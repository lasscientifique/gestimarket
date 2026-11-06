import { notify } from "./device";
import { tl } from "./i18n";
import { isMobileApp } from "./transport";

/**
 * Scanner natif : application GestiMarket installée (Tauri Android / iOS, module barcode-scanner),
 * ou pont avec l'application mobile FlutterFlow (WebView).
 *
 * L'application peut déclarer un canal JavaScript nommé « GestiMarketNative ».
 * Quand on touche le bouton caméra, la page lui envoie : {"action":"scan","title":"…"}.
 * L'application ouvre son propre scanner (plus fiable dans une WebView), puis renvoie le code :
 *     window.gestimarketScan("6181234567893")
 */
type Listener = (code: string) => void;
const listeners = new Set<Listener>();

interface NativeChannel {
  postMessage: (msg: string) => void;
}
declare global {
  interface Window {
    GestiMarketNative?: NativeChannel;
    gestimarketScan?: (code: string) => void;
    gestimarketInfo?: () => string;
  }
}

if (typeof window !== "undefined") {
  window.gestimarketScan = (code: string) => {
    const c = String(code ?? "").trim();
    if (c) listeners.forEach((l) => l(c));
  };
  // L'application peut interroger la page (version, nom du commerce) pour vérifier qu'elle est bien sur GestiMarket.
  window.gestimarketInfo = () => JSON.stringify({ app: "GestiMarket", version: __APP_VERSION__ });
}

export function hasNativeScanner(): boolean {
  return isMobileApp || (typeof window !== "undefined" && !!window.GestiMarketNative?.postMessage);
}

export function requestNativeScan(title: string) {
  if (isMobileApp) {
    void tauriScan();
    return;
  }
  window.GestiMarketNative?.postMessage(JSON.stringify({ action: "scan", title }));
}

let scanning = false;

/** Caméra du téléphone en plein écran (Tauri) ; le code lu est remis comme celui de l'application FlutterFlow. */
async function tauriScan() {
  if (scanning) return;
  scanning = true;
  try {
    const bs = await import("@tauri-apps/plugin-barcode-scanner");
    let perm = await bs.checkPermissions();
    if (perm !== "granted") perm = await bs.requestPermissions();
    if (perm !== "granted") {
      notify("error", tl("Autorisez la caméra pour GestiMarket dans les réglages du téléphone, puis réessayez."));
      await bs.openAppSettings().catch(() => undefined);
      return;
    }
    const r = await bs.scan({ windowed: false, cameraDirection: "back" });
    window.gestimarketScan?.(r.content);
  } catch (e) {
    // Retour arrière ou « Annuler » : pas de message.
    const msg = String((e as { message?: string })?.message ?? e ?? "");
    if (!/cancel/i.test(msg)) notify("error", tl("Scanner indisponible : {0}", [msg]));
  } finally {
    scanning = false;
  }
}

export function onNativeCode(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}
