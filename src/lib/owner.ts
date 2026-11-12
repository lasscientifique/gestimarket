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
  owner_name?: string;
  phone?: string;
  city?: string;
  address?: string;
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

/** Adresse du compte pas encore confirmée : le code reçu à l'inscription est demandé. */
export interface OwnerConfirm {
  status: "confirm_email";
  email: string;
}

/** Changement d'adresse : `done` quand c'est fait ; sinon un code est attendu (`other` : celui de l'ancienne adresse). */
export interface EmailChange {
  done: boolean;
  other?: boolean;
  email: string;
  old_email: string;
}

/** Informations de la boutique modifiables par la propriétaire (enregistrées chez Eden Dev). */
export interface StoreInfo {
  owner_name: string;
  phone: string;
  city: string;
  address: string;
}

const ownerCall = <T,>(action: string, args: Record<string, unknown> = {}) => local<T>("owner", { action, args });

export const isConfirm = (r: unknown): r is OwnerConfirm => (r as OwnerConfirm | null)?.status === "confirm_email";

export const owner = {
  status: () => ownerCall<{ connected: boolean; email?: string }>("status"),
  login: (email: string, password: string) => ownerCall<OwnerStores | OwnerConfirm>("login", { email, password }),
  /** Adresse confirmée avec le code reçu à l'inscription : la propriétaire est connectée. */
  confirmSignup: (email: string, code: string) => ownerCall<OwnerStores>("confirm_signup", { email, code }),
  resendSignup: (email: string) => ownerCall<{ sent: boolean }>("resend_signup", { email }),
  /** Changer l'e-mail du compte : mot de passe actuel, puis code reçu à la nouvelle adresse. */
  emailChangeStart: (email: string, password: string, new_email: string) => ownerCall<EmailChange>("email_change_start", { email, password, new_email }),
  emailChangeConfirm: (old_email: string, new_email: string, code: string, which: "new" | "old") =>
    ownerCall<EmailChange>("email_change_confirm", { old_email, new_email, code, which }),
  /** Informations d'une boutique : avec le mot de passe (PC) ou la connexion de l'Espace propriétaire. */
  storeInfo: (store_code: string, email: string, password: string) => ownerCall<StoreInfo & { code: string; name: string }>("store_info", { store_code, email, password }),
  updateStore: (p: StoreInfo & { store_code: string; email?: string; password?: string }) => ownerCall<StoreInfo & { code: string; name: string }>("update_store", { ...p }),
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
