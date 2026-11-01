import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { TrendingUp, TrendingDown, ShoppingBag, Wallet, Boxes, AlertTriangle, HandCoins, RefreshCw } from "lucide-react";
import { api } from "../api";
import { useApp } from "../context/AppContext";
import { Badge, Empty, Loading, PageHeader, StatCard } from "../components/ui";
import { dateTime, fromMinor, money, paymentLabel, percent, qty, shortDay } from "../lib/format";
import type { Dashboard } from "../types";

export default function DashboardPage() {
  const { toast, user } = useApp();
  const [data, setData] = useState<Dashboard | null>(null);
  const [noCashier, setNoCashier] = useState(false);
  useEffect(() => {
    api.listUsers().then((u) => setNoCashier(!u.some((x) => x.role === "cashier" && x.active))).catch(() => undefined);
  }, []);

  const load = () => api.dashboard().then(setData).catch(toast.error);
  useEffect(() => {
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!data) return <Loading />;

  const evolution = data.yesterday_revenue > 0 ? ((data.today_revenue - data.yesterday_revenue) / data.yesterday_revenue) * 100 : null;
  const basket = data.today_count > 0 ? Math.round(data.today_revenue / data.today_count) : 0;
  const marginRate = data.month_revenue > 0 ? (data.month_margin / data.month_revenue) * 100 : 0;
  const chart = data.daily.map((d) => ({ ...d, label: shortDay(d.date), ca: fromMinor(d.revenue), marge: fromMinor(d.margin) }));

  return (
    <div className="page">
      <PageHeader
        help="dashboard"
        title={`Bonjour ${user?.full_name.split(" ")[0] ?? ""}`}
        subtitle={new Date().toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
        actions={
          <button className="btn" onClick={load}>
            <RefreshCw size={16} /> Actualiser
          </button>
        }
      />

      {noCashier && (
        <div className="alert alert-warning">
          <strong>Aucun compte caissier.</strong> Par sécurité, l'administrateur et les gestionnaires ne vendent pas : créez au moins un compte
          caissier pour encaisser. <Link to="/users">Créer un caissier →</Link>
        </div>
      )}

      <div className="stats">
        <StatCard
          label="Chiffre d'affaires du jour"
          value={money(data.today_revenue)}
          icon={evolution !== null && evolution < 0 ? <TrendingDown size={18} /> : <TrendingUp size={18} />}
          tone="accent"
          hint={
            evolution === null ? (
              "Pas de ventes hier"
            ) : (
              <span className={evolution >= 0 ? "text-success" : "text-danger"}>
                {evolution >= 0 ? "+" : ""}
                {percent(evolution)} vs hier
              </span>
            )
          }
        />
        <StatCard label="Ventes du jour" value={data.today_count} icon={<ShoppingBag size={18} />} hint={`Panier moyen : ${money(basket)}`} />
        <StatCard label="Marge brute du jour" value={money(data.today_margin)} icon={<Wallet size={18} />} tone="success" hint={`Mois : ${money(data.month_margin)} (${percent(marginRate)})`} />
        <StatCard label="CA du mois" value={money(data.month_revenue)} icon={<TrendingUp size={18} />} hint={`${data.month_count} ventes`} />
        <StatCard
          label="Valeur du stock (achat)"
          value={money(data.stock.value_cost)}
          icon={<Boxes size={18} />}
          hint={`${data.stock.product_count} produits actifs`}
        />
        <StatCard
          label="Alertes stock"
          value={data.stock.low_stock_count + data.stock.out_of_stock_count}
          icon={<AlertTriangle size={18} />}
          tone={data.stock.out_of_stock_count > 0 ? "danger" : data.stock.low_stock_count > 0 ? "warning" : "default"}
          hint={`${data.stock.out_of_stock_count} en rupture · ${data.stock.low_stock_count} sous le seuil`}
        />
        <StatCard label="Créances clients" value={money(data.customers_debt)} icon={<HandCoins size={18} />} tone={data.customers_debt > 0 ? "warning" : "default"} hint={<Link to="/customers">Voir les clients</Link>} />
      </div>

      <div className="grid-2-1">
        <div className="card">
          <div className="card-header">
            <h3>Ventes des 14 derniers jours</h3>
          </div>
          <div style={{ height: 280 }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chart} margin={{ top: 10, right: 16, left: 8, bottom: 0 }}>
                <defs>
                  <linearGradient id="ca" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 12, fill: "var(--muted)" }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 12, fill: "var(--muted)" }} tickLine={false} axisLine={false} width={70} tickFormatter={(v) => Number(v).toLocaleString("fr-FR")} />
                <Tooltip
                  formatter={(v, name) => [Number(v).toLocaleString("fr-FR"), name === "ca" ? "Chiffre d'affaires" : "Marge"]}
                  labelFormatter={(_, p) => (p?.[0]?.payload ? `${p[0].payload.date.split("-").reverse().join("/")} · ${p[0].payload.count} ventes` : "")}
                />
                <Area type="monotone" dataKey="ca" stroke="var(--accent)" strokeWidth={2} fill="url(#ca)" />
                <Area type="monotone" dataKey="marge" stroke="var(--success)" strokeWidth={2} fill="none" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <h3>Meilleures ventes (7 jours)</h3>
          </div>
          {data.top_products.length === 0 ? (
            <Empty title="Aucune vente" />
          ) : (
            <div className="rank-list">
              {data.top_products.map((p, i) => (
                <div key={p.product_id} className="rank">
                  <span className="rank-n">{i + 1}</span>
                  <div className="rank-main">
                    <strong>{p.name}</strong>
                    <span className="muted small">{qty(p.quantity)} {p.unit} vendus</span>
                  </div>
                  <span className="rank-val">{money(p.revenue)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="grid-2">
        <div className="card">
          <div className="card-header">
            <h3>Dernières ventes</h3>
            <Link to="/sales" className="link">Tout voir</Link>
          </div>
          {data.recent_sales.length === 0 ? (
            <Empty title="Aucune vente pour le moment" />
          ) : (
            <table className="table compact">
              <tbody>
                {data.recent_sales.map((s) => (
                  <tr key={s.id} className={s.status === "cancelled" ? "row-cancelled" : ""}>
                    <td><strong>{s.number}</strong><div className="muted small">{dateTime(s.created_at)}</div></td>
                    <td>{s.customer_name ?? <span className="muted">Client de passage</span>}</td>
                    <td><Badge>{paymentLabel(s.payment_method)}</Badge></td>
                    <td className="num"><strong>{money(s.total)}</strong></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="card">
          <div className="card-header">
            <h3>Produits à réapprovisionner</h3>
            <Link to="/stock" className="link">Gérer le stock</Link>
          </div>
          {data.low_stock.length === 0 ? (
            <Empty title="Aucune alerte">Tous les stocks sont au-dessus de leur seuil.</Empty>
          ) : (
            <table className="table compact">
              <tbody>
                {data.low_stock.map((p) => (
                  <tr key={p.id}>
                    <td>{p.name}</td>
                    <td className="num">
                      <Badge tone={p.stock <= 0 ? "danger" : "warning"}>
                        {qty(p.stock)} {p.unit}
                      </Badge>
                    </td>
                    <td className="num muted small">seuil {qty(p.min_stock)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
      <div className="grid-2">
        <div className="card">
          <div className="card-header">
            <h3>Encaissements du jour</h3>
            <Link to="/payments" className="link">Paiements mobiles</Link>
          </div>
          {data.today_payments.length === 0 ? (
            <Empty title="Aucun encaissement aujourd'hui" />
          ) : (
            <div className="bars">
              {data.today_payments.map((b) => {
                const max = Math.max(...data.today_payments.map((x) => x.amount), 1);
                return (
                  <div key={b.label} className="hbar">
                    <div className="hbar-top">
                      <span>{paymentLabel(b.label)}</span>
                      <span><strong>{money(b.amount)}</strong> <span className="muted small">({b.count})</span></span>
                    </div>
                    <div className="hbar-track"><div className={`hbar-fill pm-${b.label}`} style={{ width: `${(b.amount / max) * 100}%` }} /></div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        <div className="card">
          <div className="card-header">
            <h3>Péremption proche</h3>
            <Link to="/stock" className="link">Voir tout</Link>
          </div>
          {data.expiring.length === 0 ? (
            <Empty title="Aucun produit à surveiller" />
          ) : (
            <table className="table compact">
              <tbody>
                {data.expiring.map((p) => (
                  <tr key={p.id}>
                    <td>{p.name}</td>
                    <td className="num muted small">{qty(p.stock)} {p.unit}</td>
                    <td className="num">
                      <Badge tone={p.days_left < 0 ? "danger" : p.days_left <= 7 ? "danger" : "warning"}>
                        {p.days_left < 0 ? `Périmé depuis ${-p.days_left} j` : p.days_left === 0 ? "Aujourd'hui" : `${p.days_left} j`}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
