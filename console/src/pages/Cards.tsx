import { useEffect, useMemo, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { Ban, Copy, MessageCircle, PackageCheck, Plus, Printer, RefreshCw, RotateCcw, Search, Send, TriangleAlert, Undo2 } from "lucide-react";
import type { Me, Nav } from "../App";
import { EDEN_WHATSAPP, errText, flushCards, isAndroid, openUrl, rpc, waLink } from "../lib/sb";
import { ago, dateOnly, dateTime, METHOD, money, SALE_STATUS, VOUCHER_STATUS } from "../lib/fmt";
import { ActionModal, Badge, Empty, ErrorBox, Field, Modal, Spinner, Tabs, useLoad, useToast } from "../ui";

const PLANS: [string, string][] = [["pro", "PRO"], ["starter", "STARTER"], ["business", "BUSINESS"]];
const MONTHS: [string, string][] = [["1", "1 mois"], ["3", "3 mois"], ["6", "6 mois"], ["12", "12 mois (2 offerts)"]];
const CLIENT_LINK = `https://wa.me/${EDEN_WHATSAPP}?text=${encodeURIComponent("CARTE")}`;

type Tab = "sell" | "sales" | "vouchers";

export function Cards({ me, nav, tab }: { me: Me; nav: Nav; tab?: string }) {
  const initial: Tab = tab?.startsWith("sell") ? "sell" : tab === "sales" ? "sales" : tab === "vouchers" ? "vouchers" : "sell";
  const [t, setT] = useState<Tab>(initial);
  const store = tab?.startsWith("sell:") ? tab.slice(5) : "";
  useEffect(() => setT(initial), [tab]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="stack-lg">
      <Tabs
        value={t}
        onChange={setT}
        items={[
          ["sell", "Vendre par WhatsApp"],
          ["sales", "Ventes WhatsApp"],
          ["vouchers", "Lots et cartes imprimées"],
        ]}
      />
      {t === "sell" && <Sell me={me} store={store} onSold={() => setT("sales")} />}
      {t === "sales" && <Sales me={me} nav={nav} />}
      {t === "vouchers" && <Vouchers me={me} />}
    </div>
  );
}

// ───────────────────────────── Vendre une carte ─────────────────────────────

function Sell({ me, store, onSold }: { me: Me; store: string; onSold: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({ phone: "", name: "", plan: "pro", months: "1", method: "orange_money", reference: "", store });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ phone: string; status: string; error?: string } | null>(null);
  const canSell = me.role !== "assistance";
  const needsRef = ["orange_money", "wave", "moov_money"].includes(f.method);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const sale = await rpc<{ id: string; phone: string; amount: number; window_open: boolean }>("gm_console_card_sell", {
        p_phone: f.phone, p_name: f.name, p_plan: f.plan, p_months: Number(f.months), p_method: f.method, p_reference: f.reference, p_store_code: f.store,
      });
      let status = "waiting";
      let err: string | undefined;
      if (sale.window_open) {
        const r = await flushCards(sale.phone).catch((x) => ({ ok: false, error: errText(x) }) as const);
        const mine = "sent" in r ? r.sent?.find((s) => s.id === sale.id) : undefined;
        status = mine?.status ?? "waiting";
        err = mine?.error ?? (!r.ok ? r.error : undefined);
      }
      setResult({ phone: sale.phone, status, error: err });
      toast.ok(status === "sent" ? "Carte envoyée sur WhatsApp." : "Vente enregistrée : la carte partira dès que le client écrira.");
      setF({ ...f, phone: "", name: "", reference: "" });
    } catch (x) {
      setError(errText(x));
    } finally {
      setBusy(false);
    }
  };

  if (!canSell) return <div className="alert alert-info">La vente de cartes est réservée aux rôles Direction et Paiements.</div>;

  return (
    <div className="grid-2">
      <form className="card stack" onSubmit={submit}>
        <h3 className="card-title">
          <Send size={18} /> Vendre une carte
        </h3>
        <p className="muted small">
          La carte est fabriquée au moment de l'envoi et part sur le WhatsApp du client. Son code n'apparaît nulle part : ni ici, ni dans la base.
        </p>
        <div className="form-grid">
          <Field label="WhatsApp du client *" hint="Avec l'indicatif. 8 chiffres : Mali (+223).">
            <input inputMode="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} placeholder="+223 70 00 00 00" />
          </Field>
          <Field label="Nom du client">
            <input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          </Field>
          <Field label="Formule *">
            <select value={f.plan} onChange={(e) => setF({ ...f, plan: e.target.value })}>
              {PLANS.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Durée *">
            <select value={f.months} onChange={(e) => setF({ ...f, months: e.target.value })}>
              {MONTHS.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Payé par *">
            <select value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}>
              {["orange_money", "wave", "moov_money", "especes", "virement", "autre", ...(me.role === "direction" ? ["offert"] : [])].map((m) => (
                <option key={m} value={m}>
                  {METHOD[m]}
                </option>
              ))}
            </select>
          </Field>
          <Field label={needsRef ? "ID de la transaction *" : "Référence"} hint={needsRef ? "Reçu par SMS sur le téléphone marchand." : undefined}>
            <input value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} autoComplete="off" />
          </Field>
          <Field label="Code de la boutique" hint="Facultatif : seule cette boutique pourra utiliser la carte.">
            <input value={f.store} onChange={(e) => setF({ ...f, store: e.target.value.toUpperCase() })} placeholder="GM-000123" />
          </Field>
        </div>
        {error && <ErrorBox error={error} />}
        <div className="row-end">
          <button className="btn btn-primary" disabled={busy || f.phone.replace(/\D/g, "").length < 8 || (needsRef && f.reference.trim().length < 4)}>
            <Send size={16} /> {busy ? "Envoi…" : "Vendre et envoyer"}
          </button>
        </div>
      </form>

      <div className="stack">
        {result && <SellResult result={result} onSales={onSold} />}
        <section className="card">
          <h3 className="card-title">Bon à savoir</h3>
          <ul className="bullets small">
            <li>WhatsApp ne permet à Eden Dev d'écrire au client que s'il a écrit au numéro d'Eden Dev dans les 24 dernières heures.</li>
            <li>Sinon, la carte reste « en attente » et part toute seule dès qu'il écrit n'importe quoi.</li>
            <li>
              Lien à lui transmettre : <span className="mono break">{CLIENT_LINK}</span>{" "}
              <button type="button" className="icon-btn" aria-label="Copier le lien" onClick={() => navigator.clipboard?.writeText(CLIENT_LINK)}>
                <Copy size={14} />
              </button>
            </li>
            <li>Quand il active la carte, il reçoit « Abonnement … actif jusqu'au … ».</li>
          </ul>
        </section>
      </div>
    </div>
  );
}

function SellResult({ result, onSales }: { result: { phone: string; status: string; error?: string }; onSales: () => void }) {
  const ask = `Bonjour, c'est Eden Dev. Pour recevoir votre carte GestiMarket sur WhatsApp, touchez ce lien et envoyez le message : ${CLIENT_LINK}`;
  return (
    <section className={`card ${result.status === "sent" ? "card-success" : "card-warning"}`}>
      {result.status === "sent" ? (
        <>
          <h3 className="card-title">Carte envoyée à +{result.phone}</h3>
          <p className="muted">Suivez-la dans « Ventes WhatsApp » : remise, lue, puis utilisée.</p>
        </>
      ) : result.status === "failed" ? (
        <>
          <h3 className="card-title">
            <TriangleAlert size={18} /> Carte non envoyée
          </h3>
          <p className="muted">{result.error}</p>
        </>
      ) : (
        <>
          <h3 className="card-title">En attente du client (+{result.phone})</h3>
          <p className="muted">
            Il n'a pas écrit à Eden Dev depuis 24 heures{result.error ? ` (${result.error})` : ""}. La carte partira toute seule dès qu'il écrira.
          </p>
          <button className="btn" onClick={() => openUrl(waLink(result.phone, ask))}>
            <MessageCircle size={16} /> Lui demander d'écrire (WhatsApp)
          </button>
        </>
      )}
      <button className="link-btn" onClick={onSales}>
        Voir les ventes
      </button>
    </section>
  );
}

// ───────────────────────────── Ventes WhatsApp ─────────────────────────────

type Sale = {
  id: string; created_at: string; seller_email: string; phone: string; client_name: string; plan: string; plan_label: string; months: number; amount: number;
  method: string; reference: string; status: string; last_error: string; sent_at: string | null; delivered_at: string | null; read_at: string | null;
  used_at: string | null; confirmed_at: string | null; serial: string | null; store_code: string | null; used_by_code: string | null; window_open: boolean;
  last_inbound_at: string | null;
};

function Sales({ me }: { me: Me; nav: Nav }) {
  const toast = useToast();
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const [act, setAct] = useState<{ sale: Sale; action: "resend" | "cancel" } | null>(null);
  const [flushing, setFlushing] = useState(false);
  const { data, error, busy, reload } = useLoad(() => rpc<Sale[]>("gm_console_card_sales", { p_status: status, p_search: search }), [status, search]);
  const canAct = me.role !== "assistance";

  const flush = async () => {
    setFlushing(true);
    try {
      const r = await flushCards();
      if (!r.ok) throw new Error(r.error);
      const n = r.sent?.filter((s) => s.status === "sent").length ?? 0;
      toast.info(n ? `${n} carte(s) envoyée(s).` : "Rien à envoyer pour l'instant (clients qui n'ont pas écrit).");
      reload();
    } catch (e) {
      toast.fail(e);
    } finally {
      setFlushing(false);
    }
  };

  return (
    <div className="stack">
      <div className="toolbar wrap">
        <div className="chips">
          {[["", "Toutes"], ["open", "À suivre"], ["used", "Utilisées"], ["cancelled", "Annulées"]].map(([k, l]) => (
            <button key={k} className={`chip-btn${status === k ? " active" : ""}`} onClick={() => setStatus(k)}>
              {l}
            </button>
          ))}
        </div>
        <form className="search" onSubmit={(e) => (e.preventDefault(), setSearch(q))}>
          <Search size={16} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Numéro, nom, carte, boutique" />
        </form>
        <button className="btn" onClick={flush} disabled={flushing}>
          <Send size={15} /> {flushing ? "Envoi…" : "Envoyer les cartes en attente"}
        </button>
        <button className="btn" onClick={reload} disabled={busy} aria-label="Actualiser">
          <RefreshCw size={15} />
        </button>
      </div>
      {error && <ErrorBox error={error} retry={reload} />}
      {!data ? (
        <Spinner />
      ) : !data.length ? (
        <Empty>Aucune vente par WhatsApp.</Empty>
      ) : (
        <div className="pay-list">
          {data.map((s) => (
            <article key={s.id} className="pay-card">
              <div className="pay-main">
                <div>
                  <strong>
                    {s.plan_label} {s.months} mois
                  </strong>{" "}
                  · {money(s.amount)} {METHOD[s.method]} <Badge tone={SALE_STATUS[s.status]?.[1]}>{SALE_STATUS[s.status]?.[0] ?? s.status}</Badge>
                </div>
                <div>
                  {s.client_name || "Client"} · <span className="mono">+{s.phone}</span>
                  {s.store_code && <span className="muted"> · réservée à {s.store_code}</span>}
                </div>
                <div className="muted small">
                  Vendue {dateTime(s.created_at)} par {s.seller_email}
                  {s.reference && ` · réf. ${s.reference}`}
                  {s.serial && ` · carte ${s.serial}`}
                </div>
                <div className="muted small">
                  {s.sent_at && `envoyée ${ago(s.sent_at)}`}
                  {s.delivered_at && ` · remise`}
                  {s.read_at && ` · lue ${ago(s.read_at)}`}
                  {s.used_at && ` · utilisée ${dateOnly(s.used_at)} par ${s.used_by_code}`}
                  {s.confirmed_at && ` · confirmation envoyée`}
                </div>
                {s.status === "waiting" && (
                  <div className="muted small">
                    {s.window_open ? "Le client a écrit : envoi au prochain passage." : `Dernier message du client : ${ago(s.last_inbound_at)}. En attente qu'il écrive.`}
                  </div>
                )}
                {s.last_error && <div className="small danger-text">{s.last_error}</div>}
              </div>
              {canAct && !["used", "cancelled"].includes(s.status) && (
                <div className="pay-actions">
                  {s.status === "waiting" && (
                    <button className="btn btn-sm" onClick={() => openUrl(waLink(s.phone, `Bonjour, c'est Eden Dev. Pour recevoir votre carte GestiMarket, touchez ce lien et envoyez le message : ${CLIENT_LINK}`))}>
                      <MessageCircle size={14} /> Demander d'écrire
                    </button>
                  )}
                  {s.status !== "waiting" && (
                    <button className="btn btn-sm" onClick={() => setAct({ sale: s, action: "resend" })}>
                      <RotateCcw size={14} /> Annuler et renvoyer
                    </button>
                  )}
                  <button className="btn btn-sm btn-danger-outline" onClick={() => setAct({ sale: s, action: "cancel" })}>
                    <Ban size={14} /> Annuler la vente
                  </button>
                </div>
              )}
            </article>
          ))}
        </div>
      )}
      {act && (
        <ActionModal
          title={act.action === "resend" ? "Annuler et renvoyer la carte" : "Annuler la vente"}
          intro={
            act.action === "resend"
              ? "L'ancienne carte devient inutilisable ; une nouvelle carte part dès que possible."
              : "La carte devient inutilisable. Pensez à rembourser le client si besoin."
          }
          confirm={act.action === "resend" ? "Renvoyer" : "Annuler la vente"}
          danger={act.action === "cancel"}
          onClose={() => setAct(null)}
          onSubmit={async (_v, reason) => {
            await rpc("gm_console_card_sale_action", { p_sale_id: act.sale.id, p_action: act.action, p_reason: reason });
            if (act.action === "resend") await flushCards(act.sale.phone).catch(() => undefined);
            toast.ok(act.action === "resend" ? "Nouvelle carte en route." : "Vente annulée.");
            reload();
          }}
        />
      )}
    </div>
  );
}

// ───────────────────────────── Lots de cartes imprimées ─────────────────────────────

type Voucher = {
  id: string; serial: string; batch: string; plan: string; plan_label: string; months: number; value: number; status: string; note: string;
  created_at: string; sold_at: string | null; used_at: string | null; store_code: string | null; store_name: string | null; bound_store_code: string | null; sale_id: string | null;
};
type Batch = { batch: string; created_at: string; total: number; new: number; sold: number; used: number; cancelled: number; plans: string; value: number };
type NewCard = { serial: string; code: string; plan_label: string; duration: string; value: string };

function Vouchers({ me }: { me: Me }) {
  const toast = useToast();
  const [batch, setBatch] = useState("");
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [create, setCreate] = useState(false);
  const [printed, setPrinted] = useState<{ batch: string; cards: NewCard[] } | null>(null);
  const [act, setAct] = useState<"sold" | "new" | "cancel" | null>(null);
  const { data, error, busy, reload } = useLoad(
    () => rpc<{ batches: Batch[]; vouchers: Voucher[] }>("gm_console_vouchers", { p_batch: batch, p_status: status, p_search: search }),
    [batch, status, search],
  );
  const canAct = me.role !== "assistance";
  const list = useMemo(() => data?.vouchers ?? [], [data]);
  useEffect(() => setSel(new Set()), [data]);
  const toggle = (id: string) => setSel((s) => (s.has(id) ? new Set([...s].filter((x) => x !== id)) : new Set(s).add(id)));
  const selectable = list.filter((v) => v.status === "new" || v.status === "sold");

  return (
    <div className="stack">
      <div className="toolbar wrap">
        <select value={batch} onChange={(e) => setBatch(e.target.value)} aria-label="Lot">
          <option value="">Tous les lots</option>
          {data?.batches.map((b) => (
            <option key={b.batch} value={b.batch}>
              {b.batch} ({b.total})
            </option>
          ))}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="État">
          <option value="">Tous les états</option>
          {Object.entries(VOUCHER_STATUS).map(([k, [l]]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </select>
        <form className="search" onSubmit={(e) => (e.preventDefault(), setSearch(q))}>
          <Search size={16} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="N° de carte, note, boutique" />
        </form>
        <button className="btn" onClick={reload} disabled={busy} aria-label="Actualiser">
          <RefreshCw size={15} />
        </button>
        {canAct &&
          (isAndroid ? (
            <span className="muted small">Nouveaux lots : depuis la console sur PC (impression).</span>
          ) : (
            <button className="btn btn-primary" onClick={() => setCreate(true)}>
              <Plus size={16} /> Nouveau lot
            </button>
          ))}
      </div>
      {error && <ErrorBox error={error} retry={reload} />}
      {!data ? (
        <Spinner />
      ) : (
        <>
          {data.batches.length > 0 && (
            <div className="table-scroll">
              <table className="table compact">
                <thead>
                  <tr>
                    <th>Lot</th>
                    <th>Cartes</th>
                    <th className="num">En stock</th>
                    <th className="num">Remises</th>
                    <th className="num">Utilisées</th>
                    <th className="num">Annulées</th>
                    <th className="num">Valeur</th>
                  </tr>
                </thead>
                <tbody>
                  {data.batches.map((b) => (
                    <tr key={b.batch} className={batch === b.batch ? "selected" : ""} onClick={() => setBatch(batch === b.batch ? "" : b.batch)}>
                      <td>
                        <strong>{b.batch}</strong> {b.batch === "TEST" && <Badge>hors recettes</Badge>}
                        <div className="muted small">{dateOnly(b.created_at)}</div>
                      </td>
                      <td className="small">{b.plans}</td>
                      <td className="num">{b.new}</td>
                      <td className="num">{b.sold}</td>
                      <td className="num">{b.used}</td>
                      <td className="num">{b.cancelled}</td>
                      <td className="num">{money(b.value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {canAct && sel.size > 0 && (
            <div className="selection-bar">
              <span>{sel.size} carte(s) choisie(s)</span>
              <button className="btn btn-sm" onClick={() => setAct("sold")}>
                <PackageCheck size={14} /> Remises (revendeur, client)
              </button>
              <button className="btn btn-sm" onClick={() => setAct("new")}>
                <Undo2 size={14} /> Remettre en stock
              </button>
              <button className="btn btn-sm btn-danger-outline" onClick={() => setAct("cancel")}>
                <Ban size={14} /> Annuler (perdues, volées)
              </button>
            </div>
          )}
          {!list.length ? (
            <Empty>Aucune carte.</Empty>
          ) : (
            <div className="table-scroll">
              <table className="table">
                <thead>
                  <tr>
                    {canAct && (
                      <th>
                        <input
                          type="checkbox"
                          aria-label="Tout choisir"
                          checked={selectable.length > 0 && selectable.every((v) => sel.has(v.id))}
                          onChange={(e) => setSel(e.target.checked ? new Set(selectable.map((v) => v.id)) : new Set())}
                        />
                      </th>
                    )}
                    <th>N°</th>
                    <th>Formule</th>
                    <th>État</th>
                    <th>Note</th>
                    <th>Utilisée par</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((v) => (
                    <tr key={v.id}>
                      {canAct && (
                        <td>
                          <input type="checkbox" disabled={!(v.status === "new" || v.status === "sold")} checked={sel.has(v.id)} onChange={() => toggle(v.id)} aria-label={`Choisir ${v.serial}`} />
                        </td>
                      )}
                      <td className="mono">{v.serial}</td>
                      <td>
                        {v.plan_label} {v.months} mois <span className="muted small">{money(v.value)}</span>
                      </td>
                      <td>
                        <Badge tone={VOUCHER_STATUS[v.status]?.[1]}>{VOUCHER_STATUS[v.status]?.[0] ?? v.status}</Badge>
                        {v.bound_store_code && <div className="muted small">réservée à {v.bound_store_code}</div>}
                      </td>
                      <td className="small">{v.note}</td>
                      <td className="small">{v.store_code ? `${v.store_name} (${v.store_code}) ${dateOnly(v.used_at)}` : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
      {create && (
        <NewBatch
          onClose={() => setCreate(false)}
          onDone={(r) => {
            setCreate(false);
            setPrinted(r);
            reload();
          }}
        />
      )}
      {printed && <PrintCards batch={printed.batch} cards={printed.cards} onClose={() => setPrinted(null)} />}
      {act && (
        <ActionModal
          title={act === "sold" ? "Cartes remises" : act === "new" ? "Remettre en stock" : "Annuler les cartes"}
          intro={act === "cancel" ? "Les cartes annulées ne pourront plus être utilisées." : undefined}
          fields={act === "sold" ? [{ key: "note", label: "Remises à (revendeur, client) *", value: "" }] : []}
          confirm={act === "sold" ? "Enregistrer" : act === "new" ? "Remettre en stock" : "Annuler les cartes"}
          danger={act === "cancel"}
          onClose={() => setAct(null)}
          onSubmit={async (v, reason) => {
            await rpc("gm_console_voucher_set", { p_ids: [...sel], p_action: act, p_note: v.note ?? "", p_reason: reason });
            toast.ok("Cartes mises à jour.");
            reload();
          }}
        />
      )}
    </div>
  );
}

function NewBatch({ onClose, onDone }: { onClose: () => void; onDone: (r: { batch: string; cards: NewCard[] }) => void }) {
  const [f, setF] = useState({ plan: "pro", months: "1", count: "10", batch: "", note: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const r = await rpc<{ batch: string; cards: NewCard[] }>("gm_console_voucher_batch", {
        p_plan: f.plan, p_months: Number(f.months), p_count: Number(f.count), p_batch: f.batch, p_note: f.note,
      });
      onDone(r);
    } catch (x) {
      setError(errText(x));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="Nouveau lot de cartes à imprimer" onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <div className="form-grid">
          <Field label="Formule *">
            <select value={f.plan} onChange={(e) => setF({ ...f, plan: e.target.value })}>
              {PLANS.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Durée *">
            <select value={f.months} onChange={(e) => setF({ ...f, months: e.target.value })}>
              {MONTHS.filter(([v]) => v !== "12").map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Nombre de cartes *" hint="De 1 à 200 (10 par page A4).">
            <input type="number" min={1} max={200} value={f.count} onChange={(e) => setF({ ...f, count: e.target.value })} />
          </Field>
          <Field label="Nom du lot" hint="Vide : B + date du jour. TEST : exclu des recettes.">
            <input value={f.batch} onChange={(e) => setF({ ...f, batch: e.target.value.toUpperCase() })} />
          </Field>
        </div>
        <Field label="Note (revendeur, destination…)">
          <input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
        </Field>
        <div className="alert alert-warning small">
          <TriangleAlert size={16} /> Les codes ne s'affichent qu'une seule fois, juste après : imprimez-les tout de suite
          {isAndroid ? " (impression depuis le PC de la console)" : ""}.
        </div>
        {error && <ErrorBox error={error} />}
        <div className="row-end">
          <button type="button" className="btn" onClick={onClose}>
            Annuler
          </button>
          <button className="btn btn-primary" disabled={busy || !(Number(f.count) >= 1)}>
            {busy ? "Création…" : "Créer le lot"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** Cartes du lot qui vient d'être créé : impression (10 par page A4, format carte bancaire). Codes affichés une seule fois. */
function PrintCards({ batch, cards, onClose }: { batch: string; cards: NewCard[]; onClose: () => void }) {
  const [printedOnce, setPrintedOnce] = useState(false);
  const close = () => {
    if (!printedOnce && !window.confirm("Les codes ne pourront plus être affichés. Fermer sans imprimer ?")) return;
    onClose();
  };
  const sheet = (
    <div className="print-sheet">
      {cards.map((c) => (
        <div key={c.serial} className="vcard">
          <header>
            <span className="vbrand">GestiMarket · Eden Dev</span>
            <span className="vplan">
              {c.plan_label} · {c.duration}
            </span>
          </header>
          <div className="vcode">{c.code}</div>
          <div className="vhow">Dans GestiMarket : Abonnement & licence → Payer ou renouveler → Carte de bon, puis saisissez le code. Activation immédiate, utilisable une seule fois.</div>
          <div className="vmeta">
            <span>N° {c.serial}</span>
            <span>{c.value}</span>
          </div>
        </div>
      ))}
    </div>
  );
  return (
    <>
      <Modal title={`Lot ${batch} : ${cards.length} carte(s)`} onClose={close} wide>
        <div className="stack">
          <div className="alert alert-warning small">
            <TriangleAlert size={16} /> Imprimez maintenant : ces codes ne seront plus jamais affichés. Gardez les cartes en lieu sûr.
          </div>
          <div className="row">
            <button
              className="btn btn-primary"
              disabled={isAndroid}
              onClick={() => {
                setPrintedOnce(true);
                window.print();
              }}
            >
              <Printer size={16} /> Imprimer (A4, 10 cartes par page)
            </button>
            {isAndroid && <span className="muted small">L'impression se fait depuis la console sur PC.</span>}
          </div>
          <div className="print-preview">{sheet}</div>
        </div>
      </Modal>
      {createPortal(<div className="print-only">{sheet}</div>, document.body)}
    </>
  );
}
