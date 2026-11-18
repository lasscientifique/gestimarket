// GestiMarket — cartes de bon et messages aux clients envoyés par WhatsApp (Console Eden Dev 1.0 et 1.1).
//
// POST { "action": "flush", "phone"?: "22370000000" } — sans compte : la fonction n'envoie que ce qui est dû.
//   1. Ventes « en attente » (gm_console_card_sell) dont le client a écrit à Eden Dev dans les 24 heures :
//      la carte est fabriquée maintenant (gm_card_sale_issue), son code part sur WhatsApp et n'est gardé nulle part.
//      Meta refuse l'envoi : la carte fabriquée est annulée ; fenêtre de 24 heures fermée : la vente attend
//      le prochain message du client (gm-whatsapp-webhook rappelle cette fonction).
//   2. Messages aux clients (Console 1.1) : carte annulée (avec la raison), lien de paiement CinetPay. Même règle :
//      envoyés dès que le destinataire a écrit dans les 24 heures (gm_wa_notices).
//   3. Cartes vendues par WhatsApp et utilisées : « Abonnement PRO actif jusqu'au … » (appel de la base, pg_net).
// Appelée par la console après une vente, par gm-whatsapp-webhook quand un client écrit, et par la base.
//
// Secrets (déjà là pour gm-whatsapp) : WHATSAPP_TOKEN, WHATSAPP_PHONE_ID.
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const env = (k: string) => (Deno.env.get(k) ?? "").trim();
const GRAPH = "https://graph.facebook.com/v21.0";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  if (!r.ok) throw new Error(`${name} ${r.status} ${(await r.text()).slice(0, 200)}`);
  return (await r.json().catch(() => null)) as T;
}

type Issued = {
  ok: boolean;
  phone: string;
  name: string;
  serial: string;
  code: string;
  plan_label: string;
  months: number;
  store_code: string | null;
  store_name: string | null;
  /** « Annuler et renvoyer » : numéro de la carte annulée que celle-ci remplace. */
  replaces: string | null;
};
type Notice = { id: string; phone: string; body: string };
type Confirm = { phone: string; store_code: string; store_name: string; plan_label: string | null; ends_at: string | null };
type Sent = { ok: true; id: string } | { ok: false; code: number; error: string; retry: boolean };

/** Erreurs de Meta après lesquelles la vente attend le prochain message du client (ou un nouvel essai). */
const WINDOW_CLOSED = 131047;
const RETRY = new Set([WINDOW_CLOSED, 130429, 131016, 131048, 131056, 133004]);

async function send(to: string, body: string): Promise<Sent> {
  const r = await fetch(`${GRAPH}/${env("WHATSAPP_PHONE_ID")}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env("WHATSAPP_TOKEN")}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to, type: "text", text: { preview_url: false, body } }),
  }).catch(() => null);
  if (!r) return { ok: false, code: 0, error: "Meta injoignable", retry: true };
  const data = await r.json().catch(() => ({}));
  if (r.ok && data?.messages?.[0]?.id) return { ok: true, id: String(data.messages[0].id) };
  const code = Number(data?.error?.code ?? 0);
  const error = String(data?.error?.error_data?.details ?? data?.error?.message ?? `HTTP ${r.status}`).slice(0, 250);
  return { ok: false, code, error, retry: RETRY.has(code) || r.status >= 500 };
}

const months = (n: number) => (n === 12 ? "12 mois (2 offerts)" : `${n} mois`);
const day = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" }) : "";

function cardText(c: Issued) {
  const hello = c.name ? `Bonjour ${c.name},` : "Bonjour,";
  return [
    "GestiMarket · Eden Dev",
    "",
    `${hello} voici votre carte de bon ${c.plan_label} ${months(c.months)} :`,
    "",
    `*${c.code}*`,
    `(carte n° ${c.serial})`,
    "",
    "Dans GestiMarket : Abonnement & licence → Payer ou renouveler → Carte de bon, puis tapez le code.",
    ...(c.store_code ? [`Carte réservée à la boutique ${c.store_code}${c.store_name ? ` (${c.store_name})` : ""}.`] : []),
    ...(c.replaces ? [`Elle remplace la carte n° ${c.replaces} (annulée).`] : []),
    "",
    "Utilisable une seule fois. Ne la donnez à personne, pas même à quelqu'un qui dit venir d'Eden Dev.",
  ].join("\n");
}

function confirmText(c: Confirm) {
  return [
    "GestiMarket · Eden Dev",
    "",
    c.plan_label && c.ends_at
      ? `Merci ! Votre abonnement ${c.plan_label} est actif jusqu'au ${day(c.ends_at)} (boutique ${c.store_code}).`
      : `Merci ! Votre carte a bien été activée (boutique ${c.store_code}).`,
    "Le PC de la boutique reçoit sa licence tout seul. Une question ? Répondez à ce message.",
  ].join("\n");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "Méthode POST attendue." }, 405);
  let body: { action?: unknown; phone?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    // corps vide : simple envoi de ce qui est dû
  }
  if ((body.action ?? "flush") !== "flush") return json({ ok: false, error: "Action inconnue." }, 400);
  if (!env("WHATSAPP_TOKEN") || !env("WHATSAPP_PHONE_ID")) {
    return json({ ok: false, error: "L'envoi WhatsApp n'est pas réglé chez Eden Dev (secrets WHATSAPP_TOKEN, WHATSAPP_PHONE_ID)." }, 503);
  }
  const phone = String(body.phone ?? "").replace(/\D/g, "");

  try {
    const sent: { id: string; status: string; error?: string }[] = [];
    const ids = await rpc<string[]>("gm_card_sales_claim", { p_phone: phone.length >= 8 ? phone : null });
    for (const id of ids ?? []) {
      const card = await rpc<Issued>("gm_card_sale_issue", { p_sale_id: id });
      if (!card?.ok) continue;
      const r = await send(card.phone, cardText(card));
      if (r.ok) {
        await rpc("gm_card_sale_sent", { p_sale_id: id, p_message_id: r.id });
        sent.push({ id, status: "sent" });
      } else {
        // Le client n'a pas reçu ce code : la carte est annulée (une nouvelle sera fabriquée au prochain envoi).
        console.error("Carte non envoyée", `${card.phone.slice(0, 3)}…${card.phone.slice(-2)}`, r.code, r.error);
        await rpc("gm_card_sale_failed", { p_sale_id: id, p_code: r.code, p_error: r.error, p_retry: r.retry });
        sent.push({ id, status: r.retry ? "waiting" : "failed", error: r.error });
      }
    }
    // Messages aux clients : carte annulée, lien de paiement.
    const notices = (await rpc<Notice[]>("gm_wa_notices_claim", { p_phone: phone.length >= 8 ? phone : null })) ?? [];
    for (const n of notices) {
      const r = await send(n.phone, n.body);
      if (r.ok) {
        await rpc("gm_wa_notice_sent", { p_id: n.id, p_message_id: r.id });
      } else {
        console.error("Message au client non envoyé", `${n.phone.slice(0, 3)}…${n.phone.slice(-2)}`, r.code, r.error);
        await rpc("gm_wa_notice_failed", { p_id: n.id, p_code: r.code, p_error: r.error, p_retry: r.retry });
      }
    }
    const confirms = (await rpc<Confirm[]>("gm_card_confirm_claim", {})) ?? [];
    for (const c of confirms) {
      const r = await send(c.phone, confirmText(c));
      if (!r.ok) console.error("Confirmation non envoyée", r.code, r.error);
    }
    return json({ ok: true, sent, notices: notices.length, confirmed: confirms.length });
  } catch (e) {
    console.error(e);
    return json({ ok: false, error: "Envoi des cartes momentanément indisponible." }, 500);
  }
});
