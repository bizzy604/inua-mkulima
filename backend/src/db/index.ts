/** Owns business-database setup, migrations, repeat-safe seed data, and SQL export. */
import Database from "better-sqlite3";
import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";

/** Opens a business or session database with the required SQLite safety pragmas. */
export function openDatabase(path: string): Database.Database {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path, { timeout: 3_000 });
  db.pragma("foreign_keys = ON");
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = FULL");
  return db;
}

/** Applies each numbered migration once, preserving existing business data. */
export function migrate(db: Database.Database): void {
  const directory = new URL("./migrations/", import.meta.url);
  db.transaction(() => {
    db.exec(
      "CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL) STRICT",
    );
    const known = db.prepare("SELECT 1 FROM schema_migrations WHERE name = ?");
    const record = db.prepare(
      "INSERT INTO schema_migrations(name, applied_at) VALUES (?, ?)",
    );
    for (const name of readdirSync(directory)
      .filter((file) => /^\d+_.+\.sql$/.test(file))
      .sort()) {
      if (known.get(name)) continue;
      db.exec(readFileSync(new URL(name, directory), "utf8"));
      record.run(name, new Date().toISOString());
    }
  }).immediate();
}

/** Inserts missing fictional products and wallet data without replenishing balances. */
export function seed(db: Database.Database, dealerId = "demo-dealer"): void {
  db.transaction(() => {
    const now = new Date().toISOString();
    const insert = db.prepare(
      "INSERT INTO products(id, name, price_minor, created_at, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING",
    );
    const products = [
      [1, "Animal feeds 10kg", 150000],
      [2, "Mineral salts 500g", 30000],
      [3, "Maize seeds 2kg", 36000],
      [4, "Mango seedling 1pc", 15000],
      [5, "Mango fruit fly trap 1pc", 150000],
    ] as const;
    for (const [id, name, price] of products)
      insert.run(id, name, price, now, now);
    db.prepare(
      `INSERT INTO wallets(dealer_id, farmer_name, farmer_reference, farmer_phone, name, balance_minor, updated_at)
      VALUES (?, 'Demo Farmer', ?, 'DEMO-NOT-A-PHONE', 'Inua Mkulima', 240000, ?) ON CONFLICT(dealer_id) DO NOTHING`,
    ).run(dealerId, `DEMO-FARMER-${dealerId}`, now);
  }).immediate();
}

/** A consistent business-only SQL snapshot. Sessions use a separate database. */
export function dumpDatabase(db: Database.Database): string {
  return db.transaction(() => {
    const lines = [
      "-- Fictional Inua Mkulima business data; no session data.",
      "PRAGMA foreign_keys = ON;",
      "BEGIN TRANSACTION;",
    ];
    const tables = [
      "schema_migrations",
      "products",
      "wallets",
      "transactions",
      "transaction_items",
    ];
    for (const table of tables) {
      const schema = db
        .prepare(
          "SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = ?",
        )
        .get(table) as { sql: string } | undefined;
      if (!schema) continue;
      lines.push(`${schema.sql};`);
      const columns = (
        db.prepare(`PRAGMA table_info("${table}")`).all() as { name: string }[]
      ).map((column) => column.name);
      // SQLite quotes integers and ordinary strings. Embedded NUL requires a hex
      // literal because SQLite quote() truncates text at its first NUL character.
      const quoted = columns.map(
        (column) =>
          `CASE WHEN typeof("${column}") = 'text' AND instr("${column}", char(0)) > 0 THEN 'CAST(X''' || hex("${column}") || ''' AS TEXT)' ELSE quote("${column}") END AS "${column}"`,
      );
      const rows = db
        .prepare(`SELECT ${quoted.join(", ")} FROM "${table}" ORDER BY rowid`)
        .all() as Record<string, string>[];
      for (const row of rows)
        lines.push(
          `INSERT INTO "${table}" (${columns.map((column) => `"${column}"`).join(", ")}) VALUES (${columns.map((column) => row[column]).join(", ")});`,
        );
    }
    const indexes = db
      .prepare(
        "SELECT sql FROM sqlite_schema WHERE type = 'index' AND sql IS NOT NULL ORDER BY name",
      )
      .all() as { sql: string }[];
    lines.push(...indexes.map((index) => `${index.sql};`), "COMMIT;", "");
    return lines.join("\n");
  })();
}
