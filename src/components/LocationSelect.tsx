import { useMemo } from "react";
import type { Location } from "../types";

/** Liste déroulante des cases du plan, regroupées par meuble (« Réfrigérateur FR1 — Rez-de-chaussée »). */
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
    const map = new Map<number, Location[]>();
    for (const l of locations) {
      if (!map.has(l.fixture_id)) map.set(l.fixture_id, []);
      map.get(l.fixture_id)!.push(l);
    }
    return [...map.values()];
  }, [locations]);
  const floors = new Set(locations.map((l) => l.floor_id)).size;
  return (
    <select className={className} value={value ?? ""} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}>
      <option value="">{emptyLabel}</option>
      {groups.map((list) => {
        const f = list[0];
        return (
          <optgroup key={f.fixture_id} label={`${f.fixture_name} (${f.bloc})${floors > 1 ? " — " + f.floor_name : ""}`}>
            {list.map((l) => (
              <option key={l.id} value={l.id}>
                {[l.bloc, l.etage ? `Étage ${l.etage}` : "", l.rangee ? `Case ${l.rangee}` : ""].filter(Boolean).join(" · ")}
                {l.label ? ` (${l.label})` : ""}
              </option>
            ))}
          </optgroup>
        );
      })}
    </select>
  );
}
