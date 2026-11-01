/**
 * Pont avec l'application mobile (FlutterFlow / Flutter, WebView).
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
  return typeof window !== "undefined" && !!window.GestiMarketNative?.postMessage;
}

export function requestNativeScan(title: string) {
  window.GestiMarketNative?.postMessage(JSON.stringify({ action: "scan", title }));
}

export function onNativeCode(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}
