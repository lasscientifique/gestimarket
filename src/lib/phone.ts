// Numéros WhatsApp du compte Eden Dev : indicatif du pays, format international (+22376593676), affichage.
// Même règle que le moteur (account.rs, valid_phone).

/** Indicatifs téléphoniques (code du pays → indicatif), Afrique de l'Ouest d'abord. */
export const DIAL: Record<string, string> = {
  ML: "223", SN: "221", CI: "225", BF: "226", NE: "227", GN: "224", TG: "228", BJ: "229", MR: "222", GM: "220",
  GW: "245", CV: "238", LR: "231", SL: "232", GH: "233", NG: "234", CM: "237", TD: "235", CF: "236", GA: "241",
  CG: "242", CD: "243", GQ: "240", MA: "212", DZ: "213", TN: "216", EG: "20", SD: "249", ET: "251", KE: "254",
  RW: "250", BI: "257", MG: "261", KM: "269", DJ: "253", ZA: "27", AO: "244", FR: "33", BE: "32", CH: "41",
  LU: "352", DE: "49", ES: "34", IT: "39", PT: "351", GB: "44", NL: "31", US: "1", CA: "1", SA: "966",
  AE: "971", CN: "86", TR: "90", IN: "91",
};

/** Indicatif du pays (Mali par défaut). */
export const dialFor = (country?: string | null): string => DIAL[country ?? ""] ?? "223";

/** Indicatifs proposés dans la liste (un seul par indicatif, Mali en tête). */
export const DIAL_CODES: { code: string; dial: string }[] = Object.entries(DIAL)
  .filter(([, dial], i, all) => all.findIndex(([, d]) => d === dial) === i)
  .map(([code, dial]) => ({ code, dial }));

/** Numéro au format international à partir de ce qui est tapé : « + » ou « 00 » gardent l'indicatif tapé,
 *  sinon l'indicatif du pays est ajouté (le 0 de tête d'un numéro national est retiré). */
export function toE164(raw: string, dial = "223"): string {
  const t = raw.replace(/[\s\-.() ]/g, "");
  if (!t) return "";
  if (t.startsWith("+")) return "+" + t.slice(1).replace(/\D/g, "");
  if (t.startsWith("00")) return "+" + t.slice(2).replace(/\D/g, "");
  return "+" + dial + t.replace(/\D/g, "").replace(/^0+/, "");
}

/** Ce qui est tapé ressemble-t-il à un numéro (et non à un e-mail) ? */
export const looksLikePhone = (raw: string): boolean => !raw.includes("@") && raw.replace(/\D/g, "").length >= 8;

/** Numéro complet plausible (8 à 15 chiffres après le « + »). */
export const validPhone = (e164: string): boolean => /^\+[1-9]\d{7,14}$/.test(e164);

/** Identifiant de connexion : l'e-mail tel quel, sinon le numéro WhatsApp au format international. */
export const loginId = (raw: string, dial = "223"): string => (raw.includes("@") ? raw.trim() : toE164(raw, dial));

/** Affichage lisible et jamais coupé en fin de ligne : « +223 76 59 36 76 » (espaces insécables). */
export function showPhone(e164: string): string {
  if (!e164.startsWith("+")) return e164;
  const digits = e164.slice(1);
  const dial = [3, 2, 1].map((n) => digits.slice(0, n)).find((d) => Object.values(DIAL).includes(d)) ?? "";
  const rest = digits.slice(dial.length).replace(/(\d{2})(?=\d)/g, "$1 ");
  return dial ? `+${dial} ${rest}` : e164;
}
