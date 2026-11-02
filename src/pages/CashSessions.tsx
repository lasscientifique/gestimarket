import { useCallback, useEffect, useState } from "react";
import { LockOpen, Lock, ArrowDownUp, Eye } from "lucide-react";
import { api } from "../api";
import { useApp } from "../context/AppContext";
import { HelpTip } from "../components/Help";
import { Badge, Empty, Modal, PageHeader } from "../components/ui";
import { CashMovementModal, CloseSessionModal, OpenSessionModal, SessionSummary } from "../components/CashModals";
import { addDays, dateTime, isoDate, money } from "../lib/format";
import type { CashMovement, CashSession } from "../types";
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

  const load = useCallback(async () => {
    try {
      const s = isCashier ? await api.currentCashSession() : null;
      setCurrent(s);
      setMovements(s ? await api.listCashMovements(s.id) : []);
      setHistory(await api.listCashSessions({ from, to }));
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
                  <td className="nowrap">{s.status === "open" ? <Badge tone="success">{tl("En cours")}</Badge> : dateTime(s.closed_at)}</td>
                  <td className="num">{money(s.sales_total)}</td>
                  <td className="num">{money(s.opening_amount)}</td>
                  <td className="num">{money(s.expected_amount ?? s.expected_now)}</td>
                  <td className="num">{s.counted_amount != null ? money(s.counted_amount) : "—"}</td>
                  <td className="num">
                    {s.difference == null ? "—" : <Badge tone={s.difference === 0 ? "success" : s.difference > 0 ? "info" : "danger"}>{s.difference > 0 ? "+" : ""}{money(s.difference)}</Badge>}
                  </td>
                  <td className="actions">
                    {isManager && s.status === "open" && (
                      <button className="btn btn-sm btn-danger" onClick={() => setForcing(s)} title={tl("Clôturer la caisse de ce caissier")}><Lock size={13} />  {tl("Clôturer")}</button>
                    )}
                    <button className="icon-btn" onClick={() => setViewing(s)}><Eye size={16} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {modal === "open" && <OpenSessionModal onClose={() => setModal(null)} onOpened={() => { setModal(null); load(); }} />}
      {modal === "move" && <CashMovementModal onClose={() => setModal(null)} onDone={() => { setModal(null); load(); }} />}
      {modal === "close" && current && <CloseSessionModal session={current} onClose={() => setModal(null)} onClosed={(s) => { setModal(null); setViewing(s); load(); }} />}
      {forcing && <CloseSessionModal session={forcing} forced onClose={() => setForcing(null)} onClosed={(s) => { setForcing(null); setViewing(s); load(); }} />}
      {viewing && (
        <Modal title={tl("Session de {0}", [viewing.user_name])} onClose={() => setViewing(null)} width={640}>
          <div className="kv"><span>{tl("Ouverture")}</span><span>{dateTime(viewing.opened_at)}</span></div>
          <div className="kv"><span>{tl("Clôture")}</span><span>{dateTime(viewing.closed_at)}</span></div>
          <SessionSummary session={viewing} />
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
