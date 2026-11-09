import { useCallback, useEffect, useState } from "react";
import { Search, Eye, Download } from "lucide-react";
import { api } from "../api";
import { useApp } from "../context/AppContext";
import { Badge, Empty, PageHeader, useShowMore } from "../components/ui";
import { SaleDetailModal } from "../components/SaleDetail";
import { exportCsv } from "../lib/files";
import { csvMoney, dateTime, isoDate, money, paymentLabel, paymentMethods, qty, toCsv } from "../lib/format";
import type { Sale } from "../types";
import { tl } from "../lib/i18n";

export default function SalesPage() {
  const { toast, isAdmin: isManager } = useApp();
  const [list, setList] = useState<Sale[]>([]);
  const [from, setFrom] = useState(isoDate());
  const [to, setTo] = useState(isoDate());
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [method, setMethod] = useState("");
  const [viewing, setViewing] = useState<Sale | null>(null);
  const shown = useShowMore(list, `${from}|${to}|${search}|${status}|${method}`);

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
      [tl("N°"), tl("Date"), tl("Client"), tl("Caissier"), tl("Paiement"), tl("Sous-total"), tl("Remise"), tl("Total"), "TVA", tl("À crédit"), tl("Statut")],
      list.map((s) => [s.number, s.created_at, s.customer_name, s.user_name, paymentLabel(s.payment_method), csvMoney(s.subtotal), csvMoney(s.discount), csvMoney(s.total), csvMoney(s.tax_total), csvMoney(s.credit_amount), s.status === "completed" ? tl("Validée") : tl("Annulée")]),
    );
    try {
      if (await exportCsv(`ventes-${from}-au-${to}.csv`, csv)) toast.success(tl("Export terminé."));
    } catch (e) {
      toast.error(e);
    }
  };

  return (
    <div className="page">
      <PageHeader
        help="sales"
        title={tl("Historique des ventes")}
        subtitle={isManager ? tl("Toutes les ventes de la boutique") : tl("Vos ventes")}
        actions={isManager && <button className="btn" onClick={doExport}><Download size={16} />  {tl("Exporter")}</button>}
      />
      <div className="toolbar">
        <label className="inline">{tl("Du")} <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="inline">au <input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        <div className="search-box"><Search size={16} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={tl("N° de ticket ou client…")} /></div>
        <select value={method} onChange={(e) => setMethod(e.target.value)}>
          <option value="">{tl("Tous les paiements")}</option>
          {paymentMethods().map((k) => <option key={k} value={k}>{paymentLabel(k)}</option>)}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">{tl("Tous les statuts")}</option>
          <option value="completed">{tl("Validées")}</option>
          <option value="cancelled">{tl("Annulées")}</option>
        </select>
      </div>
      <div className="summary-bar">
        <span><strong>{completed.length}</strong>  {tl("vente(s) validée(s)")}</span>
        <span>{tl("Total :")} <strong>{money(total)}</strong></span>
        {completed.length > 0 && <span>{tl("Panier moyen :")} <strong>{money(Math.round(total / completed.length))}</strong></span>}
        {list.length !== completed.length && <span className="text-danger">{list.length - completed.length}  {tl("annulée(s)")}</span>}
      </div>
      <div className="card no-pad">
        {list.length === 0 ? (
          <Empty title={tl("Aucune vente sur la période")} />
        ) : (
          <table className="table">
            <thead><tr><th>{tl("N° ticket")}</th><th>{tl("Date")}</th><th>{tl("Client")}</th><th>{tl("Caissier")}</th><th className="num">{tl("Articles")}</th><th>{tl("Paiement")}</th><th className="num">{tl("Total")}</th><th></th></tr></thead>
            <tbody>
              {shown.visible.map((s) => (
                <tr key={s.id} className={s.status === "cancelled" ? "row-cancelled" : ""} onDoubleClick={() => open(s)}>
                  <td><strong>{s.number}</strong> {s.status === "cancelled" && <Badge tone="danger">{tl("Annulée")}</Badge>}</td>
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
        {shown.more}
      </div>
      {viewing && <SaleDetailModal sale={viewing} onClose={() => setViewing(null)} onChanged={load} />}
    </div>
  );
}
