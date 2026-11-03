// Meubles 3D dessinés par le code, à leurs vraies dimensions : gondoles, frigos vitrés, congélateurs, racks,
// portants, comptoirs, caisse, murs, portes… Repère du meuble : origine au centre de l'emprise, au sol ;
// largeur sur X, profondeur sur Z, façade (côté clients) vers +Z.
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { isTransparent, material, mulberry, shade, textTexture } from "./materials";

export interface FixtureSpec {
  model: string;
  w: number;
  d: number;
  height: number;
  color: string;
  levels: number;
  sections: number;
  wallHeight: number;
  /** Murs coupés à hauteur d'appui (vue d'ensemble) pour voir l'intérieur. */
  lowWalls: boolean;
  /** Nom affiché au sol (pièces, textes). */
  label: string;
}

export type ItemKind = "box" | "bottle" | "flat" | "hanger" | "heap" | "tag" | "carton" | "pallet";

/** Case d'un meuble, dans le repère du meuble : là où se dessinent ses produits. */
export interface CellBox {
  x: number;
  y: number;
  z: number;
  w: number;
  h: number;
  d: number;
  kind: ItemKind;
  /** Côté de la façade : +Z (1) ou -Z (-1). */
  facing: 1 | -1;
}

export interface DoorPart {
  pivot: THREE.Object3D;
  /** Angle d'ouverture (radians, autour de Y). */
  open: number;
}

export interface Built {
  group: THREE.Group;
  /** Cases d'un étage (1 = en bas) et d'une case (1 = à gauche vue de face) ; deux boîtes pour un meuble double face. */
  cells: (level: number, section: number) => CellBox[];
  doors: DoorPart[];
  /** Hauteur du dessin (étiquette, cadre de sélection). */
  top: number;
}

/** Pièces regroupées par matériau puis fusionnées : quelques maillages par meuble, même pour 100 meubles. */
class Kit {
  private parts = new Map<string, THREE.BufferGeometry[]>();

  box(mat: string, w: number, h: number, d: number, x: number, y: number, z: number, rx = 0) {
    if (w <= 0.001 || h <= 0.001 || d <= 0.001) return;
    const g = new THREE.BoxGeometry(w, h, d);
    if (rx) g.rotateX(rx);
    g.translate(x, y, z);
    this.add(mat, g);
  }

  cyl(mat: string, r: number, h: number, x: number, y: number, z: number, axis: "x" | "y" | "z" = "y", seg = 12) {
    const g = new THREE.CylinderGeometry(r, r, h, seg);
    if (axis === "x") g.rotateZ(Math.PI / 2);
    else if (axis === "z") g.rotateX(Math.PI / 2);
    g.translate(x, y, z);
    this.add(mat, g);
  }

  add(mat: string, g: THREE.BufferGeometry) {
    const list = this.parts.get(mat);
    if (list) list.push(g);
    else this.parts.set(mat, [g]);
  }

  into(parent: THREE.Object3D, shadows = true) {
    for (const [mat, list] of this.parts) {
      const merged = list.length === 1 ? list[0] : mergeGeometries(list, false);
      if (list.length > 1) list.forEach((g) => g.dispose());
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, material(mat));
      const glass = isTransparent(mat);
      mesh.castShadow = shadows && !glass;
      mesh.receiveShadow = !glass;
      if (glass) mesh.renderOrder = 2;
      parent.add(mesh);
    }
    this.parts.clear();
  }
}

/** Bas de chaque étage, de `bottom` à `top` (levels + 1 valeurs). */
function levelYs(bottom: number, top: number, levels: number): number[] {
  const n = Math.max(1, levels);
  const step = (top - bottom) / n;
  return Array.from({ length: n + 1 }, (_, i) => bottom + i * step);
}

const clampCount = (n: number, max = 30) => Math.min(max, Math.max(1, Math.round(n) || 1));

interface Ctx {
  spec: FixtureSpec;
  kit: Kit;
  group: THREE.Group;
  doors: DoorPart[];
}
type Model = (c: Ctx) => { top: number; cells?: (level: number, section: number) => CellBox[] };

/** Cases d'une face d'étagères : x selon les cases, y selon les étages. */
function faceCells(
  w: number,
  ys: number[],
  sections: number,
  z: number,
  depth: number,
  kind: ItemKind,
  facing: 1 | -1,
  shelf = 0.02,
): (level: number, section: number) => CellBox | null {
  const sw = w / sections;
  return (l, s) => {
    if (l < 1 || l >= ys.length || s < 1 || s > sections) return null;
    const y0 = ys[l - 1] + shelf;
    const y1 = ys[l] - 0.02;
    const x = facing === 1 ? -w / 2 + sw * (s - 0.5) : w / 2 - sw * (s - 0.5);
    return { x, y: (y0 + y1) / 2, z, w: sw * 0.94, h: Math.max(0.05, y1 - y0), d: depth, kind, facing };
  };
}

// ───────────────────────────── Rayons ─────────────────────────────

const gondole: Model = ({ spec, kit }) => {
  const { w, d, color } = spec;
  const H = spec.height;
  const L = clampCount(spec.levels);
  const S = clampCount(spec.sections);
  const base = 0.12;
  const header = Math.min(0.22, H * 0.12);
  const panelTop = H - header;
  kit.box("metalDark", w, base, d * 0.96, 0, base / 2, 0);
  kit.box(`paint:${shade(color, 0.6)}`, w, panelTop - base, 0.04, 0, base + (panelTop - base) / 2, 0);
  kit.box(`sign:${color}`, w, header, 0.07, 0, panelTop + header / 2, 0);
  const sw = w / S;
  for (let i = 0; i <= S; i++) {
    const x = Math.min(w / 2 - 0.018, Math.max(-w / 2 + 0.018, -w / 2 + i * sw));
    kit.box("metal", 0.035, panelTop - base, 0.08, x, base + (panelTop - base) / 2, 0);
  }
  const ys = levelYs(base, panelTop - 0.02, L);
  const fd = d / 2 - 0.03;
  for (const f of [1, -1] as const) {
    for (let k = 0; k < L; k++) {
      const y = ys[k];
      if (k > 0) kit.box("metal", w - 0.02, 0.022, fd, 0, y, f * (0.025 + fd / 2));
      kit.box("label", w - 0.02, 0.035, 0.01, 0, k > 0 ? y - 0.01 : base - 0.03, f * (0.03 + fd));
    }
  }
  const front = faceCells(w, ys, S, 0.03 + fd / 2, fd * 0.85, "box", 1);
  const back = faceCells(w, ys, S, -(0.03 + fd / 2), fd * 0.85, "box", -1);
  return { top: H, cells: (l, s) => [front(l, s), back(l, s)].filter(Boolean) as CellBox[] };
};

/** Étagères d'une seule face (étagère murale, tête de gondole) : fond, côtés, tablettes, fronton. */
function singleFace(c: Ctx, side: string, back: string, head: string): ReturnType<Model> {
  const { spec, kit } = c;
  const { w, d } = spec;
  const H = spec.height;
  const L = clampCount(spec.levels);
  const S = clampCount(spec.sections);
  const base = 0.1;
  const header = Math.min(0.2, H * 0.1);
  const top = H - header;
  kit.box("metalDark", w, base, d, 0, base / 2, 0);
  kit.box(back, w - 0.04, top - base, 0.03, 0, base + (top - base) / 2, -d / 2 + 0.015);
  kit.box(side, 0.03, H, d, -w / 2 + 0.015, H / 2, 0);
  kit.box(side, 0.03, H, d, w / 2 - 0.015, H / 2, 0);
  kit.box(head, w, header, 0.05, 0, top + header / 2, -d / 2 + 0.06);
  const ys = levelYs(base, top - 0.02, L);
  const fd = d - 0.06;
  for (let k = 0; k < L; k++) {
    if (k > 0) kit.box("metal", w - 0.06, 0.022, fd, 0, ys[k], -d / 2 + 0.03 + fd / 2);
    kit.box("label", w - 0.06, 0.035, 0.01, 0, k > 0 ? ys[k] - 0.01 : base - 0.03, d / 2 - 0.01);
  }
  const cell = faceCells(w - 0.06, ys, S, -d / 2 + 0.04 + fd / 2, fd * 0.85, "box", 1);
  return { top: H, cells: (l, s) => [cell(l, s)].filter(Boolean) as CellBox[] };
}

const teteGondole: Model = (c) =>
  singleFace(c, `paint:${c.spec.color}`, `paint:${shade(c.spec.color, 0.6)}`, `sign:${c.spec.color}`);
const etagereMurale: Model = (c) => singleFace(c, "metal", `paint:${shade(c.spec.color, 0.65)}`, `paint:${c.spec.color}`);

// ───────────────────────────── Froid ─────────────────────────────

/** Armoire vitrée réfrigérée ou de congélation : caisse, clayettes, éclairage, enseigne, portes vitrées. */
function glassCabinet(c: Ctx, freezer: boolean): ReturnType<Model> {
  const { spec, kit, group, doors } = c;
  const { w, d, color } = spec;
  const H = spec.height;
  const L = clampCount(spec.levels);
  const S = clampCount(spec.sections);
  const t = 0.05;
  const body = `paint:${color}`;
  const plinth = 0.16;
  const sign = 0.2;
  kit.box(body, t, H, d, -w / 2 + t / 2, H / 2, 0);
  kit.box(body, t, H, d, w / 2 - t / 2, H / 2, 0);
  kit.box(body, w, 0.05, d, 0, H - 0.025, 0);
  kit.box("black", w, plinth, d, 0, plinth / 2, 0);
  kit.box(`sign:${shade(color, freezer ? 0.2 : 0)}`, w - 2 * t, sign - 0.02, 0.04, 0, H - sign / 2 - 0.02, d / 2 - 0.02);
  kit.box(freezer ? "freezerIn" : "white", w - 2 * t, H - plinth - sign, 0.03, 0, plinth + (H - plinth - sign) / 2, -d / 2 + 0.015);
  kit.box(freezer ? "coldLight" : "light", w - 2 * t - 0.04, 0.025, 0.03, 0, H - sign - 0.04, d / 2 - 0.1);
  const inner = w - 2 * t;
  const ys = levelYs(plinth + 0.02, H - sign - 0.06, L);
  for (let k = 0; k <= L; k++) {
    if (k > 0 && k < L) kit.box(freezer ? "metal" : "glassFrost", inner - 0.02, 0.012, d - 0.16, 0, ys[k], -0.03);
  }
  kit.box("metal", inner, 0.02, d - 0.1, 0, plinth + 0.01, -0.02);
  // Portes vitrées (une tous les 70 cm environ), chacune sur sa charnière pour s'ouvrir.
  const nd = Math.max(1, Math.round(inner / 0.7));
  const dw = inner / nd;
  const doorY0 = plinth + 0.01;
  const doorH = H - sign - 0.03 - doorY0;
  for (let i = 0; i < nd; i++) {
    const pivot = new THREE.Group();
    pivot.position.set(-w / 2 + t + i * dw, doorY0, d / 2 - 0.005);
    const dk = new Kit();
    const frame = `paint:${shade(color, -0.3)}`;
    dk.box(frame, dw - 0.006, 0.045, 0.03, dw / 2, 0.0225, 0);
    dk.box(frame, dw - 0.006, 0.045, 0.03, dw / 2, doorH - 0.0225, 0);
    dk.box(frame, 0.04, doorH, 0.03, 0.02, doorH / 2, 0);
    dk.box(frame, 0.04, doorH, 0.03, dw - 0.026, doorH / 2, 0);
    dk.box(freezer ? "glassFrost" : "glass", dw - 0.08, doorH - 0.09, 0.008, dw / 2, doorH / 2, 0);
    dk.box("chrome", 0.022, doorH * 0.45, 0.03, dw - 0.07, doorH * 0.55, 0.035);
    dk.into(pivot, false);
    group.add(pivot);
    doors.push({ pivot, open: -1.75 });
  }
  const cell = faceCells(inner - 0.02, ys, S, -0.02, d - 0.2, freezer ? "box" : "bottle", 1, 0.012);
  return { top: H, cells: (l, s) => [cell(l, s)].filter(Boolean) as CellBox[] };
}

const refrigerateur: Model = (c) => glassCabinet(c, false);
const congelateurArmoire: Model = (c) => glassCabinet(c, true);

const congelateurCoffre: Model = ({ spec, kit }) => {
  const { w, d, color } = spec;
  const H = spec.height;
  const L = clampCount(spec.levels);
  const S = clampCount(spec.sections);
  const t = 0.06;
  kit.box("white", w, H, t, 0, H / 2, d / 2 - t / 2);
  kit.box("white", w, H, t, 0, H / 2, -d / 2 + t / 2);
  kit.box("white", t, H, d - 2 * t, -w / 2 + t / 2, H / 2, 0);
  kit.box("white", t, H, d - 2 * t, w / 2 - t / 2, H / 2, 0);
  const floorY = Math.max(0.2, H - 0.55);
  kit.box("freezerIn", w - 2 * t, floorY, d - 2 * t, 0, floorY / 2, 0);
  kit.box(`paint:${color}`, w + 0.004, 0.09, 0.005, 0, H - 0.2, d / 2 + 0.002);
  kit.box("black", w - 0.02, 0.06, d - 0.02, 0, 0.03, 0);
  for (const [lw, ld, lx, lz] of [[w, 0.03, 0, d / 2 - 0.015], [w, 0.03, 0, -d / 2 + 0.015], [0.03, d, -w / 2 + 0.015, 0], [0.03, d, w / 2 - 0.015, 0]]) {
    kit.box("metal", lw, 0.03, ld, lx, H + 0.015, lz);
  }
  kit.box("glass", w / 2, 0.01, d - 0.08, -w / 4 + 0.01, H + 0.02, 0);
  kit.box("glass", w / 2, 0.01, d - 0.08, w / 4 - 0.01, H + 0.035, 0);
  const ys = levelYs(floorY, H - 0.04, L);
  const cell = faceCells(w - 2 * t, ys, S, 0, d - 2 * t - 0.04, "box", 1, 0);
  return { top: H + 0.04, cells: (l, s) => [cell(l, s)].filter(Boolean) as CellBox[] };
};

const vitrineRefrigeree: Model = ({ spec, kit }) => {
  const { w, d, color } = spec;
  const H = spec.height;
  const L = clampCount(spec.levels);
  const S = clampCount(spec.sections);
  const bh = Math.min(0.85, H * 0.62);
  kit.box("white", w - 0.08, bh, d - 0.06, 0, bh / 2, 0);
  kit.box(`paint:${color}`, w, bh, 0.04, 0, bh / 2, d / 2 - 0.02);
  kit.box(`paint:${color}`, 0.04, H, d, -w / 2 + 0.02, H / 2, 0);
  kit.box(`paint:${color}`, 0.04, H, d, w / 2 - 0.02, H / 2, 0);
  kit.box("metal", w - 0.08, 0.03, d - 0.1, 0, bh + 0.015, 0);
  // Vitre avant inclinée, vitre du dessus, vitres coulissantes côté vendeur.
  const z0 = d / 2 - 0.04;
  const z1 = d / 2 - Math.min(0.38, d * 0.42);
  const y0 = bh + 0.03;
  const y1 = H - 0.02;
  const len = Math.hypot(z0 - z1, y1 - y0);
  kit.box("glass", w - 0.08, len, 0.01, 0, (y0 + y1) / 2, (z0 + z1) / 2, -Math.atan2(z0 - z1, y1 - y0));
  const backZ = -d / 2 + 0.06;
  kit.box("glass", w - 0.08, 0.01, z1 - backZ, 0, H - 0.01, (z1 + backZ) / 2);
  kit.box("glass", w - 0.08, H - bh - 0.05, 0.01, 0, (bh + H) / 2, backZ);
  kit.box("coldLight", w - 0.12, 0.02, 0.03, 0, H - 0.04, (z1 + backZ) / 2);
  const ys = levelYs(bh + 0.03, H - 0.06, L);
  for (let k = 1; k < L; k++) kit.box("glassFrost", w - 0.1, 0.01, (z1 - backZ) * 0.9, 0, ys[k], (z1 + backZ) / 2 - 0.02);
  const sw = (w - 0.1) / S;
  return {
    top: H,
    cells: (l, s) => {
      if (l < 1 || l > L || s < 1 || s > S) return [];
      const y0c = ys[l - 1] + 0.01;
      const hc = ys[l] - ys[l - 1] - 0.03;
      const zc = l === 1 ? 0 : (z1 + backZ) / 2 - 0.02;
      const dc = l === 1 ? (d - 0.2) * 0.8 : (z1 - backZ) * 0.8;
      return [{ x: -w / 2 + 0.05 + sw * (s - 0.5), y: y0c + hc / 2, z: zc, w: sw * 0.92, h: hc, d: dc, kind: l === 1 ? "flat" : "box", facing: 1 }];
    },
  };
};

const chambreFroide: Model = ({ spec, kit, group, doors }) => {
  const { w, d, color } = spec;
  const H = spec.height;
  const Hd = spec.lowWalls ? Math.min(H, 1.2) : H;
  const L = clampCount(spec.levels);
  const S = clampCount(spec.sections);
  const t = 0.1;
  const door = Math.min(0.9, w - 2 * t - 0.1);
  kit.box("insulated", w, Hd, t, 0, Hd / 2, -d / 2 + t / 2);
  kit.box("insulated", t, Hd, d, -w / 2 + t / 2, Hd / 2, 0);
  kit.box("insulated", t, Hd, d, w / 2 - t / 2, Hd / 2, 0);
  const seg = (w - door) / 2;
  kit.box("insulated", seg, Hd, t, -w / 2 + seg / 2, Hd / 2, d / 2 - t / 2);
  kit.box("insulated", seg, Hd, t, w / 2 - seg / 2, Hd / 2, d / 2 - t / 2);
  if (!spec.lowWalls && Hd > 2.05) kit.box("insulated", door, Hd - 2.0, t, 0, 2.0 + (Hd - 2.0) / 2, d / 2 - t / 2);
  kit.box(`paint:${color}`, w, 0.1, 0.01, 0, Hd - 0.08, d / 2 + 0.005);
  kit.box("white", w - 2 * t, 0.02, d - 2 * t, 0, 0.01, 0);
  // Porte isotherme.
  const pivot = new THREE.Group();
  pivot.position.set(-door / 2, 0, d / 2);
  const dk = new Kit();
  const dh = Math.min(2.0, Hd);
  dk.box("insulated", door, dh, 0.08, door / 2, dh / 2, 0);
  dk.box("metal", 0.04, 0.3, 0.05, door - 0.1, Math.min(1.05, dh * 0.6), 0.06);
  dk.into(pivot, true);
  group.add(pivot);
  doors.push({ pivot, open: -1.6 });
  // Étagères le long du fond.
  const shelfD = Math.min(0.5, (d - 2 * t) * 0.45);
  const z = -d / 2 + t + shelfD / 2 + 0.02;
  const ys = levelYs(0.15, Math.min(H, 2.3) - 0.1, L);
  for (let k = 0; k <= L; k++) kit.box("metal", w - 2 * t - 0.1, 0.02, shelfD, 0, ys[k], z);
  for (const x of [-w / 2 + t + 0.07, w / 2 - t - 0.07]) kit.box("metal", 0.03, ys[L], 0.03, x, ys[L] / 2, z + shelfD / 2);
  const cell = faceCells(w - 2 * t - 0.12, ys, S, z, shelfD * 0.85, "box", 1);
  return { top: Hd, cells: (l, s) => [cell(l, s)].filter(Boolean) as CellBox[] };
};

// ───────────────────────────── Présentation ─────────────────────────────

const presentoir: Model = ({ spec, kit }) => {
  const { w, d, color } = spec;
  const H = spec.height;
  const L = clampCount(spec.levels);
  const S = clampCount(spec.sections);
  kit.box(`paint:${color}`, w, 0.08, d, 0, 0.04, 0);
  kit.cyl("chrome", 0.03, H - 0.1, 0, (H - 0.1) / 2, 0);
  const ys = levelYs(0.08, H - 0.28, L);
  const size = (k: number) => 1 - (0.35 * k) / Math.max(1, L);
  for (let k = 1; k < L; k++) kit.box(`paint:${shade(color, 0.5)}`, w * size(k), 0.025, d * size(k), 0, ys[k], 0);
  kit.box(`sign:${color}`, Math.min(w * 0.7, 0.8), 0.22, 0.03, 0, H - 0.11, 0);
  return {
    top: H,
    cells: (l, s) => {
      if (l < 1 || l > L || s < 1 || s > S) return [];
      const k = l - 1;
      const tw = w * size(k) * 0.9;
      const sw = tw / S;
      const y0 = ys[k] + 0.0125;
      const h = ys[l] - ys[k] - 0.05;
      return [{ x: -tw / 2 + sw * (s - 0.5), y: y0 + h / 2, z: 0, w: sw * 0.9, h, d: d * size(k) * 0.75, kind: "box", facing: 1 }];
    },
  };
};

const bacVrac: Model = ({ spec, kit }) => {
  const { w, d, color } = spec;
  const H = spec.height;
  const L = clampCount(spec.levels, 6);
  const S = clampCount(spec.sections);
  const rd = (d - 0.06) / L;
  const bw = (w - 0.06) / S;
  const y0 = Math.max(0.35, H - 0.3 - (L - 1) * 0.12);
  for (const [x, z] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) kit.box("wood", 0.05, y0, 0.05, x * (w / 2 - 0.03), y0 / 2, z * (d / 2 - 0.03));
  kit.box("wood", w, 0.04, d, 0, 0.12, 0);
  for (let k = 0; k < L; k++) {
    const y = y0 + k * 0.12;
    const z = d / 2 - 0.03 - rd * (k + 0.5);
    kit.box("wood", w, y - y0 + 0.04, rd, 0, y0 + (y - y0) / 2 - 0.02, z);
    for (let s = 0; s < S; s++) {
      const x = -w / 2 + 0.03 + bw * (s + 0.5);
      kit.box("woodLight", bw - 0.02, 0.02, rd - 0.02, x, y + 0.01, z);
      kit.box("woodLight", bw - 0.02, 0.12, 0.015, x, y + 0.06, z + rd / 2 - 0.0175);
      kit.box("woodLight", bw - 0.02, 0.2, 0.015, x, y + 0.1, z - rd / 2 + 0.0175);
      kit.box("woodLight", 0.015, 0.16, rd - 0.02, x - bw / 2 + 0.0175, y + 0.08, z);
      kit.box("woodLight", 0.015, 0.16, rd - 0.02, x + bw / 2 - 0.0175, y + 0.08, z);
      kit.box("label", Math.min(0.12, bw * 0.5), 0.06, 0.005, x, y + 0.06, z + rd / 2 - 0.007);
    }
  }
  kit.box(`sign:${color}`, w, 0.12, 0.03, 0, y0 + (L - 1) * 0.12 + 0.36, -d / 2 + 0.04);
  return {
    top: y0 + (L - 1) * 0.12 + 0.42,
    cells: (l, s) => {
      if (l < 1 || l > L || s < 1 || s > S) return [];
      const y = y0 + (l - 1) * 0.12;
      return [{ x: -w / 2 + 0.03 + bw * (s - 0.5), y: y + 0.08, z: d / 2 - 0.03 - rd * (l - 0.5), w: bw * 0.8, h: 0.12, d: rd * 0.7, kind: "heap", facing: 1 }];
    },
  };
};

/** Palette en bois (dessin réutilisé par la palette au sol et les racks). */
function pallet(kit: Kit, w: number, d: number, x = 0, y = 0, z = 0) {
  const n = 5;
  for (let i = 0; i < n; i++) kit.box("pallet", w, 0.022, Math.min(0.12, d / 7), x, y + 0.133, z - d / 2 + (d / (n - 1)) * i + (i === 0 ? 0.05 : i === n - 1 ? -0.05 : 0));
  for (const zz of [-d / 2 + 0.05, 0, d / 2 - 0.05]) {
    kit.box("pallet", w, 0.022, 0.1, x, y + 0.011, z + zz);
    for (const xx of [-w / 2 + 0.05, 0, w / 2 - 0.05]) kit.box("pallet", 0.1, 0.078, 0.1, x + xx, y + 0.061, z + zz);
  }
}

const palette: Model = ({ spec, kit }) => {
  const { w, d } = spec;
  const H = Math.max(0.3, spec.height);
  const L = clampCount(spec.levels, 6);
  const S = clampCount(spec.sections);
  pallet(kit, w, d);
  const ph = 0.144;
  const ys = levelYs(ph, H, L);
  const cell = faceCells(w, ys, S, 0, d * 0.95, "carton", 1, 0);
  return { top: H, cells: (l, s) => [cell(l, s)].filter(Boolean) as CellBox[] };
};

const portant: Model = ({ spec, kit }) => {
  const { w, d } = spec;
  const H = spec.height;
  const L = clampCount(spec.levels, 3);
  const S = clampCount(spec.sections);
  for (const x of [-w / 2 + 0.03, w / 2 - 0.03]) {
    kit.cyl("chrome", 0.016, H, x, H / 2, 0);
    kit.box("chrome", 0.03, 0.03, d, x, 0.05, 0);
    kit.cyl("black", 0.025, 0.02, x, 0.025, d / 2 - 0.04, "x");
    kit.cyl("black", 0.025, 0.02, x, 0.025, -d / 2 + 0.04, "x");
  }
  const rails = Array.from({ length: L }, (_, i) => H - 0.03 - i * Math.min(0.6, (H - 0.6) / Math.max(1, L)));
  rails.forEach((y) => kit.cyl("chrome", 0.012, w, 0, y, 0, "x"));
  const sw = (w - 0.12) / S;
  return {
    top: H,
    cells: (l, s) => {
      if (l < 1 || l > L || s < 1 || s > S) return [];
      const rail = rails[L - l];
      const h = Math.min(0.85, rail - 0.12);
      return [{ x: -w / 2 + 0.06 + sw * (s - 0.5), y: rail - 0.05 - h / 2, z: 0, w: sw * 0.95, h, d: d * 0.75, kind: "hanger", facing: 1 }];
    },
  };
};

// ───────────────────────────── Rangement ─────────────────────────────

const rack: Model = ({ spec, kit }) => {
  const { w, d } = spec;
  const H = spec.height;
  const L = clampCount(spec.levels, 10);
  const S = clampCount(spec.sections, 12);
  const bay = w / S;
  const ys = levelYs(0, H - 0.12, L);
  for (let i = 0; i <= S; i++) {
    const x = Math.min(w / 2 - 0.04, Math.max(-w / 2 + 0.04, -w / 2 + i * bay));
    for (const z of [d / 2 - 0.04, -d / 2 + 0.04]) kit.box("rackBlue", 0.075, H, 0.075, x, H / 2, z);
    // Croisillons du cadre.
    const n = Math.max(2, Math.round(H / 0.9));
    const seg = H / n;
    const len = Math.hypot(d - 0.08, seg);
    for (let k = 0; k < n; k++) kit.box("rackBlue", 0.02, len, 0.02, x, seg * (k + 0.5), 0, (k % 2 ? 1 : -1) * Math.atan2(d - 0.08, seg));
  }
  for (let k = 1; k <= L; k++) {
    for (let i = 0; i < S; i++) {
      const x = -w / 2 + bay * (i + 0.5);
      for (const z of [d / 2 - 0.04, -d / 2 + 0.04]) kit.box("rackOrange", bay - 0.075, 0.1, 0.05, x, ys[k], z);
      if (k < L) kit.box("metal", bay - 0.09, 0.015, d - 0.1, x, ys[k] + 0.058, 0);
    }
  }
  return {
    top: H,
    cells: (l, s) => {
      if (l < 1 || l > L || s < 1 || s > S) return [];
      const y0 = l === 1 ? 0 : ys[l - 1] + 0.066;
      const h = ys[l] - y0 - 0.07;
      return [{ x: -w / 2 + bay * (s - 0.5), y: y0 + h / 2, z: 0, w: bay - 0.16, h, d: d - 0.12, kind: "pallet", facing: 1 }];
    },
  };
};

const armoire: Model = ({ spec, kit, group, doors }) => {
  const { w, d, color } = spec;
  const H = spec.height;
  const L = clampCount(spec.levels);
  const S = clampCount(spec.sections);
  const body = `paint:${color}`;
  kit.box(body, 0.03, H, d, -w / 2 + 0.015, H / 2, 0);
  kit.box(body, 0.03, H, d, w / 2 - 0.015, H / 2, 0);
  kit.box(body, w, 0.03, d, 0, H - 0.015, 0);
  kit.box("black", w - 0.04, 0.08, d - 0.04, 0, 0.04, 0);
  kit.box(`paint:${shade(color, 0.35)}`, w - 0.06, H - 0.11, 0.02, 0, 0.08 + (H - 0.11) / 2, -d / 2 + 0.01);
  const ys = levelYs(0.08, H - 0.05, L);
  for (let k = 0; k < L; k++) kit.box(`paint:${shade(color, 0.25)}`, w - 0.06, 0.02, d - 0.06, 0, ys[k], -0.02);
  const nd = w >= 0.7 ? 2 : 1;
  const dw = w / nd;
  for (let i = 0; i < nd; i++) {
    const right = nd === 2 && i === 1;
    const pivot = new THREE.Group();
    pivot.position.set(right ? w / 2 : -w / 2, 0.08, d / 2);
    const dk = new Kit();
    const sx = right ? -1 : 1;
    dk.box(body, dw - 0.006, H - 0.1, 0.025, (sx * dw) / 2, (H - 0.1) / 2, 0.0125);
    dk.box("chrome", 0.02, 0.22, 0.03, sx * (dw - 0.06), (H - 0.1) * 0.5, 0.035);
    dk.into(pivot, true);
    group.add(pivot);
    doors.push({ pivot, open: right ? 1.9 : -1.9 });
  }
  const cell = faceCells(w - 0.08, ys, S, -0.02, d - 0.12, "box", 1);
  return { top: H, cells: (l, s) => [cell(l, s)].filter(Boolean) as CellBox[] };
};

const armoireTiroirs: Model = ({ spec, kit }) => {
  const { w, d, color } = spec;
  const H = spec.height;
  const L = clampCount(spec.levels);
  const S = clampCount(spec.sections);
  kit.box(`paint:${color}`, w, H, d - 0.02, 0, H / 2, -0.01);
  const ys = levelYs(0.06, H - 0.02, L);
  const sw = (w - 0.02) / S;
  for (let k = 0; k < L; k++) {
    const lh = ys[k + 1] - ys[k];
    for (let s = 0; s < S; s++) {
      const x = -w / 2 + 0.01 + sw * (s + 0.5);
      const y = ys[k] + lh / 2;
      kit.box(`paint:${shade(color, 0.18)}`, sw - 0.012, lh - 0.012, 0.02, x, y, d / 2 - 0.01);
      kit.box("chrome", sw * 0.4, 0.015, 0.02, x, y - lh * 0.18, d / 2 + 0.01);
      kit.box("label", sw * 0.36, lh * 0.2, 0.004, x, y + lh * 0.14, d / 2 + 0.002);
    }
  }
  return {
    top: H,
    cells: (l, s) => {
      if (l < 1 || l > L || s < 1 || s > S) return [];
      const lh = ys[l] - ys[l - 1];
      return [{ x: -w / 2 + 0.01 + sw * (s - 0.5), y: ys[l - 1] + lh / 2 + lh * 0.14, z: d / 2 + 0.006, w: sw * 0.3, h: lh * 0.16, d: 0.004, kind: "tag", facing: 1 }];
    },
  };
};

const vitrineFermee: Model = ({ spec, kit }) => {
  const { w, d, color } = spec;
  const H = spec.height;
  const L = clampCount(spec.levels);
  const S = clampCount(spec.sections);
  const ch = H <= 1.3 ? Math.min(0.6, H * 0.55) : 0.15;
  kit.box(`paint:${color}`, w, ch, d, 0, ch / 2, 0);
  const gh = H - ch;
  kit.box("glass", w - 0.02, gh, 0.008, 0, ch + gh / 2, d / 2 - 0.01);
  kit.box("glass", w - 0.02, gh, 0.008, 0, ch + gh / 2, -d / 2 + 0.01);
  kit.box("glass", 0.008, gh, d - 0.02, -w / 2 + 0.01, ch + gh / 2, 0);
  kit.box("glass", 0.008, gh, d - 0.02, w / 2 - 0.01, ch + gh / 2, 0);
  kit.box("glass", w - 0.02, 0.008, d - 0.02, 0, H - 0.004, 0);
  for (const [x, z] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) kit.box("chrome", 0.015, gh, 0.015, x * (w / 2 - 0.008), ch + gh / 2, z * (d / 2 - 0.008));
  for (const y of [ch + 0.005, H - 0.005]) {
    kit.box("chrome", w, 0.015, 0.015, 0, y, d / 2 - 0.008);
    kit.box("chrome", w, 0.015, 0.015, 0, y, -d / 2 + 0.008);
  }
  kit.box("light", w - 0.06, 0.015, 0.02, 0, H - 0.03, 0);
  const ys = levelYs(ch + 0.01, H - 0.05, L);
  for (let k = 1; k < L; k++) kit.box("glassFrost", w - 0.04, 0.008, d - 0.04, 0, ys[k], 0);
  const cell = faceCells(w - 0.04, ys, S, 0, d * 0.6, "box", 1, 0.008);
  return { top: H, cells: (l, s) => [cell(l, s)].filter(Boolean) as CellBox[] };
};

const comptoir: Model = ({ spec, kit }) => {
  const { w, d, color } = spec;
  const H = spec.height;
  const L = clampCount(spec.levels, 4);
  const S = clampCount(spec.sections);
  kit.box(`paint:${color}`, w, H - 0.04, 0.03, 0, (H - 0.04) / 2, d / 2 - 0.015);
  kit.box(`paint:${color}`, 0.03, H - 0.04, d, -w / 2 + 0.015, (H - 0.04) / 2, 0);
  kit.box(`paint:${color}`, 0.03, H - 0.04, d, w / 2 - 0.015, (H - 0.04) / 2, 0);
  kit.box("woodLight", w + 0.04, 0.04, d + 0.06, 0, H - 0.02, 0.02);
  const ys = levelYs(0.06, H - 0.06, L);
  for (let k = 0; k < L; k++) kit.box(`paint:${shade(color, 0.45)}`, w - 0.06, 0.02, d - 0.06, 0, ys[k], -0.015);
  const cell = faceCells(w - 0.08, ys, S, -0.03, d - 0.12, "box", -1);
  return { top: H, cells: (l, s) => [cell(l, s)].filter(Boolean) as CellBox[] };
};

// ───────────────────────────── Bâtiment ─────────────────────────────

const caisse: Model = ({ spec, kit }) => {
  const { w, d, color } = spec;
  const H = spec.height || 0.9;
  kit.box(`paint:${color}`, w, H - 0.03, d - 0.04, 0, (H - 0.03) / 2, 0);
  kit.box("metal", w, 0.03, d, 0, H - 0.015, 0);
  const belt = w * 0.55;
  kit.box("rubber", belt, 0.012, d * 0.6, -w / 2 + belt / 2 + 0.04, H + 0.006, 0.04);
  kit.box("chrome", 0.012, 0.05, d * 0.6, -w / 2 + belt + 0.05, H + 0.025, 0.04);
  kit.box("glass", 0.22, 0.006, 0.22, -w / 2 + belt + 0.2, H + 0.003, 0.04);
  kit.box("black", 0.04, 0.3, 0.04, w / 2 - 0.2, H + 0.15, -d / 2 + 0.14);
  kit.box("black", 0.34, 0.24, 0.03, w / 2 - 0.2, H + 0.38, -d / 2 + 0.14);
  kit.box("screen", 0.31, 0.21, 0.005, w / 2 - 0.2, H + 0.38, -d / 2 + 0.122);
  kit.box("black", 0.08, 0.04, 0.14, w / 2 - 0.12, H + 0.02, d / 2 - 0.12);
  kit.box("metalDark", 0.42, 0.1, 0.02, w / 2 - 0.3, H - 0.16, -d / 2 + 0.01);
  return { top: H + 0.5 };
};

const mur: Model = ({ spec, kit }) => {
  const h = spec.lowWalls ? Math.min(1.1, spec.wallHeight) : spec.wallHeight;
  kit.box("wall", spec.w, h, spec.d, 0, h / 2, 0);
  if (spec.lowWalls) kit.box("wallTop", spec.w + 0.002, 0.02, spec.d + 0.002, 0, h, 0);
  return { top: h };
};

const poteau: Model = (c) => mur(c);

const porte: Model = ({ spec, kit }) => {
  const { w } = spec;
  const d = Math.max(spec.d, 0.12);
  const full = Math.min(spec.height || 2.1, spec.wallHeight);
  const h = spec.lowWalls ? Math.min(1.1, full) : full;
  kit.box("metalDark", 0.06, h, d, -w / 2 + 0.03, h / 2, 0);
  kit.box("metalDark", 0.06, h, d, w / 2 - 0.03, h / 2, 0);
  if (!spec.lowWalls) {
    kit.box("metalDark", w, 0.08, d, 0, full - 0.04, 0);
    if (spec.wallHeight > full + 0.05) kit.box("wall", w, spec.wallHeight - full, d, 0, full + (spec.wallHeight - full) / 2, 0);
  }
  const leaves = w >= 1.4 ? 2 : 1;
  const lw = (w - 0.12) / leaves;
  for (let i = 0; i < leaves; i++) {
    // Portes vitrées entrouvertes (coulissantes).
    const x = -w / 2 + 0.06 + lw * (i + 0.5) + (leaves === 2 ? (i ? 0.18 : -0.18) : 0);
    kit.box("glass", lw - 0.04, h - 0.1, 0.012, x, h / 2, i ? 0.03 : -0.03);
    kit.box("metalDark", lw, 0.04, 0.03, x, 0.03, i ? 0.03 : -0.03);
    if (!spec.lowWalls) kit.box("metalDark", lw, 0.04, 0.03, x, h - 0.08, i ? 0.03 : -0.03);
  }
  kit.box("rubber", Math.min(w, 1.6), 0.012, 0.9, 0, 0.006, 0);
  return { top: h };
};

const fenetre: Model = ({ spec, kit }) => {
  const { w } = spec;
  const d = Math.max(spec.d, 0.12);
  const sill = 0.9;
  const head = Math.min(sill + (spec.height || 1.2), spec.wallHeight - 0.15);
  if (spec.lowWalls) {
    kit.box("white", w, 0.04, d + 0.06, 0, Math.min(1.1, sill), 0);
    return { top: Math.min(1.1, sill) };
  }
  kit.box("white", w, 0.05, d + 0.06, 0, sill, 0);
  kit.box("white", w, 0.05, d, 0, head, 0);
  kit.box("white", 0.05, head - sill, d, -w / 2 + 0.025, (sill + head) / 2, 0);
  kit.box("white", 0.05, head - sill, d, w / 2 - 0.025, (sill + head) / 2, 0);
  kit.box("white", 0.04, head - sill, 0.05, 0, (sill + head) / 2, 0);
  kit.box("glass", w - 0.1, head - sill - 0.05, 0.01, 0, (sill + head) / 2, 0);
  return { top: head };
};

const escalier: Model = ({ spec, kit }) => {
  const { w, d } = spec;
  const H = spec.lowWalls ? Math.min(spec.height, 1.5) : spec.height;
  const n = Math.max(4, Math.round(H / 0.18));
  const rise = H / n;
  const run = d / n;
  for (let i = 0; i < n; i++) kit.box("solid:#d6d3d1", w, rise * (i + 1), run, 0, (rise * (i + 1)) / 2, d / 2 - run * (i + 0.5));
  const len = Math.hypot(d, H - rise);
  const angle = Math.atan2(H - rise, d);
  for (const x of [-w / 2 + 0.04, w / 2 - 0.04]) {
    kit.box("chrome", 0.04, 0.04, len, x, rise + 0.9 + (H - rise) / 2, 0, angle);
    kit.cyl("chrome", 0.015, 0.9, x, rise + 0.45, d / 2 - 0.05);
    kit.cyl("chrome", 0.015, 0.9, x, H + 0.45, -d / 2 + 0.05);
  }
  return { top: H + 0.9 };
};

/** Texte posé au sol. */
const texte: Model = ({ spec, group }) => {
  const { texture, aspect } = textTexture(spec.label || " ", { color: spec.color, height: 96 });
  const pw = spec.w * 0.95;
  const ph = Math.min(spec.d * 0.95, pw / aspect);
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(Math.min(pw, ph * aspect), ph), new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false }));
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0.012;
  group.add(mesh);
  return { top: 0.05 };
};

/** Pièce : sol coloré, bordure et nom écrit au sol. */
const zone: Model = ({ spec, kit, group }) => {
  const { w, d, color } = spec;
  kit.box(`zone:${color}`, w, 0.006, d, 0, 0.003, 0);
  const edge = `paint:${shade(color, -0.35)}`;
  const t = Math.min(0.05, w / 10, d / 10);
  kit.box(edge, w, 0.008, t, 0, 0.004, -d / 2 + t / 2);
  kit.box(edge, w, 0.008, t, 0, 0.004, d / 2 - t / 2);
  kit.box(edge, t, 0.008, d, -w / 2 + t / 2, 0.004, 0);
  kit.box(edge, t, 0.008, d, w / 2 - t / 2, 0.004, 0);
  if (spec.label && w > 1 && d > 1) {
    const { texture, aspect } = textTexture(spec.label, { color: shade(color, -0.65), height: 96 });
    const pw = Math.min(w * 0.6, 3.2);
    const ph = pw / aspect;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(pw, ph), new THREE.MeshBasicMaterial({ map: texture, transparent: true, opacity: 0.75, depthWrite: false }));
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(0, 0.011, -d / 2 + Math.min(d / 2, ph / 2 + 0.35));
    group.add(mesh);
  }
  return { top: 0.01 };
};

/** Meuble inconnu : un bloc de sa couleur. */
const generic: Model = ({ spec, kit }) => {
  const H = Math.max(0.05, spec.height);
  kit.box(`paint:${spec.color}`, spec.w, H, spec.d, 0, H / 2, 0);
  const cell = faceCells(spec.w, levelYs(0, H, clampCount(spec.levels)), clampCount(spec.sections), 0, spec.d * 0.8, "box", 1);
  return { top: H, cells: (l, s) => [cell(l, s)].filter(Boolean) as CellBox[] };
};

const MODELS: Record<string, Model> = {
  gondole,
  tete_gondole: teteGondole,
  etagere_murale: etagereMurale,
  refrigerateur,
  congelateur_armoire: congelateurArmoire,
  congelateur_coffre: congelateurCoffre,
  vitrine_refrigeree: vitrineRefrigeree,
  chambre_froide: chambreFroide,
  presentoir,
  bac_vrac: bacVrac,
  palette,
  portant,
  rack,
  armoire,
  armoire_tiroirs: armoireTiroirs,
  vitrine_fermee: vitrineFermee,
  comptoir,
  caisse,
  mur,
  poteau,
  porte,
  fenetre,
  escalier,
  texte,
};

/** Dessine un meuble (repère local). */
export function buildFixture(spec: FixtureSpec): Built {
  const group = new THREE.Group();
  const kit = new Kit();
  const doors: DoorPart[] = [];
  const model = spec.model.startsWith("zone_") ? zone : MODELS[spec.model] ?? generic;
  const r = model({ spec, kit, group, doors });
  kit.into(group);
  return { group, doors, top: r.top, cells: r.cells ?? (() => []) };
}

// ───────────────────────────── Produits dans les cases ─────────────────────────────

export interface Item {
  shape: "box" | "cyl" | "sphere";
  x: number;
  y: number;
  z: number;
  sx: number;
  sy: number;
  sz: number;
  /** Variation de teinte (-1 à 1) ; carton : couleur du carton. */
  tint: number;
  material: "product" | "carton" | "pallet";
}

/** Articles dessinés dans une case : plus il y a de produits, plus la case paraît garnie. */
export function cellItems(c: CellBox, products: number, seed: number): Item[] {
  const rand = mulberry(seed);
  const out: Item[] = [];
  const bottomY = c.y - c.h / 2;
  const add = (it: Omit<Item, "material"> & { material?: Item["material"] }) => out.push({ material: "product", ...it });
  switch (c.kind) {
    case "bottle": {
      const k = Math.min(8, Math.max(3, products * 2 + 1));
      const r = Math.min((c.w / k) * 0.42, c.d * 0.22, 0.05);
      const h = Math.min(c.h * 0.85, 0.34);
      for (let row = 0; row < 2; row++) {
        for (let i = 0; i < k; i++) {
          add({ shape: "cyl", x: c.x - c.w / 2 + (c.w / k) * (i + 0.5), y: bottomY + h / 2, z: c.z + (row ? -1 : 1) * c.d * 0.22, sx: r * 2, sy: h, sz: r * 2, tint: (rand() - 0.5) * 0.4 });
        }
      }
      break;
    }
    case "flat": {
      const k = Math.min(5, Math.max(2, products + 1));
      for (let i = 0; i < k; i++) {
        add({ shape: "box", x: c.x - c.w / 2 + (c.w / k) * (i + 0.5), y: bottomY + 0.03, z: c.z, sx: (c.w / k) * 0.85, sy: 0.05, sz: c.d * 0.7, tint: (rand() - 0.5) * 0.5 });
      }
      break;
    }
    case "hanger": {
      const k = Math.min(10, Math.max(3, products * 2 + 1));
      for (let i = 0; i < k; i++) {
        const h = c.h * (0.75 + rand() * 0.25);
        add({ shape: "box", x: c.x - c.w / 2 + (c.w / k) * (i + 0.5), y: c.y + c.h / 2 - h / 2, z: c.z, sx: 0.04, sy: h, sz: c.d, tint: (rand() - 0.5) * 0.8 });
      }
      break;
    }
    case "heap":
      add({ shape: "sphere", x: c.x, y: bottomY + c.h * 0.15, z: c.z, sx: c.w, sy: c.h * 0.9, sz: c.d, tint: (rand() - 0.5) * 0.3 });
      break;
    case "tag":
      add({ shape: "box", x: c.x, y: c.y, z: c.z, sx: c.w, sy: c.h, sz: c.d, tint: 0 });
      break;
    case "carton":
    case "pallet": {
      let y = bottomY;
      if (c.kind === "pallet") {
        out.push({ shape: "box", x: c.x, y: y + 0.07, z: c.z, sx: c.w, sy: 0.14, sz: c.d, tint: 0, material: "pallet" });
        y += 0.14;
      }
      const cols = Math.min(4, Math.max(1, products + 1));
      const bh = 0.28;
      const rows = Math.max(1, Math.floor((c.y + c.h / 2 - y) / bh));
      const stack = Math.max(1, Math.min(rows, Math.ceil((rows * Math.min(products, 4)) / 4)));
      for (let i = 0; i < cols; i++) {
        for (let j = 0; j < stack; j++) {
          out.push({ shape: "box", x: c.x - c.w / 2 + (c.w / cols) * (i + 0.5), y: y + bh * (j + 0.5), z: c.z, sx: (c.w / cols) * 0.94, sy: bh * 0.96, sz: c.d * 0.92, tint: rand() * 0.3, material: j === stack - 1 && i % 2 ? "product" : "carton" });
        }
      }
      break;
    }
    default: {
      const k = Math.min(7, Math.max(2, Math.round(products * 1.5) + 1));
      for (let i = 0; i < k; i++) {
        const h = c.h * (0.55 + rand() * 0.3);
        add({ shape: "box", x: c.x - c.w / 2 + (c.w / k) * (i + 0.5), y: bottomY + h / 2, z: c.z, sx: (c.w / k) * 0.86, sy: h, sz: c.d * 0.85, tint: (rand() - 0.5) * 0.5 });
      }
    }
  }
  return out;
}

/** Libère les géométries d'un meuble (les matériaux sont partagés). */
export function disposeObject(o: THREE.Object3D) {
  o.traverse((n) => {
    const m = n as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
    const mat = m.material as THREE.Material | undefined;
    // Matériaux propres (textes, photos, étiquettes) : avec une texture à libérer.
    if (mat && "map" in mat && (mat as THREE.MeshBasicMaterial).map && (mat as THREE.Material).userData.own !== false) {
      (mat as THREE.MeshBasicMaterial).map?.dispose();
      mat.dispose();
    }
  });
}
