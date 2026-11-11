// Espace propriétaire et recherche des boutiques : commandes locales de l'application installée
// (jamais envoyées à un poste serveur, même quand une boutique est ouverte à distance).
import { local } from "./transport";
import type { AccountOptions } from "../types";

/** PC serveur d'une boutique, tel que publié chez Eden Dev. */
export interface OwnerServer {
  found: boolean;
  active?: boolean;
  url?: string | null;
  public_url?: string | null;
  version?: string | null;
  last_seen?: string | null;
  seconds_ago?: number | null;
  error?: string;
}

export interface OwnerStore {
  code: string;
  name: string;
  city?: string;
  status?: string;
  plan?: string | null;
  plan_label?: string | null;
  ends_at?: string | null;
  trial?: boolean;
  server: OwnerServer;
}

export interface OwnerStores {
  email: string;
  stores: OwnerStore[];
  /** Pas d'Internet : dernière liste gardée sur l'appareil. */
  offline: boolean;
  at: string;
}

export interface OwnerPayment {
  id: string;
  created_at: string;
  method: string;
  plan: string;
  plan_label: string;
  months: number | null;
  amount: number;
  currency: string;
  status: string;
  note?: string | null;
  starts_at?: string | null;
  ends_at?: string | null;
  abandoned?: boolean;
}

/** Boutique GestiMarket trouvée sur le Wi-Fi ou le partage de connexion. */
export interface FoundShop {
  url: string;
  shop_name: string;
  version: string;
  poste?: string;
  device?: "phone" | "pc" | string;
}

const ownerCall = <T,>(action: string, args: Record<string, unknown> = {}) => local<T>("owner", { action, args });

export const owner = {
  status: () => ownerCall<{ connected: boolean; email?: string }>("status"),
  login: (email: string, password: string) => ownerCall<OwnerStores>("login", { email, password }),
  logout: () => ownerCall<null>("logout"),
  stores: () => ownerCall<OwnerStores>("stores"),
  payments: (store_code: string) => ownerCall<OwnerPayment[]>("payments", { store_code }),
  redeem: (store_code: string, code: string) => ownerCall<Record<string, unknown>>("redeem", { store_code, code }),
  declare: (p: { store_code: string; plan: string; months: number; method: string; reference: string; phone: string }) =>
    ownerCall<{ payment_id: string; amount: number; plan_label: string; months: number }>("declare", p),
  options: () => ownerCall<AccountOptions>("options"),
  /** « Mot de passe oublié » : code envoyé par e-mail à l'adresse du compte. */
  recover: (email: string) => ownerCall<{ sent: boolean }>("recover", { email }),
  /** Code reçu et nouveau mot de passe ; `login` : l'Espace propriétaire reste connecté sur cet appareil. */
  resetPassword: (email: string, code: string, password: string, login = false) =>
    ownerCall<{ ok: boolean }>("reset_password", { email, code, password, login }),
  changePassword: (email: string, current: string, password: string) => ownerCall<{ ok: boolean }>("change_password", { email, current, password }),
};

/** Boutiques sur le réseau local de cet appareil (quelques secondes). */
export const discoverServers = () => local<FoundShop[]>("discover_servers");

/** Même version majeure et mineure (0.21.x) : l'écran de l'application parle la même langue que le serveur. */
export function sameVersion(a: string | null | undefined, b: string): boolean {
  const mm = (v: string) => v.split(".").slice(0, 2).join(".");
  return !!a && mm(a) === mm(b);
}

/** Le poste serveur répond-il ? Version et nom de la boutique, ou null. */
export async function pingShop(url: string, timeoutMs = 8000): Promise<{ shop_name: string; version: string } | null> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const r = await fetch(`${url.replace(/\/+$/, "")}/api/ping`, { signal: controller.signal });
    const v = await r.json();
    return v && v.app === "GestiMarket" ? v : null;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}
