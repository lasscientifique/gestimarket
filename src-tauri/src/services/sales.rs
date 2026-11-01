use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};

use crate::db::{self, Query};
use crate::error::{invalid, AppResult};
use crate::services::{audit, cash, settings, stock};
use crate::state::SessionUser;

/// Moyens de paiement réels (le crédit est le reste non payé, il n'est pas un « paiement »).
pub const PAYMENT_METHODS: &[&str] = &["cash", "orange_money", "mobile_money", "card", "other"];

#[derive(Debug, Deserialize)]
pub struct SaleItemInput {
    pub product_id: i64,
    pub quantity: f64,
    /// Remise sur la ligne (montant total, pas unitaire).
    pub discount: Option<i64>,
    /// Vente par conditionnement (carton, sac…) : `quantity` est alors un nombre de conditionnements.
    pub packaging_id: Option<i64>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct PaymentInput {
    pub method: String,
    /// Espèces : montant remis par le client. Autres : montant encaissé.
    pub amount: i64,
    /// ID de transaction (Orange Money / Sarali, mobile money, ticket carte).
    pub reference: Option<String>,
    /// Numéro de téléphone du payeur.
    pub phone: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct SaleInput {
    pub items: Vec<SaleItemInput>,
    pub customer_id: Option<i64>,
    /// Remise globale sur le ticket.
    pub discount: Option<i64>,
    pub payments: Vec<PaymentInput>,
    pub note: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct SaleItem {
    pub id: i64,
    pub product_id: i64,
    pub product_name: String,
    pub unit: String,
    pub quantity: f64,
    pub unit_price: i64,
    pub discount: i64,
    pub tax_rate: f64,
    pub total: i64,
    /// Quantité en unités de base (différente de `quantity` pour une vente par conditionnement).
    pub base_quantity: f64,
    pub packaging_id: Option<i64>,
}

#[derive(Debug, Serialize)]
pub struct SalePayment {
    pub id: i64,
    pub method: String,
    pub amount: i64,
    pub tendered: i64,
    pub reference: Option<String>,
    pub phone: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct Sale {
    pub id: i64,
    pub number: String,
    pub customer_id: Option<i64>,
    pub customer_name: Option<String>,
    pub user_id: i64,
    pub user_name: String,
    pub session_id: Option<i64>,
    pub subtotal: i64,
    pub discount: i64,
    pub tax_total: i64,
    pub total: i64,
    pub cost_total: i64,
    pub amount_paid: i64,
    pub change_due: i64,
    pub credit_amount: i64,
    pub payment_method: String,
    pub status: String,
    pub note: Option<String>,
    pub created_at: String,
    pub cancelled_at: Option<String>,
    pub cancel_reason: Option<String>,
    pub items_count: f64,
    pub items: Vec<SaleItem>,
    pub payments: Vec<SalePayment>,
}

const SALE_SELECT: &str = "SELECT s.id, s.number, s.customer_id, c.name, s.user_id, u.full_name, s.session_id,
        s.subtotal, s.discount, s.tax_total, s.total, s.cost_total, s.amount_paid, s.change_due,
        s.credit_amount, s.payment_method, s.status, s.note, s.created_at, s.cancelled_at, s.cancel_reason,
        (SELECT COALESCE(SUM(quantity), 0) FROM sale_items si WHERE si.sale_id = s.id)
    FROM sales s
    JOIN users u ON u.id = s.user_id
    LEFT JOIN customers c ON c.id = s.customer_id";

fn sale_from_row(r: &Row) -> rusqlite::Result<Sale> {
    Ok(Sale {
        id: r.get(0)?,
        number: r.get(1)?,
        customer_id: r.get(2)?,
        customer_name: r.get(3)?,
        user_id: r.get(4)?,
        user_name: r.get(5)?,
        session_id: r.get(6)?,
        subtotal: r.get(7)?,
        discount: r.get(8)?,
        tax_total: r.get(9)?,
        total: r.get(10)?,
        cost_total: r.get(11)?,
        amount_paid: r.get(12)?,
        change_due: r.get(13)?,
        credit_amount: r.get(14)?,
        payment_method: r.get(15)?,
        status: r.get(16)?,
        note: r.get(17)?,
        created_at: r.get(18)?,
        cancelled_at: r.get(19)?,
        cancel_reason: r.get(20)?,
        items_count: r.get(21)?,
        items: Vec::new(),
        payments: Vec::new(),
    })
}

pub fn get_sale(conn: &Connection, id: i64) -> AppResult<Sale> {
    let mut sale = conn.query_row(&format!("{SALE_SELECT} WHERE s.id = ?1"), [id], sale_from_row)?;
    let mut stmt = conn.prepare(
        "SELECT id, product_id, product_name, unit, quantity, unit_price, discount, tax_rate, total,
                COALESCE(base_quantity, quantity), packaging_id
         FROM sale_items WHERE sale_id = ?1 ORDER BY id",
    )?;
    sale.items = stmt
        .query_map([id], |r| {
            Ok(SaleItem {
                id: r.get(0)?,
                product_id: r.get(1)?,
                product_name: r.get(2)?,
                unit: r.get(3)?,
                quantity: r.get(4)?,
                unit_price: r.get(5)?,
                discount: r.get(6)?,
                tax_rate: r.get(7)?,
                total: r.get(8)?,
                base_quantity: r.get(9)?,
                packaging_id: r.get(10)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    let mut stmt = conn.prepare(
        "SELECT id, method, amount, tendered, reference, phone FROM sale_payments WHERE sale_id = ?1 ORDER BY id",
    )?;
    sale.payments = stmt
        .query_map([id], |r| {
            Ok(SalePayment {
                id: r.get(0)?,
                method: r.get(1)?,
                amount: r.get(2)?,
                tendered: r.get(3)?,
                reference: r.get(4)?,
                phone: r.get(5)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(sale)
}

/// Vérifie qu'un ID de transaction n'a pas déjà été utilisé (protection contre la fraude
/// consistant à présenter deux fois la même confirmation de paiement).
pub fn ensure_reference_unused(conn: &Connection, reference: &str) -> AppResult<()> {
    let used: Option<String> = conn
        .query_row(
            "SELECT s.number FROM sale_payments sp JOIN sales s ON s.id = sp.sale_id
             WHERE sp.reference = ?1 COLLATE NOCASE AND s.status = 'completed' LIMIT 1",
            [reference],
            |r| r.get(0),
        )
        .optional()?;
    if let Some(number) = used {
        return invalid(format!("L'ID de transaction « {reference} » a déjà été utilisé (vente {number})."));
    }
    let used_payment: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM customer_payments WHERE reference = ?1 COLLATE NOCASE)",
        [reference],
        |r| r.get(0),
    )?;
    if used_payment {
        return invalid(format!("L'ID de transaction « {reference} » a déjà été utilisé pour un règlement client."));
    }
    Ok(())
}

/// Nettoie et contrôle un numéro de téléphone (chiffres, espaces, +).
pub fn clean_phone(p: &Option<String>) -> AppResult<Option<String>> {
    match db::clean(p) {
        None => Ok(None),
        Some(s) => {
            if !s.chars().all(|c| c.is_ascii_digit() || c == ' ' || c == '+' || c == '-' || c == '.') {
                return invalid("Numéro de téléphone invalide.");
            }
            Ok(Some(s))
        }
    }
}

struct Line {
    product_id: i64,
    name: String,
    unit: String,
    quantity: f64,
    unit_price: i64,
    unit_cost: i64,
    discount: i64,
    tax_rate: f64,
    total: i64,
    tax: i64,
    cost: i64,
    track_stock: bool,
    base_quantity: f64,
    packaging_id: Option<i64>,
}

/// Enregistre une vente : contrôle des stocks, calcul des totaux, paiements (éventuellement multiples),
/// crédit client, mouvements de stock et points de fidélité — dans une seule transaction.
pub fn create_sale(conn: &mut Connection, user: &SessionUser, input: SaleInput) -> AppResult<Sale> {
    if input.items.is_empty() {
        return invalid("Le panier est vide.");
    }
    let allow_negative = settings::get_bool(conn, "allow_negative_stock")?;
    let require_session = settings::get_bool(conn, "require_cash_session")?;
    let loyalty_step = settings::get_i64(conn, "loyalty_step")?;
    let om_require_ref = settings::get_bool(conn, "om_require_reference")?;

    cash::ensure_cashier(user)?;
    let tx = conn.transaction()?;
    let session_id = cash::open_session_id(&tx, user.id)?;
    if require_session && session_id.is_none() {
        return invalid("Aucune session de caisse ouverte. Ouvrez la caisse avant d'encaisser.");
    }

    // 1. Lignes : prix toujours relus en base (le frontend ne fixe pas les prix).
    let mut lines: Vec<Line> = Vec::with_capacity(input.items.len());
    for item in &input.items {
        let qty = db::round_qty(item.quantity);
        if qty <= 0.0 || !qty.is_finite() {
            return invalid("Les quantités doivent être supérieures à zéro.");
        }
        let (name, unit, price, cost, tax_rate, stock_qty, track, active): (String, String, i64, i64, f64, f64, bool, bool) =
            tx.query_row(
                "SELECT name, unit, sale_price, purchase_price, tax_rate, stock, track_stock, active FROM products WHERE id = ?1",
                [item.product_id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?, r.get(7)?)),
            )?;
        if !active {
            return invalid(format!("Le produit « {name} » est archivé."));
        }
        // Conditionnement : prix du carton / sac, stock décompté en unités de base.
        let (line_name, line_unit, unit_price, base_qty) = match item.packaging_id {
            Some(pack_id) => {
                let (pname, pqty, pprice): (String, f64, i64) = tx.query_row(
                    "SELECT name, quantity, sale_price FROM product_packagings WHERE id = ?1 AND product_id = ?2",
                    params![pack_id, item.product_id],
                    |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
                )?;
                (format!("{name} — {pname}"), pname, pprice, db::round_qty(qty * pqty))
            }
            None => (name.clone(), unit.clone(), price, qty),
        };
        let already: f64 = lines.iter().filter(|l| l.product_id == item.product_id).map(|l| l.base_quantity).sum();
        if track && !allow_negative && already + base_qty > stock_qty + 1e-9 {
            return invalid(format!("Stock insuffisant pour « {name} » (disponible : {stock_qty} {unit})."));
        }
        let price = unit_price;
        let gross = (qty * price as f64).round() as i64;
        let discount = item.discount.unwrap_or(0).clamp(0, gross);
        let total = gross - discount;
        let tax = if tax_rate > 0.0 { (total as f64 * tax_rate / (100.0 + tax_rate)).round() as i64 } else { 0 };
        lines.push(Line {
            product_id: item.product_id,
            name: line_name,
            unit: line_unit,
            quantity: qty,
            unit_price: price,
            unit_cost: cost,
            discount,
            tax_rate,
            total,
            tax,
            cost: (base_qty * cost as f64).round() as i64,
            track_stock: track,
            base_quantity: base_qty,
            packaging_id: item.packaging_id,
        });
    }

    // 2. Totaux
    let subtotal: i64 = lines.iter().map(|l| l.total).sum();
    let discount = input.discount.unwrap_or(0).clamp(0, subtotal);
    let total = subtotal - discount;
    let line_tax: i64 = lines.iter().map(|l| l.tax).sum();
    let tax_total = if subtotal > 0 { (line_tax as f64 * total as f64 / subtotal as f64).round() as i64 } else { 0 };
    let cost_total: i64 = lines.iter().map(|l| l.cost).sum();

    // 3. Paiements
    let mut payments: Vec<PaymentInput> = Vec::new();
    for p in input.payments.iter().filter(|p| p.amount > 0) {
        if !PAYMENT_METHODS.contains(&p.method.as_str()) {
            return invalid("Mode de paiement invalide.");
        }
        let reference = db::clean(&p.reference);
        let phone = clean_phone(&p.phone)?;
        if p.method == "orange_money" && om_require_ref && reference.is_none() {
            return invalid("Saisissez ou scannez l'ID de transaction Orange Money.");
        }
        if let Some(r) = &reference {
            if payments.iter().any(|x| x.reference.as_deref() == Some(r.as_str())) {
                return invalid("Le même ID de transaction est saisi deux fois.");
            }
            ensure_reference_unused(&tx, r)?;
        }
        payments.push(PaymentInput { method: p.method.clone(), amount: p.amount, reference, phone });
    }
    let non_cash: i64 = payments.iter().filter(|p| p.method != "cash").map(|p| p.amount).sum();
    if non_cash > total {
        return invalid("Les paiements électroniques dépassent le montant à payer (la monnaie ne se rend qu'en espèces).");
    }
    let cash_tendered: i64 = payments.iter().filter(|p| p.method == "cash").map(|p| p.amount).sum();
    let cash_applied = cash_tendered.min(total - non_cash);
    let change_due = cash_tendered - cash_applied;
    let paid = non_cash + cash_applied;
    let credit_amount = total - paid;

    if credit_amount > 0 {
        let Some(customer_id) = input.customer_id else {
            return invalid("Montant payé insuffisant. Sélectionnez un client pour enregistrer le reste à crédit.");
        };
        let (cname, limit, balance): (String, i64, i64) = tx.query_row(
            "SELECT name, credit_limit, balance FROM customers WHERE id = ?1 AND active = 1",
            [customer_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )?;
        if limit <= 0 {
            return invalid(format!("Le client « {cname} » n'est pas autorisé à acheter à crédit."));
        }
        if balance + credit_amount > limit {
            return invalid(format!(
                "Plafond de crédit dépassé pour « {cname} » (dette actuelle : {balance}, plafond : {limit})."
            ));
        }
    }

    // Mode de paiement résumé : le seul moyen utilisé, « mixed » s'il y en a plusieurs, « credit » si rien n'est payé.
    let mut methods: Vec<&str> = Vec::new();
    for p in &payments {
        let applied = if p.method == "cash" { cash_applied } else { p.amount };
        if applied > 0 && !methods.contains(&p.method.as_str()) {
            methods.push(p.method.as_str());
        }
    }
    let payment_method = match methods.len() {
        0 => "credit".to_string(),
        1 => methods[0].to_string(),
        _ => "mixed".to_string(),
    };

    // 4. Écritures
    let number = db::next_number(&tx, "sales", "V")?;
    let now = db::now();
    tx.execute(
        "INSERT INTO sales (number, customer_id, user_id, session_id, subtotal, discount, tax_total, total, cost_total,
            amount_paid, change_due, credit_amount, payment_method, status, note, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, 'completed', ?14, ?15)",
        params![
            number,
            input.customer_id,
            user.id,
            session_id,
            subtotal,
            discount,
            tax_total,
            total,
            cost_total,
            non_cash + cash_tendered,
            change_due,
            credit_amount,
            payment_method,
            db::clean(&input.note),
            now
        ],
    )?;
    let sale_id = tx.last_insert_rowid();

    // Les espèces sont regroupées en une seule ligne (montant imputé + montant remis).
    if cash_tendered > 0 {
        tx.execute(
            "INSERT INTO sale_payments (sale_id, method, amount, tendered, created_at) VALUES (?1, 'cash', ?2, ?3, ?4)",
            params![sale_id, cash_applied, cash_tendered, now],
        )?;
    }
    for p in payments.iter().filter(|p| p.method != "cash") {
        tx.execute(
            "INSERT INTO sale_payments (sale_id, method, amount, tendered, reference, phone, created_at)
             VALUES (?1, ?2, ?3, ?3, ?4, ?5, ?6)",
            params![sale_id, p.method, p.amount, p.reference, p.phone, now],
        )?;
    }

    for l in &lines {
        tx.execute(
            "INSERT INTO sale_items (sale_id, product_id, product_name, unit, quantity, unit_price, unit_cost, discount, tax_rate, total,
                                     base_quantity, packaging_id)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
            params![sale_id, l.product_id, l.name, l.unit, l.quantity, l.unit_price, l.unit_cost, l.discount, l.tax_rate, l.total,
                    l.base_quantity, l.packaging_id],
        )?;
        if l.track_stock {
            stock::apply_change(&tx, l.product_id, -l.base_quantity, "sale", Some(l.unit_cost), Some(&number), None, user.id)?;
        }
    }

    if let Some(customer_id) = input.customer_id {
        let points = if loyalty_step > 0 { total / loyalty_step } else { 0 };
        tx.execute(
            "UPDATE customers SET balance = balance + ?1, loyalty_points = loyalty_points + ?2 WHERE id = ?3",
            params![credit_amount, points, customer_id],
        )?;
    }

    tx.commit()?;
    get_sale(conn, sale_id)
}

/// Annule une vente : remise en stock, annulation de la dette et des points de fidélité.
pub fn cancel_sale(conn: &mut Connection, user: &SessionUser, id: i64, reason: &str) -> AppResult<Sale> {
    if reason.trim().is_empty() {
        return invalid("Le motif d'annulation est obligatoire.");
    }
    let loyalty_step = settings::get_i64(conn, "loyalty_step")?;
    let sale = get_sale(conn, id)?;
    if sale.status != "completed" {
        return invalid("Cette vente est déjà annulée.");
    }
    let tx = conn.transaction()?;
    for item in &sale.items {
        let track: bool = tx.query_row("SELECT track_stock FROM products WHERE id = ?1", [item.product_id], |r| r.get(0))?;
        if track {
            stock::apply_change(&tx, item.product_id, item.base_quantity, "sale_cancel", None, Some(&sale.number), Some(reason.trim()), user.id)?;
        }
    }
    if let Some(customer_id) = sale.customer_id {
        let points = if loyalty_step > 0 { sale.total / loyalty_step } else { 0 };
        tx.execute(
            "UPDATE customers SET balance = balance - ?1, loyalty_points = MAX(0, loyalty_points - ?2) WHERE id = ?3",
            params![sale.credit_amount, points, customer_id],
        )?;
    }
    tx.execute(
        "UPDATE sales SET status = 'cancelled', cancelled_at = ?1, cancelled_by = ?2, cancel_reason = ?3 WHERE id = ?4",
        params![db::now(), user.id, reason.trim(), id],
    )?;
    audit::log(&tx, user, "Annulation de vente", "sale", Some(id), format!("{} — {}", sale.number, reason.trim()))?;
    tx.commit()?;
    get_sale(conn, id)
}

#[derive(Debug, Default, Deserialize)]
pub struct SaleFilter {
    pub from: Option<String>,
    pub to: Option<String>,
    pub search: Option<String>,
    pub status: Option<String>,
    pub payment_method: Option<String>,
    pub user_id: Option<i64>,
    pub customer_id: Option<i64>,
    pub session_id: Option<i64>,
    pub limit: Option<i64>,
}

pub fn list_sales(conn: &Connection, f: &SaleFilter) -> AppResult<Vec<Sale>> {
    let mut q = Query::new(SALE_SELECT);
    if let Some(from) = db::clean(&f.from) {
        q.and("s.created_at >= ?", vec![db::text(from)]);
    }
    if let Some(to) = db::clean(&f.to) {
        q.and("s.created_at < date(?, '+1 day')", vec![db::text(to)]);
    }
    if let Some(s) = db::clean(&f.search) {
        let like = format!("%{s}%");
        q.and(
            "(s.number LIKE ? OR c.name LIKE ? OR EXISTS (SELECT 1 FROM sale_payments sp WHERE sp.sale_id = s.id AND (sp.reference LIKE ? OR sp.phone LIKE ?)))",
            vec![db::text(&like), db::text(&like), db::text(&like), db::text(&like)],
        );
    }
    if let Some(st) = db::clean(&f.status) {
        q.and("s.status = ?", vec![db::text(st)]);
    }
    if let Some(m) = db::clean(&f.payment_method) {
        if m == "credit" {
            q.and("s.credit_amount > 0", vec![]);
        } else {
            q.and(
                "(s.payment_method = ? OR EXISTS (SELECT 1 FROM sale_payments sp WHERE sp.sale_id = s.id AND sp.method = ? AND sp.amount > 0))",
                vec![db::text(&m), db::text(&m)],
            );
        }
    }
    if let Some(u) = f.user_id {
        q.and("s.user_id = ?", vec![db::int(u)]);
    }
    if let Some(c) = f.customer_id {
        q.and("s.customer_id = ?", vec![db::int(c)]);
    }
    if let Some(sid) = f.session_id {
        q.and("s.session_id = ?", vec![db::int(sid)]);
    }
    q.tail("ORDER BY s.id DESC LIMIT ?", vec![db::int(f.limit.unwrap_or(500).clamp(1, 10000))]);
    let mut stmt = conn.prepare(&q.sql)?;
    let rows = stmt.query_map(q.params(), sale_from_row)?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

// ───────────────────────────── Paiements électroniques (rapprochement) ─────────────────────────────

#[derive(Debug, Serialize)]
pub struct ElectronicPayment {
    pub date: String,
    pub source: String, // "sale" | "customer_payment"
    pub sale_id: Option<i64>,
    pub document: String,
    pub method: String,
    pub amount: i64,
    pub reference: Option<String>,
    pub phone: Option<String>,
    pub customer_name: Option<String>,
    pub user_name: Option<String>,
}

#[derive(Debug, Default, Deserialize)]
pub struct ElectronicFilter {
    pub from: Option<String>,
    pub to: Option<String>,
    pub method: Option<String>,
    pub search: Option<String>,
}

/// Liste des encaissements Orange Money / mobile money / carte pour le rapprochement
/// avec le relevé de l'opérateur.
pub fn list_electronic(conn: &Connection, f: &ElectronicFilter) -> AppResult<Vec<ElectronicPayment>> {
    let from = db::clean(&f.from).unwrap_or_else(|| "0000-01-01".into());
    let to = db::clean(&f.to).unwrap_or_else(|| "9000-12-31".into());
    let method = db::clean(&f.method);
    let search = db::clean(&f.search).map(|s| format!("%{s}%"));
    let mut stmt = conn.prepare(
        "SELECT * FROM (
            SELECT sp.created_at AS d, 'sale' AS src, s.id, s.number, sp.method, sp.amount, sp.reference, sp.phone, c.name, u.full_name
              FROM sale_payments sp JOIN sales s ON s.id = sp.sale_id
              JOIN users u ON u.id = s.user_id LEFT JOIN customers c ON c.id = s.customer_id
             WHERE s.status = 'completed' AND sp.method <> 'cash'
            UNION ALL
            SELECT cp.created_at, 'customer_payment', NULL, 'Règlement client', cp.method, cp.amount, cp.reference, cp.phone, c.name, u.full_name
              FROM customer_payments cp JOIN customers c ON c.id = cp.customer_id LEFT JOIN users u ON u.id = cp.user_id
             WHERE cp.method <> 'cash'
         )
         WHERE d >= ?1 AND d < date(?2, '+1 day')
           AND (?3 IS NULL OR method = ?3)
           AND (?4 IS NULL OR reference LIKE ?4 OR phone LIKE ?4 OR number LIKE ?4)
         ORDER BY d DESC LIMIT 5000",
    )?;
    let rows = stmt.query_map(params![from, to, method, search], |r| {
        Ok(ElectronicPayment {
            date: r.get(0)?,
            source: r.get(1)?,
            sale_id: r.get(2)?,
            document: r.get(3)?,
            method: r.get(4)?,
            amount: r.get(5)?,
            reference: r.get(6)?,
            phone: r.get(7)?,
            customer_name: r.get(8)?,
            user_name: r.get(9)?,
        })
    })?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}
