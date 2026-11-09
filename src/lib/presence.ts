/**
 * Présence de ce poste auprès du poste serveur : chaque appareil se signale toutes les 10 s.
 * Le serveur affiche ainsi les postes connectés ; ce poste sait s'il est bien relié (synchronisé).
 */
import { useSyncExternalStore } from "react";
import { rpc, getNetwork, isMobileApp, isRemote, isTauri } from "./transport";
import { inAppWebView } from "./device";
import { tl } from "./i18n";
import { every } from "./visibility";


const ID_KEY = "gm-poste-id";
const NAME_KEY = "gm-poste-name";

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Identifiant permanent et unique de cet appareil. */
export function posteId(): string {
  const s = storage();
  let id = s?.getItem(ID_KEY) ?? "";
  if (!id) {
    id = (crypto.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`).slice(0, 36);
    s?.setItem(ID_KEY, id);
  }
  return id;
}

/** Type d'appareil déduit du navigateur. */
export function deviceLabel(): string {
  const net = getNetwork() as (ReturnType<typeof getNetwork> & { hostname?: string; os?: string }) | null;
  if (isMobileApp) {
    // Application installée : modèle du téléphone (Android) ou iPhone / iPad.
    const ua = navigator.userAgent;
    if (/iPhone/.test(ua)) return "iPhone · GestiMarket";
    if (/iPad/.test(ua) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(ua))) return "iPad · GestiMarket";
    const model = ua.match(/Android[^;]*;\s*([^;)]+?)(?:\sBuild|\))/);
    return tl("{0} Android{1} · GestiMarket", [/Mobile/.test(ua) ? "Téléphone" : "Tablette", model ? ` (${model[1].trim()})` : ""]);
  }
  if (isTauri) return `${net?.hostname ?? "PC"}${net?.os ? ` (${net.os === "windows" ? "Windows" : net.os === "macos" ? "Mac" : net.os === "linux" ? "Linux" : net.os})` : ""}`;
  const ua = navigator.userAgent;
  const app = inAppWebView() ? " · application" : "";
  if (/iPad|Macintosh.*Mobile|Macintosh.*Safari.*(?=.*Version)/.test(ua) && navigator.maxTouchPoints > 1) return `iPad${app}`;
  if (/iPhone/.test(ua)) return `iPhone${app}`;
  const android = ua.match(/Android[^;]*;\s*([^;)]+?)(?:\sBuild|\))/);
  if (/Android/.test(ua)) return tl("{0} Android{1}{2}", [/Mobile/.test(ua) ? "Téléphone" : "Tablette", android ? ` (${android[1].trim()})` : "", app]);
  if (/Windows/.test(ua)) return "PC Windows (navigateur)";
  if (/Mac OS X/.test(ua)) return "Mac (navigateur)";
  if (/Linux/.test(ua)) return "Linux (navigateur)";
  return "Navigateur";
}

export function deviceKind(): "desktop" | "mobile" | "browser" | "display" {
  if (window.location.hash.startsWith("#/display")) return "display";
  if (isMobileApp) return "mobile";
  if (isTauri) return "desktop";
  return /Android|iPhone|iPad|Mobile/.test(navigator.userAgent) || navigator.maxTouchPoints > 1 ? "mobile" : "browser";
}

/** Nom choisi pour ce poste (navigateur, tablette, téléphone). */
export function browserPosteName(): string {
  const s = storage();
  let name = s?.getItem(NAME_KEY) ?? "";
  if (!name) {
    const base = /iPhone|Android.*Mobile/.test(navigator.userAgent) ? "Téléphone" : /iPad|Android/.test(navigator.userAgent) ? "Tablette" : "Poste";
    name = `${base} ${posteId().replace(/[^0-9a-f]/gi, "").slice(0, 3).toUpperCase()}`;
    s?.setItem(NAME_KEY, name);
  }
  return name;
}

export function setBrowserPosteName(name: string) {
  storage()?.setItem(NAME_KEY, name.trim().slice(0, 40));
}

// ───── État de la liaison avec le serveur ─────

export interface PresenceState {
  /** null tant que le premier signal n'a pas abouti */
  online: boolean | null;
  latency: number | null;
  lastOk: number | null;
  error: string | null;
  postesOnline: number;
  /** Ce poste travaille-t-il sur la base d'un autre PC ? */
  remote: boolean;
  /** Route utilisée : réseau local ou Internet (déterminée par le serveur). */
  route: "local" | "internet" | null;
  /** L'adresse publique répond-elle ? (test fait par le serveur ; null si non configurée) */
  internetOk: boolean | null;
}

let state: PresenceState = { online: null, latency: null, lastOk: null, error: null, postesOnline: 0, remote: false, route: null, internetOk: null };
const listeners = new Set<() => void>();
function set(s: Partial<PresenceState>) {
  state = { ...state, ...s };
  listeners.forEach((l) => l());
}

let started = false;
let nameOf: () => string = () => "Poste";
let userPage = "";

export function setPresencePage(p: string) {
  userPage = p;
}

async function beat() {
  const t0 = performance.now();
  try {
    const display = deviceKind() === "display";
    const r = await rpc<{ online: number; route?: string; internet_ok?: boolean | null }>("poste_heartbeat", {
      // L'écran client partage le stockage de sa caisse : identifiant distinct.
      id: display ? `${posteId()}-ecran` : posteId(),
      name: display ? tl("Écran client — {0}", [nameOf()]) : nameOf(),
      kind: deviceKind(),
      device: deviceLabel(),
      mode: isTauri ? getNetwork()?.config.mode ?? "local" : "browser",
      version: __APP_VERSION__,
      page: userPage || window.location.hash.replace(/^#/, "").split("?")[0],
    });
    set({
      online: true,
      latency: Math.round(performance.now() - t0),
      lastOk: Date.now(),
      error: null,
      postesOnline: r.online,
      remote: isRemote(),
      route: r.route === "internet" ? "internet" : "local",
      internetOk: r.internet_ok ?? null,
    });
  } catch (e) {
    set({ online: false, latency: null, error: e instanceof Error ? e.message : String(e), remote: isRemote() });
  }
}

/** Démarre les signaux de présence (une seule fois par fenêtre). */
export function startPresence(name: () => string) {
  nameOf = name;
  if (started) return;
  started = true;
  beat();
  every(10_000, beat);
  window.addEventListener("online", beat);
}

export function usePresence(): PresenceState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}
