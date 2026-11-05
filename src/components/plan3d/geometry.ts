// Calculs du plan en mètres (repère du plan : x vers la droite, y vers le bas) :
// emprise au sol, aimantation, chevauchements et chemin jusqu'à un meuble.
import type { Fixture } from "../../types";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Point {
  x: number;
  y: number;
}

type Placed = { x: number; y: number; w: number; h: number; rotation: number };

/** Emprise au sol d'un meuble tourné (rectangle englobant aligné sur les axes). */
export function footprint(f: Placed): Rect {
  const cx = f.x + f.w / 2;
  const cy = f.y + f.h / 2;
  const a = (f.rotation * Math.PI) / 180;
  const c = Math.abs(Math.cos(a));
  const s = Math.abs(Math.sin(a));
  const w = f.w * c + f.h * s;
  const h = f.w * s + f.h * c;
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}

export const overlap = (a: Rect, b: Rect, eps = 0.02) =>
  a.x + eps < b.x + b.w && b.x + eps < a.x + a.w && a.y + eps < b.y + b.h && b.y + eps < a.y + a.h;

/** Éléments posés au sol, qui ne gênent rien : pièces et textes. */
export const isFloorItem = (f: Pick<Fixture, "category" | "model">) => f.category === "zone" || f.model === "texte";

/** Murs, portes, fenêtres, poteaux : ils se croisent librement entre eux. */
const isBuilding = (f: Pick<Fixture, "category">) => f.category === "batiment";

/** Meuble qui gênerait la pose de `moving` à l'emprise `rect` (null : la place est libre). */
export function collision(moving: Fixture, rect: Rect, others: Fixture[]): Fixture | null {
  if (isFloorItem(moving) || isBuilding(moving)) return null;
  for (const o of others) {
    if (o.id === moving.id || isFloorItem(o) || o.model === "porte") continue;
    if (overlap(rect, footprint(o))) return o;
  }
  return null;
}

/** Meuble qui ne peut pas aller à sa nouvelle place : `by` le meuble qui gêne, null s'il sortirait du niveau. */
export interface PlacementProblem {
  fixture: Fixture;
  by: Fixture | null;
}

/**
 * Contrôle des nouvelles places (mêmes règles que le serveur) : aucun meuble ne sort du niveau ni n'en chevauche
 * un autre ; les meubles déplacés ensemble sont contrôlés à leurs nouvelles places ; un chevauchement qui
 * existait déjà avant le déplacement reste permis.
 */
export function placementProblem(
  fixtures: Fixture[],
  next: Record<number, Placed>,
  floor: { width: number; depth: number },
): PlacementProblem | null {
  const placed = fixtures.map((f) => (next[f.id] ? { ...f, ...next[f.id] } : f));
  for (const f of placed) {
    if (!next[f.id] || isFloorItem(f) || isBuilding(f)) continue;
    const was = fixtures.find((x) => x.id === f.id)!;
    const r = footprint(f);
    if (!insideFloor(r, floor) && insideFloor(footprint(was), floor)) return { fixture: f, by: null };
    for (const o of placed) {
      if (o.id === f.id || isFloorItem(o) || o.model === "porte") continue;
      const before = fixtures.find((x) => x.id === o.id)!;
      if (overlap(r, footprint(o)) && !overlap(footprint(was), footprint(before))) return { fixture: f, by: o };
    }
  }
  return null;
}

/** Direction de la façade d'un meuble (côté clients) dans le repère du plan. */
export function frontDir(rotation: number): Point {
  const a = (rotation * Math.PI) / 180;
  return { x: -Math.sin(a), y: Math.cos(a) };
}

/** Le meuble reste dans son niveau (à 2 cm près, comme le serveur). */
export const insideFloor = (r: Rect, floor: { width: number; depth: number }, eps = 0.02) =>
  r.x >= -eps && r.y >= -eps && r.x + r.w <= floor.width + eps && r.y + r.h <= floor.depth + eps;

/** Position aimantée et repères d'alignement : ligne verticale en x, horizontale en y (null : grille). */
export interface Snap extends Point {
  guideX: number | null;
  guideY: number | null;
}

/**
 * Aimantation pendant un déplacement : un bord (ou le milieu) du meuble se colle au bord d'un mur, d'un meuble
 * ou du niveau situé à moins de 15 cm ; sinon la position suit une grille de 10 cm. Retourne la position
 * (coin x, y du meuble) et la ligne de repère à dessiner.
 */
export function snapWithGuides(moving: Fixture, x: number, y: number, others: Fixture[], floor: { width: number; depth: number }): Snap {
  const R = 0.15;
  const grid = (v: number) => Math.round(v / 0.1) * 0.1;
  const fp = footprint({ ...moving, x, y });
  const xs = [0, floor.width];
  const ys = [0, floor.depth];
  for (const o of others) {
    if (o.id === moving.id || o.model === "texte") continue;
    const r = footprint(o);
    xs.push(r.x, r.x + r.w);
    ys.push(r.y, r.y + r.h);
    if (o.category !== "zone") {
      xs.push(r.x + r.w / 2);
      ys.push(r.y + r.h / 2);
    }
  }
  const best = (edges: number[], targets: number[]) => {
    let d = Infinity;
    let at = 0;
    for (const e of edges)
      for (const t of targets)
        if (Math.abs(t - e) < Math.abs(d)) {
          d = t - e;
          at = t;
        }
    return Math.abs(d) <= R ? { d, at } : null;
  };
  const sx = best([fp.x, fp.x + fp.w, fp.x + fp.w / 2], xs);
  const sy = best([fp.y, fp.y + fp.h, fp.y + fp.h / 2], ys);
  return {
    x: Math.round((sx ? x + sx.d : grid(x)) * 100) / 100,
    y: Math.round((sy ? y + sy.d : grid(y)) * 100) / 100,
    guideX: sx ? sx.at : null,
    guideY: sy ? sy.at : null,
  };
}

export function snapPosition(moving: Fixture, x: number, y: number, others: Fixture[], floor: { width: number; depth: number }): Point {
  const s = snapWithGuides(moving, x, y, others, floor);
  return { x: s.x, y: s.y };
}

/** Distance libre d'un côté du meuble jusqu'au mur ou au meuble le plus proche, avec les deux bouts de la cote. */
export interface Clearance {
  side: "left" | "right" | "top" | "bottom";
  dist: number;
  from: Point;
  to: Point;
}

/** Largeur d'allée sous laquelle on alerte (mètres), et largeur conseillée pour un chariot. */
export const AISLE_MIN = 0.9;
export const AISLE_ADVISED = 1.2;

/**
 * Cotes autour d'un meuble : distance libre à gauche, à droite, au-dessus et au-dessous, jusqu'au meuble
 * le plus proche en face (pièces, textes et portes ignorés) ou jusqu'au bord du niveau.
 */
export function clearances(r: Rect, obstacles: Rect[], floor: { width: number; depth: number }): Clearance[] {
  const cy = r.y + r.h / 2;
  const cx = r.x + r.w / 2;
  const facesY = (o: Rect) => o.y < r.y + r.h - 0.02 && o.y + o.h > r.y + 0.02;
  const facesX = (o: Rect) => o.x < r.x + r.w - 0.02 && o.x + o.w > r.x + 0.02;
  let left = 0;
  let right = floor.width;
  let top = 0;
  let bottom = floor.depth;
  for (const o of obstacles) {
    if (facesY(o)) {
      if (o.x + o.w <= r.x + 0.02) left = Math.max(left, o.x + o.w);
      if (o.x >= r.x + r.w - 0.02) right = Math.min(right, o.x);
    }
    if (facesX(o)) {
      if (o.y + o.h <= r.y + 0.02) top = Math.max(top, o.y + o.h);
      if (o.y >= r.y + r.h - 0.02) bottom = Math.min(bottom, o.y);
    }
  }
  const out: Clearance[] = [
    { side: "left", dist: r.x - left, from: { x: left, y: cy }, to: { x: r.x, y: cy } },
    { side: "right", dist: right - (r.x + r.w), from: { x: r.x + r.w, y: cy }, to: { x: right, y: cy } },
    { side: "top", dist: r.y - top, from: { x: cx, y: top }, to: { x: cx, y: r.y } },
    { side: "bottom", dist: bottom - (r.y + r.h), from: { x: cx, y: r.y + r.h }, to: { x: cx, y: bottom } },
  ];
  return out.filter((c) => c.dist > 0.02);
}

// ───────────────────────────── Chemin jusqu'au produit ─────────────────────────────

const STEP = 0.25;

/**
 * Chemin le plus court (points en mètres) entre deux points du niveau, en contournant les meubles
 * à 20 cm près (grille de 25 cm, déplacements en diagonale permis). Null si le point d'arrivée est enfermé.
 */
export function findPath(from: Point, to: Point, obstacles: Rect[], floor: { width: number; depth: number }): Point[] | null {
  const cols = Math.max(2, Math.ceil(floor.width / STEP));
  const rows = Math.max(2, Math.ceil(floor.depth / STEP));
  const blocked = new Uint8Array(cols * rows);
  const pad = 0.2;
  for (const r of obstacles) {
    const c0 = Math.max(0, Math.floor((r.x - pad) / STEP));
    const c1 = Math.min(cols - 1, Math.floor((r.x + r.w + pad) / STEP));
    const r0 = Math.max(0, Math.floor((r.y - pad) / STEP));
    const r1 = Math.min(rows - 1, Math.floor((r.y + r.h + pad) / STEP));
    for (let j = r0; j <= r1; j++) for (let i = c0; i <= c1; i++) blocked[j * cols + i] = 1;
  }
  const cell = (p: Point) => [Math.min(cols - 1, Math.max(0, Math.floor(p.x / STEP))), Math.min(rows - 1, Math.max(0, Math.floor(p.y / STEP)))];
  // Départ et arrivée : la case libre la plus proche.
  const nearestFree = ([ci, cj]: number[]) => {
    for (let rad = 0; rad < 12; rad++) {
      for (let j = cj - rad; j <= cj + rad; j++) {
        for (let i = ci - rad; i <= ci + rad; i++) {
          if (i < 0 || j < 0 || i >= cols || j >= rows) continue;
          if (Math.max(Math.abs(i - ci), Math.abs(j - cj)) !== rad) continue;
          if (!blocked[j * cols + i]) return j * cols + i;
        }
      }
    }
    return -1;
  };
  const start = nearestFree(cell(from));
  const goal = nearestFree(cell(to));
  if (start < 0 || goal < 0) return null;

  const g = new Float32Array(cols * rows).fill(Infinity);
  const came = new Int32Array(cols * rows).fill(-1);
  const closed = new Uint8Array(cols * rows);
  const gi = goal % cols;
  const gj = Math.floor(goal / cols);
  const h = (k: number) => {
    const dx = Math.abs((k % cols) - gi);
    const dy = Math.abs(Math.floor(k / cols) - gj);
    return Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy);
  };
  // File de priorité (tas binaire) sur f = g + h.
  const heap: [number, number][] = [];
  const push = (k: number, f: number) => {
    heap.push([f, k]);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p][0] <= heap[i][0]) break;
      [heap[p], heap[i]] = [heap[i], heap[p]];
      i = p;
    }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]];
        i = m;
      }
    }
    return top[1];
  };
  g[start] = 0;
  push(start, h(start));
  const dirs = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]];
  while (heap.length) {
    const k = pop();
    if (k === goal) break;
    if (closed[k]) continue;
    closed[k] = 1;
    const ki = k % cols;
    const kj = Math.floor(k / cols);
    for (const [di, dj, cost] of dirs) {
      const ni = ki + di;
      const nj = kj + dj;
      if (ni < 0 || nj < 0 || ni >= cols || nj >= rows) continue;
      const n = nj * cols + ni;
      if (blocked[n] || closed[n]) continue;
      // Pas de raccourci à travers le coin d'un meuble.
      if (di && dj && (blocked[kj * cols + ni] || blocked[nj * cols + ki])) continue;
      const ng = g[k] + cost;
      if (ng < g[n]) {
        g[n] = ng;
        came[n] = k;
        push(n, ng + h(n));
      }
    }
  }
  if (start !== goal && came[goal] < 0) return null;
  const cells: number[] = [];
  for (let k = goal; k >= 0; k = k === start ? -1 : came[k]) cells.push(k);
  cells.reverse();
  const pts = cells.map((k) => ({ x: ((k % cols) + 0.5) * STEP, y: (Math.floor(k / cols) + 0.5) * STEP }));
  // Lissage : on saute les points intermédiaires tant que la ligne droite reste libre.
  const free = (a: Point, b: Point) => {
    const n = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / (STEP / 2));
    for (let i = 1; i < n; i++) {
      const p = { x: a.x + ((b.x - a.x) * i) / n, y: a.y + ((b.y - a.y) * i) / n };
      const [ci, cj] = cell(p);
      if (blocked[cj * cols + ci]) return false;
    }
    return true;
  };
  const out: Point[] = [pts[0]];
  let i = 0;
  while (i < pts.length - 1) {
    let j = pts.length - 1;
    while (j > i + 1 && !free(pts[i], pts[j])) j--;
    out.push(pts[j]);
    i = j;
  }
  return out;
}

/** Point de départ du chemin : à l'intérieur de l'entrée, sinon devant la caisse, sinon au milieu du bas du niveau. */
export function entryPoint(fixtures: Fixture[], floor: { width: number; depth: number }): Point {
  const center = { x: floor.width / 2, y: floor.depth / 2 };
  const door = fixtures.find((f) => f.model === "porte") ?? fixtures.find((f) => f.model === "caisse");
  if (!door) return { x: floor.width / 2, y: floor.depth - 0.6 };
  const c = { x: door.x + door.w / 2, y: door.y + door.h / 2 };
  const d = frontDir(door.rotation);
  const a = { x: c.x + d.x * 0.9, y: c.y + d.y * 0.9 };
  const b = { x: c.x - d.x * 0.9, y: c.y - d.y * 0.9 };
  return Math.hypot(a.x - center.x, a.y - center.y) < Math.hypot(b.x - center.x, b.y - center.y) ? a : b;
}

/** Points devant un meuble (façade, et dos pour une gondole double face). */
export function approachPoints(f: Fixture): Point[] {
  const c = { x: f.x + f.w / 2, y: f.y + f.h / 2 };
  const d = frontDir(f.rotation);
  const off = f.h / 2 + 0.55;
  const pts = [{ x: c.x + d.x * off, y: c.y + d.y * off }];
  if (f.model === "gondole" || f.model === "presentoir" || f.model === "portant" || f.model === "bac_vrac" || f.model === "palette") {
    pts.push({ x: c.x - d.x * off, y: c.y - d.y * off });
  }
  return pts;
}
