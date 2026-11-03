import { useCallback, useEffect, useState } from "react";
import { Printer, Search, Ticket, Undo2 } from "lucide-react";
import { api } from "../api";
import { useApp } from "../context/AppContext";
import { Badge, Empty, PageHeader } from "../components/ui";
import { SaleDetailModal } from "../components/SaleDetail";
import { addDays, dateTime, isoDate, money, paymentLabel } from "../lib/format";
import { printCreditNote, printReturn } from "../lib/receipt";
import type { CreditNote, Sale, SaleReturn } from "../types";
import { tl } from "../lib/i18n";

/** Retours d'articles (par vente) et avoirs émis (bons utilisables en caisse). */
export default function ReturnsPage() {
  const { toast, settings, user } = useApp();
  const canSeeNotes = user?.role === "admin" || user?.role === "manager";
  const [tab, setTab] = useState<"returns" | "notes">("returns");
  const [from, setFrom] = useState(isoDate(addDays(new Date(), -30)));
  const [to, setTo] = useState(isoDate());
  const [returns, setReturns] = useState<SaleReturn[]>([]);
  const [notes, setNotes] = useState<CreditNote[]>([]);
  const [search, setSearch] = useState("");
  const [sale, setSale] = useState<Sale | null>(null);

  const load = useCallback(() => {
    if (tab === "returns") api.listReturns({ from, to }).then(setReturns).catch(toast.error);
    else api.listCreditNotes({ search: search || undefined }).then(setNotes).catch(toast.error);
  }, [tab, from, to, search, toast]);
  useEffect(() => {
    const t = setTimeout(load, 150);
    return () => clearTimeout(t);
  }, [load]);

  const today = isoDate();
  const total = returns.reduce((s, r) => s + r.total, 0);

  return (
    <div className="page">
      <PageHeader
        help="returns"
        title={tl("Retours & avoirs")}
        subtitle={tl("Un retour se fait depuis la vente (Historique des ventes → la vente → « Retour d'articles »).")}
      />
      {canSeeNotes && (
        <div className="segmented" style={{ marginBottom: 12 }}>
          <button className={tab === "returns" ? "active" : ""} onClick={() => setTab("returns")}><Undo2 size={15} />  {tl("Retours")}</button>
          <button className={tab === "notes" ? "active" : ""} onClick={() => setTab("notes")}><Ticket size={15} />  {tl("Avoirs")}</button>
        </div>
      )}

      {tab === "returns" ? (
        <>
          <div className="toolbar">
            <label className="inline">{tl("Du")} <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
            <label className="inline">au <input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
            <span className="muted">{tl("{0} retour(s) · {1} rendus", [returns.length, money(total)])}</span>
          </div>
          <div className="card no-pad">
            {returns.length === 0 ? (
              <Empty title={tl("Aucun retour sur la période")} />
            ) : (
              <table className="table">
                <thead><tr><th>{tl("Retour")}</th><th>{tl("Date")}</th><th>{tl("Vente")}</th><th>{tl("Articles")}</th><th>{tl("Remboursement")}</th><th className="num">{tl("Montant")}</th><th>{tl("Validé par")}</th><th></th></tr></thead>
                <tbody>
                  {returns.map((r) => (
                    <tr key={r.id}>
                      <td className="mono">{r.number}</td>
                      <td className="nowrap">{dateTime(r.created_at)}</td>
                      <td>
                        <button className="link-btn" onClick={() => api.getSale(r.sale_id).then(setSale).catch(toast.error)}>{r.sale_number}</button>
                        {r.customer_name && <div className="muted small">{r.customer_name}</div>}
                      </td>
                      <td className="small">
                        {r.items.map((i, k) => (
                          <div key={k}>{`${i.quantity} × ${i.product_name}`}{!i.restock && <> <Badge tone="danger">{tl("abîmé")}</Badge></>}</div>
                        ))}
                        <div className="muted">{r.reason}</div>
                      </td>
                      <td>{r.refund_method === "credit_note" ? <Badge tone="info">{tl("Avoir")} {r.credit_note?.number}</Badge> : paymentLabel(r.refund_method)}</td>
                      <td className="num"><strong>{money(r.total)}</strong></td>
                      <td>{r.approved_by_name ?? "—"}</td>
                      <td className="actions">
                        <button className="icon-btn" title={tl("Réimprimer")} onClick={() => printReturn(r, settings)}><Printer size={16} /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      ) : (
        <>
          <div className="toolbar">
            <div className="search-box"><Search size={16} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={tl("N° d'avoir ou client…")} /></div>
          </div>
          <div className="card no-pad">
            {notes.length === 0 ? (
              <Empty title={tl("Aucun avoir")} />
            ) : (
              <table className="table">
                <thead><tr><th>{tl("Avoir")}</th><th>{tl("Émis le")}</th><th>{tl("Client")}</th><th className="num">{tl("Montant")}</th><th className="num">{tl("Reste")}</th><th>{tl("Valable jusqu'au")}</th><th>{tl("État")}</th><th></th></tr></thead>
                <tbody>
                  {notes.map((n) => {
                    const expired = n.status === "active" && n.expires_on < today;
                    return (
                      <tr key={n.id}>
                        <td className="mono">{n.number}{n.return_number && <div className="muted small">{tl("retour")} {n.return_number}</div>}</td>
                        <td className="nowrap">{dateTime(n.created_at)}</td>
                        <td>{n.customer_name ?? "—"}</td>
                        <td className="num">{money(n.amount)}</td>
                        <td className="num"><strong>{money(n.balance)}</strong></td>
                        <td>{n.expires_on.split("-").reverse().join("/")}</td>
                        <td>
                          {expired ? <Badge tone="warning">{tl("Expiré")}</Badge> : n.status === "active" ? <Badge tone="success">{tl("Utilisable")}</Badge> : n.status === "used" ? <Badge>{tl("Utilisé")}</Badge> : <Badge tone="danger">{tl("Annulé")}</Badge>}
                        </td>
                        <td className="actions">
                          {n.status === "active" && !expired && (
                            <button className="icon-btn" title={tl("Réimprimer le bon")} onClick={() => printCreditNote(n, settings)}><Printer size={16} /></button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
      {sale && <SaleDetailModal sale={sale} onClose={() => setSale(null)} onChanged={() => load()} />}
    </div>
  );
}
