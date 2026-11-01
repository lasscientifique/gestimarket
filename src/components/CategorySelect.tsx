import type { Category } from "../types";

/** Regroupe les catégories : chaque catégorie principale avec ses sous-catégories directes. */
export function categoryTree(categories: Category[]) {
  const roots = categories.filter((c) => c.parent_id === null);
  return roots.map((root) => ({ root, children: categories.filter((c) => c.parent_id === root.id) }));
}

/** Nom complet « Boissons › Jus » (chemin complet si disponible). */
export function categoryPath(p: { category_name: string | null; parent_category_name?: string | null; category_path?: string | null }) {
  if (p.category_path) return p.category_path;
  if (!p.category_name) return null;
  return p.parent_category_name ? `${p.parent_category_name} › ${p.category_name}` : p.category_name;
}

/** Identifiants d'une catégorie et de toute sa descendance. */
export function subtreeIds(categories: Category[], id: number): Set<number> {
  const ids = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const c of categories) {
      if (c.parent_id !== null && ids.has(c.parent_id) && !ids.has(c.id)) {
        ids.add(c.id);
        grew = true;
      }
    }
  }
  return ids;
}

/**
 * Liste déroulante de l'arborescence des catégories (profondeur illimitée, indentée).
 * `exclude` : retire une catégorie et sa descendance (choix d'un parent lors d'un déplacement).
 */
export function CategorySelect({
  categories,
  value,
  onChange,
  emptyLabel = "— Aucune —",
  rootsOnly,
  exclude,
  activeOnly,
}: {
  categories: Category[];
  value: number | null;
  onChange: (id: number | null) => void;
  emptyLabel?: string;
  rootsOnly?: boolean;
  exclude?: number | null;
  activeOnly?: boolean;
}) {
  const excluded = exclude != null ? subtreeIds(categories, exclude) : new Set<number>();
  const list = categories.filter(
    (c) => !excluded.has(c.id) && (!rootsOnly || c.parent_id === null) && (!activeOnly || c.active || c.id === value),
  );
  return (
    <select value={value ?? ""} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}>
      <option value="">{emptyLabel}</option>
      {list.map((c) => (
        <option key={c.id} value={c.id}>
          {"   ".repeat(c.depth ?? 0)}
          {(c.depth ?? 0) > 0 ? "› " : ""}
          {c.name}
          {c.active ? "" : " (masquée)"}
        </option>
      ))}
    </select>
  );
}
