import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import {
  api,
  digitsOnly,
  money,
  type CartLine,
  type Preview,
  type Product,
  type Wallet,
} from "../api";
import { cartLines, deductionTotal, type Cart } from "../cart/cart";
import { useNavigate } from "react-router-dom";

/** Product catalogue and editable subsidy selection screen. */
export function ProductsPage({
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

  const lines = cartLines(cart);
  const total = deductionTotal(cart);
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
      const preview = await api.preview({
        items: lines,
        expectedDeductionTotalMinor: total,
      });
      setPreview(preview);
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
          <h1>Product Details</h1>
        </div>
        <div className="wallet-chip">
          Wallet balance <strong>{wallet?.formattedBalance ?? "..."}</strong>
        </div>
      </div>
      <div className="breadcrumb-row">
        <button type="button" className="breadcrumb-back" onClick={() => navigate("/products")}>‹&nbsp; Back</button>
        <span>Product Details</span>
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
          {!products.length ? (
            <div className="state-panel">
              <h2>No products are available</h2>
              <p>The product catalogue is empty. Try again shortly.</p>
              <button className="outline-button" onClick={load}>Retry</button>
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
                      );
                      if (!product) return null;
                      const lineTotal =
                        line.quantity * line.expectedUnitPriceMinor;
                      const overLine = line.deductionMinor > lineTotal;
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
                            className={overLine ? "invalid-input" : undefined}
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
                          {overLine && (
                            <small className="line-warning">Cannot exceed {money(lineTotal)}</small>
                          )}
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
            <p className="subsidy-note">
              You will receive {money(total)} from the subsidy program. If this does not cover the total cost of the purchase, ensure you get the balance from the customer.
            </p>
            {wallet !== null && total > wallet.balanceMinor && (
              <p className="line-warning wallet-warning" role="alert">Deduction exceeds the available wallet balance.</p>
            )}
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
      )}
    </>
  );
}
