import { useEffect, useMemo, useState, type FormEvent } from "react";
import { FileDown, Globe, KeyRound, Laptop, Search, Store, UserRound } from "lucide-react";
import type { Me, Nav } from "../App";
import { rpc, saveText } from "../lib/sb";
import { ago, AUTH_BY, dateOnly, dateTime, JC_CAT, JC_KIND, toCsv } from "../lib/fmt";
import { Badge, Empty, ErrorBox, Field, Spinner, useToast } from "../ui";

type Event = {
  at: string;
  src: "compte" | "licence" | "eden_dev" | "erreur";
  kind: string;
  login: string;
  ip: string;
  device: string;
  via: string;
  detail: Record<string, unknown>;
  store_code: string | null;
  cat: string;
};

type Result = {
  kind: "boutique" | "compte" | "telephone" | "ip" | "noms";
  ip?: string | null;
  matches?: { code: string; name: string; owner_name: string; city: string }[];
  stores: { id: string; code: string; name: string; owner_name: string; phone: string; email: string; city: string; status: string; created_at: string }[];
  accounts: { id: string; email: string | null; phone: string | null; created_at: string; last_sign_in_at: string | null; confirmed: boolean; admin: boolean; factors: number }[];
  ips?: { ip: string; n: number; last: string; devices: string[] }[];
  events: Event[];
};

const CAT_TONE: Record<string, "danger" | "warning" | "info" | "success" | "default"> = {
  echecs: "danger",
  connexions: "info",
  compte: "warning",
  paiements: "success",
  cartes: "success",
  erreurs: "danger",
  eden_dev: "default",
};

const s = (v: unknown) => (v === null || v === undefined ? "" : String(v));

/** Résumé lisible d'un événement (détail technique en dessous, au survol). */
function summary(e: Event): string {
  const d = e.detail ?? {};
  switch (e.kind) {
    case "connexion":
    case "verification_2_etapes":
      return `par ${AUTH_BY[s(d.par)] ?? s(d.par)}`;
    case "email_change":
      return `${s(d.avant) || "—"} → ${s(d.apres)}${d.adresse ? " (adresse de la dernière session)" : ""}`;
    case "numero_change":
      return `${d.avant ? `+${s(d.avant)}` : "—"} → ${d.apres ? `+${s(d.apres)}` : "—"}`;
    case "email_change_demande":
      return `vers ${s(d.nouvelle)}`;
    case "inscription":
      return `avec ${d.avec === "whatsapp" ? "WhatsApp" : "e-mail"}${d.boutique ? ` · « ${s(d.boutique)} »` : ""}`;
    case "mot_de_passe_faux":
    case "code_faux":
    case "code_2_etapes_faux":
      return `signalé par ${e.via === "console" ? "la console" : "GestiMarket"} ${s(d.version)}${d.compte_connu === false ? " · compte inconnu" : ""}`;
    case "action_eden_dev":
      return `${s(d.action)}${d.motif ? ` — ${s(d.motif)}` : ""} (${e.login})`;
    case "erreur":
      return `${s(d.message)} (×${s(d.fois)}, version ${s(d.version)}, écran ${s(d.page) || "?"})`;
    default: {
      const keys = ["serial", "plan", "months", "amount", "method", "reference", "pc_id", "hostname", "slot", "days", "by", "order", "ends_at"];
      return keys
        .filter((k) => d[k] !== undefined && d[k] !== null && d[k] !== "")
        .map((k) => (k === "ends_at" ? `jusqu'au ${dateOnly(s(d[k]))}` : `${k} ${s(d[k])}`))
        .join(" · ");
    }
  }
}

/**
 * Journal des boutiques : on tape le code GM-…, le téléphone, l'e-mail ou une adresse IP, et on voit tout ce qu'on sait
 * (connexions, compte, appareils, cartes, paiements, erreurs, actions d'Eden Dev). Chaque recherche est inscrite au
 * journal de la console.
 */
export function ShopJournal({ nav, query }: { me: Me; nav: Nav; query?: string }) {
  const toast = useToast();
  const [q, setQ] = useState(query ?? "");
  const [cats, setCats] = useState<string[]>([]);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [text, setText] = useState("");
  const [data, setData] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const search = async (value = q) => {
    if (value.trim().length < 3) return;
    setBusy(true);
    setError("");
    try {
      setData(await rpc<Result>("gm_console_store_journal", {
        p_query: value.trim(), p_cats: cats.length ? cats : null, p_from: from || null, p_to: to || null, p_text: text,
      }));
    } catch (e) {
      setError(String((e as Error).message ?? e));
      setData(null);
    } finally {
      setBusy(false);
    }
  };

  // Ouvert depuis une alerte ou une boutique : recherche tout de suite.
  useEffect(() => {
    if (query) {
      setQ(query);
      void search(query);
    }
  }, [query]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void search();
  };
  const goIp = (ip: string) => {
    setQ(ip);
    void search(ip);
  };

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const e of data?.events ?? []) c[e.cat] = (c[e.cat] ?? 0) + 1;
    return c;
  }, [data]);

  const exportCsv = async () => {
    if (!data?.events.length) return;
    const rows = data.events.map((e) => ({
      at: dateTime(e.at), cat: JC_CAT.find(([k]) => k === e.cat)?.[1] ?? e.cat, kind: JC_KIND[e.kind] ?? e.kind, summary: summary(e),
      login: e.login, ip: e.ip, device: e.device, store: e.store_code ?? "", detail: JSON.stringify(e.detail),
    }));
    try {
      const path = await saveText(`journal-${q.trim().replace(/[^0-9A-Za-z@.-]/g, "_")}-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(rows, [
        ["at", "Date"], ["cat", "Famille"], ["kind", "Événement"], ["summary", "Résumé"], ["login", "Compte"], ["ip", "Adresse IP"],
        ["device", "Appareil"], ["store", "Boutique"], ["detail", "Détail"],
      ]), [{ name: "CSV", extensions: ["csv"] }]);
      if (path) toast.ok("Journal enregistré.");
    } catch (e) {
      toast.fail(e);
    }
  };

  return (
    <div className="stack-lg">
      <form className="card stack" onSubmit={submit}>
        <div className="toolbar wrap">
          <div className="search grow">
            <Search size={16} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="GM-000123, +223 70 00 00 00, e-mail ou adresse IP" autoFocus />
          </div>
          <button className="btn btn-primary" disabled={busy || q.trim().length < 3}>
            {busy ? "Recherche…" : "Chercher"}
          </button>
          <button type="button" className="btn" onClick={exportCsv} disabled={!data?.events.length}>
            <FileDown size={15} /> CSV
          </button>
        </div>
        <div className="chips">
          {JC_CAT.map(([k, l]) => (
            <button key={k} type="button" className={`chip-btn${cats.includes(k) ? " active" : ""}`}
              onClick={() => setCats((c) => (c.includes(k) ? c.filter((x) => x !== k) : [...c, k]))}>
              {l}
              {counts[k] ? ` (${counts[k]})` : ""}
            </button>
          ))}
        </div>
        <div className="form-grid">
          <Field label="Du">
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label="Au">
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </Field>
          <Field label="Contient" hint="Appareil, adresse IP, numéro de carte…">
            <input value={text} onChange={(e) => setText(e.target.value)} />
          </Field>
        </div>
        <p className="muted small">
          Données personnelles : consultez-les seulement pour la sécurité ou l'assistance de la boutique. Chaque recherche est inscrite au
          journal. Les connexions sont gardées 6 mois.
        </p>
      </form>

      {error && <ErrorBox error={error} />}
      {busy && <Spinner label="Recherche dans les journaux…" />}

      {data?.kind === "noms" && (
        <section className="card">
          <h3 className="card-title">Boutiques qui ressemblent à « {q} »</h3>
          {!data.matches?.length ? (
            <Empty>Aucune boutique de ce nom.</Empty>
          ) : (
            <div className="chips">
              {data.matches.map((m) => (
                <button key={m.code} className="chip-btn" onClick={() => { setQ(m.code); void search(m.code); }}>
                  {m.code} · {m.name} ({m.owner_name}, {m.city})
                </button>
              ))}
            </div>
          )}
        </section>
      )}

      {data && data.kind !== "noms" && (
        <>
          <div className="grid-2">
            <section className="card stack">
              <h3 className="card-title">
                {data.kind === "ip" ? <Globe size={18} /> : <Store size={18} />} {data.kind === "ip" ? `Adresse IP ${data.ip}` : "Boutiques et comptes"}
              </h3>
              {data.stores.map((st) => (
                <div key={st.id}>
                  <button className="link-btn" onClick={() => nav("stores", st.id)}>
                    <strong>{st.code}</strong> · {st.name}
                  </button>{" "}
                  {st.status !== "active" && <Badge tone="danger">suspendue</Badge>}
                  <div className="muted small">
                    {st.owner_name} · {st.city} · {st.phone || "—"} · créée le {dateOnly(st.created_at)}
                  </div>
                </div>
              ))}
              {data.accounts.map((a) => (
                <div key={a.id} className="small">
                  <UserRound size={14} className="inline" /> {a.email ?? (a.phone ? `+${a.phone}` : "?")}
                  {a.email && a.phone && <span className="muted"> · +{a.phone}</span>}
                  {!a.confirmed && <Badge tone="warning">non confirmé</Badge>} {a.admin && <Badge tone="info">administrateur</Badge>}{" "}
                  {a.factors > 0 && <Badge tone="success">2 étapes</Badge>}
                  <div className="muted">
                    Compte créé le {dateOnly(a.created_at)} · dernière connexion {ago(a.last_sign_in_at)}
                  </div>
                </div>
              ))}
              {!data.stores.length && !data.accounts.length && <Empty>Aucune boutique ni aucun compte trouvés.</Empty>}
            </section>
            <section className="card stack">
              <h3 className="card-title">
                <Laptop size={18} /> Adresses IP et appareils
              </h3>
              {!data.ips?.length ? (
                <p className="muted small">Aucune connexion enregistrée (le journal des connexions commence avec la Console 1.1).</p>
              ) : (
                data.ips.map((x) => (
                  <div key={x.ip} className="small">
                    <button className="link-btn mono" onClick={() => goIp(x.ip)} title="Autres comptes connectés depuis cette adresse">
                      {x.ip}
                    </button>{" "}
                    · {x.n} fois · {ago(x.last)}
                    <div className="muted">{x.devices.filter(Boolean).join(" ; ")}</div>
                  </div>
                ))
              )}
            </section>
          </div>

          {!data.events.length ? (
            <Empty>Rien dans les journaux pour cette recherche.</Empty>
          ) : (
            <div className="table-scroll">
              <table className="table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Événement</th>
                    <th>Détail</th>
                    <th>Appareil · adresse IP</th>
                  </tr>
                </thead>
                <tbody>
                  {data.events.map((e, i) => (
                    <tr key={i} className={e.cat === "echecs" ? "row-danger" : undefined}>
                      <td className="small nowrap">{dateTime(e.at)}</td>
                      <td>
                        <Badge tone={CAT_TONE[e.cat] ?? "default"}>{JC_CAT.find(([k]) => k === e.cat)?.[1] ?? e.cat}</Badge>{" "}
                        {e.kind.startsWith("mot_de_passe") || e.kind.startsWith("code") ? <KeyRound size={13} className="inline" /> : null}
                        {JC_KIND[e.kind] ?? e.kind}
                        {e.store_code && <div className="muted small">{e.store_code}</div>}
                      </td>
                      <td className="small" title={JSON.stringify(e.detail)}>
                        {summary(e)}
                        {e.src === "compte" && e.login && e.kind !== "action_eden_dev" && <div className="muted">{e.login.includes("@") ? e.login : `+${e.login}`}</div>}
                      </td>
                      <td className="small">
                        {e.device}
                        {e.ip && (
                          <div>
                            <button className="link-btn mono small" onClick={() => goIp(e.ip)}>
                              {e.ip}
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
