import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Maximize, Minus, Plus } from "lucide-react";
import type { Fixture, Floor } from "../../types";
import { tl, tm } from "../../lib/i18n";
import { mediaUrl } from "../../lib/media";
import {
  AISLE_MIN,
  clearances,
  footprint,
  isFloorItem,
  placementProblem,
  snapWithGuides,
  type PlacementProblem,
  type Point,
  type Rect,
} from "../plan3d/geometry";

/** Position, taille (mètres) et rotation (degrés) d'un meuble. */
export interface Geometry {
  id: number;
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
}

export const geometryOf = (f: Fixture): Geometry => ({ id: f.id, x: f.x, y: f.y, w: f.w, h: f.h, rotation: f.rotation });

/** Type de données glissé depuis la palette. */
export const DRAG_TYPE = "application/x-gestimarket-fixture-type";

/** Couleur et texte d'un meuble dans les affichages « État du stock » et « Ventes ». */
export interface MapOverlay {
  color: string;
  /** Texte écrit sur le meuble (nombre, montant) et sa couleur. */
  label?: string;
  ink?: string;
  /** Info-bulle au survol. */
  title?: string;
}

/** Message d'un déplacement refusé (place occupée ou hors du niveau). */
export function problemMessage(p: PlacementProblem): string {
  return p.by
    ? tl("Place occupée par {0} : le meuble revient à sa place.", [tm(p.by.name)])
    : tl("{0} sortirait du niveau : le meuble revient à sa place.", [tm(p.fixture.name)]);
}

const SNAP = 0.1;
const snap = (v: number) => Math.round(v / SNAP) * SNAP;
const round2 = (v: number) => Math.round(v * 100) / 100;
const meters = (n: number) => `${String(round2(n)).replace(".", ",")} m`;
/** Passage plus étroit qu'une allée (moins de 0,90 m) mais assez large pour qu'on veuille y passer. */
const narrow = (d: number) => d >= 0.3 && d < AISLE_MIN;
const LONG_PRESS = 550;

interface Props {
  floor: Floor;
  fixtures: Fixture[];
  editable?: boolean;
  selectedId?: number | null;
  /** Sélection de plusieurs meubles (mode modification) : déplacés, alignés, supprimés ensemble. */
  selectedIds?: number[];
  /** Meubles à faire clignoter (recherche d'un produit). */
  highlightIds?: number[];
  onSelect?: (f: Fixture | null) => void;
  /** Maj + clic, appui long, cadre tracé avec Maj : nouvelle liste de meubles sélectionnés. */
  onSelectMany?: (ids: number[]) => void;
  /** Double-clic (ou appui long hors modification) : vue de face du meuble. */
  onOpen?: (f: Fixture) => void;
  /** Fin d'un déplacement ou d'un redimensionnement (avant / après, pour annuler). */
  onGeometry?: (after: Geometry[], before: Geometry[]) => void;
  /** Déplacement refusé : le meuble est revenu à sa place. */
  onBlocked?: (message: string) => void;
  /** Meuble déposé depuis la palette (centre en mètres). */
  onDropType?: (typeId: number, x: number, y: number) => void;
  /** Affichage « État du stock » ou « Ventes » : couleur et texte de chaque meuble. */
  overlay?: Record<number, MapOverlay> | null;
  height?: number | string;
  /** Centre de la vue actuelle (pour ajouter un meuble au clic dans la palette). */
  viewCenterRef?: React.MutableRefObject<() => { x: number; y: number }>;
  svgRef?: React.MutableRefObject<SVGSVGElement | null>;
}

type Drag =
  | { kind: "pan"; startX: number; startY: number; view: View; moved: boolean }
  | { kind: "move"; id: number; start: Point; origs: Geometry[]; moved: boolean; screen: Point }
  | { kind: "resize"; id: number; start: Point; orig: Geometry }
  | { kind: "band"; start: Point; now: Point; add: number[] };

interface View {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Plan de la boutique vu de dessus, à l'échelle (1 unité = 1 mètre) : pièces, murs, portes et meubles.
 * Consultation : déplacement, zoom (molette, boutons, deux doigts), sélection. Modification : glisser les meubles
 * (aimantés sur les murs et leurs voisins, cotes des allées), les redimensionner, en sélectionner plusieurs,
 * déposer un meuble de la palette. Un meuble ne peut ni sortir du niveau ni en chevaucher un autre.
 */
export function StoreMap({
  floor,
  fixtures,
  editable,
  selectedId,
  selectedIds,
  highlightIds,
  onSelect,
  onSelectMany,
  onOpen,
  onGeometry,
  onBlocked,
  onDropType,
  overlay,
  height = 520,
  viewCenterRef,
  svgRef: externalSvgRef,
}: Props) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const fit = useCallback((): View => {
    const m = 0.6;
    return { x: -m, y: -m, w: floor.width + 2 * m, h: floor.depth + 2 * m };
  }, [floor.width, floor.depth]);
  const [view, setView] = useState<View>(fit);
  const [override, setOverride] = useState<Record<number, Geometry>>({});
  const [blocked, setBlocked] = useState<PlacementProblem | null>(null);
  const [guides, setGuides] = useState<{ x: number | null; y: number | null } | null>(null);
  const [band, setBand] = useState<Rect | null>(null);
  const drag = useRef<Drag | null>(null);
  // Un déplacement de la vue ne désélectionne pas le meuble.
  const panned = useRef(false);
  // Clic sur un meuble : le « click » qui suit arrive au fond du plan (capture du pointeur) et ne doit pas
  // désélectionner. Double-clic détecté ici (deux appuis rapprochés) pour la même raison.
  const pressedFixture = useRef(false);
  const lastPress = useRef<{ id: number; t: number } | null>(null);
  // Doigts posés sur le plan (pincer pour zoomer) et appui long.
  const pointers = useRef(new Map<number, Point>());
  const pinch = useRef<{ mid: Point; dist: number } | null>(null);
  const longPress = useRef<number | null>(null);

  useEffect(() => setView(fit()), [floor.id, fit]);
  useEffect(() => setOverride({}), [fixtures]);

  if (viewCenterRef) viewCenterRef.current = () => ({ x: view.x + view.w / 2, y: view.y + view.h / 2 });

  const selection = useMemo(() => new Set(selectedIds?.length ? selectedIds : selectedId ? [selectedId] : []), [selectedIds, selectedId]);

  /** Coordonnées écran → mètres. */
  const toPlan = (clientX: number, clientY: number) => {
    const svg = svgRef.current;
    const ctm = svg?.getScreenCTM();
    if (!svg || !ctm) return { x: 0, y: 0 };
    const p = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());
    return { x: p.x, y: p.y };
  };

  const list = useMemo(() => fixtures.map((f) => ({ ...f, ...(override[f.id] ?? {}) })), [fixtures, override]);
  const highlight = useMemo(() => new Set(highlightIds ?? []), [highlightIds]);
  const maxW = Math.max(floor.width, floor.depth) * 4;

  /** Zoom de facteur `factor` autour du point `anchor` (mètres), puis décalage de la vue de `shift` (mètres). */
  const zoomAt = (factor: number, anchor?: Point, shift: Point = { x: 0, y: 0 }) => {
    setView((v) => {
      const w = Math.min(Math.max(v.w * factor, 1.5), maxW);
      const f = w / v.w;
      const px = anchor?.x ?? v.x + v.w / 2;
      const py = anchor?.y ?? v.y + v.h / 2;
      return { x: px - (px - v.x) * f + shift.x, y: py - (py - v.y) * f + shift.y, w, h: v.h * f };
    });
  };
  const zoom = (factor: number, cx?: number, cy?: number) => zoomAt(factor, cx === undefined || cy === undefined ? undefined : { x: cx, y: cy });

  // Molette : zoom autour du pointeur (écouteur non passif pour empêcher le défilement de la page).
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const p = toPlan(e.clientX, e.clientY);
      zoom(e.deltaY > 0 ? 1.15 : 1 / 1.15, p.x, p.y);
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  });

  const cancelLongPress = () => {
    if (longPress.current !== null) window.clearTimeout(longPress.current);
    longPress.current = null;
  };

  /** Annule le geste en cours (le meuble revient à sa place). */
  const cancelDrag = () => {
    cancelLongPress();
    drag.current = null;
    setOverride({});
    setBlocked(null);
    setGuides(null);
    setBand(null);
  };

  // Deux doigts : pincer pour zoomer, glisser pour déplacer la vue (le geste à un doigt est annulé).
  const onPointerDownCapture = (e: ReactPointerEvent<SVGSVGElement>) => {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      cancelDrag();
      const [a, b] = [...pointers.current.values()];
      pinch.current = { mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, dist: Math.max(10, Math.hypot(a.x - b.x, a.y - b.y)) };
      panned.current = true;
      svgRef.current?.setPointerCapture(e.pointerId);
    }
  };

  const onBackgroundDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (e.button !== 0 || pinch.current) return;
    panned.current = false;
    pressedFixture.current = false;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    if (editable && e.shiftKey && onSelectMany) {
      const p = toPlan(e.clientX, e.clientY);
      drag.current = { kind: "band", start: p, now: p, add: [...selection] };
      return;
    }
    drag.current = { kind: "pan", startX: e.clientX, startY: e.clientY, view, moved: false };
  };

  const toggle = (f: Fixture) => {
    const ids = new Set(selection);
    if (ids.has(f.id)) ids.delete(f.id);
    else ids.add(f.id);
    onSelectMany?.([...ids]);
  };

  const onFixtureDown = (e: ReactPointerEvent, f: Fixture) => {
    if (e.button !== 0 || pinch.current) return;
    e.stopPropagation();
    pressedFixture.current = true;
    // Maj + clic : ajouter ou retirer de la sélection.
    if (editable && e.shiftKey && onSelectMany) {
      toggle(f);
      return;
    }
    const now = Date.now();
    if (lastPress.current && lastPress.current.id === f.id && now - lastPress.current.t < 450) {
      lastPress.current = null;
      onOpen?.(f);
      return;
    }
    lastPress.current = { id: f.id, t: now };
    // Appui long au doigt : sélection multiple en modification, vue de face sinon.
    if (e.pointerType === "touch") {
      cancelLongPress();
      longPress.current = window.setTimeout(() => {
        longPress.current = null;
        cancelDrag();
        panned.current = true;
        if (editable && onSelectMany) toggle(f);
        else onOpen?.(f);
      }, LONG_PRESS);
    }
    const group = selection.has(f.id) && selection.size > 1;
    if (!group) onSelect?.(f);
    if (!editable) return;
    svgRef.current?.setPointerCapture(e.pointerId);
    const ids = group ? [...selection] : [f.id];
    const origs = fixtures.filter((x) => ids.includes(x.id)).map(geometryOf);
    drag.current = { kind: "move", id: f.id, start: toPlan(e.clientX, e.clientY), origs, moved: false, screen: { x: e.clientX, y: e.clientY } };
  };

  const onHandleDown = (e: ReactPointerEvent, f: Fixture) => {
    e.stopPropagation();
    if (pinch.current) return;
    svgRef.current?.setPointerCapture(e.pointerId);
    drag.current = { kind: "resize", id: f.id, start: toPlan(e.clientX, e.clientY), orig: geometryOf(f) };
  };

  const onMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const prev = pointers.current.get(e.pointerId);
    if (prev) pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch.current) {
      if (pointers.current.size < 2) return;
      const [a, b] = [...pointers.current.values()];
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const dist = Math.max(10, Math.hypot(a.x - b.x, a.y - b.y));
      const p = pinch.current;
      const before = toPlan(p.mid.x, p.mid.y);
      const after = toPlan(mid.x, mid.y);
      zoomAt(p.dist / dist, after, { x: before.x - after.x, y: before.y - after.y });
      pinch.current = { mid, dist };
      return;
    }
    const d = drag.current;
    if (!d) return;
    if (d.kind === "pan") {
      const svg = svgRef.current;
      if (!svg) return;
      const scale = d.view.w / svg.clientWidth;
      if (Math.hypot(e.clientX - d.startX, e.clientY - d.startY) > 3) {
        d.moved = true;
        panned.current = true;
      }
      setView({ ...d.view, x: d.view.x - (e.clientX - d.startX) * scale, y: d.view.y - (e.clientY - d.startY) * scale });
      return;
    }
    const p = toPlan(e.clientX, e.clientY);
    if (d.kind === "band") {
      d.now = p;
      setBand({ x: Math.min(d.start.x, p.x), y: Math.min(d.start.y, p.y), w: Math.abs(p.x - d.start.x), h: Math.abs(p.y - d.start.y) });
      return;
    }
    const dx = p.x - d.start.x;
    const dy = p.y - d.start.y;
    if (d.kind === "move") {
      if (Math.hypot(e.clientX - d.screen.x, e.clientY - d.screen.y) > 8) cancelLongPress();
      if (!d.moved && Math.hypot(dx, dy) < 0.05) return;
      d.moved = true;
      const lead = d.origs.find((g) => g.id === d.id) ?? d.origs[0];
      const leadFixture = fixtures.find((f) => f.id === lead.id);
      if (!leadFixture) return;
      const moving = new Set(d.origs.map((g) => g.id));
      const s = snapWithGuides({ ...leadFixture, ...lead }, lead.x + dx, lead.y + dy, fixtures.filter((f) => !moving.has(f.id)), floor);
      const next: Record<number, Geometry> = {};
      for (const g of d.origs) next[g.id] = { ...g, x: round2(g.x + s.x - lead.x), y: round2(g.y + s.y - lead.y) };
      setOverride(next);
      setGuides({ x: s.guideX, y: s.guideY });
      setBlocked(placementProblem(fixtures, next, floor));
    } else {
      // Redimensionnement dans le repère du meuble (tourné).
      const a = (-d.orig.rotation * Math.PI) / 180;
      const lx = dx * Math.cos(a) - dy * Math.sin(a);
      const ly = dx * Math.sin(a) + dy * Math.cos(a);
      const w = Math.max(0.1, round2(snap(d.orig.w + lx)));
      const h = Math.max(0.1, round2(snap(d.orig.h + ly)));
      // Le coin opposé reste en place : on recentre selon la rotation.
      const r = (d.orig.rotation * Math.PI) / 180;
      const dw = (w - d.orig.w) / 2;
      const dh = (h - d.orig.h) / 2;
      const cx = d.orig.x + d.orig.w / 2 + dw * Math.cos(r) - dh * Math.sin(r);
      const cy = d.orig.y + d.orig.h / 2 + dw * Math.sin(r) + dh * Math.cos(r);
      const next = { [d.id]: { ...d.orig, w, h, x: round2(cx - w / 2), y: round2(cy - h / 2) } };
      setOverride(next);
      setBlocked(placementProblem(fixtures, next, floor));
    }
  };

  const onUp = (e: ReactPointerEvent<SVGSVGElement>) => {
    pointers.current.delete(e.pointerId);
    cancelLongPress();
    if (pinch.current) {
      if (pointers.current.size < 2) pinch.current = null;
      drag.current = null;
      return;
    }
    const d = drag.current;
    drag.current = null;
    setGuides(null);
    if (!d || d.kind === "pan") return;
    if (d.kind === "band") {
      setBand(null);
      const r = { x: Math.min(d.start.x, d.now.x), y: Math.min(d.start.y, d.now.y), w: Math.abs(d.now.x - d.start.x), h: Math.abs(d.now.y - d.start.y) };
      if (r.w < 0.1 && r.h < 0.1) return;
      panned.current = true;
      const hit = fixtures
        .filter((f) => f.category !== "zone")
        .filter((f) => {
          const o = footprint(f);
          return o.x < r.x + r.w && r.x < o.x + o.w && o.y < r.y + r.h && r.y < o.y + o.h;
        })
        .map((f) => f.id);
      onSelectMany?.([...new Set([...d.add, ...hit])]);
      return;
    }
    if (d.kind === "move" && !d.moved) return;
    const before = d.kind === "move" ? d.origs : [d.orig];
    const after = before.map((g) => override[g.id]).filter(Boolean) as Geometry[];
    const problem = placementProblem(fixtures, override, floor);
    setBlocked(null);
    if (problem) {
      setOverride({});
      onBlocked?.(problemMessage(problem));
      return;
    }
    const changed = after.some((g, i) => g.x !== before[i].x || g.y !== before[i].y || g.w !== before[i].w || g.h !== before[i].h);
    if (after.length === before.length && changed) onGeometry?.(after, before);
    else setOverride({});
  };

  const onDrop = (e: React.DragEvent) => {
    const id = Number(e.dataTransfer.getData(DRAG_TYPE));
    if (!id || !onDropType) return;
    e.preventDefault();
    const p = toPlan(e.clientX, e.clientY);
    onDropType(id, p.x, p.y);
  };

  const unit = Math.max(view.w, view.h) / 100; // ≈ 1 % de la vue : traits et textes lisibles à tout zoom
  // Code d'un meuble : lisible même sur un petit meuble (le texte peut déborder, avec un contour).
  const label = (f: Fixture) => Math.min(Math.max(Math.min(f.w, f.h) * 0.5, unit * 2.1), unit * 4);
  // Les textes sont dessinés à 100× puis réduits : sinon Chromium serre les lettres des très petites tailles.
  const T = 100;

  // Cotes : autour du meuble déplacé, sinon du meuble sélectionné (un seul) en modification.
  const moving = Object.keys(override).map(Number);
  const measured = editable
    ? moving.length === 1
      ? list.find((f) => f.id === moving[0])
      : moving.length === 0 && selection.size === 1
        ? list.find((f) => selection.has(f.id))
        : undefined
    : undefined;
  const cotes = useMemo(() => {
    if (!measured || isFloorItem(measured) || measured.category === "batiment") return [];
    const obstacles = list.filter((o) => o.id !== measured.id && !isFloorItem(o) && o.model !== "porte").map((o) => footprint(o));
    return clearances(footprint(measured), obstacles, floor);
  }, [measured, list, floor]);
  const blockedIds = blocked ? new Set(moving) : null;

  const text = (x: number, y: number, size: number, value: string, className: string, anchor: "middle" | "start" = "middle", fill?: string) => (
    <text
      transform={`scale(${1 / T})`}
      x={x * T}
      y={y * T}
      fontSize={size * T}
      strokeWidth={size * T * 0.14}
      textAnchor={anchor}
      dominantBaseline="central"
      className={className}
      style={fill ? { fill } : undefined}
    >
      {value}
    </text>
  );

  return (
    <div className="store-map" style={{ height }}>
      <svg
        ref={(el) => {
          svgRef.current = el;
          if (externalSvgRef) externalSvgRef.current = el;
        }}
        viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
        preserveAspectRatio="xMidYMid meet"
        onPointerDownCapture={onPointerDownCapture}
        onPointerDown={onBackgroundDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onClick={(e) => {
          if (panned.current || pressedFixture.current) {
            panned.current = false;
            pressedFixture.current = false;
            return;
          }
          if (e.target === e.currentTarget || (e.target as Element).classList.contains("map-floor")) onSelect?.(null);
        }}
        onDragOver={(e) => {
          if (onDropType && e.dataTransfer.types.includes(DRAG_TYPE)) e.preventDefault();
        }}
        onDrop={onDrop}
        role="img"
        aria-label={tl("Plan : {0}", [floor.name])}
      >
        <defs>
          <pattern id={`grid-${floor.id}`} width="1" height="1" patternUnits="userSpaceOnUse">
            <path d="M 1 0 L 0 0 0 1" fill="none" className="map-grid" strokeWidth={unit * 0.08} />
          </pattern>
          <pattern id="stairs" width="0.3" height="0.3" patternUnits="userSpaceOnUse">
            <path d="M 0 0.15 L 0.3 0.15" stroke="#64748b" strokeWidth="0.04" />
          </pattern>
        </defs>
        <rect className="map-floor" x={0} y={0} width={floor.width} height={floor.depth} fill={`url(#grid-${floor.id})`} strokeWidth={unit * 0.25} />
        {floor.backdrop_id && floor.backdrop && (
          <image
            className="map-backdrop"
            href={mediaUrl(floor.backdrop_id)}
            x={floor.backdrop.x}
            y={floor.backdrop.y}
            width={floor.backdrop.w}
            height={floor.backdrop.h}
            opacity={floor.backdrop.opacity}
            preserveAspectRatio="none"
            pointerEvents="none"
          />
        )}
        {list.map((f) => {
          const sel = selection.has(f.id);
          const hl = highlight.has(f.id);
          const isZone = f.category === "zone";
          const isText = f.type_code === "texte";
          const cx = f.x + f.w / 2;
          const cy = f.y + f.h / 2;
          const fs = isZone ? Math.min(unit * 2.4, f.h * 0.3) : label(f);
          const ov = overlay ? overlay[f.id] : undefined;
          // Affichage « État du stock » / « Ventes » : les meubles sans valeur restent discrets.
          const dim = !!overlay && !ov && !isZone && !isText;
          const bad = blockedIds?.has(f.id);
          return (
            <g
              key={f.id}
              className={`map-fixture cat-${f.category}${sel ? " selected" : ""}${hl ? " highlight" : ""}${editable ? " editable" : ""}${bad ? " blocked" : ""}${dim ? " dim" : ""}`}
            >
              {ov?.title && <title>{ov.title}</title>}
              <g transform={`rotate(${f.rotation} ${cx} ${cy})`} onPointerDown={(e) => onFixtureDown(e, f)}>
                <rect
                  x={f.x}
                  y={f.y}
                  width={f.w}
                  height={f.h}
                  rx={isZone ? 0 : Math.min(f.w, f.h) * 0.08}
                  fill={isText ? "transparent" : ov ? ov.color : f.type_code === "escalier" ? "url(#stairs)" : f.color}
                  fillOpacity={isZone ? (floor.backdrop_id ? 0.15 : overlay ? 0.25 : 0.55) : dim ? 0.3 : 0.9}
                  stroke={bad ? "var(--danger)" : sel ? "var(--accent-strong)" : isText ? "transparent" : "rgba(15, 23, 42, 0.45)"}
                  strokeWidth={bad || sel ? unit * 0.5 : unit * 0.12}
                  strokeDasharray={isZone ? `${unit} ${unit * 0.6}` : undefined}
                />
                {hl && <rect className="map-pulse" x={f.x} y={f.y} width={f.w} height={f.h} fill="none" strokeWidth={unit * 0.7} />}
                {f.type_code === "porte" && (
                  <path d={`M ${f.x} ${f.y + f.h} A ${f.w} ${f.w} 0 0 1 ${f.x + f.w} ${f.y + f.h - f.w}`} fill="none" stroke="#16a34a" strokeWidth={unit * 0.15} strokeDasharray={`${unit * 0.5} ${unit * 0.4}`} />
                )}
              </g>
              {ov?.label ? (
                <g className="map-label" pointerEvents="none">
                  {text(cx, cy, label(f), ov.label, "map-text overlay", "middle", ov.ink)}
                </g>
              ) : (
                (f.storage || isZone || isText || f.type_code === "caisse") && (
                  <g className="map-label" pointerEvents="none">
                    {text(
                      isZone ? f.x + unit : cx,
                      isZone ? f.y + fs * 0.75 : cy,
                      fs,
                      isZone || isText ? tm(f.name) : f.storage ? f.code : tl("Caisse"),
                      isZone || isText ? "map-text dark" : "map-text",
                      isZone ? "start" : "middle",
                    )}
                    {!overlay && f.storage && f.product_count > 0 && (
                      <g>
                        <circle cx={f.x + f.w} cy={f.y} r={unit * 1.3} className="map-count" />
                        {text(f.x + f.w, f.y, unit * 1.3, String(f.product_count), "map-count-text")}
                      </g>
                    )}
                  </g>
                )
              )}
              {editable && sel && selection.size === 1 && (
                <g transform={`rotate(${f.rotation} ${cx} ${cy})`}>
                  <rect
                    className="map-handle"
                    x={f.x + f.w - unit * 0.9}
                    y={f.y + f.h - unit * 0.9}
                    width={unit * 1.8}
                    height={unit * 1.8}
                    onPointerDown={(e) => onHandleDown(e, f)}
                  />
                </g>
              )}
            </g>
          );
        })}
        {guides && (
          <g className="map-guides" pointerEvents="none">
            {guides.x !== null && <line x1={guides.x} y1={0} x2={guides.x} y2={floor.depth} strokeWidth={unit * 0.15} strokeDasharray={`${unit * 0.8} ${unit * 0.5}`} />}
            {guides.y !== null && <line x1={0} y1={guides.y} x2={floor.width} y2={guides.y} strokeWidth={unit * 0.15} strokeDasharray={`${unit * 0.8} ${unit * 0.5}`} />}
          </g>
        )}
        {cotes.length > 0 && (
          <g className="map-cotes" pointerEvents="none">
            {cotes.map((c) => {
              const vertical = c.side === "top" || c.side === "bottom";
              const tick = unit * 0.7;
              const mid = { x: (c.from.x + c.to.x) / 2, y: (c.from.y + c.to.y) / 2 };
              const cls = narrow(c.dist) ? "map-cote narrow" : "map-cote";
              return (
                <g key={c.side} className={cls}>
                  <line x1={c.from.x} y1={c.from.y} x2={c.to.x} y2={c.to.y} strokeWidth={unit * 0.14} />
                  {[c.from, c.to].map((p, i) =>
                    vertical ? (
                      <line key={i} x1={p.x - tick} y1={p.y} x2={p.x + tick} y2={p.y} strokeWidth={unit * 0.14} />
                    ) : (
                      <line key={i} x1={p.x} y1={p.y - tick} x2={p.x} y2={p.y + tick} strokeWidth={unit * 0.14} />
                    ),
                  )}
                  {text(vertical ? mid.x + unit * 0.9 : mid.x, vertical ? mid.y : mid.y - unit * 1.3, unit * 1.5, meters(c.dist), "map-cote-text", vertical ? "start" : "middle")}
                </g>
              );
            })}
          </g>
        )}
        {band && <rect className="map-band" x={band.x} y={band.y} width={band.w} height={band.h} strokeWidth={unit * 0.15} pointerEvents="none" />}
      </svg>
      <div className="map-tools">
        <button type="button" className="icon-btn" onClick={() => zoom(1 / 1.3)} aria-label={tl("Zoomer")}><Plus size={16} /></button>
        <button type="button" className="icon-btn" onClick={() => zoom(1.3)} aria-label={tl("Dézoomer")}><Minus size={16} /></button>
        <button type="button" className="icon-btn" onClick={() => setView(fit())} aria-label={tl("Voir tout le niveau")}><Maximize size={15} /></button>
      </div>
      {blocked && <div className="map-blocked">{problemMessage(blocked)}</div>}
      {!blocked && cotes.some((c) => narrow(c.dist)) && (
        <div className="map-blocked warn">{tl("Allée de moins de 0,90 m : trop étroite pour passer avec un panier (1,20 m conseillé pour un chariot).")}</div>
      )}
      <div className="map-scale">
        {tm(floor.name)} · {floor.width}  {tl("×")} {floor.depth}  {tl("m · carreau = 1 m")}</div>
    </div>
  );
}
