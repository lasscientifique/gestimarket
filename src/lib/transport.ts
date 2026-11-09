import { invoke } from "@tauri-apps/api/core";
import { browserPosteName } from "./presence";
import { tl } from "./i18n";

/**
 * Couche de transport : où envoyer les opérations ?
 *  - « local »   : application de bureau, base sur ce PC (commande Tauri `rpc`) ;
 *  - « remote »  : poste client → serveur du réseau (HTTP), ou navigateur (tablette, TV…) → même serveur.
 */

export const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/**
 * Application GestiMarket installée sur un téléphone ou une tablette (Tauri Android / iOS) :
 * pas de mode serveur, ni de 2ᵉ écran, ni de plusieurs boutiques ; scanner natif ; fichiers par le système.
 * (Un iPad se présente comme un Mac : on le reconnaît à son écran tactile.)
 */
export const isMobileApp =
  isTauri &&
  typeof navigator !== "undefined" &&
  (/Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1));

export interface NetworkConfig {
  mode: "local" | "server" | "client";
  poste_name: string;
  port: number;
  server_url: string;
}

export interface NetworkInfo {
  config: NetworkConfig;
  local_ips: string[];
  /** Nom du PC */
  hostname?: string;
  os?: string;
}

let remoteBase: string | null = null;
let token: string | null = null;
let network: NetworkInfo | null = null;

function loadToken() {
  try {
    token = sessionStorage.getItem("gm-token");
  } catch {
    token = null;
  }
}

/** Jeton de la session réseau (photos servies par le poste serveur depuis Internet). */
export function getToken() {
  return token;
}

export function setToken(t: string | null) {
  token = t;
  try {
    if (t) sessionStorage.setItem("gm-token", t);
    else sessionStorage.removeItem("gm-token");
  } catch {
    /* stockage indisponible */
  }
}

// ───────────── Boutique ouverte à distance (Espace propriétaire) ─────────────
// L'application installée ouvre une boutique de la propriétaire par son adresse Internet, avec l'écran
// déjà dans l'application : seules les données passent par Internet. Le mode réseau de l'appareil ne
// change pas ; « Changer de boutique » revient à l'Espace propriétaire.

export interface RemoteShop {
  url: string;
  code: string;
  name: string;
}

const REMOTE_KEY = "gm-remote-shop";

export function remoteShop(): RemoteShop | null {
  try {
    const v = JSON.parse(localStorage.getItem(REMOTE_KEY) ?? "null");
    return v && typeof v.url === "string" ? (v as RemoteShop) : null;
  } catch {
    return null;
  }
}

/** Ouvre une boutique à distance (ou revient à celle de l'appareil avec `null`), puis recharge. */
export function setRemoteShop(shop: RemoteShop | null, hash = "#/") {
  try {
    if (shop) localStorage.setItem(REMOTE_KEY, JSON.stringify(shop));
    else localStorage.removeItem(REMOTE_KEY);
    sessionStorage.removeItem("gm-token");
  } catch {
    /* stockage indisponible */
  }
  window.location.hash = hash;
  window.location.reload();
}

/** À appeler au démarrage : détermine le mode de fonctionnement de ce poste. */
export async function initTransport(): Promise<NetworkInfo | null> {
  loadToken();
  if (!isTauri) {
    // Navigateur : l'interface est servie par le poste serveur lui-même.
    remoteBase = window.location.origin;
    return null;
  }
  try {
    network = await invoke<NetworkInfo>("get_network_config");
  } catch {
    network = null;
  }
  remoteBase = network?.config.mode === "client" && network.config.server_url ? network.config.server_url : null;
  // Boutique de la propriétaire ouverte à distance (application installée).
  const shop = isMobileApp ? remoteShop() : null;
  if (shop) remoteBase = shop.url.replace(/\/+$/, "");
  return network;
}

export function getNetwork() {
  return network;
}

export function isRemote() {
  return remoteBase !== null;
}

export function remoteUrl(path: string) {
  return `${remoteBase}${path}`;
}

/** Nom du poste (associe l'écran client à la bonne caisse). */
export function posteName(): string {
  const fromWindow = (window as unknown as { __GM_DISPLAY_POSTE__?: string }).__GM_DISPLAY_POSTE__;
  const fromUrl = new URLSearchParams(window.location.hash.split("?")[1] ?? "").get("poste");
  if (fromUrl || fromWindow) return (fromUrl || fromWindow)!;
  if (isTauri) return network?.config.poste_name || "Caisse 1";
  // Navigateur (tablette, téléphone) : nom propre à l'appareil, pour ne pas se mélanger avec une autre caisse.
  return browserPosteName();
}

function toError(e: unknown): Error {
  return new Error(typeof e === "string" ? e : e instanceof Error ? e.message : String(e));
}

/** Appel d'une opération métier. Les erreurs sont des messages en français prêts à afficher. */
/** Opérations longues (import, sauvegarde, plan, compte Eden Dev) : délai plus large. */
const SLOW_COMMANDS = new Set([
  "import_products", "import_categories", "seed_catalogue", "backup_database", "run_auto_backup", "plan_generate_layout",
  "license_sync", "account_signup", "account_login", "account_create_store", "account_link", "account_card_start",
]);

// Erreurs venues du moteur ou du réseau (stock insuffisant, serveur injoignable…) : attendues, déjà
// montrées à l'utilisateur, jamais envoyées à Eden Dev comme des pannes.
const expected = new WeakSet<object>();

/** L'erreur vient-elle d'une opération refusée ou du réseau (et non d'une panne de l'interface) ? */
export function isExpectedError(e: unknown): boolean {
  return typeof e === "object" && e !== null && expected.has(e);
}

export async function rpc<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await rpcCall<T>(cmd, args);
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    expected.add(err);
    throw err;
  }
}

async function rpcCall<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (remoteBase === null) {
    try {
      return await invoke<T>("rpc", { cmd, args: args ?? {} });
    } catch (e) {
      throw toError(e);
    }
  }
  if (batchSupported && !SLOW_COMMANDS.has(cmd)) return queueCall<T>(cmd, args ?? {});
  return remoteCall<T>(cmd, args ?? {});
}

function networkError(aborted: boolean): Error {
  if (aborted) {
    return new Error(tl("Le serveur ne répond pas (délai dépassé). Vérifiez le réseau, puis réessayez : une vente déjà enregistrée ne sera pas comptée deux fois."));
  }
  return new Error(tl("Serveur injoignable ({0}). Vérifiez que le poste serveur est allumé et sur le même réseau.", [remoteBase]));
}

/** Un appel envoyé seul au poste serveur. */
async function remoteCall<T>(cmd: string, args: Record<string, unknown>): Promise<T> {
  // Délai maximum : sur un réseau qui coupe (Wi-Fi faible, 4G), le bouton ne tourne pas sans fin.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SLOW_COMMANDS.has(cmd) ? 180_000 : 45_000);
  let res: Response;
  try {
    res = await fetch(`${remoteBase}/rpc/${cmd}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(args),
      signal: controller.signal,
    });
  } catch {
    clearTimeout(timer);
    throw networkError(controller.signal.aborted);
  }
  const data = await res.json().catch(() => ({ error: tl("Réponse invalide du serveur ({0}).", [res.status]) }));
  clearTimeout(timer);
  if (data.error) throw new Error(data.error);
  return data.ok as T;
}

// ───────────── Appels groupés ─────────────
// Les appels lancés au même moment (ouverture d'un écran : produits, catégories, emplacements…) partent
// ensemble, en un seul aller-retour (/rpc-batch). Par Internet ou en 4G, chaque aller-retour coûte
// 0,2 à 0,5 s. Un poste serveur plus ancien (sans /rpc-batch) reçoit à nouveau des appels séparés.

interface Pending {
  cmd: string;
  args: Record<string, unknown>;
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
}

const MAX_BATCH = 20;
let batchSupported = true;
let queue: Pending[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function queueCall<T>(cmd: string, args: Record<string, unknown>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    queue.push({ cmd, args, resolve: resolve as (v: unknown) => void, reject });
    if (queue.length >= MAX_BATCH) flushQueue();
    else flushTimer ??= setTimeout(flushQueue, 0);
  });
}

function settleAlone(p: Pending) {
  remoteCall(p.cmd, p.args).then(p.resolve, p.reject);
}

function flushQueue() {
  if (flushTimer !== null) clearTimeout(flushTimer);
  flushTimer = null;
  const calls = queue;
  queue = [];
  if (calls.length === 0) return;
  if (calls.length === 1 || !batchSupported) {
    calls.forEach(settleAlone);
    return;
  }
  void sendBatch(calls);
}

async function sendBatch(calls: Pending[]) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45_000);
  let res: Response;
  try {
    res = await fetch(`${remoteBase}/rpc-batch`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ calls: calls.map((c) => ({ cmd: c.cmd, args: c.args })) }),
      signal: controller.signal,
    });
  } catch {
    clearTimeout(timer);
    const e = networkError(controller.signal.aborted);
    calls.forEach((c) => c.reject(e));
    return;
  }
  clearTimeout(timer);
  // Poste serveur d'avant la 0.20 : pas d'appels groupés.
  if (res.status === 404 || res.status === 405) {
    batchSupported = false;
    calls.forEach(settleAlone);
    return;
  }
  const data = await res.json().catch(() => null);
  const results: unknown[] | null = data && Array.isArray(data.results) ? data.results : null;
  if (!results || results.length !== calls.length) {
    // Refus global (formule, requête) : le même message pour chaque appel.
    const e = new Error(data?.error ?? tl("Réponse invalide du serveur ({0}).", [res.status]));
    calls.forEach((c) => c.reject(e));
    return;
  }
  calls.forEach((c, i) => {
    const r = results[i] as { ok?: unknown; error?: string };
    if (r && r.error) c.reject(new Error(r.error));
    else c.resolve(r?.ok);
  });
}

/** Commande propre à ce PC (fichiers locaux, réseau, fenêtres). */
export async function local<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri) throw new Error(tl("Fonction disponible uniquement dans l'application de bureau."));
  try {
    return await invoke<T>(cmd, args);
  } catch (e) {
    throw toError(e);
  }
}

/** Teste un serveur GestiMarket (poste client). */
export async function pingServer(url: string): Promise<{ shop_name: string; version: string }> {
  const base = (url.startsWith("http") ? url : `http://${url}`).replace(/\/+$/, "");
  const res = await fetch(`${base}/api/ping`).catch(() => {
    throw new Error(tl("Serveur injoignable : vérifiez l'adresse, le port et que le poste serveur est allumé."));
  });
  const data = await res.json();
  if (data.app !== "GestiMarket") throw new Error("Ce n'est pas un serveur GestiMarket.");
  return data;
}
