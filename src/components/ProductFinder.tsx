import { useEffect, useMemo, useRef, useState } from "react";
import { MapPin, ScanSearch, X, Package, Camera, Star } from "lucide-react";
import { CameraScanner } from "./CameraScanner";
import { api } from "../api";
import { useApp } from "../context/AppContext";
import { money, qty } from "../lib/format";
import type { Location, Place, Product, StorePlanData } from "../types";
import { StoreMap } from "./plan/StoreMap";
import { FixtureFront, slotName } from "./plan/FixtureFront";
import { categoryPath } from "./CategorySelect";
import { Badge, LocationBadge, Thumb } from "./ui";
import { tl, tm } from "../lib/i18n";

/**
 * Recherche « Où se trouve ce produit ? » : nom, code-barres (douchette) ou catégorie.
 * Affiche l'emplacement en grand, fait clignoter le meuble sur le plan de la boutique et montre
 * l'étage et la case dans la vue de face. Une étiquette de case scannée (QR « GMLOC: ») montre son contenu.
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
  const [plan, setPlan] = useState<StorePlanData | null>(null);
  const [places, setPlaces] = useState<Place[]>([]);
  const [focus, setFocus] = useState(0);

  useEffect(() => {
    api.listLocations().then(setLocations).catch(toast.error);
    api.planGet().then(setPlan).catch(() => undefined);
  }, [toast]);

  useEffect(() => {
    setFocus(0);
    if (!selected) return setPlaces([]);
    api.productPlaces(selected.id).then(setPlaces).catch(() => setPlaces([]));
  }, [selected]);

  // Étiquette de case scannée (QR « GMLOC:12 ») : la case et son contenu.
  const scannedSlot = useMemo(() => {
    const m = /^GMLOC:(\d+)$/i.exec(search.trim());
    return m ? locations.find((l) => l.id === Number(m[1])) ?? null : null;
  }, [search, locations]);

  useEffect(() => {
    if (!search.trim() || /^GMLOC:/i.test(search.trim())) {
      setResults([]);
      setSelected(null);
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

  const place = places[Math.min(focus, places.length - 1)] ?? null;
  const mapFloor = place && plan ? plan.floors.find((f) => f.id === place.floor_id) ?? null : null;

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
          placeholder={tl("Nom du produit, catégorie ou code-barres scanné…")}
          autoFocus={autoFocus}
        />
        {search && (
          <button className="icon-btn" onClick={() => { setSearch(""); inputRef.current?.focus(); }} aria-label={tl("Effacer")}>
            <X size={16} />
          </button>
        )}
        <button className="icon-btn" onClick={() => setScan(true)} title={tl("Scanner avec la caméra")} aria-label={tl("Scanner avec la caméra")}>
          <Camera size={18} />
        </button>
        {scan && <CameraScanner title={tl("Où est ce produit ?")} onCode={(c) => setSearch(c)} onClose={() => setScan(false)} />}
        {onClose && <kbd className="kbd">{tl("Échap")}</kbd>}
      </div>

      <div className="finder-body">
        <div className="finder-results">
          {!search.trim() && (
            <div className="finder-hint">
              <MapPin size={34} strokeWidth={1.5} />
              <strong>{tl("Où se trouve un produit ?")}</strong>
              <span className="muted">{tl("Tapez son nom ou scannez son code-barres (ou l'étiquette d'une case) : le meuble clignote sur le plan de la boutique.")}</span>
            </div>
          )}
          {search.trim() && results.length === 0 && <div className="finder-hint muted">{tl("Aucun produit trouvé.")}</div>}
          {results.map((p, i) => (
            <button key={p.id} className={`finder-item ${i === active ? "active" : ""}`} onClick={() => choose(i)} onMouseEnter={() => choose(i)}>
              <Thumb imageId={p.image_id} name={p.name} color={p.category_color} size={44} />
              <div className="finder-item-main">
                <strong>{p.name}</strong>
                <span className="muted small">{categoryPath(p) ?? tl("Sans catégorie")} · {money(p.sale_price)}</span>
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
                        {selected.stock <= 0 ? tl("Rupture") : tl("{0} {1} en stock", [qty(selected.stock), selected.unit])}
                      </Badge>
                    )}
                  </div>
                  <span className="muted small">{categoryPath(selected) ?? tl("Sans catégorie")}</span>
                  <span className="muted small mono"> · {selected.barcode ?? ""}</span>
                </div>
              </div>
              {places.length === 0 ? (
                <div className="finder-location none">
                  <div className="fl-none"><Package size={18} />  {tl("Ce produit n'a pas encore d'emplacement sur le plan.")}</div>
                </div>
              ) : (
                <>
                  <div className="finder-location">
                    <div className="fl-part wide"><span>{tm(place?.floor_name)}</span><strong>{tm(place?.fixture_name)}</strong></div>
                    {place?.etage && <div className="fl-part"><span>{tl("Étage")}</span><strong>{place.etage}</strong></div>}
                    {place?.rangee && <div className="fl-part"><span>{tl("Case")}</span><strong>{place.rangee}</strong></div>}
                  </div>
                  {places.length > 1 && (
                    <div className="finder-places">
                      {places.map((pl, i) => (
                        <button key={pl.location_id} className={`chip ${i === focus ? "active" : ""}`} onClick={() => setFocus(i)}>
                          {pl.primary && <Star size={12} />} {pl.fixture_code}{pl.etage ? tl(" · É{0}", [pl.etage]) : ""}{pl.rangee ? tl(" · C{0}", [pl.rangee]) : ""}
                        </button>
                      ))}
                    </div>
                  )}
                  {mapFloor && place && (
                    <StoreMap
                      floor={mapFloor}
                      fixtures={plan!.fixtures.filter((f) => f.floor_id === mapFloor.id)}
                      selectedId={place.fixture_id}
                      highlightIds={places.filter((pl) => pl.floor_id === mapFloor.id).map((pl) => pl.fixture_id)}
                      height={300}
                    />
                  )}
                  {place && (
                    <FixtureFront key={place.fixture_id} fixtureId={place.fixture_id} highlightLocationId={place.location_id} highlightProductId={selected.id} compact />
                  )}
                </>
              )}
            </>
          ) : scannedSlot ? (
            <>
              <div className="finder-location">
                <div className="fl-part wide"><span>{tm(scannedSlot.floor_name)}</span><strong>{tm(scannedSlot.fixture_name)}</strong></div>
                <div className="fl-part"><span>{tl("Case scannée")}</span><strong>{slotName(scannedSlot)}</strong></div>
              </div>
              <FixtureFront key={scannedSlot.fixture_id} fixtureId={scannedSlot.fixture_id} highlightLocationId={scannedSlot.id} compact />
            </>
          ) : (
            plan &&
            plan.floors[0] && (
              <StoreMap floor={plan.floors[0]} fixtures={plan.fixtures.filter((f) => f.floor_id === plan.floors[0].id)} height={360} />
            )
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
      <div className="modal finder-modal" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label={tl("Localiser un produit")}>
        <ProductFinder onClose={onClose} />
      </div>
    </div>
  );
}
