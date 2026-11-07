import { useState } from "react";
import { api } from "../api";
import { useApp } from "../context/AppContext";
import { currencySymbol, money, paymentLabel, toMinor } from "../lib/format";
import type { CashSession } from "../types";
import { Field, Modal } from "./ui";
import { tl } from "../lib/i18n";

export function OpenSessionModal({ onClose, onOpened }: { onClose: () => void; onOpened: (s: CashSession) => void }) {
  const { toast } = useApp();
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      const s = await api.openCashSession(toMinor(amount || "0"));
      toast.success(tl("Caisse ouverte."));
      onOpened(s);
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={tl("Ouverture de caisse")}
      onClose={onClose}
      width={420}
      footer={
        <>
          <button className="btn" onClick={onClose}>{tl("Annuler")}</button>
          <button className="btn btn-primary" disabled={busy} onClick={submit}>{tl("Ouvrir la caisse")}</button>
        </>
      }
    >
      <p className="muted">{tl("Comptez les espèces présentes dans le tiroir avant de commencer (fond de caisse).")}</p>
      <Field label={tl("Fond de caisse ({0})", [currencySymbol()])}>
        <input
          className="input-lg"
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="0"
          autoFocus
        />
      </Field>
    </Modal>
  );
}

export function CashMovementModal({ onClose, onDone }: { onClose: () => void; onDone: (s: CashSession) => void }) {
  const { toast, askPin } = useApp();
  const [kind, setKind] = useState<"in" | "out">("out");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      const pin = await askPin({ title: kind === "in" ? tl("Entrée d'espèces") : tl("Sortie d'espèces"), message: <>{money(toMinor(amount))} — {reason}{tl(". Confirmez avec votre code PIN.")}</> });
      if (!pin) return;
      const s = await api.addCashMovement({ kind, amount: toMinor(amount), reason }, pin);
      toast.success(kind === "in" ? tl("Entrée d'espèces enregistrée.") : tl("Sortie d'espèces enregistrée."));
      onDone(s);
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={tl("Entrée / sortie d'espèces")}
      onClose={onClose}
      width={460}
      footer={
        <>
          <button className="btn" onClick={onClose}>{tl("Annuler")}</button>
          <button className="btn btn-primary" disabled={busy || !amount || !reason.trim()} onClick={submit}>{tl("Enregistrer")}</button>
        </>
      }
    >
      <div className="segmented">
        <button className={kind === "out" ? "active" : ""} onClick={() => setKind("out")}>{tl("Sortie (dépense, versement…)")}</button>
        <button className={kind === "in" ? "active" : ""} onClick={() => setKind("in")}>{tl("Entrée (appoint de monnaie…)")}</button>
      </div>
      <div className="form-grid one" style={{ marginTop: 14 }}>
        <Field label={tl("Montant ({0})", [currencySymbol()])}>
          <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
        </Field>
        <Field label={tl("Motif")}>
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={tl("Ex. Versement banque, achat sachets…")} />
        </Field>
      </div>
    </Modal>
  );
}

export function CloseSessionModal({
  session,
  onClose,
  onClosed,
  forced,
}: {
  session: CashSession;
  onClose: () => void;
  onClosed: (s: CashSession) => void;
  /** Clôture par l'administrateur de la caisse d'un caissier. */
  forced?: boolean;
}) {
  const { toast, askPin } = useApp();
  const [counted, setCounted] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const diff = counted === "" ? null : toMinor(counted) - session.expected_now;

  const submit = async () => {
    setBusy(true);
    try {
      const pin = await askPin({
        title: forced ? tl("Clôturer la caisse de {0}", [session.user_name]) : tl("Clôturer la caisse"),
        level: forced ? "admin" : undefined,
        message: <>{tl("Espèces comptées :")} <strong>{money(toMinor(counted))}</strong>{tl(". Confirmez avec votre code PIN.")}</>,
      });
      if (!pin) return;
      const input = { counted_amount: toMinor(counted), note: note || null };
      const s = forced ? await api.forceCloseCashSession(session.id, input, pin) : await api.closeCashSession(input, pin);
      toast.success(tl("Caisse clôturée."));
      onClosed(s);
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={forced ? tl("Clôture de la caisse de {0}", [session.user_name]) : tl("Clôture de caisse")}
      onClose={onClose}
      width={520}
      footer={
        <>
          <button className="btn" onClick={onClose}>{tl("Annuler")}</button>
          <button className="btn btn-danger" disabled={busy || counted === ""} onClick={submit}>{tl("Clôturer la caisse")}</button>
        </>
      }
    >
      <SessionSummary session={session} />
      <div className="form-grid one" style={{ marginTop: 16 }}>
        <Field label={tl("Espèces comptées dans le tiroir ({0})", [currencySymbol()])}>
          <input className="input-lg" inputMode="decimal" value={counted} onChange={(e) => setCounted(e.target.value)} autoFocus />
        </Field>
        {diff !== null && (
          <div className={`alert ${diff === 0 ? "alert-success" : diff > 0 ? "alert-info" : "alert-danger"}`}>
            {diff === 0 ? tl("Caisse juste : aucun écart.") : diff > 0 ? tl("Excédent de {0}", [money(diff)]) : tl("Manquant de {0}", [money(-diff)])}
          </div>
        )}
        <Field label={tl("Observation (facultatif)")}>
          <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

export function SessionSummary({ session }: { session: CashSession }) {
  const rows: [string, number, boolean?][] = [
    [tl("Fond de caisse"), session.opening_amount],
    [tl("Ventes en espèces"), session.cash_sales],
    [tl("Versements clients (espèces)"), session.customer_payments_cash],
    [tl("Entrées d'espèces"), session.cash_in],
    [tl("Sorties d'espèces"), -session.cash_out],
    ...(session.refunds_cash ? [[tl("Retours remboursés en espèces"), -session.refunds_cash] as [string, number]] : []),
    [tl("Espèces attendues"), session.expected_now, true],
  ];
  return (
    <div className="summary-grid">
      <div>
        <div className="summary-title">{tl("Tiroir-caisse")}</div>
        {rows.map(([l, v, strong]) => (
          <div key={l} className={`kv ${strong ? "kv-strong" : ""}`}>
            <span>{l}</span>
            <span>{money(v)}</span>
          </div>
        ))}
      </div>
      <div>
        <div className="summary-title">{tl("Ventes de la session (")}{session.sales_count})</div>
        <div className="kv"><span>{tl("Espèces")}</span><span>{money(session.cash_sales)}</span></div>
        <div className="kv"><span>{paymentLabel("orange_money")}</span><span>{money(session.orange_money_sales)}</span></div>
        <div className="kv"><span>{tl("Autre mobile money")}</span><span>{money(session.mobile_money_sales)}</span></div>
        <div className="kv"><span>{tl("Carte")}</span><span>{money(session.card_sales)}</span></div>
        <div className="kv"><span>{tl("Autre")}</span><span>{money(session.other_sales)}</span></div>
        <div className="kv"><span>{tl("À crédit")}</span><span>{money(session.credit_sales)}</span></div>
        {session.credit_note_sales > 0 && <div className="kv"><span>{tl("Payé par avoir")}</span><span>{money(session.credit_note_sales)}</span></div>}
        {session.account_sales > 0 && <div className="kv"><span>{tl("Payé avec les fonds des clients")}</span><span>{money(session.account_sales)}</span></div>}
        {session.loyalty_sales > 0 && <div className="kv"><span>{tl("Payé avec le bonus fidélité")}</span><span>{money(session.loyalty_sales)}</span></div>}
        <div className="kv kv-strong"><span>{tl("Total ventes")}</span><span>{money(session.sales_total)}</span></div>
        {session.returns_count > 0 && (
          <div className="kv"><span>{tl("Retours ({0})", [session.returns_count])}</span><span>-{money(session.returns_total)}</span></div>
        )}
        {session.customer_payments_electronic > 0 && (
          <div className="kv muted"><span>{tl("Versements clients (électroniques)")}</span><span>{money(session.customer_payments_electronic)}</span></div>
        )}
      </div>
    </div>
  );
}
