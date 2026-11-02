import { useEffect, useState, type FormEvent } from "react";
import QRCode from "qrcode";
import { ArrowLeft, CircleCheck, Copy, CreditCard, Hourglass, Smartphone, Ticket } from "lucide-react";
import { api } from "../api";
import { errorMessage, useApp } from "../context/AppContext";
import { Badge } from "./ui";
import { fcfa, isoDateTime, setLicense } from "../lib/license";
import type { AccountOptions, CardStart, LicenseStatus, SubscriptionMethod, PlanCode, PlanInfo, SubscriptionPayment } from "../types";

export const METHOD_LABELS: Record<string, string> = {
  carte_bon: "Carte de bon",
  orange_money: "Orange Money",
  carte_visa: "Carte Visa",
  moov_money: "Moov Money",
  virement: "Virement",
  especes: "Espèces",
  autre: "Autre",
};

/** « y7eg9d6zdfp998t0 » → « Y7EG-9D6Z-DFP9-98T0 » (16 caractères au plus). */
export function formatVoucher(s: string): string {
  return s.toUpperCase().replace(/[^0-9A-Z]/g, "").slice(0, 16).replace(/(.{4})(?=.)/g, "$1-");
}

/** Licence à jour après un paiement validé (la boutique voit tout de suite sa nouvelle formule). */
async function refreshAfterPayment(): Promise<string | null> {
  try {
    setLicense(await api.licenseSync());
    return null;
  } catch (e) {
    return errorMessage(e);
  }
}

/**
 * Paiement de l'abonnement en 2 étapes : moyen de paiement, puis formule et instructions.
 * Carte de bon : activation immédiate. Orange Money : validé par Eden Dev. Carte Visa : automatique.
 */
export function SubscriptionPay({ options, lic, onChange }: { options: AccountOptions; lic: LicenseStatus; onChange: () => void }) {
  const [method, setMethod] = useState<SubscriptionMethod | null>(null);
  const pay = options.payment;
  const choose = (m: SubscriptionMethod) => setMethod(m);

  return (
    <div className="card" id="payer">
      <h3 className="card-title"><CreditCard size={18} /> Payer ou renouveler l'abonnement</h3>
      {!method ? (
        <>
          <p className="muted">Choisissez le moyen de paiement.</p>
          <div className="pay-methods">
            <button type="button" className="pay-method" onClick={() => choose("carte_bon")}>
              <Ticket size={26} />
              <strong>Carte de bon</strong>
              <span className="small muted">Code à 16 caractères acheté chez Eden Dev ou un revendeur. Activation immédiate.</span>
            </button>
            <button type="button" className="pay-method" onClick={() => choose("orange_money")}>
              <Smartphone size={26} />
              <strong>Orange Money</strong>
              <span className="small muted">Code marchand Sarali ou QR code. Validé par Eden Dev.</span>
            </button>
            <button type="button" className="pay-method" onClick={() => choose("carte_visa")} disabled={!pay?.card_enabled}>
              <CreditCard size={26} />
              <strong>Carte Visa</strong>
              <span className="small muted">
                {pay?.card_enabled ? "Page de paiement sécurisée de Visa. Activation automatique." : "Bientôt disponible."}
              </span>
            </button>
          </div>
        </>
      ) : (
        <>
          <button type="button" className="link-btn" onClick={() => setMethod(null)}><ArrowLeft size={15} /> Changer de moyen de paiement</button>
          {method === "carte_bon" && <VoucherForm onChange={onChange} />}
          {method === "orange_money" && <OrangeMoneyForm options={options} lic={lic} onChange={onChange} />}
          {method === "carte_visa" && <CardForm options={options} lic={lic} onChange={onChange} />}
        </>
      )}
    </div>
  );
}

function VoucherForm({ onChange }: { onChange: () => void }) {
  const { toast } = useApp();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const r = await api.accountRedeemVoucher(code);
      const v = r.voucher;
      const syncError = r.sync_error ?? (await refreshAfterPayment());
      setDone(
        `Carte acceptée : formule ${v.plan_label}, ${v.months} mois, jusqu'au ${isoDateTime(v.ends_at)}.` +
          (syncError ? ` La licence sera téléchargée dès que possible (${syncError}).` : " La licence de ce PC est à jour."),
      );
      setCode("");
      toast.success(`Carte de bon activée : ${v.plan_label} ${v.months} mois.`);
      onChange();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="pay-step">
      <p className="muted">
        Grattez la carte et saisissez le code de 16 caractères. La formule et la durée sont celles de la carte ; une formule supérieure
        s'applique tout de suite, sinon la période s'ajoute à la suite de l'abonnement en cours.
      </p>
      <label className="field">
        <span className="field-label">Code de la carte *</span>
        <input
          className="voucher-input mono"
          value={code}
          onChange={(e) => setCode(formatVoucher(e.target.value))}
          placeholder="XXXX-XXXX-XXXX-XXXX"
          autoComplete="off"
          spellCheck={false}
          autoFocus
        />
      </label>
      {error && <div className="alert alert-danger">{error}</div>}
      {done && <div className="alert alert-success">{done}</div>}
      <div className="row-end">
        <button className="btn btn-primary" disabled={busy || code.replace(/-/g, "").length !== 16}>
          {busy ? "Vérification…" : "Activer la carte"}
        </button>
      </div>
    </form>
  );
}

/** Formule et durée ; indique quand la nouvelle période commencera. */
function PlanPicker({
  options,
  lic,
  plan,
  setPlan,
  months,
  setMonths,
}: {
  options: AccountOptions;
  lic: LicenseStatus;
  plan: PlanCode;
  setPlan: (p: PlanCode) => void;
  months: number;
  setMonths: (m: number) => void;
}) {
  const plans = options.plans.filter((p) => p.code !== "free");
  const rank = (code: string) => options.plans.findIndex((p) => p.code === code);
  const current = lic.phase === "active" && lic.plan !== "free" ? lic.plan : null;
  const chosen = plans.find((p) => p.code === plan);
  let when = "La nouvelle période commence dès la validation du paiement.";
  if (current && chosen) {
    const label = plans.find((p) => p.code === current)?.label ?? current.toUpperCase();
    if (rank(plan) > rank(current)) {
      when = `Formule supérieure : ${chosen.label} s'applique dès la validation ; les jours restants de ${label} sont convertis en jours de ${chosen.label}.`;
    } else if (plan === current) {
      when = `La période s'ajoute à la suite de votre abonnement ${label} en cours (jusqu'au ${isoDateTime(lic.expires_at)}).`;
    } else {
      when = `${chosen.label} commencera à la fin de votre abonnement ${label} (le ${isoDateTime(lic.expires_at)}).`;
    }
  }
  return (
    <>
      <div className="plan-choices">
        {plans.map((p: PlanInfo) => (
          <button type="button" key={p.code} className={`plan-choice${plan === p.code ? " active" : ""}`} onClick={() => setPlan(p.code)}>
            <strong>{p.label}</strong>
            <span>{fcfa(p.price_month)} / mois</span>
            <span className="small muted">{p.max_postes} poste(s){p.code === current ? " · formule actuelle" : ""}</span>
          </button>
        ))}
      </div>
      <div className="segmented">
        {[1, 3, 6].map((m) => (
          <button type="button" key={m} className={months === m ? "active" : ""} onClick={() => setMonths(m)}>{m} mois</button>
        ))}
      </div>
      <div className="pay-amount">
        <span className="muted small">Montant à payer</span>
        <strong className="licence-amount">{fcfa((chosen?.price_month ?? 0) * months)}</strong>
        <span className="muted small">{when}</span>
      </div>
    </>
  );
}

function usePlanChoice(options: AccountOptions, lic: LicenseStatus) {
  const plans = options.plans.filter((p) => p.code !== "free");
  const initial = (lic.plan !== "free" && plans.some((p) => p.code === lic.plan) ? lic.plan : null) ?? (plans.find((p) => p.code === "pro")?.code ?? plans[0]?.code ?? "starter");
  const [plan, setPlan] = useState<PlanCode>(initial);
  const [months, setMonths] = useState(1);
  const amount = (plans.find((p) => p.code === plan)?.price_month ?? 0) * months;
  return { plan, setPlan, months, setMonths, amount };
}

function OrangeMoneyForm({ options, lic, onChange }: { options: AccountOptions; lic: LicenseStatus; onChange: () => void }) {
  const { toast } = useApp();
  const choice = usePlanChoice(options, lic);
  const pay = options.payment;
  const merchant = pay?.om_merchant_code?.trim() ?? "";
  const [qr, setQr] = useState<string | null>(null);
  const [reference, setReference] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");

  useEffect(() => {
    const payload = pay?.om_qr_payload?.trim();
    if (!payload) return setQr(null);
    QRCode.toDataURL(payload, { margin: 1, width: 360, errorCorrectionLevel: "M" }).then(setQr).catch(() => setQr(null));
  }, [pay?.om_qr_payload]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const r = await api.accountDeclareOrangeMoney({ plan: choice.plan, months: choice.months, reference, payer_phone: phone });
      setDone(
        `Paiement envoyé à Eden Dev : ${r.plan_label}, ${r.months} mois, ${fcfa(r.amount)}. Dès sa validation, la licence de ce PC se met à jour toute seule (vérification toutes les 2 minutes).`,
      );
      setReference("");
      toast.success("Paiement Orange Money envoyé à Eden Dev.");
      onChange();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="pay-step">
      <PlanPicker options={options} lic={lic} {...choice} />
      {merchant ? (
        <div className="om-pay">
          <ol className="om-pay-steps">
            <li>
              Payez <strong>{fcfa(choice.amount)}</strong> avec Orange Money (application Orange Money ou <span className="mono">#144#</span>, paiement
              marchand) au code marchand{" "}
              <strong className="mono">{merchant}</strong>
              <button type="button" className="icon-btn" aria-label="Copier le code marchand" onClick={() => navigator.clipboard?.writeText(merchant).then(() => toast.info("Code marchand copié."))}>
                <Copy size={14} />
              </button>
              {pay?.om_merchant_name ? ` (${pay.om_merchant_name})` : ""}{qr ? ", ou scannez le QR code" : ""}.
            </li>
            <li>Saisissez ci-dessous l'ID de la transaction reçu par SMS.</li>
            <li>Eden Dev vérifie le paiement et le valide : la licence se met à jour toute seule.</li>
          </ol>
          {qr && <img className="om-pay-qr" src={qr} alt="QR code marchand Orange Money d'Eden Dev" />}
        </div>
      ) : (
        <div className="alert alert-warning">Le code marchand Orange Money d'Eden Dev n'est pas encore configuré : contactez Eden Dev ou utilisez une carte de bon.</div>
      )}
      <div className="form-grid">
        <label className="field">
          <span className="field-label">ID de la transaction *</span>
          <input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Reçu par SMS" autoComplete="off" spellCheck={false} />
        </label>
        <label className="field">
          <span className="field-label">Numéro qui a payé</span>
          <input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" />
        </label>
      </div>
      {error && <div className="alert alert-danger">{error}</div>}
      {done && <div className="alert alert-success">{done}</div>}
      <div className="row-end">
        <button className="btn btn-primary" disabled={busy || !merchant || reference.trim().length < 6}>
          {busy ? "Envoi…" : "J'ai payé : envoyer l'ID de transaction"}
        </button>
      </div>
    </form>
  );
}

function CardForm({ options, lic, onChange }: { options: AccountOptions; lic: LicenseStatus; onChange: () => void }) {
  const { toast } = useApp();
  const choice = usePlanChoice(options, lic);
  const [busy, setBusy] = useState(false);
  const [waiting, setWaiting] = useState<CardStart | null>(null);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");

  // Suivi du paiement : Cybersource envoie le résultat à Eden Dev, l'application le lit toutes les 5 s.
  useEffect(() => {
    if (!waiting) return;
    const started = Date.now();
    let stopped = false;
    const timer = window.setInterval(async () => {
      if (stopped) return;
      if (Date.now() - started > 20 * 60_000) {
        stopped = true;
        window.clearInterval(timer);
        setWaiting(null);
        setError("Aucune réponse de la page de paiement après 20 minutes. Si vous avez payé, le paiement apparaîtra dans « Mes paiements ».");
        onChange();
        return;
      }
      try {
        const p = (await api.accountPayments()).find((x) => x.id === waiting.payment_id);
        if (!p || p.status === "pending" || stopped) return;
        stopped = true;
        window.clearInterval(timer);
        setWaiting(null);
        onChange();
        if (p.status === "validated") {
          const syncError = await refreshAfterPayment();
          setDone(`Paiement par carte accepté : ${p.plan_label}, ${p.months} mois, jusqu'au ${isoDateTime(p.ends_at)}.` + (syncError ? ` Licence pas encore téléchargée (${syncError}).` : " La licence de ce PC est à jour."));
          toast.success("Paiement par carte accepté.");
        } else if (p.status === "declared") {
          setDone("Paiement reçu, en vérification par Eden Dev. La licence se mettra à jour dès la validation.");
        } else {
          setError(p.note || "Paiement par carte refusé ou annulé.");
        }
      } catch {
        // Internet coupé un instant : on réessaie au prochain tour.
      }
    }, 5000);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [waiting]);

  const start = async () => {
    setBusy(true);
    setError("");
    setDone("");
    try {
      setWaiting(await api.accountCardStart(choice.plan, choice.months));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (waiting) {
    return (
      <div className="pay-step pay-waiting">
        <Hourglass size={30} />
        <strong>Page de paiement ouverte dans votre navigateur</strong>
        <p className="muted">
          Payez {fcfa(waiting.amount)} ({waiting.plan_label}, {waiting.months} mois) sur la page sécurisée de Visa, puis revenez ici : la licence se met à jour
          dès que le paiement est accepté.
        </p>
        <button type="button" className="btn" onClick={() => setWaiting(null)}>Arrêter d'attendre</button>
      </div>
    );
  }

  return (
    <div className="pay-step">
      <PlanPicker options={options} lic={lic} {...choice} />
      <p className="muted small">
        Le paiement se fait sur la page sécurisée de Visa (Cybersource) dans votre navigateur, avec la vérification de votre banque (code par SMS).
        Le numéro de carte ne passe jamais par GestiMarket.
      </p>
      {error && <div className="alert alert-danger">{error}</div>}
      {done && <div className="alert alert-success">{done}</div>}
      <div className="row-end">
        <button type="button" className="btn btn-primary" disabled={busy || choice.amount <= 0} onClick={start}>
          <CreditCard size={16} /> {busy ? "Ouverture…" : `Payer ${fcfa(choice.amount)} par carte Visa`}
        </button>
      </div>
    </div>
  );
}

function statusBadge(p: SubscriptionPayment) {
  switch (p.status) {
    case "validated":
      return <Badge tone="success">validé</Badge>;
    case "declared":
      return <Badge tone="warning">en attente de validation</Badge>;
    case "pending":
      return p.abandoned ? <Badge>abandonné</Badge> : <Badge tone="info">paiement en cours</Badge>;
    default:
      return <Badge tone="danger">refusé</Badge>;
  }
}

/** Derniers paiements de la boutique et leur état. */
export function PaymentsHistory({ refreshKey }: { refreshKey: number }) {
  const [list, setList] = useState<SubscriptionPayment[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api
      .accountPayments()
      .then((l) => {
        setList(l);
        setError("");
      })
      .catch((e) => setError(errorMessage(e)));
  }, [refreshKey]);

  if (error) return <p className="muted small">Paiements indisponibles pour l'instant : {error}</p>;
  if (!list?.length) return null;
  return (
    <div className="card">
      <h3 className="card-title"><CircleCheck size={18} /> Mes paiements</h3>
      <div className="table-scroll">
        <table className="table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Moyen</th>
              <th>Formule</th>
              <th className="num">Montant</th>
              <th>État</th>
            </tr>
          </thead>
          <tbody>
            {list.map((p) => (
              <tr key={p.id}>
                <td>{isoDateTime(p.created_at)}</td>
                <td>{METHOD_LABELS[p.method] ?? p.method}</td>
                <td>{p.plan_label}{p.months ? `, ${p.months} mois` : ""}</td>
                <td className="num">{fcfa(p.amount)}</td>
                <td>
                  {statusBadge(p)}
                  {p.status === "validated" && p.ends_at && <div className="small muted">jusqu'au {isoDateTime(p.ends_at)}</div>}
                  {p.status === "refused" && p.note && <div className="small muted">{p.note}</div>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
