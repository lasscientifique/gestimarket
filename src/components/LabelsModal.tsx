import { useState } from "react";
import JsBarcode from "jsbarcode";
import QRCode from "qrcode";
import { Printer, Tag, LayoutGrid, QrCode, Barcode } from "lucide-react";
import { useApp } from "../context/AppContext";
import { locationText, money } from "../lib/format";
import { printHtml } from "../lib/receipt";
import type { Product } from "../types";
import { Field, Modal } from "./ui";

const esc = (s: string | null | undefined) =>
  (s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function isEan13(code: string) {
  if (!/^\d{13}$/.test(code)) return false;
  const d = code.split("").map(Number);
  const sum = d.slice(0, 12).reduce((s, x, i) => s + x * (i % 2 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === d[12];
}

/** SVG du code-barres (EAN-13 si valide, sinon Code 128). */
export function barcodeSvg(code: string, height = 38): string {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  try {
    JsBarcode(svg, code, {
      format: isEan13(code) ? "EAN13" : "CODE128",
      height,
      width: 1.6,
      displayValue: true,
      fontSize: 12,
      margin: 0,
      background: "transparent",
    });
    return svg.outerHTML;
  } catch {
    return `<div>${esc(code)}</div>`;
  }
}

type Template = "product" | "shelf";

/** SVG d'un QR code contenant le code du produit (lisible par les douchettes 2D et les smartphones). */
export async function qrSvg(code: string, size = 70): Promise<string> {
  try {
    const svg = await QRCode.toString(code, { type: "svg", margin: 0, width: size, errorCorrectionLevel: "M" });
    return `<div style="width:${size}px;height:${size}px;margin:0 auto">${svg}</div><div style="font:10px monospace;text-align:center">${esc(code)}</div>`;
  } catch {
    return `<div>${esc(code)}</div>`;
  }
}

/** Impression d'étiquettes : étiquettes produit (A4, 24 par page) ou étiquettes de rayon (prix + emplacement). */
export function LabelsModal({ products, onClose }: { products: Product[]; onClose: () => void }) {
  const { settings } = useApp();
  const [template, setTemplate] = useState<Template>("product");
  const [copies, setCopies] = useState("1");
  const [format, setFormat] = useState<"barcode" | "qr">("barcode");
  const withCode = products.filter((p) => p.barcode);

  const print = async () => {
    const n = Math.max(1, Math.min(100, Math.floor(Number(copies) || 1)));
    const items = withCode.flatMap((p) => Array.from({ length: n }, () => p));
    const codes = new Map<string, string>();
    for (const p of withCode) codes.set(p.barcode!, format === "qr" ? await qrSvg(p.barcode!, template === "product" ? 64 : 56) : "");
    const code = (p: Product, h: number) => (format === "qr" ? codes.get(p.barcode!)! : barcodeSvg(p.barcode!, h));
    const html =
      template === "product"
        ? `<div class="labels-a4">${items
            .map(
              (p) => `<div class="label">
                <div class="label-name">${esc(p.name)}</div>
                <div class="label-price">${money(p.sale_price)}</div>
                <div class="label-code">${code(p, 34)}</div>
              </div>`,
            )
            .join("")}</div>`
        : `<div class="labels-shelf">${items
            .map(
              (p) => `<div class="shelf">
                <div class="shelf-top"><span>${esc(settings.shop_name)}</span><span>${esc(locationText(p))}</span></div>
                <div class="shelf-name">${esc(p.name)}</div>
                <div class="shelf-row">
                  <div class="shelf-code">${code(p, 30)}</div>
                  <div class="shelf-price">${money(p.sale_price)}<small>/ ${esc(p.unit)}</small></div>
                </div>
              </div>`,
            )
            .join("")}</div>`;
    printHtml(html);
  };

  return (
    <Modal
      title="Imprimer des étiquettes"
      onClose={onClose}
      width={560}
      footer={
        <>
          <button className="btn" onClick={onClose}>Annuler</button>
          <button className="btn btn-primary" disabled={!withCode.length} onClick={print}><Printer size={16} /> Imprimer</button>
        </>
      }
    >
      <div className="method-grid two">
        <button className={`method ${template === "product" ? "active" : ""}`} onClick={() => setTemplate("product")}>
          <LayoutGrid size={22} />
          <span>Étiquettes produit</span>
          <span className="small muted">Planche A4 — 24 étiquettes (70 × 37 mm)</span>
        </button>
        <button className={`method ${template === "shelf" ? "active" : ""}`} onClick={() => setTemplate("shelf")}>
          <Tag size={22} />
          <span>Étiquettes de rayon</span>
          <span className="small muted">Prix, code-barres et emplacement</span>
        </button>
      </div>
      <div className="segmented" style={{ margin: "12px 0" }}>
        <button className={format === "barcode" ? "active" : ""} onClick={() => setFormat("barcode")}><Barcode size={15} /> Code-barres</button>
        <button className={format === "qr" ? "active" : ""} onClick={() => setFormat("qr")}><QrCode size={15} /> QR code</button>
      </div>
      <Field label="Nombre d'exemplaires par produit">
        <input inputMode="numeric" value={copies} onChange={(e) => setCopies(e.target.value)} />
      </Field>
      <p className="muted">
        {withCode.length} produit(s) avec code-barres sélectionné(s)
        {products.length > withCode.length && ` — ${products.length - withCode.length} sans code-barres ignoré(s) (utilisez « générer » dans la fiche produit).`}
      </p>
    </Modal>
  );
}
