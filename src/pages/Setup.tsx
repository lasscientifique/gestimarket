import { useState, type FormEvent } from "react";
import { Printer, Store, Plus, X, RefreshCw, Users, WandSparkles } from "lucide-react";
import { api } from "../api";
import { errorMessage, useApp } from "../context/AppContext";
import { isMobileApp, isTauri } from "../lib/transport";
import { Modal } from "../components/ui";
import { NetworkForm } from "../components/NetworkForm";
import { BusinessTypeGrid, useBusinessProfiles } from "../components/BusinessType";
import { HelpTip } from "../components/Help";
import { AccountForm } from "../components/AccountForm";
import { RestoreBackupModal } from "../components/RestoreBackup";
import { TermsAccept } from "../components/Terms";
import { Scale } from "lucide-react";
import { PlanProposal, defaultProposal, proposalInput, type ProposalValue } from "../components/plan/PlanProposal";
import type { AccountLinkResult, Role, TeamMember } from "../types";
import { getLang, tl, tm } from "../lib/i18n";
import { countryOptions, currencyDecimals, currencyOf, currencyOptions, currencyPositionOf, currencySymbolOf } from "../lib/countries";
import { LanguageSwitch } from "../components/LanguageSwitch";
import { ROLE_LABELS } from "../lib/format";
import { pinProblem, randomPin } from "../lib/pin";
import { printAccessSheets } from "../lib/staffPrint";

type Step = "terms" | "account" | "shop" | "team" | "sheets" | "business" | "plan";

const digits = (v: string) => v.replace(/\D/g, "").slice(0, 6);

/** Équipe par défaut : un gestionnaire et une caissière, avec un PIN tiré au hasard. */
const defaultTeam = (): TeamMember[] => [
  { role: "manager", full_name: tl("Gestionnaire"), username: "gestionnaire", pin: randomPin(4) },
  { role: "cashier", full_name: tl("Caissière 1"), username: "caisse1", pin: randomPin(4) },
];

/** Identifiant libre pour un poste ajouté : gestionnaire2, caisse2… */
function nextUsername(team: TeamMember[], role: Role): string {
  const base = role === "manager" ? "gestionnaire" : "caisse";
  const taken = new Set(team.map((m) => m.username));
  for (let n = 1; ; n++) {
    const u = role === "manager" && n === 1 ? base : `${base}${n}`;
    if (!taken.has(u)) return u;
  }
}

/**
 * Première configuration : compte boutique (Eden Dev), commerce et administrateur (identifiant + PIN de
 * 6 chiffres), équipe par défaut (gestionnaire et caissière) avec ses fiches d'accès, activités de la
 * boutique, puis plan de départ proposé à la taille habituelle.
 */
export default function SetupPage({ onDone }: { onDone: () => void }) {
  const { setUser, refreshSettings, settings } = useApp();
  const [form, setForm] = useState({
    shop_name: "",
    shop_phone: "",
    shop_address: "",
    country: "ML",
    currency: "XOF",
    symbol: "FCFA",
    full_name: "",
    username: "admin",
    pin: "",
    confirm: "",
  });
  const [team, setTeam] = useState<TeamMember[]>(defaultTeam);
  const [created, setCreated] = useState<TeamMember[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [joinOpen, setJoinOpen] = useState(false);
  // Conditions d'utilisation d'abord, puis le compte boutique (licence d'essai), sauf dans un navigateur :
  // il se crée sur le PC serveur.
  const [step, setStep] = useState<Step>("terms");
  const [termsVersion, setTermsVersion] = useState<string | undefined>();
  const [accountNote, setAccountNote] = useState("");
  const [activities, setActivities] = useState<string[]>([]);
  const [seed, setSeed] = useState(true);
  const [proposal, setProposal] = useState<ProposalValue | null>(null);
  const profiles = useBusinessProfiles();
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });
  // Pays → devise usuelle et son symbole ; devise → son symbole.
  const setCountry = (country: string) => {
    const currency = currencyOf(country);
    setForm({ ...form, country, currency, symbol: currencySymbolOf(currency) });
  };
  const setCurrency = (currency: string) => setForm({ ...form, currency, symbol: currencySymbolOf(currency) });
  const countries = countryOptions();
  const currencies = currencyOptions();

  // Étape 2 : commerce et administrateur (rien n'est encore enregistré).
  const submitShop = (e: FormEvent) => {
    e.preventDefault();
    if (!form.shop_name.trim()) return setError(tl("Le nom du commerce est obligatoire."));
    if (!form.full_name.trim()) return setError(tl("Le nom de l'administrateur est obligatoire."));
    const problem = pinProblem(form.pin, true);
    if (problem) return setError(tm(problem));
    if (form.pin !== form.confirm) return setError(tl("Les deux codes PIN ne correspondent pas."));
    setError("");
    setStep("team");
  };

  const setMember = (i: number, patch: Partial<TeamMember>) => setTeam(team.map((m, j) => (j === i ? { ...m, ...patch } : m)));
  const addMember = (role: Role) =>
    setTeam([...team, { role, full_name: role === "manager" ? tl("Gestionnaire") : tl("Caissière {0}", [team.filter((m) => m.role === "cashier").length + 1]), username: nextUsername(team, role), pin: randomPin(4) }]);

  // Étape 3 : création de la boutique, de l'administrateur et de l'équipe.
  const submitTeam = async () => {
    for (const m of team) {
      if (!m.full_name.trim() || !m.username.trim()) return setError(tl("Chaque poste a un nom et un identifiant."));
      const problem = pinProblem(m.pin, false);
      if (problem) return setError(`${m.full_name} : ${tm(problem)}`);
    }
    setBusy(true);
    setError("");
    try {
      const r = await api.initialSetup({
        shop_name: form.shop_name,
        shop_phone: form.shop_phone || null,
        shop_address: form.shop_address || null,
        currency_symbol: form.symbol.trim() || form.currency,
        currency_decimals: currencyDecimals(form.currency),
        currency_code: form.currency,
        currency_position: currencyPositionOf(form.currency, form.country),
        country: form.country,
        lang: getLang(),
        full_name: form.full_name,
        username: form.username,
        pin: form.pin,
        team: team.map((m) => ({ ...m, username: m.username.trim().toLowerCase() })),
        terms_version: termsVersion,
      });
      await refreshSettings();
      setUser(r.user);
      setCreated(r.team);
      setStep(r.team.length > 0 ? "sheets" : "business");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  // Étape 5 : activités de la boutique, puis plan de départ.
  const submitBusiness = async () => {
    setBusy(true);
    setError("");
    try {
      await api.setBusinessType(activities, null, seed);
      await refreshSettings();
      if (profiles) setProposal(defaultProposal(profiles.profiles, activities));
      setStep("plan");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  // Étape 6 : « Garder ce plan » dessine le premier niveau du plan de la boutique.
  const keepPlan = async () => {
    if (!proposal) return onDone();
    const input = proposalInput(proposal);
    if (typeof input === "string") return setError(input);
    setBusy(true);
    setError("");
    try {
      const plan = await api.planGet();
      const first = plan.floors[0];
      const empty = first && !plan.fixtures.some((f) => f.floor_id === first.id);
      await api.planGenerateLayout({ ...input, floor_id: empty ? first.id : null });
      onDone();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  // Compte relié : la boutique est pré-remplie avec les informations du compte.
  const accountLinked = (r: AccountLinkResult) => {
    const s = r.store;
    if (s) {
      const country = /^[A-Z]{2}$/.test(s.country) && s.country !== "XX" ? s.country : form.country;
      const currency = currencyOf(country);
      setForm({
        ...form,
        shop_name: s.name,
        shop_phone: s.phone,
        shop_address: [s.address, s.city].filter(Boolean).join(", "),
        country,
        currency,
        symbol: currencySymbolOf(currency),
        full_name: s.owner_name,
      });
      // Type de boutique du compte = activité principale proposée (mêmes codes).
      if (profiles?.profiles.some((p) => p.id === s.shop_type)) setActivities([s.shop_type]);
      setAccountNote(
        tl("Compte relié : {0} ({1}){2}.", [s.name, s.code, s.plan_label ? `, formule ${s.plan_label}${s.trial ? " en essai" : ""}` : ""]) +
          (r.sync_error ? tl(" Licence pas encore téléchargée : {0}", [r.sync_error]) : ""),
      );
    }
    setStep("shop");
  };

  const [restoreOpen, setRestoreOpen] = useState(false);
  const joinModal = joinOpen && (
    <Modal title={tl("Rejoindre un poste serveur")} onClose={() => setJoinOpen(false)} width={720}>
      <NetworkForm />
    </Modal>
  );

  if (step === "terms") {
    return (
      <div className="auth-page">
        <div className="auth-lang"><LanguageSwitch /></div>
        <div className="auth-card wide">
          <div className="auth-logo"><Scale size={28} /></div>
          <h1>{tl("Bienvenue dans GestiMarket")}</h1>
          <p className="muted">{tl("Avant de commencer, lisez et acceptez les conditions d'utilisation de GestiMarket, au nom de la boutique.")}</p>
          <TermsAccept
            onAccept={(v) => {
              setTermsVersion(v);
              setStep(isTauri ? "account" : "shop");
            }}
          />
        </div>
      </div>
    );
  }

  if (step === "account") {
    return (
      <div className="auth-page">
        <div className="auth-lang"><LanguageSwitch /></div>
        <div className="auth-card wide">
          <div className="auth-logo">
            <Store size={28} />
          </div>
          <h1>{tl("Bienvenue dans GestiMarket")}</h1>
          <p className="muted">
            {isMobileApp
              ? tl("Étape 1 : le compte de votre boutique chez Eden Dev (abonnement et licence). Internet est nécessaire pour cette étape seulement. Vos ventes, produits et clients restent sur cet appareil.")
              : tl("Étape 1 : le compte de votre boutique chez Eden Dev (abonnement et licence). Internet est nécessaire pour cette étape seulement. Vos ventes, produits et clients restent sur ce PC.")}</p>
          <div className="alert alert-info">
            {tl("Vous ajoutez une caisse supplémentaire à un magasin déjà équipé ?")}{" "}
            <button type="button" className="link-btn" onClick={() => setJoinOpen(true)}>{tl("Se connecter au poste serveur")}</button>
          </div>
          {isTauri && (
            <div className="alert alert-info">
              {tl("Vous avez une sauvegarde de votre boutique (téléphone ou PC changé) ?")}{" "}
              <button type="button" className="link-btn" onClick={() => setRestoreOpen(true)}>{tl("Restaurer la sauvegarde")}</button>
            </div>
          )}
          <AccountForm onLinked={accountLinked} termsVersion={termsVersion} />
          <p className="muted small" style={{ marginTop: 14 }}>
            {tl("Pas d'Internet pour l'instant ?")}{" "}
            <button type="button" className="link-btn" onClick={() => setStep("shop")}>{tl("Continuer sans compte")}</button>  {tl(": essai gratuit de 14 jours avec toutes les fonctions de la formule PRO. Créez le compte plus tard, dès que vous avez Internet (menu Abonnement & licence).")}</p>
        </div>
        {joinModal}
        {restoreOpen && <RestoreBackupModal fresh onClose={() => setRestoreOpen(false)} />}
      </div>
    );
  }

  if (step === "team") {
    return (
      <div className="auth-page">
        <div className="auth-card xwide">
          <div className="auth-logo"><Users size={28} /></div>
          <h1>{tl("Votre équipe")}</h1>
          <p className="muted">
            {tl("Chaque poste a un identifiant et un code PIN, sans mot de passe. Les codes sont proposés au hasard : gardez-les ou changez-les ; chacun pourra ensuite changer le sien. Vous ajouterez d'autres gestionnaires et caissières plus tard (menu Personnel).")}
          </p>
          <table className="table team-table">
            <thead><tr><th>{tl("Poste")}</th><th>{tl("Nom")}</th><th>{tl("Identifiant")}</th><th>{tl("Code PIN")}</th><th></th></tr></thead>
            <tbody>
              <tr className="muted">
                <td>{ROLE_LABELS.admin}</td>
                <td>{form.full_name}</td>
                <td className="mono">{form.username}</td>
                <td>••••••</td>
                <td></td>
              </tr>
              {team.map((m, i) => (
                <tr key={i}>
                  <td>{ROLE_LABELS[m.role]}</td>
                  <td><input value={m.full_name} onChange={(e) => setMember(i, { full_name: e.target.value })} /></td>
                  <td><input className="mono" value={m.username} onChange={(e) => setMember(i, { username: e.target.value })} autoCapitalize="none" /></td>
                  <td>
                    <div className="input-with-btn">
                      <input className="mono pin-input" inputMode="numeric" value={m.pin} onChange={(e) => setMember(i, { pin: digits(e.target.value) })} />
                      <button type="button" className="icon-btn" title={tl("Autre code")} onClick={() => setMember(i, { pin: randomPin(4) })}><RefreshCw size={14} /></button>
                    </div>
                  </td>
                  <td><button type="button" className="icon-btn" title={tl("Retirer ce poste")} onClick={() => setTeam(team.filter((_, j) => j !== i))}><X size={15} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="row-gap" style={{ margin: "10px 0" }}>
            <button type="button" className="btn btn-sm" onClick={() => addMember("cashier")}><Plus size={14} />  {tl("Caissière")}</button>
            <button type="button" className="btn btn-sm" onClick={() => addMember("manager")}><Plus size={14} />  {tl("Gestionnaire")}</button>
          </div>
          {error && <div className="alert alert-danger">{error}</div>}
          <div className="row-end">
            <button className="btn" disabled={busy} onClick={() => { setError(""); setStep("shop"); }}>{tl("Retour")}</button>
            <button className="btn btn-primary btn-lg" disabled={busy} onClick={submitTeam}>{busy ? tl("Configuration…") : tl("Créer la boutique et l'équipe")}</button>
          </div>
        </div>
      </div>
    );
  }

  if (step === "sheets") {
    return (
      <div className="auth-page">
        <div className="auth-card wide">
          <div className="auth-logo"><Printer size={28} /></div>
          <h1>{tl("Fiches d'accès de l'équipe")}</h1>
          <p className="muted">{tl("Remettez à chacun son identifiant et son code PIN. Les codes ne seront plus affichés : imprimez les fiches ou notez-les maintenant.")}</p>
          <table className="table">
            <thead><tr><th>{tl("Nom")}</th><th>{tl("Poste")}</th><th>{tl("Identifiant")}</th><th>{tl("Code PIN")}</th></tr></thead>
            <tbody>
              {created.map((m) => (
                <tr key={m.username}><td>{m.full_name}</td><td>{ROLE_LABELS[m.role]}</td><td className="mono">{m.username}</td><td className="mono"><strong>{m.pin}</strong></td></tr>
              ))}
            </tbody>
          </table>
          <div className="row-end" style={{ marginTop: 14 }}>
            <button className="btn" onClick={() => printAccessSheets(settings, created)}><Printer size={16} />  {tl("Imprimer les fiches d'accès")}</button>
            <button className="btn btn-primary btn-lg" onClick={() => setStep("business")}>{tl("Continuer")}</button>
          </div>
        </div>
      </div>
    );
  }

  if (step === "business") {
    return (
      <div className="auth-page">
        <div className="auth-card xwide">
          <div className="auth-logo">
            <Store size={28} />
          </div>
          <h1>{tl("Quel est votre type de commerce ?")}</h1>
          <p className="muted">
            {tl("Touchez votre activité principale, puis, si votre boutique en combine plusieurs, jusqu'à deux autres (ex. supérette + quincaillerie). GestiMarket s'adapte : catégories proposées, fonctions affichées et plan de départ. Modifiable plus tard dans Paramètres → Type de commerce.")}{" "}
            <HelpTip k="business_type" />
          </p>
          {profiles ? (
            <BusinessTypeGrid profiles={profiles.profiles} value={activities} onChange={setActivities} />
          ) : (
            <p className="muted">{tl("Chargement…")}</p>
          )}
          {activities.length > 0 && (
            <label className="check" style={{ margin: "14px 0" }}>
              <input type="checkbox" checked={seed} onChange={(e) => setSeed(e.target.checked)} />
              {tl("Créer les catégories recommandées pour ces activités (et leurs sous-catégories)")}</label>
          )}
          {error && <div className="alert alert-danger">{error}</div>}
          <div className="row-end">
            <button className="btn" disabled={busy} onClick={onDone}>{tl("Passer cette étape")}</button>
            <button className="btn btn-primary btn-lg" disabled={busy || activities.length === 0} onClick={submitBusiness}>
              {busy ? tl("Configuration…") : tl("Continuer")}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (step === "plan") {
    return (
      <div className="auth-page">
        <div className="auth-card xwide">
          <div className="auth-logo"><WandSparkles size={28} /></div>
          <h1>{tl("Votre plan de départ")}</h1>
          <p className="muted">
            {tl("GestiMarket propose un plan selon vos activités, à une taille habituelle. Donnez les vraies dimensions de la salle (longueur, largeur, hauteur) et le côté de l'entrée : le plan se redessine aussitôt. Rien n'est enregistré avant « Garder ce plan » ; vous pourrez tout déplacer ensuite.")}
          </p>
          {proposal && profiles && <PlanProposal value={proposal} onChange={setProposal} profiles={profiles.profiles} />}
          {error && <div className="alert alert-danger">{error}</div>}
          <div className="row-end" style={{ marginTop: 12 }}>
            <button className="btn" disabled={busy} onClick={onDone}>{tl("Plus tard")}</button>
            <button className="btn btn-primary btn-lg" disabled={busy || !proposal} onClick={keepPlan}>
              <WandSparkles size={16} />  {busy ? tl("Création…") : tl("Garder ce plan")}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-page">
      <div className="auth-lang"><LanguageSwitch /></div>
      <form className="auth-card wide" onSubmit={submitShop}>
        <div className="auth-logo">
          <Store size={28} />
        </div>
        <h1>{tl("Bienvenue dans GestiMarket")}</h1>
        <p className="muted">{tl("Première configuration : renseignez votre commerce et l'administrateur (identifiant et code PIN, sans mot de passe).")}</p>
        {accountNote && <div className="alert alert-success">{accountNote}</div>}

        {isTauri && !accountNote && (
          <div className="alert alert-info">
            {tl("Vous ajoutez une caisse supplémentaire à un magasin déjà équipé ?")}{" "}
            <button type="button" className="link-btn" onClick={() => setJoinOpen(true)}>{tl("Se connecter au poste serveur")}</button>
          </div>
        )}

        <h3 className="section-title">{tl("Votre commerce")}</h3>
        <div className="form-grid">
          <label className="field span-2">
            <span className="field-label">{tl("Nom du commerce *")}</span>
            <input value={form.shop_name} onChange={set("shop_name")} autoFocus placeholder={tl("Ex. Supermarché Le Baobab")} />
          </label>
          <label className="field">
            <span className="field-label">{tl("Téléphone")}</span>
            <input value={form.shop_phone} onChange={set("shop_phone")} />
          </label>
          <label className="field">
            <span className="field-label">{tl("Pays *")}</span>
            <select value={form.country} onChange={(e) => setCountry(e.target.value)}>
              {countries.map((c) => (
                <option key={c.code} value={c.code}>{c.label}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field-label">{tl("Devise *")}</span>
            <select value={form.currency} onChange={(e) => setCurrency(e.target.value)}>
              {currencies.map((c) => (
                <option key={c.code} value={c.code}>{c.label}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field-label">{tl("Symbole de la devise")}</span>
            <input value={form.symbol} onChange={set("symbol")} maxLength={8} />
            <span className="field-hint">{tl("{0} décimale(s)", [currencyDecimals(form.currency)])}</span>
          </label>
          <label className="field span-2">
            <span className="field-label">{tl("Adresse")}</span>
            <input value={form.shop_address} onChange={set("shop_address")} />
          </label>
        </div>

        <h3 className="section-title">{tl("Administrateur")}</h3>
        <div className="form-grid">
          <label className="field">
            <span className="field-label">{tl("Nom complet *")}</span>
            <input value={form.full_name} onChange={set("full_name")} />
          </label>
          <label className="field">
            <span className="field-label">{tl("Identifiant *")}</span>
            <input value={form.username} onChange={set("username")} autoCapitalize="none" />
          </label>
          <label className="field">
            <span className="field-label">{tl("Code PIN * (6 chiffres)")}</span>
            <input className="pin-input" type="password" inputMode="numeric" value={form.pin} onChange={(e) => setForm({ ...form, pin: digits(e.target.value) })} />
          </label>
          <label className="field">
            <span className="field-label">{tl("Confirmation *")}</span>
            <input className="pin-input" type="password" inputMode="numeric" value={form.confirm} onChange={(e) => setForm({ ...form, confirm: digits(e.target.value) })} />
          </label>
        </div>
        <p className="muted small">{tl("Ce code vous connecte et valide les actions importantes de l'équipe. Oublié ? Il se refait avec le compte boutique.")}</p>

        {error && <div className="alert alert-danger">{error}</div>}
        <button className="btn btn-primary btn-lg btn-block" disabled={busy}>
          {tl("Continuer")}
        </button>
      </form>
      {joinModal}
    </div>
  );
}
