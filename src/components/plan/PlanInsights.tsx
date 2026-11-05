// Affichages du plan qui aident à vendre : état du stock de chaque meuble (rupture, stock bas, péremption proche)
// et carte des ventes (chiffre d'affaires par meuble ou au m²). Aussi : actions sur plusieurs meubles
// sélectionnés (aligner, espacer, tourner, supprimer) et étiquettes de rayon d'un meuble.
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalDistributeCenter,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalDistributeCenter,
  ChartColumn,
  Map as MapIcon,
  PackageX,
  RotateCw,
  Trash2,
  X,
} from "lucide-react";
import { api } from "../../api";
import { useApp } from "../../context/AppContext";
import { LabelsModal } from "../LabelsModal";
import { addDays, blocShort, dateOnly, fromMinor, isoDate, money, qty } from "../../lib/format";
import { tl, tm } from "../../lib/i18n";
import type { Fixture, FloorStatus, Product, SalesMap, StockAlert, StockState } from "../../types";
import { footprint } from "../plan3d/geometry";
import type { Geometry, MapOverlay } from "./StoreMap";

export type PlanDisplay = "plan" | "stock" | "sales";
export type SalesMetric = "revenue" | "m2";

// Couleurs d'état (réservées à l'état, toujours accompagnées d'un libellé) et rampe bleue des ventes.
const STATUS: Record<StockState | "ok", { color: string; ink: string }> = {
  out: { color: "#d03b3b", ink: "#ffffff" },
  low: { color: "#ec835a", ink: "#ffffff" },
  expiring: { color: "#fab219", ink: "#0b0b0b" },
  ok: { color: "#0ca30c", ink: "#ffffff" },
};
const statusLabel = (k: StockState | "ok") =>
  ({ out: tl("Rupture"), low: tl("Stock bas"), expiring: tl("Péremption proche"), ok: tl("Rien à signaler") })[k];
const SALES_STEPS = ["#b7d3f6", "#86b6ef", "#5598e7", "#2a78d6", "#1c5cab"];
const SALES_INK = ["#0b0b0b", "#0b0b0b", "#ffffff", "#ffffff", "#ffffff"];
const NO_SALES = "#e1e0d9";

/** Montant court écrit sur un meuble : 850, 12 k, 1,2 M. */
export function compactMoney(minor: number): string {
  const v = fromMinor(minor);
  const a = Math.abs(v);
  if (a >= 1e6) return `${String(Math.round(v / 1e5) / 10).replace(".", ",")} M`;
  if (a >= 1e4) return `${Math.round(v / 1e3)} k`;
  if (a >= 1e3) return `${String(Math.round(v / 100) / 10).replace(".", ",")} k`;
  return String(Math.round(v));
}

function worst(s: { out_of_stock: number; low_stock: number; expiring: number }): StockState | "ok" {
  return s.out_of_stock ? "out" : s.low_stock ? "low" : s.expiring ? "expiring" : "ok";
}

/** Couleur de chaque meuble garni selon son état ; les meubles vides restent grisés. */
export function stockOverlay(fixtures: Fixture[], status: FloorStatus | null): Record<number, MapOverlay> {
  const out: Record<number, MapOverlay> = {};
  if (!status) return out;
  const by = new Map(status.fixtures.map((s) => [s.fixture_id, s]));
  for (const f of fixtures) {
    const s = by.get(f.id);
    if (!f.storage || !s || !s.products) continue;
    const k = worst(s);
    const parts = [
      s.out_of_stock ? tl("{0} en rupture", [s.out_of_stock]) : "",
      s.low_stock ? tl("{0} en stock bas", [s.low_stock]) : "",
      s.expiring ? tl("{0} bientôt périmé(s)", [s.expiring]) : "",
    ].filter(Boolean);
    out[f.id] = {
      color: STATUS[k].color,
      ink: STATUS[k].ink,
      label: s.alerts ? String(s.alerts) : f.code,
      title: `${tm(f.name)} — ${parts.length ? parts.join(" · ") : tl("rien à signaler")} (${tl("{0} produit(s)", [s.products])})`,
    };
  }
  return out;
}

/** Valeur d'un meuble pour la carte des ventes : chiffre d'affaires, ou chiffre d'affaires au m² de sol. */
function salesValue(f: Fixture, revenue: number, metric: SalesMetric) {
  return metric === "m2" ? revenue / Math.max(0.1, f.w * f.h) : revenue;
}

/** Carte des ventes : 5 nuances de bleu, du plus clair (peu) au plus foncé (le plus) ; gris : aucune vente. */
export function salesOverlay(fixtures: Fixture[], map: SalesMap | null, metric: SalesMetric): { overlay: Record<number, MapOverlay>; max: number } {
  const overlay: Record<number, MapOverlay> = {};
  if (!map) return { overlay, max: 0 };
  const by = new Map(map.fixtures.map((s) => [s.fixture_id, s]));
  const storage = fixtures.filter((f) => f.storage);
  const max = Math.max(0, ...storage.map((f) => salesValue(f, by.get(f.id)?.revenue ?? 0, metric)));
  for (const f of storage) {
    const s = by.get(f.id);
    const v = salesValue(f, s?.revenue ?? 0, metric);
    const unit = metric === "m2" ? tl(" / m²") : "";
    const title = s
      ? `${tm(f.name)} — ${money(s.revenue)} · ${tl("marge")} ${money(s.margin)} · ${tl("{0} produit(s) vendu(s)", [s.products])}${metric === "m2" ? ` · ${money(Math.round(v))}${unit}` : ""}`
      : `${tm(f.name)} — ${tl("aucune vente sur la période")}`;
    if (v <= 0 || max <= 0) {
      overlay[f.id] = { color: NO_SALES, ink: "#0b0b0b", label: "0", title };
      continue;
    }
    const bin = Math.min(4, Math.floor((v / max) * 5 - 1e-9));
    overlay[f.id] = { color: SALES_STEPS[bin], ink: SALES_INK[bin], label: compactMoney(Math.round(v)), title };
  }
  return { overlay, max };
}

/** Couleurs des meubles pour la vue 3D (halo au sol). */
export const tintsOf = (overlay: Record<number, MapOverlay> | null) =>
  overlay ? Object.fromEntries(Object.entries(overlay).map(([id, o]) => [id, o.color])) : null;

export interface SalesPeriod {
  days: number | null;
  from: string;
  to: string;
}

export const lastDays = (days: number): SalesPeriod => ({ days, from: isoDate(addDays(new Date(), -(days - 1))), to: isoDate() });

/** Choix de l'affichage (au-dessus du plan) et, pour les ventes, de la période et de la mesure. */
export function DisplayBar({
  display,
  onDisplay,
  canSales,
  period,
  onPeriod,
  metric,
  onMetric,
}: {
  display: PlanDisplay;
  onDisplay: (d: PlanDisplay) => void;
  canSales: boolean;
  period: SalesPeriod;
  onPeriod: (p: SalesPeriod) => void;
  metric: SalesMetric;
  onMetric: (m: SalesMetric) => void;
}) {
  return (
    <div className="plan-display">
      <div className="segmented" role="tablist" aria-label={tl("Affichage du plan")}>
        <button className={display === "plan" ? "active" : ""} onClick={() => onDisplay("plan")}><MapIcon size={15} />  {tl("Plan")}</button>
        <button className={display === "stock" ? "active" : ""} onClick={() => onDisplay("stock")} title={tl("Ruptures, stocks bas et produits bientôt périmés, meuble par meuble")}>
          <PackageX size={15} />  {tl("État du stock")}
        </button>
        {canSales && (
          <button className={display === "sales" ? "active" : ""} onClick={() => onDisplay("sales")} title={tl("Chiffre d'affaires de chaque meuble sur une période")}>
            <ChartColumn size={15} />  {tl("Ventes")}
          </button>
        )}
      </div>
      {display === "sales" && (
        <div className="plan-display-sales">
          <select
            value={period.days === null ? "custom" : String(period.days)}
            onChange={(e) => (e.target.value === "custom" ? onPeriod({ ...period, days: null }) : onPeriod(lastDays(Number(e.target.value))))}
            aria-label={tl("Période")}
          >
            <option value="1">{tl("Aujourd'hui")}</option>
            <option value="7">{tl("7 derniers jours")}</option>
            <option value="30">{tl("30 derniers jours")}</option>
            <option value="90">{tl("90 derniers jours")}</option>
            <option value="custom">{tl("Dates libres")}</option>
          </select>
          {period.days === null && (
            <>
              <input type="date" value={period.from} max={period.to} onChange={(e) => e.target.value && onPeriod({ ...period, from: e.target.value })} aria-label={tl("Du")} />
              <input type="date" value={period.to} min={period.from} onChange={(e) => e.target.value && onPeriod({ ...period, to: e.target.value })} aria-label={tl("Au")} />
            </>
          )}
          <div className="segmented small">
            <button className={metric === "revenue" ? "active" : ""} onClick={() => onMetric("revenue")}>{tl("Chiffre d'affaires")}</button>
            <button className={metric === "m2" ? "active" : ""} onClick={() => onMetric("m2")}>{tl("Au m²")}</button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Légende sous le plan : chaque couleur avec son libellé (et son nombre de meubles). */
export function DisplayLegend({ display, status, fixtures, max, metric }: { display: PlanDisplay; status: FloorStatus | null; fixtures: Fixture[]; max: number; metric: SalesMetric }) {
  if (display === "stock") {
    const by = new Map((status?.fixtures ?? []).map((s) => [s.fixture_id, s]));
    const count = (k: StockState | "ok") => fixtures.filter((f) => f.storage && by.get(f.id)?.products && worst(by.get(f.id)!) === k).length;
    return (
      <div className="plan-legend" aria-label={tl("Légende")}>
        {(["out", "low", "expiring", "ok"] as const).map((k) => (
          <span key={k}><i style={{ background: STATUS[k].color }} />{statusLabel(k)} <strong>{count(k)}</strong></span>
        ))}
        <span className="muted"><i className="empty" />{tl("Meuble vide")}</span>
        <span className="muted small">{tl("Chiffre sur le meuble : produits à signaler. Péremption : dans les {0} jours (Paramètres).", [status?.alert_days ?? 30])}</span>
      </div>
    );
  }
  if (display === "sales") {
    const unit = metric === "m2" ? tl(" / m²") : "";
    return (
      <div className="plan-legend" aria-label={tl("Légende")}>
        <span><i style={{ background: NO_SALES }} />{tl("Aucune vente")}</span>
        {SALES_STEPS.map((c, i) => (
          <span key={c}>
            <i style={{ background: c }} />
            {max > 0 ? `${compactMoney(Math.round((max * i) / 5))} – ${compactMoney(Math.round((max * (i + 1)) / 5))}${unit}` : "—"}
          </span>
        ))}
        <span className="muted small">{tl("Chaque produit compte pour le meuble de son emplacement principal.")}</span>
      </div>
    );
  }
  return null;
}

/** Panneau « État du stock » : produits à signaler du meuble choisi, sinon le résumé du niveau. */
export function StockPanel({ fixture, status, fixtures }: { fixture: Fixture | null; status: FloorStatus | null; fixtures: Fixture[] }) {
  const { toast } = useApp();
  const [alerts, setAlerts] = useState<StockAlert[] | null>(null);
  useEffect(() => {
    setAlerts(null);
    if (!fixture?.storage) return;
    api.planFixtureAlerts(fixture.id).then(setAlerts).catch((e) => toast.error(e));
  }, [fixture?.id, fixture?.storage, status, toast]);

  if (!fixture) {
    const flagged = (status?.fixtures ?? []).filter((s) => s.alerts > 0);
    const names = new Map(fixtures.map((f) => [f.id, f]));
    return (
      <div className="plan-insight">
        <strong>{tl("État du stock")}</strong>
        <span className="muted small">{tl("Cliquez sur un meuble pour voir ses produits à signaler.")}</span>
        {flagged.length === 0 ? (
          <p className="muted">{tl("Rien à signaler sur ce niveau.")}</p>
        ) : (
          <ul className="insight-list">
            {flagged
              .filter((s) => names.has(s.fixture_id))
              .sort((a, b) => b.out_of_stock - a.out_of_stock || b.alerts - a.alerts)
              .map((s) => {
                const k = worst(s);
                return (
                  <li key={s.fixture_id}>
                    <i style={{ background: STATUS[k].color }} />
                    <span>{tm(names.get(s.fixture_id)!.name)}</span>
                    <span className="muted small">{statusLabel(k)} · {tl("{0} produit(s)", [s.alerts])}</span>
                  </li>
                );
              })}
          </ul>
        )}
      </div>
    );
  }
  return (
    <div className="plan-insight">
      <strong>{tm(fixture.name)}</strong>
      {!fixture.storage ? (
        <span className="muted small">{tl("Ce meuble ne range pas de produits.")}</span>
      ) : alerts === null ? (
        <span className="muted small">{tl("Chargement…")}</span>
      ) : alerts.length === 0 ? (
        <p className="muted">{tl("Rien à signaler dans ce meuble.")}</p>
      ) : (
        <ul className="insight-list">
          {alerts.map((a) => (
            <li key={a.product_id}>
              <i style={{ background: STATUS[a.status].color }} />
              <span>{a.name}</span>
              <span className="muted small">
                {statusLabel(a.status)} · {tl("stock")} {qty(a.stock)} {a.unit}
                {a.status === "low" ? ` (${tl("minimum")} ${qty(a.min_stock)})` : ""}
                {a.expiring && a.expiry_date ? ` · ${tl("périme le {0}", [dateOnly(a.expiry_date)])}` : ""}
                {a.etage || a.rangee ? ` · ${[a.etage ? tl("É{0}", [a.etage]) : "", a.rangee ? tl("C{0}", [a.rangee]) : ""].filter(Boolean).join("·")}` : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Panneau « Ventes » : détail du meuble choisi, sinon les meubles qui vendent le plus et le moins. */
export function SalesPanel({ fixture, map, fixtures, metric }: { fixture: Fixture | null; map: SalesMap | null; fixtures: Fixture[]; metric: SalesMetric }) {
  const by = useMemo(() => new Map((map?.fixtures ?? []).map((s) => [s.fixture_id, s])), [map]);
  if (!map) return <div className="plan-insight"><span className="muted small">{tl("Chargement…")}</span></div>;
  const period = `${dateOnly(map.from)} – ${dateOnly(map.to)}`;
  if (fixture) {
    const s = by.get(fixture.id);
    const area = fixture.w * fixture.h;
    return (
      <div className="plan-insight">
        <strong>{tm(fixture.name)}</strong>
        <span className="muted small">{period}</span>
        {!fixture.storage ? (
          <span className="muted small">{tl("Ce meuble ne range pas de produits.")}</span>
        ) : (
          <dl className="insight-figures">
            <dt>{tl("Chiffre d'affaires")}</dt><dd>{money(s?.revenue ?? 0)}</dd>
            <dt>{tl("Marge")}</dt><dd>{money(s?.margin ?? 0)}</dd>
            <dt>{tl("Au m² de sol")}</dt><dd>{money(Math.round((s?.revenue ?? 0) / Math.max(0.1, area)))}</dd>
            <dt>{tl("Produits vendus")}</dt><dd>{s?.products ?? 0}</dd>
            <dt>{tl("Part des ventes")}</dt><dd>{map.total ? `${Math.round(((s?.revenue ?? 0) * 100) / map.total)} %` : "—"}</dd>
          </dl>
        )}
      </div>
    );
  }
  const storage = fixtures.filter((f) => f.storage);
  const ranked = storage
    .map((f) => ({ f, v: salesValue(f, by.get(f.id)?.revenue ?? 0, metric) }))
    .sort((a, b) => b.v - a.v);
  const unit = metric === "m2" ? tl(" / m²") : "";
  const row = ({ f, v }: { f: Fixture; v: number }) => (
    <li key={f.id}>
      <span>{tm(f.name)}</span>
      <span className="muted small">{money(Math.round(v))}{unit}</span>
    </li>
  );
  return (
    <div className="plan-insight">
      <strong>{tl("Ventes par meuble")}</strong>
      <span className="muted small">{period} · {tl("total")} {money(map.total)}</span>
      {ranked.length === 0 ? (
        <p className="muted">{tl("Aucun meuble de rangement sur ce niveau.")}</p>
      ) : (
        <>
          <span className="insight-title">{tl("Ceux qui vendent le plus")}</span>
          <ul className="insight-list plain">{ranked.slice(0, 5).map(row)}</ul>
          {ranked.length > 5 && (
            <>
              <span className="insight-title">{tl("Ceux qui vendent le moins")}</span>
              <ul className="insight-list plain">{ranked.slice(-Math.min(5, ranked.length - 5)).reverse().map(row)}</ul>
            </>
          )}
        </>
      )}
      {map.unplaced > 0 && <p className="muted small">{tl("Produits non rangés sur le plan : {0} de ventes.", [money(map.unplaced)])}</p>}
    </div>
  );
}

/** Actions sur plusieurs meubles sélectionnés : aligner, espacer régulièrement, tourner, supprimer. */
export function GroupPanel({
  group,
  onApply,
  onRotate,
  onDelete,
  onClear,
}: {
  group: Fixture[];
  onApply: (next: Geometry[]) => void;
  onRotate: () => void;
  onDelete: () => void;
  onClear: () => void;
}) {
  const fps = group.map((f) => ({ f, r: footprint(f) }));
  const minX = Math.min(...fps.map((p) => p.r.x));
  const maxX = Math.max(...fps.map((p) => p.r.x + p.r.w));
  const minY = Math.min(...fps.map((p) => p.r.y));
  const maxY = Math.max(...fps.map((p) => p.r.y + p.r.h));
  const r2 = (n: number) => Math.round(n * 100) / 100;
  // Déplace chaque meuble pour que son emprise au sol commence en (x, y).
  const moveTo = (p: (typeof fps)[number], x: number | null, y: number | null): Geometry => ({
    id: p.f.id,
    x: r2(p.f.x + (x === null ? 0 : x - p.r.x)),
    y: r2(p.f.y + (y === null ? 0 : y - p.r.y)),
    w: p.f.w,
    h: p.f.h,
    rotation: p.f.rotation,
  });
  const align = (how: "left" | "hcenter" | "right" | "top" | "vcenter" | "bottom") =>
    onApply(
      fps.map((p) => {
        switch (how) {
          case "left": return moveTo(p, minX, null);
          case "right": return moveTo(p, maxX - p.r.w, null);
          case "hcenter": return moveTo(p, (minX + maxX) / 2 - p.r.w / 2, null);
          case "top": return moveTo(p, null, minY);
          case "bottom": return moveTo(p, null, maxY - p.r.h);
          default: return moveTo(p, null, (minY + maxY) / 2 - p.r.h / 2);
        }
      }),
    );
  // Espacement régulier : même écart entre les meubles, les deux du bout restent en place.
  const distribute = (axis: "x" | "y") => {
    const sorted = [...fps].sort((a, b) => (axis === "x" ? a.r.x - b.r.x : a.r.y - b.r.y));
    const size = (p: (typeof fps)[number]) => (axis === "x" ? p.r.w : p.r.h);
    const span = axis === "x" ? maxX - minX : maxY - minY;
    const gap = (span - sorted.reduce((s, p) => s + size(p), 0)) / (sorted.length - 1);
    let at = axis === "x" ? minX : minY;
    onApply(
      sorted.map((p) => {
        const g = axis === "x" ? moveTo(p, at, null) : moveTo(p, null, at);
        at += size(p) + gap;
        return g;
      }),
    );
  };
  const garnished = group.filter((f) => f.product_count > 0).length;
  return (
    <div className="plan-insight group-panel">
      <div className="group-head">
        <strong>{tl("{0} meubles sélectionnés", [group.length])}</strong>
        <button className="icon-btn" title={tl("Désélectionner (Échap)")} onClick={onClear}><X size={16} /></button>
      </div>
      <span className="muted small">{tl("Glissez l'un d'eux pour les déplacer ensemble. Maj + clic : ajouter ou retirer un meuble.")}</span>
      <span className="insight-title">{tl("Aligner")}</span>
      <div className="group-tools">
        <button className="icon-btn" title={tl("Aligner à gauche")} onClick={() => align("left")}><AlignStartVertical size={17} /></button>
        <button className="icon-btn" title={tl("Centrer (horizontalement)")} onClick={() => align("hcenter")}><AlignCenterVertical size={17} /></button>
        <button className="icon-btn" title={tl("Aligner à droite")} onClick={() => align("right")}><AlignEndVertical size={17} /></button>
        <button className="icon-btn" title={tl("Aligner en haut")} onClick={() => align("top")}><AlignStartHorizontal size={17} /></button>
        <button className="icon-btn" title={tl("Centrer (verticalement)")} onClick={() => align("vcenter")}><AlignCenterHorizontal size={17} /></button>
        <button className="icon-btn" title={tl("Aligner en bas")} onClick={() => align("bottom")}><AlignEndHorizontal size={17} /></button>
      </div>
      {group.length >= 3 && (
        <>
          <span className="insight-title">{tl("Espacer régulièrement")}</span>
          <div className="group-tools">
            <button className="btn btn-sm" onClick={() => distribute("x")}><AlignHorizontalDistributeCenter size={15} />  {tl("De gauche à droite")}</button>
            <button className="btn btn-sm" onClick={() => distribute("y")}><AlignVerticalDistributeCenter size={15} />  {tl("De haut en bas")}</button>
          </div>
        </>
      )}
      <div className="fixture-panel-actions">
        <button className="btn btn-sm" onClick={onRotate} title={tl("Tourner chaque meuble de 90° (R)")}><RotateCw size={14} />  {tl("Tourner")}</button>
        <button className="btn btn-sm btn-danger-outline" onClick={onDelete} title={tl("Supprimer (Suppr)")}><Trash2 size={14} />  {tl("Supprimer")}</button>
      </div>
      {garnished > 0 && <p className="muted small">{tl("{0} de ces meubles contiennent des produits : la suppression demande le PIN d'un responsable.", [garnished])}</p>}
    </div>
  );
}

/** Étiquettes de rayon d'un meuble : ses produits case par case, avec leur case dans ce meuble. */
export function FixtureLabels({ fixture, onClose }: { fixture: Fixture; onClose: () => void }) {
  const { toast } = useApp();
  const [data, setData] = useState<{ products: Product[]; places: Map<number, string> } | null>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    Promise.all([api.planFixtureContents(fixture.id), api.listProducts({ fixture_id: fixture.id, limit: 2000 })])
      .then(([contents, products]) => {
        const places = new Map<number, string>();
        const order: number[] = [];
        for (const slot of contents.slots) {
          for (const p of slot.products) {
            if (places.has(p.product_id)) continue;
            order.push(p.product_id);
            places.set(
              p.product_id,
              [blocShort(fixture.code), slot.etage ? tl("É{0}", [slot.etage]) : "", slot.rangee ? tl("C{0}", [slot.rangee]) : ""].filter(Boolean).join("·"),
            );
          }
        }
        const rank = new Map(order.map((id, i) => [id, i]));
        setData({ products: [...products].sort((a, b) => (rank.get(a.id) ?? 1e9) - (rank.get(b.id) ?? 1e9)), places });
      })
      .catch((e) => {
        toast.error(e);
        close.current();
      });
  }, [fixture.id, fixture.code, toast]);
  if (!data) return null;
  return <LabelsModal products={data.products} initialTemplate="shelf" placeOf={(p) => data.places.get(p.id) ?? fixture.code} onClose={onClose} />;
}
