import { useCallback, useEffect, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Download, Printer } from "lucide-react";
import { api } from "../api";
import { useApp } from "../context/AppContext";
import { Empty, Loading, PageHeader, StatCard } from "../components/ui";
import { exportCsv } from "../lib/files";
import { printHtml } from "../lib/receipt";
import { addDays, csvMoney, dateOnly, fromMinor, isoDate, money, paymentLabel, percent, qty, toCsv } from "../lib/format";
import type { Breakdown, DiscountRow, SalesReport } from "../types";
import { locale, tl } from "../lib/i18n";

const PALETTE = ["#0f766e", "#2563eb", "#d97706", "#7c3aed", "#db2777", "#64748b"];

const PRESETS: { label: string; range: () => [Date, Date] }[] = [
  { label: tl("Aujourd'hui"), range: () => [new Date(), new Date()] },
  { label: tl("7 jours"), range: () => [addDays(new Date(), -6), new Date()] },
  { label: tl("30 jours"), range: () => [addDays(new Date(), -29), new Date()] },
  {
    label: tl("Ce mois"),
    range: () => {
      const d = new Date();
      return [new Date(d.getFullYear(), d.getMonth(), 1), d];
    },
  },
  {
    label: tl("Mois dernier"),
    range: () => {
      const d = new Date();
      return [new Date(d.getFullYear(), d.getMonth() - 1, 1), new Date(d.getFullYear(), d.getMonth(), 0)];
    },
  },
  {
    label: tl("Cette année"),
    range: () => {
      const d = new Date();
      return [new Date(d.getFullYear(), 0, 1), d];
    },
  },
];

export default function ReportsPage() {
  const { toast, settings } = useApp();
  const [from, setFrom] = useState(isoDate(addDays(new Date(), -29)));
  const [to, setTo] = useState(isoDate());
  const [r, setR] = useState<SalesReport | null>(null);

  const load = useCallback(() => {
    api.salesReport(from, to).then(setR).catch(toast.error);
  }, [from, to, toast]);
  useEffect(load, [load]);

  const doExport = async () => {
    if (!r) return;
    const rows: (string | number)[][] = [
      ["Synthèse", "", "", ""],
      [tl("Chiffre d'affaires TTC"), csvMoney(r.revenue), "", ""],
      [tl("Nombre de ventes"), r.sales_count, "", ""],
      [tl("Coût des marchandises vendues"), csvMoney(r.cost_total), "", ""],
      [tl("Marge brute"), csvMoney(r.margin), "", ""],
      [tl("TVA collectée"), csvMoney(r.tax_total), "", ""],
      [tl("Remises accordées"), csvMoney(r.discount_total), "", ""],
      [tl("Ventes à crédit"), csvMoney(r.credit_total), "", ""],
      [tl("Achats fournisseurs"), csvMoney(r.purchases_total), "", ""],
      [],
      ["Ventes par jour", "Nombre", "CA", "Marge"],
      ...r.by_day.map((d) => [d.date, d.count, csvMoney(d.revenue), csvMoney(d.margin)]),
      [],
      ["Produit", "Quantité", "CA", "Marge"],
      ...r.top_products.map((p) => [p.name, String(p.quantity).replace(".", ","), csvMoney(p.revenue), csvMoney(p.margin)]),
      [],
      ["Catégorie", "Tickets", "CA", "Marge"],
      ...r.by_category.map((c) => [c.label, c.count, csvMoney(c.amount), csvMoney(c.margin)]),
      [],
      ["Mode de paiement", "Ventes", "Montant", ""],
      ...r.by_payment.map((c) => [paymentLabel(c.label), c.count, csvMoney(c.amount), ""]),
      [],
      ["Caissier", "Ventes", "CA", "Marge"],
      ...r.by_user.map((c) => [c.label, c.count, csvMoney(c.amount), csvMoney(c.margin)]),
      [],
      [tl("Remises par caissier"), tl("Ventes avec remise"), tl("Total des remises"), tl("Validées par un responsable")],
      ...(r.discounts_by_user ?? []).map((d) => [d.label, d.count, csvMoney(d.amount), d.approved]),
    ];
    try {
      if (await exportCsv(`rapport-${from}-au-${to}.csv`, toCsv([`Rapport du ${dateOnly(from)} au ${dateOnly(to)}`, "", "", ""], rows))) toast.success(tl("Export terminé."));
    } catch (e) {
      toast.error(e);
    }
  };

  const doPrint = () => {
    if (!r) return;
    const table = (title: string, head: string[], rows: string[][]) =>
      `<h3>${title}</h3><table><thead><tr>${head.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
    printHtml(`
      <div class="report-print">
        <h1>${settings.shop_name} — ${tl("Rapport d'activité")}</h1>
        <p>${tl("Période du {0} au {1} · édité le {2}", [dateOnly(from), dateOnly(to), new Date().toLocaleString(locale())])}</p>
        ${table(tl("Synthèse"), [tl("Indicateur"), tl("Valeur")], [
          [tl("Chiffre d'affaires TTC"), money(r.revenue)],
          [tl("Nombre de ventes"), String(r.sales_count)],
          [tl("Panier moyen"), money(r.sales_count ? Math.round(r.revenue / r.sales_count) : 0)],
          [tl("Marge brute"), `${money(r.margin)} (${percent(r.revenue ? (r.margin / r.revenue) * 100 : 0)})`],
          [tl("TVA collectée"), money(r.tax_total)],
          [tl("Remises"), money(r.discount_total)],
          [tl("Ventes à crédit"), money(r.credit_total)],
          [tl("Règlements clients encaissés"), money(r.customer_payments_total)],
          [tl("Achats fournisseurs"), money(r.purchases_total)],
          [tl("Ventes annulées"), `${r.cancelled_count} (${money(r.cancelled_total)})`],
        ])}
        ${table(tl("Par mode de paiement"), [tl("Mode"), tl("Ventes"), tl("Montant")], r.by_payment.map((b) => [paymentLabel(b.label), String(b.count), money(b.amount)]))}
        ${table(tl("Par catégorie"), [tl("Catégorie"), tl("CA"), tl("Marge")], r.by_category.map((b) => [b.label, money(b.amount), money(b.margin)]))}
        ${table(tl("Par caissier"), [tl("Caissier"), tl("Ventes"), tl("CA")], r.by_user.map((b) => [b.label, String(b.count), money(b.amount)]))}
        ${table(tl("Remises par caissier"), [tl("Caissier"), tl("Ventes avec remise"), tl("Total des remises"), tl("Validées par un responsable")], (r.discounts_by_user ?? []).map((d) => [d.label, String(d.count), money(d.amount), String(d.approved)]))}
        ${table(tl("Meilleures ventes"), [tl("Produit"), tl("Quantité"), tl("CA"), tl("Marge")], r.top_products.map((p) => [p.name, `${qty(p.quantity)} ${p.unit}`, money(p.revenue), money(p.margin)]))}
      </div>`);
  };

  if (!r) return <Loading />;
  const marginRate = r.revenue > 0 ? (r.margin / r.revenue) * 100 : 0;
  const days = r.by_day.map((d) => ({ label: dateOnly(d.date).slice(0, 5), ca: fromMinor(d.revenue), marge: fromMinor(d.margin) }));

  return (
    <div className="page">
      <PageHeader
        help="reports"
        title={tl("Rapports")}
        subtitle={tl("Analyse des ventes, des marges et de l'activité sur une période.")}
        actions={
          <>
            <button className="btn" onClick={doPrint}><Printer size={16} />  {tl("Imprimer")}</button>
            <button className="btn" onClick={doExport}><Download size={16} />  {tl("Exporter (Excel)")}</button>
          </>
        }
      />
      <div className="toolbar">
        {PRESETS.map((p) => (
          <button
            key={p.label}
            className="chip"
            onClick={() => {
              const [a, b] = p.range();
              setFrom(isoDate(a));
              setTo(isoDate(b));
            }}
          >
            {p.label}
          </button>
        ))}
        <div className="spacer" />
        <label className="inline">{tl("Du")} <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="inline">au <input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
      </div>

      <div className="stats">
        <StatCard label={tl("Chiffre d'affaires TTC")} value={money(r.revenue)} tone="accent" hint={`${r.sales_count} ventes`} />
        <StatCard label={tl("Panier moyen")} value={money(r.sales_count ? Math.round(r.revenue / r.sales_count) : 0)} />
        <StatCard label={tl("Marge brute")} value={money(r.margin)} tone="success" hint={tl("Taux de marge : {0}", [percent(marginRate)])} />
        <StatCard label={tl("TVA collectée")} value={money(r.tax_total)} />
        <StatCard label={tl("Remises accordées")} value={money(r.discount_total)} />
        <StatCard label={tl("Ventes à crédit")} value={money(r.credit_total)} tone={r.credit_total ? "warning" : "default"} hint={tl("Règlements reçus : {0}", [money(r.customer_payments_total)])} />
        <StatCard label={tl("Achats fournisseurs")} value={money(r.purchases_total)} />
        <StatCard label={tl("Ventes annulées")} value={r.cancelled_count} tone={r.cancelled_count ? "danger" : "default"} hint={money(r.cancelled_total)} />
      </div>

      <div className="card">
        <div className="card-header"><h3>{tl("Évolution journalière")}</h3></div>
        <div style={{ height: 280 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={days} margin={{ top: 10, right: 16, left: 8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: "var(--muted)" }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
              <YAxis tick={{ fontSize: 11, fill: "var(--muted)" }} tickLine={false} axisLine={false} width={70} tickFormatter={(v) => Number(v).toLocaleString(locale())} />
              <Tooltip formatter={(v, n) => [Number(v).toLocaleString(locale()), n === "ca" ? tl("Chiffre d'affaires") : tl("Marge")]} />
              <Bar dataKey="ca" fill="var(--accent)" radius={[4, 4, 0, 0]} />
              <Bar dataKey="marge" fill="var(--success)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid-2">
        <BreakdownCard title={tl("Par mode de paiement")} data={r.by_payment} labelFn={paymentLabel} pie />
        <BreakdownCard title={tl("Par catégorie")} data={r.by_category} />
      </div>
      <div className="grid-2">
        <div className="card">
          <div className="card-header"><h3>{tl("Meilleures ventes")}</h3></div>
          {r.top_products.length === 0 ? (
            <Empty title={tl("Aucune vente")} />
          ) : (
            <table className="table compact">
              <thead><tr><th>{tl("Produit")}</th><th className="num">{tl("Quantité")}</th><th className="num">CA</th><th className="num">{tl("Marge")}</th></tr></thead>
              <tbody>
                {r.top_products.map((p) => (
                  <tr key={p.product_id}>
                    <td>{p.name}</td>
                    <td className="num">{qty(p.quantity)} {p.unit}</td>
                    <td className="num">{money(p.revenue)}</td>
                    <td className={`num ${p.margin < 0 ? "text-danger" : ""}`}>{money(p.margin)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <BreakdownCard title={tl("Par caissier")} data={r.by_user} />
        <DiscountCard data={r.discounts_by_user ?? []} />
      </div>
    </div>
  );
}

/** Remises par caissier : à surveiller (une remise au-delà du seuil est validée par un responsable). */
function DiscountCard({ data }: { data: DiscountRow[] }) {
  return (
    <div className="card">
      <div className="card-header"><h3>{tl("Remises par caissier")}</h3></div>
      {data.length === 0 ? (
        <Empty title={tl("Aucune remise sur la période")} />
      ) : (
        <table className="table compact">
          <thead><tr><th>{tl("Caissier")}</th><th className="num">{tl("Ventes avec remise")}</th><th className="num">{tl("Total des remises")}</th><th className="num">{tl("Validées par un responsable")}</th></tr></thead>
          <tbody>
            {data.map((d) => (
              <tr key={d.label}>
                <td>{d.label}</td>
                <td className="num">{d.count}</td>
                <td className="num">{money(d.amount)}</td>
                <td className="num">{d.approved}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function BreakdownCard({ title, data, labelFn = (s) => s, pie }: { title: string; data: Breakdown[]; labelFn?: (s: string) => string; pie?: boolean }) {
  const total = data.reduce((s, d) => s + d.amount, 0);
  return (
    <div className="card">
      <div className="card-header"><h3>{title}</h3></div>
      {data.length === 0 ? (
        <Empty title={tl("Aucune donnée")} />
      ) : (
        <div className={pie ? "pie-layout" : ""}>
          {pie && (
            <div style={{ width: 180, height: 180 }}>
              <ResponsiveContainer>
                <PieChart>
                  <Pie data={data.map((d) => ({ name: labelFn(d.label), value: fromMinor(d.amount) }))} dataKey="value" innerRadius={50} outerRadius={80} paddingAngle={2}>
                    {data.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
                  </Pie>
                  <Tooltip formatter={(v) => Number(v).toLocaleString(locale())} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
          <div className="bars" style={{ flex: 1 }}>
            {data.map((d, i) => (
              <div key={d.label} className="hbar">
                <div className="hbar-top">
                  <span>{pie && <span className="dot" style={{ background: PALETTE[i % PALETTE.length] }} />}{labelFn(d.label)}</span>
                  <span><strong>{money(d.amount)}</strong> <span className="muted small">({percent(total ? (d.amount / total) * 100 : 0, 0)})</span></span>
                </div>
                <div className="hbar-track"><div className="hbar-fill" style={{ width: `${total ? (d.amount / total) * 100 : 0}%`, background: PALETTE[i % PALETTE.length] }} /></div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
