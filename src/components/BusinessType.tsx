import { useEffect, useState } from "react";
import {
  Apple,
  Beef,
  BookOpen,
  BrickWall,
  Building2,
  Car,
  Carrot,
  Check,
  Croissant,
  CupSoda,
  Fuel,
  Cpu,
  Hammer,
  PawPrint,
  Smartphone,
  SprayCan,
  Library,
  Pill,
  ShoppingBasket,
  ShoppingCart,
  Shirt,
  Sparkles,
  Store,
  Truck,
  UtensilsCrossed,
} from "lucide-react";
import type { ReactNode } from "react";
import { api } from "../api";
import { useApp } from "../context/AppContext";
import { FEATURE_LABELS } from "../lib/format";
import type { BusinessProfile, CatalogueSummary } from "../types";
import { tl, tm } from "../lib/i18n";

const ICONS: Record<string, ReactNode> = {
  boutique: <Store size={22} />,
  general: <ShoppingBasket size={22} />,
  supermarket: <ShoppingCart size={22} />,
  superette: <Apple size={22} />,
  wholesale: <Truck size={22} />,
  pharmacy: <Pill size={22} />,
  fashion: <Shirt size={22} />,
  hardware: <Hammer size={22} />,
  electronics: <Cpu size={22} />,
  specialty: <Sparkles size={22} />,
  restaurant: <UtensilsCrossed size={22} />,
  building: <BrickWall size={22} />,
  phones: <Smartphone size={22} />,
  bakery: <Croissant size={22} />,
  butcher: <Beef size={22} />,
  greengrocer: <Carrot size={22} />,
  cosmetics: <SprayCan size={22} />,
  bookshop: <BookOpen size={22} />,
  autoparts: <Car size={22} />,
  agrovet: <PawPrint size={22} />,
  bar: <CupSoda size={22} />,
  kiosk: <Fuel size={22} />,
};

export function useBusinessProfiles() {
  const [data, setData] = useState<{ profiles: BusinessProfile[]; catalogue: CatalogueSummary[] } | null>(null);
  useEffect(() => {
    api.businessProfiles().then(setData).catch(() => undefined);
  }, []);
  return data;
}

/** Grille de choix du type de commerce. */
export function BusinessTypeGrid({
  profiles,
  value,
  onChange,
}: {
  profiles: BusinessProfile[];
  value: string;
  onChange: (p: BusinessProfile) => void;
}) {
  return (
    <div className="biz-grid">
      {profiles.map((p) => (
        <button type="button" key={p.id} className={`biz-card ${value === p.id ? "active" : ""}`} onClick={() => onChange(p)}>
          <span className="biz-icon">{ICONS[p.id] ?? <Building2 size={22} />}</span>
          <span className="biz-label">{tm(p.label)}</span>
          <span className="biz-desc">{tm(p.description)}</span>
          {value === p.id && <span className="biz-check"><Check size={14} /></span>}
        </button>
      ))}
    </div>
  );
}

/** Cases à cocher des fonctions activées. */
export function FeatureToggles({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  return (
    <div className="feature-grid">
      {Object.entries(FEATURE_LABELS).map(([k, f]) => (
        <label key={k} className={`feature ${value.includes(k) ? "on" : ""}`}>
          <input type="checkbox" checked={value.includes(k)} onChange={(e) => onChange(e.target.checked ? [...value, k] : value.filter((x) => x !== k))} />
          <span>
            <strong>{f.label}</strong>
            <span className="muted small">{f.hint}</span>
          </span>
        </label>
      ))}
    </div>
  );
}

/**
 * Choix des catégories du catalogue prédéfini à charger (sans doublon).
 * Les catégories recommandées pour le type de commerce sont pré-cochées.
 */
export function CataloguePicker({ onDone }: { onDone: (created: number) => void }) {
  const { toast, settings } = useApp();
  const data = useBusinessProfiles();
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const profile = data?.profiles.find((p) => p.id === settings.business_type);

  useEffect(() => {
    if (data) setSelected(new Set(profile?.categories ?? []));
  }, [data, profile]);

  if (!data) return <div className="muted pad">{tl("Chargement du catalogue…")}</div>;

  const toggle = (i: number) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(i)) n.delete(i);
      else n.add(i);
      return n;
    });
  const total = data.catalogue.filter((c) => selected.has(c.index)).reduce((s, c) => s + c.total + 1, 0);

  const load = async () => {
    setBusy(true);
    try {
      onDone(await api.seedCatalogue([...selected].sort((a, b) => a - b)));
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <p className="muted">
        {tl("Cochez les catégories à ajouter.")} {profile ? <>{tl("Les catégories recommandées pour «")} {tm(profile.label)}  {tl("» sont pré-cochées.")}</> : null}  {tl("Les catégories déjà présentes ne sont pas dupliquées ; vous pourrez tout renommer, masquer ou supprimer ensuite.")}</p>
      <div className="row-between" style={{ margin: "8px 0" }}>
        <div className="row-gap">
          <button className="btn btn-sm" onClick={() => setSelected(new Set(data.catalogue.map((c) => c.index)))}>{tl("Tout cocher")}</button>
          <button className="btn btn-sm" onClick={() => setSelected(new Set())}>{tl("Tout décocher")}</button>
          {profile && <button className="btn btn-sm" onClick={() => setSelected(new Set(profile.categories))}>{tl("Recommandées")}</button>}
        </div>
        <span className="muted small">{selected.size}  {tl("catégorie(s) ·")} {total}  {tl("élément(s) au total")}</span>
      </div>
      <div className="catalogue-grid">
        {data.catalogue.map((c) => (
          <label key={c.index} className={`catalogue-item ${selected.has(c.index) ? "on" : ""}`}>
            <input type="checkbox" checked={selected.has(c.index)} onChange={() => toggle(c.index)} />
            <span>
              <strong>{c.name}</strong>
              <span className="muted small">
                {c.subcategories}  {tl("sous-cat. —")} {c.examples.join(", ")}
                {c.subcategories > c.examples.length ? "…" : ""}
              </span>
            </span>
          </label>
        ))}
      </div>
      <div className="row-end" style={{ marginTop: 12 }}>
        <button className="btn btn-primary" disabled={busy || selected.size === 0} onClick={load}>
          <Library size={16} /> {busy ? tl("Chargement…") : tl("Charger {0} catégorie(s)", [selected.size])}
        </button>
      </div>
    </div>
  );
}
