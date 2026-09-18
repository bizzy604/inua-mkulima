/** Composes application session state with the frontend routes and page modules. */
import { useEffect, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { api, type Preview, type Transaction } from "./api";
import { type Cart } from "./cart/cart";
import { Shell } from "./components/Shell";
import { ConfirmationPage } from "./pages/ConfirmationPage";
import { LoginPage } from "./pages/LoginPage";
import { ProductsPage } from "./pages/ProductsPage";
import { SummaryPage } from "./pages/SummaryPage";

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

  function signOut() {
    setSignedIn(false);
    setCart({});
    setPreview(null);
    setTransaction(null);
  }

  if (signedIn === null) {
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
