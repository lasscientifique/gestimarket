// GestiMarket — publication des produits d'une boutique sur Sugu Eden (Eden Dev), étape S1 « Vitrine ».
//
// Appelée par le PC de la boutique (poste serveur ou poste unique) avec son jeton d'appareil (0.27) :
//   POST JSON { pc_id, device_token, action, ... }
//   - "status"   : { allowed, visible_until, shop_url, products } — formule PRO ou BUSINESS (« sugu »).
//   - "shop"     : { shop: { description, whatsapp, phone, currency, decimals, logo_key, logo? } } — fiche de la
//                  boutique ; nom, pays, ville et adresse viennent du compte Eden Dev (gm_stores).
//   - "products" : { upsert: [{ local_id, name, description, category, brand, unit, price, in_stock, stock,
//                  photo_key, photo? }], remove: [local_id…] } — 100 produits et 20 photos au plus par appel.
//   - "off"      : la boutique et ses produits quittent Sugu Eden (photos effacées).
// Photo : { mime: "image/jpeg" | "image/png" | "image/webp", data: base64 } (700 Ko au plus), déposée dans le
// bucket public « sugu ». photo_key change quand la photo change ; absente, la photo déjà publiée reste.
// Réponse : toujours HTTP 200, { status: "ok", … } ou { status: "error", message } (message en français).
import { createClient } from "npm:@supabase/supabase-js@2";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});

const MAX_ITEMS = 100;
const MAX_PHOTOS = 20;
const MAX_PHOTO_BYTES = 700 * 1024;
const MAX_PRODUCTS = 5000;
const MIMES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

function json(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}
const fail = (message: string) => json({ status: "error", message });

class UserError extends Error {}

const text = (v: unknown, max: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const longText = (v: unknown, max: number) => String(v ?? "").replace(/\r\n/g, "\n").trim().slice(0, max);

/** Adresse de la boutique sur le site : nom en minuscules sans accents, puis le numéro du compte (gm-000123). */
export function slugOf(name: string, code: string): string {
  const base = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  const num = code.toLowerCase().replace(/[^a-z0-9]/g, "").replace(/^gm0*/, "") || "0";
  return `${base || "boutique"}-${num}`;
}

function decodePhoto(p: unknown): { bytes: Uint8Array; mime: string; ext: string } {
  const o = (p ?? {}) as { mime?: unknown; data?: unknown };
  const mime = String(o.mime ?? "");
  const ext = MIMES[mime];
  if (!ext) throw new UserError("Photo refusée : JPEG, PNG ou WebP seulement.");
  const raw = String(o.data ?? "").replace(/^data:[^,]*,/, "");
  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.from(atob(raw), (c) => c.charCodeAt(0));
  } catch {
    throw new UserError("Photo illisible.");
  }
  if (bytes.length === 0 || bytes.length > MAX_PHOTO_BYTES) throw new UserError("Photo trop lourde (700 Ko au plus).");
  return { bytes, mime, ext };
}

async function upload(path: string, photo: { bytes: Uint8Array; mime: string }) {
  const r = await sb.storage.from("sugu").upload(path, photo.bytes, { upsert: true, contentType: photo.mime, cacheControl: "604800" });
  if (r.error) throw r.error;
}

async function removeFiles(paths: (string | null | undefined)[]) {
  const list = paths.filter((p): p is string => !!p);
  for (let i = 0; i < list.length; i += 100) {
    await sb.storage.from("sugu").remove(list.slice(i, i + 100));
  }
}

type Store = {
  store_id: string;
  code: string;
  name: string;
  country: string;
  city: string;
  address: string;
  phone: string;
  shop_type: string;
  active: boolean;
  allowed: boolean;
  visible_until: string | null;
  site_url: string | null;
};

function shopUrl(store: Store, slug: string) {
  const site = (store.site_url ?? "").trim();
  if (!site) return null;
  return `${site.replace(/\/+$/, "")}/#/b/${slug}`;
}

async function countProducts(storeId: string) {
  const { count } = await sb.from("sugu_products").select("id", { count: "exact", head: true }).eq("store_id", storeId);
  await sb.from("sugu_shops").update({ products: count ?? 0 }).eq("store_id", storeId);
  return count ?? 0;
}

async function current(storeId: string) {
  const { data } = await sb.from("sugu_shops").select("slug, products, logo_path").eq("store_id", storeId).maybeSingle();
  return data as { slug: string; products: number; logo_path: string | null } | null;
}

async function saveShop(store: Store, body: Record<string, unknown>) {
  const shop = (body.shop ?? {}) as Record<string, unknown>;
  const before = await current(store.store_id);
  const slug = before?.slug ?? slugOf(store.name, store.code);
  const decimals = Math.max(0, Math.min(3, Number(shop.decimals ?? 0) | 0));
  const row: Record<string, unknown> = {
    store_id: store.store_id,
    slug,
    name: text(store.name, 120),
    country: store.country,
    city: text(store.city, 80),
    address: text(store.address, 200),
    whatsapp: text(shop.whatsapp, 20).replace(/[^0-9+]/g, ""),
    phone: text(shop.phone || store.phone, 40),
    description: longText(shop.description, 600),
    shop_type: text(store.shop_type, 40),
    currency: text(shop.currency || "XOF", 3).toUpperCase() || "XOF",
    decimals,
    active: true,
    visible_until: store.visible_until ?? new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  const logoKey = text(shop.logo_key, 40);
  if (shop.logo) {
    const photo = decodePhoto(shop.logo);
    const path = `s/${slug}/logo-${logoKey || "1"}.${photo.ext}`;
    await upload(path, photo);
    row.logo_path = path;
    if (before?.logo_path && before.logo_path !== path) await removeFiles([before.logo_path]);
  } else if (!logoKey) {
    row.logo_path = null;
    if (before?.logo_path) await removeFiles([before.logo_path]);
  }
  const { error } = await sb.from("sugu_shops").upsert(row, { onConflict: "store_id" });
  if (error) throw error;
  return slug;
}

async function saveProducts(store: Store, body: Record<string, unknown>) {
  const shop = await current(store.store_id);
  if (!shop) throw new UserError("Publiez d'abord la fiche de la boutique.");
  // Abonnement prolongé : la boutique reste visible jusqu'à la nouvelle fin.
  await sb.from("sugu_shops").update({ visible_until: store.visible_until, active: true }).eq("store_id", store.store_id);

  const upsert = Array.isArray(body.upsert) ? body.upsert : [];
  const remove = (Array.isArray(body.remove) ? body.remove : []).map((v) => Number(v)).filter((n) => Number.isSafeInteger(n));
  if (upsert.length > MAX_ITEMS || remove.length > 1000) throw new UserError("Trop de produits en un seul envoi.");
  if (shop.products + upsert.length > MAX_PRODUCTS + remove.length) {
    throw new UserError(`${MAX_PRODUCTS} produits au plus sur Sugu Eden.`);
  }
  let photos = 0;
  const localIds = upsert.map((u) => Number((u as Record<string, unknown>).local_id));
  const { data: existing } = localIds.length
    ? await sb.from("sugu_products").select("local_id, photo_path, photo_key").eq("store_id", store.store_id).in("local_id", localIds)
    : { data: [] as { local_id: number; photo_path: string | null; photo_key: string }[] };
  const known = new Map((existing ?? []).map((e) => [Number(e.local_id), e]));
  const rows: Record<string, unknown>[] = [];
  const stale: string[] = [];
  for (const raw of upsert) {
    const u = raw as Record<string, unknown>;
    const localId = Number(u.local_id);
    const name = text(u.name, 160);
    const price = Number(u.price);
    if (!Number.isSafeInteger(localId) || !name || !Number.isSafeInteger(price) || price < 0) {
      throw new UserError(`Produit invalide : ${name || localId}.`);
    }
    const before = known.get(localId);
    const photoKey = text(u.photo_key, 40);
    let photoPath: string | null = before?.photo_path ?? null;
    if (u.photo) {
      photos += 1;
      if (photos > MAX_PHOTOS) throw new UserError("Trop de photos en un seul envoi.");
      const photo = decodePhoto(u.photo);
      photoPath = `p/${shop.slug}/${localId}-${photoKey || "1"}.${photo.ext}`;
      await upload(photoPath, photo);
      if (before?.photo_path && before.photo_path !== photoPath) stale.push(before.photo_path);
    } else if (!photoKey) {
      if (before?.photo_path) stale.push(before.photo_path);
      photoPath = null;
    }
    const stock = u.stock === null || u.stock === undefined || u.stock === "" ? null : Number(u.stock);
    rows.push({
      store_id: store.store_id,
      local_id: localId,
      name,
      description: longText(u.description, 1500),
      category: text(u.category, 120),
      brand: text(u.brand, 80),
      unit: text(u.unit, 20),
      price,
      in_stock: u.in_stock !== false,
      stock_shown: stock !== null && Number.isFinite(stock) ? Math.max(0, stock) : null,
      photo_path: photoPath,
      photo_key: photoPath ? photoKey : "",
    });
  }
  if (rows.length) {
    const { error } = await sb.from("sugu_products").upsert(rows, { onConflict: "store_id,local_id" });
    if (error) throw error;
  }
  if (remove.length) {
    const { data: gone } = await sb.from("sugu_products").select("photo_path").eq("store_id", store.store_id).in("local_id", remove);
    stale.push(...(gone ?? []).map((g) => g.photo_path as string));
    const { error } = await sb.from("sugu_products").delete().eq("store_id", store.store_id).in("local_id", remove);
    if (error) throw error;
  }
  await removeFiles(stale);
  return countProducts(store.store_id);
}

async function off(store: Store) {
  const shop = await current(store.store_id);
  if (!shop) return;
  const { data: all } = await sb.from("sugu_products").select("photo_path").eq("store_id", store.store_id);
  await removeFiles([...(all ?? []).map((p) => p.photo_path as string), shop.logo_path]);
  const { error } = await sb.from("sugu_shops").delete().eq("store_id", store.store_id);
  if (error) throw error;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return fail("Méthode POST attendue.");
  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return fail("Demande illisible.");
  }
  try {
    const { data, error } = await sb.rpc("sugu_pc_store", { p_pc_id: String(body.pc_id ?? ""), p_token: String(body.device_token ?? "") });
    if (error) throw new UserError(error.message);
    const store = data as Store;
    const action = String(body.action ?? "status");
    if (action === "off") {
      await off(store);
      return json({ status: "ok", published: false, products: 0 });
    }
    if (!store.allowed) {
      return json({
        status: "not_allowed",
        message: "Sugu Eden est inclus dans les formules PRO et BUSINESS : activez l'une d'elles (Abonnement & licence).",
      });
    }
    if (action === "status") {
      const shop = await current(store.store_id);
      return json({
        status: "ok", allowed: true, visible_until: store.visible_until, published: !!shop,
        products: shop?.products ?? 0, shop_url: shop ? shopUrl(store, shop.slug) : null,
      });
    }
    if (action === "shop") {
      const slug = await saveShop(store, body);
      return json({ status: "ok", shop_url: shopUrl(store, slug), visible_until: store.visible_until });
    }
    if (action === "products") {
      const products = await saveProducts(store, body);
      return json({ status: "ok", products });
    }
    return fail("Action inconnue.");
  } catch (e) {
    if (e instanceof UserError) return fail(e.message);
    console.error(e);
    return fail("Sugu Eden est momentanément indisponible : réessayez plus tard.");
  }
});
