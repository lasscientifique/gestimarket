import { convertFileSrc } from "@tauri-apps/api/core";
import { api } from "../api";
import { open } from "@tauri-apps/plugin-dialog";
import { readFile } from "@tauri-apps/plugin-fs";
import { chosenName } from "./files";
import { getToken, isMobileApp, isRemote, isTauri, remoteUrl } from "./transport";

/** URL d'une photo stockée dans la base (servie par le protocole « media » côté Rust). */
export function mediaUrl(id: number | null | undefined): string | undefined {
  if (!id) return undefined;
  // Depuis Internet, le poste serveur exige la session pour servir les photos.
  if (isRemote()) {
    const t = getToken();
    return remoteUrl(`/media/${id}${t ? `?t=${encodeURIComponent(t)}` : ""}`);
  }
  if (!isTauri) return undefined;
  try {
    return convertFileSrc(String(id), "media");
  } catch {
    return undefined;
  }
}

/** Ouvre le sélecteur de fichiers et retourne l'image choisie. */
export function pickImageFile(): Promise<File | null> {
  if (isMobileApp) return pickImageInApp();
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/png,image/jpeg,image/webp,image/gif";
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.oncancel = () => resolve(null);
    input.click();
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Image illisible."));
    img.src = src;
  });
}

/**
 * Redimensionne une image (côté le plus long = maxSize) et l'encode en JPEG (ou PNG si transparence utile),
 * pour garder une base légère : une photo produit pèse ~20–40 Ko.
 */
export async function compressImage(file: Blob, maxSize = 600, keepPng = false): Promise<{ mime: string; data: string }> {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d")!;
    const mime = keepPng ? "image/png" : "image/jpeg";
    if (!keepPng) {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, w, h);
    }
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, 0, 0, w, h);
    const data = canvas.toDataURL(mime, 0.85);
    return { mime, data: data.split(",")[1] };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Sélection + compression + envoi. Retourne l'identifiant de la photo, ou null si annulé. */
export async function chooseAndUploadImage(opts: { maxSize?: number; keepPng?: boolean } = {}): Promise<number | null> {
  const file = await pickImageFile();
  if (!file) return null;
  const { mime, data } = await compressImage(file, opts.maxSize ?? 600, opts.keepPng ?? false);
  return api.uploadImage(mime, data);
}

/** Application installée sur téléphone ou tablette : galerie ou fichiers du système, lus par le module fs. */
async function pickImageInApp(): Promise<File | null> {
  const path = await open({ multiple: false, filters: [{ name: "Image", extensions: ["png", "jpg", "jpeg", "webp", "gif"] }] });
  if (!path || Array.isArray(path)) return null;
  const name = chosenName(path);
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  const type = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : ext === "gif" ? "image/gif" : "image/jpeg";
  return new File([await readFile(path)], name, { type });
}
