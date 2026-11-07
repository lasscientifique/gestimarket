import type { Sale, Settings } from "../types";
import { customerLines, dateTime, money, paymentLabelShop, qty } from "./format";
import { ts } from "./i18n";

/**
 * Tickets pour imprimante thermique (ESC/POS), envoyés directement à l'imprimante de ce poste :
 * pas de fenêtre d'impression, coupe du papier, ouverture du tiroir-caisse.
 * Texte en page de code PC850 (accents français), 32 caractères en 58 mm, 48 en 80 mm.
 */

const ESC = 0x1b;
const GS = 0x1d;

/** Page de code PC850, octets 0x80 à 0xFF. */
const CP850_HIGH =
  "ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜø£Ø×ƒáíóúñÑªº¿®¬½¼¡«»░▒▓│┤ÁÂÀ©╣║╗╝¢¥┐└┴┬├─┼ãÃ╚╔╩╦╠═╬¤ðÐÊËÈıÍÎÏ┘┌█▄¦Ì▀ÓßÔÒõÕµþÞÚÛÙýÝ¯´­±‗¾¶§÷¸°¨·¹³²■ ";
const CP850 = new Map<string, number>(Array.from(CP850_HIGH, (c, i) => [c, 0x80 + i]));

/** Texte → octets PC850 (lettres absentes : sans accent, « € » → « EUR »). */
export function encodeCp850(text: string): number[] {
  const out: number[] = [];
  const clean = text.replace(/[   ]/g, " ").replace(/€/g, "EUR").replace(/[’‘]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, "-").replace(/…/g, "...");
  for (const ch of clean) {
    const code = ch.codePointAt(0) ?? 63;
    if (code >= 0x20 && code < 0x7f) out.push(code);
    else if (ch === "\n") out.push(0x0a);
    else if (CP850.has(ch)) out.push(CP850.get(ch)!);
    else {
      const plain = ch.normalize("NFD").replace(/[̀-ͯ]/g, "");
      out.push(...(plain && plain.charCodeAt(0) < 0x7f ? [plain.charCodeAt(0)] : [0x3f]));
    }
  }
  return out;
}

/** Nombre de caractères par ligne (police A). */
export const lineWidth = (settings: Settings) => (settings.receipt_width === "58" ? 32 : 48);

class Ticket {
  bytes: number[] = [ESC, 0x40, ESC, 0x74, 2]; // initialisation, page de code PC850
  constructor(readonly width: number) {}
  raw(...b: number[]) {
    this.bytes.push(...b);
    return this;
  }
  text(s: string) {
    this.bytes.push(...encodeCp850(s), 0x0a);
    return this;
  }
  align(a: "left" | "center") {
    return this.raw(ESC, 0x61, a === "center" ? 1 : 0);
  }
  bold(on: boolean) {
    return this.raw(ESC, 0x45, on ? 1 : 0);
  }
  /** Taille : 0 normal, 1 double hauteur, 2 double hauteur et largeur. */
  size(n: 0 | 1 | 2) {
    return this.raw(GS, 0x21, n === 2 ? 0x11 : n === 1 ? 0x01 : 0);
  }
  /** Texte long coupé en lignes de la largeur du ticket. */
  wrap(s: string, width = this.width) {
    for (const para of s.split(/\r?\n/)) {
      let line = "";
      for (const word of para.split(/\s+/).filter(Boolean)) {
        const w = word.length > width ? word.slice(0, width) : word;
        if (line && line.length + 1 + w.length > width) {
          this.text(line);
          line = w;
        } else line = line ? `${line} ${w}` : w;
      }
      if (line) this.text(line);
    }
    return this;
  }
  /** Libellé à gauche, montant à droite. */
  row(label: string, value: string, width = this.width) {
    const v = value.replace(/[  ]/g, " ");
    const room = Math.max(1, width - v.length - 1);
    const l = label.length > room ? label.slice(0, room) : label;
    return this.text(l + " ".repeat(Math.max(1, width - l.length - v.length)) + v);
  }
  sep() {
    return this.text("-".repeat(this.width));
  }
  /** Ouvre le tiroir-caisse branché sur l'imprimante (impulsion sur la broche 2). */
  drawer() {
    return this.raw(ESC, 0x70, 0, 25, 250);
  }
  /** Avance le papier puis le coupe. */
  cut() {
    return this.raw(ESC, 0x64, 4, GS, 0x56, 66, 0);
  }
  /** Code-barres dessiné par l'imprimante, chiffres en dessous : EAN-13 s'il est valide, sinon Code 128. */
  barcode(code: string) {
    this.raw(GS, 0x48, 2, GS, 0x68, 64, GS, 0x77, 2);
    if (isEan13(code)) this.raw(GS, 0x6b, 67, 13, ...Array.from(code, (c) => c.charCodeAt(0)));
    else {
      const data = encodeCp850(code).filter((b) => b >= 0x20 && b < 0x7f).slice(0, 60);
      this.raw(GS, 0x6b, 73, data.length + 2, 0x7b, 0x42, ...data);
    }
    return this.raw(0x0a);
  }
}

function isEan13(code: string) {
  if (!/^\d{13}$/.test(code)) return false;
  const d = Array.from(code, Number);
  const sum = d.slice(0, 12).reduce((s, x, i) => s + x * (i % 2 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === d[12];
}

/** Étiquette imprimée sur l'imprimante à tickets (une étiquette par coupe). */
export interface LabelItem {
  name: string;
  price: string;
  unit: string;
  code: string | null;
  place: string;
}

/** Étiquettes de rayon (boutique, case, nom, prix, code-barres) ou étiquettes produit, l'une après l'autre. */
export function labelsEscpos(items: LabelItem[], settings: Settings, kind: "shelf" | "product"): Uint8Array {
  const t = new Ticket(lineWidth(settings));
  for (const it of items) {
    if (kind === "shelf") t.align("left").row(settings.shop_name || "GestiMarket", it.place);
    t.align("center").bold(true).wrap(it.name).bold(false);
    t.size(2).bold(true).text(it.price).size(0).bold(false);
    if (kind === "shelf") t.text(`/ ${it.unit}`);
    if (it.code) t.barcode(it.code);
    t.cut();
  }
  return Uint8Array.from(t.bytes);
}

/** Ticket de vente (mêmes informations que le ticket imprimé par la fenêtre d'impression). */
export function receiptEscpos(sale: Sale, settings: Settings, opts: { drawer?: boolean } = {}): Uint8Array {
  const t = new Ticket(lineWidth(settings));
  if (opts.drawer) t.drawer();
  t.align("center").size(2).bold(true).wrap(settings.shop_name || "GestiMarket", Math.floor(t.width / 2)).size(0).bold(false);
  if (settings.shop_address) t.wrap(settings.shop_address);
  if (settings.shop_phone) t.text(`${ts("Tél :")} ${settings.shop_phone}`);
  if (settings.shop_tax_id) t.wrap(settings.shop_tax_id);
  t.align("left").sep();
  t.row(ts("Ticket"), sale.number).row(ts("Date"), dateTime(sale.created_at)).row(ts("Caissier"), sale.user_name);
  if (sale.customer_name) t.row(ts("Client"), sale.customer_name);
  if (sale.status === "cancelled") t.align("center").bold(true).text(`*** ${ts("VENTE ANNULÉE")} ***`).bold(false).align("left");
  t.sep();
  for (const i of sale.items) {
    t.wrap(i.product_name);
    t.row(`  ${qty(i.quantity)} ${i.unit} x ${money(i.unit_price, false)}`, money(i.total, false));
    if (i.regular_price && i.price_kind !== "retail") {
      t.text(`  ${i.price_kind === "promo" ? ts("Promo") : ts("Prix de gros")} (${ts("au lieu de")} ${money(i.regular_price, false)})`.slice(0, t.width));
    }
    if (i.discount > 0) t.row(`  ${ts("Remise")}`, `-${money(i.discount, false)}`);
  }
  t.sep();
  if (sale.discount > 0) t.row(ts("Sous-total"), money(sale.subtotal)).row(ts("Remise"), `-${money(sale.discount)}`);
  t.bold(true).size(1).row(ts("TOTAL"), money(sale.total)).size(0).bold(false);
  if (sale.tax_total > 0 && settings.prices_include_tax === "0") t.row(ts("Total HT"), money(sale.total - sale.tax_total)).row(ts("Taxe"), money(sale.tax_total));
  else if (sale.tax_total > 0) t.row(ts("dont TVA"), money(sale.tax_total));
  t.sep();
  for (const p of sale.payments) {
    t.row(paymentLabelShop(p.method) + (p.method === "cash" ? ` (${ts("reçu")})` : ""), money(p.method === "cash" ? p.tendered : p.amount));
    if (p.reference) t.text(`  ${ts("Réf.")} ${p.reference}${p.phone ? ` ${p.phone}` : ""}`.slice(0, t.width));
  }
  if (sale.change_due > 0) t.bold(true).row(ts("Monnaie rendue"), money(sale.change_due)).bold(false);
  if (sale.credit_amount > 0) t.bold(true).row(ts("Reste à crédit"), money(sale.credit_amount)).bold(false);
  // Compte et fidélité du client (étoiles en toutes lettres : les imprimantes thermiques n'ont pas « ★ »).
  for (const [label, value] of customerLines(sale, false)) t.row(label, value);
  const saved = sale.items.reduce((s, i) => s + (i.regular_price && i.price_kind !== "retail" ? Math.round((i.regular_price - i.unit_price) * i.quantity) : 0), 0);
  if (saved > 0) t.sep().bold(true).row(ts("Vous économisez"), money(saved)).bold(false);
  t.sep().align("center");
  if (settings.receipt_footer) t.wrap(settings.receipt_footer);
  t.text(`${ts("Articles :")} ${qty(sale.items.reduce((s, i) => s + i.quantity, 0))}`);
  return Uint8Array.from(t.cut().bytes);
}

/** Page de test : nom de l'imprimante, largeur, accents, coupe (et tiroir si demandé). */
export function testPageEscpos(settings: Settings, printer: string, drawer: boolean): Uint8Array {
  const t = new Ticket(lineWidth(settings));
  if (drawer) t.drawer();
  t.align("center").size(2).bold(true).text("GestiMarket").size(0).bold(false);
  t.text(ts("Page de test de l'imprimante"));
  t.wrap(printer);
  t.align("left").sep();
  t.text("1234567890".repeat(5).slice(0, t.width));
  t.text("àâäçéèêëîïôöûùü ÀÉÈÇ °");
  t.row(ts("Total"), money(123456));
  t.sep().align("center").text(new Date().toLocaleString());
  return Uint8Array.from(t.cut().bytes);
}

/** Tiroir-caisse seul. */
export function drawerEscpos(): Uint8Array {
  return Uint8Array.from(new Ticket(48).drawer().bytes);
}

export function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
