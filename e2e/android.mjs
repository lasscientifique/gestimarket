// Application GestiMarket pour Android (Tauri), essayée dans un émulateur Android sur GitHub Actions.
// Playwright se branche sur la page de l'application (WebView de la compilation debug) :
// première configuration et licence de test, produit et vente dans la base SQLite du téléphone,
// pages de l'administrateur à la largeur du téléphone, mode réseau sans « Poste serveur »,
// liaison à un poste serveur (faux, sur le PC de GitHub) et imprimante à tickets réseau (fausse, port 9100).
// L'émulateur voit le PC de GitHub à l'adresse 10.0.2.2.
//   node e2e/android.mjs   (APK déjà installé : adb install)
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import { _android } from "playwright";
import { measure, problems } from "./mobile.mjs";

const OUT = "e2e/out-android";
const PKG = "com.gestimarket.app";
const PIN = "135792";
fs.mkdirSync(OUT, { recursive: true });

const checks = [];
const report = [];
function check(name, ok, detail = "") {
  checks.push({ name, ok: !!ok, detail: String(detail) });
  console.log(`${ok ? "OK  " : "ÉCHEC"} ${name}${detail ? ` — ${detail}` : ""}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Licence BUSINESS signée avec la clé de test (acceptée par les compilations debug seulement).
const TEST_SEED = Buffer.from("gestimarket-cle-de-test-e2e-0001");
async function testLicense(pcId) {
  const der = Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), TEST_SEED]);
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "Ed25519" }, false, ["sign"]);
  const now = Date.now();
  const payload = {
    v: 1, license_id: crypto.randomUUID(), store_code: "GM-E2E", store_name: "Eden Superrette", plan: "business", max_postes: 20,
    features: ["write", "server", "internet", "customer_display", "logo"], pc_id: pcId.replace(/-/g, ""),
    issued_at: new Date(now).toISOString(), starts_at: new Date(now - 3600e3).toISOString(), expires_at: new Date(now + 30 * 86400e3).toISOString(),
  };
  const bytes = Buffer.from(JSON.stringify(payload));
  const sig = Buffer.from(await crypto.subtle.sign({ name: "Ed25519" }, key, bytes));
  return JSON.stringify({ format: "gestimarket-licence", kid: 99, payload: bytes.toString("base64"), sig: sig.toString("base64") }, null, 2);
}

// Fausse imprimante à tickets réseau (ESC/POS brut sur le port 9100).
const printed = [];
const printer = net.createServer((s) => {
  const chunks = [];
  s.on("data", (c) => chunks.push(c));
  s.on("end", () => printed.push(Buffer.concat(chunks)));
});
await new Promise((r) => printer.listen(9100, "0.0.0.0", r));

// Faux poste serveur : répond au test de connexion d'un poste client (CORS comme le vrai serveur).
const server = http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify({ app: "GestiMarket", shop_name: "Boutique du serveur", version: "test" }));
});
await new Promise((r) => server.listen(7979, "0.0.0.0", r));

let device;
let exitCode = 1;
try {
  [device] = await _android.devices();
  check("émulateur Android trouvé", !!device, device ? `${device.model()} (${device.serial()})` : "aucun");
  await device.shell(`am force-stop ${PKG}`);
  await device.shell(`monkey -p ${PKG} -c android.intent.category.LAUNCHER 1`);
  const webview = await device.webView({ pkg: PKG }, { timeout: 180_000 });
  const page = await webview.page();
  const errors = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text().slice(0, 300)));
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 300)));
  await page.waitForLoadState("domcontentloaded");
  await page.waitForFunction(() => !!document.querySelector("#root > *"), null, { timeout: 90_000 }).catch(() => {});
  await sleep(3000);
  await device.screenshot({ path: `${OUT}/a-01-premier-lancement.png` });

  const invoke = (cmd, args = {}) => page.evaluate(([c, a]) => window.__TAURI_INTERNALS__.invoke(c, a), [cmd, args]);
  const rpc = (cmd, args = {}) => invoke("rpc", { cmd, args });
  const settle = async (ms = 1500) => {
    await page.waitForLoadState("networkidle", { timeout: 6000 }).catch(() => {});
    await sleep(ms);
  };
  const go = async (hash) => {
    await page.evaluate((h) => (location.hash = h), hash);
    await settle();
  };
  const shot = (file) => device.screenshot({ path: `${OUT}/${file}` });

  // ── Le cœur Rust tourne sur le téléphone
  const info = await invoke("get_network_config");
  check("application Android : système « android »", info.os === "android", info.os);
  check("application Android : mode poste unique au premier lancement", info.config.mode === "local", info.config.mode);
  check("interface : application installée reconnue (pas de WebView FlutterFlow)", await page.evaluate(() => "__TAURI_INTERNALS__" in window && /Android/.test(navigator.userAgent)));

  if (await rpc("needs_setup")) {
    await rpc("initial_setup", {
      input: { shop_name: "Boutique Android", shop_phone: null, shop_address: "Bamako", currency_symbol: "FCFA", currency_decimals: 0, full_name: "Admin Android", username: "admin", pin: PIN },
    });
  }
  const lic = await rpc("license_status");
  check("identifiant de l'appareil pour la licence", /^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/.test(lic.pc_id), lic.pc_id);
  await rpc("license_import", { text: await testLicense(lic.pc_id) });
  const coca = await rpc("save_product", { id: null, input: { name: "Coca-Cola 33 cl", purchase_price: 300, sale_price: 500, initial_stock: 48 } });
  check("base SQLite du téléphone : produit créé avec un code-barres", coca?.id > 0 && !!coca?.barcode, coca?.barcode);
  await rpc("open_cash_session", { amount: 0 }).catch(() => null);
  const sale = await rpc("create_sale", {
    input: {
      items: [{ product_id: coca.id, quantity: 2, discount: 0, packaging_id: null }],
      customer_id: null, discount: 0, payments: [{ method: "cash", amount: 1000, reference: null, phone: null }], note: null,
    },
  }).then((v) => v, (e) => ({ error: String(e) }));
  check("vente enregistrée sur le téléphone (2 × 500 = 1 000)", sale?.total === 1000, sale?.error ?? sale?.total);
  const stock = (await rpc("get_product", { id: coca.id })).stock;
  check("stock du téléphone décompté (48 → 46)", stock === 46, stock);

  // ── Interface : pages de l'administrateur à la largeur du téléphone
  await page.reload();
  await settle(3000);
  await shot("a-02-tableau-de-bord.png");
  for (const r of ["dashboard", "pos", "products", "sales", "stock", "customers", "reports", "poste", "settings"]) {
    await go(`#/${r}`);
    const m = await page.evaluate(measure, { covered: "top" });
    m.label = `page ${r}`;
    m.errors = errors.splice(0);
    report.push(m);
    const p = problems(m);
    check(`Android : page ${r} à la largeur de l'écran`, p.length === 0, p.join(" | "));
    await shot(`a-page-${r}.png`);
  }

  // ── Poste & réseau : poste client ou poste unique, jamais serveur ; pas de « plusieurs boutiques »
  await go("#/poste");
  const modes = await page.locator(".mode-card").allInnerTexts();
  check("mode réseau : poste client et poste unique proposés, pas de poste serveur", modes.length === 2 && !modes.some((t) => /serveur/i.test(t)), modes.map((t) => t.split("\n")[0]).join(", "));
  const refused = await invoke("save_network_config", { config: { ...info.config, mode: "server" }, pin: PIN }).then(() => "accepté", (e) => String(e));
  check("mode serveur refusé par Rust sur le téléphone", refused.includes("poste serveur"), refused);

  // ── Poste client : test de connexion au poste serveur du Wi-Fi (http, adresse IP)
  await page.locator(".mode-card").filter({ hasText: "Poste client" }).first().click();
  await page.locator(".network-form input[placeholder='192.168.1.10:7878']").fill("10.0.2.2:7979");
  await page.locator(".network-form button").filter({ hasText: "Tester" }).first().click();
  const linked = await page.locator(".network-form .alert-success").filter({ hasText: "Boutique du serveur" }).first().waitFor({ timeout: 15_000 }).then(() => true, () => false);
  check("poste client : le téléphone joint un poste serveur en http sur le réseau", linked);
  await shot("a-poste-client.png");
  await page.locator(".mode-card").filter({ hasText: "Poste unique" }).first().click();

  // ── Imprimante à tickets réseau : page de test reçue par la fausse imprimante
  await go("#/settings");
  await page.locator(".tabbar .tab-item").filter({ hasText: "Ventes" }).first().click();
  await settle(800);
  const ip = page.locator("input[placeholder='192.168.1.50']");
  check("imprimante : adresse IP demandée (pas de pilote sur téléphone)", (await ip.count()) === 1);
  await ip.fill("10.0.2.2:9100");
  await page.getByRole("button", { name: "Imprimer une page de test" }).click();
  for (let i = 0; i < 20 && printed.length === 0; i++) await sleep(500);
  const ticket = printed[0] ?? Buffer.alloc(0);
  check("imprimante réseau : page de test reçue (ESC/POS)", ticket.length > 20 && ticket[0] === 0x1b, `${ticket.length} octet(s)`);
  await shot("a-imprimante-reseau.png");

  // ── Sauvegarde : bouton « Enregistrer une copie… », pas de dossier à choisir
  await page.locator(".tabbar .tab-item").filter({ hasText: "Sauvegarde" }).first().click();
  await settle(800);
  const copyBtn = await page.getByRole("button", { name: "Enregistrer une copie…" }).count();
  const chooseBtn = await page.getByRole("button", { name: "Choisir" }).count();
  check("sauvegarde : « Enregistrer une copie… » proposé, sans choix de dossier", copyBtn === 1 && chooseBtn === 0, `${copyBtn} / ${chooseBtn}`);
  await shot("a-sauvegarde.png");

  // ── Retour arrière d'Android : revient à la page précédente sans fermer l'application
  await go("#/dashboard");
  await go("#/products");
  await device.shell("input keyevent KEYCODE_BACK");
  await sleep(1500);
  const after = await page.evaluate(() => location.hash).catch(() => "(application fermée)");
  console.log(`[android] retour arrière : ${after}`);
  report.push({ label: "retour arrière Android", hash: after });

  check("aucune erreur JavaScript pendant la visite", errors.length === 0, errors.slice(0, 3).join(" | "));
  exitCode = checks.every((c) => c.ok) ? 0 : 1;
} catch (e) {
  check("scénario Android terminé", false, e?.stack ?? String(e));
  if (device) await device.screenshot({ path: `${OUT}/a-erreur.png` }).catch(() => {});
} finally {
  fs.writeFileSync(`${OUT}/results.json`, JSON.stringify({ checks, report }, null, 2));
  const failed = checks.filter((c) => !c.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} vérifications réussies sur Android`);
  for (const f of failed) console.log(`::error title=Android : ${f.name.replace(/[:,]/g, " ")}::${(f.detail || "échec").replace(/\r?\n/g, " ").slice(0, 900)}`);
  await device?.close().catch(() => {});
  printer.close();
  server.close();
  process.exit(exitCode);
}
