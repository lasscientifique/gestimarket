import { useCallback, useEffect, useState } from "react";
import { Plus, Search, Pencil, Archive, HandCoins, FileText, Phone, Undo2, QrCode } from "lucide-react";
import { api } from "../api";
import { useApp } from "../context/AppContext";
import { HelpTip } from "../components/Help";
import { Badge, Empty, Field, Modal, PageHeader, useShowMore } from "../components/ui";
import { SaleDetailModal } from "../components/SaleDetail";
import { AccountBalance, DepositModal, LoyaltyCardModal, LoyaltyHistory, RefundFundsModal, Stars, balanceText, useLoyaltyActive } from "../components/CustomerAccount";
import { currencySymbol, dateOnly, dateTime, minorToInput, money, paymentLabel, toMinor } from "../lib/format";
import type { Customer, Sale, StatementLine } from "../types";
import { tl } from "../lib/i18n";

type View = "all" | "debt" | "funds";

export default function CustomersPage() {
  const { toast, confirm, isAdmin, askPin } = useApp();
  const loyalty = useLoyaltyActive();
  const [list, setList] = useState<Customer[]>([]);
  const [search, setSearch] = useState("");
  const [view, setView] = useState<View>("all");
  const [editing, setEditing] = useState<Customer | "new" | null>(null);
  const [paying, setPaying] = useState<Customer | null>(null);
  const [refunding, setRefunding] = useState<Customer | null>(null);
  const [card, setCard] = useState<Customer | null>(null);
  const [statement, setStatement] = useState<Customer | null>(null);
  const shown = useShowMore(list, `${search}|${view}`);

  const load = useCallback(
    () => api.listCustomers({ search, with_debt: view === "debt", with_funds: view === "funds" }).then(setList).catch(toast.error),
    [search, view, toast],
  );
  useEffect(() => {
    const t = setTimeout(load, 150);
    return () => clearTimeout(t);
  }, [load]);

  const totalDebt = list.reduce((s, c) => s + Math.max(0, c.balance), 0);
  const totalFunds = list.reduce((s, c) => s + Math.max(0, -c.balance), 0);
  const showPoints = !loyalty && list.some((c) => c.loyalty_points > 0);

  const archive = async (c: Customer) => {
    if (!(await confirm({ title: tl("Archiver le client"), message: tl("Archiver « {0} » ?", [c.name]), danger: true, confirmLabel: tl("Archiver") }))) return;
    try {
      const pin = await askPin({ title: tl("Archiver le client"), level: "admin" });
      if (!pin) return;
      await api.archiveCustomer(c.id, pin);
      load();
    } catch (e) {
      toast.error(e);
    }
  };

  return (
    <div className="page">
      <PageHeader
        help="customers"
        title={tl("Clients")}
        subtitle={
          <>
            {list.length}  {tl("client(s) · Créances :")} <strong>{money(totalDebt)}</strong>
            {totalFunds > 0 && <>  {tl("· Fonds des clients :")} <strong>{money(totalFunds)}</strong></>}
          </>
        }
        actions={<button className="btn btn-primary" onClick={() => setEditing("new")}><Plus size={16} />  {tl("Nouveau client")}</button>}
      />
      <div className="toolbar">
        <div className="search-box"><Search size={16} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={tl("Nom, téléphone ou e-mail…")} /></div>
        <select value={view} onChange={(e) => setView(e.target.value as View)} aria-label={tl("Clients affichés")}>
          <option value="all">{tl("Tous les clients")}</option>
          <option value="debt">{tl("Avec une dette")}</option>
          <option value="funds">{tl("Avec des fonds")}</option>
        </select>
      </div>
      <div className="card no-pad">
        {list.length === 0 ? (
          <Empty title={tl("Aucun client")} />
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>{tl("Client")}</th>
                <th>{tl("Téléphone")}</th>
                <th className="num">{tl("Achats cumulés")}</th>
                <th>{tl("Dernier achat")}</th>
                {loyalty && <th>{tl("Fidélité")}</th>}
                {showPoints && <th className="num">{tl("Points")}</th>}
                <th className="num">{tl("Plafond crédit")}</th>
                <th className="num">{tl("Compte")} <HelpTip k="customer_account" /></th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {shown.visible.map((c) => (
                <tr key={c.id} onDoubleClick={() => setStatement(c)}>
                  <td><strong>{c.name}</strong>{c.wholesale && <> <Badge tone="info">{tl("Grossiste")}</Badge></>}{c.address && <div className="muted small">{c.address}</div>}</td>
                  <td>{c.phone ? <><Phone size={12} /> {c.phone}</> : <span className="muted">—</span>}</td>
                  <td className="num">{money(c.purchases_total)}</td>
                  <td>{dateOnly(c.last_purchase_at)}</td>
                  {loyalty && (
                    <td className="nowrap">
                      <Stars value={c.stars} />
                      {c.loyalty_bonus > 0 && <div className="small">{tl("Bonus")} <strong>{money(c.loyalty_bonus)}</strong></div>}
                    </td>
                  )}
                  {showPoints && <td className="num">{c.loyalty_points}</td>}
                  <td className="num">{c.credit_limit > 0 ? money(c.credit_limit) : <span className="muted">{tl("aucun")}</span>}</td>
                  <td className="num"><AccountBalance balance={c.balance} /></td>
                  <td className="actions">
                    <button className="icon-btn" title={c.balance > 0 ? tl("Encaisser un versement (dette)") : tl("Ajouter des fonds")} onClick={() => setPaying(c)}><HandCoins size={16} /></button>
                    {c.balance < 0 && <button className="icon-btn" title={tl("Rendre des fonds")} onClick={() => setRefunding(c)}><Undo2 size={16} /></button>}
                    {loyalty && <button className="icon-btn" title={tl("Carte de fidélité")} onClick={() => setCard(c)}><QrCode size={16} /></button>}
                    <button className="icon-btn" title={tl("Relevé de compte")} onClick={() => setStatement(c)}><FileText size={16} /></button>
                    <button className="icon-btn" title={tl("Modifier")} onClick={() => setEditing(c)}><Pencil size={16} /></button>
                    {isAdmin && <button className="icon-btn danger" title={tl("Archiver")} onClick={() => archive(c)}><Archive size={16} /></button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {shown.more}
      </div>
      {editing && <CustomerForm customer={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
      {paying && <DepositModal customer={paying} onClose={() => setPaying(null)} onSaved={() => { setPaying(null); load(); }} />}
      {refunding && <RefundFundsModal customer={refunding} onClose={() => setRefunding(null)} onSaved={() => { setRefunding(null); load(); }} />}
      {card && <LoyaltyCardModal customer={card} onClose={() => { setCard(null); load(); }} />}
      {statement && <StatementModal customer={statement} loyalty={loyalty} onClose={() => setStatement(null)} />}
    </div>
  );
}

function CustomerForm({ customer, onClose, onSaved }: { customer: Customer | null; onClose: () => void; onSaved: () => void }) {
  const { toast, isAdmin: isManager, user } = useApp();
  const [f, setF] = useState({
    name: customer?.name ?? "",
    phone: customer?.phone ?? "",
    email: customer?.email ?? "",
    address: customer?.address ?? "",
    notes: customer?.notes ?? "",
    credit_limit: customer ? minorToInput(customer.credit_limit) : "0",
    wholesale: customer?.wholesale ?? false,
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const submit = async () => {
    try {
      await api.saveCustomer(customer?.id ?? null, { ...f, credit_limit: toMinor(f.credit_limit || "0") });
      toast.success(tl("Client enregistré."));
      onSaved();
    } catch (e) {
      toast.error(e);
    }
  };
  return (
    <Modal
      title={customer ? tl("Modifier le client") : tl("Nouveau client")}
      onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>{tl("Annuler")}</button><button className="btn btn-primary" disabled={!f.name.trim()} onClick={submit}>{tl("Enregistrer")}</button></>}
    >
      <div className="form-grid">
        <Field label={tl("Nom complet *")} span={2}><input value={f.name} onChange={set("name")} autoFocus /></Field>
        <Field label={tl("Téléphone")}><input value={f.phone} onChange={set("phone")} /></Field>
        <Field label={tl("E-mail")}><input value={f.email} onChange={set("email")} /></Field>
        <Field label={tl("Adresse")} span={2}><input value={f.address} onChange={set("address")} /></Field>
        <Field label={<>{tl("Plafond de crédit (")}{currencySymbol()}) <HelpTip k="credit_limit" /></>} hint={isManager ? tl("0 = vente à crédit non autorisée") : tl("Modifiable uniquement par l'administrateur")}>
          <input inputMode="decimal" value={f.credit_limit} onChange={set("credit_limit")} disabled={!isManager} />
        </Field>
        <Field label={tl("Notes")}><input value={f.notes} onChange={set("notes")} /></Field>
        <label className="check span-2">
          <input type="checkbox" checked={f.wholesale} disabled={user?.role === "cashier"} onChange={(e) => setF({ ...f, wholesale: e.target.checked })} />
          {tl("Client grossiste : toujours au prix de gros (articles qui en ont un)")}
          {user?.role === "cashier" && <span className="muted small">  {tl("(décidé par un gestionnaire)")}</span>}
        </label>
      </div>
    </Modal>
  );
}

/** Libellé d'une ligne du relevé (traduit à l'affichage). */
function lineLabel(kind: StatementLine["kind"]): string {
  const labels: Record<StatementLine["kind"], string> = {
    sale: tl("Achat"),
    payment: tl("Versement"),
    refund: tl("Fonds rendus"),
    return: tl("Retour sur le compte"),
  };
  return labels[kind] ?? kind;
}

function StatementModal({ customer, loyalty, onClose }: { customer: Customer; loyalty: boolean; onClose: () => void }) {
  const { toast } = useApp();
  const [lines, setLines] = useState<StatementLine[]>([]);
  const [sale, setSale] = useState<Sale | null>(null);
  const [tab, setTab] = useState<"account" | "bonus">("account");
  useEffect(() => {
    api.customerStatement(customer.id).then(setLines).catch(toast.error);
  }, [customer.id, toast]);
  const open = (id: number | null) => id && api.getSale(id).then(setSale).catch(toast.error);

  return (
    <Modal title={tl("Relevé de compte — {0}", [customer.name])} onClose={onClose} width={760}>
      <div className="summary-bar">
        <span>{tl("Achats cumulés :")} <strong>{money(customer.purchases_total)}</strong></span>
        <span>{tl("Compte :")} <strong className={customer.balance > 0 ? "text-danger" : customer.balance < 0 ? "text-success" : ""}>{balanceText(customer.balance)}</strong></span>
        {loyalty && (
          <span>
            <Stars value={customer.stars} />  {tl("Bonus :")} <strong>{money(customer.loyalty_bonus)}</strong>
            <span className="muted small">  {tl("({0} achat(s) sur 12 mois)", [customer.purchases_12m])}</span>
          </span>
        )}
        {!loyalty && customer.loyalty_points > 0 && <span>{tl("Points fidélité :")} <strong>{customer.loyalty_points}</strong></span>}
      </div>
      {loyalty && (
        <div className="tabbar small-tabs">
          <button className={`tab-item ${tab === "account" ? "active" : ""}`} onClick={() => setTab("account")}>{tl("Compte")}</button>
          <button className={`tab-item ${tab === "bonus" ? "active" : ""}`} onClick={() => setTab("bonus")}>{tl("Bonus fidélité")}</button>
        </div>
      )}
      {tab === "bonus" ? (
        <LoyaltyHistory customerId={customer.id} />
      ) : lines.length === 0 ? (
        <Empty title={tl("Aucune opération")} />
      ) : (
        <table className="table compact">
          <thead><tr><th>{tl("Date")}</th><th>{tl("Opération")}</th><th>{tl("Paiement")}</th><th className="num">{tl("Montant")}</th><th className="num">{tl("Effet sur le compte")}</th></tr></thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i} onDoubleClick={() => open(l.sale_id)}>
                <td className="nowrap">{dateTime(l.date)}</td>
                <td>
                  {l.kind === "sale" ? (
                    <button className="link-btn" onClick={() => open(l.sale_id)}>{tl("Achat")} {l.reference}</button>
                  ) : (
                    <>{lineLabel(l.kind)}{l.kind === "return" && <span className="mono">  {l.reference}</span>}</>
                  )}
                </td>
                <td>{paymentLabel(l.method)}</td>
                <td className="num">{money(l.total)}</td>
                <td className={`num ${l.debt_change > 0 ? "text-danger" : l.debt_change < 0 ? "text-success" : "muted"}`}>
                  {l.debt_change === 0 ? "—" : `${l.debt_change > 0 ? "+" : ""}${money(l.debt_change)}`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="muted small" style={{ marginTop: 8 }}>{tl("Effet sur le compte : + achat payé avec le compte ou mis en dette, − versement ou retour remis sur le compte.")}</p>
      {sale && <SaleDetailModal sale={sale} onClose={() => setSale(null)} />}
    </Modal>
  );
}
