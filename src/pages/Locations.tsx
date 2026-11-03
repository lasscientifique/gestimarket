import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Box,
  Boxes,
  Copy,
  Footprints,
  Map as MapIcon,
  Repeat,
  WandSparkles,
  Eye,
  LayoutGrid,
  Pencil,
  Plus,
  Printer,
  Redo2,
  RotateCw,
  Settings2,
  Trash2,
  Undo2,
} from "lucide-react";
import { api } from "../api";
import { useApp } from "../context/AppContext";
import { HelpTip } from "../components/Help";
import { Field, Modal, PageHeader, StatCard } from "../components/ui";
import { useBusinessProfiles } from "../components/BusinessType";
import { DRAG_TYPE, StoreMap, geometryOf, type Geometry } from "../components/plan/StoreMap";
import { FixtureFront } from "../components/plan/FixtureFront";
import { printHtml } from "../lib/receipt";
import type { CellFill, Fixture, FixtureCategory, FixtureType, Floor, FloorStyle, LayoutInput, StorePlanData } from "../types";
import { collision, footprint } from "../components/plan3d/geometry";
import { saveView, savedView, webglAvailable, type PlanView } from "../components/plan3d/support";
import { tl, tm } from "../lib/i18n";

const GROUPS: { key: FixtureCategory; label: string }[] = [
  { key: "rayon", label: tl("Rayons") },
  { key: "froid", label: tl("Froid") },
  { key: "presentation", label: tl("Présentation") },
  { key: "rangement", label: tl("Rangement et réserve") },
  { key: "zone", label: tl("Pièces") },
  { key: "batiment", label: tl("Bâtiment") },
];
const CATEGORY_LABELS: Record<FixtureCategory, string> = {
  rayon: tl("Rayon"),
  froid: tl("Froid"),
  presentation: tl("Présentation"),
  rangement: tl("Rangement"),
  zone: tl("Pièce / zone"),
  batiment: tl("Bâtiment (mur, porte…)"),
};
// La 3D (three.js) n'est chargée qu'à l'ouverture du plan.
const Store3D = lazy(() => import("../components/plan3d/Store3D"));
const VIEW_KEY = "gm-plan-view";
const FLOOR_STYLES: { key: FloorStyle; label: string }[] = [
  { key: "tiles", label: tl("Carrelage") },
  { key: "concrete", label: tl("Béton") },
  { key: "wood", label: tl("Parquet") },
  { key: "vinyl", label: tl("Lino") },
];

const meters = (n: number) => `${String(Math.round(n * 100) / 100).replace(".", ",")} m`;
const round2 = (n: number) => Math.round(n * 100) / 100;

interface UndoStep {
  before: Geometry[];
  after: Geometry[];
}

/**
 * Plan de la boutique, comme un plan d'architecte : le gestionnaire pose ses meubles (gondoles,
 * frigos, congélateurs, vitrines, présentoirs, réserve…) sur le plan à l'échelle, puis range les
 * produits dans leurs étages et leurs cases. Il suffit ensuite de regarder le plan pour trouver un produit.
 */
export default function LocationsPage() {
  const { toast, confirm, askPin, settings } = useApp();
  const [plan, setPlan] = useState<StorePlanData | null>(null);
  const [floorId, setFloorId] = useState<number | null>(null);
  const [edit, setEdit] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [front, setFront] = useState<number | null>(null);
  const [undo, setUndo] = useState<UndoStep[]>([]);
  const [redo, setRedo] = useState<UndoStep[]>([]);
  const [modal, setModal] = useState<null | "floor-new" | Floor | "type-new" | FixtureType | "generate" | "wizard">(null);
  const [view, setViewState] = useState<PlanView>(() => savedView(VIEW_KEY, "3d"));
  const setView = (v: PlanView) => {
    setViewState(v);
    saveView(VIEW_KEY, v);
  };
  const [fill, setFill] = useState<CellFill[]>([]);
  const [unplaced, setUnplaced] = useState(0);
  const centerRef = useRef<() => { x: number; y: number }>(() => ({ x: 2, y: 2 }));
  const svgRef = useRef<SVGSVGElement | null>(null);
  const profiles = useBusinessProfiles();

  const load = useCallback(async () => {
    try {
      const p = await api.planGet();
      setPlan(p);
      setFloorId((id) => (id && p.floors.some((f) => f.id === id) ? id : p.floors[0]?.id ?? null));
      setUnplaced((await api.listProducts({ without_location: true, limit: 2000 })).length);
    } catch (e) {
      toast.error(e);
    }
  }, [toast]);
  useEffect(() => {
    load();
  }, [load]);

  const floor = plan?.floors.find((f) => f.id === floorId) ?? null;
  // Contenu des cases (produits dessinés dans les meubles en 3D).
  useEffect(() => {
    if (!floorId || view === "plan") return;
    api.planFloorFill(floorId).then(setFill).catch(() => setFill([]));
  }, [floorId, plan, view]);
  const fixtures = useMemo(() => plan?.fixtures.filter((f) => f.floor_id === floorId) ?? [], [plan, floorId]);
  const selected = fixtures.find((f) => f.id === selectedId) ?? null;
  const storage = plan?.fixtures.filter((f) => f.storage) ?? [];
  const emptyFloor = fixtures.every((f) => f.category === "zone");
  const placed = storage.reduce((s, f) => s + f.product_count, 0);
  const slots = storage.reduce((s, f) => s + f.levels * f.sections, 0);

  // Meubles proposés pour le type de commerce (en tête de la palette).
  const suggested = useMemo(() => {
    const codes = profiles?.profiles.find((p) => p.id === settings.business_type)?.fixtures ?? [];
    return codes.map((c) => plan?.types.find((t) => t.code === c)).filter(Boolean) as FixtureType[];
  }, [profiles, settings.business_type, plan]);

  const replaceFixture = (f: Fixture) => setPlan((p) => p && { ...p, fixtures: p.fixtures.map((x) => (x.id === f.id ? f : x)) });

  const applyGeometry = async (items: Geometry[]) => {
    setPlan((p) => p && { ...p, fixtures: p.fixtures.map((f) => ({ ...f, ...(items.find((g) => g.id === f.id) ?? {}) })) });
    try {
      await api.planMoveFixtures(items);
    } catch (e) {
      toast.error(e);
      load();
    }
  };
  const onGeometry = (after: Geometry[], before: Geometry[]) => {
    applyGeometry(after);
    setUndo((u) => [...u.slice(-49), { before, after }]);
    setRedo([]);
  };
  const doUndo = () => {
    const step = undo[undo.length - 1];
    if (!step) return;
    setUndo((u) => u.slice(0, -1));
    setRedo((r) => [...r, step]);
    applyGeometry(step.before);
  };
  const doRedo = () => {
    const step = redo[redo.length - 1];
    if (!step) return;
    setRedo((r) => r.slice(0, -1));
    setUndo((u) => [...u, step]);
    applyGeometry(step.after);
  };

  /** Prendre un meuble dans la palette et le poser : au point de dépôt, sinon à une place libre. */
  const addFixture = async (t: FixtureType, at?: { x: number; y: number }) => {
    if (!floor) return;
    try {
      const pos = at ? { x: round2(Math.max(0, at.x - t.width / 2)), y: round2(Math.max(0, at.y - t.depth / 2)) } : {};
      const f = await api.planSaveFixture(null, { type_id: t.id, floor_id: floor.id, ...pos });
      setPlan((p) => p && { ...p, fixtures: [...p.fixtures, f], types: p.types.map((x) => (x.id === t.id ? { ...x, used: x.used + 1 } : x)) });
      setSelectedId(f.id);
      if (f.storage) toast.success(tl("{0} posé sur le plan. Double-cliquez dessus pour y ranger des produits.", [tm(f.name)]));
      // Le niveau a pu s'agrandir (plus de place libre).
      if (!at) load();
    } catch (e) {
      toast.error(e);
    }
  };

  const duplicate = async (f: Fixture) => {
    try {
      const copy = await api.planSaveFixture(null, {
        type_id: f.type_id,
        floor_id: f.floor_id,
        name: undefined,
        x: round2(f.x + 0.5),
        y: round2(f.y + 0.5),
        w: f.w,
        h: f.h,
        rotation: f.rotation,
        levels: f.levels,
        sections: f.sections,
        color: f.custom_color,
      });
      setPlan((p) => p && { ...p, fixtures: [...p.fixtures, copy] });
      setSelectedId(copy.id);
    } catch (e) {
      toast.error(e);
    }
  };

  /** Trois copies côte à côte, séparées d'une allée de 1,30 m, du côté où il y a de la place. */
  const repeat = async (f: Fixture) => {
    if (!floor) return;
    const a = (f.rotation * Math.PI) / 180;
    const across = f.w >= f.h;
    const step = (across ? f.h : f.w) + 1.3;
    const dir = across ? { x: -Math.sin(a), y: Math.cos(a) } : { x: Math.cos(a), y: Math.sin(a) };
    const tryDir = (sign: number) =>
      [1, 2, 3].map((k) => ({ x: round2(f.x + sign * dir.x * step * k), y: round2(f.y + sign * dir.y * step * k) }));
    const fits = (pts: { x: number; y: number }[]) =>
      pts.every((p) => {
        const r = footprint({ ...f, ...p });
        return r.x >= -0.01 && r.y >= -0.01 && r.x + r.w <= floor.width + 0.01 && r.y + r.h <= floor.depth + 0.01 && !collision(f, r, fixtures);
      });
    const plus = tryDir(1);
    const minus = tryDir(-1);
    const pts = fits(plus) ? plus : fits(minus) ? minus : plus;
    try {
      const copies: Fixture[] = [];
      for (const p of pts) {
        copies.push(
          await api.planSaveFixture(null, {
            type_id: f.type_id,
            floor_id: f.floor_id,
            x: p.x,
            y: p.y,
            w: f.w,
            h: f.h,
            rotation: f.rotation,
            levels: f.levels,
            sections: f.sections,
            color: f.custom_color,
            height: f.custom_height ?? 0,
          }),
        );
      }
      setPlan((pl) => pl && { ...pl, fixtures: [...pl.fixtures, ...copies] });
      toast.success(tl("Rangée créée : {0} meubles de plus.", [copies.length]));
    } catch (e) {
      toast.error(e);
      load();
    }
  };

  const remove = async (f: Fixture) => {
    const msg = f.product_count
      ? tl("Supprimer {0} ? Les {1} produit(s) rangés dedans gardent leurs autres emplacements, sinon deviennent « non rangés ».", [f.name, f.product_count])
      : tl("Supprimer {0} du plan ?", [f.name]);
    if (!(await confirm({ title: tl("Supprimer du plan"), message: msg, danger: true, confirmLabel: tl("Supprimer") }))) return;
    try {
      let pin: string | null = null;
      if (f.product_count) {
        pin = await askPin({ title: tl("Supprimer un meuble garni"), level: "manager" });
        if (!pin) return;
      }
      await api.planDeleteFixture(f.id, pin);
      setSelectedId(null);
      load();
    } catch (e) {
      toast.error(e);
    }
  };

  const rotate = (f: Fixture) => onGeometry([{ ...geometryOf(f), rotation: (f.rotation + 90) % 360 }], [geometryOf(f)]);

  // Raccourcis du mode modification : Suppr, R, flèches, Ctrl+Z / Ctrl+Y, Ctrl+D.
  useEffect(() => {
    if (!edit) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName) || front || modal) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        return e.shiftKey ? doRedo() : doUndo();
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
        e.preventDefault();
        return doRedo();
      }
      if (!selected) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "d") {
        e.preventDefault();
        return void duplicate(selected);
      }
      if (e.key === "Delete") return void remove(selected);
      if (e.key.toLowerCase() === "r" && !e.ctrlKey) return rotate(selected);
      const step = e.shiftKey ? 1 : 0.1;
      const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
      if (d) {
        e.preventDefault();
        onGeometry([{ ...geometryOf(selected), x: round2(selected.x + d[0]), y: round2(selected.y + d[1]) }], [geometryOf(selected)]);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  /** Plan imprimable : dessin du niveau et légende des meubles. */
  const printPlan = () => {
    if (view !== "plan") {
      setView("plan");
      window.setTimeout(() => printRef.current(), 400);
      return;
    }
    if (!floor || !svgRef.current) return;
    const svg = svgRef.current.outerHTML;
    const rows = fixtures
      .filter((f) => f.storage)
      .sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }))
      .map((f) => `<tr><td><strong>${f.code}</strong></td><td>${tm(f.name)}</td><td>${tm(f.type_name)}</td><td>${f.levels} × ${f.sections}</td><td>${f.product_count}</td></tr>`)
      .join("");
    printHtml(`
      <div class="report-print plan-print">
        <h1>${settings.shop_name ?? ""} — ${tl("Plan : {0}", [tm(floor.name)])}</h1>
        <div class="plan-print-svg">${svg}</div>
        <table><thead><tr><th>${tl("Code")}</th><th>${tl("Meuble")}</th><th>${tl("Type")}</th><th>${tl("Étages × cases")}</th><th>${tl("Produits")}</th></tr></thead><tbody>${rows}</tbody></table>
      </div>`);
  };

  const printRef = useRef(printPlan);
  printRef.current = printPlan;

  if (!plan || !floor) {
    return (
      <div className="page">
        <PageHeader title={tl("Plan de la boutique")} />
        <p className="muted">{tl("Chargement…")}</p>
      </div>
    );
  }

  return (
    <div className="page plan-page">
      <PageHeader
        help="locations"
        title={tl("Plan de la boutique")}
        subtitle={tl("Dessinez votre boutique à l'échelle, posez vos meubles, puis rangez-y les produits : il suffit de regarder le plan pour trouver un produit.")}
        actions={
          <>
            <button className="btn" onClick={() => setModal("wizard")}><WandSparkles size={16} />  {tl("Créer ma boutique")}</button>
            <button className="btn" onClick={printPlan}><Printer size={16} />  {tl("Imprimer le plan")}</button>
            {edit ? (
              <button className="btn btn-primary" onClick={() => setEdit(false)}>{tl("Terminer la modification")}</button>
            ) : (
              <button className="btn btn-primary" onClick={() => setEdit(true)}><Pencil size={16} />  {tl("Modifier le plan")}</button>
            )}
          </>
        }
      />

      <div className="stats">
        <StatCard label={tl("Meubles de rangement")} value={storage.length} icon={<LayoutGrid size={18} />} tone="accent" />
        <StatCard label={tl("Cases")} value={slots} icon={<Boxes size={18} />} />
        <StatCard label={tl("Produits rangés")} value={placed} tone="success" />
        <StatCard label={tl("Produits non rangés")} value={unplaced} tone={unplaced ? "warning" : "default"} />
      </div>

      <div className="plan-floors">
        {webglAvailable() && (
          <div className="segmented plan-views" role="tablist">
            <button className={view === "plan" ? "active" : ""} onClick={() => setView("plan")} title={tl("Plan vu de dessus, précis et imprimable")}><MapIcon size={15} />  {tl("Dessus")}</button>
            <button className={view === "3d" ? "active" : ""} onClick={() => setView("3d")} title={tl("Boutique en 3D : tourner autour, zoomer, déplacer les meubles")}><Box size={15} />  {tl("3D")}</button>
            <button className={view === "walk" ? "active" : ""} onClick={() => setView("walk")} title={tl("Se promener dans les allées, à hauteur d'homme")}><Footprints size={15} />  {tl("Visite")}</button>
          </div>
        )}
        {plan.floors.map((f) => (
          <button key={f.id} className={`chip ${f.id === floorId ? "active" : ""}`} onClick={() => { setFloorId(f.id); setSelectedId(null); }}>
            {tm(f.name)}
          </button>
        ))}
        {edit && (
          <>
            <button className="chip" onClick={() => setModal("floor-new")}><Plus size={14} />  {tl("Niveau")}</button>
            <button className="icon-btn" title={tl("Nom et dimensions de ce niveau")} onClick={() => setModal(floor)}><Settings2 size={16} /></button>
            <span className="plan-undo">
              <button className="icon-btn" title={tl("Annuler (Ctrl+Z)")} disabled={!undo.length} onClick={doUndo}><Undo2 size={16} /></button>
              <button className="icon-btn" title={tl("Rétablir (Ctrl+Y)")} disabled={!redo.length} onClick={doRedo}><Redo2 size={16} /></button>
            </span>
          </>
        )}
      </div>

      <div className={`plan-layout${edit ? " editing" : ""}`}>
        {edit && (
          <Palette
            types={plan.types}
            suggested={suggested}
            onAdd={(t) => addFixture(t)}
            onNewType={() => setModal("type-new")}
            onEditType={(t) => setModal(t)}
            onGenerate={() => setModal("generate")}
            onWizard={() => setModal("wizard")}
          />
        )}
        <div className="card plan-canvas-card">
          {emptyFloor && (
            <div className="plan-empty">
              <WandSparkles size={26} />
              <div>
                <strong>{tl("Ce niveau est vide")}</strong>
                <span className="muted small">{tl("Créez votre boutique en 3 questions (taille, entrée, type de commerce) : murs, caisse, frigos et allées sont posés pour vous.")}</span>
              </div>
              <button className="btn btn-primary" onClick={() => setModal("wizard")}>{tl("Créer ma boutique")}</button>
            </div>
          )}
          {view !== "plan" ? (
            <Suspense fallback={<div className="plan3d plan3d-loading" style={{ height: "min(68vh, 720px)" }}>{tl("Chargement de la 3D…")}</div>}>
              <Store3D
                floor={floor}
                fixtures={fixtures}
                fill={fill}
                mode={view === "walk" ? "walk" : "orbit"}
                editable={edit && view === "3d"}
                selectedId={selectedId}
                openFixtureId={front}
                onSelect={(f) => setSelectedId(f?.id ?? null)}
                onOpen={(f) => f.storage && setFront(f.id)}
                onGeometry={onGeometry}
                onDropType={(id, x, y) => {
                  const t = plan.types.find((x) => x.id === id);
                  if (t) addFixture(t, { x, y });
                }}
                onUnavailable={() => setView("plan")}
                height="min(68vh, 720px)"
              />
            </Suspense>
          ) : (
          <StoreMap
            floor={floor}
            fixtures={fixtures}
            editable={edit}
            selectedId={selectedId}
            onSelect={(f) => setSelectedId(f?.id ?? null)}
            onOpen={(f) => f.storage && setFront(f.id)}
            onGeometry={onGeometry}
            onDropType={(id, x, y) => {
              const t = plan.types.find((x) => x.id === id);
              if (t) addFixture(t, { x, y });
            }}
            viewCenterRef={centerRef}
            svgRef={svgRef}
            height="min(68vh, 720px)"
          />
          )}
          <p className="muted small plan-hint">
            {view === "walk"
              ? tl("Visite : flèches (ou Z Q S D) pour marcher et tourner, glisser pour regarder autour, double-clic sur un meuble pour l'ouvrir.")
              : view === "3d"
                ? edit
                  ? tl("Glissez un meuble de la palette dans la boutique, déplacez-le à la souris ou au doigt : il s'aligne tout seul sur les murs et ses voisins. R : tourner.")
                  : tl("Glisser : tourner autour ; molette ou deux doigts : zoomer ; clic droit : déplacer la vue. Double-clic sur un meuble : l'ouvrir et voir ses produits.")
                : edit
              ? tl("Glissez un meuble de la palette sur le plan (ou cliquez dessus), déplacez-le, agrandissez-le par son coin, tournez-le avec R. Flèches : déplacer de 10 cm (Maj : 1 m).")
                  : tl("Cliquez sur un meuble pour le sélectionner, double-cliquez pour voir ses étages et ranger des produits. Molette : zoom ; glisser le fond : déplacer la vue.")}
          </p>
        </div>
        <aside className="card plan-side">
          {selected ? (
            <FixturePanel
              key={selected.id}
              fixture={selected}
              edit={edit}
              onOpen={() => setFront(selected.id)}
              onSaved={replaceFixture}
              onRotate={() => rotate(selected)}
              onDuplicate={() => duplicate(selected)}
              onRepeat={() => repeat(selected)}
              onDelete={() => remove(selected)}
            />
          ) : (
            <div className="plan-side-empty">
              <LayoutGrid size={28} strokeWidth={1.4} />
              <strong>{tl("Aucun meuble sélectionné")}</strong>
              <span className="muted small">
                {edit ? tl("Prenez un meuble dans la palette et posez-le sur le plan.") : tl("Cliquez sur un meuble du plan. Passez en « Modifier le plan » pour dessiner votre boutique.")}
              </span>
            </div>
          )}
        </aside>
      </div>

      {front && (
        <Modal title={tl("Vue de face et rangement")} onClose={() => setFront(null)} width={1180}>
          <FixtureFront fixtureId={front} editable onChanged={load} />
        </Modal>
      )}
      {(modal === "floor-new" || (modal && typeof modal === "object" && "depth" in modal && !("category" in modal))) && (
        <FloorForm
          floor={modal === "floor-new" ? null : (modal as Floor)}
          canDelete={plan.floors.length > 1}
          onClose={() => setModal(null)}
          onSaved={(id) => {
            setModal(null);
            if (id) setFloorId(id);
            load();
          }}
        />
      )}
      {(modal === "type-new" || (modal && typeof modal === "object" && "category" in modal)) && (
        <TypeForm type={modal === "type-new" ? null : (modal as FixtureType)} types={plan.types} onClose={() => setModal(null)} onSaved={() => { setModal(null); load(); }} />
      )}
      {modal === "wizard" && (
        <WizardModal
          floor={floor}
          empty={emptyFloor}
          onClose={() => setModal(null)}
          onDone={(id) => {
            setModal(null);
            setFloorId(id);
            setSelectedId(null);
            if (webglAvailable()) setView("3d");
            load();
          }}
        />
      )}
      {modal === "generate" && <GenerateModal onClose={() => setModal(null)} onDone={() => { setModal(null); load(); }} />}
    </div>
  );
}

/** Palette des meubles : glisser sur le plan (ou cliquer pour poser à une place libre). */
/** Miniatures 3D des meubles (calculées une fois, en arrière-plan). */
function useThumbnails(types: FixtureType[]): Record<number, string> {
  const [map, setMap] = useState<Record<number, string>>({});
  useEffect(() => {
    if (!webglAvailable()) return;
    let alive = true;
    import("../components/plan3d/thumbs")
      .then(({ thumbnail }) => {
        let i = 0;
        const next = () => {
          if (!alive) return;
          const batch: Record<number, string> = {};
          for (let k = 0; k < 4 && i < types.length; k++, i++) {
            const url = thumbnail(types[i]);
            if (url) batch[types[i].id] = url;
          }
          setMap((m) => ({ ...m, ...batch }));
          if (i < types.length) window.setTimeout(next, 20);
        };
        next();
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [types]);
  return map;
}

function Palette({
  types,
  suggested,
  onAdd,
  onNewType,
  onEditType,
  onGenerate,
  onWizard,
}: {
  types: FixtureType[];
  suggested: FixtureType[];
  onAdd: (t: FixtureType) => void;
  onNewType: () => void;
  onEditType: (t: FixtureType) => void;
  onGenerate: () => void;
  onWizard: () => void;
}) {
  const custom = types.filter((t) => !t.builtin);
  const thumbs = useThumbnails(types);
  const item = (t: FixtureType, keyPrefix = "") => (
    <div
      key={keyPrefix + t.id}
      className="palette-item"
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(DRAG_TYPE, String(t.id));
        e.dataTransfer.effectAllowed = "copy";
      }}
      onClick={() => onAdd(t)}
      title={tl("Glissez sur le plan, ou cliquez pour le poser à une place libre")}
    >
      {thumbs[t.id] ? (
        <img className="palette-thumb" src={thumbs[t.id]} alt="" draggable={false} />
      ) : (
        <span className={`palette-swatch cat-${t.category}`} style={{ background: t.color }} />
      )}
      <span className="palette-name">
        {tm(t.name)}
        <small>{t.storage ? tl("{0} × {1} · {2} ét. × {3}", [meters(t.width), meters(t.depth), t.levels, t.sections]) : tl("{0} × {1}", [meters(t.width), meters(t.depth)])}</small>
      </span>
      {!t.builtin && (
        <button
          type="button"
          className="icon-btn"
          title={tl("Modifier ce meuble personnalisé")}
          onClick={(e) => {
            e.stopPropagation();
            onEditType(t);
          }}
        >
          <Pencil size={13} />
        </button>
      )}
    </div>
  );
  return (
    <aside className="card palette">
      <div className="palette-actions">
        <button className="btn btn-sm btn-primary" onClick={onWizard}><WandSparkles size={14} />  {tl("Créer ma boutique")}</button>
        <button className="btn btn-sm" onClick={onNewType}><Plus size={14} />  {tl("Meuble personnalisé")}</button>
        <button className="btn btn-sm" onClick={onGenerate} title={tl("Plusieurs gondoles d'un coup (rayons A à F…)")}><LayoutGrid size={14} />  {tl("Série de rayons")}</button>
      </div>
      {suggested.length > 0 && (
        <div className="palette-group">
          <h5>{tl("Pour votre commerce")}</h5>
          {suggested.map((t) => item(t, "s"))}
        </div>
      )}
      {custom.length > 0 && (
        <div className="palette-group">
          <h5>{tl("Mes meubles")}</h5>
          {custom.map((t) => item(t))}
        </div>
      )}
      {GROUPS.map((g) => (
        <div key={g.key} className="palette-group">
          <h5>{g.label}</h5>
          {types.filter((t) => t.builtin && t.category === g.key).map((t) => item(t))}
        </div>
      ))}
    </aside>
  );
}

/** Propriétés du meuble sélectionné (nom, code, taille, étages, cases, couleur). */
function FixturePanel({
  fixture: f,
  edit,
  onOpen,
  onSaved,
  onRotate,
  onDuplicate,
  onRepeat,
  onDelete,
}: {
  fixture: Fixture;
  edit: boolean;
  onOpen: () => void;
  onSaved: (f: Fixture) => void;
  onRotate: () => void;
  onDuplicate: () => void;
  onRepeat: () => void;
  onDelete: () => void;
}) {
  const { toast } = useApp();
  const init = () => ({
    name: f.name,
    code: f.code,
    w: String(f.w).replace(".", ","),
    h: String(f.h).replace(".", ","),
    levels: String(f.levels),
    sections: String(f.sections),
    color: f.custom_color ?? "",
    notes: f.notes ?? "",
    height: f.custom_height ? String(f.custom_height).replace(".", ",") : "",
  });
  const [v, setV] = useState(init);
  useEffect(() => setV(init()), [f.id, f.w, f.h, f.name, f.code, f.levels, f.sections, f.custom_color, f.custom_height]);
  const num = (s: string) => Number(s.replace(",", "."));
  const set = (k: keyof ReturnType<typeof init>) => (e: { target: { value: string } }) => setV({ ...v, [k]: e.target.value });

  const save = async () => {
    try {
      const saved = await api.planSaveFixture(f.id, {
        name: v.name,
        code: v.code,
        w: num(v.w),
        h: num(v.h),
        levels: f.storage ? Number(v.levels) : undefined,
        sections: f.storage ? Number(v.sections) : undefined,
        color: v.color,
        notes: v.notes,
        height: v.height.trim() ? num(v.height) : 0,
      });
      onSaved(saved);
      toast.success(tl("Meuble enregistré."));
    } catch (e) {
      toast.error(e);
    }
  };

  return (
    <div className="fixture-panel">
      <div className="fixture-panel-head">
        <span className="front-swatch" style={{ background: f.color }} />
        <div>
          <strong>{tm(f.name)}</strong>
          <span className="muted small">{tm(f.type_name)} · {f.code}</span>
        </div>
      </div>
      {f.storage && (
        <div className="fixture-panel-stats">
          <span><strong>{f.levels}</strong>  {tl("étage(s) ×")} <strong>{f.sections}</strong>  {tl("case(s)")}</span>
          <span><strong>{f.product_count}</strong>  {tl("produit(s)")}</span>
        </div>
      )}
      {f.storage && (
        <button className="btn btn-primary btn-block" onClick={onOpen}><Eye size={16} />  {tl("Vue de face et rangement")}</button>
      )}
      {edit && (
        <>
          <div className="form-grid">
            <Field label={tl("Nom")} span={2}><input value={v.name} onChange={set("name")} /></Field>
            <Field label={tl("Code")}><input value={v.code} onChange={(e) => setV({ ...v, code: e.target.value.toUpperCase() })} /></Field>
            <Field label={tl("Couleur")}>
              <span className="color-field">
                <input type="color" value={v.color || f.color} onChange={set("color")} />
                {v.color && <button type="button" className="link-btn small" onClick={() => setV({ ...v, color: "" })}>{tl("Par défaut")}</button>}
              </span>
            </Field>
            <Field label={tl("Largeur (m)")}><input inputMode="decimal" value={v.w} onChange={set("w")} /></Field>
            <Field label={tl("Profondeur (m)")}><input inputMode="decimal" value={v.h} onChange={set("h")} /></Field>
            <Field label={tl("Hauteur (m)")} hint={tl("Vide : hauteur du modèle ({0})", [meters(f.height)])}>
              <input inputMode="decimal" value={v.height} onChange={set("height")} placeholder={String(f.height).replace(".", ",")} />
            </Field>
            {f.storage && (
              <>
                <Field label={tl("Étages")}><input inputMode="numeric" value={v.levels} onChange={set("levels")} /></Field>
                <Field label={tl("Cases par étage")}><input inputMode="numeric" value={v.sections} onChange={set("sections")} /></Field>
              </>
            )}
            <Field label={tl("Notes")} span={2}><input value={v.notes} onChange={set("notes")} placeholder={tl("Ex. boissons fraîches, porte à gauche")} /></Field>
          </div>
          <button className="btn btn-primary btn-block" onClick={save}>{tl("Enregistrer")}</button>
          <div className="fixture-panel-actions">
            <button className="btn btn-sm" onClick={onRotate} title={tl("Tourner de 90° (R)")}><RotateCw size={14} />  {tl("Tourner")}</button>
            <button className="btn btn-sm" onClick={onDuplicate} title={tl("Dupliquer (Ctrl+D)")}><Copy size={14} />  {tl("Dupliquer")}</button>
            <button className="btn btn-sm" onClick={onRepeat} title={tl("Trois copies en rangée, avec une allée de 1,30 m")}><Repeat size={14} />  {tl("Répéter ×3")}</button>
            <button className="btn btn-sm btn-danger-outline" onClick={onDelete} title={tl("Supprimer (Suppr)")}><Trash2 size={14} />  {tl("Supprimer")}</button>
          </div>
          <p className="muted small">{tl("Position :")} {meters(f.x)} ; {meters(f.y)}  {tl("· rotation")} {f.rotation}°</p>
        </>
      )}
      {!edit && f.notes && <p className="muted small">{f.notes}</p>}
    </div>
  );
}

function FloorForm({ floor, canDelete, onClose, onSaved }: { floor: Floor | null; canDelete: boolean; onClose: () => void; onSaved: (id: number | null) => void }) {
  const { toast, askPin, confirm } = useApp();
  const [f, setF] = useState({
    name: floor?.name ?? tl("1er étage"),
    width: String(floor?.width ?? 20),
    depth: String(floor?.depth ?? 12),
    wall_height: String(floor?.wall_height ?? 3).replace(".", ","),
    floor_style: (floor?.floor_style ?? "tiles") as FloorStyle,
  });
  const num = (s: string) => Number(s.replace(",", "."));
  const submit = async () => {
    try {
      const id = await api.planSaveFloor(floor?.id ?? null, {
        name: f.name,
        width: num(f.width),
        depth: num(f.depth),
        wall_height: num(f.wall_height),
        floor_style: f.floor_style,
      });
      onSaved(id);
    } catch (e) {
      toast.error(e);
    }
  };
  const remove = async () => {
    if (!floor) return;
    if (!(await confirm({ title: tl("Supprimer le niveau"), message: tl("Supprimer « {0} » et ses meubles (vides) ?", [floor.name]), danger: true, confirmLabel: tl("Supprimer") }))) return;
    try {
      const pin = await askPin({ title: tl("Supprimer un niveau du plan"), level: "manager" });
      if (!pin) return;
      await api.planDeleteFloor(floor.id, pin);
      onSaved(null);
    } catch (e) {
      toast.error(e);
    }
  };
  return (
    <Modal
      title={floor ? tl("Niveau du bâtiment") : tl("Nouveau niveau")}
      onClose={onClose}
      width={460}
      footer={
        <>
          {floor && canDelete && <button className="btn btn-danger-outline" onClick={remove}><Trash2 size={15} />  {tl("Supprimer")}</button>}
          <button className="btn" onClick={onClose}>{tl("Annuler")}</button>
          <button className="btn btn-primary" onClick={submit}>{tl("Enregistrer")}</button>
        </>
      }
    >
      <div className="form-grid">
        <Field label={tl("Nom *")} span={2} hint={tl("Ex. Rez-de-chaussée, 1er étage, Entrepôt, Magasin 2")}><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus /></Field>
        <Field label={tl("Largeur (m)")}><input inputMode="decimal" value={f.width} onChange={(e) => setF({ ...f, width: e.target.value })} /></Field>
        <Field label={tl("Profondeur (m)")}><input inputMode="decimal" value={f.depth} onChange={(e) => setF({ ...f, depth: e.target.value })} /></Field>
        <Field label={tl("Hauteur des murs (m)")}><input inputMode="decimal" value={f.wall_height} onChange={(e) => setF({ ...f, wall_height: e.target.value })} /></Field>
        <Field label={tl("Sol")}>
          <select value={f.floor_style} onChange={(e) => setF({ ...f, floor_style: e.target.value as FloorStyle })}>
            {FLOOR_STYLES.map((s) => (
              <option key={s.key} value={s.key}>{s.label}</option>
            ))}
          </select>
        </Field>
      </div>
    </Modal>
  );
}

/** Meuble personnalisé : l'utilisateur n'est pas limité à la palette de base. */
function TypeForm({ type, types, onClose, onSaved }: { type: FixtureType | null; types: FixtureType[]; onClose: () => void; onSaved: () => void }) {
  const { toast, confirm } = useApp();
  const [f, setF] = useState({
    name: type?.name ?? "",
    category: (type?.category ?? "rangement") as FixtureCategory,
    prefix: type?.prefix ?? "M",
    color: type?.color ?? "#0d9488",
    width: String(type?.width ?? 1).replace(".", ","),
    depth: String(type?.depth ?? 0.6).replace(".", ","),
    levels: String(type?.levels ?? 4),
    sections: String(type?.sections ?? 2),
    model: type?.model ?? "",
    height: String(type?.height ?? 1.8).replace(".", ","),
  });
  const num = (s: string) => Number(s.replace(",", "."));
  // Formes 3D : celles des meubles de base de la même famille d'abord.
  const shapes = types.filter((t) => t.builtin).sort((a, b) => Number(b.category === f.category) - Number(a.category === f.category));
  const storage = !["zone", "batiment"].includes(f.category);
  const submit = async () => {
    try {
      await api.planSaveType(type?.id ?? null, {
        name: f.name,
        category: f.category,
        prefix: f.prefix,
        color: f.color,
        width: num(f.width),
        depth: num(f.depth),
        levels: Number(f.levels) || 1,
        sections: Number(f.sections) || 1,
        model: f.model || undefined,
        height: f.height.trim() ? num(f.height) : undefined,
      });
      toast.success(tl("Meuble personnalisé enregistré : il est dans la palette."));
      onSaved();
    } catch (e) {
      toast.error(e);
    }
  };
  const remove = async () => {
    if (!type || !(await confirm({ title: tl("Supprimer ce meuble de la palette"), message: tl("Supprimer « {0} » ?", [type.name]), danger: true, confirmLabel: tl("Supprimer") }))) return;
    try {
      await api.planDeleteType(type.id);
      onSaved();
    } catch (e) {
      toast.error(e);
    }
  };
  return (
    <Modal
      title={type ? tl("Meuble personnalisé") : tl("Nouveau meuble personnalisé")}
      onClose={onClose}
      width={560}
      footer={
        <>
          {type && <button className="btn btn-danger-outline" onClick={remove}><Trash2 size={15} />  {tl("Supprimer")}</button>}
          <button className="btn" onClick={onClose}>{tl("Annuler")}</button>
          <button className="btn btn-primary" disabled={!f.name.trim()} onClick={submit}>{tl("Enregistrer")}</button>
        </>
      }
    >
      <div className="form-grid">
        <Field label={tl("Nom *")} span={2} hint={tl("Ex. Frigo à boissons Coca, Étagère à épices, Vitrine à pain, Casier à bouteilles de gaz")}>
          <input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus />
        </Field>
        <Field label={tl("Famille")}>
          <select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value as FixtureCategory })}>
            {Object.entries(CATEGORY_LABELS).map(([k, label]) => (
              <option key={k} value={k}>{label}</option>
            ))}
          </select>
        </Field>
        <Field label={tl("Début des codes")} hint={tl("1 à 3 lettres : FB → FB1, FB2…")}>
          <input value={f.prefix} maxLength={3} onChange={(e) => setF({ ...f, prefix: e.target.value.toUpperCase().replace(/[^A-Z]/g, "") })} />
        </Field>
        <Field label={tl("Largeur (m)")}><input inputMode="decimal" value={f.width} onChange={(e) => setF({ ...f, width: e.target.value })} /></Field>
        <Field label={tl("Profondeur (m)")}><input inputMode="decimal" value={f.depth} onChange={(e) => setF({ ...f, depth: e.target.value })} /></Field>
        {storage && (
          <>
            <Field label={tl("Étages")}><input inputMode="numeric" value={f.levels} onChange={(e) => setF({ ...f, levels: e.target.value })} /></Field>
            <Field label={tl("Cases par étage")}><input inputMode="numeric" value={f.sections} onChange={(e) => setF({ ...f, sections: e.target.value })} /></Field>
          </>
        )}
        <Field label={tl("Couleur sur le plan")}><input type="color" value={f.color} onChange={(e) => setF({ ...f, color: e.target.value })} /></Field>
        <Field label={tl("Hauteur (m)")}><input inputMode="decimal" value={f.height} onChange={(e) => setF({ ...f, height: e.target.value })} /></Field>
        <Field label={tl("Dessin en 3D")} span={2} hint={tl("Le meuble de base qui lui ressemble le plus (frigo vitré, étagère, vitrine…).")}>
          <select value={f.model} onChange={(e) => setF({ ...f, model: e.target.value })}>
            <option value="">{tl("Selon la famille")}</option>
            {shapes.map((t) => (
              <option key={t.code} value={t.code}>{tm(t.name)}</option>
            ))}
          </select>
        </Field>
      </div>
      {!storage && <p className="muted small">{tl("Les pièces et les éléments du bâtiment (murs, portes…) servent à se repérer : ils ne reçoivent pas de produits.")}</p>}
    </Modal>
  );
}

/** Série de gondoles d'un coup : rayons A à F, N étages × M cases. */
function GenerateModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { toast } = useApp();
  const [f, setF] = useState({ bloc: "A", bloc_to: "", label: "", etage_from: "1", etage_to: "5", rangee_from: "1", rangee_to: "6" });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const n = (s: string) => Math.max(0, Math.floor(Number(s) || 0));
  const count = (() => {
    const a = f.bloc.trim().toUpperCase();
    const b = f.bloc_to.trim().toUpperCase();
    if (!b) return 1;
    if (/^[A-Z]$/.test(a) && /^[A-Z]$/.test(b)) return Math.max(0, b.charCodeAt(0) - a.charCodeAt(0) + 1);
    if (/^\d+$/.test(a) && /^\d+$/.test(b)) return Math.max(0, Number(b) - Number(a) + 1);
    return 0;
  })();
  const submit = async () => {
    try {
      const created = await api.generateLocations({
        bloc: f.bloc,
        bloc_to: f.bloc_to || null,
        label: f.label || null,
        etage_from: n(f.etage_from),
        etage_to: n(f.etage_to),
        rangee_from: n(f.rangee_from),
        rangee_to: n(f.rangee_to),
      });
      toast.success(tl("{0} rayon(s) posé(s) sur le plan, {1} case(s).", [count, created]));
      onDone();
    } catch (e) {
      toast.error(e);
    }
  };
  return (
    <Modal
      title={<>{tl("Série de rayons (gondoles)")} <HelpTip k="generate_blocs" /></>}
      onClose={onClose}
      width={520}
      footer={<><button className="btn" onClick={onClose}>{tl("Annuler")}</button><button className="btn btn-primary" disabled={!f.bloc.trim() || count === 0} onClick={submit}>{tl("Créer")} {count}  {tl("rayon(s)")}</button></>}
    >
      <div className="form-grid">
        <Field label={tl("Premier rayon *")} hint={tl("Lettre (A, B…) ou numéro")}><input value={f.bloc} onChange={(e) => setF({ ...f, bloc: e.target.value.toUpperCase() })} autoFocus /></Field>
        <Field label={tl("…jusqu'au rayon (facultatif)")} hint={tl("Ex. A à F : 6 rayons d'un coup")}><input value={f.bloc_to} onChange={(e) => setF({ ...f, bloc_to: e.target.value.toUpperCase() })} placeholder="—" /></Field>
        <Field label={tl("Nom (facultatif)")} span={2}><input value={f.label} onChange={set("label")} placeholder={tl("Ex. Épicerie, Boissons…")} /></Field>
        <Field label={tl("Étages : du")}><input inputMode="numeric" value={f.etage_from} onChange={set("etage_from")} /></Field>
        <Field label="au"><input inputMode="numeric" value={f.etage_to} onChange={set("etage_to")} /></Field>
        <Field label={tl("Cases : de")}><input inputMode="numeric" value={f.rangee_from} onChange={set("rangee_from")} /></Field>
        <Field label={tl("à")}><input inputMode="numeric" value={f.rangee_to} onChange={set("rangee_to")} /></Field>
      </div>
      <p className="muted small">{tl("Les rayons sont posés aux places libres du plan : déplacez-les ensuite où ils sont réellement.")}</p>
    </Modal>
  );
}

type EntrySide = LayoutInput["entry"];
const ENTRIES: { key: EntrySide; label: string }[] = [
  { key: "bottom", label: tl("En bas") },
  { key: "top", label: tl("En haut") },
  { key: "left", label: tl("À gauche") },
  { key: "right", label: tl("À droite") },
];

/** Assistant « Créer ma boutique » : taille de la salle, côté de l'entrée, type de commerce. */
function WizardModal({ floor, empty, onClose, onDone }: { floor: Floor; empty: boolean; onClose: () => void; onDone: (floorId: number) => void }) {
  const { toast, confirm, settings } = useApp();
  const profiles = useBusinessProfiles();
  const [f, setF] = useState({
    width: "12",
    depth: "9",
    entry: "bottom" as EntrySide,
    storage: true,
    business: settings.business_type ?? "",
    target: (empty ? "replace" : "new") as "replace" | "new",
    name: tl("Boutique"),
  });
  const [busy, setBusy] = useState(false);
  const num = (s: string) => Number(s.replace(",", "."));
  const W = num(f.width);
  const D = num(f.depth);
  const valid = W >= 3 && D >= 3 && W <= 200 && D <= 200;

  // Aperçu à l'échelle : un clic sur un côté y place l'entrée.
  const scale = 170 / Math.max(W || 1, D || 1, 1);
  const pw = Math.max(24, (W || 1) * scale);
  const ph = Math.max(24, (D || 1) * scale);
  const ox = (220 - pw) / 2;
  const oy = (220 - ph) / 2;
  const side = (s: EntrySide): [number, number, number, number] =>
    s === "bottom" ? [ox, oy + ph, ox + pw, oy + ph] : s === "top" ? [ox, oy, ox + pw, oy] : s === "left" ? [ox, oy, ox, oy + ph] : [ox + pw, oy, ox + pw, oy + ph];
  const [x1, y1, x2, y2] = side(f.entry);
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  const horizontal = y1 === y2;

  const submit = async () => {
    if (!valid || busy) return;
    if (
      f.target === "replace" &&
      !empty &&
      !(await confirm({
        title: tl("Redessiner ce niveau"),
        message: tl("Les meubles actuels de « {0} » seront remplacés par le nouveau plan.", [tm(floor.name)]),
        confirmLabel: tl("Remplacer"),
        danger: true,
      }))
    )
      return;
    setBusy(true);
    try {
      const id = await api.planGenerateLayout({
        floor_id: f.target === "replace" ? floor.id : null,
        name: f.target === "new" ? f.name : null,
        width: W,
        depth: D,
        entry: f.entry,
        storage_room: f.storage,
        business_type: f.business || null,
      });
      toast.success(tl("Votre boutique est dessinée : ajustez les meubles si besoin, puis rangez-y les produits."));
      onDone(id);
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={tl("Créer ma boutique")}
      onClose={onClose}
      width={760}
      footer={
        <>
          <button className="btn" onClick={onClose}>{tl("Annuler")}</button>
          <button className="btn btn-primary" disabled={!valid || busy} onClick={submit}>
            <WandSparkles size={16} />  {busy ? tl("Création…") : tl("Créer le plan")}
          </button>
        </>
      }
    >
      <div className="wizard-grid">
        <div className="form-grid">
          <Field label={tl("1. Largeur de la salle (m)")}>
            <input inputMode="decimal" value={f.width} onChange={(e) => setF({ ...f, width: e.target.value })} autoFocus />
          </Field>
          <Field label={tl("Profondeur (m)")}>
            <input inputMode="decimal" value={f.depth} onChange={(e) => setF({ ...f, depth: e.target.value })} />
          </Field>
          <div className="span-2">
            <span className="field-label">{tl("2. Côté de l'entrée")}</span>
            <div className="segmented">
              {ENTRIES.map((e) => (
                <button type="button" key={e.key} className={f.entry === e.key ? "active" : ""} onClick={() => setF({ ...f, entry: e.key })}>
                  {e.label}
                </button>
              ))}
            </div>
          </div>
          <Field label={tl("3. Type de commerce")} span={2} hint={tl("Choisit les meubles : gondoles, frigos, portants, racks, vitrines…")}>
            <select value={f.business} onChange={(e) => setF({ ...f, business: e.target.value })}>
              <option value="">{tl("Meubles courants")}</option>
              {profiles?.profiles.map((p) => (
                <option key={p.id} value={p.id}>{tm(p.label)}</option>
              ))}
            </select>
          </Field>
          <label className="check span-2">
            <input type="checkbox" checked={f.storage} onChange={(e) => setF({ ...f, storage: e.target.checked })} />
            {tl("Avec une réserve au fond (salle de 6 m × 6 m au moins)")}
          </label>
          <div className="span-2 wizard-target">
            <label className="check">
              <input type="radio" checked={f.target === "replace"} onChange={() => setF({ ...f, target: "replace" })} />
              {tl("Dessiner sur « {0} »", [tm(floor.name)])}
              {!empty && <span className="muted small">  {tl("(ses meubles actuels seront remplacés)")}</span>}
            </label>
            <label className="check">
              <input type="radio" checked={f.target === "new"} onChange={() => setF({ ...f, target: "new" })} />
              {tl("Nouveau niveau")}
            </label>
            {f.target === "new" && <input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder={tl("Nom du niveau")} />}
          </div>
        </div>
        <div className="wizard-preview">
          <svg viewBox="0 0 220 220" width="220" height="220" role="img" aria-label={tl("Aperçu de la salle")}>
            <rect x={ox} y={oy} width={pw} height={ph} className="wz-room" />
            {ENTRIES.map((e) => {
              const [a, b, c, d] = side(e.key);
              return <line key={e.key} x1={a} y1={b} x2={c} y2={d} className={`wz-side${f.entry === e.key ? " active" : ""}`} onClick={() => setF({ ...f, entry: e.key })} />;
            })}
            <line
              x1={horizontal ? mx - 14 : mx}
              y1={horizontal ? my : my - 14}
              x2={horizontal ? mx + 14 : mx}
              y2={horizontal ? my : my + 14}
              className="wz-door"
            />
            <text x={110} y={Math.max(12, oy - 6)} textAnchor="middle" className="wz-dim">{valid ? meters(W) : "—"}</text>
            <text x={Math.max(12, ox - 6)} y={110} textAnchor="middle" className="wz-dim" transform={`rotate(-90 ${Math.max(12, ox - 6)} 110)`}>
              {valid ? meters(D) : "—"}
            </text>
          </svg>
          <span className="muted small">{tl("Cliquez sur un côté pour y placer l'entrée.")}</span>
        </div>
      </div>
      <p className="muted small">
        {tl("Murs, entrée, caisse, frigos, étagères, allées et réserve sont posés selon votre commerce. Vous pourrez tout déplacer ensuite.")}
      </p>
    </Modal>
  );
}
