// Vitesse sur téléphone et compatibilité Safari.
//
// 1. Petit téléphone Android simulé (Chromium) : processeur ralenti 6 fois et « 4G africaine »
//    (0,3 s de délai, 1,6 Mbit/s), par Internet (faux tunnel). Pour le démarrage et chaque écran
//    principal : temps avant que l'écran soit utilisable, nombre d'allers-retours avec le serveur,
//    temps bloqué (tâches longues). Résultats dans vitesse.json.
// 2. iPhone (moteur WebKit, celui de Safari) : les mêmes écrans s'ouvrent, sans erreur JavaScript.
//
// Objectifs (VITESSE_STRICT=1 : un objectif manqué fait échouer le test ; sinon simple relevé).
import fs from "node:fs";
import { webkit } from "playwright";

const ANDROID = "Mozilla/5.0 (Linux; Android 11; SM-A105F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36";
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

/** Objectifs en millisecondes (téléphone d'entrée de gamme simulé, 4G). */
export const BUDGET = { start: 6000, screen: 4000, rpcPerScreen: 12 };

const CASHIER_SCREENS = ["pos", "finder", "customers", "sales", "cash"];
const ADMIN_SCREENS = ["dashboard", "products", "stock", "sales", "customers", "finder", "reports"];

/** Suit les requêtes de la page : en cours, et date de la dernière réponse. */
function tracker(page) {
  const t = { inflight: 0, last: Date.now(), rpc: 0 };
  page.on("request", (r) => {
    t.inflight++;
    if (/\/rpc(-batch)?(\/|$)/.test(r.url())) t.rpc++;
  });
  const done = (r) => {
    t.inflight = Math.max(0, t.inflight - 1);
    t.last = Date.now();
  };
  page.on("requestfinished", done);
  page.on("requestfailed", done);
  return t;
}

/** Attend que l'écran soit prêt : plus de requête depuis `quiet` ms et plus de « Chargement… ». */
async function ready(page, t, start, quiet = 700, max = 30_000) {
  const end = start + max;
  for (;;) {
    await page.waitForTimeout(100);
    const loading = await page.evaluate(() => /Chargement|Démarrage de GestiMarket/.test(document.body?.innerText ?? "")).catch(() => false);
    const now = Date.now();
    if (t.inflight === 0 && !loading && now - t.last >= quiet) return Math.max(0, t.last - start);
    if (now > end) return max;
  }
}

async function longTasks(page) {
  return page.evaluate(() => {
    const w = window;
    const total = w.__gmLong ?? 0;
    w.__gmLong = 0;
    return Math.round(total);
  });
}

const observeLongTasks = () => {
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) window.__gmLong = (window.__gmLong ?? 0) + Math.max(0, e.duration - 50);
    }).observe({ entryTypes: ["longtask"] });
  } catch {
    /* moteur sans « longtask » (Safari) */
  }
};

async function slowPhone(browser, url, token) {
  const ctx = await browser.newContext({ viewport: { width: 360, height: 760 }, userAgent: ANDROID, isMobile: true, hasTouch: true, deviceScaleFactor: 2, locale: "fr-FR" });
  await ctx.addInitScript(observeLongTasks);
  if (token) await ctx.addInitScript((tk) => sessionStorage.setItem("gm-token", tk), token);
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 300, downloadThroughput: (1.6e6 / 8) | 0, uploadThroughput: (0.75e6 / 8) | 0 });
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 6 });
  return { ctx, page };
}

async function measureScreens(page, t, who, screens, rows) {
  for (const s of screens) {
    t.rpc = 0;
    const start = Date.now();
    await page.evaluate((h) => (location.hash = h), `#/${s}`);
    const ms = await ready(page, t, start);
    rows.push({ who, screen: s, ms, rpc: t.rpc, longTasksMs: await longTasks(page) });
  }
}

export async function speedTest({ browser, url, adminToken, cashierToken, out, check }) {
  const strict = process.env.VITESSE_STRICT === "1";
  const rows = [];
  const verdict = (name, ok, detail) => {
    if (strict) check(name, ok, detail);
    else console.log(`[vitesse] ${ok ? "ok" : "AU-DESSUS DE L'OBJECTIF"} — ${name} ${detail}`);
  };

  // ── 1. Petit téléphone Android, 4G : démarrage puis écrans de la caissière et de l'administrateur.
  for (const [who, token, screens] of [["caissière", cashierToken, CASHIER_SCREENS], ["administrateur", adminToken, ADMIN_SCREENS]]) {
    if (!token) continue;
    const { ctx, page } = await slowPhone(browser, url, token);
    const t = tracker(page);
    const start = Date.now();
    await page.goto(`${url}/#/`, { timeout: 60_000 });
    const startMs = await ready(page, t, start, 900, 60_000);
    rows.push({ who, screen: "démarrage", ms: startMs, rpc: t.rpc, longTasksMs: await longTasks(page) });
    await measureScreens(page, t, who, screens, rows);
    await ctx.close();
  }
  for (const r of rows) {
    const limit = r.screen === "démarrage" ? BUDGET.start : BUDGET.screen;
    verdict(`vitesse téléphone 4G (${r.who}) : ${r.screen} en moins de ${limit / 1000} s`, r.ms <= limit, `${(r.ms / 1000).toFixed(2)} s, ${r.rpc} appels, ${r.longTasksMs} ms bloqués`);
    if (r.screen !== "démarrage") verdict(`vitesse téléphone 4G (${r.who}) : ${r.screen}, au plus ${BUDGET.rpcPerScreen} allers-retours`, r.rpc <= BUDGET.rpcPerScreen, `${r.rpc}`);
  }

  // ── 2. iPhone (WebKit, comme Safari) : chaque écran s'ouvre sans erreur JavaScript.
  const safari = [];
  let wk = null;
  try {
    wk = await webkit.launch();
  } catch (e) {
    check("Safari (WebKit) : navigateur de test disponible", false, e.message);
  }
  if (wk) {
    for (const [who, token, screens] of [["caissière", cashierToken, CASHIER_SCREENS], ["administrateur", adminToken, ADMIN_SCREENS]]) {
      if (!token) continue;
      const ctx = await wk.newContext({ viewport: { width: 390, height: 844 }, userAgent: IPHONE, isMobile: true, hasTouch: true, deviceScaleFactor: 3, locale: "fr-FR" });
      await ctx.addInitScript((tk) => sessionStorage.setItem("gm-token", tk), token);
      const page = await ctx.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message.slice(0, 200)));
      const t = tracker(page);
      const start = Date.now();
      await page.goto(`${url}/#/`, { timeout: 60_000 });
      const startMs = await ready(page, t, start, 700, 45_000);
      const started = await page.evaluate(() => !!window.__GM_READY__ && !document.getElementById("gm-compat"));
      check(`Safari iPhone (${who}) : GestiMarket démarre`, started, `${(startMs / 1000).toFixed(2)} s ${errors.join(" | ")}`);
      for (const s of screens) {
        const st = Date.now();
        await page.evaluate((h) => (location.hash = h), `#/${s}`);
        const ms = await ready(page, t, st);
        const text = await page.evaluate(() => (document.querySelector(".content")?.textContent ?? "").trim().length);
        safari.push({ who, screen: s, ms, errors: errors.splice(0) });
        check(`Safari iPhone (${who}) : écran ${s} affiché sans erreur`, text > 20 && safari[safari.length - 1].errors.length === 0, `${(ms / 1000).toFixed(2)} s ${safari[safari.length - 1].errors.join(" | ")}`);
        await page.screenshot({ path: `${out}/safari-${who === "caissière" ? "caisse" : "admin"}-${s}.png` }).catch(() => {});
      }
      await ctx.close();
    }
    await wk.close();
  }
  fs.writeFileSync(`${out}/vitesse.json`, JSON.stringify({ budget: BUDGET, android4g: rows, safari }, null, 2));
  console.log("[vitesse] " + rows.map((r) => `${r.who}/${r.screen} ${(r.ms / 1000).toFixed(1)}s ${r.rpc}rpc`).join(" · "));
}
