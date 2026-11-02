import { useCallback, useEffect, useState } from "react";
import { Plus, Trash2, Eye, Truck } from "lucide-react";
import { api } from "../api";
import { useApp } from "../context/AppContext";
import { HelpTip } from "../components/Help";
import { Empty, Field, Modal, PageHeader } from "../components/ui";
import { ProductPicker } from "../components/ProductPicker";
import { addDays, currencySymbol, dateTime, isoDate, minorToInput, money, parseNumber, qty, toMinor } from "../lib/format";
import type { Product, Purchase, Supplier } from "../types";
import { tl } from "../lib/i18n";

export default function PurchasesPage() {
  const { toast } = useApp();
  const [list, setList] = useState<Purchase[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [from, setFrom] = useState(isoDate(addDays(new Date(), -90)));
  const [to, setTo] = useState(isoDate());
  const [supplierId, setSupplierId] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [viewing, setViewing] = useState<Purchase | null>(null);

  const load = useCallback(() => {
    api.listPurchases({ from, to, supplier_id: supplierId ?? undefined }).then(setList).catch(toast.error);
  }, [from, to, supplierId, toast]);
  useEffect(load, [load]);
  useEffect(() => {
    api.listSuppliers().then(setSuppliers).catch(toast.error);
  }, [toast]);

  const total = list.reduce((s, p) => s + p.total, 0);

  return (
    <div className="page">
      <PageHeader
        help="purchases"
        title={tl("Achats / réceptions")}
        subtitle={tl("Enregistrez les livraisons fournisseurs : le stock et les coûts d'achat sont mis à jour automatiquement.")}
        actions={<button className="btn btn-primary" onClick={() => setCreating(true)}><Plus size={16} />  {tl("Nouvelle réception")}</button>}
      />
      <div className="toolbar">
        <label className="inline">{tl("Du")} <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="inline">au <input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        <select value={supplierId ?? ""} onChange={(e) => setSupplierId(e.target.value ? Number(e.target.value) : null)}>
          <option value="">{tl("Tous les fournisseurs")}</option>
          {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <div className="spacer" />
        <span className="muted">{tl("Total de la période :")} <strong>{money(total)}</strong></span>
      </div>
      <div className="card no-pad">
        {list.length === 0 ? (
          <Empty title={tl("Aucune réception sur la période")} />
        ) : (
          <table className="table">
            <thead><tr><th>{tl("N°")}</th><th>{tl("Date")}</th><th>{tl("Fournisseur")}</th><th className="num">{tl("Lignes")}</th><th className="num">{tl("Montant")}</th><th>{tl("Saisi par")}</th><th></th></tr></thead>
            <tbody>
              {list.map((p) => (
                <tr key={p.id} onDoubleClick={() => api.getPurchase(p.id).then(setViewing)}>
                  <td><strong>{p.number}</strong></td>
                  <td>{dateTime(p.created_at)}</td>
                  <td>{p.supplier_name ?? <span className="muted">—</span>}</td>
                  <td className="num">{p.items_count}</td>
                  <td className="num"><strong>{money(p.total)}</strong></td>
                  <td>{p.user_name}</td>
                  <td className="actions"><button className="icon-btn" onClick={() => api.getPurchase(p.id).then(setViewing).catch(toast.error)}><Eye size={16} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {creating && <PurchaseForm suppliers={suppliers} onClose={() => setCreating(false)} onSaved={() => { setCreating(false); load(); }} />}
      {viewing && (
        <Modal title={tl("Réception {0}", [viewing.number])} onClose={() => setViewing(null)} width={680}>
          <div className="kv"><span>{tl("Date")}</span><span>{dateTime(viewing.created_at)}</span></div>
          <div className="kv"><span>{tl("Fournisseur")}</span><span>{viewing.supplier_name ?? "—"}</span></div>
          <div className="kv"><span>{tl("Saisi par")}</span><span>{viewing.user_name}</span></div>
          {viewing.note && <div className="kv"><span>{tl("Note")}</span><span>{viewing.note}</span></div>}
          <table className="table compact" style={{ marginTop: 12 }}>
            <thead><tr><th>{tl("Produit")}</th><th className="num">{tl("Quantité")}</th><th className="num">{tl("Coût unitaire")}</th><th>{tl("Péremption")}</th><th className="num">{tl("Total")}</th></tr></thead>
            <tbody>
              {viewing.items.map((i) => (
                <tr key={i.id}><td>{i.product_name}</td><td className="num">{qty(i.quantity)}</td><td className="num">{money(i.unit_cost)}</td><td>{i.expiry_date ? i.expiry_date.split("-").reverse().join("/") : "—"}</td><td className="num">{money(i.total)}</td></tr>
              ))}
            </tbody>
            <tfoot><tr><td colSpan={4}>{tl("Total")}</td><td className="num"><strong>{money(viewing.total)}</strong></td></tr></tfoot>
          </table>
        </Modal>
      )}
    </div>
  );
}

interface Line {
  product: Product;
  quantity: string;
  cost: string;
  price: string;
  expiry: string;
}

function PurchaseForm({ suppliers, onClose, onSaved }: { suppliers: Supplier[]; onClose: () => void; onSaved: () => void }) {
  const { toast, confirm } = useApp();
  const [supplierId, setSupplierId] = useState<number | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [note, setNote] = useState("");
  const [updateCosts, setUpdateCosts] = useState(true);
  const [busy, setBusy] = useState(false);

  const add = (p: Product) => {
    if (lines.some((l) => l.product.id === p.id)) return toast.info(tl("Ce produit est déjà dans la liste."));
    setLines((ls) => [...ls, { product: p, quantity: "1", cost: minorToInput(p.purchase_price), price: minorToInput(p.sale_price), expiry: "" }]);
  };
  const update = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const lineTotal = (l: Line) => Math.round((parseNumber(l.quantity) || 0) * toMinor(l.cost || "0"));
  const total = lines.reduce((s, l) => s + lineTotal(l), 0);

  const submit = async () => {
    if (!(await confirm({ title: tl("Valider la réception"), message: tl("Le stock de {0} produit(s) sera augmenté. Montant : {1}.", [lines.length, money(total)]), confirmLabel: tl("Valider") }))) return;
    setBusy(true);
    try {
      await api.createPurchase({
        supplier_id: supplierId,
        items: lines.map((l) => ({ product_id: l.product.id, quantity: parseNumber(l.quantity), unit_cost: toMinor(l.cost || "0"), expiry_date: l.expiry || null })),
        note: note.trim() || null,
        update_costs: updateCosts,
        new_sale_prices: lines.filter((l) => toMinor(l.price || "0") !== l.product.sale_price).map((l) => [l.product.id, toMinor(l.price || "0")] as [number, number]),
      });
      toast.success(tl("Réception enregistrée, stock mis à jour."));
      onSaved();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={<><Truck size={18} />  {tl("Nouvelle réception de marchandises")}</>}
      onClose={onClose}
      width={940}
      footer={
        <>
          <span className="muted" style={{ marginRight: "auto" }}>{tl("Total :")} <strong>{money(total)}</strong></span>
          <button className="btn" onClick={onClose}>{tl("Annuler")}</button>
          <button className="btn btn-primary" disabled={busy || lines.length === 0} onClick={submit}>{tl("Valider la réception")}</button>
        </>
      }
    >
      <div className="form-grid">
        <Field label={tl("Fournisseur")}>
          <select value={supplierId ?? ""} onChange={(e) => setSupplierId(e.target.value ? Number(e.target.value) : null)}>
            <option value="">{tl("— Non précisé —")}</option>
            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </Field>
        <Field label={tl("Référence / note (n° de bon de livraison, facture…)")}>
          <input value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
      <div style={{ margin: "14px 0" }}>
        <ProductPicker onPick={add} placeholder={tl("Ajouter un produit (recherche ou douchette)…")} autoFocus />
      </div>
      {lines.length === 0 ? (
        <Empty title={tl("Aucun produit")}>{tl("Recherchez ou scannez les produits reçus.")}</Empty>
      ) : (
        <table className="table compact">
          <thead>
            <tr><th>{tl("Produit")}</th><th className="num">{tl("Stock actuel")}</th><th style={{ width: 110 }}>{tl("Quantité reçue")}</th><th style={{ width: 130 }}>{tl("Coût unitaire (")}{currencySymbol()})</th><th style={{ width: 130 }}>{tl("Prix de vente (")}{currencySymbol()})</th><th style={{ width: 140 }}>{tl("Péremption")}</th><th className="num">{tl("Total")}</th><th></th></tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={l.product.id}>
                <td><strong>{l.product.name}</strong></td>
                <td className="num">{qty(l.product.stock)} {l.product.unit}</td>
                <td><input inputMode="decimal" value={l.quantity} onChange={(e) => update(i, { quantity: e.target.value })} /></td>
                <td><input inputMode="decimal" value={l.cost} onChange={(e) => update(i, { cost: e.target.value })} /></td>
                <td><input inputMode="decimal" value={l.price} onChange={(e) => update(i, { price: e.target.value })} /></td>
                <td><input type="date" value={l.expiry} onChange={(e) => update(i, { expiry: e.target.value })} /></td>
                <td className="num">{money(lineTotal(l))}</td>
                <td><button className="icon-btn danger" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}><Trash2 size={15} /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <label className="check" style={{ marginTop: 12 }}>
        <input type="checkbox" checked={updateCosts} onChange={(e) => setUpdateCosts(e.target.checked)} />
        {tl("Mettre à jour le prix d'achat des produits (coût moyen unitaire pondéré — CMUP)")} <HelpTip k="cmup" />
      </label>
    </Modal>
  );
}
