import { useState, type FormEvent } from "react";
import { KeyRound, MailCheck } from "lucide-react";
import { errorMessage, useApp } from "../context/AppContext";
import { owner } from "../lib/owner";
import { tl } from "../lib/i18n";
import { loginId, looksLikePhone, showPhone } from "../lib/phone";
import { WhatsAppWriteFirst } from "./AccountProfile";
import { Field, Modal } from "./ui";

/** Même règle que le moteur (account.rs) : 8 caractères au moins, lettres et chiffres. */
export function passwordProblem(p: string): string | null {
  if (p.length < 8) return tl("Mot de passe trop court : au moins 8 caractères, avec des lettres et des chiffres.");
  if (!/[A-Za-zÀ-ÿ]/.test(p) || !/[0-9]/.test(p)) return tl("Mot de passe trop faible : mélangez des lettres et des chiffres.");
  return null;
}

function NewPassword({ value, confirm, onValue, onConfirm }: { value: string; confirm: string; onValue: (v: string) => void; onConfirm: (v: string) => void }) {
  return (
    <>
      <Field label={tl("Nouveau mot de passe")} hint={tl("8 caractères au moins, avec des lettres et des chiffres. Évitez 12345678, votre nom ou celui de la boutique.")}>
        <input type="password" autoComplete="new-password" value={value} onChange={(e) => onValue(e.target.value)} required />
      </Field>
      <Field label={tl("Confirmation")}>
        <input type="password" autoComplete="new-password" value={confirm} onChange={(e) => onConfirm(e.target.value)} required />
      </Field>
    </>
  );
}

/**
 * « Mot de passe oublié » du compte Eden Dev : un code est envoyé par e-mail, puis on choisit un nouveau mot
 * de passe. `login` : l'Espace propriétaire reste ensuite connecté sur cet appareil. Internet nécessaire.
 */
export function ForgotPasswordModal({ email: initial = "", login: stay = false, onClose, onDone }: { email?: string; login?: boolean; onClose: () => void; onDone?: () => void }) {
  const { toast } = useApp();
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState(initial);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const run = async (f: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await f();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  // E-mail, ou numéro WhatsApp tapé avec ou sans indicatif : le code part sur WhatsApp.
  const login = loginId(email);
  const byWhatsapp = !login.includes("@");

  const send = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      await owner.recover(login);
      setStep("code");
    });
  };

  const reset = (e: FormEvent) => {
    e.preventDefault();
    const problem = passwordProblem(password);
    if (problem) return setError(problem);
    if (password !== confirm) return setError(tl("Les mots de passe ne correspondent pas."));
    void run(async () => {
      await owner.resetPassword(login, code, password, stay);
      toast.success(tl("Nouveau mot de passe enregistré."));
      onDone?.();
      onClose();
    });
  };

  return (
    <Modal title={<><KeyRound size={18} />  {tl("Mot de passe oublié")}</>} onClose={onClose} width={480}>
      {step === "email" ? (
        <form onSubmit={send} className="stack">
          <p className="muted">{tl("Tapez l'e-mail ou le numéro WhatsApp du compte de la boutique : Eden Dev y envoie un code pour choisir un nouveau mot de passe. Internet est nécessaire.")}</p>
          <Field label={tl("E-mail ou numéro WhatsApp")}>
            <input autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
          </Field>
          {byWhatsapp && looksLikePhone(email) && <WhatsAppWriteFirst />}
          {error && <div className="alert alert-danger">{error}</div>}
          <button className="btn btn-primary btn-block" disabled={busy || !email}>{busy ? tl("Envoi…") : tl("Recevoir le code")}</button>
        </form>
      ) : (
        <form onSubmit={reset} className="stack">
          <div className="alert alert-info">
            <MailCheck size={16} />{" "}
            {byWhatsapp
              ? tl("Si un compte existe avec le numéro {0}, un code vient d'être envoyé sur WhatsApp.", [showPhone(login)])
              : tl("Si un compte existe à l'adresse {0}, un code vient d'y être envoyé (regardez aussi les courriers indésirables).", [login])}
          </div>
          <Field label={byWhatsapp ? tl("Code reçu sur WhatsApp") : tl("Code reçu par e-mail")}>
            <input className="mono" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 10))} required autoFocus />
          </Field>
          <NewPassword value={password} confirm={confirm} onValue={setPassword} onConfirm={setConfirm} />
          {error && <div className="alert alert-danger">{error}</div>}
          <button className="btn btn-primary btn-block" disabled={busy || code.length < 6}>{busy ? tl("Enregistrement…") : tl("Enregistrer le nouveau mot de passe")}</button>
          <button type="button" className="link-btn small" onClick={() => { setStep("email"); setCode(""); }}>{tl("Renvoyer un code")}</button>
        </form>
      )}
    </Modal>
  );
}

/** Changer le mot de passe du compte Eden Dev (l'actuel est demandé). Internet nécessaire. */
export function ChangePasswordModal({ email: initial = "", onClose }: { email?: string; onClose: () => void }) {
  const { toast } = useApp();
  const [email, setEmail] = useState(initial);
  const [current, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [forgot, setForgot] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const problem = passwordProblem(password);
    if (problem) return setError(problem);
    if (password !== confirm) return setError(tl("Les mots de passe ne correspondent pas."));
    setBusy(true);
    setError("");
    try {
      await owner.changePassword(loginId(email), current, password);
      toast.success(tl("Mot de passe du compte changé."));
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (forgot) return <ForgotPasswordModal email={email} onClose={onClose} />;
  return (
    <Modal title={<><KeyRound size={18} />  {tl("Changer le mot de passe du compte")}</>} onClose={onClose} width={480}>
      <form onSubmit={submit} className="stack">
        <Field label={tl("E-mail ou numéro WhatsApp")}>
          <input autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required readOnly={!!initial} />
        </Field>
        <Field label={tl("Mot de passe actuel")}>
          <input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required autoFocus />
        </Field>
        <NewPassword value={password} confirm={confirm} onValue={setPassword} onConfirm={setConfirm} />
        {error && <div className="alert alert-danger">{error}</div>}
        <button className="btn btn-primary btn-block" disabled={busy}>{busy ? tl("Enregistrement…") : tl("Changer le mot de passe")}</button>
        <button type="button" className="link-btn small" onClick={() => setForgot(true)}>{tl("Mot de passe actuel oublié ?")}</button>
      </form>
    </Modal>
  );
}
