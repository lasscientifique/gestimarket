import { useEffect, useRef, useState } from "react";
import { CircleHelp, X, Lightbulb, ListChecks, Target } from "lucide-react";
import { PAGE_HELP, TIPS } from "../lib/help";

/**
 * Petit « ? » à côté d'un bouton ou d'un champ : explique son rôle.
 * S'ouvre au survol ou au clic ; se ferme en cliquant ailleurs.
 */
export function HelpTip({ k, text, side = "bottom" }: { k?: keyof typeof TIPS | string; text?: string; side?: "bottom" | "top" | "left" }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const content = text ?? (k ? TIPS[k] : "");
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  if (!content) return null;
  return (
    <span className="help-tip" ref={ref} onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button
        type="button"
        className="help-tip-btn"
        aria-label="Aide"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((o) => !o);
        }}
      >
        ?
      </button>
      {open && <span className={`help-pop ${side}`} role="tooltip">{content}</span>}
    </span>
  );
}

/** Bouton « Aide » d'un écran : ouvre un panneau expliquant l'écran et son utilisation. */
export function PageHelpButton({ page }: { page: string }) {
  const [open, setOpen] = useState(false);
  const help = PAGE_HELP[page];
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  if (!help) return null;
  return (
    <>
      <button className="btn btn-help" onClick={() => setOpen(true)} title="Aide sur cet écran">
        <CircleHelp size={16} /> Aide
      </button>
      {open && (
        <div className="help-backdrop" onMouseDown={() => setOpen(false)}>
          <aside className="help-panel" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label={`Aide : ${help.title}`}>
            <div className="help-panel-head">
              <CircleHelp size={20} />
              <h2>{help.title}</h2>
              <button className="icon-btn" onClick={() => setOpen(false)} aria-label="Fermer"><X size={18} /></button>
            </div>
            <section>
              <h4><Target size={15} /> À quoi sert cet écran ?</h4>
              <p>{help.purpose}</p>
            </section>
            <section>
              <h4><ListChecks size={15} /> Comment faire</h4>
              <ol>{help.steps.map((s) => <li key={s}>{s}</li>)}</ol>
            </section>
            {help.tips && (
              <section>
                <h4><Lightbulb size={15} /> Astuces</h4>
                <ul>{help.tips.map((s) => <li key={s}>{s}</li>)}</ul>
              </section>
            )}
            <p className="muted small">Les petits boutons <span className="help-tip-btn inline">?</span> à côté des actions expliquent chaque fonction.</p>
          </aside>
        </div>
      )}
    </>
  );
}
