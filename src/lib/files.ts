import { open, save } from "@tauri-apps/plugin-dialog";
import { readFile, writeFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { api } from "../api";
import { inAppWebView, notify } from "./device";
import { tl } from "./i18n";
import { isMobileApp, isTauri } from "./transport";

/*
 * Application installée sur téléphone ou tablette (Tauri Android / iOS) : les boîtes de dialogue donnent
 * une adresse « content:// » (Android) ou « file:// » (iOS) et non un chemin. Seul le module fs de Tauri
 * sait y écrire et y lire ; sur PC, les commandes Rust habituelles écrivent au chemin choisi.
 */

/** Écrit un texte dans le fichier choisi par la boîte « Enregistrer sous ». */
export async function writeChosenText(path: string, contents: string): Promise<void> {
  if (isMobileApp) await writeTextFile(path, contents);
  else await api.saveTextFile(path, contents);
}

/** Écrit un fichier binaire (base64) dans le fichier choisi par la boîte « Enregistrer sous ». */
export async function writeChosenBinary(path: string, base64: string): Promise<void> {
  if (!isMobileApp) return api.saveBinaryFile(path, base64);
  const raw = atob(base64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  await writeFile(path, bytes);
}

/** Nom lisible d'un fichier choisi : « C:\…\produits.csv », « content://…/document/primary%3ADownload%2Fproduits.csv ». */
export function chosenName(path: string): string {
  let p = path;
  try {
    p = decodeURIComponent(path);
  } catch {
    /* adresse déjà lisible */
  }
  return p.split(/[\\/:]/).filter(Boolean).pop() ?? path;
}

/** UTF-8, sinon Windows-1252 (Excel enregistre souvent ainsi). */
function decodeText(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

/** Application mobile : la WebView ne sait pas enregistrer un fichier. */
export function noFileInApp() {
  notify("info", tl("L'application mobile ne peut pas enregistrer de fichier. Exportez depuis un PC de la boutique, ou ouvrez l'adresse de la boutique dans Chrome."));
}

/** Téléchargement par le navigateur (téléphone, tablette, PC sans le logiciel). */
export function browserDownload(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/** Enregistre un fichier CSV : boîte « Enregistrer sous » sur le PC, téléchargement dans un navigateur.
 *  Retourne false si annulé (ou impossible dans l'application mobile). */
export async function exportCsv(defaultName: string, contents: string): Promise<boolean> {
  if (!isTauri) {
    if (inAppWebView()) {
      noFileInApp();
      return false;
    }
    browserDownload(defaultName, new Blob([contents], { type: "text/csv;charset=utf-8" }));
    return true;
  }
  const path = await save({
    title: tl("Exporter en CSV"),
    defaultPath: defaultName,
    filters: [{ name: "Fichier CSV (Excel)", extensions: ["csv"] }],
  });
  if (!path) return false;
  await writeChosenText(path, contents);
  return true;
}

/** Choisit un fichier CSV et le lit : boîte « Ouvrir » sur le PC, sélecteur de fichiers dans un navigateur
 *  ou dans l'application mobile. Excel enregistre souvent en Windows-1252 : lu comme tel si ce n'est pas de l'UTF-8. */
export async function pickTextFile(): Promise<{ name: string; text: string } | null> {
  if (isMobileApp) {
    // Android range les CSV sous plusieurs types : pas de filtre, pour que le fichier reste visible.
    const path = await open({ multiple: false });
    if (!path || Array.isArray(path)) return null;
    const bytes = await readFile(path);
    if (bytes.length > 20 * 1024 * 1024) throw new Error(tl("Fichier trop volumineux (20 Mo maximum)."));
    return { name: chosenName(path), text: decodeText(bytes) };
  }
  if (isTauri) {
    const path = await open({ multiple: false, filters: [{ name: "Fichier CSV", extensions: ["csv", "txt"] }] });
    if (!path || Array.isArray(path)) return null;
    return { name: path.split(/[\\/]/).pop() ?? path, text: await api.readTextFile(path) };
  }
  const file = await new Promise<File | null>((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".csv,.txt,text/csv,text/plain";
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.addEventListener("cancel", () => resolve(null));
    input.click();
  });
  if (!file) return null;
  if (file.size > 20 * 1024 * 1024) throw new Error(tl("Fichier trop volumineux (20 Mo maximum)."));
  return { name: file.name, text: decodeText(new Uint8Array(await file.arrayBuffer())) };
}
