import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { CircleAlert, CircleCheck, Info, LoaderCircle, X } from "lucide-react";
import { errText } from "./lib/sb";
import type { Tone } from "./lib/fmt";

export function Badge({ tone = "default", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function Spinner({ label = "Chargement…" }: { label?: string }) {
  return (
    <div className="loading">
      <LoaderCircle size={18} className="spin" /> {label}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function ErrorBox({ error, retry }: { error: string; retry?: () => void }) {
  return (
    <div className="alert alert-danger">
      <CircleAlert size={18} />
      <span>{error}</span>
      {retry && (
        <button className="btn btn-sm" onClick={retry}>
          Réessayer
        </button>
      )}
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

export function Stat({ label, value, tone, hint, onClick }: { label: string; value: ReactNode; tone?: Tone; hint?: ReactNode; onClick?: () => void }) {
  return (
    <button type="button" className={`stat stat-${tone ?? "default"}${onClick ? " stat-link" : ""}`} onClick={onClick} disabled={!onClick}>
      <span className="stat-label">{label}</span>
      <strong className="stat-value">{value}</strong>
      {hint && <span className="stat-hint">{hint}</span>}
    </button>
  );
}

export function Tabs<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: [T, ReactNode][] }) {
  return (
    <div className="tabs" role="tablist">
      {items.map(([k, label]) => (
        <button key={k} role="tab" aria-selected={value === k} className={value === k ? "active" : ""} onClick={() => onChange(k)}>
          {label}
        </button>
      ))}
    </div>
  );
}

export function Modal({ title, onClose, children, wide }: { title: ReactNode; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal${wide ? " modal-wide" : ""}`} role="dialog" aria-modal="true">
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="icon-btn" aria-label="Fermer" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

/** Données chargées par une fonction de la console, avec rechargement. */
export function useLoad<T>(load: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(true);
  const seq = useRef(0);
  const reload = useCallback(() => {
    const n = ++seq.current;
    setBusy(true);
    load()
      .then((d) => {
        if (n === seq.current) {
          setData(d);
          setError("");
        }
      })
      .catch((e) => n === seq.current && setError(errText(e)))
      .finally(() => n === seq.current && setBusy(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(reload, [reload]);
  return { data, error, busy, reload, setData };
}

// ───────────────────────────── Messages ─────────────────────────────

type ToastItem = { id: number; tone: "success" | "danger" | "info"; text: string };
const ToastCtx = createContext<{ ok: (t: string) => void; fail: (e: unknown) => void; info: (t: string) => void }>({
  ok: () => undefined,
  fail: () => undefined,
  info: () => undefined,
});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const push = useCallback((tone: ToastItem["tone"], text: string) => {
    const id = Date.now() + Math.random();
    setItems((l) => [...l, { id, tone, text }]);
    setTimeout(() => setItems((l) => l.filter((x) => x.id !== id)), tone === "danger" ? 9000 : 5000);
  }, []);
  const api = useRef({
    ok: (t: string) => push("success", t),
    fail: (e: unknown) => push("danger", errText(e)),
    info: (t: string) => push("info", t),
  });
  return (
    <ToastCtx.Provider value={api.current}>
      {children}
      <div className="toasts" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast toast-${t.tone}`}>
            {t.tone === "success" ? <CircleCheck size={18} /> : t.tone === "danger" ? <CircleAlert size={18} /> : <Info size={18} />}
            <span>{t.text}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export const useToast = () => useContext(ToastCtx);

// ───────────────────────────── Action avec motif ─────────────────────────────

export type AskField = { key: string; label: string; type?: "text" | "number" | "select" | "textarea"; options?: [string, string][]; value?: string; hint?: string };

/** Fenêtre d'une action : champs éventuels, puis motif obligatoire (inscrit au journal). */
export function ActionModal({
  title,
  intro,
  fields = [],
  reason = true,
  reasonLabel = "Motif (inscrit au journal) *",
  confirm,
  danger,
  onClose,
  onSubmit,
}: {
  title: string;
  intro?: ReactNode;
  fields?: AskField[];
  reason?: boolean;
  reasonLabel?: string;
  confirm: string;
  danger?: boolean;
  onClose: () => void;
  onSubmit: (values: Record<string, string>, reason: string) => Promise<void>;
}) {
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(fields.map((f) => [f.key, f.value ?? ""])));
  const [why, setWhy] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await onSubmit(values, why.trim());
      onClose();
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={title} onClose={onClose}>
      <form onSubmit={submit} className="stack">
        {intro && <div className="muted">{intro}</div>}
        {fields.map((f) => (
          <Field key={f.key} label={f.label} hint={f.hint}>
            {f.type === "select" ? (
              <select value={values[f.key]} onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}>
                {f.options?.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            ) : f.type === "textarea" ? (
              <textarea rows={3} value={values[f.key]} onChange={(e) => setValues({ ...values, [f.key]: e.target.value })} />
            ) : (
              <input
                type={f.type === "number" ? "number" : "text"}
                value={values[f.key]}
                onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
              />
            )}
          </Field>
        ))}
        {reason && (
          <Field label={reasonLabel}>
            <input value={why} onChange={(e) => setWhy(e.target.value)} autoFocus={!fields.length} placeholder="Ex. PC changé, geste commercial, client a payé en espèces…" />
          </Field>
        )}
        {error && <ErrorBox error={error} />}
        <div className="row-end">
          <button type="button" className="btn" onClick={onClose}>
            Annuler
          </button>
          <button className={`btn ${danger ? "btn-danger" : "btn-primary"}`} disabled={busy || (reason && why.trim().length < 3)}>
            {busy ? "Un instant…" : confirm}
          </button>
        </div>
      </form>
    </Modal>
  );
}
