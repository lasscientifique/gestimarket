// Test d'interface de bout en bout (CI Linux, Xvfb) : route « Réseau local » / « Internet ».
//
// Prérequis : GestiMarket lancé en mode serveur sur :7878 (voir .github/workflows/build.yml, job e2e).
// Le script lance lui-même le faux tunnel Cloudflare (:8080) et la fausse API Supabase (:54321),
// configure le commerce par RPC, puis pilote quatre appareils avec Playwright :
//   - PC navigateur sur le réseau local          http://127.0.0.1:7878
//   - tablette sur le réseau local (IP du LAN)   http://<LAN_IP>:7878
//   - téléphone 390 px par Internet (tunnel)     http://127.0.0.1:8080
//   - écran du poste serveur (interface réelle, pont Tauri simulé pour l'affichage dans Chromium)
// Résultats : e2e/out/*.png et e2e/out/results.json ; code de sortie 1 si une vérification échoue.
import { spawn } from "node:child_process";
import fs from "node:fs";
import { chromium } from "playwright";
import { phoneTour } from "./mobile.mjs";

const SRV = "http://127.0.0.1:7878";
const PUB = "http://127.0.0.1:8080";
const LAN = process.env.LAN_IP ? `http://${process.env.LAN_IP}:7878` : SRV;
const OUT = "e2e/out";
// Code PIN de l'administrateur (6 chiffres) : identifiant + PIN, plus de mot de passe.
const PIN = "135792";
fs.mkdirSync(OUT, { recursive: true });

const checks = [];
function check(name, ok, detail = "") {
  checks.push({ name, ok: !!ok, detail: String(detail) });
  console.log(`${ok ? "OK  " : "ÉCHEC"} ${name}${detail ? ` — ${detail}` : ""}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function rpc(cmd, args = {}, token = null, base = SRV) {
  const r = await fetch(`${base}/rpc/${cmd}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(args),
  });
  const d = await r.json();
  if (d.error) throw new Error(`${cmd} : ${d.error}`);
  return d.ok;
}

// Licence signée avec la clé de test (kid 99), reconnue seulement par les compilations de développement.
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

function startMock(kind) {
  const p = spawn(process.execPath, ["e2e/mocks.mjs", kind], { stdio: "inherit" });
  return p;
}
// Attend qu'une adresse réponde (anyStatus : n'importe quel code HTTP suffit).
async function waitUp(url, tries = 30, anyStatus = false) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url);
      if (r.ok || anyStatus) return true;
    } catch {}
    await sleep(500);
  }
  return false;
}

// Affiche l'interface réelle du poste serveur dans Chromium : le pont Tauri est simulé et renvoie
// les appels « rpc » vers le serveur HTTP (mêmes commandes et mêmes droits que dans l'application).
const tauriBridge = (lanIp) => `
  window.__TAURI_INTERNALS__ = {
    invoke: async (cmd, args) => {
      if (cmd === "get_network_config")
        return { config: { mode: "server", poste_name: "Caisse 1", port: 7878, server_url: "" }, local_ips: [${JSON.stringify(lanIp)}], hostname: "PC-SERVEUR", os: "windows" };
      if (cmd === "rpc") {
        const t = sessionStorage.getItem("gm-token");
        const r = await fetch("/rpc/" + args.cmd, { method: "POST", headers: { "Content-Type": "application/json", ...(t ? { Authorization: "Bearer " + t } : {}) }, body: JSON.stringify(args.args || {}) });
        const d = await r.json();
        if (d.error) throw d.error;
        return d.ok;
      }
      if (cmd === "list_monitors") return [];
      // Imprimante à tickets de ce poste (0.16) : une imprimante simulée ; les tickets envoyés sont gardés.
      if (cmd === "printer_list") return ["XP-80C (test)"];
      if (cmd === "printer_get_config") return window.__printerConfig ?? { printer: "", auto_print: true, open_drawer: false };
      if (cmd === "printer_save_config") { window.__printerConfig = args.config; return null; }
      if (cmd === "printer_send") { (window.__printed = window.__printed || []).push(args.data); return null; }
      if (cmd === "journal_text") return "2026-11-04 08:00:00 [INFO] Démarrage de GestiMarket";
      if (cmd === "journal_export") return "/home/runner/Documents/GestiMarket/journal-gestimarket-test.txt";
      throw "Commande non disponible dans le test : " + cmd;
    },
    transformCallback: (cb) => { const id = Math.floor(Math.random() * 1e9); window["_" + id] = cb; return id; },
    convertFileSrc: (p) => p,
  };`;

async function device(browser, { name, url, token, viewport, userAgent, mobile, bridge }) {
  const ctx = await browser.newContext({ viewport, userAgent, isMobile: !!mobile, hasTouch: !!mobile, locale: "fr-FR" });
  await ctx.addInitScript((t) => sessionStorage.setItem("gm-token", t), token);
  if (bridge) await ctx.addInitScript({ content: bridge });
  const page = await ctx.newPage();
  page.on("console", (m) => m.type() === "error" && console.log(`[${name}] console : ${m.text()}`));
  page.on("pageerror", (e) => console.log(`[${name}] erreur : ${e.message}`));
  await page.goto(`${url}/#/poste`);
  return page;
}

async function seen(page, label, text, timeout = 45_000) {
  try {
    // Seulement les éléments visibles : la pastille existe en deux exemplaires (menu et barre mobile).
    await page.locator(`:text("${text}"):visible`).first().waitFor({ state: "visible", timeout });
    check(`${label} : « ${text} »`, true);
    return true;
  } catch {
    check(`${label} : « ${text} »`, false, "texte absent");
    return false;
  }
}

// Pastille de connexion visible avec la bonne route (data-route posé par ConnChip).
async function chip(page, label, route, timeout = 45_000) {
  try {
    await page.locator(`.conn-chip.ok[data-route="${route}"]:visible`).first().waitFor({ state: "visible", timeout });
    check(`${label} : pastille « ${route === "internet" ? "Internet" : "Réseau local"} »`, true);
  } catch {
    check(`${label} : pastille « ${route === "internet" ? "Internet" : "Réseau local"} »`, false, "pastille absente ou mauvaise route");
  }
}

async function shot(page, file) {
  await page.screenshot({ path: `${OUT}/${file}`, fullPage: true });
}

const supabase = startMock("supabase");
let tunnel = startMock("tunnel");
let browser;
try {
  check("faux Supabase démarré", await waitUp("http://127.0.0.1:54321/", 30, true));
  check("faux tunnel démarré (ping via :8080)", await waitUp(`${PUB}/api/ping`));

  // ── Première configuration et compte administrateur (par RPC, comme l'écran « Première configuration »)
  // Sans licence (FREE) : 1 seul poste. On garde la session de la configuration jusqu'à l'installation de la licence.
  // Équipe par défaut créée avec la boutique : un gestionnaire et une caissière, PIN tirés au hasard.
  let setupToken = null;
  let team = [];
  if (await rpc("needs_setup")) {
    const r = await rpc("initial_setup", {
      input: { shop_name: "Eden Superrette", shop_phone: null, shop_address: "Bamako", currency_symbol: "FCFA", currency_decimals: 0, full_name: "Admin E2E", username: "admin", pin: PIN },
    });
    setupToken = r.token;
    team = r.team;
  }
  check(
    "équipe par défaut : gestionnaire et caissière avec identifiant et PIN",
    team.map((m) => `${m.role}:${m.username}`).join(",") === "manager:gestionnaire,cashier:caisse1" && team.every((m) => /^\d{4}$/.test(m.pin)),
    JSON.stringify(team.map((m) => m.username)),
  );
  const login = async () => (await rpc("login", { username: "admin", pin: PIN })).token;
  const admin = setupToken ?? (await login());
  const oldPassword = await rpc("login_password", { username: "admin", password: "secret123" }).then(() => "acceptée", (e) => e.message);
  check("plus de mot de passe : connexion par identifiant et code PIN", oldPassword.includes("PIN"), oldPassword);
  const second = await rpc("login", { username: "admin", pin: PIN }).then(() => "acceptée", (e) => e.message);
  check("sans licence : une 2ᵉ session est refusée (FREE, 1 poste)", second.includes("Nombre maximal"), second);

  // ── Licence : sans licence, lecture seule ; licence BUSINESS signée avec la clé de test (compilation debug)
  const before = await rpc("save_category", { id: null, input: { name: "Essai lecture seule" } }, admin).then(() => "accepté", (e) => e.message);
  check("sans licence : écriture refusée (lecture seule)", before.includes("Lecture seule"), before);
  const lic = await rpc("license_status", {}, admin);
  check("identifiant du PC affiché", /^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/.test(lic.pc_id), lic.pc_id);
  const installed = await rpc("license_import", { text: await testLicense(lic.pc_id) }, admin);
  check("licence de test installée (BUSINESS, écriture permise)", installed.plan === "business" && !installed.read_only, `${installed.plan} ${installed.message}`);
  const tampered = JSON.parse(await testLicense(lic.pc_id));
  const badSig = Buffer.from(tampered.sig, "base64");
  badSig[0] ^= 1;
  tampered.sig = badSig.toString("base64");
  const forged = await rpc("license_import", { text: JSON.stringify(tampered) }, admin).then(() => "acceptée", (e) => e.message);
  check("licence falsifiée refusée", /Signature|illisible/.test(forged), forged);
  // Paiement de l'abonnement : uniquement sur le PC serveur, jamais depuis un appareil du réseau.
  const remotePay = await rpc("account_redeem_voucher", { code: "AAAA-BBBB-CCCC-DDDD" }, admin).then(() => "accepté", (e) => e.message);
  check("carte de bon refusée depuis un appareil du réseau", remotePay.includes("PC serveur"), remotePay);

  await rpc("update_settings", {
    values: { supabase_enabled: "1", supabase_url: "http://127.0.0.1:54321", supabase_key: "cle-publique-test", public_url: PUB },
    pin: PIN,
  }, admin);
  let cloud = await rpc("cloud_publish_now", {}, admin);
  check("publication Supabase réussie", !!cloud.last_ok_at && !cloud.last_error, cloud.last_error ?? "");
  check("adresse publique testée par le serveur : disponible", cloud.public_ok === true, JSON.stringify({ ok: cloud.public_ok, ms: cloud.public_ms, err: cloud.public_error }));

  // ── Appareils
  // WebGL logiciel (SwiftShader) : la vue 3D du plan s'affiche sans carte graphique.
  browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
  const android = "Mozilla/5.0 (Linux; Android 14; SM-A546B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36";
  const tabletUa = "Mozilla/5.0 (Linux; Android 14; SM-X210) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36";
  const pc = await device(browser, { name: "pc", url: SRV, token: await login(), viewport: { width: 1366, height: 850 } });
  const tablet = await device(browser, { name: "tablette", url: LAN, token: await login(), viewport: { width: 820, height: 1180 }, userAgent: tabletUa, mobile: true });
  const phone = await device(browser, { name: "téléphone", url: PUB, token: await login(), viewport: { width: 390, height: 844 }, userAgent: android, mobile: true });
  const server = await device(browser, { name: "serveur", url: SRV, token: await login(), viewport: { width: 1366, height: 1000 }, bridge: tauriBridge(process.env.LAN_IP ?? "127.0.0.1") });

  await seen(pc, "PC (réseau local)", "Synchronisé · Réseau local");
  await seen(tablet, "Tablette (réseau local)", "Synchronisé · Réseau local");
  await chip(phone, "Téléphone (Internet)", "internet");
  await chip(pc, "PC (réseau local)", "local");
  await seen(phone, "Téléphone (Internet)", "Hors du réseau du magasin");
  await seen(server, "Poste serveur", "Réseau local disponible");
  await seen(server, "Poste serveur", "Internet disponible");
  await seen(server, "Poste serveur", "Les deux routes sont actives");
  await seen(server, "Poste serveur, liste des appareils", "41.73.10.20");

  // Le serveur voit bien chaque route et la vraie IP du téléphone (pas 127.0.0.1)
  const { postes } = await rpc("list_postes", {}, admin);
  const viaInternet = postes.filter((p) => p.route === "internet" && p.online);
  const viaLocal = postes.filter((p) => p.route === "local" && p.online && p.mode !== "server");
  check("list_postes : un appareil en « internet » avec l'IP 41.73.10.20", viaInternet.length === 1 && viaInternet[0].ip === "41.73.10.20", JSON.stringify(viaInternet.map((p) => [p.name, p.ip])));
  check("list_postes : PC et tablette en « local »", viaLocal.length >= 2, JSON.stringify(viaLocal.map((p) => [p.name, p.ip])));
  check("list_postes : la tablette garde son IP du réseau local", !process.env.LAN_IP || viaLocal.some((p) => p.ip === process.env.LAN_IP), process.env.LAN_IP ?? "");

  await shot(server, "01-serveur-deux-routes.png");
  await shot(pc, "02-pc-reseau-local.png");
  await shot(tablet, "03-tablette-reseau-local.png");
  await shot(phone, "04-telephone-internet.png");

  // ── Coupure du tunnel : Internet indisponible, le réseau local continue
  tunnel.kill();
  await sleep(1500);
  cloud = await rpc("cloud_publish_now", {}, admin);
  check("tunnel coupé : le serveur détecte « Internet indisponible »", cloud.public_ok === false, cloud.public_error ?? "");
  await server.reload();
  await seen(server, "Poste serveur (tunnel coupé)", "Internet indisponible");
  await seen(server, "Poste serveur (tunnel coupé)", "Réseau local disponible");
  await seen(phone, "Téléphone (tunnel coupé)", "Serveur injoignable", 30_000);
  await seen(pc, "PC (tunnel coupé)", "Synchronisé · Réseau local");
  await shot(server, "05-serveur-internet-coupe.png");
  await shot(phone, "06-telephone-tunnel-coupe.png");

  // ── Retour du tunnel : le téléphone se reconnecte seul, sans recharger la page
  tunnel = startMock("tunnel");
  await waitUp(`${PUB}/api/ping`);
  await chip(phone, "Téléphone (tunnel rétabli, sans recharger)", "internet", 40_000);
  await seen(phone, "Téléphone (tunnel rétabli, sans recharger)", "Connecté au serveur");
  cloud = await rpc("cloud_publish_now", {}, admin);
  check("tunnel rétabli : « Internet disponible » de nouveau", cloud.public_ok === true, cloud.public_error ?? "");
  await shot(phone, "07-telephone-reconnecte.png");

  // ── Accès Internet : téléphone d'une caissière autorisé par un code d'accès de l'administrateur
  const caisse = team.find((m) => m.username === "caisse1");
  if (caisse) {
    const refused = await rpc("login", { username: "caisse1", pin: caisse.pin }, null, PUB).then(() => "acceptée", (e) => e.message);
    check("Internet : connexion refusée sans téléphone autorisé", refused.includes("pas encore autorisé"), refused);
    const caisseId = (await rpc("list_users", {}, admin)).find((u) => u.username === "caisse1").id;
    const code = await rpc("create_access_code", { user_id: caisseId, pin: PIN }, admin);
    check("code d'accès téléphone : 8 lettres et chiffres", /^[A-Z0-9]{8}$/.test(code.code), code.code);
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, userAgent: android, isMobile: true, hasTouch: true, locale: "fr-FR" });
    const phone2 = await ctx.newPage();
    phone2.on("pageerror", (e) => console.log(`[téléphone 2] erreur : ${e.message}`));
    await phone2.goto(`${PUB}/#/`);
    await seen(phone2, "Téléphone non autorisé", "Autoriser ce téléphone");
    await phone2.getByLabel("Identifiant").fill("caisse1");
    await phone2.getByLabel("Code PIN").fill(caisse.pin);
    await phone2.getByLabel("Code d'accès").fill(`${code.code.slice(0, 4)}-${code.code.slice(4)}`);
    await shot(phone2, "15-telephone-code-acces.png");
    await phone2.getByRole("button", { name: "Autoriser ce téléphone" }).click();
    try {
      await phone2.locator(".auth-page").waitFor({ state: "detached", timeout: 45_000 });
      check("téléphone autorisé par code d'accès : la caissière est connectée", true);
    } catch {
      check("téléphone autorisé par code d'accès : la caissière est connectée", false, "toujours sur l'écran de connexion");
    }
    await phone2.waitForTimeout(1500);
    await shot(phone2, "16-telephone-autorise.png");
    const devices = await rpc("list_devices", {}, admin);
    check("téléphone autorisé visible par l'administrateur", devices.some((d) => d.user_name === "Caissière 1"), JSON.stringify(devices.map((d) => d.label)));
    await pc.goto(`${SRV}/#/users`);
    await seen(pc, "Personnel : téléphones autorisés", "Téléphones autorisés");
    await shot(pc, "17-personnel.png");
    await ctx.close();
  }

  // ── Plan de la boutique : salle, porte, frigo et gondole posés ; produit rangé ; plan et recherche
  const plan = await rpc("plan_get", {}, admin);
  const typeOf = (code) => plan.types.find((t) => t.code === code);
  check(
    "palette du plan : gondoles, frigos, congélateurs, vitrines, chambre froide, murs, portes…",
    plan.types.filter((t) => t.builtin).length >= 25 && ["gondole", "refrigerateur", "congelateur_coffre", "vitrine_refrigeree", "chambre_froide", "mur", "porte"].every(typeOf),
    String(plan.types.length),
  );
  await rpc("plan_save_fixture", { id: null, input: { type_id: typeOf("zone_vente").id, x: 0.5, y: 0.5, w: 14, h: 9 } }, admin);
  await rpc("plan_save_fixture", { id: null, input: { type_id: typeOf("porte").id, x: 6, y: 9.4 } }, admin);
  const fridge = await rpc("plan_save_fixture", { id: null, input: { type_id: typeOf("refrigerateur").id, x: 1.5, y: 1.5 } }, admin);
  await rpc("plan_save_fixture", { id: null, input: { type_id: typeOf("gondole").id, x: 5, y: 3 } }, admin);
  const coca = await rpc("save_product", { id: null, input: { name: "Coca-Cola 33 cl", purchase_price: 300, sale_price: 500, initial_stock: 48 } }, admin);
  const slots = (await rpc("plan_fixture_contents", { id: fridge.id }, admin)).slots;
  check("frigo posé sur le plan : FR1, 5 étages", fridge.code === "FR1" && slots.length === 5, `${fridge.code} ${slots.length}`);
  const places = await rpc("plan_put", { input: { product_id: coca.id, location_id: slots.find((s) => s.level === 3).id } }, admin);
  check(
    "produit posé au 3e étage du frigo (emplacement principal)",
    places.length === 1 && places[0].primary && places[0].fixture_code === "FR1" && places[0].level === 3,
    JSON.stringify(places[0] ?? {}),
  );
  await pc.goto(`${SRV}/#/locations`);
  // Vue 3D (par défaut si WebGL) : canevas affiché, visite ; puis plan vu de dessus pour la suite.
  const view3d = pc.getByRole("button", { name: "3D", exact: true });
  await pc.getByRole("button", { name: "Modifier le plan" }).waitFor({ timeout: 45_000 });
  const has3d = (await view3d.count()) > 0;
  if (has3d) {
    await view3d.click();
    try {
      await pc.locator("canvas.plan3d-canvas").waitFor({ state: "visible", timeout: 30_000 });
      check("plan en 3D : boutique affichée", true);
    } catch {
      check("plan en 3D : boutique affichée", false, "canevas 3D absent");
    }
    await pc.waitForTimeout(2500);
    await shot(pc, "12-plan-3d.png");
    await pc.getByRole("button", { name: "Visite", exact: true }).click();
    await pc.waitForTimeout(2000);
    await shot(pc, "13-plan-visite.png");
    await pc.getByRole("button", { name: "Dessus", exact: true }).click();
  } else {
    check("plan en 3D : WebGL indisponible ici, plan vu de dessus affiché", true);
  }
  await seen(pc, "Plan de la boutique", "Salle de vente");
  await seen(pc, "Plan de la boutique", "FR1");
  await shot(pc, "08-plan-de-la-boutique.png");
  // Mode modification : palette de meubles ; double-clic sur le frigo : vue de face avec le produit.
  await pc.getByRole("button", { name: "Modifier le plan" }).click();
  await seen(pc, "Plan en modification : palette", "Chambre froide");
  await shot(pc, "10-plan-modification-palette.png");
  await pc.locator(".map-fixture").filter({ hasText: "FR1" }).locator("rect").first().dblclick();
  await seen(pc, "Vue de face du frigo", "Coca-Cola 33 cl");
  await shot(pc, "11-vue-de-face-frigo.png");
  await pc.goto(`${SRV}/#/finder`);
  await pc.locator(".finder-search input").fill("Coca");
  await seen(pc, "Localiser un produit", "Réfrigérateur vitré FR1");
  await pc.waitForTimeout(2000);
  await shot(pc, "09-localiser-un-produit.png");
  // Plan proposé pour une boutique à deux activités (supérette + quincaillerie), aux vraies dimensions.
  const layout = { floor_id: null, name: "Magasin 2", width: 14, depth: 10, height: 3.5, entry: "bottom", storage_room: true, activities: ["superette", "hardware"] };
  const preview = await rpc("plan_preview_layout", { input: layout }, admin);
  const rayons = preview.fixtures.filter((f) => f.type_code === "zone_vente").map((f) => f.name);
  check("plan proposé (aperçu) : un rayon par activité", rayons.join(",") === "Alimentation,Quincaillerie", rayons.join(","));
  const wizFloor = await rpc("plan_generate_layout", { input: layout }, admin);
  const made = (await rpc("plan_get", {}, admin)).fixtures.filter((f) => f.floor_id === wizFloor);
  check(
    "« Garder ce plan » : murs, porte, caisse, frigos, gondoles et racks posés",
    ["mur", "porte", "caisse", "refrigerateur", "gondole", "rack"].every((c) => made.some((f) => f.type_code === c)) && made.length === preview.fixtures.length,
    `${made.length} élément(s)`,
  );
  if (has3d) {
    await pc.goto(`${SRV}/#/locations`);
    await pc.getByRole("button", { name: "Magasin 2" }).click();
    await pc.getByRole("button", { name: "3D", exact: true }).click();
    await pc.waitForTimeout(3000);
    await shot(pc, "14-assistant-boutique-3d.png");
  }

  // ── 0.15 : prix de gros à partir d'une quantité, promotion du jour, rapports Z
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const noPin = await rpc("save_product", { id: coca.id, input: { name: coca.name, barcode: coca.barcode, purchase_price: 300, sale_price: 500, wholesale_price: 450, wholesale_min_qty: 24 } }, admin)
    .then(() => "accepté", (e) => e.message);
  check("prix de gros : changement confirmé par le PIN", /PIN/i.test(noPin), noPin);
  await rpc("save_product", { id: coca.id, pin: PIN, input: { name: coca.name, barcode: coca.barcode, purchase_price: 300, sale_price: 500, wholesale_price: 450, wholesale_min_qty: 24 } }, admin);
  const quote = (quantity) => rpc("sale_quote", { items: [{ product_id: coca.id, quantity, packaging_id: null }], customer_id: null }, admin).then((r) => r[0]);
  const [q6, q24] = [await quote(6), await quote(24)];
  check("prix de gros à partir de 24 canettes", q6.kind === "retail" && q6.unit_price === 500 && q24.kind === "wholesale" && q24.unit_price === 450, JSON.stringify([q6, q24]));
  await rpc("save_promotion", { input: { id: null, name: "Fête de quartier", kind: "percent", value: 20, product_id: coca.id, category_id: null, starts_on: today, ends_on: today, active: true } }, admin);
  const promo = await quote(1);
  check("promotion du jour : -20 % appliqué en caisse", promo.kind === "promo" && promo.unit_price === 400 && promo.regular_price === 500, JSON.stringify(promo));
  const zs = await rpc("list_z_reports", { filter: null }, admin);
  check("rapports Z : liste lisible (aucune clôture pour l'instant)", Array.isArray(zs) && zs.length === 0, JSON.stringify(zs).slice(0, 80));
  await pc.goto(`${SRV}/#/promotions`);
  await seen(pc, "page Promotions", "Fête de quartier");
  await shot(pc, "18-promotions.png");
  await pc.goto(`${SRV}/#/returns`);
  await seen(pc, "page Retours & avoirs", "Retours & avoirs");

  // ── 0.16 : serveur durci, remises contrôlées par le serveur, ventes sans doublon, sauvegarde, impression directe
  const raw = async (base, cmd, body) => {
    const r = await fetch(`${base}/rpc/${cmd}`, { method: "POST", headers: { "Content-Type": "application/json" }, body });
    return { status: r.status, text: await r.text() };
  };
  const staffList = await raw(PUB, "list_login_users", "[]");
  check("Internet : appel avec une liste au lieu d'un objet refusé (personnel non divulgué)", staffList.status === 400 && staffList.text.includes("objet JSON") && !staffList.text.includes("caisse1"), `${staffList.status} ${staffList.text.slice(0, 100)}`);
  const settingsList = await raw(PUB, "get_settings", "[]");
  check("Internet : paramètres de la boutique non lisibles par une liste", settingsList.status === 400 && !settingsList.text.includes("om_merchant"), String(settingsList.status));
  const home = await fetch(`${SRV}/`, { headers: { "Accept-Encoding": "gzip, br" } });
  const homeHtml = await home.text();
  check("interface compressée, page d'accueil toujours revérifiée", /gzip|br/.test(home.headers.get("content-encoding") ?? "") && home.headers.get("cache-control") === "no-cache", `${home.headers.get("content-encoding")} / ${home.headers.get("cache-control")}`);
  const script = homeHtml.match(/\/assets\/index-[^"]+\.js/)?.[0];
  const asset = script ? await fetch(`${SRV}${script}`) : null;
  check("fichiers de l'interface gardés en cache sur l'appareil", !!asset && /immutable/.test(asset.headers.get("cache-control") ?? ""), asset?.headers.get("cache-control") ?? "aucun script");
  const stale = await fetch(`${SRV}/assets/ancienne-version-0000.js`);
  check("fichier d'une ancienne version : 404 (pas la page d'accueil)", stale.status === 404, String(stale.status));

  if (caisse) {
    const gerant = team.find((m) => m.username === "gestionnaire");
    const gerantId = (await rpc("list_users", {}, admin)).find((u) => u.username === "gestionnaire").id;
    const cashier = (await rpc("login", { username: "caisse1", pin: caisse.pin })).token;
    await rpc("open_cash_session", { amount: 0 }, cashier).catch(() => null);
    // 10 canettes à 400 (promotion du jour) = 4 000 FCFA.
    const sell = (lineDiscount, input = {}) =>
      rpc("create_sale", {
        input: {
          items: [{ product_id: coca.id, quantity: 10, discount: lineDiscount, packaging_id: null }],
          customer_id: null, discount: 0, payments: [{ method: "cash", amount: 5000, reference: null, phone: null }], note: null, ...input,
        },
      }, cashier);
    const refusedDiscount = await sell(400).then(() => "acceptée", (e) => e.message);
    check("remise de 10 % refusée par le serveur sans le PIN d'un responsable", refusedDiscount.includes("10 %") && refusedDiscount.includes("gestionnaire"), refusedDiscount);
    const caissePin = await sell(400, { discount_pin: caisse.pin }).then(() => "acceptée", (e) => e.message);
    check("la caissière ne valide pas sa propre remise", caissePin !== "acceptée", caissePin);
    const approved = await sell(400, { discount_pin: `${gerantId}:${gerant.pin}` }).then((v) => v, (e) => e.message);
    check("remise de 10 % validée par le PIN du gestionnaire", approved?.total === 3600, typeof approved === "string" ? approved : approved.total);
    const small = await sell(200).then((v) => v, (e) => e.message);
    check("remise de 5 % acceptée sans validation", small?.total === 3800, typeof small === "string" ? small : small.total);
    const ref = `e2e-${Date.now()}`;
    const first = await sell(0, { client_ref: ref });
    const stockAfter = (await rpc("get_product", { id: coca.id }, admin)).stock;
    const again = await sell(0, { client_ref: ref });
    const stockAgain = (await rpc("get_product", { id: coca.id }, admin)).stock;
    check("même ticket envoyé deux fois (coupure réseau) : une seule vente, stock décompté une fois", first.id === again.id && stockAfter === stockAgain, `${first.number} / ${again.number}, stock ${stockAfter} → ${stockAgain}`);
    const report = await rpc("sales_report", { from: today, to: today }, admin);
    const mine = (report.discounts_by_user ?? []).find((d) => d.label === "Caissière 1");
    check("rapport : remises par caissier (dont 1 validée par un responsable)", mine?.count === 2 && mine?.amount === 600 && mine?.approved === 1, JSON.stringify(report.discounts_by_user));
    await pc.goto(`${SRV}/#/reports`);
    await seen(pc, "Rapports", "Remises par caissier");
    await pc.locator(':text("Remises par caissier")').first().scrollIntoViewIfNeeded();
    await shot(pc, "19-remises-par-caissier.png");
  }

  // ── 0.19 : compte client (fonds puis dette) et programme client fidèle (étoiles, bonus, carte QR)
  if (caisse) {
    await rpc("update_settings", { values: { loyalty_enabled: "1", loyalty_star_steps: "1,2,3,4,5" }, pin: PIN }, admin);
    const cashier = (await rpc("login", { username: "caisse1", pin: caisse.pin })).token;
    await rpc("open_cash_session", { amount: 0 }, cashier).catch(() => null);
    const fatou = await rpc("save_customer", { id: null, input: { name: "Fatou Fidèle", phone: "70 11 22 33", credit_limit: 0 } }, admin);
    const dep = await rpc("record_customer_payment", { input: { customer_id: fatou.id, amount: 5000, method: "cash", reference: null, phone: null, note: null } }, cashier);
    check("compte client : versement de 5 000 sans dette → 5 000 de fonds", dep.balance === -5000, dep.balance);
    const bought = await rpc("create_sale", {
      input: { items: [{ product_id: coca.id, quantity: 4, discount: 0, packaging_id: null }], customer_id: fatou.id, discount: 0, payments: [], note: null },
    }, cashier);
    check("caisse : achat payé avec les fonds du client (rien à crédit)", bought.account_amount === bought.total && bought.credit_amount === 0, `${bought.account_amount} / ${bought.total}`);
    check("client fidèle : bonus de 0,5 % gagné sur l'achat", bought.loyalty_earned === Math.floor(bought.total * 0.005), bought.loyalty_earned);
    const tooMuch = await rpc("create_sale", {
      input: { items: [{ product_id: coca.id, quantity: 40, discount: 0, packaging_id: null }], customer_id: fatou.id, discount: 0, payments: [], note: null },
    }, cashier).then(() => "acceptée", (e) => e.message);
    check("compte client : au-delà des fonds, sans plafond de crédit, refusé", tooMuch.includes("Fonds insuffisants"), tooMuch);
    const card = await rpc("customer_card", { id: fatou.id }, admin);
    const byCard = await rpc("customer_by_card", { code: card }, cashier);
    check("carte de fidélité : client retrouvé par son QR code, avec ses étoiles", byCard?.id === fatou.id && byCard.stars === 1, `${card} → ${byCard?.name} (${byCard?.stars} étoile)`);
    await pc.goto(`${SRV}/#/customers`);
    if (await seen(pc, "Clients : compte et fidélité", "Fatou Fidèle")) {
      check("page Clients : fonds du client affichés", (await pc.locator("tr", { hasText: "Fatou Fidèle" }).locator(".badge", { hasText: "Fonds" }).count()) === 1);
      await shot(pc, "23-clients-fonds-fidelite.png");
    }
  }

  const backup = await rpc("backup_status", {}, admin);
  check("sauvegarde automatique active sans réglage (dossier par défaut, copie récente)", !!backup.dir && backup.is_default && !backup.stale && !backup.error, JSON.stringify(backup));
  await pc.goto(`${SRV}/#/dashboard`);
  await seen(pc, "Tableau de bord", "Chiffre d'affaires du jour");
  check("tableau de bord : pas d'alerte de sauvegarde", (await pc.locator(':text("Sauvegarde à vérifier.")').count()) === 0);
  await shot(pc, "20-tableau-de-bord.png");

  // Imprimante à tickets (poste serveur, pont Tauri simulé) : page de test en ESC/POS, sans fenêtre d'impression.
  await server.evaluate(() => sessionStorage.setItem("gm-settings-tab", "sales"));
  await server.goto(`${SRV}/#/settings`);
  await server.reload();
  if (await seen(server, "Paramètres → Ventes", "Imprimante à tickets de ce poste")) {
    await server.locator("select").filter({ hasText: "Aucune : fenêtre d'impression" }).selectOption("XP-80C (test)");
    await server.getByRole("button", { name: "Imprimer une page de test" }).click();
    await server.waitForTimeout(1500);
    const printed = await server.evaluate(() => window.__printed ?? []);
    const bytes = printed[0] ? Buffer.from(printed[0], "base64") : Buffer.alloc(0);
    check("page de test envoyée en ESC/POS (initialisation, coupe du papier)", bytes[0] === 0x1b && bytes[1] === 0x40 && bytes.includes(Buffer.from([0x1d, 0x56])), `${bytes.length} octets`);
    check("accents du ticket en page de code PC850 (é = 0x82)", bytes.includes(0x82));
    await shot(server, "21-imprimante-a-tickets.png");
  }
  await server.evaluate(() => sessionStorage.setItem("gm-settings-tab", "developer"));
  await server.reload();
  await seen(server, "Paramètres → Développeur Eden Dev", "En cas de problème : envoyer le journal");
  await shot(server, "22-journal-eden-dev.png");

  // ── 0.17 : plan — chevauchement refusé, place libre, plusieurs meubles, état du stock, ventes, étiquettes de rayon
  const onFloor = (await rpc("plan_get", {}, admin)).fixtures.filter((f) => f.floor_id === fridge.floor_id);
  const go = onFloor.find((f) => f.type_code === "gondole");
  const fr = onFloor.find((f) => f.id === fridge.id);
  const moveTry = (x, y) => rpc("plan_move_fixtures", { items: [{ id: fr.id, x, y, w: fr.w, h: fr.h, rotation: fr.rotation }] }, admin).then(() => "accepté", (e) => e.message);
  const overlapMsg = await moveTry(go.x + 0.5, go.y);
  check("plan : frigo posé sur la gondole refusé par le serveur", overlapMsg.includes("Place occupée"), overlapMsg);
  const outMsg = await moveTry(40, 1);
  check("plan : meuble hors du niveau refusé", outMsg.includes("sortirait du niveau"), outMsg);
  const dup = await rpc("plan_save_fixture", { id: null, input: { type_id: go.type_id, floor_id: go.floor_id, x: go.x + 0.5, y: go.y } }, admin);
  const box = (f) => [f.x, f.y, f.x + f.w, f.y + f.h];
  const [a1, b1] = [box(dup), box(go)];
  check(
    "plan : copie posée sur un meuble → place libre la plus proche",
    a1[0] >= b1[2] - 0.02 || b1[0] >= a1[2] - 0.02 || a1[1] >= b1[3] - 0.02 || b1[1] >= a1[3] - 0.02,
    JSON.stringify({ copie: a1, gondole: b1 }),
  );
  await rpc("plan_delete_fixture", { id: dup.id }, admin);

  const lait = await rpc("save_product", { id: null, input: { name: "Lait UHT 1 L", purchase_price: 600, sale_price: 800, initial_stock: 2, min_stock: 5 } }, admin);
  await rpc("plan_put", { input: { product_id: lait.id, location_id: slots.find((s) => s.level === 1).id } }, admin);
  const stockState = await rpc("plan_floor_status", { floor_id: fridge.floor_id }, admin);
  const frState = stockState.fixtures.find((s) => s.fixture_id === fridge.id);
  check("état du stock : stock bas du lait signalé sur le frigo", frState?.low_stock === 1 && frState?.alerts >= 1, JSON.stringify(frState));
  const frAlerts = await rpc("plan_fixture_alerts", { id: fridge.id }, admin);
  check("état du stock : produits à signaler du frigo", frAlerts.some((x) => x.name === "Lait UHT 1 L" && x.status === "low"), JSON.stringify(frAlerts));
  // Le Coca a été modifié plus haut par l'API sans son emplacement : il est remis dans le frigo (emplacement principal).
  await rpc("plan_put", { input: { product_id: coca.id, location_id: slots.find((s) => s.level === 3).id } }, admin).catch(() => null);
  const salesMap = await rpc("plan_sales_map", { from: today, to: today }, admin);
  const frSales = salesMap.fixtures.find((s) => s.fixture_id === fridge.id);
  check("carte des ventes : le Coca vendu compte pour le frigo", frSales?.revenue > 0 && salesMap.total >= frSales.revenue, JSON.stringify(salesMap));

  await pc.goto(`${SRV}/#/locations`);
  await pc.getByRole("button", { name: "Modifier le plan" }).waitFor({ timeout: 45_000 });
  if (has3d) await pc.getByRole("button", { name: "Dessus", exact: true }).click();
  const displayBar = pc.locator(".plan-display");
  await displayBar.getByRole("button", { name: "État du stock" }).click();
  await seen(pc, "Plan : état du stock (légende)", "Stock bas");
  await pc.locator('.map-fixture[data-code="FR1"] rect').first().click();
  await seen(pc, "Plan : produits à signaler du frigo", "Lait UHT 1 L");
  await shot(pc, "23-plan-etat-du-stock.png");
  await displayBar.getByRole("button", { name: "Ventes", exact: true }).click();
  await seen(pc, "Plan : ventes du frigo", "Part des ventes");
  await pc.locator(".map-floor").click({ position: { x: 5, y: 5 } });
  await seen(pc, "Plan : meubles qui vendent le plus", "Ceux qui vendent le plus");
  await shot(pc, "24-plan-carte-des-ventes.png");
  await displayBar.getByRole("button", { name: "Plan", exact: true }).click();

  // Plusieurs meubles : Maj + clic sur le frigo et la gondole, puis « Aligner en haut ».
  await pc.getByRole("button", { name: "Modifier le plan" }).click();
  await pc.locator('.map-fixture[data-code="FR1"] rect').first().click();
  await pc.locator(`.map-fixture[data-code="${go.code}"] rect`).first().click({ modifiers: ["Shift"] });
  await seen(pc, "Plan : deux meubles sélectionnés", "2 meubles sélectionnés");
  await pc.getByTitle("Aligner en haut").click();
  await pc.waitForTimeout(1500);
  const goAfter = (await rpc("plan_get", {}, admin)).fixtures.find((f) => f.id === go.id);
  check("plusieurs meubles : gondole alignée en haut sur le frigo", Math.abs(goAfter.y - fr.y) < 0.01, `${goAfter.y} / ${fr.y}`);
  await shot(pc, "25-plan-plusieurs-meubles.png");
  await pc.getByRole("button", { name: "Terminer la modification" }).click();

  // Étiquettes de rayon du frigo sur l'imprimante à tickets du poste serveur (pont Tauri simulé).
  await server.goto(`${SRV}/#/locations`);
  await server.getByRole("button", { name: "Modifier le plan" }).waitFor({ timeout: 45_000 });
  if ((await server.getByRole("button", { name: "Dessus", exact: true }).count()) > 0) await server.getByRole("button", { name: "Dessus", exact: true }).click();
  await server.evaluate(() => {
    window.__printerConfig = { printer: "XP-80C (test)", auto_print: true, open_drawer: false };
  });
  await server.locator('.map-fixture[data-code="FR1"] rect').first().click();
  await server.getByRole("button", { name: "Étiquettes de rayon" }).click();
  if (await seen(server, "Étiquettes de rayon : choix de l'imprimante à tickets", "Feuille (fenêtre d'impression)")) {
    await server.locator(".modal").getByRole("button", { name: "Imprimante à tickets", exact: true }).click();
    await shot(server, "26-etiquettes-de-rayon.png");
    const before = await server.evaluate(() => (window.__printed ?? []).length);
    await server.locator(".modal").getByRole("button", { name: "Imprimer", exact: true }).click();
    await server.waitForTimeout(1500);
    const printed = await server.evaluate(() => window.__printed ?? []);
    const lab = printed.length > before ? Buffer.from(printed[printed.length - 1], "base64") : Buffer.alloc(0);
    check(
      "étiquettes de rayon du frigo sur l'imprimante à tickets (code-barres, coupe)",
      lab.includes(Buffer.from([0x1d, 0x6b])) && lab.includes(Buffer.from([0x1d, 0x56])),
      `${lab.length} octets`,
    );
  }

  // ── Version mobile : toutes les pages sur un téléphone de 360 px, par Internet (administrateur et caissière).
  const cashierToken = caisse ? (await rpc("login", { username: "caisse1", pin: caisse.pin })).token : null;
  await phoneTour({ browser, url: PUB, adminToken: await login(), cashierToken, out: OUT, strict: process.env.MOBILE_STRICT !== "0", check });
} catch (e) {
  check("scénario exécuté sans exception", false, e.stack ?? e.message);
} finally {
  await browser?.close();
  tunnel.kill();
  supabase.kill();
  fs.writeFileSync(`${OUT}/results.json`, JSON.stringify(checks, null, 2));
  const failed = checks.filter((c) => !c.ok);
  for (const f of failed) console.log(`::error title=Test d'interface::${f.name} ${f.detail}`.replace(/\n/g, " "));
  console.log(`\n${checks.length - failed.length}/${checks.length} vérifications réussies`);
  process.exit(failed.length ? 1 : 0);
}
