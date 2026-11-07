/**
 * Compte client et programme client fidèle (0.19).
 *
 * - Solde du compte : > 0 dette du client, < 0 fonds qu'il a déposés à la boutique.
 * - Versement : rembourse d'abord la dette, le reste devient des fonds (dépensés en caisse).
 * - Fonds rendus : le client reprend son argent, validé par le PIN d'un responsable.
 * - Client fidèle (PRO, BUSINESS) : étoiles de 0 à 5, bonus utilisable en caisse, carte avec QR code.
 */
import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { Printer, Star } from "lucide-react";
import { api } from "../api";
import { useApp } from "../context/AppContext";
import { Badge, Empty, Field, Modal } from "./ui";
import { currencySymbol, dateTime, minorToInput, money, operatorMethods, paymentLabel, toMinor } from "../lib/format";
import { useLicense } from "../lib/license";
import { printHtml } from "../lib/receipt";
import type { Customer, LoyaltyMove } from "../types";
import { tl, ts } from "../lib/i18n";

/** Programme client fidèle en marche : activé par la boutique et inclus dans sa formule (PRO, BUSINESS). */
export function useLoyaltyActive(): boolean {
  const { settings } = useApp();
  const lic = useLicense();
  const enabled = settings.loyalty_enabled === "1";
  if (!lic) return enabled;
  return enabled && (lic.plan === "pro" || lic.plan === "business");
}

/** Étoiles du client (0 à 5). */
export function Stars({ value, size = 14 }: { value: number; size?: number }) {
  const n = Math.max(0, Math.min(5, value));
  return (
    <span className="stars" title={tl("{0} étoile(s) sur 5", [n])} aria-label={tl("{0} étoile(s) sur 5", [n])}>
      {[0, 1, 2, 3, 4].map((i) => (
        <Star key={i} size={size} className={i < n ? "on" : ""} fill={i < n ? "currentColor" : "none"} />
      ))}
    </span>
  );
}

/** Solde du compte : dette en rouge, fonds en vert. */
export function AccountBalance({ balance }: { balance: number }) {
  if (balance > 0) return <Badge tone="danger">{tl("Dette")} {money(balance)}</Badge>;
  if (balance < 0) return <Badge tone="success">{tl("Fonds")} {money(-balance)}</Badge>;
  return <span className="muted">—</span>;
}

/** Texte du solde : « Dette : 3 000 FCFA », « Fonds : 5 000 FCFA ». */
export function balanceText(balance: number): string {
  if (balance > 0) return tl("Dette : {0}", [money(balance)]);
  if (balance < 0) return tl("Fonds : {0}", [money(-balance)]);
  return tl("Compte à zéro");
}

function MethodSelect({ value, onChange }: { value: string; onChange: (m: string) => void }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="cash">{tl("Espèces")}</option>
      <option value="orange_money">{paymentLabel("orange_money")}</option>
      {operatorMethods().map((m) => (
        <option key={m} value={m}>{paymentLabel(m)}</option>
      ))}
      <option value="mobile_money">{paymentLabel("mobile_money")}</option>
      <option value="card">{tl("Carte bancaire")}</option>
      <option value="other">{tl("Autre")}</option>
    </select>
  );
}

/** Versement du client : rembourse d'abord sa dette, puis ajoute des fonds sur son compte. */
export function DepositModal({ customer, onClose, onSaved }: { customer: Customer; onClose: () => void; onSaved: (c: Customer) => void }) {
  const { toast } = useApp();
  const [amount, setAmount] = useState(customer.balance > 0 ? minorToInput(customer.balance) : "");
  const [method, setMethod] = useState("cash");
  const [reference, setReference] = useState("");
  const [phone, setPhone] = useState(customer.phone ?? "");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const value = toMinor(amount || "0");
  const debt = Math.max(0, customer.balance);
  const after = customer.balance - value;
  const submit = async () => {
    if (value <= 0 || busy) return;
    setBusy(true);
    try {
      const c = await api.recordCustomerPayment({
        customer_id: customer.id,
        amount: value,
        method,
        reference: method === "cash" ? null : reference.trim() || null,
        phone: method === "cash" ? null : phone.trim() || null,
        note: note || null,
      });
      toast.success(tl("Versement enregistré. {0}", [balanceText(c.balance)]));
      onSaved(c);
    } catch (e) {
      toast.error(e);
      setBusy(false);
    }
  };
  return (
    <Modal
      title={tl("Versement de {0}", [customer.name])}
      onClose={onClose}
      width={480}
      footer={
        <>
          <button className="btn" onClick={onClose}>{tl("Annuler")}</button>
          <button className="btn btn-primary" disabled={value <= 0 || busy} onClick={submit}>{tl("Encaisser le versement")}</button>
        </>
      }
    >
      <div className={`alert ${customer.balance > 0 ? "alert-warning" : "alert-info"}`}>
        {tl("Compte actuel :")} <strong>{balanceText(customer.balance)}</strong>
        <div className="small">{tl("Le versement rembourse d'abord la dette ; le reste devient des fonds, dépensés ensuite en caisse avec « Compte client ».")}</div>
      </div>
      <div className="form-grid one">
        <Field label={tl("Montant reçu ({0})", [currencySymbol()])}>
          <input className="input-lg" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus onKeyDown={(e) => e.key === "Enter" && submit()} />
        </Field>
        {value > 0 && (
          <p className="muted small" style={{ margin: 0 }}>
            {debt > 0 && tl("Dette réglée : {0}. ", [money(Math.min(value, debt))])}
            {value > debt && tl("Fonds ajoutés : {0}. ", [money(value - debt)])}
            {tl("Après le versement : {0}", [balanceText(after)])}
          </p>
        )}
        <Field label={tl("Mode de paiement")}>
          <MethodSelect value={method} onChange={setMethod} />
        </Field>
        {method !== "cash" && method !== "other" && (
          <>
            <Field label={tl("ID de transaction")} hint={tl("Saisissez ou scannez la référence de la confirmation.")}>
              <input className="mono" value={reference} onChange={(e) => setReference(e.target.value.trim())} />
            </Field>
            <Field label={tl("N° de téléphone du payeur")}><input value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
          </>
        )}
        <Field label={tl("Note")}><input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

/** Fonds rendus au client : espèces sorties du tiroir ou paiement mobile, PIN d'un gestionnaire. */
export function RefundFundsModal({ customer, onClose, onSaved }: { customer: Customer; onClose: () => void; onSaved: (c: Customer) => void }) {
  const { toast, askPin } = useApp();
  const funds = Math.max(0, -customer.balance);
  const [amount, setAmount] = useState(minorToInput(funds));
  const [method, setMethod] = useState("cash");
  const [reference, setReference] = useState("");
  const [phone, setPhone] = useState(customer.phone ?? "");
  const [note, setNote] = useState("");
  const value = toMinor(amount || "0");
  const submit = async () => {
    if (value <= 0 || value > funds) return;
    const pin = await askPin({ title: tl("Rendre des fonds à {0}", [customer.name]), level: "manager" });
    if (!pin) return;
    try {
      const c = await api.refundCustomerFunds(
        {
          customer_id: customer.id,
          amount: value,
          method,
          reference: method === "cash" ? null : reference.trim() || null,
          phone: method === "cash" ? null : phone.trim() || null,
          note: note || null,
        },
        pin,
      );
      toast.success(tl("Fonds rendus. {0}", [balanceText(c.balance)]));
      onSaved(c);
    } catch (e) {
      toast.error(e);
    }
  };
  return (
    <Modal
      title={tl("Rendre des fonds à {0}", [customer.name])}
      onClose={onClose}
      width={480}
      footer={
        <>
          <button className="btn" onClick={onClose}>{tl("Annuler")}</button>
          <button className="btn btn-primary" disabled={value <= 0 || value > funds} onClick={submit}>{tl("Rendre les fonds")}</button>
        </>
      }
    >
      <div className="alert alert-info">
        {tl("Fonds disponibles :")} <strong>{money(funds)}</strong>
        <div className="small">{tl("L'argent sort de votre caisse (espèces) ou part par paiement mobile. Validation par le PIN d'un gestionnaire.")}</div>
      </div>
      <div className="form-grid one">
        <Field label={tl("Montant rendu ({0})", [currencySymbol()])}>
          <input className="input-lg" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
        </Field>
        {value > funds && <div className="alert alert-danger">{tl("Le client n'a que {0} de fonds.", [money(funds)])}</div>}
        <Field label={tl("Mode de remboursement")}>
          <MethodSelect value={method} onChange={setMethod} />
        </Field>
        {method !== "cash" && method !== "other" && (
          <>
            <Field label={tl("ID de transaction")}>
              <input className="mono" value={reference} onChange={(e) => setReference(e.target.value.trim())} />
            </Field>
            <Field label={tl("N° de téléphone du client")}><input value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
          </>
        )}
        <Field label={tl("Note")}><input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

const esc = (s: string | null | undefined) =>
  (s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Carte de fidélité du client : QR code lu par la douchette ou le scanner du téléphone en caisse. */
export function LoyaltyCardModal({ customer, onClose }: { customer: Customer; onClose: () => void }) {
  const { toast, settings } = useApp();
  const [code, setCode] = useState(customer.card_code);
  const [qr, setQr] = useState("");
  useEffect(() => {
    if (code) return;
    api.customerCard(customer.id).then(setCode).catch(toast.error);
  }, [code, customer.id, toast]);
  useEffect(() => {
    if (code) QRCode.toDataURL(code, { margin: 1, width: 240 }).then(setQr).catch(() => setQr(""));
  }, [code]);
  const print = () => {
    if (!code || !qr) return;
    const stars = "★".repeat(customer.stars) + "☆".repeat(5 - customer.stars);
    printHtml(
      `<div class="loyalty-card">
        <div class="lc-shop">${esc(settings.shop_name)}</div>
        <div class="lc-title">${esc(ts("Carte de fidélité"))}</div>
        <img src="${qr}" alt="" />
        <div class="lc-name">${esc(customer.name)}</div>
        <div class="lc-stars">${stars}</div>
        <div class="lc-code">${esc(code)}</div>
      </div>`,
      86,
    );
  };
  return (
    <Modal
      title={tl("Carte de fidélité — {0}", [customer.name])}
      onClose={onClose}
      width={420}
      footer={
        <>
          <button className="btn" onClick={onClose}>{tl("Fermer")}</button>
          <button className="btn btn-primary" disabled={!qr} onClick={print}><Printer size={16} />  {tl("Imprimer la carte")}</button>
        </>
      }
    >
      <div className="loyalty-card-preview">
        {qr ? <img src={qr} alt={code ?? ""} width={200} height={200} /> : <div className="muted">{tl("Préparation…")}</div>}
        <strong>{customer.name}</strong>
        <Stars value={customer.stars} size={18} />
        <span className="mono">{code}</span>
        <p className="muted small">{tl("En caisse, scannez cette carte (douchette ou caméra) : le client est choisi tout seul, avec son compte et son bonus.")}</p>
      </div>
    </Modal>
  );
}

/** Libellé d'un mouvement du bonus (traduit à l'affichage). */
function moveLabel(kind: LoyaltyMove["kind"]): string {
  const labels: Record<LoyaltyMove["kind"], string> = {
    earn: tl("Bonus gagné"),
    spend: tl("Bonus dépensé"),
    cancel: tl("Vente annulée"),
    return: tl("Retour d'articles"),
    expire: tl("Bonus expiré"),
    convert: tl("Anciens points convertis"),
    debt_paid: tl("Dette réglée"),
  };
  return labels[kind] ?? kind;
}

/** Historique du bonus fidélité d'un client. */
export function LoyaltyHistory({ customerId }: { customerId: number }) {
  const { toast } = useApp();
  const [moves, setMoves] = useState<LoyaltyMove[] | null>(null);
  useEffect(() => {
    api.customerLoyaltyHistory(customerId).then(setMoves).catch(toast.error);
  }, [customerId, toast]);
  if (moves === null) return null;
  if (moves.length === 0) return <Empty title={tl("Pas encore de bonus")} />;
  return (
    <table className="table compact">
      <thead><tr><th>{tl("Date")}</th><th>{tl("Opération")}</th><th>{tl("Vente")}</th><th className="num">{tl("Bonus")}</th></tr></thead>
      <tbody>
        {moves.map((m) => (
          <tr key={m.id}>
            <td className="nowrap">{dateTime(m.created_at)}</td>
            <td>{moveLabel(m.kind)}{m.note && <div className="muted small">{m.note}</div>}</td>
            <td className="mono">{m.sale_number ?? "—"}</td>
            <td className={`num ${m.amount > 0 ? "text-success" : "text-danger"}`}>{`${m.amount > 0 ? "+" : ""}${money(m.amount)}`}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
