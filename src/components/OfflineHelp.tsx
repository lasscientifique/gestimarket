import { useCallback, useEffect, useState } from "react";
import { BookOpen, Download, PlayCircle } from "lucide-react";
import { useApp } from "../context/AppContext";
import { local } from "../lib/transport";
import { allHelpFiles, setOfflineHelp } from "../lib/videos";
import { openManual } from "./Help";
import { tl } from "../lib/i18n";

interface Status {
  files: string[];
  size: number;
  running: boolean;
  done: number;
  total: number;
  bytes: number;
  error: string | null;
}

const mb = (n: number) => (n / 1_048_576).toFixed(0);

/**
 * Aide hors ligne : vidéos d'aide et manuel téléchargés une fois sur ce poste. Ils se lisent ensuite sans
 * Internet, et le poste serveur les sert aux téléphones et tablettes de la boutique.
 */
export function OfflineHelpCard() {
  const { toast } = useApp();
  const [st, setSt] = useState<Status | null>(null);
  const wanted = allHelpFiles();

  const load = useCallback(() => {
    local<Status>("help_offline_status")
      .then((s) => {
        setSt(s);
        setOfflineHelp(s.files, "local");
      })
      .catch(() => undefined);
  }, []);
  useEffect(load, [load]);
  // Pendant le téléchargement : état toutes les 2 secondes.
  useEffect(() => {
    if (!st?.running) return;
    const t = setInterval(load, 2000);
    return () => clearInterval(t);
  }, [st?.running, load]);

  const present = wanted.filter((f) => st?.files.includes(f)).length;
  const start = async () => {
    try {
      await local("help_offline_download", { names: wanted });
      load();
    } catch (e) {
      toast.error(e);
    }
  };

  return (
    <div className="card">
      <h3 className="card-title"><PlayCircle size={18} />  {tl("Aide hors ligne : vidéos et manuel")}</h3>
      <p className="muted">
        {tl("Les vidéos d'aide et le manuel se lisent en ligne. Téléchargez-les une fois sur ce poste (environ 100 Mo) : ils marchent ensuite sans Internet, ici et sur les téléphones et tablettes reliés à ce poste serveur.")}
      </p>
      {st && (
        <p>
          {st.running
            ? tl("Téléchargement : {0} sur {1} ({2} Mo)…", [st.done, st.total, mb(st.bytes)])
            : tl("{0} fichier(s) sur {1} sur ce poste ({2} Mo).", [present, wanted.length, mb(st.size)])}
        </p>
      )}
      {st?.error && !st.running && <div className="alert alert-warning">{st.error}</div>}
      <div className="row-start">
        <button className="btn" onClick={start} disabled={!st || st.running || present === wanted.length}>
          <Download size={16} />  {present === wanted.length ? tl("Aide téléchargée") : tl("Télécharger l'aide")}
        </button>
        <button className="btn" onClick={() => void openManual()}><BookOpen size={16} />  {tl("Manuel d'utilisation (PDF)")}</button>
      </div>
    </div>
  );
}
