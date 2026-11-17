import { useState } from "react";
import { FileDown, RefreshCw, Search } from "lucide-react";
import type { Me } from "../App";
import { rpc, saveText } from "../lib/sb";
import { dateTime, ROLE, toCsv } from "../lib/fmt";
import { Empty, ErrorBox, Spinner, useLoad, useToast } from "../ui";

type Entry = { id: number; at: string; email: string; role: string; action: string; target: string; reason: string; detail: Record<string, unknown> };

export function Journal({ me }: { me: Me }) {
  const toast = useToast();
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const { data, error, busy, reload } = useLoad(() => rpc<Entry[]>("gm_console_journal", { p_search: search, p_limit: 500 }), [search]);

  const exportCsv = async () => {
    if (!data?.length) return;
    const rows = data.map((j) => ({ ...j, at: dateTime(j.at), role: ROLE[j.role] ?? j.role, detail: JSON.stringify(j.detail) }));
    try {
      const path = await saveText(`journal-console-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(rows, [
        ["at", "Date"], ["email", "Membre"], ["role", "Rôle"], ["action", "Action"], ["target", "Sur"], ["reason", "Motif"], ["detail", "Détail"],
      ]), [{ name: "CSV", extensions: ["csv"] }]);
      if (path) toast.ok("Journal enregistré.");
    } catch (e) {
      toast.fail(e);
    }
  };

  return (
    <div className="stack-lg">
      <form className="toolbar" onSubmit={(e) => (e.preventDefault(), setSearch(q))}>
        <div className="search">
          <Search size={16} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Action, boutique, motif, membre" />
        </div>
        <button className="btn">Chercher</button>
        <button type="button" className="btn" onClick={reload} disabled={busy} aria-label="Actualiser">
          <RefreshCw size={15} />
        </button>
        <button type="button" className="btn" onClick={exportCsv} disabled={!data?.length}>
          <FileDown size={15} /> CSV
        </button>
      </form>
      <p className="muted small">
        {me.role === "direction" ? "Toutes les actions de l'équipe" : "Vos actions"} : qui, quoi, quand, pourquoi. Le journal ne se modifie pas et ne s'efface pas.
      </p>
      {error && <ErrorBox error={error} retry={reload} />}
      {!data ? (
        <Spinner />
      ) : !data.length ? (
        <Empty>Aucune action pour l'instant.</Empty>
      ) : (
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Membre</th>
                <th>Action</th>
                <th>Sur</th>
                <th>Motif</th>
              </tr>
            </thead>
            <tbody>
              {data.map((j) => (
                <tr key={j.id}>
                  <td className="small nowrap">{dateTime(j.at)}</td>
                  <td className="small">
                    {j.email}
                    <div className="muted">{ROLE[j.role] ?? j.role}</div>
                  </td>
                  <td>{j.action}</td>
                  <td className="small mono">{j.target}</td>
                  <td className="small">{j.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
