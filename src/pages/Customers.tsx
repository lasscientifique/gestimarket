import { useCallback, useEffect, useState } from "react";
import { Plus, Search, Pencil, Archive, HandCoins, FileText, Phone } from "lucide-react";
import { api } from "../api";
import { useApp } from "../context/AppContext";
import { HelpTip } from "../components/Help";
import { Badge, Empty, Field, Modal, PageHeader } from "../components/ui";
import { SaleDetailModal } from "../components/SaleDetail";
import { currencySymbol, dateOnly, dateTime, minorToInput, money, paymentLabel, toMinor } from "../lib/format";
import type { Customer, Sale, StatementLine } from "../types";

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
    if (!(await confirm({ title: "Archiver le client", message: `Archiver « ${c.name} » ?`, danger: true, confirmLabel: "Archiver" }))) return;
    try {
      const pin = await askPin({ title: "Archiver le client", level: "admin" });
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
        title="Clients"
        subtitle={<>{list.length} client(s) · Créances : <strong>{money(totalDebt)}</strong></>}
        actions={<button className="btn btn-primary" onClick={() => setEditing("new")}><Plus size={16} /> Nouveau client</button>}
      />
      <div className="toolbar">
        <div className="search-box"><Search size={16} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Nom, téléphone ou e-mail…" /></div>
        <label className="check"><input type="checkbox" checked={withDebt} onChange={(e) => setWithDebt(e.target.checked)} /> Uniquement les clients endettés</label>
      </div>
      <div className="card no-pad">
        {list.length === 0 ? (
          <Empty title="Aucun client" />
        ) : (
          <table className="table">
            <thead><tr><th>Client</th><th>Téléphone</th><th className="num">Achats cumulés</th><th>Dernier achat</th><th className="num">Points</th><th className="num">Plafond crédit</th><th className="num">Dette</th><th></th></tr></thead>
            <tbody>
              {list.map((c) => (
                <tr key={c.id} onDoubleClick={() => setStatement(c)}>
                  <td><strong>{c.name}</strong>{c.address && <div className="muted small">{c.address}</div>}</td>
                  <td>{c.phone ? <><Phone size={12} /> {c.phone}</> : <span className="muted">—</span>}</td>
                  <td className="num">{money(c.purchases_total)}</td>
                  <td>{dateOnly(c.last_purchase_at)}</td>
                  <td className="num">{c.loyalty_points}</td>
                  <td className="num">{c.credit_limit > 0 ? money(c.credit_limit) : <span className="muted">aucun</span>}</td>
                  <td className="num">{c.balance > 0 ? <Badge tone="warning">{money(c.balance)}</Badge> : c.balance < 0 ? <Badge tone="info">Avoir {money(-c.balance)}</Badge> : <span className="muted">—</span>}</td>
                  <td className="actions">
                    {c.balance > 0 && <button className="icon-btn" title="Encaisser un règlement" onClick={() => setPaying(c)}><HandCoins size={16} /></button>}
                    <button className="icon-btn" title="Relevé de compte" onClick={() => setStatement(c)}><FileText size={16} /></button>
                    <button className="icon-btn" title="Modifier" onClick={() => setEditing(c)}><Pencil size={16} /></button>
                    {isAdmin && <button className="icon-btn danger" title="Archiver" onClick={() => archive(c)}><Archive size={16} /></button>}
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
      toast.success("Client enregistré.");
      onSaved();
    } catch (e) {
      toast.error(e);
    }
  };
  return (
    <Modal
      title={customer ? "Modifier le client" : "Nouveau client"}
      onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Annuler</button><button className="btn btn-primary" disabled={!f.name.trim()} onClick={submit}>Enregistrer</button></>}
    >
      <div className="form-grid">
        <Field label="Nom complet *" span={2}><input value={f.name} onChange={set("name")} autoFocus /></Field>
        <Field label="Téléphone"><input value={f.phone} onChange={set("phone")} /></Field>
        <Field label="E-mail"><input value={f.email} onChange={set("email")} /></Field>
        <Field label="Adresse" span={2}><input value={f.address} onChange={set("address")} /></Field>
        <Field label={<>Plafond de crédit ({currencySymbol()}) <HelpTip k="credit_limit" /></>} hint={isManager ? "0 = vente à crédit non autorisée" : "Modifiable uniquement par l'administrateur"}>
          <input inputMode="decimal" value={f.credit_limit} onChange={set("credit_limit")} disabled={!isManager} />
        </Field>
        <Field label="Notes"><input value={f.notes} onChange={set("notes")} /></Field>
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
      toast.success("Règlement enregistré.");
      onSaved();
    } catch (e) {
      toast.error(e);
    }
  };
  return (
    <Modal
      title={`Règlement de ${customer.name}`}
      onClose={onClose}
      width={460}
      footer={<><button className="btn" onClick={onClose}>Annuler</button><button className="btn btn-primary" onClick={submit}>Encaisser</button></>}
    >
      <div className="alert alert-warning">Dette actuelle : <strong>{money(customer.balance)}</strong></div>
      <div className="form-grid one">
        <Field label={`Montant reçu (${currencySymbol()})`}><input className="input-lg" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus /></Field>
        <Field label="Mode de paiement">
          <select value={method} onChange={(e) => setMethod(e.target.value)}>
            <option value="cash">Espèces</option>
            <option value="orange_money">{paymentLabel("orange_money")}</option>
            <option value="mobile_money">{paymentLabel("mobile_money")}</option>
            <option value="card">Carte bancaire</option>
            <option value="other">Autre</option>
          </select>
        </Field>
        {method !== "cash" && method !== "other" && (
          <>
            <Field label="ID de transaction" hint="Saisissez ou scannez la référence de la confirmation.">
              <input className="mono" value={reference} onChange={(e) => setReference(e.target.value.trim())} />
            </Field>
            <Field label="N° de téléphone du payeur"><input value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
          </>
        )}
        <Field label="Note"><input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
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
    <Modal title={`Relevé de compte — ${customer.name}`} onClose={onClose} width={720}>
      <div className="summary-bar">
        <span>Achats cumulés : <strong>{money(customer.purchases_total)}</strong></span>
        <span>Dette : <strong>{money(customer.balance)}</strong></span>
        <span>Points fidélité : <strong>{customer.loyalty_points}</strong></span>
      </div>
      {lines.length === 0 ? (
        <Empty title="Aucune opération" />
      ) : (
        <table className="table compact">
          <thead><tr><th>Date</th><th>Opération</th><th>Paiement</th><th className="num">Montant</th><th className="num">Effet sur la dette</th></tr></thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i} onDoubleClick={() => l.sale_id && api.getSale(l.sale_id).then(setSale)}>
                <td className="nowrap">{dateTime(l.date)}</td>
                <td>{l.kind === "sale" ? <button className="link-btn" onClick={() => l.sale_id && api.getSale(l.sale_id).then(setSale).catch(toast.error)}>Achat {l.reference}</button> : "Règlement"}</td>
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
