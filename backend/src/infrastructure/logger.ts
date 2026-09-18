/** Provides structured local-file logging and bounded, best-effort Loki delivery. */
import {
  appendFileSync,
  mkdirSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import { join } from "node:path";
import winston from "winston";
import Transport from "winston-transport";

export type LogMetadata = Record<string, unknown>;
export interface AppLogger {
  info(message: string, metadata?: LogMetadata): void;
  warn(message: string, metadata?: LogMetadata): void;
  error(message: string, metadata?: LogMetadata): void;
  debug(message: string, metadata?: LogMetadata): void;
  /** Resolves only after the local file append; Loki is best effort. */
  writeActivity(message: string, metadata?: LogMetadata): Promise<void>;
  close(): Promise<void>;
}

const sensitive =
  /password|cookie|authorization|session|verification|phone|farmer|receiptparties|requestbody|^body$|^code$/i;
function clean(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[truncated]";
  if (value instanceof Error) return { name: value.name };
  if (Array.isArray(value))
    return value.slice(0, 100).map((item) => clean(item, depth + 1));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        sensitive.test(key) ? "[redacted]" : clean(item, depth + 1),
      ]),
    );
  }
  return typeof value === "bigint" ? value.toString() : value;
}

export class RotatingJsonTransport extends Transport {
  private size = 0;
  readonly filename: string;
  constructor(
    logDir: string,
    private readonly maxBytes = 5 * 1024 * 1024,
    private readonly retained = 3,
  ) {
    super();
    mkdirSync(logDir, { recursive: true });
    this.filename = join(logDir, "application.log");
    try {
      this.size = statSync(this.filename).size;
    } catch {
      /* First startup. */
    }
    // Validate that the destination is writable at startup.
    appendFileSync(this.filename, "", { mode: 0o600 });
  }

  writeRecord(record: LogMetadata): void {
    const line = `${JSON.stringify(record)}\n`;
    const bytes = Buffer.byteLength(line);
    if (this.size > 0 && this.size + bytes > this.maxBytes) {
      rmSync(`${this.filename}.${this.retained}`, { force: true });
      for (let index = this.retained - 1; index >= 1; index--) {
        try {
          renameSync(
            `${this.filename}.${index}`,
            `${this.filename}.${index + 1}`,
          );
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
      }
      renameSync(this.filename, `${this.filename}.1`);
      this.size = 0;
    }
    appendFileSync(this.filename, line, { mode: 0o600 });
    this.size += bytes;
  }

  override log(info: LogMetadata, callback: () => void): void {
    try {
      this.writeRecord(info);
    } catch {
      process.stderr.write(
        '{"level":"error","message":"local_log_write_failed"}\n',
      );
    }
    callback();
  }
}

/** Small bounded transport: outage delivery is best effort; disk is authoritative. */
export class LokiTransport extends Transport {
  private readonly buffer: LogMetadata[] = [];
  private active: Promise<void> | undefined;
  private stopped = false;
  private lastFallback = 0;
  private readonly timer: NodeJS.Timeout;

  constructor(
    private readonly url: string,
    private readonly environment: string,
    private readonly fallback: (record: LogMetadata) => void,
  ) {
    super();
    this.timer = setInterval(() => {
      void this.flush();
    }, 1000);
    this.timer.unref();
  }

  override log(info: LogMetadata, callback: () => void): void {
    this.enqueue(info);
    callback();
  }

  enqueue(info: LogMetadata): void {
    if (this.stopped) return;
    if (this.buffer.length >= 500) {
      this.buffer.shift();
      this.noteFailure("loki_buffer_full");
    }
    this.buffer.push({ ...info });
  }

  private noteFailure(message: string): void {
    if (Date.now() - this.lastFallback < 30_000) return;
    this.lastFallback = Date.now();
    try {
      this.fallback({
        level: "warn",
        message,
        timestamp: new Date().toISOString(),
      });
    } catch {
      process.stderr.write(
        '{"level":"error","message":"logging_dependencies_unavailable"}\n',
      );
    }
  }

  flush(): Promise<void> {
    if (this.active) return this.active;
    if (!this.buffer.length) return Promise.resolve();
    const batch = this.buffer.splice(0, 100);
    this.active = (async () => {
      try {
        const streams = batch.map((record) => ({
          stream: {
            app: "inua-mkulima",
            environment: this.environment,
            level: String(record.level),
          },
          values: [
            [
              String(BigInt(Date.parse(String(record.timestamp))) * 1_000_000n),
              JSON.stringify(record),
            ],
          ],
        }));
        const response = await fetch(
          `${this.url.replace(/\/$/, "")}/loki/api/v1/push`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ streams }),
            signal: AbortSignal.timeout(2000),
          },
        );
        await response.body?.cancel();
        if (!response.ok) throw new Error("Loki rejected batch");
      } catch {
        // Keep the newest bounded set, including the failed batch when space allows.
        this.buffer.unshift(...batch);
        if (this.buffer.length > 500)
          this.buffer.splice(0, this.buffer.length - 500);
        this.noteFailure("loki_delivery_failed");
      } finally {
        this.active = undefined;
      }
    })();
    return this.active;
  }

  async shutdown(): Promise<void> {
    clearInterval(this.timer);
    this.stopped = true;
    await this.flush(); // One bounded final batch; no unbounded outage drain.
  }
}

/** Creates the shared logger; local writes remain authoritative when Loki is unavailable. */
export function createLogger(config: {
  logDir: string;
  lokiUrl: string;
  nodeEnv: string;
  logLevel: string;
}): AppLogger {
  const local = new RotatingJsonTransport(config.logDir);
  const loki = new LokiTransport(config.lokiUrl, config.nodeEnv, (record) =>
    local.writeRecord(record),
  );
  const logger = winston.createLogger({
    level: config.logLevel,
    format: winston.format.combine(
      winston.format((info) => {
        const sanitized = clean(info) as LogMetadata;
        Object.assign(info, sanitized);
        return info;
      })(),
      winston.format.timestamp(),
      winston.format.json(),
    ),
    transports: [local, loki],
  });
  logger.on("error", () => {
    process.stderr.write('{"level":"error","message":"logger_error"}\n');
  });
  return {
    info: (message, metadata = {}) => {
      logger.info(message, metadata);
    },
    warn: (message, metadata = {}) => {
      logger.warn(message, metadata);
    },
    error: (message, metadata = {}) => {
      logger.error(message, metadata);
    },
    debug: (message, metadata = {}) => {
      logger.debug(message, metadata);
    },
    async writeActivity(message, metadata = {}) {
      const record = {
        ...(clean(metadata) as LogMetadata),
        message,
        level: "info",
        timestamp: new Date().toISOString(),
      };
      local.writeRecord(record);
      loki.enqueue(record);
    },
    async close() {
      await loki.shutdown();
      logger.close();
    },
  };
}
