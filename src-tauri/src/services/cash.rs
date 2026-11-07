use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};

use crate::db::{self, Query};
use crate::error::{invalid, AppResult};
use crate::services::audit;
use crate::state::SessionUser;

#[derive(Debug, Serialize)]
pub struct CashSession {
    pub id: i64,
    pub user_id: i64,
    pub user_name: String,
    pub opened_at: String,
    pub closed_at: Option<String>,
    pub opening_amount: i64,
    pub expected_amount: Option<i64>,
    pub counted_amount: Option<i64>,
    pub difference: Option<i64>,
    pub status: String,
    pub note: Option<String>,
    // Récapitulatif calculé
    pub sales_count: i64,
    pub sales_total: i64,
    pub cash_sales: i64,
    pub orange_money_sales: i64,
    pub mobile_money_sales: i64,
    pub card_sales: i64,
    pub other_sales: i64,
    pub credit_sales: i64,
    pub customer_payments_cash: i64,
    pub customer_payments_electronic: i64,
    pub cash_in: i64,
    pub cash_out: i64,
    /// Ventes payées avec un avoir.
    pub credit_note_sales: i64,
    /// Ventes payées avec les fonds du compte client, et avec le bonus fidélité.
    pub account_sales: i64,
    pub loyalty_sales: i64,
    /// Retours de la session : nombre, montant rendu, dont espèces sorties du tiroir.
    pub returns_count: i64,
    pub returns_total: i64,
    pub refunds_cash: i64,
    /// Espèces théoriquement présentes dans le tiroir à l'instant présent.
    pub expected_now: i64,
    /// Numéro du rapport Z (session clôturée).
    pub z_number: Option<i64>,
}

const SESSION_SELECT: &str = "SELECT cs.id, cs.user_id, u.full_name, cs.opened_at, cs.closed_at, cs.opening_amount,
        cs.expected_amount, cs.counted_amount, cs.difference, cs.status, cs.note
    FROM cash_sessions cs JOIN users u ON u.id = cs.user_id";

fn session_from_row(r: &Row) -> rusqlite::Result<CashSession> {
    Ok(CashSession {
        id: r.get(0)?,
        user_id: r.get(1)?,
        user_name: r.get(2)?,
        opened_at: r.get(3)?,
        closed_at: r.get(4)?,
        opening_amount: r.get(5)?,
        expected_amount: r.get(6)?,
        counted_amount: r.get(7)?,
        difference: r.get(8)?,
        status: r.get(9)?,
        note: r.get(10)?,
        sales_count: 0,
        sales_total: 0,
        cash_sales: 0,
        orange_money_sales: 0,
        mobile_money_sales: 0,
        card_sales: 0,
        other_sales: 0,
        credit_sales: 0,
        customer_payments_cash: 0,
        customer_payments_electronic: 0,
        cash_in: 0,
        cash_out: 0,
        credit_note_sales: 0,
        account_sales: 0,
        loyalty_sales: 0,
        returns_count: 0,
        returns_total: 0,
        refunds_cash: 0,
        expected_now: 0,
        z_number: None,
    })
}

fn fill_summary(conn: &Connection, s: &mut CashSession) -> AppResult<()> {
    (s.sales_count, s.sales_total, s.credit_sales) = conn.query_row(
        "SELECT COUNT(*), COALESCE(SUM(total), 0), COALESCE(SUM(credit_amount), 0)
         FROM sales WHERE session_id = ?1 AND status = 'completed'",
        [s.id],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
    )?;
    (s.cash_sales, s.orange_money_sales, s.mobile_money_sales, s.card_sales, s.other_sales) = conn.query_row(
        "SELECT COALESCE(SUM(CASE WHEN sp.method = 'cash' THEN sp.amount END), 0),
                COALESCE(SUM(CASE WHEN sp.method = 'orange_money' THEN sp.amount END), 0),
                COALESCE(SUM(CASE WHEN sp.method = 'mobile_money' OR sp.method LIKE 'mm:%' THEN sp.amount END), 0),
                COALESCE(SUM(CASE WHEN sp.method = 'card' THEN sp.amount END), 0),
                COALESCE(SUM(CASE WHEN sp.method = 'other' THEN sp.amount END), 0)
         FROM sale_payments sp JOIN sales sa ON sa.id = sp.sale_id
         WHERE sa.session_id = ?1 AND sa.status = 'completed'",
        [s.id],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
    )?;
    (s.customer_payments_cash, s.customer_payments_electronic) = conn.query_row(
        "SELECT COALESCE(SUM(CASE WHEN method = 'cash' THEN amount END), 0),
                COALESCE(SUM(CASE WHEN method <> 'cash' THEN amount END), 0)
         FROM customer_payments WHERE session_id = ?1",
        [s.id],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?;
    (s.cash_in, s.cash_out) = conn.query_row(
        "SELECT COALESCE(SUM(CASE WHEN kind = 'in' THEN amount ELSE 0 END), 0),
                COALESCE(SUM(CASE WHEN kind = 'out' THEN amount ELSE 0 END), 0)
         FROM cash_movements WHERE session_id = ?1",
        [s.id],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?;
    (s.credit_note_sales, s.account_sales, s.loyalty_sales) = conn.query_row(
        "SELECT COALESCE(SUM(CASE WHEN sp.method = 'credit_note' THEN sp.amount END), 0),
                COALESCE(SUM(CASE WHEN sp.method = 'account' THEN sp.amount END), 0),
                COALESCE(SUM(CASE WHEN sp.method = 'loyalty' THEN sp.amount END), 0)
         FROM sale_payments sp JOIN sales sa ON sa.id = sp.sale_id
         WHERE sa.session_id = ?1 AND sa.status = 'completed'",
        [s.id],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
    )?;
    (s.returns_count, s.returns_total, s.refunds_cash) = conn.query_row(
        "SELECT COUNT(*), COALESCE(SUM(total), 0), COALESCE(SUM(CASE WHEN refund_method = 'cash' THEN total - loyalty_refund END), 0)
         FROM returns WHERE session_id = ?1",
        [s.id],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
    )?;
    s.z_number = conn.query_row("SELECT number FROM z_reports WHERE session_id = ?1", [s.id], |r| r.get(0)).optional()?;
    s.expected_now = s.opening_amount + s.cash_sales + s.customer_payments_cash + s.cash_in - s.cash_out - s.refunds_cash;
    Ok(())
}

pub fn get_session(conn: &Connection, id: i64) -> AppResult<CashSession> {
    let mut s = conn.query_row(&format!("{SESSION_SELECT} WHERE cs.id = ?1"), [id], session_from_row)?;
    fill_summary(conn, &mut s)?;
    Ok(s)
}

/// Identifiant de la session ouverte par cet utilisateur, s'il y en a une.
pub fn open_session_id(conn: &Connection, user_id: i64) -> AppResult<Option<i64>> {
    Ok(conn
        .query_row(
            "SELECT id FROM cash_sessions WHERE user_id = ?1 AND status = 'open' ORDER BY id DESC LIMIT 1",
            [user_id],
            |r| r.get(0),
        )
        .optional()?)
}

pub fn current_session(conn: &Connection, user: &SessionUser) -> AppResult<Option<CashSession>> {
    match open_session_id(conn, user.id)? {
        Some(id) => Ok(Some(get_session(conn, id)?)),
        None => Ok(None),
    }
}

/// Sécurité : seuls les comptes « caissier » ouvrent une caisse et encaissent.
/// Les comptes gestionnaire et administrateur (plus sensibles en cas de fuite) ne vendent pas.
pub fn ensure_cashier(user: &SessionUser) -> AppResult<()> {
    if user.role != "cashier" {
        return invalid(
            "Seuls les comptes caissier peuvent ouvrir une caisse et encaisser. \
             Créez un compte caissier dans « Utilisateurs » et connectez-vous avec lui pour vendre.",
        );
    }
    Ok(())
}

pub fn open(conn: &Connection, user: &SessionUser, opening_amount: i64) -> AppResult<CashSession> {
    ensure_cashier(user)?;
    if opening_amount < 0 {
        return invalid("Le fond de caisse ne peut pas être négatif.");
    }
    if open_session_id(conn, user.id)?.is_some() {
        return invalid("Vous avez déjà une session de caisse ouverte.");
    }
    conn.execute(
        "INSERT INTO cash_sessions (user_id, opened_at, opening_amount, status) VALUES (?1, ?2, ?3, 'open')",
        params![user.id, db::now(), opening_amount],
    )?;
    let id = conn.last_insert_rowid();
    audit::log(conn, user, "Ouverture de caisse", "cash_session", Some(id), format!("Fond de caisse : {opening_amount}"))?;
    get_session(conn, id)
}

#[derive(Debug, Deserialize)]
pub struct CashMovementInput {
    pub kind: String,
    pub amount: i64,
    pub reason: String,
}

pub fn add_movement(conn: &Connection, user: &SessionUser, input: CashMovementInput) -> AppResult<CashSession> {
    let Some(session_id) = open_session_id(conn, user.id)? else {
        return invalid("Aucune session de caisse ouverte.");
    };
    if !["in", "out"].contains(&input.kind.as_str()) {
        return invalid("Type de mouvement invalide.");
    }
    if input.amount <= 0 {
        return invalid("Le montant doit être supérieur à zéro.");
    }
    if input.reason.trim().is_empty() {
        return invalid("Le motif est obligatoire.");
    }
    if input.kind == "out" {
        let s = get_session(conn, session_id)?;
        if input.amount > s.expected_now {
            return invalid("Montant supérieur aux espèces disponibles en caisse.");
        }
    }
    conn.execute(
        "INSERT INTO cash_movements (session_id, kind, amount, reason, user_id, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![session_id, input.kind, input.amount, input.reason.trim(), user.id, db::now()],
    )?;
    let label = if input.kind == "in" { "Entrée de caisse" } else { "Sortie de caisse" };
    audit::log(conn, user, label, "cash_session", Some(session_id), format!("{} — {}", input.amount, input.reason.trim()))?;
    get_session(conn, session_id)
}

#[derive(Debug, Serialize)]
pub struct CashMovement {
    pub id: i64,
    pub kind: String,
    pub amount: i64,
    pub reason: String,
    pub user_name: Option<String>,
    pub created_at: String,
}

pub fn list_movements(conn: &Connection, session_id: i64) -> AppResult<Vec<CashMovement>> {
    let mut stmt = conn.prepare(
        "SELECT m.id, m.kind, m.amount, m.reason, u.full_name, m.created_at
         FROM cash_movements m LEFT JOIN users u ON u.id = m.user_id
         WHERE m.session_id = ?1 ORDER BY m.id DESC",
    )?;
    let rows = stmt.query_map([session_id], |r| {
        Ok(CashMovement {
            id: r.get(0)?,
            kind: r.get(1)?,
            amount: r.get(2)?,
            reason: r.get(3)?,
            user_name: r.get(4)?,
            created_at: r.get(5)?,
        })
    })?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

#[derive(Debug, Deserialize)]
pub struct CloseInput {
    pub counted_amount: i64,
    pub note: Option<String>,
}

pub fn close(conn: &Connection, user: &SessionUser, input: CloseInput) -> AppResult<CashSession> {
    let Some(session_id) = open_session_id(conn, user.id)? else {
        return invalid("Aucune session de caisse ouverte.");
    };
    close_session(conn, user, session_id, input, false)
}

/// Clôture par l'administrateur de la caisse d'un caissier (absent, oubli de clôture…).
pub fn force_close(conn: &Connection, user: &SessionUser, session_id: i64, input: CloseInput) -> AppResult<CashSession> {
    let status: String = conn.query_row("SELECT status FROM cash_sessions WHERE id = ?1", [session_id], |r| r.get(0))?;
    if status != "open" {
        return invalid("Cette session de caisse est déjà clôturée.");
    }
    close_session(conn, user, session_id, input, true)
}

fn close_session(conn: &Connection, user: &SessionUser, session_id: i64, input: CloseInput, forced: bool) -> AppResult<CashSession> {
    if input.counted_amount < 0 {
        return invalid("Le montant compté ne peut pas être négatif.");
    }
    let s = get_session(conn, session_id)?;
    let difference = input.counted_amount - s.expected_now;
    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "UPDATE cash_sessions SET status = 'closed', closed_at = ?1, expected_amount = ?2, counted_amount = ?3,
            difference = ?4, note = ?5 WHERE id = ?6",
        params![db::now(), s.expected_now, input.counted_amount, difference, db::clean(&input.note), session_id],
    )?;
    crate::services::zreport::save(&tx, session_id, user.id)?;
    tx.commit()?;
    audit::log(
        conn,
        user,
        if forced { "Clôture de caisse par l'administrateur" } else { "Clôture de caisse" },
        "cash_session",
        Some(session_id),
        format!("Attendu : {}, compté : {}, écart : {difference}", s.expected_now, input.counted_amount),
    )?;
    get_session(conn, session_id)
}

#[derive(Debug, Default, Deserialize)]
pub struct SessionFilter {
    pub from: Option<String>,
    pub to: Option<String>,
    pub user_id: Option<i64>,
    pub limit: Option<i64>,
}

pub fn list_sessions(conn: &Connection, f: &SessionFilter) -> AppResult<Vec<CashSession>> {
    let mut q = Query::new(SESSION_SELECT);
    if let Some(from) = db::clean(&f.from) {
        q.and("cs.opened_at >= ?", vec![db::text(from)]);
    }
    if let Some(to) = db::clean(&f.to) {
        q.and("cs.opened_at < date(?, '+1 day')", vec![db::text(to)]);
    }
    if let Some(u) = f.user_id {
        q.and("cs.user_id = ?", vec![db::int(u)]);
    }
    q.tail("ORDER BY cs.id DESC LIMIT ?", vec![db::int(f.limit.unwrap_or(200).clamp(1, 2000))]);
    let mut stmt = conn.prepare(&q.sql)?;
    let mut sessions = stmt.query_map(q.params(), session_from_row)?.collect::<Result<Vec<_>, _>>()?;
    for s in sessions.iter_mut() {
        fill_summary(conn, s)?;
    }
    Ok(sessions)
}


// ───────────────────────────── Tableau de bord du caissier ─────────────────────────────

#[derive(Debug, Serialize)]
pub struct HourPoint {
    pub hour: i64,
    pub count: i64,
    pub total: i64,
}

#[derive(Debug, Serialize)]
pub struct TopLine {
    pub name: String,
    pub unit: String,
    pub quantity: f64,
    pub total: i64,
}

#[derive(Debug, Serialize)]
pub struct RecentSale {
    pub id: i64,
    pub number: String,
    pub created_at: String,
    pub total: i64,
    pub status: String,
    pub customer_name: Option<String>,
    pub items: i64,
}

#[derive(Debug, Serialize)]
pub struct CashierStats {
    /// Session ouverte, sinon la dernière session du caissier.
    pub session: Option<CashSession>,
    pub items_sold: f64,
    pub average_basket: i64,
    pub biggest_sale: i64,
    pub discounts_total: i64,
    pub cancelled_count: i64,
    pub cancelled_total: i64,
    pub customers_count: i64,
    pub hourly: Vec<HourPoint>,
    pub top_products: Vec<TopLine>,
    pub recent: Vec<RecentSale>,
    /// Toutes sessions confondues, aujourd'hui.
    pub today_count: i64,
    pub today_total: i64,
}

pub fn cashier_stats(conn: &Connection, user: &SessionUser) -> AppResult<CashierStats> {
    let session_id: Option<i64> = match open_session_id(conn, user.id)? {
        Some(id) => Some(id),
        None => conn
            .query_row("SELECT id FROM cash_sessions WHERE user_id = ?1 ORDER BY id DESC LIMIT 1", [user.id], |r| r.get(0))
            .optional()?,
    };
    let (today_count, today_total): (i64, i64) = conn.query_row(
        "SELECT COUNT(*), COALESCE(SUM(total), 0) FROM sales
         WHERE user_id = ?1 AND status = 'completed' AND date(created_at) = date('now', 'localtime')",
        [user.id],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?;
    let mut stats = CashierStats {
        session: None,
        items_sold: 0.0,
        average_basket: 0,
        biggest_sale: 0,
        discounts_total: 0,
        cancelled_count: 0,
        cancelled_total: 0,
        customers_count: 0,
        hourly: Vec::new(),
        top_products: Vec::new(),
        recent: Vec::new(),
        today_count,
        today_total,
    };
    let Some(sid) = session_id else { return Ok(stats) };
    let session = get_session(conn, sid)?;
    stats.average_basket = if session.sales_count > 0 { session.sales_total / session.sales_count } else { 0 };
    (stats.biggest_sale, stats.discounts_total, stats.customers_count) = conn.query_row(
        "SELECT COALESCE(MAX(total), 0),
                COALESCE(SUM(discount), 0) + COALESCE((SELECT SUM(si.discount) FROM sale_items si JOIN sales x ON x.id = si.sale_id
                                                        WHERE x.session_id = ?1 AND x.status = 'completed'), 0),
                COUNT(DISTINCT customer_id)
         FROM sales WHERE session_id = ?1 AND status = 'completed'",
        [sid],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
    )?;
    (stats.cancelled_count, stats.cancelled_total) = conn.query_row(
        "SELECT COUNT(*), COALESCE(SUM(total), 0) FROM sales WHERE session_id = ?1 AND status = 'cancelled'",
        [sid],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?;
    stats.items_sold = conn.query_row(
        "SELECT COALESCE(SUM(si.quantity), 0) FROM sale_items si JOIN sales s ON s.id = si.sale_id
         WHERE s.session_id = ?1 AND s.status = 'completed'",
        [sid],
        |r| r.get(0),
    )?;
    let mut stmt = conn.prepare(
        "SELECT CAST(strftime('%H', created_at) AS INTEGER), COUNT(*), COALESCE(SUM(total), 0)
         FROM sales WHERE session_id = ?1 AND status = 'completed' GROUP BY 1 ORDER BY 1",
    )?;
    stats.hourly = stmt
        .query_map([sid], |r| Ok(HourPoint { hour: r.get(0)?, count: r.get(1)?, total: r.get(2)? }))?
        .collect::<Result<_, _>>()?;
    let mut stmt = conn.prepare(
        "SELECT si.product_name, si.unit, SUM(si.quantity), SUM(si.total)
         FROM sale_items si JOIN sales s ON s.id = si.sale_id
         WHERE s.session_id = ?1 AND s.status = 'completed'
         GROUP BY si.product_name, si.unit ORDER BY SUM(si.total) DESC LIMIT 6",
    )?;
    stats.top_products = stmt
        .query_map([sid], |r| Ok(TopLine { name: r.get(0)?, unit: r.get(1)?, quantity: r.get(2)?, total: r.get(3)? }))?
        .collect::<Result<_, _>>()?;
    let mut stmt = conn.prepare(
        "SELECT s.id, s.number, s.created_at, s.total, s.status, c.name,
                (SELECT COUNT(*) FROM sale_items si WHERE si.sale_id = s.id)
         FROM sales s LEFT JOIN customers c ON c.id = s.customer_id
         WHERE s.session_id = ?1 ORDER BY s.id DESC LIMIT 8",
    )?;
    stats.recent = stmt
        .query_map([sid], |r| {
            Ok(RecentSale {
                id: r.get(0)?,
                number: r.get(1)?,
                created_at: r.get(2)?,
                total: r.get(3)?,
                status: r.get(4)?,
                customer_name: r.get(5)?,
                items: r.get(6)?,
            })
        })?
        .collect::<Result<_, _>>()?;
    stats.session = Some(session);
    Ok(stats)
}
