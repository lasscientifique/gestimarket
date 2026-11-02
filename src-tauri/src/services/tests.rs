//! Tests d'intégration de la logique métier sur une base SQLite en mémoire.

use rusqlite::Connection;

use crate::db;
use crate::services::*;
use crate::state::SessionUser;

fn setup() -> (Connection, SessionUser) {
    let mut conn = db::open_in_memory().unwrap();
    let admin = auth::initial_setup(
        &mut conn,
        auth::SetupInput {
            shop_name: "Boutique Test".into(),
            shop_phone: None,
            shop_address: None,
            currency_symbol: "FCFA".into(),
            currency_decimals: 0,
            full_name: "Admin Test".into(),
            username: "admin".into(),
            password: "secret123".into(),
        },
    )
    .unwrap();
    (conn, admin)
}

/// Compte caissier : seul rôle autorisé à ouvrir une caisse et à vendre.
fn cashier(conn: &Connection, admin: &SessionUser) -> SessionUser {
    let id = users::create(conn, admin, users::UserInput {
        username: Some("caisse".into()), full_name: "Caissière Test".into(), role: "cashier".into(), active: Some(true), password: Some("caisse123".into()),
    }).unwrap();
    SessionUser { id, username: "caisse".into(), full_name: "Caissière Test".into(), role: "cashier".into(), has_pin: false }
}

fn product(conn: &mut Connection, user: &SessionUser, name: &str, cost: i64, price: i64, qty: f64) -> i64 {
    catalog::save_product(
        conn,
        user,
        None,
        catalog::ProductInput {
            barcode: None,
            name: name.into(),
            description: None,
            category_id: None,
            supplier_id: None,
            image_id: None,
            location_id: None,
            expiry_date: None,
            unit: None,
            purchase_price: cost,
            sale_price: price,
            tax_rate: Some(18.0),
            min_stock: Some(2.0),
            track_stock: Some(true),
            active: Some(true),
            initial_stock: Some(qty),
            brand: None,
            sku: None,
            packagings: None,
        },
    )
    .unwrap()
    .id
}

fn sale_input(items: Vec<(i64, f64)>, method: &str, paid: i64, customer: Option<i64>) -> sales::SaleInput {
    sales::SaleInput {
        items: items
            .into_iter()
            .map(|(product_id, quantity)| sales::SaleItemInput { product_id, quantity, discount: None, packaging_id: None })
            .collect(),
        customer_id: customer,
        discount: None,
        payments: if method == "credit" || paid == 0 {
            vec![]
        } else {
            vec![sales::PaymentInput {
                method: method.into(),
                amount: paid,
                reference: if method == "orange_money" { Some(format!("OM{paid}")) } else { None },
                phone: None,
            }]
        },
        note: None,
    }
}

fn stock_of(conn: &Connection, id: i64) -> f64 {
    catalog::get_product(conn, id).unwrap().stock
}

#[test]
fn login_and_password_checks() {
    let (conn, _) = setup();
    assert!(auth::login(&conn, "admin", "secret123").is_ok());
    assert!(auth::login(&conn, "ADMIN", "secret123").is_ok(), "identifiant insensible à la casse");
    assert!(auth::login(&conn, "admin", "mauvais").is_err());
    assert!(!auth::needs_setup(&conn).unwrap());
}

#[test]
fn sale_requires_open_cash_session() {
    let (mut conn, admin) = setup();
    let caisse = cashier(&conn, &admin);
    let p = product(&mut conn, &admin, "Riz 5kg", 3000, 3500, 10.0);
    let err = sales::create_sale(&mut conn, &caisse, sale_input(vec![(p, 1.0)], "cash", 3500, None)).unwrap_err();
    assert!(err.to_string().contains("session de caisse"));
}

#[test]
fn full_sale_flow_updates_stock_cash_and_cancel_restores() {
    let (mut conn, admin) = setup();
    let caisse = cashier(&conn, &admin);
    let riz = product(&mut conn, &admin, "Riz 5kg", 3000, 3500, 10.0);
    let huile = product(&mut conn, &admin, "Huile 1L", 900, 1200, 5.0);
    cash::open(&conn, &caisse, 10_000).unwrap();

    let sale = sales::create_sale(&mut conn, &caisse, sale_input(vec![(riz, 2.0), (huile, 1.0)], "cash", 10_000, None)).unwrap();
    assert_eq!(sale.total, 8200);
    assert_eq!(sale.change_due, 1800);
    assert_eq!(sale.cost_total, 6900);
    assert_eq!(sale.items.len(), 2);
    assert!(sale.number.starts_with('V'));
    assert_eq!(stock_of(&conn, riz), 8.0);
    assert_eq!(stock_of(&conn, huile), 4.0);
    // TVA incluse : 8200 * 18 / 118 ≈ 1251
    assert_eq!(sale.tax_total, 1251);

    let session = cash::current_session(&conn, &caisse).unwrap().unwrap();
    assert_eq!(session.cash_sales, 8200);
    assert_eq!(session.expected_now, 18_200);

    let cancelled = sales::cancel_sale(&mut conn, &admin, sale.id, "Erreur de saisie").unwrap();
    assert_eq!(cancelled.status, "cancelled");
    assert_eq!(stock_of(&conn, riz), 10.0);
    assert_eq!(stock_of(&conn, huile), 5.0);
    let session = cash::current_session(&conn, &caisse).unwrap().unwrap();
    assert_eq!(session.expected_now, 10_000);
    assert!(sales::cancel_sale(&mut conn, &admin, sale.id, "encore").is_err());
}

#[test]
fn insufficient_stock_is_rejected() {
    let (mut conn, admin) = setup();
    let caisse = cashier(&conn, &admin);
    let p = product(&mut conn, &admin, "Sucre", 500, 700, 3.0);
    cash::open(&conn, &caisse, 0).unwrap();
    // Deux lignes du même produit dépassant le stock au total.
    let err = sales::create_sale(&mut conn, &caisse, sale_input(vec![(p, 2.0), (p, 2.0)], "cash", 5000, None)).unwrap_err();
    assert!(err.to_string().contains("Stock insuffisant"));
    assert_eq!(stock_of(&conn, p), 3.0, "rien ne doit être écrit en cas d'erreur");
}

#[test]
fn credit_sale_respects_limit_and_payments_reduce_debt() {
    let (mut conn, admin) = setup();
    let caisse = cashier(&conn, &admin);
    let p = product(&mut conn, &admin, "Lait", 400, 600, 50.0);
    cash::open(&conn, &caisse, 0).unwrap();
    let client = partners::save_customer(
        &conn,
        &admin,
        None,
        partners::CustomerInput { name: "Awa".into(), phone: None, email: None, address: None, notes: None, credit_limit: Some(5000) },
    )
    .unwrap();

    // Paiement partiel : 1000 en espèces, le reste (2000) à crédit.
    let sale = sales::create_sale(&mut conn, &caisse, sale_input(vec![(p, 5.0)], "cash", 1000, Some(client.id))).unwrap();
    assert_eq!(sale.credit_amount, 2000);
    assert_eq!(partners::get_customer(&conn, client.id).unwrap().balance, 2000);

    // Sans client, un paiement insuffisant est refusé.
    assert!(sales::create_sale(&mut conn, &caisse, sale_input(vec![(p, 1.0)], "cash", 100, None)).is_err());

    // Dépassement du plafond (2000 + 3600 > 5000).
    assert!(sales::create_sale(&mut conn, &caisse, sale_input(vec![(p, 6.0)], "credit", 0, Some(client.id))).is_err());

    // Espèces : réservé au caissier (l'argent entre dans son tiroir)
    let pay = |m: &str| partners::CustomerPaymentInput { customer_id: client.id, amount: 1500, method: m.into(), reference: None, phone: None, note: None };
    assert!(partners::record_payment(&mut conn, &admin, pay("cash")).is_err());
    let c = partners::record_payment(
        &mut conn,
        &caisse,
        partners::CustomerPaymentInput { customer_id: client.id, amount: 1500, method: "cash".into(), reference: None, phone: None, note: None },
    )
    .unwrap();
    assert_eq!(c.balance, 500);
    let session = cash::current_session(&conn, &caisse).unwrap().unwrap();
    assert_eq!(session.expected_now, 1000 + 1500);
    assert_eq!(partners::statement(&conn, client.id).unwrap().len(), 2);
}

#[test]
fn purchase_increases_stock_with_weighted_average_cost() {
    let (mut conn, admin) = setup();
    let p = product(&mut conn, &admin, "Savon", 100, 200, 10.0);
    let supplier = partners::save_supplier(
        &conn,
        &admin,
        None,
        partners::SupplierInput { name: "Grossiste SA".into(), contact: None, phone: None, email: None, address: None, notes: None },
    )
    .unwrap();
    let purchase = purchases::create_purchase(
        &mut conn,
        &admin,
        purchases::PurchaseInput {
            supplier_id: Some(supplier),
            items: vec![purchases::PurchaseItemInput { product_id: p, quantity: 10.0, unit_cost: 160, expiry_date: Some("2030-01-15".into()) }],
            note: None,
            update_costs: Some(true),
            new_sale_prices: Some(vec![(p, 250)]),
        },
    )
    .unwrap();
    assert_eq!(purchase.total, 1600);
    let prod = catalog::get_product(&conn, p).unwrap();
    assert_eq!(prod.stock, 20.0);
    assert_eq!(prod.purchase_price, 130, "CMUP = (10×100 + 10×160) / 20");
    assert_eq!(prod.sale_price, 250);
    assert_eq!(prod.supplier_id, Some(supplier));
    assert_eq!(prod.expiry_date.as_deref(), Some("2030-01-15"));
}

#[test]
fn stock_adjustment_and_movements() {
    let (mut conn, admin) = setup();
    let p = product(&mut conn, &admin, "Biscuits", 50, 100, 20.0);
    let s = stock::adjust(
        &mut conn,
        &admin,
        stock::AdjustInput { product_id: p, mode: "set".into(), quantity: 17.0, kind: "adjustment".into(), note: Some("Inventaire".into()) },
    )
    .unwrap();
    assert_eq!(s, 17.0);
    stock::adjust(
        &mut conn,
        &admin,
        stock::AdjustInput { product_id: p, mode: "remove".into(), quantity: 2.0, kind: "loss".into(), note: None },
    )
    .unwrap();
    let moves = stock::list_movements(&conn, &stock::MovementFilter { product_id: Some(p), ..Default::default() }).unwrap();
    assert_eq!(moves.len(), 3); // initial + ajustement + perte
    assert_eq!(moves[0].stock_after, 15.0);
    let summary = stock::summary(&conn).unwrap();
    assert_eq!(summary.value_cost, 750);
}

#[test]
fn cash_session_close_computes_difference() {
    let (mut conn, admin) = setup();
    let caisse = cashier(&conn, &admin);
    let p = product(&mut conn, &admin, "Pain", 150, 250, 100.0);
    cash::open(&conn, &caisse, 5000).unwrap();
    sales::create_sale(&mut conn, &caisse, sale_input(vec![(p, 4.0)], "cash", 1000, None)).unwrap();
    sales::create_sale(&mut conn, &caisse, sale_input(vec![(p, 2.0)], "mobile_money", 500, None)).unwrap();
    cash::add_movement(&conn, &caisse, cash::CashMovementInput { kind: "out".into(), amount: 2000, reason: "Achat sacs".into() }).unwrap();
    let closed = cash::close(&conn, &caisse, cash::CloseInput { counted_amount: 3900, note: None }).unwrap();
    assert_eq!(closed.expected_amount, Some(4000));
    assert_eq!(closed.difference, Some(-100));
    assert_eq!(closed.mobile_money_sales, 500);
    assert!(cash::current_session(&conn, &caisse).unwrap().is_none());
}

#[test]
fn reports_and_barcodes() {
    let (mut conn, admin) = setup();
    let caisse = cashier(&conn, &admin);
    let p = product(&mut conn, &admin, "Café", 1000, 1500, 10.0);
    cash::open(&conn, &caisse, 0).unwrap();
    sales::create_sale(&mut conn, &caisse, sale_input(vec![(p, 2.0)], "card", 3000, None)).unwrap();
    let dash = reports::dashboard(&conn).unwrap();
    assert_eq!(dash.today_revenue, 3000);
    assert_eq!(dash.today_margin, 1000);
    assert_eq!(dash.daily.len(), 14);
    let today = chrono::Local::now().format("%Y-%m-%d").to_string();
    let report = reports::sales_report(&conn, &today, &today).unwrap();
    assert_eq!(report.revenue, 3000);
    assert_eq!(report.top_products[0].quantity, 2.0);
    assert_eq!(report.by_payment[0].label, "card");

    let code = catalog::generate_barcode(&conn).unwrap();
    assert_eq!(code.len(), 13);
    assert_eq!(catalog::ean13_check_digit("400638133393"), 1); // EAN réel : 4006381333931
    assert_ne!(catalog::generate_barcode(&conn).unwrap(), code);
}

#[test]
fn users_keep_at_least_one_admin() {
    let (conn, admin) = setup();
    let cashier_id = users::create(
        &conn,
        &admin,
        users::UserInput { username: Some("fatou".into()), full_name: "Fatou".into(), role: "cashier".into(), active: Some(true), password: Some("caisse1".into()) },
    )
    .unwrap();
    assert!(cashier_id > 0);
    let err = users::update(
        &conn,
        &admin,
        admin.id,
        users::UserInput { username: None, full_name: "Admin".into(), role: "manager".into(), active: Some(true), password: None },
    );
    assert!(err.is_err());
    assert!(auth::login(&conn, "fatou", "caisse1").is_ok());
}


#[test]
fn split_payment_cash_and_orange_money_with_unique_reference() {
    let (mut conn, admin) = setup();
    let caisse = cashier(&conn, &admin);
    let p = product(&mut conn, &admin, "Lait en poudre", 2000, 2500, 20.0);
    cash::open(&conn, &caisse, 5000).unwrap();
    let pay = |method: &str, amount: i64, reference: Option<&str>| sales::PaymentInput {
        method: method.into(),
        amount,
        reference: reference.map(String::from),
        phone: Some("70 00 00 00".into()),
    };
    let mut input = sale_input(vec![(p, 4.0)], "cash", 0, None); // total 10 000
    input.payments = vec![pay("orange_money", 6000, Some("MP2610.1234.A1")), pay("cash", 5000, None)];
    let sale = sales::create_sale(&mut conn, &caisse, input).unwrap();
    assert_eq!(sale.total, 10_000);
    assert_eq!(sale.payment_method, "mixed");
    assert_eq!(sale.change_due, 1000, "6000 OM + 5000 espèces → 1000 rendus");
    assert_eq!(sale.payments.len(), 2);
    let session = cash::current_session(&conn, &caisse).unwrap().unwrap();
    assert_eq!(session.cash_sales, 4000);
    assert_eq!(session.orange_money_sales, 6000);
    assert_eq!(session.expected_now, 9000);

    // Même ID de transaction réutilisé → refusé.
    let mut again = sale_input(vec![(p, 1.0)], "cash", 0, None);
    again.payments = vec![pay("orange_money", 2500, Some("mp2610.1234.a1"))];
    let err = sales::create_sale(&mut conn, &caisse, again).unwrap_err();
    assert!(err.to_string().contains("déjà été utilisé"), "{err}");

    // Orange Money sans ID de transaction → refusé (paramètre par défaut).
    let mut no_ref = sale_input(vec![(p, 1.0)], "cash", 0, None);
    no_ref.payments = vec![pay("orange_money", 2500, None)];
    assert!(sales::create_sale(&mut conn, &caisse, no_ref).is_err());

    // Paiement électronique supérieur au total → refusé.
    let mut over = sale_input(vec![(p, 1.0)], "cash", 0, None);
    over.payments = vec![pay("orange_money", 3000, Some("X1"))];
    assert!(sales::create_sale(&mut conn, &caisse, over).is_err());

    // Recherche d'une vente par ID de transaction et liste de rapprochement.
    let found = sales::list_sales(&conn, &sales::SaleFilter { search: Some("1234.A1".into()), ..Default::default() }).unwrap();
    assert_eq!(found.len(), 1);
    let om = sales::list_electronic(&conn, &sales::ElectronicFilter { method: Some("orange_money".into()), ..Default::default() }).unwrap();
    assert_eq!(om.len(), 1);
    assert_eq!(om[0].amount, 6000);
    let today = chrono::Local::now().format("%Y-%m-%d").to_string();
    let report = reports::sales_report(&conn, &today, &today).unwrap();
    assert!(report.by_payment.iter().any(|b| b.label == "orange_money" && b.amount == 6000));
}

#[test]
fn locations_assignment_and_search() {
    let (mut conn, admin) = setup();
    let created = locations::generate(
        &mut conn,
        &admin,
        locations::GenerateInput { bloc: "2".into(), bloc_to: None, etage_from: 1, etage_to: 2, rangee_from: 1, rangee_to: 5, label: Some("Boissons".into()) },
    )
    .unwrap();
    assert_eq!(created, 10);
    let all = locations::list(&conn).unwrap();
    assert_eq!(all.len(), 10);
    let target = all.iter().find(|l| l.etage == "2" && l.rangee == "4").unwrap().id;
    let p = product(&mut conn, &admin, "Jus d'orange 1L", 600, 900, 12.0);
    locations::assign(&mut conn, &admin, Some(target), vec![p]).unwrap();
    let found = catalog::list_products(&conn, &catalog::ProductFilter { search: Some("orange jus".into()), ..Default::default() }).unwrap();
    assert_eq!(found.len(), 1);
    assert_eq!(found[0].bloc.as_deref(), Some("2"));
    assert_eq!(found[0].etage.as_deref(), Some("2"));
    assert_eq!(found[0].rangee.as_deref(), Some("4"));
    let in_bloc = catalog::list_products(&conn, &catalog::ProductFilter { bloc: Some("2".into()), ..Default::default() }).unwrap();
    assert_eq!(in_bloc.len(), 1);
    // Suppression de l'emplacement : le produit n'est plus rangé mais existe toujours.
    locations::delete(&conn, &admin, target).unwrap();
    assert_eq!(catalog::get_product(&conn, p).unwrap().location_id, None);
}

#[test]
fn import_products_creates_and_updates() {
    let (mut conn, admin) = setup();
    let row = |code: &str, name: &str, price: i64, stock: f64| catalog::ImportRow {
        barcode: Some(code.into()),
        name: name.into(),
        category: Some("Épicerie".into()),
        subcategory: Some("Condiments".into()),
        unit: None,
        purchase_price: Some(price - 100),
        sale_price: Some(price),
        tax_rate: None,
        stock: Some(stock),
        min_stock: Some(2.0),
        bloc: Some("1".into()),
        etage: Some("1".into()),
        rangee: Some("3".into()),
        expiry_date: None,
        brand: None,
        sku: None,
    };
    let r = catalog::import_products(&mut conn, &admin, vec![row("111", "Sel 1kg", 300, 10.0), row("222", "Poivre", 500, 4.0)]).unwrap();
    assert_eq!((r.created, r.updated, r.errors.len()), (2, 0, 0));
    let r = catalog::import_products(&mut conn, &admin, vec![row("111", "Sel fin 1kg", 350, 7.0)]).unwrap();
    assert_eq!((r.created, r.updated), (0, 1));
    let sel = catalog::find_by_barcode(&conn, "111").unwrap().unwrap();
    assert_eq!(sel.name, "Sel fin 1kg");
    assert_eq!(sel.sale_price, 350);
    assert_eq!(sel.stock, 7.0);
    assert_eq!(sel.category_name.as_deref(), Some("Condiments"));
    assert_eq!(sel.parent_category_name.as_deref(), Some("Épicerie"));
    assert_eq!(sel.rangee.as_deref(), Some("3"));
    assert_eq!(locations::list(&conn).unwrap().len(), 1);
}

#[test]
fn images_are_stored_and_cleaned_up() {
    let (mut conn, admin) = setup();
    // PNG 1×1 transparent
    let png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
    let a = media::save(&conn, "image/png", png).unwrap();
    let b = media::save(&conn, "image/png", &format!("data:image/png;base64,{png}")).unwrap();
    assert!(media::get(&conn, a).unwrap().is_some());
    assert!(media::save(&conn, "application/pdf", png).is_err());
    let p = product(&mut conn, &admin, "Biscuit", 100, 150, 5.0);
    let edit = |image: Option<i64>| catalog::ProductInput {
        barcode: None,
        name: "Biscuit".into(),
        description: None,
        category_id: None,
        supplier_id: None,
        unit: None,
        purchase_price: 100,
        sale_price: 150,
        tax_rate: None,
        min_stock: None,
        track_stock: Some(true),
        active: Some(true),
        image_id: image,
        location_id: None,
        expiry_date: Some(chrono::Local::now().format("%Y-%m-%d").to_string()),
        initial_stock: None,
        brand: None,
        sku: None,
        packagings: None,
    };
    let prod = catalog::save_product(&mut conn, &admin, Some(p), edit(Some(a))).unwrap();
    assert_eq!(prod.image_id, Some(a));
    catalog::save_product(&mut conn, &admin, Some(p), edit(Some(b))).unwrap();
    assert!(media::get(&conn, a).unwrap().is_none(), "l'ancienne photo est supprimée");
    // Produit qui périme aujourd'hui → alerte au tableau de bord.
    let dash = reports::dashboard(&conn).unwrap();
    assert_eq!(dash.expiring.len(), 1);
    assert_eq!(dash.expiring[0].days_left, 0);
}

#[test]
fn migration_from_version_1_keeps_existing_data() {
    let conn = Connection::open_in_memory().unwrap();
    conn.execute_batch(db::migration_sql(0)).unwrap();
    conn.execute_batch("PRAGMA user_version = 1; PRAGMA foreign_keys = ON;").unwrap();
    conn.execute_batch(
        "INSERT INTO users (id, username, full_name, password_hash, role) VALUES (1, 'admin', 'Admin', 'x', 'admin');
         INSERT INTO customers (id, name, credit_limit, balance) VALUES (1, 'Client', 10000, 500);
         INSERT INTO products (id, name, sale_price, stock) VALUES (1, 'Riz', 1000, 5);
         INSERT INTO sales (id, number, user_id, subtotal, total, amount_paid, change_due, payment_method, customer_id, credit_amount)
              VALUES (1, 'V1', 1, 2000, 2000, 2000, 0, 'mobile_money', NULL, 0),
                     (2, 'V2', 1, 1000, 1000, 1500, 500, 'cash', NULL, 0),
                     (3, 'V3', 1, 500, 500, 0, 0, 'credit', 1, 500);
         INSERT INTO sale_items (sale_id, product_id, product_name, quantity, unit_price, total) VALUES (1, 1, 'Riz', 2, 1000, 2000), (2, 1, 'Riz', 1, 1000, 1000);
         INSERT INTO customer_payments (customer_id, amount, method) VALUES (1, 100, 'cash');",
    )
    .unwrap();
    db::migrate_for_test(&conn).unwrap();
    let count = |sql: &str| -> i64 { conn.query_row(sql, [], |r| r.get(0)).unwrap() };
    assert_eq!(count("PRAGMA user_version"), 5);
    assert_eq!(count("SELECT COUNT(*) FROM sales"), 3);
    assert_eq!(count("SELECT COUNT(*) FROM sale_items"), 2, "pas de suppression en cascade");
    assert_eq!(count("SELECT COUNT(*) FROM sale_payments"), 2);
    assert_eq!(count("SELECT amount FROM sale_payments WHERE sale_id = 2"), 1000);
    assert_eq!(count("SELECT COUNT(*) FROM customer_payments"), 1);
    assert_eq!(count("PRAGMA foreign_keys"), 1);
    assert_eq!(count("SELECT COUNT(*) FROM pragma_foreign_key_check"), 0);
    let sale = sales::get_sale(&conn, 1).unwrap();
    assert_eq!(sale.payments[0].method, "mobile_money");
}

#[test]
fn searches_with_several_criteria() {
    let (mut conn, admin) = setup();
    product(&mut conn, &admin, "Savon liquide", 500, 800, 5.0);
    let r = catalog::list_products(&conn, &catalog::ProductFilter { search: Some("savon".into()), ..Default::default() }).unwrap();
    assert_eq!(r.len(), 1);
    partners::save_customer(&conn, &admin, None, partners::CustomerInput { name: "Moussa".into(), phone: Some("76 12".into()), email: None, address: None, notes: None, credit_limit: None }).unwrap();
    assert_eq!(partners::list_customers(&conn, &partners::CustomerFilter { search: Some("76".into()), with_debt: None }).unwrap().len(), 1);
    assert_eq!(audit::list(&conn, &audit::AuditFilter { search: Some("Création de produit".into()), ..Default::default() }).unwrap().len(), 1);
    assert!(partners::list_suppliers(&conn, Some("x".into())).unwrap().is_empty());
}

#[test]
fn subcategories_and_letter_blocs() {
    let (mut conn, admin) = setup();
    let cat = |name: &str, parent: Option<i64>| catalog::CategoryInput { name: name.into(), color: None, image_id: None, parent_id: parent, sort_order: None, active: None };
    let boissons = catalog::save_category(&conn, &admin, None, cat("Boissons", None)).unwrap();
    let jus = catalog::save_category(&conn, &admin, None, cat("Jus", Some(boissons))).unwrap();
    let eaux = catalog::save_category(&conn, &admin, None, cat("Eaux", Some(boissons))).unwrap();
    // 3e niveau autorisé (profondeur illimitée), doublon dans la même catégorie interdit
    let bio = catalog::save_category(&conn, &admin, None, cat("Bio", Some(jus))).unwrap();
    // Impossible de déplacer une catégorie dans sa propre descendance
    assert!(catalog::save_category(&conn, &admin, Some(boissons), cat("Boissons", Some(bio))).is_err());
    assert!(catalog::save_category(&conn, &admin, None, cat("jus", Some(boissons))).is_err());
    // même nom autorisé sous une autre catégorie
    let epicerie = catalog::save_category(&conn, &admin, None, cat("Épicerie", None)).unwrap();
    catalog::save_category(&conn, &admin, None, cat("Jus", Some(epicerie))).unwrap();

    let p = product(&mut conn, &admin, "Jus d'ananas", 500, 800, 10.0);
    let mut prod = catalog::get_product(&conn, p).unwrap();
    let mut input = catalog::ProductInput {
        barcode: None, name: prod.name.clone(), description: None, category_id: Some(jus), supplier_id: None,
        unit: None, purchase_price: 500, sale_price: 800, tax_rate: None, min_stock: None, track_stock: Some(true),
        active: Some(true), image_id: None, location_id: None, expiry_date: None, initial_stock: None, brand: None, sku: None, packagings: None,
    };
    prod = catalog::save_product(&mut conn, &admin, Some(p), input).unwrap();
    assert_eq!(prod.parent_category_name.as_deref(), Some("Boissons"));
    // Filtrer sur la catégorie principale inclut ses sous-catégories
    let f = |c| catalog::ProductFilter { category_id: Some(c), ..Default::default() };
    assert_eq!(catalog::list_products(&conn, &f(boissons)).unwrap().len(), 1);
    assert_eq!(catalog::list_products(&conn, &f(eaux)).unwrap().len(), 0);
    let cats = catalog::list_categories(&conn).unwrap();
    assert_eq!(cats.iter().find(|c| c.id == boissons).unwrap().children_count, 2);
    assert_eq!(cats.iter().find(|c| c.id == boissons).unwrap().product_count, 1);
    // Suppression de la catégorie principale : sous-catégories supprimées, produit conservé sans catégorie
    catalog::delete_category(&mut conn, &admin, boissons).unwrap();
    assert_eq!(catalog::get_product(&conn, p).unwrap().category_id, None);
    input = catalog::ProductInput {
        barcode: None, name: "x".into(), description: None, category_id: Some(eaux), supplier_id: None, unit: None,
        purchase_price: 1, sale_price: 1, tax_rate: None, min_stock: None, track_stock: None, active: None,
        image_id: None, location_id: None, expiry_date: None, initial_stock: None, brand: None, sku: None, packagings: None,
    };
    assert!(catalog::save_product(&mut conn, &admin, None, input).is_err(), "la sous-catégorie n'existe plus");

    // Blocs de A à C, 2 étages, 3 rangées = 18 emplacements
    let n = locations::generate(&mut conn, &admin, locations::GenerateInput {
        bloc: "a".into(), bloc_to: Some("C".into()), etage_from: 1, etage_to: 2, rangee_from: 1, rangee_to: 3, label: None,
    }).unwrap();
    assert_eq!(n, 18);
    let blocs: std::collections::BTreeSet<String> = locations::list(&conn).unwrap().into_iter().map(|l| l.bloc).collect();
    assert_eq!(blocs.into_iter().collect::<Vec<_>>(), vec!["A", "B", "C"]);
    assert!(locations::bloc_series("F", Some("A")).is_err());
}

#[test]
fn remote_sessions_and_customer_display() {
    use crate::state::{AppState, Origin};
    use serde_json::json;
    let (conn, _) = setup();
    let state = AppState::new(conn, std::path::PathBuf::from(":memory:"));
    let anon = Origin::Remote(None);
    // Sans jeton : refus
    assert!(crate::rpc::dispatch(&state, &anon, "list_products", json!({})).is_err());
    // Connexion réseau → jeton
    let r = crate::rpc::dispatch(&state, &anon, "login", json!({"username": "admin", "password": "secret123"})).unwrap();
    let token = r["token"].as_str().unwrap().to_string();
    let me = Origin::Remote(Some(token.clone()));
    assert!(crate::rpc::dispatch(&state, &me, "list_products", json!({"filter": {"search": "x"}})).is_ok());
    // La session locale n'est pas ouverte par une connexion réseau
    assert!(crate::rpc::dispatch(&state, &Origin::Local, "list_products", json!({})).is_err());
    // Écran client : mise à jour par la caisse connectée, lecture libre
    crate::rpc::dispatch(&state, &me, "display_update", json!({"poste": "Caisse 2", "state": {"total": 1500}})).unwrap();
    let d = crate::rpc::dispatch(&state, &anon, "display_state", json!({"poste": "Caisse 2"})).unwrap();
    assert_eq!(d["total"], 1500);
    assert!(crate::rpc::dispatch(&state, &anon, "display_update", json!({"poste": "X", "state": {}})).is_err());
    // Définir son PIN ne doit pas fermer la session réseau (même jeton).
    crate::rpc::dispatch(&state, &me, "set_my_pin", json!({"password": "secret123", "pin": "7391"})).unwrap();
    assert!(crate::rpc::dispatch(&state, &me, "list_products", json!({})).is_ok());
    // Déconnexion → jeton invalide
    crate::rpc::dispatch(&state, &me, "logout", json!({})).unwrap();
    assert!(crate::rpc::dispatch(&state, &me, "list_products", json!({})).is_err());
    assert!(crate::rpc::dispatch(&state, &anon, "inconnue", json!({})).is_err());
}

#[test]
fn pin_confirmation_roles_and_lockout() {
    use crate::state::{AppState, Origin};
    use serde_json::json;
    let (mut conn, admin) = setup();
    let p = product(&mut conn, &admin, "Farine 1kg", 400, 600, 20.0);
    let caissier = users::create(&conn, &admin, users::UserInput {
        username: Some("fatou".into()), full_name: "Fatou".into(), role: "cashier".into(), active: Some(true), password: Some("caisse1".into()),
    }).unwrap();
    assert!(auth::validate_pin("1234").is_err() && auth::validate_pin("1111").is_err() && auth::validate_pin("12a4").is_err());
    let state = AppState::new(conn, std::path::PathBuf::from(":memory:"));
    let local = Origin::Local;
    let rpc = |o: &Origin, cmd: &str, a: serde_json::Value| crate::rpc::dispatch(&state, o, cmd, a);

    // Administrateur : définit son PIN
    rpc(&local, "login", json!({"username": "admin", "password": "secret123"})).unwrap();
    assert!(rpc(&local, "set_my_pin", json!({"password": "faux", "pin": "2580"})).is_err());
    let me = rpc(&local, "set_my_pin", json!({"password": "secret123", "pin": "2580"})).unwrap();
    assert_eq!(me["has_pin"], true);
    // Action critique sans PIN → refus ; avec PIN → OK
    let adjust = json!({"input": {"product_id": p, "mode": "set", "quantity": 18.0, "kind": "adjustment", "note": null}});
    assert!(rpc(&local, "adjust_stock", adjust.clone()).unwrap_err().to_string().contains("PIN requis"));
    let mut with_pin = adjust.clone();
    with_pin["pin"] = json!("2580");
    assert_eq!(rpc(&local, "adjust_stock", with_pin).unwrap(), json!(18.0));

    // Caissière : connexion par PIN, vente, annulation autorisée par l'administrateur
    rpc(&local, "logout", json!({})).unwrap();
    rpc(&local, "login", json!({"username": "fatou", "password": "caisse1"})).unwrap();
    rpc(&local, "set_my_pin", json!({"password": "caisse1", "pin": "4826"})).unwrap();
    rpc(&local, "logout", json!({})).unwrap();
    let users = rpc(&local, "list_login_users", json!({})).unwrap();
    assert_eq!(users.as_array().unwrap().len(), 2);
    assert!(rpc(&local, "login_pin", json!({"user_id": caissier, "pin": "9999"})).is_err());
    let r = rpc(&local, "login_pin", json!({"user_id": caissier, "pin": "4826"})).unwrap();
    assert_eq!(r["user"]["role"], "cashier");
    // La caissière n'a pas accès au tableau de bord (administrateur)
    assert!(rpc(&local, "dashboard", json!({})).is_err());
    rpc(&local, "open_cash_session", json!({"amount": 0})).unwrap();
    let sale = rpc(&local, "create_sale", json!({"input": {"items": [{"product_id": p, "quantity": 2.0}], "customer_id": null, "discount": 0,
        "payments": [{"method": "cash", "amount": 1200}], "note": null}})).unwrap();
    let id = sale["id"].as_i64().unwrap();
    // Son propre PIN ne suffit pas pour annuler ; celui de l'administrateur oui.
    assert!(rpc(&local, "cancel_sale", json!({"id": id, "reason": "erreur", "pin": "4826"})).is_err());
    let cancelled = rpc(&local, "cancel_sale", json!({"id": id, "reason": "erreur", "pin": "2580"})).unwrap();
    assert_eq!(cancelled["status"], "cancelled");
    // Suppression d'article : niveau « caissier » → son propre PIN suffit
    let ok = rpc(&local, "verify_pin", json!({"pin": "4826", "level": "cashier", "action": "Suppression d'article"})).unwrap();
    assert_eq!(ok["full_name"], "Fatou");
    assert!(rpc(&local, "verify_pin", json!({"pin": "4826", "level": "manager"})).is_err());
    // Blocage après 5 erreurs
    for _ in 0..4 {
        let _ = rpc(&local, "verify_pin", json!({"pin": "0000", "level": "cashier"}));
    }
    let locked = rpc(&local, "verify_pin", json!({"pin": "4826", "level": "cashier"})).unwrap_err();
    assert!(locked.to_string().contains("Trop d'essais"), "{locked}");
}

#[test]
fn barcode_is_mandatory_and_packagings_sell_in_base_units() {
    let (mut conn, admin) = setup();
    let caisse = cashier(&conn, &admin);
    // Code-barres vide → généré automatiquement
    let eau = product(&mut conn, &admin, "Eau 1,5L", 250, 400, 30.0);
    let p = catalog::get_product(&conn, eau).unwrap();
    let code = p.barcode.clone().expect("code-barres généré");
    assert!(!code.is_empty());
    // Conditionnement : 1 carton = 12 bouteilles, code propre
    let input = catalog::ProductInput {
        barcode: Some(code.clone()), name: p.name.clone(), description: None, category_id: None, supplier_id: None,
        unit: Some("bouteille".into()), purchase_price: 250, sale_price: 400, tax_rate: None, min_stock: None,
        track_stock: Some(true), active: Some(true), image_id: None, location_id: None, expiry_date: None,
        initial_stock: None, brand: Some("Kirène".into()), sku: Some("EAU-15".into()),
        packagings: Some(vec![catalog::Packaging { id: None, name: "Carton de 12".into(), quantity: 12.0, barcode: Some("CART-EAU".into()), sale_price: 4500 }]),
    };
    let saved = catalog::save_product(&mut conn, &admin, Some(eau), input).unwrap();
    assert_eq!(saved.packagings.len(), 1);
    assert_eq!(saved.brand.as_deref(), Some("Kirène"));
    // Le code du carton ne peut pas être réutilisé comme code produit
    let dup = catalog::ProductInput {
        barcode: Some("CART-EAU".into()), name: "Autre".into(), description: None, category_id: None, supplier_id: None,
        unit: None, purchase_price: 1, sale_price: 1, tax_rate: None, min_stock: None, track_stock: None, active: None,
        image_id: None, location_id: None, expiry_date: None, initial_stock: None, brand: None, sku: None, packagings: None,
    };
    assert!(catalog::save_product(&mut conn, &admin, None, dup).is_err());
    // Scan
    let s = catalog::scan(&conn, "CART-EAU").unwrap().unwrap();
    assert_eq!(s.product.id, eau);
    let pack = s.packaging.unwrap();
    assert!(catalog::scan(&conn, &code).unwrap().unwrap().packaging.is_none());
    // Vente d'un carton + 2 bouteilles
    cash::open(&conn, &caisse, 0).unwrap();
    let mut input = sale_input(vec![(eau, 1.0), (eau, 2.0)], "cash", 10_000, None);
    input.items[0].packaging_id = pack.id;
    let sale = sales::create_sale(&mut conn, &caisse, input).unwrap();
    assert_eq!(sale.total, 4500 + 800);
    assert_eq!(stock_of(&conn, eau), 30.0 - 14.0);
    sales::cancel_sale(&mut conn, &admin, sale.id, "test").unwrap();
    assert_eq!(stock_of(&conn, eau), 30.0);
    // Anciens produits sans code-barres : complétés au démarrage
    conn.execute("UPDATE products SET barcode = NULL WHERE id = ?1", [eau]).unwrap();
    assert_eq!(catalog::fill_missing_barcodes(&conn).unwrap(), 1);
    assert!(catalog::get_product(&conn, eau).unwrap().barcode.is_some());
}

#[test]
fn catalogue_business_types_and_category_tree() {
    use crate::state::{AppState, Origin};
    use serde_json::json;
    let tree = templates::catalogue();
    assert!(tree.len() >= 32);
    assert_eq!(templates::profiles().len(), 11);
    let (mut conn, admin) = setup();
    let created = templates::seed(&mut conn, &admin, &[1, 2]).unwrap();
    assert!(created > 10);
    // Pas de doublon au second chargement
    assert_eq!(templates::seed(&mut conn, &admin, &[1, 2]).unwrap(), 0);
    assert!(templates::seed(&mut conn, &admin, &[999]).is_err());
    // Import de chemins sur plusieurs niveaux
    let n = templates::import_paths(&mut conn, &admin, vec!["Quincaillerie > Plomberie > Tuyaux PVC".into(), "Quincaillerie > Plomberie".into()]).unwrap();
    assert_eq!(n, 3);
    let cats = catalog::list_categories(&conn).unwrap();
    let tuyaux = cats.iter().find(|c| c.name == "Tuyaux PVC").unwrap();
    assert_eq!(tuyaux.depth, 2);
    assert_eq!(tuyaux.path, "Quincaillerie › Plomberie › Tuyaux PVC");
    // Masquer une branche masque sa descendance
    let quinc = cats.iter().find(|c| c.name == "Quincaillerie").unwrap().id;
    catalog::set_category_active(&conn, &admin, quinc, false).unwrap();
    let cats = catalog::list_categories(&conn).unwrap();
    assert!(!cats.iter().find(|c| c.name == "Tuyaux PVC").unwrap().active);
    // Type de commerce via RPC
    let state = AppState::new(conn, std::path::PathBuf::from(":memory:"));
    crate::rpc::dispatch(&state, &Origin::Local, "login", json!({"username": "admin", "password": "secret123"})).unwrap();
    let r = crate::rpc::dispatch(&state, &Origin::Local, "set_business_type", json!({"id": "restaurant", "seed": true})).unwrap();
    assert_eq!(r["settings"]["business_type"], "restaurant");
    assert_eq!(r["settings"]["enabled_features"], "services");
    assert!(r["created"].as_i64().unwrap() > 0);
    let p = crate::rpc::dispatch(&state, &Origin::Remote(None), "business_profiles", json!({})).unwrap();
    assert_eq!(p["profiles"].as_array().unwrap().len(), 11);
}

#[test]
fn only_cashiers_sell_and_cashier_dashboard() {
    let (mut conn, admin) = setup();
    let p = product(&mut conn, &admin, "Savon", 200, 350, 50.0);
    // L'administrateur (et le gestionnaire) ne peuvent ni ouvrir une caisse ni vendre.
    assert!(cash::open(&conn, &admin, 0).unwrap_err().to_string().contains("caissier"));
    assert!(sales::create_sale(&mut conn, &admin, sale_input(vec![(p, 1.0)], "cash", 350, None)).is_err());
    let caisse = cashier(&conn, &admin);
    let stats = cash::cashier_stats(&conn, &caisse).unwrap();
    assert!(stats.session.is_none());
    cash::open(&conn, &caisse, 1000).unwrap();
    sales::create_sale(&mut conn, &caisse, sale_input(vec![(p, 2.0)], "cash", 1000, None)).unwrap();
    let s2 = sales::create_sale(&mut conn, &caisse, sale_input(vec![(p, 4.0)], "cash", 2000, None)).unwrap();
    sales::cancel_sale(&mut conn, &admin, s2.id, "erreur").unwrap();
    sales::create_sale(&mut conn, &caisse, sale_input(vec![(p, 1.0)], "card", 350, None)).unwrap();
    let st = cash::cashier_stats(&conn, &caisse).unwrap();
    let session = st.session.as_ref().unwrap();
    assert_eq!(session.sales_count, 2);
    assert_eq!(session.sales_total, 1050);
    assert_eq!(st.average_basket, 525);
    assert_eq!(st.biggest_sale, 700);
    assert_eq!((st.cancelled_count, st.cancelled_total), (1, 1400));
    assert_eq!(st.items_sold, 3.0);
    assert_eq!(st.top_products[0].name, "Savon");
    assert_eq!(st.recent.len(), 3);
    assert_eq!(st.today_total, 1050);
    // Clôture forcée par l'administrateur
    let closed = cash::force_close(&conn, &admin, session.id, cash::CloseInput { counted_amount: 1700, note: None }).unwrap();
    assert_eq!(closed.difference, Some(0));
    assert!(cash::force_close(&conn, &admin, session.id, cash::CloseInput { counted_amount: 0, note: None }).is_err());
    // Après clôture, le tableau de bord montre la dernière session
    assert_eq!(cash::cashier_stats(&conn, &caisse).unwrap().session.unwrap().status, "closed");
}

#[test]
fn live_cart_take_over_between_cashiers() {
    use crate::state::{AppState, Origin};
    use serde_json::json;
    let (conn, admin) = setup();
    users::create(&conn, &admin, users::UserInput { username: Some("fatou".into()), full_name: "Fatou".into(), role: "cashier".into(), active: Some(true), password: Some("caisse123".into()) }).unwrap();
    users::create(&conn, &admin, users::UserInput { username: Some("mariam".into()), full_name: "Mariam".into(), role: "cashier".into(), active: Some(true), password: Some("caisse123".into()) }).unwrap();
    let state = AppState::new(conn, std::path::PathBuf::from(":memory:"));
    let rpc = |o: &Origin, cmd: &str, a: serde_json::Value| crate::rpc::dispatch(&state, o, cmd, a);
    let anon = Origin::Remote(None);
    let login = |u: &str, pin: &str| {
        let t = rpc(&anon, "login", json!({"username": u, "password": "caisse123"})).unwrap()["token"].as_str().unwrap().to_string();
        let o = Origin::Remote(Some(t));
        rpc(&o, "set_my_pin", json!({"password": "caisse123", "pin": pin})).unwrap();
        o
    };
    let mariam = login("mariam", "2468");
    let fatou = login("fatou", "9753");
    // Présence sans connexion
    let r = rpc(&anon, "poste_heartbeat", json!({"id": "tab-1", "name": "Tablette 1", "kind": "mobile", "__ip": "192.168.1.30"})).unwrap();
    assert_eq!(r["online"], 1);
    assert!(rpc(&anon, "list_postes", json!({})).is_err(), "liste réservée aux utilisateurs connectés");
    assert_eq!(rpc(&fatou, "list_postes", json!({})).unwrap()["postes"][0]["ip"], "192.168.1.30");
    assert_eq!(rpc(&fatou, "list_postes", json!({})).unwrap()["postes"][0]["route"], "local");
    // Téléphone passé par le tunnel : route « internet » renvoyée au poste et affichée dans la liste
    let r = rpc(&anon, "poste_heartbeat", json!({"id": "tel-1", "name": "Téléphone 1", "kind": "mobile", "__ip": "41.73.10.20", "__route": "internet"})).unwrap();
    assert_eq!(r["route"], "internet");
    let postes = rpc(&fatou, "list_postes", json!({})).unwrap()["postes"].clone();
    let tel = postes.as_array().unwrap().iter().find(|p| p["id"] == "tel-1").unwrap().clone();
    assert_eq!(tel["route"], "internet");
    assert_eq!(tel["ip"], "41.73.10.20");
    // Mariam encaisse ; Fatou la voit et reprend son client
    let cart = json!({"lines": [{"product_id": 1, "packaging_id": null, "name": "Riz", "unit": "pce", "quantity": 2.0, "unit_price": 650, "discount": 0, "total": 1300}], "customer": null, "discount": 0, "total": 1300, "items": 2.0});
    rpc(&mariam, "live_cart_update", json!({"poste_id": "p-m", "poste": "Caisse 1", "cart": cart, "status": "payment"})).unwrap();
    let list = rpc(&fatou, "live_carts", json!({"except": "p-f"})).unwrap();
    assert_eq!(list[0]["user_name"], "Mariam");
    assert_eq!(list[0]["status"], "payment");
    assert!(rpc(&fatou, "live_cart_take", json!({"poste_id": "p-m"})).is_err(), "PIN obligatoire");
    let taken = rpc(&fatou, "live_cart_take", json!({"poste_id": "p-m", "pin": "9753"})).unwrap();
    assert_eq!(taken["total"], 1300);
    let r = rpc(&mariam, "live_cart_update", json!({"poste_id": "p-m", "poste": "Caisse 1", "cart": cart, "status": "payment"})).unwrap();
    assert_eq!(r["taken_by"], "Fatou");
    // L'administrateur ne vend pas : il ne peut pas reprendre un ticket
    let t = rpc(&anon, "login", json!({"username": "admin", "password": "secret123"})).unwrap()["token"].as_str().unwrap().to_string();
    rpc(&mariam, "live_cart_update", json!({"poste_id": "p-m", "poste": "Caisse 1", "cart": cart, "status": "cart"})).unwrap();
    assert!(rpc(&Origin::Remote(Some(t)), "live_cart_take", json!({"poste_id": "p-m", "pin": "0000"})).unwrap_err().to_string().contains("caissier"));
}

#[test]
fn cloud_payload_lists_addresses() {
    let p = crate::cloud::payload("Kanu", 7878, &["192.168.1.10".into(), "10.0.0.5".into()], "", 3);
    assert_eq!(p["url"], "http://192.168.1.10:7878");
    assert_eq!(p["https_url"], "https://192.168.1.10:7879");
    assert_eq!(p["urls"].as_array().unwrap().len(), 2);
    assert!(p["public_url"].is_null());
    assert_eq!(p["postes_online"], 3);
}
