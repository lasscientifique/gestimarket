// Manuels d'utilisation (PDF, français et anglais) rangés dans l'application : public/manuel/, copiés tels
// quels dans l'interface fabriquée. Ils s'ouvrent ainsi dans GestiMarket dès le premier jour, sans Internet.
//
// Source : la dernière édition publiée (pré-release « aide »), refaite par le test d'interface à chaque envoi
// sur main. Lancé par GitHub Actions avant chaque fabrication (installateurs, APK, test d'interface).
// Sans Internet ou sans manuel publié : avertissement, et le lecteur du manuel propose la version en ligne.
import fs from "node:fs";
import path from "node:path";

const BASE = "https://github.com/lasscientifique/gestimarket/releases/download/aide";
const DIR = path.join("public", "manuel");
fs.mkdirSync(DIR, { recursive: true });

let ok = 0;
for (const lang of ["fr", "en"]) {
  const file = `GestiMarket_manuel_${lang}.pdf`;
  try {
    const r = await fetch(`${BASE}/${file}`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.subarray(0, 5).toString() !== "%PDF-" || buf.length < 200_000) throw new Error(`fichier inattendu (${buf.length} octets)`);
    fs.writeFileSync(path.join(DIR, file), buf);
    console.log(`${file} : ${Math.round(buf.length / 1024)} Ko`);
    ok++;
  } catch (e) {
    console.log(`::warning title=Manuel non rangé dans l'application::${file} : ${e.message}`);
  }
}
console.log(`${ok} manuel(s) rangé(s) dans ${DIR}`);
