import { useState } from "react";
import { ShieldCheck, LogOut } from "lucide-react";
import { api } from "../api";
import { errorMessage, useApp } from "../context/AppContext";
import { NumPad } from "../components/PinPad";
import { BrandLogo } from "../components/Brand";

/**
 * Création obligatoire du code PIN à la première connexion.
 * Le PIN sert à confirmer les actions critiques et à se connecter rapidement.
 */
export default function PinSetupPage() {
  const { user, setUser, logout } = useApp();
  const [step, setStep] = useState<"password" | "pin" | "confirm">("password");
  const [password, setPassword] = useState("");
  const [pin, setPin] = useState("");
  const [pin2, setPin2] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

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
      if (pin.length < 4) return setError("4 à 6 chiffres.");
      return setStep("confirm");
    }
    if (pin2 !== pin) {
      setPin2("");
      return setError("Les deux codes ne correspondent pas.");
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
        <h1>Bonjour {user?.full_name.split(" ")[0]}</h1>
        <p className="muted">
          Créez votre <strong>code PIN personnel</strong> (4 à 6 chiffres). Il sert à vous connecter rapidement et à confirmer
          les actions importantes (annulation, clôture de caisse, changement de prix…). Ne le communiquez à personne.
        </p>

        {step === "password" ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (password) setStep("pin");
            }}
            className="form-grid one"
          >
            <label className="field">
              <span className="field-label">Votre mot de passe actuel (pour confirmer votre identité)</span>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
            </label>
            {error && <div className="alert alert-danger">{error}</div>}
            <button className="btn btn-primary btn-lg btn-block" disabled={!password}>Continuer</button>
          </form>
        ) : (
          <>
            <div className="pin-step">{step === "pin" ? "Choisissez votre code PIN" : "Saisissez-le une seconde fois"}</div>
            <div className="pin-dots">
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <span key={i} className={`pin-dot ${i < current.length ? "on" : ""} ${i >= 4 ? "opt" : ""}`} />
              ))}
            </div>
            <div className="pin-error">{error}</div>
            <NumPad onKey={press} />
            <button className="btn btn-primary btn-lg btn-block" disabled={current.length < 4 || busy} onClick={next}>
              <ShieldCheck size={18} /> {step === "pin" ? "Suivant" : "Enregistrer mon code PIN"}
            </button>
          </>
        )}
        <button className="link-btn auth-net" onClick={logout}><LogOut size={14} /> Se déconnecter</button>
      </div>
    </div>
  );
}
