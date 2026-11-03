import { lazy, Suspense, useEffect, useState } from "react";
import { Box, Loader2, Map as MapIcon } from "lucide-react";
import { api } from "../../api";
import { errorMessage } from "../../context/AppContext";
import { Field } from "../ui";
import { StoreMap } from "./StoreMap";
import { webglAvailable } from "../plan3d/support";
import type { BusinessProfile, LayoutInput, LayoutPreview } from "../../types";
import { getLang, tl, tm } from "../../lib/i18n";

const Store3D = lazy(() => import("../plan3d/Store3D"));

export type EntrySide = LayoutInput["entry"];
export const ENTRIES: { key: EntrySide; label: string }[] = [
  { key: "bottom", label: tl("En bas") },
  { key: "top", label: tl("En haut") },
  { key: "left", label: tl("À gauche") },
  { key: "right", label: tl("À droite") },
];

/** Réglages du plan proposé (champs texte : virgule acceptée). */
export interface ProposalValue {
  name: string;
  width: string;
  depth: string;
  height: string;
  entry: EntrySide;
  storage: boolean;
  upstairs: boolean;
  activities: string[];
}

const num = (s: string) => Number(s.replace(",", "."));
const fmt = (n: number) => String(Math.round(n * 10) / 10).replace(".", getLang() === "fr" ? "," : ".");
const meters = (n: number) => `${fmt(n)} m`;

/**
 * Taille habituelle de la salle pour des activités : celle de la principale, agrandie pour les autres
 * (la moitié de leur surface habituelle chacune).
 */
export function typicalSize(profiles: BusinessProfile[], activities: string[]): [number, number] {
  const sizes = activities.map((id) => profiles.find((p) => p.id === id)?.size).filter((s): s is [number, number] => !!s);
  if (sizes.length === 0) return [10, 8];
  const [w, d] = sizes[0];
  const area = w * d + sizes.slice(1).reduce((s, [a, b]) => s + (a * b) / 2, 0);
  const k = Math.sqrt(area / (w * d));
  const round = (v: number) => Math.round(v * k * 2) / 2;
  return [round(w), round(d)];
}

export function defaultProposal(profiles: BusinessProfile[], activities: string[], name = tl("Rez-de-chaussée")): ProposalValue {
  const [w, d] = typicalSize(profiles, activities);
  return { name, width: fmt(w), depth: fmt(d), height: "3", entry: "bottom", storage: w >= 6 && d >= 6, upstairs: false, activities };
}

/** Paramètres de l'assistant, ou un message si une valeur est hors limites. */
export function proposalInput(v: ProposalValue): LayoutInput | string {
  const W = num(v.width);
  const D = num(v.depth);
  const H = num(v.height);
  if (!(W >= 3 && W <= 200 && D >= 3 && D <= 200)) return tl("Dimensions de la salle : de 3 à 200 mètres.");
  if (!(H >= 2 && H <= 12)) return tl("Hauteur sous plafond : de 2 à 12 mètres.");
  return {
    floor_id: null,
    name: v.name.trim() || null,
    width: W,
    depth: D,
    height: H,
    entry: v.entry,
    storage_room: v.storage,
    upstairs: v.upstairs,
    activities: v.activities,
  };
}

/**
 * Plan proposé par le logiciel : longueur, largeur et hauteur de la salle, côté de l'entrée, réserve ;
 * aperçu immédiat en 3D ou vu de dessus. Rien n'est enregistré ici (« Garder ce plan » chez l'appelant).
 */
export function PlanProposal({
  value,
  onChange,
  profiles,
  showUpstairs = false,
  previewHeight = 320,
}: {
  value: ProposalValue;
  onChange: (v: ProposalValue) => void;
  profiles: BusinessProfile[];
  showUpstairs?: boolean;
  previewHeight?: number;
}) {
  const [preview, setPreview] = useState<LayoutPreview | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState<"3d" | "plan">(() => (webglAvailable() ? "3d" : "plan"));
  const set = (patch: Partial<ProposalValue>) => onChange({ ...value, ...patch });
  const input = proposalInput(value);
  const key = JSON.stringify(input);

  // Aperçu recalculé peu après chaque changement.
  useEffect(() => {
    if (typeof input === "string") {
      setError(input);
      return;
    }
    setError("");
    setLoading(true);
    const t = setTimeout(() => {
      api
        .planPreviewLayout(input)
        .then(setPreview)
        .catch((e) => setError(errorMessage(e)))
        .finally(() => setLoading(false));
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const W = num(value.width) || 1;
  const D = num(value.depth) || 1;
  const scale = 120 / Math.max(W, D, 1);
  const pw = Math.max(20, W * scale);
  const ph = Math.max(20, D * scale);
  const ox = (150 - pw) / 2;
  const oy = (150 - ph) / 2;
  const side = (s: EntrySide): [number, number, number, number] =>
    s === "bottom" ? [ox, oy + ph, ox + pw, oy + ph] : s === "top" ? [ox, oy, ox + pw, oy] : s === "left" ? [ox, oy, ox, oy + ph] : [ox + pw, oy, ox + pw, oy + ph];
  const [x1, y1, x2, y2] = side(value.entry);
  const horizontal = y1 === y2;
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  const names = value.activities.map((id) => profiles.find((p) => p.id === id)).filter((p) => !!p);
  const counts = preview?.fixtures.filter((f) => f.storage).length ?? 0;

  return (
    <div className="proposal">
      <div className="proposal-form">
        <div className="form-grid">
          <Field label={tl("Niveau")} span={2}>
            <input value={value.name} onChange={(e) => set({ name: e.target.value })} placeholder={tl("Rez-de-chaussée")} />
          </Field>
          <Field label={tl("Longueur L (m)")} hint={tl("De gauche à droite sur le plan")}>
            <input inputMode="decimal" value={value.width} onChange={(e) => set({ width: e.target.value })} />
          </Field>
          <Field label={tl("Largeur l (m)")} hint={tl("De haut en bas sur le plan")}>
            <input inputMode="decimal" value={value.depth} onChange={(e) => set({ depth: e.target.value })} />
          </Field>
          <Field label={tl("Hauteur sous plafond (m)")}>
            <input inputMode="decimal" value={value.height} onChange={(e) => set({ height: e.target.value })} />
          </Field>
          <div className="proposal-entry">
            <span className="field-label">{value.upstairs ? tl("Côté de l'escalier") : tl("Côté de l'entrée")}</span>
            <svg viewBox="0 0 150 150" width="120" height="120" role="img" aria-label={tl("Aperçu de la salle")}>
              <rect x={ox} y={oy} width={pw} height={ph} className="wz-room" />
              {ENTRIES.map((e) => {
                const [a, b, c, d] = side(e.key);
                return <line key={e.key} x1={a} y1={b} x2={c} y2={d} className={`wz-side${value.entry === e.key ? " active" : ""}`} onClick={() => set({ entry: e.key })} />;
              })}
              <line x1={horizontal ? mx - 10 : mx} y1={horizontal ? my : my - 10} x2={horizontal ? mx + 10 : mx} y2={horizontal ? my : my + 10} className="wz-door" />
            </svg>
          </div>
          <label className="check span-2">
            <input type="checkbox" checked={value.storage} onChange={(e) => set({ storage: e.target.checked })} />
            {tl("Avec une réserve au fond (salle de 6 m × 6 m au moins)")}
          </label>
          {showUpstairs && (
            <label className="check span-2">
              <input type="checkbox" checked={value.upstairs} onChange={(e) => set({ upstairs: e.target.checked })} />
              {tl("Niveau à l'étage : on y arrive par un escalier (ni porte d'entrée ni caisse)")}
            </label>
          )}
        </div>
        {names.length > 1 && (
          <p className="muted small">
            {tl("La salle est partagée en rayons : {0}.", [names.map((p, i) => `${tm(p!.label)} ${Math.round((names.length === 2 ? [60, 40] : [50, 25, 25])[i])} %`).join(", ")])}
          </p>
        )}
      </div>
      <div className="proposal-preview">
        <div className="row-between">
          <span className="muted small">
            {typeof input !== "string" && <>{meters(input.width)}  {tl("×")} {meters(input.depth)} · {fmt(input.width * input.depth)}  {tl("m² ·")} {tl("{0} meuble(s)", [counts])}</>}
          </span>
          {webglAvailable() && (
            <div className="segmented small">
              <button type="button" className={view === "3d" ? "active" : ""} onClick={() => setView("3d")}><Box size={13} />  {tl("3D")}</button>
              <button type="button" className={view === "plan" ? "active" : ""} onClick={() => setView("plan")}><MapIcon size={13} />  {tl("Dessus")}</button>
            </div>
          )}
        </div>
        {error && <div className="alert alert-danger small">{error}</div>}
        {preview ? (
          <div className="proposal-canvas">
            {loading && <span className="proposal-busy"><Loader2 className="spin" size={16} /></span>}
            {view === "3d" ? (
              <Suspense fallback={<div className="plan3d plan3d-loading" style={{ height: previewHeight }}>{tl("Chargement de la 3D…")}</div>}>
                <Store3D floor={preview.floor} fixtures={preview.fixtures} fill={[]} mode="orbit" height={previewHeight} compact onUnavailable={() => setView("plan")} />
              </Suspense>
            ) : (
              <StoreMap floor={preview.floor} fixtures={preview.fixtures} height={previewHeight} />
            )}
          </div>
        ) : (
          <div className="plan3d plan3d-loading" style={{ height: previewHeight }}>{loading ? tl("Dessin du plan…") : "—"}</div>
        )}
      </div>
    </div>
  );
}
