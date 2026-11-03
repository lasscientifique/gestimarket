import { useState } from "react";
import { ShieldCheck, LogOut } from "lucide-react";
import { api } from "../api";
import { errorMessage, useApp } from "../context/AppContext";
import { NumPad } from "../components/PinPad";
import { BrandLogo } from "../components/Brand";
import { tl } from "../lib/i18n";

/**
 * Mise à jour depuis la 0.13 : l'administrateur qui n'avait pas encore de PIN le crée ici
 * (6 chiffres), avec son ancien mot de passe, qui est ensuite effacé.
 */
export default function PinSetupPage() {
  const { user, setUser, logout } = useApp();
  const [step, setStep] = useState<"password" | "pin" | "confirm">("password");
  const [password, setPassword] = useState("");
  const [pin, setPin] = useState("");
  const [pin2, setPin2] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const min = user?.role === "admin" ? 6 : 4;

  const current = step === "confirm" ? pin2 : pin;
  const setCurrent = step === "confirm" ? setPin2 : setPin;

  const press = (k: string) => {
    if (k === "⌫") return setCurrent((p) => p.slice(0, -1));
    if (k === "C") return setCurrent("");
    setCurrent((p) => (p.length < 6 ? p + k : p));
  };

  const next = async () => {
    setError("");
    if (step === "pin") {
      if (pin.length < min) return setError(min === 6 ? tl("6 chiffres.") : tl("4 à 6 chiffres."));
      return setStep("confirm");
    }
    if (pin2 !== pin) {
      setPin2("");
      return setError(tl("Les deux codes ne correspondent pas."));
    }
    setBusy(true);
    try {
      setUser(await api.setMyPin(password, pin));
    } catch (e) {
      setError(errorMessage(e));
      setStep(errorMessage(e).includes("Mot de passe") ? "password" : "pin");
      setPin("");
      setPin2("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-card pin-setup">
        <BrandLogo size={58} />
        <h1>{tl("Bonjour")} {user?.full_name.split(" ")[0]}</h1>
        <p className="muted">
          {tl("Créez votre")} <strong>{tl("code PIN personnel")}</strong>  {min === 6 ? tl("(6 chiffres). Les mots de passe disparaissent : votre identifiant et ce code servent à vous connecter et à confirmer les actions importantes. Ne le communiquez à personne.") : tl("(4 à 6 chiffres). Il sert à vous connecter rapidement et à confirmer les actions importantes (annulation, clôture de caisse, changement de prix…). Ne le communiquez à personne.")}</p>

        {step === "password" ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (password) setStep("pin");
            }}
            className="form-grid one"
          >
            <label className="field">
              <span className="field-label">{tl("Votre ancien mot de passe (une dernière fois)")}</span>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
            </label>
            {error && <div className="alert alert-danger">{error}</div>}
            <button className="btn btn-primary btn-lg btn-block" disabled={!password}>{tl("Continuer")}</button>
          </form>
        ) : (
          <>
            <div className="pin-step">{step === "pin" ? tl("Choisissez votre code PIN") : tl("Saisissez-le une seconde fois")}</div>
            <div className="pin-dots">
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <span key={i} className={`pin-dot ${i < current.length ? "on" : ""} ${i >= 4 ? "opt" : ""}`} />
              ))}
            </div>
            <div className="pin-error">{error}</div>
            <NumPad onKey={press} />
            <button className="btn btn-primary btn-lg btn-block" disabled={current.length < min || busy} onClick={next}>
              <ShieldCheck size={18} /> {step === "pin" ? tl("Suivant") : tl("Enregistrer mon code PIN")}
            </button>
          </>
        )}
        <button className="link-btn auth-net" onClick={logout}><LogOut size={14} />  {tl("Se déconnecter")}</button>
      </div>
    </div>
  );
}
