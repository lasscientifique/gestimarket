// Vérifie le QR PI-SPI fabriqué par GestiMarket (src/lib/pispi.ts) contre la spécification de la BCEAO (CI).
//   node scripts/check-pispi.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = fs.readFileSync(path.join(ROOT, "src/lib/pispi.ts"), "utf8");
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText;
const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "pispi-")), "pispi.mjs");
fs.writeFileSync(tmp, js);
const P = await import(pathToFileURL(tmp).href);

let failed = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "ok  " : "ÉCHEC"} ${name}${ok ? "" : ` : ${detail}`}`);
  if (!ok) failed++;
};

// 1. Exemple officiel de la BCEAO (guide « Générer un QR Code ») : CRC attendu 9618.
const official = "00020136560012int.bceao.pi0136111c3e1b-4312-49ec-b75e-4c8c74c10fd7520400005303952540410005802CI5901X6001X62270516F2YG7643D5HH202311035006304";
check("CRC de l'exemple officiel = 9618", P.crc16(official) === "9618", P.crc16(official));

// 2. QR fixe sans montant : même forme que le QR PI-SPI d'Orange Money Mali (canal 000, pays ML, nom et ville « X »).
const alias = "341c3e1b-4312-49ec-b75e-4c8c74c10fd7";
const fixed = P.pispiPayload({ alias });
const fixedBody = `00020136560012int.bceao.pi0136${alias}5204000053039525802ML5901X6001X62071103000`;
check("QR fixe : forme exacte", fixed.startsWith(fixedBody + "6304") && fixed.length === fixedBody.length + 8, fixed);
check("QR fixe : CRC valide", P.pispiCrcOk(fixed), fixed);

// 3. QR unique d'une vente : montant, référence, canal 400.
const sale = P.pispiPayload({ alias: alias.toUpperCase(), amount: 1000, reference: "f2yg-7643 d5hh2023", country: "ml" });
check("QR unique : montant 1000 (54041000)", sale.includes("520400005303952540410005802ML"), sale);
check("QR unique : référence et canal 400", sale.includes("62270516F2YG7643D5HH20231103400"), sale);
check("QR unique : CRC valide", P.pispiCrcOk(sale), sale);

// 4. Alias collé : l'alias seul, ou le texte complet d'un QR.
check("alias tiré d'un QR complet", P.pispiAliasFrom(sale) === alias);
check("alias seul (majuscules, espaces)", P.pispiAliasFrom(`  ${alias.toUpperCase()} `) === alias);
check("texte quelconque refusé", P.pispiAliasFrom("70 00 00 00") === null && P.pispiAliasFrom("") === null);
check("QR d'un autre réseau refusé", P.pispiAliasFrom(fixed.replace("int.bceao.pi", "int.autre.pi")) === null);

// 5. Montant absent ou nul : pas de champ 54 ; référence vide : canal 000.
check("montant 0 ignoré", !P.pispiPayload({ alias, amount: 0 }).includes("5303952540"));
check("référence aléatoire : lettres et chiffres, 25 au plus", /^GM[0-9A-Z]{6,23}$/.test(P.pispiReference()));

if (failed) {
  console.error(`${failed} vérification(s) PI-SPI en échec`);
  process.exit(1);
}
console.log("QR PI-SPI conforme");
