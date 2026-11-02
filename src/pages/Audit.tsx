import { useCallback, useEffect, useState } from "react";
import { Search, Download } from "lucide-react";
import { api } from "../api";
import { useApp } from "../context/AppContext";
import { Empty, PageHeader } from "../components/ui";
import { exportCsv } from "../lib/files";
import { addDays, dateTime, isoDate, toCsv } from "../lib/format";
import type { AuditEntry } from "../types";
import { tl, tm } from "../lib/i18n";

export default function AuditPage() {
  const { toast } = useApp();
  const [list, setList] = useState<AuditEntry[]>([]);
  const [search, setSearch] = useState("");
  const [from, setFrom] = useState(isoDate(addDays(new Date(), -7)));
  const [to, setTo] = useState(isoDate());

  const load = useCallback(() => api.listAuditLog({ search, from, to, limit: 2000 }).then(setList).catch(toast.error), [search, from, to, toast]);
  useEffect(() => {
    const t = setTimeout(load, 200);
    return () => clearTimeout(t);
  }, [load]);

  const doExport = async () => {
    try {
      if (await exportCsv(`journal-${from}-au-${to}.csv`, toCsv(["Date", "Utilisateur", "Action", "Détails"], list.map((a) => [a.created_at, a.username, a.action, a.details]))))
        toast.success(tl("Export terminé."));
    } catch (e) {
      toast.error(e);
    }
  };

  return (
    <div className="page">
      <PageHeader
        help="audit"
        title={tl("Journal d'activité")}
        subtitle={tl("Traçabilité des opérations sensibles : connexions, annulations, ajustements de stock, modifications de prix et de paramètres.")}
        actions={<button className="btn" onClick={doExport}><Download size={16} />  {tl("Exporter")}</button>}
      />
      <div className="toolbar">
        <label className="inline">{tl("Du")} <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="inline">au <input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        <div className="search-box"><Search size={16} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={tl("Action, utilisateur, détail…")} /></div>
      </div>
      <div className="card no-pad">
        {list.length === 0 ? (
          <Empty title={tl("Aucune entrée")} />
        ) : (
          <table className="table compact">
            <thead><tr><th>{tl("Date")}</th><th>{tl("Utilisateur")}</th><th>{tl("Action")}</th><th>{tl("Détails")}</th></tr></thead>
            <tbody>
              {list.map((a) => (
                <tr key={a.id}>
                  <td className="nowrap">{dateTime(a.created_at)}</td>
                  <td>{a.username}</td>
                  <td><strong>{tm(a.action)}</strong></td>
                  <td className="small">{a.details || <span className="muted">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
