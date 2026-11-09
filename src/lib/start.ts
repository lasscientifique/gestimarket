// Choix du démarrage de l'application installée (téléphone, tablette, TV), gardés sur l'appareil.

export const START_KEY = "gm-start";
export const TV_KEY = "gm-tv";

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Choix fait au premier démarrage : « local » (boutique sur ce téléphone), « join », « owner ». */
export const startChoice = () => read(START_KEY);

export function rememberStart(choice: string) {
  try {
    localStorage.setItem(START_KEY, choice);
  } catch {
    /* stockage indisponible : le choix sera reproposé */
  }
}

/** Caisse affichée par cette TV (écran client), choisie une fois. */
export function tvPoste(): string | null {
  try {
    const v = JSON.parse(read(TV_KEY) ?? "null");
    return v && typeof v.poste === "string" ? v.poste : null;
  } catch {
    return null;
  }
}

export function rememberTv(poste: string, shop: string) {
  try {
    localStorage.setItem(TV_KEY, JSON.stringify({ poste, shop }));
  } catch {
    /* stockage indisponible : la TV redemandera la caisse */
  }
}

/** Adresse de l'écran client d'une caisse. */
export const displayHash = (poste: string) => `#/display?poste=${encodeURIComponent(poste)}`;
