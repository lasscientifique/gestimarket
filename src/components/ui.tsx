import { useEffect, useState, type ReactNode } from "react";
import { X, Inbox, Loader2, ImagePlus, Trash2, MapPin, Package } from "lucide-react";
import { chooseAndUploadImage, mediaUrl } from "../lib/media";
import { locationText } from "../lib/format";
import { PageHelpButton } from "./Help";
import { tl } from "../lib/i18n";

export function PageHeader({ title, subtitle, actions, help }: { title: string; subtitle?: ReactNode; actions?: ReactNode; help?: string }) {
  return (
    <header className="page-header">
      <div>
        <h1>{title}</h1>
        {subtitle && <p className="muted">{subtitle}</p>}
      </div>
      {(actions || help) && (
        <div className="page-actions">
          {help && <PageHelpButton page={help} />}
          {actions}
        </div>
      )}
    </header>
  );
}

export function Modal({
  title,
  onClose,
  children,
  footer,
  width = 560,
}: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal" style={{ width }} onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="modal-header">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label={tl("Fermer")}>
            <X size={18} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  );
}

export function StatCard({
  label,
  value,
  hint,
  icon,
  tone = "default",
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: ReactNode;
  tone?: "default" | "success" | "warning" | "danger" | "accent";
}) {
  return (
    <div className={`stat-card tone-${tone}`}>
      <div className="stat-top">
        <span className="stat-label">{label}</span>
        {icon && <span className="stat-icon">{icon}</span>}
      </div>
      <div className="stat-value">{value}</div>
      {hint && <div className="stat-hint">{hint}</div>}
    </div>
  );
}

export function Empty({ title = tl("Aucun élément"), children }: { title?: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <Inbox size={36} strokeWidth={1.5} />
      <strong>{title}</strong>
      {children && <span className="muted">{children}</span>}
    </div>
  );
}

export function Loading({ label = "Chargement…" }: { label?: string }) {
  return (
    <div className="loading">
      <Loader2 className="spin" size={20} /> {label}
    </div>
  );
}

export function Badge({ children, tone = "default" }: { children: ReactNode; tone?: "default" | "success" | "warning" | "danger" | "info" | "om" }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function Field({ label, children, hint, span }: { label: ReactNode; children: ReactNode; hint?: ReactNode; span?: 2 }) {
  return (
    <label className={`field ${span === 2 ? "span-2" : ""}`}>
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

/** Vignette : photo si disponible, sinon pastille colorée avec initiales. */
export function Thumb({
  imageId,
  name,
  color,
  size = 40,
  rounded = 8,
}: {
  imageId?: number | null;
  name: string;
  color?: string | null;
  size?: number;
  rounded?: number;
}) {
  const url = mediaUrl(imageId);
  const [failedUrl, setFailedUrl] = useState<string | undefined>();
  const style = { width: size, height: size, borderRadius: rounded, flexShrink: 0 } as const;
  if (url && failedUrl !== url) {
    return <img className="thumb" src={url} alt="" style={style} loading="lazy" onError={() => setFailedUrl(url)} />;
  }
  const initials = name
    .replace(/[^\p{L}\p{N} ]/gu, "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
  return (
    <span className="thumb thumb-empty" style={{ ...style, background: color ? `${color}22` : undefined, color: color ?? undefined, fontSize: size * 0.34 }}>
      {initials || <Package size={size * 0.5} />}
    </span>
  );
}

/** Champ photo : aperçu, choix d'un fichier (redimensionné automatiquement), suppression. */
export function ImageField({
  value,
  onChange,
  label = "Photo",
  size = 112,
  keepPng = false,
  maxSize = 600,
}: {
  value: number | null;
  onChange: (id: number | null) => void;
  label?: ReactNode;
  size?: number;
  keepPng?: boolean;
  maxSize?: number;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const choose = async () => {
    setBusy(true);
    setError("");
    try {
      const id = await chooseAndUploadImage({ keepPng, maxSize });
      if (id) onChange(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const url = mediaUrl(value);
  return (
    <div className="image-field">
      <span className="field-label">{label}</span>
      <div className="image-field-row">
        <button type="button" className="image-drop" style={{ width: size, height: size }} onClick={choose} disabled={busy}>
          {url ? <img src={url} alt="" /> : busy ? <Loader2 className="spin" size={22} /> : <><ImagePlus size={24} /><span>{tl("Ajouter")}</span></>}
        </button>
        <div className="image-field-actions">
          <button type="button" className="btn btn-sm" onClick={choose} disabled={busy}>
            <ImagePlus size={14} /> {value ? tl("Changer") : tl("Choisir une image")}
          </button>
          {value && (
            <button type="button" className="btn btn-sm btn-danger-outline" onClick={() => onChange(null)}>
              <Trash2 size={14} />  {tl("Retirer")}</button>
          )}
          <span className="field-hint">{tl("JPEG, PNG ou WebP — redimensionnée automatiquement.")}</span>
          {error && <span className="text-danger small">{error}</span>}
        </div>
      </div>
    </div>
  );
}

/** Pastille d'emplacement « Réfrigérateur FR1 · Étage 3 » (+ n autres emplacements). */
export function LocationBadge({
  p,
  short,
  big,
}: {
  p: { bloc?: string | null; etage?: string | null; rangee?: string | null; fixture_name?: string | null; other_places?: number };
  short?: boolean;
  big?: boolean;
}) {
  if (!p.bloc) return <span className={`loc-badge none ${big ? "big" : ""}`}><MapPin size={big ? 16 : 12} />  {tl("Non rangé")}</span>;
  const others = p.other_places ?? 0;
  return (
    <span className={`loc-badge ${big ? "big" : ""}`} title={locationText(p) + (others ? ` (+ ${others} autre(s) emplacement(s))` : "")}>
      <MapPin size={big ? 16 : 12} /> {locationText(p, short)}
      {others > 0 && <span className="loc-more">+{others}</span>}
    </span>
  );
}
