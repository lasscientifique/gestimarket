//! Rapports X et Z d'une caisse.
//!
//! Rapport X : chiffres de la session en cours, sans la clôturer. Rapport Z : figé à la clôture,
//! numéroté (Z-0001…), jamais modifiable (déclencheurs SQL) et chaîné : chaque rapport porte
//! l'empreinte SHA-256 du précédent, si bien qu'une retouche directe de la base se voit.

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use crate::db;
use crate::error::AppResult;
use crate::services::{cash, settings};

fn sum(conn: &Connection, sql: &str, session_id: i64) -> AppResult<i64> {
    Ok(conn.query_row(sql, [session_id], |r| r.get::<_, Option<i64>>(0))?.unwrap_or(0))
}

/// Contenu d'un rapport X ou Z pour une session de caisse.
pub fn build(conn: &Connection, session_id: i64) -> AppResult<Value> {
    let s = cash::get_session(conn, session_id)?;
    let gross = sum(
        conn,
        "SELECT CAST(ROUND(SUM(si.quantity * si.unit_price)) AS INTEGER) FROM sale_items si JOIN sales sa ON sa.id = si.sale_id
         WHERE sa.session_id = ?1 AND sa.status = 'completed'",
        session_id,
    )?;
    let line_discounts = sum(
        conn,
        "SELECT SUM(si.discount) FROM sale_items si JOIN sales sa ON sa.id = si.sale_id
         WHERE sa.session_id = ?1 AND sa.status = 'completed'",
        session_id,
    )?;
    let ticket_discounts = sum(conn, "SELECT SUM(discount) FROM sales WHERE session_id = ?1 AND status = 'completed'", session_id)?;
    let tax_total = sum(conn, "SELECT SUM(tax_total) FROM sales WHERE session_id = ?1 AND status = 'completed'", session_id)?;
    let promo_savings = sum(
        conn,
        "SELECT CAST(ROUND(SUM(si.quantity * (si.regular_price - si.unit_price))) AS INTEGER) FROM sale_items si JOIN sales sa ON sa.id = si.sale_id
         WHERE sa.session_id = ?1 AND sa.status = 'completed' AND si.price_kind = 'promo' AND si.regular_price IS NOT NULL",
        session_id,
    )?;
    let wholesale_total = sum(
        conn,
        "SELECT SUM(si.total) FROM sale_items si JOIN sales sa ON sa.id = si.sale_id
         WHERE sa.session_id = ?1 AND sa.status = 'completed' AND si.price_kind = 'wholesale'",
        session_id,
    )?;
    let (cancelled_count, cancelled_total): (i64, i64) = conn.query_row(
        "SELECT COUNT(*), COALESCE(SUM(total), 0) FROM sales WHERE session_id = ?1 AND status = 'cancelled'",
        [session_id],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?;

    // Encaissements par moyen de paiement (espèces : montant imputé, monnaie rendue déduite).
    let mut stmt = conn.prepare(
        "SELECT sp.method, COUNT(*), SUM(sp.amount) FROM sale_payments sp JOIN sales sa ON sa.id = sp.sale_id
         WHERE sa.session_id = ?1 AND sa.status = 'completed' AND sp.amount > 0
         GROUP BY sp.method ORDER BY SUM(sp.amount) DESC",
    )?;
    let payments: Vec<Value> = stmt
        .query_map([session_id], |r| {
            Ok(json!({ "method": r.get::<_, String>(0)?, "count": r.get::<_, i64>(1)?, "amount": r.get::<_, i64>(2)? }))
        })?
        .collect::<Result<_, _>>()?;

    // Taxes par taux (part de la remise du ticket déduite).
    let mut stmt = conn.prepare(
        "SELECT si.tax_rate,
                ROUND(SUM(si.total * sa.total * 1.0 / NULLIF(sa.subtotal, 0))),
                ROUND(SUM(si.total * sa.total * 1.0 / NULLIF(sa.subtotal, 0) * si.tax_rate / (100.0 + si.tax_rate)))
         FROM sale_items si JOIN sales sa ON sa.id = si.sale_id
         WHERE sa.session_id = ?1 AND sa.status = 'completed' AND si.tax_rate > 0
         GROUP BY si.tax_rate ORDER BY si.tax_rate",
    )?;
    let taxes: Vec<Value> = stmt
        .query_map([session_id], |r| {
            Ok(json!({
                "rate": r.get::<_, f64>(0)?,
                "base": r.get::<_, Option<f64>>(1)?.unwrap_or(0.0) as i64,
                "tax": r.get::<_, Option<f64>>(2)?.unwrap_or(0.0) as i64,
            }))
        })?
        .collect::<Result<_, _>>()?;

    // Retours : par moyen de remboursement, et valeur des articles abîmés.
    let mut stmt = conn.prepare(
        "SELECT refund_method, COUNT(*), SUM(total) FROM returns WHERE session_id = ?1 GROUP BY refund_method ORDER BY SUM(total) DESC",
    )?;
    let refunds: Vec<Value> = stmt
        .query_map([session_id], |r| {
            Ok(json!({ "method": r.get::<_, String>(0)?, "count": r.get::<_, i64>(1)?, "amount": r.get::<_, i64>(2)? }))
        })?
        .collect::<Result<_, _>>()?;
    let damaged = sum(
        conn,
        "SELECT SUM(ri.total) FROM return_items ri JOIN returns r ON r.id = ri.return_id WHERE r.session_id = ?1 AND ri.restock = 0",
        session_id,
    )?;
    let returns_tax = sum(conn, "SELECT SUM(tax_total) FROM returns WHERE session_id = ?1", session_id)?;

    Ok(json!({
        "shop_name": settings::get(conn, "shop_name")?,
        "session_id": s.id,
        "cashier": s.user_name,
        "opened_at": s.opened_at,
        "closed_at": s.closed_at,
        "sales": {
            "count": s.sales_count,
            "gross": gross,
            "line_discounts": line_discounts,
            "ticket_discounts": ticket_discounts,
            "total": s.sales_total,
            "tax_total": tax_total,
            "promo_savings": promo_savings,
            "wholesale_total": wholesale_total,
            "credit": s.credit_sales,
            "cancelled_count": cancelled_count,
            "cancelled_total": cancelled_total,
        },
        "payments": payments,
        "taxes": taxes,
        "returns": {
            "count": s.returns_count,
            "total": s.returns_total,
            "tax_total": returns_tax,
            "damaged": damaged,
            "by_method": refunds,
        },
        "net_total": s.sales_total - s.returns_total,
        "customer_payments": { "cash": s.customer_payments_cash, "electronic": s.customer_payments_electronic },
        "cash": {
            "opening": s.opening_amount,
            "sales": s.cash_sales,
            "customer_payments": s.customer_payments_cash,
            "cash_in": s.cash_in,
            "cash_out": s.cash_out,
            "refunds": s.refunds_cash,
            "expected": s.expected_amount.unwrap_or(s.expected_now),
            "counted": s.counted_amount,
            "difference": s.difference,
        },
    }))
}

fn sha256(text: &str) -> String {
    Sha256::digest(text.as_bytes()).iter().map(|b| format!("{b:02x}")).collect()
}

/// Fige le rapport Z d'une session qui vient d'être clôturée (dans la transaction de la clôture).
pub fn save(conn: &Connection, session_id: i64, user_id: i64) -> AppResult<i64> {
    let (last_number, prev_hash): (i64, String) = conn
        .query_row("SELECT number, hash FROM z_reports ORDER BY number DESC LIMIT 1", [], |r| Ok((r.get(0)?, r.get(1)?)))
        .optional()?
        .unwrap_or((0, String::new()));
    let number = last_number + 1;
    let mut data = build(conn, session_id)?;
    data["number"] = json!(number);
    let text = data.to_string();
    conn.execute(
        "INSERT INTO z_reports (number, session_id, user_id, data, prev_hash, hash, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![number, session_id, user_id, text, prev_hash, sha256(&format!("{prev_hash}{text}")), db::now()],
    )?;
    Ok(number)
}

#[derive(Debug, Serialize)]
pub struct ZReport {
    pub number: i64,
    pub session_id: i64,
    pub user_name: Option<String>,
    pub created_at: String,
    pub data: Value,
    /// Empreinte conforme au contenu et au rapport précédent.
    pub intact: bool,
}

#[derive(Debug, Default, Deserialize)]
pub struct ZFilter {
    pub from: Option<String>,
    pub to: Option<String>,
    pub user_id: Option<i64>,
}

/// Rapports Z (les plus récents d'abord), avec la vérification de la chaîne d'empreintes.
pub fn list(conn: &Connection, f: &ZFilter) -> AppResult<Vec<ZReport>> {
    let mut stmt = conn.prepare(
        "SELECT z.number, z.session_id, u.full_name, z.created_at, z.data, z.prev_hash, z.hash, cs.user_id
         FROM z_reports z LEFT JOIN users u ON u.id = z.user_id JOIN cash_sessions cs ON cs.id = z.session_id
         ORDER BY z.number",
    )?;
    let rows = stmt
        .query_map([], |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, i64>(1)?,
                r.get::<_, Option<String>>(2)?,
                r.get::<_, String>(3)?,
                r.get::<_, String>(4)?,
                r.get::<_, String>(5)?,
                r.get::<_, String>(6)?,
                r.get::<_, i64>(7)?,
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    let from = db::clean(&f.from).unwrap_or_default();
    let to = db::clean(&f.to).map(|t| format!("{t} 99")).unwrap_or_else(|| "9999".into());
    let mut out = Vec::new();
    let mut previous = String::new();
    for (number, session_id, user_name, created_at, text, prev_hash, hash, cashier_id) in rows {
        let intact = prev_hash == previous && sha256(&format!("{prev_hash}{text}")) == hash;
        previous = hash;
        if created_at.as_str() < from.as_str() || created_at.as_str() > to.as_str() || f.user_id.is_some_and(|u| u != cashier_id) {
            continue;
        }
        out.push(ZReport { number, session_id, user_name, created_at, data: serde_json::from_str(&text).unwrap_or(Value::Null), intact });
    }
    out.reverse();
    Ok(out)
}
