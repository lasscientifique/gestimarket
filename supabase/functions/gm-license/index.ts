// GestiMarket — émission des licences (Eden Dev).
//
// POST { "pc_id": "K7QM2XPA9DTR" } (appelée par GestiMarket, sans compte : l'identifiant du PC suffit)
//  → lit l'abonnement de la boutique de ce PC (gm_license_target) ;
//  → si la licence a changé : la signe (Ed25519), la dépose dans le bucket public « licences »
//    (licences/<pc_id>.gml) et l'enregistre (gm_licenses) ;
//  → répond { status, license_id, path, plan, expires_at, server_time, revoked }.
// GestiMarket télécharge ensuite le fichier signé : /storage/v1/object/public/licences/<pc_id>.gml
//
// Clé de signature : créée au premier appel et rangée dans Vault (gm_signing_key_init). La clé privée
// ne quitte jamais Supabase ; la clé publique (gm_config.license_public_key_1) est intégrée à GestiMarket.
import { createClient } from "npm:@supabase/supabase-js@2";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});

// En-tête PKCS#8 d'une clé privée Ed25519 (RFC 8410), suivi des 32 octets de la graine.
const PKCS8_PREFIX = new Uint8Array([0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20]);

const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

let cachedKey: { kid: number; key: CryptoKey } | null = null;

async function signingKey(): Promise<{ kid: number; key: CryptoKey }> {
  if (cachedKey) return cachedKey;
  let { data, error } = await sb.rpc("gm_signing_key");
  if (error) throw error;
  if (!data?.private) {
    const pair = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair;
    const pkcs8 = new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
    const raw = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
    if (pkcs8.length !== 48 || raw.length !== 32) throw new Error("Format de clé Ed25519 inattendu");
    ({ data, error } = await sb.rpc("gm_signing_key_init", { p_private: b64(pkcs8.slice(16)), p_public: b64(raw) }));
    if (error) throw error;
  }
  const der = new Uint8Array(48);
  der.set(PKCS8_PREFIX);
  der.set(unb64(data.private), 16);
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "Ed25519" }, false, ["sign"]);
  cachedKey = { kid: data.kid, key };
  return cachedKey;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ status: "error", message: "Méthode POST attendue." }, 405);
  let body: { pc_id?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    // corps vide ou invalide : refusé ci-dessous
  }
  const pc = String(body.pc_id ?? "").toUpperCase().replace(/[^0-9A-Z]/g, "");
  if (!/^[0-9A-Z]{12}$/.test(pc)) return json({ status: "error", message: "Identifiant de PC invalide." }, 400);

  try {
    const { data: t, error } = await sb.rpc("gm_license_target", { p_pc_id: pc });
    if (error) throw error;
    const base = { server_time: t.server_time, revoked: t.revoked ?? [] };
    if (t.status !== "ok") return json({ ...base, status: t.status, store_code: t.store_code ?? null });
    if (t.current) {
      return json({ ...base, status: "ok", license_id: t.current.license_id, path: t.current.file_path, plan: t.plan, expires_at: t.expires_at });
    }

    const { kid, key } = await signingKey();
    const path = `${pc}.gml`;
    const payload = {
      v: 1,
      license_id: crypto.randomUUID(),
      store_code: t.store_code,
      store_name: t.store_name,
      plan: t.plan,
      max_postes: t.max_postes,
      features: t.features,
      pc_id: pc,
      issued_at: new Date().toISOString(),
      starts_at: t.starts_at,
      expires_at: t.expires_at,
    };
    const bytes = new TextEncoder().encode(JSON.stringify(payload));
    const sig = new Uint8Array(await crypto.subtle.sign({ name: "Ed25519" }, key, bytes));
    const file = JSON.stringify({ format: "gestimarket-licence", kid, payload: b64(bytes), sig: b64(sig) }, null, 2);

    const up = await sb.storage.from("licences").upload(path, new Blob([file], { type: "application/json" }), {
      upsert: true,
      contentType: "application/json",
      cacheControl: "60",
    });
    if (up.error) throw up.error;
    const rec = await sb.rpc("gm_license_record", {
      p: { ...payload, store_id: t.store_id, subscription_id: t.subscription_id, kid, file_path: path },
    });
    if (rec.error) throw rec.error;
    return json({ ...base, status: "ok", license_id: payload.license_id, path, plan: t.plan, expires_at: t.expires_at });
  } catch (e) {
    console.error(e);
    return json({ status: "error", message: "Service des licences momentanément indisponible." }, 500);
  }
});
