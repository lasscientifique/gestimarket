import { useCallback, useEffect, useState } from "react";
import { SlidersHorizontal, Download, Boxes, AlertTriangle, PackageX, Coins } from "lucide-react";
import { api } from "../api";
import { useApp } from "../context/AppContext";
import { Badge, Empty, Field, LocationBadge, Modal, PageHeader, StatCard, Thumb } from "../components/ui";
import { ProductPicker } from "../components/ProductPicker";
import { exportCsv } from "../lib/files";
import { addDays, dateOnly, dateTime, daysUntil, isoDate, money, MOVEMENT_LABELS, parseNumber, qty, toCsv } from "../lib/format";
import type { Product, StockMovement, StockSummary } from "../types";

export default function StockPage() {
  const { toast, settings } = useApp();
  const [tab, setTab] = useState<"alerts" | "expiry" | "movements">("alerts");
  const [expiring, setExpiring] = useState<Product[]>([]);
  const alertDays = Number(settings.expiry_alert_days || 30);
  const [summary, setSummary] = useState<StockSummary | null>(null);
  const [alerts, setAlerts] = useState<Product[]>([]);
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [kind, setKind] = useState("");
  const [from, setFrom] = useState(isoDate(addDays(new Date(), -30)));
  const [to, setTo] = useState(isoDate());
  const [adjust, setAdjust] = useState<Product | "pick" | null>(null);

  const load = useCallback(() => {
    api.stockSummary().then(setSummary).catch(toast.error);
    api.listProducts({ low_stock: true, limit: 2000 }).then(setAlerts).catch(toast.error);
    api.listProducts({ expiring_days: alertDays, limit: 2000 }).then(setExpiring).catch(toast.error);
    api.listStockMovements({ kind: kind || undefined, from, to, limit: 2000 }).then(setMovements).catch(toast.error);
  }, [kind, from, to, toast, alertDays]);

  useEffect(load, [load]);

  const exportMovements = async () => {
    const csv = toCsv(
      ["Date", "Produit", "Type", "Quantité", "Stock après", "Référence", "Note", "Utilisateur"],
      movements.map((m) => [m.created_at, m.product_name, MOVEMENT_LABELS[m.kind] ?? m.kind, String(m.quantity).replace(".", ","), String(m.stock_after).replace(".", ","), m.reference, m.note, m.user_name]),
    );
    try {
      if (await exportCsv(`mouvements-stock-${from}-au-${to}.csv`, csv)) toast.success("Export terminé.");
    } catch (e) {
      toast.error(e);
    }
  };

  return (
    <div className="page">
      <PageHeader
        help="stock"
        title="Stock & inventaire"
        subtitle="Suivez les niveaux de stock, les alertes et l'historique des mouvements."
        actions={
          <button className="btn btn-primary" onClick={() => setAdjust("pick")}>
            <SlidersHorizontal size={16} /> Ajuster / inventorier
          </button>
        }
      />

      {summary && (
        <div className="stats">
          <StatCard label="Produits actifs" value={summary.product_count} icon={<Boxes size={18} />} />
          <StatCard label="Valeur au prix d'achat" value={money(summary.value_cost)} icon={<Coins size={18} />} tone="accent" />
          <StatCard label="Valeur au prix de vente" value={money(summary.value_sale)} icon={<Coins size={18} />} hint={`Marge potentielle : ${money(summary.value_sale - summary.value_cost)}`} />
          <StatCard label="Sous le seuil" value={summary.low_stock_count} icon={<AlertTriangle size={18} />} tone={summary.low_stock_count ? "warning" : "default"} />
          <StatCard label="En rupture" value={summary.out_of_stock_count} icon={<PackageX size={18} />} tone={summary.out_of_stock_count ? "danger" : "default"} />
        </div>
      )}

      <div className="tabs">
        <button className={tab === "alerts" ? "active" : ""} onClick={() => setTab("alerts")}>Alertes de stock ({alerts.length})</button>
        <button className={tab === "expiry" ? "active" : ""} onClick={() => setTab("expiry")}>Péremption ({expiring.length})</button>
        <button className={tab === "movements" ? "active" : ""} onClick={() => setTab("movements")}>Mouvements de stock</button>
      </div>

      {tab === "alerts" && (
        <div className="card no-pad">
          {alerts.length === 0 ? (
            <Empty title="Aucune alerte">Tous les produits suivis sont au-dessus de leur seuil d'alerte.</Empty>
          ) : (
            <table className="table">
              <thead>
                <tr><th>Produit</th><th>Fournisseur</th><th className="num">Stock</th><th className="num">Seuil</th><th className="num">À commander (≈)</th><th></th></tr>
              </thead>
              <tbody>
                {alerts.map((p) => (
                  <tr key={p.id}>
                    <td><strong>{p.name}</strong><div className="muted small mono">{p.barcode}</div></td>
                    <td>{p.supplier_name ?? <span className="muted">—</span>}</td>
                    <td className="num"><Badge tone={p.stock <= 0 ? "danger" : "warning"}>{qty(p.stock)} {p.unit}</Badge></td>
                    <td className="num">{qty(p.min_stock)}</td>
                    <td className="num">{qty(Math.max(0, p.min_stock * 2 - p.stock))} {p.unit}</td>
                    <td className="actions"><button className="btn btn-sm" onClick={() => setAdjust(p)}>Ajuster</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === "expiry" && (
        <div className="card no-pad">
          {expiring.length === 0 ? (
            <Empty title="Aucun produit à surveiller">Aucun produit en stock ne périme dans les {alertDays} prochains jours.</Empty>
          ) : (
            <table className="table">
              <thead><tr><th>Produit</th><th>Emplacement</th><th className="num">Stock</th><th>Péremption</th><th className="num">Délai</th><th></th></tr></thead>
              <tbody>
                {expiring.map((p) => {
                  const d = daysUntil(p.expiry_date!);
                  return (
                    <tr key={p.id}>
                      <td><div className="cell-product"><Thumb imageId={p.image_id} name={p.name} color={p.category_color} size={34} /> <strong>{p.name}</strong></div></td>
                      <td><LocationBadge p={p} short /></td>
                      <td className="num">{qty(p.stock)} {p.unit}</td>
                      <td>{dateOnly(p.expiry_date)}</td>
                      <td className="num"><Badge tone={d <= 7 ? "danger" : "warning"}>{d < 0 ? `Périmé (${-d} j)` : d === 0 ? "Aujourd'hui" : `${d} jours`}</Badge></td>
                      <td className="actions"><button className="btn btn-sm" onClick={() => setAdjust(p)}>Retirer / perte</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === "movements" && (
        <>
          <div className="toolbar">
            <label className="inline">Du <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
            <label className="inline">au <input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
            <select value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="">Tous les types</option>
              {Object.entries(MOVEMENT_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <div className="spacer" />
            <button className="btn" onClick={exportMovements}><Download size={16} /> Exporter</button>
          </div>
          <div className="card no-pad">
            {movements.length === 0 ? (
              <Empty title="Aucun mouvement sur la période" />
            ) : (
              <table className="table compact">
                <thead>
                  <tr><th>Date</th><th>Produit</th><th>Type</th><th className="num">Quantité</th><th className="num">Stock après</th><th>Référence / note</th><th>Par</th></tr>
                </thead>
                <tbody>
                  {movements.map((m) => (
                    <tr key={m.id}>
                      <td className="nowrap">{dateTime(m.created_at)}</td>
                      <td>{m.product_name}</td>
                      <td><Badge tone={m.quantity >= 0 ? "success" : m.kind === "loss" ? "danger" : "default"}>{MOVEMENT_LABELS[m.kind] ?? m.kind}</Badge></td>
                      <td className={`num ${m.quantity >= 0 ? "text-success" : "text-danger"}`}>{m.quantity > 0 ? "+" : ""}{qty(m.quantity)} {m.unit}</td>
                      <td className="num">{qty(m.stock_after)}</td>
                      <td className="small">{[m.reference, m.note].filter(Boolean).join(" — ") || <span className="muted">—</span>}</td>
                      <td className="small">{m.user_name}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      {adjust && (
        <AdjustModal
          product={adjust === "pick" ? null : adjust}
          onClose={() => setAdjust(null)}
          onDone={() => {
            setAdjust(null);
            load();
          }}
        />
      )}
    </div>
  );
}

const KINDS = [
  { id: "adjustment", label: "Inventaire / correction", modes: ["set", "add", "remove"] as const },
  { id: "loss", label: "Perte, casse, péremption, vol", modes: ["remove"] as const },
  { id: "return", label: "Retour client (remise en stock)", modes: ["add"] as const },
];

function AdjustModal({ product: initial, onClose, onDone }: { product: Product | null; onClose: () => void; onDone: () => void }) {
  const { toast, askPin } = useApp();
  const [product, setProduct] = useState<Product | null>(initial);
  const [kind, setKind] = useState("adjustment");
  const [mode, setMode] = useState<"set" | "add" | "remove">("set");
  const [quantity, setQuantity] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const modes = KINDS.find((k) => k.id === kind)!.modes;
  useEffect(() => {
    if (!(modes as readonly string[]).includes(mode)) setMode(modes[0]);
  }, [kind, mode, modes]);

  const q = parseNumber(quantity);
  const newStock = product && Number.isFinite(q) ? (mode === "set" ? q : mode === "add" ? product.stock + q : product.stock - q) : null;

  const submit = async () => {
    if (!product) return;
    setBusy(true);
    try {
      const pin = await askPin({ title: "Ajustement de stock", level: "manager", message: <>{product.name} : nouveau stock <strong>{qty(newStock ?? 0)} {product.unit}</strong>. Confirmez avec votre code PIN.</> });
      if (!pin) return;
      await api.adjustStock({ product_id: product.id, mode, quantity: q, kind, note: note.trim() || null }, pin);
      toast.success("Stock mis à jour.");
      onDone();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Ajustement de stock"
      onClose={onClose}
      width={520}
      footer={
        <>
          <button className="btn" onClick={onClose}>Annuler</button>
          <button className="btn btn-primary" disabled={busy || !product || !Number.isFinite(q)} onClick={submit}>Valider</button>
        </>
      }
    >
      <div className="form-grid one">
        {product ? (
          <div className="selected-product">
            <div>
              <strong>{product.name}</strong>
              <div className="muted small">Stock actuel : {qty(product.stock)} {product.unit}</div>
            </div>
            {!initial && <button className="btn btn-sm" onClick={() => setProduct(null)}>Changer</button>}
          </div>
        ) : (
          <ProductPicker onPick={setProduct} autoFocus />
        )}
        <Field label="Type de mouvement">
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            {KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
          </select>
        </Field>
        {modes.length > 1 && (
          <div className="segmented">
            <button className={mode === "set" ? "active" : ""} onClick={() => setMode("set")}>Quantité comptée</button>
            <button className={mode === "add" ? "active" : ""} onClick={() => setMode("add")}>Ajouter</button>
            <button className={mode === "remove" ? "active" : ""} onClick={() => setMode("remove")}>Retirer</button>
          </div>
        )}
        <Field label={mode === "set" ? "Quantité réellement comptée" : mode === "add" ? "Quantité à ajouter" : "Quantité à retirer"}>
          <input className="input-lg" inputMode="decimal" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
        </Field>
        {newStock !== null && product && (
          <div className="alert alert-info">
            Nouveau stock : <strong>{qty(newStock)} {product.unit}</strong> (écart {newStock - product.stock >= 0 ? "+" : ""}{qty(newStock - product.stock)})
          </div>
        )}
        <Field label="Motif / observation">
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ex. inventaire mensuel, produit périmé…" />
        </Field>
      </div>
    </Modal>
  );
}
