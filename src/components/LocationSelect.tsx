import { useMemo } from "react";
import type { Location } from "../types";

/** Liste déroulante d'emplacements, regroupés par bloc. */
export function LocationSelect({
  locations,
  value,
  onChange,
  emptyLabel = "— Non rangé —",
  className,
}: {
  locations: Location[];
  value: number | null;
  onChange: (id: number | null) => void;
  emptyLabel?: string;
  className?: string;
}) {
  const groups = useMemo(() => {
    const map = new Map<string, Location[]>();
    for (const l of locations) {
      if (!map.has(l.bloc)) map.set(l.bloc, []);
      map.get(l.bloc)!.push(l);
    }
    return [...map.entries()];
  }, [locations]);
  return (
    <select className={className} value={value ?? ""} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}>
      <option value="">{emptyLabel}</option>
      {groups.map(([bloc, list]) => (
        <optgroup key={bloc} label={`Bloc ${bloc}${list[0]?.label ? " — " + list[0].label : ""}`}>
          {list.map((l) => (
            <option key={l.id} value={l.id}>
              Bloc {l.bloc} · Étage {l.etage || "—"} · Rangée {l.rangee || "—"}
              {l.label ? ` (${l.label})` : ""}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}
