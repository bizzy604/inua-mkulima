import { useEffect, useRef } from "react";

/** Accessible confirmation dialog for ending the authenticated dealer session. */
export function LogoutModal({
  busy,
  onCancel,
  onConfirm,
}: {
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onCancel();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [busy, onCancel]);

  return (
    <div
      className="dialog-backdrop"
      role="presentation"
      onMouseDown={(event) =>
        event.target === event.currentTarget && !busy && onCancel()
      }
    >
      <section
        className="logout-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="logout-title"
        aria-describedby="logout-description"
      >
        <h2 id="logout-title">Log Out?</h2>
        <div className="logout-icon" aria-hidden="true">
          ↪
        </div>
        <p id="logout-description">Are you sure you want to log out?</p>
        <div className="logout-actions">
          <button
            ref={cancelRef}
            className="outline-button"
            onClick={onCancel}
            disabled={busy}
          >
            Back
          </button>
          <button className="black-button" onClick={onConfirm} disabled={busy}>
            {busy ? "Logging out..." : "Yes, log out"}
          </button>
        </div>
      </section>
    </div>
  );
}
