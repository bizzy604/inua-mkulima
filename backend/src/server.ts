/** Starts the single backend process and coordinates graceful resource shutdown. */
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { openDatabase, migrate } from "./db/index.js";
import { createLogger } from "./infrastructure/logger.js";
import { startQueue } from "./infrastructure/queue.js";

async function main() {
  const config = loadConfig();
  const logger = createLogger(config);
  const db = openDatabase(config.databasePath);
  const sessionDb = openDatabase(config.sessionDatabasePath);
  migrate(db);
  const queue = startQueue(db, logger, config.rabbitmqUrl);
  const { app, close } = createApp({
    config,
    db,
    sessionDb,
    logger,
    onPurchase: queue.wake,
  });
  const server = app.listen(config.port, () =>
    logger.info("server.started", { port: config.port }),
  );
  let stopping = false;
  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    const deadline = setTimeout(() => {
      server.closeAllConnections();
    }, 10_000);
    deadline.unref();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await queue.stop();
    close();
    sessionDb.close();
    db.close();
    logger.info("server.stopped");
    await logger.close();
    clearTimeout(deadline);
  };
  process.once("SIGINT", () => {
    void shutdown();
  });
  process.once("SIGTERM", () => {
    void shutdown();
  });
  server.once("error", (error) => {
    logger.error("server.failed", {
      code: (error as NodeJS.ErrnoException).code ?? "UNKNOWN",
    });
    process.exitCode = 1;
    void shutdown();
  });
}
main().catch(() => {
  // Configuration validation errors may contain secrets. Print only the remediation.
  console.error(
    "Backend startup failed. Check .env configuration, database permissions, and migrations.",
  );
  process.exitCode = 1;
});
