use std::collections::HashMap;

use chrono::{Duration, Local, NaiveDate};
use rusqlite::{params, Connection};
use serde::Serialize;

use crate::error::{invalid, AppResult};
use crate::services::sales::{self, Sale, SaleFilter};
use crate::services::stock;

#[derive(Debug, Serialize)]
pub struct DayPoint {
    pub date: String,
    pub revenue: i64,
    pub margin: i64,
    pub count: i64,
}

#[derive(Debug, Serialize)]
pub struct TopProduct {
    pub product_id: i64,
    pub name: String,
    pub unit: String,
    pub quantity: f64,
    pub revenue: i64,
    pub margin: i64,
}

#[derive(Debug, Serialize)]
pub struct LowStockItem {
    pub id: i64,
    pub name: String,
    pub unit: String,
    pub stock: f64,
    pub min_stock: f64,
}

#[derive(Debug, Serialize)]
pub struct Dashboard {
    pub today_revenue: i64,
    pub today_margin: i64,
    pub today_count: i64,
    pub yesterday_revenue: i64,
    pub month_revenue: i64,
    pub month_margin: i64,
    pub month_count: i64,
    pub customers_debt: i64,
    pub stock: stock::StockSummary,
    pub daily: Vec<DayPoint>,
    pub top_products: Vec<TopProduct>,
    pub low_stock: Vec<LowStockItem>,
    pub expiring: Vec<ExpiringItem>,
    pub today_payments: Vec<Breakdown>,
    pub recent_sales: Vec<Sale>,
}

#[derive(Debug, Serialize)]
pub struct ExpiringItem {
    pub id: i64,
    pub name: String,
    pub unit: String,
    pub stock: f64,
    pub expiry_date: String,
    pub days_left: i64,
}

/// (CA, marge, nombre de ventes) sur une période [from, to] (dates incluses).
fn totals(conn: &Connection, from: &str, to: &str) -> AppResult<(i64, i64, i64)> {
    Ok(conn.query_row(
        "SELECT COALESCE(SUM(total), 0), COALESCE(SUM(total - cost_total), 0), COUNT(*)
         FROM sales WHERE status = 'completed' AND created_at >= ?1 AND created_at < date(?2, '+1 day')",
        params![from, to],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
    )?)
}

fn by_day(conn: &Connection, from: NaiveDate, to: NaiveDate) -> AppResult<Vec<DayPoint>> {
    let mut stmt = conn.prepare(
        "SELECT date(created_at), SUM(total), SUM(total - cost_total), COUNT(*)
         FROM sales WHERE status = 'completed' AND created_at >= ?1 AND created_at < date(?2, '+1 day')
         GROUP BY date(created_at)",
    )?;
    let mut map: HashMap<String, (i64, i64, i64)> = HashMap::new();
    let rows = stmt.query_map(params![from.to_string(), to.to_string()], |r| {
        Ok((r.get::<_, String>(0)?, (r.get(1)?, r.get(2)?, r.get(3)?)))
    })?;
    for row in rows {
        let (d, v) = row?;
        map.insert(d, v);
    }
    let mut out = Vec::new();
    let mut d = from;
    while d <= to {
        let key = d.to_string();
        let (revenue, margin, count) = map.get(&key).copied().unwrap_or((0, 0, 0));
        out.push(DayPoint { date: key, revenue, margin, count });
        d += Duration::days(1);
    }
    Ok(out)
}

/// Part du total payé d'une ligne de vente (remise du ticket répartie au prorata des lignes).
pub(crate) const ALLOCATED: &str = "si.total * CASE WHEN s.subtotal > 0 THEN CAST(s.total AS REAL) / s.subtotal ELSE 0 END";

fn top_products(conn: &Connection, from: &str, to: &str, limit: i64) -> AppResult<Vec<TopProduct>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT si.product_id, (SELECT name FROM products WHERE id = si.product_id), (SELECT unit FROM products WHERE id = si.product_id), SUM(COALESCE(si.base_quantity, si.quantity)),
                CAST(ROUND(SUM({ALLOCATED})) AS INTEGER),
                CAST(ROUND(SUM({ALLOCATED} - COALESCE(si.base_quantity, si.quantity) * si.unit_cost)) AS INTEGER)
         FROM sale_items si JOIN sales s ON s.id = si.sale_id
         WHERE s.status = 'completed' AND s.created_at >= ?1 AND s.created_at < date(?2, '+1 day')
         GROUP BY si.product_id ORDER BY 5 DESC LIMIT ?3"
    ))?;
    let rows = stmt.query_map(params![from, to, limit], |r| {
        Ok(TopProduct {
            product_id: r.get(0)?,
            name: r.get(1)?,
            unit: r.get(2)?,
            quantity: r.get(3)?,
            revenue: r.get(4)?,
            margin: r.get(5)?,
        })
    })?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

/// Encaissements par moyen de paiement (le crédit apparaît comme une ligne à part).
fn payments_breakdown(conn: &Connection, from: &str, to: &str) -> AppResult<Vec<Breakdown>> {
    breakdown(
        conn,
        "SELECT method, COUNT(DISTINCT sale_id), SUM(amount), 0 FROM (
            SELECT sp.method, sp.sale_id, sp.amount FROM sale_payments sp JOIN sales s ON s.id = sp.sale_id
             WHERE s.status = 'completed' AND s.created_at >= ?1 AND s.created_at < date(?2, '+1 day') AND sp.amount > 0
            UNION ALL
            SELECT 'credit', s.id, s.credit_amount FROM sales s
             WHERE s.status = 'completed' AND s.created_at >= ?1 AND s.created_at < date(?2, '+1 day') AND s.credit_amount > 0
         ) GROUP BY method ORDER BY 3 DESC",
        from,
        to,
    )
}

pub fn dashboard(conn: &Connection) -> AppResult<Dashboard> {
    let today = Local::now().date_naive();
    let today_s = today.to_string();
    let yesterday = (today - Duration::days(1)).to_string();
    let month_start = today.format("%Y-%m-01").to_string();

    let (today_revenue, today_margin, today_count) = totals(conn, &today_s, &today_s)?;
    let (yesterday_revenue, _, _) = totals(conn, &yesterday, &yesterday)?;
    let (month_revenue, month_margin, month_count) = totals(conn, &month_start, &today_s)?;
    let customers_debt: i64 = conn.query_row(
        "SELECT COALESCE(SUM(balance), 0) FROM customers WHERE balance > 0",
        [],
        |r| r.get(0),
    )?;

    let mut stmt = conn.prepare(
        "SELECT id, name, unit, stock, min_stock FROM products
         WHERE active = 1 AND track_stock = 1 AND stock <= min_stock
         ORDER BY (stock - min_stock), name LIMIT 10",
    )?;
    let low_stock = stmt
        .query_map([], |r| {
            Ok(LowStockItem { id: r.get(0)?, name: r.get(1)?, unit: r.get(2)?, stock: r.get(3)?, min_stock: r.get(4)? })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    let alert_days = crate::services::settings::get_i64(conn, "expiry_alert_days")?.max(0);
    let mut stmt = conn.prepare(
        "SELECT id, name, unit, stock, expiry_date, CAST(julianday(expiry_date) - julianday(date('now', 'localtime')) AS INTEGER)
         FROM products
         WHERE active = 1 AND stock > 0 AND expiry_date IS NOT NULL AND expiry_date <> ''
           AND expiry_date <= date('now', 'localtime', ?1)
         ORDER BY expiry_date LIMIT 10",
    )?;
    let expiring = stmt
        .query_map([format!("+{alert_days} days")], |r| {
            Ok(ExpiringItem { id: r.get(0)?, name: r.get(1)?, unit: r.get(2)?, stock: r.get(3)?, expiry_date: r.get(4)?, days_left: r.get(5)? })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    let seven_days_ago = (today - Duration::days(6)).to_string();
    Ok(Dashboard {
        today_revenue,
        today_margin,
        today_count,
        yesterday_revenue,
        month_revenue,
        month_margin,
        month_count,
        customers_debt,
        stock: stock::summary(conn)?,
        daily: by_day(conn, today - Duration::days(13), today)?,
        top_products: top_products(conn, &seven_days_ago, &today_s, 6)?,
        low_stock,
        expiring,
        today_payments: payments_breakdown(conn, &today_s, &today_s)?,
        recent_sales: sales::list_sales(conn, &SaleFilter { limit: Some(8), ..Default::default() })?,
    })
}

#[derive(Debug, Serialize)]
pub struct Breakdown {
    pub label: String,
    pub count: i64,
    pub amount: i64,
    pub margin: i64,
}

/// Remises d'un caissier sur la période : ventes concernées, montant (lignes + ticket), validées par un responsable.
#[derive(Debug, Serialize)]
pub struct DiscountRow {
    pub label: String,
    pub count: i64,
    pub amount: i64,
    pub approved: i64,
}

#[derive(Debug, Serialize)]
pub struct SalesReport {
    pub from: String,
    pub to: String,
    pub revenue: i64,
    pub sales_count: i64,
    pub discount_total: i64,
    pub tax_total: i64,
    pub cost_total: i64,
    pub margin: i64,
    pub credit_total: i64,
    pub cancelled_count: i64,
    pub cancelled_total: i64,
    pub purchases_total: i64,
    pub customer_payments_total: i64,
    pub by_day: Vec<DayPoint>,
    pub by_payment: Vec<Breakdown>,
    pub by_category: Vec<Breakdown>,
    pub by_user: Vec<Breakdown>,
    pub discounts_by_user: Vec<DiscountRow>,
    pub top_products: Vec<TopProduct>,
}

fn breakdown(conn: &Connection, sql: &str, from: &str, to: &str) -> AppResult<Vec<Breakdown>> {
    let mut stmt = conn.prepare(sql)?;
    let rows = stmt.query_map(params![from, to], |r| {
        Ok(Breakdown { label: r.get(0)?, count: r.get(1)?, amount: r.get(2)?, margin: r.get(3)? })
    })?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

pub fn sales_report(conn: &Connection, from: &str, to: &str) -> AppResult<SalesReport> {
    let parse = |s: &str| NaiveDate::parse_from_str(s, "%Y-%m-%d");
    let (Ok(from_d), Ok(to_d)) = (parse(from), parse(to)) else {
        return invalid("Dates invalides.");
    };
    if from_d > to_d {
        return invalid("La date de début doit précéder la date de fin.");
    }
    if (to_d - from_d).num_days() > 366 * 3 {
        return invalid("Période trop longue (3 ans maximum).");
    }
    let period = "s.created_at >= ?1 AND s.created_at < date(?2, '+1 day')";

    let (revenue, sales_count, discount_total, tax_total, cost_total, credit_total): (i64, i64, i64, i64, i64, i64) =
        conn.query_row(
            &format!(
                "SELECT COALESCE(SUM(total), 0), COUNT(*), COALESCE(SUM(discount), 0), COALESCE(SUM(tax_total), 0),
                        COALESCE(SUM(cost_total), 0), COALESCE(SUM(credit_amount), 0)
                 FROM sales s WHERE s.status = 'completed' AND {period}"
            ),
            params![from, to],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?)),
        )?;
    // Remises sur les lignes (en plus de la remise du ticket, comptée ci-dessus).
    let line_discounts: i64 = conn.query_row(
        &format!(
            "SELECT COALESCE(SUM(si.discount), 0) FROM sale_items si JOIN sales s ON s.id = si.sale_id
             WHERE s.status = 'completed' AND {period}"
        ),
        params![from, to],
        |r| r.get(0),
    )?;
    let discount_total = discount_total + line_discounts;
    let mut stmt = conn.prepare(&format!(
        "SELECT u.full_name, COUNT(*),
                SUM(s.discount + COALESCE((SELECT SUM(si.discount) FROM sale_items si WHERE si.sale_id = s.id), 0)),
                SUM(CASE WHEN s.discount_approved_by IS NOT NULL AND s.discount_approved_by <> s.user_id THEN 1 ELSE 0 END)
         FROM sales s JOIN users u ON u.id = s.user_id
         WHERE s.status = 'completed' AND {period}
           AND (s.discount > 0 OR EXISTS (SELECT 1 FROM sale_items si WHERE si.sale_id = s.id AND si.discount > 0))
         GROUP BY s.user_id ORDER BY 3 DESC"
    ))?;
    let discounts_by_user = stmt
        .query_map(params![from, to], |r| Ok(DiscountRow { label: r.get(0)?, count: r.get(1)?, amount: r.get(2)?, approved: r.get(3)? }))?
        .collect::<Result<Vec<_>, _>>()?;
    let (cancelled_count, cancelled_total): (i64, i64) = conn.query_row(
        &format!("SELECT COUNT(*), COALESCE(SUM(total), 0) FROM sales s WHERE s.status = 'cancelled' AND {period}"),
        params![from, to],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?;
    let purchases_total: i64 = conn.query_row(
        "SELECT COALESCE(SUM(total), 0) FROM purchases s WHERE s.created_at >= ?1 AND s.created_at < date(?2, '+1 day')",
        params![from, to],
        |r| r.get(0),
    )?;
    let customer_payments_total: i64 = conn.query_row(
        "SELECT COALESCE(SUM(amount), 0) FROM customer_payments s WHERE s.created_at >= ?1 AND s.created_at < date(?2, '+1 day')",
        params![from, to],
        |r| r.get(0),
    )?;

    let by_payment = payments_breakdown(conn, from, to)?;
    let by_category = breakdown(
        conn,
        &format!(
            "SELECT COALESCE(c.name, 'Sans catégorie'), COUNT(DISTINCT s.id),
                    CAST(ROUND(SUM({ALLOCATED})) AS INTEGER),
                    CAST(ROUND(SUM({ALLOCATED} - COALESCE(si.base_quantity, si.quantity) * si.unit_cost)) AS INTEGER)
             FROM sale_items si
             JOIN sales s ON s.id = si.sale_id
             LEFT JOIN products p ON p.id = si.product_id
             LEFT JOIN categories c ON c.id = p.category_id
             WHERE s.status = 'completed' AND {period}
             GROUP BY c.id ORDER BY 3 DESC"
        ),
        from,
        to,
    )?;
    let by_user = breakdown(
        conn,
        &format!(
            "SELECT u.full_name, COUNT(*), SUM(s.total), SUM(s.total - s.cost_total) FROM sales s
             JOIN users u ON u.id = s.user_id
             WHERE s.status = 'completed' AND {period} GROUP BY s.user_id ORDER BY 3 DESC"
        ),
        from,
        to,
    )?;

    Ok(SalesReport {
        from: from.to_string(),
        to: to.to_string(),
        revenue,
        sales_count,
        discount_total,
        tax_total,
        cost_total,
        margin: revenue - cost_total,
        credit_total,
        cancelled_count,
        cancelled_total,
        purchases_total,
        customer_payments_total,
        by_day: by_day(conn, from_d, to_d)?,
        by_payment,
        by_category,
        by_user,
        discounts_by_user,
        top_products: top_products(conn, from, to, 30)?,
    })
}
