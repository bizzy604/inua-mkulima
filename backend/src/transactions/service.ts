/** Calculates purchases and owns the immediate SQLite transaction that debits wallets. */
import { createHash, randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { AppError } from '../middleware/errors.js';
import { cartSchema, idempotencyKeySchema, type CartPayload } from './schemas.js';

interface WalletRow {
  id: number; dealer_id: string; balance_minor: number; farmer_name: string; farmer_reference: string; farmer_phone: string; name: string;
}
export interface PurchaseItem {
  productId: number; productName: string; quantity: number; unitPriceMinor: number; lineTotalMinor: number; deductionMinor: number;
}
export interface ReceiptParties {
  dealer: { id: string; name: string };
  farmer: { name: string; reference: string; phone: string };
  walletName: string;
}
export interface SavedTransaction {
  id: string; dealerId: string; walletId: number; requestId: string;
  purchaseTotalMinor: number; deductionTotalMinor: number; customerDueMinor: number;
  walletBeforeMinor: number; walletAfterMinor: number; createdAt: string;
  items: PurchaseItem[]; receiptParties: ReceiptParties;
}
interface TransactionRow {
  id: string; dealer_id: string; wallet_id: number; request_id: string; request_hash: string;
  purchase_total_minor: number; deduction_total_minor: number; customer_due_minor: number;
  wallet_before_minor: number; wallet_after_minor: number; created_at: string; receipt_parties_json: string;
}

function safe(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new AppError(400, 'INVALID_INPUT', 'The calculated amount exceeds the supported integer range.');
  return value;
}
function assignedWallet(db: Database.Database, dealerId: string): WalletRow {
  const wallet = db.prepare('SELECT * FROM wallets WHERE dealer_id = ?').get(dealerId) as WalletRow | undefined;
  if (!wallet) throw new AppError(404, 'WALLET_NOT_FOUND', 'The assigned wallet was not found.');
  return wallet;
}
function calculate(db: Database.Database, wallet: WalletRow, payload: CartPayload) {
  let purchaseTotalMinor = 0;
  let deductionTotalMinor = 0;
  const lookup = db.prepare('SELECT id, name, price_minor, active FROM products WHERE id = ?');
  const items: PurchaseItem[] = payload.items.map((item) => {
    const product = lookup.get(item.productId) as { id: number; name: string; price_minor: number; active: number } | undefined;
    if (!product) throw new AppError(404, 'PRODUCT_NOT_FOUND', 'A selected product was not found.');
    if (!product.active) throw new AppError(409, 'PRODUCT_UNAVAILABLE', 'A selected product is no longer available.');
    if (product.price_minor !== item.expectedUnitPriceMinor) throw new AppError(409, 'PRICE_CHANGED', 'A product price changed. Reload products and review the purchase.');
    const lineTotalMinor = safe(item.quantity * product.price_minor);
    if (item.deductionMinor > lineTotalMinor) throw new AppError(400, 'INVALID_INPUT', 'A line deduction cannot exceed its line total.');
    purchaseTotalMinor = safe(purchaseTotalMinor + lineTotalMinor);
    deductionTotalMinor = safe(deductionTotalMinor + item.deductionMinor);
    return { productId: product.id, productName: product.name, quantity: item.quantity, unitPriceMinor: product.price_minor, lineTotalMinor, deductionMinor: item.deductionMinor };
  });
  if (deductionTotalMinor !== payload.expectedDeductionTotalMinor) throw new AppError(400, 'TOTAL_MISMATCH', 'The submitted deduction total does not match the line deductions.');
  if (deductionTotalMinor <= 0) throw new AppError(400, 'INVALID_INPUT', 'Enter a positive subsidy deduction.');
  if (deductionTotalMinor > wallet.balance_minor) throw new AppError(409, 'INSUFFICIENT_FUNDS', 'The wallet balance is too low for this deduction.');
  return {
    items, purchaseTotalMinor, deductionTotalMinor,
    customerDueMinor: safe(purchaseTotalMinor - deductionTotalMinor),
    walletBalanceMinor: wallet.balance_minor,
    walletAfterMinor: safe(wallet.balance_minor - deductionTotalMinor),
  };
}

/** Calculates canonical totals without reserving funds or writing any database rows. */
export function previewPurchase(db: Database.Database, dealerId: string, payload: CartPayload) {
  const cart = cartSchema.parse(payload);
  return db.transaction(() => calculate(db, assignedWallet(db, dealerId), cart))();
}

function hydrate(db: Database.Database, row: TransactionRow): SavedTransaction {
  const items = db.prepare(`SELECT product_id AS productId, product_name AS productName, quantity,
    unit_price_minor AS unitPriceMinor, line_total_minor AS lineTotalMinor, deduction_minor AS deductionMinor
    FROM transaction_items WHERE transaction_id = ? ORDER BY product_id`).all(row.id) as PurchaseItem[];
  return {
    id: row.id, dealerId: row.dealer_id, walletId: row.wallet_id, requestId: row.request_id,
    purchaseTotalMinor: row.purchase_total_minor, deductionTotalMinor: row.deduction_total_minor,
    customerDueMinor: row.customer_due_minor, walletBeforeMinor: row.wallet_before_minor,
    walletAfterMinor: row.wallet_after_minor, createdAt: row.created_at, items,
    receiptParties: JSON.parse(row.receipt_parties_json) as ReceiptParties,
  };
}
/** Retrieves a completed purchase only when it belongs to the authenticated dealer. */
export function getTransaction(db: Database.Database, dealerId: string, id: string): SavedTransaction {
  const row = db.prepare('SELECT * FROM transactions WHERE id = ? AND dealer_id = ?').get(id, dealerId) as TransactionRow | undefined;
  if (!row) throw new AppError(404, 'TRANSACTION_NOT_FOUND', 'The transaction was not found.');
  return hydrate(db, row);
}
/** Lists dealer-owned purchases with bounded pagination and saved item snapshots. */
export function listTransactions(db: Database.Database, dealerId: string, limit = 20, offset = 0) {
  if (!Number.isSafeInteger(limit) || limit < 1 || !Number.isSafeInteger(offset) || offset < 0) throw new AppError(400, 'INVALID_INPUT', 'Pagination requires positive limit and nonnegative offset integers.');
  const cappedLimit = Math.min(limit, 100);
  return db.transaction(() => {
    const rows = db.prepare('SELECT * FROM transactions WHERE dealer_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ? OFFSET ?').all(dealerId, cappedLimit, offset) as TransactionRow[];
    const { total } = db.prepare('SELECT count(*) AS total FROM transactions WHERE dealer_id = ?').get(dealerId) as { total: number };
    return { items: rows.map((row) => hydrate(db, row)), total, limit: cappedLimit, offset };
  })();
}

/** The HTTP layer verifies the demo code before calling this function. No network work occurs here. */
/** Atomically validates, debits, snapshots, and persists one purchase or returns its safe replay. */
export function completePurchase(db: Database.Database, dealerId: string, payload: CartPayload, key: string, requestId: string): { transaction: SavedTransaction; replayed: boolean } {
  // Explicit economic fields allow an already-validated payment payload without hashing its code.
  const cart = cartSchema.parse({ items: payload.items, expectedDeductionTotalMinor: payload.expectedDeductionTotalMinor });
  const idempotencyKey = idempotencyKeySchema.parse(key);
  return db.transaction(() => {
    const wallet = assignedWallet(db, dealerId);
    const canonical = { walletId: wallet.id, items: [...cart.items].sort((a, b) => a.productId - b.productId).map(({ productId, quantity, expectedUnitPriceMinor, deductionMinor }) => ({ productId, quantity, expectedUnitPriceMinor, deductionMinor })), expectedDeductionTotalMinor: cart.expectedDeductionTotalMinor };
    const hash = createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
    const existing = db.prepare('SELECT * FROM transactions WHERE dealer_id = ? AND idempotency_key = ?').get(dealerId, idempotencyKey) as TransactionRow | undefined;
    if (existing) {
      if (existing.request_hash !== hash) throw new AppError(409, 'IDEMPOTENCY_CONFLICT', 'This payment key was already used for a different purchase.');
      return { transaction: hydrate(db, existing), replayed: true };
    }
    const calculated = calculate(db, wallet, cart);
    const now = new Date().toISOString();
    const id = randomUUID();
    const debit = db.prepare('UPDATE wallets SET balance_minor = balance_minor - ?, updated_at = ? WHERE id = ? AND dealer_id = ? AND balance_minor >= ?')
      .run(calculated.deductionTotalMinor, now, wallet.id, dealerId, calculated.deductionTotalMinor);
    if (debit.changes !== 1) throw new AppError(409, 'INSUFFICIENT_FUNDS', 'The wallet balance is too low for this deduction.');
    const parties: ReceiptParties = { dealer: { id: dealerId, name: 'Demo Agro-dealer' }, farmer: { name: wallet.farmer_name, reference: wallet.farmer_reference, phone: wallet.farmer_phone }, walletName: wallet.name };
    db.prepare(`INSERT INTO transactions(id, dealer_id, wallet_id, idempotency_key, request_hash, request_id,
      purchase_total_minor, deduction_total_minor, customer_due_minor, wallet_before_minor, wallet_after_minor, receipt_parties_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, dealerId, wallet.id, idempotencyKey, hash, requestId,
      calculated.purchaseTotalMinor, calculated.deductionTotalMinor, calculated.customerDueMinor, wallet.balance_minor, calculated.walletAfterMinor, JSON.stringify(parties), now);
    const insertItem = db.prepare('INSERT INTO transaction_items(transaction_id, product_id, product_name, quantity, unit_price_minor, line_total_minor, deduction_minor) VALUES (?, ?, ?, ?, ?, ?, ?)');
    for (const item of calculated.items) insertItem.run(id, item.productId, item.productName, item.quantity, item.unitPriceMinor, item.lineTotalMinor, item.deductionMinor);
    return { transaction: getTransaction(db, dealerId, id), replayed: false };
  }).immediate();
}
