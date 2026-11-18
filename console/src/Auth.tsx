import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import QRCode from "qrcode";
import { Copy, KeyRound, LogOut, MonitorSmartphone, RefreshCw, ShieldCheck, ShieldAlert } from "lucide-react";
import { errText, reportAuthFailure, sb } from "./lib/sb";
import { noteSent, resendState } from "./lib/resend";
import { ErrorBox, Field } from "./ui";
import { Logo } from "./Logo";
import { MfaHelp } from "./MfaHelp";

function Shell({ title, children, onSignOut }: { title: string; children: ReactNode; onSignOut?: () => void }) {
  return (
    <div className="auth">
      <div className="auth-card">
        <div className="auth-brand">
          <Logo size={44} />
          <div>
            <strong>Console Eden Dev</strong>
            <span>Administration de GestiMarket</span>
          </div>
        </div>
        <h2>{title}</h2>
        {children}
        {onSignOut && (
          <button className="link-btn auth-out" onClick={onSignOut}>
            <LogOut size={15} /> Se déconnecter
          </button>
        )}
      </div>
      <p className="auth-foot">Réservé à l'équipe Eden Dev · chaque action est inscrite au journal</p>
    </div>
  );
}

const digits6 = (s: string) => s.replace(/\D/g, "").slice(0, 6);

/** « Renvoyer le code » : 30 secondes entre deux envois, 5 renvois au plus, puis 1 heure. */
function ResendCode({ login, disabled, onClick }: { login: string; disabled?: boolean; onClick: () => void }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);
  const st = resendState(login, now);
  return (
    <button type="button" className="link-btn" disabled={disabled || st.wait > 0} onClick={onClick}>
      {st.blocked
        ? `Trop d'envois : réessayez dans ${Math.max(1, Math.ceil(st.wait / 60_000))} min`
        : st.wait > 0
          ? `Renvoyer le code (dans ${Math.ceil(st.wait / 1000)} s)`
          : `Renvoyer le code${st.left < 5 ? ` (encore ${st.left})` : ""}`}
    </button>
  );
}

/** Connexion par e-mail et mot de passe ; création du compte et mot de passe oublié par code reçu par e-mail. */
export function Login({ onDone }: { onDone: () => void }) {
  const [mode, setMode] = useState<"login" | "signup" | "recover">("login");
  const [step, setStep] = useState<"form" | "code" | "newpass">("form");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  const go = (m: typeof mode) => {
    setMode(m);
    setStep("form");
    setError("");
    setInfo("");
    setCode("");
  };

  const run = (f: () => Promise<void>) => async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await f();
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  };

  const mail = email.trim().toLowerCase();

  const login = run(async () => {
    const { error } = await sb.auth.signInWithPassword({ email: mail, password });
    if (error) {
      if (/Invalid login credentials/i.test(error.message)) reportAuthFailure(mail, "mot_de_passe_faux");
      throw error;
    }
    onDone();
  });

  /** Code faux ou expiré : signalé (journal des comptes), puis l'erreur affichée. */
  const verify = async (type: "signup" | "recovery") => {
    const { error } = await sb.auth.verifyOtp({ email: mail, token: digits6(code), type });
    if (error) {
      if (/expired|invalid/i.test(error.message)) reportAuthFailure(mail, "code_faux");
      throw error;
    }
  };

  const resend = async () => {
    setBusy(true);
    setError("");
    try {
      const { error } = mode === "signup" ? await sb.auth.resend({ type: "signup", email: mail }) : await sb.auth.resetPasswordForEmail(mail);
      if (error) throw error;
      noteSent(mail);
      setInfo(`Nouveau code envoyé à ${mail} (regardez aussi les courriers indésirables).`);
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  };

  const signup = run(async () => {
    if (step === "form") {
      if (password.length < 8) throw new Error("Mot de passe : 8 caractères au moins.");
      if (password !== password2) throw new Error("Les deux mots de passe sont différents.");
      const { data, error } = await sb.auth.signUp({ email: mail, password, options: { data: { console_eden_dev: true } } });
      if (error) throw error;
      if (data.session) return onDone();
      noteSent(mail);
      setStep("code");
      setInfo(`Un code à 6 chiffres vient d'être envoyé à ${mail}.`);
      return;
    }
    await verify("signup");
    onDone();
  });

  const recover = run(async () => {
    if (step === "form") {
      const { error } = await sb.auth.resetPasswordForEmail(mail);
      if (error) throw error;
      noteSent(mail);
      setStep("code");
      setInfo(`Si un compte existe avec ${mail}, un code à 6 chiffres vient d'y être envoyé.`);
      return;
    }
    if (step === "code") {
      await verify("recovery");
      setStep("newpass");
      setInfo("Code accepté : choisissez votre nouveau mot de passe.");
      return;
    }
    if (password.length < 8) throw new Error("Mot de passe : 8 caractères au moins.");
    if (password !== password2) throw new Error("Les deux mots de passe sont différents.");
    const { error } = await sb.auth.updateUser({ password });
    if (error) throw error;
    onDone();
  });

  const title = mode === "login" ? "Connexion" : mode === "signup" ? "Créer mon compte" : "Mot de passe oublié";
  const codeField = (
    <Field label="Code reçu par e-mail *">
      <input className="code-input" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(digits6(e.target.value))} autoFocus />
    </Field>
  );
  const newPass = (
    <>
      <Field label="Mot de passe *" hint="8 caractères au moins, difficile à deviner.">
        <input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </Field>
      <Field label="Le même mot de passe *">
        <input type="password" autoComplete="new-password" value={password2} onChange={(e) => setPassword2(e.target.value)} />
      </Field>
    </>
  );

  return (
    <Shell title={title}>
      <form className="stack" onSubmit={mode === "login" ? login : mode === "signup" ? signup : recover}>
        {step === "form" && (
          <Field label="E-mail *">
            <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
          </Field>
        )}
        {mode === "login" && (
          <Field label="Mot de passe *">
            <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
        )}
        {mode === "signup" && step === "form" && newPass}
        {step === "code" && codeField}
        {mode === "recover" && step === "newpass" && newPass}
        {info && <div className="alert alert-info">{info}</div>}
        {error && <ErrorBox error={error} />}
        <button className="btn btn-primary btn-block" disabled={busy || (step === "form" && !mail.includes("@")) || (step === "code" && code.length !== 6)}>
          {busy
            ? "Un instant…"
            : mode === "login"
              ? "Se connecter"
              : step === "code"
                ? "Valider le code"
                : mode === "signup"
                  ? "Créer le compte"
                  : step === "newpass"
                    ? "Enregistrer le mot de passe"
                    : "Recevoir un code"}
        </button>
      </form>
      <div className="auth-links">
        {step === "code" && <ResendCode login={mail} disabled={busy} onClick={() => void resend()} />}
        {mode !== "login" && <button className="link-btn" onClick={() => go("login")}>J'ai déjà un compte : me connecter</button>}
        {mode !== "signup" && <button className="link-btn" onClick={() => go("signup")}>Créer mon compte</button>}
        {mode !== "recover" && <button className="link-btn" onClick={() => go("recover")}>Mot de passe oublié</button>}
      </div>
      {mode === "signup" && (
        <p className="muted small">
          Après la création du compte, la Direction d'Eden Dev doit vous déclarer administrateur. Le premier compte est celui
          de l'adresse d'Eden Dev.
        </p>
      )}
    </Shell>
  );
}

/** Vérification à 2 étapes : mise en place (code QR) puis code à 6 chiffres à chaque connexion. */
export function Mfa({ enroll, onDone, onSignOut }: { enroll: boolean; onDone: () => void; onSignOut: () => void }) {
  const [factorId, setFactorId] = useState("");
  const [factors, setFactors] = useState<{ id: string; name: string }[]>([]);
  const [email, setEmail] = useState("");
  const [qr, setQr] = useState("");
  const [secret, setSecret] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let stop = false;
    (async () => {
      try {
        const { data, error } = await sb.auth.mfa.listFactors();
        if (error) throw error;
        sb.auth.getUser().then(({ data: u }) => !stop && setEmail(u.user?.email ?? ""), () => undefined);
        const verified = data.totp.filter((f) => f.status === "verified");
        if (verified.length) {
          if (stop) return;
          // Téléphone principal et téléphone de secours : la personne choisit celui qu'elle a en main.
          setFactors(verified.map((f, i) => ({ id: f.id, name: f.friendly_name?.startsWith("Téléphone de secours") ? "Téléphone de secours" : i === 0 ? "Téléphone principal" : `Téléphone ${i + 1}` })));
          return setFactorId(verified[0].id);
        }
        // Essai précédent pas terminé : on recommence proprement.
        for (const f of data.all.filter((x) => x.status !== "verified")) await sb.auth.mfa.unenroll({ factorId: f.id });
        const r = await sb.auth.mfa.enroll({ factorType: "totp", friendlyName: `Console Eden Dev ${new Date().toISOString().slice(0, 10)}` });
        if (r.error) throw r.error;
        if (stop) return;
        setFactorId(r.data.id);
        setSecret(r.data.totp.secret);
        setQr(await QRCode.toDataURL(r.data.totp.uri, { margin: 1, width: 240 }));
      } catch (e) {
        if (!stop) setError(errText(e));
      }
    })();
    return () => {
      stop = true;
    };
  }, []);

  const verify = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const { error } = await sb.auth.mfa.challengeAndVerify({ factorId, code: digits6(code) });
      if (error) {
        if (/invalid|expired|incorrect/i.test(error.message)) reportAuthFailure(email, "code_2_etapes_faux");
        throw error;
      }
      onDone();
    } catch (err) {
      setError(errText(err));
      setCode("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell title={enroll && secret ? "Vérification à 2 étapes" : "Code de vérification"} onSignOut={onSignOut}>
      {enroll && secret ? (
        <div className="stack">
          <p className="muted">
            <ShieldCheck size={16} className="inline" /> Obligatoire pour la console. Installez <strong>Google Authenticator</strong> (ou
            Microsoft Authenticator) sur votre téléphone, touchez <strong>+</strong>, puis scannez ce code :
          </p>
          {qr && <img className="mfa-qr" src={qr} alt="Code QR de la vérification à 2 étapes" />}
          <p className="muted small">
            Pas de caméra ? Tapez cette clé dans l'application :{" "}
            <span className="mono break">{secret}</span>{" "}
            <button type="button" className="icon-btn" aria-label="Copier la clé" onClick={() => navigator.clipboard?.writeText(secret)}>
              <Copy size={14} />
            </button>
          </p>
        </div>
      ) : (
        <p className="muted">
          <KeyRound size={16} className="inline" /> Ouvrez Google Authenticator sur votre téléphone et tapez le code à 6 chiffres de
          « Console Eden Dev ».
        </p>
      )}
      {factors.length > 1 && (
        <div className="chips">
          {factors.map((f) => (
            <button key={f.id} type="button" className={`chip-btn${factorId === f.id ? " active" : ""}`} onClick={() => setFactorId(f.id)}>
              {f.name}
            </button>
          ))}
        </div>
      )}
      <MfaHelp open={enroll && !!secret} />
      <form className="stack" onSubmit={verify}>
        <Field label="Code à 6 chiffres *">
          <input className="code-input" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(digits6(e.target.value))} autoFocus />
        </Field>
        {error && <ErrorBox error={error} />}
        <button className="btn btn-primary btn-block" disabled={busy || !factorId || code.length !== 6}>
          {busy ? "Vérification…" : "Valider"}
        </button>
      </form>
    </Shell>
  );
}

export function NotAdmin({ email, disabled, onRetry, onSignOut }: { email: string; disabled?: boolean; onRetry: () => void; onSignOut: () => void }) {
  return (
    <Shell title={disabled ? "Compte désactivé" : "Compte pas encore administrateur"} onSignOut={onSignOut}>
      <div className="alert alert-warning">
        <ShieldAlert size={18} />
        <span>
          {disabled
            ? `Le compte ${email} a été désactivé par la Direction d'Eden Dev.`
            : `Le compte ${email} existe, mais il n'est pas administrateur Eden Dev. Demandez à la Direction de vous ajouter (Équipe → Ajouter un membre) avec cette adresse, puis réessayez.`}
        </span>
      </div>
      <button className="btn btn-block" onClick={onRetry}>
        <RefreshCw size={16} /> Réessayer
      </button>
    </Shell>
  );
}

export function DeviceWait({ label, revoked, onRetry, onSignOut }: { label: string; revoked: boolean; onRetry: () => void; onSignOut: () => void }) {
  return (
    <Shell title={revoked ? "Appareil retiré" : "Appareil à autoriser"} onSignOut={onSignOut}>
      <div className={`alert ${revoked ? "alert-danger" : "alert-info"}`}>
        <MonitorSmartphone size={18} />
        <span>
          {revoked
            ? `Cet appareil (${label}) a été retiré de la console. Demandez à la Direction de l'autoriser de nouveau.`
            : `Première connexion depuis cet appareil (${label}). Par sécurité, la Direction doit l'autoriser une fois : Équipe → Appareils → Autoriser. Ensuite, touchez « Réessayer ».`}
        </span>
      </div>
      <button className="btn btn-block" onClick={onRetry}>
        <RefreshCw size={16} /> Réessayer
      </button>
    </Shell>
  );
}
