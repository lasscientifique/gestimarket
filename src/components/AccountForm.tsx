import { useEffect, useState, type FormEvent } from "react";
import { LogIn, Plus, RefreshCw, Store, UserPlus } from "lucide-react";
import { api } from "../api";
import { errorMessage } from "../context/AppContext";
import { Badge } from "./ui";
import { isoDateTime } from "../lib/license";
import type { AccountLinkResult, AccountOptions, AccountStore, StoreInput } from "../types";

const EMPTY_STORE: StoreInput = { name: "", owner_name: "", phone: "", country: "ML", city: "", address: "", shop_type: "" };

/** Champs d'une boutique (inscription ou nouvelle boutique sur le compte). */
function StoreFields({ value, onChange, options }: { value: StoreInput; onChange: (v: StoreInput) => void; options: AccountOptions }) {
  const set = (k: keyof StoreInput) => (e: { target: { value: string } }) => onChange({ ...value, [k]: e.target.value });
  return (
    <div className="form-grid">
      <label className="field span-2">
        <span className="field-label">Nom de la boutique *</span>
        <input value={value.name} onChange={set("name")} placeholder="Ex. Eden Superrette" />
      </label>
      <label className="field">
        <span className="field-label">Nom complet de la propriétaire *</span>
        <input value={value.owner_name} onChange={set("owner_name")} />
      </label>
      <label className="field">
        <span className="field-label">Téléphone</span>
        <input value={value.phone} onChange={set("phone")} inputMode="tel" />
      </label>
      <label className="field">
        <span className="field-label">Pays *</span>
        <select value={value.country} onChange={set("country")}>
          {options.countries.map((c) => (
            <option key={c.code} value={c.code}>{c.label}</option>
          ))}
        </select>
      </label>
      <label className="field">
        <span className="field-label">Ville *</span>
        <input value={value.city} onChange={set("city")} />
      </label>
      <label className="field span-2">
        <span className="field-label">Adresse *</span>
        <input value={value.address} onChange={set("address")} placeholder="Quartier, rue, repère" />
      </label>
      <label className="field span-2">
        <span className="field-label">Type de boutique *</span>
        <select value={value.shop_type} onChange={set("shop_type")}>
          <option value="">Choisir…</option>
          {options.shop_types.map((t) => (
            <option key={t.code} value={t.code}>{t.label}</option>
          ))}
        </select>
      </label>
    </div>
  );
}

function missing(s: StoreInput): string | null {
  if (!s.name.trim()) return "Renseignez le nom de la boutique.";
  if (!s.owner_name.trim()) return "Renseignez le nom complet de la propriétaire.";
  if (!s.city.trim()) return "Renseignez la ville.";
  if (!s.address.trim()) return "Renseignez l'adresse.";
  if (!s.shop_type) return "Choisissez le type de boutique.";
  return null;
}

/**
 * Compte boutique Eden Dev : création (essai gratuit), connexion, choix ou création de la boutique,
 * puis rattachement de ce PC. La licence est téléchargée aussitôt.
 */
export function AccountForm({ onLinked, startWith = "signup" }: { onLinked: (r: AccountLinkResult) => void; startWith?: "signup" | "login" }) {
  const [options, setOptions] = useState<AccountOptions | null>(null);
  const [optionsError, setOptionsError] = useState("");
  const [mode, setMode] = useState<"signup" | "login" | "choose" | "new-store">(startWith);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPwd, setConfirmPwd] = useState("");
  const [store, setStore] = useState<StoreInput>(EMPTY_STORE);
  const [stores, setStores] = useState<AccountStore[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  const loadOptions = () => {
    setOptionsError("");
    api.accountOptions().then(setOptions).catch((e) => setOptionsError(errorMessage(e)));
  };
  useEffect(loadOptions, []);

  const run = async (f: () => Promise<void>) => {
    setBusy(true);
    setError("");
    setInfo("");
    try {
      await f();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const linked = (r: AccountLinkResult) => {
    if (r.status === "confirm_email") {
      setMode("login");
      setInfo("Compte créé. Ouvrez le lien de confirmation reçu par e-mail, puis connectez-vous ici.");
      return;
    }
    onLinked(r);
  };

  const signup = (e: FormEvent) => {
    e.preventDefault();
    if (password.length < 8) return setError("Le mot de passe doit contenir au moins 8 caractères.");
    if (password !== confirmPwd) return setError("Les mots de passe ne correspondent pas.");
    const m = missing(store);
    if (m) return setError(m);
    run(async () => linked(await api.accountSignup({ ...store, email, password })));
  };

  const login = (e: FormEvent) => {
    e.preventDefault();
    run(async () => {
      const r = await api.accountLogin(email, password);
      setStores(r.stores);
      setMode(r.stores.length ? "choose" : "new-store");
      if (!r.stores.length) setInfo("Aucune boutique sur ce compte : créez-la.");
    });
  };

  const createStore = (e: FormEvent) => {
    e.preventDefault();
    const m = missing(store);
    if (m) return setError(m);
    run(async () => linked(await api.accountCreateStore(store)));
  };

  if (!options) {
    return optionsError ? (
      <div className="alert alert-danger">
        {optionsError}{" "}
        <button type="button" className="link-btn" onClick={loadOptions}><RefreshCw size={14} /> Réessayer</button>
      </div>
    ) : (
      <p className="muted">Connexion au service Eden Dev…</p>
    );
  }

  return (
    <div className="account-form">
      {(mode === "signup" || mode === "login") && (
        <div className="segmented">
          <button type="button" className={mode === "signup" ? "active" : ""} onClick={() => { setMode("signup"); setError(""); }}>
            <UserPlus size={15} /> Créer un compte
          </button>
          <button type="button" className={mode === "login" ? "active" : ""} onClick={() => { setMode("login"); setError(""); }}>
            <LogIn size={15} /> J'ai déjà un compte
          </button>
        </div>
      )}
      {info && <div className="alert alert-info">{info}</div>}

      {mode === "signup" && (
        <form onSubmit={signup}>
          {options.trial_days > 0 && (
            <p className="muted small">{options.trial_days} jours d'essai gratuit de la formule PRO, sans engagement.</p>
          )}
          <h4 className="section-title">Compte</h4>
          <div className="form-grid">
            <label className="field span-2">
              <span className="field-label">E-mail (identifiant) *</span>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
            </label>
            <label className="field">
              <span className="field-label">Mot de passe * (8 caractères min.)</span>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
            </label>
            <label className="field">
              <span className="field-label">Confirmation *</span>
              <input type="password" value={confirmPwd} onChange={(e) => setConfirmPwd(e.target.value)} autoComplete="new-password" />
            </label>
          </div>
          <h4 className="section-title">Boutique</h4>
          <StoreFields value={store} onChange={setStore} options={options} />
          {error && <div className="alert alert-danger">{error}</div>}
          <button className="btn btn-primary btn-lg btn-block" disabled={busy}>
            {busy ? "Création du compte…" : "Créer le compte et activer l'essai"}
          </button>
        </form>
      )}

      {mode === "login" && (
        <form onSubmit={login}>
          <div className="form-grid">
            <label className="field span-2">
              <span className="field-label">E-mail</span>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" autoFocus />
            </label>
            <label className="field span-2">
              <span className="field-label">Mot de passe</span>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
            </label>
          </div>
          {error && <div className="alert alert-danger">{error}</div>}
          <button className="btn btn-primary btn-lg btn-block" disabled={busy || !email || !password}>
            {busy ? "Connexion…" : "Se connecter"}
          </button>
        </form>
      )}

      {mode === "choose" && (
        <div>
          <p className="muted">Quelle boutique utilise ce PC ?</p>
          <div className="boutique-list">
            {stores.map((s) => (
              <div key={s.code} className="boutique-row">
                <Store size={18} />
                <div className="boutique-main">
                  <strong>{s.name}</strong>
                  <span className="small muted">
                    {s.code} · {s.city} · {s.plan_label ? `${s.plan_label}${s.trial ? " (essai)" : ""} jusqu'au ${isoDateTime(s.ends_at)}` : "aucun abonnement en cours"}
                  </span>
                </div>
                {s.status !== "active" ? (
                  <Badge tone="danger">suspendue</Badge>
                ) : (
                  <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => run(async () => linked(await api.accountLink(s.code)))}>
                    Utiliser
                  </button>
                )}
              </div>
            ))}
          </div>
          {stores.length < 5 && (
            <button className="btn" style={{ marginTop: 12 }} onClick={() => { setStore(EMPTY_STORE); setMode("new-store"); }}>
              <Plus size={16} /> Nouvelle boutique sur ce compte
            </button>
          )}
          {error && <div className="alert alert-danger">{error}</div>}
        </div>
      )}

      {mode === "new-store" && (
        <form onSubmit={createStore}>
          <StoreFields value={store} onChange={setStore} options={options} />
          {error && <div className="alert alert-danger">{error}</div>}
          <div className="row-end">
            {stores.length > 0 && <button type="button" className="btn" onClick={() => setMode("choose")}>Retour</button>}
            <button className="btn btn-primary" disabled={busy}>{busy ? "Création…" : "Créer la boutique"}</button>
          </div>
        </form>
      )}
    </div>
  );
}
