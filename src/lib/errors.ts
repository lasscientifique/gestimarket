// Pannes imprévues de l'interface (erreur JavaScript, page qui ne s'affiche pas) : envoyées à Eden Dev,
// si la boutique le permet (Paramètres), pour être corrigées sans attendre son appel.
// Jamais : les opérations refusées (stock insuffisant…), les coupures de réseau, les données saisies.
import { api } from "../api";
import { isExpectedError } from "./transport";
import { deviceLabel } from "./device";

let sent = 0;
const seen = new Set<string>();

/** Bruits connus des navigateurs, sans rapport avec GestiMarket. */
const IGNORED = [/ResizeObserver loop/i, /^Script error\.?$/i, /Failed to fetch dynamically imported module/i, /Importing a module script failed/i, /Load failed/i, /NetworkError/i];

export function reportError(kind: string, error: unknown, extra = "") {
  if (isExpectedError(error)) return;
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error ?? "");
  if (!message.trim() || IGNORED.some((re) => re.test(message))) return;
  if (sent >= 10 || seen.has(message)) return;
  seen.add(message);
  sent++;
  const stack = ((error instanceof Error && error.stack) || "") + (extra ? `\n${extra}` : "");
  const page = window.location.hash.replace(/^#/, "").split("?")[0] || "/";
  const engine = (window as unknown as { __GM_ENGINE__?: string }).__GM_ENGINE__ ?? "";
  api
    .reportError({ kind, message: message.slice(0, 500), stack: stack.slice(0, 2000), page, device: `${deviceLabel()} · ${engine}`.slice(0, 200) })
    .catch(() => undefined);
}

/** À appeler une fois au démarrage. */
export function captureErrors() {
  window.addEventListener("error", (e) => reportError("js", e.error ?? e.message));
  window.addEventListener("unhandledrejection", (e) => reportError("promise", e.reason));
}
