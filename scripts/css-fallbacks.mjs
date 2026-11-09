// Valeurs de secours pour les anciens moteurs web (Android non mis à jour, boîtiers TV, iOS 13 à 16).
//
// Devant chaque déclaration qui utilise color-mix(), max(), min() ou l'unité dvh, on place la même
// déclaration avec une valeur simple. Un moteur récent garde la seconde ; un ancien moteur ignore la
// seconde (qu'il ne comprend pas) et garde la première. Les variables (--x) ne sont pas touchées :
// public/compat.js calcule leurs couleurs mélangées quand le moteur ne sait pas le faire.

/** Position de la parenthèse fermante qui correspond à celle ouverte en `open`. */
function closing(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "(") depth++;
    else if (text[i] === ")" && --depth === 0) return i;
  }
  return -1;
}

/** Arguments d'une fonction CSS, séparés par les virgules de premier niveau. */
function splitArgs(inner) {
  const out = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (c === "," && depth === 0) {
      out.push(inner.slice(start, i).trim());
      start = i + 1;
    }
  }
  out.push(inner.slice(start).trim());
  return out;
}

/** Remplace chaque appel `name(...)` (au premier niveau du texte) par `pick(arguments)`. */
function replaceCalls(value, name, pick) {
  let out = "";
  let i = 0;
  const re = new RegExp(`(^|[^a-zA-Z0-9-])${name}\\(`, "g");
  for (;;) {
    re.lastIndex = i;
    const m = re.exec(value);
    if (!m) break;
    const open = m.index + m[1].length + name.length;
    const close = closing(value, open);
    if (close < 0) break;
    out += value.slice(i, open - name.length) + pick(splitArgs(value.slice(open + 1, close)));
    i = close + 1;
  }
  return out + value.slice(i);
}

/** Couleur d'un argument de color-mix() : « var(--brand) 55% » → « var(--brand) ». */
function colorOf(arg) {
  return arg.replace(/\s+\d+(\.\d+)?%\s*$/, "").replace(/^\d+(\.\d+)?%\s+/, "").trim();
}

/** Part d'un argument de color-mix() : « var(--brand) 55% » → 55 ; sans pourcentage : null. */
function shareOf(arg) {
  const m = /(?:^|\s)(\d+(?:\.\d+)?)%(?:\s|$)/.exec(arg);
  return m ? Number(m[1]) : null;
}

export function simpleValue(value) {
  let v = value;
  // color-mix(in srgb, A p%, B) → la couleur qui domine le mélange (A si p ≥ 50, sinon B).
  for (let n = 0; n < 4 && v.includes("color-mix("); n++) {
    v = replaceCalls(v, "color-mix", (args) => {
      const a = colorOf(args[1] ?? "");
      const b = colorOf(args[2] ?? "") || "transparent";
      const pa = shareOf(args[1] ?? "");
      const pb = shareOf(args[2] ?? "");
      const shareA = pa ?? (pb !== null ? 100 - pb : 50);
      return shareA >= 50 ? a : b;
    });
  }
  // max(16px, env(...)) → 16px : la valeur fixe, sans les marges du système.
  v = replaceCalls(v, "max", (args) => args.find((a) => !a.startsWith("env(")) ?? args[0]);
  // min(560px, 100%) → 100% : la valeur relative, pour ne jamais dépasser l'écran d'un téléphone.
  v = replaceCalls(v, "min", (args) => args.find((a) => /%|vw|vh/.test(a)) ?? args[0]);
  v = v.replace(/(\d)dvh/g, "$1vh");
  return v;
}

const NEEDS = /color-mix\(|(^|[^a-zA-Z0-9-])(max|min)\(|\ddvh/;

/** Ajoute les valeurs de secours dans une feuille de styles. */
export function legacyCssFallbacks(css) {
  // Déclaration : « propriété: valeur » entre « { » ou « ; » et « ; » ou « } ».
  return css.replace(/([{;]\s*)([a-zA-Z-]+)(\s*:\s*)([^;{}]+?)(\s*)(?=[;}])/g, (all, lead, prop, colon, value, trail) => {
    if (prop.startsWith("--") || !NEEDS.test(value)) return all;
    const simple = simpleValue(value);
    if (simple === value) return all;
    return `${lead}${prop}${colon}${simple}; ${prop}${colon}${value}${trail}`;
  });
}
