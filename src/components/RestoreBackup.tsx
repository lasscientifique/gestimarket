import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { appCacheDir, join } from "@tauri-apps/api/path";
import { readFile, remove, writeFile } from "@tauri-apps/plugin-fs";
import { ArchiveRestore, FileUp, Lock, ShieldAlert } from "lucide-react";
import { api } from "../api";
import { errorMessage, useApp } from "../context/AppContext";
import { dateTime } from "../lib/format";
import { tl } from "../lib/i18n";
import { isMobileApp } from "../lib/transport";
import type { BackupFile, BackupInfo } from "../types";
import { Field, Modal } from "./ui";

const mb = (n: number) => (n / 1_048_576).toLocaleString(undefined, { maximumFractionDigits: 1 });

/**
 * Choisit le fichier de sauvegarde. Sur PC : son chemin. Sur téléphone et tablette, le système donne une
 * adresse que seul le module fs sait lire : le fichier est copié dans le cache de l'application.
 */
async function pickBackup(): Promise<{ path: string; temp: boolean } | null> {
  if (isMobileApp) {
    const uri = await open({ multiple: false });
    if (!uri || Array.isArray(uri)) return null;
    const path = await join(await appCacheDir(), `gestimarket-restauration-${Date.now()}.bin`);
    await writeFile(path, await readFile(uri));
    return { path, temp: true };
  }
  const path = await open({
    multiple: false,
    title: tl("Choisir la sauvegarde à restaurer"),
    filters: [{ name: tl("Sauvegarde GestiMarket"), extensions: ["db", "gmsave"] }],
  });
  if (!path || Array.isArray(path)) return null;
  return { path, temp: false };
}

/**
 * Restaurer une sauvegarde : choix du fichier (ou d'une copie de cet appareil), contenu affiché, mot de passe
 * si elle est protégée, puis remplacement de la base. `fresh` : appareil neuf (premier démarrage), sans code PIN.
 */
export function RestoreBackupModal({ fresh = false, onClose, onRestored }: { fresh?: boolean; onClose: () => void; onRestored?: () => void }) {
  const { toast, askPin } = useApp();
  const [files, setFiles] = useState<BackupFile[]>([]);
  const [chosen, setChosen] = useState<{ path: string; temp: boolean } | null>(null);
  const [info, setInfo] = useState<BackupInfo | null>(null);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api.backupList().then(setFiles).catch(() => undefined);
  }, []);

  // Copie temporaire (téléphone) effacée en quittant.
  useEffect(() => () => void (chosen?.temp && remove(chosen.path).catch(() => undefined)), [chosen]);

  const inspect = async (file: { path: string; temp: boolean }, pwd?: string) => {
    setBusy(true);
    setError("");
    try {
      setChosen(file);
      setInfo(await api.backupInspect(file.path, pwd));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const choose = async () => {
    try {
      const f = await pickBackup();
      if (f) {
        setPassword("");
        setInfo(null);
        await inspect(f);
      }
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const restore = async () => {
    if (!chosen) return;
    let pin: string | null = null;
    if (!fresh) {
      pin = await askPin({
        title: tl("Restaurer la sauvegarde"),
        message: tl("Les données actuelles seront remplacées par celles de la sauvegarde. Une copie de sécurité est faite avant."),
        level: "admin",
      });
      if (!pin) return;
    }
    setBusy(true);
    setError("");
    try {
      const r = await api.backupRestore(chosen.path, password || null, pin);
      toast.success(
        r.safety_copy
          ? tl("Sauvegarde restaurée. Les anciennes données sont gardées dans {0}. Reconnectez-vous avec les codes PIN de la sauvegarde.", [r.safety_copy])
          : tl("Sauvegarde restaurée. Connectez-vous avec les codes PIN de la sauvegarde."),
      );
      onRestored?.();
      // Tout l'écran repart de la base restaurée (connexion, paramètres, licence).
      setTimeout(() => {
        window.location.hash = "#/";
        window.location.reload();
      }, 1500);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  const ready = info && !info.needs_password && !info.newer;
  return (
    <Modal title={<><ArchiveRestore size={18} />  {tl("Restaurer une sauvegarde")}</>} onClose={onClose} width={620}>
      <div className="stack">
        <p className="muted">
          {fresh
            ? tl("Retrouvez votre boutique (téléphone changé, cassé ou réinitialisé, nouveau PC) : choisissez le fichier de sauvegarde. Les codes PIN, produits, clients, dettes et ventes reviennent tels qu'ils étaient au moment de la copie.")
            : tl("Remplace toutes les données de cet appareil par celles d'une sauvegarde. Une copie de sécurité des données actuelles est faite avant : rien n'est perdu.")}
        </p>
        <div className="row-start">
          <button type="button" className="btn btn-primary" onClick={choose} disabled={busy}><FileUp size={16} />  {tl("Choisir un fichier de sauvegarde…")}</button>
        </div>
        {files.length > 0 && !info && (
          <>
            <span className="muted small">{tl("Ou une copie gardée sur cet appareil :")}</span>
            <div className="restore-files">
              {files.slice(0, 20).map((f) => (
                <button key={f.path} type="button" className="restore-file" disabled={busy} onClick={() => inspect({ path: f.path, temp: false })}>
                  <span>
                    <strong>{f.safety ? tl("Avant restauration — {0}", [f.modified ? dateTime(f.modified) : f.name]) : f.modified ? dateTime(f.modified) : f.name}</strong>
                    <span className="muted small">{f.name} · {mb(f.size)} {tl("Mo")}</span>
                  </span>
                  {f.protected && <Lock size={15} aria-label={tl("Protégée par un mot de passe")} />}
                </button>
              ))}
            </div>
          </>
        )}
        {busy && <div className="muted">{tl("Lecture de la sauvegarde…")}</div>}
        {info?.needs_password && chosen && (
          <form className="stack" onSubmit={(e) => { e.preventDefault(); void inspect(chosen, password); }}>
            <div className="alert alert-info"><Lock size={16} />  {tl("« {0} » est protégée par un mot de passe.", [info.file])}</div>
            <Field label={tl("Mot de passe de la sauvegarde")}>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
            </Field>
            <button className="btn" disabled={busy || !password}>{tl("Ouvrir la sauvegarde")}</button>
          </form>
        )}
        {info && !info.needs_password && (
          <>
            <h4 className="section-title">{info.shop_name || tl("Boutique sans nom")}</h4>
            <div className="restore-info">
              <div><span className="muted small">{tl("Dernière activité")}</span><strong>{info.last_activity ? dateTime(info.last_activity) : "—"}</strong></div>
              <div><span className="muted small">{tl("Produits")}</span><strong>{info.products}</strong></div>
              <div><span className="muted small">{tl("Clients")}</span><strong>{info.customers}</strong></div>
              <div><span className="muted small">{tl("Ventes")}</span><strong>{info.sales}</strong></div>
              <div><span className="muted small">{tl("Personnel")}</span><strong>{info.users}</strong></div>
              <div><span className="muted small">{tl("Fichier")}</span><strong>{mb(info.size)} {tl("Mo")}</strong>{info.protected && <span className="small"><Lock size={12} />  {tl("protégée")}</span>}</div>
            </div>
            {info.newer && <div className="alert alert-danger">{tl("Cette sauvegarde a été faite avec une version plus récente de GestiMarket : mettez d'abord GestiMarket à jour sur cet appareil.")}</div>}
            {ready && !fresh && (
              <div className="alert alert-warning"><ShieldAlert size={16} />  {tl("Toutes les données actuelles de cet appareil seront remplacées. Chacun devra se reconnecter avec les codes PIN de la sauvegarde.")}</div>
            )}
          </>
        )}
        {error && <div className="alert alert-danger">{error}</div>}
        <div className="row-end">
          {info && <button type="button" className="btn" disabled={busy} onClick={() => { setInfo(null); setPassword(""); }}>{tl("Autre sauvegarde")}</button>}
          <button type="button" className="btn btn-primary" disabled={busy || !ready} onClick={restore}>
            <ArchiveRestore size={16} />  {busy && ready ? tl("Restauration…") : tl("Restaurer cette sauvegarde")}
          </button>
        </div>
      </div>
    </Modal>
  );
}
