import { useCallback, useEffect, useState } from "react";
import { Search, Download, Smartphone } from "lucide-react";
import { api } from "../api";
import { useApp } from "../context/AppContext";
import { Badge, Empty, PageHeader, StatCard } from "../components/ui";
import { SaleDetailModal } from "../components/SaleDetail";
import { exportCsv } from "../lib/files";
import { csvMoney, dateTime, isoDate, money, paymentLabel, paymentMethods, toCsv } from "../lib/format";
import type { ElectronicPayment, Sale } from "../types";
import { tl } from "../lib/i18n";

/** Rapprochement des paiements Orange Money / mobile money / carte avec le relevé de l'opérateur. */
export default function PaymentsPage() {
  const { toast } = useApp();
  const [list, setList] = useState<ElectronicPayment[]>([]);
  const [from, setFrom] = useState(isoDate());
  const [to, setTo] = useState(isoDate());
  const [method, setMethod] = useState("orange_money");
  const [search, setSearch] = useState("");
  const [sale, setSale] = useState<Sale | null>(null);

  const load = useCallback(() => {
    api.listElectronicPayments({ from, to, method: method || undefined, search: search || undefined }).then(setList).catch(toast.error);
  }, [from, to, method, search, toast]);
  useEffect(() => {
    const t = setTimeout(load, 150);
    return () => clearTimeout(t);
  }, [load]);

  const total = list.reduce((s, p) => s + p.amount, 0);
  const withoutRef = list.filter((p) => !p.reference).length;

  const doExport = async () => {
    const csv = toCsv(
      ["Date", "Moyen", "Document", "Montant", "ID de transaction", "Téléphone", "Client", "Caissier"],
      list.map((p) => [p.date, paymentLabel(p.method), p.document, csvMoney(p.amount), p.reference, p.phone, p.customer_name, p.user_name]),
    );
    try {
      if (await exportCsv(`paiements-${method || "electroniques"}-${from}-au-${to}.csv`, csv)) toast.success(tl("Export terminé."));
    } catch (e) {
      toast.error(e);
    }
  };

  return (
    <div className="page">
      <PageHeader
        help="payments"
        title={tl("Paiements mobiles")}
        subtitle={tl("Rapprochez les encaissements Orange Money / Sarali, mobile money et carte avec le relevé de votre opérateur.")}
        actions={<button className="btn" onClick={doExport}><Download size={16} />  {tl("Exporter")}</button>}
      />
      <div className="toolbar">
        <label className="inline">{tl("Du")} <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="inline">au <input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        <select value={method} onChange={(e) => setMethod(e.target.value)}>
          <option value="orange_money">{paymentLabel("orange_money")}</option>
          {paymentMethods()
            .filter((m) => m.startsWith("mm:"))
            .map((m) => (
              <option key={m} value={m}>{paymentLabel(m)}</option>
            ))}
          <option value="mobile_money">{paymentLabel("mobile_money")}</option>
          <option value="card">{paymentLabel("card")}</option>
          <option value="">{tl("Tous les paiements électroniques")}</option>
        </select>
        <div className="search-box"><Search size={16} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={tl("ID de transaction, téléphone, n° de ticket…")} /></div>
      </div>
      <div className="stats">
        <StatCard label={tl("Total encaissé")} value={money(total)} icon={<Smartphone size={18} />} tone="accent" hint={tl("{0} transaction(s)", [list.length])} />
        <StatCard label={tl("Sans ID de transaction")} value={withoutRef} tone={withoutRef ? "warning" : "default"} hint={tl("À vérifier sur le relevé")} />
      </div>
      <div className="card no-pad">
        {list.length === 0 ? (
          <Empty title={tl("Aucun paiement sur la période")} />
        ) : (
          <table className="table">
            <thead><tr><th>{tl("Date")}</th><th>{tl("Moyen")}</th><th>{tl("Document")}</th><th>{tl("ID de transaction")}</th><th>{tl("Téléphone")}</th><th>{tl("Client")}</th><th>{tl("Caissier")}</th><th className="num">{tl("Montant")}</th></tr></thead>
            <tbody>
              {list.map((p, i) => (
                <tr key={i} onDoubleClick={() => p.sale_id && api.getSale(p.sale_id).then(setSale)}>
                  <td className="nowrap">{dateTime(p.date)}</td>
                  <td><Badge tone={p.method === "orange_money" ? "om" : "info"}>{paymentLabel(p.method)}</Badge></td>
                  <td>
                    {p.sale_id ? (
                      <button className="link-btn" onClick={() => api.getSale(p.sale_id!).then(setSale).catch(toast.error)}>{p.document}</button>
                    ) : (
                      p.document
                    )}
                  </td>
                  <td className="mono">{p.reference ?? <span className="text-danger small">manquant</span>}</td>
                  <td>{p.phone ?? <span className="muted">—</span>}</td>
                  <td>{p.customer_name ?? <span className="muted">—</span>}</td>
                  <td>{p.user_name}</td>
                  <td className="num"><strong>{money(p.amount)}</strong></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {sale && <SaleDetailModal sale={sale} onClose={() => setSale(null)} onChanged={load} />}
    </div>
  );
}
