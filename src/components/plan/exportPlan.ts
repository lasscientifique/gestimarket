/**
 * Export du plan d'un niveau : photo (PNG) de la vue 3D ou du plan coté, et PDF détaillé
 * (plan coté avec les meubles numérotés, liste des meubles, vue 3D, contenu des meubles en option).
 * Chargé seulement au moment de l'export (jsPDF, three.js).
 */
import { save } from "@tauri-apps/plugin-dialog";
import { api } from "../../api";
import { isTauri } from "../../lib/transport";
import { inAppWebView } from "../../lib/device";
import { noFileInApp } from "../../lib/files";
import { mediaUrl } from "../../lib/media";
import type { Fixture, Floor } from "../../types";
import { getLang, tl, tm } from "../../lib/i18n";

const fmt = (n: number) => String(Math.round(n * 100) / 100).replace(".", getLang() === "fr" ? "," : ".");

/** Numéros des meubles sur le plan (ordre des codes) : rangement, caisse, comptoir… ni pièces, ni murs, ni portes. */
export function numbering(fixtures: Fixture[]): Map<number, number> {
  const list = fixtures
    .filter((f) => f.category !== "zone" && !["mur", "porte", "fenetre", "texte"].includes(f.type_code))
    .sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
  return new Map(list.map((f, i) => [f.id, i + 1]));
}

/** Contour de la salle : réunion des pièces, sinon de tous les éléments, sinon le niveau. */
export function roomBox(floor: Floor, fixtures: Fixture[]): { x: number; y: number; w: number; h: number } {
  const pick = fixtures.filter((f) => f.category === "zone");
  const list = pick.length ? pick : fixtures;
  if (!list.length) return { x: 0, y: 0, w: floor.width, h: floor.depth };
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const f of list) {
    const turned = f.rotation % 180 === 90;
    const w = turned ? f.h : f.w;
    const h = turned ? f.w : f.h;
    const cx = f.x + f.w / 2;
    const cy = f.y + f.h / 2;
    x0 = Math.min(x0, cx - w / 2);
    y0 = Math.min(y0, cy - h / 2);
    x1 = Math.max(x1, cx + w / 2);
    y1 = Math.max(y1, cy + h / 2);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Image du dessin du bâtiment, si le navigateur peut l'utiliser dans un export (même origine). */
async function backdropImage(floor: Floor): Promise<ImageBitmap | null> {
  const url = mediaUrl(floor.backdrop_id);
  if (!url || !floor.backdrop) return null;
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    return await createImageBitmap(await r.blob());
  } catch {
    return null;
  }
}

function alpha(hex: string, a: number) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return `rgba(148, 163, 184, ${a})`;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

/**
 * Plan vu de dessus, coté (longueur et largeur de la salle), meubles numérotés, échelle :
 * dessiné sur un canevas, pour la photo et le PDF.
 */
export function drawPlan(floor: Floor, fixtures: Fixture[], numbers: Map<number, number>, backdrop: ImageBitmap | null = null): HTMLCanvasElement {
  const margin = 1.8;
  const ppm = Math.min(90, 3600 / Math.max(floor.width + 2 * margin, floor.depth + 2 * margin));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round((floor.width + 2 * margin) * ppm);
  canvas.height = Math.round((floor.depth + 2 * margin) * ppm);
  const c = canvas.getContext("2d")!;
  const X = (x: number) => (x + margin) * ppm;
  const Y = (y: number) => (y + margin) * ppm;
  const font = (px: number, bold = false) => `${bold ? "700 " : ""}${Math.max(9, px)}px "Segoe UI", Arial, sans-serif`;

  c.fillStyle = "#ffffff";
  c.fillRect(0, 0, canvas.width, canvas.height);
  c.fillStyle = "#f8fafc";
  c.fillRect(X(0), Y(0), floor.width * ppm, floor.depth * ppm);
  if (backdrop && floor.backdrop) {
    c.globalAlpha = floor.backdrop.opacity;
    c.drawImage(backdrop, X(floor.backdrop.x), Y(floor.backdrop.y), floor.backdrop.w * ppm, floor.backdrop.h * ppm);
    c.globalAlpha = 1;
  }
  // Quadrillage d'un mètre.
  c.strokeStyle = "rgba(148, 163, 184, 0.25)";
  c.lineWidth = 1;
  for (let x = 0; x <= floor.width; x++) {
    c.beginPath();
    c.moveTo(X(x), Y(0));
    c.lineTo(X(x), Y(floor.depth));
    c.stroke();
  }
  for (let y = 0; y <= floor.depth; y++) {
    c.beginPath();
    c.moveTo(X(0), Y(y));
    c.lineTo(X(floor.width), Y(y));
    c.stroke();
  }

  const order = [...fixtures].sort((a, b) => Number(b.category === "zone") - Number(a.category === "zone"));
  for (const f of order) {
    const cx = X(f.x + f.w / 2);
    const cy = Y(f.y + f.h / 2);
    const w = f.w * ppm;
    const h = f.h * ppm;
    c.save();
    c.translate(cx, cy);
    c.rotate((f.rotation * Math.PI) / 180);
    if (f.category === "zone") {
      c.fillStyle = alpha(f.color, backdrop ? 0.15 : 0.35);
      c.fillRect(-w / 2, -h / 2, w, h);
      c.setLineDash([ppm * 0.4, ppm * 0.25]);
      c.strokeStyle = "rgba(15, 23, 42, 0.35)";
      c.strokeRect(-w / 2, -h / 2, w, h);
      c.setLineDash([]);
    } else if (f.type_code === "mur") {
      c.fillStyle = "#334155";
      c.fillRect(-w / 2, -h / 2, w, h);
    } else if (f.type_code === "porte") {
      c.fillStyle = "#ffffff";
      c.fillRect(-w / 2, -h / 2, w, h);
      c.strokeStyle = "#16a34a";
      c.lineWidth = Math.max(1.5, ppm * 0.04);
      c.beginPath();
      c.moveTo(-w / 2, h / 2);
      c.arc(-w / 2, h / 2, w, 0, -Math.PI / 2, true);
      c.stroke();
    } else if (f.type_code === "texte") {
      c.fillStyle = f.color;
      c.font = font(Math.min(h * 0.7, ppm * 0.5), true);
      c.textAlign = "center";
      c.textBaseline = "middle";
      c.fillText(tm(f.name), 0, 0, w);
    } else {
      c.fillStyle = f.type_code === "escalier" ? "#e2e8f0" : alpha(f.color, 0.85);
      c.fillRect(-w / 2, -h / 2, w, h);
      if (f.type_code === "escalier") {
        c.strokeStyle = "#64748b";
        for (let s = -h / 2; s < h / 2; s += ppm * 0.3) {
          c.beginPath();
          c.moveTo(-w / 2, s);
          c.lineTo(w / 2, s);
          c.stroke();
        }
      }
      c.strokeStyle = "rgba(15, 23, 42, 0.6)";
      c.lineWidth = 1.2;
      c.strokeRect(-w / 2, -h / 2, w, h);
    }
    c.restore();
    // Nom des pièces, numéro des meubles.
    if (f.category === "zone" && f.w * ppm > 60) {
      c.fillStyle = "rgba(15, 23, 42, 0.75)";
      c.font = font(ppm * 0.42, true);
      c.textAlign = "left";
      c.textBaseline = "top";
      const turned = f.rotation % 180 === 90;
      const bw = (turned ? f.h : f.w) * ppm;
      const bh = (turned ? f.w : f.h) * ppm;
      c.fillText(tm(f.name), cx - bw / 2 + ppm * 0.25, cy - bh / 2 + ppm * 0.2, bw - ppm * 0.5);
    }
    const n = numbers.get(f.id);
    if (n) {
      const r = Math.max(9, Math.min(ppm * 0.28, Math.min(w, h) * 0.6));
      c.beginPath();
      c.arc(cx, cy, r, 0, Math.PI * 2);
      c.fillStyle = "#ffffff";
      c.fill();
      c.strokeStyle = "#0f172a";
      c.lineWidth = 1.2;
      c.stroke();
      c.fillStyle = "#0f172a";
      c.font = font(r * 1.05, true);
      c.textAlign = "center";
      c.textBaseline = "middle";
      c.fillText(String(n), cx, cy + 0.5);
    }
  }

  // Cotes de la salle : longueur au-dessus, largeur à gauche.
  const room = roomBox(floor, fixtures);
  c.strokeStyle = "#0f172a";
  c.fillStyle = "#0f172a";
  c.lineWidth = 1.4;
  const arrow = (x: number, y: number, dx: number, dy: number) => {
    const s = Math.max(6, ppm * 0.15);
    c.beginPath();
    c.moveTo(x, y);
    c.lineTo(x + dx * s - dy * s * 0.5, y + dy * s + dx * s * 0.5);
    c.lineTo(x + dx * s + dy * s * 0.5, y + dy * s - dx * s * 0.5);
    c.closePath();
    c.fill();
  };
  const ty = Y(room.y) - ppm * 0.9;
  c.beginPath();
  c.moveTo(X(room.x), ty);
  c.lineTo(X(room.x + room.w), ty);
  c.moveTo(X(room.x), ty - ppm * 0.2);
  c.lineTo(X(room.x), ty + ppm * 0.2);
  c.moveTo(X(room.x + room.w), ty - ppm * 0.2);
  c.lineTo(X(room.x + room.w), ty + ppm * 0.2);
  c.stroke();
  arrow(X(room.x), ty, 1, 0);
  arrow(X(room.x + room.w), ty, -1, 0);
  c.font = font(ppm * 0.42, true);
  c.textAlign = "center";
  c.textBaseline = "bottom";
  c.fillText(`L = ${fmt(room.w)} m`, X(room.x + room.w / 2), ty - ppm * 0.12);
  const tx = X(room.x) - ppm * 0.9;
  c.beginPath();
  c.moveTo(tx, Y(room.y));
  c.lineTo(tx, Y(room.y + room.h));
  c.moveTo(tx - ppm * 0.2, Y(room.y));
  c.lineTo(tx + ppm * 0.2, Y(room.y));
  c.moveTo(tx - ppm * 0.2, Y(room.y + room.h));
  c.lineTo(tx + ppm * 0.2, Y(room.y + room.h));
  c.stroke();
  arrow(tx, Y(room.y), 0, 1);
  arrow(tx, Y(room.y + room.h), 0, -1);
  c.save();
  c.translate(tx - ppm * 0.12, Y(room.y + room.h / 2));
  c.rotate(-Math.PI / 2);
  c.textAlign = "center";
  c.textBaseline = "bottom";
  c.fillText(`l = ${fmt(room.h)} m`, 0, 0);
  c.restore();

  // Échelle : 5 m (ou 1 m pour une petite salle).
  const len = Math.max(floor.width, floor.depth) > 8 ? 5 : 1;
  const sx = X(0);
  const sy = Y(floor.depth) + ppm * 1.0;
  c.fillStyle = "#0f172a";
  c.fillRect(sx, sy, len * ppm, Math.max(3, ppm * 0.08));
  c.font = font(ppm * 0.32);
  c.textAlign = "left";
  c.textBaseline = "top";
  c.fillText(`0`, sx, sy + ppm * 0.15);
  c.textAlign = "right";
  c.fillText(`${len} m`, sx + len * ppm, sy + ppm * 0.15);
  return canvas;
}

/** Vue 3D d'ensemble calculée hors écran (quand la vue 3D n'est pas ouverte). */
async function offscreen3d(floor: Floor, fixtures: Fixture[]): Promise<string | null> {
  const { StoreEngine } = await import("../plan3d/engine");
  const div = document.createElement("div");
  div.style.cssText = "position:fixed;left:-20000px;top:0;width:1600px;height:1000px;";
  document.body.appendChild(div);
  try {
    const engine = new StoreEngine(div, { onSelect: () => undefined, onOpen: () => undefined, onMove: () => undefined, onBlocked: () => undefined }, {
      quality: "realistic",
      products: true,
      photos: false,
      highWalls: false,
    });
    try {
      const fill = floor.id > 0 ? await api.planFloorFill(floor.id).catch(() => []) : [];
      engine.setFloor(floor);
      engine.setFixtures(fixtures);
      engine.setFill(fill);
      await new Promise((r) => setTimeout(r, 400));
      return engine.snapshot();
    } finally {
      engine.dispose();
    }
  } catch {
    return null;
  } finally {
    div.remove();
  }
}

/** Enregistre un fichier exporté : boîte « Enregistrer sous » sur le PC, téléchargement dans un navigateur. */
async function saveFile(name: string, dataUrl: string, kind: "png" | "pdf"): Promise<boolean> {
  const base64 = dataUrl.split(",")[1] ?? "";
  if (isTauri) {
    const path = await save({
      title: kind === "pdf" ? tl("Exporter le plan en PDF") : tl("Exporter le plan en photo"),
      defaultPath: name,
      filters: [kind === "pdf" ? { name: "PDF", extensions: ["pdf"] } : { name: "Image PNG", extensions: ["png"] }],
    });
    if (!path) return false;
    await api.saveBinaryFile(path, base64);
    return true;
  }
  if (inAppWebView()) {
    noFileInApp();
    return false;
  }
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  return true;
}

const fileName = (floor: Floor, ext: string) =>
  `plan-${floor.name.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase() || "boutique"}.${ext}`;

/** Photo du plan : la vue 3D actuelle si elle est ouverte, sinon le plan coté. */
export async function exportPng(floor: Floor, fixtures: Fixture[], snapshot: (() => string | null) | null): Promise<boolean> {
  const shot = snapshot?.();
  const data = shot ?? drawPlan(floor, fixtures, numbering(fixtures), await backdropImage(floor)).toDataURL("image/png");
  return saveFile(fileName(floor, "png"), data, "png");
}

/** PDF détaillé du niveau. */
export async function exportPdf(opts: {
  shopName: string;
  floor: Floor;
  fixtures: Fixture[];
  snapshot: (() => string | null) | null;
  contents: boolean;
}): Promise<boolean> {
  const { jsPDF } = await import("jspdf");
  const { floor, fixtures } = opts;
  const numbers = numbering(fixtures);
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const PW = 297;
  const PH = 210;
  const room = roomBox(floor, fixtures);
  const today = new Date().toLocaleDateString(getLang() === "fr" ? "fr-FR" : "en-GB");
  let page = 1;
  const footer = () => {
    doc.setFontSize(8);
    doc.setTextColor(100);
    doc.text(`GestiMarket · ${opts.shopName} · ${today} · ${tl("page {0}", [page])}`, PW / 2, PH - 6, { align: "center" });
    doc.setTextColor(0);
  };
  const header = (title: string, sub?: string) => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(15);
    doc.text(title, 12, 14);
    doc.setFont("helvetica", "normal");
    if (sub) {
      doc.setFontSize(9.5);
      doc.text(sub, 12, 20);
    }
  };
  const newPage = () => {
    footer();
    doc.addPage();
    page++;
  };

  // 1. Plan coté.
  const surface = room.w * room.h;
  header(
    `${opts.shopName} — ${tl("Plan : {0}", [tm(floor.name)])}`,
    tl("Salle : L = {0} m × l = {1} m · hauteur sous plafond {2} m · surface {3} m² · {4} meuble(s)", [fmt(room.w), fmt(room.h), fmt(floor.wall_height), fmt(surface), numbers.size]),
  );
  const canvas = drawPlan(floor, fixtures, numbers, await backdropImage(floor));
  const boxW = PW - 24;
  const boxH = PH - 36;
  const k = Math.min(boxW / canvas.width, boxH / canvas.height);
  const iw = canvas.width * k;
  const ih = canvas.height * k;
  doc.addImage(canvas.toDataURL("image/png"), "PNG", 12 + (boxW - iw) / 2, 24 + (boxH - ih) / 2, iw, ih);

  // 2. Liste des meubles.
  newPage();
  header(tl("Liste des meubles — {0}", [tm(floor.name)]));
  const cols = [
    { t: tl("N°"), w: 12 },
    { t: tl("Code"), w: 22 },
    { t: tl("Meuble"), w: 70 },
    { t: tl("Type"), w: 60 },
    { t: tl("Dimensions L × P × H (m)"), w: 52 },
    { t: tl("Étages × cases"), w: 30 },
    { t: tl("Produits"), w: 24 },
  ];
  let y = 28;
  const row = (cells: string[], bold = false) => {
    if (y > PH - 16) {
      newPage();
      y = 20;
    }
    doc.setFont("helvetica", bold ? "bold" : "normal");
    doc.setFontSize(9);
    let x = 12;
    cells.forEach((v, i) => {
      doc.text(doc.splitTextToSize(v, cols[i].w - 2)[0] ?? "", x + 1, y);
      x += cols[i].w;
    });
    doc.setDrawColor(220);
    doc.line(12, y + 2, 12 + cols.reduce((s, c) => s + c.w, 0), y + 2);
    y += 6.5;
  };
  row(cols.map((c) => c.t), true);
  const listed = fixtures.filter((f) => numbers.has(f.id)).sort((a, b) => numbers.get(a.id)! - numbers.get(b.id)!);
  for (const f of listed) {
    row([
      String(numbers.get(f.id)),
      f.code,
      tm(f.name),
      tm(f.type_name),
      `${fmt(f.w)} × ${fmt(f.h)} × ${fmt(f.height)}`,
      f.storage ? `${f.levels} × ${f.sections}` : "—",
      f.storage ? String(f.product_count) : "—",
    ]);
  }
  const zones = fixtures.filter((f) => f.category === "zone");
  if (zones.length) {
    y += 4;
    row([tl("Pièces et rayons"), "", "", "", tl("Dimensions (m)"), tl("Surface"), ""], true);
    for (const z of zones) row(["", "", tm(z.name), tm(z.type_name), `${fmt(z.w)} × ${fmt(z.h)}`, `${fmt(z.w * z.h)} m²`, ""]);
  }

  // 3. Vue 3D.
  const shot = opts.snapshot?.() ?? (await offscreen3d(floor, fixtures));
  if (shot) {
    newPage();
    header(tl("Vue 3D — {0}", [tm(floor.name)]));
    const img = await new Promise<HTMLImageElement>((resolve) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.src = shot;
    });
    const s = Math.min(boxW / img.width, (PH - 34) / img.height);
    doc.addImage(shot, "PNG", 12 + (boxW - img.width * s) / 2, 24, img.width * s, img.height * s);
  }

  // 4. Contenu des meubles (en option).
  if (opts.contents && floor.id > 0) {
    newPage();
    header(tl("Contenu des meubles — {0}", [tm(floor.name)]));
    y = 28;
    for (const f of listed.filter((x) => x.storage && x.product_count > 0)) {
      const c = await api.planFixtureContents(f.id).catch(() => null);
      if (!c) continue;
      if (y > PH - 24) {
        newPage();
        y = 20;
      }
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      doc.text(`${numbers.get(f.id)}. ${tm(f.name)} (${f.code})`, 12, y);
      y += 5.5;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8.5);
      for (const s of c.slots.filter((x) => x.products.length)) {
        const where = [s.etage ? tl("Étage {0}", [s.etage]) : "", s.rangee ? tl("Case {0}", [s.rangee]) : ""].filter(Boolean).join(" · ") || tl("Meuble");
        const lines: string[] = doc.splitTextToSize(`${where} : ${s.products.map((p) => p.name).join(", ")}`, PW - 30);
        for (const line of lines) {
          if (y > PH - 14) {
            newPage();
            y = 20;
            doc.setFontSize(8.5);
          }
          doc.text(line, 16, y);
          y += 4.2;
        }
      }
      y += 2.5;
    }
  }
  footer();
  return saveFile(fileName(floor, "pdf"), doc.output("datauristring"), "pdf");
}
