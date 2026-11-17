import { useState } from "react";
import { Check, MonitorSmartphone, RefreshCw, ShieldCheck, ShieldOff, UserPlus, Users } from "lucide-react";
import type { Me } from "../App";
import { rpc } from "../lib/sb";
import { ago, dateOnly, ROLE } from "../lib/fmt";
import { ActionModal, Badge, Empty, ErrorBox, Spinner, useLoad, useToast, type AskField } from "../ui";

type Admin = { user_id: string; email: string; name: string; role: string; role_label: string; active: boolean; created_at: string; me: boolean; devices: number; mfa: boolean };
type Device = {
  id: string; email: string; name: string; role: string; label: string; platform: string; app_version: string; status: string;
  created_at: string; approved_at: string | null; last_seen: string | null; mine: boolean;
};

const ROLES: [string, string][] = [
  ["paiements", "Paiements : valider les paiements, vendre et gérer les cartes"],
  ["assistance", "Assistance : boutiques, licences, gestes de 7 jours au plus"],
  ["direction", "Direction : tout, équipe, réglages"],
];

export function Team({ me }: { me: Me }) {
  const toast = useToast();
  const isDir = me.role === "direction";
  const admins = useLoad(() => (isDir ? rpc<Admin[]>("gm_console_admins") : Promise.resolve([] as Admin[])), [isDir]);
  const devices = useLoad(() => rpc<Device[]>("gm_console_devices"), []);
  const [edit, setEdit] = useState<{ title: string; fields: AskField[]; active: boolean } | null>(null);
  const [dev, setDev] = useState<{ d: Device; status: "approved" | "revoked" } | null>(null);

  const memberFields = (a?: Admin): AskField[] => [
    { key: "email", label: "E-mail du compte *", value: a?.email ?? "", hint: a ? undefined : "La personne crée d'abord son compte dans la console (« Créer mon compte »)." },
    { key: "name", label: "Nom", value: a?.name ?? "" },
    { key: "role", label: "Rôle *", type: "select", options: ROLES, value: a?.role ?? "paiements" },
  ];

  return (
    <div className="stack-lg">
      {isDir && (
        <section className="card">
          <div className="card-head">
            <h3 className="card-title">
              <Users size={18} /> Équipe Eden Dev
            </h3>
            <div className="row">
              <button className="btn btn-sm" onClick={admins.reload} aria-label="Actualiser">
                <RefreshCw size={14} />
              </button>
              <button className="btn btn-sm btn-primary" onClick={() => setEdit({ title: "Ajouter un membre", fields: memberFields(), active: true })}>
                <UserPlus size={14} /> Ajouter un membre
              </button>
            </div>
          </div>
          {admins.error && <ErrorBox error={admins.error} retry={admins.reload} />}
          {!admins.data ? (
            <Spinner />
          ) : (
            <div className="table-scroll">
              <table className="table">
                <thead>
                  <tr>
                    <th>Membre</th>
                    <th>Rôle</th>
                    <th>2 étapes</th>
                    <th className="num">Appareils</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {admins.data.map((a) => (
                    <tr key={a.user_id} className={a.active ? "" : "muted"}>
                      <td>
                        <strong>{a.name || a.email}</strong> {a.me && <Badge tone="info">vous</Badge>} {!a.active && <Badge tone="danger">désactivé</Badge>}
                        <div className="muted small">
                          {a.email} · depuis le {dateOnly(a.created_at)}
                        </div>
                      </td>
                      <td>{a.role_label}</td>
                      <td>{a.mfa ? <Badge tone="success">activée</Badge> : <Badge tone="warning">à la 1re connexion</Badge>}</td>
                      <td className="num">{a.devices}</td>
                      <td className="row-end">
                        {!a.me && (
                          <>
                            <button className="btn btn-sm" onClick={() => setEdit({ title: `Modifier ${a.email}`, fields: memberFields(a), active: a.active })}>
                              Rôle
                            </button>
                            <button
                              className={`btn btn-sm ${a.active ? "btn-danger-outline" : ""}`}
                              onClick={() => setEdit({ title: a.active ? `Désactiver ${a.email}` : `Réactiver ${a.email}`, fields: memberFields(a), active: !a.active })}
                            >
                              {a.active ? "Désactiver" : "Réactiver"}
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      <section className="card">
        <div className="card-head">
          <h3 className="card-title">
            <MonitorSmartphone size={18} /> {isDir ? "Appareils autorisés" : "Mes appareils"}
          </h3>
          <button className="btn btn-sm" onClick={devices.reload} aria-label="Actualiser">
            <RefreshCw size={14} />
          </button>
        </div>
        <p className="muted small">
          Chaque nouvel appareil (PC ou téléphone) doit être autorisé une fois par la Direction. Un appareil perdu se retire ici.
        </p>
        {devices.error && <ErrorBox error={devices.error} retry={devices.reload} />}
        {!devices.data ? (
          <Spinner />
        ) : !devices.data.length ? (
          <Empty>Aucun appareil.</Empty>
        ) : (
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Appareil</th>
                  {isDir && <th>Membre</th>}
                  <th>État</th>
                  <th>Vu</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {devices.data.map((d) => (
                  <tr key={d.id}>
                    <td>
                      <strong>{d.label || "Appareil"}</strong> {d.mine && <Badge tone="info">celui-ci</Badge>}
                      <div className="muted small">
                        {d.platform} · console {d.app_version || "?"} · ajouté le {dateOnly(d.created_at)}
                      </div>
                    </td>
                    {isDir && (
                      <td>
                        {d.email}
                        <div className="muted small">{ROLE[d.role] ?? d.role}</div>
                      </td>
                    )}
                    <td>
                      <Badge tone={d.status === "approved" ? "success" : d.status === "pending" ? "warning" : "danger"}>
                        {d.status === "approved" ? "autorisé" : d.status === "pending" ? "en attente" : "retiré"}
                      </Badge>
                    </td>
                    <td className="small">{ago(d.last_seen)}</td>
                    <td className="row-end">
                      {isDir && d.status !== "approved" && (
                        <button className="btn btn-sm btn-primary" onClick={() => setDev({ d, status: "approved" })}>
                          <Check size={14} /> Autoriser
                        </button>
                      )}
                      {d.status !== "revoked" && !d.mine && (
                        <button className="btn btn-sm btn-danger-outline" onClick={() => setDev({ d, status: "revoked" })}>
                          <ShieldOff size={14} /> Retirer
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card">
        <h3 className="card-title">
          <ShieldCheck size={18} /> Sécurité de la console
        </h3>
        <ul className="bullets small">
          <li>Connexion : mot de passe + code Google Authenticator, sur un appareil autorisé.</li>
          <li>Déconnexion après 30 minutes sans activité.</li>
          <li>Chaque action est inscrite au journal, qui ne s'efface pas.</li>
          <li>La console ne voit jamais les ventes, produits, stocks ni clients des boutiques.</li>
        </ul>
      </section>

      {edit && (
        <ActionModal
          title={edit.title}
          fields={edit.fields}
          confirm="Enregistrer"
          danger={!edit.active}
          onClose={() => setEdit(null)}
          onSubmit={async (v, reason) => {
            await rpc("gm_console_admin_set", { p_email: v.email, p_role: v.role, p_active: edit.active, p_name: v.name, p_reason: reason });
            toast.ok("Équipe mise à jour.");
            admins.reload();
            devices.reload();
          }}
        />
      )}
      {dev && (
        <ActionModal
          title={dev.status === "approved" ? `Autoriser « ${dev.d.label} »` : `Retirer « ${dev.d.label} »`}
          intro={dev.status === "approved" ? `Appareil de ${dev.d.email}. Autorisez-le seulement si cette personne vient de vous le demander.` : "Cet appareil ne pourra plus ouvrir la console."}
          confirm={dev.status === "approved" ? "Autoriser" : "Retirer"}
          danger={dev.status === "revoked"}
          onClose={() => setDev(null)}
          onSubmit={async (_v, reason) => {
            await rpc("gm_console_device_set", { p_id: dev.d.id, p_status: dev.status, p_reason: reason });
            toast.ok(dev.status === "approved" ? "Appareil autorisé." : "Appareil retiré.");
            devices.reload();
          }}
        />
      )}
    </div>
  );
}
