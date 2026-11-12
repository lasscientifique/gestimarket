// GestiMarket — codes du compte de la boutique envoyés sur WhatsApp (crochet « Send SMS » de Supabase Auth).
//
// Supabase Auth (fournisseur « Phone » : inscription, connexion par code, numéro changé) appelle cette fonction
// avec { user: { phone }, sms: { otp } }, signé selon Standard Webhooks. Elle envoie le modèle d'authentification
// de Meta (WhatsApp Cloud API) : « {code} est votre code de vérification » et le bouton « Copier le code ».
//
// Réglages :
//   - Authentication → Hooks → Send SMS : HTTPS, adresse …/functions/v1/gm-whatsapp, « Generate secret ».
//   - Secrets de la fonction (Edge Functions → Secrets), jamais dans le code ni dans une conversation :
//       SEND_SMS_HOOK_SECRET  le secret du crochet (« v1,whsec_… »)
//       WHATSAPP_TOKEN        jeton permanent d'un utilisateur système Meta (whatsapp_business_messaging)
//       WHATSAPP_PHONE_ID     identifiant du numéro d'envoi (WhatsApp Manager → Numéros de téléphone)
//       WHATSAPP_TEMPLATE     nom du modèle d'authentification (« gestimarket_code » par défaut)
//       WHATSAPP_LANG         langue du modèle (« fr » par défaut)
//   - Puis gm_config.whatsapp_enabled = 'true' : l'option apparaît dans GestiMarket.
import { Webhook } from "https://esm.sh/standardwebhooks@1.0.0";

const HOOK_SECRET = (Deno.env.get("SEND_SMS_HOOK_SECRET") ?? "").replace(/^v1,whsec_/, "");
const TOKEN = Deno.env.get("WHATSAPP_TOKEN") ?? "";
const PHONE_ID = Deno.env.get("WHATSAPP_PHONE_ID") ?? "";
const TEMPLATE = Deno.env.get("WHATSAPP_TEMPLATE") ?? "gestimarket_code";
const LANG = Deno.env.get("WHATSAPP_LANG") ?? "fr";
const GRAPH = "https://graph.facebook.com/v21.0";

/** Erreur rendue à Supabase Auth, qui la transmet telle quelle à GestiMarket. */
function fail(http_code: number, e: { message: string }) {
  return new Response(JSON.stringify({ error: { http_code, message: e.message } }), {
    status: http_code,
    headers: { "Content-Type": "application/json" },
  });
}

const NOT_READY = { message: "L'envoi des codes sur WhatsApp n'est pas encore prêt chez Eden Dev : utilisez votre e-mail." };
const NO_WHATSAPP = { message: "Ce numéro ne reçoit pas les messages WhatsApp : vérifiez-le, ou utilisez votre e-mail." };
const SEND_FAILED = { message: "Envoi du code sur WhatsApp impossible pour le moment : réessayez dans quelques minutes, ou utilisez votre e-mail." };

/** Erreurs de Meta qui désignent le destinataire : message non livrable (pas de WhatsApp…), numéro non autorisé
 *  (numéro de test), destinataire égal à l'expéditeur. */
const RECIPIENT_ERRORS = new Set([131026, 131030, 131021]);

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

  const r = await fetch(`${GRAPH}/${PHONE_ID}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: phone,
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
    }),
  }).catch(() => null);
  if (r?.ok) return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });

  const err = r ? await r.json().catch(() => ({})) : {};
  const code = Number(err?.error?.code ?? 0);
  // Journal de la fonction (Supabase → Edge Functions → Logs) : code et texte de Meta, sans le code envoyé.
  console.error("WhatsApp refusé", r?.status ?? "réseau", code, String(err?.error?.message ?? "").slice(0, 300));
  if (RECIPIENT_ERRORS.has(code)) return fail(400, NO_WHATSAPP);
  return fail(502, SEND_FAILED);
});
