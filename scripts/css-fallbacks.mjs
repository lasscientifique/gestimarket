// Valeurs de secours pour les anciens moteurs web (Android non mis à jour, boîtiers TV, iOS 13 à 16).
//
// Pour chaque règle qui utilise color-mix(), max() ou min() :
//   - la règle garde une valeur simple (la couleur qui domine le mélange, la valeur fixe…) ;
//   - la valeur moderne est placée juste après, dans un bloc @supports que seuls les moteurs récents lisent.
// Une simple « valeur de secours ; valeur moderne » ne suffit pas : quand la valeur moderne contient var(),
// un ancien moteur l'accepte quand même à la lecture, puis l'abandonne à l'affichage, sans revenir à la
// valeur de secours (fond, bordure ou couleur disparus). L'unité dvh garde la méthode simple (sans var()).
// Les variables (--x) ne sont pas touchées : public/compat.js calcule leurs couleurs mélangées.

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
  return v;
}

const MODERN = /color-mix\(|(^|[^a-zA-Z0-9-])(max|min)\(/;
const SUPPORTS = "@supports (color: color-mix(in srgb, red 50%, blue)) and (width: max(1px, 2px))";

/** Découpe le corps d'une règle en déclarations (les « ; » entre parenthèses ne comptent pas). */
function declarations(body) {
  const out = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (c === ";" && depth === 0) {
      out.push(body.slice(start, i));
      start = i + 1;
    }
  }
  if (body.slice(start).trim()) out.push(body.slice(start));
  return out;
}

/** Ajoute les valeurs de secours dans une feuille de styles. */
export function legacyCssFallbacks(css) {
  // dvh (sans var()) : valeur simple juste devant, méthode classique.
  let text = css.replace(/([{;]\s*)([a-zA-Z-]+)(\s*:\s*)([^;{}]*\ddvh[^;{}]*?)(\s*)(?=[;}])/g, (all, lead, prop, colon, value, trail) =>
    prop.startsWith("--") ? all : `${lead}${prop}${colon}${value.replace(/(\d)dvh/g, "$1vh")}; ${prop}${colon}${value}${trail}`,
  );
  // Règles les plus intérieures « sélecteur { déclarations } » (pas dans @keyframes).
  const keyframes = [];
  for (let m, re = /@(-webkit-)?keyframes[^{]*\{/g; (m = re.exec(text)); ) {
    const start = m.index;
    let depth = 0;
    let i = m.index + m[0].length - 1;
    for (; i < text.length; i++) {
      if (text[i] === "{") depth++;
      else if (text[i] === "}" && --depth === 0) break;
    }
    keyframes.push([start, i]);
  }
  const inKeyframes = (pos) => keyframes.some(([a, b]) => pos > a && pos < b);
  return text.replace(/([^{}]+)\{([^{}]*)\}/g, (all, selector, body, offset) => {
    if (inKeyframes(offset) || selector.trim().startsWith("@")) return all;
    const decls = declarations(body);
    const modern = [];
    let changed = false;
    const base = decls.map((d) => {
      const m = /^(\s*)([a-zA-Z-]+)(\s*:\s*)([\s\S]*)$/.exec(d);
      if (!m || m[2].startsWith("--") || !MODERN.test(m[4])) return d;
      const simple = simpleValue(m[4]);
      if (simple === m[4]) return d;
      changed = true;
      modern.push(`${m[2]}: ${m[4].trim()}`);
      return `${m[1]}${m[2]}${m[3]}${simple}`;
    });
    if (!changed) return all;
    const sel = selector.trim();
    return `${selector}{${base.join(";")}}\n${SUPPORTS} { ${sel} { ${modern.join("; ")}; } }`;
  });
}
