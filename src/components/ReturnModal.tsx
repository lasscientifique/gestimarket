import { useMemo, useState } from "react";
import { Undo2 } from "lucide-react";
import { api } from "../api";
import { useApp } from "../context/AppContext";
import { money, paymentLabel, qty } from "../lib/format";
import { printReturn } from "../lib/receipt";
import { tl } from "../lib/i18n";
import type { Sale, SaleReturn } from "../types";
import { Field, Modal } from "./ui";

/** Retour de tout ou partie d'une vente : quantités, article remis en rayon ou abîmé, remboursement. */
export function ReturnModal({ sale, onClose, onDone }: { sale: Sale; onClose: () => void; onDone: (r: SaleReturn) => void }) {
  const { settings, toast, askPin, user } = useApp();
  const [lines, setLines] = useState(() =>
    sale.items.map((i) => ({ id: i.id, name: i.product_name, unit: i.unit, left: i.quantity - i.returned_quantity, sold: i.quantity, total: i.total, quantity: 0, restock: true })),
  );
  const onCredit = sale.credit_amount > 0;
  // Moyens possibles : espèces, avoir, ou le moyen électronique utilisé pour la vente ; dette si vente à crédit.
  const methods = useMemo(() => {
    if (onCredit) return ["debt"];
    const electronic = [...new Set(sale.payments.map((p) => p.method).filter((m) => m !== "cash" && m !== "credit_note"))];
    return ["cash", "credit_note", ...electronic];
  }, [sale, onCredit]);
  const [method, setMethod] = useState(methods[0]);
  const [reference, setReference] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const factor = sale.subtotal > 0 ? sale.total / sale.subtotal : 0;
  const amount = Math.min(
    lines.reduce((s, l) => s + Math.round((l.total * l.quantity) / l.sold * factor), 0),
    sale.total - sale.returned_total,
  );
  const set = (id: number, patch: Partial<(typeof lines)[number]>) => setLines((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch } : l)));

  const submit = async () => {
    try {
      const pin = await askPin({
        title: tl("Valider le retour"),
        level: "manager",
        message: <>{tl("Retour de")} <strong>{money(amount)}</strong> {tl("sur la vente")} {sale.number} : {tl("un gestionnaire ou l'administrateur valide avec son code PIN.")}</>,
      });
      if (!pin) return;
      setBusy(true);
      const r = await api.createReturn(
        {
          sale_id: sale.id,
          items: lines.filter((l) => l.quantity > 0).map((l) => ({ sale_item_id: l.id, quantity: l.quantity, restock: l.restock })),
          refund_method: method,
          refund_reference: reference.trim() || null,
          reason: reason.trim(),
        },
        pin,
      );
      toast.success(r.credit_note ? tl("Retour enregistré : avoir {0} imprimé.", [r.credit_note.number]) : tl("Retour enregistré : {0} rendus.", [money(r.total)]));
      if (settings) printReturn(r, settings);
      onDone(r);
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };

  const ready = amount > 0 && reason.trim() !== "" && lines.some((l) => l.quantity > 0);
  return (
    <Modal
      title={<><Undo2 size={18} />  {tl("Retour d'articles")} — {sale.number}</>}
      onClose={onClose}
      width={720}
      footer={
        <>
          <button className="btn" onClick={onClose}>{tl("Fermer")}</button>
          <button className="btn btn-primary" disabled={!ready || busy} onClick={submit}>
            {busy ? tl("Enregistrement…") : tl("Rendre {0}", [money(amount)])}</button>
        </>
      }
    >
      {user?.role !== "cashier" && (
        <div className="alert alert-warning small">{tl("Le retour se fait à la caisse : connectez-vous avec le compte de la caissière (caisse ouverte). Vous validerez ensuite avec votre PIN.")}</div>
      )}
      <table className="table compact">
        <thead><tr><th>{tl("Article")}</th><th className="num">{tl("Vendu")}</th><th className="num">{tl("À retourner")}</th><th>{tl("État")}</th></tr></thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.id}>
              <td>{l.name}</td>
              <td className="num">{qty(l.sold)} {l.unit}{l.sold !== l.left && <div className="small muted">{tl("déjà rendu : {0}", [qty(l.sold - l.left)])}</div>}</td>
              <td className="num">
                <input type="number" min={0} max={l.left} step="any" style={{ width: 90 }} disabled={l.left <= 0}
                  value={l.quantity || ""} placeholder="0"
                  onChange={(e) => set(l.id, { quantity: Math.max(0, Math.min(l.left, Number(e.target.value) || 0)) })} />
              </td>
              <td>
                <select value={l.restock ? "1" : "0"} onChange={(e) => set(l.id, { restock: e.target.value === "1" })} disabled={l.quantity <= 0}>
                  <option value="1">{tl("Remis en rayon")}</option>
                  <option value="0">{tl("Abîmé (perte)")}</option>
                </select>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="form-grid" style={{ marginTop: 12 }}>
        <Field label={tl("Remboursement")}>
          <select value={method} onChange={(e) => setMethod(e.target.value)}>
            {methods.map((m) => (
              <option key={m} value={m}>{m === "credit_note" ? tl("Avoir (bon à utiliser en caisse)") : paymentLabel(m)}</option>
            ))}
          </select>
        </Field>
        {method !== "cash" && method !== "credit_note" && method !== "debt" && (
          <Field label={tl("ID de la transaction de remboursement")}>
            <input value={reference} onChange={(e) => setReference(e.target.value)} />
          </Field>
        )}
        <Field label={tl("Motif du retour *")}>
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={tl("Ex. article défectueux, erreur de taille…")} />
        </Field>
      </div>
      {onCredit && <p className="muted small">{tl("Vente faite à crédit : le montant rendu se déduit de la dette du client.")}</p>}
      <p className="muted small">{tl("Retour possible jusqu'à {0} jours après la vente ; un avoir est valable {1} jours.", [settings?.return_days ?? "7", settings?.credit_note_days ?? "90"])}</p>
    </Modal>
  );
}
