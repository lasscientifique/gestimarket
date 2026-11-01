use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

use crate::db::{self, Query};
use crate::error::{invalid, AppResult};
use crate::services::audit;
use crate::state::SessionUser;

/// Applique une variation de stock (signée) et trace le mouvement.
/// Doit être appelée à l'intérieur d'une transaction. Retourne le nouveau stock.
#[allow(clippy::too_many_arguments)]
pub fn apply_change(
    conn: &Connection,
    product_id: i64,
    delta: f64,
    kind: &str,
    unit_cost: Option<i64>,
    reference: Option<&str>,
    note: Option<&str>,
    user_id: i64,
) -> AppResult<f64> {
    let current: f64 = conn.query_row("SELECT stock FROM products WHERE id = ?1", [product_id], |r| r.get(0))?;
    let new_stock = db::round_qty(current + delta);
    let now = db::now();
    conn.execute(
        "UPDATE products SET stock = ?1, updated_at = ?2 WHERE id = ?3",
        params![new_stock, now, product_id],
    )?;
    conn.execute(
        "INSERT INTO stock_movements (product_id, kind, quantity, stock_after, unit_cost, reference, note, user_id, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![product_id, kind, db::round_qty(delta), new_stock, unit_cost, reference, note, user_id, now],
    )?;
    Ok(new_stock)
}

#[derive(Debug, Deserialize)]
pub struct AdjustInput {
    pub product_id: i64,
    /// `set` (inventaire : quantité comptée), `add` (entrée) ou `remove` (sortie)
    pub mode: String,
    pub quantity: f64,
    /// `adjustment`, `loss` (perte/casse/péremption) ou `return` (retour client)
    pub kind: String,
    pub note: Option<String>,
}

pub fn adjust(conn: &mut Connection, user: &SessionUser, input: AdjustInput) -> AppResult<f64> {
    if !["adjustment", "loss", "return"].contains(&input.kind.as_str()) {
        return invalid("Type de mouvement invalide.");
    }
    if input.quantity < 0.0 || !input.quantity.is_finite() {
        return invalid("La quantité doit être positive.");
    }
    let tx = conn.transaction()?;
    let (name, current): (String, f64) = tx.query_row(
        "SELECT name, stock FROM products WHERE id = ?1",
        [input.product_id],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?;
    let delta = match input.mode.as_str() {
        "set" => input.quantity - current,
        "add" => input.quantity,
        "remove" => -input.quantity,
        _ => return invalid("Mode d'ajustement invalide."),
    };
    if db::round_qty(delta) == 0.0 {
        return invalid("Aucune variation de stock à enregistrer.");
    }
    let note = db::clean(&input.note);
    let new_stock = apply_change(&tx, input.product_id, delta, &input.kind, None, None, note.as_deref(), user.id)?;
    audit::log(
        &tx,
        user,
        "Ajustement de stock",
        "product",
        Some(input.product_id),
        format!("{name} : {current} → {new_stock} ({})", input.kind),
    )?;
    tx.commit()?;
    Ok(new_stock)
}

#[derive(Debug, Serialize)]
pub struct StockMovement {
    pub id: i64,
    pub product_id: i64,
    pub product_name: String,
    pub unit: String,
    pub kind: String,
    pub quantity: f64,
    pub stock_after: f64,
    pub unit_cost: Option<i64>,
    pub reference: Option<String>,
    pub note: Option<String>,
    pub user_name: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Default, Deserialize)]
pub struct MovementFilter {
    pub product_id: Option<i64>,
    pub kind: Option<String>,
    pub from: Option<String>,
    pub to: Option<String>,
    pub limit: Option<i64>,
}

pub fn list_movements(conn: &Connection, f: &MovementFilter) -> AppResult<Vec<StockMovement>> {
    let mut q = Query::new(
        "SELECT m.id, m.product_id, p.name, p.unit, m.kind, m.quantity, m.stock_after, m.unit_cost,
                m.reference, m.note, u.full_name, m.created_at
         FROM stock_movements m
         JOIN products p ON p.id = m.product_id
         LEFT JOIN users u ON u.id = m.user_id",
    );
    if let Some(p) = f.product_id {
        q.and("m.product_id = ?", vec![db::int(p)]);
    }
    if let Some(k) = db::clean(&f.kind) {
        q.and("m.kind = ?", vec![db::text(k)]);
    }
    if let Some(from) = db::clean(&f.from) {
        q.and("m.created_at >= ?", vec![db::text(from)]);
    }
    if let Some(to) = db::clean(&f.to) {
        q.and("m.created_at < date(?, '+1 day')", vec![db::text(to)]);
    }
    q.tail("ORDER BY m.id DESC LIMIT ?", vec![db::int(f.limit.unwrap_or(500).clamp(1, 10000))]);
    let mut stmt = conn.prepare(&q.sql)?;
    let rows = stmt.query_map(q.params(), |r| {
        Ok(StockMovement {
            id: r.get(0)?,
            product_id: r.get(1)?,
            product_name: r.get(2)?,
            unit: r.get(3)?,
            kind: r.get(4)?,
            quantity: r.get(5)?,
            stock_after: r.get(6)?,
            unit_cost: r.get(7)?,
            reference: r.get(8)?,
            note: r.get(9)?,
            user_name: r.get(10)?,
            created_at: r.get(11)?,
        })
    })?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

#[derive(Debug, Serialize)]
pub struct StockSummary {
    pub product_count: i64,
    pub value_cost: i64,
    pub value_sale: i64,
    pub low_stock_count: i64,
    pub out_of_stock_count: i64,
}

pub fn summary(conn: &Connection) -> AppResult<StockSummary> {
    Ok(conn.query_row(
        "SELECT COUNT(*),
                COALESCE(CAST(ROUND(SUM(CASE WHEN track_stock = 1 AND stock > 0 THEN stock * purchase_price ELSE 0 END)) AS INTEGER), 0),
                COALESCE(CAST(ROUND(SUM(CASE WHEN track_stock = 1 AND stock > 0 THEN stock * sale_price ELSE 0 END)) AS INTEGER), 0),
                COALESCE(SUM(CASE WHEN track_stock = 1 AND stock > 0 AND stock <= min_stock THEN 1 ELSE 0 END), 0),
                COALESCE(SUM(CASE WHEN track_stock = 1 AND stock <= 0 THEN 1 ELSE 0 END), 0)
         FROM products WHERE active = 1",
        [],
        |r| {
            Ok(StockSummary {
                product_count: r.get(0)?,
                value_cost: r.get(1)?,
                value_sale: r.get(2)?,
                low_stock_count: r.get(3)?,
                out_of_stock_count: r.get(4)?,
            })
        },
    )?)
}
