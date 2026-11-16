// Données de Sugu Eden : fonctions publiques d'Eden Dev (lecture seule, clé publique).
// Les boutiques GestiMarket publient leurs produits ; ici on ne fait que les lire.

const SUPABASE_URL = "https://wpuchfnyuyujdflbmqpn.supabase.co";
const PUBLIC_KEY = "sb_publishable_cbsxEz9jKifmGN8ahIIYcg_M14lFLv3";

export interface ShopRef {
  slug: string;
  name: string;
  city: string;
  country: string;
}

export interface Item {
  id: string;
  name: string;
  price: number;
  unit: string;
  brand: string;
  category: string;
  /** Classement Sugu Eden (sous-catégorie) ; état ; public visé. */
  code?: string | null;
  condition?: "new" | "used" | "refurbished";
  audience?: "women" | "men" | "unisex" | "kids" | null;
  /** Toutes les photos, la principale d'abord. */
  photos?: string[];
  /** Couleurs proposées (codes de la palette) et nombre de couleurs/tailles. */
  colors?: string[];
  variants_count?: number;
  /** Fiche complète : type de taille, couleurs et tailles, liens de vidéos. */
  axis?: string | null;
  variants?: Variant[];
  videos?: string[];
  in_stock: boolean;
  stock: number | null;
  photo: string | null;
  currency: string;
  decimals: number;
  shop: ShopRef;
  description?: string;
}

/** Une couleur et/ou une taille d'un produit. */
export interface Variant {
  color: string | null;
  size: string | null;
  /** Prix propre (null : prix du produit). */
  price: number | null;
  in_stock: boolean;
  stock: number | null;
  /** Photo de cette couleur (chemin dans le bucket). */
  photo: string | null;
}

export interface Shop extends ShopRef {
  found: boolean;
  address: string;
  whatsapp: string;
  phone: string;
  description?: string;
  logo: string | null;
  shop_type?: string;
  products?: number;
  since?: string;
}

/** Classement Sugu Eden : Catégorie (1) → Section (2) → Sous-catégorie (3). */
export interface TaxNode {
  code: string;
  parent: string | null;
  level: number;
  name: string;
}

export interface Home {
  countries: { code: string; shops: number }[];
  cities: { city: string; shops: number }[];
  categories: { code?: string; category: string; products: number }[];
  shops: (ShopRef & { logo: string | null; products: number; shop_type: string })[];
}

export interface Results {
  total: number;
  items: Item[];
  /** Couleurs présentes dans les résultats (filtre). */
  colors?: string[];
}

export interface ProductPage {
  found: boolean;
  product?: Item;
  shop?: Shop;
  more?: Item[];
}

async function rpc<T>(name: string, body: Record<string, unknown>): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
      method: "POST",
      headers: { apikey: PUBLIC_KEY, Authorization: `Bearer ${PUBLIC_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error("Pas de connexion à Internet : réessayez dans un instant.");
  }
  if (!res.ok) throw new Error("Sugu Eden est momentanément indisponible : réessayez plus tard.");
  return (await res.json()) as T;
}

let taxonomy: Promise<TaxNode[]> | null = null;

export const api = {
  home: (country: string) => rpc<Home>("sugu_home", { p_country: country || null }),
  /** Classement complet (lu une fois). */
  taxonomy: () =>
    (taxonomy ??= rpc<{ items: TaxNode[] }>("sugu_taxonomy", {}).then(
      (r) => r.items,
      (e) => {
        taxonomy = null;
        throw e;
      },
    )),
  /** Nombre de produits par ligne du classement. */
  counts: (country: string) => rpc<Record<string, number>>("sugu_counts", { p_country: country || null }),
  search: (p: { q?: string; country?: string; city?: string; category?: string; shop?: string; code?: string; color?: string; offset?: number; limit?: number }) =>
    rpc<Results>("sugu_search", {
      p_q: p.q || null,
      p_country: p.country || null,
      p_city: p.city || null,
      p_category: p.category || null,
      p_shop: p.shop || null,
      p_code: p.code || null,
      p_limit: p.limit ?? 24,
      p_offset: p.offset ?? 0,
      // Seulement s'il sert : la recherche marche aussi avec une base d'avant la 0.32.
      ...(p.color ? { p_color: p.color } : {}),
    }),
  // Identifiant mal recopié : « introuvable », sans appel.
  product: (id: string) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
      ? rpc<ProductPage>("sugu_product", { p_id: id })
      : Promise.resolve<ProductPage>({ found: false }),
  shop: (slug: string) => rpc<Shop>("sugu_shop", { p_slug: slug }),
};

/** Adresse publique d'une photo (bucket « sugu »). */
export const photoUrl = (path: string | null | undefined) => (path ? `${SUPABASE_URL}/storage/v1/object/public/sugu/${path}` : null);

/** Prix au format du pays : « 15 000 F CFA ». */
export function price(item: { price: number; currency: string; decimals: number }): string {
  const value = item.price / Math.pow(10, item.decimals || 0);
  try {
    return new Intl.NumberFormat("fr-FR", {
      style: "currency",
      currency: item.currency || "XOF",
      minimumFractionDigits: item.decimals || 0,
      maximumFractionDigits: item.decimals || 0,
    }).format(value);
  } catch {
    return `${value.toLocaleString("fr-FR")} ${item.currency}`;
  }
}

let regions: Intl.DisplayNames | null | undefined;
/** Nom d'un pays en français (« ML » → « Mali »). */
export function countryName(code: string): string {
  if (regions === undefined) {
    try {
      regions = new Intl.DisplayNames(["fr"], { type: "region" });
    } catch {
      regions = null;
    }
  }
  return (regions && regions.of(code)) || code;
}

export const CONDITIONS: Record<string, string> = { new: "Neuf", used: "Occasion", refurbished: "Reconditionné" };
export const AUDIENCES: Record<string, string> = { women: "Femme", men: "Homme", unisex: "Homme et femme", kids: "Enfant" };

/** Vidéo d'un produit : site (« TikTok ») et image d'aperçu quand elle existe (YouTube). */
export function videoInfo(link: string): { site: string; preview: string | null } {
  let host: string;
  let id: string | null = null;
  try {
    const u = new URL(link);
    host = u.hostname.toLowerCase().replace(/^(www|m|vm|web)\./, "");
    if (host === "youtu.be") id = u.pathname.slice(1).split("/")[0] || null;
    else if (host.endsWith("youtube.com")) id = u.searchParams.get("v") ?? (u.pathname.match(/^\/(?:shorts|embed|live)\/([\w-]+)/)?.[1] ?? null);
  } catch {
    return { site: "Vidéo", preview: null };
  }
  const site = host.includes("tiktok") ? "TikTok" : host.includes("youtu") ? "YouTube" : host.includes("instagram") ? "Instagram" : host.includes("facebook") || host === "fb.watch" ? "Facebook" : "Vidéo";
  return { site, preview: id && /^[\w-]{6,20}$/.test(id) ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : null };
}

/** Lien WhatsApp vers la boutique, avec le message de commande déjà écrit. */
export function whatsappLink(number: string, message: string): string | null {
  const digits = number.replace(/[^0-9]/g, "");
  if (digits.length < 8) return null;
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}
