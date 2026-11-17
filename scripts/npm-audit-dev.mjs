// Failles des modules web, outils de fabrication compris (vite, eslint…) : contrôle qualité (CI).
//
// Les modules livrés dans GestiMarket sont contrôlés à part, sans exception (npm audit --omit=dev).
// Ici, une faille grave ou critique fait échouer le contrôle seulement si une correction simple existe
// (npm audit fix, sans changer de version majeure d'un outil). Sans correction publiée — ou seulement en
// revenant à une ancienne version majeure — elle est signalée par un avertissement : ces outils ne servent qu'à
// fabriquer le logiciel et ne sont pas installés chez les boutiques. Le contrôle échoue de nouveau dès qu'une
// correction paraît.
//
//   node scripts/npm-audit-dev.mjs
import { execSync } from "node:child_process";

let out;
try {
  out = execSync("npm audit --json", { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
} catch (e) {
  out = e.stdout ?? ""; // npm audit sort en erreur dès qu'une faille existe
}
let report;
try {
  report = JSON.parse(out);
} catch {
  console.log("::error title=npm audit::réponse illisible (registre npm injoignable ?)");
  process.exit(1);
}
if (report.error) {
  console.log(`::error title=npm audit::${report.error.summary ?? "erreur"}`);
  process.exit(1);
}

const serious = Object.values(report.vulnerabilities ?? {}).filter((v) => v.severity === "high" || v.severity === "critical");
let failures = 0;
for (const v of serious) {
  const advisories = v.via.filter((x) => typeof x === "object");
  if (!advisories.length) continue; // module touché seulement par un autre (même faille, déjà signalée)
  const fix = v.fixAvailable;
  const simpleFix = fix === true || (typeof fix === "object" && fix !== null && !fix.isSemVerMajor);
  const what = advisories.map((a) => `${a.title} (${a.url}, versions ${a.range})`).join(" ; ");
  if (simpleFix) {
    failures++;
    console.log(`::error title=Faille ${v.severity} : ${v.name}::${what}. Correction : npm audit fix`);
  } else {
    console.log(`::warning title=Faille ${v.severity} sans correction (outil de fabrication) : ${v.name}::${what}`);
  }
}
console.log(`${serious.length} module(s) touché(s) par une faille grave, ${failures} avec une correction à appliquer.`);
process.exit(failures ? 1 : 0);
