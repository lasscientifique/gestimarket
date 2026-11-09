import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Banknote, CreditCard, HandCoins, Receipt, RefreshCw, ShoppingBag, ShoppingCart, Smartphone, Trophy, Wallet, XCircle } from "lucide-react";
import { api } from "../api";
import { useApp } from "../context/AppContext";
import { Badge, Empty, Loading, PageHeader, StatCard } from "../components/ui";
import { dateTime, fromMinor, money, qty } from "../lib/format";
import type { CashierStats } from "../types";
import { locale, tl } from "../lib/i18n";
import { every } from "../lib/visibility";

/** Tableau de bord du caissier : statistiques de sa session de caisse. */
export default function CashierDashboardPage() {
  const { toast, user, settings } = useApp();
  const [data, setData] = useState<CashierStats | null>(null);

  const load = useCallback(() => api.cashierStats().then(setData).catch(toast.error), [toast]);
  useEffect(() => {
    load();
    return every(30_000, load);
  }, [load]);

  if (!data) return <Loading />;
  const s = data.session;
  const open = s?.status === "open";
  const electronic = s ? s.orange_money_sales + s.mobile_money_sales : 0;
  const hours = data.hourly.map((h) => ({ label: `${h.hour}h`, total: fromMinor(h.total), count: h.count }));

  return (
    <div className="page">
      <PageHeader
        help="my_dashboard"
        title={tl("Bonjour {0}", [user?.full_name.split(" ")[0] ?? ""])}
        subtitle={
          s ? (
            <>
              {open ? <Badge tone="success">{tl("Caisse ouverte")}</Badge> : <Badge>{tl("Dernière session (clôturée)")}</Badge>}  {tl("depuis le")} {dateTime(s.opened_at)}
              {!open && s.closed_at && <>  {tl("— clôturée le")} {dateTime(s.closed_at)}</>}
            </>
          ) : (
            tl("Aucune session de caisse pour l'instant.")
          )
        }
        actions={
          <>
            <button className="btn" onClick={load}><RefreshCw size={16} />  {tl("Actualiser")}</button>
            <Link className="btn btn-primary" to="/pos"><ShoppingCart size={16} /> {open ? tl("Retour à la caisse") : tl("Ouvrir la caisse")}</Link>
          </>
        }
      />

      {!s ? (
        <div className="card">
          <Empty title={tl("Pas encore de vente")}>{tl("Ouvrez votre caisse pour commencer : vos statistiques s'afficheront ici en direct.")}</Empty>
        </div>
      ) : (
        <>
          <div className="stats">
            <StatCard label={tl("Ventes de la session")} value={money(s.sales_total)} hint={tl("{0} ticket(s)", [s.sales_count])} icon={<ShoppingBag size={20} />} tone="accent" />
            <StatCard label={tl("Panier moyen")} value={money(data.average_basket)} hint={tl("Plus gros ticket : {0}", [money(data.biggest_sale)])} icon={<Receipt size={20} />} />
            <StatCard label={tl("Articles vendus")} value={qty(data.items_sold)} hint={tl("{0} client(s) identifié(s)", [data.customers_count])} icon={<Trophy size={20} />} />
            <StatCard
              label={tl("Espèces attendues dans le tiroir")}
              value={money(s.expected_now)}
              hint={tl("Fond {0} + espèces {1}{2}", [money(s.opening_amount), money(s.cash_sales + s.customer_payments_cash), s.cash_out ? ` − sorties ${money(s.cash_out)}` : ""])}
              icon={<Wallet size={20} />}
              tone="success"
            />
          </div>

          <div className="grid-2">
            <div className="card">
              <h3 className="card-title">{tl("Encaissements par moyen de paiement")}</h3>
              <div className="pay-split">
                <PayRow icon={<Banknote size={18} />} label={tl("Espèces")} value={s.cash_sales} total={s.sales_total} />
                <PayRow icon={<Smartphone size={18} />} label={settings.om_label || tl("Orange Money")} value={electronic} total={s.sales_total} tone="om" />
                <PayRow icon={<CreditCard size={18} />} label={tl("Carte")} value={s.card_sales} total={s.sales_total} />
                <PayRow icon={<HandCoins size={18} />} label={tl("À crédit")} value={s.credit_sales} total={s.sales_total} />
              </div>
              {(s.customer_payments_cash > 0 || s.customer_payments_electronic > 0) && (
                <div className="kv muted" style={{ marginTop: 10 }}>
                  <span>{tl("Règlements de dettes clients")}</span>
                  <span>{money(s.customer_payments_cash + s.customer_payments_electronic)}</span>
                </div>
              )}
              <div className="kv" style={{ marginTop: 6 }}>
                <span><XCircle size={14} />  {tl("Annulations")}</span>
                <span>{data.cancelled_count ? <Badge tone="danger">{data.cancelled_count} · {money(data.cancelled_total)}</Badge> : tl("aucune")}</span>
              </div>
              <div className="kv">
                <span>{tl("Remises accordées")}</span>
                <span>{data.discounts_total ? money(data.discounts_total) : tl("aucune")}</span>
              </div>
              <div className="kv">
                <span>{tl("Aujourd'hui (toutes mes sessions)")}</span>
                <strong>{money(data.today_total)} · {data.today_count}  {tl("ticket(s)")}</strong>
              </div>
            </div>

            <div className="card">
              <h3 className="card-title">{tl("Ventes par heure")}</h3>
              {hours.length === 0 ? (
                <Empty title={tl("Aucune vente pour l'instant")} />
              ) : (
                <div style={{ height: 240 }}>
                  <ResponsiveContainer>
                    <BarChart data={hours}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                      <XAxis dataKey="label" tick={{ fontSize: 12, fill: "var(--muted)" }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fontSize: 12, fill: "var(--muted)" }} axisLine={false} tickLine={false} width={60} />
                      <Tooltip
                        formatter={(v) => [`${Number(v).toLocaleString(locale())} ${settings.currency_symbol ?? ""}`, tl("Ventes")]}
                        contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10 }}
                      />
                      <Bar dataKey="total" fill="var(--accent)" radius={[6, 6, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          </div>

          <div className="grid-2">
            <div className="card">
              <h3 className="card-title">{tl("Mes meilleurs articles")}</h3>
              {data.top_products.length === 0 ? (
                <Empty title={tl("Aucun article vendu")} />
              ) : (
                <table className="table compact">
                  <tbody>
                    {data.top_products.map((p, i) => (
                      <tr key={p.name + p.unit}>
                        <td style={{ width: 28 }}><span className="rank-n">{i + 1}</span></td>
                        <td>{p.name}</td>
                        <td className="num muted">{qty(p.quantity)} {p.unit}</td>
                        <td className="num"><strong>{money(p.total)}</strong></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <div className="card">
              <h3 className="card-title">{tl("Derniers tickets")}</h3>
              {data.recent.length === 0 ? (
                <Empty title={tl("Aucun ticket")} />
              ) : (
                <table className="table compact">
                  <tbody>
                    {data.recent.map((r) => (
                      <tr key={r.id} className={r.status === "cancelled" ? "row-cancelled" : ""}>
                        <td className="mono small">{r.number}</td>
                        <td className="muted small nowrap">{dateTime(r.created_at).slice(-5)}</td>
                        <td className="small">{r.customer_name ?? tl("{0} article(s)", [r.items])}</td>
                        <td className="num">
                          {r.status === "cancelled" ? <Badge tone="danger">{tl("Annulée")}</Badge> : <strong>{money(r.total)}</strong>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function PayRow({ icon, label, value, total, tone }: { icon: React.ReactNode; label: string; value: number; total: number; tone?: "om" }) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div className={`pay-row ${tone ?? ""}`}>
      <span className="pay-row-icon">{icon}</span>
      <div className="pay-row-main">
        <div className="kv"><span>{label}</span><strong>{money(value)}</strong></div>
        <div className="bar"><span style={{ width: `${pct}%` }} /></div>
      </div>
      <span className="muted small pay-row-pct">{pct} %</span>
    </div>
  );
}
