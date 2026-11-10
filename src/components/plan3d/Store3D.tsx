import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { ArrowDown, ArrowUp, Image, Layers, Maximize, Package, RotateCcw, RotateCw, Sparkles } from "lucide-react";
import { useApp } from "../../context/AppContext";
import type { CellFill, Fixture, Floor } from "../../types";
import { DRAG_TYPE, geometryOf, problemMessage, type Geometry } from "../plan/StoreMap";
import { StoreEngine, type EngineOptions, type Highlight, type TourState, type ViewMode } from "./engine";
import { tl } from "../../lib/i18n";
import { isPhoneLike } from "../../lib/visibility";

const PREFS = "gm-plan3d";

function loadPrefs(): EngineOptions {
  try {
    const v = JSON.parse(localStorage.getItem(PREFS) ?? "{}");
    // Qualité « Simple » (sans ombres) par défaut sur téléphone et tablette : plus fluide, moins de batterie.
    const quality = v.quality === "simple" || v.quality === "realistic" ? v.quality : isPhoneLike() ? "simple" : "realistic";
    return { quality, products: v.products !== false, photos: !!v.photos, highWalls: !!v.highWalls };
  } catch {
    return { quality: isPhoneLike() ? "simple" : "realistic", products: true, photos: false, highWalls: false };
  }
}

export interface Store3DProps {
  floor: Floor;
  fixtures: Fixture[];
  fill: CellFill[];
  /** Vue d'ensemble (tourner autour) ou visite à hauteur d'homme. */
  mode: ViewMode;
  editable?: boolean;
  selectedId?: number | null;
  /** Produit recherché : meuble entouré, case qui clignote ; `showPath` : chemin depuis l'entrée. */
  highlight?: Highlight | null;
  showPath?: boolean;
  /** Meuble ouvert (vue de face affichée) : ses portes se referment quand il redevient vide. */
  openFixtureId?: number | null;
  onSelect?: (f: Fixture | null) => void;
  onOpen?: (f: Fixture) => void;
  onGeometry?: (after: Geometry[], before: Geometry[]) => void;
  onDropType?: (typeId: number, x: number, y: number) => void;
  /** La 3D n'a pas pu démarrer : la page revient au plan vu de dessus. */
  onUnavailable?: () => void;
  height?: number | string;
  /** Recherche d'un produit : outils réduits. */
  compact?: boolean;
  /** Affichages « État du stock » et « Ventes » : couleur de chaque meuble. */
  tints?: Record<number, string> | null;
  /** Reçoit la fonction qui capture la vue actuelle en image PNG (export du plan). */
  snapshotRef?: { current: (() => string | null) | null };
  /** Visite guidée jusqu'au produit (mode « walk ») : démarre toute seule. */
  tour?: boolean;
  onTourState?: (s: TourState | null) => void;
  /** Commandes de la visite guidée (pause, recommencer, vitesse, regarder autour). */
  tourRef?: { current: TourControls | null };
}

export interface TourControls {
  pause(paused: boolean): void;
  restart(): void;
  speed(factor: number): void;
  stop(): void;
}

/**
 * Plan de la boutique en 3D : meubles dessinés à leurs dimensions et garnis de leurs produits.
 * Vue d'ensemble (tourner, zoomer, déplacer les meubles en mode modification) ou visite comme dans les allées.
 */
export default function Store3D(p: Store3DProps) {
  const { toast } = useApp();
  const ref = useRef<HTMLDivElement>(null);
  const engine = useRef<StoreEngine | null>(null);
  const props = useRef(p);
  props.current = p;
  const [opts, setOpts] = useState<EngineOptions>(loadPrefs);

  useEffect(() => {
    if (!ref.current) return;
    let e: StoreEngine;
    try {
      e = new StoreEngine(
        ref.current,
        {
          onSelect: (id) => props.current.onSelect?.(props.current.fixtures.find((f) => f.id === id) ?? null),
          onOpen: (id) => {
            const f = props.current.fixtures.find((x) => x.id === id);
            if (f) props.current.onOpen?.(f);
          },
          onMove: (id, x, y) => {
            const f = props.current.fixtures.find((x) => x.id === id);
            if (f) props.current.onGeometry?.([{ ...geometryOf(f), x, y }], [geometryOf(f)]);
          },
          onBlocked: (problem) => toast.error(problemMessage(problem)),
        },
        opts,
      );
    } catch {
      props.current.onUnavailable?.();
      return;
    }
    engine.current = e;
    if (props.current.snapshotRef) props.current.snapshotRef.current = () => e.snapshot();
    return () => {
      if (props.current.snapshotRef) props.current.snapshotRef.current = null;
      e.dispose();
      engine.current = null;
    };
    // Le moteur est créé une seule fois ; les données suivent par les effets ci-dessous.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => engine.current?.setFloor(p.floor), [p.floor]);
  useEffect(() => engine.current?.setFixtures(p.fixtures), [p.fixtures]);
  useEffect(() => engine.current?.setFill(p.fill), [p.fill]);
  useEffect(() => engine.current?.setTints(p.tints ?? null), [p.tints]);
  useEffect(() => engine.current?.setEditable(!!p.editable), [p.editable]);
  useEffect(() => engine.current?.setSelected(p.selectedId ?? null), [p.selectedId]);
  useEffect(() => engine.current?.setMode(p.mode), [p.mode]);
  const h = p.highlight;
  useEffect(
    () => engine.current?.setHighlight(h ? { fixtureId: h.fixtureId, level: h.level, section: h.section } : null, !!p.showPath),
    [h?.fixtureId, h?.level, h?.section, p.showPath],
  );
  useEffect(() => {
    if (p.openFixtureId == null) engine.current?.closeDoors();
  }, [p.openFixtureId]);
  // Visite guidée : après le mode et le produit recherché (effets ci-dessus), et à chaque nouveau produit
  // ou nouveau plan (pas à chaque affichage : la visite ne recommence pas en marchant).
  const fixturesKey = p.fixtures.map((f) => `${f.id}:${f.x}:${f.y}`).join(",");
  useEffect(() => {
    const e = engine.current;
    if (!e) return;
    if (!p.tour) {
      e.stopTour();
      return;
    }
    const started = e.startTour((st) => props.current.onTourState?.(st));
    if (!started) props.current.onTourState?.(null);
    if (props.current.tourRef) {
      props.current.tourRef.current = {
        pause: (b) => e.pauseTour(b),
        restart: () => e.startTour(),
        speed: (f) => e.setTourSpeed(f),
        stop: () => e.stopTour(),
      };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.tour, h?.fixtureId, h?.level, h?.section, fixturesKey]);
  useEffect(() => {
    engine.current?.setOptions(opts);
    try {
      localStorage.setItem(PREFS, JSON.stringify(opts));
    } catch {
      // Préférences non mémorisées : sans conséquence.
    }
  }, [opts]);

  const toggle = (k: "products" | "photos" | "highWalls") => setOpts((o) => ({ ...o, [k]: !o[k] }));
  const hold = (forward: number, turn: number) => ({
    onPointerDown: (e: ReactPointerEvent) => {
      e.preventDefault();
      engine.current?.setWalkInput(forward, turn);
    },
    onPointerUp: () => engine.current?.setWalkInput(0, 0),
    onPointerLeave: () => engine.current?.setWalkInput(0, 0),
  });
  const walk = p.mode === "walk";

  return (
    <div
      className={`plan3d${p.compact ? " compact" : ""}`}
      style={{ height: p.height ?? 520 }}
      ref={ref}
      onDragOver={(e) => {
        if (p.onDropType && e.dataTransfer.types.includes(DRAG_TYPE)) e.preventDefault();
      }}
      onDrop={(e) => {
        const id = Number(e.dataTransfer.getData(DRAG_TYPE));
        const at = engine.current?.floorPointAt(e.clientX, e.clientY);
        if (id && at && p.onDropType) {
          e.preventDefault();
          p.onDropType(id, at.x, at.y);
        }
      }}
    >
      <div className="plan3d-tools">
        <button type="button" className="plan3d-tool" onClick={() => engine.current?.resetView()} title={walk ? tl("Revenir à l'entrée") : tl("Vue d'ensemble de la boutique")}>
          <Maximize size={14} /> {walk ? tl("Entrée") : tl("Vue d'ensemble")}
        </button>
        {!walk && (
          <button type="button" className={`plan3d-tool${opts.highWalls ? " active" : ""}`} onClick={() => toggle("highWalls")} title={tl("Murs à pleine hauteur ou coupés pour voir l'intérieur")}>
            <Layers size={14} /> {opts.highWalls ? tl("Murs hauts") : tl("Murs coupés")}
          </button>
        )}
        {!p.compact && (
          <>
            <button type="button" className={`plan3d-tool${opts.products ? " active" : ""}`} onClick={() => toggle("products")} title={tl("Afficher les produits rangés dans les cases")}>
              <Package size={14} /> {tl("Produits")}
            </button>
            <button type="button" className={`plan3d-tool${opts.photos ? " active" : ""}`} onClick={() => toggle("photos")} title={tl("Photos des produits sur la façade des cases")}>
              <Image size={14} /> {tl("Photos")}
            </button>
            <button
              type="button"
              className={`plan3d-tool${opts.quality === "realistic" ? " active" : ""}`}
              onClick={() => setOpts((o) => ({ ...o, quality: o.quality === "realistic" ? "simple" : "realistic" }))}
              title={tl("Réaliste : ombres et image fine. Simple : plus rapide sur un ordinateur modeste.")}
            >
              <Sparkles size={14} /> {opts.quality === "realistic" ? tl("Réaliste") : tl("Simple")}
            </button>
          </>
        )}
      </div>
      {walk && (
        <div className="plan3d-walk">
          <span />
          <button type="button" aria-label={tl("Avancer")} {...hold(1, 0)}><ArrowUp size={20} /></button>
          <span />
          <button type="button" aria-label={tl("Tourner à gauche")} {...hold(0, 1)}><RotateCcw size={20} /></button>
          <button type="button" aria-label={tl("Reculer")} {...hold(-1, 0)}><ArrowDown size={20} /></button>
          <button type="button" aria-label={tl("Tourner à droite")} {...hold(0, -1)}><RotateCw size={20} /></button>
        </div>
      )}
    </div>
  );
}
