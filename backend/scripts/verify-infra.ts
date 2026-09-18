import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { createLogger } from "../src/infrastructure/logger.js";
import { startQueue, type QueueHandle } from "../src/infrastructure/queue.js";

const directory = mkdtempSync(join(tmpdir(), "inua-infrastructure-"));
const db = new Database(join(directory, "verification.sqlite"));
const lokiUrl = process.env.LOKI_URL ?? "http://127.0.0.1:3100";
const rabbitmqUrl =
  process.env.RABBITMQ_URL ?? "amqp://inua:local-rabbitmq-only@127.0.0.1:5672";
const logger = createLogger({
  logDir: directory,
  lokiUrl,
  nodeEnv: "verification",
  logLevel: "info",
});
const transactionId = randomUUID();
let worker: QueueHandle | undefined;

async function eventually(
  check: () => boolean | Promise<boolean>,
  description: string,
): Promise<void> {
  const deadline = Date.now() + 60_000;
  do {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  } while (Date.now() < deadline);
  throw new Error(`Timed out: ${description}. Evidence: ${directory}`);
}

function activityCount(): number {
  return readFileSync(join(directory, "application.log"), "utf8")
    .split("\n")
    .filter((line) => {
      if (!line) return false;
      const entry = JSON.parse(line) as Record<string, unknown>;
      return (
        entry.message === "purchase.completed.processed" &&
        entry.transactionId === transactionId
      );
    }).length;
}

try {
  db.exec(
    "CREATE TABLE wallets (id INTEGER PRIMARY KEY, balance_minor INTEGER); INSERT INTO wallets VALUES (1,100000); CREATE TABLE transactions (id TEXT PRIMARY KEY, request_id TEXT, created_at TEXT, deduction_total_minor INTEGER, event_published_at TEXT)",
  );
  db.prepare("INSERT INTO transactions VALUES (?, ?, ?, ?, NULL)").run(
    transactionId,
    `infra-${randomUUID()}`,
    new Date().toISOString(),
    140000,
  );
  worker = startQueue(db, logger, rabbitmqUrl);
  await eventually(
    () => activityCount() >= 1,
    "real RabbitMQ consumer local write",
  );
  await eventually(
    () =>
      Boolean(
        (
          db.prepare("SELECT event_published_at FROM transactions").get() as {
            event_published_at: string | null;
          }
        ).event_published_at,
      ),
    "publisher confirmation marker",
  );
  await worker.stop();

  // Recreate the allowed crash window: broker received the event, but its marker
  // did not persist. Recovery must replay the event without touching the wallet.
  db.prepare("UPDATE transactions SET event_published_at = NULL").run();
  const beforeReplay = activityCount();
  worker = startQueue(db, logger, rabbitmqUrl);
  await eventually(
    () => activityCount() > beforeReplay,
    "pending event replay after restart",
  );
  assert.equal(
    (
      db.prepare("SELECT balance_minor FROM wallets").get() as {
        balance_minor: number;
      }
    ).balance_minor,
    100000,
  );

  let queryEvidence: unknown;
  const query = new URL("/loki/api/v1/query_range", lokiUrl);
  query.searchParams.set(
    "query",
    `{app="inua-mkulima",environment="verification"} |= "purchase.completed.processed" |= "${transactionId}"`,
  );
  query.searchParams.set("since", "1h");
  query.searchParams.set("limit", "100");
  await eventually(async () => {
    try {
      const response = await fetch(query, {
        signal: AbortSignal.timeout(3000),
      });
      if (!response.ok) return false;
      const body = (await response.json()) as {
        data?: { result?: Array<{ values: Array<[string, string]> }> };
      };
      queryEvidence = body;
      return (
        body.data?.result?.some((stream) =>
          stream.values.some(([, line]) => line.includes(transactionId)),
        ) ?? false
      );
    } catch {
      return false;
    }
  }, "same transaction ID in real Loki query");
  writeFileSync(
    join(directory, "loki-query.json"),
    JSON.stringify(queryEvidence, null, 2),
  );
  const report = {
    result: "PASS",
    checks: [
      "A16 real broker consumption and pending-event replay",
      "A17 local log and Loki transaction correlation",
    ],
    transactionId,
    walletBalanceMinor: 100000,
    activityCount: activityCount(),
    directory,
    lokiQuery: query.toString(),
  };
  writeFileSync(
    join(directory, "report.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  console.error(
    error instanceof Error
      ? error.message
      : "Infrastructure verification failed",
  );
  process.exitCode = 1;
} finally {
  await worker?.stop();
  await logger.close();
  db.close();
}
