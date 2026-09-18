/** Provides explicit migration, seed, reset, dump, and fresh-database restore commands. */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import dotenv from 'dotenv';
import { projectRoot } from '../config.js';
import { dumpDatabase, migrate, openDatabase, seed } from './index.js';

const [command, file] = process.argv.slice(2);
dotenv.config({ path: resolve(projectRoot, '.env'), quiet: true });
if (!process.env.DATABASE_PATH) throw new Error('DATABASE_PATH is required. Configure your local .env before running a database command.');
const databasePath = resolve(projectRoot, process.env.DATABASE_PATH);
const db = openDatabase(databasePath);
try {
  switch (command) {
    case 'migrate': migrate(db); break;
    case 'seed': migrate(db); seed(db, process.env.DEMO_DEALER_ID ?? 'demo-dealer'); break;
    case 'reset':
      if (!process.argv.includes('--confirm-demo-reset')) throw new Error('Reset requires --confirm-demo-reset; this permanently clears local business data.');
      if (process.env.NODE_ENV === 'production') throw new Error('Demo reset is disabled in production.');
      migrate(db);
      db.transaction(() => {
        db.exec('DELETE FROM transaction_items; DELETE FROM transactions; DELETE FROM wallets; DELETE FROM products;');
        seed(db, process.env.DEMO_DEALER_ID ?? 'demo-dealer');
      }).immediate();
      break;
    case 'dump': {
      const target = resolve(projectRoot, file ?? 'business-data.sql');
      if (target === resolve(databasePath)) throw new Error('Dump target must differ from the database file.');
      writeFileSync(target, dumpDatabase(db), { encoding: 'utf8', flag: 'wx' });
      console.log(`Wrote ${target}`);
      break;
    }
    case 'restore':
      if (!file) throw new Error('Provide a trusted business SQL dump path.');
      if ((db.prepare("SELECT count(*) AS count FROM sqlite_schema WHERE type = 'table'").get() as { count: number }).count !== 0) throw new Error('Restore requires a fresh, empty database.');
      db.exec(readFileSync(file, 'utf8'));
      break;
    default: throw new Error('Expected migrate, seed, reset, dump [file], or restore <file>.');
  }
} finally {
  db.close();
}
