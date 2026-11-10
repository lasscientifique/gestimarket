// Manuel d'utilisation en PDF (français et anglais), fabriqué à chaque test d'interface sur GitHub.
//
// - Chapitres écrits à la main : docs/manuel/<langue>/*.md (installation, téléphone serveur et TV, caisse…).
// - « Les écrans, un par un » : pour chaque écran du vrai logiciel (boutique d'exemple du test), une capture
//   et le texte de son bouton « Aide » (dans la langue du manuel) : le manuel suit toujours le logiciel.
// - PDF A4 par le navigateur du test (Chromium), numéros de page en bas.
// Sorties : <out>/GestiMarket_manuel_fr.pdf et <out>/GestiMarket_manuel_en.pdf
import fs from "node:fs";
import path from "node:path";

/** Écrans du manuel, dans l'ordre : clé de l'aide, adresse, rôle qui l'ouvre. */
const SCREENS = [
  ["pos", "pos", "cashier"], ["my_dashboard", "my-dashboard", "cashier"], ["dashboard", "dashboard", "admin"],
  ["sales", "sales", "admin"], ["cash", "cash", "admin"], ["returns", "returns", "admin"], ["customers", "customers", "admin"],
  ["promotions", "promotions", "admin"], ["products", "products", "admin"], ["categories", "categories", "admin"],
  ["stock", "stock", "admin"], ["purchases", "purchases", "admin"], ["suppliers", "suppliers", "admin"],
  ["locations", "locations", "admin"], ["finder", "finder", "admin"], ["reports", "reports", "admin"],
  ["payments", "payments", "admin"], ["users", "users", "admin"], ["audit", "audit", "admin"],
  ["poste", "poste", "admin"], ["settings", "settings", "admin"],
];

const TEXT = {
  fr: { title: "Manuel d'utilisation", screens: "Les écrans, un par un", contents: "Sommaire", by: "Eden Dev", version: "Version", date: "Édition du" },
  en: { title: "User manual", screens: "The screens, one by one", contents: "Contents", by: "Eden Dev", version: "Version", date: "Edition of" },
};

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

/** Texte de l'aide d'un écran, lu dans le panneau « Aide » (titre et sections, sans les vidéos). */
function readHelpPanel() {
  const panel = document.querySelector(".help-panel");
  if (!panel) return null;
  const title = panel.querySelector("h2")?.textContent?.trim() ?? "";
  const sections = [...panel.querySelectorAll("section")]
    .filter((s) => !s.querySelector(".help-videos"))
    .map((s) => ({
      heading: s.querySelector("h4")?.textContent?.trim() ?? "",
      paragraphs: [...s.querySelectorAll("p")].map((p) => p.textContent.trim()).filter(Boolean),
      items: [...s.querySelectorAll("li")].map((li) => li.textContent.trim()).filter(Boolean),
      ordered: !!s.querySelector("ol"),
    }));
  return { title, sections };
}

async function screenPages(browser, url, tokens, lang) {
  const out = [];
  for (const role of ["cashier", "admin"]) {
    const token = tokens[role];
    if (!token) continue;
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, locale: lang === "fr" ? "fr-FR" : "en-GB" });
    await ctx.addInitScript(([t, l]) => {
      sessionStorage.setItem("gm-token", t);
      localStorage.setItem("gm-lang", l);
    }, [token, lang]);
    const page = await ctx.newPage();
    await page.goto(`${url}/#/`, { waitUntil: "load" });
    await page.waitForTimeout(1500);
    for (const [key, route, who] of SCREENS) {
      if (who !== role) continue;
      try {
        await page.evaluate((r) => (location.hash = `#/${r}`), route);
        await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
        await page.waitForTimeout(1200);
        const shot = (await page.screenshot({ type: "jpeg", quality: 70 })).toString("base64");
        let help = null;
        const btn = page.locator(".btn-help").first();
        if (await btn.count()) {
          await btn.click();
          await page.waitForSelector(".help-panel", { timeout: 4000 }).catch(() => {});
          help = await page.evaluate(readHelpPanel);
          await page.keyboard.press("Escape");
          await page.waitForTimeout(300);
        }
        out.push({ key, shot, help });
      } catch (e) {
        console.log(`[manuel] écran ${key} (${lang}) : ${e.message}`);
      }
    }
    await ctx.close();
  }
  // Ordre du manuel.
  return SCREENS.map(([k]) => out.find((s) => s.key === k)).filter(Boolean);
}

function chapters(lang, marked) {
  const dir = path.join("docs", "manuel", lang);
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .sort()
    .map((f) => {
      const md = fs.readFileSync(path.join(dir, f), "utf8");
      const titles = [...md.matchAll(/^# (.+)$/gm)].map((m) => m[1].trim());
      return { titles, html: marked.parse(md) };
    });
}

function html({ lang, version, chapters: chs, screens }) {
  const t = TEXT[lang];
  const today = new Date().toLocaleDateString(lang === "fr" ? "fr-FR" : "en-GB", { day: "numeric", month: "long", year: "numeric" });
  const icon = fs.existsSync("src-tauri/icons/128x128@2x.png") ? fs.readFileSync("src-tauri/icons/128x128@2x.png").toString("base64") : "";
  const toc = [
    ...chs.flatMap((c) => c.titles),
    t.screens,
  ];
  const screenHtml = screens
    .map((s) => {
      const h = s.help;
      const body = (h?.sections ?? [])
        .map((sec) => {
          const list = sec.items.length ? `<${sec.ordered ? "ol" : "ul"}>${sec.items.map((i) => `<li>${esc(i)}</li>`).join("")}</${sec.ordered ? "ol" : "ul"}>` : "";
          return `<h3>${esc(sec.heading)}</h3>${sec.paragraphs.map((p) => `<p>${esc(p)}</p>`).join("")}${list}`;
        })
        .join("");
      return `<section class="screen"><h2>${esc(h?.title || s.key)}</h2><img class="shot" src="data:image/jpeg;base64,${s.shot}" alt="" />${body}</section>`;
    })
    .join("\n");
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><title>GestiMarket — ${esc(t.title)}</title>
<style>
  @page { size: A4; margin: 16mm 15mm 18mm; }
  body { font-family: "Inter", "Segoe UI", "DejaVu Sans", "Liberation Sans", Arial, sans-serif; color: #0f172a; font-size: 10.5pt; line-height: 1.5; }
  .cover { height: 250mm; display: flex; flex-direction: column; justify-content: center; align-items: flex-start; gap: 6mm; padding: 0 10mm; }
  .cover img { width: 34mm; height: 34mm; border-radius: 8mm; }
  .cover h1 { font-size: 34pt; margin: 0; color: #0b1a24; border: 0; }
  .cover .sub { font-size: 18pt; color: #0f766e; font-weight: 600; }
  .cover .meta { color: #64748b; font-size: 11pt; }
  .toc { break-before: page; }
  .toc ol { font-size: 12pt; line-height: 2; }
  h1 { break-before: page; font-size: 20pt; color: #0b1a24; border-bottom: 3px solid #0f766e; padding-bottom: 2mm; margin: 0 0 5mm; }
  h2 { font-size: 14pt; color: #0f766e; margin: 7mm 0 2mm; }
  h3 { font-size: 11.5pt; margin: 4mm 0 1mm; }
  p { margin: 1.5mm 0; }
  ul, ol { margin: 1.5mm 0 2mm; padding-left: 6mm; }
  li { margin: 0.8mm 0; }
  table { border-collapse: collapse; width: 100%; margin: 3mm 0; font-size: 9.5pt; }
  th, td { border: 1px solid #cbd5e1; padding: 1.6mm 2.2mm; text-align: left; vertical-align: top; }
  th { background: #f1f5f9; }
  code { background: #f1f5f9; padding: 0 1mm; border-radius: 1mm; font-size: 9.5pt; }
  .screens-title { break-before: page; }
  .screen { break-inside: avoid-page; }
  .screen + .screen { break-before: page; }
  .shot { width: 100%; border: 1px solid #cbd5e1; border-radius: 2mm; margin: 2mm 0 3mm; }
</style></head><body>
<div class="cover">
  ${icon ? `<img src="data:image/png;base64,${icon}" alt="" />` : ""}
  <h1>GestiMarket</h1>
  <div class="sub">${esc(t.title)}</div>
  <div class="meta">${esc(t.version)} ${esc(version)} · ${esc(t.date)} ${esc(today)} · ${esc(t.by)}</div>
</div>
<div class="toc"><h2>${esc(t.contents)}</h2><ol>${toc.map((x) => `<li>${esc(x)}</li>`).join("")}</ol></div>
${chs.map((c) => c.html).join("\n")}
<h1 class="screens-title">${esc(t.screens)}</h1>
${screenHtml}
</body></html>`;
}

/** Fabrique les deux manuels. Retourne la liste des fichiers créés. */
export async function buildManuals({ browser, url, adminToken, cashierToken, out, check }) {
  let marked;
  try {
    ({ marked } = await import("marked"));
  } catch (e) {
    check("manuel PDF : module « marked » disponible", false, e.message);
    return [];
  }
  const version = await fetch(`${url}/api/ping`).then((r) => r.json()).then((v) => v.version, () => "");
  const files = [];
  for (const lang of ["fr", "en"]) {
    const screens = await screenPages(browser, url, { admin: adminToken, cashier: cashierToken }, lang);
    const doc = html({ lang, version, chapters: chapters(lang, marked), screens });
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.setContent(doc, { waitUntil: "load" });
    const file = path.join(out, `GestiMarket_manuel_${lang}.pdf`);
    await page.pdf({
      path: file,
      format: "A4",
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: "<span></span>",
      footerTemplate: `<div style="font-size:8px;width:100%;text-align:center;color:#64748b;font-family:sans-serif">GestiMarket ${esc(version)} — <span class="pageNumber"></span> / <span class="totalPages"></span></div>`,
      margin: { top: "16mm", bottom: "18mm", left: "15mm", right: "15mm" },
    });
    await ctx.close();
    const size = fs.statSync(file).size;
    const withHelp = screens.filter((s) => s.help?.sections?.length).length;
    check(`manuel PDF (${lang}) : ${screens.length} écrans avec capture, ${withHelp} avec leur aide`, screens.length >= 18 && withHelp >= 15 && size > 200_000, `${Math.round(size / 1024)} Ko`);
    files.push(file);
  }
  return files;
}
