import { useCallback, useEffect, useState } from "react";
import { BadgePercent, Plus, Pencil, Trash2 } from "lucide-react";
import { api } from "../api";
import { useApp } from "../context/AppContext";
import { Badge, Empty, Field, Modal, PageHeader } from "../components/ui";
import { CategorySelect } from "../components/CategorySelect";
import { ProductPicker } from "../components/ProductPicker";
import { currencySymbol, isoDate, minorToInput, money, toMinor } from "../lib/format";
import type { Category, Product, Promotion } from "../types";
import { tl } from "../lib/i18n";

const STATE: Record<Promotion["state"], { label: string; tone: "success" | "info" | "default" | "warning" }> = {
  current: { label: tl("En cours"), tone: "success" },
  upcoming: { label: tl("À venir"), tone: "info" },
  ended: { label: tl("Terminée"), tone: "default" },
  off: { label: tl("Désactivée"), tone: "warning" },
};

const shortDate = (d: string) => d.split("-").reverse().join("/");

/** Promotions datées : remise en % (article ou catégorie) ou prix promo (article), appliquées seules en caisse. */
export default function PromotionsPage() {
  const { toast } = useApp();
  const [list, setList] = useState<Promotion[]>([]);
  const [editing, setEditing] = useState<Promotion | "new" | null>(null);

  const load = useCallback(() => {
    api.listPromotions().then(setList).catch(toast.error);
  }, [toast]);
  useEffect(load, [load]);

  const remove = async (p: Promotion) => {
    if (!confirm(tl("Supprimer la promotion « {0} » ?", [p.name]))) return;
    try {
      await api.deletePromotion(p.id);
      load();
    } catch (e) {
      toast.error(e);
    }
  };

  return (
    <div className="page">
      <PageHeader
        help="promotions"
        title={tl("Promotions")}
        subtitle={tl("Remise en pourcentage ou prix promo, du premier au dernier jour : la caisse l'applique toute seule et le ticket montre l'économie.")}
        actions={<button className="btn btn-primary" onClick={() => setEditing("new")}><Plus size={16} />  {tl("Nouvelle promotion")}</button>}
      />
      <div className="card no-pad">
        {list.length === 0 ? (
          <Empty title={tl("Aucune promotion")}>{tl("Créez une promotion sur un article (prix promo ou %) ou sur toute une catégorie (%).")}</Empty>
        ) : (
          <table className="table">
            <thead><tr><th>{tl("Promotion")}</th><th>{tl("Sur")}</th><th className="num">{tl("Remise")}</th><th>{tl("Période")}</th><th>{tl("État")}</th><th></th></tr></thead>
            <tbody>
              {list.map((p) => (
                <tr key={p.id} onDoubleClick={() => setEditing(p)}>
                  <td><strong>{p.name}</strong></td>
                  <td>{p.product_name ?? <>{tl("Catégorie")} « {p.category_name} »</>}</td>
                  <td className="num">
                    {p.kind === "percent" ? `-${p.value} %` : <>{money(p.value)}{p.regular_price ? <div className="muted small"><s>{money(p.regular_price)}</s></div> : null}</>}
                  </td>
                  <td className="nowrap">{tl("du {0} au {1}", [shortDate(p.starts_on), shortDate(p.ends_on)])}</td>
                  <td><Badge tone={STATE[p.state].tone}>{STATE[p.state].label}</Badge></td>
                  <td className="actions">
                    <button className="icon-btn" onClick={() => setEditing(p)} aria-label={tl("Modifier")}><Pencil size={16} /></button>
                    <button className="icon-btn danger" onClick={() => remove(p)} aria-label={tl("Supprimer")}><Trash2 size={16} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {editing && (
        <PromotionForm
          promotion={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
        />
      )}
    </div>
  );
}

function PromotionForm({ promotion, onClose, onSaved }: { promotion: Promotion | null; onClose: () => void; onSaved: () => void }) {
  const { toast } = useApp();
  const [name, setName] = useState(promotion?.name ?? "");
  const [target, setTarget] = useState<"product" | "category">(promotion?.category_id ? "category" : "product");
  const [product, setProduct] = useState<{ id: number; name: string; sale_price: number } | null>(
    promotion?.product_id ? { id: promotion.product_id, name: promotion.product_name ?? "", sale_price: promotion.regular_price ?? 0 } : null,
  );
  const [categoryId, setCategoryId] = useState<number | null>(promotion?.category_id ?? null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [kind, setKind] = useState<"percent" | "price">(promotion?.kind ?? "percent");
  const [value, setValue] = useState(promotion ? (promotion.kind === "percent" ? String(promotion.value) : minorToInput(promotion.value)) : "");
  const [from, setFrom] = useState(promotion?.starts_on ?? isoDate());
  const [to, setTo] = useState(promotion?.ends_on ?? isoDate());
  const [active, setActive] = useState(promotion?.active ?? true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.listCategories().then(setCategories).catch(() => undefined);
  }, []);
  const asPrice = target === "product" && kind === "price";

  const submit = async () => {
    setBusy(true);
    try {
      await api.savePromotion({
        id: promotion?.id ?? null,
        name: name.trim(),
        kind: asPrice ? "price" : "percent",
        value: asPrice ? toMinor(value || "0") : Math.round(Number(value.replace(",", ".")) || 0),
        product_id: target === "product" ? product?.id ?? null : null,
        category_id: target === "category" ? categoryId : null,
        starts_on: from,
        ends_on: to,
        active,
      });
      toast.success(tl("Promotion enregistrée."));
      onSaved();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={<><BadgePercent size={18} />  {promotion ? tl("Modifier la promotion") : tl("Nouvelle promotion")}</>}
      onClose={onClose}
      width={620}
      footer={
        <>
          <button className="btn" onClick={onClose}>{tl("Annuler")}</button>
          <button className="btn btn-primary" disabled={busy || !name.trim() || !value || (target === "product" ? !product : !categoryId)} onClick={submit}>
            {tl("Enregistrer")}</button>
        </>
      }
    >
      <div className="form-grid">
        <Field label={tl("Nom *")} span={2}>
          <input value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder={tl("Ex. Tabaski, rentrée scolaire, déstockage…")} />
        </Field>
        <Field label={tl("Sur")}>
          <div className="segmented">
            <button type="button" className={target === "product" ? "active" : ""} onClick={() => setTarget("product")}>{tl("Un article")}</button>
            <button type="button" className={target === "category" ? "active" : ""} onClick={() => { setTarget("category"); setKind("percent"); }}>{tl("Une catégorie")}</button>
          </div>
        </Field>
        {target === "product" ? (
          <Field label={tl("Article *")} hint={product ? <>{product.name} · {money(product.sale_price)}</> : undefined}>
            <ProductPicker
              placeholder={tl("Rechercher ou scanner l'article…")}
              onPick={(p: Product) => setProduct({ id: p.id, name: p.name, sale_price: p.sale_price })}
            />
          </Field>
        ) : (
          <Field label={tl("Catégorie *")} hint={tl("Sous-catégories comprises")}>
            <CategorySelect categories={categories} value={categoryId} onChange={setCategoryId} />
          </Field>
        )}
        {target === "product" && (
          <Field label={tl("Type")}>
            <div className="segmented">
              <button type="button" className={kind === "percent" ? "active" : ""} onClick={() => setKind("percent")}>{tl("Remise en %")}</button>
              <button type="button" className={kind === "price" ? "active" : ""} onClick={() => setKind("price")}>{tl("Prix promo")}</button>
            </div>
          </Field>
        )}
        <Field label={asPrice ? tl("Prix promo ({0}) *", [currencySymbol()]) : tl("Remise (%) *")}
          hint={asPrice && product ? tl("Prix normal : {0}", [money(product.sale_price)]) : asPrice ? undefined : tl("De 1 à 90 %")}>
          <input inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} />
        </Field>
        <Field label={tl("Premier jour")}><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label={tl("Dernier jour (inclus)")}><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        <label className="check span-2">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          {tl("Active (décochez pour la suspendre sans la supprimer)")}</label>
      </div>
      <p className="muted small">{tl("En caisse, le prix le plus bas l'emporte : prix normal, prix de gros ou promotion.")}</p>
    </Modal>
  );
}
