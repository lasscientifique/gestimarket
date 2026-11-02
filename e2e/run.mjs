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

const SRV = "http://127.0.0.1:7878";
const PUB = "http://127.0.0.1:8080";
const LAN = process.env.LAN_IP ? `http://${process.env.LAN_IP}:7878` : SRV;
const OUT = "e2e/out";
const PIN = "1357";
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
  let setupToken = null;
  if (await rpc("needs_setup")) {
    setupToken = (await rpc("initial_setup", {
      input: { shop_name: "Eden Superrette", shop_phone: null, shop_address: "Bamako", currency_symbol: "FCFA", currency_decimals: 0, full_name: "Admin E2E", username: "admin", password: "secret123" },
    })).token;
  }
  const login = async () => (await rpc("login", { username: "admin", password: "secret123" })).token;
  const admin = setupToken ?? (await login());
  const second = await rpc("login", { username: "admin", password: "secret123" }).then(() => "acceptée", (e) => e.message);
  check("sans licence : une 2ᵉ session est refusée (FREE, 1 poste)", second.includes("Nombre maximal"), second);
  try {
    await rpc("set_my_pin", { password: "secret123", pin: PIN }, admin);
  } catch (e) {
    console.log(`PIN : ${e.message}`);
  }

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

  await rpc("update_settings", {
    values: { supabase_enabled: "1", supabase_url: "http://127.0.0.1:54321", supabase_key: "cle-publique-test", public_url: PUB },
    pin: PIN,
  }, admin);
  let cloud = await rpc("cloud_publish_now", {}, admin);
  check("publication Supabase réussie", !!cloud.last_ok_at && !cloud.last_error, cloud.last_error ?? "");
  check("adresse publique testée par le serveur : disponible", cloud.public_ok === true, JSON.stringify({ ok: cloud.public_ok, ms: cloud.public_ms, err: cloud.public_error }));

  // ── Appareils
  browser = await chromium.launch();
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
