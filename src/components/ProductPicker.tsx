import { useEffect, useRef, useState } from "react";
import { Search } from "lucide-react";
import { api } from "../api";
import { useApp } from "../context/AppContext";
import { money, qty } from "../lib/format";
import type { Product } from "../types";

/** Champ de recherche de produit avec liste déroulante (compatible douchette code-barres). */
export function ProductPicker({ onPick, placeholder = "Rechercher ou scanner un produit…", autoFocus }: { onPick: (p: Product) => void; placeholder?: string; autoFocus?: boolean }) {
  const { toast } = useApp();
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<Product[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!search.trim()) {
      setResults([]);
      return;
    }
    const t = setTimeout(() => {
      api.listProducts({ search, limit: 12 }).then((r) => {
        setResults(r);
        setActive(0);
        setOpen(true);
      }).catch(toast.error);
    }, 120);
    return () => clearTimeout(t);
  }, [search, toast]);

  useEffect(() => {
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const pick = (p: Product) => {
    onPick(p);
    setSearch("");
    setResults([]);
    setOpen(false);
  };

  const onEnter = async () => {
    const code = search.trim();
    if (!code) return;
    const byCode = await api.findProductByBarcode(code).catch(() => null);
    if (byCode) return pick(byCode);
    if (results[active]) pick(results[active]);
  };

  return (
    <div className="picker" ref={ref}>
      <div className="search-box">
        <Search size={16} />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onFocus={() => results.length && setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onEnter();
            } else if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => Math.min(a + 1, results.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            } else if (e.key === "Escape") setOpen(false);
          }}
          placeholder={placeholder}
          autoFocus={autoFocus}
        />
      </div>
      {open && results.length > 0 && (
        <div className="picker-menu">
          {results.map((p, i) => (
            <button key={p.id} className={`picker-item ${i === active ? "active" : ""}`} onMouseEnter={() => setActive(i)} onClick={() => pick(p)}>
              <div>
                <strong>{p.name}</strong>
                <div className="muted small mono">{p.barcode ?? ""}</div>
              </div>
              <div className="right small">
                <div>{money(p.sale_price)}</div>
                <div className="muted">Stock : {qty(p.stock)} {p.unit}</div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
