// Mise à jour de la console (Console 1.1) :
//   - PC : module officiel de Tauri (tauri-plugin-updater), fichier latest.json de la pré-release fixe « console »,
//     signé par Eden Dev (même clé que GestiMarket). Mise à jour automatique (réglage de cet appareil, activé par
//     défaut) : au lancement, puis toutes les 6 heures si la console n'est pas utilisée depuis 10 minutes ;
//   - téléphone Android : la dernière version publiée (étiquette « console-v… ») est lue sur GitHub, et l'APK se
//     télécharge dans le navigateur (Android ne permet pas d'installer une application toute seule).
import { APP_VERSION, isAndroid, isDesktopApp } from "./sb";

export type UpdateInfo = { version: string; date?: string | null; notes?: string | null; apkUrl?: string };

const AUTO_KEY = "console-maj-auto";
const LAST_KEY = "console-maj-derniere-verification";
const RELEASES = "https://api.github.com/repos/lasscientifique/gestimarket/releases?per_page=30";
export const RELEASES_PAGE = "https://github.com/lasscientifique/gestimarket/releases";

/** Mise à jour automatique sur ce PC (oui par défaut). */
export function autoUpdate(): boolean {
  try {
    return localStorage.getItem(AUTO_KEY) !== "non";
  } catch {
    return true;
  }
}

export function setAutoUpdate(on: boolean) {
  try {
    localStorage.setItem(AUTO_KEY, on ? "oui" : "non");
  } catch {
    // stockage indisponible : réglage par défaut au prochain lancement
  }
}

/** Dernière vérification faite sur cet appareil (heure, version trouvée). */
export function lastCheck(): { at: string; version: string | null } | null {
  try {
    const v = JSON.parse(localStorage.getItem(LAST_KEY) ?? "null");
    return v && typeof v.at === "string" ? v : null;
  } catch {
    return null;
  }
}

function remember(version: string | null) {
  try {
    localStorage.setItem(LAST_KEY, JSON.stringify({ at: new Date().toISOString(), version }));
  } catch {
    // sans importance
  }
}

/** « 1.10.0 » est plus récente que « 1.9.2 ». */
export function newer(a: string, b: string): boolean {
  const pa = a.split(".").map((x) => parseInt(x, 10) || 0);
  const pb = b.split(".").map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0);
  }
  return false;
}

// Mise à jour trouvée par le module de Tauri (PC), gardée pour l'installer sans revérifier.
type TauriUpdate = Awaited<ReturnType<typeof import("@tauri-apps/plugin-updater").check>>;
let pending: TauriUpdate = null;

/** Nouvelle version ? null si la console est à jour. */
export async function checkUpdate(): Promise<UpdateInfo | null> {
  if (isDesktopApp) {
    const { check } = await import("@tauri-apps/plugin-updater");
    pending = await check();
    remember(pending?.version ?? null);
    return pending ? { version: pending.version, date: pending.date, notes: pending.body } : null;
  }
  const r = await fetch(RELEASES, { headers: { Accept: "application/vnd.github+json" } });
  if (!r.ok) throw new Error(r.status === 403 ? "GitHub limite les vérifications : réessayez dans une heure." : `GitHub injoignable (${r.status}).`);
  const list = (await r.json()) as { tag_name: string; published_at: string; body: string; html_url: string; assets: { name: string; browser_download_url: string }[] }[];
  const rel = list.find((x) => /^console-v\d+\.\d+\.\d+$/.test(x.tag_name));
  const version = rel?.tag_name.slice("console-v".length) ?? null;
  remember(version && newer(version, APP_VERSION) ? version : null);
  if (!rel || !version || !newer(version, APP_VERSION)) return null;
  const apk = rel.assets.find((a) => /android.*\.apk$/i.test(a.name));
  return { version, date: rel.published_at, notes: rel.body, apkUrl: isAndroid ? (apk?.browser_download_url ?? rel.html_url) : rel.html_url };
}

/** PC : télécharge, vérifie la signature d'Eden Dev, installe, puis redémarre la console. */
export async function installUpdate(onProgress?: (percent: number | null) => void): Promise<void> {
  if (!isDesktopApp) throw new Error("Sur le téléphone, la nouvelle version s'installe avec l'APK.");
  const { check } = await import("@tauri-apps/plugin-updater");
  const u = pending ?? (await check());
  if (!u) throw new Error("La console est déjà à jour.");
  let total = 0;
  let got = 0;
  await u.downloadAndInstall((e) => {
    if (e.event === "Started") {
      total = e.data.contentLength ?? 0;
      onProgress?.(total ? 0 : null);
    } else if (e.event === "Progress") {
      got += e.data.chunkLength;
      onProgress?.(total ? Math.min(99, Math.round((got * 100) / total)) : null);
    } else {
      onProgress?.(100);
    }
  });
  const { relaunch } = await import("@tauri-apps/plugin-process");
  await relaunch();
}

// Dernière activité de la personne (souris, clavier, toucher) : la mise à jour automatique attend 10 minutes de calme.
let lastActivity = Date.now();
if (typeof window !== "undefined") {
  for (const e of ["pointerdown", "keydown", "wheel", "touchstart"]) {
    window.addEventListener(e, () => (lastActivity = Date.now()), { passive: true });
  }
}
export const idleMs = () => Date.now() - lastActivity;
