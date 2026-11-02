import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Maximize, Minus, Plus } from "lucide-react";
import type { Fixture, Floor } from "../../types";

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

const SNAP = 0.1;
const snap = (v: number) => Math.round(v / SNAP) * SNAP;
const round2 = (v: number) => Math.round(v * 100) / 100;

interface Props {
  floor: Floor;
  fixtures: Fixture[];
  editable?: boolean;
  selectedId?: number | null;
  /** Meubles à faire clignoter (recherche d'un produit). */
  highlightIds?: number[];
  onSelect?: (f: Fixture | null) => void;
  /** Double-clic : vue de face du meuble. */
  onOpen?: (f: Fixture) => void;
  /** Fin d'un déplacement ou d'un redimensionnement (avant / après, pour annuler). */
  onGeometry?: (after: Geometry[], before: Geometry[]) => void;
  /** Meuble déposé depuis la palette (centre en mètres). */
  onDropType?: (typeId: number, x: number, y: number) => void;
  height?: number | string;
  /** Centre de la vue actuelle (pour ajouter un meuble au clic dans la palette). */
  viewCenterRef?: React.MutableRefObject<() => { x: number; y: number }>;
  svgRef?: React.MutableRefObject<SVGSVGElement | null>;
}

type Drag =
  | { kind: "pan"; startX: number; startY: number; view: View; moved: boolean }
  | { kind: "move"; id: number; start: { x: number; y: number }; orig: Geometry; moved: boolean }
  | { kind: "resize"; id: number; start: { x: number; y: number }; orig: Geometry };

interface View {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Plan de la boutique vu de dessus, à l'échelle (1 unité = 1 mètre) : pièces, murs, portes et meubles.
 * Consultation : déplacement, zoom, sélection. Modification : glisser les meubles, les redimensionner,
 * déposer un meuble de la palette.
 */
export function StoreMap({
  floor,
  fixtures,
  editable,
  selectedId,
  highlightIds,
  onSelect,
  onOpen,
  onGeometry,
  onDropType,
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
  const drag = useRef<Drag | null>(null);
  // Un déplacement de la vue ne désélectionne pas le meuble.
  const panned = useRef(false);
  // Clic sur un meuble : le « click » qui suit arrive au fond du plan (capture du pointeur) et ne doit pas
  // désélectionner. Double-clic détecté ici (deux appuis rapprochés) pour la même raison.
  const pressedFixture = useRef(false);
  const lastPress = useRef<{ id: number; t: number } | null>(null);

  useEffect(() => setView(fit()), [floor.id, fit]);
  useEffect(() => setOverride({}), [fixtures]);

  if (viewCenterRef) viewCenterRef.current = () => ({ x: view.x + view.w / 2, y: view.y + view.h / 2 });

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

  const zoom = (factor: number, cx?: number, cy?: number) => {
    setView((v) => {
      const w = Math.min(Math.max(v.w * factor, 1.5), Math.max(floor.width, floor.depth) * 4);
      const f = w / v.w;
      const px = cx ?? v.x + v.w / 2;
      const py = cy ?? v.y + v.h / 2;
      return { x: px - (px - v.x) * f, y: py - (py - v.y) * f, w, h: v.h * f };
    });
  };

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

  const onBackgroundDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    panned.current = false;
    pressedFixture.current = false;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    drag.current = { kind: "pan", startX: e.clientX, startY: e.clientY, view, moved: false };
  };

  const onFixtureDown = (e: ReactPointerEvent, f: Fixture) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    pressedFixture.current = true;
    const now = Date.now();
    if (lastPress.current && lastPress.current.id === f.id && now - lastPress.current.t < 450) {
      lastPress.current = null;
      onOpen?.(f);
      return;
    }
    lastPress.current = { id: f.id, t: now };
    onSelect?.(f);
    if (!editable) return;
    svgRef.current?.setPointerCapture(e.pointerId);
    drag.current = { kind: "move", id: f.id, start: toPlan(e.clientX, e.clientY), orig: geometryOf(f), moved: false };
  };

  const onHandleDown = (e: ReactPointerEvent, f: Fixture) => {
    e.stopPropagation();
    svgRef.current?.setPointerCapture(e.pointerId);
    drag.current = { kind: "resize", id: f.id, start: toPlan(e.clientX, e.clientY), orig: geometryOf(f) };
  };

  const onMove = (e: ReactPointerEvent<SVGSVGElement>) => {
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
    const dx = p.x - d.start.x;
    const dy = p.y - d.start.y;
    if (d.kind === "move") {
      if (!d.moved && Math.hypot(dx, dy) < 0.05) return;
      d.moved = true;
      setOverride((o) => ({ ...o, [d.id]: { ...d.orig, x: round2(snap(d.orig.x + dx)), y: round2(snap(d.orig.y + dy)) } }));
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
      setOverride((o) => ({ ...o, [d.id]: { ...d.orig, w, h, x: round2(cx - w / 2), y: round2(cy - h / 2) } }));
    }
  };

  const onUp = () => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.kind === "pan") {
      return;
    }
    const after = override[d.id];
    if (d.kind === "move" && !d.moved) return;
    if (after && (after.x !== d.orig.x || after.y !== d.orig.y || after.w !== d.orig.w || after.h !== d.orig.h)) {
      onGeometry?.([after], [d.orig]);
    }
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

  return (
    <div className="store-map" style={{ height }}>
      <svg
        ref={(el) => {
          svgRef.current = el;
          if (externalSvgRef) externalSvgRef.current = el;
        }}
        viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
        preserveAspectRatio="xMidYMid meet"
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
        aria-label={`Plan : ${floor.name}`}
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
        {list.map((f) => {
          const sel = f.id === selectedId;
          const hl = highlight.has(f.id);
          const isZone = f.category === "zone";
          const isText = f.type_code === "texte";
          const cx = f.x + f.w / 2;
          const cy = f.y + f.h / 2;
          const fs = isZone ? Math.min(unit * 2.4, f.h * 0.3) : label(f);
          return (
            <g key={f.id} className={`map-fixture cat-${f.category}${sel ? " selected" : ""}${hl ? " highlight" : ""}${editable ? " editable" : ""}`}>
              <g
                transform={`rotate(${f.rotation} ${cx} ${cy})`}
                onPointerDown={(e) => onFixtureDown(e, f)}
              >
                <rect
                  x={f.x}
                  y={f.y}
                  width={f.w}
                  height={f.h}
                  rx={isZone ? 0 : Math.min(f.w, f.h) * 0.08}
                  fill={isText ? "transparent" : f.type_code === "escalier" ? "url(#stairs)" : f.color}
                  fillOpacity={isZone ? 0.55 : 0.9}
                  stroke={sel ? "var(--accent-strong)" : isText ? "transparent" : "rgba(15, 23, 42, 0.45)"}
                  strokeWidth={sel ? unit * 0.5 : unit * 0.12}
                  strokeDasharray={isZone ? `${unit} ${unit * 0.6}` : undefined}
                />
                {hl && <rect className="map-pulse" x={f.x} y={f.y} width={f.w} height={f.h} fill="none" strokeWidth={unit * 0.7} />}
                {f.type_code === "porte" && (
                  <path d={`M ${f.x} ${f.y + f.h} A ${f.w} ${f.w} 0 0 1 ${f.x + f.w} ${f.y + f.h - f.w}`} fill="none" stroke="#16a34a" strokeWidth={unit * 0.15} strokeDasharray={`${unit * 0.5} ${unit * 0.4}`} />
                )}
              </g>
              {(f.storage || isZone || isText || f.type_code === "caisse") && (
                <g className="map-label" pointerEvents="none">
                  <text
                    transform={`scale(${1 / T})`}
                    x={(isZone ? f.x + unit : cx) * T}
                    y={(isZone ? f.y + fs * 1.1 : cy) * T}
                    fontSize={fs * T}
                    strokeWidth={fs * T * 0.14}
                    textAnchor={isZone ? "start" : "middle"}
                    dominantBaseline={isZone ? "auto" : "central"}
                    className={isZone || isText ? "map-text dark" : "map-text"}
                  >
                    {isZone || isText ? f.name : f.storage ? f.code : "Caisse"}
                  </text>
                  {f.storage && f.product_count > 0 && (
                    <g>
                      <circle cx={f.x + f.w} cy={f.y} r={unit * 1.3} className="map-count" />
                      <text
                        transform={`scale(${1 / T})`}
                        x={(f.x + f.w) * T}
                        y={f.y * T}
                        fontSize={unit * 1.3 * T}
                        textAnchor="middle"
                        dominantBaseline="central"
                        className="map-count-text"
                      >
                        {f.product_count}
                      </text>
                    </g>
                  )}
                </g>
              )}
              {editable && sel && (
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
      </svg>
      <div className="map-tools">
        <button type="button" className="icon-btn" onClick={() => zoom(1 / 1.3)} aria-label="Zoomer"><Plus size={16} /></button>
        <button type="button" className="icon-btn" onClick={() => zoom(1.3)} aria-label="Dézoomer"><Minus size={16} /></button>
        <button type="button" className="icon-btn" onClick={() => setView(fit())} aria-label="Voir tout le niveau"><Maximize size={15} /></button>
      </div>
      <div className="map-scale">
        {floor.name} · {floor.width} × {floor.depth} m · carreau = 1 m
      </div>
    </div>
  );
}
