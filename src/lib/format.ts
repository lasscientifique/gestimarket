import type { Role } from "../types";

// ───────────── Devise ─────────────
// Les montants circulent en entiers (plus petite unité). `decimals` = 0 pour le FCFA, 2 pour l'euro.

let currency = { symbol: "FCFA", decimals: 0 };

export function configureCurrency(symbol: string, decimals: number) {
  currency = { symbol: symbol || "FCFA", decimals: Number.isFinite(decimals) ? decimals : 0 };
}

export function currencySymbol() {
  return currency.symbol;
}

export function currencyDecimals() {
  return currency.decimals;
}

/** Montant en unité mineure → nombre décimal. */
export function fromMinor(minor: number): number {
  return minor / 10 ** currency.decimals;
}

/** Saisie utilisateur (« 1 500,50 ») → entier en unité mineure. */
export function toMinor(value: string | number): number {
  const n = typeof value === "number" ? value : parseNumber(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 10 ** currency.decimals);
}

/** Valeur numérique pour un champ de saisie (sans séparateur de milliers). */
export function minorToInput(minor: number): string {
  const v = fromMinor(minor);
  return currency.decimals > 0 ? v.toFixed(currency.decimals) : String(Math.round(v));
}

export function money(minor: number, withSymbol = true): string {
  const value = fromMinor(minor) || 0; // évite l'affichage de « -0 »
  const s = value
    .toLocaleString("fr-FR", {
      minimumFractionDigits: currency.decimals,
      maximumFractionDigits: currency.decimals,
    })
    // Espace fine insécable → espace insécable classique (rendu homogène selon les polices).
    .replace(/ /g, " ");
  return withSymbol ? `${s} ${currency.symbol}` : s;
}

// ───────────── Nombres ─────────────

export function parseNumber(value: string): number {
  if (value == null) return NaN;
  const cleaned = String(value).replace(/\s/g, "").replace(/ /g, "").replace(",", ".");
  if (cleaned === "") return NaN;
  return Number(cleaned);
}

export function qty(n: number): string {
  return (n || 0).toLocaleString("fr-FR", { maximumFractionDigits: 3 }).replace(/ /g, " ");
}

export function percent(n: number, digits = 1): string {
  return `${n.toLocaleString("fr-FR", { maximumFractionDigits: digits })} %`;
}

// ───────────── Dates ─────────────

export function isoDate(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function addDays(d: Date, n: number): Date {
  const c = new Date(d);
  c.setDate(c.getDate() + n);
  return c;
}

/** « 2026-10-31 14:05:00 » → « 31/10/2026 14:05 » */
export function dateTime(s: string | null | undefined): string {
  if (!s) return "—";
  const [d, t] = s.split(" ");
  const [y, m, day] = d.split("-");
  return `${day}/${m}/${y}${t ? " " + t.slice(0, 5) : ""}`;
}

export function dateOnly(s: string | null | undefined): string {
  if (!s) return "—";
  const [y, m, day] = s.slice(0, 10).split("-");
  return `${day}/${m}/${y}`;
}

export function shortDay(s: string): string {
  const d = new Date(s + "T00:00:00");
  return d.toLocaleDateString("fr-FR", { weekday: "short", day: "2-digit" });
}

// ───────────── Libellés ─────────────

export const PAYMENT_LABELS: Record<string, string> = {
  cash: "Espèces",
  orange_money: "Orange Money / Sarali",
  mobile_money: "Autre mobile money",
  card: "Carte bancaire",
  credit: "Crédit client",
  other: "Autre",
  mixed: "Paiement mixte",
};

/** Personnalise le libellé d'Orange Money (paramètre « om_label »). */
export function configurePaymentLabels(omLabel?: string) {
  if (omLabel && omLabel.trim()) PAYMENT_LABELS.orange_money = omLabel.trim();
}

export function paymentLabel(m: string | null | undefined): string {
  return (m && PAYMENT_LABELS[m]) || m || "—";
}

// ───────────── Emplacements ─────────────

export function locationText(l: { bloc?: string | null; etage?: string | null; rangee?: string | null } | null | undefined, short = false): string {
  if (!l || !l.bloc) return short ? "—" : "Non rangé";
  const parts = short
    ? [blocShort(l.bloc), l.etage ? `É${l.etage}` : "", l.rangee ? `R${l.rangee}` : ""]
    : [`Bloc ${l.bloc}`, l.etage ? `Étage ${l.etage}` : "", l.rangee ? `Rangée ${l.rangee}` : ""];
  return parts.filter(Boolean).join(short ? "·" : " · ");
}

/** « A » reste « A » ; un bloc numéroté « 2 » devient « B2 ». */
export function blocShort(bloc: string): string {
  return /^\d+$/.test(bloc) ? `B${bloc}` : bloc;
}

/** Nombre de jours entre aujourd'hui et une date AAAA-MM-JJ (négatif si dépassée). */
export function daysUntil(date: string): number {
  const d = new Date(date + "T00:00:00");
  const t = new Date();
  t.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - t.getTime()) / 86400000);
}

export const ROLE_LABELS: Record<Role, string> = {
  admin: "Administrateur",
  manager: "Gestionnaire",
  cashier: "Caissier / Caissière",
};

export const MOVEMENT_LABELS: Record<string, string> = {
  initial: "Stock initial",
  sale: "Vente",
  sale_cancel: "Annulation vente",
  purchase: "Réception achat",
  adjustment: "Ajustement / inventaire",
  loss: "Perte / casse",
  return: "Retour client",
};

export const UNITS = ["pce", "kg", "g", "L", "cl", "m", "paquet", "carton", "sac", "boîte", "bouteille"];

/** Unités de mesure regroupées par famille. */
export const UNIT_GROUPS: { label: string; units: string[] }[] = [
  { label: "Quantité", units: ["pce", "unité", "lot", "paire"] },
  { label: "Poids", units: ["kg", "g", "mg", "tonne"] },
  { label: "Volume", units: ["L", "ml", "cl", "m³"] },
  { label: "Longueur", units: ["m", "cm", "mm", "km"] },
  { label: "Conditionnement", units: ["carton", "paquet", "sachet", "boîte", "pack"] },
  { label: "Alimentaire", units: ["sac", "bassine", "mesure", "tas"] },
  { label: "Boissons", units: ["bouteille", "bidon", "canette", "casier"] },
  { label: "Matériaux", units: ["barre", "rouleau", "palette", "brouette", "voyage"] },
  { label: "Tissus", units: ["mètre", "coupon", "yard"] },
  { label: "Électricité", units: ["bobine", "couronne"] },
  { label: "Restauration", units: ["plat", "portion", "part", "verre"] },
];

/** Libellés des fonctions activables selon le type de commerce. */
export const FEATURE_LABELS: Record<string, { label: string; hint: string }> = {
  expiry: { label: "Dates de péremption", hint: "Alertes sur les produits qui périment bientôt." },
  brand: { label: "Marques", hint: "Champ « Marque » sur les produits, recherche par marque." },
  sku: { label: "Référence interne", hint: "Code article interne (ex. RIZ-001), en plus du code-barres." },
  packagings: { label: "Conditionnements", hint: "Vente au carton, au sac, au pack… avec conversion automatique (1 carton = 12 bouteilles)." },
  decimal: { label: "Quantités décimales", hint: "Vente au poids ou au mètre (0,5 kg, 2,75 m)." },
  services: { label: "Services / plats", hint: "Articles sans stock : réparations, plats, prestations." },
};

// ───────────── Export CSV (compatible Excel FR) ─────────────

export function toCsv(headers: string[], rows: (string | number | null | undefined)[][]): string {
  const esc = (v: string | number | null | undefined) => {
    const s = v == null ? "" : String(v);
    return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return "﻿" + [headers, ...rows].map((r) => r.map(esc).join(";")).join("\r\n");
}

/** Montant pour export CSV (virgule décimale). */
export function csvMoney(minor: number): string {
  return fromMinor(minor).toFixed(currency.decimals).replace(".", ",");
}
