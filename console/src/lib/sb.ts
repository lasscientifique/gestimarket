// Accès à Supabase (projet Eden Dev) avec la clé publique seulement : chaque écran passe par une fonction
// « gm_console_* » de la base qui vérifie le compte administrateur, la vérification à 2 étapes, cet appareil
// et le rôle. Aucune clé « service_role » ici.
import { createClient } from "@supabase/supabase-js";

export const SUPABASE_URL = "https://wpuchfnyuyujdflbmqpn.supabase.co";
const SUPABASE_KEY = "sb_publishable_cbsxEz9jKifmGN8ahIIYcg_M14lFLv3";
export const EDEN_WHATSAPP = "22397126202";

export const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, storageKey: "console-eden-dev-session" },
});

export const APP_VERSION: string = __APP_VERSION__;
export const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
export const isAndroid = /Android/i.test(navigator.userAgent);
export const isDesktopApp = isTauri && !isAndroid;

const DEVICE_KEY = "console-eden-dev-appareil";

/** Jeton de cet appareil (créé une fois, gardé sur l'appareil) : la base n'en connaît que l'empreinte. */
export function deviceToken(): string {
  let t = "";
  try {
    t = localStorage.getItem(DEVICE_KEY) ?? "";
  } catch {
    /* stockage indisponible : nouveau jeton à chaque lancement (appareil à autoriser) */
  }
  if (t.length >= 64) return t;
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  t = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  try {
    localStorage.setItem(DEVICE_KEY, t);
  } catch {
    /* idem */
  }
  return t;
}

/** Nom proposé pour cet appareil (nom du PC, sinon modèle). */
export async function deviceLabel(): Promise<string> {
  if (isDesktopApp) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const n = await invoke<string>("device_name");
      if (n) return `PC ${n}`;
    } catch {
      /* nom inconnu */
    }
    return "PC Windows";
  }
  const m = navigator.userAgent.match(/Android [\d.]+; ([^;)]+)/);
  return isAndroid ? `Téléphone ${m?.[1]?.trim() ?? "Android"}` : "Navigateur";
}

export const platform = () => (isAndroid ? "android" : isDesktopApp ? "windows" : "web");

/** Message d'erreur lisible (base, Supabase Auth, réseau). */
export function errText(e: unknown): string {
  const m = e instanceof Error ? e.message : typeof e === "object" && e && "message" in e ? String((e as { message: unknown }).message) : String(e);
  if (/Failed to fetch|NetworkError|Load failed|network/i.test(m)) return "Pas d'Internet, ou Eden Dev injoignable : réessayez.";
  if (/Invalid login credentials/i.test(m)) return "E-mail ou mot de passe incorrect.";
  if (/Email not confirmed/i.test(m)) return "Adresse e-mail pas encore confirmée : tapez le code reçu par e-mail.";
  if (/User already registered/i.test(m)) return "Un compte existe déjà avec cette adresse : connectez-vous.";
  if (/Token has expired or is invalid|otp_expired|invalid.*code/i.test(m)) return "Code incorrect ou expiré.";
  if (/Password should be at least/i.test(m)) return "Mot de passe trop court : 8 caractères au moins.";
  if (/weak|pwned|known/i.test(m)) return "Mot de passe trop connu ou trop simple : choisissez-en un autre.";
  if (/rate limit|too many/i.test(m)) return "Trop d'essais : patientez quelques minutes.";
  if (/JWT expired/i.test(m)) return "Session expirée : reconnectez-vous.";
  if (/permission denied/i.test(m)) return "Accès refusé : session expirée ou compte non autorisé. Reconnectez-vous.";
  return m.replace(/^ERROR:\s*/, "");
}

/** Fonction de la console (le jeton de l'appareil est ajouté). */
export async function rpc<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await sb.rpc(name, { p_device: deviceToken(), ...args });
  if (error) throw new Error(errText(error));
  return data as T;
}

/** Envoie les cartes WhatsApp dues (fonction « gm-cartes » : seulement ce qui est dû, rien d'autre). */
export async function flushCards(phone?: string): Promise<{ ok: boolean; sent?: { id: string; status: string; error?: string }[]; error?: string }> {
  const r = await fetch(`${SUPABASE_URL}/functions/v1/gm-cartes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "flush", ...(phone ? { phone } : {}) }),
  });
  return r.json().catch(() => ({ ok: false, error: `Réponse ${r.status}` }));
}

/** Lien de paiement CinetPay d'une carte vendue (fonction « gm-cinetpay », au nom de l'administrateur connecté). */
export async function cinetpaySaleLink(saleId: string): Promise<{ payment_url: string; window_open: boolean }> {
  const { data } = await sb.auth.getSession();
  const r = await fetch(`${SUPABASE_URL}/functions/v1/gm-cinetpay`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${data.session?.access_token ?? ""}` },
    body: JSON.stringify({ action: "sale_link", sale_id: saleId, device: deviceToken() }),
  });
  const v = await r.json().catch(() => ({}));
  if (v?.status !== "ok") throw new Error(v?.message ?? `Réponse ${r.status}`);
  return v;
}

/** Paiement CinetPay relu chez CinetPay (notification perdue). */
export async function cinetpayCheck(paymentId: string): Promise<string> {
  const r = await fetch(`${SUPABASE_URL}/functions/v1/gm-cinetpay`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "check", payment_id: paymentId }),
  });
  const v = await r.json().catch(() => ({}));
  if (v?.status !== "ok") throw new Error(v?.message ?? `Réponse ${r.status}`);
  return String(v.state ?? "");
}

/** Mot de passe ou code faux à la console : signalé au journal des comptes (alertes en cas d'essais répétés). */
export function reportAuthFailure(login: string, kind: "mot_de_passe_faux" | "code_faux" | "code_2_etapes_faux") {
  if (!login.trim()) return;
  void sb.rpc("gm_report_auth_failure", { p: { login: login.trim().toLowerCase(), kind, app: "console", version: APP_VERSION, platform: platform() } }).then(
    () => undefined,
    () => undefined,
  );
}

/** Ouvre une adresse (WhatsApp, site) dans l'application du système. */
export async function openUrl(url: string) {
  if (isTauri) {
    const { openUrl: open } = await import("@tauri-apps/plugin-opener");
    await open(url);
  } else {
    window.open(url, "_blank", "noopener");
  }
}

/** Lien WhatsApp vers un numéro, avec un texte prêt. */
export function waLink(phone: string, text = ""): string {
  const d = phone.replace(/\D/g, "").replace(/^00/, "");
  const n = d.length === 8 ? `223${d}` : d;
  return `https://wa.me/${n}${text ? `?text=${encodeURIComponent(text)}` : ""}`;
}

/** Enregistre un texte (CSV, licence) dans le fichier choisi par « Enregistrer sous ». */
export async function saveText(defaultName: string, contents: string, filters: { name: string; extensions: string[] }[]): Promise<string | null> {
  if (!isTauri) {
    const url = URL.createObjectURL(new Blob([contents], { type: "text/plain;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = defaultName;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    return defaultName;
  }
  const { save } = await import("@tauri-apps/plugin-dialog");
  const path = await save({ defaultPath: defaultName, filters });
  if (!path) return null;
  if (isAndroid) {
    const { writeTextFile } = await import("@tauri-apps/plugin-fs");
    await writeTextFile(path, contents);
  } else {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("save_text", { path, contents });
  }
  return path;
}
