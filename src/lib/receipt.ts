import type { CreditNote, Sale, SaleReturn, Settings, ZData } from "../types";
import { barcodeSvg } from "../components/LabelsModal";
import { customerLines, dateTime, money, paymentLabelShop, qty } from "./format";
import { inAppWebView, notify } from "./device";
import { tl, ts } from "./i18n";
import { mediaUrl } from "./media";
import { receiptEscpos } from "./escpos";
import { printerConfig, sendToPrinter } from "./printer";
import { isMobileApp } from "./transport";

const esc = (s: string | null | undefined) =>
  (s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Construit le HTML d'un ticket de caisse (imprimante thermique 58 ou 80 mm). */
export function receiptHtml(sale: Sale, settings: Settings): string {
  const lines = sale.items
    .map(
      (i) => `
      <div class="r-item">
        <div class="r-name">${esc(i.product_name)}</div>
        <div class="r-row"><span>${qty(i.quantity)} ${esc(i.unit)} × ${money(i.unit_price, false)}</span><span>${money(i.total, false)}</span></div>
        ${i.regular_price && i.price_kind !== "retail"
          ? `<div class="r-row r-small"><span>${i.price_kind === "promo" ? ts("Promo") : ts("Prix de gros")} (${ts("au lieu de")} ${money(i.regular_price, false)})</span><span></span></div>`
          : ""}
        ${i.discount > 0 ? `<div class="r-row r-small"><span>${ts("Remise")}</span><span>-${money(i.discount, false)}</span></div>` : ""}
      </div>`,
    )
    .join("");
  const saved = sale.items.reduce((s, i) => s + (i.regular_price && i.price_kind !== "retail" ? Math.round((i.regular_price - i.unit_price) * i.quantity) : 0), 0);

  const row = (label: string, value: string, strong = false) =>
    `<div class="r-row ${strong ? "r-strong" : ""}"><span>${label}</span><span>${value}</span></div>`;

  return `
  <div class="receipt">
    <div class="r-center">
      ${settings.shop_logo_id ? `<img class="r-logo" src="${mediaUrl(Number(settings.shop_logo_id))}" alt="" />` : ""}
      <div class="r-title">${esc(settings.shop_name)}</div>
      ${settings.shop_address ? `<div>${esc(settings.shop_address)}</div>` : ""}
      ${settings.shop_phone ? `<div>${ts("Tél :")} ${esc(settings.shop_phone)}</div>` : ""}
      ${settings.shop_tax_id ? `<div>${esc(settings.shop_tax_id).replace(/\r?\n/g, "<br />")}</div>` : ""}
    </div>
    <div class="r-sep"></div>
    ${row(ts("Ticket"), esc(sale.number))}
    ${row(ts("Date"), dateTime(sale.created_at))}
    ${row(ts("Caissier"), esc(sale.user_name))}
    ${sale.customer_name ? row(ts("Client"), esc(sale.customer_name)) : ""}
    ${sale.status === "cancelled" ? `<div class="r-center r-strong">*** ${ts("VENTE ANNULÉE")} ***</div>` : ""}
    <div class="r-sep"></div>
    ${lines}
    <div class="r-sep"></div>
    ${sale.discount > 0 ? row(ts("Sous-total"), money(sale.subtotal)) + row(ts("Remise"), "-" + money(sale.discount)) : ""}
    ${row(ts("TOTAL"), money(sale.total), true)}
    ${sale.tax_total > 0 && settings.prices_include_tax === "0"
      ? row(ts("Total HT"), money(sale.total - sale.tax_total)) + row(ts("Taxe"), money(sale.tax_total))
      : sale.tax_total > 0
        ? row(ts("dont TVA"), money(sale.tax_total))
        : ""}
    <div class="r-sep"></div>
    ${sale.payments
      .map(
        (p) =>
          row(paymentLabelShop(p.method) + (p.method === "cash" ? ` (${ts("reçu")})` : ""), money(p.method === "cash" ? p.tendered : p.amount)) +
          (p.reference ? `<div class="r-row r-small"><span>${ts("Réf.")} ${esc(p.reference)}</span><span>${esc(p.phone)}</span></div>` : ""),
      )
      .join("")}
    ${sale.change_due > 0 ? row(ts("Monnaie rendue"), money(sale.change_due), true) : ""}
    ${sale.credit_amount > 0 ? row(ts("Reste à crédit"), money(sale.credit_amount), true) : ""}
    ${customerLines(sale)
      .map(([label, value]) => row(label, esc(value)))
      .join("")}
    ${saved > 0 ? `<div class="r-sep"></div>${row(ts("Vous économisez"), money(saved), true)}` : ""}
    <div class="r-sep"></div>
    <div class="r-center">${esc(settings.receipt_footer)}</div>
    <div class="r-center r-small">${ts("Articles :")} ${qty(sale.items.reduce((s, i) => s + i.quantity, 0))}</div>
  </div>`;
}

/** Imprime un contenu HTML via la boîte d'impression du système.
 *  L'application mobile (WebView) n'a pas de boîte d'impression : on le dit au lieu de ne rien faire. */
export function printHtml(html: string, widthMm?: number) {
  // Application installée sur téléphone ou tablette : pas de fenêtre d'impression du système.
  if (isMobileApp) {
    notify("info", tl("Sur téléphone ou tablette, les tickets sortent sur une imprimante réseau (Paramètres → Ventes). Les autres documents s'impriment depuis un PC de la boutique."));
    return;
  }
  if (inAppWebView()) {
    notify("info", tl("L'application mobile ne peut pas imprimer. Imprimez depuis un PC de la boutique, ou ouvrez l'adresse de la boutique dans Chrome."));
    return;
  }
  const root = document.getElementById("print-root");
  if (!root) return;
  root.innerHTML = html;
  let style = document.getElementById("print-page-style");
  if (!style) {
    style = document.createElement("style");
    style.id = "print-page-style";
    document.head.appendChild(style);
  }
  style.textContent = widthMm
    ? `@page { size: ${widthMm}mm auto; margin: 2mm; } #print-root { width: ${widthMm - 4}mm; }`
    : `@page { size: A4; margin: 12mm; }`;
  document.body.classList.add("printing");
  // Attend le chargement des images (logo, codes-barres) avant d'ouvrir la boîte d'impression.
  const images = [...root.querySelectorAll("img")].filter((img) => !img.complete);
  const ready = Promise.race([
    Promise.all(images.map((img) => new Promise((r) => { img.onload = img.onerror = r; }))),
    new Promise((r) => setTimeout(r, 1500)),
  ]);
  ready.then(() =>
    setTimeout(() => {
      window.print();
      document.body.classList.remove("printing");
    }, 50),
  );
}

/** Ticket de vente : directement sur l'imprimante à tickets de ce poste si elle est choisie
 *  (sans fenêtre), sinon par la fenêtre d'impression du système. */
export async function printReceipt(sale: Sale, settings: Settings): Promise<void> {
  const pc = await printerConfig();
  if (pc?.printer) {
    await sendToPrinter(receiptEscpos(sale, settings));
    return;
  }
  printHtml(receiptHtml(sale, settings), Number(settings.receipt_width || 80));
}

const row = (label: string, value: string, strong = false) =>
  `<div class="r-row ${strong ? "r-strong" : ""}"><span>${label}</span><span>${value}</span></div>`;

const shopHeader = (settings: Settings) => `
    <div class="r-center">
      <div class="r-title">${esc(settings.shop_name)}</div>
      ${settings.shop_address ? `<div>${esc(settings.shop_address)}</div>` : ""}
      ${settings.shop_phone ? `<div>${ts("Tél :")} ${esc(settings.shop_phone)}</div>` : ""}
    </div>
    <div class="r-sep"></div>`;

/** Bon d'avoir : code complet en clair et en code-barres (scanné en caisse pour payer). */
export function creditNoteHtml(note: CreditNote, settings: Settings): string {
  return `
  <div class="receipt">
    ${shopHeader(settings)}
    <div class="r-center r-title">${ts("AVOIR")}</div>
    ${row(ts("Numéro"), esc(note.number))}
    ${note.customer_name ? row(ts("Client"), esc(note.customer_name)) : ""}
    ${row(ts("Montant"), money(note.amount), true)}
    ${note.balance !== note.amount ? row(ts("Reste"), money(note.balance), true) : ""}
    ${row(ts("Valable jusqu'au"), esc(note.expires_on.split("-").reverse().join("/")))}
    <div class="r-sep"></div>
    <div class="r-center">${barcodeSvg(note.code, 42)}</div>
    <div class="r-center r-small">${ts("À présenter en caisse : utilisable en une ou plusieurs fois, non remboursable en espèces.")}</div>
  </div>`;
}

/** Ticket de retour (et l'avoir s'il y en a un). */
export function returnHtml(ret: SaleReturn, settings: Settings): string {
  const lines = ret.items
    .map(
      (i) => `<div class="r-item"><div class="r-name">${esc(i.product_name)}${i.restock ? "" : ` (${ts("abîmé")})`}</div>
        <div class="r-row"><span>${qty(i.quantity)}</span><span>-${money(i.total, false)}</span></div></div>`,
    )
    .join("");
  return `
  <div class="receipt">
    ${shopHeader(settings)}
    <div class="r-center r-title">${ts("RETOUR")}</div>
    ${row(ts("Retour"), esc(ret.number))}
    ${row(ts("Ticket d'origine"), esc(ret.sale_number))}
    ${row(ts("Date"), dateTime(ret.created_at))}
    ${row(ts("Caissier"), esc(ret.user_name))}
    ${ret.approved_by_name ? row(ts("Validé par"), esc(ret.approved_by_name)) : ""}
    ${ret.customer_name ? row(ts("Client"), esc(ret.customer_name)) : ""}
    <div class="r-sep"></div>
    ${lines}
    <div class="r-sep"></div>
    ${row(ts("Montant rendu"), money(ret.total), true)}
    ${row(ts("Remboursement"), esc(paymentLabelShop(ret.refund_method)))}
    ${ret.refund_reference ? row(ts("Réf."), esc(ret.refund_reference)) : ""}
    <div class="r-row r-small"><span>${ts("Motif :")} ${esc(ret.reason)}</span></div>
  </div>
  ${ret.credit_note ? `<div class="r-cut"></div>${creditNoteHtml(ret.credit_note, settings)}` : ""}`;
}

export function printReturn(ret: SaleReturn, settings: Settings) {
  printHtml(returnHtml(ret, settings), Number(settings.receipt_width || 80));
}

export function printCreditNote(note: CreditNote, settings: Settings) {
  printHtml(creditNoteHtml(note, settings), Number(settings.receipt_width || 80));
}

/** Rapport X (caisse en cours) ou Z (clôture), sur ticket ou en A4. */
export function zReportHtml(d: ZData, kind: "X" | "Z", settings: Settings): string {
  const title = kind === "Z" ? `${ts("RAPPORT Z")} N° ${String(d.number ?? "").padStart(4, "0")}` : ts("RAPPORT X (caisse en cours)");
  const methods = d.payments.map((p) => row(`${esc(paymentLabelShop(p.method))} (${p.count})`, money(p.amount))).join("");
  const taxes = d.taxes.map((t) => row(`${ts("Taxe")} ${t.rate} % — ${ts("base")} ${money(t.base, false)}`, money(t.tax))).join("");
  const refunds = d.returns.by_method.map((r) => row(`${esc(paymentLabelShop(r.method))} (${r.count})`, "-" + money(r.amount))).join("");
  return `
  <div class="receipt">
    ${shopHeader(settings)}
    <div class="r-center r-title">${title}</div>
    ${row(ts("Caisse de"), esc(d.cashier))}
    ${row(ts("Ouverte le"), dateTime(d.opened_at))}
    ${d.closed_at ? row(ts("Clôturée le"), dateTime(d.closed_at)) : row(ts("Imprimé le"), esc(new Date().toLocaleString()))}
    <div class="r-sep"></div>
    <div class="r-strong">${ts("Ventes")}</div>
    ${row(ts("Nombre de tickets"), String(d.sales.count))}
    ${row(ts("Ventes brutes"), money(d.sales.gross))}
    ${d.sales.line_discounts + d.sales.ticket_discounts > 0 ? row(ts("Remises"), "-" + money(d.sales.line_discounts + d.sales.ticket_discounts)) : ""}
    ${d.sales.promo_savings > 0 ? row(ts("dont promotions (économie clients)"), money(d.sales.promo_savings)) : ""}
    ${d.sales.wholesale_total > 0 ? row(ts("Ventes au prix de gros"), money(d.sales.wholesale_total)) : ""}
    ${row(ts("Total des ventes TTC"), money(d.sales.total), true)}
    ${taxes}
    ${d.sales.cancelled_count > 0 ? row(`${ts("Ventes annulées")} (${d.sales.cancelled_count})`, money(d.sales.cancelled_total)) : ""}
    <div class="r-sep"></div>
    <div class="r-strong">${ts("Encaissements")}</div>
    ${methods}
    ${d.sales.credit > 0 ? row(ts("Crédit client"), money(d.sales.credit)) : ""}
    ${d.customer_payments.cash + d.customer_payments.electronic > 0
      ? row(ts("Règlements clients"), money(d.customer_payments.cash + d.customer_payments.electronic)) : ""}
    <div class="r-sep"></div>
    <div class="r-strong">${ts("Retours")} (${d.returns.count})</div>
    ${refunds}
    ${d.returns.damaged > 0 ? row(ts("dont articles abîmés"), money(d.returns.damaged)) : ""}
    ${row(ts("Total net (ventes − retours)"), money(d.net_total), true)}
    <div class="r-sep"></div>
    <div class="r-strong">${ts("Espèces")}</div>
    ${row(ts("Fond de caisse"), money(d.cash.opening))}
    ${row(ts("Ventes en espèces"), money(d.cash.sales))}
    ${d.cash.customer_payments ? row(ts("Règlements clients"), money(d.cash.customer_payments)) : ""}
    ${d.cash.cash_in ? row(ts("Entrées"), money(d.cash.cash_in)) : ""}
    ${d.cash.cash_out ? row(ts("Sorties"), "-" + money(d.cash.cash_out)) : ""}
    ${d.cash.refunds ? row(ts("Remboursements"), "-" + money(d.cash.refunds)) : ""}
    ${row(ts("Attendu"), money(d.cash.expected), true)}
    ${d.cash.counted != null ? row(ts("Compté"), money(d.cash.counted)) : ""}
    ${d.cash.difference != null ? row(ts("Écart"), money(d.cash.difference), true) : ""}
  </div>`;
}

export function printZReport(d: ZData, kind: "X" | "Z", settings: Settings, a4 = false) {
  printHtml(zReportHtml(d, kind, settings), a4 ? undefined : Number(settings.receipt_width || 80));
}
