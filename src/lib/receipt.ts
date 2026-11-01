import type { Sale, Settings } from "../types";
import { dateTime, money, paymentLabel, qty } from "./format";
import { mediaUrl } from "./media";

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
        ${i.discount > 0 ? `<div class="r-row r-small"><span>Remise</span><span>-${money(i.discount, false)}</span></div>` : ""}
      </div>`,
    )
    .join("");

  const row = (label: string, value: string, strong = false) =>
    `<div class="r-row ${strong ? "r-strong" : ""}"><span>${label}</span><span>${value}</span></div>`;

  return `
  <div class="receipt">
    <div class="r-center">
      ${settings.shop_logo_id ? `<img class="r-logo" src="${mediaUrl(Number(settings.shop_logo_id))}" alt="" />` : ""}
      <div class="r-title">${esc(settings.shop_name)}</div>
      ${settings.shop_address ? `<div>${esc(settings.shop_address)}</div>` : ""}
      ${settings.shop_phone ? `<div>Tél : ${esc(settings.shop_phone)}</div>` : ""}
      ${settings.shop_tax_id ? `<div>${esc(settings.shop_tax_id)}</div>` : ""}
    </div>
    <div class="r-sep"></div>
    ${row("Ticket", esc(sale.number))}
    ${row("Date", dateTime(sale.created_at))}
    ${row("Caissier", esc(sale.user_name))}
    ${sale.customer_name ? row("Client", esc(sale.customer_name)) : ""}
    ${sale.status === "cancelled" ? `<div class="r-center r-strong">*** VENTE ANNULÉE ***</div>` : ""}
    <div class="r-sep"></div>
    ${lines}
    <div class="r-sep"></div>
    ${sale.discount > 0 ? row("Sous-total", money(sale.subtotal)) + row("Remise", "-" + money(sale.discount)) : ""}
    ${row("TOTAL", money(sale.total), true)}
    ${sale.tax_total > 0 ? row("dont TVA", money(sale.tax_total)) : ""}
    <div class="r-sep"></div>
    ${sale.payments
      .map(
        (p) =>
          row(paymentLabel(p.method) + (p.method === "cash" ? " (reçu)" : ""), money(p.method === "cash" ? p.tendered : p.amount)) +
          (p.reference ? `<div class="r-row r-small"><span>Réf. ${esc(p.reference)}</span><span>${esc(p.phone)}</span></div>` : ""),
      )
      .join("")}
    ${sale.change_due > 0 ? row("Monnaie rendue", money(sale.change_due), true) : ""}
    ${sale.credit_amount > 0 ? row("Reste à crédit", money(sale.credit_amount), true) : ""}
    <div class="r-sep"></div>
    <div class="r-center">${esc(settings.receipt_footer)}</div>
    <div class="r-center r-small">Articles : ${qty(sale.items.reduce((s, i) => s + i.quantity, 0))}</div>
  </div>`;
}

/** Imprime un contenu HTML via la boîte d'impression du système. */
export function printHtml(html: string, widthMm?: number) {
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

export function printReceipt(sale: Sale, settings: Settings) {
  printHtml(receiptHtml(sale, settings), Number(settings.receipt_width || 80));
}
