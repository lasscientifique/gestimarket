import { useState } from "react";
import { Palette, Plus, Wand2, X } from "lucide-react";
import { api } from "../api";
import { useApp } from "../context/AppContext";
import { HelpTip } from "./Help";
import { Modal } from "./ui";
import { AXES, COLORS, axisName, axisPresets, colorName, swatchStyle, variantLabel } from "../lib/variants";
import { getLang, tl } from "../lib/i18n";
import { currencySymbol, minorToInput, money, parseNumber, qty, toMinor } from "../lib/format";
import { mediaUrl } from "../lib/media";
import type { Product, Variant, VariantInput } from "../types";

/** Ligne de l'éditeur : champs tels qu'ils sont tapés. */
export interface VariantRow {
  id: number | null;
  color: string | null;
  size: string | null;
  barcode: string;
  price: string;
  stock: string;
  photo_id: number | null;
  active: boolean;
}

export const rowsFromVariants = (list: Variant[]): VariantRow[] =>
  list.map((v) => ({
    id: v.id,
    color: v.color,
    size: v.size,
    barcode: v.barcode ?? "",
    price: v.price ? minorToInput(v.price) : "",
    stock: String(v.stock).replace(".", ","),
    photo_id: v.photo_id,
    active: v.active,
  }));

export const rowsToInput = (rows: VariantRow[]): VariantInput[] =>
  rows.map((r) => ({
    id: r.id,
    color: r.color,
    size: r.size,
    barcode: r.barcode.trim() || null,
    price: r.price.trim() ? toMinor(r.price) || null : null,
    stock: Math.max(0, Math.round((parseNumber(r.stock) || 0) * 1000) / 1000),
    photo_id: r.photo_id,
    active: r.active,
  }));

/** Même règle que le moteur : le PIN d'un responsable est demandé si le stock ou le prix d'une déclinaison
 *  existante change, ou si une déclinaison qui a du stock est retirée. */
export function variantsNeedPin(before: Variant[], rows: VariantRow[]): boolean {
  const input = rowsToInput(rows);
  return before.some((old) => {
    const v = input.find((x) => x.id === old.id);
    if (!v) return old.stock > 1e-9;
    return Math.abs(v.stock - old.stock) > 1e-9 || (v.price ?? null) !== (old.price ?? null);
  });
}

/** Couleurs et tailles en vente d'un produit. */
export const sellable = (p: Product) => p.variants.filter((v) => v.active);

const unique = (list: (string | null)[]) => list.filter((x, i): x is string => !!x && list.indexOf(x) === i);
const sameSize = (a: string | null, b: string | null) => (a ?? "").toLowerCase() === (b ?? "").toLowerCase();

/** Fiche produit : couleurs (palette) et tailles, puis stock, prix, code-barres de chaque combinaison. */
export function VariantsEditor({
  rows,
  axis,
  onChange,
  onAxis,
  photos,
  unit,
  price,
  track,
}: {
  rows: VariantRow[];
  axis: string | null;
  onChange: (rows: VariantRow[]) => void;
  onAxis: (axis: string | null) => void;
  /** Photos du produit (la principale d'abord) : une couleur peut en montrer une. */
  photos: number[];
  unit: string;
  price: number;
  track: boolean;
}) {
  const { toast } = useApp();
  const lang = getLang();
  const colors = unique(rows.map((r) => r.color));
  const sizes = unique(rows.map((r) => r.size));
  const [paletteOpen, setPaletteOpen] = useState(rows.length === 0);
  const [sizeText, setSizeText] = useState("");

  /** Toutes les combinaisons couleur × taille ; les lignes déjà saisies sont gardées. */
  const rebuild = (cs: string[], ss: string[]) => {
    const next: VariantRow[] = [];
    for (const c of cs.length ? cs : [null]) {
      for (const s of ss.length ? ss : [null]) {
        if (c === null && s === null) continue;
        const old = rows.find((r) => r.color === c && sameSize(r.size, s));
        const photo = c ? rows.find((r) => r.color === c && r.photo_id)?.photo_id ?? null : null;
        next.push(old ?? { id: null, color: c, size: s, barcode: "", price: "", stock: "0", photo_id: photo, active: true });
      }
    }
    onChange(next);
  };
  const toggleColor = (code: string) => rebuild(colors.includes(code) ? colors.filter((c) => c !== code) : [...colors, code], sizes);
  const toggleSize = (s: string) => {
    const has = sizes.some((x) => sameSize(x, s));
    rebuild(colors, has ? sizes.filter((x) => !sameSize(x, s)) : [...sizes, s]);
  };
  const addSize = () => {
    const s = sizeText.trim().replace(/\s+/g, " ");
    if (!s) return;
    if (!axis) return toast.info(tl("Choisissez d'abord le type de taille (taille, pointure, âge…)."));
    if (s.length > 40) return toast.error(tl("Taille trop longue (40 caractères au plus)."));
    if (!sizes.some((x) => sameSize(x, s))) rebuild(colors, [...sizes, s]);
    setSizeText("");
  };
  const setRow = (i: number, patch: Partial<VariantRow>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const setColorPhoto = (code: string, id: number | null) => onChange(rows.map((r) => (r.color === code ? { ...r, photo_id: id } : r)));
  const changeAxis = (a: string | null) => {
    // Plus de second axe : les lignes ne gardent que leur couleur.
    if (!a && sizes.length) rebuild(colors, []);
    onAxis(a);
  };
  const total = rows.reduce((s, r) => s + (parseNumber(r.stock) || 0), 0);
  const presets = axisPresets(axis, lang).filter((p) => !sizes.some((x) => sameSize(x, p)));
  const photoName = (id: number) => (id === photos[0] ? tl("Photo principale") : tl("Photo {0}", [photos.indexOf(id) + 1]));

  return (
    <div className="span-2 packs-box variants-box">
      <div className="packs-head">
        <span className="field-label"><Palette size={14} />  {tl("Couleurs et tailles")} <HelpTip k="variants" /></span>
        <label className="inline small">
          {tl("Type de taille")}
          <select value={axis ?? ""} onChange={(e) => changeAxis(e.target.value || null)}>
            <option value="">{tl("Aucun (couleurs seulement)")}</option>
            {AXES.map((a) => <option key={a.code} value={a.code}>{a[lang]}</option>)}
          </select>
        </label>
      </div>
      {rows.length === 0 && (
        <p className="muted small">{tl("Vêtements, chaussures, téléphones… : chaque couleur et chaque taille a son stock, et au besoin son code-barres et son prix. Choisissez les couleurs, puis les tailles.")}</p>
      )}

      <div className="variant-chips">
        {colors.map((c) => (
          <button key={c} type="button" className="color-chip on" onClick={() => toggleColor(c)} title={tl("Retirer")}>
            <span className="swatch" style={swatchStyle(c)} /> {colorName(c, lang)} <X size={12} />
          </button>
        ))}
        <button type="button" className="btn btn-sm" onClick={() => setPaletteOpen((o) => !o)}>
          <Plus size={13} />  {tl("Couleurs")}</button>
      </div>
      {paletteOpen && (
        <div className="variant-palette">
          {COLORS.filter((c) => !colors.includes(c.code)).map((c) => (
            <button key={c.code} type="button" className="color-chip" onClick={() => toggleColor(c.code)}>
              <span className="swatch" style={swatchStyle(c.code)} /> {c[lang]}
            </button>
          ))}
        </div>
      )}

      {axis && (
        <>
          <div className="variant-chips">
            <span className="muted small">{axisName(axis, lang)} :</span>
            {sizes.map((s) => (
              <button key={s} type="button" className="size-chip on" onClick={() => toggleSize(s)} title={tl("Retirer")}>
                {s} <X size={12} />
              </button>
            ))}
            <span className="input-group size-add">
              <input
                value={sizeText}
                maxLength={40}
                onChange={(e) => setSizeText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addSize();
                  }
                }}
                placeholder={tl("Autre…")}
              />
              <button type="button" className="btn btn-sm" onClick={addSize} title={tl("Ajouter")}><Plus size={13} /></button>
            </span>
          </div>
          {presets.length > 0 && (
            <div className="variant-chips">
              {presets.map((p) => (
                <button key={p} type="button" className="size-chip" onClick={() => toggleSize(p)}>{p}</button>
              ))}
            </div>
          )}
        </>
      )}

      {colors.length > 0 && photos.length > 0 && (
        <div className="variant-photos">
          <span className="muted small">{tl("Photo de chaque couleur (sur Sugu Eden) :")}</span>
          {colors.map((c) => {
            const current = rows.find((r) => r.color === c)?.photo_id ?? null;
            return (
              <label key={c} className="variant-photo">
                <span className="swatch" style={swatchStyle(c)} />
                {current && <img src={mediaUrl(current, 96) ?? ""} alt="" />}
                <select value={current ?? ""} onChange={(e) => setColorPhoto(c, e.target.value ? Number(e.target.value) : null)}>
                  <option value="">{colorName(c, lang)} : {tl("aucune")}</option>
                  {photos.map((id) => <option key={id} value={id}>{colorName(c, lang)} : {photoName(id)}</option>)}
                </select>
              </label>
            );
          })}
        </div>
      )}

      {rows.length > 120 && <p className="text-danger small">{tl("120 couleurs ou tailles au plus par produit.")}</p>}
      {rows.length > 0 && (
        <table className="table compact variants-table">
          <thead>
            <tr>
              <th>{tl("Couleur, taille")}</th>
              {track && <th className="num">{tl("Stock ({0})", [unit])}</th>}
              <th className="num">{tl("Prix ({0})", [currencySymbol()])}</th>
              <th>{tl("Code-barres")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={`${r.color ?? ""}|${r.size ?? ""}`}>
                <td>
                  {r.color && <span className="swatch" style={swatchStyle(r.color)} />} {variantLabel(r, lang)}
                </td>
                {track && (
                  <td className="num">
                    <input inputMode="decimal" className="num" style={{ width: 70 }} value={r.stock} onChange={(e) => setRow(i, { stock: e.target.value })} />
                  </td>
                )}
                <td className="num">
                  <input inputMode="decimal" className="num" style={{ width: 95 }} value={r.price} placeholder={minorToInput(price)} onChange={(e) => setRow(i, { price: e.target.value })} />
                </td>
                <td>
                  <div className="input-group">
                    <input className="mono" value={r.barcode} placeholder={tl("Aucun")} onChange={(e) => setRow(i, { barcode: e.target.value })} />
                    <button type="button" className="btn btn-sm" title={tl("Générer")} onClick={() => api.generateBarcode().then((c) => setRow(i, { barcode: c })).catch(toast.error)}>
                      <Wand2 size={13} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
          {track && (
            <tfoot>
              <tr>
                <td>{tl("Total")}</td>
                <td className="num"><strong>{qty(total)} {unit}</strong></td>
                <td colSpan={2} className="muted small">{tl("Le stock du produit devient ce total. Prix vide : {0}.", [money(price)])}</td>
              </tr>
            </tfoot>
          )}
        </table>
      )}
    </div>
  );
}

/** Caisse : quelle couleur, quelle taille ? Les déclinaisons épuisées sont grisées. */
export function VariantChoice({
  product,
  allowNegative,
  inCart,
  onPick,
  onClose,
}: {
  product: Product;
  allowNegative: boolean;
  /** Unités déjà au panier pour cette déclinaison. */
  inCart: (variantId: number) => number;
  onPick: (v: Variant) => void;
  onClose: () => void;
}) {
  const lang = getLang();
  const groups: { color: string | null; items: Variant[] }[] = [];
  for (const v of sellable(product)) {
    let g = groups.find((x) => x.color === v.color);
    if (!g) groups.push((g = { color: v.color, items: [] }));
    g.items.push(v);
  }
  return (
    <Modal title={<>{tl("Quelle couleur, quelle taille ?")} <HelpTip k="variants" /></>} onClose={onClose} width={560}>
      <p className="variant-choice-name"><strong>{product.name}</strong></p>
      <div className="variant-choice">
        {groups.map((g) => (
          <div key={g.color ?? "-"} className="variant-choice-row">
            {g.color && (
              <span className="variant-choice-color">
                <span className="swatch big" style={swatchStyle(g.color)} /> {colorName(g.color, lang)}
              </span>
            )}
            <div className="variant-choice-sizes">
              {g.items.map((v) => {
                const left = v.stock - inCart(v.id);
                const out = product.track_stock && !allowNegative && left <= 0;
                return (
                  <button key={v.id} type="button" className="btn variant-choice-btn" disabled={out} onClick={() => onPick(v)}>
                    <strong>{v.size ?? colorName(v.color, lang)}</strong>
                    {product.track_stock && <span className={`small ${left <= 0 ? "text-danger" : "muted"}`}>{qty(Math.max(left, 0))} {product.unit}</span>}
                    {v.price !== null && v.price !== product.sale_price && <span className="small">{money(v.price)}</span>}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </Modal>
  );
}
