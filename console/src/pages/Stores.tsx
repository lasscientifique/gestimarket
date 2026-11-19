import { useState } from "react";
import { ArrowLeft, Ban, Banknote, CalendarPlus, Gift, MessageCircle, Monitor, Pencil, RefreshCw, RotateCcw, Search, Shuffle, Unplug } from "lucide-react";
import type { Me, Nav } from "../App";
import { openUrl, rpc, waLink } from "../lib/sb";
import { ago, dateOnly, dateTime, daysLeft, EVENT, METHOD, money, PAY_STATUS, SALE_STATUS, SOURCE } from "../lib/fmt";
import { ActionModal, Badge, Empty, ErrorBox, Spinner, Tabs, useLoad, useToast, type AskField } from "../ui";

type StoreRow = {
  id: string; code: string; name: string; owner_name: string; phone: string; email: string; city: string; country: string; status: string;
  created_at: string; plan: string | null; plan_label: string | null; source: string | null; ends_at: string | null; pcs: number; last_seen: string | null; declared: number;
};

const FILTERS: [string, string][] = [
  ["", "Toutes"], ["paid", "Payantes"], ["trial", "En essai"], ["expiring", "Finissent dans 7 j"], ["expired", "Sans abonnement"], ["suspended", "Suspendues"],
];

export function Stores({ me, nav, storeId }: { me: Me; nav: Nav; storeId?: string }) {
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("");
  const { data, error, busy, reload } = useLoad(() => rpc<StoreRow[]>("gm_console_stores", { p_search: search, p_filter: filter }), [search, filter]);
  if (storeId) return <StoreDetail me={me} id={storeId} back={() => nav("stores")} nav={nav} />;

  return (
    <div className="stack-lg">
      <form className="toolbar" onSubmit={(e) => (e.preventDefault(), setSearch(q))}>
        <div className="search">
          <Search size={16} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Code GM-…, nom, téléphone, e-mail" />
        </div>
        <button className="btn">Chercher</button>
        <button type="button" className="btn" onClick={reload} disabled={busy}>
          <RefreshCw size={15} />
        </button>
      </form>
      <div className="chips">
        {FILTERS.map(([k, l]) => (
          <button key={k} className={`chip-btn${filter === k ? " active" : ""}`} onClick={() => setFilter(k)}>
            {l}
          </button>
        ))}
      </div>
      {error && <ErrorBox error={error} retry={reload} />}
      {!data ? (
        <Spinner />
      ) : !data.length ? (
        <Empty>Aucune boutique.</Empty>
      ) : (
        <div className="table-scroll">
          <table className="table hover">
            <thead>
              <tr>
                <th>Boutique</th>
                <th>Propriétaire</th>
                <th>Formule</th>
                <th>Fin</th>
                <th className="num">PC</th>
                <th>Vu</th>
              </tr>
            </thead>
            <tbody>
              {data.map((s) => {
                const n = daysLeft(s.ends_at);
                return (
                  <tr key={s.id} onClick={() => nav("stores", s.id)}>
                    <td>
                      <strong>{s.name}</strong>
                      <div className="muted small">
                        {s.code} · {s.city || s.country}
                        {s.status === "suspended" && <Badge tone="danger">suspendue</Badge>}
                        {s.declared > 0 && <Badge tone="warning">{s.declared} paiement(s) à valider</Badge>}
                      </div>
                    </td>
                    <td>
                      {s.owner_name}
                      <div className="muted small">{s.phone}</div>
                    </td>
                    <td>{s.plan_label ? `${s.plan_label} · ${SOURCE[s.source ?? ""] ?? s.source}` : <Badge tone="warning">aucune</Badge>}</td>
                    <td>
                      {dateOnly(s.ends_at)}
                      {n !== null && n <= 7 && <Badge tone={n <= 1 ? "danger" : "warning"}>J-{Math.max(0, n)}</Badge>}
                    </td>
                    <td className="num">{s.pcs}</td>
                    <td className="muted small">{ago(s.last_seen)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

type Detail = {
  store: { id: string; code: string; name: string; owner_name: string; phone: string; email: string; city: string; country: string; address: string; shop_type: string; status: string; created_at: string };
  account: { email: string; phone: string; created_at: string; last_sign_in_at: string | null; email_confirmed: boolean } | null;
  current: { plan: string; plan_label: string; source: string; max_postes: number; ends_at: string } | null;
  subscriptions: { id: string; plan_label: string; months: number | null; status: string; source: string; starts_at: string | null; ends_at: string | null; created_at: string }[];
  payments: { id: string; created_at: string; method: string; amount: number; currency: string; status: string; reference: string; payer_phone: string; note: string; plan_label: string; months: number; test: boolean }[];
  pcs: { pc_id: string; slot: number; hostname: string; app_version: string; registered_at: string; last_seen: string | null; licence: { plan: string; expires_at: string; issued_at: string } | null }[];
  server: { active: boolean; last_seen: string | null; public_url: string | null } | null;
  tunnel: { hostname: string; port: number; updated_at: string } | null;
  sugu: { slug: string; active: boolean; products: number; visible_until: string | null; updated_at: string } | null;
  card_sales: { id: string; created_at: string; status: string; plan: string; months: number; phone: string }[];
  events: { kind: string; detail: Record<string, unknown>; created_at: string }[];
  errors: { last_at: string; count: number; version: string; kind: string; message: string; page: string }[];
  journal: { at: string; email: string; action: string; reason: string }[];
};

type Action = { title: string; action: string; confirm: string; fields?: AskField[]; danger?: boolean; args?: (v: Record<string, string>) => Record<string, unknown>; intro?: string };

const fmtPc = (id: string) => id.replace(/(.{4})(?=.)/g, "$1-");

function StoreDetail({ me, id, back, nav }: { me: Me; id: string; back: () => void; nav: Nav }) {
  const toast = useToast();
  const { data: d, error, busy, reload } = useLoad(() => rpc<Detail>("gm_console_store", { p_store_id: id }), [id]);
  const [tab, setTab] = useState<"pcs" | "subs" | "payments" | "events" | "journal">("pcs");
  const [act, setAct] = useState<Action | null>(null);
  if (error) return <ErrorBox error={error} retry={reload} />;
  if (!d) return <Spinner />;
  const s = d.store;
  const isDir = me.role === "direction";
  const canHelp = me.role !== "paiements";
  const plans: [string, string][] = [["starter", "STARTER"], ["pro", "PRO"], ["business", "BUSINESS"]];

  const canPay = me.role !== "assistance";

  const run = async (a: Action, values: Record<string, string>, reason: string) => {
    const r = await rpc<{ ok: boolean; amount?: number | null; plan?: string | null; months?: number | null }>("gm_console_store_action", {
      p_store_id: s.id, p_action: a.action, p_args: a.args ? a.args(values) : {}, p_reason: reason,
    });
    toast.ok(a.action === "record_payment" && r.amount != null
      ? `Paiement enregistré : ${money(r.amount)}, ${r.plan} ${r.months} mois. La licence part toute seule.`
      : `${a.title} : fait.`);
    reload();
  };

  return (
    <div className="stack-lg">
      <div className="page-head">
        <button className="link-btn" onClick={back}>
          <ArrowLeft size={16} /> Toutes les boutiques
        </button>
        <button className="btn btn-sm" onClick={reload} disabled={busy}>
          <RefreshCw size={15} /> Actualiser
        </button>
      </div>

      <section className="card store-head">
        <div>
          <h2>
            {s.name} <span className="muted">{s.code}</span> {s.status === "suspended" && <Badge tone="danger">suspendue</Badge>}
          </h2>
          <p className="muted">
            {s.owner_name} · {s.phone || "pas de téléphone"} · {s.email} · {[s.address, s.city, s.country].filter(Boolean).join(", ")}
          </p>
          <p className="muted small">
            Créée le {dateOnly(s.created_at)} · type {s.shop_type || "—"} · compte {d.account?.email_confirmed ? "confirmé" : "non confirmé"}, dernière
            connexion {ago(d.account?.last_sign_in_at)}
          </p>
        </div>
        <div className="store-plan">
          {d.current ? (
            <>
              <strong>{d.current.plan_label}</strong>
              <span>
                {SOURCE[d.current.source] ?? d.current.source} · {d.current.max_postes} poste(s)
              </span>
              <span>jusqu'au {dateOnly(d.current.ends_at)}</span>
            </>
          ) : (
            <Badge tone="warning">Aucun abonnement : lecture seule</Badge>
          )}
        </div>
      </section>

      <div className="actions">
        {s.phone && (
          <button className="btn" onClick={() => openUrl(waLink(s.phone, `Bonjour ${s.owner_name}, c'est Eden Dev (GestiMarket). `))}>
            <MessageCircle size={16} /> WhatsApp
          </button>
        )}
        {canHelp && (
          <button
            className="btn"
            onClick={() =>
              setAct({
                title: "Offrir des jours",
                action: "gift",
                confirm: "Offrir",
                intro: me.role === "assistance" ? "Assistance : 7 jours au plus." : "Même formule : à la suite de l'abonnement en cours ; autre formule : tout de suite.",
                fields: [
                  { key: "days", label: "Nombre de jours *", type: "number", value: "7" },
                  { key: "plan", label: "Formule", type: "select", options: [["", d.current ? `Formule actuelle (${d.current.plan_label})` : "PRO"], ...plans], value: "" },
                ],
                args: (v) => ({ days: Number(v.days), ...(v.plan ? { plan: v.plan } : {}) }),
              })
            }
          >
            <Gift size={16} /> Offrir des jours
          </button>
        )}
        {isDir && d.current && (
          <button
            className="btn"
            onClick={() =>
              setAct({
                title: "Changer de formule",
                action: "change_plan",
                confirm: "Changer",
                intro: `Nouvelle formule tout de suite, jusqu'au ${dateOnly(d.current?.ends_at)}.`,
                fields: [{ key: "plan", label: "Nouvelle formule *", type: "select", options: plans.filter(([c]) => c !== d.current?.plan), value: plans.find(([c]) => c !== d.current?.plan)?.[0] }],
                args: (v) => ({ plan: v.plan }),
              })
            }
          >
            <Shuffle size={16} /> Changer de formule
          </button>
        )}
        {canHelp && (
          <button
            className="btn"
            onClick={() =>
              setAct({
                title: "Corriger les coordonnées",
                action: "edit",
                confirm: "Enregistrer",
                fields: [
                  { key: "name", label: "Nom de la boutique", value: s.name },
                  { key: "owner_name", label: "Propriétaire", value: s.owner_name },
                  { key: "phone", label: "Téléphone", value: s.phone },
                  { key: "city", label: "Ville", value: s.city },
                  { key: "address", label: "Adresse", value: s.address },
                ],
                args: (v) => v,
              })
            }
          >
            <Pencil size={16} /> Coordonnées
          </button>
        )}
        {canPay && (
          <button
            className="btn"
            onClick={() =>
              setAct({
                title: "Enregistrer un paiement reçu",
                action: "record_payment",
                confirm: "Enregistrer",
                intro:
                  "Paiement reçu hors de GestiMarket (« c'est payé » sur WhatsApp, espèces…). Vérifiez d'abord le SMS de l'opérateur. " +
                  "Le montant est le prix de la formule ; l'abonnement s'active tout de suite et compte dans les recettes.",
                fields: [
                  { key: "plan", label: "Formule *", type: "select", options: plans, value: d.current?.plan && d.current.plan !== "free" ? d.current.plan : "pro" },
                  { key: "months", label: "Durée *", type: "select", options: [["1", "1 mois"], ["3", "3 mois"], ["6", "6 mois"], ["12", "12 mois (2 offerts)"]], value: "1" },
                  {
                    key: "method", label: "Payé par *", type: "select", value: "orange_money",
                    options: [["orange_money", "Orange Money"], ["moov_money", "Moov Money"], ["wave", "Wave"], ["especes", "Espèces"], ["virement", "Virement"], ["autre", "Autre"]],
                  },
                  { key: "payer_phone", label: "Numéro qui a payé", value: s.phone ?? "" },
                  { key: "reference", label: "ID de la transaction (facultatif)", hint: "Copié du SMS de l'opérateur : jamais deux fois le même." },
                ],
                args: (v) => ({ plan: v.plan, months: Number(v.months), method: v.method, payer_phone: v.payer_phone, reference: v.reference }),
              })
            }
          >
            <Banknote size={16} /> Paiement reçu
          </button>
        )}
        <button className="btn" onClick={() => nav("cards", `sell:${s.code}`)}>
          <CalendarPlus size={16} /> Vendre une carte
        </button>
        {isDir &&
          (s.status === "active" ? (
            <button className="btn btn-danger-outline" onClick={() => setAct({ title: "Suspendre la boutique", action: "suspend", confirm: "Suspendre", danger: true, intro: "GestiMarket passe en lecture seule sur tous ses PC à leur prochaine vérification." })}>
              <Ban size={16} /> Suspendre
            </button>
          ) : (
            <button className="btn" onClick={() => setAct({ title: "Réactiver la boutique", action: "reactivate", confirm: "Réactiver" })}>
              <RotateCcw size={16} /> Réactiver
            </button>
          ))}
      </div>

      <div className="grid-3">
        <section className="card">
          <h3 className="card-title">Serveur et Internet</h3>
          {d.server ? (
            <p>
              {d.server.active ? <Badge tone="success">publié</Badge> : <Badge>non publié</Badge>} vu {ago(d.server.last_seen)}
            </p>
          ) : (
            <p className="muted">Pas de serveur publié.</p>
          )}
          {d.tunnel && <p className="muted small mono break">{d.tunnel.hostname}</p>}
        </section>
        <section className="card">
          <h3 className="card-title">Sugu Eden</h3>
          {d.sugu ? (
            <p>
              {d.sugu.active ? <Badge tone="success">vitrine en ligne</Badge> : <Badge>vitrine cachée</Badge>} {d.sugu.products} produit(s) · /{d.sugu.slug}
            </p>
          ) : (
            <p className="muted">Pas de vitrine.</p>
          )}
        </section>
        <section className="card">
          <h3 className="card-title">Erreurs récentes</h3>
          {d.errors.length ? (
            <ul className="list small">
              {d.errors.slice(0, 4).map((e, i) => (
                <li key={i}>
                  <span>
                    {e.message} <span className="muted">({e.version}, ×{e.count}, {ago(e.last_at)})</span>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">Aucune.</p>
          )}
        </section>
      </div>

      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          ["pcs", `Appareils (${d.pcs.length})`],
          ["subs", "Abonnements"],
          ["payments", `Paiements (${d.payments.length})`],
          ["events", "Événements"],
          ["journal", "Journal Eden Dev"],
        ]}
      />

      {tab === "pcs" &&
        (d.pcs.length ? (
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>PC</th>
                  <th>Version</th>
                  <th>Vu</th>
                  <th>Licence</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {d.pcs.map((p) => (
                  <tr key={p.pc_id}>
                    <td>
                      <Monitor size={14} className="inline" /> <strong>{p.hostname || "PC"}</strong> <span className="muted">poste {p.slot}</span>
                      <div className="muted small mono">{fmtPc(p.pc_id)}</div>
                    </td>
                    <td>{p.app_version || "?"}</td>
                    <td className="small">{ago(p.last_seen)}</td>
                    <td className="small">{p.licence ? `${p.licence.plan.toUpperCase()} → ${dateOnly(p.licence.expires_at)}` : <Badge tone="warning">aucune</Badge>}</td>
                    <td className="row-end">
                      {canHelp && (
                        <>
                          <button className="btn btn-sm" title="Licence refaite à la prochaine vérification du PC" onClick={() => setAct({ title: `Refaire la licence de ${p.hostname || fmtPc(p.pc_id)}`, action: "resend_licence", confirm: "Refaire", args: () => ({ pc_id: p.pc_id }) })}>
                            <RefreshCw size={14} /> Licence
                          </button>
                          <button className="btn btn-sm btn-danger-outline" title="PC changé ou réinstallé" onClick={() => setAct({ title: `Libérer la place de ${p.hostname || fmtPc(p.pc_id)}`, action: "free_pc", confirm: "Libérer", danger: true, intro: "La licence de ce PC est retirée ; un autre PC pourra prendre sa place.", args: () => ({ pc_id: p.pc_id }) })}>
                            <Unplug size={14} /> Libérer
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty>Aucun PC relié.</Empty>
        ))}

      {tab === "subs" && (
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>Formule</th>
                <th>Origine</th>
                <th>Du</th>
                <th>Au</th>
                <th>État</th>
              </tr>
            </thead>
            <tbody>
              {d.subscriptions.map((x) => (
                <tr key={x.id}>
                  <td>
                    {x.plan_label} {x.months ? `· ${x.months} mois` : ""}
                  </td>
                  <td>{SOURCE[x.source] ?? x.source}</td>
                  <td className="small">{dateTime(x.starts_at)}</td>
                  <td className="small">{dateTime(x.ends_at)}</td>
                  <td>
                    <Badge tone={x.status === "active" ? "success" : x.status === "pending" ? "warning" : "default"}>{x.status === "active" ? "actif" : x.status === "pending" ? "en attente" : "annulé"}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === "payments" &&
        (d.payments.length ? (
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Moyen</th>
                  <th>Formule</th>
                  <th className="num">Montant</th>
                  <th>Référence</th>
                  <th>État</th>
                </tr>
              </thead>
              <tbody>
                {d.payments.map((p) => (
                  <tr key={p.id}>
                    <td className="small">{dateTime(p.created_at)}</td>
                    <td>{METHOD[p.method] ?? p.method}</td>
                    <td>
                      {p.plan_label} · {p.months} mois
                    </td>
                    <td className="num">{money(p.amount, p.currency)}</td>
                    <td className="small mono">
                      {p.reference} {p.payer_phone && <span className="muted">({p.payer_phone})</span>}
                    </td>
                    <td>
                      <Badge tone={PAY_STATUS[p.status]?.[1]}>{PAY_STATUS[p.status]?.[0] ?? p.status}</Badge> {p.test && <Badge>TEST</Badge>}
                      {p.note && <div className="muted small">{p.note}</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty>Aucun paiement.</Empty>
        ))}

      {tab === "events" && (
        <ul className="list small">
          {d.card_sales.map((c) => (
            <li key={c.id}>
              <span>
                Carte {c.plan.toUpperCase()} {c.months} mois par WhatsApp (+{c.phone}) <Badge tone={SALE_STATUS[c.status]?.[1]}>{SALE_STATUS[c.status]?.[0]}</Badge>
              </span>
              <span className="muted">{dateTime(c.created_at)}</span>
            </li>
          ))}
          {d.events.map((e, i) => (
            <li key={i}>
              <span>
                {EVENT[e.kind] ?? e.kind} <span className="muted">{eventDetail(e.detail)}</span>
              </span>
              <span className="muted">{dateTime(e.created_at)}</span>
            </li>
          ))}
        </ul>
      )}

      {tab === "journal" &&
        (d.journal.length ? (
          <ul className="list small">
            {d.journal.map((j, i) => (
              <li key={i}>
                <span>
                  <strong>{j.action}</strong> — {j.reason} <span className="muted">({j.email})</span>
                </span>
                <span className="muted">{dateTime(j.at)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <Empty>Aucune action d'Eden Dev sur cette boutique.</Empty>
        ))}

      {act && (
        <ActionModal
          title={act.title}
          intro={act.intro}
          fields={act.fields}
          confirm={act.confirm}
          danger={act.danger}
          onClose={() => setAct(null)}
          onSubmit={(v, r) => run(act, v, r)}
        />
      )}
    </div>
  );
}

function eventDetail(d: Record<string, unknown>): string {
  const parts: string[] = [];
  if (d.plan) parts.push(String(d.plan).toUpperCase());
  if (d.months) parts.push(`${d.months} mois`);
  if (d.days) parts.push(`${d.days} j`);
  if (d.serial) parts.push(String(d.serial));
  if (d.method) parts.push(METHOD[String(d.method)] ?? String(d.method));
  if (d.amount) parts.push(money(Number(d.amount)));
  if (d.pc_id) parts.push(fmtPc(String(d.pc_id)));
  if (d.expires_at) parts.push(`→ ${dateOnly(String(d.expires_at))}`);
  if (d.ends_at) parts.push(`→ ${dateOnly(String(d.ends_at))}`);
  if (d.by) parts.push(`par ${d.by}`);
  return parts.join(" · ");
}
