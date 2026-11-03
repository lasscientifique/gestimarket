// Disponibilité de la 3D (sans charger three.js : la caisse reste légère).

let cached: boolean | null = null;

/** L'appareil sait-il afficher la 3D (WebGL) ? */
export function webglAvailable(): boolean {
  if (cached !== null) return cached;
  try {
    const c = document.createElement("canvas");
    cached = !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    cached = false;
  }
  return cached;
}

export type PlanView = "plan" | "3d" | "walk";

/** Vue du plan choisie sur ce poste (dessus, 3D ou visite). */
export function savedView(key: string, fallback: PlanView): PlanView {
  try {
    const v = localStorage.getItem(key);
    if (v === "plan" || ((v === "3d" || v === "walk") && webglAvailable())) return v;
  } catch {
    // Stockage indisponible : vue par défaut.
  }
  return fallback === "plan" || webglAvailable() ? fallback : "plan";
}

export function saveView(key: string, v: PlanView) {
  try {
    localStorage.setItem(key, v);
  } catch {
    // Préférence non mémorisée : sans conséquence.
  }
}
