import { useCallback, useEffect, useState, type FormEvent } from "react";
import { LanguageSwitch } from "../components/LanguageSwitch";
import { LogIn, Network, ArrowLeft, KeyRound, Loader2, Keyboard, Smartphone, ShieldCheck, Store } from "lucide-react";
import { api } from "../api";
import { errorMessage, useApp } from "../context/AppContext";
import { getNetwork, isTauri } from "../lib/transport";
import { ROLE_LABELS } from "../lib/format";
import { Field, Modal } from "../components/ui";
import { NetworkForm } from "../components/NetworkForm";
import { BoutiquesPanel } from "../components/BoutiquesPanel";
import { NumPad } from "../components/PinPad";
import { BrandLogo } from "../components/Brand";
import type { LoginInfo, LoginUser } from "../types";
import { deviceLabel, setDeviceToken } from "../lib/device";
import { tl } from "../lib/i18n";

const initials = (n: string) =>
  n
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();

const digits = (v: string, max = 6) => v.replace(/\D/g, "").slice(0, max);

type Mode = "tiles" | "keyboard" | "password" | "authorize";

/**
 * Connexion du personnel : identifiant et code PIN, sans mot de passe.
 *  - au magasin : on touche son nom puis on tape son PIN (ou identifiant + PIN au clavier) ;
 *  - depuis Internet : le téléphone est d'abord autorisé (code d'accès de l'administrateur, ou compte boutique),
 *    puis identifiant + PIN suffisent.
 */
export default function LoginPage() {
  const { settings, setUser, toast } = useApp();
  const [info, setInfo] = useState<LoginInfo | null>(null);
  const [users, setUsers] = useState<LoginUser[] | null>(null);
  const [selected, setSelected] = useState<LoginUser | null>(null);
  const [mode, setMode] = useState<Mode>("tiles");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [pin, setPin] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [netOpen, setNetOpen] = useState(false);
  const [forgotOpen, setForgotOpen] = useState(false);
  const net = getNetwork();
  const modeLabel = net?.config.mode === "client" ? `Poste client · serveur ${net.config.server_url}` : net?.config.mode === "server" ? "Poste serveur" : "Poste unique";

  const load = useCallback(async () => {
    const i = await api.loginInfo().catch(() => ({ internet: false, device: null, account: false }) as LoginInfo);
    setInfo(i);
    if (i.internet) {
      setUsers([]);
      setMode(i.device ? "keyboard" : "authorize");
      return;
    }
    const list = await api.listLoginUsers().catch((e) => {
      setError(errorMessage(e));
      return [] as LoginUser[];
    });
    setUsers(list);
    setMode(list.length > 0 ? "tiles" : "keyboard");
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  /** Téléphone retiré par l'administrateur : il faut l'autoriser de nouveau. */
  const handle = (err: unknown) => {
    const m = errorMessage(err);
    if (info?.internet && /pas encore autorisé|not authorised yet|not authorized yet/i.test(m)) {
      setDeviceToken(null);
      setInfo({ ...info, device: null });
      setMode("authorize");
    }
    setError(m);
  };

  const loginPin = useCallback(
    async (value: string) => {
      if (!selected || value.length < 4 || busy) return;
      setBusy(true);
      setError("");
      try {
        setUser(await api.loginPin(selected.id, value));
      } catch (err) {
        setError(errorMessage(err));
        setPin("");
      } finally {
        setBusy(false);
      }
    },
    [selected, busy, setUser],
  );

  const press = useCallback((k: string) => {
    if (k === "⌫") return setPin((p) => p.slice(0, -1));
    if (k === "C") return setPin("");
    setPin((p) => (p.length < 6 ? p + k : p));
  }, []);

  // Saisie au clavier physique aussi.
  useEffect(() => {
    if (!selected?.has_pin || mode !== "tiles") return;
    const onKey = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) press(e.key);
      else if (e.key === "Backspace") press("⌫");
      else if (e.key === "Enter") loginPin(pin);
      else if (e.key === "Escape") setSelected(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected, press, loginPin, pin, mode]);

  const submitKeyboard = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      setUser(await api.login(username, pin));
    } catch (err) {
      handle(err);
      setPin("");
    } finally {
      setBusy(false);
    }
  };

  const submitPassword = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      setUser(await api.loginPassword(username, password));
    } catch (err) {
      setError(errorMessage(err));
      setPassword("");
    } finally {
      setBusy(false);
    }
  };

  const choose = (u: LoginUser) => {
    setError("");
    setPin("");
    if (u.has_pin) setSelected(u);
    else if (u.legacy_password) {
      setUsername(u.username);
      setMode("password");
    } else setError(tl("{0} n'a pas encore de code PIN : l'administrateur doit lui en donner un.", [u.full_name]));
  };

  const keyboardForm = (
    <form onSubmit={submitKeyboard} className="form-grid one">
      {!info?.internet && users && users.length > 0 && (
        <button type="button" className="link-btn back" onClick={() => { setMode("tiles"); setError(""); }}>
          <ArrowLeft size={15} />  {tl("Connexion rapide : toucher son nom")}</button>
      )}
      <h2>{tl("Connexion")}</h2>
      {info?.internet && info.device && (
        <div className="alert alert-success small">
          <Smartphone size={15} /> {tl("Téléphone autorisé : {0}", [info.device.label])}
          {info.device.user_name ? ` · ${info.device.user_name}` : ""}
        </div>
      )}
      {notice && <div className="alert alert-info small">{notice}</div>}
      <Field label={tl("Identifiant")}>
        <input value={username} onChange={(e) => setUsername(e.target.value)} autoFocus={!username} autoComplete="username" autoCapitalize="none" />
      </Field>
      <Field label={tl("Code PIN")}>
        <input className="pin-input" type="password" inputMode="numeric" value={pin} onChange={(e) => setPin(digits(e.target.value))} autoFocus={!!username} autoComplete="current-password" />
      </Field>
      {error && <div className="alert alert-danger">{error}</div>}
      <button className="btn btn-primary btn-lg btn-block" disabled={busy || !username || pin.length < 4}>
        <LogIn size={18} /> {busy ? tl("Connexion…") : tl("Se connecter")}
      </button>
    </form>
  );

  return (
    <div className="auth-page">
      <div className="auth-lang"><LanguageSwitch /></div>
      <div className="auth-shell">
        <div className="auth-hero">
          <BrandLogo size={84} />
          <h1>{settings.shop_name || tl("GestiMarket")}</h1>
          <p>{settings.shop_address || tl("Caisse et gestion de magasin")}</p>
          <span className="auth-hero-foot">{tl("GestiMarket")}</span>
        </div>

        <div className="auth-card">
          {info === null && <div className="loading"><Loader2 className="spin" size={20} /></div>}

          {info && mode === "tiles" && !selected && (
            <>
              <h2>{tl("Qui êtes-vous ?")}</h2>
              <p className="muted">{tl("Touchez votre nom, puis tapez votre code PIN.")}</p>
              {users === null ? (
                <div className="loading"><Loader2 className="spin" size={20} /></div>
              ) : (
                <div className="user-tiles">
                  {users.map((u) => (
                    <button key={u.id} className={`user-tile role-${u.role} ${u.has_pin || u.legacy_password ? "" : "no-pin"}`} onClick={() => choose(u)}>
                      <span className="user-tile-avatar">{initials(u.full_name)}</span>
                      <strong>{u.full_name}</strong>
                      <span>{ROLE_LABELS[u.role]}</span>
                    </button>
                  ))}
                </div>
              )}
              {error && <div className="alert alert-danger small">{error}</div>}
              <button className="btn btn-block" onClick={() => { setMode("keyboard"); setError(""); }}><Keyboard size={16} />  {tl("Identifiant et code PIN au clavier")}</button>
            </>
          )}

          {info && mode === "tiles" && selected && (
            <>
              <button className="link-btn back" onClick={() => setSelected(null)}><ArrowLeft size={15} />  {tl("Changer d'utilisateur")}</button>
              <div className="pin-who">
                <span className={`user-tile-avatar role-${selected.role}`}>{initials(selected.full_name)}</span>
                <div>
                  <strong>{selected.full_name}</strong>
                  <span className="muted">{ROLE_LABELS[selected.role]}</span>
                </div>
              </div>
              <div className="pin-dots">
                {[0, 1, 2, 3, 4, 5].map((i) => (
                  <span key={i} className={`pin-dot ${i < pin.length ? "on" : ""} ${i >= 4 ? "opt" : ""}`} />
                ))}
              </div>
              <div className="pin-error">{busy ? <Loader2 className="spin" size={16} /> : error}</div>
              <NumPad onKey={press} extra="C" />
              <button className="btn btn-primary btn-lg btn-block" disabled={pin.length < 4 || busy} onClick={() => loginPin(pin)}>
                <LogIn size={18} />  {tl("Se connecter")}</button>
            </>
          )}

          {info && mode === "keyboard" && keyboardForm}

          {info && mode === "password" && (
            <form onSubmit={submitPassword} className="form-grid one">
              <button type="button" className="link-btn back" onClick={() => { setMode("tiles"); setError(""); }}>
                <ArrowLeft size={15} />  {tl("Retour")}</button>
              <h2>{tl("Dernière connexion avec votre ancien mot de passe")}</h2>
              <p className="muted small">{tl("Les mots de passe disparaissent : vous allez créer votre code PIN de 6 chiffres, qui servira désormais.")}</p>
              <Field label={tl("Identifiant")}>
                <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" />
              </Field>
              <Field label={tl("Ancien mot de passe")}>
                <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus autoComplete="current-password" />
              </Field>
              {error && <div className="alert alert-danger">{error}</div>}
              <button className="btn btn-primary btn-lg btn-block" disabled={busy || !username || !password}>
                <LogIn size={18} /> {tl("Continuer")}</button>
            </form>
          )}

          {info && mode === "authorize" && (
            <AuthorizePhone
              info={info}
              onLinked={(user) => setUser(user)}
              onAccount={async () => {
                setNotice(tl("Téléphone autorisé. Connectez-vous avec votre identifiant et votre code PIN."));
                await load();
              }}
            />
          )}

          {info && !info.internet && (
            <button type="button" className="link-btn small forgot-pin" onClick={() => setForgotOpen(true)}>
              <KeyRound size={13} /> {tl("Code PIN administrateur oublié ?")}</button>
          )}

          <BoutiquesPanel compact />

          {isTauri && (
            <button type="button" className="link-btn auth-net" onClick={() => setNetOpen(true)}>
              <Network size={14} /> {modeLabel}  {tl("— modifier")}</button>
          )}
        </div>
      </div>
      {netOpen && (
        <Modal title={tl("Réseau multi-postes")} onClose={() => setNetOpen(false)} width={720}>
          <NetworkForm />
        </Modal>
      )}
      {forgotOpen && (
        <ForgotAdminPin
          onClose={() => setForgotOpen(false)}
          onDone={(name) => {
            setForgotOpen(false);
            toast.success(tl("Nouveau code PIN enregistré pour {0}.", [name]));
            load();
          }}
        />
      )}
    </div>
  );
}

/**
 * Téléphone pas encore autorisé (connexion depuis Internet) : code d'accès donné par l'administrateur
 * (gestionnaire, caissière), ou compte boutique (téléphone de l'administrateur).
 */
function AuthorizePhone({ info, onLinked, onAccount }: { info: LoginInfo; onLinked: (u: Awaited<ReturnType<typeof api.authorizeDeviceCode>>) => void; onAccount: () => void }) {
  const [tab, setTab] = useState<"code" | "account">("code");
  const [f, setF] = useState({ username: "", pin: "", code: "", email: "", password: "", label: deviceLabel() });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (tab === "code") onLinked(await api.authorizeDeviceCode(f.username, f.pin, f.code, f.label));
      else {
        await api.authorizeDeviceAccount(f.email, f.password, f.label);
        onAccount();
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="form-grid one">
      <h2><ShieldCheck size={20} /> {tl("Autoriser ce téléphone")}</h2>
      <p className="muted small">{tl("Connexion depuis Internet : ce téléphone doit être autorisé une seule fois. Ensuite, identifiant et code PIN suffisent.")}</p>
      <div className="segmented">
        <button type="button" className={tab === "code" ? "active" : ""} onClick={() => setTab("code")}><KeyRound size={14} />  {tl("Code d'accès")}</button>
        <button type="button" className={tab === "account" ? "active" : ""} onClick={() => setTab("account")}><Store size={14} />  {tl("Compte boutique")}</button>
      </div>
      {tab === "code" ? (
        <>
          <p className="muted small">{tl("Gestionnaire ou caissière : tapez votre identifiant, votre code PIN et le code d'accès de 8 lettres et chiffres donné par l'administrateur.")}</p>
          <Field label={tl("Identifiant")}><input value={f.username} onChange={set("username")} autoCapitalize="none" autoFocus /></Field>
          <Field label={tl("Code PIN")}>
            <input className="pin-input" type="password" inputMode="numeric" value={f.pin} onChange={(e) => setF({ ...f, pin: digits(e.target.value) })} />
          </Field>
          <Field label={tl("Code d'accès")}>
            <input className="mono access-code-input" value={f.code} maxLength={9} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} placeholder={tl("ABCD-2345")} autoCapitalize="characters" />
          </Field>
        </>
      ) : (
        <>
          <p className="muted small">{tl("Administrateur : e-mail et mot de passe du compte de la boutique chez Eden Dev.")}</p>
          {!info.account && <div className="alert alert-warning small">{tl("Le poste serveur n'est relié à aucun compte boutique.")}</div>}
          <Field label={tl("E-mail")}><input type="email" value={f.email} onChange={set("email")} autoComplete="email" /></Field>
          <Field label={tl("Mot de passe du compte boutique")}><input type="password" value={f.password} onChange={set("password")} /></Field>
        </>
      )}
      <Field label={tl("Nom de ce téléphone")} hint={tl("Visible par l'administrateur, qui peut le retirer.")}>
        <input value={f.label} onChange={set("label")} maxLength={60} />
      </Field>
      {error && <div className="alert alert-danger">{error}</div>}
      <button
        className="btn btn-primary btn-lg btn-block"
        disabled={busy || (tab === "code" ? !f.username || f.pin.length < 4 || f.code.replace(/[^A-Za-z0-9]/g, "").length !== 8 : !f.email || !f.password)}
      >
        <Smartphone size={18} /> {busy ? tl("Vérification…") : tl("Autoriser ce téléphone")}
      </button>
    </form>
  );
}

/** Code PIN administrateur oublié : nouveau PIN après vérification du compte boutique (Internet nécessaire). */
function ForgotAdminPin({ onClose, onDone }: { onClose: () => void; onDone: (fullName: string) => void }) {
  const [f, setF] = useState({ email: "", password: "", username: "", pin: "", confirm: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (f.pin !== f.confirm) return setError(tl("Les deux codes PIN ne correspondent pas."));
    setBusy(true);
    setError("");
    try {
      const r = await api.resetAdminPin(f.email, f.password, f.pin, f.username || undefined);
      onDone(r.full_name);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={tl("Code PIN administrateur oublié")}
      onClose={onClose}
      width={460}
      footer={
        <>
          <button className="btn" onClick={onClose}>{tl("Annuler")}</button>
          <button className="btn btn-primary" disabled={busy || !f.email || !f.password || f.pin.length !== 6} onClick={submit}>
            {busy ? tl("Vérification…") : tl("Enregistrer le nouveau PIN")}</button>
        </>
      }
    >
      <p className="muted small" style={{ marginTop: 0 }}>{tl("Prouvez que vous êtes la propriétaire avec le compte boutique (e-mail et mot de passe Eden Dev, Internet nécessaire), puis choisissez un nouveau code PIN de 6 chiffres.")}</p>
      <div className="form-grid one">
        <Field label={tl("E-mail du compte boutique")}><input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} autoFocus /></Field>
        <Field label={tl("Mot de passe du compte boutique")}><input type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></Field>
        <Field label={tl("Identifiant de l'administrateur")} hint={tl("Vide : le premier administrateur (admin).")}>
          <input value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} placeholder="admin" />
        </Field>
        <Field label={tl("Nouveau code PIN (6 chiffres)")}>
          <input className="pin-input" type="password" inputMode="numeric" value={f.pin} onChange={(e) => setF({ ...f, pin: digits(e.target.value) })} />
        </Field>
        <Field label={tl("Confirmer le code PIN")}>
          <input className="pin-input" type="password" inputMode="numeric" value={f.confirm} onChange={(e) => setF({ ...f, confirm: digits(e.target.value) })} />
        </Field>
      </div>
      {error && <div className="alert alert-danger">{error}</div>}
    </Modal>
  );
}
