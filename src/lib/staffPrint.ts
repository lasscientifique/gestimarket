import type { Role, Settings } from "../types";
import { ROLE_LABELS } from "./format";
import { printHtml } from "./receipt";
import { ts } from "./i18n";

/** Fiche d'accès d'une personne : identifiant, code PIN et, pour l'accès Internet, le code d'accès téléphone. */
export interface AccessSheet {
  full_name: string;
  role: Role;
  username: string;
  pin?: string;
  code?: string;
  expires_at?: string;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Code d'accès lisible : ABCD-2345. */
export const formatCode = (code: string) => (code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code);

/** Imprime une fiche par personne (ticket de caisse), à lui remettre en main propre. */
export function printAccessSheets(settings: Settings, sheets: AccessSheet[]) {
  const width = Number(settings.receipt_width) === 58 ? 58 : 80;
  const html = sheets
    .map(
      (s) => `<div class="receipt access-sheet">
  <div class="r-center r-title">${esc(settings.shop_name || "GestiMarket")}</div>
  <div class="r-center r-small">${esc(ts("Fiche d'accès personnelle — à garder pour vous"))}</div>
  <div class="r-sep"></div>
  <div><strong>${esc(s.full_name)}</strong> · ${esc(ROLE_LABELS[s.role])}</div>
  <div>${esc(ts("Identifiant"))} : <strong class="r-big">${esc(s.username)}</strong></div>
  ${s.pin ? `<div>${esc(ts("Code PIN"))} : <strong class="r-big">${esc(s.pin)}</strong></div>` : ""}
  ${
    s.code
      ? `<div class="r-sep"></div>
  <div>${esc(ts("Code d'accès téléphone (Internet)"))} :</div>
  <div class="r-center r-big"><strong>${esc(formatCode(s.code))}</strong></div>
  <div class="r-small">${esc(ts("Une seule fois, sur votre téléphone, avant le {0}.", [s.expires_at ?? ""]))}</div>`
      : ""
  }
  <div class="r-sep"></div>
  <div class="r-small">${esc(ts("Connexion : votre identifiant et votre code PIN. Ne communiquez votre code à personne ; vous pouvez le changer (menu Mon code PIN)."))}</div>
</div>`,
    )
    .join('<div class="r-cut"></div>');
  printHtml(html, width);
}
