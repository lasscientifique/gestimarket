// GestiMarket — codes du compte de la boutique envoyés sur WhatsApp (crochet « Send SMS » de Supabase Auth).
//
// Supabase Auth (fournisseur « Phone » : inscription, connexion par code, numéro changé) appelle cette fonction
// avec { user: { phone }, sms: { otp } }, signé selon Standard Webhooks. Elle envoie le code par la WhatsApp
// Cloud API de Meta :
//   - en message simple (par défaut) : sans entreprise vérifiée, Meta ne remet le message que si la personne
//     a écrit à GestiMarket dans les 24 heures (GestiMarket affiche « Écrire à GestiMarket » avant le code).
//     Meta accepte l'envoi même hors de cette fenêtre puis l'abandonne sans le dire ici : la fonction
//     gm-whatsapp-webhook note donc l'heure du dernier message reçu de chaque numéro, et le code n'est envoyé
//     que dans la fenêtre (sinon « Écrivez d'abord… » tout de suite) ;
//   - avec le modèle d'authentification WHATSAPP_TEMPLATE, s'il est défini (entreprise vérifiée par Meta) :
//     le code part sans que la personne écrive d'abord.
//
// Réglages :
//   - Authentication → Hooks → Send SMS : HTTPS, adresse …/functions/v1/gm-whatsapp, « Generate secret ».
//   - Secrets de la fonction (Edge Functions → Secrets), jamais dans le code ni dans une conversation :
//       SEND_SMS_HOOK_SECRET  le secret du crochet (« v1,whsec_… »)
//       WHATSAPP_TOKEN        jeton permanent d'un utilisateur système Meta (whatsapp_business_messaging)
//       WHATSAPP_PHONE_ID     identifiant du numéro d'envoi (WhatsApp Manager → Numéros de téléphone)
//       WHATSAPP_TEMPLATE     facultatif : nom du modèle d'authentification approuvé (ex. « gestimarket_code »)
//       WHATSAPP_LANG         langue du modèle (« fr » par défaut)
//   - Puis gm_config : whatsapp_number = le numéro d'envoi (+223…), whatsapp_enabled = 'true'.
import { Webhook } from "https://esm.sh/standardwebhooks@1.0.0";

const HOOK_SECRET = (Deno.env.get("SEND_SMS_HOOK_SECRET") ?? "").replace(/^v1,whsec_/, "");
const TOKEN = Deno.env.get("WHATSAPP_TOKEN") ?? "";
const PHONE_ID = Deno.env.get("WHATSAPP_PHONE_ID") ?? "";
const TEMPLATE = (Deno.env.get("WHATSAPP_TEMPLATE") ?? "").trim();
const LANG = Deno.env.get("WHATSAPP_LANG") ?? "fr";
const GRAPH = "https://graph.facebook.com/v21.0";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

/** Fonction SQL réservée aux fonctions (service_role) : fenêtre de 24 h, messages non remis. */
async function rpc(name: string, args: Record<string, unknown>) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  if (!r.ok) throw new Error(`${name} ${r.status} ${(await r.text()).slice(0, 200)}`);
  return await r.json().catch(() => null);
}

/** Erreur rendue à Supabase Auth, qui la transmet telle quelle à GestiMarket (avec le code http_code).
 *  La réponse HTTP reste 200 : sur un 400, Supabase Auth ignore le corps (« Invalid payload sent to hook ») ;
 *  sur un 429 ou un 503, il rappelle la fonction. */
function fail(http_code: number, e: { message: string }) {
  return new Response(JSON.stringify({ error: { http_code, message: e.message } }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

const NOT_READY = { message: "L'envoi des codes sur WhatsApp n'est pas encore prêt chez Eden Dev : utilisez votre e-mail." };
const NO_WHATSAPP = { message: "Ce numéro ne reçoit pas les messages WhatsApp : vérifiez-le, ou utilisez votre e-mail." };
const WRITE_FIRST = {
  message: "Écrivez d'abord « GestiMarket » à GestiMarket sur WhatsApp (bouton « Écrire à GestiMarket »), puis redemandez le code.",
};
const SEND_FAILED = { message: "Envoi du code sur WhatsApp impossible pour le moment : réessayez dans quelques minutes, ou utilisez votre e-mail." };

/** Erreurs de Meta qui désignent le destinataire : message non livrable (pas de WhatsApp…), numéro non autorisé
 *  (numéro de test), destinataire égal à l'expéditeur. */
const RECIPIENT_ERRORS = new Set([131026, 131030, 131021]);
/** Plus de 24 heures depuis le dernier message de la personne : un message simple n'est pas permis. */
const WINDOW_CLOSED = 131047;

/** Message envoyé : modèle d'authentification (entreprise vérifiée) ou message simple dans la fenêtre de 24 h. */
function message(to: string, otp: string) {
  if (TEMPLATE) {
    return {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "template",
      template: {
        name: TEMPLATE,
        language: { code: LANG },
        components: [
          { type: "body", parameters: [{ type: "text", text: otp }] },
          // Bouton « Copier le code » des modèles d'authentification.
          { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: otp }] },
        ],
      },
    };
  }
  return {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "text",
    text: {
      preview_url: false,
      body: `GestiMarket : votre code est ${otp}\n\nTapez-le dans GestiMarket. Il est valable 10 minutes.\nNe le donnez à personne, pas même à quelqu'un qui dit venir d'Eden Dev.`,
    },
  };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return fail(405, NOT_READY);
  const payload = await req.text();
  if (!HOOK_SECRET) return fail(503, NOT_READY);
  let data: { user?: { phone?: string }; sms?: { otp?: string } };
  try {
    data = new Webhook(HOOK_SECRET).verify(payload, Object.fromEntries(req.headers)) as typeof data;
  } catch {
    return fail(401, { message: "Signature du crochet invalide." });
  }
  const phone = String(data.user?.phone ?? "").replace(/\D/g, "");
  const otp = String(data.sms?.otp ?? "");
  if (phone.length < 8 || !/^\d{4,10}$/.test(otp)) return fail(400, NO_WHATSAPP);
  if (!TOKEN || !PHONE_ID) return fail(503, NOT_READY);

  // Message simple : seulement si la personne a écrit dans les 24 heures (notifications de Meta). Si la base
  // ne répond pas, le code part quand même : Meta le remettra si la fenêtre est ouverte.
  if (!TEMPLATE) {
    const open = await rpc("gm_whatsapp_window_open", { p_phone: phone }).catch((e) => {
      console.error("Fenêtre WhatsApp non vérifiée", String(e).slice(0, 300));
      return true;
    });
    if (open === false) return fail(400, WRITE_FIRST);
  }

  const r = await fetch(`${GRAPH}/${PHONE_ID}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(message(phone, otp)),
  }).catch(() => null);
  if (r?.ok) return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });

  const err = r ? await r.json().catch(() => ({})) : {};
  const code = Number(err?.error?.code ?? 0);
  // Journal de la fonction (Supabase → Edge Functions → Logs) : code et texte de Meta, sans le code envoyé.
  const why = String(err?.error?.message ?? "").slice(0, 300);
  console.error("WhatsApp refusé", r?.status ?? "réseau", code, why);
  if (code) await rpc("gm_whatsapp_failed", { p_phone: phone, p_code: code, p_error: why }).catch(() => null);
  if (code === WINDOW_CLOSED) return fail(400, WRITE_FIRST);
  if (RECIPIENT_ERRORS.has(code)) return fail(400, NO_WHATSAPP);
  return fail(502, SEND_FAILED);
});
