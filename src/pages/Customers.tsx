import { useCallback, useEffect, useState } from "react";
import { Plus, Search, Pencil, Archive, HandCoins, FileText, Phone } from "lucide-react";
import { api } from "../api";
import { useApp } from "../context/AppContext";
import { HelpTip } from "../components/Help";
import { Badge, Empty, Field, Modal, PageHeader } from "../components/ui";
import { SaleDetailModal } from "../components/SaleDetail";
import { currencySymbol, dateOnly, dateTime, minorToInput, money, operatorMethods, paymentLabel, toMinor } from "../lib/format";
import type { Customer, Sale, StatementLine } from "../types";
import { tl } from "../lib/i18n";

export default function CustomersPage() {
  const { toast, confirm, isAdmin, askPin } = useApp();
  const [list, setList] = useState<Customer[]>([]);
  const [search, setSearch] = useState("");
  const [withDebt, setWithDebt] = useState(false);
  const [editing, setEditing] = useState<Customer | "new" | null>(null);
  const [paying, setPaying] = useState<Customer | null>(null);
  const [statement, setStatement] = useState<Customer | null>(null);

  const load = useCallback(() => api.listCustomers({ search, with_debt: withDebt }).then(setList).catch(toast.error), [search, withDebt, toast]);
  useEffect(() => {
    const t = setTimeout(load, 150);
    return () => clearTimeout(t);
  }, [load]);

  const totalDebt = list.reduce((s, c) => s + Math.max(0, c.balance), 0);

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
        subtitle={<>{list.length}  {tl("client(s) · Créances :")} <strong>{money(totalDebt)}</strong></>}
        actions={<button className="btn btn-primary" onClick={() => setEditing("new")}><Plus size={16} />  {tl("Nouveau client")}</button>}
      />
      <div className="toolbar">
        <div className="search-box"><Search size={16} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={tl("Nom, téléphone ou e-mail…")} /></div>
        <label className="check"><input type="checkbox" checked={withDebt} onChange={(e) => setWithDebt(e.target.checked)} />  {tl("Uniquement les clients endettés")}</label>
      </div>
      <div className="card no-pad">
        {list.length === 0 ? (
          <Empty title={tl("Aucun client")} />
        ) : (
          <table className="table">
            <thead><tr><th>{tl("Client")}</th><th>{tl("Téléphone")}</th><th className="num">{tl("Achats cumulés")}</th><th>{tl("Dernier achat")}</th><th className="num">{tl("Points")}</th><th className="num">{tl("Plafond crédit")}</th><th className="num">{tl("Dette")}</th><th></th></tr></thead>
            <tbody>
              {list.map((c) => (
                <tr key={c.id} onDoubleClick={() => setStatement(c)}>
                  <td><strong>{c.name}</strong>{c.address && <div className="muted small">{c.address}</div>}</td>
                  <td>{c.phone ? <><Phone size={12} /> {c.phone}</> : <span className="muted">—</span>}</td>
                  <td className="num">{money(c.purchases_total)}</td>
                  <td>{dateOnly(c.last_purchase_at)}</td>
                  <td className="num">{c.loyalty_points}</td>
                  <td className="num">{c.credit_limit > 0 ? money(c.credit_limit) : <span className="muted">aucun</span>}</td>
                  <td className="num">{c.balance > 0 ? <Badge tone="warning">{money(c.balance)}</Badge> : c.balance < 0 ? <Badge tone="info">{tl("Avoir")} {money(-c.balance)}</Badge> : <span className="muted">—</span>}</td>
                  <td className="actions">
                    {c.balance > 0 && <button className="icon-btn" title={tl("Encaisser un règlement")} onClick={() => setPaying(c)}><HandCoins size={16} /></button>}
                    <button className="icon-btn" title={tl("Relevé de compte")} onClick={() => setStatement(c)}><FileText size={16} /></button>
                    <button className="icon-btn" title={tl("Modifier")} onClick={() => setEditing(c)}><Pencil size={16} /></button>
                    {isAdmin && <button className="icon-btn danger" title={tl("Archiver")} onClick={() => archive(c)}><Archive size={16} /></button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {editing && <CustomerForm customer={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
      {paying && <PaymentForm customer={paying} onClose={() => setPaying(null)} onSaved={() => { setPaying(null); load(); }} />}
      {statement && <StatementModal customer={statement} onClose={() => setStatement(null)} />}
    </div>
  );
}

function CustomerForm({ customer, onClose, onSaved }: { customer: Customer | null; onClose: () => void; onSaved: () => void }) {
  const { toast, isAdmin: isManager } = useApp();
  const [f, setF] = useState({
    name: customer?.name ?? "",
    phone: customer?.phone ?? "",
    email: customer?.email ?? "",
    address: customer?.address ?? "",
    notes: customer?.notes ?? "",
    credit_limit: customer ? minorToInput(customer.credit_limit) : "0",
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
      </div>
    </Modal>
  );
}

function PaymentForm({ customer, onClose, onSaved }: { customer: Customer; onClose: () => void; onSaved: () => void }) {
  const { toast } = useApp();
  const [amount, setAmount] = useState(minorToInput(customer.balance));
  const [method, setMethod] = useState("cash");
  const [reference, setReference] = useState("");
  const [phone, setPhone] = useState(customer.phone ?? "");
  const [note, setNote] = useState("");
  const submit = async () => {
    try {
      await api.recordCustomerPayment({
        customer_id: customer.id,
        amount: toMinor(amount),
        method,
        reference: method === "cash" ? null : reference.trim() || null,
        phone: method === "cash" ? null : phone.trim() || null,
        note: note || null,
      });
      toast.success(tl("Règlement enregistré."));
      onSaved();
    } catch (e) {
      toast.error(e);
    }
  };
  return (
    <Modal
      title={tl("Règlement de {0}", [customer.name])}
      onClose={onClose}
      width={460}
      footer={<><button className="btn" onClick={onClose}>{tl("Annuler")}</button><button className="btn btn-primary" onClick={submit}>{tl("Encaisser")}</button></>}
    >
      <div className="alert alert-warning">{tl("Dette actuelle :")} <strong>{money(customer.balance)}</strong></div>
      <div className="form-grid one">
        <Field label={tl("Montant reçu ({0})", [currencySymbol()])}><input className="input-lg" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus /></Field>
        <Field label={tl("Mode de paiement")}>
          <select value={method} onChange={(e) => setMethod(e.target.value)}>
            <option value="cash">{tl("Espèces")}</option>
            <option value="orange_money">{paymentLabel("orange_money")}</option>
            {operatorMethods().map((m) => (
              <option key={m} value={m}>{paymentLabel(m)}</option>
            ))}
            <option value="mobile_money">{paymentLabel("mobile_money")}</option>
            <option value="card">{tl("Carte bancaire")}</option>
            <option value="other">{tl("Autre")}</option>
          </select>
        </Field>
        {method !== "cash" && method !== "other" && (
          <>
            <Field label={tl("ID de transaction")} hint={tl("Saisissez ou scannez la référence de la confirmation.")}>
              <input className="mono" value={reference} onChange={(e) => setReference(e.target.value.trim())} />
            </Field>
            <Field label={tl("N° de téléphone du payeur")}><input value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
          </>
        )}
        <Field label={tl("Note")}><input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

function StatementModal({ customer, onClose }: { customer: Customer; onClose: () => void }) {
  const { toast } = useApp();
  const [lines, setLines] = useState<StatementLine[]>([]);
  const [sale, setSale] = useState<Sale | null>(null);
  useEffect(() => {
    api.customerStatement(customer.id).then(setLines).catch(toast.error);
  }, [customer.id, toast]);

  return (
    <Modal title={tl("Relevé de compte — {0}", [customer.name])} onClose={onClose} width={720}>
      <div className="summary-bar">
        <span>{tl("Achats cumulés :")} <strong>{money(customer.purchases_total)}</strong></span>
        <span>{tl("Dette :")} <strong>{money(customer.balance)}</strong></span>
        <span>{tl("Points fidélité :")} <strong>{customer.loyalty_points}</strong></span>
      </div>
      {lines.length === 0 ? (
        <Empty title={tl("Aucune opération")} />
      ) : (
        <table className="table compact">
          <thead><tr><th>{tl("Date")}</th><th>{tl("Opération")}</th><th>{tl("Paiement")}</th><th className="num">{tl("Montant")}</th><th className="num">{tl("Effet sur la dette")}</th></tr></thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i} onDoubleClick={() => l.sale_id && api.getSale(l.sale_id).then(setSale)}>
                <td className="nowrap">{dateTime(l.date)}</td>
                <td>{l.kind === "sale" ? <button className="link-btn" onClick={() => l.sale_id && api.getSale(l.sale_id).then(setSale).catch(toast.error)}>{tl("Achat")} {l.reference}</button> : tl("Règlement")}</td>
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
      {sale && <SaleDetailModal sale={sale} onClose={() => setSale(null)} />}
    </Modal>
  );
}
