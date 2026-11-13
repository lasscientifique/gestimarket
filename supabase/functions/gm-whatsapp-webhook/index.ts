// GestiMarket — notifications WhatsApp de Meta (webhook de l'app Meta « GestiMarket »).
//
// Sans entreprise vérifiée, le code part en message simple, permis seulement si la personne a écrit au numéro
// de GestiMarket dans les 24 heures. Meta accepte pourtant l'envoi hors de cette fenêtre, puis abandonne le
// message (erreur 131047 reçue ici, plus tard). Cette fonction :
//   - note l'heure du dernier message reçu de chaque numéro (gm_whatsapp_inbound) : gm-whatsapp n'envoie un
//     code que dans la fenêtre, sinon GestiMarket demande tout de suite d'écrire d'abord ;
//   - note les messages non remis et leur code d'erreur (gm_whatsapp_failed, et journal de la fonction).
// Aucun texte de message n'est gardé : seulement le numéro et l'heure.
//
// Réglages :
//   - App Meta → WhatsApp → Configuration → Webhook : URL de rappel …/functions/v1/gm-whatsapp-webhook,
//     jeton de vérification = secret WHATSAPP_VERIFY_TOKEN ; puis abonner le champ « messages ».
//   - Secrets de la fonction (Edge Functions → Secrets), jamais dans le code ni dans une conversation :
//       WHATSAPP_VERIFY_TOKEN  texte choisi par Eden Dev, tapé aussi chez Meta (vérification de l'adresse)
//       WHATSAPP_APP_SECRET    clé secrète de l'app Meta (Paramètres de l'app → Général) : signature des envois
//       WHATSAPP_PHONE_ID      (déjà là pour gm-whatsapp) : seules les notifications de ce numéro comptent
// Secrets lus à chaque appel : un secret ajouté ou changé compte tout de suite.
const env = (k: string) => (Deno.env.get(k) ?? "").trim();
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const enc = new TextEncoder();

function text(body: string, status = 200) {
  return new Response(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });
}

/** Comparaison en temps constant (signature, jeton). */
function same(a: string, b: string) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

/** En-tête X-Hub-Signature-256 = « sha256= » + HMAC-SHA256 du corps brut avec la clé secrète de l'app. */
async function signed(body: string, header: string | null, secret: string) {
  if (!header?.startsWith("sha256=")) return false;
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(body)));
  const hex = Array.from(mac, (b) => b.toString(16).padStart(2, "0")).join("");
  return same(hex, header.slice(7).toLowerCase());
}

async function rpc(name: string, args: Record<string, unknown>) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  if (!r.ok) throw new Error(`${name} ${r.status} ${(await r.text()).slice(0, 200)}`);
}

const digits = (v: unknown) => String(v ?? "").replace(/\D/g, "");
const when = (v: unknown) => {
  const s = Number(v);
  return new Date(Number.isFinite(s) && s > 0 ? s * 1000 : Date.now()).toISOString();
};

type Status = { status?: string; recipient_id?: string; errors?: { code?: number; title?: string; message?: string; error_data?: { details?: string } }[] };
type Value = {
  metadata?: { phone_number_id?: string };
  messages?: { from?: string; timestamp?: string }[];
  statuses?: Status[];
};
type MetaEvent = { object?: string; entry?: { changes?: { field?: string; value?: Value }[] }[] };

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const VERIFY_TOKEN = env("WHATSAPP_VERIFY_TOKEN");
  const APP_SECRET = env("WHATSAPP_APP_SECRET");
  const PHONE_ID = env("WHATSAPP_PHONE_ID");

  // Vérification de l'adresse par Meta (« Vérifier et enregistrer »).
  if (req.method === "GET") {
    const ok = VERIFY_TOKEN && url.searchParams.get("hub.mode") === "subscribe" &&
      same(url.searchParams.get("hub.verify_token") ?? "", VERIFY_TOKEN);
    return ok ? text(url.searchParams.get("hub.challenge") ?? "") : text("Jeton de vérification refusé.", 403);
  }
  if (req.method !== "POST") return text("Méthode non permise.", 405);

  const body = await req.text();
  if (!APP_SECRET) {
    console.error("WHATSAPP_APP_SECRET manquant : notification ignorée");
    return text("Pas prêt.", 503);
  }
  if (!(await signed(body, req.headers.get("x-hub-signature-256"), APP_SECRET))) return text("Signature invalide.", 401);

  let event: MetaEvent;
  try {
    event = JSON.parse(body);
  } catch {
    return text("JSON invalide.", 400);
  }
  if (event.object !== "whatsapp_business_account") return text("ok");

  const tasks: Promise<void>[] = [];
  for (const entry of event.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field !== "messages" || !change.value) continue;
      const v = change.value;
      // Autres numéros du compte (numéro de test de Meta…) : ignorés.
      if (PHONE_ID && v.metadata?.phone_number_id && v.metadata.phone_number_id !== PHONE_ID) continue;
      for (const m of v.messages ?? []) {
        const phone = digits(m.from);
        if (phone.length >= 8 && phone.length <= 15) tasks.push(rpc("gm_whatsapp_inbound", { p_phone: phone, p_at: when(m.timestamp) }));
      }
      for (const s of v.statuses ?? []) {
        if (s.status !== "failed") continue;
        const phone = digits(s.recipient_id);
        const e: NonNullable<Status["errors"]>[number] = s.errors?.[0] ?? {};
        const why = String(e.error_data?.details ?? e.message ?? e.title ?? "").slice(0, 300);
        // Journal de la fonction (Supabase → Edge Functions → gm-whatsapp-webhook → Logs), sans le texte envoyé.
        console.error("WhatsApp non remis", `${phone.slice(0, 3)}…${phone.slice(-2)}`, e.code ?? 0, why);
        if (phone.length >= 8 && phone.length <= 15) tasks.push(rpc("gm_whatsapp_failed", { p_phone: phone, p_code: Number(e.code ?? 0), p_error: why }));
      }
    }
  }
  const failed = (await Promise.allSettled(tasks)).filter((t) => t.status === "rejected");
  if (failed.length) {
    console.error("Notification WhatsApp non enregistrée", String((failed[0] as PromiseRejectedResult).reason).slice(0, 300));
    return text("Erreur d'enregistrement.", 500); // Meta renvoie la notification plus tard.
  }
  return text("ok");
});
