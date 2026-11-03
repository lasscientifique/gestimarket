/**
 * Téléphone autorisé pour l'accès Internet : jeton gardé par ce navigateur (il reste autorisé
 * jusqu'à ce que l'administrateur le retire). Jamais envoyé ailleurs qu'au poste serveur.
 */
const KEY = "gm-device";

export function getDeviceToken(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function setDeviceToken(token: string | null) {
  try {
    if (token) localStorage.setItem(KEY, token);
    else localStorage.removeItem(KEY);
  } catch {
    /* stockage indisponible : il faudra autoriser le téléphone à chaque fois */
  }
}

/** Nom proposé pour ce téléphone (modifiable) : « Téléphone Android », « iPhone »… */
export function deviceLabel(): string {
  const ua = navigator.userAgent;
  if (/iPhone/i.test(ua)) return "iPhone";
  if (/iPad/i.test(ua)) return "iPad";
  if (/Android/i.test(ua)) return /Mobile/i.test(ua) ? "Téléphone Android" : "Tablette Android";
  if (/Windows/i.test(ua)) return "PC Windows";
  if (/Mac OS/i.test(ua)) return "Mac";
  return "Téléphone";
}
