import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Search, Pencil, Archive, Tags, Download, Wand2, Trash2, Upload, Printer, MapPin, Package, Camera } from "lucide-react";
import { api } from "../api";
import { useApp } from "../context/AppContext";
import { Badge, Empty, Field, ImageField, LocationBadge, Modal, PageHeader, Thumb } from "../components/ui";
import { ImportModal } from "../components/ImportModal";
import { LabelsModal } from "../components/LabelsModal";
import { LocationSelect } from "../components/LocationSelect";
import { CategorySelect, categoryPath } from "../components/CategorySelect";
import { HelpTip } from "../components/Help";
import { CameraScanner } from "../components/CameraScanner";
import { exportCsv } from "../lib/files";
import { csvMoney, currencySymbol, dateOnly, daysUntil, minorToInput, money, parseNumber, percent, qty, toCsv, toMinor, UNIT_GROUPS } from "../lib/format";
import type { Category, Location, Packaging, Product, Supplier } from "../types";

export default function ProductsPage() {
  const { toast, confirm, askPin } = useApp();
  const navigate = useNavigate();
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [search, setSearch] = useState("");
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [filter, setFilter] = useState<"" | "low" | "unplaced" | "nocat" | "archived">("");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [modal, setModal] = useState<null | "new" | "import" | "labels" | Product>(null);

  const load = useCallback(() => {
    api
      .listProducts({
        search,
        category_id: categoryId,
        low_stock: filter === "low",
        without_location: filter === "unplaced",
        without_category: filter === "nocat",
        include_inactive: filter === "archived",
        limit: 5000,
      })
      .then(setProducts)
      .catch(toast.error);
  }, [search, categoryId, filter, toast]);

  const loadRefs = useCallback(() => {
    api.listCategories().then(setCategories).catch(toast.error);
    api.listSuppliers().then(setSuppliers).catch(toast.error);
    api.listLocations().then(setLocations).catch(toast.error);
  }, [toast]);

  useEffect(() => {
    const t = setTimeout(load, 150);
    return () => clearTimeout(t);
  }, [load]);
  useEffect(loadRefs, [loadRefs]);

  const archive = async (p: Product) => {
    if (!(await confirm({ title: "Archiver le produit", message: `« ${p.name} » ne sera plus proposé à la vente. L'historique est conservé.`, confirmLabel: "Archiver", danger: true })))
      return;
    try {
      const pin = await askPin({ title: "Archiver le produit", level: "manager" });
      if (!pin) return;
      await api.archiveProduct(p.id, pin);
      toast.success("Produit archivé.");
      load();
    } catch (e) {
      toast.error(e);
    }
  };

  const toggle = (id: number) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const allSelected = products.length > 0 && products.every((p) => selected.has(p.id));
  const selectedProducts = products.filter((p) => selected.has(p.id));

  const doExport = async () => {
    const csv = toCsv(
      ["Code-barres", "Référence", "Désignation", "Marque", "Catégorie", "Unité", "Prix d'achat", "Prix de vente", "TVA %", "Stock", "Seuil d'alerte", "Bloc", "Étage", "Rangée", "Péremption", "Fournisseur", "Actif"],
      products.map((p) => [
        p.barcode,
        p.sku,
        p.name,
        p.brand,
        categoryPath(p),
        p.unit,
        csvMoney(p.purchase_price),
        csvMoney(p.sale_price),
        p.tax_rate,
        String(p.stock).replace(".", ","),
        String(p.min_stock).replace(".", ","),
        p.bloc,
        p.etage,
        p.rangee,
        p.expiry_date ? dateOnly(p.expiry_date) : "",
        p.supplier_name,
        p.active ? "oui" : "non",
      ]),
    );
    try {
      if (await exportCsv("produits.csv", csv)) toast.success("Export terminé.");
    } catch (e) {
      toast.error(e);
    }
  };

  return (
    <div className="page">
      <PageHeader
        help="products"
        title="Produits"
        subtitle={`${products.length} produit(s)`}
        actions={
          <>
            <button className="btn" onClick={() => setModal("import")}><Upload size={16} /> Importer</button>
            <HelpTip k="import" />
            <button className="btn" onClick={doExport}><Download size={16} /> Exporter</button>
            <button className="btn" onClick={() => navigate("/categories")}><Tags size={16} /> Catégories</button>
            <HelpTip k="categories" />
            <button className="btn btn-primary" onClick={() => setModal("new")}><Plus size={16} /> Nouveau produit</button>
          </>
        }
      />

      <div className="toolbar">
        <div className="search-box">
          <Search size={16} />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Nom, code-barres, marque, référence ou catégorie…" autoFocus />
        </div>
        <CategorySelect categories={categories} value={categoryId} onChange={setCategoryId} emptyLabel="Toutes les catégories" />
        <div className="segmented inline-seg">
          <button className={filter === "" ? "active" : ""} onClick={() => setFilter("")}>Actifs</button>
          <button className={filter === "low" ? "active" : ""} onClick={() => setFilter("low")}>Stock bas</button>
          <button className={filter === "unplaced" ? "active" : ""} onClick={() => setFilter("unplaced")}>Non rangés</button>
          <button className={filter === "nocat" ? "active" : ""} onClick={() => setFilter("nocat")}>Sans catégorie</button>
          <button className={filter === "archived" ? "active" : ""} onClick={() => setFilter("archived")}>+ Archivés</button>
        </div>
      </div>

      {selected.size > 0 && (
        <div className="selection-bar">
          <strong>{selected.size} sélectionné(s)</strong>
          <button className="btn btn-sm" onClick={() => setModal("labels")}><Printer size={14} /> Imprimer les étiquettes</button>
          <HelpTip k="labels" />
          <HelpTip k="bulk_location" />
          <BulkLocation
            locations={locations}
            onApply={async (loc) => {
              try {
                await api.assignLocation(loc, [...selected]);
                toast.success("Emplacement appliqué.");
                load();
                loadRefs();
              } catch (e) {
                toast.error(e);
              }
            }}
          />
          <button className="btn btn-sm" onClick={() => setSelected(new Set())}>Désélectionner</button>
        </div>
      )}

      <div className="card no-pad">
        {products.length === 0 ? (
          <Empty title="Aucun produit">Créez un produit ou importez votre catalogue depuis Excel.</Empty>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 36 }}>
                  <input type="checkbox" checked={allSelected} onChange={() => setSelected(allSelected ? new Set() : new Set(products.map((p) => p.id)))} />
                </th>
                <th>Produit</th>
                <th>Catégorie</th>
                <th>Emplacement</th>
                <th className="num">Prix d'achat</th>
                <th className="num">Prix de vente</th>
                <th className="num">Marge</th>
                <th className="num">Stock</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {products.map((p) => {
                const margin = p.sale_price - p.purchase_price;
                const rate = p.sale_price > 0 ? (margin / p.sale_price) * 100 : 0;
                const days = p.expiry_date ? daysUntil(p.expiry_date) : null;
                return (
                  <tr key={p.id} className={`${!p.active ? "row-cancelled" : ""} ${selected.has(p.id) ? "row-selected" : ""}`} onDoubleClick={() => setModal(p)}>
                    <td><input type="checkbox" checked={selected.has(p.id)} onChange={() => toggle(p.id)} /></td>
                    <td>
                      <div className="cell-product">
                        <Thumb imageId={p.image_id} name={p.name} color={p.category_color} size={40} />
                        <div>
                          <strong>{p.name}</strong>
                          <div className="muted small mono">
                            {p.barcode ?? "sans code-barres"}
                            {p.sku && <> · {p.sku}</>}
                            {p.brand && <> · {p.brand}</>}
                            {p.packagings.length > 0 && <Badge tone="info"><Package size={11} /> {p.packagings.map((k) => k.name).join(", ")}</Badge>}
                            {days !== null && days <= 30 && (
                              <Badge tone={days < 0 ? "danger" : "warning"}>{days < 0 ? "Périmé" : `Périme dans ${days} j`}</Badge>
                            )}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td>
                      {p.category_name ? (
                        <span className="cat"><span className="dot" style={{ background: p.category_color ?? "#999" }} />{categoryPath(p)}</span>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td><LocationBadge p={p} short /></td>
                    <td className="num">{money(p.purchase_price)}</td>
                    <td className="num"><strong>{money(p.sale_price)}</strong></td>
                    <td className={`num ${margin < 0 ? "text-danger" : ""}`}>{percent(rate)}</td>
                    <td className="num">
                      {!p.track_stock ? (
                        <span className="muted">non suivi</span>
                      ) : (
                        <Badge tone={p.stock <= 0 ? "danger" : p.stock <= p.min_stock ? "warning" : "success"}>
                          {qty(p.stock)} {p.unit}
                        </Badge>
                      )}
                    </td>
                    <td className="actions">
                      <button className="icon-btn" title="Modifier" onClick={() => setModal(p)}><Pencil size={16} /></button>
                      {p.active && <button className="icon-btn danger" title="Archiver" onClick={() => archive(p)}><Archive size={16} /></button>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {(modal === "new" || (modal && typeof modal === "object")) && (
        <ProductForm
          product={modal === "new" ? null : (modal as Product)}
          categories={categories}
          suppliers={suppliers}
          locations={locations}
          onClose={() => setModal(null)}
          onSaved={() => {
            setModal(null);
            load();
            loadRefs();
          }}
        />
      )}
      {modal === "import" && <ImportModal onClose={() => setModal(null)} onDone={() => { load(); loadRefs(); }} />}
      {modal === "labels" && <LabelsModal products={selectedProducts} onClose={() => setModal(null)} />}
    </div>
  );
}

function BulkLocation({ locations, onApply }: { locations: Location[]; onApply: (id: number | null) => void }) {
  const [value, setValue] = useState<number | null>(null);
  return (
    <span className="bulk-loc">
      <MapPin size={14} />
      <LocationSelect locations={locations} value={value} onChange={setValue} emptyLabel="Ranger dans…" />
      <button className="btn btn-sm btn-primary" disabled={!value} onClick={() => onApply(value)}>Appliquer</button>
    </span>
  );
}

function ProductForm({
  product,
  categories,
  suppliers,
  locations,
  onClose,
  onSaved,
}: {
  product: Product | null;
  categories: Category[];
  suppliers: Supplier[];
  locations: Location[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast, settings, askPin, hasFeature } = useApp();
  const restaurant = settings.business_type === "restaurant";
  const [f, setF] = useState({
    barcode: product?.barcode ?? "",
    name: product?.name ?? "",
    description: product?.description ?? "",
    brand: product?.brand ?? "",
    sku: product?.sku ?? "",
    category_id: product?.category_id ?? null,
    supplier_id: product?.supplier_id ?? null,
    location_id: product?.location_id ?? null,
    image_id: product?.image_id ?? null,
    expiry_date: product?.expiry_date ?? "",
    unit: product?.unit ?? (restaurant ? "plat" : "pce"),
    purchase_price: product ? minorToInput(product.purchase_price) : "",
    sale_price: product ? minorToInput(product.sale_price) : "",
    tax_rate: String(product?.tax_rate ?? settings.default_tax_rate ?? "0"),
    min_stock: String(product?.min_stock ?? "0"),
    track_stock: product?.track_stock ?? !restaurant,
    active: product?.active ?? true,
    initial_stock: "",
  });
  const [packs, setPacks] = useState<(Omit<Packaging, "sale_price" | "quantity"> & { price: string; qty: string })[]>(
    (product?.packagings ?? []).map((k) => ({ ...k, price: minorToInput(k.sale_price), qty: String(k.quantity).replace(".", ",") })),
  );
  const [busy, setBusy] = useState(false);
  const [scan, setScan] = useState<null | "product" | number>(null);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const showPacks = hasFeature("packagings") || packs.length > 0;

  // Nouveau produit : un code-barres interne est proposé d'emblée (remplaçable par un scan).
  useEffect(() => {
    if (!product) api.generateBarcode().then((c) => setF((x) => (x.barcode ? x : { ...x, barcode: c }))).catch(() => undefined);
  }, [product]);

  const cost = toMinor(f.purchase_price || "0");
  const price = toMinor(f.sale_price || "0");
  const marginRate = price > 0 ? ((price - cost) / price) * 100 : 0;
  const unitKnown = UNIT_GROUPS.some((g) => g.units.includes(f.unit));

  const submit = async () => {
    if (!f.barcode.trim()) return toast.error("Le code-barres est obligatoire : scannez le produit ou générez un code.");
    setBusy(true);
    try {
      // Changer un prix ou désactiver un produit existant demande une confirmation par PIN.
      let pin: string | undefined;
      if (product && (cost !== product.purchase_price || price !== product.sale_price || (product.active && !f.active))) {
        const p = await askPin({
          title: "Modification de prix",
          level: "manager",
          message: <>Prix de vente : {money(product.sale_price)} → <strong>{money(price)}</strong>. Confirmez avec votre code PIN.</>,
        });
        if (!p) return;
        pin = p;
      }
      await api.saveProduct(product?.id ?? null, {
        barcode: f.barcode.trim(),
        name: f.name,
        description: f.description.trim() || null,
        brand: f.brand.trim() || null,
        sku: f.sku.trim() || null,
        category_id: f.category_id,
        supplier_id: f.supplier_id,
        location_id: f.location_id,
        image_id: f.image_id,
        expiry_date: f.expiry_date || null,
        unit: f.unit,
        purchase_price: cost,
        sale_price: price,
        tax_rate: parseNumber(f.tax_rate) || 0,
        min_stock: parseNumber(f.min_stock) || 0,
        track_stock: f.track_stock,
        active: f.active,
        initial_stock: product ? undefined : parseNumber(f.initial_stock) || 0,
        packagings: packs
          .filter((k) => k.name.trim())
          .map((k) => ({ id: k.id, name: k.name.trim(), quantity: parseNumber(k.qty) || 0, barcode: k.barcode?.trim() || null, sale_price: toMinor(k.price || "0") })),
      }, pin);
      toast.success(product ? "Produit modifié." : "Produit créé.");
      onSaved();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };

  const setPack = (i: number, k: string, v: string) => setPacks((l) => l.map((x, j) => (j === i ? { ...x, [k]: v } : x)));

  return (
    <Modal
      title={product ? `Modifier « ${product.name} »` : "Nouveau produit"}
      onClose={onClose}
      width={880}
      footer={
        <>
          <button className="btn" onClick={onClose}>Annuler</button>
          <button className="btn btn-primary" disabled={busy || !f.name.trim()} onClick={submit}>Enregistrer</button>
        </>
      }
    >
      {scan !== null && (
        <CameraScanner
          title={scan === "product" ? "Scanner le code du produit" : "Scanner le code du conditionnement"}
          onCode={(c) => (scan === "product" ? set("barcode", c) : setPack(scan, "barcode", c))}
          onClose={() => setScan(null)}
        />
      )}
      <div className="product-form">
        <div className="product-form-side">
          <ImageField value={f.image_id} onChange={(id) => set("image_id", id)} size={180} />
          <div className="side-box">
            <span className="field-label"><MapPin size={14} /> Emplacement en magasin</span>
            <LocationSelect locations={locations} value={f.location_id} onChange={(id) => set("location_id", id)} />
            {locations.length === 0 && <span className="field-hint">Créez d'abord vos blocs dans « Emplacements ».</span>}
          </div>
        </div>
        <div className="form-grid">
          <Field label="Désignation *" span={2}>
            <input value={f.name} onChange={(e) => set("name", e.target.value)} autoFocus />
          </Field>
          <Field label={<>Code-barres * <HelpTip k="barcode" /></>} hint="Scannez l'emballage (EAN) ou gardez le code interne généré">
            <div className="input-group">
              <input className="mono" value={f.barcode} onChange={(e) => set("barcode", e.target.value)} placeholder="Scanner ou saisir" />
              <button className="btn" type="button" title="Scanner avec la caméra" onClick={() => setScan("product")}>
                <Camera size={16} />
              </button>
              <button className="btn" type="button" title="Générer un nouveau code interne" onClick={() => api.generateBarcode().then((c) => set("barcode", c)).catch(toast.error)}>
                <Wand2 size={16} />
              </button>
            </div>
          </Field>
          <Field label="Unité de vente" hint="Unité de base du stock">
            <select value={f.unit} onChange={(e) => set("unit", e.target.value)}>
              {!unitKnown && <option value={f.unit}>{f.unit}</option>}
              {UNIT_GROUPS.map((g) => (
                <optgroup key={g.label} label={g.label}>
                  {g.units.map((u) => <option key={u} value={u}>{u}</option>)}
                </optgroup>
              ))}
            </select>
          </Field>
          {hasFeature("brand") && (
            <Field label="Marque">
              <input value={f.brand} onChange={(e) => set("brand", e.target.value)} placeholder="Ex. Uncle Ben's, Nestlé…" />
            </Field>
          )}
          {hasFeature("sku") && (
            <Field label={<>Référence interne <HelpTip k="sku" /></>}>
              <input className="mono" value={f.sku} onChange={(e) => set("sku", e.target.value)} placeholder="Ex. RIZ-001" />
            </Field>
          )}
          <Field label="Catégorie / sous-catégorie / famille">
            <CategorySelect categories={categories} value={f.category_id} onChange={(id) => set("category_id", id)} activeOnly />
          </Field>
          <Field label="Fournisseur principal">
            <select value={f.supplier_id ?? ""} onChange={(e) => set("supplier_id", e.target.value ? Number(e.target.value) : null)}>
              <option value="">— Aucun —</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
          <Field label={`Prix d'achat (${currencySymbol()})`}>
            <input inputMode="decimal" value={f.purchase_price} onChange={(e) => set("purchase_price", e.target.value)} />
          </Field>
          <Field label={`Prix de vente TTC (${currencySymbol()}) *`} hint={price > 0 ? `Marge : ${money(price - cost)} (${percent(marginRate)})` : undefined}>
            <input inputMode="decimal" value={f.sale_price} onChange={(e) => set("sale_price", e.target.value)} />
          </Field>
          <Field label="TVA (%)" hint="Prix TTC : la TVA est incluse">
            <input inputMode="decimal" value={f.tax_rate} onChange={(e) => set("tax_rate", e.target.value)} />
          </Field>
          <Field label="Seuil d'alerte de stock">
            <input inputMode="decimal" value={f.min_stock} onChange={(e) => set("min_stock", e.target.value)} />
          </Field>
          {(hasFeature("expiry") || f.expiry_date) && (
            <Field label={<>Date de péremption <HelpTip k="expiry" /></>}>
              <input type="date" value={f.expiry_date} onChange={(e) => set("expiry_date", e.target.value)} />
            </Field>
          )}
          {!product && f.track_stock && (
            <Field label={`Stock initial (${f.unit})`} hint="Ensuite : « Achats / réceptions »">
              <input inputMode="decimal" value={f.initial_stock} onChange={(e) => set("initial_stock", e.target.value)} placeholder="0" />
            </Field>
          )}
          {showPacks && (
            <div className="span-2 packs-box">
              <div className="packs-head">
                <span className="field-label"><Package size={14} /> Conditionnements <HelpTip k="packagings" /></span>
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => setPacks((l) => [...l, { id: null, name: "", qty: "", price: "", barcode: "" }])}
                >
                  <Plus size={13} /> Ajouter
                </button>
              </div>
              {packs.length === 0 ? (
                <p className="muted small">Vendez aussi par carton, sac, pack… Ex. « Carton de 12 » = 12 {f.unit}, avec son propre code-barres et son prix.</p>
              ) : (
                <table className="table compact">
                  <thead>
                    <tr>
                      <th>Nom</th>
                      <th className="num">Contient ({f.unit})</th>
                      <th>Code-barres</th>
                      <th className="num">Prix ({currencySymbol()})</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {packs.map((k, i) => {
                      const q = parseNumber(k.qty) || 0;
                      const unitTotal = q * price;
                      const pp = toMinor(k.price || "0");
                      return (
                        <tr key={i}>
                          <td><input value={k.name} onChange={(e) => setPack(i, "name", e.target.value)} placeholder="Carton de 12" /></td>
                          <td className="num"><input inputMode="decimal" className="num" style={{ width: 80 }} value={k.qty} onChange={(e) => setPack(i, "qty", e.target.value)} placeholder="12" /></td>
                          <td>
                            <div className="input-group">
                              <input className="mono" value={k.barcode ?? ""} onChange={(e) => setPack(i, "barcode", e.target.value)} placeholder="Auto" />
                              <button type="button" className="btn btn-sm" title="Scanner" onClick={() => setScan(i)}><Camera size={13} /></button>
                              <button type="button" className="btn btn-sm" title="Générer" onClick={() => api.generateBarcode().then((c) => setPack(i, "barcode", c)).catch(toast.error)}><Wand2 size={13} /></button>
                            </div>
                          </td>
                          <td className="num">
                            <input inputMode="decimal" className="num" style={{ width: 100 }} value={k.price} onChange={(e) => setPack(i, "price", e.target.value)} placeholder={unitTotal ? minorToInput(unitTotal) : ""} />
                            {pp > 0 && unitTotal > pp && <div className="muted small">−{money(unitTotal - pp)} vs détail</div>}
                          </td>
                          <td><button type="button" className="icon-btn danger" onClick={() => setPacks((l) => l.filter((_, j) => j !== i))}><Trash2 size={14} /></button></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          )}
          <Field label="Description" span={2}>
            <textarea rows={2} value={f.description} onChange={(e) => set("description", e.target.value)} />
          </Field>
          <label className="check span-2">
            <input type="checkbox" checked={f.track_stock} onChange={(e) => set("track_stock", e.target.checked)} />
            Suivre le stock (décocher pour un service, un plat ou un article non stocké)
          </label>
          {product && (
            <label className="check span-2">
              <input type="checkbox" checked={f.active} onChange={(e) => set("active", e.target.checked)} /> Produit actif (proposé à la vente)
            </label>
          )}
        </div>
      </div>
    </Modal>
  );
}
