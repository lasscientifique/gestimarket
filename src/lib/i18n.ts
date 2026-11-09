// Langues de l'interface : français (par défaut) et anglais.
//
// Les textes sont écrits en français dans le code et traduits à l'affichage :
//   tl("Enregistrer")                      → « Save »
//   tl("Supprimer {0} ?", [nom])           → « Delete {0}? »
//   ts(…)                                  → même chose, dans la langue de la boutique (ticket, écran client)
//   tm(message du serveur)                 → messages du moteur (erreurs, licence…), traduits d'après leur modèle
// Un texte sans traduction reste en français. La langue est lue au démarrage (les textes des listes et
// menus sont calculés au chargement) : en changer recharge l'interface.
// Le dictionnaire anglais (environ 250 Ko) n'est chargé que si l'anglais sert : interface en anglais,
// ou boutique en anglais (tickets, écran client). Démarrage plus rapide pour tous les autres.
let EN: Record<string, string> = {};
let EN_MESSAGES: Record<string, string> = {};
let dictionary: Promise<void> | null = null;

/** Charge le dictionnaire anglais (une seule fois). */
export function loadDictionary(): Promise<void> {
  dictionary ??= Promise.all([import("../i18n/en"), import("../i18n/en-messages")]).then(([a, b]) => {
    EN = a.EN;
    EN_MESSAGES = b.EN_MESSAGES;
    patterns = null;
  });
  return dictionary;
}

export type Lang = "fr" | "en";
export const LANGS: { code: Lang; label: string }[] = [
  { code: "fr", label: "Français" },
  { code: "en", label: "English" },
];

const STORAGE = "gm-lang";

function initialLang(): Lang {
  try {
    const v = localStorage.getItem(STORAGE);
    if (v === "fr" || v === "en") return v;
  } catch {
    // stockage indisponible : français
  }
  return "fr";
}

let lang: Lang = initialLang();
let shopLang: Lang = "fr";
let country = "ML";

export const getLang = (): Lang => lang;
export const getShopLang = (): Lang => shopLang;

export const isLang = (v: unknown): v is Lang => v === "fr" || v === "en";

/** Ce poste a-t-il déjà une langue choisie ? (sinon : langue de la boutique) */
export function hasStoredLang(): boolean {
  try {
    return isLang(localStorage.getItem(STORAGE));
  } catch {
    return false;
  }
}

/** Langue de ce poste. Un changement recharge l'interface (sauf `reload = false`). */
export function setLang(l: Lang, reload = true) {
  try {
    localStorage.setItem(STORAGE, l);
  } catch {
    // stockage indisponible
  }
  if (l !== lang) {
    lang = l;
    if (reload) location.reload();
  }
}

/** Langue de la boutique (tickets, écran client, catalogue) et pays (formats de nombres et de dates). */
export function configureLocale(shop: string | undefined, countryCode: string | undefined) {
  if (isLang(shop)) shopLang = shop;
  if (shopLang === "en") void loadDictionary();
  if (countryCode && /^[A-Z]{2}$/.test(countryCode)) country = countryCode;
}

/** Locale Intl de l'interface : « fr-ML », « en-NG »… */
export const locale = () => `${lang}-${country}`;
export const shopLocale = () => `${shopLang}-${country}`;
export const getCountry = () => country;

type Params = readonly (string | number | null | undefined)[];

function fill(s: string, params?: Params): string {
  return params ? s.replace(/\{(\d+)\}/g, (_m, i: string) => String(params[Number(i)] ?? "")) : s;
}

function lookup(fr: string, l: Lang): string {
  return l === "en" ? EN[fr] ?? EN_MESSAGES[fr] ?? fr : fr;
}

/** Texte de l'interface dans la langue de l'utilisateur. */
export function tl(fr: string, params?: Params): string {
  return fill(lookup(fr, lang), params);
}

/** Texte imprimé ou montré aux clients (ticket, écran client) : langue de la boutique. */
export function ts(fr: string, params?: Params): string {
  return fill(lookup(fr, shopLang), params);
}

// ───────────── Messages du serveur ─────────────
// Modèles « Le code {} est déjà utilisé… » : {} = partie variable (traduite à son tour si possible).

interface Pattern {
  re: RegExp;
  en: string;
}

let patterns: Pattern[] | null = null;

function compile(): Pattern[] {
  const list: Pattern[] = [];
  for (const [fr, en] of Object.entries(EN_MESSAGES)) {
    if (!fr.includes("{}")) continue;
    const re = fr
      .split("{}")
      .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("([\\s\\S]+?)");
    list.push({ re: new RegExp(`^${re}$`), en });
  }
  // Les modèles les plus précis (le plus de texte fixe) d'abord.
  return list.sort((a, b) => b.re.source.length - a.re.source.length);
}

function translateMessage(message: string, depth: number): string {
  const exact = EN_MESSAGES[message] ?? EN[message];
  if (exact !== undefined) return exact;
  if (depth > 3) return message;
  patterns ??= compile();
  for (const p of patterns) {
    const m = p.re.exec(message);
    if (!m) continue;
    const parts = m.slice(1).map((v) => translateMessage(v, depth + 1));
    let i = 0;
    return p.en.replace(/\{\}/g, () => parts[i++] ?? "");
  }
  return message;
}

/** Message venant du moteur (erreur, état de la licence…) dans la langue de l'utilisateur. */
export function tm(message: string | null | undefined): string {
  if (!message) return message ?? "";
  if (lang === "fr") return message;
  // Plusieurs phrases : chacune est traduite séparément si le message entier n'a pas de modèle.
  const whole = translateMessage(message, 0);
  if (whole !== message) return whole;
  const sentences = splitSentences(message);
  return sentences.length > 1 ? sentences.map((s) => translateMessage(s, 0)).join(" ") : message;
}

/**
 * Découpe un message en phrases (« . », « ! » ou « ? » suivi d'une majuscule).
 * Sans « regarder en arrière » dans l'expression régulière : Safari ne le comprend qu'à partir d'iOS 16.4,
 * et une seule de ces écritures empêche tout le programme de démarrer sur les iPhone plus anciens.
 */
export function splitSentences(message: string): string[] {
  const out: string[] = [];
  const re = /[.!?]\s+(?=[A-ZÀ-Ý«])/g;
  let last = 0;
  for (let m = re.exec(message); m; m = re.exec(message)) {
    out.push(message.slice(last, m.index + 1));
    last = re.lastIndex;
  }
  out.push(message.slice(last));
  return out;
}
