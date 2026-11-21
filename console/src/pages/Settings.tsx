import { useEffect, useState } from "react";
import { Pencil, RefreshCw } from "lucide-react";
import type { Me } from "../App";
import { cardStatus, rpc } from "../lib/sb";
import { money } from "../lib/fmt";
import { ActionModal, Badge, ErrorBox, Spinner, Tabs, useLoad, useToast, type AskField } from "../ui";
import { MyFactors } from "./MyFactors";
import { UpdateTab } from "./UpdateTab";

type Cfg = {
  config: Record<string, string>;
  plans: { code: string; label: string; price_month: number; max_postes: number; active: boolean; description: string }[];
  whatsapp_ready: boolean;
  cinetpay?: { orders: number; success: number; last_error: string | null };
  card?: { test_payments: number; test_accepted: number; real_accepted: number };
  pispi?: { declared: number; validated: number };
};

const GROUPS: { title: string; hint: string; keys: [string, string, AskField["type"]?][] }[] = [
  {
    title: "Orange Money (Sarali)",
    hint: "Affiché dans GestiMarket au moment de payer. Vide : Orange Money fermé.",
    keys: [["om_merchant_code", "Code marchand"], ["om_merchant_name", "Nom affiché"], ["om_qr_payload", "Contenu du QR marchand", "textarea"]],
  },
  {
    title: "PI-SPI (BCEAO)",
    hint:
      "Compte PI-SPI d'Eden Dev (Orange Money, banque…) : PI-SPI → Détails du compte. Les boutiques paient depuis n'importe quelle banque ou portefeuille de l'UEMOA (QR avec le montant exact), puis « J'ai payé » ; vous validez dans Paiements. Alias vide : PI-SPI fermé.",
    keys: [["pispi_alias", "Alias PI-SPI (36 caractères)"], ["pispi_name", "Nom affiché"], ["pispi_phone", "Numéro PI-SPI (facultatif)"]],
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
    title: "Carte bancaire (Visa, Mastercard)",
    hint: "Cybersource. Essai : les boutiques d'essai seulement, cartes de test, aucun argent. Ouvrir à toutes les boutiques seulement avec le profil réel (CYBS_ENV = live).",
    keys: [
      ["card_test_stores", "Boutiques d'essai (codes GM-…, séparés par des virgules)"],
      ["card_enabled", "Ouverte à toutes les boutiques", "select"],
    ],
  },
  {
    title: "Essai et services",
    hint: "Essai offert aux nouvelles boutiques ; ouverture des codes WhatsApp.",
    keys: [
      ["trial_days", "Durée de l'essai (jours)", "number"],
      ["trial_plan", "Formule de l'essai", "select"],
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
  // État de la carte chez Cybersource (clés en place, essai ou réel) : lu dans « gm-pay », sans les clés.
  const [card, setCard] = useState<{ configured: boolean; mode: "test" | "live" } | "erreur" | null>(null);
  useEffect(() => {
    cardStatus().then(setCard).catch(() => setCard("erreur"));
  }, []);
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
    if (key === "card_test_stores") return v ? v.split(",").join(", ") : <span className="muted">aucune</span>;
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
      {data.pispi && data.pispi.declared + data.pispi.validated > 0 && (
        <p className="muted small">
          PI-SPI : {data.pispi.declared} paiement(s) à valider, {data.pispi.validated} validé(s).
        </p>
      )}
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
            {g.keys.some(([k]) => k === "card_enabled") && <CardState card={card} open={c.card_enabled === "true"} stats={data.card} />}
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
          intro={
            edit.key === "card_enabled" && card !== "erreur" && card?.mode === "test"
              ? "Cybersource est en mode essai : même ouverte, la carte reste refusée aux boutiques hors de la liste d'essai. Ouvrez-la à toutes seulement avec le profil réel."
              : edit.key === "card_test_stores"
                ? "Vos boutiques d'essai (par exemple GM-000001). Elles voient la carte même fermée. Videz la liste après les essais."
                : undefined
          }
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

/** Carte bancaire : clés Cybersource, mode essai ou réel, et paiements par carte déjà faits. */
function CardState({
  card,
  open,
  stats,
}: {
  card: { configured: boolean; mode: "test" | "live" } | "erreur" | null;
  open: boolean;
  stats?: Cfg["card"];
}) {
  if (card === null) return <p className="muted small">Cybersource : vérification…</p>;
  if (card === "erreur") return <p className="muted small">Cybersource : état indisponible pour l'instant.</p>;
  return (
    <div className="stack">
      <p className="small">
        Cybersource :{" "}
        {card.configured ? <Badge tone="success">clés en place</Badge> : <Badge tone="warning">clés absentes de Supabase</Badge>}{" "}
        {card.mode === "live" ? <Badge tone="success">profil réel</Badge> : <Badge>mode essai</Badge>}
        {stats && ` · ${stats.test_payments} paiement(s) d'essai, dont ${stats.test_accepted} accepté(s) ; ${stats.real_accepted} paiement(s) réel(s) accepté(s).`}
      </p>
      {open && card.mode === "test" && (
        <p className="small">
          <Badge tone="danger">attention</Badge> Carte ouverte à toutes les boutiques alors que Cybersource est en mode essai : les autres
          boutiques sont refusées. Fermez-la, ou passez au profil réel.
        </p>
      )}
    </div>
  );
}
