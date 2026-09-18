import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { api, digitsOnly, money, type Preview, type Transaction } from "../api";
import { cartPayload, type Cart } from "../cart/cart";

/** Server-preview review and simulated verification/payment screen. */
export function SummaryPage({
  cart,
  preview,
  setCart,
  setPreview,
  onPaid,
}: {
  cart: Cart;
  preview: Preview | null;
  setCart: Dispatch<SetStateAction<Cart>>;
  setPreview: (preview: Preview | null) => void;
  onPaid: (transaction: Transaction) => void;
}) {
  const navigate = useNavigate();
  const [code, setCode] = useState<string[]>(() => Array(6).fill(""));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [stale, setStale] = useState(false);
  const [resendIn, setResendIn] = useState(30);
  const codeRefs = useRef<Array<HTMLInputElement | null>>([]);
  const [key] = useState(() => {
    try {
      const pending = JSON.parse(sessionStorage.getItem("inua-payment-attempt") ?? "null") as { key?: unknown } | null;
      return typeof pending?.key === "string" ? pending.key : crypto.randomUUID();
    } catch {
      return crypto.randomUUID();
    }
  });

  useEffect(() => {
    if (!resendIn) return;
    const timer = window.setInterval(() => setResendIn((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [resendIn]);

  if (!preview) {
    return <Navigate to="/products" replace />;
  }

  async function pay() {
    if (stale) return;
    setBusy(true);
    setError("");
    const economicPayload = cartPayload(cart);
    const payload = { ...economicPayload, verificationCode: code.join("") };
    // Keep only the economic request. Verification codes never enter browser storage.
    sessionStorage.setItem("inua-payment-attempt", JSON.stringify({ key, payload: economicPayload }));
    try {
      const result = await api.pay(payload, key);
      sessionStorage.removeItem("inua-payment-attempt");
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

  function editQuantity(productId: number, delta: number) {
    setCart((current) => {
      const line = current[productId];
      if (!line) return current;
      const quantity = line.quantity + delta;
      if (quantity < 1) {
        const next = { ...current };
        delete next[productId];
        return next;
      }
      return { ...current, [productId]: { ...line, quantity: Math.min(999, quantity) } };
    });
    setStale(true);
    setError("");
  }

  async function refreshPreview() {
    setBusy(true);
    setError("");
    try {
      const next = await api.preview(cartPayload(cart));
      setPreview(next);
      setStale(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Review the selected items.");
    } finally {
      setBusy(false);
    }
  }

  function updateCode(index: number, value: string) {
    const digits = digitsOnly(value);
    if (!digits) {
      setCode((current) => current.map((item, position) => position === index ? "" : item));
      return;
    }
    const next = [...code];
    for (const digit of digits.slice(0, 6 - index)) next[index++] = digit;
    setCode(next);
    codeRefs.current[Math.min(index, 5)]?.focus();
  }

  function handleCodeKey(index: number, event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Backspace" && !code[index] && index > 0) codeRefs.current[index - 1]?.focus();
    if (event.key === "ArrowLeft" && index > 0) codeRefs.current[index - 1]?.focus();
    if (event.key === "ArrowRight" && index < 5) codeRefs.current[index + 1]?.focus();
  }

  function resend() {
    setCode(Array(6).fill(""));
    setResendIn(30);
    setError("");
    codeRefs.current[0]?.focus();
  }

  return (
    <div className="summary-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">CHECKOUT</p>
          <h1>Review purchase</h1>
        </div>
        <div className="wallet-chip">
          After payment <strong>{money(preview.walletAfterMinor)}</strong>
        </div>
      </div>
      <div className="breadcrumb-row">
        <button type="button" className="breadcrumb-back" onClick={() => navigate("/products")}>‹&nbsp; Back</button>
        <span>Product Details</span><span className="breadcrumb-separator">›</span><strong>Summary</strong>
      </div>
      <div className="summary-card">
        <div className="summary-table" role="table" aria-label="Selected products">
          <div className="summary-table-row summary-table-head" role="row">
            <span>Product name</span><span>Quantity</span><span>Price</span><span>Total</span><span>Deduction</span>
          </div>
          {preview.items.map((item) => (
            <div className="summary-table-row" key={item.productId} role="row">
              <strong>{item.productName}</strong>
              <div className="qty" aria-label={`Quantity for ${item.productName}`}>
                <button type="button" onClick={() => editQuantity(item.productId, -1)} aria-label={`Decrease ${item.productName}`}>−</button>
                <b>{cart[item.productId]?.quantity ?? item.quantity}</b>
                <button type="button" onClick={() => editQuantity(item.productId, 1)} aria-label={`Increase ${item.productName}`}>+</button>
              </div>
              <span>{money(item.unitPriceMinor)}</span>
              <span>{money((cart[item.productId]?.quantity ?? item.quantity) * item.unitPriceMinor)}</span>
              <span className="deduction">{money(item.deductionMinor)}</span>
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
          Enter the six-digit demo verification code. No SMS is sent in this assessment.
        </p>
        <div className="code-grid" role="group" aria-label="Six digit verification code">
          {code.map((digit, index) => (
            <input
              key={index}
              ref={(element) => { codeRefs.current[index] = element; }}
              className="code-box"
              inputMode="numeric"
              maxLength={index === 0 ? 6 : 1}
              value={digit}
              onChange={(event) => updateCode(index, event.target.value)}
              onKeyDown={(event) => handleCodeKey(index, event)}
              aria-label={`Verification digit ${index + 1}`}
            />
          ))}
        </div>
        <p className="resend-copy">
          Didn’t receive the code? <button type="button" className="resend-button" onClick={resend} disabled={resendIn > 0}>{resendIn ? `Resend in ${resendIn}s` : "Resend"}</button>
        </p>
        {stale && (
          <div className="stale-preview" role="alert">
            <p className="form-error">The selection changed. Refresh the preview before paying.</p>
            <button type="button" className="outline-button" onClick={refreshPreview} disabled={busy}>Refresh preview</button>
          </div>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button
          className="black-button"
          disabled={busy || stale || code.join("").length !== 6}
          onClick={pay}
        >
          {busy ? "Processing..." : `Pay ${money(preview.deductionTotalMinor)}`}
        </button>
        <p className="subsidy-note summary-note">
          You will receive {money(preview.deductionTotalMinor)} from the subsidy program. If this does not cover the total cost of the purchase, ensure you get the balance from the customer.
        </p>
      </section>
    </div>
  );
}
