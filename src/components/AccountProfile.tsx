import { useState, type FormEvent } from "react";
import { AtSign, MailCheck, MessageCircle, Store } from "lucide-react";
import { errorMessage, useApp } from "../context/AppContext";
import { owner, type EmailChange, type PhoneChange, type StoreInfo } from "../lib/owner";
import { DIAL_CODES, dialFor, showPhone, toE164, validPhone } from "../lib/phone";
import { countryName } from "../lib/countries";
import { tl } from "../lib/i18n";
import { Field, Modal } from "./ui";

/** Numéro WhatsApp : indicatif du pays (celui de la boutique par défaut) et numéro, rendu au format international. */
export function PhoneInput({ country, onChange, autoFocus }: { country?: string | null; onChange: (e164: string) => void; autoFocus?: boolean }) {
  const [dial, setDial] = useState(() => dialFor(country));
  const [local, setLocal] = useState("");
  const update = (d: string, l: string) => {
    setDial(d);
    setLocal(l);
    onChange(toE164(l, d));
  };
  return (
    <div className="phone-input">
      <select value={dial} onChange={(e) => update(e.target.value, local)} aria-label={tl("Indicatif du pays")}>
        {DIAL_CODES.map((c) => (
          <option key={c.dial} value={c.dial}>+{c.dial} {countryName(c.code, c.code)}</option>
        ))}
      </select>
      <input inputMode="tel" autoComplete="tel-national" value={local} onChange={(e) => update(dial, e.target.value)} placeholder="76 59 36 76" required autoFocus={autoFocus} />
    </div>
  );
}

/** Champ du code à 6 chiffres reçu par e-mail ou sur WhatsApp. */
function CodeInput({ value, onChange, whatsapp = false }: { value: string; onChange: (v: string) => void; whatsapp?: boolean }) {
  return (
    <Field label={whatsapp ? tl("Code reçu sur WhatsApp") : tl("Code reçu par e-mail")}>
      <input
        className="mono"
        inputMode="numeric"
        autoComplete="one-time-code"
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, 10))}
        required
        autoFocus
      />
    </Field>
  );
}

/** Action en cours, erreur affichée : même comportement pour toutes les fenêtres du compte. */
function useRun() {
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
  return { busy, error, run };
}

/**
 * Code reçu pour confirmer le compte (réglages « Confirm email » / « Confirm phone » de Supabase) ou pour se
 * connecter par WhatsApp, avec « Renvoyer le code » s'il n'est pas arrivé ou a expiré. Internet nécessaire.
 * `email` : l'adresse ou le numéro WhatsApp (format international) qui a reçu le code.
 */
export function ConfirmCode({ email, confirm, resend, onBack, signIn = false }: {
  email: string;
  confirm: (code: string) => Promise<void>;
  resend: () => Promise<unknown>;
  onBack?: () => void;
  /** Connexion par code (et non confirmation de l'inscription). */
  signIn?: boolean;
}) {
  const whatsapp = !email.includes("@");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const { busy, error, run } = useRun();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run(() => confirm(code));
  };
  return (
    <form onSubmit={submit} className="stack confirm-code">
      <div className="alert alert-info">
        {whatsapp ? <MessageCircle size={16} /> : <MailCheck size={16} />}{" "}
        {whatsapp
          ? tl("Un code vient d'être envoyé sur WhatsApp au {0}.", [showPhone(email)])
          : tl("Confirmez l'adresse du compte : un code a été envoyé à {0} (regardez aussi les courriers indésirables).", [email])}
      </div>
      <CodeInput value={code} onChange={setCode} whatsapp={whatsapp} />
      {sent && <div className="alert alert-success">{tl("Nouveau code envoyé.")}</div>}
      {error && <div className="alert alert-danger">{error}</div>}
      <button className="btn btn-primary btn-block" disabled={busy || code.length < 6}>
        {busy ? tl("Vérification…") : signIn ? tl("Se connecter") : whatsapp ? tl("Confirmer le numéro") : tl("Confirmer l'adresse")}
      </button>
      <div className="row-between">
        <button type="button" className="link-btn small" disabled={busy} onClick={() => void run(async () => { setSent(false); await resend(); setSent(true); })}>
          {tl("Renvoyer le code")}</button>
        {onBack && <button type="button" className="link-btn small" onClick={onBack}>{tl("Retour")}</button>}
      </div>
    </form>
  );
}

/**
 * Changer l'e-mail du compte Eden Dev : mot de passe actuel et nouvelle adresse, puis le code reçu à la
 * nouvelle adresse (et celui de l'ancienne si Supabase en demande deux). Internet nécessaire.
 */
export function ChangeEmailModal({ email, onClose, onDone }: { email: string; onClose: () => void; onDone?: (email: string) => void }) {
  const { toast } = useApp();
  const [step, setStep] = useState<"form" | "new" | "old">("form");
  const [password, setPassword] = useState("");
  const [next, setNext] = useState("");
  const [code, setCode] = useState("");
  const { busy, error, run } = useRun();

  const after = (r: EmailChange) => {
    if (r.done) {
      toast.success(tl("Adresse du compte changée : {0}.", [r.email]));
      onDone?.(r.email);
      onClose();
      return;
    }
    setCode("");
    setStep(r.other ? "old" : "new");
  };

  const start = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => after(await owner.emailChangeStart(email, password, next)));
  };
  const confirm = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => after(await owner.emailChangeConfirm(email, next, code, step === "old" ? "old" : "new")));
  };

  return (
    <Modal title={<><AtSign size={18} />  {tl("Changer l'e-mail du compte")}</>} onClose={onClose} width={480}>
      {step === "form" ? (
        <form onSubmit={start} className="stack">
          <p className="muted">{tl("La nouvelle adresse sert à se connecter et à recevoir les codes (mot de passe oublié). Internet est nécessaire.")}</p>
          <Field label={tl("Compte")}>
            <input value={email.includes("@") ? email : showPhone(email)} readOnly />
          </Field>
          <Field label={tl("Mot de passe du compte")}>
            <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required autoFocus />
          </Field>
          <Field label={tl("Nouvelle adresse e-mail")}>
            <input type="email" autoComplete="email" value={next} onChange={(e) => setNext(e.target.value)} required />
          </Field>
          {error && <div className="alert alert-danger">{error}</div>}
          <button className="btn btn-primary btn-block" disabled={busy || !password || !next}>{busy ? tl("Envoi…") : tl("Recevoir le code")}</button>
        </form>
      ) : (
        <form onSubmit={confirm} className="stack">
          <div className="alert alert-info">
            <MailCheck size={16} />{" "}
            {step === "old"
              ? tl("Dernière étape : tapez le code envoyé à l'ancienne adresse, {0}.", [email])
              : tl("Un code vient d'être envoyé à {0} (regardez aussi les courriers indésirables).", [next])}
          </div>
          <CodeInput value={code} onChange={setCode} />
          {error && <div className="alert alert-danger">{error}</div>}
          <button className="btn btn-primary btn-block" disabled={busy || code.length < 6}>{busy ? tl("Vérification…") : tl("Changer l'adresse")}</button>
          <button type="button" className="link-btn small" onClick={() => { setStep("form"); setCode(""); }}>{tl("Renvoyer un code")}</button>
        </form>
      )}
    </Modal>
  );
}

/**
 * Ajouter ou changer le numéro WhatsApp du compte : mot de passe et nouveau numéro, puis le code reçu sur
 * WhatsApp à ce numéro. Le compte s'ouvre ensuite aussi avec ce numéro. Internet nécessaire.
 * `login` : l'e-mail ou le numéro avec lequel la propriétaire se connecte.
 */
export function ChangePhoneModal({ login, country, onClose, onDone }: { login: string; country?: string | null; onClose: () => void; onDone?: (phone: string) => void }) {
  const { toast } = useApp();
  const [step, setStep] = useState<"form" | "code">("form");
  const [password, setPassword] = useState("");
  const [next, setNext] = useState("");
  const [code, setCode] = useState("");
  const { busy, error, run } = useRun();

  const after = (r: PhoneChange) => {
    if (r.done) {
      toast.success(tl("Numéro WhatsApp du compte enregistré : {0}.", [showPhone(r.phone)]));
      onDone?.(r.phone);
      onClose();
      return;
    }
    setCode("");
    setStep("code");
  };

  const start = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      if (!validPhone(next)) throw new Error(tl("Numéro WhatsApp invalide : tapez-le avec l'indicatif du pays (ex. +223 76 59 36 76)."));
      after(await owner.phoneChangeStart(login, password, next));
    });
  };
  const confirm = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => after(await owner.phoneChangeConfirm(login, next, code)));
  };

  return (
    <Modal title={<><MessageCircle size={18} />  {tl("Numéro WhatsApp du compte")}</>} onClose={onClose} width={480}>
      {step === "form" ? (
        <form onSubmit={start} className="stack">
          <p className="muted">{tl("Avec ce numéro, le compte s'ouvre aussi par un code reçu sur WhatsApp, sans mot de passe. Internet est nécessaire.")}</p>
          <Field label={tl("Compte")}>
            <input value={login.includes("@") ? login : showPhone(login)} readOnly />
          </Field>
          <Field label={tl("Mot de passe du compte")}>
            <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required autoFocus />
          </Field>
          <Field label={tl("Numéro WhatsApp")}>
            <PhoneInput country={country} onChange={setNext} />
          </Field>
          {error && <div className="alert alert-danger">{error}</div>}
          <button className="btn btn-primary btn-block" disabled={busy || !password || !next}>{busy ? tl("Envoi…") : tl("Recevoir le code sur WhatsApp")}</button>
        </form>
      ) : (
        <form onSubmit={confirm} className="stack">
          <div className="alert alert-info">
            <MessageCircle size={16} />  {tl("Un code vient d'être envoyé sur WhatsApp au {0}.", [showPhone(next)])}
          </div>
          <CodeInput value={code} onChange={setCode} whatsapp />
          {error && <div className="alert alert-danger">{error}</div>}
          <button className="btn btn-primary btn-block" disabled={busy || code.length < 6}>{busy ? tl("Vérification…") : tl("Confirmer le numéro")}</button>
          <button type="button" className="link-btn small" onClick={() => { setStep("form"); setCode(""); }}>{tl("Renvoyer un code")}</button>
        </form>
      )}
    </Modal>
  );
}

const EMPTY_INFO: StoreInfo = { owner_name: "", phone: "", city: "", address: "" };

const toInfo = (s: Partial<StoreInfo>): StoreInfo => ({
  owner_name: s.owner_name ?? "",
  phone: s.phone ?? "",
  city: s.city ?? "",
  address: s.address ?? "",
});

/**
 * Informations de la boutique enregistrées chez Eden Dev : nom complet de la propriétaire, téléphone, ville,
 * adresse. Sur le PC (`initial` absent), le mot de passe du compte est demandé d'abord ; sur le téléphone,
 * la connexion de l'Espace propriétaire suffit. Internet nécessaire.
 */
export function StoreInfoModal({ code, name, email, initial, onClose, onSaved }: {
  code: string;
  name: string;
  email: string;
  initial?: Partial<StoreInfo> | null;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const { toast } = useApp();
  const withPassword = !initial;
  const [password, setPassword] = useState("");
  const [fields, setFields] = useState<StoreInfo | null>(initial ? toInfo(initial) : null);
  const { busy, error, run } = useRun();
  const set = (k: keyof StoreInfo) => (e: { target: { value: string } }) => setFields({ ...(fields ?? EMPTY_INFO), [k]: e.target.value });

  const load = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => setFields(toInfo(await owner.storeInfo(code, email, password))));
  };
  const save = (e: FormEvent) => {
    e.preventDefault();
    if (!fields) return;
    void run(async () => {
      await owner.updateStore({ ...fields, store_code: code, email, password: withPassword ? password : undefined });
      toast.success(tl("Informations de la boutique enregistrées."));
      onSaved?.();
      onClose();
    });
  };

  return (
    <Modal title={<><Store size={18} />  {tl("Informations de la boutique")}</>} onClose={onClose} width={520}>
      <p className="muted small">{tl("{0} ({1}). Le nom de la boutique, le pays et le type ne changent pas : demandez à Eden Dev si besoin.", [name, code])}</p>
      {!fields ? (
        <form onSubmit={load} className="stack">
          <Field label={tl("Mot de passe du compte ({0})", [email])}>
            <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required autoFocus />
          </Field>
          {error && <div className="alert alert-danger">{error}</div>}
          <button className="btn btn-primary btn-block" disabled={busy || !password}>{busy ? tl("Connexion…") : tl("Continuer")}</button>
        </form>
      ) : (
        <form onSubmit={save} className="stack">
          <div className="form-grid">
            <label className="field span-2">
              <span className="field-label">{tl("Nom complet de la propriétaire *")}</span>
              <input value={fields.owner_name} onChange={set("owner_name")} required />
            </label>
            <label className="field">
              <span className="field-label">{tl("Téléphone")}</span>
              <input value={fields.phone} onChange={set("phone")} inputMode="tel" />
            </label>
            <label className="field">
              <span className="field-label">{tl("Ville *")}</span>
              <input value={fields.city} onChange={set("city")} required />
            </label>
            <label className="field span-2">
              <span className="field-label">{tl("Adresse *")}</span>
              <input value={fields.address} onChange={set("address")} placeholder={tl("Quartier, rue, repère")} required />
            </label>
          </div>
          {error && <div className="alert alert-danger">{error}</div>}
          <button className="btn btn-primary btn-block" disabled={busy}>{busy ? tl("Enregistrement…") : tl("Enregistrer")}</button>
        </form>
      )}
    </Modal>
  );
}
