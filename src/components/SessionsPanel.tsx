import { useCallback, useEffect, useState } from "react";
import { LogOut, RefreshCw, Users } from "lucide-react";
import { api } from "../api";
import { useApp } from "../context/AppContext";
import { Badge } from "./ui";
import { ROLE_LABELS } from "../lib/format";
import type { SessionInfo } from "../types";
import { tl } from "../lib/i18n";

function idle(secs: number): string {
  if (secs < 60) return tl("à l'instant");
  if (secs < 3600) return `il y a ${Math.floor(secs / 60)} min`;
  return `il y a ${Math.floor(secs / 3600)} h`;
}

/**
 * Postes connectés (administrateur) : chaque session ouverte compte dans le nombre de postes de la
 * formule. Une session sans signal depuis 3 minutes ne compte plus ; on peut aussi la fermer ici.
 */
export function SessionsPanel() {
  const { toast, confirm, user } = useApp();
  const [data, setData] = useState<{ sessions: SessionInfo[]; max: number; used: number } | null>(null);

  const load = useCallback(() => api.listSessions().then(setData).catch(() => undefined), []);
  useEffect(() => {
    if (user?.role !== "admin") return;
    load();
    const t = setInterval(load, 10_000);
    return () => clearInterval(t);
  }, [load, user?.role]);
  if (user?.role !== "admin" || !data) return null;

  const kick = async (s: SessionInfo) => {
    if (!(await confirm({ title: tl("Déconnecter ce poste"), message: tl("Fermer la session de {0} ({1}) ? L'appareil reviendra à l'écran de connexion.", [s.user, s.ip]), confirmLabel: tl("Déconnecter"), danger: true }))) return;
    try {
      await api.kickSession(s.id);
      toast.success(tl("Session de {0} fermée.", [s.user]));
      load();
    } catch (e) {
      toast.error(e);
    }
  };

  return (
    <div className="card">
      <h3 className="card-title">
        <Users size={18} />  {tl("Postes connectés")} <Badge tone={data.used >= data.max ? "warning" : "success"}>{data.used} / {data.max}</Badge>
        <button className="icon-btn" onClick={load} title={tl("Actualiser")} style={{ marginLeft: "auto" }}><RefreshCw size={14} /></button>
      </h3>
      <p className="muted small">
        {tl("Chaque appareil connecté (ce PC compris) occupe une place de la formule. Un appareil éteint libère sa place au bout de 3 minutes.")}</p>
      <div className="table-scroll">
        <table className="table">
          <thead>
            <tr>
              <th>{tl("Utilisateur")}</th>
              <th>{tl("Appareil")}</th>
              <th>{tl("Depuis")}</th>
              <th>{tl("Dernier signal")}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data.sessions.map((s) => (
              <tr key={s.id} className={s.active ? "" : "muted"}>
                <td>
                  <strong>{s.user}</strong> <span className="small muted">{ROLE_LABELS[s.role] ?? s.role}</span>
                </td>
                <td>
                  {s.local ? tl("Ce PC") : s.ip} <Badge tone={s.route === "internet" ? "info" : "default"}>{s.route === "internet" ? tl("Internet") : tl("Réseau local")}</Badge>
                </td>
                <td>{s.since}</td>
                <td>{s.local ? "—" : s.active ? idle(s.idle_secs) : tl("inactif ({0})", [idle(s.idle_secs)])}</td>
                <td className="row-end">
                  {!s.local && (
                    <button className="btn btn-sm" onClick={() => kick(s)}><LogOut size={14} />  {tl("Déconnecter")}</button>
                  )}
                </td>
              </tr>
            ))}
            {data.sessions.length === 0 && (
              <tr>
                <td colSpan={5} className="muted">{tl("Aucune session ouverte.")}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
