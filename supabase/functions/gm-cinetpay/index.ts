// GestiMarket — paiement direct par CinetPay (Orange Money, Moov Money, carte bancaire), API REST de CinetPay (2026).
//
// Fermé tant que gm_config.cinetpay_enabled ≠ 'true' (Console Eden Dev → Réglages → Paiements).
// Secrets (Edge Functions → Secrets), mis par Eden Dev, jamais dans le code ni dans une conversation :
//   CINETPAY_API_KEY, CINETPAY_API_PASSWORD  identifiants d'API du compte marchand (un compte = un pays : le Mali)
//   CINETPAY_ENV                              « sandbox » (essai, par défaut) ou « production »
//
// POST JSON :
//   { action: "start", pc_id, plan, months }          GestiMarket sur PC (boutique de ce PC)
//   { action: "start", store_code, plan, months }     téléphone (Authorization: Bearer <session du compte boutique>)
//     → { status: "ok", payment_id, payment_url, amount, currency, plan_label, months }
//   { action: "sale_link", sale_id, device }          Console Eden Dev (Authorization: Bearer <session administrateur>) :
//     lien de paiement d'une carte vendue → { status: "ok", payment_url, window_open } ; il part aussi au client sur WhatsApp
//   { action: "check", payment_id }                   état d'un paiement relu chez CinetPay (sans compte)
//   { action: "sweep" }                               commandes ouvertes relues chez CinetPay (pg_cron, toutes les 10 minutes)
//   Notification de CinetPay : { notify_token, merchant_transaction_id, transaction_id, … } (JSON ou formulaire)
//     → jeton comparé à l'empreinte gardée à l'ouverture, puis état relu chez CinetPay (GET /v1/payment/{commande}) :
//       seul cet état compte, jamais celui du message.
// Paiement réussi : abonnement activé (la licence part toute seule) ou carte de bon envoyée au client (gm-cartes).
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const env = (k: string) => (Deno.env.get(k) ?? "").trim();
const base = () => (env("CINETPAY_ENV").toLowerCase() === "production" ? "https://api.cinetpay.co" : "https://api.cinetpay.net");
/** Page de retour après le paiement (site d'Eden Dev, GitHub Pages). */
const RETURN_PAGE = "https://lasscientifique.github.io/gestimarket/paiement/";
const NOT_READY = "Le paiement direct (CinetPay) n'est pas encore prêt chez Eden Dev : utilisez une carte de bon ou déclarez votre paiement mobile.";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

class Refused extends Error {}

/** Fonction de la base : avec la clé de service, ou au nom de la personne connectée (console). */
async function rpc<T>(name: string, args: Record<string, unknown>, jwt?: string): Promise<T> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: {
      apikey: jwt ? ANON_KEY : SERVICE_KEY,
      Authorization: `Bearer ${jwt ?? SERVICE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(args),
  });
  const data = await r.json().catch(() => null);
  if (!r.ok) {
    // Message de la base (exception en français) : montré tel quel à la personne.
    if (data?.message && r.status < 500) throw new Refused(String(data.message));
    throw new Error(`${name} ${r.status} ${JSON.stringify(data).slice(0, 200)}`);
  }
  return data as T;
}

async function sha256(s: string) {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
  return Array.from(d, (b) => b.toString(16).padStart(2, "0")).join("");
}

function same(a: string, b: string) {
  if (!a || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

// ───────────────────────────── API de CinetPay ─────────────────────────────

let token: { value: string; until: number } | null = null;

async function cpLogin(): Promise<string> {
  const r = await fetch(`${base()}/v1/oauth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ api_key: env("CINETPAY_API_KEY"), api_password: env("CINETPAY_API_PASSWORD") }),
    signal: AbortSignal.timeout(15000),
  });
  const d = await r.json().catch(() => ({}));
  const t = String(d?.access_token ?? d?.data?.token ?? d?.data?.access_token ?? "");
  if (!r.ok || !t) throw new Error(`Connexion à CinetPay refusée (${d?.status ?? r.status})`);
  const exp = Number(d?.expires_in ?? d?.data?.expires_in ?? 300);
  token = { value: t, until: Date.now() + Math.max(30, exp - 30) * 1000 };
  return t;
}

// deno-lint-ignore no-explicit-any
async function cp(method: string, path: string, body?: unknown, retry = true): Promise<any> {
  const t = token && token.until > Date.now() ? token.value : await cpLogin();
  const r = await fetch(`${base()}${path}`, {
    method,
    headers: { Accept: "application/json", "Content-Type": "application/json", Authorization: `Bearer ${t}` },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  const d = await r.json().catch(() => ({}));
  const st = String(d?.status ?? "");
  if (retry && (r.status === 401 || st === "INVALID_TOKEN" || st === "EXPIRED_TOKEN")) {
    token = null;
    return cp(method, path, body, false);
  }
  if (!r.ok) throw new Refused(String(d?.description ?? d?.message ?? st ?? `HTTP ${r.status}`).slice(0, 250));
  return d;
}

type Order = {
  order_id: string;
  amount: number;
  currency: string;
  designation: string;
  first_name: string;
  last_name: string;
  email: string;
  phone?: string;
};

const person = (s: unknown, fallback: string) => {
  const v = String(s ?? "").replace(/[<>"&;=]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
  return v.length >= 2 ? v : fallback;
};

/** Ouvre le paiement chez CinetPay : adresse de la page de paiement (gardée), empreinte du jeton de notification. */
async function open(o: Order): Promise<string> {
  const email = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(o.email ?? "") ? o.email : "no-reply@gestimarket.shop";
  const phone = String(o.phone ?? "").replace(/\D/g, "");
  try {
    const d = await cp("POST", "/v1/payment", {
      currency: o.currency || "XOF",
      merchant_transaction_id: o.order_id,
      amount: o.amount,
      success_url: `${RETURN_PAGE}?r=ok`,
      failed_url: `${RETURN_PAGE}?r=ko`,
      notify_url: `${SUPABASE_URL}/functions/v1/gm-cinetpay`,
      lang: "fr",
      designation: o.designation.slice(0, 120),
      client_first_name: person(o.first_name, "Client"),
      client_last_name: person(o.last_name, "GestiMarket"),
      client_email: email,
      // Compte CinetPay du Mali : seul un numéro malien (+223) est accepté.
      ...(phone.startsWith("223") && phone.length === 11 ? { client_phone_number: `+${phone}` } : {}),
      direct_pay: false,
    });
    const url = String(d?.payment_url ?? d?.data?.payment_url ?? "");
    if (!/^https:\/\//.test(url)) throw new Refused(String(d?.details?.message ?? d?.description ?? d?.status ?? "réponse sans adresse de paiement"));
    const notify = String(d?.notify_token ?? d?.data?.notify_token ?? "");
    await rpc("gm_cinetpay_opened", {
      p_order_id: o.order_id,
      p_transaction_id: String(d?.transaction_id ?? d?.data?.transaction_id ?? ""),
      p_notify_hash: notify ? await sha256(notify) : "",
      p_payment_url: url,
    });
    return url;
  } catch (e) {
    const why = e instanceof Refused ? e.message : "CinetPay injoignable";
    console.error("Paiement CinetPay non ouvert", o.order_id, String(e).slice(0, 300));
    await rpc("gm_cinetpay_init_failed", { p_order_id: o.order_id, p_error: why }).catch(() => null);
    throw new Refused(`CinetPay n'a pas pu ouvrir le paiement (${why}) : réessayez plus tard, ou utilisez une carte de bon.`);
  }
}

/** État relu chez CinetPay, puis appliqué (gm_cinetpay_result). */
async function check(orderId: string): Promise<string> {
  const d = await cp("GET", `/v1/payment/${encodeURIComponent(orderId)}`);
  const merchant = String(d?.merchant_transaction_id ?? d?.data?.merchant_transaction_id ?? "");
  if (merchant && merchant !== orderId) throw new Error(`Commande différente dans la réponse de CinetPay : ${merchant}`);
  const amount = Number(d?.amount ?? d?.data?.amount ?? d?.details?.amount ?? NaN);
  const r = await rpc<{ status?: string }>("gm_cinetpay_result", {
    p_order_id: orderId,
    p_cp_status: String(d?.status ?? d?.data?.status ?? ""),
    p_transaction_id: String(d?.transaction_id ?? d?.data?.transaction_id ?? ""),
    p_amount: Number.isFinite(amount) ? amount : null,
    p_currency: String(d?.currency ?? d?.data?.currency ?? ""),
  });
  return String(r?.status ?? "");
}

// ───────────────────────────── Appels ─────────────────────────────

const ready = () => !!(env("CINETPAY_API_KEY") && env("CINETPAY_API_PASSWORD"));

async function userId(jwt: string): Promise<string | null> {
  if (!jwt) return null;
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: ANON_KEY, Authorization: `Bearer ${jwt}` } }).catch(() => null);
  if (!r?.ok) return null;
  const u = await r.json().catch(() => null);
  return typeof u?.id === "string" ? u.id : null;
}

// deno-lint-ignore no-explicit-any
async function start(body: any, jwt: string) {
  if (!ready()) return json({ status: "error", message: NOT_READY }, 503);
  const plan = String(body.plan ?? "");
  const months = Number(body.months);
  // deno-lint-ignore no-explicit-any
  let s: any;
  if (body.store_code != null) {
    const uid = await userId(jwt);
    if (!uid) return json({ status: "error", message: "Connectez-vous à votre compte boutique." }, 401);
    s = await rpc("gm_cinetpay_start_owner", { p_uid: uid, p_store_code: String(body.store_code), p_plan: plan, p_months: months });
  } else {
    const pc = String(body.pc_id ?? "").toUpperCase().replace(/[^0-9A-Z]/g, "");
    if (!/^[0-9A-Z]{12}$/.test(pc)) return json({ status: "error", message: "Identifiant de PC invalide." }, 400);
    s = await rpc("gm_cinetpay_start_pc", { p_pc_id: pc, p_plan: plan, p_months: months });
  }
  const url = await open(s as Order);
  return json({
    status: "ok", payment_id: s.payment_id, payment_url: url, amount: s.amount, currency: s.currency,
    plan_label: s.plan_label, months: s.months,
  });
}

// deno-lint-ignore no-explicit-any
async function saleLink(body: any, jwt: string) {
  if (!ready()) return json({ status: "error", message: "Secrets CinetPay absents (CINETPAY_API_KEY, CINETPAY_API_PASSWORD)." }, 503);
  if (!jwt) return json({ status: "error", message: "Connectez-vous à la console." }, 401);
  // Vérifications de la console (administrateur, 2 étapes, appareil autorisé, rôle) : faites par la base, au nom de la personne.
  const o = await rpc<Order>("gm_console_card_pay_link", { p_device: String(body.device ?? ""), p_sale_id: String(body.sale_id ?? "") }, jwt);
  const url = await open(o);
  const sent = await rpc<{ window_open?: boolean }>("gm_cinetpay_sale_link_ready", { p_order_id: o.order_id });
  return json({ status: "ok", payment_url: url, window_open: !!sent?.window_open });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return new Response("GestiMarket · CinetPay", { headers: { ...CORS, "Content-Type": "text/plain; charset=utf-8" } });
  const raw = await req.text();
  // deno-lint-ignore no-explicit-any
  let body: any = {};
  try {
    body = (req.headers.get("content-type") ?? "").includes("application/x-www-form-urlencoded")
      ? Object.fromEntries(new URLSearchParams(raw))
      : JSON.parse(raw || "{}");
  } catch {
    return json({ status: "error", message: "Requête illisible." }, 400);
  }
  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");

  try {
    // Notification de CinetPay.
    if (body?.notify_token && body?.merchant_transaction_id) {
      const id = String(body.merchant_transaction_id);
      const o = await rpc<{ notify_hash?: string } | null>("gm_cinetpay_order_get", { p_order_id: id });
      if (!o) return json({ status: "ignored" });
      if (!o.notify_hash || !same(await sha256(String(body.notify_token)), o.notify_hash)) {
        console.error("Notification CinetPay refusée (jeton)", id);
        return json({ status: "error" }, 401);
      }
      return json({ status: "ok", state: await check(id) });
    }
    switch (String(body?.action ?? "")) {
      case "start":
        return await start(body, jwt);
      case "sale_link":
        return await saleLink(body, jwt);
      case "check": {
        if (!ready()) return json({ status: "error", message: NOT_READY }, 503);
        const id = await rpc<string | null>("gm_cinetpay_order_of_payment", { p_payment_id: String(body.payment_id ?? "") });
        if (!id) return json({ status: "error", message: "Paiement CinetPay inconnu." }, 404);
        return json({ status: "ok", state: await check(id) });
      }
      case "sweep": {
        if (!ready()) return json({ status: "ok", checked: 0 });
        const ids = (await rpc<string[]>("gm_cinetpay_due", {})) ?? [];
        let checked = 0;
        for (const id of ids) {
          await check(id).then(() => checked++, (e) => console.error("Commande CinetPay non vérifiée", id, String(e).slice(0, 200)));
        }
        return json({ status: "ok", checked });
      }
      default:
        return json({ status: "error", message: "Action inconnue." }, 400);
    }
  } catch (e) {
    if (e instanceof Refused) return json({ status: "error", message: e.message }, 400);
    console.error(e);
    return json({ status: "error", message: "Paiement direct momentanément indisponible : réessayez dans quelques minutes." }, 500);
  }
});
