import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ChevronDown,
  ChevronRight,
  Download,
  Eye,
  EyeOff,
  FolderTree,
  Library,
  Pencil,
  Plus,
  Search,
  Trash2,
  Upload,
  PackageX,
} from "lucide-react";
import { api } from "../api";
import { useApp } from "../context/AppContext";
import { Badge, Empty, Field, ImageField, Modal, PageHeader, StatCard, Thumb } from "../components/ui";
import { CategorySelect, subtreeIds } from "../components/CategorySelect";
import { HelpTip } from "../components/Help";
import { CataloguePicker } from "../components/BusinessType";
import { exportCsv, pickTextFile } from "../lib/files";
import { parseCsv } from "../lib/csv";
import { toCsv } from "../lib/format";
import type { Category } from "../types";
import { tl } from "../lib/i18n";

const COLORS = ["#0f766e", "#2563eb", "#7c3aed", "#db2777", "#dc2626", "#ea580c", "#ca8a04", "#16a34a", "#0891b2", "#64748b"];

type Filter = "all" | "empty" | "hidden";

export default function CategoriesPage() {
  const { toast, confirm, askPin, isAdmin } = useApp();
  const navigate = useNavigate();
  const [categories, setCategories] = useState<Category[]>([]);
  const [noCategory, setNoCategory] = useState(0);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  const [editing, setEditing] = useState<null | { category: Category | null; parent: number | null }>(null);
  const [catalogueOpen, setCatalogueOpen] = useState(false);

  const load = useCallback(() => {
    api
      .listCategories()
      .then((c) => {
        setCategories(c);
        // Par défaut, les catégories principales sont repliées quand l'arbre est grand.
        setCollapsed((prev) => (prev.size === 0 && c.length > 40 ? new Set(c.filter((x) => x.children_count > 0).map((x) => x.id)) : prev));
      })
      .catch(toast.error);
    api.listProducts({ without_category: true, limit: 5000 }).then((p) => setNoCategory(p.length)).catch(() => undefined);
  }, [toast]);
  useEffect(load, [load]);

  const byId = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);

  /** Lignes visibles : filtre + recherche (les ancêtres des résultats restent affichés), repli. */
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const match = (c: Category) =>
      (!q || c.name.toLowerCase().includes(q)) &&
      (filter === "all" || (filter === "empty" && c.product_count === 0) || (filter === "hidden" && !c.active));
    const filtering = q !== "" || filter !== "all";
    const keep = new Set<number>();
    if (filtering) {
      for (const c of categories) {
        if (!match(c)) continue;
        let cur: Category | undefined = c;
        while (cur) {
          keep.add(cur.id);
          cur = cur.parent_id !== null ? byId.get(cur.parent_id) : undefined;
        }
      }
    }
    return categories.filter((c) => {
      if (filtering) return keep.has(c.id);
      // masquée si un ancêtre est replié
      let p = c.parent_id;
      while (p !== null) {
        if (collapsed.has(p)) return false;
        p = byId.get(p)?.parent_id ?? null;
      }
      return true;
    });
  }, [categories, search, filter, collapsed, byId]);

  const roots = categories.filter((c) => c.parent_id === null).length;
  const empty = categories.filter((c) => c.product_count === 0).length;
  const hidden = categories.filter((c) => !c.active).length;

  const toggleCollapse = (id: number) =>
    setCollapsed((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const toggleActive = async (c: Category) => {
    try {
      await api.setCategoryActive(c.id, !c.active);
      toast.success(c.active ? tl("« {0} » est masquée en caisse.", [c.name]) : tl("« {0} » est de nouveau visible.", [c.name]));
      load();
    } catch (e) {
      toast.error(e);
    }
  };

  const remove = async (c: Category) => {
    const sub = subtreeIds(categories, c.id).size - 1;
    const msg = tl("Supprimer « {0} »{1} ? {2}", [c.name, sub ? ` et ses ${sub} sous-catégorie(s)` : "", c.product_count ? `Les ${c.product_count} produit(s) concerné(s) seront conservés, sans catégorie.` : "Aucun produit n'est concerné."]);
    if (!(await confirm({ title: tl("Supprimer la catégorie"), message: msg, danger: true, confirmLabel: tl("Supprimer") }))) return;
    try {
      const pin = await askPin({ title: tl("Supprimer la catégorie"), level: "manager" });
      if (!pin) return;
      await api.deleteCategory(c.id, pin);
      toast.success(tl("Catégorie supprimée."));
      load();
    } catch (e) {
      toast.error(e);
    }
  };

  const doExport = async () => {
    const csv = toCsv(
      ["Chemin", "Niveau", "Produits", "Visible"],
      categories.map((c) => [c.path.split(" › ").join(" > "), c.depth + 1, c.product_count, c.active ? "oui" : "non"]),
    );
    try {
      if (await exportCsv("categories.csv", csv)) toast.success(tl("Export terminé."));
    } catch (e) {
      toast.error(e);
    }
  };

  const doImport = async () => {
    try {
      const picked = await pickTextFile();
      if (!picked) return;
      const rows = parseCsv(picked.text);
      // 1re colonne = chemin « A > B > C » ; ou plusieurs colonnes (catégorie, sous-catégorie, famille…).
      const paths = rows
        .filter((r, i) => !(i === 0 && /chemin|cat[ée]gorie/i.test(r[0] ?? "")))
        .map((r) => {
          const cells = r.map((x) => x.trim()).filter(Boolean);
          if (cells.length === 0) return "";
          return cells[0].includes(">") || cells[0].includes("›") ? cells[0].replace(/›/g, ">") : cells.filter((x) => !/^\d+$/.test(x) && !/^(oui|non)$/i.test(x)).join(" > ");
        })
        .filter(Boolean);
      if (!paths.length) return toast.error(tl("Aucune catégorie trouvée dans ce fichier."));
      const n = await api.importCategories(paths);
      toast.success(tl("{0} catégorie(s) créée(s) ({1} ligne(s) lue(s)).", [n, paths.length]));
      load();
    } catch (e) {
      toast.error(e);
    }
  };

  return (
    <div className="page">
      <PageHeader
        help="categories"
        title={tl("Catégories")}
        subtitle={tl("Catégorie → sous-catégorie → famille… sans limite de niveaux")}
        actions={
          <>
            {isAdmin && (
              <button className="btn" onClick={() => setCatalogueOpen(true)}>
                <Library size={16} />  {tl("Charger le catalogue")}</button>
            )}
            <button className="btn" onClick={doImport}><Upload size={16} />  {tl("Importer")}</button>
            <button className="btn" onClick={doExport}><Download size={16} />  {tl("Exporter")}</button>
            <button className="btn btn-primary" onClick={() => setEditing({ category: null, parent: null })}>
              <Plus size={16} />  {tl("Nouvelle catégorie")}</button>
          </>
        }
      />

      <div className="stats">
        <StatCard label={tl("Catégories principales")} value={String(roots)} icon={<FolderTree size={20} />} />
        <StatCard label={tl("Total (tous niveaux)")} value={String(categories.length)} icon={<FolderTree size={20} />} tone="accent" />
        <StatCard label={tl("Catégories vides")} value={String(empty)} icon={<PackageX size={20} />} tone={empty ? "warning" : undefined} />
        <button className="stat-link" onClick={() => navigate("/products")} title={tl("Voir dans Produits (filtre « Sans catégorie »)")}>
          <StatCard label={tl("Produits sans catégorie")} value={String(noCategory)} icon={<PackageX size={20} />} tone={noCategory ? "danger" : "success"} />
        </button>
      </div>

      <div className="toolbar">
        <div className="search-box">
          <Search size={16} />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={tl("Rechercher une catégorie…")} />
        </div>
        <div className="segmented inline-seg">
          <button className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}>{tl("Toutes")}</button>
          <button className={filter === "empty" ? "active" : ""} onClick={() => setFilter("empty")}>{tl("Vides (")}{empty})</button>
          <button className={filter === "hidden" ? "active" : ""} onClick={() => setFilter("hidden")}>{tl("Masquées (")}{hidden})</button>
        </div>
        <button className="btn btn-sm" onClick={() => setCollapsed(new Set())}>{tl("Tout déplier")}</button>
        <button className="btn btn-sm" onClick={() => setCollapsed(new Set(categories.filter((c) => c.children_count > 0).map((c) => c.id)))}>{tl("Tout replier")}</button>
      </div>

      <div className="card no-pad">
        {categories.length === 0 ? (
          <Empty title={tl("Aucune catégorie")}>
            {tl("Créez votre première catégorie")}{isAdmin && <>  {tl("ou chargez le catalogue prédéfini (32 catégories et leurs sous-catégories)")}</>}.
            {isAdmin && (
              <div style={{ marginTop: 12 }}>
                <button className="btn btn-primary" onClick={() => setCatalogueOpen(true)}><Library size={16} />  {tl("Charger le catalogue")}</button>
              </div>
            )}
          </Empty>
        ) : rows.length === 0 ? (
          <Empty title={tl("Aucun résultat")} />
        ) : (
          <div className="tree-list">
            {rows.map((c) => (
              <div key={c.id} className={`tree-row depth-${Math.min(c.depth, 4)} ${c.active ? "" : "is-hidden"}`} style={{ paddingLeft: 12 + c.depth * 26 }}>
                {c.children_count > 0 ? (
                  <button className="icon-btn tree-toggle" onClick={() => toggleCollapse(c.id)} aria-label={tl("Déplier / replier")}>
                    {collapsed.has(c.id) && !search && filter === "all" ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
                  </button>
                ) : (
                  <span className="tree-toggle" />
                )}
                <Thumb imageId={c.image_id} name={c.name} color={c.color} size={c.depth === 0 ? 36 : 28} />
                <div className="tree-main">
                  <span className={c.depth === 0 ? "tree-name root" : "tree-name"}>{c.name}</span>
                  <span className="muted small">
                    {c.children_count > 0 && <>{c.children_count}  {tl("sous-catégorie(s) ·")} </>}
                    {c.product_count}  {tl("produit(s)")}{c.direct_count !== c.product_count && c.direct_count > 0 && <> dont {c.direct_count} ici</>}
                  </span>
                </div>
                {!c.active && <Badge tone="warning">{tl("Masquée")}</Badge>}
                {c.product_count === 0 && c.active && <Badge>{tl("Vide")}</Badge>}
                <div className="tree-actions">
                  <button className="icon-btn" title={tl("Ajouter une sous-catégorie")} onClick={() => setEditing({ category: null, parent: c.id })}><Plus size={15} /></button>
                  <button className="icon-btn" title={tl("Modifier / déplacer")} onClick={() => setEditing({ category: c, parent: c.parent_id })}><Pencil size={15} /></button>
                  <button className="icon-btn" title={c.active ? tl("Masquer en caisse") : tl("Afficher")} onClick={() => toggleActive(c)}>
                    {c.active ? <Eye size={15} /> : <EyeOff size={15} />}
                  </button>
                  <button className="icon-btn danger" title={tl("Supprimer")} onClick={() => remove(c)}><Trash2 size={15} /></button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {editing && (
        <CategoryForm
          category={editing.category}
          parent={editing.parent}
          categories={categories}
          onClose={() => setEditing(null)}
          onSaved={(again) => {
            load();
            if (!again) setEditing(null);
          }}
        />
      )}
      {catalogueOpen && (
        <Modal title={<>{tl("Charger le catalogue de catégories")} <HelpTip k="business_type" /></>} onClose={() => setCatalogueOpen(false)} width={860}>
          <CataloguePicker
            onDone={(n) => {
              toast.success(n ? tl("{0} catégorie(s) ajoutée(s).", [n]) : tl("Ces catégories existent déjà : rien à ajouter."));
              setCatalogueOpen(false);
              load();
            }}
          />
        </Modal>
      )}
    </div>
  );
}

function CategoryForm({
  category,
  parent: initialParent,
  categories,
  onClose,
  onSaved,
}: {
  category: Category | null;
  parent: number | null;
  categories: Category[];
  onClose: () => void;
  onSaved: (again: boolean) => void;
}) {
  const { toast } = useApp();
  const parentCat = categories.find((c) => c.id === initialParent);
  const [name, setName] = useState(category?.name ?? "");
  const [color, setColor] = useState(category?.color ?? parentCat?.color ?? COLORS[0]);
  const [image, setImage] = useState<number | null>(category?.image_id ?? null);
  const [parent, setParent] = useState<number | null>(initialParent);
  const [order, setOrder] = useState(String(category?.sort_order ?? 0));
  const [active, setActive] = useState(category?.active ?? true);
  const [busy, setBusy] = useState(false);
  const parentPath = categories.find((c) => c.id === parent)?.path;

  const save = async (again: boolean) => {
    setBusy(true);
    try {
      await api.saveCategory(category?.id ?? null, { name, color, image_id: image, parent_id: parent, sort_order: Number(order) || 0, active });
      toast.success(category ? tl("Catégorie modifiée.") : tl("Catégorie ajoutée."));
      onSaved(again);
      if (again) {
        setName("");
        setImage(null);
      }
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={category ? tl("Modifier « {0} »", [category.name]) : parent ? tl("Nouvelle sous-catégorie") : tl("Nouvelle catégorie")}
      onClose={onClose}
      width={620}
      footer={
        <>
          <button className="btn" onClick={onClose}>{tl("Fermer")}</button>
          {!category && <button className="btn" disabled={busy || !name.trim()} onClick={() => save(true)}>{tl("Enregistrer et ajouter une autre")}</button>}
          <button className="btn btn-primary" disabled={busy || !name.trim()} onClick={() => save(false)}>{tl("Enregistrer")}</button>
        </>
      }
    >
      <div className="cat-editor">
        <ImageField value={image} onChange={setImage} size={96} label={tl("Photo / icône")} maxSize={300} />
        <div className="cat-editor-main">
          <div className="form-grid">
            <Field label={tl("Nom *")} span={2}>
              <input value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder={tl("Ex. Riz local")} onKeyDown={(e) => e.key === "Enter" && name.trim() && save(!category)} />
            </Field>
            <Field label={tl("Rangée dans")} hint={parentPath ? tl("Chemin : {0} › {1}", [parentPath, name || "…"]) : tl("Vide = catégorie principale")} span={2}>
              <CategorySelect categories={categories} value={parent} onChange={setParent} exclude={category?.id ?? null} emptyLabel={tl("— Catégorie principale —")} />
            </Field>
            <Field label={tl("Ordre d'affichage")} hint={tl("Les plus petits nombres en premier")}>
              <input inputMode="numeric" value={order} onChange={(e) => setOrder(e.target.value)} />
            </Field>
            <label className="check" style={{ alignSelf: "end" }}>
              <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />  {tl("Visible en caisse")}</label>
          </div>
          <div className="color-row">
            {COLORS.map((c) => (
              <button key={c} className={`swatch ${color === c ? "active" : ""}`} style={{ background: c }} onClick={() => setColor(c)} aria-label={c} />
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
}
