import { useCallback, useEffect, useState } from "react";
import { Plus, Pencil, KeyRound, ShieldCheck } from "lucide-react";
import { api } from "../api";
import { useApp } from "../context/AppContext";
import { Badge, Field, Modal, PageHeader } from "../components/ui";
import { dateTime, ROLE_LABELS } from "../lib/format";
import type { Role, User } from "../types";

const ROLE_HELP: Record<Role, string> = {
  admin: "Contrôle total : tableau de bord, rapports, utilisateurs, paramètres et réglages, annulation des ventes, paiements mobiles, journal d'activité.",
  manager: "Gestion des produits : ajout, modification, suppression, catégories, emplacements, stock, achats et fournisseurs. Peut aussi encaisser.",
  cashier: "Vente uniquement : caisse, clients, recherche de produits, ses propres ventes et sa session de caisse.",
};

export default function UsersPage() {
  const { toast, user: me } = useApp();
  const [list, setList] = useState<User[]>([]);
  const [editing, setEditing] = useState<User | "new" | null>(null);
  const [resetting, setResetting] = useState<User | null>(null);
  const [pinFor, setPinFor] = useState<User | null>(null);

  const load = useCallback(() => api.listUsers().then(setList).catch(toast.error), [toast]);
  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="page">
      <PageHeader
        help="users" title="Utilisateurs" subtitle="Comptes du personnel et droits d'accès." actions={<button className="btn btn-primary" onClick={() => setEditing("new")}><Plus size={16} /> Nouvel utilisateur</button>} />
      <div className="card no-pad">
        <table className="table">
          <thead><tr><th>Nom</th><th>Identifiant</th><th>Rôle</th><th>Statut</th><th>Code PIN</th><th>Dernière connexion</th><th></th></tr></thead>
          <tbody>
            {list.map((u) => (
              <tr key={u.id} className={!u.active ? "row-cancelled" : ""}>
                <td><strong>{u.full_name}</strong> {u.id === me?.id && <Badge tone="info">vous</Badge>}</td>
                <td className="mono">{u.username}</td>
                <td><Badge tone={u.role === "admin" ? "danger" : u.role === "manager" ? "warning" : "default"}>{ROLE_LABELS[u.role]}</Badge></td>
                <td>{u.active ? <Badge tone="success">Actif</Badge> : <Badge>Désactivé</Badge>}</td>
                <td>{u.has_pin ? <Badge tone="success">Défini</Badge> : <Badge tone="warning">À définir</Badge>}</td>
                <td>{dateTime(u.last_login_at)}</td>
                <td className="actions">
                  <button className="icon-btn" title="Modifier" onClick={() => setEditing(u)}><Pencil size={16} /></button>
                  <button className="icon-btn" title="Réinitialiser le mot de passe" onClick={() => setResetting(u)}><KeyRound size={16} /></button>
                  <button className="icon-btn" title="Réinitialiser le code PIN" onClick={() => setPinFor(u)}><ShieldCheck size={16} /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editing && <UserForm user={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
      {resetting && <ResetForm user={resetting} onClose={() => setResetting(null)} />}
      {pinFor && <ResetPinForm user={pinFor} onClose={() => { setPinFor(null); load(); }} />}
    </div>
  );
}

function UserForm({ user, onClose, onSaved }: { user: User | null; onClose: () => void; onSaved: () => void }) {
  const { toast, askPin } = useApp();
  const [f, setF] = useState({ full_name: user?.full_name ?? "", username: user?.username ?? "", role: (user?.role ?? "cashier") as Role, active: user?.active ?? true, password: "" });
  const submit = async () => {
    try {
      const pin = await askPin({ title: user ? "Modifier l'utilisateur" : "Créer l'utilisateur", level: "admin" });
      if (!pin) return;
      await api.saveUser(user?.id ?? null, user ? { full_name: f.full_name, role: f.role, active: f.active } : { ...f }, pin);
      toast.success("Utilisateur enregistré.");
      onSaved();
    } catch (e) {
      toast.error(e);
    }
  };
  return (
    <Modal
      title={user ? "Modifier l'utilisateur" : "Nouvel utilisateur"}
      onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Annuler</button><button className="btn btn-primary" onClick={submit}>Enregistrer</button></>}
    >
      <div className="form-grid">
        <Field label="Nom complet *"><input value={f.full_name} onChange={(e) => setF({ ...f, full_name: e.target.value })} autoFocus /></Field>
        <Field label="Identifiant de connexion *"><input value={f.username} disabled={!!user} onChange={(e) => setF({ ...f, username: e.target.value })} /></Field>
        <Field label="Rôle" span={2} hint={ROLE_HELP[f.role]}>
          <select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as Role })}>
            {(Object.keys(ROLE_LABELS) as Role[]).map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
          </select>
        </Field>
        {!user && <Field label="Mot de passe initial *" hint="6 caractères minimum"><input type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></Field>}
        {user && <label className="check span-2"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Compte actif</label>}
      </div>
    </Modal>
  );
}

function ResetForm({ user, onClose }: { user: User; onClose: () => void }) {
  const { toast, askPin } = useApp();
  const [pwd, setPwd] = useState("");
  const submit = async () => {
    try {
      const pin = await askPin({ title: "Réinitialiser le mot de passe", level: "admin" });
      if (!pin) return;
      await api.resetUserPassword(user.id, pwd, pin);
      toast.success("Mot de passe réinitialisé.");
      onClose();
    } catch (e) {
      toast.error(e);
    }
  };
  return (
    <Modal title={`Nouveau mot de passe — ${user.full_name}`} onClose={onClose} width={420} footer={<><button className="btn" onClick={onClose}>Annuler</button><button className="btn btn-primary" disabled={!pwd} onClick={submit}>Réinitialiser</button></>}>
      <Field label="Nouveau mot de passe" hint="Communiquez-le à l'utilisateur, qui pourra le changer ensuite.">
        <input type="password" value={pwd} onChange={(e) => setPwd(e.target.value)} autoFocus />
      </Field>
    </Modal>
  );
}

function ResetPinForm({ user, onClose }: { user: User; onClose: () => void }) {
  const { toast, askPin } = useApp();
  const [pin, setPin] = useState("");
  const submit = async () => {
    try {
      const admin = await askPin({ title: "Réinitialiser le code PIN", level: "admin" });
      if (!admin) return;
      await api.resetUserPin(user.id, pin, admin);
      toast.success("Code PIN réinitialisé.");
      onClose();
    } catch (e) {
      toast.error(e);
    }
  };
  return (
    <Modal title={`Nouveau code PIN — ${user.full_name}`} onClose={onClose} width={420} footer={<><button className="btn" onClick={onClose}>Annuler</button><button className="btn btn-primary" disabled={pin.length < 4} onClick={submit}>Enregistrer</button></>}>
      <Field label="Nouveau code PIN (4 à 6 chiffres)" hint="Communiquez-le à l'utilisateur ; il pourra le changer lui-même (icône clé du menu).">
        <input className="input-lg pin-input" inputMode="numeric" maxLength={6} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} autoFocus />
      </Field>
    </Modal>
  );
}
