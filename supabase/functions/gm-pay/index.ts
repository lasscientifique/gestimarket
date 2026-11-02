// GestiMarket — paiement des abonnements par carte Visa : Cybersource (Visa), page de paiement
// hébergée « Secure Acceptance Hosted Checkout ». Le numéro de carte ne passe jamais par Eden Dev.
//
// 1. GestiMarket : POST JSON { "pc_id", "plan", "months" }
//    → gm_card_start (abonnement et paiement « pending » de la boutique de ce PC)
//    → champs signés (HMAC-SHA256 avec la clé secrète du profil Secure Acceptance)
//    → { status: "ok", payment_id, amount, currency, plan_label, months, endpoint, fields }.
//    GestiMarket ouvre la page de paiement de Cybersource dans le navigateur (formulaire envoyé seul).
// 2. Cybersource : POST (formulaire) du résultat signé à override_backoffice_post_url (cette fonction)
//    → signature vérifiée → gm_card_result : ACCEPT au bon montant = abonnement activé ; REVIEW ou montant
//      inattendu = à vérifier par Eden Dev ; DECLINE, CANCEL, ERROR = refusé.
//
// Secrets (Edge Functions → Secrets) : CYBS_PROFILE_ID, CYBS_ACCESS_KEY, CYBS_SECRET_KEY et CYBS_ENV
// (« test » par défaut, « live » en production). Puis gm_config.card_enabled = 'true'.
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const sb = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});

const PROFILE_ID = Deno.env.get("CYBS_PROFILE_ID") ?? "";
const ACCESS_KEY = Deno.env.get("CYBS_ACCESS_KEY") ?? "";
const SECRET_KEY = Deno.env.get("CYBS_SECRET_KEY") ?? "";
const LIVE = (Deno.env.get("CYBS_ENV") ?? "test").trim().toLowerCase() === "live";
const ENDPOINT = LIVE ? "https://secureacceptance.cybersource.com/pay" : "https://testsecureacceptance.cybersource.com/pay";

const enc = new TextEncoder();
const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function text(body: string, status = 200) {
  return new Response(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });
}

/** Signature Secure Acceptance : HMAC-SHA256 de « nom=valeur,nom=valeur… » (ordre de signed_field_names), en base64. */
async function sign(fields: Record<string, string>): Promise<string> {
  const data = (fields.signed_field_names ?? "")
    .split(",")
    .map((n) => `${n}=${fields[n] ?? ""}`)
    .join(",");
  const key = await crypto.subtle.importKey("raw", enc.encode(SECRET_KEY), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64(new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(data))));
}

function sameText(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Champ de facturation prérempli (la cliente peut le corriger sur la page de paiement). */
const clean = (s: unknown, max: number) =>
  String(s ?? "").replace(/[<>"&,;=]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

async function start(req: Request): Promise<Response> {
  if (!PROFILE_ID || !ACCESS_KEY || !SECRET_KEY) {
    return json({ status: "error", message: "Le paiement par carte Visa n'est pas encore configuré chez Eden Dev : utilisez une carte de bon ou Orange Money." }, 503);
  }
  let body: { pc_id?: unknown; plan?: unknown; months?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    // refusé ci-dessous
  }
  const pc = String(body.pc_id ?? "").toUpperCase().replace(/[^0-9A-Z]/g, "");
  if (!/^[0-9A-Z]{12}$/.test(pc)) return json({ status: "error", message: "Identifiant de PC invalide." }, 400);

  const { data: s, error } = await sb.rpc("gm_card_start", { p_pc_id: pc, p_plan: String(body.plan ?? ""), p_months: Number(body.months) });
  if (error) return json({ status: "error", message: error.message }, 400);

  const owner = clean(s.store?.owner_name, 60).split(" ").filter(Boolean);
  const country = String(s.store?.country ?? "");
  const fields: Record<string, string> = {
    access_key: ACCESS_KEY,
    profile_id: PROFILE_ID,
    transaction_uuid: crypto.randomUUID(),
    signed_date_time: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    locale: "fr-fr",
    transaction_type: "sale",
    reference_number: s.payment_id,
    amount: String(s.amount),
    currency: s.currency,
    override_backoffice_post_url: `${SUPABASE_URL}/functions/v1/gm-pay`,
    bill_to_forename: owner[0] ?? "Client",
    bill_to_surname: owner.slice(1).join(" ") || owner[0] || "GestiMarket",
    bill_to_email: clean(s.store?.email, 100),
    bill_to_address_line1: clean(s.store?.address, 60) || "-",
    bill_to_address_city: clean(s.store?.city, 50) || "-",
    bill_to_address_country: /^[A-Z]{2}$/.test(country) && country !== "XX" ? country : "ML",
    unsigned_field_names: "",
  };
  fields.signed_field_names = [...Object.keys(fields), "signed_field_names"].join(",");
  fields.signature = await sign(fields);
  return json({
    status: "ok",
    payment_id: s.payment_id,
    amount: s.amount,
    currency: s.currency,
    plan_label: s.plan_label,
    months: s.months,
    endpoint: ENDPOINT,
    fields,
  });
}

/** Résultat envoyé par Cybersource (serveur à serveur), répété tant qu'il n'est pas accepté. */
async function notify(req: Request): Promise<Response> {
  const form = await req.formData();
  const f: Record<string, string> = {};
  for (const [k, v] of form.entries()) f[k] = String(v);
  if (!SECRET_KEY || !f.signature || !f.signed_field_names) return text("Signature manquante.", 400);
  const names = f.signed_field_names.split(",");
  for (const k of ["req_reference_number", "decision", "req_amount", "req_currency"]) {
    if (!names.includes(k)) return text(`Champ non signé : ${k}`, 400);
  }
  if (!sameText(await sign(f), f.signature)) return text("Signature invalide.", 403);
  if (!UUID.test(f.req_reference_number)) return text("Référence inconnue : ignorée.");

  const { data, error } = await sb.rpc("gm_card_result", {
    p_payment_id: f.req_reference_number,
    p_decision: f.decision,
    p_amount: Number(f.req_amount),
    p_currency: f.req_currency,
    p_transaction_id: f.transaction_id ?? "",
    p_message: [f.reason_code, f.message].filter(Boolean).join(" — "),
  });
  if (error) {
    console.error(error);
    return text("Erreur momentanée.", 500);
  }
  return text(data?.ok ? `OK ${data.status}` : `Ignoré : ${data?.error ?? ""}`);
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ status: "error", message: "Méthode POST attendue." }, 405);
  const type = req.headers.get("content-type") ?? "";
  try {
    return type.includes("application/x-www-form-urlencoded") || type.includes("multipart/form-data") ? await notify(req) : await start(req);
  } catch (e) {
    console.error(e);
    return json({ status: "error", message: "Service de paiement momentanément indisponible." }, 500);
  }
});
