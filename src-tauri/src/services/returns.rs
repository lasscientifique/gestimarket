//! Retours d'articles : tout ou partie d'une vente, dans le délai fixé (7 jours par défaut).
//! Article remis en rayon ou abîmé ; remboursement en espèces, par paiement mobile, en avoir
//! (bon numéroté utilisable en caisse) ou en réduction de la dette du client. Validé par le PIN
//! d'un responsable et repris dans le rapport Z de la caisse.

use rusqlite::{params, Connection, Row};
use serde::{Deserialize, Serialize};

use crate::db::{self, Query};
use crate::error::{invalid, AppResult};
use crate::services::sales::{self, CreditNote};
use crate::services::{audit, cash, loyalty, settings, stock};
use crate::state::SessionUser;

#[derive(Debug, Deserialize)]
pub struct ReturnItemInput {
    pub sale_item_id: i64,
    /// En unités de vente (cartons si l'article a été vendu au carton).
    pub quantity: f64,
    /// true : remis en rayon ; false : abîmé.
    pub restock: bool,
}

#[derive(Debug, Deserialize)]
pub struct ReturnInput {
    pub sale_id: i64,
    pub items: Vec<ReturnItemInput>,
    /// cash, orange_money, mm:<id>, card, other, credit_note (avoir) ou debt (compte du client :
    /// réduit sa dette, puis devient des fonds).
    pub refund_method: String,
    pub refund_reference: Option<String>,
    pub reason: String,
}

#[derive(Debug, Serialize)]
pub struct ReturnItem {
    pub product_name: String,
    pub quantity: f64,
    pub total: i64,
    pub restock: bool,
}

#[derive(Debug, Serialize)]
pub struct SaleReturn {
    pub id: i64,
    pub number: String,
    pub sale_id: i64,
    pub sale_number: String,
    pub customer_name: Option<String>,
    pub user_name: String,
    pub approved_by_name: Option<String>,
    pub session_id: Option<i64>,
    pub total: i64,
    pub tax_total: i64,
    pub refund_method: String,
    pub refund_reference: Option<String>,
    pub reason: String,
    pub created_at: String,
    /// Part rendue en bonus fidélité (vente payée en partie avec le bonus).
    pub loyalty_refund: i64,
    pub credit_note: Option<CreditNote>,
    pub items: Vec<ReturnItem>,
}

const RETURN_SELECT: &str = "SELECT r.id, r.number, r.sale_id, s.number, c.name, u.full_name, a.full_name, r.session_id,
        r.total, r.tax_total, r.refund_method, r.refund_reference, r.reason, r.created_at, r.credit_note_id, r.loyalty_refund
    FROM returns r
    JOIN sales s ON s.id = r.sale_id
    JOIN users u ON u.id = r.user_id
    LEFT JOIN users a ON a.id = r.approved_by
    LEFT JOIN customers c ON c.id = r.customer_id";

fn return_from_row(r: &Row) -> rusqlite::Result<(SaleReturn, Option<i64>)> {
    Ok((
        SaleReturn {
            id: r.get(0)?,
            number: r.get(1)?,
            sale_id: r.get(2)?,
            sale_number: r.get(3)?,
            customer_name: r.get(4)?,
            user_name: r.get(5)?,
            approved_by_name: r.get(6)?,
            session_id: r.get(7)?,
            total: r.get(8)?,
            tax_total: r.get(9)?,
            refund_method: r.get(10)?,
            refund_reference: r.get(11)?,
            reason: r.get(12)?,
            created_at: r.get(13)?,
            loyalty_refund: r.get(15)?,
            credit_note: None,
            items: Vec::new(),
        },
        r.get(14)?,
    ))
}

pub fn get_return(conn: &Connection, id: i64) -> AppResult<SaleReturn> {
    let (mut ret, note_id) = conn.query_row(&format!("{RETURN_SELECT} WHERE r.id = ?1"), [id], return_from_row)?;
    if let Some(n) = note_id {
        ret.credit_note = Some(sales::get_credit_note(conn, n)?);
    }
    let mut stmt = conn.prepare("SELECT product_name, quantity, total, restock FROM return_items WHERE return_id = ?1 ORDER BY id")?;
    ret.items = stmt
        .query_map([id], |r| Ok(ReturnItem { product_name: r.get(0)?, quantity: r.get(1)?, total: r.get(2)?, restock: r.get(3)? }))?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(ret)
}

#[derive(Debug, Default, Deserialize)]
pub struct ReturnFilter {
    pub from: Option<String>,
    pub to: Option<String>,
    pub sale_id: Option<i64>,
    pub session_id: Option<i64>,
    pub user_id: Option<i64>,
}

pub fn list_returns(conn: &Connection, f: &ReturnFilter) -> AppResult<Vec<SaleReturn>> {
    let mut q = Query::new(RETURN_SELECT);
    if let Some(from) = db::clean(&f.from) {
        q.and("r.created_at >= ?", vec![db::text(from)]);
    }
    if let Some(to) = db::clean(&f.to) {
        q.and("r.created_at < date(?, '+1 day')", vec![db::text(to)]);
    }
    if let Some(id) = f.sale_id {
        q.and("r.sale_id = ?", vec![db::int(id)]);
    }
    if let Some(id) = f.session_id {
        q.and("r.session_id = ?", vec![db::int(id)]);
    }
    if let Some(id) = f.user_id {
        q.and("r.user_id = ?", vec![db::int(id)]);
    }
    q.tail("ORDER BY r.id DESC LIMIT ?", vec![db::int(1000)]);
    let mut stmt = conn.prepare(&q.sql)?;
    let ids: Vec<i64> = stmt.query_map(q.params(), |r| return_from_row(r).map(|(x, _)| x.id))?.collect::<Result<Vec<_>, _>>()?;
    ids.into_iter().map(|id| get_return(conn, id)).collect()
}

/// Code d'un avoir : son numéro suivi de 4 caractères tirés au hasard (le numéro seul se devine).
fn credit_note_code(number: &str) -> String {
    use password_hash::rand_core::{OsRng, RngCore};
    const ALPHABET: &[u8] = b"ABCDEFGHJKMNPQRSTUVWXYZ23456789";
    let mut bytes = [0u8; 4];
    OsRng.fill_bytes(&mut bytes);
    let suffix: String = bytes.iter().map(|b| ALPHABET[*b as usize % ALPHABET.len()] as char).collect();
    format!("{number}-{suffix}")
}

struct Line {
    sale_item_id: i64,
    product_id: i64,
    name: String,
    quantity: f64,
    base_quantity: f64,
    total: i64,
    tax: i64,
    cost: i64,
    restock: bool,
}

/// Enregistre un retour : la caissière (caisse ouverte) rend, le responsable valide par son PIN.
pub fn create_return(conn: &mut Connection, user: &SessionUser, approver: &SessionUser, input: ReturnInput) -> AppResult<SaleReturn> {
    let reason = input.reason.trim().to_string();
    if reason.is_empty() {
        return invalid("Le motif du retour est obligatoire.");
    }
    if input.items.is_empty() {
        return invalid("Choisissez au moins un article à retourner.");
    }
    cash::ensure_cashier(user)?;
    let Some(session_id) = cash::open_session_id(conn, user.id)? else {
        return invalid("Ouvrez votre caisse avant d'enregistrer un retour.");
    };
    let sale = sales::get_sale(conn, input.sale_id)?;
    if sale.status != "completed" {
        return invalid("Cette vente a été annulée : rien à retourner.");
    }
    let days = settings::get_i64(conn, "return_days")?.max(0);
    let sold = chrono::NaiveDateTime::parse_from_str(&sale.created_at, "%Y-%m-%d %H:%M:%S")
        .map(|d| d.date())
        .unwrap_or_else(|_| chrono::Local::now().date_naive());
    if (chrono::Local::now().date_naive() - sold).num_days() > days {
        return invalid(format!("Retour impossible : la vente {} date de plus de {days} jours.", sale.number));
    }

    // Montants : part de la ligne, remise du ticket déduite au prorata.
    let subtotal: i64 = sale.items.iter().map(|i| i.total).sum();
    let factor = if subtotal > 0 { sale.total as f64 / subtotal as f64 } else { 0.0 };
    let mut lines: Vec<Line> = Vec::new();
    for it in &input.items {
        if lines.iter().any(|l| l.sale_item_id == it.sale_item_id) {
            return invalid("Le même article est saisi deux fois.");
        }
        let Some(si) = sale.items.iter().find(|i| i.id == it.sale_item_id) else {
            return invalid("Cet article ne fait pas partie de la vente.");
        };
        let q = db::round_qty(it.quantity);
        if q <= 0.0 || !q.is_finite() {
            continue;
        }
        let left = db::round_qty(si.quantity - si.returned_quantity);
        if q > left + 1e-9 {
            return invalid(format!("« {} » : {} au plus peut encore être retourné.", si.product_name, left));
        }
        let ratio = q / si.quantity;
        let total = (si.total as f64 * ratio * factor).round() as i64;
        let unit_cost: i64 = conn.query_row("SELECT unit_cost FROM sale_items WHERE id = ?1", [si.id], |r| r.get(0))?;
        let base_quantity = db::round_qty(si.base_quantity * ratio);
        lines.push(Line {
            sale_item_id: si.id,
            product_id: si.product_id,
            name: si.product_name.clone(),
            quantity: q,
            base_quantity,
            total,
            tax: if si.tax_rate > 0.0 { (total as f64 * si.tax_rate / (100.0 + si.tax_rate)).round() as i64 } else { 0 },
            cost: (base_quantity * unit_cost as f64).round() as i64,
            restock: it.restock,
        });
    }
    if lines.is_empty() {
        return invalid("Choisissez au moins un article à retourner.");
    }
    // Jamais plus que ce qui reste de la vente (arrondis cumulés).
    let mut total: i64 = lines.iter().map(|l| l.total).sum();
    let left_total = (sale.total - sale.returned_total).max(0);
    if total > left_total {
        let excess = total - left_total;
        if let Some(last) = lines.last_mut() {
            last.total = (last.total - excess).max(0);
        }
        total = left_total;
    }
    let tax_total: i64 = lines.iter().map(|l| l.tax).sum();
    let cost_total: i64 = lines.iter().map(|l| l.cost).sum();

    // Remboursement
    let method = input.refund_method.trim().to_string();
    let reference = db::clean(&input.refund_reference);
    if (sale.credit_amount > 0 || sale.account_amount > 0) && method != "debt" {
        return invalid("Cette vente a été payée en partie avec le compte du client (fonds ou crédit) : le retour revient sur son compte.");
    }
    // Part payée avec le bonus fidélité : rendue en bonus d'abord ; le reste par le moyen choisi.
    let loyalty_paid: i64 = sale.payments.iter().filter(|p| p.method == "loyalty").map(|p| p.amount).sum();
    let loyalty_already: i64 =
        conn.query_row("SELECT COALESCE(SUM(loyalty_refund), 0) FROM returns WHERE sale_id = ?1", [sale.id], |r| r.get(0))?;
    let bonus_back = total.min((loyalty_paid - loyalty_already).max(0));
    let money = total - bonus_back;
    match method.as_str() {
        "cash" => {
            let s = cash::get_session(conn, session_id)?;
            if money > s.expected_now {
                return invalid("Pas assez d'espèces dans la caisse pour rembourser : choisissez un avoir.");
            }
        }
        "credit_note" => {}
        "debt" => {
            if sale.customer_id.is_none() {
                return invalid("Pas de client sur cette vente : choisissez un autre remboursement.");
            }
        }
        m => sales::check_payment(conn, m, reference.as_deref())?,
    }

    let tx = conn.transaction()?;
    let number = db::next_number(&tx, "returns", "R")?;
    let now = db::now();
    tx.execute(
        "INSERT INTO returns (number, sale_id, customer_id, user_id, approved_by, session_id, total, tax_total, cost_total,
                              refund_method, refund_reference, reason, created_at, loyalty_refund)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
        params![number, sale.id, sale.customer_id, user.id, approver.id, session_id, total, tax_total, cost_total,
                method, reference, reason, now, bonus_back],
    )?;
    let return_id = tx.last_insert_rowid();
    for l in &lines {
        tx.execute(
            "INSERT INTO return_items (return_id, sale_item_id, product_id, product_name, quantity, base_quantity, total, tax, cost, restock)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![return_id, l.sale_item_id, l.product_id, l.name, l.quantity, l.base_quantity, l.total, l.tax, l.cost, l.restock],
        )?;
        let track: bool = tx.query_row("SELECT track_stock FROM products WHERE id = ?1", [l.product_id], |r| r.get(0))?;
        if track && l.restock {
            let unit_cost = if l.base_quantity > 0.0 { (l.cost as f64 / l.base_quantity).round() as i64 } else { 0 };
            stock::apply_change(&tx, l.product_id, l.base_quantity, "return", Some(unit_cost), Some(&number), Some(&reason), user.id)?;
        }
    }
    match method.as_str() {
        "credit_note" if money > 0 => {
            let days = settings::get_i64(&tx, "credit_note_days")?.clamp(1, 3650);
            let expires = (chrono::Local::now().date_naive() + chrono::Days::new(days as u64)).format("%Y-%m-%d").to_string();
            let note_number = db::next_number(&tx, "credit_notes", "AV")?;
            tx.execute(
                "INSERT INTO credit_notes (number, code, customer_id, amount, balance, expires_on, user_id, return_id, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?4, ?5, ?6, ?7, ?8)",
                params![note_number, credit_note_code(&note_number), sale.customer_id, money, expires, user.id, return_id, now],
            )?;
            let note_id = tx.last_insert_rowid();
            tx.execute("UPDATE returns SET credit_note_id = ?1 WHERE id = ?2", params![note_id, return_id])?;
        }
        "debt" => {
            // Sur le compte du client : réduit sa dette, l'excédent devient des fonds.
            tx.execute("UPDATE customers SET balance = balance - ?1 WHERE id = ?2", params![money, sale.customer_id])?;
        }
        _ => {}
    }
    if let Some(customer_id) = sale.customer_id {
        // Bonus : la part payée en bonus revient au client ; le bonus gagné sur les articles rendus est retiré.
        let note = format!("Retour {number}");
        loyalty::add_move(&tx, customer_id, "return", bonus_back, Some(sale.id), Some(return_id), Some(&note), Some(user.id))?;
        if sale.loyalty_earned > 0 && sale.total > 0 {
            let earned_back = (sale.loyalty_earned as f64 * total as f64 / sale.total as f64).round() as i64;
            loyalty::add_move(&tx, customer_id, "return", -earned_back, Some(sale.id), Some(return_id), Some(&note), Some(user.id))?;
        }
        let step = settings::get_i64(&tx, "loyalty_step")?;
        if step > 0 {
            tx.execute(
                "UPDATE customers SET loyalty_points = MAX(0, loyalty_points - ?1) WHERE id = ?2",
                params![total / step, customer_id],
            )?;
        }
    }
    let approved = if approver.id != user.id { format!(" — validé par {}", approver.full_name) } else { String::new() };
    audit::log(&tx, user, "Retour d'articles", "sale", Some(sale.id), format!("{number} sur {} : {total} ({method}){approved}", sale.number))?;
    tx.commit()?;
    get_return(conn, return_id)
}
