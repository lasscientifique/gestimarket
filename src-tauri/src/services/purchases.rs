use rusqlite::{params, Connection, Row};
use serde::{Deserialize, Serialize};

use crate::db::{self, Query};
use crate::error::{invalid, AppResult};
use crate::services::{audit, stock};
use crate::state::SessionUser;

#[derive(Debug, Deserialize)]
pub struct PurchaseItemInput {
    pub product_id: i64,
    pub quantity: f64,
    pub unit_cost: i64,
    /// Date de péremption du lot reçu (AAAA-MM-JJ).
    pub expiry_date: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct PurchaseInput {
    pub supplier_id: Option<i64>,
    pub items: Vec<PurchaseItemInput>,
    pub note: Option<String>,
    /// Met à jour le prix d'achat des produits au coût moyen unitaire pondéré (CMUP).
    pub update_costs: Option<bool>,
    /// Nouveaux prix de vente éventuels (product_id → prix).
    pub new_sale_prices: Option<Vec<(i64, i64)>>,
}

#[derive(Debug, Serialize)]
pub struct PurchaseItem {
    pub id: i64,
    pub product_id: i64,
    pub product_name: String,
    pub quantity: f64,
    pub unit_cost: i64,
    pub total: i64,
    pub expiry_date: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct Purchase {
    pub id: i64,
    pub number: String,
    pub supplier_id: Option<i64>,
    pub supplier_name: Option<String>,
    pub user_name: String,
    pub total: i64,
    pub note: Option<String>,
    pub created_at: String,
    pub items_count: i64,
    pub items: Vec<PurchaseItem>,
}

const PURCHASE_SELECT: &str = "SELECT pu.id, pu.number, pu.supplier_id, s.name, u.full_name, pu.total, pu.note, pu.created_at,
        (SELECT COUNT(*) FROM purchase_items pi WHERE pi.purchase_id = pu.id)
    FROM purchases pu
    JOIN users u ON u.id = pu.user_id
    LEFT JOIN suppliers s ON s.id = pu.supplier_id";

fn purchase_from_row(r: &Row) -> rusqlite::Result<Purchase> {
    Ok(Purchase {
        id: r.get(0)?,
        number: r.get(1)?,
        supplier_id: r.get(2)?,
        supplier_name: r.get(3)?,
        user_name: r.get(4)?,
        total: r.get(5)?,
        note: r.get(6)?,
        created_at: r.get(7)?,
        items_count: r.get(8)?,
        items: Vec::new(),
    })
}

pub fn get_purchase(conn: &Connection, id: i64) -> AppResult<Purchase> {
    let mut p = conn.query_row(&format!("{PURCHASE_SELECT} WHERE pu.id = ?1"), [id], purchase_from_row)?;
    let mut stmt = conn.prepare(
        "SELECT id, product_id, product_name, quantity, unit_cost, total, expiry_date FROM purchase_items WHERE purchase_id = ?1 ORDER BY id",
    )?;
    p.items = stmt
        .query_map([id], |r| {
            Ok(PurchaseItem {
                id: r.get(0)?,
                product_id: r.get(1)?,
                product_name: r.get(2)?,
                quantity: r.get(3)?,
                unit_cost: r.get(4)?,
                total: r.get(5)?,
                expiry_date: r.get(6)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(p)
}

/// Réception de marchandises : entrée en stock et mise à jour optionnelle des coûts.
pub fn create_purchase(conn: &mut Connection, user: &SessionUser, input: PurchaseInput) -> AppResult<Purchase> {
    if input.items.is_empty() {
        return invalid("Ajoutez au moins un produit.");
    }
    for item in &input.items {
        if item.quantity <= 0.0 || !item.quantity.is_finite() {
            return invalid("Les quantités doivent être supérieures à zéro.");
        }
        if item.unit_cost < 0 {
            return invalid("Les coûts ne peuvent pas être négatifs.");
        }
        if let Some(d) = db::clean(&item.expiry_date) {
            if chrono::NaiveDate::parse_from_str(&d, "%Y-%m-%d").is_err() {
                return invalid("Date de péremption invalide.");
            }
        }
    }
    let update_costs = input.update_costs.unwrap_or(true);
    let tx = conn.transaction()?;
    let number = db::next_number(&tx, "purchases", "A")?;
    let now = db::now();
    let total: i64 = input.items.iter().map(|i| (i.quantity * i.unit_cost as f64).round() as i64).sum();
    tx.execute(
        "INSERT INTO purchases (number, supplier_id, user_id, total, note, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![number, input.supplier_id, user.id, total, db::clean(&input.note), now],
    )?;
    let purchase_id = tx.last_insert_rowid();

    for item in &input.items {
        let qty = db::round_qty(item.quantity);
        let (name, old_stock, old_cost): (String, f64, i64) = tx.query_row(
            "SELECT name, stock, purchase_price FROM products WHERE id = ?1",
            [item.product_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )?;
        let line_total = (qty * item.unit_cost as f64).round() as i64;
        tx.execute(
            "INSERT INTO purchase_items (purchase_id, product_id, product_name, quantity, unit_cost, total, expiry_date)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![purchase_id, item.product_id, name, qty, item.unit_cost, line_total, db::clean(&item.expiry_date)],
        )?;
        if let Some(expiry) = db::clean(&item.expiry_date) {
            // On garde la date la plus proche tant que l'ancien stock n'est pas écoulé.
            tx.execute(
                "UPDATE products SET expiry_date = CASE
                    WHEN ?1 > 0 AND expiry_date IS NOT NULL AND expiry_date <> '' AND expiry_date < ?2 THEN expiry_date
                    ELSE ?2 END
                 WHERE id = ?3",
                params![old_stock, expiry, item.product_id],
            )?;
        }
        stock::apply_change(&tx, item.product_id, qty, "purchase", Some(item.unit_cost), Some(&number), None, user.id)?;
        if update_costs {
            // Coût moyen unitaire pondéré (CMUP).
            let new_cost = if old_stock > 0.0 {
                ((old_stock * old_cost as f64 + qty * item.unit_cost as f64) / (old_stock + qty)).round() as i64
            } else {
                item.unit_cost
            };
            tx.execute("UPDATE products SET purchase_price = ?1 WHERE id = ?2", params![new_cost, item.product_id])?;
        }
        if let Some(supplier_id) = input.supplier_id {
            tx.execute(
                "UPDATE products SET supplier_id = ?1 WHERE id = ?2 AND supplier_id IS NULL",
                params![supplier_id, item.product_id],
            )?;
        }
    }
    for (product_id, price) in input.new_sale_prices.unwrap_or_default() {
        if price >= 0 {
            tx.execute("UPDATE products SET sale_price = ?1, updated_at = ?2 WHERE id = ?3", params![price, now, product_id])?;
        }
    }
    audit::log(&tx, user, "Réception fournisseur", "purchase", Some(purchase_id), format!("{number} — total {total}"))?;
    tx.commit()?;
    get_purchase(conn, purchase_id)
}

#[derive(Debug, Default, Deserialize)]
pub struct PurchaseFilter {
    pub from: Option<String>,
    pub to: Option<String>,
    pub supplier_id: Option<i64>,
    pub limit: Option<i64>,
}

pub fn list_purchases(conn: &Connection, f: &PurchaseFilter) -> AppResult<Vec<Purchase>> {
    let mut q = Query::new(PURCHASE_SELECT);
    if let Some(from) = db::clean(&f.from) {
        q.and("pu.created_at >= ?", vec![db::text(from)]);
    }
    if let Some(to) = db::clean(&f.to) {
        q.and("pu.created_at < date(?, '+1 day')", vec![db::text(to)]);
    }
    if let Some(s) = f.supplier_id {
        q.and("pu.supplier_id = ?", vec![db::int(s)]);
    }
    q.tail("ORDER BY pu.id DESC LIMIT ?", vec![db::int(f.limit.unwrap_or(500).clamp(1, 5000))]);
    let mut stmt = conn.prepare(&q.sql)?;
    let rows = stmt.query_map(q.params(), purchase_from_row)?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}
