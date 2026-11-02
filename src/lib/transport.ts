import { invoke } from "@tauri-apps/api/core";
import { browserPosteName } from "./presence";

/**
 * Couche de transport : où envoyer les opérations ?
 *  - « local »   : application de bureau, base sur ce PC (commande Tauri `rpc`) ;
 *  - « remote »  : poste client → serveur du réseau (HTTP), ou navigateur (tablette, TV…) → même serveur.
 */

export const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

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
export async function rpc<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (remoteBase === null) {
    try {
      return await invoke<T>("rpc", { cmd, args: args ?? {} });
    } catch (e) {
      throw toError(e);
    }
  }
  let res: Response;
  try {
    res = await fetch(`${remoteBase}/rpc/${cmd}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(args ?? {}),
    });
  } catch {
    throw new Error(`Serveur injoignable (${remoteBase}). Vérifiez que le poste serveur est allumé et sur le même réseau.`);
  }
  const data = await res.json().catch(() => ({ error: `Réponse invalide du serveur (${res.status}).` }));
  if (data.error) throw new Error(data.error);
  return data.ok as T;
}

/** Commande propre à ce PC (fichiers locaux, réseau, fenêtres). */
export async function local<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri) throw new Error("Fonction disponible uniquement dans l'application de bureau.");
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
    throw new Error("Serveur injoignable : vérifiez l'adresse, le port et que le poste serveur est allumé.");
  });
  const data = await res.json();
  if (data.app !== "GestiMarket") throw new Error("Ce n'est pas un serveur GestiMarket.");
  return data;
}
