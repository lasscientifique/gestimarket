import { useState, type FormEvent } from "react";
import { Lock, LockOpen } from "lucide-react";
import { api } from "../api";
import { useApp } from "../context/AppContext";
import { tl } from "../lib/i18n";
import type { BackupStatus } from "../types";
import { HelpTip } from "./Help";
import { Field } from "./ui";

/**
 * Sauvegardes protégées par un mot de passe (au choix) : les copies envoyées par WhatsApp ou rangées sur
 * Google Drive ne peuvent être lues qu'avec ce mot de passe. Sans lui, personne ne peut les restaurer.
 */
export function BackupProtectionCard({ status, onChange }: { status: BackupStatus | null; onChange: (s: BackupStatus) => void }) {
  const { toast, askPin, confirm: ask } = useApp();
  const [editing, setEditing] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const on = !!status?.protected;

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (password.trim().length < 8) return setError(tl("Mot de passe des sauvegardes : au moins 8 caractères."));
    if (password !== confirm) return setError(tl("Les mots de passe ne correspondent pas."));
    const pin = await askPin({ title: tl("Protéger les sauvegardes"), level: "admin" });
    if (!pin) return;
    setBusy(true);
    try {
      onChange(await api.backupProtect(password, pin));
      toast.success(tl("Les prochaines sauvegardes seront protégées par ce mot de passe."));
      setEditing(false);
      setPassword("");
      setConfirm("");
      setError("");
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };

  const removeProtection = async () => {
    const yes = await ask({
      title: tl("Retirer la protection"),
      message: tl("Les prochaines sauvegardes ne seront plus protégées : toute personne qui reçoit le fichier pourra lire les données de la boutique. Les copies déjà protégées gardent leur mot de passe."),
      confirmLabel: tl("Retirer la protection"),
      danger: true,
    });
    if (!yes) return;
    const pin = await askPin({ title: tl("Retirer la protection des sauvegardes"), level: "admin" });
    if (!pin) return;
    try {
      onChange(await api.backupProtect(null, pin));
      toast.success(tl("Les prochaines sauvegardes ne sont plus protégées."));
    } catch (err) {
      toast.error(err);
    }
  };

  return (
    <div className="card">
      <h3 className="card-title">{on ? <Lock size={18} /> : <LockOpen size={18} />}  {tl("Protéger les sauvegardes par un mot de passe")} <HelpTip k="backup_password" /></h3>
      <p className="muted">
        {on
          ? tl("Les sauvegardes sont protégées : un fichier envoyé par WhatsApp ou rangé sur Google Drive ne peut être ouvert qu'avec le mot de passe. Les copies de ce poste se restaurent sans le retaper.")
          : tl("Une sauvegarde contient tout : clients, dettes, ventes. Protégée par un mot de passe, elle ne peut être lue par personne d'autre, même si le fichier est envoyé par WhatsApp ou perdu avec une clé USB.")}
      </p>
      {!editing ? (
        <div className="row-start">
          <button className="btn" onClick={() => setEditing(true)}><Lock size={16} />  {on ? tl("Changer le mot de passe") : tl("Protéger par un mot de passe")}</button>
          {on && <button className="btn" onClick={removeProtection}><LockOpen size={16} />  {tl("Retirer la protection")}</button>}
        </div>
      ) : (
        <form className="stack" onSubmit={save}>
          <div className="alert alert-warning">
            {tl("Notez ce mot de passe sur papier et gardez-le en lieu sûr : sans lui, personne (pas même Eden Dev) ne peut ouvrir les sauvegardes protégées.")}
          </div>
          <div className="form-grid">
            <Field label={tl("Mot de passe des sauvegardes")} hint={tl("8 caractères au moins.")}>
              <input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
            </Field>
            <Field label={tl("Confirmation")}>
              <input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            </Field>
          </div>
          {error && <div className="alert alert-danger">{error}</div>}
          <div className="row-start">
            <button className="btn btn-primary" disabled={busy}>{tl("Enregistrer")}</button>
            <button type="button" className="btn" onClick={() => { setEditing(false); setError(""); }}>{tl("Annuler")}</button>
          </div>
        </form>
      )}
    </div>
  );
}
