import { useCallback, useEffect, useState, type FormEvent } from "react";
import { LogIn, Network, ArrowLeft, KeyRound, Loader2 } from "lucide-react";
import { api } from "../api";
import { errorMessage, useApp } from "../context/AppContext";
import { getNetwork, isTauri } from "../lib/transport";
import { ROLE_LABELS } from "../lib/format";
import { Modal } from "../components/ui";
import { NetworkForm } from "../components/NetworkForm";
import { BoutiquesPanel } from "../components/BoutiquesPanel";
import { NumPad } from "../components/PinPad";
import { BrandLogo } from "../components/Brand";
import type { Role } from "../types";

type LoginUser = { id: number; username: string; full_name: string; role: Role; has_pin: boolean };

const initials = (n: string) =>
  n
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();

/**
 * Connexion : on touche son nom puis on tape son code PIN (rapide pour les caissiers),
 * ou connexion classique identifiant + mot de passe.
 */
export default function LoginPage() {
  const { settings, setUser } = useApp();
  const [users, setUsers] = useState<LoginUser[] | null>(null);
  const [selected, setSelected] = useState<LoginUser | null>(null);
  const [mode, setMode] = useState<"tiles" | "password">("tiles");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [netOpen, setNetOpen] = useState(false);
  const net = getNetwork();
  const modeLabel = net?.config.mode === "client" ? `Poste client · serveur ${net.config.server_url}` : net?.config.mode === "server" ? "Poste serveur" : "Poste unique";

  useEffect(() => {
    api.listLoginUsers()
      .then(setUsers)
      .catch((e) => {
        setUsers([]);
        setError(errorMessage(e));
        setMode("password");
      });
  }, []);

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

  const press = useCallback(
    (k: string) => {
      if (k === "⌫") return setPin((p) => p.slice(0, -1));
      if (k === "C") return setPin("");
      setPin((p) => (p.length < 6 ? p + k : p));
    },
    [],
  );

  // Saisie au clavier physique aussi.
  useEffect(() => {
    if (!selected?.has_pin) return;
    const onKey = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) press(e.key);
      else if (e.key === "Backspace") press("⌫");
      else if (e.key === "Enter") loginPin(pin);
      else if (e.key === "Escape") setSelected(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected, press, loginPin, pin]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      setUser(await api.login(username, password));
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
    else {
      setUsername(u.username);
      setMode("password");
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-shell">
        <div className="auth-hero">
          <BrandLogo size={84} />
          <h1>{settings.shop_name || "GestiMarket"}</h1>
          <p>{settings.shop_address || "Caisse et gestion de magasin"}</p>
          <span className="auth-hero-foot">GestiMarket</span>
        </div>

        <div className="auth-card">
          {mode === "tiles" && !selected && (
            <>
              <h2>Qui êtes-vous ?</h2>
              <p className="muted">Touchez votre nom, puis tapez votre code PIN.</p>
              {users === null ? (
                <div className="loading"><Loader2 className="spin" size={20} /></div>
              ) : (
                <div className="user-tiles">
                  {users.map((u) => (
                    <button key={u.id} className={`user-tile role-${u.role}`} onClick={() => choose(u)}>
                      <span className="user-tile-avatar">{initials(u.full_name)}</span>
                      <strong>{u.full_name}</strong>
                      <span>{ROLE_LABELS[u.role]}</span>
                    </button>
                  ))}
                </div>
              )}
              <button className="btn btn-block" onClick={() => setMode("password")}><KeyRound size={16} /> Connexion avec mot de passe</button>
            </>
          )}

          {mode === "tiles" && selected && (
            <>
              <button className="link-btn back" onClick={() => setSelected(null)}><ArrowLeft size={15} /> Changer d'utilisateur</button>
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
                <LogIn size={18} /> Se connecter
              </button>
            </>
          )}

          {mode === "password" && (
            <form onSubmit={submit} className="form-grid one">
              {users && users.length > 0 && (
                <button type="button" className="link-btn back" onClick={() => { setMode("tiles"); setError(""); }}>
                  <ArrowLeft size={15} /> Connexion rapide par code PIN
                </button>
              )}
              <h2>Connexion</h2>
              <label className="field">
                <span className="field-label">Identifiant</span>
                <input value={username} onChange={(e) => setUsername(e.target.value)} autoFocus={!username} autoComplete="username" />
              </label>
              <label className="field">
                <span className="field-label">Mot de passe</span>
                <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus={!!username} autoComplete="current-password" />
              </label>
              {error && <div className="alert alert-danger">{error}</div>}
              <button className="btn btn-primary btn-lg btn-block" disabled={busy || !username || !password}>
                <LogIn size={18} /> {busy ? "Connexion…" : "Se connecter"}
              </button>
            </form>
          )}

          <BoutiquesPanel compact />

          {isTauri && (
            <button type="button" className="link-btn auth-net" onClick={() => setNetOpen(true)}>
              <Network size={14} /> {modeLabel} — modifier
            </button>
          )}
        </div>
      </div>
      {netOpen && (
        <Modal title="Réseau multi-postes" onClose={() => setNetOpen(false)} width={720}>
          <NetworkForm />
        </Modal>
      )}
    </div>
  );
}
