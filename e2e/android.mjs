// Application GestiMarket pour Android (Tauri), essayée dans un émulateur Android sur GitHub Actions.
// Playwright se branche sur la page de l'application (WebView de la compilation debug) :
// première configuration et licence de test, produit et vente dans la base SQLite du téléphone,
// pages de l'administrateur à la largeur du téléphone, téléphone « Serveur de la boutique » (serveur joint
// depuis le PC de GitHub par adb forward, service permanent, recherche des boutiques sur le réseau),
// liaison à un poste serveur (faux, sur le PC de GitHub) et imprimante à tickets réseau (fausse, port 9100).
// L'émulateur voit le PC de GitHub à l'adresse 10.0.2.2.
//   node e2e/android.mjs   (APK déjà installé : adb install)
import fs from "node:fs";
import { execFileSync } from "node:child_process";
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
const t0 = Date.now();
// Avancement écrit au fur et à mesure (publié même si le scénario reste bloqué).
function step(label) {
  const line = `${((Date.now() - t0) / 1000).toFixed(0).padStart(4)} s  ${label}`;
  console.log(`[android] ${line}`);
  fs.appendFileSync(`${OUT}/progress.txt`, line + "\n");
}
function check(name, ok, detail = "") {
  checks.push({ name, ok: !!ok, detail: String(detail) });
  console.log(`${ok ? "OK  " : "ÉCHEC"} ${name}${detail ? ` — ${detail}` : ""}`);
  step(`${ok ? "OK" : "ÉCHEC"} ${name}`);
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
let finished = false;
function finish() {
  if (finished) return;
  finished = true;
  fs.writeFileSync(`${OUT}/results.json`, JSON.stringify({ checks, report }, null, 2));
  const failed = checks.filter((c) => !c.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} vérifications réussies sur Android`);
  for (const f of failed) console.log(`::error title=Android : ${f.name.replace(/[:,]/g, " ")}::${(f.detail || "échec").replace(/\r?\n/g, " ").slice(0, 900)}`);
}
// Garde-fou : le scénario ne bloque jamais le job (12 minutes au plus).
setTimeout(async () => {
  check("scénario Android terminé en moins de 12 minutes", false, "bloqué : voir progress.txt");
  if (device) await device.screenshot({ path: `${OUT}/a-bloque.png` }).catch(() => {});
  finish();
  process.exit(1);
}, 12 * 60_000).unref();
try {
  step("recherche de l'émulateur");
  [device] = await _android.devices();
  check("émulateur Android trouvé", !!device, device ? `${device.model()} (${device.serial()})` : "aucun");
  await device.shell(`am force-stop ${PKG}`);
  step("lancement de l'application");
  await device.shell(`monkey -p ${PKG} -c android.intent.category.LAUNCHER 1`);
  await sleep(5000);
  await device.screenshot({ path: `${OUT}/a-00-lancement.png` }).catch(() => {});
  step("attente de la page de l'application (WebView)");
  const webview = await device.webView({ pkg: PKG }, { timeout: 180_000 });
  step("WebView trouvée");
  // L'application tient-elle ? (processus vivant, écran) : une capture toutes les 5 s pendant 30 s.
  const alive = async () => String(await device.shell(`pidof ${PKG}`).catch(() => "")).trim();
  for (let i = 1; i <= 6; i++) {
    await sleep(5000);
    const pid = await alive();
    step(`après ${i * 5} s : processus ${pid || "ARRÊTÉ"}`);
    await device.screenshot({ path: `${OUT}/a-00-${String(i * 5).padStart(2, "0")}s.png` }).catch(() => {});
    if (!pid) {
      fs.writeFileSync(`${OUT}/crash.txt`, String(await device.shell("logcat -d -b crash").catch(() => "")));
      throw new Error("l'application s'est fermée juste après son lancement (voir crash.txt et logcat.txt)");
    }
  }
  const page = await Promise.race([
    webview.page(),
    sleep(60_000).then(() => {
      throw new Error("la page de l'application ne répond pas (60 s)");
    }),
  ]);
  page.setDefaultTimeout(30_000);
  step("page de l'application ouverte");
  const errors = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text().slice(0, 300)));
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 300)));
  await page.waitForLoadState("domcontentloaded");
  await page.waitForFunction(() => !!document.querySelector("#root > *"), null, { timeout: 90_000 }).catch(() => {});
  await sleep(3000);
  await device.screenshot({ path: `${OUT}/a-01-premier-lancement.png` });

  // Appel Tauri depuis la page, avec délai : une application bloquée ne fige pas le scénario.
  const invoke = (cmd, args = {}) =>
    Promise.race([
      page.evaluate(([c, a]) => window.__TAURI_INTERNALS__.invoke(c, a), [cmd, args]),
      sleep(60_000).then(async () => {
        throw new Error(`« ${cmd} » sans réponse depuis 60 s (processus ${(await alive()) || "arrêté"})`);
      }),
    ]);
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

  // Premier démarrage : boutique sur ce téléphone, rejoindre, espace propriétaire, ou restaurer une sauvegarde.
  const choices = await page.locator(".start-choice").allInnerTexts().catch(() => []);
  check(
    "premier démarrage : « Ma boutique sur ce téléphone », « Rejoindre une boutique », « Espace propriétaire », « J'ai une sauvegarde »",
    choices.length === 4 &&
      choices.some((t) => t.includes("Ma boutique sur ce téléphone")) &&
      choices.some((t) => t.includes("Espace propriétaire")) &&
      choices.some((t) => t.includes("J'ai une sauvegarde")),
    choices.map((t) => t.split(/\r?\n/)[0]).join(", "),
  );
  await shot("a-01b-choix-du-demarrage.png");

  // « Ma boutique sur ce téléphone » : d'abord les conditions d'utilisation, à accepter pour continuer.
  try {
    await page.locator(".start-choice", { hasText: "Ma boutique sur ce téléphone" }).click();
    const accept = page.getByRole("button", { name: "Accepter et continuer" });
    await accept.waitFor({ timeout: 20_000 });
    const before = await accept.isDisabled();
    await page.locator(".terms-check input").check();
    const after = await accept.isEnabled();
    const docs = await page.locator(".terms-doc").count();
    check("premier démarrage : conditions d'utilisation, licence et données à accepter (bouton bloqué sans la case)", before && after && docs === 3, `${docs} textes`);
    await shot("a-01c-conditions-d-utilisation.png");
  } catch (e) {
    check("premier démarrage : conditions d'utilisation, licence et données à accepter (bouton bloqué sans la case)", false, e.message);
  }

  let team = [];
  if (await rpc("needs_setup")) {
    const r = await rpc("initial_setup", {
      input: {
        shop_name: "Boutique Android", shop_phone: null, shop_address: "Bamako", currency_symbol: "FCFA", currency_decimals: 0, full_name: "Admin Android", username: "admin", pin: PIN,
        terms_version: (await rpc("terms_status"))?.current,
      },
    });
    team = r?.team ?? [];
  }
  const lic = await rpc("license_status");
  check("identifiant de l'appareil pour la licence", /^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/.test(lic.pc_id), lic.pc_id);
  check("téléphone sans Internet : essai gratuit de 14 jours dès la configuration", lic.phase === "trial" && !lic.read_only, `${lic.phase} ${lic.days_left} j`);
  await rpc("license_import", { text: await testLicense(lic.pc_id) });
  const coca = await rpc("save_product", { id: null, input: { name: "Coca-Cola 33 cl", purchase_price: 300, sale_price: 500, initial_stock: 48 } });
  check("base SQLite du téléphone : produit créé avec un code-barres", coca?.id > 0 && !!coca?.barcode, coca?.barcode);
  // Seule une caissière encaisse : connexion de la caissière de l'équipe par défaut, vente, puis retour à l'administrateur.
  const caisse = team.find((m) => m.role === "cashier");
  check("équipe par défaut : une caissière avec son PIN", !!caisse?.pin, team.map((m) => m.username).join(", "));
  if (caisse) await rpc("login", { username: caisse.username, pin: caisse.pin });
  await rpc("open_cash_session", { amount: 0 }).catch(() => null);
  const sale = await rpc("create_sale", {
    input: {
      items: [{ product_id: coca.id, quantity: 2, discount: 0, packaging_id: null }],
      customer_id: null, discount: 0, payments: [{ method: "cash", amount: 1000, reference: null, phone: null }], note: null,
    },
  }).then((v) => v, (e) => ({ error: String(e) }));
  check("vente enregistrée sur le téléphone (2 × 500 = 1 000)", sale?.total === 1000, sale?.error ?? sale?.total);
  await rpc("login", { username: "admin", pin: PIN });
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

  // ── Poste & réseau : serveur de la boutique (Android), poste client, poste unique ; pas de « plusieurs boutiques »
  await go("#/poste");
  const modes = await page.locator(".mode-card").allInnerTexts();
  const titles = modes.map((t) => t.split("\n")[0].trim());
  check("mode réseau : serveur de la boutique, poste client et poste unique proposés", titles.length === 3 && titles.includes("Serveur de la boutique"), titles.join(", "));

  // ── Poste client : test de connexion au poste serveur du Wi-Fi (http, adresse IP)
  await page.locator(".mode-card").filter({ hasText: "Poste client" }).first().click();
  await page.locator(".network-form input[placeholder='192.168.1.10:7878']").fill("10.0.2.2:7979");
  await page.locator(".network-form button").filter({ hasText: "Tester" }).first().click();
  const linked = await page.locator(".network-form .alert-success").filter({ hasText: "Boutique du serveur" }).first().waitFor({ timeout: 15_000 }).then(() => true, () => false);
  check("poste client : le téléphone joint un poste serveur en http sur le réseau", linked);
  await shot("a-poste-client.png");
  await page.locator(".mode-card").filter({ hasText: "Poste unique" }).first().click();

  // ── Téléphone serveur : sans PC, la TV et les autres caisses se relient à ce téléphone.
  const asServer = await invoke("save_network_config", { config: { ...info.config, mode: "server" }, pin: PIN }).then(() => "ok", (e) => String(e));
  check("téléphone serveur : mode serveur accepté sur Android", asServer === "ok", asServer);
  await sleep(2500);
  try {
    execFileSync("adb", ["forward", "tcp:7990", "tcp:7878"]);
  } catch (e) {
    report.push({ label: "adb forward", error: String(e) });
  }
  const pinged = await fetch("http://127.0.0.1:7990/api/ping").then((r) => r.json(), (e) => ({ error: String(e) }));
  check("téléphone serveur : répond sur le réseau (port 7878)", pinged.app === "GestiMarket" && pinged.device === "phone", JSON.stringify(pinged));
  const seen = await invoke("discover_servers").then((l) => l, (e) => String(e));
  check(
    "téléphone serveur : trouvé par la recherche des boutiques sur le réseau",
    Array.isArray(seen) && seen.some((x) => x.shop_name === pinged.shop_name),
    JSON.stringify(seen).slice(0, 300),
  );
  // Service permanent (notification) : le serveur continue écran verrouillé.
  await page.evaluate(() => window.GestiMarketAndroid?.startServer());
  await sleep(2500);
  const services = String(await device.shell(`dumpsys activity services ${PKG}`).catch(() => ""));
  check("téléphone serveur : service permanent démarré", services.includes("GestiServerService"), services.slice(0, 200));
  check("application toujours ouverte après le démarrage du service", !!String(await device.shell(`pidof ${PKG}`).catch(() => "")).trim());
  await shot("a-telephone-serveur.png");
  await page.evaluate(() => window.GestiMarketAndroid?.stopServer());
  const back = await invoke("save_network_config", { config: { ...info.config, mode: "local" }, pin: PIN }).then(() => "ok", (e) => String(e));
  await sleep(1500);
  const stopped = await fetch("http://127.0.0.1:7990/api/ping").then(() => false, () => true);
  check("téléphone serveur : arrêté en repassant en poste unique", back === "ok" && stopped, back);

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
  // Champ de recherche actif : le 1er appui sur retour irait au clavier (comportement normal d'Android).
  await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
  await sleep(1000);
  // Jusqu'à 2 appuis (le 1er peut fermer le clavier), en laissant au téléphone le temps de changer de page.
  let after = "";
  let presses = 0;
  for (; presses < 2 && !after.startsWith("#/dashboard"); presses++) {
    await device.shell("input keyevent KEYCODE_BACK");
    for (let i = 0; i < 16; i++) {
      await sleep(500);
      after = await page.evaluate(() => location.hash).catch(() => "(application fermée)");
      if (after.startsWith("#/dashboard") || after.startsWith("(")) break;
    }
  }
  report.push({ label: "retour arrière Android", hash: after, presses });
  const stillOpen = !!String(await device.shell(`pidof ${PKG}`).catch(() => "")).trim();
  check("bouton retour d'Android : page précédente, application toujours ouverte", after.startsWith("#/dashboard") && stillOpen, `${after} ; ${presses} appui(s) ; ${stillOpen ? "ouverte" : "fermée"}`);
  await shot("a-retour-arriere.png");

  check("aucune erreur JavaScript pendant la visite", errors.length === 0, errors.slice(0, 3).join(" | "));
  exitCode = checks.every((c) => c.ok) ? 0 : 1;
} catch (e) {
  check("scénario Android terminé", false, e?.stack ?? String(e));
  if (device) await device.screenshot({ path: `${OUT}/a-erreur.png` }).catch(() => {});
} finally {
  finish();
  await device?.close().catch(() => {});
  printer.close();
  server.close();
  process.exit(exitCode);
}
