import { useState, type FormEvent } from "react";
import { Store } from "lucide-react";
import { api } from "../api";
import { errorMessage, useApp } from "../context/AppContext";
import { isTauri } from "../lib/transport";
import { Modal } from "../components/ui";
import { NetworkForm } from "../components/NetworkForm";
import { BusinessTypeGrid, useBusinessProfiles } from "../components/BusinessType";
import { HelpTip } from "../components/Help";
import { AccountForm } from "../components/AccountForm";
import type { AccountLinkResult } from "../types";

const CURRENCIES = [
  { symbol: "FCFA", decimals: 0, label: "Franc CFA (FCFA) — sans décimales" },
  { symbol: "GNF", decimals: 0, label: "Franc guinéen (GNF) — sans décimales" },
  { symbol: "€", decimals: 2, label: "Euro (€) — 2 décimales" },
  { symbol: "MAD", decimals: 2, label: "Dirham marocain (MAD) — 2 décimales" },
  { symbol: "DA", decimals: 2, label: "Dinar algérien (DA) — 2 décimales" },
  { symbol: "$", decimals: 2, label: "Dollar ($) — 2 décimales" },
];

export default function SetupPage({ onDone }: { onDone: () => void }) {
  const { setUser, refreshSettings } = useApp();
  const [form, setForm] = useState({
    shop_name: "",
    shop_phone: "",
    shop_address: "",
    currency: "FCFA",
    full_name: "",
    username: "admin",
    password: "",
    confirm: "",
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [joinOpen, setJoinOpen] = useState(false);
  // Compte boutique d'abord (licence d'essai), sauf dans un navigateur : il se crée sur le PC serveur.
  const [step, setStep] = useState<"account" | "shop" | "business">(isTauri ? "account" : "shop");
  const [accountNote, setAccountNote] = useState("");
  const [bizType, setBizType] = useState("");
  const [seed, setSeed] = useState(true);
  const profiles = useBusinessProfiles();
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (form.password !== form.confirm) return setError("Les mots de passe ne correspondent pas.");
    const cur = CURRENCIES.find((c) => c.symbol === form.currency)!;
    setBusy(true);
    setError("");
    try {
      const user = await api.initialSetup({
        shop_name: form.shop_name,
        shop_phone: form.shop_phone || null,
        shop_address: form.shop_address || null,
        currency_symbol: cur.symbol,
        currency_decimals: cur.decimals,
        full_name: form.full_name,
        username: form.username,
        password: form.password,
      });
      await refreshSettings();
      setUser(user);
      setStep("business");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const finish = async () => {
    setBusy(true);
    setError("");
    try {
      if (bizType) await api.setBusinessType(bizType, null, seed);
      await refreshSettings();
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
      const currency = CURRENCIES.some((c) => c.symbol === s.currency) ? s.currency! : form.currency;
      setForm({
        ...form,
        shop_name: s.name,
        shop_phone: s.phone,
        shop_address: [s.address, s.city].filter(Boolean).join(", "),
        currency,
        full_name: s.owner_name,
      });
      // Type de boutique du compte = type de commerce proposé (mêmes codes).
      if (profiles?.profiles.some((p) => p.id === s.shop_type)) setBizType(s.shop_type);
      setAccountNote(
        `Compte relié : ${s.name} (${s.code})${s.plan_label ? `, formule ${s.plan_label}${s.trial ? " en essai" : ""}` : ""}.` +
          (r.sync_error ? ` Licence pas encore téléchargée : ${r.sync_error}` : ""),
      );
    }
    setStep("shop");
  };

  if (step === "account") {
    return (
      <div className="auth-page">
        <div className="auth-card wide">
          <div className="auth-logo">
            <Store size={28} />
          </div>
          <h1>Bienvenue dans GestiMarket</h1>
          <p className="muted">
            Étape 1 : le compte de votre boutique chez Eden Dev (abonnement et licence). Internet est nécessaire pour cette étape seulement.
            Vos ventes, produits et clients restent sur ce PC.
          </p>
          <div className="alert alert-info">
            Vous ajoutez une caisse supplémentaire à un magasin déjà équipé ?{" "}
            <button type="button" className="link-btn" onClick={() => setJoinOpen(true)}>Se connecter au poste serveur</button>
          </div>
          <AccountForm onLinked={accountLinked} />
          <p className="muted small" style={{ marginTop: 14 }}>
            Pas d'Internet pour l'instant ?{" "}
            <button type="button" className="link-btn" onClick={() => setStep("shop")}>Continuer sans compte</button> : GestiMarket restera en lecture seule
            jusqu'à l'activation (menu Abonnement & licence).
          </p>
        </div>
        {joinOpen && (
          <Modal title="Rejoindre un poste serveur" onClose={() => setJoinOpen(false)} width={720}>
            <NetworkForm />
          </Modal>
        )}
      </div>
    );
  }

  if (step === "business") {
    const chosen = profiles?.profiles.find((p) => p.id === bizType);
    return (
      <div className="auth-page">
        <div className="auth-card xwide">
          <div className="auth-logo">
            <Store size={28} />
          </div>
          <h1>Quel est votre type de commerce ?</h1>
          <p className="muted">
            GestiMarket s'adapte à votre activité : catégories proposées et fonctions affichées. Modifiable plus tard dans Paramètres → Type de commerce.{" "}
            <HelpTip k="business_type" />
          </p>
          {profiles ? (
            <BusinessTypeGrid profiles={profiles.profiles} value={bizType} onChange={(p) => setBizType(p.id)} />
          ) : (
            <p className="muted">Chargement…</p>
          )}
          {chosen && (
            <label className="check" style={{ margin: "14px 0" }}>
              <input type="checkbox" checked={seed} onChange={(e) => setSeed(e.target.checked)} />
              Créer les catégories recommandées ({chosen.categories.length} catégorie(s) principale(s) et leurs sous-catégories)
            </label>
          )}
          {error && <div className="alert alert-danger">{error}</div>}
          <div className="row-end">
            <button className="btn" disabled={busy} onClick={() => { setBizType(""); onDone(); }}>Passer cette étape</button>
            <button className="btn btn-primary btn-lg" disabled={busy || !bizType} onClick={finish}>
              {busy ? "Configuration…" : "Terminer"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-page">
      <form className="auth-card wide" onSubmit={submit}>
        <div className="auth-logo">
          <Store size={28} />
        </div>
        <h1>Bienvenue dans GestiMarket</h1>
        <p className="muted">Première configuration : renseignez votre commerce et créez le compte administrateur.</p>
        {accountNote && <div className="alert alert-success">{accountNote}</div>}

        {isTauri && !accountNote && (
          <div className="alert alert-info">
            Vous ajoutez une caisse supplémentaire à un magasin déjà équipé ?{" "}
            <button type="button" className="link-btn" onClick={() => setJoinOpen(true)}>Se connecter au poste serveur</button>
          </div>
        )}

        <h3 className="section-title">Votre commerce</h3>
        <div className="form-grid">
          <label className="field span-2">
            <span className="field-label">Nom du commerce *</span>
            <input value={form.shop_name} onChange={set("shop_name")} autoFocus placeholder="Ex. Supermarché Le Baobab" />
          </label>
          <label className="field">
            <span className="field-label">Téléphone</span>
            <input value={form.shop_phone} onChange={set("shop_phone")} />
          </label>
          <label className="field">
            <span className="field-label">Devise *</span>
            <select value={form.currency} onChange={set("currency")}>
              {CURRENCIES.map((c) => (
                <option key={c.symbol} value={c.symbol}>{c.label}</option>
              ))}
            </select>
          </label>
          <label className="field span-2">
            <span className="field-label">Adresse</span>
            <input value={form.shop_address} onChange={set("shop_address")} />
          </label>
        </div>

        <h3 className="section-title">Compte administrateur</h3>
        <div className="form-grid">
          <label className="field">
            <span className="field-label">Nom complet *</span>
            <input value={form.full_name} onChange={set("full_name")} />
          </label>
          <label className="field">
            <span className="field-label">Identifiant *</span>
            <input value={form.username} onChange={set("username")} />
          </label>
          <label className="field">
            <span className="field-label">Mot de passe * (6 caractères min.)</span>
            <input type="password" value={form.password} onChange={set("password")} />
          </label>
          <label className="field">
            <span className="field-label">Confirmation *</span>
            <input type="password" value={form.confirm} onChange={set("confirm")} />
          </label>
        </div>

        {error && <div className="alert alert-danger">{error}</div>}
        <button className="btn btn-primary btn-lg btn-block" disabled={busy}>
          {busy ? "Configuration…" : "Continuer"}
        </button>
      </form>
      {joinOpen && (
        <Modal title="Rejoindre un poste serveur" onClose={() => setJoinOpen(false)} width={720}>
          <NetworkForm />
        </Modal>
      )}
    </div>
  );
}
