import { useState } from "react";
import { api } from "../api";
import { useApp } from "../context/AppContext";
import { currencySymbol, money, paymentLabel, toMinor } from "../lib/format";
import type { CashSession } from "../types";
import { Field, Modal } from "./ui";

export function OpenSessionModal({ onClose, onOpened }: { onClose: () => void; onOpened: (s: CashSession) => void }) {
  const { toast } = useApp();
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      const s = await api.openCashSession(toMinor(amount || "0"));
      toast.success("Caisse ouverte.");
      onOpened(s);
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title="Ouverture de caisse"
      onClose={onClose}
      width={420}
      footer={
        <>
          <button className="btn" onClick={onClose}>Annuler</button>
          <button className="btn btn-primary" disabled={busy} onClick={submit}>Ouvrir la caisse</button>
        </>
      }
    >
      <p className="muted">Comptez les espèces présentes dans le tiroir avant de commencer (fond de caisse).</p>
      <Field label={`Fond de caisse (${currencySymbol()})`}>
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
      const pin = await askPin({ title: kind === "in" ? "Entrée d'espèces" : "Sortie d'espèces", message: <>{money(toMinor(amount))} — {reason}. Confirmez avec votre code PIN.</> });
      if (!pin) return;
      const s = await api.addCashMovement({ kind, amount: toMinor(amount), reason }, pin);
      toast.success(kind === "in" ? "Entrée d'espèces enregistrée." : "Sortie d'espèces enregistrée.");
      onDone(s);
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title="Entrée / sortie d'espèces"
      onClose={onClose}
      width={460}
      footer={
        <>
          <button className="btn" onClick={onClose}>Annuler</button>
          <button className="btn btn-primary" disabled={busy || !amount || !reason.trim()} onClick={submit}>Enregistrer</button>
        </>
      }
    >
      <div className="segmented">
        <button className={kind === "out" ? "active" : ""} onClick={() => setKind("out")}>Sortie (dépense, versement…)</button>
        <button className={kind === "in" ? "active" : ""} onClick={() => setKind("in")}>Entrée (appoint de monnaie…)</button>
      </div>
      <div className="form-grid one" style={{ marginTop: 14 }}>
        <Field label={`Montant (${currencySymbol()})`}>
          <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
        </Field>
        <Field label="Motif">
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ex. Versement banque, achat sachets…" />
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
        title: forced ? `Clôturer la caisse de ${session.user_name}` : "Clôturer la caisse",
        level: forced ? "admin" : undefined,
        message: <>Espèces comptées : <strong>{money(toMinor(counted))}</strong>. Confirmez avec votre code PIN.</>,
      });
      if (!pin) return;
      const input = { counted_amount: toMinor(counted), note: note || null };
      const s = forced ? await api.forceCloseCashSession(session.id, input, pin) : await api.closeCashSession(input, pin);
      toast.success("Caisse clôturée.");
      onClosed(s);
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={forced ? `Clôture de la caisse de ${session.user_name}` : "Clôture de caisse"}
      onClose={onClose}
      width={520}
      footer={
        <>
          <button className="btn" onClick={onClose}>Annuler</button>
          <button className="btn btn-danger" disabled={busy || counted === ""} onClick={submit}>Clôturer la caisse</button>
        </>
      }
    >
      <SessionSummary session={session} />
      <div className="form-grid one" style={{ marginTop: 16 }}>
        <Field label={`Espèces comptées dans le tiroir (${currencySymbol()})`}>
          <input className="input-lg" inputMode="decimal" value={counted} onChange={(e) => setCounted(e.target.value)} autoFocus />
        </Field>
        {diff !== null && (
          <div className={`alert ${diff === 0 ? "alert-success" : diff > 0 ? "alert-info" : "alert-danger"}`}>
            {diff === 0 ? "Caisse juste : aucun écart." : diff > 0 ? `Excédent de ${money(diff)}` : `Manquant de ${money(-diff)}`}
          </div>
        )}
        <Field label="Observation (facultatif)">
          <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

export function SessionSummary({ session }: { session: CashSession }) {
  const rows: [string, number, boolean?][] = [
    ["Fond de caisse", session.opening_amount],
    ["Ventes en espèces", session.cash_sales],
    ["Règlements clients (espèces)", session.customer_payments_cash],
    ["Entrées d'espèces", session.cash_in],
    ["Sorties d'espèces", -session.cash_out],
    ["Espèces attendues", session.expected_now, true],
  ];
  return (
    <div className="summary-grid">
      <div>
        <div className="summary-title">Tiroir-caisse</div>
        {rows.map(([l, v, strong]) => (
          <div key={l} className={`kv ${strong ? "kv-strong" : ""}`}>
            <span>{l}</span>
            <span>{money(v)}</span>
          </div>
        ))}
      </div>
      <div>
        <div className="summary-title">Ventes de la session ({session.sales_count})</div>
        <div className="kv"><span>Espèces</span><span>{money(session.cash_sales)}</span></div>
        <div className="kv"><span>{paymentLabel("orange_money")}</span><span>{money(session.orange_money_sales)}</span></div>
        <div className="kv"><span>Autre mobile money</span><span>{money(session.mobile_money_sales)}</span></div>
        <div className="kv"><span>Carte</span><span>{money(session.card_sales)}</span></div>
        <div className="kv"><span>Autre</span><span>{money(session.other_sales)}</span></div>
        <div className="kv"><span>À crédit</span><span>{money(session.credit_sales)}</span></div>
        <div className="kv kv-strong"><span>Total ventes</span><span>{money(session.sales_total)}</span></div>
        {session.customer_payments_electronic > 0 && (
          <div className="kv muted"><span>Règlements clients (électroniques)</span><span>{money(session.customer_payments_electronic)}</span></div>
        )}
      </div>
    </div>
  );
}
