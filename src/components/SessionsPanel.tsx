import { useCallback, useEffect, useState } from "react";
import { LogOut, RefreshCw, Users } from "lucide-react";
import { api } from "../api";
import { useApp } from "../context/AppContext";
import { Badge } from "./ui";
import { ROLE_LABELS } from "../lib/format";
import type { SessionInfo } from "../types";

function idle(secs: number): string {
  if (secs < 60) return "à l'instant";
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
    if (!(await confirm({ title: "Déconnecter ce poste", message: `Fermer la session de ${s.user} (${s.ip}) ? L'appareil reviendra à l'écran de connexion.`, confirmLabel: "Déconnecter", danger: true }))) return;
    try {
      await api.kickSession(s.id);
      toast.success(`Session de ${s.user} fermée.`);
      load();
    } catch (e) {
      toast.error(e);
    }
  };

  return (
    <div className="card">
      <h3 className="card-title">
        <Users size={18} /> Postes connectés <Badge tone={data.used >= data.max ? "warning" : "success"}>{data.used} / {data.max}</Badge>
        <button className="icon-btn" onClick={load} title="Actualiser" style={{ marginLeft: "auto" }}><RefreshCw size={14} /></button>
      </h3>
      <p className="muted small">
        Chaque appareil connecté (ce PC compris) occupe une place de la formule. Un appareil éteint libère sa place au bout de 3 minutes.
      </p>
      <div className="table-scroll">
        <table className="table">
          <thead>
            <tr>
              <th>Utilisateur</th>
              <th>Appareil</th>
              <th>Depuis</th>
              <th>Dernier signal</th>
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
                  {s.local ? "Ce PC" : s.ip} <Badge tone={s.route === "internet" ? "info" : "default"}>{s.route === "internet" ? "Internet" : "Réseau local"}</Badge>
                </td>
                <td>{s.since}</td>
                <td>{s.local ? "—" : s.active ? idle(s.idle_secs) : `inactif (${idle(s.idle_secs)})`}</td>
                <td className="row-end">
                  {!s.local && (
                    <button className="btn btn-sm" onClick={() => kick(s)}><LogOut size={14} /> Déconnecter</button>
                  )}
                </td>
              </tr>
            ))}
            {data.sessions.length === 0 && (
              <tr>
                <td colSpan={5} className="muted">Aucune session ouverte.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
