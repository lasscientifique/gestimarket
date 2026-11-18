import { useEffect, useState } from "react";
import { Pencil, RefreshCw } from "lucide-react";
import type { Me } from "../App";
import { rpc } from "../lib/sb";
import { money } from "../lib/fmt";
import { ActionModal, Badge, ErrorBox, Spinner, Tabs, useLoad, useToast, type AskField } from "../ui";
import { MyFactors } from "./MyFactors";
import { UpdateTab } from "./UpdateTab";

type Cfg = {
  config: Record<string, string>;
  plans: { code: string; label: string; price_month: number; max_postes: number; active: boolean; description: string }[];
  whatsapp_ready: boolean;
  cinetpay?: { orders: number; success: number; last_error: string | null };
};

const GROUPS: { title: string; hint: string; keys: [string, string, AskField["type"]?][] }[] = [
  {
    title: "Orange Money (Sarali)",
    hint: "Affiché dans GestiMarket au moment de payer. Vide : Orange Money fermé.",
    keys: [["om_merchant_code", "Code marchand"], ["om_merchant_name", "Nom affiché"], ["om_qr_payload", "Contenu du QR marchand", "textarea"]],
  },
  {
    title: "Wave",
    hint: "Numéro marchand Wave d'Eden Dev. Vide : Wave fermé dans GestiMarket.",
    keys: [["wave_merchant_number", "Numéro marchand"], ["wave_merchant_name", "Nom affiché"]],
  },
  {
    title: "Moov Money",
    hint: "Numéro marchand Moov d'Eden Dev. Vide : Moov fermé dans GestiMarket.",
    keys: [["moov_merchant_number", "Numéro marchand"], ["moov_merchant_name", "Nom affiché"]],
  },
  {
    title: "CinetPay (paiement direct)",
    hint: "Orange Money, Moov Money et cartes, validés tout seuls. Ouvrez seulement quand le compte CinetPay existe et que ses secrets (CINETPAY_API_KEY, CINETPAY_API_PASSWORD, CINETPAY_ENV) sont dans Supabase.",
    keys: [["cinetpay_enabled", "Paiement direct dans GestiMarket et lien de paiement des cartes", "select"]],
  },
  {
    title: "Essai et services",
    hint: "Essai offert aux nouvelles boutiques ; ouverture de Visa et des codes WhatsApp.",
    keys: [
      ["trial_days", "Durée de l'essai (jours)", "number"],
      ["trial_plan", "Formule de l'essai", "select"],
      ["card_enabled", "Paiement par carte Visa", "select"],
      ["whatsapp_enabled", "Codes de connexion par WhatsApp", "select"],
      ["payment_instructions", "Texte d'aide au paiement", "textarea"],
    ],
  },
];

const yesNo = (v: string) => (v === "true" ? "ouvert" : "fermé");

type SettingsTab = "eden" | "securite" | "maj";
const tabOf = (t?: string): SettingsTab => (t === "maj" ? "maj" : t === "securite" ? "securite" : "eden");

/** Réglages : ceux d'Eden Dev (Direction), ma vérification à 2 étapes, mise à jour de la console. */
export function Settings({ me, tab }: { me: Me; tab?: string }) {
  const [t, setT] = useState<SettingsTab>(tabOf(tab));
  useEffect(() => setT(tabOf(tab)), [tab]);
  return (
    <div className="stack-lg">
      <Tabs
        value={t}
        onChange={setT}
        items={[
          ["eden", "Réglages d'Eden Dev"],
          ["securite", "Ma sécurité"],
          ["maj", "Mise à jour"],
        ]}
      />
      {t === "eden" && <EdenSettings me={me} />}
      {t === "securite" && <MyFactors />}
      {t === "maj" && <UpdateTab />}
    </div>
  );
}

function EdenSettings({ me }: { me: Me }) {
  const toast = useToast();
  const { data, error, busy, reload } = useLoad(() => rpc<Cfg>("gm_console_settings"), []);
  const [edit, setEdit] = useState<{ key: string; label: string; type?: AskField["type"] } | null>(null);
  const [plan, setPlan] = useState<Cfg["plans"][number] | null>(null);
  const isDir = me.role === "direction";
  if (error) return <ErrorBox error={error} retry={reload} />;
  if (!data) return <Spinner />;
  const c = data.config;
  const shown = (key: string) => {
    const v = c[key] ?? "";
    if (key === "card_enabled" || key === "whatsapp_enabled" || key === "cinetpay_enabled") return yesNo(v);
    if (key === "trial_plan") return v.toUpperCase();
    return v || <span className="muted">non réglé</span>;
  };
  const options = (key: string): [string, string][] =>
    key === "trial_plan"
      ? data.plans.filter((p) => p.code !== "free").map((p) => [p.code, p.label])
      : [["true", "Ouvert"], ["false", "Fermé"]];

  return (
    <div className="stack-lg">
      <div className="page-head">
        <p className="muted">{isDir ? "Réglages d'Eden Dev, sans passer par la base. Chaque changement est inscrit au journal." : "Réglages d'Eden Dev (modifiables par la Direction)."}</p>
        <button className="btn btn-sm" onClick={reload} disabled={busy}>
          <RefreshCw size={15} />
        </button>
      </div>
      {data.cinetpay && data.cinetpay.orders > 0 && (
        <p className="muted small">
          CinetPay : {data.cinetpay.orders} paiement(s) commencé(s), {data.cinetpay.success} réussi(s)
          {data.cinetpay.last_error ? ` · dernière erreur : ${data.cinetpay.last_error}` : ""}.
        </p>
      )}
      <div className="grid-2">
        {GROUPS.map((g) => (
          <section key={g.title} className="card">
            <h3 className="card-title">{g.title}</h3>
            <p className="muted small">{g.hint}</p>
            <dl className="kv">
              {g.keys.map(([k, label, type]) => (
                <div key={k}>
                  <dt>{label}</dt>
                  <dd>
                    <span className="break">{shown(k)}</span>
                    {isDir && (
                      <button className="icon-btn" aria-label={`Modifier ${label}`} onClick={() => setEdit({ key: k, label, type })}>
                        <Pencil size={14} />
                      </button>
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
        <section className="card">
          <h3 className="card-title">Formules et prix</h3>
          <p className="muted small">Prix par mois en FCFA. 12 mois = 10 mois payés.</p>
          <table className="table compact">
            <tbody>
              {data.plans
                .filter((p) => p.code !== "free")
                .map((p) => (
                  <tr key={p.code}>
                    <td>
                      <strong>{p.label}</strong> {!p.active && <Badge>inactive</Badge>}
                    </td>
                    <td className="num">{money(p.price_month)}</td>
                    <td className="num">{p.max_postes} poste(s)</td>
                    <td className="row-end">
                      {isDir && (
                        <button className="icon-btn" aria-label={`Modifier ${p.label}`} onClick={() => setPlan(p)}>
                          <Pencil size={14} />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </section>
        <section className="card">
          <h3 className="card-title">WhatsApp d'Eden Dev</h3>
          <p>
            Numéro : <strong>{c.whatsapp_number || "—"}</strong>{" "}
            {data.whatsapp_ready ? <Badge tone="success">messages reçus ce mois</Badge> : <Badge tone="warning">aucun message reçu depuis 30 jours</Badge>}
          </p>
          <p className="muted small">
            Sert aux codes de connexion et à l'envoi des cartes de bon. Adresse du premier administrateur de la console :{" "}
            {c.console_owner_email}.
          </p>
        </section>
      </div>
      {edit && (
        <ActionModal
          title={`Modifier : ${edit.label}`}
          fields={[{ key: "value", label: edit.label, type: edit.type === "select" ? "select" : edit.type, options: edit.type === "select" ? options(edit.key) : undefined, value: c[edit.key] ?? "" }]}
          confirm="Enregistrer"
          onClose={() => setEdit(null)}
          onSubmit={async (v, reason) => {
            await rpc("gm_console_setting_set", { p_key: edit.key, p_value: v.value, p_reason: reason });
            toast.ok("Réglage enregistré : GestiMarket le prend en compte à sa prochaine connexion.");
            reload();
          }}
        />
      )}
      {plan && (
        <ActionModal
          title={`Formule ${plan.label}`}
          intro="Le nouveau prix s'applique aux prochains paiements et aux nouvelles cartes."
          fields={[
            { key: "price", label: "Prix par mois (FCFA) *", type: "number", value: String(plan.price_month) },
            { key: "postes", label: "Nombre de postes *", type: "number", value: String(plan.max_postes) },
          ]}
          confirm="Enregistrer"
          onClose={() => setPlan(null)}
          onSubmit={async (v, reason) => {
            await rpc("gm_console_plan_set", { p_code: plan.code, p_price_month: Number(v.price), p_max_postes: Number(v.postes), p_reason: reason });
            toast.ok("Formule enregistrée.");
            reload();
          }}
        />
      )}
    </div>
  );
}
