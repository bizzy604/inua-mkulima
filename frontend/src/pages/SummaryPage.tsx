import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, digitsOnly, money, type Preview, type Transaction } from "../api";
import { cartPayload, type Cart } from "../cart/cart";

/** Server-preview review and simulated verification/payment screen. */
export function SummaryPage({
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
