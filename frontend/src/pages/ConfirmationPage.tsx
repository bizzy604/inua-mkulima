import { useState } from "react";
import { api, money, type Transaction } from "../api";

/** Completed-payment confirmation with saved receipt download. */
export function ConfirmationPage({
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
        <h1>Payment Successful</h1>
        <p className="reference">
          Ref Number: <strong>{transaction.id.slice(0, 18)}</strong>
        </p>
        <p className="reference">Date: <strong>{new Date(transaction.createdAt).toLocaleDateString("en-GB", { dateStyle: "long" })}</strong></p>
        <div className="success-mark" aria-label="Payment complete">✓</div>
        <p className="confirmation-amount">
          {money(transaction.deductionTotalMinor)}
        </p>
        <p>
          Agrovet product purchase for
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
