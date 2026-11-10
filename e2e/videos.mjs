// Vidéos d'aide de GestiMarket, filmées sur GitHub (workflow « aide-videos ») avec le vrai logiciel.
//
// Prérequis : GestiMarket en mode serveur sur :7878 (base vide), écran virtuel Xvfb 1280x720 sur
// $VIDEO_DISPLAY, ffmpeg, Piper (voix de synthèse) et ses voix dans $PIPER_VOICES :
//   fr_FR-siwis-medium.onnx (SIWIS, CC BY 4.0) et en_US-libritts_r-medium.onnx (LibriTTS-R, CC BY 4.0).
//
// Pour chaque vidéo et chaque langue (fr, en) : le navigateur est filmé (ffmpeg x11grab), une phrase de
// commentaire s'affiche en bas de l'écran (sous-titre incrusté) pendant que la voix la lit et que la souris
// montre l'action. Le son est posé ensuite au bon moment. Sorties : aide/out/<id>-<langue>.mp4.
//   - « ecran-<clé> » : présentation de chaque écran, commentée avec le texte de son bouton « Aide ».
//   - vidéos d'action : une tâche pas à pas (vente, Orange Money, compte client, caisse, produit, visite).
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { seedShop } from "./boutique-exemple.mjs";

const SRV = "http://127.0.0.1:7878";
const OUT = "aide/out";
const WORK = "aide/work";
const DISPLAY = process.env.VIDEO_DISPLAY ?? ":100";
const VOICES = process.env.PIPER_VOICES ?? "voices";
const ONLY = (process.env.VIDEOS_ONLY ?? "").split(",").filter(Boolean);
const LANGS = (process.env.VIDEO_LANGS ?? "fr,en").split(",");
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(WORK, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function rpc(cmd, args = {}, token = null) {
  const r = await fetch(`${SRV}/rpc/${cmd}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(args),
  });
  const d = await r.json();
  if (d.error) throw new Error(`${cmd} : ${d.error}`);
  return d.ok;
}

// ───────────── Traductions (sélecteurs des boutons en anglais) ─────────────
const EN = {};
for (const line of fs.readFileSync("src/i18n/en.ts", "utf8").split("\n")) {
  const m = /^\s*("(?:[^"\\]|\\.)*")\s*:\s*("(?:[^"\\]|\\.)*"),?\s*$/.exec(line);
  if (m) EN[JSON.parse(m[1])] = JSON.parse(m[2]);
}
let LANG = "fr";
const T = (fr) => (LANG === "en" ? EN[fr] ?? fr : fr);

// ───────────── Voix de synthèse (Piper) ─────────────
const VOICE = {
  fr: { model: path.join(VOICES, "fr_FR-siwis-medium.onnx"), args: [] },
  en: { model: path.join(VOICES, "en_US-libritts_r-medium.onnx"), args: ["--speaker", "14"] },
};
let tts = 0;
/** Lit une phrase : fichier WAV et durée (secondes). */
function speak(text, lang) {
  const file = path.join(WORK, `voix-${++tts}.wav`);
  const v = VOICE[lang];
  const r = spawnSync("piper", ["--model", v.model, ...v.args, "--output_file", file], { input: text, encoding: "utf8" });
  if (r.status !== 0 || !fs.existsSync(file)) throw new Error(`piper : ${r.stderr?.slice(0, 300)}`);
  const wav = fs.readFileSync(file);
  const byteRate = wav.readUInt32LE(28);
  const data = wav.indexOf(Buffer.from("data"));
  const size = data > 0 ? wav.readUInt32LE(data + 4) : wav.length - 44;
  return { file, seconds: size / byteRate };
}

// ───────────── Page filmée : curseur visible, sous-titre ─────────────
const overlay = `
  addEventListener("DOMContentLoaded", () => {
    const c = document.createElement("div");
    c.id = "gm-curseur";
    c.innerHTML = '<svg width="30" height="30" viewBox="0 0 24 24"><path d="M4 2l15 11.5-6.6 1.2 3.9 6.9-2.9 1.6-3.9-7L4 20z" fill="#0f172a" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    Object.assign(c.style, { position: "fixed", left: "0", top: "0", zIndex: 2147483647, pointerEvents: "none", transform: "translate(-200px,-200px)", filter: "drop-shadow(0 2px 3px rgba(0,0,0,.35))" });
    document.body.appendChild(c);
    addEventListener("mousemove", (e) => { c.style.transform = "translate(" + (e.clientX - 5) + "px," + (e.clientY - 3) + "px)"; }, true);
    addEventListener("mousedown", (e) => {
      const o = document.createElement("div");
      Object.assign(o.style, { position: "fixed", left: e.clientX - 22 + "px", top: e.clientY - 22 + "px", width: "44px", height: "44px", borderRadius: "50%",
        border: "4px solid rgba(20,184,166,.9)", zIndex: 2147483646, pointerEvents: "none", transition: "transform .45s ease-out, opacity .45s ease-out" });
      document.body.appendChild(o);
      requestAnimationFrame(() => { o.style.transform = "scale(1.8)"; o.style.opacity = "0"; });
      setTimeout(() => o.remove(), 500);
    }, true);
    const s = document.createElement("div");
    s.id = "gm-soustitre";
    Object.assign(s.style, { position: "fixed", left: "50%", bottom: "26px", transform: "translateX(-50%)", maxWidth: "1080px", zIndex: 2147483645,
      pointerEvents: "none", background: "rgba(11,26,36,.86)", color: "#fff", font: "600 23px/1.35 Inter, system-ui, sans-serif",
      padding: "12px 22px", borderRadius: "14px", textAlign: "center", boxShadow: "0 6px 22px rgba(0,0,0,.35)", display: "none" });
    document.body.appendChild(s);
  });`;

async function caption(page, text) {
  await page.evaluate((t) => {
    const s = document.getElementById("gm-soustitre");
    if (!s) return;
    s.textContent = t;
    s.style.display = t ? "block" : "none";
  }, text).catch(() => {});
}

let browser;
async function launch() {
  browser = await chromium.launch({
    headless: false,
    env: { ...process.env, DISPLAY },
    args: ["--window-position=0,0", "--window-size=1280,720", "--hide-scrollbars", "--disable-infobars", "--no-first-run",
      "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
  });
}

/** Nouvelle page dans la langue voulue, connectée, en plein écran. */
async function openPage(token, hash) {
  const ctx = await browser.newContext({ viewport: null, locale: LANG === "fr" ? "fr-FR" : "en-GB" });
  await ctx.addInitScript(([t, l]) => {
    sessionStorage.setItem("gm-token", t);
    localStorage.setItem("gm-lang", l);
    localStorage.setItem("gm-update-dismissed", "99.0.0");
  }, [token, LANG]);
  await ctx.addInitScript({ content: overlay });
  const page = await ctx.newPage();
  try {
    const cdp = await ctx.newCDPSession(page);
    const { windowId } = await cdp.send("Browser.getWindowForTarget");
    await cdp.send("Browser.setWindowBounds", { windowId, bounds: { windowState: "fullscreen" } });
  } catch (e) {
    console.log("plein écran :", e.message);
  }
  await page.goto(`${SRV}/${hash}`, { waitUntil: "load" });
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
  await sleep(1500);
  await page.mouse.move(640, 360);
  return { ctx, page };
}

async function moveTo(page, locator, click = false) {
  const l = locator.first();
  await l.waitFor({ state: "visible", timeout: 10_000 });
  await l.scrollIntoViewIfNeeded().catch(() => {});
  const b = await l.boundingBox();
  if (!b) return;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 22 });
  if (click) {
    await sleep(250);
    await page.mouse.down();
    await sleep(70);
    await page.mouse.up();
  }
}

async function typeSlowly(page, locator, text) {
  await moveTo(page, locator, true);
  await locator.first().fill("");
  await page.keyboard.type(text, { delay: 110 });
}

// ───────────── Tournage d'une vidéo ─────────────
/**
 * steps : [{ say: { fr, en }, do?: async (page) => void }] ; la phrase s'affiche et se lit pendant l'action.
 */
async function film({ id, token, hash, steps }) {
  const name = `${id}-${LANG}`;
  const raw = path.join(WORK, `${name}-brut.mp4`);
  const { ctx, page } = await openPage(token, hash);
  const ff = spawn("ffmpeg", ["-y", "-loglevel", "error", "-f", "x11grab", "-video_size", "1280x720", "-framerate", "25", "-draw_mouse", "0",
    "-i", `${DISPLAY}.0`, "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p", raw], { stdio: ["pipe", "inherit", "inherit"] });
  const t0 = Date.now();
  await sleep(700);
  const voices = [];
  for (const step of steps) {
    const text = typeof step.say === "string" ? step.say : step.say[LANG] ?? step.say.fr;
    if (!text) continue;
    const v = speak(text, LANG);
    const at = Date.now() - t0;
    await caption(page, text);
    voices.push({ file: v.file, at });
    const action = (async () => {
      try {
        await step.do?.(page);
      } catch (e) {
        console.log(`  [${name}] action : ${e.message.split("\n")[0]}`);
      }
    })();
    await Promise.all([action, sleep(v.seconds * 1000 + 450)]);
  }
  // Fin : nom du logiciel et crédit des voix (licence CC BY 4.0).
  await caption(page, LANG === "fr" ? "GestiMarket · Eden Dev — voix de synthèse Piper (SIWIS, LibriTTS-R, CC BY 4.0)" : "GestiMarket · Eden Dev — Piper synthetic voice (SIWIS, LibriTTS-R, CC BY 4.0)");
  await sleep(2600);
  ff.stdin.write("q");
  await new Promise((r) => ff.on("close", r));
  await ctx.close();

  // Son : chaque phrase posée à son moment (adelay), mélangées, puis vidéo finale (H.264 + AAC).
  const out = path.join(OUT, `${name}.mp4`);
  const inputs = voices.flatMap((v) => ["-i", v.file]);
  const filters = voices.map((v, i) => `[${i + 1}:a]adelay=${v.at}|${v.at}[a${i}]`).join(";");
  const mix = `${voices.map((_, i) => `[a${i}]`).join("")}amix=inputs=${voices.length}:dropout_transition=0,volume=${voices.length}[a]`;
  const r = spawnSync("ffmpeg", ["-y", "-loglevel", "error", "-i", raw, ...inputs, "-filter_complex", `${filters};${mix}`, "-map", "0:v", "-map", "[a]",
    "-c:v", "libx264", "-preset", "medium", "-crf", "26", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "96k", "-movflags", "+faststart", out], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`ffmpeg : ${r.stderr?.slice(0, 400)}`);
  fs.rmSync(raw, { force: true });
  for (const v of voices) fs.rmSync(v.file, { force: true });
  const seconds = (Date.now() - t0) / 1000;
  console.log(`vidéo ${name} : ${seconds.toFixed(0)} s, ${Math.round(fs.statSync(out).size / 1024)} Ko`);
  return { name, seconds };
}

// ───────────── Vidéos d'écran : commentées avec le texte de l'aide ─────────────
const SCREENS = [
  ["pos", "pos", "cashier"], ["my_dashboard", "my-dashboard", "cashier"], ["dashboard", "dashboard", "admin"], ["sales", "sales", "admin"],
  ["cash", "cash", "admin"], ["returns", "returns", "admin"], ["customers", "customers", "admin"], ["promotions", "promotions", "admin"],
  ["products", "products", "admin"], ["categories", "categories", "admin"], ["stock", "stock", "admin"], ["purchases", "purchases", "admin"],
  ["suppliers", "suppliers", "admin"], ["locations", "locations", "admin"], ["finder", "finder", "admin"], ["reports", "reports", "admin"],
  ["payments", "payments", "admin"], ["users", "users", "admin"], ["audit", "audit", "admin"], ["poste", "poste", "admin"], ["settings", "settings", "admin"],
];

/** Texte du bouton « Aide » de l'écran (dans la langue de la page). */
async function helpText(token, route) {
  const { ctx, page } = await openPage(token, `#/${route}`);
  let help = null;
  try {
    await page.locator(".page-header .btn-help").first().click({ timeout: 8000 });
    await page.waitForSelector(".help-panel", { timeout: 5000 });
    help = await page.evaluate(() => {
      const panel = document.querySelector(".help-panel");
      const sec = [...panel.querySelectorAll("section")].filter((s) => !s.querySelector(".help-videos"));
      return {
        title: panel.querySelector("h2")?.textContent?.trim() ?? "",
        purpose: sec[0]?.querySelector("p")?.textContent?.trim() ?? "",
        steps: [...(sec[1]?.querySelectorAll("li") ?? [])].map((li) => li.textContent.trim()),
        tips: [...(sec[2]?.querySelectorAll("li") ?? [])].map((li) => li.textContent.trim()),
      };
    });
  } catch (e) {
    console.log(`aide de ${route} : ${e.message.split("\n")[0]}`);
  }
  await ctx.close();
  return help;
}

/** La souris parcourt les éléments de l'écran (boutons, onglets, lignes) pendant le commentaire. */
function explore(i) {
  return async (page) => {
    const targets = page.locator(".page-header .btn, .tabbar .tab-item, .card .btn, .stat-card, table tbody tr, .tile, .mode-card, .card-title");
    const n = await targets.count();
    if (!n) return;
    await moveTo(page, targets.nth(Math.min(n - 1, i * 3)));
  };
}

function screenVideo(key, route, token) {
  return async () => {
    const h = await helpText(token, route);
    if (!h) throw new Error("aide introuvable");
    const steps = [{ say: `${h.title}. ${h.purpose}`, do: explore(0) }];
    h.steps.slice(0, 6).forEach((s, i) => steps.push({ say: s, do: explore(i + 1) }));
    h.tips.slice(0, 2).forEach((s, i) => steps.push({ say: s, do: explore(i + 7) }));
    return film({ id: `ecran-${key}`, token, hash: `#/${route}`, steps });
  };
}

// ───────────── Vidéos d'action ─────────────
function actionVideos(tok) {
  const press = (key) => async (page) => page.keyboard.press(key);
  const byText = (page, sel, fr) => page.locator(sel).filter({ hasText: T(fr) });
  return {
    vente: () =>
      film({
        id: "vente", token: tok.cashier, hash: "#/pos",
        steps: [
          { say: { fr: "Pour vendre, scannez l'article avec la douchette ou la caméra, ou tapez son nom.", en: "To sell, scan the item with the barcode scanner or the camera, or type its name." },
            do: async (p) => { await typeSlowly(p, p.locator(".pos-search input"), "Riz"); await sleep(900); await moveTo(p, p.locator(".tile"), true); } },
          { say: { fr: "Tapez six, étoile, puis le code-barres : six articles d'un coup.", en: "Type six, star, then the barcode: six items at once." },
            do: async (p) => { await typeSlowly(p, p.locator(".pos-search input"), "6*5449000000996"); await p.keyboard.press("Enter"); } },
          { say: { fr: "Le ticket montre les articles, le prix de gros à partir de vingt-quatre, et les promotions.", en: "The ticket shows the items, the wholesale price from twenty-four, and the promotions." },
            do: async (p) => p.mouse.move(1080, 300, { steps: 25 }) },
          { say: { fr: "Touche F9 pour encaisser. Choisissez espèces : le montant reçu et la monnaie s'affichent.", en: "Press F9 to take payment. Choose cash: the amount received and the change are shown." },
            do: async (p) => { await p.keyboard.press("F9"); await sleep(800); await moveTo(p, p.locator(".method-grid .method"), true); } },
          { say: { fr: "Validez la vente. Le ticket peut s'imprimer, puis on passe au client suivant.", en: "Confirm the sale. The receipt can be printed, then on to the next customer." },
            do: async (p) => { await moveTo(p, byText(p, ".modal-footer .btn-primary", "Valider la vente (Entrée)"), true); await sleep(1800); await moveTo(p, byText(p, ".modal-footer .btn", "Nouvelle vente"), true); } },
        ],
      }),
    "paiement-mobile": () =>
      film({
        id: "paiement-mobile", token: tok.cashier, hash: "#/pos",
        steps: [
          { say: { fr: "Le client veut payer par Orange Money. Ajoutez les articles comme d'habitude.", en: "The customer wants to pay with Orange Money. Add the items as usual." },
            do: async (p) => { await typeSlowly(p, p.locator(".pos-search input"), "Huile"); await sleep(900); await moveTo(p, p.locator(".tile"), true); } },
          { say: { fr: "Touche F9, puis Orange Money.", en: "Press F9, then Orange Money." },
            do: async (p) => { await p.keyboard.press("F9"); await sleep(800); await moveTo(p, p.locator(".method-grid .method").filter({ hasText: "Orange" }), true); } },
          { say: { fr: "Le QR code du marchand s'affiche, ici et sur l'écran client. Le client le scanne et paie avec son téléphone.", en: "The merchant QR code is shown, here and on the customer display. The customer scans it and pays with the phone." },
            do: async (p) => p.mouse.move(820, 380, { steps: 25 }) },
          { say: { fr: "Saisissez la référence reçue par SMS, puis validez la vente : le paiement est noté dans Paiements mobiles.", en: "Enter the reference received by SMS, then confirm the sale: the payment is recorded in Mobile payments." },
            do: async (p) => { const ref = p.locator(".modal input").last(); await typeSlowly(p, ref, "MP251110.1520.C88812"); } },
          { say: { fr: "Paiement partiel : un client peut payer une partie en espèces et le reste par Orange Money.", en: "Partial payment: a customer can pay part in cash and the rest with Orange Money." },
            do: async (p) => { await moveTo(p, byText(p, ".modal-footer .btn", "Paiement partiel")); await sleep(1500); await p.keyboard.press("Escape"); } },
        ],
      }),
    "compte-client": () =>
      film({
        id: "compte-client", token: tok.admin, hash: "#/customers",
        steps: [
          { say: { fr: "Chaque client a un compte. En rouge, il doit de l'argent à la boutique. En vert, il a déposé des fonds.", en: "Each customer has an account. In red, they owe the shop money. In green, they have deposited funds." },
            do: async (p) => moveTo(p, p.locator("table tbody tr")) },
          { say: { fr: "Versement : l'argent rembourse d'abord la dette, le reste devient des fonds.", en: "Deposit: the money first repays the debt, the rest becomes funds." },
            do: async (p) => { await moveTo(p, p.locator("table tbody tr .icon-btn").first(), true); await sleep(900); } },
          { say: { fr: "Tapez le montant, choisissez le moyen de paiement et confirmez avec le code PIN.", en: "Type the amount, choose the payment method and confirm with the PIN." },
            do: async (p) => { const amount = p.locator(".modal input").first(); await typeSlowly(p, amount, "10000"); await sleep(1200); await p.keyboard.press("Escape"); } },
          { say: { fr: "En caisse, Compte client paie avec les fonds d'abord, puis en dette jusqu'au plafond de crédit.", en: "At the till, Customer account pays with the funds first, then as a debt up to the credit limit." } },
          { say: { fr: "Le relevé montre tous les achats, versements et retours du client.", en: "The statement shows all the customer's purchases, deposits and returns." },
            do: async (p) => moveTo(p, p.locator("table tbody tr .icon-btn").last()) },
        ],
      }),
    caisse: () =>
      film({
        id: "caisse", token: tok.cashier, hash: "#/cash",
        steps: [
          { say: { fr: "Le matin, ouvrez votre caisse en déclarant le fond de caisse, les espèces du tiroir.", en: "In the morning, open your till by declaring the opening float, the cash in the drawer." },
            do: async (p) => moveTo(p, p.locator(".page-header .btn").first()) },
          { say: { fr: "Pendant la journée, les entrées et sorties d'espèces sont notées : dépenses, versements des clients.", en: "During the day, cash in and out is recorded: expenses, customer deposits." },
            do: async (p) => moveTo(p, p.locator(".card").first()) },
          { say: { fr: "Le soir, clôturez la caisse : comptez les espèces, GestiMarket calcule l'écart.", en: "In the evening, close the till: count the cash, GestiMarket computes the difference." },
            do: async (p) => { await moveTo(p, byText(p, ".btn", "Clôturer ma caisse"), true); await sleep(1500); } },
          { say: { fr: "Le rapport Z de la journée est numéroté et ne peut plus être modifié.", en: "The day's Z report is numbered and can no longer be changed." },
            do: async (p) => { await sleep(1200); await p.keyboard.press("Escape"); } },
        ],
      }),
    produit: () =>
      film({
        id: "produit", token: tok.admin, hash: "#/products",
        steps: [
          { say: { fr: "Produits, puis Nouveau produit.", en: "Products, then New product." },
            do: async (p) => { await moveTo(p, byText(p, ".page-header .btn", "Nouveau produit"), true); await sleep(900); } },
          { say: { fr: "Tapez le nom, choisissez la catégorie, puis les prix d'achat et de vente.", en: "Type the name, choose the category, then the purchase and sale prices." },
            do: async (p) => { await typeSlowly(p, p.locator(".modal input").first(), "Savon de Marseille 300 g"); } },
          { say: { fr: "Le code-barres est créé tout seul si le produit n'en a pas. Ajoutez une photo et le stock de départ.", en: "A barcode is created automatically if the product has none. Add a photo and the starting stock." },
            do: async (p) => p.mouse.move(700, 420, { steps: 25 }) },
          { say: { fr: "Enregistrez. Pour un catalogue entier, utilisez Importer avec un fichier Excel.", en: "Save. For a whole catalogue, use Import with an Excel file." },
            do: async (p) => { await p.keyboard.press("Escape"); await sleep(600); await moveTo(p, byText(p, ".page-header .btn", "Importer")); } },
        ],
      }),
    localiser: () =>
      film({
        id: "localiser", token: tok.admin, hash: "#/finder",
        steps: [
          { say: { fr: "Où est ce produit ? Tapez son nom ou scannez son code-barres. Raccourci partout : Contrôle K.", en: "Where is this product? Type its name or scan its barcode. Shortcut everywhere: Control K." },
            do: async (p) => { await typeSlowly(p, p.locator(".finder-search input"), "Riz"); await sleep(1200); } },
          { say: { fr: "Le meuble, l'étage et la case s'affichent, et le meuble clignote sur le plan.", en: "The fixture, the shelf and the slot are shown, and the fixture blinks on the plan." },
            do: async (p) => { await moveTo(p, p.locator(".finder-views button").first(), true); await sleep(1500); } },
          { say: { fr: "En 3D, le chemin vert part de l'entrée.", en: "In 3D, the green path starts at the entrance." },
            do: async (p) => { await moveTo(p, p.locator(".finder-views button").nth(1), true); await sleep(3000); } },
          { say: { fr: "Visite : la caméra marche toute seule jusqu'au produit, à hauteur d'homme.", en: "Visit: the camera walks by itself to the product, at eye level." },
            do: async (p) => { await moveTo(p, p.locator(".finder-views button").nth(2), true); await sleep(9000); } },
          { say: { fr: "Arrivé devant le meuble, la case du produit clignote. Regarder autour permet de marcher librement.", en: "In front of the fixture, the product's slot blinks. Look around lets you walk freely." },
            do: async (p) => moveTo(p, p.locator(".finder-tour .btn").last()) },
        ],
      }),
  };
}

// ───────────── Programme ─────────────
const results = [];
try {
  const shop = await seedShop((cmd, args, token) => rpc(cmd, args, token));
  const tok = { admin: shop.admin, cashier: shop.caissiere };
  console.log("boutique d'exemple prête");
  await launch();
  const jobs = [
    ...SCREENS.map(([key, route, who]) => [`ecran-${key}`, screenVideo(key, route, who === "cashier" ? tok.cashier : tok.admin)]),
    ...Object.entries(actionVideos(tok)),
  ].filter(([id]) => !ONLY.length || ONLY.includes(id));
  for (const lang of LANGS) {
    LANG = lang;
    for (const [id, run] of jobs) {
      try {
        const r = await run();
        results.push({ id, lang, ok: true, seconds: r.seconds });
      } catch (e) {
        console.log(`::warning title=Vidéo ${id}-${lang}::${e.message.split("\n")[0]}`);
        results.push({ id, lang, ok: false, error: e.message.slice(0, 300) });
      }
    }
  }
} catch (e) {
  console.log(`::error title=Vidéos d'aide::${e.stack ?? e.message}`);
  results.push({ id: "programme", ok: false, error: String(e) });
} finally {
  await browser?.close();
  fs.writeFileSync(path.join(OUT, "videos.json"), JSON.stringify(results, null, 2));
  const ok = results.filter((r) => r.ok).length;
  console.log(`${ok}/${results.length} vidéos filmées`);
  process.exit(ok > 0 ? 0 : 1);
}
