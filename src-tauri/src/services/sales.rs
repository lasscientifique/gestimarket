use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};

use crate::db::{self, Query};
use crate::error::{invalid, AppResult};
use crate::services::{audit, cash, settings, stock};
use crate::state::SessionUser;

/// Moyens de paiement réels (le crédit est le reste non payé, il n'est pas un « paiement »).
pub const PAYMENT_METHODS: &[&str] = &["cash", "orange_money", "mobile_money", "card", "other"];

/// Opérateur de mobile money configuré en caisse (paramètre « mobile_operators », liste JSON).
/// Ses paiements ont pour mode « mm:<id> » (ex. « mm:wave »).
#[derive(Debug, Deserialize)]
pub struct MobileOperator {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub require_ref: bool,
    #[serde(default = "enabled_default")]
    pub enabled: bool,
}

fn enabled_default() -> bool {
    true
}

/// Vérifie la liste des opérateurs avant enregistrement des paramètres.
pub fn validate_operators(json: &str) -> AppResult<()> {
    if json.trim().is_empty() {
        return Ok(());
    }
    let ops: Vec<MobileOperator> = match serde_json::from_str(json) {
        Ok(v) => v,
        Err(_) => return invalid("Liste des opérateurs de paiement mobile illisible."),
    };
    for (i, op) in ops.iter().enumerate() {
        let id_ok = (1..=20).contains(&op.id.len())
            && op.id.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_' || c == '-');
        if !id_ok {
            return invalid("Identifiant d'opérateur invalide (lettres minuscules, chiffres, - ou _).");
        }
        if op.name.trim().is_empty() {
            return invalid("Chaque opérateur de paiement mobile doit avoir un nom.");
        }
        if ops[..i].iter().any(|o| o.id == op.id) {
            return invalid("Deux opérateurs de paiement mobile ont le même identifiant.");
        }
    }
    Ok(())
}

fn mobile_operators(conn: &Connection) -> AppResult<Vec<MobileOperator>> {
    let raw = settings::get(conn, "mobile_operators")?;
    Ok(if raw.trim().is_empty() { Vec::new() } else { serde_json::from_str(&raw).unwrap_or_default() })
}

/// Contrôle le mode de paiement (fixe ou opérateur actif « mm:<id> ») et l'ID de transaction
/// lorsque l'opérateur l'exige.
pub fn check_payment(conn: &Connection, method: &str, reference: Option<&str>) -> AppResult<()> {
    if method == "credit_note" {
        if reference.is_none() {
            return invalid("Saisissez ou scannez le code de l'avoir.");
        }
        return Ok(());
    }
    if method == "orange_money" {
        if reference.is_none() && settings::get_bool(conn, "om_require_reference")? {
            return invalid("Saisissez ou scannez l'ID de transaction Orange Money.");
        }
        return Ok(());
    }
    if PAYMENT_METHODS.contains(&method) {
        return Ok(());
    }
    let op = match method.strip_prefix("mm:") {
        Some(id) => mobile_operators(conn)?.into_iter().find(|o| o.id == id && o.enabled),
        None => None,
    };
    match op {
        None => invalid("Mode de paiement invalide."),
        Some(op) if op.require_ref && reference.is_none() => {
            invalid(format!("Saisissez ou scannez l'ID de transaction {}.", op.name))
        }
        Some(_) => Ok(()),
    }
}

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
    /// Prix appliqué : « retail » (normal), « wholesale » (gros) ou « promo ».
    pub price_kind: String,
    /// Prix normal quand un prix de gros ou une promotion s'applique (économie sur le ticket).
    pub regular_price: Option<i64>,
    /// Quantité déjà retournée (unités de vente).
    pub returned_quantity: f64,
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
    /// Montant déjà rendu par des retours.
    pub returned_total: i64,
    pub items: Vec<SaleItem>,
    pub payments: Vec<SalePayment>,
}

const SALE_SELECT: &str = "SELECT s.id, s.number, s.customer_id, c.name, s.user_id, u.full_name, s.session_id,
        s.subtotal, s.discount, s.tax_total, s.total, s.cost_total, s.amount_paid, s.change_due,
        s.credit_amount, s.payment_method, s.status, s.note, s.created_at, s.cancelled_at, s.cancel_reason,
        (SELECT COALESCE(SUM(quantity), 0) FROM sale_items si WHERE si.sale_id = s.id),
        (SELECT COALESCE(SUM(total), 0) FROM returns rt WHERE rt.sale_id = s.id)
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
        returned_total: r.get(22)?,
        items: Vec::new(),
        payments: Vec::new(),
    })
}

pub fn get_sale(conn: &Connection, id: i64) -> AppResult<Sale> {
    let mut sale = conn.query_row(&format!("{SALE_SELECT} WHERE s.id = ?1"), [id], sale_from_row)?;
    let mut stmt = conn.prepare(
        "SELECT si.id, si.product_id, si.product_name, si.unit, si.quantity, si.unit_price, si.discount, si.tax_rate, si.total,
                COALESCE(si.base_quantity, si.quantity), si.packaging_id, si.price_kind, si.regular_price,
                (SELECT COALESCE(SUM(ri.quantity), 0) FROM return_items ri WHERE ri.sale_item_id = si.id)
         FROM sale_items si WHERE si.sale_id = ?1 ORDER BY si.id",
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
                price_kind: r.get(11)?,
                regular_price: r.get(12)?,
                returned_quantity: r.get(13)?,
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

// ───────────────────────────── Prix de gros et promotions ─────────────────────────────

/// Prix d'une ligne : normal, de gros (quantité atteinte ou client grossiste) ou promotion du jour,
/// le plus bas des trois. `unit_price` est le prix d'une unité de vente (le carton s'il est vendu au carton).
#[derive(Debug, Clone, Serialize)]
pub struct LinePrice {
    pub unit_price: i64,
    pub regular_price: i64,
    pub kind: &'static str,
    pub promotion_id: Option<i64>,
    pub promotion_name: Option<String>,
    #[serde(skip)]
    pub packaging_name: Option<String>,
    /// Unités de base dans une unité de vente (1, ou le contenu du carton).
    #[serde(skip)]
    pub pack_quantity: f64,
}

pub fn is_wholesale_customer(conn: &Connection, customer_id: Option<i64>) -> AppResult<bool> {
    let Some(id) = customer_id else {
        return Ok(false);
    };
    let flag: Option<i64> = conn.query_row("SELECT wholesale FROM customers WHERE id = ?1", [id], |r| r.get(0)).optional()?;
    Ok(flag == Some(1))
}

pub fn price_line(
    conn: &Connection,
    product_id: i64,
    packaging_id: Option<i64>,
    qty: f64,
    wholesale_customer: bool,
    today: &str,
) -> AppResult<LinePrice> {
    let (price, w_price, w_min, category_id): (i64, i64, f64, Option<i64>) = conn.query_row(
        "SELECT sale_price, wholesale_price, wholesale_min_qty, category_id FROM products WHERE id = ?1",
        [product_id],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
    )?;
    let (regular, w_price, w_min, pack_name, pack_qty) = match packaging_id {
        Some(pack_id) => {
            let (name, quantity, sale_price, wp, wm): (String, f64, i64, i64, f64) = conn.query_row(
                "SELECT name, quantity, sale_price, wholesale_price, wholesale_min_qty FROM product_packagings
                 WHERE id = ?1 AND product_id = ?2",
                params![pack_id, product_id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
            )?;
            (sale_price, wp, wm, Some(name), quantity)
        }
        None => (price, w_price, w_min, None, 1.0),
    };
    let mut best = LinePrice {
        unit_price: regular,
        regular_price: regular,
        kind: "retail",
        promotion_id: None,
        promotion_name: None,
        packaging_name: pack_name,
        pack_quantity: pack_qty,
    };
    if w_price > 0 && w_price < best.unit_price && (wholesale_customer || (w_min > 0.0 && qty + 1e-9 >= w_min)) {
        best.unit_price = w_price;
        best.kind = "wholesale";
    }
    // Promotions du jour sur l'article, sa catégorie ou une catégorie parente.
    let mut stmt = conn.prepare(
        "WITH RECURSIVE chain(id) AS (
             SELECT ?2 WHERE ?2 IS NOT NULL
             UNION ALL
             SELECT c.parent_id FROM categories c JOIN chain ON c.id = chain.id WHERE c.parent_id IS NOT NULL
         )
         SELECT id, name, kind, value FROM promotions
         WHERE active = 1 AND starts_on <= ?3 AND ends_on >= ?3
           AND (product_id = ?1 OR category_id IN (SELECT id FROM chain))
         ORDER BY id",
    )?;
    let promos = stmt
        .query_map(params![product_id, category_id, today], |r| {
            Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?, r.get::<_, i64>(3)?))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    for (id, name, kind, value) in promos {
        let promo = if kind == "percent" {
            (regular as f64 * (100 - value.clamp(0, 100)) as f64 / 100.0).round() as i64
        } else {
            (value as f64 * pack_qty).round() as i64
        };
        if promo < best.unit_price {
            best.unit_price = promo;
            best.kind = "promo";
            best.promotion_id = Some(id);
            best.promotion_name = Some(name);
        }
    }
    Ok(best)
}

#[derive(Debug, Deserialize)]
pub struct QuoteItem {
    pub product_id: i64,
    pub quantity: f64,
    pub packaging_id: Option<i64>,
}

#[derive(Debug, Serialize)]
pub struct QuoteLine {
    pub product_id: i64,
    pub packaging_id: Option<i64>,
    #[serde(flatten)]
    pub price: LinePrice,
}

/// Prix que la caisse affiche avant l'encaissement (mêmes règles que l'enregistrement de la vente).
pub fn quote(conn: &Connection, items: &[QuoteItem], customer_id: Option<i64>) -> AppResult<Vec<QuoteLine>> {
    let wholesale_customer = is_wholesale_customer(conn, customer_id)?;
    let today = chrono::Local::now().format("%Y-%m-%d").to_string();
    items
        .iter()
        .map(|i| {
            Ok(QuoteLine {
                product_id: i.product_id,
                packaging_id: i.packaging_id,
                price: price_line(conn, i.product_id, i.packaging_id, db::round_qty(i.quantity.max(0.0)), wholesale_customer, &today)?,
            })
        })
        .collect()
}

// ───────────────────────────── Avoirs ─────────────────────────────

#[derive(Debug, Clone, Serialize)]
pub struct CreditNote {
    pub id: i64,
    pub number: String,
    pub code: String,
    pub customer_id: Option<i64>,
    pub customer_name: Option<String>,
    pub amount: i64,
    pub balance: i64,
    pub status: String,
    pub expires_on: String,
    pub created_at: String,
    pub return_number: Option<String>,
}

const CREDIT_NOTE_SELECT: &str = "SELECT cn.id, cn.number, cn.code, cn.customer_id, c.name, cn.amount, cn.balance, cn.status,
        cn.expires_on, cn.created_at, r.number
    FROM credit_notes cn
    LEFT JOIN customers c ON c.id = cn.customer_id
    LEFT JOIN returns r ON r.id = cn.return_id";

fn credit_note_from_row(r: &Row) -> rusqlite::Result<CreditNote> {
    Ok(CreditNote {
        id: r.get(0)?,
        number: r.get(1)?,
        code: r.get(2)?,
        customer_id: r.get(3)?,
        customer_name: r.get(4)?,
        amount: r.get(5)?,
        balance: r.get(6)?,
        status: r.get(7)?,
        expires_on: r.get(8)?,
        created_at: r.get(9)?,
        return_number: r.get(10)?,
    })
}

/// Avoir retrouvé par son code complet (imprimé sur le bon), jamais par son seul numéro.
pub fn credit_note_by_code(conn: &Connection, code: &str) -> AppResult<CreditNote> {
    let code = code.trim().to_uppercase().replace(' ', "");
    let found = conn
        .query_row(&format!("{CREDIT_NOTE_SELECT} WHERE cn.code = ?1"), [&code], credit_note_from_row)
        .optional()?;
    match found {
        Some(n) => Ok(n),
        None => invalid("Avoir introuvable : vérifiez le code imprimé sur le bon."),
    }
}

pub fn get_credit_note(conn: &Connection, id: i64) -> AppResult<CreditNote> {
    Ok(conn.query_row(&format!("{CREDIT_NOTE_SELECT} WHERE cn.id = ?1"), [id], credit_note_from_row)?)
}

/// Un avoir paie au plus son reste, jusqu'à sa date de validité incluse.
pub fn usable_credit_note(note: &CreditNote, amount: i64) -> AppResult<()> {
    let today = chrono::Local::now().format("%Y-%m-%d").to_string();
    if note.status == "cancelled" {
        return invalid(format!("L'avoir {} a été annulé.", note.number));
    }
    if note.balance <= 0 || note.status == "used" {
        return invalid(format!("L'avoir {} a déjà été entièrement utilisé.", note.number));
    }
    if note.expires_on.as_str() < today.as_str() {
        return invalid(format!("L'avoir {} a expiré le {}.", note.number, note.expires_on));
    }
    if amount > note.balance {
        return invalid(format!("Il ne reste que {} sur l'avoir {}.", note.balance, note.number));
    }
    Ok(())
}

#[derive(Debug, Default, Deserialize)]
pub struct CreditNoteFilter {
    pub search: Option<String>,
    pub status: Option<String>,
    pub customer_id: Option<i64>,
}

pub fn list_credit_notes(conn: &Connection, f: &CreditNoteFilter) -> AppResult<Vec<CreditNote>> {
    let mut q = Query::new(CREDIT_NOTE_SELECT);
    if let Some(s) = db::clean(&f.search) {
        let like = format!("%{s}%");
        q.and("(cn.number LIKE ? OR cn.code LIKE ? OR c.name LIKE ?)", vec![db::text(&like), db::text(&like), db::text(&like)]);
    }
    if let Some(st) = db::clean(&f.status) {
        q.and("cn.status = ?", vec![db::text(st)]);
    }
    if let Some(c) = f.customer_id {
        q.and("cn.customer_id = ?", vec![db::int(c)]);
    }
    q.tail("ORDER BY cn.id DESC LIMIT ?", vec![db::int(1000)]);
    let mut stmt = conn.prepare(&q.sql)?;
    let rows = stmt.query_map(q.params(), credit_note_from_row)?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
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
    price_kind: &'static str,
    regular_price: Option<i64>,
    promotion_id: Option<i64>,
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

    cash::ensure_cashier(user)?;
    let tx = conn.transaction()?;
    let session_id = cash::open_session_id(&tx, user.id)?;
    if require_session && session_id.is_none() {
        return invalid("Aucune session de caisse ouverte. Ouvrez la caisse avant d'encaisser.");
    }

    // 1. Lignes : prix toujours relus en base (le frontend ne fixe pas les prix).
    let wholesale_customer = is_wholesale_customer(&tx, input.customer_id)?;
    let today = chrono::Local::now().format("%Y-%m-%d").to_string();
    let mut lines: Vec<Line> = Vec::with_capacity(input.items.len());
    for item in &input.items {
        let qty = db::round_qty(item.quantity);
        if qty <= 0.0 || !qty.is_finite() {
            return invalid("Les quantités doivent être supérieures à zéro.");
        }
        let (name, unit, cost, tax_rate, stock_qty, track, active): (String, String, i64, f64, f64, bool, bool) = tx.query_row(
            "SELECT name, unit, purchase_price, tax_rate, stock, track_stock, active FROM products WHERE id = ?1",
            [item.product_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?)),
        )?;
        if !active {
            return invalid(format!("Le produit « {name} » est archivé."));
        }
        // Prix normal, de gros ou promotion du jour (le plus bas), relu en base.
        // Conditionnement : prix du carton / sac, stock décompté en unités de base.
        let priced = price_line(&tx, item.product_id, item.packaging_id, qty, wholesale_customer, &today)?;
        let (line_name, line_unit) = match &priced.packaging_name {
            Some(pname) => (format!("{name} — {pname}"), pname.clone()),
            None => (name.clone(), unit.clone()),
        };
        let unit_price = priced.unit_price;
        let base_qty = db::round_qty(qty * priced.pack_quantity);
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
            price_kind: priced.kind,
            regular_price: (priced.kind != "retail").then_some(priced.regular_price),
            promotion_id: priced.promotion_id,
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
        let reference = db::clean(&p.reference);
        let phone = clean_phone(&p.phone)?;
        check_payment(&tx, &p.method, reference.as_deref())?;
        if p.method == "credit_note" {
            let note = credit_note_by_code(&tx, reference.as_deref().unwrap_or_default())?;
            let used: i64 = payments
                .iter()
                .filter(|x| x.method == "credit_note" && x.reference.as_deref() == Some(note.code.as_str()))
                .map(|x| x.amount)
                .sum();
            usable_credit_note(&note, used + p.amount)?;
            payments.push(PaymentInput { method: p.method.clone(), amount: p.amount, reference: Some(note.code), phone: None });
            continue;
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
        if p.method == "credit_note" {
            tx.execute(
                "UPDATE credit_notes SET balance = balance - ?1,
                        status = CASE WHEN balance - ?1 <= 0 THEN 'used' ELSE status END
                 WHERE code = ?2",
                params![p.amount, p.reference],
            )?;
        }
    }

    for l in &lines {
        tx.execute(
            "INSERT INTO sale_items (sale_id, product_id, product_name, unit, quantity, unit_price, unit_cost, discount, tax_rate, total,
                                     base_quantity, packaging_id, price_kind, regular_price, promotion_id)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)",
            params![sale_id, l.product_id, l.name, l.unit, l.quantity, l.unit_price, l.unit_cost, l.discount, l.tax_rate, l.total,
                    l.base_quantity, l.packaging_id, l.price_kind, l.regular_price, l.promotion_id],
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
    if sale.returned_total > 0 || sale.items.iter().any(|i| i.returned_quantity > 0.0) {
        return invalid("Des articles de cette vente ont déjà été retournés : elle ne peut plus être annulée.");
    }
    let tx = conn.transaction()?;
    for p in sale.payments.iter().filter(|p| p.method == "credit_note") {
        tx.execute(
            "UPDATE credit_notes SET balance = balance + ?1, status = CASE WHEN status = 'used' THEN 'active' ELSE status END WHERE code = ?2",
            params![p.amount, p.reference],
        )?;
    }
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
             WHERE s.status = 'completed' AND sp.method NOT IN ('cash', 'credit_note')
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
