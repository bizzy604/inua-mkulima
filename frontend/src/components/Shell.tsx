import { useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { LogoutModal } from "./LogoutModal";

/** Shared authenticated layout with the assessment navigation and logout action. */
export function Shell({
  children,
  onLogout,
}: {
  children: ReactNode;
  onLogout: () => void;
}) {
  const navigate = useNavigate();
  const [logoutOpen, setLogoutOpen] = useState(false);
  const [logoutBusy, setLogoutBusy] = useState(false);

  async function logout() {
    setLogoutBusy(true);
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
          <button className="logout-button" onClick={() => setLogoutOpen(true)}>
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
      {logoutOpen && (
        <LogoutModal
          busy={logoutBusy}
          onCancel={() => setLogoutOpen(false)}
          onConfirm={logout}
        />
      )}
    </div>
  );
}
