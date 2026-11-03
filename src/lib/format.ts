import type { Role } from "../types";
import { getLang, locale, tl, tm, ts } from "./i18n";

// ───────────── Devise ─────────────
// Les montants circulent en entiers (plus petite unité). `decimals` = 0 pour le FCFA, 2 pour l'euro.

let currency = { symbol: "FCFA", decimals: 0, before: false };

/** Devise de la boutique : symbole, décimales (0 à 3) et place du symbole (« $ 12 » ou « 12 FCFA »). */
export function configureCurrency(symbol: string, decimals: number, position?: string) {
  currency = { symbol: symbol || "FCFA", decimals: Number.isFinite(decimals) ? decimals : 0, before: position === "before" };
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
    .toLocaleString(locale(), {
      minimumFractionDigits: currency.decimals,
      maximumFractionDigits: currency.decimals,
    })
    // Espace fine insécable → espace insécable classique (rendu homogène selon les polices).
    .replace(/ /g, " ");
  if (!withSymbol) return s;
  return currency.before ? `${currency.symbol}\u00a0${s}` : `${s}\u00a0${currency.symbol}`;
}

// ───────────── Nombres ─────────────

/** Saisie « 1 500,50 », « 1,500.50 » ou « 0,75 » → nombre (virgule ou point décimal). */
export function parseNumber(value: string): number {
  if (value == null) return NaN;
  let s = String(value).replace(/[\s\u00a0\u202f']/g, "");
  if (s === "") return NaN;
  const comma = s.lastIndexOf(",");
  const dot = s.lastIndexOf(".");
  if (comma >= 0 && dot >= 0) {
    // Le dernier séparateur est le séparateur décimal.
    s = comma > dot ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  } else if (comma >= 0) {
    // Anglais : « 1,500 » = mille cinq cents ; sinon la virgule est décimale.
    s = getLang() === "en" && /^-?\d{1,3}(,\d{3})+$/.test(s) ? s.replace(/,/g, "") : s.replace(",", ".");
  }
  return Number(s);
}

export function qty(n: number): string {
  return (n || 0).toLocaleString(locale(), { maximumFractionDigits: 3 }).replace(/ /g, " ");
}

export function percent(n: number, digits = 1): string {
  return `${n.toLocaleString(locale(), { maximumFractionDigits: digits })} %`;
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
  return d.toLocaleDateString(locale(), { weekday: "short", day: "2-digit" });
}

// ───────────── Libellés ─────────────

/** Moyens de paiement (texte source français, traduit à l'affichage). */
const PAYMENT_SOURCE: Record<string, string> = {
  cash: "Espèces",
  orange_money: "Orange Money / Sarali",
  mobile_money: "Autre mobile money",
  card: "Carte bancaire",
  credit: "Crédit client",
  other: "Autre",
  mixed: "Paiement mixte",
  credit_note: "Avoir",
  debt: "Déduit de la dette du client",
};
/** Libellés choisis par la boutique (opérateurs de mobile money…) : affichés tels quels. */
let customPayments: Record<string, string> = {};
let activeOperators: string[] = [];

/** `active` : modes « mm:<id> » des opérateurs proposés en caisse. */
export function configurePaymentLabels(labels: Record<string, string>, active: string[] = []) {
  customPayments = labels;
  activeOperators = active;
}

/** Opérateurs de mobile money actifs (« mm:<id> »), pour les nouveaux encaissements. */
export function operatorMethods(): string[] {
  return activeOperators;
}

export function paymentLabel(m: string | null | undefined): string {
  if (!m) return "—";
  return customPayments[m] ?? (PAYMENT_SOURCE[m] ? tl(PAYMENT_SOURCE[m]) : m);
}

/** Codes des moyens de paiement connus, opérateurs de la boutique compris (listes de filtres). */
export function paymentMethods(): string[] {
  return [...Object.keys(PAYMENT_SOURCE), ...Object.keys(customPayments).filter((k) => k.startsWith("mm:"))];
}

/** Libellé imprimé sur le ticket (langue de la boutique). */
export function paymentLabelShop(m: string | null | undefined): string {
  if (!m) return "—";
  return customPayments[m] ?? (PAYMENT_SOURCE[m] ? ts(PAYMENT_SOURCE[m]) : m);
}

// ───────────── Emplacements ─────────────

type LocationLike = { bloc?: string | null; etage?: string | null; rangee?: string | null; fixture_name?: string | null };

/** « Réfrigérateur FR1 · Étage 3 · Case 2 » ; court : « FR1·É3·C2 ». */
export function locationText(l: LocationLike | null | undefined, short = false): string {
  if (!l || !l.bloc) return short ? "—" : tl("Non rangé");
  const parts = short
    ? [blocShort(l.bloc), l.etage ? tl("É{0}", [l.etage]) : "", l.rangee ? tl("C{0}", [l.rangee]) : ""]
    : [l.fixture_name ? tm(l.fixture_name) : tl("Meuble {0}", [l.bloc]), l.etage ? tl("Étage {0}", [l.etage]) : "", l.rangee ? tl("Case {0}", [l.rangee]) : ""];
  return parts.filter(Boolean).join(short ? "·" : " · ");
}

/** Code court d'un meuble : « FR1 » reste « FR1 » ; un ancien bloc numéroté « 2 » devient « R2 ». */
export function blocShort(bloc: string): string {
  return /^\d+$/.test(bloc) ? `R${bloc}` : bloc;
}

/** Nombre de jours entre aujourd'hui et une date AAAA-MM-JJ (négatif si dépassée). */
export function daysUntil(date: string): number {
  const d = new Date(date + "T00:00:00");
  const t = new Date();
  t.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - t.getTime()) / 86400000);
}

export const ROLE_LABELS: Record<Role, string> = {
  admin: tl("Administrateur"),
  manager: tl("Gestionnaire"),
  cashier: tl("Caissier / Caissière"),
};

export const MOVEMENT_LABELS: Record<string, string> = {
  initial: tl("Stock initial"),
  sale: tl("Vente"),
  sale_cancel: tl("Annulation vente"),
  purchase: tl("Réception achat"),
  adjustment: tl("Ajustement / inventaire"),
  loss: tl("Perte / casse"),
  return: tl("Retour client"),
};

export const UNITS = ["pce", "kg", "g", "L", "cl", "m", "paquet", "carton", "sac", "boîte", "bouteille"];

/** Unités de mesure regroupées par famille. */
export const UNIT_GROUPS: { label: string; units: string[] }[] = [
  { label: tl("Quantité"), units: ["pce", "unité", "lot", "paire"] },
  { label: tl("Poids"), units: ["kg", "g", "mg", "tonne"] },
  { label: tl("Volume"), units: ["L", "ml", "cl", "m³"] },
  { label: tl("Longueur"), units: ["m", "cm", "mm", "km"] },
  { label: tl("Conditionnement"), units: ["carton", "paquet", "sachet", "boîte", "pack"] },
  { label: tl("Alimentaire"), units: ["sac", "bassine", "mesure", "tas"] },
  { label: tl("Boissons"), units: ["bouteille", "bidon", "canette", "casier"] },
  { label: tl("Matériaux"), units: ["barre", "rouleau", "palette", "brouette", "voyage"] },
  { label: tl("Tissus"), units: ["mètre", "coupon", "yard"] },
  { label: tl("Électricité"), units: ["bobine", "couronne"] },
  { label: tl("Restauration"), units: ["plat", "portion", "part", "verre"] },
];

/** Taux de taxe nommés de la boutique (paramètre « tax_rates » : une ligne « Nom=taux »). */
export function taxRates(setting: string | undefined): { name: string; rate: number }[] {
  return (setting ?? "")
    .split(/\r?\n/)
    .map((l) => l.split("="))
    .filter((p) => p.length === 2 && p[0].trim() && Number.isFinite(parseNumber(p[1])))
    .map(([name, rate]) => ({ name: name.trim(), rate: parseNumber(rate) }));
}

/** Libellés des fonctions activables selon le type de commerce. */
export const FEATURE_LABELS: Record<string, { label: string; hint: string }> = {
  expiry: { label: tl("Dates de péremption"), hint: tl("Alertes sur les produits qui périment bientôt.") },
  brand: { label: tl("Marques"), hint: tl("Champ « Marque » sur les produits, recherche par marque.") },
  sku: { label: tl("Référence interne"), hint: tl("Code article interne (ex. RIZ-001), en plus du code-barres.") },
  packagings: { label: tl("Conditionnements"), hint: tl("Vente au carton, au sac, au pack… avec conversion automatique (1 carton = 12 bouteilles).") },
  decimal: { label: tl("Quantités décimales"), hint: tl("Vente au poids ou au mètre (0,5 kg, 2,75 m).") },
  services: { label: tl("Services / plats"), hint: tl("Articles sans stock : réparations, plats, prestations.") },
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
