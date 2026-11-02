// Traduction de l'interface : repère les textes français visibles et les passe dans tl("…").
//
//   node scripts/i18n.mjs wrap    entoure les textes encore bruts (JSX, attributs, toasts, libellés…)
//   node scripts/i18n.mjs keys    écrit scripts/i18n-keys.json : textes à traduire (tl / ts)
//   node scripts/i18n.mjs check   échoue s'il reste un texte brut ou un texte sans traduction anglaise (CI)
//
// Les modèles avec variables s'écrivent tl("Supprimer {0} ?", [nom]).
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "src");
const SKIP = new Set(["src/lib/i18n.ts", "src/types.ts", "src/api.ts", "src/vite-env.d.ts"]);

/** Attributs JSX qui portent du texte visible. */
const ATTRS = new Set([
  "placeholder", "title", "label", "aria-label", "alt", "subtitle", "hint", "emptyLabel", "confirmLabel",
  "cancelLabel", "description", "message", "text", "tooltip", "caption", "loadingLabel",
]);
/** Propriétés d'objets qui portent du texte visible. */
const PROPS = new Set([
  "title", "message", "confirmLabel", "cancelLabel", "label", "short", "hint", "description", "placeholder",
  "subtitle", "purpose", "text", "tip", "emptyLabel", "tooltip", "caption", "steps", "tips", "group",
]);
/** Fonctions dont l'argument est un texte affiché. */
const CALLS = /^(toast\.(success|error|info|warning)|set(Error|Info|Done|Message|Notice|AccountNote|Hint|Warning|Status)|alert|window\.alert|window\.confirm)$/;
/** Objets « libellés » : toutes leurs valeurs sont des textes. */
const LABEL_VARS = /(^|_)(LABELS|HELP|TIPS|TEXTS|MESSAGES)$|^HELP|^TIPS/;

function files(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== "i18n") out.push(...files(p));
    } else if (/\.(tsx?|mts)$/.test(e.name) && !e.name.endsWith(".d.ts")) out.push(p);
  }
  return out;
}

const rel = (p) => path.relative(ROOT, p).replace(/\\/g, "/");

/** Texte lisible (et non un identifiant, une classe CSS, une couleur, une URL…). */
function isText(s) {
  const v = s.trim();
  if (!/[A-Za-zÀ-ÿ]/.test(v)) return false;
  if (/^(#|https?:|\/|\.\/|\.\.\/|data:|var\(|rgba?\(|[a-z-]+:)/.test(v)) return false;
  if (/^[a-z0-9_\-.:]+$/.test(v)) return false; // identifiant, code
  if (/^[A-Z0-9_]+$/.test(v) && v.length <= 4) return false; // FCFA, PIN, QR…
  if (/^\d+(px|rem|em|%|mm|vh|vw)\b/.test(v)) return false;
  return true;
}

function decodeEntities(s) {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'");
}

/** Texte JSX tel que React l'affiche (lignes rognées, retours à la ligne → espace). */
function jsxText(raw) {
  const lines = raw.split(/\r?\n/);
  const kept = [];
  lines.forEach((line, i) => {
    let l = line.replace(/\t/g, " ");
    if (i > 0) l = l.replace(/^ +/, "");
    if (i < lines.length - 1) l = l.replace(/ +$/, "");
    if (l) kept.push(l);
  });
  return decodeEntities(kept.join(" "));
}

const q = (s) => JSON.stringify(s);

/** Remonte les expressions « transparentes » (parenthèses, ternaire, ||, ??, &&, as) jusqu'au contexte. */
function contextOf(node) {
  let cur = node;
  for (;;) {
    const p = cur.parent;
    if (!p) return null;
    if (ts.isParenthesizedExpression(p) || ts.isAsExpression(p) || ts.isSatisfiesExpression?.(p)) {
      cur = p;
      continue;
    }
    if (ts.isConditionalExpression(p) && (p.whenTrue === cur || p.whenFalse === cur)) {
      cur = p;
      continue;
    }
    if (ts.isBinaryExpression(p) && p.right === cur) {
      const op = p.operatorToken.kind;
      if (op === ts.SyntaxKind.BarBarToken || op === ts.SyntaxKind.QuestionQuestionToken || op === ts.SyntaxKind.AmpersandAmpersandToken) {
        cur = p;
        continue;
      }
    }
    if (ts.isBinaryExpression(p) && p.left === cur && (p.operatorToken.kind === ts.SyntaxKind.BarBarToken || p.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken)) {
      cur = p;
      continue;
    }
    return { node: cur, parent: p };
  }
}

function inLabelObject(node) {
  for (let p = node.parent; p; p = p.parent) {
    if (ts.isVariableDeclaration(p) && ts.isIdentifier(p.name)) return LABEL_VARS.test(p.name.text);
    if (ts.isFunctionLike(p) || ts.isSourceFile(p)) return false;
  }
  return false;
}

/** Le littéral est-il un texte affiché à traduire ? */
function isUiPosition(lit, file) {
  const ctx = contextOf(lit);
  if (!ctx) return false;
  const { parent } = ctx;
  if (ts.isJsxExpression(parent)) {
    const gp = parent.parent;
    if (ts.isJsxElement(gp) || ts.isJsxFragment(gp)) return true;
    if (ts.isJsxAttribute(gp)) return ATTRS.has(gp.name.getText());
    return false;
  }
  if (ts.isJsxAttribute(parent)) return ATTRS.has(parent.name.getText());
  if (ts.isCallExpression(parent) && parent.arguments.includes(ctx.node)) {
    return CALLS.test(parent.expression.getText());
  }
  if (ts.isPropertyAssignment(parent) && parent.initializer === ctx.node) {
    const name = parent.name.getText().replace(/['"]/g, "");
    if (file === "src/lib/help.ts") return true;
    return PROPS.has(name) || inLabelObject(parent);
  }
  if (ts.isArrayLiteralExpression(parent)) {
    const pa = parent.parent;
    if (ts.isPropertyAssignment(pa) && pa.initializer === parent) {
      const name = pa.name.getText().replace(/['"]/g, "");
      return name === "steps" || name === "tips" || file === "src/lib/help.ts";
    }
  }
  return false;
}

/** Déjà dans tl(), ts() ou tm() ? */
function alreadyWrapped(node) {
  for (let p = node.parent; p; p = p.parent) {
    if (ts.isCallExpression(p) && /^(tl|ts|tm)$/.test(p.expression.getText())) return true;
    if (ts.isJsxElement(p) || ts.isFunctionLike(p) || ts.isSourceFile(p)) return false;
  }
  return false;
}

/** Littéral → appel tl(…) (ou null si ce n'est pas un texte). */
/** Texte affiché comme contenu JSX : un mot seul en minuscules (« poser ») est aussi un texte. */
function isJsxChild(node) {
  const ctx = contextOf(node);
  return !!ctx && ts.isJsxExpression(ctx.parent) && (ts.isJsxElement(ctx.parent.parent) || ts.isJsxFragment(ctx.parent.parent));
}

const looseText = (s) => /[A-Za-zÀ-ÿ]{2}/.test(s) && !/^(#|https?:|\/|var\(|rgba?\()/.test(s.trim());

function callFor(lit, fn = "tl") {
  const ok = isJsxChild(lit) ? looseText : isText;
  if (ts.isStringLiteral(lit) || ts.isNoSubstitutionTemplateLiteral(lit)) {
    if (!ok(lit.text)) return null;
    return `${fn}(${q(lit.text)})`;
  }
  if (ts.isTemplateExpression(lit)) {
    let key = lit.head.text;
    const args = [];
    lit.templateSpans.forEach((span, i) => {
      key += `{${i}}` + span.literal.text;
      args.push(span.expression.getText());
    });
    if (!ok(key.replace(/\{\d+\}/g, ""))) return null;
    return `${fn}(${q(key)}, [${args.join(", ")}])`;
  }
  return null;
}

function analyse(file, text) {
  const kind = file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
  const edits = [];
  const fname = rel(file);
  const shopFile = /src\/(lib\/receipt|lib\/display|pages\/CustomerDisplay)\.tsx?$/.test(fname);
  const fn = shopFile ? "ts" : "tl";
  const visit = (node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node) || ts.isTypeNode(node)) return;
    if (ts.isJsxText(node)) {
      const s = jsxText(node.text);
      const core = s.trim();
      if (core && isText(core)) {
        const lead = /^\s/.test(s) ? " " : "";
        const trail = /\s$/.test(s) ? " " : "";
        edits.push({ start: node.getStart(), end: node.getEnd(), text: `${lead}{${fn}(${q(core)})}${trail}`, key: core });
      }
      return;
    }
    if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node)) && !alreadyWrapped(node)) {
      if (isUiPosition(node, fname)) {
        const call = callFor(node, fn);
        if (call) {
          const direct = ts.isJsxAttribute(node.parent);
          edits.push({ start: node.getStart(), end: node.getEnd(), text: direct ? `{${call}}` : call, key: call });
          return;
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return { sf, edits, fn };
}

function importLine(file, names) {
  let r = path.relative(path.dirname(file), path.join(SRC, "lib", "i18n")).replace(/\\/g, "/");
  if (!r.startsWith(".")) r = "./" + r;
  return `import { ${names.join(", ")} } from "${r}";\n`;
}

function addImport(file, text, sf, fn) {
  if (new RegExp(`import \\{[^}]*\\b${fn}\\b[^}]*\\} from "[./]*(lib/)?i18n"`).test(text)) return text;
  const existing = /import \{([^}]*)\} from "([./]*(?:lib\/)?i18n)";\n/.exec(text);
  if (existing) {
    const names = [...new Set([...existing[1].split(",").map((s) => s.trim()).filter(Boolean), fn])].sort();
    return text.replace(existing[0], `import { ${names.join(", ")} } from "${existing[2]}";\n`);
  }
  const imports = sf.statements.filter((s) => ts.isImportDeclaration(s));
  const at = imports.length ? imports[imports.length - 1].getEnd() + 1 : 0;
  return text.slice(0, at) + importLine(file, [fn]) + text.slice(at);
}

/** Textes passés à tl() / ts() (premier argument littéral). */
function keysOf(sf) {
  const keys = [];
  const visit = (node) => {
    if (ts.isCallExpression(node) && /^(tl|ts)$/.test(node.expression.getText()) && node.arguments[0]) {
      const a = node.arguments[0];
      if (ts.isStringLiteral(a) || ts.isNoSubstitutionTemplateLiteral(a)) keys.push(a.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return keys;
}

function dictionaryKeys(file) {
  const text = fs.readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const keys = new Set();
  const visit = (node) => {
    if (ts.isPropertyAssignment(node) && (ts.isStringLiteral(node.name) || ts.isIdentifier(node.name))) keys.add(node.name.text);
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return keys;
}

const FRENCH = /[À-ÿ]|(de|la|le|les|des|du|un|une|et|pour|avec|sur|dans|est|pas|aucun|aucune)/i;

function audit(file, text) {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out = [];
  const visit = (node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node) || ts.isTypeNode(node)) return;
    if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node)) && !alreadyWrapped(node)) {
      const p = node.parent;
      const skip =
        (ts.isPropertyAssignment(p) && p.name === node) ||
        (ts.isJsxAttribute(p) && !ATTRS.has(p.name.getText())) ||
        (ts.isCallExpression(p) && /^(api\.|console\.|localStorage|sessionStorage|document\.|window\.(open|addEventListener)|new Date)/.test(p.expression.getText()));
      const value = ts.isTemplateExpression(node) ? node.getText().slice(1, -1) : node.text;
      if (!skip && / /.test(value) && FRENCH.test(value)) {
        out.push(`${rel(file)}:${sf.getLineAndCharacterOfPosition(node.getStart()).line + 1}  ${value.slice(0, 140).replace(/\s+/g, " ")}`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

const mode = process.argv[2] ?? "check";
// Lignes désignées à la main (textes hors des positions reconnues) : « force fichier:début-fin… ».
if (mode === "force") {
  for (const spec of process.argv.slice(3)) {
    const [f, range] = spec.split(":");
    const [from, to] = range.split("-").map(Number);
    const file = path.join(ROOT, f);
    let text = fs.readFileSync(file, "utf8");
    const kind = file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
    const fn = /src\/(lib\/receipt|lib\/display|pages\/CustomerDisplay)\.tsx?$/.test(f) ? "ts" : "tl";
    const edits = [];
    const visit = (node) => {
      if (ts.isImportDeclaration(node) || ts.isTypeNode(node)) return;
      const line = sf.getLineAndCharacterOfPosition(node.getStart()).line + 1;
      if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node)) && line >= from && line <= (to || from) && !alreadyWrapped(node)) {
        const p = node.parent;
        const skip = (ts.isPropertyAssignment(p) && p.name === node) || (ts.isJsxAttribute(p) && !ATTRS.has(p.name.getText()));
        const call = skip ? null : callFor(node, fn);
        if (call) {
          edits.push({ start: node.getStart(), end: node.getEnd(), text: ts.isJsxAttribute(p) ? `{${call}}` : call });
          return;
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
    for (const e of edits.sort((a, b) => b.start - a.start)) text = text.slice(0, e.start) + e.text + text.slice(e.end);
    if (edits.length) text = addImport(file, text, ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind), fn);
    fs.writeFileSync(file, text);
    console.log(`${f}:${range} : ${edits.length} texte(s)`);
  }
  process.exit(0);
}
if (mode === "audit") {
  for (const file of files(SRC).filter((f) => !SKIP.has(rel(f)))) for (const l of audit(file, fs.readFileSync(file, "utf8"))) console.log(l);
  process.exit(0);
}
const all = files(SRC).filter((f) => !SKIP.has(rel(f)));
let pending = 0;
const used = new Set();
for (const file of all) {
  let text = fs.readFileSync(file, "utf8");
  const { sf, edits, fn } = analyse(file, text);
  if (mode === "wrap" && edits.length) {
    for (const e of [...edits].sort((a, b) => b.start - a.start)) text = text.slice(0, e.start) + e.text + text.slice(e.end);
    const sf2 = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    text = addImport(file, text, sf2, fn);
    fs.writeFileSync(file, text);
    console.log(`${rel(file)} : ${edits.length} texte(s)`);
  } else if (edits.length) {
    pending += edits.length;
    for (const e of edits.slice(0, 5)) console.log(`${rel(file)}:${sf.getLineAndCharacterOfPosition(e.start).line + 1} texte non traduit : ${e.key}`);
  }
  const after = mode === "wrap" ? ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS) : sf;
  for (const k of keysOf(after)) used.add(k);
}

if (mode === "keys") {
  const out = path.join(ROOT, "scripts", "i18n-keys.json");
  fs.writeFileSync(out, JSON.stringify([...used].sort((a, b) => a.localeCompare(b, "fr")), null, 1));
  console.log(`${used.size} texte(s) → ${rel(out)}`);
}
if (mode === "check") {
  const en = dictionaryKeys(path.join(SRC, "i18n", "en.ts"));
  for (const f of fs.readdirSync(path.join(SRC, "i18n"))) {
    if (/^en-.+\.ts$/.test(f) && f !== "en-messages.ts") for (const k of dictionaryKeys(path.join(SRC, "i18n", f))) en.add(k);
  }
  const missing = [...used].filter((k) => !en.has(k));
  for (const k of missing.slice(0, 40)) console.log(`sans traduction anglaise : ${k}`);
  console.log(`${used.size} texte(s) ; ${pending} non entouré(s) ; ${missing.length} sans traduction`);
  if (pending || missing.length) process.exit(1);
}
