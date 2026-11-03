/** Code PIN trop simple : un seul chiffre répété, ou suite (1234, 987654…). */
export function simplePin(pin: string): boolean {
  return /^(\d)\1*$/.test(pin) || "0123456789".includes(pin) || "9876543210".includes(pin);
}

/** Code PIN tiré au hasard (jamais trop simple). */
export function randomPin(length = 4): string {
  const bytes = new Uint8Array(length);
  for (;;) {
    crypto.getRandomValues(bytes);
    const pin = [...bytes].map((b) => String(b % 10)).join("");
    if (!simplePin(pin)) return pin;
  }
}

/** Message si le PIN ne convient pas au rôle (6 chiffres pour l'administrateur, 4 à 6 pour les autres). */
export function pinProblem(pin: string, admin: boolean): string | null {
  if (!/^\d+$/.test(pin)) return "Le code PIN ne contient que des chiffres.";
  if (admin && pin.length !== 6) return "Le code PIN de l'administrateur doit contenir 6 chiffres.";
  if (pin.length < 4 || pin.length > 6) return "Le code PIN doit contenir 4 à 6 chiffres.";
  if (simplePin(pin)) return "Code PIN trop simple (évitez 1111, 1234…).";
  return null;
}
