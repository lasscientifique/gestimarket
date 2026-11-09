// Vérifie que le programme fabriqué (dist/assets/*.js) est lisible par les anciens moteurs web visés
// (Chrome 70 : Android 7 à jour, boîtiers TV, BlueStacks ; Safari 13 : iOS 13).
// Une seule écriture trop récente dans un fichier empêche ce fichier — souvent tout GestiMarket — de démarrer.
//
// Usage : node scripts/check-compat.mjs [dossier]   (par défaut dist/assets)
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const dir = process.argv[2] ?? "dist/assets";
const files = fs.readdirSync(dir).filter((f) => f.endsWith(".js"));
const problems = [];

/** Écritures refusées par Chrome 70 ou Safari 13 (avec la version qui les a apportées). */
function check(file, text) {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, false, ts.ScriptKind.JS);
  const found = new Map();
  const add = (what, node) => {
    if (found.has(what)) return;
    const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
    found.set(what, `${what} (ligne ${line + 1} : ${text.slice(node.getStart(sf), node.getStart(sf) + 60).replace(/\s+/g, " ")})`);
  };
  // Parcours sans récursion : le code compacté a des chaînes d'expressions très longues.
  const stack = [[sf, false]];
  while (stack.length) {
    const [node, inFunction] = stack.pop();
    switch (node.kind) {
      case ts.SyntaxKind.QuestionDotToken:
        add("chaînage optionnel ?. (Chrome 80, iOS 13.4)", node);
        break;
      case ts.SyntaxKind.QuestionQuestionToken:
        add("opérateur ?? (Chrome 80, iOS 13.4)", node);
        break;
      case ts.SyntaxKind.QuestionQuestionEqualsToken:
      case ts.SyntaxKind.BarBarEqualsToken:
      case ts.SyntaxKind.AmpersandAmpersandEqualsToken:
        add("affectation logique ??= ||= &&= (Chrome 85, iOS 14)", node);
        break;
      case ts.SyntaxKind.ClassStaticBlockDeclaration:
        add("bloc static {} de classe (Chrome 94, iOS 16.4)", node);
        break;
      case ts.SyntaxKind.PrivateIdentifier:
        add("champ privé #x (Chrome 74, iOS 14.5)", node);
        break;
      case ts.SyntaxKind.PropertyDeclaration:
        add("champ de classe (Chrome 72, iOS 14)", node);
        break;
      case ts.SyntaxKind.NumericLiteral:
        if (node.getText(sf).includes("_")) add("séparateur de chiffres 1_000 (Chrome 75, iOS 13)", node);
        break;
      case ts.SyntaxKind.RegularExpressionLiteral:
        if (/\(\?<[=!]/.test(node.getText(sf))) add("expression régulière avec (?<= ou (?<! (iOS 16.4)", node);
        break;
      case ts.SyntaxKind.AwaitExpression:
        if (!inFunction) add("await au premier niveau (Chrome 89, iOS 15)", node);
        break;
      default:
        break;
    }
    const fn = inFunction || ts.isFunctionLike(node) || ts.isClassStaticBlockDeclaration(node);
    ts.forEachChild(node, (child) => {
      stack.push([child, fn]);
    });
  }
  // Les jetons ?. ?? et ??= sont visités avec leur expression (forEachChild les parcourt).
  for (const v of found.values()) problems.push(`${file} : ${v}`);
}

for (const f of files) check(f, fs.readFileSync(path.join(dir, f), "utf8"));

const css = fs.readdirSync(dir).filter((f) => f.endsWith(".css"));
for (const f of css) {
  const text = fs.readFileSync(path.join(dir, f), "utf8");
  // Chaque couleur mélangée d'une propriété normale doit être précédée d'une valeur simple (scripts/css-fallbacks.mjs).
  const re = /([{;])([a-z-]+):([^;{}]*color-mix\([^;{}]*)(?=[;}])/g;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const before = text.slice(Math.max(0, m.index - 400), m.index + 1);
    const prop = m[2];
    if (prop.startsWith("--")) continue; // Variables : calculées par public/compat.js.
    if (!new RegExp(`[{;]${prop}:[^;{}]*;$`).test(before)) {
      problems.push(`${f} : « ${prop}: color-mix(…) » sans valeur de secours (${m[3].slice(0, 60)})`);
    }
  }
}

if (problems.length) {
  console.error(`Écritures trop récentes pour les anciens moteurs web (${problems.length}) :`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log(`Compatibilité : ${files.length} fichiers JavaScript et ${css.length} feuilles de styles lisibles par Chrome 70 et iOS 13.`);
