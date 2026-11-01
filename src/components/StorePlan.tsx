import { useMemo } from "react";
import type { Location } from "../types";

interface Props {
  locations: Location[];
  /** Emplacement à mettre en évidence. */
  highlightId?: number | null;
  /** Emplacement sélectionné (mode gestion). */
  selectedId?: number | null;
  onSelect?: (l: Location) => void;
  /** N'afficher que ce bloc. */
  onlyBloc?: string | null;
  compact?: boolean;
}

const natural = (a: string, b: string) => a.localeCompare(b, "fr", { numeric: true, sensitivity: "base" });

/**
 * Plan schématique du magasin : un cadre par bloc, une ligne par étage, une case par rangée.
 * La case recherchée clignote pour guider le client ou le vendeur.
 */
export function StorePlan({ locations, highlightId, selectedId, onSelect, onlyBloc, compact }: Props) {
  const blocs = useMemo(() => {
    const map = new Map<string, Map<string, Location[]>>();
    for (const l of locations) {
      if (onlyBloc && l.bloc !== onlyBloc) continue;
      if (!map.has(l.bloc)) map.set(l.bloc, new Map());
      const etages = map.get(l.bloc)!;
      if (!etages.has(l.etage)) etages.set(l.etage, []);
      etages.get(l.etage)!.push(l);
    }
    return [...map.entries()]
      .sort(([a], [b]) => natural(a, b))
      .map(([bloc, etages]) => ({
        bloc,
        label: [...etages.values()].flat().find((l) => l.label)?.label ?? null,
        etages: [...etages.entries()]
          .sort(([a], [b]) => natural(b, a)) // étage le plus haut en premier, comme une étagère
          .map(([etage, list]) => ({ etage, list: list.sort((x, y) => natural(x.rangee, y.rangee)) })),
      }));
  }, [locations, onlyBloc]);

  const highlightBloc = locations.find((l) => l.id === highlightId)?.bloc;

  if (blocs.length === 0) {
    return <div className="plan-empty muted">Aucun emplacement défini. Créez vos blocs dans « Emplacements ».</div>;
  }

  return (
    <div className={`plan ${compact ? "compact" : ""}`}>
      {blocs.map((b) => (
        <div key={b.bloc} className={`plan-bloc ${highlightBloc === b.bloc ? "target" : ""} ${highlightId && highlightBloc !== b.bloc ? "dim" : ""}`}>
          <div className="plan-bloc-head">
            <strong>Bloc {b.bloc}</strong>
            {b.label && <span className="muted small">{b.label}</span>}
          </div>
          <div className="plan-rows">
            {b.etages.map((e) => (
              <div key={e.etage} className="plan-row">
                <span className="plan-row-label">{e.etage ? `É${e.etage}` : "—"}</span>
                <div className="plan-cells">
                  {e.list.map((l) => {
                    const cls = [
                      "plan-cell",
                      l.id === highlightId ? "hit" : "",
                      l.id === selectedId ? "selected" : "",
                      l.product_count > 0 ? "filled" : "",
                    ].join(" ");
                    return (
                      <button
                        key={l.id}
                        className={cls}
                        onClick={onSelect ? () => onSelect(l) : undefined}
                        disabled={!onSelect}
                        title={`Bloc ${l.bloc} · Étage ${l.etage || "—"} · Rangée ${l.rangee || "—"}${l.label ? " — " + l.label : ""}\n${l.product_count} produit(s)`}
                      >
                        {l.rangee ? `R${l.rangee}` : "•"}
                        {!compact && l.product_count > 0 && <span className="plan-count">{l.product_count}</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
