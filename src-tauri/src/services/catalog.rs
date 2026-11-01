use std::collections::HashMap;

use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};

use crate::db::{self, Query};
use crate::error::{invalid, AppResult};
use crate::services::{audit, locations, media, settings, stock};
use crate::state::SessionUser;

// ───────────────────────────── Catégories ─────────────────────────────
// Arborescence de profondeur illimitée : Catégorie → Sous-catégorie → Famille → … (parent_id).

#[derive(Debug, Clone, Serialize)]
pub struct Category {
    pub id: i64,
    pub parent_id: Option<i64>,
    pub parent_name: Option<String>,
    pub name: String,
    /// Chemin complet « Alimentation › Riz › Riz local ».
    pub path: String,
    /// Profondeur (0 = catégorie principale).
    pub depth: i64,
    pub color: String,
    pub image_id: Option<i64>,
    pub sort_order: i64,
    pub active: bool,
    /// Produits actifs de la catégorie et de toutes ses descendantes.
    pub product_count: i64,
    pub direct_count: i64,
    pub children_count: i64,
}

#[derive(Debug, Deserialize)]
pub struct CategoryInput {
    pub name: String,
    pub color: Option<String>,
    pub image_id: Option<i64>,
    pub parent_id: Option<i64>,
    pub sort_order: Option<i64>,
    pub active: Option<bool>,
}

/// Toutes les catégories, dans l'ordre de l'arbre (chaque catégorie suivie de ses descendantes).
pub fn list_categories(conn: &Connection) -> AppResult<Vec<Category>> {
    let mut stmt = conn.prepare(
        "SELECT c.id, c.parent_id, c.name, c.color, c.image_id, c.sort_order, c.active,
                (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id AND p.active = 1)
         FROM categories c ORDER BY c.sort_order, c.name COLLATE NOCASE",
    )?;
    let raw = stmt
        .query_map([], |r| {
            Ok(Category {
                id: r.get(0)?,
                parent_id: r.get(1)?,
                parent_name: None,
                name: r.get(2)?,
                path: String::new(),
                depth: 0,
                color: r.get(3)?,
                image_id: r.get(4)?,
                sort_order: r.get(5)?,
                active: r.get(6)?,
                product_count: 0,
                direct_count: r.get(7)?,
                children_count: 0,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    let by_id: HashMap<i64, usize> = raw.iter().enumerate().map(|(i, c)| (c.id, i)).collect();
    let mut children: HashMap<Option<i64>, Vec<usize>> = HashMap::new();
    for (i, c) in raw.iter().enumerate() {
        // Un parent introuvable (donnée incohérente) rattache la catégorie à la racine.
        let parent = c.parent_id.filter(|p| by_id.contains_key(p));
        children.entry(parent).or_default().push(i);
    }
    fn subtotal(i: usize, raw: &[Category], children: &HashMap<Option<i64>, Vec<usize>>) -> i64 {
        raw[i].direct_count
            + children.get(&Some(raw[i].id)).map(|v| v.iter().map(|&j| subtotal(j, raw, children)).sum()).unwrap_or(0)
    }
    let mut out = Vec::with_capacity(raw.len());
    let mut seen = std::collections::HashSet::new();
    fn walk(
        i: usize,
        depth: i64,
        prefix: &str,
        parent_name: Option<String>,
        raw: &[Category],
        children: &HashMap<Option<i64>, Vec<usize>>,
        out: &mut Vec<Category>,
        seen: &mut std::collections::HashSet<i64>,
    ) {
        if !seen.insert(raw[i].id) {
            return; // protection contre une boucle
        }
        let mut c = raw[i].clone();
        c.depth = depth;
        c.path = if prefix.is_empty() { c.name.clone() } else { format!("{prefix} › {}", c.name) };
        c.parent_name = parent_name;
        c.children_count = children.get(&Some(c.id)).map(|v| v.len() as i64).unwrap_or(0);
        c.product_count = subtotal(i, raw, children);
        let (path, name) = (c.path.clone(), c.name.clone());
        out.push(c);
        if let Some(kids) = children.get(&Some(raw[i].id)) {
            for &k in kids {
                walk(k, depth + 1, &path, Some(name.clone()), raw, children, out, seen);
            }
        }
    }
    for &i in children.get(&None).map(|v| v.as_slice()).unwrap_or(&[]) {
        walk(i, 0, "", None, &raw, &children, &mut out, &mut seen);
    }
    Ok(out)
}

/// Identifiants d'une catégorie et de toutes ses descendantes.
pub fn descendants(conn: &Connection, id: i64) -> AppResult<Vec<i64>> {
    let mut stmt = conn.prepare(
        "WITH RECURSIVE sub(id) AS (SELECT ?1 UNION SELECT c.id FROM categories c JOIN sub ON c.parent_id = sub.id) SELECT id FROM sub",
    )?;
    let rows = stmt.query_map([id], |r| r.get(0))?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

pub fn save_category(conn: &Connection, user: &SessionUser, id: Option<i64>, input: CategoryInput) -> AppResult<i64> {
    let name = input.name.trim();
    if name.is_empty() {
        return invalid("Le nom de la catégorie est obligatoire.");
    }
    if let (Some(id), Some(parent)) = (id, input.parent_id) {
        // Déplacement : interdit de placer une catégorie dans elle-même ou dans une de ses descendantes.
        if descendants(conn, id)?.contains(&parent) {
            return invalid("Impossible de déplacer une catégorie dans elle-même ou dans une de ses sous-catégories.");
        }
    }
    let color = db::clean(&input.color).unwrap_or_else(|| "#64748b".into());
    let order = input.sort_order.unwrap_or(0);
    let active = input.active.unwrap_or(true);
    let id = match id {
        Some(id) => {
            let old: Option<i64> = conn.query_row("SELECT image_id FROM categories WHERE id = ?1", [id], |r| r.get(0))?;
            conn.execute(
                "UPDATE categories SET name = ?1, color = ?2, image_id = ?3, parent_id = ?4, sort_order = ?5, active = ?6 WHERE id = ?7",
                params![name, color, input.image_id, input.parent_id, order, active, id],
            )?;
            if old != input.image_id {
                media::cleanup(conn, old)?;
            }
            id
        }
        None => {
            conn.execute(
                "INSERT INTO categories (name, color, image_id, parent_id, sort_order, active) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![name, color, input.image_id, input.parent_id, order, active],
            )?;
            conn.last_insert_rowid()
        }
    };
    audit::log(conn, user, "Enregistrement de catégorie", "category", Some(id), name)?;
    Ok(id)
}

/// Active ou masque une catégorie (et toutes ses sous-catégories).
pub fn set_category_active(conn: &Connection, user: &SessionUser, id: i64, active: bool) -> AppResult<()> {
    for c in descendants(conn, id)? {
        conn.execute("UPDATE categories SET active = ?1 WHERE id = ?2", params![active, c])?;
    }
    audit::log(conn, user, if active { "Activation de catégorie" } else { "Masquage de catégorie" }, "category", Some(id), "")?;
    Ok(())
}

/// Supprime une catégorie et toute sa descendance ; leurs produits deviennent « sans catégorie ».
pub fn delete_category(conn: &mut Connection, user: &SessionUser, id: i64) -> AppResult<()> {
    let tx = conn.transaction()?;
    let name: String = tx.query_row("SELECT name FROM categories WHERE id = ?1", [id], |r| r.get(0))?;
    let ids = descendants(&tx, id)?;
    let mut images = Vec::new();
    for c in ids.iter().rev() {
        let img: Option<i64> = tx.query_row("SELECT image_id FROM categories WHERE id = ?1", [c], |r| r.get(0))?;
        images.push(img);
        tx.execute("UPDATE products SET category_id = NULL WHERE category_id = ?1", [c])?;
        tx.execute("UPDATE categories SET parent_id = NULL WHERE id = ?1", [c])?;
    }
    for c in &ids {
        tx.execute("DELETE FROM categories WHERE id = ?1", [c])?;
    }
    for img in images {
        media::cleanup(&tx, img)?;
    }
    audit::log(&tx, user, "Suppression de catégorie", "category", Some(id), format!("{name} ({} catégorie(s))", ids.len()))?;
    tx.commit()?;
    Ok(())
}

fn find_or_create_category(conn: &Connection, name: &str, parent: Option<i64>) -> AppResult<Option<i64>> {
    let name = name.trim();
    if name.is_empty() {
        return Ok(parent);
    }
    Ok(Some(crate::services::templates::find_or_create(conn, name, parent, "#64748b", 0)?.0))
}

// ───────────────────────────── Produits ─────────────────────────────

#[derive(Debug, Serialize)]
pub struct Product {
    pub id: i64,
    pub barcode: Option<String>,
    pub name: String,
    pub description: Option<String>,
    pub category_id: Option<i64>,
    pub category_name: Option<String>,
    pub category_color: Option<String>,
    /// Catégorie principale quand le produit est rangé dans une sous-catégorie.
    pub parent_category_id: Option<i64>,
    pub parent_category_name: Option<String>,
    pub supplier_id: Option<i64>,
    pub supplier_name: Option<String>,
    pub unit: String,
    pub purchase_price: i64,
    pub sale_price: i64,
    pub tax_rate: f64,
    pub stock: f64,
    pub min_stock: f64,
    pub track_stock: bool,
    pub active: bool,
    pub image_id: Option<i64>,
    pub location_id: Option<i64>,
    pub bloc: Option<String>,
    pub etage: Option<String>,
    pub rangee: Option<String>,
    pub location_label: Option<String>,
    pub expiry_date: Option<String>,
    pub brand: Option<String>,
    /// Référence interne (ex. RIZ-001).
    pub sku: Option<String>,
    /// Chemin complet de la catégorie « Alimentation › Riz › Riz local ».
    pub category_path: Option<String>,
    /// Conditionnements (carton, sac…) avec leur propre code-barres et prix.
    pub packagings: Vec<Packaging>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Packaging {
    pub id: Option<i64>,
    pub name: String,
    /// Nombre d'unités de base contenues (ex. 12 bouteilles, 50 kg).
    pub quantity: f64,
    pub barcode: Option<String>,
    pub sale_price: i64,
}

const PRODUCT_SELECT: &str = "SELECT p.id, p.barcode, p.name, p.description, p.category_id, c.name,
        COALESCE(pc.color, c.color), pc.id, pc.name, p.supplier_id, s.name, p.unit, p.purchase_price, p.sale_price, p.tax_rate, p.stock,
        p.min_stock, p.track_stock, p.active, p.image_id, p.location_id, l.bloc, l.etage, l.rangee, l.label,
        p.expiry_date, p.created_at, p.updated_at, p.brand, p.sku
    FROM products p
    LEFT JOIN categories c ON c.id = p.category_id
    LEFT JOIN categories pc ON pc.id = c.parent_id
    LEFT JOIN suppliers s ON s.id = p.supplier_id
    LEFT JOIN locations l ON l.id = p.location_id";

fn product_from_row(r: &Row) -> rusqlite::Result<Product> {
    Ok(Product {
        id: r.get(0)?,
        barcode: r.get(1)?,
        name: r.get(2)?,
        description: r.get(3)?,
        category_id: r.get(4)?,
        category_name: r.get(5)?,
        category_color: r.get(6)?,
        parent_category_id: r.get(7)?,
        parent_category_name: r.get(8)?,
        supplier_id: r.get(9)?,
        supplier_name: r.get(10)?,
        unit: r.get(11)?,
        purchase_price: r.get(12)?,
        sale_price: r.get(13)?,
        tax_rate: r.get(14)?,
        stock: r.get(15)?,
        min_stock: r.get(16)?,
        track_stock: r.get(17)?,
        active: r.get(18)?,
        image_id: r.get(19)?,
        location_id: r.get(20)?,
        bloc: r.get(21)?,
        etage: r.get(22)?,
        rangee: r.get(23)?,
        location_label: r.get(24)?,
        expiry_date: r.get(25)?,
        created_at: r.get(26)?,
        updated_at: r.get(27)?,
        brand: r.get(28)?,
        sku: r.get(29)?,
        category_path: None,
        packagings: Vec::new(),
    })
}

#[derive(Debug, Default, Deserialize)]
pub struct ProductFilter {
    pub search: Option<String>,
    pub category_id: Option<i64>,
    pub supplier_id: Option<i64>,
    pub location_id: Option<i64>,
    pub bloc: Option<String>,
    pub without_location: Option<bool>,
    /// Produits sans catégorie.
    pub without_category: Option<bool>,
    pub low_stock: Option<bool>,
    /// Produits dont la date de péremption tombe dans les N prochains jours (ou est dépassée).
    pub expiring_days: Option<i64>,
    pub include_inactive: Option<bool>,
    pub limit: Option<i64>,
}

#[derive(Debug, Deserialize)]
pub struct ProductInput {
    pub barcode: Option<String>,
    pub name: String,
    pub description: Option<String>,
    pub category_id: Option<i64>,
    pub supplier_id: Option<i64>,
    pub unit: Option<String>,
    pub purchase_price: i64,
    pub sale_price: i64,
    pub tax_rate: Option<f64>,
    pub min_stock: Option<f64>,
    pub track_stock: Option<bool>,
    pub active: Option<bool>,
    pub image_id: Option<i64>,
    pub location_id: Option<i64>,
    pub expiry_date: Option<String>,
    pub brand: Option<String>,
    pub sku: Option<String>,
    /// Liste complète des conditionnements (remplace l'existante si fournie).
    pub packagings: Option<Vec<Packaging>>,
    /// Uniquement à la création.
    pub initial_stock: Option<f64>,
}

pub fn list_products(conn: &Connection, f: &ProductFilter) -> AppResult<Vec<Product>> {
    let mut q = Query::new(PRODUCT_SELECT);
    if !f.include_inactive.unwrap_or(false) {
        q.and("p.active = 1", vec![]);
    }
    if let Some(s) = db::clean(&f.search) {
        // Chaque mot doit apparaître (dans le nom, le code-barres, la description ou la catégorie).
        for word in s.split_whitespace().take(6) {
            let like = format!("%{word}%");
            q.and(
                "(p.name LIKE ? OR p.barcode LIKE ? OR p.description LIKE ? OR c.name LIKE ? OR pc.name LIKE ? OR p.brand LIKE ? OR p.sku LIKE ?
                  OR EXISTS (SELECT 1 FROM product_packagings pk WHERE pk.product_id = p.id AND pk.barcode LIKE ?))",
                vec![db::text(&like), db::text(&like), db::text(&like), db::text(&like), db::text(&like), db::text(&like), db::text(&like), db::text(&like)],
            );
        }
    }
    if let Some(c) = f.category_id {
        // Une catégorie inclut les produits de toutes ses sous-catégories (tous niveaux).
        q.and(
            "p.category_id IN (WITH RECURSIVE sub(id) AS (SELECT ? UNION SELECT c2.id FROM categories c2 JOIN sub ON c2.parent_id = sub.id) SELECT id FROM sub)",
            vec![db::int(c)],
        );
    }
    if let Some(s) = f.supplier_id {
        q.and("p.supplier_id = ?", vec![db::int(s)]);
    }
    if let Some(l) = f.location_id {
        q.and("p.location_id = ?", vec![db::int(l)]);
    }
    if let Some(b) = db::clean(&f.bloc) {
        q.and("l.bloc = ?", vec![db::text(b)]);
    }
    if f.without_category.unwrap_or(false) {
        q.and("p.category_id IS NULL", vec![]);
    }
    if f.without_location.unwrap_or(false) {
        q.and("p.location_id IS NULL", vec![]);
    }
    if f.low_stock.unwrap_or(false) {
        q.and("p.track_stock = 1 AND p.stock <= p.min_stock", vec![]);
    }
    if let Some(days) = f.expiring_days {
        q.and(
            "p.expiry_date IS NOT NULL AND p.expiry_date <> '' AND p.expiry_date <= date('now', 'localtime', ?) AND p.stock > 0",
            vec![db::text(format!("+{} days", days.max(0)))],
        );
        q.tail("ORDER BY p.expiry_date LIMIT ?", vec![db::int(f.limit.unwrap_or(1000).clamp(1, 20000))]);
    } else {
        q.tail("ORDER BY p.name COLLATE NOCASE LIMIT ?", vec![db::int(f.limit.unwrap_or(1000).clamp(1, 20000))]);
    }
    let mut stmt = conn.prepare(&q.sql)?;
    let mut list = stmt.query_map(q.params(), product_from_row)?.collect::<Result<Vec<_>, _>>()?;
    enrich(conn, &mut list)?;
    Ok(list)
}

/// Ajoute à chaque produit le chemin de sa catégorie et ses conditionnements.
fn enrich(conn: &Connection, list: &mut [Product]) -> AppResult<()> {
    if list.is_empty() {
        return Ok(());
    }
    let paths: HashMap<i64, String> = list_categories(conn)?.into_iter().map(|c| (c.id, c.path)).collect();
    let mut packs: HashMap<i64, Vec<Packaging>> = HashMap::new();
    let mut stmt = conn.prepare("SELECT product_id, id, name, quantity, barcode, sale_price FROM product_packagings ORDER BY quantity")?;
    let rows = stmt.query_map([], |r| {
        Ok((r.get::<_, i64>(0)?, Packaging { id: r.get(1)?, name: r.get(2)?, quantity: r.get(3)?, barcode: r.get(4)?, sale_price: r.get(5)? }))
    })?;
    for row in rows {
        let (pid, pack) = row?;
        packs.entry(pid).or_default().push(pack);
    }
    for p in list.iter_mut() {
        p.category_path = p.category_id.and_then(|c| paths.get(&c).cloned());
        p.packagings = packs.remove(&p.id).unwrap_or_default();
    }
    Ok(())
}

pub fn get_product(conn: &Connection, id: i64) -> AppResult<Product> {
    let mut p = [conn.query_row(&format!("{PRODUCT_SELECT} WHERE p.id = ?1"), [id], product_from_row)?];
    enrich(conn, &mut p)?;
    let [p] = p;
    Ok(p)
}

pub fn find_by_barcode(conn: &Connection, code: &str) -> AppResult<Option<Product>> {
    Ok(scan(conn, code)?.map(|s| s.product))
}

#[derive(Debug, Serialize)]
pub struct ScanResult {
    pub product: Product,
    /// Renseigné si le code scanné est celui d'un conditionnement (carton, sac…).
    pub packaging: Option<Packaging>,
}

/// Recherche par code scanné ou saisi : code du produit, puis code d'un conditionnement.
pub fn scan(conn: &Connection, code: &str) -> AppResult<Option<ScanResult>> {
    let code = code.trim();
    if code.is_empty() {
        return Ok(None);
    }
    let id: Option<i64> = conn.query_row("SELECT id FROM products WHERE barcode = ?1 AND active = 1", [code], |r| r.get(0)).optional()?;
    if let Some(id) = id {
        return Ok(Some(ScanResult { product: get_product(conn, id)?, packaging: None }));
    }
    let pack: Option<(i64, i64)> = conn
        .query_row(
            "SELECT pk.product_id, pk.id FROM product_packagings pk JOIN products p ON p.id = pk.product_id WHERE pk.barcode = ?1 AND p.active = 1",
            [code],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()?;
    match pack {
        Some((pid, pack_id)) => {
            let product = get_product(conn, pid)?;
            let packaging = product.packagings.iter().find(|p| p.id == Some(pack_id)).cloned();
            Ok(Some(ScanResult { product, packaging }))
        }
        None => Ok(None),
    }
}

/// Vérifie qu'un code-barres n'est utilisé par aucun autre produit ni conditionnement.
fn ensure_barcode_free(conn: &Connection, code: &str, product_id: Option<i64>, packaging_id: Option<i64>) -> AppResult<()> {
    let product: Option<String> = conn
        .query_row("SELECT name FROM products WHERE barcode = ?1 AND id <> ?2", params![code, product_id.unwrap_or(0)], |r| r.get(0))
        .optional()?;
    if let Some(name) = product {
        return invalid(format!("Le code-barres {code} est déjà utilisé par « {name} »."));
    }
    let pack: Option<String> = conn
        .query_row(
            "SELECT p.name || ' (' || pk.name || ')' FROM product_packagings pk JOIN products p ON p.id = pk.product_id
             WHERE pk.barcode = ?1 AND pk.id <> ?2",
            params![code, packaging_id.unwrap_or(0)],
            |r| r.get(0),
        )
        .optional()?;
    if let Some(name) = pack {
        return invalid(format!("Le code-barres {code} est déjà utilisé par « {name} »."));
    }
    Ok(())
}

/// Donne un code-barres interne à chaque produit qui n'en a pas (le code-barres est obligatoire).
pub fn fill_missing_barcodes(conn: &Connection) -> AppResult<i64> {
    let ids: Vec<i64> = {
        let mut stmt = conn.prepare("SELECT id FROM products WHERE barcode IS NULL OR TRIM(barcode) = ''")?;
        let rows = stmt.query_map([], |r| r.get(0))?.collect::<Result<Vec<_>, _>>()?;
        rows
    };
    for id in &ids {
        let code = generate_barcode(conn)?;
        conn.execute("UPDATE products SET barcode = ?1 WHERE id = ?2", params![code, id])?;
    }
    Ok(ids.len() as i64)
}

fn save_packagings(conn: &Connection, product_id: i64, packs: &[Packaging]) -> AppResult<()> {
    let keep: Vec<i64> = packs.iter().filter_map(|p| p.id).collect();
    let existing: Vec<i64> = {
        let mut stmt = conn.prepare("SELECT id FROM product_packagings WHERE product_id = ?1")?;
        let rows = stmt.query_map([product_id], |r| r.get(0))?.collect::<Result<Vec<_>, _>>()?;
        rows
    };
    for id in existing.iter().filter(|id| !keep.contains(id)) {
        conn.execute("DELETE FROM product_packagings WHERE id = ?1", [id])?;
    }
    for p in packs {
        let name = p.name.trim();
        if name.is_empty() {
            return invalid("Chaque conditionnement doit avoir un nom (ex. Carton de 12).");
        }
        if !(p.quantity > 0.0) {
            return invalid(format!("Conditionnement « {name} » : la quantité contenue doit être supérieure à zéro."));
        }
        if p.sale_price < 0 {
            return invalid("Le prix d'un conditionnement ne peut pas être négatif.");
        }
        let barcode = match db::clean(&p.barcode) {
            Some(b) => b,
            None => generate_barcode(conn)?,
        };
        ensure_barcode_free(conn, &barcode, Some(-1), p.id)?;
        let product_code: Option<String> = conn.query_row("SELECT barcode FROM products WHERE id = ?1", [product_id], |r| r.get(0))?;
        if product_code.as_deref() == Some(barcode.as_str()) {
            return invalid("Un conditionnement doit avoir un code-barres différent de celui du produit.");
        }
        match p.id.filter(|id| existing.contains(id)) {
            Some(id) => {
                conn.execute(
                    "UPDATE product_packagings SET name = ?1, quantity = ?2, barcode = ?3, sale_price = ?4 WHERE id = ?5",
                    params![name, db::round_qty(p.quantity), barcode, p.sale_price, id],
                )?;
            }
            None => {
                conn.execute(
                    "INSERT INTO product_packagings (product_id, name, quantity, barcode, sale_price) VALUES (?1, ?2, ?3, ?4, ?5)",
                    params![product_id, name, db::round_qty(p.quantity), barcode, p.sale_price],
                )?;
            }
        }
    }
    Ok(())
}

fn valid_date(d: &Option<String>) -> AppResult<Option<String>> {
    match db::clean(d) {
        None => Ok(None),
        Some(s) => {
            if chrono::NaiveDate::parse_from_str(&s, "%Y-%m-%d").is_err() {
                return invalid("Date de péremption invalide (format AAAA-MM-JJ).");
            }
            Ok(Some(s))
        }
    }
}

fn validate_product(input: &ProductInput) -> AppResult<()> {
    if input.name.trim().is_empty() {
        return invalid("Le nom du produit est obligatoire.");
    }
    if input.sale_price < 0 || input.purchase_price < 0 {
        return invalid("Les prix ne peuvent pas être négatifs.");
    }
    let tax = input.tax_rate.unwrap_or(0.0);
    if !(0.0..=100.0).contains(&tax) {
        return invalid("Le taux de TVA doit être compris entre 0 et 100 %.");
    }
    if input.min_stock.unwrap_or(0.0) < 0.0 {
        return invalid("Le stock d'alerte ne peut pas être négatif.");
    }
    if input.initial_stock.unwrap_or(0.0) < 0.0 {
        return invalid("Le stock initial ne peut pas être négatif.");
    }
    Ok(())
}

pub fn save_product(conn: &mut Connection, user: &SessionUser, id: Option<i64>, input: ProductInput) -> AppResult<Product> {
    validate_product(&input)?;
    let expiry = valid_date(&input.expiry_date)?;
    let unit = db::clean(&input.unit).unwrap_or_else(|| "pce".into());
    let now = db::now();
    let tx = conn.transaction()?;
    // Code-barres obligatoire (EAN, UPC, Code 128 ou contenu d'un QR code) : généré s'il manque.
    let barcode = match db::clean(&input.barcode) {
        Some(b) if b.chars().count() > 200 => return invalid("Code-barres trop long (200 caractères maximum)."),
        Some(b) => b,
        None => generate_barcode(&tx)?,
    };
    ensure_barcode_free(&tx, &barcode, id, Some(-1))?;

    let product_id = match id {
        Some(id) => {
            let old_image: Option<i64> = tx.query_row("SELECT image_id FROM products WHERE id = ?1", [id], |r| r.get(0))?;
            tx.execute(
                "UPDATE products SET barcode = ?1, name = ?2, description = ?3, category_id = ?4,
                    supplier_id = ?5, unit = ?6, purchase_price = ?7, sale_price = ?8, tax_rate = ?9,
                    min_stock = ?10, track_stock = ?11, active = ?12, image_id = ?13, location_id = ?14,
                    expiry_date = ?15, updated_at = ?16
                 WHERE id = ?17",
                params![
                    barcode,
                    input.name.trim(),
                    db::clean(&input.description),
                    input.category_id,
                    input.supplier_id,
                    unit,
                    input.purchase_price,
                    input.sale_price,
                    input.tax_rate.unwrap_or(0.0),
                    input.min_stock.unwrap_or(0.0),
                    input.track_stock.unwrap_or(true),
                    input.active.unwrap_or(true),
                    input.image_id,
                    input.location_id,
                    expiry,
                    now,
                    id
                ],
            )?;
            if old_image != input.image_id {
                media::cleanup(&tx, old_image)?;
            }
            audit::log(&tx, user, "Modification de produit", "product", Some(id), input.name.trim())?;
            id
        }
        None => {
            tx.execute(
                "INSERT INTO products (barcode, name, description, category_id, supplier_id, unit,
                    purchase_price, sale_price, tax_rate, stock, min_stock, track_stock, active,
                    image_id, location_id, expiry_date, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 0, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?16)",
                params![
                    barcode,
                    input.name.trim(),
                    db::clean(&input.description),
                    input.category_id,
                    input.supplier_id,
                    unit,
                    input.purchase_price,
                    input.sale_price,
                    input.tax_rate.unwrap_or(0.0),
                    input.min_stock.unwrap_or(0.0),
                    input.track_stock.unwrap_or(true),
                    input.active.unwrap_or(true),
                    input.image_id,
                    input.location_id,
                    expiry,
                    now
                ],
            )?;
            let new_id = tx.last_insert_rowid();
            let initial = db::round_qty(input.initial_stock.unwrap_or(0.0));
            if initial > 0.0 {
                stock::apply_change(&tx, new_id, initial, "initial", Some(input.purchase_price), None, Some("Stock initial"), user.id)?;
            }
            audit::log(&tx, user, "Création de produit", "product", Some(new_id), input.name.trim())?;
            new_id
        }
    };
    tx.execute(
        "UPDATE products SET brand = ?1, sku = ?2 WHERE id = ?3",
        params![db::clean(&input.brand), db::clean(&input.sku), product_id],
    )?;
    if let Some(packs) = &input.packagings {
        save_packagings(&tx, product_id, packs)?;
    }
    tx.commit()?;
    get_product(conn, product_id)
}

pub fn archive_product(conn: &Connection, user: &SessionUser, id: i64) -> AppResult<()> {
    let name: String = conn.query_row("SELECT name FROM products WHERE id = ?1", [id], |r| r.get(0))?;
    conn.execute("UPDATE products SET active = 0, updated_at = ?1 WHERE id = ?2", params![db::now(), id])?;
    audit::log(conn, user, "Archivage de produit", "product", Some(id), name)?;
    Ok(())
}

/// Calcule la clé de contrôle EAN-13 pour 12 chiffres.
pub fn ean13_check_digit(digits12: &str) -> u32 {
    let sum: u32 = digits12
        .chars()
        .filter_map(|c| c.to_digit(10))
        .enumerate()
        .map(|(i, d)| if i % 2 == 0 { d } else { d * 3 })
        .sum();
    (10 - sum % 10) % 10
}

/// Génère un code EAN-13 interne (préfixe 20 réservé à l'usage en magasin) non encore utilisé.
pub fn generate_barcode(conn: &Connection) -> AppResult<String> {
    let mut seq = settings::get_i64(conn, "barcode_seq")?;
    loop {
        seq += 1;
        let base = format!("20{seq:010}");
        let code = format!("{base}{}", ean13_check_digit(&base));
        let used: bool = conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM products WHERE barcode = ?1) OR EXISTS(SELECT 1 FROM product_packagings WHERE barcode = ?1)",
            [&code],
            |r| r.get(0),
        )?;
        if !used {
            settings::set(conn, "barcode_seq", &seq.to_string())?;
            return Ok(code);
        }
    }
}

// ───────────────────────────── Import (CSV / Excel) ─────────────────────────────

#[derive(Debug, Deserialize)]
pub struct ImportRow {
    pub barcode: Option<String>,
    pub name: String,
    pub category: Option<String>,
    pub subcategory: Option<String>,
    pub brand: Option<String>,
    pub sku: Option<String>,
    pub unit: Option<String>,
    pub purchase_price: Option<i64>,
    pub sale_price: Option<i64>,
    pub tax_rate: Option<f64>,
    pub stock: Option<f64>,
    pub min_stock: Option<f64>,
    pub bloc: Option<String>,
    pub etage: Option<String>,
    pub rangee: Option<String>,
    pub expiry_date: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct ImportResult {
    pub created: i64,
    pub updated: i64,
    pub errors: Vec<String>,
}

/// Importe ou met à jour des produits (rapprochement par code-barres, sinon par nom exact).
/// Une colonne « stock » renseignée fixe le stock (mouvement d'inventaire tracé).
pub fn import_products(conn: &mut Connection, user: &SessionUser, rows: Vec<ImportRow>) -> AppResult<ImportResult> {
    if rows.len() > 20000 {
        return invalid("Fichier trop volumineux (20 000 lignes maximum).");
    }
    let mut result = ImportResult { created: 0, updated: 0, errors: Vec::new() };
    let tx = conn.transaction()?;
    let now = db::now();
    for (i, row) in rows.into_iter().enumerate() {
        let line = i + 2; // ligne 1 = en-têtes
        let name = row.name.trim();
        if name.is_empty() {
            result.errors.push(format!("Ligne {line} : désignation manquante."));
            continue;
        }
        if row.sale_price.unwrap_or(0) < 0 || row.purchase_price.unwrap_or(0) < 0 {
            result.errors.push(format!("Ligne {line} : prix négatif."));
            continue;
        }
        let expiry = match valid_date(&row.expiry_date) {
            Ok(d) => d,
            Err(_) => {
                result.errors.push(format!("Ligne {line} : date de péremption invalide (AAAA-MM-JJ)."));
                continue;
            }
        };
        let barcode = db::clean(&row.barcode);
        let existing: Option<i64> = match &barcode {
            Some(code) => tx.query_row("SELECT id FROM products WHERE barcode = ?1", [code], |r| r.get(0)).optional()?,
            None => tx.query_row("SELECT id FROM products WHERE name = ?1 COLLATE NOCASE", [name], |r| r.get(0)).optional()?,
        };
        // « Épicerie > Riz » dans la colonne catégorie, ou colonnes séparées catégorie / sous-catégorie.
        // Chemin « Alimentation > Riz > Riz local » (tous niveaux), éventuellement complété par la colonne sous-catégorie.
        let mut parts: Vec<String> = row.category.as_deref().unwrap_or("").split('>').map(|p| p.trim().to_string()).filter(|p| !p.is_empty()).collect();
        if let Some(sub) = db::clean(&row.subcategory) {
            parts.extend(sub.split('>').map(|p| p.trim().to_string()).filter(|p| !p.is_empty()));
        }
        let mut category_id: Option<i64> = None;
        for part in &parts {
            category_id = find_or_create_category(&tx, part, category_id)?;
        }
        let location_id = match &row.bloc {
            Some(b) => locations::find_or_create(
                &tx,
                b,
                row.etage.as_deref().unwrap_or(""),
                row.rangee.as_deref().unwrap_or(""),
            )?,
            None => None,
        };

        let product_id = match existing {
            Some(id) => {
                tx.execute(
                    "UPDATE products SET name = ?1,
                        category_id = COALESCE(?2, category_id),
                        unit = COALESCE(?3, unit),
                        purchase_price = COALESCE(?4, purchase_price),
                        sale_price = COALESCE(?5, sale_price),
                        tax_rate = COALESCE(?6, tax_rate),
                        min_stock = COALESCE(?7, min_stock),
                        location_id = COALESCE(?8, location_id),
                        expiry_date = COALESCE(?9, expiry_date),
                        active = 1, updated_at = ?10
                     WHERE id = ?11",
                    params![
                        name,
                        category_id,
                        db::clean(&row.unit),
                        row.purchase_price,
                        row.sale_price,
                        row.tax_rate,
                        row.min_stock,
                        location_id,
                        expiry,
                        now,
                        id
                    ],
                )?;
                result.updated += 1;
                id
            }
            None => {
                tx.execute(
                    "INSERT INTO products (barcode, name, category_id, unit, purchase_price, sale_price, tax_rate,
                        stock, min_stock, location_id, expiry_date, created_at, updated_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 0, ?8, ?9, ?10, ?11, ?11)",
                    params![
                        match &barcode { Some(b) => b.clone(), None => generate_barcode(&tx)? },
                        name,
                        category_id,
                        db::clean(&row.unit).unwrap_or_else(|| "pce".into()),
                        row.purchase_price.unwrap_or(0),
                        row.sale_price.unwrap_or(0),
                        row.tax_rate.unwrap_or(0.0),
                        row.min_stock.unwrap_or(0.0),
                        location_id,
                        expiry,
                        now
                    ],
                )?;
                result.created += 1;
                tx.last_insert_rowid()
            }
        };

        if db::clean(&row.brand).is_some() || db::clean(&row.sku).is_some() {
            tx.execute(
                "UPDATE products SET brand = COALESCE(?1, brand), sku = COALESCE(?2, sku) WHERE id = ?3",
                params![db::clean(&row.brand), db::clean(&row.sku), product_id],
            )?;
        }
        if let Some(target) = row.stock {
            let current: f64 = tx.query_row("SELECT stock FROM products WHERE id = ?1", [product_id], |r| r.get(0))?;
            let delta = db::round_qty(target - current);
            if delta != 0.0 {
                let kind = if existing.is_some() { "adjustment" } else { "initial" };
                stock::apply_change(&tx, product_id, delta, kind, row.purchase_price, None, Some("Import de produits"), user.id)?;
            }
        }
    }
    audit::log(
        &tx,
        user,
        "Import de produits",
        "product",
        None,
        format!("{} créé(s), {} mis à jour, {} erreur(s)", result.created, result.updated, result.errors.len()),
    )?;
    tx.commit()?;
    Ok(result)
}
