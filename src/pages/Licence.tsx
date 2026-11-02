import { useEffect, useState } from "react";
import { BadgeCheck, Check, Copy, FileUp, RefreshCw, Store, X } from "lucide-react";
import { api } from "../api";
import { useApp } from "../context/AppContext";
import { Badge, Modal, PageHeader } from "../components/ui";
import { AccountForm } from "../components/AccountForm";
import { PaymentsHistory, SubscriptionPay } from "../components/SubscriptionPay";
import { isRemote, isTauri } from "../lib/transport";
import { FEATURE_LABELS, fcfa, isoDateTime, refreshLicense, setLicense, useLicense } from "../lib/license";
import type { AccountLinkResult, AccountOptions, LicenseFeature, PlanCode } from "../types";

const FEATURES = Object.keys(FEATURE_LABELS) as LicenseFeature[];

/** Abonnement de la boutique : formule, licence de ce PC, compte Eden Dev et paiement. */
export default function LicencePage() {
  const { toast } = useApp();
  const lic = useLicense();
  const [options, setOptions] = useState<AccountOptions | null>(null);
  const [busy, setBusy] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
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
      toast.success(s.read_only ? "Vérification faite : aucune licence active pour l'instant." : `Licence à jour : ${s.plan_label}.`);
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
        toast.success(`Licence installée : ${s.plan_label}, jusqu'au ${isoDateTime(s.expires_at)}.`);
      } catch (e) {
        toast.error(e);
      }
    };
    input.click();
  };

  const linked = (r: AccountLinkResult) => {
    setAccountOpen(false);
    toast.success(`Ce PC est relié à la boutique ${r.store?.name ?? ""} (${r.store?.code ?? ""}).`);
    if (r.sync_error) toast.error(`Licence pas encore téléchargée : ${r.sync_error}`);
    refreshLicense();
  };

  if (!lic) {
    return (
      <div className="page narrow">
        <PageHeader title="Abonnement & licence" />
        <p className="muted">Chargement…</p>
      </div>
    );
  }

  const linkedAccount = !!lic.account.store_code;
  return (
    <div className="page narrow">
      <PageHeader
        title="Abonnement & licence"
        subtitle="Formule de la boutique, licence de ce PC et compte Eden Dev. Aucune donnée commerciale n'est envoyée à Eden Dev."
        actions={
          onThisPc && (
            <>
              <button className="btn" onClick={importFile}><FileUp size={16} /> Importer un fichier</button>
              <button className="btn btn-primary" onClick={sync} disabled={busy}><RefreshCw size={16} /> {busy ? "Vérification…" : "Vérifier maintenant"}</button>
            </>
          )
        }
      />

      <div className="card">
        <h3 className="card-title">
          <BadgeCheck size={18} /> Formule {lic.plan_label}
          <Badge tone={lic.read_only ? "danger" : lic.level === "warning" ? "warning" : "success"}>
            {lic.phase === "expired" ? "expirée" : lic.read_only ? "lecture seule" : "active"}
          </Badge>
        </h3>
        <div className={`alert ${lic.read_only || lic.level === "danger" ? "alert-danger" : lic.level === "warning" ? "alert-warning" : "alert-success"}`}>
          {lic.warning && lic.warning !== lic.message ? `${lic.message} ${lic.warning}` : lic.message}
        </div>
        {lic.clock_warning && <div className="alert alert-warning">{lic.clock_warning}</div>}
        {lic.load_error && <div className="alert alert-danger">Licence enregistrée refusée : {lic.load_error}</div>}
        <div className="licence-grid">
          <div>
            <span className="muted small">Boutique</span>
            <strong>{lic.store_name || lic.account.store_name || "—"}</strong>
            <span className="small">{lic.store_code || lic.account.store_code}</span>
          </div>
          <div>
            <span className="muted small">Valable jusqu'au</span>
            <strong>{isoDateTime(lic.expires_at)}</strong>
            {lic.days_left !== null && lic.phase === "active" && <span className="small">{lic.days_left} jour(s) restant(s)</span>}
          </div>
          <div>
            <span className="muted small">Postes connectés</span>
            <strong>{lic.postes_used ?? "—"} / {lic.max_postes}</strong>
            <span className="small">PC, téléphones et tablettes</span>
          </div>
          <div>
            <span className="muted small">Identifiant de ce PC</span>
            <strong className="mono">{lic.pc_id || "—"}</strong>
            {lic.pc_id && (
              <button className="link-btn small" onClick={() => navigator.clipboard?.writeText(lic.pc_id).then(() => toast.info("Identifiant copié."))}>
                <Copy size={13} /> Copier
              </button>
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
          {lic.last_sync ? `Dernière vérification auprès d'Eden Dev : ${lic.last_sync}.` : "Pas encore vérifiée auprès d'Eden Dev."}
          {lic.last_sync_error ? ` Dernière erreur : ${lic.last_sync_error}` : ""}
          {lic.remote_status === "none" && " Aucun abonnement en cours chez Eden Dev."}
          {lic.remote_status === "suspended" && " Boutique suspendue par Eden Dev."}
          {" "}La licence est vérifiée sur ce PC, même sans Internet ; elle se met à jour toute seule après un paiement.
        </p>
      </div>

      {!onThisPc ? (
        <div className="alert alert-info">
          Le compte boutique, le paiement et l'import de licence se font sur le PC serveur de la boutique (menu Abonnement & licence).
        </div>
      ) : (
        <>
          <div className="card">
            <h3 className="card-title"><Store size={18} /> Compte boutique Eden Dev</h3>
            {linkedAccount ? (
              <>
                <p>
                  Ce PC est relié à <strong>{lic.account.store_name}</strong> ({lic.account.store_code}), compte <strong>{lic.account.email}</strong>.
                </p>
                <button className="btn" onClick={() => setAccountOpen(true)}>Changer de boutique ou de compte</button>
              </>
            ) : (
              <>
                <p className="muted">
                  Créez le compte de la boutique (essai gratuit) ou connectez-vous à votre compte pour relier ce PC. Internet est nécessaire
                  pour cette étape ; ensuite la licence fonctionne aussi hors ligne.
                </p>
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
        <Modal title="Compte boutique" onClose={() => setAccountOpen(false)} width={720}>
          <AccountForm onLinked={linked} startWith="login" />
        </Modal>
      )}
    </div>
  );
}

function PlansCard({ options, current }: { options: AccountOptions; current: PlanCode }) {
  return (
    <div className="card">
      <h3 className="card-title"><BadgeCheck size={18} /> Les formules</h3>
      <div className="table-scroll">
        <table className="table">
          <thead>
            <tr>
              <th>Fonction</th>
              {options.plans.map((p) => (
                <th key={p.code} className={p.code === current ? "plan-current" : ""}>{p.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Prix par mois</td>
              {options.plans.map((p) => (
                <td key={p.code}>{p.price_month ? fcfa(p.price_month) : "Gratuit"}</td>
              ))}
            </tr>
            <tr>
              <td>Postes simultanés</td>
              {options.plans.map((p) => (
                <td key={p.code}>{p.code === "business" ? `${p.max_postes} (selon contrat)` : p.max_postes}</td>
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
