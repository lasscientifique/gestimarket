// GestiMarket — adresse Internet automatique d'une boutique (tunnel Cloudflare géré par Eden Dev).
//
// GestiMarket (PC serveur) : POST JSON { "store_code", "port" } avec « Authorization: Bearer <session du
// compte boutique> » (l'administrateur tape l'e-mail et le mot de passe du compte boutique une fois).
//   → tunnel « gm-000123 » créé une seule fois dans le compte Cloudflare d'Eden Dev
//   → adresse https://gm-000123.<TUNNEL_DOMAIN> reliée à http://localhost:<port> du PC
//   → { status: "ok", url, hostname, token } : GestiMarket lance cloudflared avec ce jeton.
// Le jeton n'est jamais enregistré chez Eden Dev ; le redemander redonne le même tunnel et la même adresse.
//
// Secret (Edge Functions → Secrets) : CF_API_TOKEN, jeton Cloudflare avec les droits « Cloudflare Tunnel : Edit »
// (compte), « Zone : Read » et « DNS : Edit » (domaine). Domaine : secret TUNNEL_DOMAIN, sinon gm_config.tunnel_domain
// (ex. « gestimarket.shop »). Compte et zone : secrets CF_ACCOUNT_ID et CF_ZONE_ID, sinon retrouvés par le domaine.
import { createClient } from "npm:@supabase/supabase-js@2";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});

let CF_TOKEN = "";
let ACCOUNT = Deno.env.get("CF_ACCOUNT_ID") ?? "";
let ZONE = Deno.env.get("CF_ZONE_ID") ?? "";
let DOMAIN = Deno.env.get("TUNNEL_DOMAIN") ?? "";
const CF = "https://api.cloudflare.com/client/v4";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/** Appel de l'API Cloudflare : renvoie « result », ou lève une erreur lisible. */
async function cf(path: string, init: RequestInit = {}) {
  const r = await fetch(CF + path, {
    ...init,
    headers: { Authorization: `Bearer ${CF_TOKEN}`, "Content-Type": "application/json" },
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.success === false) {
    const why = (j.errors ?? []).map((e: { message?: string }) => e.message).filter(Boolean).join(", ");
    throw new Error(`Cloudflare ${r.status}${why ? ` : ${why}` : ""}`);
  }
  return j.result;
}

const NOT_OPEN = "L'adresse Internet automatique n'est pas encore ouverte chez Eden Dev : utilisez une adresse publique saisie à la main.";

/** Jeton Cloudflare, relu à chaque appel : un secret posé après le démarrage de la fonction est pris tout de suite. */
function readToken(): string {
  CF_TOKEN = (Deno.env.get("CF_API_TOKEN") ?? "").trim();
  if (!CF_TOKEN) {
    try {
      // Noms seulement (jamais les valeurs), pour repérer un secret mal nommé dans les journaux.
      const all = Object.keys(Deno.env.toObject());
      const names = all.filter((k) => !k.startsWith("SUPABASE") && !k.startsWith("DENO") && !k.startsWith("SB_"));
      console.warn(`CF_API_TOKEN absent ; ${all.length} variables, secrets du projet : ${names.join(", ") || "aucun"}`);
    } catch {
      // lecture de l'environnement refusée
    }
  }
  return CF_TOKEN;
}

/** Domaine, compte et zone Cloudflare (gardés tant que la fonction reste chargée). Retourne un motif s'il manque quelque chose. */
async function configure(): Promise<string | null> {
  if (!DOMAIN) {
    const { data } = await sb.from("gm_config").select("value").eq("key", "tunnel_domain").maybeSingle();
    DOMAIN = String(data?.value ?? "");
  }
  DOMAIN = DOMAIN.trim().toLowerCase().replace(/^\.+|\.+$/g, "");
  if (!CF_TOKEN || !DOMAIN) return NOT_OPEN;
  if (!ZONE || !ACCOUNT) {
    const zones = await cf(`/zones?name=${encodeURIComponent(DOMAIN)}`);
    const zone = Array.isArray(zones) ? zones[0] : null;
    if (!zone) return `Le domaine ${DOMAIN} n'est pas dans le compte Cloudflare d'Eden Dev (ou le jeton n'a pas le droit « Zone : Read »).`;
    if (zone.status !== "active") {
      return `Le domaine ${DOMAIN} n'est pas encore actif chez Cloudflare : ses serveurs DNS doivent être ceux de Cloudflare chez le vendeur du domaine.`;
    }
    ZONE ||= zone.id;
    ACCOUNT ||= zone.account?.id ?? "";
  }
  return null;
}

/** Tunnel de la boutique : celui déjà enregistré s'il existe encore, sinon par son nom, sinon créé. */
async function tunnelId(known: string | null, name: string): Promise<string> {
  if (known) {
    try {
      const t = await cf(`/accounts/${ACCOUNT}/cfd_tunnel/${known}`);
      if (t && !t.deleted_at) return known;
    } catch {
      // supprimé côté Cloudflare : recréé ci-dessous
    }
  }
  const found = await cf(`/accounts/${ACCOUNT}/cfd_tunnel?name=${encodeURIComponent(name)}&is_deleted=false`);
  if (Array.isArray(found) && found[0]?.id) return found[0].id;
  const secret = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
  const created = await cf(`/accounts/${ACCOUNT}/cfd_tunnel`, {
    method: "POST",
    body: JSON.stringify({ name, config_src: "cloudflare", tunnel_secret: secret }),
  });
  return created.id;
}

/** Nom DNS de la boutique → tunnel (CNAME proxifié), créé ou corrigé. */
async function pointDns(hostname: string, id: string, code: string) {
  const target = `${id}.cfargotunnel.com`;
  const records = await cf(`/zones/${ZONE}/dns_records?name=${encodeURIComponent(hostname)}`);
  const rec = Array.isArray(records) ? records[0] : null;
  if (!rec) {
    await cf(`/zones/${ZONE}/dns_records`, {
      method: "POST",
      body: JSON.stringify({ type: "CNAME", name: hostname, content: target, proxied: true, comment: `GestiMarket ${code}` }),
    });
  } else if (rec.type !== "CNAME" || rec.content !== target || !rec.proxied) {
    await cf(`/zones/${ZONE}/dns_records/${rec.id}`, {
      method: "PUT",
      body: JSON.stringify({ type: "CNAME", name: hostname, content: target, proxied: true, comment: `GestiMarket ${code}` }),
    });
  }
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ status: "error", message: "Méthode POST attendue." }, 405);
  if (!readToken()) return json({ status: "error", message: NOT_OPEN }, 503);
  try {
    const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data: u } = jwt ? await sb.auth.getUser(jwt) : { data: { user: null } };
    if (!u?.user) return json({ status: "error", message: "Connectez-vous à votre compte boutique." }, 401);
    const notReady = await configure();
    if (notReady) return json({ status: "error", message: notReady }, 503);

    let body: { store_code?: unknown; port?: unknown } = {};
    try {
      body = await req.json();
    } catch {
      // refusé ci-dessous
    }
    const port = Number(body.port);
    if (!Number.isInteger(port) || port < 1024 || port > 65535) {
      return json({ status: "error", message: "Port du serveur invalide." }, 400);
    }
    const { data: t, error } = await sb.rpc("gm_tunnel_target", { p_uid: u.user.id, p_store_code: String(body.store_code ?? "") });
    if (error) return json({ status: "error", message: error.message }, 400);

    const name = String(t.code).toLowerCase().replace(/[^a-z0-9-]/g, "");
    const hostname = `${name}.${DOMAIN}`;
    const id = await tunnelId(t.tunnel_id ?? null, name);
    await cf(`/accounts/${ACCOUNT}/cfd_tunnel/${id}/configurations`, {
      method: "PUT",
      body: JSON.stringify({
        config: { ingress: [{ hostname, service: `http://localhost:${port}`, originRequest: {} }, { service: "http_status:404" }] },
      }),
    });
    await pointDns(hostname, id, String(t.code));
    const token = await cf(`/accounts/${ACCOUNT}/cfd_tunnel/${id}/token`);
    const { error: saveError } = await sb.rpc("gm_tunnel_saved", { p_store_id: t.store_id, p_tunnel_id: id, p_hostname: hostname, p_port: port });
    if (saveError) console.error(saveError);
    return json({ status: "ok", url: `https://${hostname}`, hostname, token: String(token) });
  } catch (e) {
    console.error(e);
    return json({ status: "error", message: `Adresse Internet momentanément impossible à créer (${e instanceof Error ? e.message : e}).` }, 502);
  }
});
