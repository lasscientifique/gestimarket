import { useCallback, useEffect, useState } from "react";
import { LockOpen, Lock, ArrowDownUp, Eye, FileText, Printer, ShieldCheck, ShieldAlert } from "lucide-react";
import { api } from "../api";
import { useApp } from "../context/AppContext";
import { HelpTip } from "../components/Help";
import { Badge, Empty, Modal, PageHeader } from "../components/ui";
import { CashMovementModal, CloseSessionModal, OpenSessionModal, SessionSummary } from "../components/CashModals";
import { addDays, dateTime, isoDate, money } from "../lib/format";
import { printZReport } from "../lib/receipt";
import type { CashMovement, CashSession, ZReport } from "../types";
import { tl } from "../lib/i18n";

export default function CashSessionsPage() {
  const { toast, isAdmin: isManager, user } = useApp();
  const isCashier = user?.role === "cashier";
  const [forcing, setForcing] = useState<CashSession | null>(null);
  const [current, setCurrent] = useState<CashSession | null | undefined>(undefined);
  const [movements, setMovements] = useState<CashMovement[]>([]);
  const [history, setHistory] = useState<CashSession[]>([]);
  const [from, setFrom] = useState(isoDate(addDays(new Date(), -30)));
  const [to, setTo] = useState(isoDate());
  const [modal, setModal] = useState<null | "open" | "move" | "close">(null);
  const [viewing, setViewing] = useState<CashSession | null>(null);
  const [zs, setZs] = useState<ZReport[]>([]);
  const { settings } = useApp();

  /** Rapport X : chiffres de la caisse en cours, imprimés sans la clôturer. */
  const xReport = async (sessionId?: number) => {
    try {
      printZReport(await api.cashXReport(sessionId), "X", settings);
    } catch (e) {
      toast.error(e);
    }
  };

  const load = useCallback(async () => {
    try {
      const s = isCashier ? await api.currentCashSession() : null;
      setCurrent(s);
      setMovements(s ? await api.listCashMovements(s.id) : []);
      setHistory(await api.listCashSessions({ from, to }));
      setZs(await api.listZReports({ from, to }));
    } catch (e) {
      toast.error(e);
    }
  }, [from, to, toast, isCashier]);
  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="page">
      <PageHeader
        help="cash"
        title={tl("Sessions de caisse")}
        subtitle={tl("Ouverture, mouvements d'espèces et clôture avec contrôle des écarts.")}
        actions={
          !isCashier ? undefined : current ? (
            <>
              <button className="btn" onClick={() => xReport()} title={tl("Chiffres de la caisse en cours, sans la clôturer")}><FileText size={16} />  {tl("Rapport X")}</button>
              <button className="btn" onClick={() => setModal("move")}><ArrowDownUp size={16} />  {tl("Entrée / sortie")}</button>
              <HelpTip k="cash_movement" />
              <button className="btn btn-danger" onClick={() => setModal("close")}><Lock size={16} />  {tl("Clôturer ma caisse")}</button>
              <HelpTip k="cash_close" side="left" />
            </>
          ) : (
            current === null && <button className="btn btn-primary" onClick={() => setModal("open")}><LockOpen size={16} />  {tl("Ouvrir ma caisse")}</button>
          )
        }
      />

      {current && (
        <div className="card">
          <div className="card-header">
            <h3>{tl("Ma session en cours")} <Badge tone="success">{tl("Ouverte")}</Badge></h3>
            <span className="muted">{tl("depuis le")} {dateTime(current.opened_at)}</span>
          </div>
          <SessionSummary session={current} />
          {movements.length > 0 && (
            <>
              <h4 className="section-title">{tl("Mouvements d'espèces")}</h4>
              <table className="table compact">
                <tbody>
                  {movements.map((m) => (
                    <tr key={m.id}>
                      <td className="nowrap">{dateTime(m.created_at)}</td>
                      <td><Badge tone={m.kind === "in" ? "success" : "danger"}>{m.kind === "in" ? tl("Entrée") : tl("Sortie")}</Badge></td>
                      <td>{m.reason}</td>
                      <td className="num">{money(m.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      )}
      {!isCashier && (
        <div className="alert alert-info">
          {tl("Par sécurité, seuls les comptes")} <strong>caissier</strong>  {tl("ouvrent une caisse et encaissent. Les gestionnaires et administrateurs supervisent : historique, écarts")}{isManager && <>{tl(", et clôture d'une caisse restée ouverte (caissier absent)")}</>}.
        </div>
      )}
      {isCashier && current === null && (
        <div className="card">
          <Empty title={tl("Aucune session ouverte")}>{tl("Ouvrez votre caisse en début de journée en déclarant le fond de caisse.")}</Empty>
        </div>
      )}

      <div className="card-header" style={{ marginTop: 20 }}>
        <h3>{isManager ? tl("Historique des sessions (tous les caissiers)") : tl("Mes sessions")}</h3>
        <div className="toolbar" style={{ margin: 0 }}>
          <label className="inline">{tl("Du")} <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
          <label className="inline">au <input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        </div>
      </div>
      <div className="card no-pad">
        {history.length === 0 ? (
          <Empty title={tl("Aucune session sur la période")} />
        ) : (
          <table className="table">
            <thead><tr><th>{tl("Caissier")}</th><th>{tl("Ouverture")}</th><th>{tl("Clôture")}</th><th className="num">{tl("Ventes")}</th><th className="num">{tl("Fond")}</th><th className="num">{tl("Attendu")}</th><th className="num">{tl("Compté")}</th><th className="num">{tl("Écart")}</th><th></th></tr></thead>
            <tbody>
              {history.map((s) => (
                <tr key={s.id} onDoubleClick={() => setViewing(s)}>
                  <td>{s.user_name}</td>
                  <td className="nowrap">{dateTime(s.opened_at)}</td>
                  <td className="nowrap">
                    {s.status === "open" ? <Badge tone="success">{tl("En cours")}</Badge> : dateTime(s.closed_at)}
                    {s.z_number != null && <div className="muted small mono">{`Z-${String(s.z_number).padStart(4, "0")}`}</div>}
                  </td>
                  <td className="num">{money(s.sales_total)}</td>
                  <td className="num">{money(s.opening_amount)}</td>
                  <td className="num">{money(s.expected_amount ?? s.expected_now)}</td>
                  <td className="num">{s.counted_amount != null ? money(s.counted_amount) : "—"}</td>
                  <td className="num">
                    {s.difference == null ? "—" : <Badge tone={s.difference === 0 ? "success" : s.difference > 0 ? "info" : "danger"}>{s.difference > 0 ? "+" : ""}{money(s.difference)}</Badge>}
                  </td>
                  <td className="actions">
                    {isManager && s.status === "open" && (
                      <>
                        <button className="btn btn-sm" onClick={() => xReport(s.id)} title={tl("Rapport X de cette caisse")}><FileText size={13} />  X</button>
                        <button className="btn btn-sm btn-danger" onClick={() => setForcing(s)} title={tl("Clôturer la caisse de ce caissier")}><Lock size={13} />  {tl("Clôturer")}</button>
                      </>
                    )}
                    <button className="icon-btn" onClick={() => setViewing(s)}><Eye size={16} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <ZReportsCard reports={zs} />

      {modal === "open" && <OpenSessionModal onClose={() => setModal(null)} onOpened={() => { setModal(null); load(); }} />}
      {modal === "move" && <CashMovementModal onClose={() => setModal(null)} onDone={() => { setModal(null); load(); }} />}
      {modal === "close" && current && <CloseSessionModal session={current} onClose={() => setModal(null)} onClosed={(s) => { setModal(null); setViewing(s); load(); }} />}
      {forcing && <CloseSessionModal session={forcing} forced onClose={() => setForcing(null)} onClosed={(s) => { setForcing(null); setViewing(s); load(); }} />}
      {viewing && (
        <Modal title={tl("Session de {0}", [viewing.user_name])} onClose={() => setViewing(null)} width={640}>
          <div className="kv"><span>{tl("Ouverture")}</span><span>{dateTime(viewing.opened_at)}</span></div>
          <div className="kv"><span>{tl("Clôture")}</span><span>{dateTime(viewing.closed_at)}</span></div>
          <SessionSummary session={viewing} />
          {viewing.z_number != null &&
            zs.filter((z) => z.number === viewing.z_number).map((z) => (
              <div key={z.number} className="row-end" style={{ marginBottom: 8 }}>
                <button className="btn" onClick={() => printZReport(z.data, "Z", settings)}>
                  <Printer size={15} />  {tl("Imprimer le rapport Z-{0}", [String(z.number).padStart(4, "0")])}</button>
              </div>
            ))}
          {viewing.counted_amount != null && (
            <div className={`alert ${viewing.difference === 0 ? "alert-success" : (viewing.difference ?? 0) > 0 ? "alert-info" : "alert-danger"}`}>
              {tl("Compté :")} <strong>{money(viewing.counted_amount)}</strong>  {tl("— écart :")} <strong>{money(viewing.difference ?? 0)}</strong>
              {viewing.note && <> — {viewing.note}</>}
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}

/** Rapports Z de la période : un par clôture, numérotés, non modifiables ; total par jour. */
function ZReportsCard({ reports }: { reports: ZReport[] }) {
  const { settings } = useApp();
  if (reports.length === 0) return null;
  const days = new Map<string, { count: number; sales: number; returns: number; net: number; difference: number }>();
  for (const z of reports) {
    const day = z.created_at.slice(0, 10);
    const d = days.get(day) ?? { count: 0, sales: 0, returns: 0, net: 0, difference: 0 };
    d.count += 1;
    d.sales += z.data.sales.total;
    d.returns += z.data.returns.total;
    d.net += z.data.net_total;
    d.difference += z.data.cash.difference ?? 0;
    days.set(day, d);
  }
  const broken = reports.some((z) => !z.intact);
  return (
    <>
      <div className="card-header" style={{ marginTop: 20 }}>
        <h3>{tl("Rapports Z")}</h3>
        {broken ? (
          <Badge tone="danger"><ShieldAlert size={13} /> {tl("Un rapport a été modifié en dehors de GestiMarket")}</Badge>
        ) : (
          <Badge tone="success"><ShieldCheck size={13} /> {tl("Chaîne d'empreintes vérifiée")}</Badge>
        )}
      </div>
      <div className="card no-pad">
        <table className="table">
          <thead><tr><th>{tl("N°")}</th><th>{tl("Clôture")}</th><th>{tl("Caissier")}</th><th className="num">{tl("Ventes")}</th><th className="num">{tl("Retours")}</th><th className="num">{tl("Net")}</th><th className="num">{tl("Écart")}</th><th></th></tr></thead>
          <tbody>
            {reports.map((z) => (
              <tr key={z.number}>
                <td className="mono">{`Z-${String(z.number).padStart(4, "0")}`}{!z.intact && <> <Badge tone="danger">!</Badge></>}</td>
                <td className="nowrap">{dateTime(z.created_at)}</td>
                <td>{z.data.cashier}</td>
                <td className="num">{money(z.data.sales.total)}</td>
                <td className="num">{z.data.returns.total ? "-" + money(z.data.returns.total) : "—"}</td>
                <td className="num"><strong>{money(z.data.net_total)}</strong></td>
                <td className="num">{money(z.data.cash.difference ?? 0)}</td>
                <td className="actions">
                  <button className="icon-btn" title={tl("Imprimer (ticket)")} onClick={() => printZReport(z.data, "Z", settings)}><Printer size={16} /></button>
                  <button className="btn btn-sm" title={tl("Imprimer en A4")} onClick={() => printZReport(z.data, "Z", settings, true)}>A4</button>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            {[...days.entries()].map(([day, d]) => (
              <tr key={day} className="muted">
                <td colSpan={3}>{tl("Journée du {0} ({1} caisse(s))", [day.split("-").reverse().join("/"), d.count])}</td>
                <td className="num">{money(d.sales)}</td>
                <td className="num">{d.returns ? "-" + money(d.returns) : "—"}</td>
                <td className="num"><strong>{money(d.net)}</strong></td>
                <td className="num">{money(d.difference)}</td>
                <td></td>
              </tr>
            ))}
          </tfoot>
        </table>
      </div>
    </>
  );
}
