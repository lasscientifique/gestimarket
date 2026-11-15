import { useEffect, useMemo, useState } from "react";
import { Search, Sparkles, X } from "lucide-react";
import { api } from "../api";
import { tl } from "../lib/i18n";
import type { SuguNode, SuguSuggestion, SuguTaxonomy } from "../types";

// Classement Sugu Eden (Catégorie → Section → Sous-catégorie), lu une fois par session.
let taxonomy: Promise<SuguTaxonomy> | null = null;
export function loadSuguTaxonomy(): Promise<SuguTaxonomy> {
  if (!taxonomy) taxonomy = api.suguTaxonomy().catch((e) => {
    taxonomy = null;
    throw e;
  });
  return taxonomy;
}

const norm = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/** « Femmes › Vêtements › Robes » pour un code. */
export function suguLabel(t: SuguTaxonomy | null, code: string | null | undefined): string {
  if (!t || !code) return "";
  const parts: string[] = [];
  let at: string | null = code;
  while (at) {
    const node: SuguNode | undefined = t.items.find((n) => n.code === at);
    if (!node) break;
    parts.unshift(node.name);
    at = node.parent;
  }
  return parts.join(" › ");
}

/**
 * Choix du classement Sugu Eden d'un produit : suggestions (nom, rayon, marque), recherche par mot (« robe »),
 * ou parcours Catégorie → Section → Sous-catégorie, les catégories du type de commerce en premier.
 */
export function SuguPicker({
  value,
  onChange,
  hint,
}: {
  value: string | null;
  onChange: (code: string | null) => void;
  /** Produit à classer : nom, rayon GestiMarket et marque, pour les suggestions. */
  hint?: { name: string; aisle?: string; brand?: string };
}) {
  const [t, setT] = useState<SuguTaxonomy | null>(null);
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<SuguSuggestion[]>([]);
  const [cat, setCat] = useState("");
  const [section, setSection] = useState("");

  useEffect(() => {
    loadSuguTaxonomy().then(setT).catch(() => setT(null));
  }, []);

  // Suggestions : quand le nom change (après une courte pause de frappe).
  const hintKey = `${hint?.name ?? ""}|${hint?.aisle ?? ""}|${hint?.brand ?? ""}`;
  useEffect(() => {
    if (!hint?.name?.trim()) {
      setSuggestions([]);
      return;
    }
    const timer = setTimeout(() => {
      api.suguSuggest(hint.name, hint.aisle ?? "", hint.brand ?? "").then(setSuggestions).catch(() => setSuggestions([]));
    }, 350);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hintKey]);

  // Parcours : la sélection suit le classement choisi.
  useEffect(() => {
    if (!value) return;
    const parts = value.split("/");
    setCat(parts[0] ?? "");
    setSection(parts.length > 1 ? `${parts[0]}/${parts[1]}` : "");
  }, [value]);

  const cats = useMemo(() => {
    if (!t) return [];
    const top = t.items.filter((n) => n.level === 1);
    const favored = top.filter((n) => t.favored.includes(n.code));
    return [...favored, ...top.filter((n) => !t.favored.includes(n.code))];
  }, [t]);
  const sections = useMemo(() => (t && cat ? t.items.filter((n) => n.parent === cat) : []), [t, cat]);
  const leaves = useMemo(() => (t && section ? t.items.filter((n) => n.parent === section) : []), [t, section]);

  const results = useMemo(() => {
    const q = norm(query.trim());
    if (!t || q.length < 2) return [];
    const words = q.split(/\s+/);
    return t.items
      .filter((n) => n.level === 3)
      .map((n) => ({ n, text: norm(`${suguLabel(t, n.code)} ${n.synonyms}`) }))
      .filter(({ text }) => words.every((w) => text.includes(w)))
      .slice(0, 30)
      .map(({ n }) => n);
  }, [t, query]);

  if (!t) return <p className="muted small">{tl("Chargement du classement Sugu Eden…")}</p>;

  return (
    <div className="sugu-picker">
      {value ? (
        <div className="sugu-chosen">
          <strong>{suguLabel(t, value) || value}</strong>
          <button type="button" className="icon-btn" title={tl("Retirer le classement")} onClick={() => onChange(null)}><X size={15} /></button>
        </div>
      ) : (
        <p className="muted small">{tl("Pas encore classé : choisissez une suggestion, cherchez un mot ou parcourez les catégories.")}</p>
      )}
      {suggestions.length > 0 && (
        <div className="sugu-suggestions">
          <span className="muted small"><Sparkles size={13} />  {tl("Suggestions")}</span>
          {suggestions.slice(0, 4).map((s) => (
            <button key={s.code} type="button" className={`chip-btn ${value === s.code ? "active" : ""}`} onClick={() => onChange(s.code)}>{s.label}</button>
          ))}
        </div>
      )}
      <div className="search-box sugu-search">
        <Search size={15} />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={tl("Chercher : robe, smartphone, riz…")} />
      </div>
      {results.length > 0 && (
        <div className="sugu-results">
          {results.map((n) => (
            <button key={n.code} type="button" className={value === n.code ? "active" : ""} onClick={() => { onChange(n.code); setQuery(""); }}>
              {suguLabel(t, n.code)}
            </button>
          ))}
        </div>
      )}
      <div className="sugu-browse">
        <select value={cat} onChange={(e) => { setCat(e.target.value); setSection(""); }} aria-label={tl("Catégorie")}>
          <option value="">{tl("Catégorie…")}</option>
          {cats.map((n) => <option key={n.code} value={n.code}>{n.name}</option>)}
        </select>
        <select value={section} onChange={(e) => setSection(e.target.value)} disabled={!cat} aria-label={tl("Section")}>
          <option value="">{tl("Section…")}</option>
          {sections.map((n) => <option key={n.code} value={n.code}>{n.name}</option>)}
        </select>
        <select value={value && value.startsWith(`${section}/`) ? value : ""} onChange={(e) => e.target.value && onChange(e.target.value)} disabled={!section} aria-label={tl("Sous-catégorie")}>
          <option value="">{tl("Sous-catégorie…")}</option>
          {leaves.map((n) => <option key={n.code} value={n.code}>{n.name}</option>)}
        </select>
      </div>
    </div>
  );
}
