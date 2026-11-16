// Couleurs et tailles des produits : palette commune à GestiMarket, au moteur (`src-tauri/data/couleurs.txt`)
// et au site Sugu Eden, et types de taille (second axe) avec des valeurs proposées.
// Ce fichier ne dépend pas de l'interface de GestiMarket : le site Sugu Eden l'importe aussi.
import type { CSSProperties } from "react";
import RAW from "../../src-tauri/data/couleurs.txt?raw";

export type VariantLang = "fr" | "en";

export interface PaletteColor {
  /** Code enregistré (« bleu-marine ») : ne change jamais. */
  code: string;
  fr: string;
  en: string;
  /** Teinte (« #1b2a4a ») ; vide pour un motif (multicolore, imprimé, transparent). */
  hex: string;
}

export const COLORS: PaletteColor[] = RAW.split(/\r?\n/)
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith("#"))
  .map((l) => {
    const [code, fr, en, hex = ""] = l.split(";");
    return { code, fr, en, hex };
  });

export const colorOf = (code: string | null | undefined): PaletteColor | undefined => COLORS.find((c) => c.code === code);

export function colorName(code: string | null | undefined, lang: VariantLang = "fr"): string {
  const c = colorOf(code);
  return c ? c[lang] : code ?? "";
}

/** Pastille de couleur : teinte, ou motif pour multicolore, imprimé et transparent. */
export function swatchStyle(code: string | null | undefined): CSSProperties {
  const c = colorOf(code);
  if (c?.hex) return { background: c.hex };
  if (code === "multicolore") return { background: "conic-gradient(#d32f2f, #fbc02d, #2e7d32, #1e63d6, #7b1fa2, #d32f2f)" };
  if (code === "imprime") return { background: "repeating-linear-gradient(45deg, #f57c00 0 4px, #1b2a4a 4px 8px, #fbc02d 8px 12px)" };
  if (code === "transparent") return { background: "repeating-conic-gradient(#d0d0d0 0 25%, #ffffff 0 50%) 0 0 / 8px 8px" };
  return { background: "#cccccc" };
}

export interface Axis {
  code: string;
  fr: string;
  en: string;
  /** Valeurs proposées d'un clic (la boutique peut en taper d'autres). */
  presets: string[];
  presetsEn?: string[];
}

const range = (from: number, to: number, step = 1) => Array.from({ length: Math.floor((to - from) / step) + 1 }, (_, i) => String(from + i * step));

export const AXES: Axis[] = [
  { code: "size", fr: "Taille", en: "Size", presets: ["XS", "S", "M", "L", "XL", "XXL", "3XL", "4XL", ...range(36, 54, 2)] },
  { code: "shoe", fr: "Pointure", en: "Shoe size", presets: range(35, 47) },
  {
    code: "age",
    fr: "Âge",
    en: "Age",
    presets: ["0-3 mois", "3-6 mois", "6-12 mois", "12-18 mois", "18-24 mois", "2 ans", "3 ans", "4 ans", "5 ans", "6 ans", "8 ans", "10 ans", "12 ans", "14 ans"],
    presetsEn: ["0-3 months", "3-6 months", "6-12 months", "12-18 months", "18-24 months", "2 years", "3 years", "4 years", "5 years", "6 years", "8 years", "10 years", "12 years", "14 years"],
  },
  {
    code: "storage",
    fr: "Capacité",
    en: "Storage",
    presets: ["16 Go", "32 Go", "64 Go", "128 Go", "256 Go", "512 Go", "1 To"],
    presetsEn: ["16 GB", "32 GB", "64 GB", "128 GB", "256 GB", "512 GB", "1 TB"],
  },
  { code: "volume", fr: "Contenance", en: "Volume", presets: ["30 ml", "50 ml", "100 ml", "150 ml", "250 ml", "500 ml", "1 L"] },
  { code: "model", fr: "Modèle", en: "Model", presets: [] },
];

export const axisOf = (code: string | null | undefined): Axis | undefined => AXES.find((a) => a.code === code);

export function axisName(code: string | null | undefined, lang: VariantLang = "fr"): string {
  const a = axisOf(code);
  return a ? a[lang] : "";
}

export function axisPresets(code: string | null | undefined, lang: VariantLang = "fr"): string[] {
  const a = axisOf(code);
  if (!a) return [];
  return lang === "en" && a.presetsEn ? a.presetsEn : a.presets;
}

/** « Rouge, M » */
export function variantLabel(v: { color: string | null; size: string | null }, lang: VariantLang = "fr"): string {
  return [v.color ? colorName(v.color, lang) : null, v.size].filter(Boolean).join(", ");
}
