import { useCallback, useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";
import { Hand, MapPin, PackagePlus, Printer, Star, X } from "lucide-react";
import { api } from "../../api";
import { useApp } from "../../context/AppContext";
import { qty } from "../../lib/format";
import { printHtml } from "../../lib/receipt";
import { ProductPicker } from "../ProductPicker";
import { Thumb } from "../ui";
import type { FixtureContents, Product, Slot, SlotProduct } from "../../types";
import { tl, tm } from "../../lib/i18n";

/** Données glissées : un produit (depuis la liste ou depuis une case). */
const PRODUCT_DRAG = "application/x-gestimarket-product";

interface Moving {
  product_id: number;
  name: string;
  /** Case d'origine (déplacement) ; absent : produit à poser. */
  from_location_id?: number;
}

/** Libellé d'une case : « Étage 3 · Case 2 ». */
export function slotName(s: { etage: string; rangee: string }): string {
  return [s.etage ? tl("Étage {0}", [s.etage]) : "", s.rangee ? tl("Case {0}", [s.rangee]) : ""].filter(Boolean).join(" · ") || tl("Emplacement unique");
}

/** Code d'étiquette d'une case, lu par la recherche « Où est le produit ? ». */
export const slotQr = (locationId: number) => `GMLOC:${locationId}`;

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/**
 * Vue de face d'un meuble : ses étages (le plus haut en premier) et ses cases, avec les produits
 * rangés. Modification : glisser un produit dans une case (« poser »), d'une case à l'autre
 * (déplacer), le retirer (« prendre »), ou toucher le produit puis la case (écran tactile).
 */
export function FixtureFront({
  fixtureId,
  editable,
  highlightLocationId,
  highlightProductId,
  onChanged,
  compact,
}: {
  fixtureId: number;
  editable?: boolean;
  highlightLocationId?: number | null;
  highlightProductId?: number | null;
  onChanged?: () => void;
  compact?: boolean;
}) {
  const { toast, settings } = useApp();
  const [data, setData] = useState<FixtureContents | null>(null);
  const [moving, setMoving] = useState<Moving | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const [unplaced, setUnplaced] = useState<Product[]>([]);

  const load = useCallback(async () => {
    try {
      setData(await api.planFixtureContents(fixtureId));
    } catch (e) {
      toast.error(e);
    }
  }, [fixtureId, toast]);
  useEffect(() => {
    load();
  }, [load]);
  const loadUnplaced = useCallback(() => {
    if (editable) api.listProducts({ without_location: true, limit: 60 }).then(setUnplaced).catch(() => undefined);
  }, [editable]);
  useEffect(loadUnplaced, [loadUnplaced]);

  const rows = useMemo(() => {
    if (!data) return [];
    const byLevel = new Map<number, Slot[]>();
    for (const s of data.slots) {
      if (!byLevel.has(s.level)) byLevel.set(s.level, []);
      byLevel.get(s.level)!.push(s);
    }
    // Étage le plus haut en premier, comme le meuble vu de face.
    return [...byLevel.entries()].sort(([a], [b]) => b - a).map(([level, slots]) => ({ level, slots: slots.sort((x, y) => x.section - y.section) }));
  }, [data]);

  const after = async (p: Promise<unknown>, ok: string) => {
    try {
      await p;
      toast.success(ok);
      setMoving(null);
      await load();
      loadUnplaced();
      onChanged?.();
    } catch (e) {
      toast.error(e);
    }
  };

  const put = (m: Moving, slot: Slot) => {
    if (m.from_location_id === slot.id) return setMoving(null);
    after(
      api.planPut({ product_id: m.product_id, location_id: slot.id, from_location_id: m.from_location_id ?? null }),
      `« ${m.name} » ${m.from_location_id ? tl("déplacé") : tl("posé")} : ${tm(data?.fixture.name)} · ${slotName(slot)}.`,
    );
  };
  const take = (p: SlotProduct, slot: Slot) => after(api.planTake(p.product_id, slot.id), tl("« {0} » retiré de {1}.", [p.name, slotName(slot)]));
  const makePrimary = (p: SlotProduct, slot: Slot) =>
    after(api.planSetPrimary(p.product_id, slot.id), tl("{0} est maintenant l'emplacement principal de « {1} ».", [slotName(slot), p.name]));

  const onDrop = (e: React.DragEvent, slot: Slot) => {
    e.preventDefault();
    setOver(null);
    try {
      put(JSON.parse(e.dataTransfer.getData(PRODUCT_DRAG)) as Moving, slot);
    } catch {
      // autre chose qu'un produit
    }
  };

  /** Étiquettes de rayon : une par case, avec le QR code lu par « Où est le produit ? ». */
  const printLabels = async () => {
    if (!data) return;
    const f = data.fixture;
    const cards = await Promise.all(
      data.slots.map(async (s) => {
        const qr = await QRCode.toDataURL(slotQr(s.id), { margin: 0, width: 160 });
        return `<div class="slot-label"><img src="${qr}"/><div><strong>${esc(f.code)}${s.etage ? `-${esc(s.etage)}` : ""}${s.rangee ? `-${esc(s.rangee)}` : ""}</strong><span>${esc(tm(f.name))}</span><span>${esc(slotName(s))}</span></div></div>`;
      }),
    );
    printHtml(`
      <style>
        .slot-labels { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4mm; }
        .slot-label { display: flex; gap: 3mm; align-items: center; border: 1px dashed #999; padding: 3mm; break-inside: avoid; font-family: sans-serif; }
        .slot-label img { width: 18mm; height: 18mm; }
        .slot-label div { display: flex; flex-direction: column; gap: 1mm; font-size: 9pt; }
        .slot-label strong { font-size: 14pt; }
      </style>
      <h3 style="font-family:sans-serif">${esc(settings.shop_name ?? "")} — ${esc(tm(f.name))} (${esc(f.code)})</h3>
      <div class="slot-labels">${cards.join("")}</div>`);
  };

  if (!data) return <p className="muted">{tl("Chargement…")}</p>;
  const f = data.fixture;
  if (!f.storage) return <p className="muted">{tl("Cet élément du plan (")}{tm(f.type_name)}{tl(") ne reçoit pas de produits.")}</p>;

  const chip = (p: SlotProduct, slot: Slot) => (
    <div
      key={`${p.product_id}-${slot.id}`}
      className={`slot-chip${p.primary ? "" : " other"}${highlightProductId === p.product_id ? " found" : ""}${moving?.product_id === p.product_id && moving.from_location_id === slot.id ? " moving" : ""}`}
      draggable={editable}
      onDragStart={(e) => {
        e.dataTransfer.setData(PRODUCT_DRAG, JSON.stringify({ product_id: p.product_id, name: p.name, from_location_id: slot.id }));
        e.dataTransfer.effectAllowed = "move";
      }}
      onClick={(e) => {
        if (!editable) return;
        e.stopPropagation();
        setMoving({ product_id: p.product_id, name: p.name, from_location_id: slot.id });
      }}
      title={tl("{0}{1} — stock {2} {3}", [p.name, p.primary ? "" : " (autre emplacement)", qty(p.stock), p.unit])}
    >
      {!compact && <Thumb imageId={p.image_id} name={p.name} size={26} rounded={5} />}
      <span className="slot-chip-name">{p.name}</span>
      {!p.primary && <span className="slot-chip-tag">autre</span>}
      {editable && (
        <span className="slot-chip-actions">
          {!p.primary && (
            <button type="button" className="icon-btn" title={tl("En faire l'emplacement principal")} onClick={(e) => { e.stopPropagation(); makePrimary(p, slot); }}>
              <Star size={13} />
            </button>
          )}
          <button type="button" className="icon-btn danger" title={tl("Prendre : retirer de cette case")} onClick={(e) => { e.stopPropagation(); take(p, slot); }}>
            <X size={13} />
          </button>
        </span>
      )}
    </div>
  );

  return (
    <div className={`fixture-front${compact ? " compact" : ""}`}>
      <div className="front-main">
        <div className="front-head">
          <span className="front-swatch" style={{ background: f.color }} />
          <div>
            <strong>{tm(f.name)}</strong>
            <span className="muted small"> · {f.code} · {tm(f.type_name)} · {f.levels}  {tl("étage(s) ×")} {f.sections}  {tl("case(s)")}</span>
          </div>
          {!compact && (
            <button type="button" className="btn btn-sm" onClick={printLabels} title={tl("Une étiquette par case, avec QR code")}>
              <Printer size={14} />  {tl("Étiquettes")}</button>
          )}
        </div>
        {moving && (
          <div className="alert alert-info front-moving">
            <Hand size={16} />  {tl("Touchez une case pour")} {moving.from_location_id ? tl("déplacer") : tl("poser")} « {moving.name} ».
            <button type="button" className="link-btn" onClick={() => setMoving(null)}>{tl("Annuler")}</button>
          </div>
        )}
        <div className="front-grid" style={{ ["--front-color" as string]: f.color }}>
          {rows.map(({ level, slots }) => (
            <div key={level} className="front-level">
              <span className="front-level-name">{slots[0]?.etage ? tl("É{0}", [slots[0].etage]) : ""}</span>
              <div className="front-cells" style={{ gridTemplateColumns: `repeat(${f.sections}, minmax(0, 1fr))` }}>
                {slots.map((s) => (
                  <div
                    key={s.id}
                    className={`front-cell${over === s.id ? " over" : ""}${highlightLocationId === s.id ? " found" : ""}${moving ? " target" : ""}`}
                    onDragOver={(e) => {
                      if (editable && e.dataTransfer.types.includes(PRODUCT_DRAG)) {
                        e.preventDefault();
                        setOver(s.id);
                      }
                    }}
                    onDragLeave={() => setOver((o) => (o === s.id ? null : o))}
                    onDrop={(e) => onDrop(e, s)}
                    onClick={() => moving && put(moving, s)}
                  >
                    {s.rangee && <span className="front-cell-name">C{s.rangee}</span>}
                    {s.products.map((p) => chip(p, s))}
                    {s.products.length === 0 && <span className="front-empty">{editable ? tl("Déposez un produit ici") : tl("Vide")}</span>}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        {!compact && (
          <p className="muted small">
            {editable
              ? tl("Glissez un produit dans une case (ou touchez le produit puis la case). Un produit déjà rangé ailleurs garde son emplacement principal : celui-ci devient un « autre » emplacement (★ pour l'échanger). ✕ retire le produit de la case.")
              : tl("Les produits marqués « autre » ont aussi un emplacement principal ailleurs.")}
          </p>
        )}
      </div>

      {editable && !compact && (
        <aside className="front-side">
          <h4><PackagePlus size={16} />  {tl("Produits à ranger")}</h4>
          <ProductPicker
            placeholder={tl("Rechercher ou scanner…")}
            onPick={(p) => setMoving({ product_id: p.id, name: p.name })}
          />
          <p className="muted small">{tl("Choisissez un produit, puis touchez une case ; ou glissez un produit non rangé ci-dessous.")}</p>
          <div className="front-unplaced">
            {unplaced.map((p) => (
              <div
                key={p.id}
                className={`slot-chip${moving?.product_id === p.id && !moving.from_location_id ? " moving" : ""}`}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData(PRODUCT_DRAG, JSON.stringify({ product_id: p.id, name: p.name }));
                  e.dataTransfer.effectAllowed = "copy";
                }}
                onClick={() => setMoving({ product_id: p.id, name: p.name })}
              >
                <Thumb imageId={p.image_id} name={p.name} color={p.category_color} size={26} rounded={5} />
                <span className="slot-chip-name">{p.name}</span>
              </div>
            ))}
            {unplaced.length === 0 && (
              <span className="muted small"><MapPin size={13} />  {tl("Tous les produits sont rangés.")}</span>
            )}
          </div>
        </aside>
      )}
    </div>
  );
}
