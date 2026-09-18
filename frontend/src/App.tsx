/** Composes application session state with the frontend routes and page modules. */
import { useEffect, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { api, type CartLine, type Preview, type Transaction } from "./api";
import { type Cart } from "./cart/cart";
import { Shell } from "./components/Shell";
import { ConfirmationPage } from "./pages/ConfirmationPage";
import { LoginPage } from "./pages/LoginPage";
import { ProductsPage } from "./pages/ProductsPage";
import { SummaryPage } from "./pages/SummaryPage";

export function App() {
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [restoringAttempt, setRestoringAttempt] = useState(false);
  const [cart, setCart] = useState<Cart>({});
  const [preview, setPreview] = useState<Preview | null>(null);
  const [transaction, setTransaction] = useState<Transaction | null>(null);

  useEffect(() => {
    const unauthenticated = () => {
      setSignedIn(false);
      setCart({});
      setPreview(null);
      setTransaction(null);
      setRestoringAttempt(false);
    };
    window.addEventListener("inua:unauthenticated", unauthenticated);
    api.me().then(() => {
      setSignedIn(true);
      const raw = sessionStorage.getItem("inua-payment-attempt");
      if (!raw) return;
      try {
        const pending = JSON.parse(raw) as { payload?: { items?: unknown[]; expectedDeductionTotalMinor?: unknown } };
        if (!Array.isArray(pending.payload?.items) || typeof pending.payload.expectedDeductionTotalMinor !== "number") throw new Error("Invalid attempt");
        const items = pending.payload.items as CartLine[];
        const restoredCart = Object.fromEntries(items.map((item) => [item.productId, item])) as Cart;
        setCart(restoredCart);
        setRestoringAttempt(true);
        api.preview({ items, expectedDeductionTotalMinor: pending.payload.expectedDeductionTotalMinor })
          .then(setPreview)
          .catch(() => sessionStorage.removeItem("inua-payment-attempt"))
          .finally(() => setRestoringAttempt(false));
      } catch {
        sessionStorage.removeItem("inua-payment-attempt");
      }
    }).catch(() => setSignedIn(false));
    return () => window.removeEventListener("inua:unauthenticated", unauthenticated);
  }, []);

  function signOut() {
    setSignedIn(false);
    setCart({});
    setPreview(null);
    setTransaction(null);
    sessionStorage.removeItem("inua-payment-attempt");
  }

  if (signedIn === null || restoringAttempt) {
    return (
      <div className="splash">
        <img src="/assets/Logo.svg" alt="" />
        Loading workspace
      </div>
    );
  }

  return (
    <Routes>
      <Route
        path="/login"
        element={
          signedIn ? (
            <Navigate to="/products" replace />
          ) : (
            <LoginPage onSuccess={() => setSignedIn(true)} />
          )
        }
      />
      <Route
        path="/products"
        element={
          signedIn ? (
            <Shell onLogout={signOut}>
              <ProductsPage
                cart={cart}
                setCart={setCart}
                setPreview={setPreview}
              />
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
              <SummaryPage
                cart={cart}
                preview={preview}
                setCart={setCart}
                setPreview={setPreview}
                onPaid={setTransaction}
              />
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
              <ConfirmationPage
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
