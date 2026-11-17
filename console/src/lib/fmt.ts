// Mise en forme : montants en FCFA, dates à la française, libellés.

export const money = (n: number | null | undefined, currency = "FCFA") =>
  `${Math.round(Number(n ?? 0)).toLocaleString("fr-FR").replace(/ | /g, " ")} ${currency === "XOF" || currency === "XAF" || !currency ? "FCFA" : currency}`;

export function dateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${d.toLocaleDateString("fr-FR")} ${d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`;
}

export function dateOnly(iso: string | null | undefined): string {
  return iso ? new Date(iso).toLocaleDateString("fr-FR") : "—";
}

/** « il y a 5 min », « dans 3 j ». */
export function ago(iso: string | null | undefined): string {
  if (!iso) return "jamais";
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  const a = Math.abs(s);
  const v = a < 60 ? "quelques s" : a < 3600 ? `${Math.round(a / 60)} min` : a < 86400 ? `${Math.round(a / 3600)} h` : `${Math.round(a / 86400)} j`;
  return s >= 0 ? `il y a ${v}` : `dans ${v}`;
}

export function daysLeft(iso: string | null | undefined): number | null {
  if (!iso) return null;
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000);
}

export const METHOD: Record<string, string> = {
  carte_bon: "Carte de bon",
  orange_money: "Orange Money",
  wave: "Wave",
  moov_money: "Moov Money",
  carte_visa: "Carte Visa",
  virement: "Virement",
  especes: "Espèces",
  offert: "Offerte",
  autre: "Autre",
};

export const PAY_STATUS: Record<string, [string, Tone]> = {
  declared: ["À valider", "warning"],
  validated: ["Validé", "success"],
  refused: ["Refusé", "danger"],
  pending: ["Paiement en cours", "info"],
};

export const VOUCHER_STATUS: Record<string, [string, Tone]> = {
  new: ["En stock", "info"],
  sold: ["Remise / vendue", "warning"],
  used: ["Utilisée", "success"],
  cancelled: ["Annulée", "danger"],
};

export const SALE_STATUS: Record<string, [string, Tone]> = {
  waiting: ["En attente du client", "warning"],
  sending: ["Envoi…", "info"],
  sent: ["Envoyée", "info"],
  delivered: ["Remise", "info"],
  read: ["Lue", "success"],
  used: ["Utilisée", "success"],
  failed: ["Non envoyée", "danger"],
  cancelled: ["Annulée", "default"],
};

export const SOURCE: Record<string, string> = {
  trial: "Essai",
  payment: "Paiement",
  voucher: "Carte de bon",
  manual: "Eden Dev",
};

export const ROLE: Record<string, string> = { direction: "Direction", paiements: "Paiements", assistance: "Assistance" };

export type Tone = "default" | "info" | "success" | "warning" | "danger";

export const EVENT: Record<string, string> = {
  subscription_activated: "Abonnement activé",
  payment_declared: "Paiement déclaré",
  payment_validated: "Paiement validé",
  payment_refused: "Paiement refusé",
  payment_pending: "Paiement commencé",
  voucher_used: "Carte de bon utilisée",
  voucher_failed: "Carte de bon refusée",
  license_issued: "Licence émise",
  licence_reset: "Licence refaite",
  pc_registered: "PC relié",
  pc_freed: "Place de PC libérée",
  gift: "Jours offerts",
  plan_changed: "Formule changée",
  store_suspended: "Boutique suspendue",
  store_reactivated: "Boutique réactivée",
};

/** Fichier CSV (séparateur « ; », lisible par Excel en français). */
export function toCsv(rows: Record<string, unknown>[], columns: [string, string][]): string {
  const cell = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return "﻿" + [columns.map(([, h]) => cell(h)).join(";"), ...rows.map((r) => columns.map(([k]) => cell(r[k])).join(";"))].join("\r\n");
}
