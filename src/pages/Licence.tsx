import { useEffect, useState } from "react";
import { BadgeCheck, Check, Copy, FileUp, RefreshCw, Store, X } from "lucide-react";
import { api } from "../api";
import { useApp } from "../context/AppContext";
import { Badge, Modal, PageHeader } from "../components/ui";
import { AccountForm } from "../components/AccountForm";
import { ChangePasswordModal } from "../components/AccountPassword";
import { PaymentsHistory, SubscriptionPay } from "../components/SubscriptionPay";
import { isRemote, isTauri } from "../lib/transport";
import { FEATURE_LABELS, isoDateTime, planPrice, price, refreshLicense, setLicense, useLicense } from "../lib/license";
import type { AccountLinkResult, AccountOptions, LicenseFeature, PlanCode } from "../types";
import { tl, tm } from "../lib/i18n";

const FEATURES = Object.keys(FEATURE_LABELS) as LicenseFeature[];

/** Abonnement de la boutique : formule, licence de ce PC, compte Eden Dev et paiement. */
export default function LicencePage() {
  const { toast } = useApp();
  const lic = useLicense();
  const [options, setOptions] = useState<AccountOptions | null>(null);
  const [busy, setBusy] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  // Change après chaque paiement : la liste « Mes paiements » se recharge.
  const [paymentsKey, setPaymentsKey] = useState(0);
  // Le compte et le paiement se gèrent sur le PC qui détient la base (poste serveur ou poste unique).
  const onThisPc = isTauri && !isRemote();

  useEffect(() => {
    if (onThisPc) api.accountOptions().then(setOptions).catch(() => undefined);
  }, [onThisPc]);

  const sync = async () => {
    setBusy(true);
    try {
      const s = await api.licenseSync();
      setLicense(s);
      toast.success(s.read_only ? tl("Vérification faite : aucune licence active pour l'instant.") : tl("Licence à jour : {0}.", [s.plan_label]));
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
      refreshLicense();
    }
  };

  const importFile = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".gml,.json,application/json";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const s = await api.licenseImport(await file.text());
        setLicense(s);
        toast.success(tl("Licence installée : {0}, jusqu'au {1}.", [s.plan_label, isoDateTime(s.expires_at)]));
      } catch (e) {
        toast.error(e);
      }
    };
    input.click();
  };

  const linked = (r: AccountLinkResult) => {
    setAccountOpen(false);
    toast.success(tl("Ce PC est relié à la boutique {0} ({1}).", [r.store?.name ?? "", r.store?.code ?? ""]));
    if (r.sync_error) toast.error(tl("Licence pas encore téléchargée : {0}", [tm(r.sync_error)]));
    refreshLicense();
  };

  if (!lic) {
    return (
      <div className="page narrow">
        <PageHeader title={tl("Abonnement & licence")} />
        <p className="muted">{tl("Chargement…")}</p>
      </div>
    );
  }

  const linkedAccount = !!lic.account.store_code;
  return (
    <div className="page narrow">
      <PageHeader
        title={tl("Abonnement & licence")}
        subtitle={tl("Formule de la boutique, licence de ce PC et compte Eden Dev. Aucune donnée commerciale n'est envoyée à Eden Dev.")}
        actions={
          onThisPc && (
            <>
              <button className="btn" onClick={importFile}><FileUp size={16} />  {tl("Importer un fichier")}</button>
              <button className="btn btn-primary" onClick={sync} disabled={busy}><RefreshCw size={16} /> {busy ? tl("Vérification…") : tl("Vérifier maintenant")}</button>
            </>
          )
        }
      />

      <div className="card">
        <h3 className="card-title">
          <BadgeCheck size={18} />  {tl("Formule")} {lic.plan_label}
          <Badge tone={lic.read_only ? "danger" : lic.level === "warning" ? "warning" : "success"}>
            {lic.phase === "expired"
              ? tl("expirée")
              : lic.phase === "trial_over"
                ? tl("essai terminé")
                : lic.read_only
                  ? tl("lecture seule")
                  : lic.phase === "trial"
                    ? tl("essai sans Internet")
                    : tl("active")}
          </Badge>
        </h3>
        <div className={`alert ${lic.read_only || lic.level === "danger" ? "alert-danger" : lic.level === "warning" ? "alert-warning" : "alert-success"}`}>
          {lic.warning && lic.warning !== lic.message ? `${tm(lic.message)} ${tm(lic.warning)}` : tm(lic.message)}
        </div>
        {lic.clock_warning && <div className="alert alert-warning">{tm(lic.clock_warning)}</div>}
        {lic.load_error && <div className="alert alert-danger">{tl("Licence enregistrée refusée :")} {tm(lic.load_error)}</div>}
        <div className="licence-grid">
          <div>
            <span className="muted small">{tl("Boutique")}</span>
            <strong>{lic.store_name || lic.account.store_name || "—"}</strong>
            <span className="small">{lic.store_code || lic.account.store_code}</span>
          </div>
          <div>
            <span className="muted small">{tl("Valable jusqu'au")}</span>
            <strong>{isoDateTime(lic.expires_at)}</strong>
            {lic.days_left !== null && (lic.phase === "active" || lic.phase === "trial") && <span className="small">{lic.days_left}  {tl("jour(s) restant(s)")}</span>}
          </div>
          <div>
            <span className="muted small">{tl("Postes connectés")}</span>
            <strong>{lic.postes_used ?? "—"} / {lic.max_postes}</strong>
            <span className="small">{tl("PC, téléphones et tablettes")}</span>
          </div>
          <div>
            <span className="muted small">{tl("Identifiant de ce PC")}</span>
            <strong className="mono">{lic.pc_id || "—"}</strong>
            {lic.pc_id && (
              <button className="link-btn small" onClick={() => navigator.clipboard?.writeText(lic.pc_id).then(() => toast.info(tl("Identifiant copié.")))}>
                <Copy size={13} />  {tl("Copier")}</button>
            )}
          </div>
        </div>
        <ul className="feature-list">
          {FEATURES.map((f) => {
            const on = lic.features.includes(f);
            return (
              <li key={f} className={on ? "on" : "off"}>
                {on ? <Check size={15} /> : <X size={15} />} {FEATURE_LABELS[f]}
              </li>
            );
          })}
        </ul>
        <p className="muted small">
          {lic.last_sync ? tl("Dernière vérification auprès d'Eden Dev : {0}.", [lic.last_sync]) : tl("Pas encore vérifiée auprès d'Eden Dev.")}
          {lic.last_sync_error ? tl(" Dernière erreur : {0}", [tm(lic.last_sync_error)]) : ""}
          {lic.remote_status === "none" && tl(" Aucun abonnement en cours chez Eden Dev.")}
          {lic.remote_status === "suspended" && tl(" Boutique suspendue par Eden Dev.")}
          {" "}{tl("La licence est vérifiée sur ce PC, même sans Internet ; elle se met à jour toute seule après un paiement.")}</p>
      </div>

      {!onThisPc ? (
        <div className="alert alert-info">
          {tl("Le compte boutique, le paiement et l'import de licence se font sur le PC serveur de la boutique (menu Abonnement & licence).")}</div>
      ) : (
        <>
          <div className="card">
            <h3 className="card-title"><Store size={18} />  {tl("Compte boutique Eden Dev")}</h3>
            {linkedAccount ? (
              <>
                <p>
                  {tl("Ce PC est relié à")} <strong>{lic.account.store_name}</strong> ({lic.account.store_code}{tl("), compte")} <strong>{lic.account.email}</strong>.
                </p>
                <div className="row-start">
                  <button className="btn" onClick={() => setAccountOpen(true)}>{tl("Changer de boutique ou de compte")}</button>
                  <button className="btn" onClick={() => setPasswordOpen(true)}>{tl("Changer le mot de passe du compte")}</button>
                </div>
                {passwordOpen && <ChangePasswordModal email={lic.account.email} onClose={() => setPasswordOpen(false)} />}
              </>
            ) : (
              <>
                <p className="muted">
                  {tl("Créez le compte de la boutique (essai gratuit) ou connectez-vous à votre compte pour relier ce PC. Internet est nécessaire pour cette étape ; ensuite la licence fonctionne aussi hors ligne.")}</p>
                <AccountForm onLinked={linked} />
              </>
            )}
          </div>

          {linkedAccount && options && <SubscriptionPay options={options} lic={lic} onChange={() => setPaymentsKey((k) => k + 1)} />}
          {linkedAccount && <PaymentsHistory refreshKey={paymentsKey} />}
        </>
      )}

      {options && <PlansCard options={options} current={lic.plan} />}

      {accountOpen && (
        <Modal title={tl("Compte boutique")} onClose={() => setAccountOpen(false)} width={720}>
          <AccountForm onLinked={linked} startWith="login" />
        </Modal>
      )}
    </div>
  );
}

function PlansCard({ options, current }: { options: AccountOptions; current: PlanCode }) {
  const { settings } = useApp();
  return (
    <div className="card">
      <h3 className="card-title"><BadgeCheck size={18} />  {tl("Les formules")}</h3>
      <div className="table-scroll">
        <table className="table">
          <thead>
            <tr>
              <th>{tl("Fonction")}</th>
              {options.plans.map((p) => (
                <th key={p.code} className={p.code === current ? "plan-current" : ""}>{p.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>{tl("Prix par mois")}</td>
              {options.plans.map((p) => (
                <td key={p.code}>{p.price_month ? price(planPrice(p, settings.currency_code).amount, planPrice(p, settings.currency_code).currency) : tl("Gratuit")}</td>
              ))}
            </tr>
            <tr>
              <td>{tl("Postes simultanés")}</td>
              {options.plans.map((p) => (
                <td key={p.code}>{p.code === "business" ? tl("{0} (selon contrat)", [p.max_postes]) : p.max_postes}</td>
              ))}
            </tr>
            {FEATURES.map((f) => (
              <tr key={f}>
                <td>{FEATURE_LABELS[f]}</td>
                {options.plans.map((p) => (
                  <td key={p.code}>{p.features.includes(f) ? <Check size={16} className="ok" /> : <X size={16} className="ko" />}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
