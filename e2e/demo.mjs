// Tournage de la démonstration GestiMarket (publicité) : vrai logiciel, boutique d'exemple.
//
// Prérequis (voir .github/workflows/demo.yml) : GestiMarket lancé en mode serveur sur :7878, écran
// virtuel Xvfb 1920x1080 sur $DEMO_DISPLAY, ffmpeg. Le script :
//   1. remplit une boutique d'exemple par RPC (produits, stock, prix de gros, promotion, client, plan, ventes) ;
//   2. ouvre Chromium en plein écran sur l'écran virtuel et filme l'écran avec ffmpeg (x11grab) ;
//   3. joue le scénario (connexion par PIN, vente scannée payée par Orange Money, tableau de bord, produits,
//      stock, promotions, plan 3D, caisse, Paramètres → Développeur Eden Dev), avec un curseur visible ;
//   4. prend des captures téléphone et tablette.
// Sorties dans demo/out : ecran.mp4 (film), reperes.json (début de chaque séquence, en secondes), *.png.
import { spawn } from "node:child_process";
import fs from "node:fs";
import { chromium } from "playwright";

const SRV = "http://127.0.0.1:7878";
const OUT = "demo/out";
const PIN = "135792";
const DISPLAY = process.env.DEMO_DISPLAY ?? ":100";
fs.mkdirSync(OUT, { recursive: true });
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

// Licence BUSINESS signée avec la clé de test (kid 99), reconnue par les compilations de développement.
const TEST_SEED = Buffer.from("gestimarket-cle-de-test-e2e-0001");
async function testLicense(pcId) {
  const der = Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), TEST_SEED]);
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "Ed25519" }, false, ["sign"]);
  const now = Date.now();
  const payload = {
    v: 1, license_id: crypto.randomUUID(), store_code: "GM-DEMO", store_name: "Supérette Le Bon Prix", plan: "business", max_postes: 20,
    features: ["write", "server", "internet", "customer_display", "logo"], pc_id: pcId.replace(/-/g, ""),
    issued_at: new Date(now).toISOString(), starts_at: new Date(now - 3600e3).toISOString(), expires_at: new Date(now + 365 * 86400e3).toISOString(),
  };
  const bytes = Buffer.from(JSON.stringify(payload));
  const sig = Buffer.from(await crypto.subtle.sign({ name: "Ed25519" }, key, bytes));
  return JSON.stringify({ format: "gestimarket-licence", kid: 99, payload: bytes.toString("base64"), sig: sig.toString("base64") });
}

// ───────────── 1. Boutique d'exemple ─────────────
const setup = await rpc("initial_setup", {
  input: {
    shop_name: "Supérette Le Bon Prix", shop_phone: "76 00 00 00", shop_address: "Bamako, Hamdallaye ACI 2000",
    currency_symbol: "FCFA", currency_decimals: 0, full_name: "Awa Traoré", username: "admin", pin: PIN,
  },
});
const admin = setup.token;
const caisse = setup.team.find((m) => m.username === "caisse1");
const lic = await rpc("license_status", {}, admin);
await rpc("license_import", { text: await testLicense(lic.pc_id) }, admin);
await rpc("set_business_type", { ids: ["superette"], id: "superette", features: null, seed: false, pin: PIN }, admin).catch((e) => console.log(e.message));
await rpc("update_settings", {
  values: { om_merchant_number: "70 12 34 56", om_merchant_name: "Le Bon Prix", om_qr_payload: "GESTIMARKET-DEMO-OM-70123456" },
  pin: PIN,
}, admin);

const cats = {};
for (const [name, color] of [["Alimentation", "#16a34a"], ["Boissons", "#0ea5e9"], ["Hygiène", "#a855f7"], ["Maison", "#f59e0b"]]) {
  cats[name] = await rpc("save_category", { id: null, input: { name, color, image_id: null, parent_id: null } }, admin);
}
const produits = [
  ["6130234000012", "Riz parfumé 25 kg", "Alimentation", 15000, 17500, 40, 5, 16500, 5],
  ["6130234000029", "Huile végétale 5 L", "Alimentation", 5200, 6000, 25, 5],
  ["6130234000036", "Sucre en poudre 1 kg", "Alimentation", 600, 750, 80, 10],
  ["6130234000043", "Lait en poudre 400 g", "Alimentation", 2600, 3200, 18, 5],
  ["6130234000050", "Pâtes 500 g", "Alimentation", 400, 550, 60, 10],
  ["6130234000067", "Café soluble 50 g", "Alimentation", 1100, 1500, 30, 5],
  ["6130234000142", "Tomate concentrée 400 g", "Alimentation", 500, 700, 36, 6],
  ["6130234000135", "Thé vert 25 g", "Alimentation", 150, 250, 200, 20],
  ["6130234000128", "Biscuits au chocolat", "Alimentation", 200, 300, 70, 10],
  ["6130234000111", "Lait concentré sucré", "Alimentation", 450, 600, 48, 6],
  ["5449000000996", "Soda cola 33 cl", "Boissons", 300, 500, 96, 24, 450, 24],
  ["6130234000074", "Eau minérale 1,5 L", "Boissons", 250, 400, 120, 24],
  ["6130234000081", "Jus d'orange 1 L", "Boissons", 700, 1000, 24, 6],
  ["6130234000098", "Lessive en poudre 1 kg", "Hygiène", 1300, 1750, 3, 10],
  ["6130234000104", "Dentifrice 75 ml", "Hygiène", 600, 900, 4, 6],
  ["6130234000159", "Bougies (paquet de 6)", "Maison", 600, 800, 2, 5],
];
const ids = {};
for (const [barcode, name, cat, achat, vente, stock, min, gros, grosQte] of produits) {
  const input = {
    barcode, name, description: null, category_id: cats[cat], supplier_id: null, unit: "pièce", purchase_price: achat, sale_price: vente,
    tax_rate: 0, min_stock: min, track_stock: true, active: true, image_id: null, location_id: null, expiry_date: null, brand: null, sku: null,
    initial_stock: stock, ...(gros ? { wholesale_price: gros, wholesale_min_qty: grosQte } : {}),
  };
  const p = await rpc("save_product", { id: null, input, pin: PIN }, admin);
  ids[name] = p.id;
}
const now = new Date();
const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
const fin = new Date(now.getTime() + 10 * 86400e3).toISOString().slice(0, 10);
await rpc("save_promotion", {
  input: { id: null, name: "Promo de la semaine", kind: "percent", value: 10, product_id: ids["Huile végétale 5 L"], category_id: null, starts_on: today, ends_on: fin, active: true },
}, admin);
await rpc("save_customer", { id: null, input: { name: "Moussa Diarra", phone: "76 11 22 33", credit_limit: 50000 } }, admin);
await rpc("plan_generate_layout", {
  input: { floor_id: null, name: "Magasin", width: 14, depth: 10, height: 3.5, entry: "bottom", storage_room: true, activities: ["superette"] },
}, admin).catch((e) => console.log(e.message));

// Ventes de la journée (tableau de bord, rapport de caisse) par la caissière.
const caissiere = (await rpc("login", { username: "caisse1", pin: caisse.pin })).token;
await rpc("open_cash_session", { amount: 25000 }, caissiere);
const paniers = [
  [["Riz parfumé 25 kg", 1], ["Huile végétale 5 L", 1]], [["Soda cola 33 cl", 6], ["Biscuits au chocolat", 4]], [["Sucre en poudre 1 kg", 3], ["Thé vert 25 g", 4]],
  [["Lait en poudre 400 g", 2], ["Café soluble 50 g", 1]], [["Eau minérale 1,5 L", 6]], [["Pâtes 500 g", 5], ["Tomate concentrée 400 g", 3]],
  [["Riz parfumé 25 kg", 2]], [["Jus d'orange 1 L", 3], ["Biscuits au chocolat", 6]], [["Lessive en poudre 1 kg", 1], ["Dentifrice 75 ml", 2]],
  [["Soda cola 33 cl", 24]], [["Lait concentré sucré", 6], ["Sucre en poudre 1 kg", 2]], [["Huile végétale 5 L", 2], ["Riz parfumé 25 kg", 1]],
];
let n = 0;
for (const panier of paniers) {
  const items = panier.map(([nom, q]) => ({ product_id: ids[nom], quantity: q, packaging_id: null }));
  const lignes = await rpc("sale_quote", { items, customer_id: null }, caissiere);
  const total = lignes.reduce((s, l, i) => s + l.unit_price * items[i].quantity, 0);
  const om = n % 3 === 1;
  const payments = om
    ? [{ method: "orange_money", amount: total, reference: `MP2511${String(10 + n).padStart(2, "0")}.1${n}20.C${12345 + n}`, phone: null }]
    : [{ method: "cash", amount: Math.ceil(total / 1000) * 1000 }];
  await rpc("create_sale", { input: { items, customer_id: null, discount: 0, payments, note: null } }, caissiere).catch((e) => console.log("vente :", e.message));
  n++;
}
console.log("boutique d'exemple prête :", Object.keys(ids).length, "produits,", n, "ventes");

// ───────────── 2. Tournage ─────────────
const reperes = [];
let t0 = 0;
const repere = (nom) => {
  const s = (Date.now() - t0) / 1000;
  reperes.push({ nom, s: Math.round(s * 100) / 100 });
  console.log(`repère ${nom} : ${s.toFixed(2)} s`);
};

// Curseur visible (Playwright ne déplace pas le vrai curseur de l'écran virtuel) et onde au clic.
const curseur = `
  addEventListener("DOMContentLoaded", () => {
    const c = document.createElement("div");
    c.id = "demo-curseur";
    c.innerHTML = '<svg width="34" height="34" viewBox="0 0 24 24"><path d="M4 2l15 11.5-6.6 1.2 3.9 6.9-2.9 1.6-3.9-7L4 20z" fill="#0f172a" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    Object.assign(c.style, { position: "fixed", left: "0", top: "0", zIndex: 2147483647, pointerEvents: "none", transform: "translate(-200px,-200px)", filter: "drop-shadow(0 2px 3px rgba(0,0,0,.35))" });
    document.body.appendChild(c);
    addEventListener("mousemove", (e) => { c.style.transform = "translate(" + (e.clientX - 5) + "px," + (e.clientY - 3) + "px)"; }, true);
    addEventListener("mousedown", (e) => {
      const o = document.createElement("div");
      Object.assign(o.style, { position: "fixed", left: e.clientX - 24 + "px", top: e.clientY - 24 + "px", width: "48px", height: "48px", borderRadius: "50%",
        border: "4px solid rgba(20,184,166,.9)", zIndex: 2147483646, pointerEvents: "none", transition: "transform .45s ease-out, opacity .45s ease-out" });
      document.body.appendChild(o);
      requestAnimationFrame(() => { o.style.transform = "scale(1.8)"; o.style.opacity = "0"; });
      setTimeout(() => o.remove(), 500);
    }, true);
  });`;

const ecran = spawn("ffmpeg", ["-y", "-loglevel", "error", "-f", "x11grab", "-video_size", "1920x1080", "-framerate", "30", "-draw_mouse", "0", "-i", `${DISPLAY}.0`,
  "-c:v", "libx264", "-preset", "veryfast", "-crf", "16", "-pix_fmt", "yuv420p", `${OUT}/ecran.mp4`], { stdio: ["pipe", "inherit", "inherit"] });
t0 = Date.now();

const browser = await chromium.launch({
  headless: false,
  env: { ...process.env, DISPLAY },
  // Zoom 150 % : l'interface (1280 x 720 en pixels CSS) reste lisible dans la vidéo 1920 x 1080.
  args: ["--window-position=0,0", "--window-size=1920,1080", "--force-device-scale-factor=1.5", "--hide-scrollbars",
    "--disable-infobars", "--no-first-run", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
const ctx = await browser.newContext({ viewport: null, locale: "fr-FR" });
await ctx.addInitScript({ content: curseur });
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("erreur page :", e.message));
// Vrai plein écran (sans onglets ni barre d'adresse) par le protocole de Chrome.
try {
  const cdp = await ctx.newCDPSession(page);
  const { windowId } = await cdp.send("Browser.getWindowForTarget");
  await cdp.send("Browser.setWindowBounds", { windowId, bounds: { windowState: "fullscreen" } });
} catch (e) {
  console.log("plein écran :", e.message);
}

let souris = { x: 640, y: 360 };
async function aller(x, y, etapes = 24) {
  await page.mouse.move(x, y, { steps: etapes });
  souris = { x, y };
}
async function cliquer(loc, pause = 250) {
  const l = loc.first();
  await l.waitFor({ state: "visible", timeout: 20_000 });
  await l.scrollIntoViewIfNeeded().catch(() => {});
  const b = await l.boundingBox();
  await aller(b.x + b.width / 2, b.y + b.height / 2);
  await sleep(pause);
  await page.mouse.down();
  await sleep(70);
  await page.mouse.up();
}
const capture = (nom) => page.screenshot({ path: `${OUT}/${nom}.png` }).catch(() => {});
async function sequence(nom, fn) {
  repere(nom);
  try {
    await fn();
  } catch (e) {
    console.log(`séquence ${nom} : ${e.message}`);
  }
}

try {
  await page.goto(`${SRV}/#/`);
  await page.locator(".auth-page").waitFor({ timeout: 45_000 });
  await aller(640, 360, 1);
  await sleep(1500);

  await sequence("connexion", async () => {
    await capture("01-connexion");
    await cliquer(page.locator(".user-tile").filter({ hasText: "Caissière 1" }));
    await sleep(700);
    for (const chiffre of caisse.pin) {
      await cliquer(page.locator(".auth-card button").filter({ hasText: new RegExp(`^${chiffre}$`) }), 120);
      await sleep(180);
    }
    await sleep(300);
    await cliquer(page.getByRole("button", { name: "Se connecter" }));
    await page.locator(".auth-page").waitFor({ state: "detached", timeout: 30_000 });
    await sleep(1500);
  });

  await sequence("caisse", async () => {
    if (!page.url().includes("/pos")) {
      const lien = page.locator('a[href="#/pos"]:visible');
      if (await lien.count()) await cliquer(lien);
      else await page.goto(`${SRV}/#/pos`);
    }
    const recherche = page.getByPlaceholder("Scanner un code-barres ou rechercher un produit… (F2)");
    await recherche.waitFor({ timeout: 30_000 });
    await sleep(1500);
    await capture("02-caisse");
    // Douchette : le code arrive d'un coup, suivi d'Entrée.
    repere("scan");
    for (const code of ["6130234000012", "6130234000029"]) {
      await recherche.click();
      await recherche.pressSequentially(code, { delay: 18 });
      await recherche.press("Enter");
      await sleep(1100);
    }
    repere("tuiles");
    await cliquer(page.locator(".product-tile").filter({ hasText: "Soda cola 33 cl" }));
    await sleep(700);
    const ligneSoda = page.locator(".ticket-lines .line").filter({ hasText: "Soda cola 33 cl" });
    for (let i = 0; i < 2; i++) {
      await cliquer(ligneSoda.getByRole("button", { name: "Plus" }), 120);
      await sleep(350);
    }
    await cliquer(page.locator(".product-tile").filter({ hasText: "Sucre en poudre 1 kg" }));
    await sleep(1200);
    await capture("03-ticket");
    repere("encaissement");
    await cliquer(page.locator(".pos-ticket .btn-primary.btn-lg"));
    await sleep(1200);
    repere("orange-money");
    await cliquer(page.locator(".modal button").filter({ hasText: /Orange Money/ }));
    await sleep(1600);
    await capture("04-orange-money");
    repere("reference");
    const ref = page.getByPlaceholder("Ex. MP251031.1542.C12345");
    await ref.pressSequentially("MP251104.1530.C48213", { delay: 55 });
    await sleep(700);
    await cliquer(page.getByRole("button", { name: "Valider la vente (Entrée)" }));
    await page.locator(".sale-done").waitFor({ timeout: 20_000 });
    repere("vente-ok");
    await sleep(2200);
    await capture("05-vente-enregistree");
    await cliquer(page.getByRole("button", { name: "Nouvelle vente" }));
    await sleep(800);
  });

  // Administratrice : tableau de bord et gestion (changement de session hors champ, coupé au montage).
  repere("coupure");
  await page.evaluate((t) => sessionStorage.setItem("gm-token", t), admin);
  await page.goto(`${SRV}/#/dashboard`);
  await page.reload();
  await sleep(2500);

  await sequence("tableau-de-bord", async () => {
    await sleep(3500);
    await capture("06-tableau-de-bord");
    await aller(800, 500);
    repere("tableau-defile");
    for (let k = 0; k < 6; k++) {
      await page.mouse.wheel(0, 90);
      await sleep(120);
    }
    await sleep(2500);
  });

  await sequence("produits", async () => {
    await page.goto(`${SRV}/#/products`);
    await sleep(2800);
    await capture("07-produits");
    repere("stock-bas");
    await cliquer(page.getByText("Stock bas", { exact: true }));
    await sleep(2500);
    await capture("08-produits-stock-bas");
  });

  await sequence("stock", async () => {
    await page.goto(`${SRV}/#/stock`);
    await sleep(3200);
    await capture("09-stock");
  });

  await sequence("promotions", async () => {
    await page.goto(`${SRV}/#/promotions`);
    await sleep(2600);
    await capture("10-promotions");
  });

  await sequence("plan-3d", async () => {
    await page.goto(`${SRV}/#/locations`);
    await page.getByRole("button", { name: "Modifier le plan" }).waitFor({ timeout: 30_000 }).catch(() => {});
    const etage = page.getByRole("button", { name: "Magasin", exact: true });
    if (await etage.count()) {
      await cliquer(etage);
      await sleep(1500);
    }
    repere("plan-vue");
    const vue3d = page.getByRole("button", { name: "3D", exact: true });
    if (await vue3d.count()) {
      await cliquer(vue3d);
      await sleep(3500);
      repere("plan-3d-ok");
      await capture("11-plan-3d");
      await aller(1300, 600);
      await page.mouse.down();
      await aller(900, 620, 60);
      await page.mouse.up();
      await sleep(1500);
      const visite = page.getByRole("button", { name: "Visite", exact: true });
      if (await visite.count()) {
        repere("plan-visite");
        await cliquer(visite);
        await sleep(3500);
        await capture("12-visite");
      }
    } else {
      await sleep(3000);
      await capture("11-plan");
    }
  });

  await sequence("caisse-rapport", async () => {
    await page.goto(`${SRV}/#/cash`);
    await sleep(3000);
    await capture("13-caisse-sessions");
  });

  await sequence("developpeur", async () => {
    await page.goto(`${SRV}/#/settings`);
    await sleep(1500);
    repere("developpeur-onglet");
    await cliquer(page.getByRole("tab", { name: "Développeur Eden Dev" }));
    await sleep(2800);
    await capture("14-developpeur");
  });
  repere("fin");
} catch (e) {
  console.log("tournage :", e.message);
}
await sleep(500);
ecran.stdin.write("q");
await new Promise((r) => ecran.on("close", r));
fs.writeFileSync(`${OUT}/reperes.json`, JSON.stringify(reperes, null, 2));

// ───────────── 3. Téléphone et tablette (captures nettes) ─────────────
const headless = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const android = "Mozilla/5.0 (Linux; Android 14; SM-A546B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36";
for (const [nom, token, chemin, vue] of [
  ["20-telephone-caisse", caissiere, "/#/pos", { width: 390, height: 844 }],
  ["21-telephone-tableau", admin, "/#/dashboard", { width: 390, height: 844 }],
  ["22-tablette-caisse", caissiere, "/#/pos", { width: 820, height: 1180 }],
]) {
  const c = await headless.newContext({ viewport: vue, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: android, locale: "fr-FR" });
  await c.addInitScript((t) => sessionStorage.setItem("gm-token", t), token);
  const p = await c.newPage();
  await p.goto(`${SRV}${chemin}`);
  await p.waitForTimeout(4000);
  await p.screenshot({ path: `${OUT}/${nom}.png` });
  await c.close();
}
await headless.close();
await browser.close();
console.log("tournage terminé", reperes.length, "repères");
