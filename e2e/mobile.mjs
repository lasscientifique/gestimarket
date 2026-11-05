// Version mobile : chaque écran de GestiMarket sur un téléphone étroit (360 px), par Internet (faux tunnel).
//
// Pour chaque page, onglet ou fenêtre, on relève :
//   - le défilement horizontal de la page (rien ne doit dépasser la largeur de l'écran) ;
//   - les éléments qui sortent de l'écran, ou qui sont coupés net par leur cadre ;
//   - les boutons et champs cachés sous les barres fixes (haut, onglets du bas, barre de la caisse) ;
//   - les erreurs de la console.
// Captures m-*.png ; détail dans mobile-audit.json.
import fs from "node:fs";

export const PHONE_WIDTH = 360;
const ANDROID = "Mozilla/5.0 (Linux; Android 14; SM-A155F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36";
// WebView Android de l'application FlutterFlow (« ; wv) ») : pas de boîte d'impression ni de téléchargement.
const WEBVIEW = "Mozilla/5.0 (Linux; Android 14; SM-A155F Build/UP1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/131.0 Mobile Safari/537.36";

// Pages de l'administrateur (tout le menu) et de la caissière (celle qui se sert le plus du téléphone).
const ADMIN_PAGES = [
  "dashboard", "poste", "finder", "locations", "sales", "cash", "returns", "customers", "promotions", "products",
  "categories", "stock", "purchases", "suppliers", "payments", "reports", "users", "audit", "settings", "licence",
];
const CASHIER_PAGES = ["pos", "my-dashboard", "sales", "cash", "returns", "customers", "finder", "poste"];

// Mesures faites dans la page (sérialisées par Playwright : pas de variable extérieure).
// opts.covered : chercher les boutons cachés sous une barre fixe : "top" en haut de la page (barre du haut,
// onglets des Paramètres), "bottom" en bas de la page (onglets du bas, barre de la caisse, pied de fenêtre).
function measure(opts = {}) {
  const W = document.documentElement.clientWidth;
  const H = window.innerHeight;
  const drawerOpen = !!document.querySelector(".mobile-open");
  const name = (el) => {
    let s = el.tagName.toLowerCase();
    const cls = typeof el.className === "string" ? el.className : el.className?.baseVal ?? "";
    const c = cls.trim().split(/\s+/).filter(Boolean).slice(0, 3);
    if (c.length) s += "." + c.join(".");
    const t = (el.getAttribute("aria-label") || el.innerText || el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 50);
    return t ? `${s} « ${t} »` : s;
  };
  const shown = (el) => {
    const s = getComputedStyle(el);
    return s.display !== "none" && s.visibility !== "hidden" && Number(s.opacity) > 0.05;
  };
  const skip = (el) => (!drawerOpen && el.closest(".sidebar, .mobile-overlay")) || (el.closest("svg") && el.tagName.toLowerCase() !== "svg");
  // Ancêtre le plus proche qui coupe ou fait défiler horizontalement.
  const clipOf = (el) => {
    for (let p = el.parentElement; p && p !== document.body && p !== document.documentElement; p = p.parentElement) {
      if (getComputedStyle(p).overflowX !== "visible") return p;
    }
    return null;
  };
  const outside = [];
  const cut = [];
  for (const el of document.body.querySelectorAll("*")) {
    if (skip(el) || !shown(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    const clip = clipOf(el);
    const cs = clip ? getComputedStyle(clip).overflowX : "visible";
    if (cs === "auto" || cs === "scroll") continue; // dans une zone qui défile : normal
    if (r.right > W + 1.5 || r.left < -1.5) {
      if (!clip) outside.push(el);
      else {
        const cr = clip.getBoundingClientRect();
        if (cr.right <= W + 1.5 && cr.left >= -1.5) cut.push(el);
      }
    } else if (clip && el.matches("button, a, input, select, textarea, label, .btn, h1, h2, h3, strong")) {
      // Coupé à l'intérieur de l'écran par un cadre « overflow: hidden » (bouton ou titre tronqué net).
      const cr = clip.getBoundingClientRect();
      const ellipsis = getComputedStyle(el).textOverflow === "ellipsis";
      if (!ellipsis && (r.right > cr.right + 3 || r.left < cr.left - 3)) cut.push(el);
    }
  }
  const outer = (list) => list.filter((el) => !list.some((o) => o !== el && o.contains(el)));
  const rect = (el) => {
    const r = el.getBoundingClientRect();
    return `${name(el)} [x ${Math.round(r.left)}→${Math.round(r.right)}]`;
  };
  // Contenu qui sort de son cadre sans le couper (texte qui passe sous le bouton voisin, par exemple).
  const spill = [];
  for (const el of document.querySelectorAll("button, .btn, .card, .kv, .stat-card, .line-info, .chip, .modal-body, .page-header, td, th")) {
    if (skip(el) || !shown(el) || el.closest(".table-scroll, .table-wrap, .card.no-pad, .plan3d, svg")) continue;
    const st = getComputedStyle(el);
    if (st.overflowX !== "visible" || st.display === "table-cell" && el.closest("table")?.scrollWidth > el.closest("table")?.clientWidth) continue;
    if (el.scrollWidth > el.clientWidth + 2 && el.clientWidth > 0) spill.push(el);
  }
  // Boutons et champs visibles à l'écran mais recouverts par une barre fixe (fenêtre ouverte : ceux de la fenêtre).
  const covered = [];
  const modal = document.querySelector(".modal");
  // En haut : seulement si la page n'a pas défilé (après un clic, un bouton passé sous la barre du haut est normal).
  const scrolled = (document.scrollingElement?.scrollTop ?? 0) > 2;
  const look = opts.covered === "bottom" || (opts.covered === "top" && (modal || !scrolled));
  const targets = !look ? [] : modal ? modal.querySelectorAll("button, a, input, select") : document.querySelectorAll(".content button, .content a, .content input, .content select, .pos-ticket button");
  for (const el of targets) {
    if (skip(el) || !shown(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4 || r.bottom <= 0 || r.top >= H || r.right <= 0 || r.left >= W) continue;
    const x = Math.min(W - 1, Math.max(0, r.left + r.width / 2));
    const y = Math.min(H - 1, Math.max(0, r.top + r.height / 2));
    const hit = document.elementFromPoint(x, y);
    if (!hit || el.contains(hit) || hit.contains(el)) continue;
    const bar = hit.closest(opts.covered === "top" ? ".mobile-topbar, .tabbar, .licence-banner" : ".mobile-tabs, .pos-mobile-bar, .modal-footer");
    if (bar && !bar.contains(el)) covered.push(`${name(el)} sous ${name(bar).slice(0, 40)}`);
  }
  // Cibles tactiles de moins de 30 px : à titre indicatif.
  const small = [];
  for (const el of document.querySelectorAll(".content button, .content a.btn, .modal button")) {
    if (skip(el) || !shown(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width >= 1 && r.height >= 1 && (r.width < 30 || r.height < 30)) small.push(`${name(el).slice(0, 60)} ${Math.round(r.width)}x${Math.round(r.height)}`);
  }
  return {
    width: W,
    pageScroll: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - W,
    outside: outer(outside).slice(0, 12).map(rect),
    cut: outer(cut).slice(0, 12).map(rect),
    spill: outer(spill).slice(0, 8).map((el) => `${name(el).slice(0, 70)} (${el.scrollWidth} > ${el.clientWidth})`),
    covered: covered.slice(0, 8),
    small: small.length,
    smallSample: small.slice(0, 8),
  };
}

// Les défauts, du plus visible au moins visible.
export function problems(m) {
  const p = [];
  if (m.pageScroll > 1) p.push(`la page défile de ${m.pageScroll} px vers la droite`);
  if (m.outside.length) p.push(`hors de l'écran : ${m.outside.join(" ; ")}`);
  if (m.cut.length) p.push(`coupé : ${m.cut.join(" ; ")}`);
  if (m.spill?.length) p.push(`sort de son cadre : ${m.spill.join(" ; ")}`);
  if (m.covered.length) p.push(`caché sous une barre : ${m.covered.join(" ; ")}`);
  if (m.errors?.length) p.push(`erreurs : ${m.errors.join(" ; ")}`);
  return p;
}

export async function phoneTour({ browser, url, adminToken, cashierToken, out, strict = false, check }) {
  const report = [];
  const errors = [];

  const phone = async (token, userAgent = ANDROID) => {
    const ctx = await browser.newContext({
      viewport: { width: PHONE_WIDTH, height: 780 }, userAgent, isMobile: true, hasTouch: true, deviceScaleFactor: 2, locale: "fr-FR", acceptDownloads: true,
    });
    if (token) await ctx.addInitScript((t) => sessionStorage.setItem("gm-token", t), token);
    const page = await ctx.newPage();
    page.on("console", (m) => m.type() === "error" && errors.push(m.text().slice(0, 200)));
    page.on("pageerror", (e) => errors.push(e.message.slice(0, 200)));
    return { ctx, page };
  };
  const settle = async (page, ms = 1200) => {
    await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(ms);
  };
  const record = async (page, label, file) => {
    const m = await page.evaluate(measure, { covered: "top" });
    m.errors = errors.splice(0);
    m.label = label;
    m.file = file;
    report.push(m);
    if (file) await page.screenshot({ path: `${out}/${file}`, fullPage: true });
    const p = problems(m);
    if (strict) check(`téléphone ${PHONE_WIDTH} px : ${label}`, p.length === 0, p.join(" | "));
    else console.log(`[mobile] ${label} : ${p.length ? p.join(" | ") : "rien à signaler"}`);
    return m;
  };
  const scrollAll = (page, end) =>
    page.evaluate((toEnd) => {
      for (const el of [document.scrollingElement, document.body, document.querySelector(".content"), document.querySelector(".modal-body")]) {
        if (el) el.scrollTop = toEnd ? el.scrollHeight : 0;
      }
    }, end);
  const go = async (page, hash) => {
    await page.evaluate((h) => (location.hash = h), hash);
    await settle(page);
    await scrollAll(page, false);
  };
  // Bas de la page ou de la fenêtre : plus rien ne doit rester caché sous une barre fixe.
  const bottom = async (page, label) => {
    await scrollAll(page, true);
    await page.waitForTimeout(350);
    const end = await page.evaluate(measure, { covered: "bottom" });
    await scrollAll(page, false);
    const ok = end.covered.length === 0;
    if (!ok) report.push({ ...end, label: `${label} (bas)`, errors: [] });
    if (strict) check(`téléphone ${PHONE_WIDTH} px : ${label}, bas de page dégagé`, ok, end.covered.join(" ; "));
    else if (!ok) console.log(`[mobile] ${label} (bas) : ${end.covered.join(" ; ")}`);
  };
  // Chaque page en haut, puis tout en bas (dernier bouton au-dessus des onglets ?).
  const pages = async (page, who, list) => {
    for (const r of list) {
      await go(page, `#/${r}`);
      await record(page, `${who} : page ${r}`, `m-${who}-${r}.png`);
      await bottom(page, `${who} : page ${r}`);
    }
  };

  // ── Administrateur
  {
    const { ctx, page } = await phone(adminToken);
    await page.goto(`${url}/#/dashboard`);
    await settle(page, 2500);
    await pages(page, "admin", ADMIN_PAGES);

    // Onglets des Paramètres.
    await go(page, "#/settings");
    const tabs = page.locator(".tabbar .tab-item");
    const count = await tabs.count();
    for (let i = 0; i < count; i++) {
      const label = ((await tabs.nth(i).innerText()) || `onglet ${i + 1}`).trim();
      await tabs.nth(i).click();
      await settle(page, 800);
      await page.evaluate(() => window.scrollTo(0, 0));
      await record(page, `Paramètres → ${label}`, `m-admin-settings-${String(i + 1).padStart(2, "0")}.png`);
    }

    // Menu en tiroir.
    await go(page, "#/dashboard");
    await page.locator(".mobile-topbar button").first().click();
    await page.waitForTimeout(600);
    await record(page, "menu ouvert", "m-admin-menu.png");
    await page.locator(".mobile-close").click().catch(() => {});
    await page.waitForTimeout(400);

    // Où est le produit ? (bouton de la barre du haut)
    await page.locator(".mobile-topbar").getByRole("button", { name: "Où est le produit ?" }).click().catch(() => {});
    await settle(page, 800);
    await record(page, "fenêtre « Où est le produit ? »", "m-admin-ou-est.png");
    await page.keyboard.press("Escape");

    // Fiche produit.
    await go(page, "#/products");
    const add = page.getByRole("button", { name: "Nouveau produit" });
    if (await add.count()) {
      await add.first().click();
      await settle(page, 800);
      await record(page, "fenêtre « Nouveau produit »", "m-admin-nouveau-produit.png");
      await bottom(page, "fenêtre « Nouveau produit »");
      await page.keyboard.press("Escape");
      await page.waitForTimeout(400);
    }

    // Fichiers dans le navigateur du téléphone (avant : boîte de dialogue du PC, en erreur).
    const result = (label, ok, detail) => (strict ? check(`téléphone : ${label}`, ok, detail) : console.log(`[mobile] ${label} : ${ok ? "oui" : "NON"} ${detail}`));
    await go(page, "#/products");
    const [download] = await Promise.all([
      page.waitForEvent("download", { timeout: 10_000 }).catch(() => null),
      page.getByRole("button", { name: "Exporter", exact: true }).click(),
    ]);
    result("« Exporter » télécharge le fichier CSV", !!download && /\.csv$/.test(download.suggestedFilename()), download?.suggestedFilename() ?? "aucun téléchargement");
    await go(page, "#/categories");
    const [chooser] = await Promise.all([
      page.waitForEvent("filechooser", { timeout: 10_000 }).catch(() => null),
      page.getByRole("button", { name: "Importer", exact: true }).click(),
    ]);
    if (chooser) await chooser.setFiles({ name: "categories.csv", mimeType: "text/csv", buffer: Buffer.from(["Chemin", "Boissons > Sodas", ""].join("\n"), "utf-8") });
    const imported = await page.locator(".toast").filter({ hasText: "catégorie(s) créée(s)" }).first().waitFor({ timeout: 10_000 }).then(() => true, () => false);
    result("« Importer » ouvre le sélecteur de fichiers et importe les catégories", !!chooser && imported, chooser ? (imported ? "" : "pas de message d'import") : "pas de sélecteur de fichiers");

    // Plan de la boutique : vue de dessus, un meuble choisi, état du stock.
    await go(page, "#/locations");
    const top = page.getByRole("button", { name: "Dessus", exact: true });
    if (await top.count()) await top.click().catch(() => {});
    await settle(page, 800);
    const fixture = page.locator('.map-fixture[data-code="FR1"] rect').first();
    if (await fixture.count()) {
      await fixture.click({ force: true }).catch(() => {});
      await settle(page, 800);
      await record(page, "plan : frigo choisi", "m-admin-plan-meuble.png");
    }
    const stockView = page.locator(".plan-display").getByRole("button", { name: "État du stock" });
    if (await stockView.count()) {
      await stockView.click().catch(() => {});
      await settle(page, 800);
      await record(page, "plan : état du stock", "m-admin-plan-stock.png");
    }
    await ctx.close();
  }

  // ── Caissière : ses pages, puis une vente (article, ticket, paiement).
  if (cashierToken) {
    const { ctx, page } = await phone(cashierToken);
    await page.goto(`${url}/#/pos`);
    await settle(page, 2500);
    await pages(page, "caisse", CASHIER_PAGES);
    await go(page, "#/pos");
    const tile = page.locator(".product-grid > *").first();
    if (await tile.count()) {
      await tile.click();
      await page.waitForTimeout(600);
      await record(page, "caisse : un article au ticket", "m-caisse-article.png");
      if (await page.locator(".pmb-ticket").count()) {
        await page.locator(".pmb-ticket").click();
        await page.waitForTimeout(700);
        await record(page, "caisse : ticket ouvert", "m-caisse-ticket.png");
        const overlap = await page.evaluate(() =>
          [...document.querySelectorAll(".pos-ticket .line")].filter((l) => {
            const sub = l.querySelector(".line-sub")?.getBoundingClientRect();
            const qty = l.querySelector(".qty-ctrl")?.getBoundingClientRect();
            return sub && qty && sub.right > qty.left + 1;
          }).length,
        );
        if (strict) check(`téléphone ${PHONE_WIDTH} px : ticket, prix et promotion à côté des boutons + / −`, overlap === 0, `${overlap} ligne(s) chevauchée(s)`);
        else console.log(`[mobile] ticket : ${overlap} ligne(s) dont le prix passe sous les boutons + / −`);
        await page.locator(".ticket-close").first().click().catch(() => {});
        await page.waitForTimeout(500);
      }
      if (await page.locator(".pmb-pay").count()) {
        await page.locator(".pmb-pay").click();
        await settle(page, 800);
        await record(page, "caisse : paiement", "m-caisse-paiement.png");
        await bottom(page, "caisse : paiement");
        await page.keyboard.press("Escape");
        await page.waitForTimeout(400);
      }
    }
    await ctx.close();
  }

  // ── Application mobile (WebView) : impression et enregistrement impossibles, un message le dit.
  {
    const { ctx, page } = await phone(adminToken, WEBVIEW);
    const result = (label, ok, detail) => (strict ? check(`application mobile : ${label}`, ok, detail) : console.log(`[mobile] application : ${label} : ${ok ? "oui" : "NON"} ${detail}`));
    const said = (text) => page.locator(".toast").filter({ hasText: text }).first().waitFor({ timeout: 8000 }).then(() => true, () => false);
    await page.goto(`${url}/#/reports`);
    await settle(page, 2500);
    await page.getByRole("button", { name: "Imprimer", exact: true }).click();
    result("« Imprimer » explique que l'application n'imprime pas", await said("ne peut pas imprimer"), "");
    await page.screenshot({ path: `${out}/m-application-imprimer.png` });
    await go(page, "#/products");
    await page.getByRole("button", { name: "Exporter", exact: true }).click();
    result("« Exporter » explique que l'application n'enregistre pas de fichier", await said("ne peut pas enregistrer"), "");
    await ctx.close();
  }

  // ── Écran de connexion d'un téléphone sans session.
  {
    const { ctx, page } = await phone(null);
    await page.goto(`${url}/#/`);
    await settle(page, 1500);
    await record(page, "connexion (téléphone sans session)", "m-connexion.png");
    await ctx.close();
  }

  // Le poste serveur a tenu toute la visite (une coupure ici se lit dans e2e-app.log).
  const alive = await fetch(`${url}/api/ping`).then((r) => r.ok, () => false);
  check("version mobile : le poste serveur répond toujours après la visite", alive, alive ? "" : "voir e2e-app.log");

  fs.writeFileSync(`${out}/mobile-audit.json`, JSON.stringify(report, null, 2));
  return report;
}
