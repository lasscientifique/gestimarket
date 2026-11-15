import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { CheckCircle2, Download, RefreshCw, Rocket } from "lucide-react";
import { api } from "../api";
import { useApp } from "../context/AppContext";
import { getNetwork, isMobileApp, isRemote, isTauri } from "../lib/transport";
import { tl } from "../lib/i18n";
import { dateTime } from "../lib/format";
import { Badge } from "./ui";
import type { PosteInfo } from "../types";

/** Mise à jour en un clic : seulement dans la fenêtre GestiMarket d'un PC (pas un navigateur, ni un téléphone). */
const desktopApp = isTauri && !isMobileApp;
const androidApp = isMobileApp && typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent);

type Status = { current: string; latest: string | null; newer: boolean; url: string };
/** Mise à jour trouvée par le module de mise à jour (version signée par Eden Dev). */
type Found = {
  version: string;
  date?: string;
  body?: string;
  downloadAndInstall: (cb?: (e: { event: string; data?: { contentLength?: number; chunkLength?: number } }) => void) => Promise<void>;
};

const parse = (v: string) => v.split(".").map((n) => Number(n) || 0);
const older = (a: string, b: string) => {
  const [x, y] = [parse(a), parse(b)];
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) < (y[i] ?? 0);
  return false;
};

/**
 * Paramètres → Mise à jour : version installée, dernière version et ses nouveautés. Sur le PC (fenêtre
 * GestiMarket, administrateur) : « Mettre à jour maintenant » = sauvegarde, téléchargement, vérification de la
 * signature d'Eden Dev, installation sans question, redémarrage. Téléphone Android : téléchargement de l'APK.
 * Poste serveur : les appareils connectés restés sur une version plus ancienne.
 */
export function UpdateTab() {
  const { toast, confirm, user } = useApp();
  const [status, setStatus] = useState<Status | null>(null);
  const [found, setFound] = useState<Found | null>(null);
  const [checking, setChecking] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [postes, setPostes] = useState<PosteInfo[]>([]);
  const admin = user?.role === "admin";
  const local = desktopApp && !isRemote();
  const server = getNetwork()?.config.mode === "server";

  const check = async (force: boolean) => {
    setChecking(true);
    setError(null);
    try {
      setStatus(await api.updateStatus(force));
      if (local) {
        const { check: checkUpdate } = await import("@tauri-apps/plugin-updater");
        setFound((await checkUpdate()) as unknown as Found | null);
      }
    } catch (e) {
      setError(tl("Vérification impossible pour le moment : vérifiez la connexion à Internet."));
      console.warn(e);
    } finally {
      setChecking(false);
    }
  };
  useEffect(() => {
    check(false);
    if (server) api.listPostes().then((r) => setPostes(r.postes)).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const install = async () => {
    if (!found) return;
    const ok = await confirm({
      title: tl("Mettre à jour GestiMarket"),
      message: tl("GestiMarket fait d'abord une sauvegarde, télécharge la version {0}, se ferme pendant l'installation puis redémarre tout seul. Les autres caisses attendent quelques instants.", [found.version]),
      confirmLabel: tl("Mettre à jour maintenant"),
    });
    if (!ok) return;
    // Sauvegarde de la boutique (PC serveur ou poste unique) avant de changer de version.
    if (getNetwork()?.config.mode !== "client") {
      try {
        await api.runAutoBackup();
      } catch (e) {
        const go = await confirm({
          title: tl("Sauvegarde impossible"),
          message: tl("La sauvegarde automatique n'a pas pu se faire ({0}). Mettre à jour quand même ?", [String(e instanceof Error ? e.message : e)]),
          confirmLabel: tl("Mettre à jour quand même"),
          danger: true,
        });
        if (!go) return;
      }
    }
    setProgress(0);
    try {
      let total = 0;
      let done = 0;
      await found.downloadAndInstall((ev) => {
        if (ev.event === "Started") total = ev.data?.contentLength ?? 0;
        else if (ev.event === "Progress") {
          done += ev.data?.chunkLength ?? 0;
          setProgress(total ? Math.min(99, Math.round((done * 100) / total)) : null);
        } else if (ev.event === "Finished") setProgress(100);
      });
      // Windows : l'installateur ferme GestiMarket et le relance. Ailleurs : redémarrage ici.
      const { relaunch } = await import("@tauri-apps/plugin-process");
      await relaunch();
    } catch (e) {
      setProgress(null);
      toast.error(tl("Mise à jour interrompue : {0}", [String(e instanceof Error ? e.message : e)]));
    }
  };

  const openApk = async () => {
    if (!status?.latest) return;
    try {
      await invoke("open_contact", { kind: "apk", number: status.latest });
    } catch (e) {
      toast.error(e);
    }
  };

  const latest = found?.version ?? status?.latest ?? null;
  const newer = found ? true : !!status?.newer;
  const behind = status?.current ? postes.filter((p) => p.online && p.version && p.kind !== "display" && older(p.version, status.current)) : [];

  return (
    <div className="card update-tab">
      <h3 className="card-title"><Rocket size={18} />  {tl("Mise à jour")}</h3>
      <div className="kv"><span>{tl("Version installée")}</span><strong className="mono">{status?.current ?? __APP_VERSION__}</strong></div>
      <div className="kv">
        <span>{tl("Dernière version")}</span>
        <span>
          {latest ? <strong className="mono">{latest}</strong> : <span className="muted">{checking ? tl("vérification…") : "—"}</span>}
          {found?.date ? <span className="muted small">  {dateTime(found.date)}</span> : null}
        </span>
      </div>
      <div className="kv">
        <span>{tl("État")}</span>
        <span>
          {checking ? (
            <Badge>{tl("vérification…")}</Badge>
          ) : newer && latest ? (
            <Badge tone="info">{tl("la version {0} est disponible", [latest])}</Badge>
          ) : status ? (
            <Badge tone="success"><CheckCircle2 size={13} /> {tl("GestiMarket est à jour")}</Badge>
          ) : null}
        </span>
      </div>
      {error && <div className="alert alert-warning small">{error}</div>}

      {newer && found?.body && (
        <>
          <h4 className="section-title">{tl("Nouveautés")}</h4>
          <div className="update-notes">{found.body}</div>
        </>
      )}

      {progress != null && (
        <div className="update-progress">
          <div className="update-progress-bar" style={{ width: `${progress}%` }} />
          <span className="small">{progress >= 100 ? tl("Installation… GestiMarket va redémarrer.") : tl("Téléchargement… {0} %", [String(progress)])}</span>
        </div>
      )}

      <div className="row-end" style={{ marginTop: 12 }}>
        <button className="btn" disabled={checking || progress != null} onClick={() => check(true)}><RefreshCw size={15} />  {tl("Vérifier maintenant")}</button>
        {local && admin && found && (
          <button className="btn btn-primary" disabled={progress != null} onClick={install}><Download size={15} />  {tl("Mettre à jour maintenant")}</button>
        )}
        {androidApp && newer && status?.latest && (
          <button className="btn btn-primary" onClick={openApk}><Download size={15} />  {tl("Télécharger la mise à jour")}</button>
        )}
      </div>
      {local && !admin && found && <p className="muted small">{tl("Seul l'administrateur peut lancer la mise à jour.")}</p>}
      {!local && !androidApp && newer && (
        <p className="muted small">{tl("La mise à jour se lance depuis la fenêtre GestiMarket de chaque PC (Paramètres → Mise à jour).")}</p>
      )}
      {androidApp && newer && (
        <p className="muted small">{tl("Le téléphone télécharge la nouvelle application, puis Android propose de l'installer.")}</p>
      )}

      {behind.length > 0 && (
        <div className="alert alert-info small" style={{ marginTop: 12 }}>
          <strong>{tl("Appareils à mettre à jour :")}</strong>
          <ul>{behind.map((p) => <li key={p.id}>{p.name} — {p.version}</li>)}</ul>
        </div>
      )}
    </div>
  );
}
