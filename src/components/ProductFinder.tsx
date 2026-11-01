import { useEffect, useRef, useState } from "react";
import { MapPin, ScanSearch, X, Package, Camera } from "lucide-react";
import { CameraScanner } from "./CameraScanner";
import { api } from "../api";
import { useApp } from "../context/AppContext";
import { locationText, money, qty } from "../lib/format";
import type { Location, Product } from "../types";
import { StorePlan } from "./StorePlan";
import { categoryPath } from "./CategorySelect";
import { Badge, LocationBadge, Thumb } from "./ui";

/**
 * Recherche « Où se trouve ce produit ? » : nom, code-barres (douchette) ou catégorie.
 * Affiche l'emplacement en grand et le met en évidence sur le plan du magasin.
 */
export function ProductFinder({ autoFocus = true, onClose }: { autoFocus?: boolean; onClose?: () => void }) {
  const { toast } = useApp();
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<Product[]>([]);
  const [selected, setSelected] = useState<Product | null>(null);
  const [locations, setLocations] = useState<Location[]>([]);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const [scan, setScan] = useState(false);

  useEffect(() => {
    api.listLocations().then(setLocations).catch(toast.error);
  }, [toast]);

  useEffect(() => {
    if (!search.trim()) {
      setResults([]);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const byCode = await api.findProductByBarcode(search.trim());
        const list = byCode ? [byCode] : await api.listProducts({ search, limit: 40 });
        setResults(list);
        setActive(0);
        setSelected(list[0] ?? null);
      } catch (e) {
        toast.error(e);
      }
    }, 160);
    return () => clearTimeout(t);
  }, [search, toast]);

  const choose = (i: number) => {
    setActive(i);
    setSelected(results[i] ?? null);
  };

  return (
    <div className="finder">
      <div className="finder-search">
        <ScanSearch size={22} />
        <input
          ref={inputRef}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              choose(Math.min(active + 1, results.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              choose(Math.max(active - 1, 0));
            } else if (e.key === "Enter") {
              (e.target as HTMLInputElement).select();
            }
          }}
          placeholder="Nom du produit, catégorie ou code-barres scanné…"
          autoFocus={autoFocus}
        />
        {search && (
          <button className="icon-btn" onClick={() => { setSearch(""); inputRef.current?.focus(); }} aria-label="Effacer">
            <X size={16} />
          </button>
        )}
        <button className="icon-btn" onClick={() => setScan(true)} title="Scanner avec la caméra" aria-label="Scanner avec la caméra">
          <Camera size={18} />
        </button>
        {scan && <CameraScanner title="Où est ce produit ?" onCode={(c) => setSearch(c)} onClose={() => setScan(false)} />}
        {onClose && <kbd className="kbd">Échap</kbd>}
      </div>

      <div className="finder-body">
        <div className="finder-results">
          {!search.trim() && (
            <div className="finder-hint">
              <MapPin size={34} strokeWidth={1.5} />
              <strong>Où se trouve un produit ?</strong>
              <span className="muted">Tapez son nom ou scannez son code-barres : l'emplacement s'affiche avec le plan du magasin.</span>
            </div>
          )}
          {search.trim() && results.length === 0 && <div className="finder-hint muted">Aucun produit trouvé.</div>}
          {results.map((p, i) => (
            <button key={p.id} className={`finder-item ${i === active ? "active" : ""}`} onClick={() => choose(i)} onMouseEnter={() => choose(i)}>
              <Thumb imageId={p.image_id} name={p.name} color={p.category_color} size={44} />
              <div className="finder-item-main">
                <strong>{p.name}</strong>
                <span className="muted small">{categoryPath(p) ?? "Sans catégorie"} · {money(p.sale_price)}</span>
              </div>
              <LocationBadge p={p} short />
            </button>
          ))}
        </div>

        <div className="finder-detail">
          {selected ? (
            <>
              <div className="finder-product">
                <Thumb imageId={selected.image_id} name={selected.name} color={selected.category_color} size={96} rounded={14} />
                <div>
                  <h2>{selected.name}</h2>
                  <div className="finder-meta">
                    <span className="finder-price">{money(selected.sale_price)}</span>
                    {selected.track_stock && (
                      <Badge tone={selected.stock <= 0 ? "danger" : selected.stock <= selected.min_stock ? "warning" : "success"}>
                        {selected.stock <= 0 ? "Rupture" : `${qty(selected.stock)} ${selected.unit} en stock`}
                      </Badge>
                    )}
                  </div>
                  <span className="muted small">{categoryPath(selected) ?? "Sans catégorie"}</span>
                  <span className="muted small mono"> · {selected.barcode ?? ""}</span>
                </div>
              </div>
              <div className={`finder-location ${selected.bloc ? "" : "none"}`}>
                {selected.bloc ? (
                  <>
                    <div className="fl-part"><span>Bloc</span><strong>{selected.bloc}</strong></div>
                    <div className="fl-part"><span>Étage</span><strong>{selected.etage || "—"}</strong></div>
                    <div className="fl-part"><span>Rangée</span><strong>{selected.rangee || "—"}</strong></div>
                    {selected.location_label && <div className="fl-label">{selected.location_label}</div>}
                  </>
                ) : (
                  <div className="fl-none"><Package size={18} /> Ce produit n'a pas encore d'emplacement.</div>
                )}
              </div>
              {selected.location_id && (
                <>
                  <div className="section-title">Plan du magasin — {locationText(selected)}</div>
                  <StorePlan locations={locations} highlightId={selected.location_id} compact />
                </>
              )}
            </>
          ) : (
            <StorePlan locations={locations} compact />
          )}
        </div>
      </div>
    </div>
  );
}

/** Fenêtre de recherche rapide, ouverte depuis n'importe quel écran (Ctrl+K). */
export function ProductFinderModal({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop finder-backdrop" onMouseDown={onClose}>
      <div className="modal finder-modal" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label="Localiser un produit">
        <ProductFinder onClose={onClose} />
      </div>
    </div>
  );
}
