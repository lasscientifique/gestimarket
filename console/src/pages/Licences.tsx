import { useState } from "react";
import { FileDown, RefreshCw, Search, Store } from "lucide-react";
import type { Me, Nav } from "../App";
import { rpc, saveText, SUPABASE_URL } from "../lib/sb";
import { ago, dateOnly, dateTime, daysLeft } from "../lib/fmt";
import { ActionModal, Badge, Empty, ErrorBox, Spinner, useLoad, useToast } from "../ui";

type Lic = {
  pc_id: string; plan: string; plan_label: string; max_postes: number; expires_at: string; issued_at: string; file_path: string;
  store_id: string; store_code: string; store_name: string; hostname: string | null; app_version: string | null; last_seen: string | null; slot: number | null;
};

const fmtPc = (id: string) => id.replace(/(.{4})(?=.)/g, "$1-");

/** Fait signer la licence du PC tout de suite (fonction « gm-license ») puis enregistre le fichier signé. */
async function downloadLicence(pc: string): Promise<string | null> {
  const r = await fetch(`${SUPABASE_URL}/functions/v1/gm-license`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pc_id: pc }),
  });
  const v = await r.json().catch(() => ({}));
  if (v.status !== "ok" || !v.path) throw new Error(v.message ?? `Licence indisponible (${v.status ?? r.status}).`);
  const f = await fetch(`${SUPABASE_URL}/storage/v1/object/public/licences/${v.path}?t=${Date.now()}`);
  if (!f.ok) throw new Error(`Fichier de licence introuvable (${f.status}).`);
  return saveText(`licence-${fmtPc(pc)}.gml`, await f.text(), [{ name: "Licence GestiMarket", extensions: ["gml"] }]);
}

export function Licences({ me, nav }: { me: Me; nav: Nav }) {
  const toast = useToast();
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const [reissue, setReissue] = useState<Lic | null>(null);
  const [busyPc, setBusyPc] = useState("");
  const { data, error, busy, reload } = useLoad(() => rpc<Lic[]>("gm_console_licences", { p_search: search }), [search]);
  const canHelp = me.role !== "paiements";

  const download = async (l: Lic) => {
    setBusyPc(l.pc_id);
    try {
      const path = await downloadLicence(l.pc_id);
      if (path) toast.ok("Fichier de licence enregistré : à copier sur le PC de la boutique (Abonnement & licence → Importer un fichier).");
    } catch (e) {
      toast.fail(e);
    } finally {
      setBusyPc("");
    }
  };

  return (
    <div className="stack-lg">
      <form className="toolbar" onSubmit={(e) => (e.preventDefault(), setSearch(q))}>
        <div className="search">
          <Search size={16} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Boutique, nom du PC, identifiant du PC" />
        </div>
        <button className="btn">Chercher</button>
        <button type="button" className="btn" onClick={reload} disabled={busy} aria-label="Actualiser">
          <RefreshCw size={15} />
        </button>
      </form>
      <p className="muted small">
        Licences en cours, une par PC. « Fichier » sert à une boutique sans Internet : la licence signée est enregistrée ici, puis envoyée par
        WhatsApp ou sur une clé USB.
      </p>
      {error && <ErrorBox error={error} retry={reload} />}
      {!data ? (
        <Spinner />
      ) : !data.length ? (
        <Empty>Aucune licence.</Empty>
      ) : (
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>Boutique</th>
                <th>PC</th>
                <th>Formule</th>
                <th>Fin</th>
                <th>Émise</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.map((l) => {
                const n = daysLeft(l.expires_at) ?? 0;
                return (
                  <tr key={l.pc_id}>
                    <td>
                      <button className="link-btn" onClick={() => nav("stores", l.store_id)}>
                        <Store size={13} /> {l.store_name}
                      </button>
                      <div className="muted small">{l.store_code}</div>
                    </td>
                    <td>
                      {l.hostname || "PC"} {l.slot ? <span className="muted">poste {l.slot}</span> : null}
                      <div className="muted small mono">
                        {fmtPc(l.pc_id)} · {l.app_version || "?"} · vu {ago(l.last_seen)}
                      </div>
                    </td>
                    <td>
                      {l.plan_label} · {l.max_postes} poste(s)
                    </td>
                    <td>
                      {dateOnly(l.expires_at)} {n <= 7 && <Badge tone={n <= 1 ? "danger" : "warning"}>{n <= 0 ? "expirée" : `J-${n}`}</Badge>}
                    </td>
                    <td className="small">{dateTime(l.issued_at)}</td>
                    <td className="row-end">
                      {canHelp && (
                        <button className="btn btn-sm" onClick={() => setReissue(l)}>
                          <RefreshCw size={14} /> Refaire
                        </button>
                      )}
                      <button className="btn btn-sm" disabled={busyPc === l.pc_id} onClick={() => download(l)}>
                        <FileDown size={14} /> Fichier
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {reissue && (
        <ActionModal
          title={`Refaire la licence de ${reissue.hostname || fmtPc(reissue.pc_id)}`}
          intro="La licence est signée de nouveau tout de suite (formule et date de fin de l'abonnement en cours). Le PC la reçoit à sa prochaine vérification."
          confirm="Refaire"
          onClose={() => setReissue(null)}
          onSubmit={async (_v, reason) => {
            await rpc("gm_console_licence_reissue", { p_pc_id: reissue.pc_id, p_reason: reason });
            await fetch(`${SUPABASE_URL}/functions/v1/gm-license`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ pc_id: reissue.pc_id }),
            }).catch(() => undefined);
            toast.ok("Licence refaite.");
            reload();
          }}
        />
      )}
    </div>
  );
}
