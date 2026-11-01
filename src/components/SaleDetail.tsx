import { useState } from "react";
import { Printer, Ban } from "lucide-react";
import { api } from "../api";
import { useApp } from "../context/AppContext";
import { dateTime, money, paymentLabel, qty } from "../lib/format";
import { printReceipt } from "../lib/receipt";
import type { Sale } from "../types";
import { Badge, Field, Modal } from "./ui";
import { HelpTip } from "./Help";

export function SaleDetailModal({ sale, onClose, onChanged }: { sale: Sale; onClose: () => void; onChanged?: (s: Sale) => void }) {
  const { settings, toast, askPin } = useApp();
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState("");
  const [current, setCurrent] = useState(sale);

  const doCancel = async () => {
    try {
      const pin = await askPin({ title: "Annuler la vente", level: "admin", message: <>L'annulation de <strong>{current.number}</strong> doit être validée par le code PIN de l'administrateur.</> });
      if (!pin) return;
      const s = await api.cancelSale(current.id, reason, pin);
      toast.success("Vente annulée, stock réintégré.");
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
          Vente {current.number} {current.status === "cancelled" && <Badge tone="danger">Annulée</Badge>}
        </>
      }
      onClose={onClose}
      width={680}
      footer={
        <>
          {current.status === "completed" && !cancelling && (
            <button className="btn btn-danger-outline" style={{ marginRight: "auto" }} onClick={() => setCancelling(true)}>
              <Ban size={16} /> Annuler la vente
            </button>
          )}
          {current.status === "completed" && !cancelling && (
            <HelpTip k="cancel_sale" side="top" />
          )}
          <button className="btn" onClick={() => printReceipt(current, settings)}>
            <Printer size={16} /> Réimprimer le ticket
          </button>
          <button className="btn btn-primary" onClick={onClose}>Fermer</button>
        </>
      }
    >
      <div className="grid-2 tight">
        <div>
          <div className="kv"><span>Date</span><span>{dateTime(current.created_at)}</span></div>
          <div className="kv"><span>Caissier</span><span>{current.user_name}</span></div>
          <div className="kv"><span>Client</span><span>{current.customer_name ?? "Client de passage"}</span></div>
          {current.note && <div className="kv"><span>Note</span><span>{current.note}</span></div>}
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
          {current.change_due > 0 && <div className="kv"><span>Monnaie rendue</span><span>{money(current.change_due)}</span></div>}
          {current.credit_amount > 0 && <div className="kv"><span>À crédit</span><span>{money(current.credit_amount)}</span></div>}
          {current.payments.length === 0 && current.credit_amount === 0 && <div className="kv"><span>Paiement</span><span>{paymentLabel(current.payment_method)}</span></div>}
        </div>
      </div>

      <table className="table compact" style={{ marginTop: 14 }}>
        <thead><tr><th>Produit</th><th className="num">Qté</th><th className="num">P.U.</th><th className="num">Remise</th><th className="num">Total</th></tr></thead>
        <tbody>
          {current.items.map((i) => (
            <tr key={i.id}>
              <td>{i.product_name}</td>
              <td className="num">{qty(i.quantity)} {i.unit}</td>
              <td className="num">{money(i.unit_price)}</td>
              <td className="num">{i.discount ? money(i.discount) : "—"}</td>
              <td className="num">{money(i.total)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          {current.discount > 0 && <tr><td colSpan={4}>Remise sur ticket</td><td className="num">-{money(current.discount)}</td></tr>}
          <tr><td colSpan={4}><strong>Total TTC</strong></td><td className="num"><strong>{money(current.total)}</strong></td></tr>
          {current.tax_total > 0 && <tr className="muted"><td colSpan={4}>dont TVA</td><td className="num">{money(current.tax_total)}</td></tr>}
          {settings && false && <tr className="muted"><td colSpan={4}>Marge brute</td><td className="num">{money(current.total - current.cost_total)}</td></tr>}
        </tfoot>
      </table>

      {current.status === "cancelled" && (
        <div className="alert alert-danger">
          Annulée le {dateTime(current.cancelled_at)} — motif : {current.cancel_reason}
        </div>
      )}

      {cancelling && (
        <div className="cancel-box">
          <Field label="Motif de l'annulation *">
            <input value={reason} onChange={(e) => setReason(e.target.value)} autoFocus placeholder="Ex. erreur de saisie, retour client…" />
          </Field>
          <div className="row-end">
            <button className="btn" onClick={() => setCancelling(false)}>Retour</button>
            <button className="btn btn-danger" disabled={!reason.trim()} onClick={doCancel}>Confirmer l'annulation</button>
          </div>
        </div>
      )}
    </Modal>
  );
}
