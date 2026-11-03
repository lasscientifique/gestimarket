use rusqlite::{params, Connection, Row};
use serde::{Deserialize, Serialize};

use crate::db::{self, Query};
use crate::error::{invalid, AppResult};
use crate::services::{audit, cash, sales};
use crate::state::SessionUser;

// ───────────────────────────── Fournisseurs ─────────────────────────────

#[derive(Debug, Serialize)]
pub struct Supplier {
    pub id: i64,
    pub name: String,
    pub contact: Option<String>,
    pub phone: Option<String>,
    pub email: Option<String>,
    pub address: Option<String>,
    pub notes: Option<String>,
    pub active: bool,
    pub created_at: String,
    pub product_count: i64,
    pub purchases_total: i64,
}

#[derive(Debug, Deserialize)]
pub struct SupplierInput {
    pub name: String,
    pub contact: Option<String>,
    pub phone: Option<String>,
    pub email: Option<String>,
    pub address: Option<String>,
    pub notes: Option<String>,
}

pub fn list_suppliers(conn: &Connection, search: Option<String>) -> AppResult<Vec<Supplier>> {
    let mut q = Query::new(
        "SELECT s.id, s.name, s.contact, s.phone, s.email, s.address, s.notes, s.active, s.created_at,
                (SELECT COUNT(*) FROM products p WHERE p.supplier_id = s.id AND p.active = 1),
                (SELECT COALESCE(SUM(total), 0) FROM purchases pu WHERE pu.supplier_id = s.id)
         FROM suppliers s",
    );
    q.and("s.active = 1", vec![]);
    if let Some(s) = db::clean(&search) {
        let like = format!("%{s}%");
        q.and("(s.name LIKE ? OR s.phone LIKE ? OR s.contact LIKE ?)", vec![db::text(&like), db::text(&like), db::text(&like)]);
    }
    q.tail("ORDER BY s.name COLLATE NOCASE", vec![]);
    let mut stmt = conn.prepare(&q.sql)?;
    let rows = stmt.query_map(q.params(), |r| {
        Ok(Supplier {
            id: r.get(0)?,
            name: r.get(1)?,
            contact: r.get(2)?,
            phone: r.get(3)?,
            email: r.get(4)?,
            address: r.get(5)?,
            notes: r.get(6)?,
            active: r.get(7)?,
            created_at: r.get(8)?,
            product_count: r.get(9)?,
            purchases_total: r.get(10)?,
        })
    })?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

pub fn save_supplier(conn: &Connection, user: &SessionUser, id: Option<i64>, input: SupplierInput) -> AppResult<i64> {
    let name = input.name.trim();
    if name.is_empty() {
        return invalid("Le nom du fournisseur est obligatoire.");
    }
    let (contact, phone, email, address, notes) = (
        db::clean(&input.contact),
        db::clean(&input.phone),
        db::clean(&input.email),
        db::clean(&input.address),
        db::clean(&input.notes),
    );
    let id = match id {
        Some(id) => {
            conn.execute(
                "UPDATE suppliers SET name = ?1, contact = ?2, phone = ?3, email = ?4, address = ?5, notes = ?6 WHERE id = ?7",
                params![name, contact, phone, email, address, notes, id],
            )?;
            id
        }
        None => {
            conn.execute(
                "INSERT INTO suppliers (name, contact, phone, email, address, notes, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![name, contact, phone, email, address, notes, db::now()],
            )?;
            conn.last_insert_rowid()
        }
    };
    audit::log(conn, user, "Enregistrement de fournisseur", "supplier", Some(id), name)?;
    Ok(id)
}

pub fn archive_supplier(conn: &Connection, user: &SessionUser, id: i64) -> AppResult<()> {
    let name: String = conn.query_row("SELECT name FROM suppliers WHERE id = ?1", [id], |r| r.get(0))?;
    conn.execute("UPDATE suppliers SET active = 0 WHERE id = ?1", [id])?;
    audit::log(conn, user, "Archivage de fournisseur", "supplier", Some(id), name)?;
    Ok(())
}

// ───────────────────────────── Clients ─────────────────────────────

#[derive(Debug, Serialize)]
pub struct Customer {
    pub id: i64,
    pub name: String,
    pub phone: Option<String>,
    pub email: Option<String>,
    pub address: Option<String>,
    pub notes: Option<String>,
    pub credit_limit: i64,
    pub balance: i64,
    pub loyalty_points: i64,
    pub active: bool,
    pub created_at: String,
    pub purchases_total: i64,
    pub last_purchase_at: Option<String>,
    /// Client grossiste : toujours au prix de gros (quand l'article en a un).
    pub wholesale: bool,
}

const CUSTOMER_SELECT: &str = "SELECT c.id, c.name, c.phone, c.email, c.address, c.notes, c.credit_limit, c.balance,
        c.loyalty_points, c.active, c.created_at,
        (SELECT COALESCE(SUM(total), 0) FROM sales s WHERE s.customer_id = c.id AND s.status = 'completed'),
        (SELECT MAX(created_at) FROM sales s WHERE s.customer_id = c.id AND s.status = 'completed'),
        c.wholesale
    FROM customers c";

fn customer_from_row(r: &Row) -> rusqlite::Result<Customer> {
    Ok(Customer {
        id: r.get(0)?,
        name: r.get(1)?,
        phone: r.get(2)?,
        email: r.get(3)?,
        address: r.get(4)?,
        notes: r.get(5)?,
        credit_limit: r.get(6)?,
        balance: r.get(7)?,
        loyalty_points: r.get(8)?,
        active: r.get(9)?,
        created_at: r.get(10)?,
        purchases_total: r.get(11)?,
        last_purchase_at: r.get(12)?,
        wholesale: r.get(13)?,
    })
}

#[derive(Debug, Deserialize)]
pub struct CustomerInput {
    pub name: String,
    pub phone: Option<String>,
    pub email: Option<String>,
    pub address: Option<String>,
    pub notes: Option<String>,
    pub credit_limit: Option<i64>,
    pub wholesale: Option<bool>,
}

#[derive(Debug, Default, Deserialize)]
pub struct CustomerFilter {
    pub search: Option<String>,
    pub with_debt: Option<bool>,
}

pub fn list_customers(conn: &Connection, f: &CustomerFilter) -> AppResult<Vec<Customer>> {
    let mut q = Query::new(CUSTOMER_SELECT);
    q.and("c.active = 1", vec![]);
    if let Some(s) = db::clean(&f.search) {
        let like = format!("%{s}%");
        q.and("(c.name LIKE ? OR c.phone LIKE ? OR c.email LIKE ?)", vec![db::text(&like), db::text(&like), db::text(&like)]);
    }
    if f.with_debt.unwrap_or(false) {
        q.and("c.balance > 0", vec![]);
    }
    q.tail("ORDER BY c.name COLLATE NOCASE", vec![]);
    let mut stmt = conn.prepare(&q.sql)?;
    let rows = stmt.query_map(q.params(), customer_from_row)?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

pub fn get_customer(conn: &Connection, id: i64) -> AppResult<Customer> {
    Ok(conn.query_row(&format!("{CUSTOMER_SELECT} WHERE c.id = ?1"), [id], customer_from_row)?)
}

pub fn save_customer(conn: &Connection, user: &SessionUser, id: Option<i64>, input: CustomerInput) -> AppResult<Customer> {
    let name = input.name.trim();
    if name.is_empty() {
        return invalid("Le nom du client est obligatoire.");
    }
    let limit = input.credit_limit.unwrap_or(0);
    if limit < 0 {
        return invalid("Le plafond de crédit ne peut pas être négatif.");
    }
    // Seul l'administrateur peut accorder ou modifier un plafond de crédit.
    let limit = if user.is_admin() {
        limit
    } else if let Some(id) = id {
        conn.query_row("SELECT credit_limit FROM customers WHERE id = ?1", [id], |r| r.get(0))?
    } else {
        0
    };
    // Client grossiste : décidé par un gestionnaire ou l'administrateur.
    let wholesale = if user.role != "cashier" {
        input.wholesale.unwrap_or(false)
    } else if let Some(id) = id {
        conn.query_row("SELECT wholesale FROM customers WHERE id = ?1", [id], |r| r.get(0))?
    } else {
        false
    };
    let id = match id {
        Some(id) => {
            conn.execute(
                "UPDATE customers SET name = ?1, phone = ?2, email = ?3, address = ?4, notes = ?5, credit_limit = ?6 WHERE id = ?7",
                params![name, db::clean(&input.phone), db::clean(&input.email), db::clean(&input.address), db::clean(&input.notes), limit, id],
            )?;
            id
        }
        None => {
            conn.execute(
                "INSERT INTO customers (name, phone, email, address, notes, credit_limit, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![name, db::clean(&input.phone), db::clean(&input.email), db::clean(&input.address), db::clean(&input.notes), limit, db::now()],
            )?;
            conn.last_insert_rowid()
        }
    };
    conn.execute("UPDATE customers SET wholesale = ?1 WHERE id = ?2", params![wholesale, id])?;
    audit::log(conn, user, "Enregistrement de client", "customer", Some(id), name)?;
    get_customer(conn, id)
}

pub fn archive_customer(conn: &Connection, user: &SessionUser, id: i64) -> AppResult<()> {
    let (name, balance): (String, i64) =
        conn.query_row("SELECT name, balance FROM customers WHERE id = ?1", [id], |r| Ok((r.get(0)?, r.get(1)?)))?;
    if balance > 0 {
        return invalid("Ce client a encore une dette en cours : impossible de l'archiver.");
    }
    conn.execute("UPDATE customers SET active = 0 WHERE id = ?1", [id])?;
    audit::log(conn, user, "Archivage de client", "customer", Some(id), name)?;
    Ok(())
}

#[derive(Debug, Deserialize)]
pub struct CustomerPaymentInput {
    pub customer_id: i64,
    pub amount: i64,
    pub method: String,
    pub reference: Option<String>,
    pub phone: Option<String>,
    pub note: Option<String>,
}

/// Encaissement d'un règlement de dette client.
pub fn record_payment(conn: &mut Connection, user: &SessionUser, input: CustomerPaymentInput) -> AppResult<Customer> {
    if input.amount <= 0 {
        return invalid("Le montant doit être supérieur à zéro.");
    }
    let reference = db::clean(&input.reference);
    let phone = sales::clean_phone(&input.phone)?;
    sales::check_payment(conn, &input.method, reference.as_deref())?;
    let tx = conn.transaction()?;
    if let Some(r) = &reference {
        sales::ensure_reference_unused(&tx, r)?;
    }
    let (name, balance): (String, i64) = tx.query_row(
        "SELECT name, balance FROM customers WHERE id = ?1",
        [input.customer_id],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?;
    if input.amount > balance {
        return invalid("Le montant dépasse la dette du client.");
    }
    let session_id = cash::open_session_id(&tx, user.id)?;
    if input.method == "cash" && session_id.is_none() {
        return invalid("Un règlement en espèces s'encaisse par un caissier, depuis sa caisse ouverte (l'argent entre dans son tiroir).");
    }
    tx.execute(
        "INSERT INTO customer_payments (customer_id, amount, method, reference, phone, note, user_id, session_id, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![input.customer_id, input.amount, input.method, reference, phone, db::clean(&input.note), user.id, session_id, db::now()],
    )?;
    tx.execute("UPDATE customers SET balance = balance - ?1 WHERE id = ?2", params![input.amount, input.customer_id])?;
    audit::log(&tx, user, "Règlement client", "customer", Some(input.customer_id), format!("{name} : {}", input.amount))?;
    tx.commit()?;
    get_customer(conn, input.customer_id)
}

#[derive(Debug, Serialize)]
pub struct StatementLine {
    pub date: String,
    pub kind: String, // "sale" | "payment"
    pub reference: String,
    pub sale_id: Option<i64>,
    pub total: i64,
    /// Montant ajouté (+) ou retiré (-) de la dette.
    pub debt_change: i64,
    pub method: Option<String>,
}

/// Relevé de compte client : achats et règlements, du plus récent au plus ancien.
pub fn statement(conn: &Connection, customer_id: i64) -> AppResult<Vec<StatementLine>> {
    let mut stmt = conn.prepare(
        "SELECT created_at, 'sale', number, id, total, credit_amount, payment_method
           FROM sales WHERE customer_id = ?1 AND status = 'completed'
         UNION ALL
         SELECT created_at, 'payment', 'Règlement', NULL, amount, -amount, method
           FROM customer_payments WHERE customer_id = ?1
         ORDER BY 1 DESC LIMIT 300",
    )?;
    let rows = stmt.query_map([customer_id], |r| {
        Ok(StatementLine {
            date: r.get(0)?,
            kind: r.get(1)?,
            reference: r.get(2)?,
            sale_id: r.get(3)?,
            total: r.get(4)?,
            debt_change: r.get(5)?,
            method: r.get(6)?,
        })
    })?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}
