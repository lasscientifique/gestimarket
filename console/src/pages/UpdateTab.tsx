import { useEffect, useState } from "react";
import { Download, ExternalLink, RefreshCw, ShieldCheck } from "lucide-react";
import { APP_VERSION, errText, isAndroid, isDesktopApp, openUrl } from "../lib/sb";
import { ago, dateOnly } from "../lib/fmt";
import { autoUpdate, checkUpdate, installUpdate, lastCheck, RELEASES_PAGE, setAutoUpdate, type UpdateInfo } from "../lib/update";
import { Badge, ErrorBox, Spinner } from "../ui";

/** Réglages → Mise à jour : version installée, dernière version, nouveautés, mise à jour automatique. */
export function UpdateTab() {
  const [info, setInfo] = useState<UpdateInfo | null | undefined>(undefined);
  const [checking, setChecking] = useState(false);
  const [progress, setProgress] = useState<number | null | undefined>(undefined);
  const [auto, setAuto] = useState(autoUpdate());
  const [error, setError] = useState("");
  const [last, setLast] = useState(lastCheck());

  const check = async () => {
    setChecking(true);
    setError("");
    try {
      setInfo(await checkUpdate());
    } catch (e) {
      setError(errText(e));
    } finally {
      setChecking(false);
      setLast(lastCheck());
    }
  };

  useEffect(() => {
    void check();
  }, []);

  const install = async () => {
    setError("");
    setProgress(null);
    try {
      await installUpdate(setProgress);
    } catch (e) {
      setError(errText(e));
      setProgress(undefined);
    }
  };

  const toggleAuto = (on: boolean) => {
    setAuto(on);
    setAutoUpdate(on);
  };

  return (
    <div className="stack-lg">
      <div className="grid-2">
        <section className="card stack">
          <h3 className="card-title">Version installée</h3>
          <div className="big-version">{APP_VERSION}</div>
          <p className="muted small">
            Console Eden Dev · {isDesktopApp ? "PC Windows" : isAndroid ? "téléphone Android" : "navigateur"}
            {last && ` · dernière vérification ${ago(last.at)}`}
          </p>
          <div className="row">
            <button className="btn" onClick={check} disabled={checking || progress !== undefined}>
              <RefreshCw size={15} /> {checking ? "Vérification…" : "Vérifier maintenant"}
            </button>
          </div>
        </section>

        <section className="card stack">
          <h3 className="card-title">Dernière version</h3>
          {error && <ErrorBox error={error} retry={check} />}
          {info === undefined ? (
            <Spinner label="Recherche d'une nouvelle version…" />
          ) : info === null ? (
            <p>
              <Badge tone="success">À jour</Badge> La console est à la dernière version.
            </p>
          ) : (
            <>
              <p>
                <Badge tone="warning">Nouvelle version</Badge> <strong>{info.version}</strong>
                {info.date && <span className="muted small"> · publiée le {dateOnly(info.date)}</span>}
              </p>
              {info.notes && <div className="update-notes small">{info.notes}</div>}
              {progress !== undefined ? (
                <div className="stack">
                  <div className="progress" aria-label="Téléchargement">
                    <span style={{ width: `${progress ?? 30}%` }} className={progress === null ? "indeterminate" : undefined} />
                  </div>
                  <p className="muted small">
                    {progress === 100 ? "Installation… la console redémarre toute seule." : `Téléchargement${progress === null ? "…" : ` : ${progress} %`}`}
                  </p>
                </div>
              ) : isDesktopApp ? (
                <div className="row">
                  <button className="btn btn-primary" onClick={install}>
                    <Download size={16} /> Mettre à jour maintenant
                  </button>
                  <span className="muted small">La console redémarre ; reconnectez-vous ensuite.</span>
                </div>
              ) : (
                <div className="row">
                  <button className="btn btn-primary" onClick={() => openUrl(info.apkUrl ?? RELEASES_PAGE)}>
                    <ExternalLink size={16} /> {isAndroid ? "Télécharger l'APK" : "Page des versions"}
                  </button>
                  {isAndroid && <span className="muted small">Ouvrez le fichier téléchargé : Android installe la nouvelle version par-dessus l'ancienne.</span>}
                </div>
              )}
            </>
          )}
        </section>
      </div>

      <section className="card stack">
        <h3 className="card-title">
          <ShieldCheck size={18} /> Mise à jour automatique
        </h3>
        {isDesktopApp ? (
          <>
            <label className="check">
              <input type="checkbox" checked={auto} onChange={(e) => toggleAuto(e.target.checked)} />
              <span>Installer les nouvelles versions toutes seules sur ce PC</span>
            </label>
            <ul className="bullets small muted">
              <li>Vérification au lancement de la console, puis toutes les 6 heures.</li>
              <li>Installation au lancement, ou quand la console n'a pas servi depuis 10 minutes : jamais au milieu d'une action.</li>
              <li>Chaque version est signée par Eden Dev : une version modifiée par quelqu'un d'autre est refusée.</li>
              <li>Désactivée : un bandeau annonce la nouvelle version, et vous choisissez le moment.</li>
            </ul>
          </>
        ) : (
          <p className="muted small">
            {isAndroid
              ? "Sur le téléphone, Android ne laisse pas une application s'installer toute seule : la console vérifie au lancement et annonce la nouvelle version ; touchez « Télécharger l'APK »."
              : "Dans un navigateur, la console se met à jour avec le site."}
          </p>
        )}
      </section>
    </div>
  );
}
