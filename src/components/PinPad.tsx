import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Delete, ShieldCheck, X, Loader2 } from "lucide-react";
import { tl } from "../lib/i18n";

/** Pavé numérique tactile (code PIN, montants). */
export function NumPad({ onKey, extra }: { onKey: (k: string) => void; extra?: string }) {
  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", extra ?? "C", "0", "⌫"];
  return (
    <div className="numpad">
      {keys.map((k) => (
        <button key={k} type="button" className={`numpad-key ${k === "⌫" || k === "C" ? "muted-key" : ""}`} onClick={() => onKey(k)}>
          {k === "⌫" ? <Delete size={22} /> : k}
        </button>
      ))}
    </div>
  );
}

export const LEVEL_LABELS: Record<string, string> = {
  cashier: tl("votre code PIN"),
  manager: tl("le code PIN d'un gestionnaire ou de l'administrateur"),
  admin: tl("le code PIN de l'administrateur"),
};

/**
 * Fenêtre de saisie du code PIN. `verify` contrôle le code (côté serveur) : en cas d'erreur
 * le message s'affiche et l'utilisateur peut réessayer sans fermer la fenêtre.
 */
export function PinDialog({
  title,
  message,
  level = "cashier",
  verify,
  onDone,
  onCancel,
}: {
  title: string;
  message?: ReactNode;
  level?: string;
  verify: (pin: string) => Promise<void>;
  onDone: (pin: string) => void;
  onCancel: () => void;
}) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [shake, setShake] = useState(false);

  const submit = useCallback(
    async (value: string) => {
      if (value.length < 4 || busy) return;
      setBusy(true);
      setError("");
      try {
        await verify(value);
        onDone(value);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setPin("");
        setShake(true);
        setTimeout(() => setShake(false), 400);
      } finally {
        setBusy(false);
      }
    },
    [busy, verify, onDone],
  );

  const press = useCallback(
    (k: string) => {
      if (k === "⌫") return setPin((p) => p.slice(0, -1));
      if (k === "C") return setPin("");
      if (k === "OK") return submit(pin);
      if (/^\d$/.test(k)) setPin((p) => (p.length < 6 ? p + k : p));
    },
    [pin, submit],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) press(e.key);
      else if (e.key === "Backspace") press("⌫");
      else if (e.key === "Enter") submit(pin);
      else if (e.key === "Escape") onCancel();
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [press, submit, pin, onCancel]);

  return (
    <div className="modal-backdrop pin-backdrop" onMouseDown={onCancel}>
      <div className={`pin-dialog ${shake ? "shake" : ""}`} onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label={title}>
        <button className="icon-btn pin-close" onClick={onCancel} aria-label={tl("Annuler")}><X size={18} /></button>
        <div className="pin-icon"><ShieldCheck size={28} /></div>
        <h2>{title}</h2>
        <p className="muted">{message ?? <>{tl("Confirmez avec")} {LEVEL_LABELS[level] ?? tl("votre code PIN")}.</>}</p>
        <div className="pin-dots">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <span key={i} className={`pin-dot ${i < pin.length ? "on" : ""} ${i >= 4 ? "opt" : ""}`} />
          ))}
        </div>
        <div className="pin-error">{busy ? <Loader2 className="spin" size={16} /> : error}</div>
        <NumPad onKey={press} extra="C" />
        <button className="btn btn-primary btn-lg btn-block" disabled={pin.length < 4 || busy} onClick={() => submit(pin)}>
          {tl("Valider")}</button>
      </div>
    </div>
  );
}
