/** Contains the login, selection, preview/payment, confirmation, and logout flow. */
import {
  useEffect,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import { Navigate, Route, Routes, useNavigate } from "react-router-dom";
import {
  api,
  digitsOnly,
  money,
  type CartLine,
  type Preview,
  type Product,
  type Transaction,
  type Wallet,
} from "./api";

type Cart = Record<number, CartLine>;
const cartPayload = (cart: Cart) => ({
  items: Object.values(cart),
  expectedDeductionTotalMinor: Object.values(cart).reduce(
    (total, item) => total + item.deductionMinor,
    0,
  ),
});

export function App() {
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [cart, setCart] = useState<Cart>({});
  const [preview, setPreview] = useState<Preview | null>(null);
  const [transaction, setTransaction] = useState<Transaction | null>(null);
  useEffect(() => {
    api
      .me()
      .then(() => setSignedIn(true))
      .catch(() => setSignedIn(false));
  }, []);
  const signOut = () => {
    setSignedIn(false);
    setCart({});
    setPreview(null);
    setTransaction(null);
  };
  if (signedIn === null)
    return (
      <div className="splash">
        <img src="/assets/Logo.svg" alt="" />
        Loading workspace
      </div>
    );
  return (
    <Routes>
      <Route
        path="/login"
        element={
          signedIn ? (
            <Navigate to="/products" replace />
          ) : (
            <Login onSuccess={() => setSignedIn(true)} />
          )
        }
      />
      <Route
        path="/products"
        element={
          signedIn ? (
            <Shell onLogout={signOut}>
              <Products cart={cart} setCart={setCart} setPreview={setPreview} />
            </Shell>
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />
      <Route
        path="/summary"
        element={
          signedIn ? (
            <Shell onLogout={signOut}>
              <Summary cart={cart} preview={preview} onPaid={setTransaction} />
            </Shell>
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />
      <Route
        path="/confirmation"
        element={
          signedIn && transaction ? (
            <Shell onLogout={signOut}>
              <Confirmation
                transaction={transaction}
                onDone={() => {
                  setTransaction(null);
                  setCart({});
                  setPreview(null);
                }}
              />
            </Shell>
          ) : (
            <Navigate to="/products" replace />
          )
        }
      />
      <Route
        path="*"
        element={<Navigate to={signedIn ? "/products" : "/login"} replace />}
      />
    </Routes>
  );
}

function Login({ onSuccess }: { onSuccess: () => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [step, setStep] = useState<"username" | "password">("username");
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    if (step === "username") {
      if (!username.trim()) setError("Enter your username.");
      else setStep("password");
      return;
    }
    if (!password) {
      setError("Enter your password.");
      return;
    }
    setBusy(true);
    try {
      await api.login(username.trim(), password);
      onSuccess();
    } catch {
      setError("The username or password is incorrect.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="login-page">
      <section className="login-visual">
        <img
          src="/assets/header@2x.png"
          alt="Farmer using the Inua Mkulima service"
        />
        <div className="visual-caption">
          <img src="/assets/Logo.svg" alt="Co-operative Bank" />
          <span>Growing access for every harvest.</span>
        </div>
      </section>
      <section className="login-panel">
        <div className="login-card">
          <img
            className="brand-mark"
            src="/assets/Logo.svg"
            alt="Inua Mkulima"
          />
          <p className="eyebrow">WELCOME TO</p>
          <h1>
            Inua Mkulima
            <br />
            Subsidy Program
          </h1>
          <p className="login-copy">
            {step === "username"
              ? "Enter your username to continue"
              : "Enter your password to continue"}
          </p>
          <form onSubmit={submit}>
            {step === "username" ? (
              <label>
                Username
                <input
                  autoFocus
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  autoComplete="username"
                />
              </label>
            ) : (
              <>
                <button
                  type="button"
                  className="back-link"
                  onClick={() => setStep("username")}
                >
                  Back to username
                </button>
                <label>
                  Password
                  <div className="password-field">
                    <input
                      autoFocus
                      type={visible ? "text" : "password"}
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      autoComplete="current-password"
                    />
                    <button
                      type="button"
                      className="icon-button"
                      onClick={() => setVisible(!visible)}
                    >
                      {visible ? "Hide" : "Show"}
                    </button>
                  </div>
                </label>
              </>
            )}
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <button className="gold-button" disabled={busy}>
              {busy
                ? "Signing in..."
                : step === "username"
                  ? "Continue"
                  : "Sign in"}{" "}
              <span>→</span>
            </button>
          </form>
        </div>
      </section>
    </main>
  );
}

function Shell({
  children,
  onLogout,
}: {
  children: ReactNode;
  onLogout: () => void;
}) {
  const navigate = useNavigate();
  async function logout() {
    if (!window.confirm("Are you sure you want to log out?")) return;
    await api.logout().catch(() => undefined);
    onLogout();
    navigate("/login");
  }
  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-title">
          Inua Mkulima <span>Subsidy Program</span>
        </div>
        <div className="user-area">
          <span>
            Logged in as: <strong>DEALER</strong>
          </span>
          <button className="logout-button" onClick={logout}>
            ↪ Logout
          </button>
        </div>
      </header>
      <div className="app-body">
        <aside>
          <button className="nav-active" onClick={() => navigate("/products")}>
            Dashboard
          </button>
          <button disabled>Transactions</button>
          <button disabled>Reports</button>
        </aside>
        <main className="workspace">{children}</main>
      </div>
    </div>
  );
}

function Products({
  cart,
  setCart,
  setPreview,
}: {
  cart: Cart;
  setCart: Dispatch<SetStateAction<Cart>>;
  setPreview: (preview: Preview | null) => void;
}) {
  const [products, setProducts] = useState<Product[]>([]);
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const navigate = useNavigate();
  async function load() {
    setLoading(true);
    setError("");
    try {
      const [items, currentWallet] = await Promise.all([
        api.products(),
        api.wallet(),
      ]);
      setProducts(items);
      setWallet(currentWallet);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load products.");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, []);
  const lines = Object.values(cart);
  const total = lines.reduce((sum, line) => sum + line.deductionMinor, 0);
  const invalid =
    !lines.length ||
    !total ||
    lines.some(
      (line) =>
        line.deductionMinor > line.quantity * line.expectedUnitPriceMinor,
    ) ||
    (wallet !== null && total > wallet.balanceMinor);
  const edit = (id: number, change: Partial<CartLine>) => {
    setCart((current) => ({
      ...current,
      [id]: { ...current[id]!, ...change },
    }));
    setPreview(null);
  };
  function add(product: Product) {
    const existing = cart[product.id];
    edit(
      product.id,
      existing
        ? { quantity: Math.min(999, existing.quantity + 1) }
        : {
            productId: product.id,
            quantity: 1,
            expectedUnitPriceMinor: product.priceMinor,
            deductionMinor: 0,
          },
    );
  }
  function quantity(id: number, delta: number) {
    const line = cart[id];
    if (!line) return;
    if (line.quantity + delta < 1) {
      setCart((current) => {
        const next = { ...current };
        delete next[id];
        return next;
      });
      setPreview(null);
    } else edit(id, { quantity: Math.min(999, line.quantity + delta) });
  }
  async function deduct() {
    try {
      setPreview(await api.preview(cartPayload(cart)));
      navigate("/summary");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Review the selected items.",
      );
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">DASHBOARD</p>
          <h1>Product details</h1>
        </div>
        <div className="wallet-chip">
          Wallet balance <strong>{wallet?.formattedBalance ?? "..."}</strong>
        </div>
      </div>
      {loading ? (
        <div className="state-panel">Loading products...</div>
      ) : error ? (
        <div className="state-panel">
          <p>{error}</p>
          <button className="outline-button" onClick={load}>
            Retry
          </button>
        </div>
      ) : (
        <>
          <div className="selection-grid">
            <section>
              <h2>Products</h2>
              <div className="product-list">
                {products.map((product) => (
                  <div className="product-row" key={product.id}>
                    <span>{product.name}</span>
                    <strong>{money(product.priceMinor)}</strong>
                    <button
                      className="round-button"
                      onClick={() => add(product)}
                      aria-label={`Add ${product.name}`}
                    >
                      +
                    </button>
                  </div>
                ))}
              </div>
            </section>
            <section>
              <h2>Selected products</h2>
              <div className="selected-panel">
                {!lines.length ? (
                  <p className="empty-selection">
                    Please select products from
                    <br />
                    the products panel first
                  </p>
                ) : (
                  <>
                    <div className="selected-header">
                      <span>Product</span>
                      <span>Qty</span>
                      <span>Price</span>
                      <span>Total</span>
                      <span>Deduction</span>
                    </div>
                    {lines.map((line) => {
                      const product = products.find(
                        (item) => item.id === line.productId,
                      )!;
                      const lineTotal =
                        line.quantity * line.expectedUnitPriceMinor;
                      return (
                        <div className="selected-row" key={line.productId}>
                          <span>{product.name}</span>
                          <div className="qty">
                            <button
                              onClick={() => quantity(line.productId, -1)}
                              aria-label="Decrease quantity"
                            >
                              −
                            </button>
                            <b>{line.quantity}</b>
                            <button
                              onClick={() => quantity(line.productId, 1)}
                              aria-label="Increase quantity"
                            >
                              +
                            </button>
                          </div>
                          <span>{money(product.priceMinor)}</span>
                          <span>{money(lineTotal)}</span>
                          <input
                            aria-label={`Deduction for ${product.name}`}
                            inputMode="numeric"
                            value={
                              line.deductionMinor
                                ? line.deductionMinor / 100
                                : ""
                            }
                            onChange={(event) =>
                              edit(line.productId, {
                                deductionMinor:
                                  Number(digitsOnly(event.target.value)) * 100,
                              })
                            }
                          />
                        </div>
                      );
                    })}
                    <div className="selected-total">
                      <strong>Total deduction</strong>
                      <strong>{money(total)}</strong>
                    </div>
                  </>
                )}
              </div>
            </section>
          </div>
          <div className="checkout-actions">
            <p>
              Any amount not covered by the subsidy is collected from the
              customer.
            </p>
            <button
              className="black-button"
              disabled={invalid}
              onClick={deduct}
            >
              Deduct {money(total)} <span>→</span>
            </button>
          </div>
        </>
      )}
    </>
  );
}

function Summary({
  cart,
  preview,
  onPaid,
}: {
  cart: Cart;
  preview: Preview | null;
  onPaid: (transaction: Transaction) => void;
}) {
  const navigate = useNavigate();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [key] = useState(
    () => sessionStorage.getItem("inua-payment-key") ?? crypto.randomUUID(),
  );
  if (!preview) {
    navigate("/products", { replace: true });
    return null;
  }
  async function pay() {
    setBusy(true);
    setError("");
    sessionStorage.setItem("inua-payment-key", key);
    try {
      const result = await api.pay(
        { ...cartPayload(cart), verificationCode: code },
        key,
      );
      sessionStorage.removeItem("inua-payment-key");
      onPaid(result);
      navigate("/confirmation");
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "We could not confirm the result. Retry to check this payment.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="summary-page">
      <button className="back-link" onClick={() => navigate("/products")}>
        ← Back to selection
      </button>
      <div className="page-heading">
        <div>
          <p className="eyebrow">CHECKOUT</p>
          <h1>Review purchase</h1>
        </div>
        <div className="wallet-chip">
          After payment <strong>{money(preview.walletAfterMinor)}</strong>
        </div>
      </div>
      <div className="summary-card">
        <div className="summary-lines">
          {preview.items.map((item) => (
            <div className="summary-line" key={item.productId}>
              <span>
                <strong>{item.productName}</strong>
                <small>
                  {item.quantity} × {money(item.unitPriceMinor)}
                </small>
              </span>
              <span>{money(item.lineTotalMinor)}</span>
              <span className="deduction">
                Subsidy {money(item.deductionMinor)}
              </span>
            </div>
          ))}
        </div>
        <div className="summary-totals">
          <span>
            Purchase total <strong>{money(preview.purchaseTotalMinor)}</strong>
          </span>
          <span>
            Customer pays outside app{" "}
            <strong>{money(preview.customerDueMinor)}</strong>
          </span>
          <span className="total-highlight">
            Total subsidy deduction{" "}
            <strong>{money(preview.deductionTotalMinor)}</strong>
          </span>
        </div>
      </div>
      <section className="verification">
        <h2>Verify and pay</h2>
        <p>
          Enter the six-digit demo verification code. No SMS is sent in this
          assessment.
        </p>
        <input
          className="code-input"
          inputMode="numeric"
          maxLength={6}
          value={code}
          onChange={(event) =>
            setCode(digitsOnly(event.target.value).slice(0, 6))
          }
          aria-label="Six digit verification code"
          placeholder="••••••"
        />
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button
          className="black-button"
          disabled={busy || code.length !== 6}
          onClick={pay}
        >
          {busy ? "Processing..." : `Pay ${money(preview.deductionTotalMinor)}`}
        </button>
      </section>
    </div>
  );
}

function Confirmation({
  transaction,
  onDone,
}: {
  transaction: Transaction;
  onDone: () => void;
}) {
  const [error, setError] = useState("");
  async function download() {
    try {
      const blob = await api.receipt(transaction.id);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `receipt-${transaction.id}.pdf`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch {
      setError("Receipt download failed. Try again.");
    }
  }
  return (
    <div className="confirmation-backdrop">
      <section className="confirmation-card">
        <div className="success-mark">✓</div>
        <p className="eyebrow">PAYMENT COMPLETE</p>
        <h1>Payment successful</h1>
        <p className="reference">
          Reference <strong>{transaction.id}</strong>
        </p>
        <p className="confirmation-amount">
          {money(transaction.deductionTotalMinor)}
        </p>
        <p>
          Subsidy purchase for
          <br />
          <strong>{transaction.receiptParties.farmer.name}</strong>
          <br />
          <small>{transaction.receiptParties.farmer.reference}</small>
        </p>
        {error && <p className="form-error">{error}</p>}
        <div className="confirmation-actions">
          <button className="outline-button" onClick={download}>
            Download receipt
          </button>
          <button className="black-button" onClick={onDone}>
            Done
          </button>
        </div>
      </section>
    </div>
  );
}
