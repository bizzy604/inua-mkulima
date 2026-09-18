import { useState } from "react";
import { api } from "../api";

/** Two-step demo dealer login screen. */
export function LoginPage({ onSuccess }: { onSuccess: () => void }) {
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
          className="login-background"
          src="/assets/bg@2x.png"
          alt="Inua Mkulima agricultural background"
        />
        <img
          className="login-logo"
          src="/assets/logo%20(2).svg"
          alt="Inua Mkulima"
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
