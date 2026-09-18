import { afterEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { createServer, type RequestListener, type Server } from "node:http";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import type amqp from "amqplib";
import {
  createLogger,
  LokiTransport,
  RotatingJsonTransport,
  type AppLogger,
} from "../src/infrastructure/logger.js";
import {
  consumePurchaseMessage,
  parsePurchaseEvent,
  startQueue,
  type PurchaseEvent,
  type QueueHandle,
} from "../src/infrastructure/queue.js";

const event: PurchaseEvent = {
  eventId: "transaction-1",
  transactionId: "transaction-1",
  eventType: "purchase.completed",
  requestId: "request-1",
  timestamp: new Date().toISOString(),
  deductionTotalMinor: 140000,
};
const resources: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of resources.reverse()) await cleanup();
  resources.length = 0;
});
function directory(): string {
  const path = mkdtempSync(join(tmpdir(), "inua-log-test-"));
  resources.push(() => rmSync(path, { recursive: true, force: true }));
  return path;
}
function fakeLogger(): AppLogger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    writeActivity: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  };
}
async function until(check: () => boolean): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > 2500) throw new Error("Condition timed out");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
async function serve(
  handler: RequestListener,
): Promise<{ server: Server; url: string }> {
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  resources.push(
    () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  );
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("No server address");
  return { server, url: `http://127.0.0.1:${address.port}` };
}

describe("local logs and Loki", () => {
  it("rotates JSON files by size and retains the configured history", () => {
    const transport = new RotatingJsonTransport(directory(), 70, 2);
    for (let index = 0; index < 4; index++)
      transport.writeRecord({ message: "a".repeat(35), index });
    expect(JSON.parse(readFileSync(transport.filename, "utf8")).index).toBe(3);
    expect(
      JSON.parse(readFileSync(`${transport.filename}.1`, "utf8")).index,
    ).toBe(2);
    expect(
      JSON.parse(readFileSync(`${transport.filename}.2`, "utf8")).index,
    ).toBe(1);
  });

  it("writes the correlated activity locally and pushes the same event to Loki with low-cardinality labels", async () => {
    const received: Array<{
      streams: Array<{
        stream: Record<string, string>;
        values: Array<[string, string]>;
      }>;
    }> = [];
    const { url } = await serve((request, response) => {
      let body = "";
      request.on("data", (chunk: Buffer) => {
        body += chunk.toString();
      });
      request.on("end", () => {
        received.push(JSON.parse(body));
        response.writeHead(204).end();
      });
    });
    const logDir = directory();
    const logger = createLogger({
      logDir,
      lokiUrl: url,
      nodeEnv: "test",
      logLevel: "info",
    });
    await logger.writeActivity("purchase.completed.processed", {
      ...event,
      password: "secret",
      verificationCode: "123456",
    });
    const local = JSON.parse(
      readFileSync(join(logDir, "application.log"), "utf8"),
    );
    expect(local.transactionId).toBe(event.transactionId);
    expect(local.password).toBe("[redacted]");
    await logger.close();
    expect(received).toHaveLength(1);
    expect(received[0]!.streams[0]!.stream).toEqual({
      app: "inua-mkulima",
      environment: "test",
      level: "info",
    });
    expect(JSON.parse(received[0]!.streams[0]!.values[0]![1])).toEqual(local);
  });

  it("keeps writes local during a Loki outage and bounds buffered work", async () => {
    const { url } = await serve((_request, response) => {
      response.writeHead(503).end();
    });
    const fallback = vi.fn();
    const transport = new LokiTransport(url, "test", fallback);
    for (let index = 0; index < 1000; index++)
      transport.enqueue({
        level: "info",
        message: "event",
        timestamp: new Date().toISOString(),
        index,
      });
    await transport.flush();
    expect(fallback).toHaveBeenCalledTimes(1);
    expect((transport as unknown as { buffer: unknown[] }).buffer).toHaveLength(
      500,
    );
    await transport.shutdown();
  });
});

describe("purchase event consumer", () => {
  it("acknowledges only after the local write completes", async () => {
    const logger = fakeLogger();
    let complete!: () => void;
    logger.writeActivity = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          complete = resolve;
        }),
    );
    const channel = { ack: vi.fn(), reject: vi.fn() };
    const message = {
      content: Buffer.from(JSON.stringify(event)),
    } as amqp.ConsumeMessage;
    const work = consumePurchaseMessage(message, channel, logger);
    expect(channel.ack).not.toHaveBeenCalled();
    complete();
    await work;
    expect(channel.ack).toHaveBeenCalledWith(message);
  });

  it("leaves failed local writes unacknowledged and discards malformed messages without requeue", async () => {
    const logger = fakeLogger();
    logger.writeActivity = vi.fn().mockRejectedValue(new Error("Disk full"));
    const channel = { ack: vi.fn(), reject: vi.fn() };
    await expect(
      consumePurchaseMessage(
        { content: Buffer.from(JSON.stringify(event)) } as amqp.ConsumeMessage,
        channel,
        logger,
      ),
    ).rejects.toThrow("Disk full");
    expect(channel.ack).not.toHaveBeenCalled();
    expect(channel.reject).not.toHaveBeenCalled();
    const invalid = { content: Buffer.from("{") } as amqp.ConsumeMessage;
    await consumePurchaseMessage(invalid, channel, logger);
    expect(channel.reject).toHaveBeenCalledWith(invalid, false);
  });

  it("rejects unexpected identity fields, mismatched event IDs and unsafe amounts", () => {
    for (const invalid of [
      { ...event, phone: "secret" },
      { ...event, eventId: "other" },
      { ...event, deductionTotalMinor: 0 },
      { ...event, deductionTotalMinor: Number.MAX_SAFE_INTEGER + 1 },
    ]) {
      expect(() =>
        parsePurchaseEvent(Buffer.from(JSON.stringify(invalid))),
      ).toThrow();
    }
  });
});

describe("pending publication recovery", () => {
  function fixture(
    onSend: (callback: (error: Error | null) => void, body: Buffer) => void,
  ) {
    const db = new Database(":memory:");
    resources.push(() => {
      db.close();
    });
    db.exec(
      "CREATE TABLE transactions(id TEXT,request_id TEXT,created_at TEXT,deduction_total_minor INTEGER,event_published_at TEXT); CREATE TABLE wallets(balance_minor INTEGER); INSERT INTO wallets VALUES(100000)",
    );
    db.prepare("INSERT INTO transactions VALUES(?,?,?,?,NULL)").run(
      event.transactionId,
      event.requestId,
      event.timestamp,
      event.deductionTotalMinor,
    );
    const publisher = Object.assign(new EventEmitter(), {
      assertQueue: vi.fn().mockResolvedValue({}),
      sendToQueue: vi.fn(
        (
          _queue: string,
          body: Buffer,
          _options: unknown,
          callback: (error: Error | null) => void,
        ) => {
          onSend(callback, body);
          return true;
        },
      ),
    });
    const consumer = Object.assign(new EventEmitter(), {
      prefetch: vi.fn().mockResolvedValue(undefined),
      consume: vi.fn().mockResolvedValue({ consumerTag: "test" }),
    });
    const connection = Object.assign(new EventEmitter(), {
      createConfirmChannel: vi.fn().mockResolvedValue(publisher),
      createChannel: vi.fn().mockResolvedValue(consumer),
      close: vi.fn().mockResolvedValue(undefined),
    });
    const connect = vi
      .fn()
      .mockResolvedValue(connection) as unknown as typeof amqp.connect;
    let worker: QueueHandle;
    const start = () => {
      worker = startQueue(db, fakeLogger(), "amqp://test", {
        connect,
        intervalMs: 25,
        timeoutMs: 100,
      });
      resources.push(() => worker.stop());
      return worker;
    };
    const marker = () =>
      (
        db.prepare("SELECT event_published_at FROM transactions").get() as {
          event_published_at: string | null;
        }
      ).event_published_at;
    return { db, publisher, connect, start, marker };
  }

  it("waits for publisher confirmation and does not overlap wake requests", async () => {
    let confirm!: (error: Error | null) => void;
    const setup = fixture((callback) => {
      confirm = callback;
    });
    const worker = setup.start();
    await until(() => setup.publisher.sendToQueue.mock.calls.length === 1);
    for (let index = 0; index < 10; index++) worker.wake();
    expect(setup.marker()).toBeNull();
    expect(setup.publisher.sendToQueue).toHaveBeenCalledTimes(1);
    confirm(null);
    await until(() => setup.marker() !== null);
    expect(setup.publisher.sendToQueue.mock.calls[0]![2]).toMatchObject({
      persistent: true,
      mandatory: true,
      messageId: event.eventId,
    });
  });

  it("retries a failed confirmation with the same event ID without changing the wallet", async () => {
    const sent: PurchaseEvent[] = [];
    const setup = fixture((callback, body) => {
      sent.push(JSON.parse(body.toString()));
      callback(sent.length === 1 ? new Error("Broker down") : null);
    });
    setup.start();
    await until(() => setup.marker() !== null);
    expect(sent).toHaveLength(2);
    expect(sent[0]).toEqual(sent[1]);
    expect(setup.db.prepare("SELECT balance_minor FROM wallets").get()).toEqual(
      { balance_minor: 100000 },
    );
    expect(setup.connect).toHaveBeenCalledTimes(2);
  });
});
