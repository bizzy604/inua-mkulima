CREATE TABLE products (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(trim(name)) >= 1),
  price_minor INTEGER NOT NULL CHECK (price_minor BETWEEN 1 AND 9007199254740991),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE wallets (
  id INTEGER PRIMARY KEY,
  dealer_id TEXT NOT NULL UNIQUE,
  farmer_name TEXT NOT NULL,
  farmer_reference TEXT NOT NULL UNIQUE,
  farmer_phone TEXT NOT NULL,
  name TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'KES' CHECK (currency = 'KES'),
  balance_minor INTEGER NOT NULL CHECK (balance_minor BETWEEN 0 AND 9007199254740991),
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE transactions (
  id TEXT PRIMARY KEY,
  dealer_id TEXT NOT NULL,
  wallet_id INTEGER NOT NULL REFERENCES wallets(id),
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  request_id TEXT NOT NULL,
  purchase_total_minor INTEGER NOT NULL CHECK (purchase_total_minor BETWEEN 1 AND 9007199254740991),
  deduction_total_minor INTEGER NOT NULL CHECK (deduction_total_minor > 0 AND deduction_total_minor <= purchase_total_minor),
  customer_due_minor INTEGER NOT NULL CHECK (customer_due_minor = purchase_total_minor - deduction_total_minor),
  wallet_before_minor INTEGER NOT NULL CHECK (wallet_before_minor BETWEEN deduction_total_minor AND 9007199254740991),
  wallet_after_minor INTEGER NOT NULL CHECK (wallet_after_minor = wallet_before_minor - deduction_total_minor),
  receipt_parties_json TEXT NOT NULL CHECK (json_valid(receipt_parties_json)),
  created_at TEXT NOT NULL,
  event_published_at TEXT,
  UNIQUE (dealer_id, idempotency_key)
) STRICT;
CREATE INDEX transactions_dealer_created ON transactions(dealer_id, created_at DESC);
CREATE INDEX transactions_pending_events ON transactions(created_at) WHERE event_published_at IS NULL;

CREATE TABLE transaction_items (
  id INTEGER PRIMARY KEY,
  transaction_id TEXT NOT NULL REFERENCES transactions(id),
  product_id INTEGER NOT NULL REFERENCES products(id),
  product_name TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 999),
  unit_price_minor INTEGER NOT NULL CHECK (unit_price_minor BETWEEN 1 AND 9007199254740991),
  line_total_minor INTEGER NOT NULL CHECK (line_total_minor <= 9007199254740991 AND line_total_minor = quantity * unit_price_minor),
  deduction_minor INTEGER NOT NULL CHECK (deduction_minor >= 0 AND deduction_minor <= line_total_minor),
  UNIQUE (transaction_id, product_id)
) STRICT;
