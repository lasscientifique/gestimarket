import { useState } from "react";
import { Bell, BellOff, Check, CheckCheck, RefreshCw, Search, Volume2 } from "lucide-react";
import type { Me, Nav } from "../App";
import { rpc } from "../lib/sb";
import { ago, dateTime } from "../lib/fmt";
import { askNotifications, beep, LEVEL, setSoundMode, soundMode, useAlerts, type Alert, type Level, type SoundMode } from "../lib/alerts";
import { Badge, Empty, ErrorBox, Field, Modal, Spinner, Tabs, useLoad, useToast } from "../ui";

const SOUNDS: [SoundMode, string][] = [
  ["bips", "Bips (critique répété jusqu'à « Vu »)"],
  ["discret", "Un bip discret"],
  ["nuit", "Bips, mais muet de 22 h à 6 h"],
  ["muet", "Muet (bandeau et pastilles seulement)"],
];

/** Ce qu'on peut ouvrir depuis une alerte : boutique, compte ou adresse IP dans le journal des boutiques. */
function Links({ a, nav }: { a: Alert; nav: Nav }) {
  const go = (q: string) => nav("shops", q);
  return (
    <div className="row wrap small">
      {a.store_code && (
        <button className="link-btn" onClick={() => go(a.store_code ?? "")}>
          <Search size={13} /> {a.store_code}
        </button>
      )}
      {a.login && (
        <button className="link-btn" onClick={() => go(a.login.includes("@") ? a.login : `+${a.login}`)}>
          <Search size={13} /> {a.login.includes("@") ? a.login : `+${a.login}`}
        </button>
      )}
      {a.ip && (
        <button className="link-btn mono" onClick={() => go(a.ip ?? "")}>
          <Search size={13} /> {a.ip}
        </button>
      )}
      {a.rule === "paiement_a_valider" && (
        <button className="link-btn" onClick={() => nav("payments")}>
          Paiements à valider
        </button>
      )}
      {(a.rule === "whatsapp_echec" || a.rule === "carte_en_attente" || a.rule === "cinetpay_a_verifier") && (
        <button className="link-btn" onClick={() => nav("cards", "sales")}>
          Ventes WhatsApp
        </button>
      )}
      {a.rule === "appareil_console" && (
        <button className="link-btn" onClick={() => nav("team")}>
          Équipe et appareils
        </button>
      )}
    </div>
  );
}

export function Alerts({ nav }: { me: Me; nav: Nav }) {
  const toast = useToast();
  const { open, error, reload, seen } = useAlerts();
  const [tab, setTab] = useState<"open" | "history">("open");
  const [ask, setAsk] = useState<Alert[] | null>(null);
  const [note, setNote] = useState("");
  const [sound, setSound] = useState<SoundMode>(soundMode());
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const history = useLoad(
    () => (tab === "history" ? rpc<{ history: Alert[] }>("gm_console_alerts", { p_history: true, p_search: search }).then((r) => r.history) : Promise.resolve([] as Alert[])),
    [tab, search],
  );

  const confirmSeen = async () => {
    if (!ask) return;
    try {
      await seen(ask.map((a) => a.id), note.trim());
      toast.ok(ask.length > 1 ? `${ask.length} alertes marquées « Vu ».` : "Alerte marquée « Vu ».");
      setAsk(null);
      setNote("");
    } catch (e) {
      toast.fail(e);
    }
  };

  const byLevel = (l: Level) => open.filter((a) => a.level === l);

  return (
    <div className="stack-lg">
      <Tabs value={tab} onChange={setTab} items={[["open", `À traiter (${open.length})`], ["history", "Historique"]]} />
      {tab === "open" && (
        <>
          <div className="toolbar wrap">
            <button className="btn" onClick={reload} aria-label="Actualiser">
              <RefreshCw size={15} /> Actualiser
            </button>
            <span className="muted small">Lues toutes les 30 secondes ; la base les calcule chaque minute.</span>
          </div>
          {error && <ErrorBox error={error} retry={reload} />}
          {!open.length ? (
            <Empty>Aucune alerte à traiter.</Empty>
          ) : (
            (["critique", "attention", "info"] as Level[]).map((l) =>
              byLevel(l).length ? (
                <section key={l} className={`card stack alert-level-${l}`}>
                  <div className="row-between">
                    <h3 className="card-title">
                      <Badge tone={LEVEL[l][1]}>{LEVEL[l][0]}</Badge> {byLevel(l).length} alerte(s)
                    </h3>
                    <button className="btn btn-sm" onClick={() => setAsk(byLevel(l))}>
                      <CheckCheck size={14} /> Tout marquer « Vu »
                    </button>
                  </div>
                  {byLevel(l).map((a) => (
                    <article key={a.id} className="alert-item">
                      <div className="grow">
                        <strong>{a.title}</strong>
                        <div className="muted small">
                          {dateTime(a.at)} · {ago(a.at)}
                        </div>
                        <Links a={a} nav={nav} />
                      </div>
                      <button className="btn btn-sm" onClick={() => setAsk([a])}>
                        <Check size={14} /> Vu
                      </button>
                    </article>
                  ))}
                </section>
              ) : null,
            )
          )}
          <section className="card stack">
            <h3 className="card-title">
              <Volume2 size={18} /> Son sur cet appareil
            </h3>
            <Field label="Quand une alerte arrive">
              <select value={sound} onChange={(e) => { const m = e.target.value as SoundMode; setSound(m); setSoundMode(m); }}>
                {SOUNDS.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </Field>
            <div className="row wrap">
              <button className="btn btn-sm" onClick={() => beep("critique", true)}>
                <Bell size={14} /> Tester le bip
              </button>
              <button className="btn btn-sm" onClick={async () => toast.info((await askNotifications()) ? "Notifications du système autorisées." : "Notifications refusées par le système : seuls les bips et le bandeau préviennent.")}>
                <BellOff size={14} /> Autoriser les notifications
              </button>
            </div>
            <p className="muted small">
              Sur le téléphone, les bips ne sonnent que si la console est ouverte. Critique : piratage probable (mots de passe faux en série,
              e-mail changé puis nouvel appareil, cartes essayées, référence en double, vérification à 2 étapes retirée). Attention : à
              regarder bientôt. Info : à faire (paiement à valider, carte en attente).
            </p>
          </section>
        </>
      )}
      {tab === "history" && (
        <>
          <form className="toolbar" onSubmit={(e) => (e.preventDefault(), setSearch(q))}>
            <div className="search">
              <Search size={16} />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Boutique, compte, membre" />
            </div>
            <button className="btn">Chercher</button>
          </form>
          {history.error && <ErrorBox error={history.error} retry={history.reload} />}
          {!history.data ? (
            <Spinner />
          ) : !history.data.length ? (
            <Empty>Aucune alerte traitée.</Empty>
          ) : (
            <div className="table-scroll">
              <table className="table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Alerte</th>
                    <th>Traitée</th>
                  </tr>
                </thead>
                <tbody>
                  {history.data.map((a) => (
                    <tr key={a.id}>
                      <td className="small nowrap">{dateTime(a.at)}</td>
                      <td>
                        <Badge tone={LEVEL[a.level][1]}>{LEVEL[a.level][0]}</Badge> {a.title}
                        <Links a={a} nav={nav} />
                      </td>
                      <td className="small">
                        {a.seen_at ? `Vu ${dateTime(a.seen_at)} par ${a.seen_email}` : `Réglée toute seule ${dateTime(a.resolved_at)}`}
                        {a.seen_note && <div className="muted">{a.seen_note}</div>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
      {ask && (
        <Modal title={ask.length > 1 ? `Marquer ${ask.length} alertes « Vu »` : "Marquer « Vu »"} onClose={() => setAsk(null)}>
          <div className="stack">
            <p className="muted small">Inscrit au journal de la console : qui a vu, quand, et la note.</p>
            <Field label="Note (facultative)" hint="Ex. client appelé, mot de passe changé avec lui, fausse alerte…">
              <input value={note} onChange={(e) => setNote(e.target.value)} autoFocus />
            </Field>
            <div className="row-end">
              <button className="btn" onClick={() => setAsk(null)}>
                Annuler
              </button>
              <button className="btn btn-primary" onClick={confirmSeen}>
                <Check size={15} /> Vu
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
