import { useState } from "react";
import { Printer, Ban, Undo2 } from "lucide-react";
import { api } from "../api";
import { useApp } from "../context/AppContext";
import { dateTime, money, paymentLabel, qty } from "../lib/format";
import { printReceipt } from "../lib/receipt";
import type { Sale } from "../types";
import { Badge, Field, Modal } from "./ui";
import { HelpTip } from "./Help";
import { ReturnModal } from "./ReturnModal";
import { tl } from "../lib/i18n";

export function SaleDetailModal({ sale, onClose, onChanged }: { sale: Sale; onClose: () => void; onChanged?: (s: Sale) => void }) {
  const { settings, toast, askPin } = useApp();
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState("");
  const [current, setCurrent] = useState(sale);
  const [returning, setReturning] = useState(false);
  const canReturn = current.status === "completed" && current.items.some((i) => i.quantity - i.returned_quantity > 1e-9);

  const doCancel = async () => {
    try {
      const pin = await askPin({ title: tl("Annuler la vente"), level: "admin", message: <>{tl("L'annulation de")} <strong>{current.number}</strong>  {tl("doit être validée par le code PIN de l'administrateur.")}</> });
      if (!pin) return;
      const s = await api.cancelSale(current.id, reason, pin);
      toast.success(tl("Vente annulée, stock réintégré."));
      setCurrent(s);
      setCancelling(false);
      onChanged?.(s);
    } catch (e) {
      toast.error(e);
    }
  };

  return (
    <Modal
      title={
        <>
          {tl("Vente")} {current.number} {current.status === "cancelled" && <Badge tone="danger">{tl("Annulée")}</Badge>}
        </>
      }
      onClose={onClose}
      width={680}
      footer={
        <>
          {current.status === "completed" && !cancelling && current.returned_total === 0 && (
            <button className="btn btn-danger-outline" style={{ marginRight: "auto" }} onClick={() => setCancelling(true)}>
              <Ban size={16} />  {tl("Annuler la vente")}</button>
          )}
          {canReturn && !cancelling && (
            <button className="btn" style={current.returned_total > 0 ? { marginRight: "auto" } : undefined} onClick={() => setReturning(true)}>
              <Undo2 size={16} />  {tl("Retour d'articles")}</button>
          )}
          {current.status === "completed" && !cancelling && (
            <HelpTip k="cancel_sale" side="top" />
          )}
          <button className="btn" onClick={() => printReceipt(current, settings).catch(toast.error)}>
            <Printer size={16} />  {tl("Réimprimer le ticket")}</button>
          <button className="btn btn-primary" onClick={onClose}>{tl("Fermer")}</button>
        </>
      }
    >
      <div className="grid-2 tight">
        <div>
          <div className="kv"><span>{tl("Date")}</span><span>{dateTime(current.created_at)}</span></div>
          <div className="kv"><span>{tl("Caissier")}</span><span>{current.user_name}</span></div>
          <div className="kv"><span>{tl("Client")}</span><span>{current.customer_name ?? tl("Client de passage")}</span></div>
          {current.note && <div className="kv"><span>{tl("Note")}</span><span>{current.note}</span></div>}
        </div>
        <div>
          {current.payments.map((p) => (
            <div key={p.id} className="kv">
              <span>
                {paymentLabel(p.method)}
                {p.reference && <span className="mono small muted"> · {p.reference}</span>}
                {p.phone && <span className="small muted"> · {p.phone}</span>}
              </span>
              <span>{money(p.method === "cash" ? p.tendered : p.amount)}</span>
            </div>
          ))}
          {current.change_due > 0 && <div className="kv"><span>{tl("Monnaie rendue")}</span><span>{money(current.change_due)}</span></div>}
          {current.credit_amount > 0 && <div className="kv"><span>{tl("À crédit")}</span><span>{money(current.credit_amount)}</span></div>}
          {current.payments.length === 0 && current.credit_amount === 0 && <div className="kv"><span>{tl("Paiement")}</span><span>{paymentLabel(current.payment_method)}</span></div>}
        </div>
      </div>

      <table className="table compact" style={{ marginTop: 14 }}>
        <thead><tr><th>{tl("Produit")}</th><th className="num">{tl("Qté")}</th><th className="num">{tl("P.U.")}</th><th className="num">{tl("Remise")}</th><th className="num">{tl("Total")}</th></tr></thead>
        <tbody>
          {current.items.map((i) => (
            <tr key={i.id}>
              <td>
                {i.product_name}
                {i.price_kind === "promo" && <> <Badge tone="success">{tl("Promo")}</Badge></>}
                {i.price_kind === "wholesale" && <> <Badge tone="info">{tl("Gros")}</Badge></>}
                {i.returned_quantity > 0 && <div className="small muted">{tl("retourné : {0}", [qty(i.returned_quantity)])}</div>}
              </td>
              <td className="num">{qty(i.quantity)} {i.unit}</td>
              <td className="num">{money(i.unit_price)}</td>
              <td className="num">{i.discount ? money(i.discount) : "—"}</td>
              <td className="num">{money(i.total)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          {current.discount > 0 && <tr><td colSpan={4}>{tl("Remise sur ticket")}</td><td className="num">-{money(current.discount)}</td></tr>}
          <tr><td colSpan={4}><strong>{tl("Total TTC")}</strong></td><td className="num"><strong>{money(current.total)}</strong></td></tr>
          {current.tax_total > 0 && <tr className="muted"><td colSpan={4}>{tl("dont TVA")}</td><td className="num">{money(current.tax_total)}</td></tr>}
          {current.returned_total > 0 && <tr><td colSpan={4}>{tl("Rendu par des retours")}</td><td className="num">-{money(current.returned_total)}</td></tr>}
        </tfoot>
      </table>

      {current.status === "cancelled" && (
        <div className="alert alert-danger">
          {tl("Annulée le")} {dateTime(current.cancelled_at)}  {tl("— motif :")} {current.cancel_reason}
        </div>
      )}

      {returning && (
        <ReturnModal
          sale={current}
          onClose={() => setReturning(false)}
          onDone={async () => {
            setReturning(false);
            const s = await api.getSale(current.id);
            setCurrent(s);
            onChanged?.(s);
          }}
        />
      )}

      {cancelling && (
        <div className="cancel-box">
          <Field label={tl("Motif de l'annulation *")}>
            <input value={reason} onChange={(e) => setReason(e.target.value)} autoFocus placeholder={tl("Ex. erreur de saisie, retour client…")} />
          </Field>
          <div className="row-end">
            <button className="btn" onClick={() => setCancelling(false)}>{tl("Retour")}</button>
            <button className="btn btn-danger" disabled={!reason.trim()} onClick={doCancel}>{tl("Confirmer l'annulation")}</button>
          </div>
        </div>
      )}
    </Modal>
  );
}
