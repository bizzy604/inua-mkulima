import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { dumpDatabase, migrate, openDatabase, seed } from '../src/db/index.js';
import { completePurchase, getTransaction, listTransactions, previewPurchase } from '../src/transactions/service.js';
import { cartSchema, paymentSchema, type CartPayload } from '../src/transactions/schemas.js';
import { createReceipt } from '../src/transactions/receipt.js';

const dealer = 'demo-dealer';
const cart = (): CartPayload => ({ items: [
  { productId: 1, quantity: 1, expectedUnitPriceMinor: 150000, deductionMinor: 90000 },
  { productId: 2, quantity: 2, expectedUnitPriceMinor: 30000, deductionMinor: 50000 },
], expectedDeductionTotalMinor: 140000 });

describe('persisted purchases and accounting invariants', () => {
  let db: ReturnType<typeof openDatabase>;
  let directory: string;
  let path: string;
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'inua-purchase-'));
    path = join(directory, 'business.sqlite');
    db = openDatabase(path); migrate(db); seed(db);
  });
  afterEach(() => { if (db.open) db.close(); rmSync(directory, { recursive: true, force: true }); });
  const balance = () => (db.prepare('SELECT balance_minor AS balance FROM wallets WHERE dealer_id = ?').get(dealer) as { balance: number }).balance;
  const count = () => (db.prepare('SELECT count(*) AS count FROM transactions').get() as { count: number }).count;
  const purchase = (payload = cart(), key = randomUUID()) => completePurchase(db, dealer, payload, key, randomUUID());

  it('A07/A12: previews without writes then saves the exact worked example and pending event', () => {
    expect(previewPurchase(db, dealer, cart())).toMatchObject({ purchaseTotalMinor: 210000, deductionTotalMinor: 140000, customerDueMinor: 70000, walletBalanceMinor: 240000, walletAfterMinor: 100000 });
    expect(balance()).toBe(240000); expect(count()).toBe(0);
    const { transaction, replayed } = purchase();
    expect(replayed).toBe(false);
    expect(transaction).toMatchObject({ purchaseTotalMinor: 210000, deductionTotalMinor: 140000, customerDueMinor: 70000, walletBeforeMinor: 240000, walletAfterMinor: 100000 });
    expect(transaction.items).toHaveLength(2); expect(balance()).toBe(100000); expect(count()).toBe(1);
    expect(db.prepare('SELECT event_published_at FROM transactions').get()).toEqual({ event_published_at: null });
  });
  it('A08: insufficient funds preserve balance and all records', () => {
    purchase();
    expect(() => purchase()).toThrow('wallet balance is too low');
    expect(balance()).toBe(100000); expect(count()).toBe(1);
  });
  it('A09: an actual item-insert failure rolls back header, earlier items and debit', () => {
    db.exec("CREATE TRIGGER fail_second_item BEFORE INSERT ON transaction_items WHEN NEW.product_id = 2 BEGIN SELECT RAISE(ABORT, 'injected item failure'); END");
    expect(() => purchase()).toThrow('injected item failure');
    expect(balance()).toBe(240000); expect(count()).toBe(0);
    expect(db.prepare('SELECT count(*) AS count FROM transaction_items').get()).toEqual({ count: 0 });
  });
  it('A10: retry after price/deactivation/balance changes returns original snapshot without debit', () => {
    const key = randomUUID(); const first = purchase(cart(), key);
    db.prepare("UPDATE products SET name = 'Changed', price_minor = 1, active = 0 WHERE id = 1").run();
    const reversed = { ...cart(), items: cart().items.reverse() };
    const replay = purchase(reversed, key);
    expect(replay.replayed).toBe(true); expect(replay.transaction).toEqual(first.transaction);
    expect(balance()).toBe(100000); expect(count()).toBe(1);
    expect(() => purchase({ ...cart(), expectedDeductionTotalMinor: 1 }, key)).toThrow('different purchase');
  });
  it('A15: saved parties and item names/prices survive edits; access is owner scoped', async () => {
    const { transaction } = purchase();
    db.exec("UPDATE products SET name = 'Renamed', price_minor = 1; UPDATE wallets SET farmer_name = 'Changed farmer'");
    expect(getTransaction(db, dealer, transaction.id)).toEqual(transaction);
    expect(() => getTransaction(db, 'another-dealer', transaction.id)).toThrow('not found');
    expect(listTransactions(db, 'another-dealer').total).toBe(0);
    expect(listTransactions(db, dealer, 999).limit).toBe(100);
    const pdf = await createReceipt(transaction);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-'); expect(pdf.length).toBeGreaterThan(1000);
  });
  it('A14: a receipt paginates fifty long product names and includes the provided vector logo', async () => {
    const value: CartPayload = { items: [], expectedDeductionTotalMinor: 50 };
    for (let id = 1; id <= 50; id++) {
      const name = `Product ${id} ` + 'Long fictional agricultural product description '.repeat(4);
      db.prepare('INSERT INTO products(id,name,price_minor,created_at,updated_at) VALUES (?,?,100,?,?) ON CONFLICT(id) DO UPDATE SET name = excluded.name, price_minor = 100').run(id, name, new Date().toISOString(), new Date().toISOString());
      value.items.push({ productId: id, quantity: 1, expectedUnitPriceMinor: 100, deductionMinor: 1 });
    }
    const pdf = await createReceipt(purchase(value).transaction);
    expect([...pdf.toString('latin1').matchAll(/\/Type \/Page\b/g)].length).toBeGreaterThan(3);
    // The source logo contains gradients; PDFKit serializes them as shadings.
    expect(pdf.toString('latin1')).toContain('/Shading');
  });
  it('A19: migration/seed are repeatable and restart plus SQL restore preserve purchases', () => {
    const first = purchase();
    migrate(db); seed(db); expect(balance()).toBe(100000);
    db.close(); db = openDatabase(path);
    expect(getTransaction(db, dealer, first.transaction.id)).toEqual(first.transaction);
    const restored = openDatabase(':memory:');
    try {
      restored.exec(dumpDatabase(db));
      migrate(restored); seed(restored);
      expect(getTransaction(restored, dealer, first.transaction.id)).toEqual(first.transaction);
      expect(restored.prepare('SELECT balance_minor FROM wallets').get()).toEqual({ balance_minor: 100000 });
      expect(restored.pragma('foreign_key_check')).toEqual([]);
    } finally { restored.close(); }
  });
  it('A19: dump preserves quoted and NUL-containing product names exactly', () => {
    const name = "Farmer's seed\0batch";
    db.prepare('UPDATE products SET name = ? WHERE id = 1').run(name);
    const restored = openDatabase(':memory:');
    try {
      restored.exec(dumpDatabase(db));
      expect(restored.prepare('SELECT name FROM products WHERE id = 1').get()).toEqual({ name });
    } finally { restored.close(); }
  });
  it.each([
    ['empty cart', (value: CartPayload) => { value.items = []; }],
    ['duplicate product', (value: CartPayload) => { value.items.push({ ...value.items[0]! }); }],
    ['zero quantity', (value: CartPayload) => { value.items[0]!.quantity = 0; }],
    ['fractional quantity', (value: CartPayload) => { value.items[0]!.quantity = 1.2; }],
    ['excessive quantity', (value: CartPayload) => { value.items[0]!.quantity = 1000; }],
    ['negative deduction', (value: CartPayload) => { value.items[0]!.deductionMinor = -1; }],
    ['unsafe amount', (value: CartPayload) => { value.items[0]!.deductionMinor = Number.MAX_SAFE_INTEGER + 1; }],
    ['zero total', (value: CartPayload) => { value.expectedDeductionTotalMinor = 0; }],
  ])('A06: rejects %s without changing the wallet', (_name, change) => {
    const value = cart(); change(value);
    expect(cartSchema.safeParse(value).success).toBe(false);
    expect(() => purchase(value)).toThrow(); expect(balance()).toBe(240000); expect(count()).toBe(0);
  });
  it.each([
    ['line deduction above total', (value: CartPayload) => { value.items[0]!.deductionMinor = 150001; }, 'line deduction'],
    ['wrong total', (value: CartPayload) => { value.expectedDeductionTotalMinor = 10; }, 'submitted deduction total'],
    ['price conflict', (value: CartPayload) => { value.items[0]!.expectedUnitPriceMinor = 1; }, 'price changed'],
    ['missing product', (value: CartPayload) => { value.items[0]!.productId = 999; }, 'not found'],
  ])('A06: rejects %s transactionally', (_name, change, message) => {
    const value = cart(); change(value);
    expect(() => purchase(value)).toThrow(message); expect(balance()).toBe(240000); expect(count()).toBe(0);
  });
  it('A06: rejects inactive products, unsafe line multiplication and unsafe cart sums', () => {
    db.exec('UPDATE products SET active = 0 WHERE id = 1');
    expect(() => purchase()).toThrow('no longer available');
    db.prepare('UPDATE products SET active = 1, price_minor = ? WHERE id IN (1, 2)').run(Number.MAX_SAFE_INTEGER);
    const value = cart(); value.items.forEach((item) => { item.expectedUnitPriceMinor = Number.MAX_SAFE_INTEGER; item.quantity = 1; });
    expect(() => purchase(value)).toThrow('integer range');
    value.items = [value.items[0]!]; value.items[0]!.quantity = 2;
    expect(() => purchase(value)).toThrow('integer range'); expect(balance()).toBe(240000);
  });
  it('A12: requires a six-digit payment code at the request boundary', () => {
    expect(paymentSchema.safeParse(cart()).success).toBe(false);
    expect(paymentSchema.safeParse({ ...cart(), verificationCode: '12345a' }).success).toBe(false);
    expect(paymentSchema.safeParse({ ...cart(), verificationCode: '123456' }).success).toBe(true);
  });
  it('A11: two independently running processes cannot overspend the same wallet', async () => {
    const dbModule = new URL('../src/db/index.ts', import.meta.url).href;
    const serviceModule = new URL('../src/transactions/service.ts', import.meta.url).href;
    const children: ChildProcessWithoutNullStreams[] = [];
    const launch = () => {
      const script = `import {openDatabase} from ${JSON.stringify(dbModule)};
        import {completePurchase} from ${JSON.stringify(serviceModule)};
        const db = openDatabase(${JSON.stringify(path)});
        process.stdout.write('READY\\n');
        process.stdin.once('data', () => {
          try { const result = completePurchase(db, 'demo-dealer', ${JSON.stringify(cart())}, ${JSON.stringify(randomUUID())}, 'concurrent-request'); process.stdout.write(JSON.stringify({ok:true,id:result.transaction.id})+'\\n'); }
          catch (error) { process.stdout.write(JSON.stringify({ok:false,code:error.code})+'\\n'); }
          finally { db.close(); process.stdin.destroy(); }
        });`;
      const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '--eval', script], { cwd: new URL('../', import.meta.url), stdio: 'pipe' });
      children.push(child);
      let output = ''; let errors = ''; let resolveReady: () => void;
      const ready = new Promise<void>((resolve) => { resolveReady = resolve; });
      child.stdout.on('data', (chunk: Buffer) => { output += chunk.toString(); if (output.includes('READY\n')) resolveReady(); });
      child.stderr.on('data', (chunk: Buffer) => { errors += chunk.toString(); });
      const result = new Promise<{ok: boolean; code?: string}>((resolve, reject) => {
        child.on('error', reject);
        child.on('close', (code) => {
          if (code !== 0) { reject(new Error(errors || `Child exited ${code}`)); return; }
          try { resolve(JSON.parse(output.trim().split('\n').at(-1)!)); } catch (error) { reject(error); }
        });
      });
      return { ready: Promise.race([ready, result.then(() => { throw new Error('Worker exited before start.'); })]), result, child };
    };
    try {
      const first = launch(); const second = launch();
      await Promise.all([first.ready, second.ready]);
      first.child.stdin.write('GO\n'); second.child.stdin.write('GO\n');
      const results = await Promise.all([first.result, second.result]);
      expect(results.filter((result) => result.ok)).toHaveLength(1);
      expect(results.find((result) => !result.ok)?.code).toBe('INSUFFICIENT_FUNDS');
      expect(balance()).toBe(100000); expect(count()).toBe(1);
    } finally { for (const child of children) if (child.exitCode === null) child.kill(); }
  }, 15_000);
});
