// Boutique d'exemple pour les vidéos d'aide (même boutique que la démonstration publicitaire e2e/demo.mjs) :
// administrateur, caissière, licence de test, produits, catégories, promotion, client, plan et ventes du jour.
export const PIN = "135792";

// Licence BUSINESS signée avec la clé de test (kid 99), reconnue par les compilations de développement
// (même licence que e2e/demo.mjs).
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

/** Remplit la boutique. `rpc(cmd, args, token)` appelle le poste serveur. */
export async function seedShop(rpc) {
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
    values: { om_merchant_number: "70 12 34 56", om_merchant_name: "Le Bon Prix", om_qr_payload: "GESTIMARKET-DEMO-OM-70123456", loyalty_enabled: "1" },
    pin: PIN,
  }, admin).catch((e) => console.log("réglages :", e.message));

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
  }, admin).catch((e) => console.log("promotion :", e.message));
  const client = await rpc("save_customer", { id: null, input: { name: "Moussa Diarra", phone: "76 11 22 33", credit_limit: 50000 } }, admin);
  await rpc("plan_generate_layout", {
    input: { floor_id: null, name: "Magasin", width: 14, depth: 10, height: 3.5, entry: "bottom", storage_room: true, activities: ["superette"] },
  }, admin).catch((e) => console.log("plan :", e.message));
  // Produits rangés dans les meubles (Localiser un produit, visite) : une case au milieu de chaque meuble.
  try {
    const plan = await rpc("plan_get", {}, admin);
    const names = ["Riz parfumé 25 kg", "Huile végétale 5 L", "Soda cola 33 cl", "Lessive en poudre 1 kg", "Biscuits au chocolat", "Lait en poudre 400 g"];
    let k = 0;
    for (const f of plan.fixtures) {
      if (k >= names.length) break;
      const slots = (await rpc("plan_fixture_contents", { id: f.id }, admin).catch(() => ({ slots: [] }))).slots ?? [];
      if (slots.length < 2) continue;
      const slot = slots[Math.floor(slots.length / 2)];
      await rpc("plan_put", { input: { product_id: ids[names[k]], location_id: slot.id } }, admin).catch(() => null);
      k++;
    }
    console.log("produits rangés sur le plan :", k);
  } catch (e) {
    console.log("rangement :", e.message);
  }

  const caissiere = (await rpc("login", { username: "caisse1", pin: caisse.pin })).token;
  await rpc("open_cash_session", { amount: 25000 }, caissiere).catch(() => null);
  const paniers = [
    [["Riz parfumé 25 kg", 1], ["Huile végétale 5 L", 1]], [["Soda cola 33 cl", 6], ["Biscuits au chocolat", 4]], [["Sucre en poudre 1 kg", 3], ["Thé vert 25 g", 4]],
    [["Lait en poudre 400 g", 2], ["Café soluble 50 g", 1]], [["Eau minérale 1,5 L", 6]], [["Pâtes 500 g", 5], ["Tomate concentrée 400 g", 3]],
    [["Riz parfumé 25 kg", 2]], [["Jus d'orange 1 L", 3], ["Biscuits au chocolat", 6]],
  ];
  let n = 0;
  for (const panier of paniers) {
    const items = panier.map(([nom, q]) => ({ product_id: ids[nom], quantity: q, packaging_id: null }));
    const lignes = await rpc("sale_quote", { items, customer_id: null }, caissiere);
    const total = lignes.reduce((s, l, i) => s + l.unit_price * items[i].quantity, 0);
    const payments = n % 3 === 1
      ? [{ method: "orange_money", amount: total, reference: `MP2511${String(10 + n).padStart(2, "0")}.1${n}20.C${12345 + n}`, phone: null }]
      : [{ method: "cash", amount: Math.ceil(total / 1000) * 1000 }];
    await rpc("create_sale", { input: { items, customer_id: null, discount: 0, payments, note: null } }, caissiere).catch((e) => console.log("vente :", e.message));
    n++;
  }
  return { admin, caissiere, caisse, ids, client };
}
