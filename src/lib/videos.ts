// Vidéos d'aide et manuel d'utilisation.
//
// Les vidéos sont filmées toutes seules sur GitHub à chaque version (e2e/videos.mjs) : le vrai logiciel,
// avec une voix de synthèse et des sous-titres incrustés, en français et en anglais. Elles sont publiées
// avec le manuel PDF dans la pré-release « aide » (adresse fixe). Le PC de la boutique peut les
// télécharger une fois (Paramètres → Aide hors ligne) : il les sert ensuite aux téléphones et tablettes
// de la boutique, même sans Internet.
import { convertFileSrc } from "@tauri-apps/api/core";
import { getLang, tl } from "./i18n";
import { isRemote, isTauri, local, remoteUrl, rpc } from "./transport";

export const HELP_RELEASE = "https://github.com/lasscientifique/gestimarket/releases/download/aide";

export interface HelpVideo {
  id: string;
  title: string;
  /** Écrans où la vidéo est proposée (clés de PAGE_HELP). */
  screens: string[];
}

/** Écrans qui ont leur vidéo de présentation (« ecran-<clé> »). */
export const SCREEN_VIDEOS = [
  "dashboard", "pos", "finder", "sales", "cash", "returns", "promotions", "customers", "products", "categories",
  "locations", "stock", "purchases", "suppliers", "reports", "payments", "users", "audit", "settings", "poste", "my_dashboard",
];

/** Vidéos d'action : une tâche pas à pas (filmées par e2e/videos.mjs). */
export const ACTION_VIDEOS = (): HelpVideo[] => [
  { id: "vente", title: tl("Faire une vente"), screens: ["pos", "my_dashboard", "sales"] },
  { id: "paiement-mobile", title: tl("Encaisser par Orange Money"), screens: ["pos", "payments"] },
  { id: "compte-client", title: tl("Compte client : versement et achat avec les fonds"), screens: ["customers", "pos"] },
  { id: "caisse", title: tl("Ouvrir et fermer la caisse"), screens: ["cash", "pos"] },
  { id: "produit", title: tl("Ajouter un produit"), screens: ["products", "categories", "stock"] },
  { id: "localiser", title: tl("Localiser un produit et faire la visite"), screens: ["finder", "locations"] },
];

/** Petit « ? » d'une fonction → vidéo qui la montre. */
export const TIP_VIDEO: Record<string, string> = {
  camera_scan: "vente", code_entry: "vente", hold: "vente", other_tills: "vente", partial: "paiement-mobile", om_reference: "paiement-mobile",
  om_qr: "paiement-mobile", cash_close: "caisse", cash_movement: "caisse", require_session: "caisse", credit_limit: "compte-client",
  customer_account: "compte-client", import: "produit", labels: "produit", sku: "produit", packagings: "produit", categories: "produit",
  barcode: "produit", plan: "localiser", bulk_location: "localiser",
};

/** Fichiers téléchargés pour l'aide hors ligne sur ce poste (rempli par Paramètres → Aide hors ligne). */
let offline: Set<string> = new Set();
let offlineFrom: "local" | "server" | null = null;

export function setOfflineHelp(files: string[], from: "local" | "server") {
  offline = new Set(files);
  offlineFrom = from;
}

export const videoFile = (id: string, lang = getLang()) => `${id}-${lang}.mp4`;
export const manualFile = (lang = getLang()) => `GestiMarket_manuel_${lang}.pdf`;

/** Adresse d'un fichier d'aide : sur ce poste ou le poste serveur s'il est téléchargé, sinon en ligne. */
export function helpUrl(file: string): string {
  if (offline.has(file)) {
    if (offlineFrom === "server" && isRemote()) return remoteUrl(`/aide/${file}`);
    if (offlineFrom === "local" && isTauri) {
      try {
        return convertFileSrc(file, "aide");
      } catch {
        /* protocole indisponible : en ligne */
      }
    }
  }
  return `${HELP_RELEASE}/${file}`;
}

/** Toutes les vidéos proposées sur un écran : sa présentation, puis les tâches. */
export function videosFor(screen: string): HelpVideo[] {
  const list: HelpVideo[] = [];
  if (SCREEN_VIDEOS.includes(screen)) list.push({ id: `ecran-${screen}`, title: tl("Présentation de l'écran"), screens: [screen] });
  return list.concat(ACTION_VIDEOS().filter((v) => v.screens.includes(screen)));
}

/** Tous les fichiers de l'aide dans une langue (téléchargement hors ligne). */
export function allHelpFiles(lang = getLang()): string[] {
  return [...SCREEN_VIDEOS.map((s) => videoFile(`ecran-${s}`, lang)), ...ACTION_VIDEOS().map((v) => videoFile(v.id, lang)), manualFile(lang)];
}

/** Au démarrage : l'aide est-elle téléchargée sur ce poste, ou sur le poste serveur ? */
export async function loadOfflineHelp() {
  try {
    if (isRemote()) setOfflineHelp(await rpc<string[]>("help_offline_files"), "server");
    else if (isTauri) setOfflineHelp((await local<{ files: string[] }>("help_offline_status")).files, "local");
  } catch {
    /* poste serveur plus ancien ou hors ligne : aide en ligne */
  }
}
