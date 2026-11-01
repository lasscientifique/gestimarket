import { useCallback, useEffect, useState } from "react";
import { Plus, Search, Pencil, Archive, Phone, Mail } from "lucide-react";
import { api } from "../api";
import { useApp } from "../context/AppContext";
import { Empty, Field, Modal, PageHeader } from "../components/ui";
import { money } from "../lib/format";
import type { Supplier } from "../types";

export default function SuppliersPage() {
  const { toast, confirm, askPin } = useApp();
  const [list, setList] = useState<Supplier[]>([]);
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Supplier | "new" | null>(null);

  const load = useCallback(() => api.listSuppliers(search).then(setList).catch(toast.error), [search, toast]);
  useEffect(() => {
    const t = setTimeout(load, 150);
    return () => clearTimeout(t);
  }, [load]);

  const archive = async (s: Supplier) => {
    if (!(await confirm({ title: "Archiver le fournisseur", message: `Archiver « ${s.name} » ?`, danger: true, confirmLabel: "Archiver" }))) return;
    try {
      const pin = await askPin({ title: "Archiver le fournisseur", level: "manager" });
      if (!pin) return;
      await api.archiveSupplier(s.id, pin);
      load();
    } catch (e) {
      toast.error(e);
    }
  };

  return (
    <div className="page">
      <PageHeader
        help="suppliers" title="Fournisseurs" subtitle={`${list.length} fournisseur(s)`} actions={<button className="btn btn-primary" onClick={() => setEditing("new")}><Plus size={16} /> Nouveau fournisseur</button>} />
      <div className="toolbar">
        <div className="search-box"><Search size={16} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Nom, contact ou téléphone…" /></div>
      </div>
      <div className="card no-pad">
        {list.length === 0 ? (
          <Empty title="Aucun fournisseur" />
        ) : (
          <table className="table">
            <thead><tr><th>Fournisseur</th><th>Contact</th><th>Coordonnées</th><th className="num">Produits</th><th className="num">Total des achats</th><th></th></tr></thead>
            <tbody>
              {list.map((s) => (
                <tr key={s.id} onDoubleClick={() => setEditing(s)}>
                  <td><strong>{s.name}</strong>{s.address && <div className="muted small">{s.address}</div>}</td>
                  <td>{s.contact ?? <span className="muted">—</span>}</td>
                  <td className="small">
                    {s.phone && <div><Phone size={12} /> {s.phone}</div>}
                    {s.email && <div><Mail size={12} /> {s.email}</div>}
                  </td>
                  <td className="num">{s.product_count}</td>
                  <td className="num">{money(s.purchases_total)}</td>
                  <td className="actions">
                    <button className="icon-btn" onClick={() => setEditing(s)}><Pencil size={16} /></button>
                    <button className="icon-btn danger" onClick={() => archive(s)}><Archive size={16} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {editing && <SupplierForm supplier={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
    </div>
  );
}

function SupplierForm({ supplier, onClose, onSaved }: { supplier: Supplier | null; onClose: () => void; onSaved: () => void }) {
  const { toast } = useApp();
  const [f, setF] = useState({
    name: supplier?.name ?? "",
    contact: supplier?.contact ?? "",
    phone: supplier?.phone ?? "",
    email: supplier?.email ?? "",
    address: supplier?.address ?? "",
    notes: supplier?.notes ?? "",
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const submit = async () => {
    try {
      await api.saveSupplier(supplier?.id ?? null, f);
      toast.success("Fournisseur enregistré.");
      onSaved();
    } catch (e) {
      toast.error(e);
    }
  };
  return (
    <Modal
      title={supplier ? "Modifier le fournisseur" : "Nouveau fournisseur"}
      onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Annuler</button><button className="btn btn-primary" disabled={!f.name.trim()} onClick={submit}>Enregistrer</button></>}
    >
      <div className="form-grid">
        <Field label="Raison sociale *" span={2}><input value={f.name} onChange={set("name")} autoFocus /></Field>
        <Field label="Personne à contacter"><input value={f.contact} onChange={set("contact")} /></Field>
        <Field label="Téléphone"><input value={f.phone} onChange={set("phone")} /></Field>
        <Field label="E-mail"><input value={f.email} onChange={set("email")} /></Field>
        <Field label="Adresse"><input value={f.address} onChange={set("address")} /></Field>
        <Field label="Notes" span={2}><textarea rows={2} value={f.notes} onChange={set("notes")} /></Field>
      </div>
    </Modal>
  );
}
