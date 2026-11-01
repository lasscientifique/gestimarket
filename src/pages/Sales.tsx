import { useCallback, useEffect, useState } from "react";
import { Search, Eye, Download } from "lucide-react";
import { api } from "../api";
import { useApp } from "../context/AppContext";
import { Badge, Empty, PageHeader } from "../components/ui";
import { SaleDetailModal } from "../components/SaleDetail";
import { exportCsv } from "../lib/files";
import { csvMoney, dateTime, isoDate, money, PAYMENT_LABELS, paymentLabel, qty, toCsv } from "../lib/format";
import type { Sale } from "../types";

export default function SalesPage() {
  const { toast, isAdmin: isManager } = useApp();
  const [list, setList] = useState<Sale[]>([]);
  const [from, setFrom] = useState(isoDate());
  const [to, setTo] = useState(isoDate());
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [method, setMethod] = useState("");
  const [viewing, setViewing] = useState<Sale | null>(null);

  const load = useCallback(() => {
    api.listSales({ from, to, search, status: status || undefined, payment_method: method || undefined, limit: 5000 }).then(setList).catch(toast.error);
  }, [from, to, search, status, method, toast]);
  useEffect(() => {
    const t = setTimeout(load, 150);
    return () => clearTimeout(t);
  }, [load]);

  const completed = list.filter((s) => s.status === "completed");
  const total = completed.reduce((s, x) => s + x.total, 0);

  const open = (s: Sale) => api.getSale(s.id).then(setViewing).catch(toast.error);

  const doExport = async () => {
    const csv = toCsv(
      ["N°", "Date", "Client", "Caissier", "Paiement", "Sous-total", "Remise", "Total", "TVA", "À crédit", "Statut"],
      list.map((s) => [s.number, s.created_at, s.customer_name, s.user_name, paymentLabel(s.payment_method), csvMoney(s.subtotal), csvMoney(s.discount), csvMoney(s.total), csvMoney(s.tax_total), csvMoney(s.credit_amount), s.status === "completed" ? "Validée" : "Annulée"]),
    );
    try {
      if (await exportCsv(`ventes-${from}-au-${to}.csv`, csv)) toast.success("Export terminé.");
    } catch (e) {
      toast.error(e);
    }
  };

  return (
    <div className="page">
      <PageHeader
        help="sales"
        title="Historique des ventes"
        subtitle={isManager ? "Toutes les ventes de la boutique" : "Vos ventes"}
        actions={isManager && <button className="btn" onClick={doExport}><Download size={16} /> Exporter</button>}
      />
      <div className="toolbar">
        <label className="inline">Du <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="inline">au <input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        <div className="search-box"><Search size={16} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="N° de ticket ou client…" /></div>
        <select value={method} onChange={(e) => setMethod(e.target.value)}>
          <option value="">Tous les paiements</option>
          {Object.entries(PAYMENT_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Tous les statuts</option>
          <option value="completed">Validées</option>
          <option value="cancelled">Annulées</option>
        </select>
      </div>
      <div className="summary-bar">
        <span><strong>{completed.length}</strong> vente(s) validée(s)</span>
        <span>Total : <strong>{money(total)}</strong></span>
        {completed.length > 0 && <span>Panier moyen : <strong>{money(Math.round(total / completed.length))}</strong></span>}
        {list.length !== completed.length && <span className="text-danger">{list.length - completed.length} annulée(s)</span>}
      </div>
      <div className="card no-pad">
        {list.length === 0 ? (
          <Empty title="Aucune vente sur la période" />
        ) : (
          <table className="table">
            <thead><tr><th>N° ticket</th><th>Date</th><th>Client</th><th>Caissier</th><th className="num">Articles</th><th>Paiement</th><th className="num">Total</th><th></th></tr></thead>
            <tbody>
              {list.map((s) => (
                <tr key={s.id} className={s.status === "cancelled" ? "row-cancelled" : ""} onDoubleClick={() => open(s)}>
                  <td><strong>{s.number}</strong> {s.status === "cancelled" && <Badge tone="danger">Annulée</Badge>}</td>
                  <td className="nowrap">{dateTime(s.created_at)}</td>
                  <td>{s.customer_name ?? <span className="muted">—</span>}</td>
                  <td>{s.user_name}</td>
                  <td className="num">{qty(s.items_count)}</td>
                  <td>
                    <Badge tone={s.payment_method === "credit" || s.credit_amount > 0 ? "warning" : "default"}>{paymentLabel(s.payment_method)}</Badge>
                  </td>
                  <td className="num"><strong>{money(s.total)}</strong></td>
                  <td className="actions"><button className="icon-btn" onClick={() => open(s)}><Eye size={16} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {viewing && <SaleDetailModal sale={viewing} onClose={() => setViewing(null)} onChanged={load} />}
    </div>
  );
}
