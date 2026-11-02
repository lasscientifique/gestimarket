import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Boxes,
  Copy,
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
import type { Fixture, FixtureCategory, FixtureType, Floor, StorePlanData } from "../types";
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
  const [modal, setModal] = useState<null | "floor-new" | Floor | "type-new" | FixtureType | "generate">(null);
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
  const fixtures = useMemo(() => plan?.fixtures.filter((f) => f.floor_id === floorId) ?? [], [plan, floorId]);
  const selected = fixtures.find((f) => f.id === selectedId) ?? null;
  const storage = plan?.fixtures.filter((f) => f.storage) ?? [];
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
          />
        )}
        <div className="card plan-canvas-card">
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
          <p className="muted small plan-hint">
            {edit
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
        <TypeForm type={modal === "type-new" ? null : (modal as FixtureType)} onClose={() => setModal(null)} onSaved={() => { setModal(null); load(); }} />
      )}
      {modal === "generate" && <GenerateModal onClose={() => setModal(null)} onDone={() => { setModal(null); load(); }} />}
    </div>
  );
}

/** Palette des meubles : glisser sur le plan (ou cliquer pour poser à une place libre). */
function Palette({
  types,
  suggested,
  onAdd,
  onNewType,
  onEditType,
  onGenerate,
}: {
  types: FixtureType[];
  suggested: FixtureType[];
  onAdd: (t: FixtureType) => void;
  onNewType: () => void;
  onEditType: (t: FixtureType) => void;
  onGenerate: () => void;
}) {
  const custom = types.filter((t) => !t.builtin);
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
      <span className={`palette-swatch cat-${t.category}`} style={{ background: t.color }} />
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
  onDelete,
}: {
  fixture: Fixture;
  edit: boolean;
  onOpen: () => void;
  onSaved: (f: Fixture) => void;
  onRotate: () => void;
  onDuplicate: () => void;
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
  });
  const [v, setV] = useState(init);
  useEffect(() => setV(init()), [f.id, f.w, f.h, f.name, f.code, f.levels, f.sections, f.custom_color]);
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
  const [f, setF] = useState({ name: floor?.name ?? tl("1er étage"), width: String(floor?.width ?? 20), depth: String(floor?.depth ?? 12) });
  const num = (s: string) => Number(s.replace(",", "."));
  const submit = async () => {
    try {
      const id = await api.planSaveFloor(floor?.id ?? null, { name: f.name, width: num(f.width), depth: num(f.depth) });
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
      </div>
    </Modal>
  );
}

/** Meuble personnalisé : l'utilisateur n'est pas limité à la palette de base. */
function TypeForm({ type, onClose, onSaved }: { type: FixtureType | null; onClose: () => void; onSaved: () => void }) {
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
  });
  const num = (s: string) => Number(s.replace(",", "."));
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
