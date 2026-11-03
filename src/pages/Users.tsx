import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Pencil, KeyRound, Smartphone, Lock, Unlock, History, Trash2, Printer, Copy, RefreshCw, Globe } from "lucide-react";
import { api } from "../api";
import { useApp } from "../context/AppContext";
import { Badge, Empty, Field, Modal, PageHeader } from "../components/ui";
import { dateTime, ROLE_LABELS } from "../lib/format";
import { formatCode, printAccessSheets, type AccessSheet } from "../lib/staffPrint";
import type { AccessCode, Role, TrustedDevice, User } from "../types";
import { tl } from "../lib/i18n";

const ROLE_HELP: Record<Role, string> = {
  admin: tl("Contrôle total : tableau de bord, rapports, personnel, paramètres et réglages, annulation des ventes, paiements mobiles, journal d'activité. Valide les actions des autres avec son code PIN."),
  manager: tl("Gestion des produits : ajout, modification, suppression, catégories, emplacements, plan de la boutique, stock, achats et fournisseurs."),
  cashier: tl("Vente uniquement : caisse, clients, recherche de produits, ses propres ventes et sa session de caisse."),
};

const digits = (v: string, max = 6) => v.replace(/\D/g, "").slice(0, max);

/**
 * Personnel : chaque poste a un identifiant et un code PIN (pas de mot de passe, pas de compte en ligne).
 * L'administrateur crée les postes, donne les PIN, bloque, autorise l'accès Internet (code d'accès
 * téléphone), retire les téléphones et supprime les comptes.
 */
export default function UsersPage() {
  const { toast, confirm, askPin, settings, user: me } = useApp();
  const navigate = useNavigate();
  const [list, setList] = useState<User[]>([]);
  const [devices, setDevices] = useState<TrustedDevice[]>([]);
  const [editing, setEditing] = useState<User | { role: Role } | null>(null);
  const [pinFor, setPinFor] = useState<User | null>(null);
  const [code, setCode] = useState<AccessCode & { role: Role } | null>(null);
  const [sheet, setSheet] = useState<AccessSheet | null>(null);

  const load = useCallback(() => {
    api.listUsers().then(setList).catch(toast.error);
    api.listDevices().then(setDevices).catch(() => setDevices([]));
  }, [toast]);
  useEffect(() => {
    load();
  }, [load]);

  const toggleBlock = async (u: User) => {
    try {
      const pin = await askPin({ title: u.active ? tl("Bloquer {0}", [u.full_name]) : tl("Débloquer {0}", [u.full_name]), level: "admin" });
      if (!pin) return;
      await api.saveUser(u.id, { full_name: u.full_name, role: u.role, active: !u.active, internet_access: u.internet_access }, pin);
      toast.success(u.active ? tl("Compte bloqué : la personne est déconnectée.") : tl("Compte débloqué."));
      load();
    } catch (e) {
      toast.error(e);
    }
  };

  const remove = async (u: User) => {
    const ok = await confirm({
      title: tl("Supprimer {0} ?", [u.full_name]),
      message: tl("La personne ne pourra plus se connecter et ses téléphones sont retirés. Si elle a déjà travaillé, son nom reste dans l'historique (ventes, caisses, journal)."),
      confirmLabel: tl("Supprimer"),
      danger: true,
    });
    if (!ok) return;
    try {
      const pin = await askPin({ title: tl("Supprimer {0}", [u.full_name]), level: "admin" });
      if (!pin) return;
      const r = await api.deleteUser(u.id, pin);
      toast.success(r.erased ? tl("Compte effacé.") : tl("Compte supprimé (son nom reste dans l'historique)."));
      load();
    } catch (e) {
      toast.error(e);
    }
  };

  const accessCode = async (u: User) => {
    try {
      const pin = await askPin({ title: tl("Code d'accès téléphone — {0}", [u.full_name]), level: "admin" });
      if (!pin) return;
      const c = await api.createAccessCode(u.id, pin);
      setCode({ ...c, role: u.role });
      load();
    } catch (e) {
      toast.error(e);
    }
  };

  const revoke = async (d: TrustedDevice) => {
    const ok = await confirm({
      title: tl("Retirer « {0} » ?", [d.label]),
      message: tl("Ce téléphone ne pourra plus se connecter depuis Internet ; sa session en cours est fermée. Il faudra un nouveau code d'accès pour l'autoriser de nouveau."),
      confirmLabel: tl("Retirer"),
      danger: true,
    });
    if (!ok) return;
    try {
      await api.revokeDevice(d.id);
      toast.success(tl("Téléphone retiré."));
      load();
    } catch (e) {
      toast.error(e);
    }
  };

  return (
    <div className="page">
      <PageHeader
        help="users"
        title={tl("Personnel")}
        subtitle={tl("Chaque poste a un identifiant et un code PIN. Vous gérez les postes, les codes, le blocage et l'accès Internet.")}
        actions={
          <>
            <button className="btn" onClick={() => setEditing({ role: "manager" })}><Plus size={16} />  {tl("Gestionnaire")}</button>
            <button className="btn btn-primary" onClick={() => setEditing({ role: "cashier" })}><Plus size={16} />  {tl("Caissière")}</button>
          </>
        }
      />
      <div className="card no-pad">
        <table className="table staff-table">
          <thead>
            <tr><th>{tl("Nom")}</th><th>{tl("Identifiant")}</th><th>{tl("Poste")}</th><th>{tl("Statut")}</th><th>{tl("Internet")}</th><th>{tl("Dernière connexion")}</th><th></th></tr>
          </thead>
          <tbody>
            {list.map((u) => (
              <tr key={u.id} className={!u.active ? "row-cancelled" : ""}>
                <td><strong>{u.full_name}</strong> {u.id === me?.id && <Badge tone="info">{tl("vous")}</Badge>}</td>
                <td className="mono">{u.username}</td>
                <td><Badge tone={u.role === "admin" ? "danger" : u.role === "manager" ? "warning" : "default"}>{ROLE_LABELS[u.role]}</Badge></td>
                <td>
                  {!u.active ? <Badge>{tl("Bloqué")}</Badge> : u.has_pin ? <Badge tone="success">{tl("Actif")}</Badge> : <Badge tone="warning">{tl("PIN à donner")}</Badge>}
                </td>
                <td>
                  {u.internet_access ? (
                    <Badge tone="info"><Globe size={12} /> {u.devices > 0 ? tl("{0} téléphone(s)", [u.devices]) : tl("Autorisé")}</Badge>
                  ) : (
                    <span className="muted small">{tl("Non")}</span>
                  )}
                </td>
                <td>{dateTime(u.last_login_at)}</td>
                <td className="actions">
                  <button className="icon-btn" title={tl("Modifier")} onClick={() => setEditing(u)}><Pencil size={16} /></button>
                  <button className="icon-btn" title={tl("Nouveau code PIN")} onClick={() => setPinFor(u)}><KeyRound size={16} /></button>
                  <button className="icon-btn" title={tl("Code d'accès téléphone (Internet)")} disabled={!u.active} onClick={() => accessCode(u)}><Smartphone size={16} /></button>
                  {u.id !== me?.id && (
                    <button className="icon-btn" title={u.active ? tl("Bloquer") : tl("Débloquer")} onClick={() => toggleBlock(u)}>
                      {u.active ? <Lock size={16} /> : <Unlock size={16} />}
                    </button>
                  )}
                  <button className="icon-btn" title={tl("Voir ses actions")} onClick={() => navigate(`/audit?user=${u.id}&name=${encodeURIComponent(u.full_name)}`)}><History size={16} /></button>
                  {u.id !== me?.id && (
                    <button className="icon-btn danger" title={tl("Supprimer")} onClick={() => remove(u)}><Trash2 size={16} /></button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <div className="card-head">
          <h3><Smartphone size={17} /> {tl("Téléphones autorisés (accès depuis Internet)")}</h3>
        </div>
        <p className="muted small">
          {tl("Au magasin, aucun téléphone n'a besoin d'être autorisé. Depuis Internet, un téléphone l'est une fois : par le compte boutique (votre téléphone) ou par un code d'accès que vous donnez à une personne (icône téléphone ci-dessus).")}
        </p>
        {devices.length === 0 ? (
          <Empty title={tl("Aucun téléphone autorisé")} />
        ) : (
          <table className="table">
            <thead><tr><th>{tl("Téléphone")}</th><th>{tl("Pour")}</th><th>{tl("Autorisé le")}</th><th>{tl("Dernière utilisation")}</th><th></th></tr></thead>
            <tbody>
              {devices.map((d) => (
                <tr key={d.id}>
                  <td><strong>{d.label}</strong></td>
                  <td>{d.user_name ?? <span className="muted">{tl("Compte boutique — tout le personnel autorisé")}</span>}</td>
                  <td>{dateTime(d.created_at)}</td>
                  <td>{dateTime(d.last_used_at)}</td>
                  <td className="actions"><button className="btn btn-sm" onClick={() => revoke(d)}>{tl("Retirer")}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {editing && (
        <StaffForm
          user={"id" in editing ? editing : null}
          role={editing.role}
          onClose={() => setEditing(null)}
          onSaved={(s) => {
            setEditing(null);
            load();
            if (s) setSheet(s);
          }}
        />
      )}
      {pinFor && (
        <NewPinForm
          user={pinFor}
          onClose={() => setPinFor(null)}
          onSaved={(s) => {
            setPinFor(null);
            load();
            setSheet(s);
          }}
        />
      )}
      {code && (
        <Modal
          title={tl("Code d'accès téléphone — {0}", [code.full_name])}
          onClose={() => setCode(null)}
          width={460}
          footer={
            <>
              <button className="btn" onClick={() => navigator.clipboard?.writeText(formatCode(code.code)).then(() => toast.success(tl("Code copié.")))}><Copy size={15} />  {tl("Copier")}</button>
              <button className="btn" onClick={() => printAccessSheets(settings, [{ ...code, role: code.role }])}><Printer size={15} />  {tl("Imprimer")}</button>
              <button className="btn btn-primary" onClick={() => setCode(null)}>{tl("Terminé")}</button>
            </>
          }
        >
          <div className="access-code">{formatCode(code.code)}</div>
          <p className="muted small center">{tl("Valable une seule fois, pour un téléphone, jusqu'au {0}.", [dateTime(code.expires_at)])}</p>
          <ol className="steps small">
            <li>{tl("Transmettez ce code à {0} (de vive voix, par SMS ou WhatsApp).", [code.full_name])}</li>
            <li>{tl("Sur son téléphone, hors du magasin : ouvrir GestiMarket → « Code d'accès ».")}</li>
            <li>{tl("Taper son identifiant ({0}), son code PIN et ce code.", [code.username])}</li>
            <li>{tl("Ensuite, identifiant et code PIN suffisent sur ce téléphone. Vous pouvez le retirer à tout moment.")}</li>
          </ol>
        </Modal>
      )}
      {sheet && (
        <Modal
          title={tl("Fiche d'accès — {0}", [sheet.full_name])}
          onClose={() => setSheet(null)}
          width={420}
          footer={
            <>
              <button className="btn" onClick={() => printAccessSheets(settings, [sheet])}><Printer size={15} />  {tl("Imprimer la fiche")}</button>
              <button className="btn btn-primary" onClick={() => setSheet(null)}>{tl("Terminé")}</button>
            </>
          }
        >
          <div className="access-sheet-view">
            <div><span className="muted">{tl("Identifiant")}</span><strong className="mono">{sheet.username}</strong></div>
            {sheet.pin && <div><span className="muted">{tl("Code PIN")}</span><strong className="mono">{sheet.pin}</strong></div>}
          </div>
          <p className="muted small">{tl("Remettez-lui ces informations en main propre. Le code PIN ne sera plus affiché ; la personne peut le changer (menu Mon code PIN).")}</p>
        </Modal>
      )}
    </div>
  );
}

function StaffForm({ user, role, onClose, onSaved }: { user: User | null; role: Role; onClose: () => void; onSaved: (sheet: AccessSheet | null) => void }) {
  const { toast, askPin } = useApp();
  const [f, setF] = useState({
    full_name: user?.full_name ?? "",
    username: user?.username ?? "",
    role: (user?.role ?? role) as Role,
    active: user?.active ?? true,
    internet_access: user?.internet_access ?? false,
    pin: "",
  });
  const [busy, setBusy] = useState(false);
  const promoted = !!user && user.role !== "admin" && f.role === "admin";

  // Nouveau poste : identifiant et PIN proposés (modifiables).
  useEffect(() => {
    if (user) return;
    api.suggestStaff(f.role).then((s) => setF((x) => ({ ...x, username: s.username, pin: s.pin }))).catch(() => undefined);
  }, [user, f.role]);

  const regenerate = () => api.suggestStaff(f.role).then((s) => setF((x) => ({ ...x, pin: s.pin }))).catch(toast.error);
  const pinLen = f.role === "admin" ? 6 : 4;

  const submit = async () => {
    setBusy(true);
    try {
      const admin = await askPin({ title: user ? tl("Modifier le poste") : tl("Créer le poste"), level: "admin" });
      if (!admin) return;
      await api.saveUser(
        user?.id ?? null,
        {
          username: f.username,
          full_name: f.full_name,
          role: f.role,
          active: f.active,
          internet_access: f.internet_access,
          ...(!user || promoted ? { pin: f.pin } : {}),
        },
        admin,
      );
      toast.success(user ? tl("Poste enregistré.") : tl("Poste créé."));
      onSaved(!user || promoted ? { full_name: f.full_name, role: f.role, username: f.username.trim().toLowerCase(), pin: f.pin } : null);
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={user ? tl("Modifier — {0}", [user.full_name]) : f.role === "manager" ? tl("Nouveau gestionnaire") : f.role === "admin" ? tl("Nouvel administrateur") : tl("Nouvelle caissière")}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>{tl("Annuler")}</button>
          <button className="btn btn-primary" disabled={busy || !f.full_name.trim() || !f.username.trim() || ((!user || promoted) && f.pin.length < pinLen)} onClick={submit}>
            {tl("Enregistrer")}</button>
        </>
      }
    >
      <div className="form-grid">
        <Field label={tl("Nom *")}><input value={f.full_name} onChange={(e) => setF({ ...f, full_name: e.target.value })} autoFocus /></Field>
        <Field label={tl("Identifiant de connexion *")} hint={tl("Lettres sans accent, chiffres, « . » « _ » « - »")}>
          <input className="mono" value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} autoCapitalize="none" />
        </Field>
        <Field label={tl("Poste")} span={2} hint={ROLE_HELP[f.role]}>
          <select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as Role })}>
            {(Object.keys(ROLE_LABELS) as Role[]).map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
          </select>
        </Field>
        {(!user || promoted) && (
          <Field label={f.role === "admin" ? tl("Code PIN (6 chiffres)") : tl("Code PIN (4 à 6 chiffres)")} hint={tl("Proposé au hasard : gardez-le ou tapez-en un autre. La personne pourra le changer.")}>
            <div className="input-with-btn">
              <input className="pin-input mono" inputMode="numeric" value={f.pin} onChange={(e) => setF({ ...f, pin: digits(e.target.value) })} />
              <button type="button" className="btn" title={tl("Autre code")} onClick={regenerate}><RefreshCw size={15} /></button>
            </div>
          </Field>
        )}
        <label className="check span-2">
          <input type="checkbox" checked={f.internet_access} onChange={(e) => setF({ ...f, internet_access: e.target.checked })} />
          {tl("Accès depuis Internet (téléphone autorisé par un code d'accès)")}
        </label>
        {user && (
          <label className="check span-2">
            <input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} />
            {tl("Compte actif (décochez pour bloquer)")}
          </label>
        )}
      </div>
    </Modal>
  );
}

function NewPinForm({ user, onClose, onSaved }: { user: User; onClose: () => void; onSaved: (sheet: AccessSheet) => void }) {
  const { toast, askPin } = useApp();
  const [pin, setPin] = useState("");
  const len = user.role === "admin" ? 6 : 4;
  const regenerate = useCallback(() => api.suggestStaff(user.role).then((s) => setPin(s.pin)).catch(toast.error), [user.role, toast]);
  useEffect(() => {
    regenerate();
  }, [regenerate]);
  const submit = async () => {
    try {
      const admin = await askPin({ title: tl("Nouveau code PIN — {0}", [user.full_name]), level: "admin" });
      if (!admin) return;
      await api.resetUserPin(user.id, pin, admin);
      toast.success(tl("Nouveau code PIN enregistré."));
      onSaved({ full_name: user.full_name, role: user.role, username: user.username, pin });
    } catch (e) {
      toast.error(e);
    }
  };
  return (
    <Modal
      title={tl("Nouveau code PIN — {0}", [user.full_name])}
      onClose={onClose}
      width={420}
      footer={<><button className="btn" onClick={onClose}>{tl("Annuler")}</button><button className="btn btn-primary" disabled={pin.length < len} onClick={submit}>{tl("Enregistrer")}</button></>}
    >
      <Field
        label={user.role === "admin" ? tl("Nouveau code PIN (6 chiffres)") : tl("Nouveau code PIN (4 à 6 chiffres)")}
        hint={tl("Proposé au hasard : gardez-le ou tapez-en un autre. Communiquez-le à la personne, qui pourra le changer.")}
      >
        <div className="input-with-btn">
          <input className="input-lg pin-input mono" inputMode="numeric" value={pin} onChange={(e) => setPin(digits(e.target.value))} autoFocus />
          <button type="button" className="btn" title={tl("Autre code")} onClick={regenerate}><RefreshCw size={15} /></button>
        </div>
      </Field>
    </Modal>
  );
}
