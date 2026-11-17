import { MessageCircle, RefreshCw, Store } from "lucide-react";
import type { Me, Nav } from "../App";
import { rpc, openUrl, waLink } from "../lib/sb";
import { daysLeft, dateOnly, METHOD, money, SOURCE } from "../lib/fmt";
import { Badge, ErrorBox, Spinner, Stat, useLoad } from "../ui";

type Dash = {
  stores: { total: number; suspended: number; paid: number; trial: number; expired: number; new_month: number };
  payments_to_validate: number;
  cards: { waiting: number; failed: number; sold_month: number; sold_month_amount: number; new_vouchers: number };
  revenue: { method: string; amount: number; count: number }[];
  revenue_by_plan: { plan: string; amount: number; count: number }[];
  revenue_last_month: number;
  expiring: { store_id: string; code: string; name: string; owner_name: string; phone: string; plan: string; source: string; ends_at: string }[];
  servers: { published: number; offline: number };
  errors_7d: number;
  versions: { version: string; count: number }[];
  devices_pending: number;
};

export function Dashboard({ me, nav }: { me: Me; nav: Nav }) {
  const { data: d, error, busy, reload } = useLoad(() => rpc<Dash>("gm_console_dashboard"), []);
  if (error) return <ErrorBox error={error} retry={reload} />;
  if (!d) return <Spinner />;
  const month = d.revenue.reduce((s, r) => s + Number(r.amount), 0);
  const relance = (e: Dash["expiring"][number]) =>
    `Bonjour ${e.owner_name || ""}, votre abonnement GestiMarket ${e.plan} (boutique ${e.code}) se termine le ${dateOnly(e.ends_at)}. ` +
    "Pour continuer sans coupure, renouvelez-le dans GestiMarket : Abonnement & licence → Payer ou renouveler (carte de bon, Orange Money, Wave, Moov). Eden Dev";

  return (
    <div className="stack-lg">
      <div className="page-head">
        <p className="muted">Bonjour {me.name || me.email}. Voici GestiMarket aujourd'hui.</p>
        <button className="btn btn-sm" onClick={reload} disabled={busy}>
          <RefreshCw size={15} /> Actualiser
        </button>
      </div>

      <div className="stats">
        <Stat label="Paiements à valider" value={d.payments_to_validate} tone={d.payments_to_validate ? "danger" : "success"} hint="Orange Money, Wave, Moov" onClick={() => nav("payments")} />
        <Stat label="Cartes WhatsApp en attente" value={d.cards.waiting} tone={d.cards.waiting ? "warning" : "default"} hint={d.cards.failed ? `${d.cards.failed} non envoyée(s)` : "client qui doit écrire"} onClick={() => nav("cards", "sales")} />
        <Stat label="Boutiques payantes" value={d.stores.paid} tone="success" hint={`${d.stores.total} boutique(s) en tout`} onClick={() => nav("stores")} />
        <Stat label="En essai" value={d.stores.trial} tone="info" hint={`${d.stores.new_month} nouvelle(s) ce mois`} />
        <Stat label="Sans abonnement" value={d.stores.expired} tone={d.stores.expired ? "warning" : "default"} hint="lecture seule" />
        <Stat label="Suspendues" value={d.stores.suspended} />
      </div>

      <div className="grid-2">
        <section className="card">
          <h3 className="card-title">Recettes du mois</h3>
          <p className="big-number">{money(month)}</p>
          <p className="muted small">Mois dernier : {money(d.revenue_last_month)} · sans les cartes du lot TEST</p>
          {d.revenue.length ? (
            <table className="table compact">
              <tbody>
                {d.revenue.map((r) => (
                  <tr key={r.method}>
                    <td>{METHOD[r.method] ?? r.method}</td>
                    <td className="num">{r.count}</td>
                    <td className="num">{money(r.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="muted">Aucun paiement validé ce mois-ci.</p>
          )}
          {d.revenue_by_plan.length > 0 && (
            <p className="muted small">
              Par formule : {d.revenue_by_plan.map((r) => `${r.plan} ${money(r.amount)}`).join(" · ")}
            </p>
          )}
          <p className="muted small">
            Cartes vendues par WhatsApp ce mois : {d.cards.sold_month} ({money(d.cards.sold_month_amount)}) · cartes en stock :{" "}
            {d.cards.new_vouchers}
          </p>
        </section>

        <section className="card">
          <h3 className="card-title">Licences qui finissent dans 7 jours</h3>
          {d.expiring.length ? (
            <ul className="list">
              {d.expiring.map((e) => {
                const n = daysLeft(e.ends_at) ?? 0;
                return (
                  <li key={e.store_id}>
                    <div>
                      <strong>{e.name}</strong> <span className="muted">{e.code}</span>
                      <div className="muted small">
                        {e.plan} ({SOURCE[e.source] ?? e.source}) · fin le {dateOnly(e.ends_at)}{" "}
                        <Badge tone={n <= 1 ? "danger" : "warning"}>{n <= 0 ? "aujourd'hui" : `J-${n}`}</Badge>
                      </div>
                    </div>
                    <div className="row">
                      {e.phone && (
                        <button className="btn btn-sm" onClick={() => openUrl(waLink(e.phone, relance(e)))} title="Message prêt dans WhatsApp">
                          <MessageCircle size={15} /> Relancer
                        </button>
                      )}
                      <button className="btn btn-sm" onClick={() => nav("stores", e.store_id)}>
                        <Store size={15} /> Ouvrir
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="muted">Aucune licence ne finit cette semaine.</p>
          )}
        </section>
      </div>

      <div className="grid-3">
        <section className="card">
          <h3 className="card-title">Serveurs des boutiques</h3>
          <p>
            {d.servers.published} publié(s) sur Internet ·{" "}
            {d.servers.offline ? <Badge tone="danger">{d.servers.offline} hors ligne depuis plus d'1 h</Badge> : <Badge tone="success">tous en ligne</Badge>}
          </p>
        </section>
        <section className="card">
          <h3 className="card-title">Erreurs remontées (7 jours)</h3>
          <p className="big-number">{d.errors_7d}</p>
        </section>
        <section className="card">
          <h3 className="card-title">Versions des PC (30 jours)</h3>
          {d.versions.length ? (
            <p>
              {d.versions.map((v) => (
                <span key={v.version} className="chip">
                  {v.version} × {v.count}
                </span>
              ))}
            </p>
          ) : (
            <p className="muted">Aucun PC vu.</p>
          )}
          <p className="muted small">GestiMarket 0.33 et plus envoie sa version à chaque vérification de licence.</p>
        </section>
      </div>

      {me.role === "direction" && d.devices_pending > 0 && (
        <div className="alert alert-warning">
          <span>{d.devices_pending} appareil(s) attendent votre autorisation.</span>
          <button className="btn btn-sm" onClick={() => nav("team")}>
            Voir
          </button>
        </div>
      )}
    </div>
  );
}
