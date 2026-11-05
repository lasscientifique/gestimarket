//! Tests d'intégration de la logique métier sur une base SQLite en mémoire.

use rusqlite::Connection;

use crate::db;
use crate::services::*;
use crate::state::SessionUser;

/// PIN de l'administrateur des tests.
const ADMIN_PIN: &str = "258036";

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
            username: None,
            pin: ADMIN_PIN.into(),
            team: Some(vec![]),
            lang: None,
            country: None,
            currency_code: None,
            currency_position: None,
        },
    )
    .unwrap()
    .user;
    (conn, admin)
}

/// Compte caissier : seul rôle autorisé à ouvrir une caisse et à vendre.
fn cashier(conn: &Connection, admin: &SessionUser) -> SessionUser {
    let id = users::create(conn, admin, users::UserInput {
        username: Some("caisse".into()), full_name: "Caissière Test".into(), role: "cashier".into(), active: Some(true), pin: Some("4826".into()), internet_access: None,
    }).unwrap();
    SessionUser { id, username: "caisse".into(), full_name: "Caissière Test".into(), role: "cashier".into(), has_pin: false, lang: None }
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
            wholesale_price: None,
            wholesale_min_qty: None,
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
        client_ref: None,
        discount_pin: None,
    }
}

fn stock_of(conn: &Connection, id: i64) -> f64 {
    catalog::get_product(conn, id).unwrap().stock
}

#[test]
fn login_by_identifier_and_pin() {
    let (conn, _) = setup();
    let admin = auth::account_by_username(&conn, "ADMIN").unwrap().expect("identifiant insensible à la casse");
    assert!(auth::check_pin(&conn, &admin, ADMIN_PIN).unwrap().is_some());
    assert!(auth::check_pin(&conn, &admin, "135790").unwrap().is_none());
    assert!(!auth::needs_setup(&conn).unwrap());
    // PIN : 6 chiffres pour l'administrateur, 4 à 6 pour les autres, jamais trop simple.
    assert!(auth::validate_pin("4826", "admin").is_err());
    assert!(auth::validate_pin("4826", "cashier").is_ok() && auth::validate_pin("482613", "manager").is_ok());
    assert!(auth::validate_pin("123456", "admin").is_err() && auth::validate_pin("1111", "cashier").is_err());
    assert!(auth::validate_pin("12a4", "cashier").is_err() && auth::validate_pin("4826137", "cashier").is_err());
    for _ in 0..50 {
        assert!(auth::validate_pin(&auth::random_pin(4), "cashier").is_ok());
        assert!(auth::validate_pin(&auth::random_pin(6), "admin").is_ok());
    }
    // Plus de mot de passe.
    assert!(auth::login_password(&conn, "admin", "secret123").is_err());
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
        partners::CustomerInput { name: "Awa".into(), phone: None, email: None, address: None, notes: None, credit_limit: Some(5000), wholesale: None },
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
        users::UserInput { username: Some("fatou".into()), full_name: "Fatou".into(), role: "cashier".into(), active: Some(true), pin: Some("4826".into()), internet_access: None },
    )
    .unwrap();
    assert!(cashier_id > 0);
    let err = users::update(
        &conn,
        &admin,
        admin.id,
        users::UserInput { username: None, full_name: "Admin".into(), role: "manager".into(), active: Some(true), pin: None, internet_access: None },
    );
    assert!(err.is_err());
    let fatou = auth::account_by_username(&conn, "fatou").unwrap().unwrap();
    assert!(auth::check_pin(&conn, &fatou, "4826").unwrap().is_some());
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
fn configured_mobile_operator_payment() {
    let (mut conn, admin) = setup();
    let caisse = cashier(&conn, &admin);
    let p = product(&mut conn, &admin, "Riz 1 kg", 500, 800, 50.0);
    cash::open(&conn, &caisse, 0).unwrap();
    let ops = r#"[{"id":"wave","name":"Wave","require_ref":true},{"id":"moov","name":"Moov Money","enabled":false}]"#;
    let mut values = std::collections::BTreeMap::new();
    values.insert("mobile_operators".to_string(), ops.to_string());
    settings::update(&mut conn, &admin, values).unwrap();
    // Liste illisible ou identifiant en double → refusée.
    let mut bad = std::collections::BTreeMap::new();
    bad.insert("mobile_operators".to_string(), r#"[{"id":"wave","name":"A"},{"id":"wave","name":"B"}]"#.to_string());
    assert!(settings::update(&mut conn, &admin, bad).is_err());

    let pay = |method: &str, reference: Option<&str>| sales::PaymentInput {
        method: method.into(),
        amount: 800,
        reference: reference.map(String::from),
        phone: None,
    };
    let mut ok = sale_input(vec![(p, 1.0)], "cash", 0, None);
    ok.payments = vec![pay("mm:wave", Some("T-WAVE-1"))];
    let sale = sales::create_sale(&mut conn, &caisse, ok).unwrap();
    assert_eq!(sale.payment_method, "mm:wave");

    // ID de transaction exigé, opérateur désactivé ou inconnu → refusé.
    for (method, reference) in [("mm:wave", None), ("mm:moov", Some("T2")), ("mm:mtn", Some("T3"))] {
        let mut input = sale_input(vec![(p, 1.0)], "cash", 0, None);
        input.payments = vec![pay(method, reference)];
        assert!(sales::create_sale(&mut conn, &caisse, input).is_err(), "{method}");
    }
    let session = cash::current_session(&conn, &caisse).unwrap().unwrap();
    assert_eq!(session.mobile_money_sales, 800);
    let wave = sales::list_electronic(&conn, &sales::ElectronicFilter { method: Some("mm:wave".into()), ..Default::default() }).unwrap();
    assert_eq!(wave.len(), 1);
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
    // Rayon « 1 » créé sur le plan : 1 étage × 3 cases.
    assert_eq!(sel.fixture_name.as_deref(), Some("Rayon 1"));
    assert_eq!(locations::list(&conn).unwrap().len(), 3);
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
        wholesale_price: None,
        wholesale_min_qty: None,
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
    assert_eq!(count("PRAGMA user_version"), 11);
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
    partners::save_customer(&conn, &admin, None, partners::CustomerInput { name: "Moussa".into(), phone: Some("76 12".into()), email: None, address: None, notes: None, credit_limit: None, wholesale: None }).unwrap();
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
        active: Some(true), image_id: None, location_id: None, expiry_date: None, initial_stock: None, brand: None, sku: None, packagings: None, wholesale_price: None, wholesale_min_qty: None,
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
        image_id: None, location_id: None, expiry_date: None, initial_stock: None, brand: None, sku: None, packagings: None, wholesale_price: None, wholesale_min_qty: None,
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
    let r = crate::rpc::dispatch(&state, &anon, "login", json!({"username": "admin", "pin": ADMIN_PIN})).unwrap();
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
    // Changer son PIN ne doit pas fermer la session réseau (même jeton).
    assert!(crate::rpc::dispatch(&state, &me, "change_my_pin", json!({"current": "135790", "pin": "739104"})).is_err());
    crate::rpc::dispatch(&state, &me, "change_my_pin", json!({"current": ADMIN_PIN, "pin": "739104"})).unwrap();
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
        username: Some("fatou".into()), full_name: "Fatou".into(), role: "cashier".into(), active: Some(true), pin: Some("4826".into()), internet_access: None,
    }).unwrap();
    let state = AppState::new(conn, std::path::PathBuf::from(":memory:"));
    let local = Origin::Local;
    let rpc = |o: &Origin, cmd: &str, a: serde_json::Value| crate::rpc::dispatch(&state, o, cmd, a);

    // Administrateur : action critique sans PIN → refus ; avec son PIN → OK
    rpc(&local, "login", json!({"username": "admin", "pin": ADMIN_PIN})).unwrap();
    let adjust = json!({"input": {"product_id": p, "mode": "set", "quantity": 18.0, "kind": "adjustment", "note": null}});
    assert!(rpc(&local, "adjust_stock", adjust.clone()).unwrap_err().to_string().contains("PIN requis"));
    let mut with_pin = adjust.clone();
    with_pin["pin"] = json!(ADMIN_PIN);
    assert_eq!(rpc(&local, "adjust_stock", with_pin).unwrap(), json!(18.0));

    // Caissière : connexion par PIN, vente, annulation validée par l'administrateur choisi
    rpc(&local, "logout", json!({})).unwrap();
    let users = rpc(&local, "list_login_users", json!({})).unwrap();
    assert_eq!(users.as_array().unwrap().len(), 2);
    assert!(rpc(&local, "login_pin", json!({"user_id": caissier, "pin": "9157"})).is_err());
    let r = rpc(&local, "login_pin", json!({"user_id": caissier, "pin": "4826"})).unwrap();
    assert_eq!(r["user"]["role"], "cashier");
    // La caissière n'a pas accès au tableau de bord (administrateur)
    assert!(rpc(&local, "dashboard", json!({})).is_err());
    rpc(&local, "open_cash_session", json!({"amount": 0})).unwrap();
    let sale = rpc(&local, "create_sale", json!({"input": {"items": [{"product_id": p, "quantity": 2.0}], "customer_id": null, "discount": 0,
        "payments": [{"method": "cash", "amount": 1200}], "note": null}})).unwrap();
    let id = sale["id"].as_i64().unwrap();
    // Responsables proposés pour valider : l'administrateur seulement.
    let approvers = rpc(&local, "list_approvers", json!({"level": "admin"})).unwrap();
    assert_eq!(approvers.as_array().unwrap().len(), 1);
    assert_eq!(approvers[0]["id"].as_i64(), Some(admin.id));
    // Son propre PIN ne suffit pas ; le PIN de l'administrateur sans le choisir non plus ;
    // l'administrateur choisi dans la liste, avec son PIN : oui.
    assert!(rpc(&local, "cancel_sale", json!({"id": id, "reason": "erreur", "pin": "4826"})).unwrap_err().to_string().contains("choisissez"));
    assert!(rpc(&local, "cancel_sale", json!({"id": id, "reason": "erreur", "pin": ADMIN_PIN})).is_err());
    assert!(rpc(&local, "cancel_sale", json!({"id": id, "reason": "erreur", "pin": format!("{caissier}:4826")})).is_err());
    let cancelled = rpc(&local, "cancel_sale", json!({"id": id, "reason": "erreur", "pin": format!("{}:{ADMIN_PIN}", admin.id)})).unwrap();
    assert_eq!(cancelled["status"], "cancelled");
    // Même PIN que l'administrateur (autorisé : chacun choisit le sien) : il ne vaut que pour elle.
    rpc(&local, "change_my_pin", json!({"current": "4826", "pin": ADMIN_PIN})).unwrap();
    let ok = rpc(&local, "verify_pin", json!({"pin": ADMIN_PIN, "level": "cashier", "action": "Suppression d'article"})).unwrap();
    assert_eq!(ok["full_name"], "Fatou");
    assert!(rpc(&local, "verify_pin", json!({"pin": ADMIN_PIN, "level": "admin"})).is_err());
    // Blocage du compte après 5 PIN faux
    for _ in 0..5 {
        let _ = rpc(&local, "verify_pin", json!({"pin": "9157", "level": "cashier"}));
    }
    let locked = rpc(&local, "verify_pin", json!({"pin": ADMIN_PIN, "level": "cashier"})).unwrap_err();
    assert!(locked.to_string().contains("Trop de codes PIN"), "{locked}");
    // L'administrateur, lui, n'est pas bloqué.
    let boss = rpc(&local, "verify_pin", json!({"pin": format!("{}:{ADMIN_PIN}", admin.id), "level": "admin"})).unwrap();
    assert_eq!(boss["role"], "admin");
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
        packagings: Some(vec![catalog::Packaging { id: None, name: "Carton de 12".into(), quantity: 12.0, barcode: Some("CART-EAU".into()), sale_price: 4500, wholesale_price: 0, wholesale_min_qty: 0.0 }]),
        wholesale_price: None,
        wholesale_min_qty: None,
    };
    let saved = catalog::save_product(&mut conn, &admin, Some(eau), input).unwrap();
    assert_eq!(saved.packagings.len(), 1);
    assert_eq!(saved.brand.as_deref(), Some("Kirène"));
    // Le code du carton ne peut pas être réutilisé comme code produit
    let dup = catalog::ProductInput {
        barcode: Some("CART-EAU".into()), name: "Autre".into(), description: None, category_id: None, supplier_id: None,
        unit: None, purchase_price: 1, sale_price: 1, tax_rate: None, min_stock: None, track_stock: None, active: None,
        image_id: None, location_id: None, expiry_date: None, initial_stock: None, brand: None, sku: None, packagings: None, wholesale_price: None, wholesale_min_qty: None,
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
    assert_eq!(templates::profiles().len(), 22);
    let (mut conn, admin) = setup();
    // Chaque profil propose des meubles de la palette du plan et des catégories du catalogue.
    for profile in templates::profiles() {
        assert!(profile.categories.iter().all(|&i| i >= 1 && i <= tree.len()), "{}", profile.id);
        for code in &profile.fixtures {
            let n: i64 = conn.query_row("SELECT COUNT(*) FROM fixture_types WHERE code = ?1 AND builtin = 1", [code], |r| r.get(0)).unwrap();
            assert_eq!(n, 1, "{} : meuble {code} inconnu", profile.id);
        }
    }
    let created = templates::seed(&mut conn, &admin, &[1, 2]).unwrap();
    assert!(created > 10);
    // Pas de doublon au second chargement
    assert_eq!(templates::seed(&mut conn, &admin, &[1, 2]).unwrap(), 0);
    assert!(templates::seed(&mut conn, &admin, &[999]).is_err());
    // Catalogue anglais : même arborescence (les index des profils restent valables).
    fn shape(n: &templates::TemplateNode) -> Vec<usize> {
        std::iter::once(n.children.len()).chain(n.children.iter().flat_map(shape)).collect()
    }
    let en = templates::catalogue_in("en");
    assert_eq!(en.len(), tree.len());
    assert!(en.iter().zip(&tree).all(|(a, b)| shape(a) == shape(b)));
    assert_eq!(en[1].name, "Beverages");
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
    crate::rpc::dispatch(&state, &Origin::Local, "login", json!({"username": "admin", "pin": ADMIN_PIN})).unwrap();
    let r = crate::rpc::dispatch(&state, &Origin::Local, "set_business_type", json!({"id": "restaurant", "seed": true})).unwrap();
    assert_eq!(r["settings"]["business_type"], "restaurant");
    assert_eq!(r["settings"]["enabled_features"], "services");
    assert!(r["created"].as_i64().unwrap() > 0);
    let p = crate::rpc::dispatch(&state, &Origin::Remote(None), "business_profiles", json!({})).unwrap();
    assert_eq!(p["profiles"].as_array().unwrap().len(), 22);
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
    users::create(&conn, &admin, users::UserInput { username: Some("fatou".into()), full_name: "Fatou".into(), role: "cashier".into(), active: Some(true), pin: Some("9753".into()), internet_access: None }).unwrap();
    users::create(&conn, &admin, users::UserInput { username: Some("mariam".into()), full_name: "Mariam".into(), role: "cashier".into(), active: Some(true), pin: Some("2468".into()), internet_access: None }).unwrap();
    let state = AppState::new(conn, std::path::PathBuf::from(":memory:"));
    let rpc = |o: &Origin, cmd: &str, a: serde_json::Value| crate::rpc::dispatch(&state, o, cmd, a);
    let anon = Origin::Remote(None);
    let login = |u: &str, pin: &str| {
        let t = rpc(&anon, "login", json!({"username": u, "pin": pin})).unwrap()["token"].as_str().unwrap().to_string();
        Origin::Remote(Some(t))
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
    let t = rpc(&anon, "login", json!({"username": "admin", "pin": ADMIN_PIN})).unwrap()["token"].as_str().unwrap().to_string();
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

#[test]
fn postes_limit_login_throttle_and_internet_restrictions() {
    use crate::state::{AppState, Origin};
    use serde_json::json;
    let (conn, admin) = setup();
    users::create(&conn, &admin, users::UserInput { username: Some("awa".into()), full_name: "Awa".into(), role: "cashier".into(), active: Some(true), pin: Some("4826".into()), internet_access: None }).unwrap();
    let state = AppState::new(conn, std::path::PathBuf::from(":memory:"));
    let anon = Origin::Remote(None);
    let awa = auth::account_by_username(&state.conn(), "awa").unwrap().unwrap().session();
    let boss = auth::account_by_username(&state.conn(), "admin").unwrap().unwrap().session();

    // 2 postes : deux appareils connectés, le troisième est refusé.
    let t1 = state.set_user(&anon, Some(awa.clone())).unwrap();
    assert!(state.ensure_slot(&anon, &awa, 2).is_ok());
    state.set_user(&anon, Some(awa.clone())).unwrap();
    assert!(state.ensure_slot(&anon, &awa, 2).unwrap_err().to_string().contains("Nombre maximal"));
    // Un appareil qui se reconnecte (même jeton) reprend sa propre place.
    assert!(state.ensure_slot(&Origin::Remote(Some(t1)), &awa, 2).is_ok());
    // Ce PC compte aussi comme un poste ; l'administrateur peut toujours s'y connecter pour libérer des places.
    assert!(state.ensure_slot(&Origin::Local, &awa, 2).is_err());
    assert!(state.ensure_slot(&Origin::Local, &boss, 2).is_ok());
    // Liste des postes et déconnexion d'un appareil par l'administrateur.
    let sessions = state.sessions();
    assert_eq!(sessions.len(), 2);
    assert!(sessions.iter().all(|s| s.active && !s.local));
    assert!(state.kick(&sessions[0].id).is_some());
    assert!(state.kick(&sessions[0].id).is_none());
    assert_eq!(state.active_sessions(), 1);
    assert!(state.ensure_slot(&anon, &awa, 2).is_ok());

    // Anti force brute : 5 PIN faux bloquent cet appareil, et ce compte depuis tous les appareils.
    let login = |ip: &str, user: &str, pin: &str| crate::rpc::dispatch(&state, &anon, "login", json!({"username": user, "pin": pin, "__ip": ip}));
    for _ in 0..5 {
        assert!(login("41.73.10.20", "awa", "9157").is_err());
    }
    assert!(login("41.73.10.20", "awa", "4826").unwrap_err().to_string().contains("Trop d'essais"));
    assert!(login("192.168.1.20", "awa", "4826").unwrap_err().to_string().contains("pour ce compte"));
    assert!(login("192.168.1.20", "admin", ADMIN_PIN).is_ok());

    // Depuis Internet : ni liste du personnel, ni connexion par PIN, paramètres publics seulement.
    let net = json!({"__route": "internet"});
    assert_eq!(crate::rpc::dispatch(&state, &anon, "list_login_users", net.clone()).unwrap().as_array().unwrap().len(), 0);
    assert_eq!(crate::rpc::dispatch(&state, &anon, "list_login_users", json!({})).unwrap().as_array().unwrap().len(), 2);
    let pin = crate::rpc::dispatch(&state, &anon, "login_pin", json!({"user_id": 1, "pin": ADMIN_PIN, "__route": "internet"}));
    assert!(pin.unwrap_err().to_string().contains("Internet"));
    let typed = crate::rpc::dispatch(&state, &anon, "login", json!({"username": "admin", "pin": ADMIN_PIN, "__route": "internet", "__ip": "41.73.10.30"}));
    assert!(typed.unwrap_err().to_string().contains("pas encore autorisé"));
    let s = crate::rpc::dispatch(&state, &anon, "get_settings", net).unwrap();
    assert!(s.get("shop_name").is_some() && s.get("supabase_key").is_none() && s.get("om_merchant_number").is_none());
    assert!(crate::rpc::dispatch(&state, &anon, "get_settings", json!({})).unwrap().get("om_merchant_number").is_some());
}

#[test]
fn store_plan_put_take_move_and_resize() {
    let (mut conn, admin) = setup();
    let types = plan::get(&conn).unwrap().types;
    let fridge_type = types.iter().find(|t| t.code == "refrigerateur").unwrap().id;
    let wall_type = types.iter().find(|t| t.code == "mur").unwrap().id;

    // Frigo posé sur le plan : code FR1, 5 étages × 1 case, cases créées.
    let fr = plan::create_fixture(&conn, Some(&admin), plan::FixtureInput { type_id: Some(fridge_type), x: Some(2.0), y: Some(3.0), ..Default::default() }).unwrap();
    assert_eq!((fr.code.as_str(), fr.levels, fr.sections, fr.storage), ("FR1", 5, 1, true));
    assert_eq!(plan::create_fixture(&conn, None, plan::FixtureInput { type_id: Some(fridge_type), ..Default::default() }).unwrap().code, "FR2");
    let wall = plan::create_fixture(&conn, None, plan::FixtureInput { type_id: Some(wall_type), ..Default::default() }).unwrap();
    assert!(!wall.storage);
    let slots = plan::contents(&conn, fr.id).unwrap().slots;
    assert_eq!(slots.len(), 5);
    assert!(plan::contents(&conn, wall.id).unwrap().slots.is_empty(), "un mur n'a pas de cases");
    let slot = |level: i64| slots.iter().find(|s| s.level == level).unwrap().id;

    // Poser : 1er emplacement = principal ; 2e = autre emplacement (rayon + frigo).
    let p = product(&mut conn, &admin, "Coca 33cl", 300, 500, 24.0);
    let places = plan::put(&mut conn, &admin, plan::PutInput { product_id: p, location_id: slot(3), from_location_id: None, primary: None }).unwrap();
    assert_eq!(places.len(), 1);
    assert!(places[0].primary);
    assert_eq!(plan::slot_text(&conn, slot(3)).unwrap(), "Réfrigérateur vitré FR1 · Étage 3");
    let places = plan::put(&mut conn, &admin, plan::PutInput { product_id: p, location_id: slot(1), from_location_id: None, primary: None }).unwrap();
    assert_eq!(places.iter().map(|x| (x.level, x.primary)).collect::<Vec<_>>(), vec![(3, true), (1, false)]);
    let prod = catalog::get_product(&conn, p).unwrap();
    assert_eq!((prod.fixture_name.as_deref(), prod.other_places), (Some("Réfrigérateur vitré FR1"), 1));
    assert_eq!(plan::get(&conn).unwrap().fixtures.iter().find(|f| f.id == fr.id).unwrap().product_count, 1);

    // Déplacer l'emplacement principal de l'étage 3 à l'étage 5.
    let places = plan::put(&mut conn, &admin, plan::PutInput { product_id: p, location_id: slot(5), from_location_id: Some(slot(3)), primary: None }).unwrap();
    assert_eq!(places.iter().map(|x| (x.level, x.primary)).collect::<Vec<_>>(), vec![(5, true), (1, false)]);
    // L'autre emplacement devient principal.
    let places = plan::set_primary(&mut conn, &admin, p, slot(1)).unwrap();
    assert_eq!(places.iter().map(|x| (x.level, x.primary)).collect::<Vec<_>>(), vec![(1, true), (5, false)]);

    // Réduire le frigo à 2 étages : refusé (étage 5 occupé). Prendre le produit de l'étage 5, puis réduire.
    let shrink = |conn: &mut Connection| plan::update_fixture(conn, &admin, fr.id, plan::FixtureInput { levels: Some(2), ..Default::default() });
    assert!(shrink(&mut conn).unwrap_err().to_string().contains("contiennent encore des produits"));
    let places = plan::take(&mut conn, &admin, p, slot(5)).unwrap();
    assert_eq!(places.len(), 1);
    let fr2 = shrink(&mut conn).unwrap();
    assert_eq!(fr2.levels, 2);
    assert_eq!(plan::contents(&conn, fr.id).unwrap().slots.len(), 2);
    // Changer le code du meuble change le libellé de ses cases.
    plan::update_fixture(&mut conn, &admin, fr.id, plan::FixtureInput { code: Some("frb".into()), name: Some("Frigo boissons".into()), ..Default::default() }).unwrap();
    assert_eq!(catalog::get_product(&conn, p).unwrap().bloc.as_deref(), Some("FRB"));
    assert!(plan::update_fixture(&mut conn, &admin, fr.id, plan::FixtureInput { code: Some("FR2".into()), ..Default::default() }).is_err(), "code déjà pris");

    // Glisser-déposer : position, taille, rotation.
    plan::move_fixtures(&mut conn, vec![plan::Geometry { id: fr.id, x: 8.5, y: 1.0, w: 0.8, h: 0.7, rotation: -90 }]).unwrap();
    let moved = plan::get_fixture(&conn, fr.id).unwrap();
    assert_eq!((moved.x, moved.rotation), (8.5, 270));

    // Supprimer le meuble : le produit garde son autre emplacement, qui devient principal.
    let other = plan::create_fixture(&conn, None, plan::FixtureInput { type_id: Some(fridge_type), ..Default::default() }).unwrap();
    let other_slot = plan::contents(&conn, other.id).unwrap().slots[0].id;
    plan::put(&mut conn, &admin, plan::PutInput { product_id: p, location_id: other_slot, from_location_id: None, primary: None }).unwrap();
    assert_eq!(plan::delete_fixture(&mut conn, &admin, fr.id).unwrap(), 1);
    let places = plan::product_places(&conn, p).unwrap();
    assert_eq!((places.len(), places[0].primary, places[0].fixture_id), (1, true, other.id));

    // Meuble personnalisé : créé, posé, puis impossible à supprimer tant qu'il est posé.
    let custom = plan::save_type(&conn, &admin, None, plan::TypeInput {
        name: "Frigo à boissons Coca".into(), category: "froid".into(), prefix: "fb".into(), color: "#dc2626".into(),
        width: 0.6, depth: 0.6, levels: 4, sections: 2, ..Default::default()
    }).unwrap();
    let fb = plan::create_fixture(&conn, None, plan::FixtureInput { type_id: Some(custom), ..Default::default() }).unwrap();
    assert_eq!((fb.code.as_str(), fb.levels * fb.sections), ("FB1", 8));
    assert!(plan::delete_type(&conn, &admin, custom).is_err());
    plan::delete_fixture(&mut conn, &admin, fb.id).unwrap();
    plan::delete_type(&conn, &admin, custom).unwrap();
    assert!(plan::delete_type(&conn, &admin, fridge_type).is_err(), "meuble de base");

    // Niveaux du bâtiment : le dernier ne se supprime pas.
    let first = plan::get(&conn).unwrap().floors[0].id;
    let up = plan::save_floor(&conn, &admin, None, plan::FloorInput { name: "1er étage".into(), width: 15.0, depth: 10.0, ..Default::default() }).unwrap();
    assert_eq!(plan::get(&conn).unwrap().floors.len(), 2);
    plan::delete_floor(&conn, &admin, up).unwrap();
    assert!(plan::delete_floor(&conn, &admin, first).is_err());
}

#[test]
fn migration_6_turns_blocs_into_plan_fixtures() {
    let conn = Connection::open_in_memory().unwrap();
    for i in 0..5 {
        conn.execute_batch(db::migration_sql(i)).unwrap();
    }
    conn.execute_batch("PRAGMA user_version = 5; PRAGMA foreign_keys = ON;").unwrap();
    conn.execute_batch(
        "INSERT INTO locations (id, bloc, etage, rangee, label) VALUES
             (1, 'A', '1', '1', 'Boissons'), (2, 'A', '1', '2', NULL), (3, 'A', '2', '1', NULL), (4, 'B', '', '', NULL);
         INSERT INTO products (id, name, sale_price, location_id) VALUES (1, 'Coca', 500, 3), (2, 'Riz', 900, 4), (3, 'Sel', 200, NULL);",
    )
    .unwrap();
    db::migrate_for_test(&conn).unwrap();
    let count = |sql: &str| -> i64 { conn.query_row(sql, [], |r| r.get(0)).unwrap() };
    assert_eq!(count("PRAGMA user_version"), 11);
    assert_eq!(count("SELECT COUNT(*) FROM pragma_foreign_key_check"), 0);
    assert_eq!(count("SELECT COUNT(*) FROM fixtures"), 2);
    // Bloc A : 2 étages × 2 cases (la case manquante de l'étage 2 est créée).
    assert_eq!(count("SELECT COUNT(*) FROM locations l JOIN fixtures f ON f.id = l.fixture_id WHERE f.code = 'A'"), 4);
    let coca = catalog::get_product(&conn, 1).unwrap();
    assert_eq!((coca.bloc.as_deref(), coca.etage.as_deref(), coca.rangee.as_deref()), (Some("A"), Some("2"), Some("1")));
    assert_eq!(coca.fixture_name.as_deref(), Some("Boissons"));
    let riz = catalog::get_product(&conn, 2).unwrap();
    assert_eq!(riz.fixture_name.as_deref(), Some("Rayon B"));
    assert_eq!(plan::product_places(&conn, 1).unwrap()[0].level, 2);
    assert_eq!(locations::list(&conn).unwrap().len(), 5);
}

#[test]
fn plan_3d_heights_models_and_layout_wizard() {
    fn rect(f: &plan::Fixture) -> (f64, f64, f64, f64) {
        let (w, h) = if f.rotation % 180 == 90 { (f.h, f.w) } else { (f.w, f.h) };
        let (cx, cy) = (f.x + f.w / 2.0, f.y + f.h / 2.0);
        (cx - w / 2.0, cy - h / 2.0, w, h)
    }
    let (mut conn, admin) = setup();
    let plan0 = plan::get(&conn).unwrap();
    let fridge = plan0.types.iter().find(|t| t.code == "refrigerateur").unwrap();
    assert_eq!((fridge.model.as_str(), fridge.height), ("refrigerateur", 2.0));
    assert_eq!(plan0.floors[0].wall_height, 3.0);
    // Hauteur propre d'un meuble, puis retour à celle du type.
    let fr = plan::create_fixture(&conn, None, plan::FixtureInput { type_id: Some(fridge.id), height: Some(1.6), ..Default::default() }).unwrap();
    assert_eq!((fr.height, fr.custom_height), (1.6, Some(1.6)));
    let fr = plan::update_fixture(&mut conn, &admin, fr.id, plan::FixtureInput { height: Some(0.0), ..Default::default() }).unwrap();
    assert_eq!((fr.height, fr.custom_height, fr.model.as_str()), (2.0, None, "refrigerateur"));
    // Meuble personnalisé : forme 3D au choix ; forme inconnue refusée.
    let custom = plan::save_type(&conn, &admin, None, plan::TypeInput {
        name: "Frigo Coca".into(), category: "froid".into(), prefix: "FC".into(), color: "#dc2626".into(),
        width: 0.6, depth: 0.6, levels: 4, sections: 1, model: Some("congelateur_armoire".into()), height: Some(1.9),
    }).unwrap();
    let t = plan::get(&conn).unwrap().types.into_iter().find(|t| t.id == custom).unwrap();
    assert_eq!((t.model.as_str(), t.height), ("congelateur_armoire", 1.9));
    assert!(plan::save_type(&conn, &admin, None, plan::TypeInput {
        name: "X".into(), category: "rayon".into(), prefix: "X".into(), color: "#000000".into(),
        width: 1.0, depth: 1.0, levels: 1, sections: 1, model: Some("soucoupe".into()), height: None,
    }).is_err());
    // Murs et sol d'un niveau.
    let first = plan0.floors[0].id;
    plan::save_floor(&conn, &admin, Some(first), plan::FloorInput {
        name: "RDC".into(), width: 20.0, depth: 12.0, wall_height: Some(3.5), floor_style: Some("wood".into()),
    }).unwrap();
    let f0 = plan::get(&conn).unwrap().floors.into_iter().find(|f| f.id == first).unwrap();
    assert_eq!((f0.wall_height, f0.floor_style.as_str()), (3.5, "wood"));
    assert!(plan::save_floor(&conn, &admin, Some(first), plan::FloorInput {
        name: "RDC".into(), width: 20.0, depth: 12.0, floor_style: Some("lave".into()), ..Default::default()
    }).is_err());

    // Assistant : boutique complète pour chaque côté d'entrée, sans débordement ni chevauchement.
    settings::set(&conn, "business_type", "supermarket").unwrap();
    for entry in ["bottom", "top", "left", "right"] {
        let input = plan::LayoutInput {
            floor_id: None, name: Some(format!("Test {entry}")), width: 14.0, depth: 10.0, entry: entry.into(),
            storage_room: true, business_type: None, ..Default::default()
        };
        let floor_id = plan::generate_layout(&mut conn, &admin, input).unwrap();
        let p = plan::get(&conn).unwrap();
        let floor = p.floors.iter().find(|f| f.id == floor_id).unwrap();
        assert_eq!((floor.width, floor.depth), (16.0, 12.0));
        let items: Vec<&plan::Fixture> = p.fixtures.iter().filter(|f| f.floor_id == floor_id).collect();
        let n = |code: &str| items.iter().filter(|f| f.type_code == code).count();
        assert_eq!(n("caisse"), 1, "{entry}");
        assert!(n("porte") >= 2 && n("gondole") >= 2 && n("refrigerateur") >= 2 && n("mur") >= 5, "{entry}");
        for f in &items {
            let r = rect(f);
            assert!(
                r.0 >= -0.01 && r.1 >= -0.01 && r.0 + r.2 <= floor.width + 0.01 && r.1 + r.3 <= floor.depth + 0.01,
                "{entry} : {} déborde",
                f.code
            );
        }
        let storage: Vec<&plan::Fixture> = items.iter().copied().filter(|f| f.storage).collect();
        for (i, a) in storage.iter().enumerate() {
            for b in &storage[i + 1..] {
                let (ra, rb) = (rect(a), rect(b));
                let clash = ra.0 + 0.02 < rb.0 + rb.2 && rb.0 + 0.02 < ra.0 + ra.2 && ra.1 + 0.02 < rb.1 + rb.3 && rb.1 + 0.02 < ra.1 + ra.3;
                assert!(!clash, "{entry} : {} chevauche {}", a.code, b.code);
            }
        }
    }
    // Petite boutique de quartier ; salle trop petite refusée.
    let small = plan::generate_layout(&mut conn, &admin, plan::LayoutInput {
        floor_id: None, name: None, width: 4.0, depth: 5.0, entry: "bottom".into(), storage_room: true,
        business_type: Some("boutique".into()), ..Default::default()
    }).unwrap();
    let p = plan::get(&conn).unwrap();
    assert!(p.fixtures.iter().any(|f| f.floor_id == small && f.type_code == "caisse"));
    assert!(plan::generate_layout(&mut conn, &admin, plan::LayoutInput {
        floor_id: None, name: None, width: 1.0, depth: 5.0, entry: "bottom".into(), storage_room: false, business_type: None, ..Default::default()
    }).is_err());

    // Contenu des cases pour la vue 3D ; un niveau garni ne se redessine pas.
    let gondola = p.fixtures.iter().find(|f| f.type_code == "gondole").unwrap();
    let slot = plan::contents(&conn, gondola.id).unwrap().slots[0].id;
    let prod = product(&mut conn, &admin, "Lait UHT", 500, 700, 10.0);
    plan::put(&mut conn, &admin, plan::PutInput { product_id: prod, location_id: slot, from_location_id: None, primary: None }).unwrap();
    let fill = plan::floor_fill(&conn, gondola.floor_id).unwrap();
    assert_eq!(fill.len(), 1);
    assert_eq!((fill[0].fixture_id, fill[0].level, fill[0].section, fill[0].products), (gondola.id, 1, 1, 1));
    let again = plan::LayoutInput {
        floor_id: Some(gondola.floor_id), name: None, width: 10.0, depth: 8.0, entry: "bottom".into(), storage_room: false,
        business_type: None, ..Default::default()
    };
    assert!(plan::generate_layout(&mut conn, &admin, again).is_err());
}

#[test]
fn default_team_staff_management_and_deletion() {
    use crate::state::{AppState, Origin};
    use serde_json::json;
    // Équipe par défaut : administrateur, gestionnaire et caissière, avec leur PIN.
    let mut conn = db::open_in_memory().unwrap();
    let input = |pin: &str| auth::SetupInput {
        shop_name: "Boutique".into(), shop_phone: None, shop_address: None, currency_symbol: "FCFA".into(), currency_decimals: 0,
        full_name: "Awa Traoré".into(), username: None, pin: pin.into(), team: None, lang: None, country: None,
        currency_code: None, currency_position: None,
    };
    assert!(auth::initial_setup(&mut conn, input("4826")).unwrap_err().to_string().contains("6 chiffres"));
    let setup = auth::initial_setup(&mut conn, input(ADMIN_PIN)).unwrap();
    let team: Vec<(String, String)> = setup.team.iter().map(|m| (m.role.clone(), m.username.clone())).collect();
    assert_eq!(team, vec![("manager".into(), "gestionnaire".into()), ("cashier".into(), "caisse1".into())]);
    let all = users::list(&conn).unwrap();
    assert_eq!(all.len(), 3);
    assert!(all.iter().all(|u| u.has_pin));
    assert_eq!(all.iter().filter(|u| u.internet_access).count(), 1, "Internet : l'administrateur seulement, au départ");
    let caisse1 = auth::account_by_username(&conn, "caisse1").unwrap().unwrap();
    assert!(auth::check_pin(&conn, &caisse1, &setup.team[1].pin).unwrap().is_some());
    // Postes suivants proposés par le logiciel.
    assert_eq!(users::next_username(&conn, "cashier").unwrap(), "caisse2");
    assert_eq!(users::next_username(&conn, "manager").unwrap(), "gestionnaire2");
    let admin = setup.user;
    assert!(users::create(&conn, &admin, users::UserInput {
        username: Some("caisse2".into()), full_name: "Caissière 2".into(), role: "cashier".into(), ..Default::default()
    }).is_err(), "PIN obligatoire");
    let c2 = users::create(&conn, &admin, users::UserInput {
        username: Some("caisse2".into()), full_name: "Caissière 2".into(), role: "cashier".into(), pin: Some("5173".into()), ..Default::default()
    }).unwrap();
    assert!(users::create(&conn, &admin, users::UserInput {
        username: Some("CAISSE2".into()), full_name: "X".into(), role: "cashier".into(), pin: Some("5173".into()), ..Default::default()
    }).is_err(), "identifiant déjà pris");
    // Devenir administrateur : nouveau PIN de 6 chiffres exigé.
    assert!(users::update(&conn, &admin, c2, users::UserInput { full_name: "Caissière 2".into(), role: "admin".into(), ..Default::default() }).is_err());
    // Nouveau PIN donné par l'administrateur.
    users::reset_pin(&conn, &admin, c2, "6284").unwrap();
    assert!(users::reset_pin(&conn, &admin, admin.id, "6284").is_err(), "administrateur : 6 chiffres");
    let a2 = auth::account_by_id(&conn, c2).unwrap().unwrap();
    assert!(auth::check_pin(&conn, &a2, "6284").unwrap().is_some());

    let state = AppState::new(conn, std::path::PathBuf::from(":memory:"));
    let rpc = |o: &Origin, cmd: &str, a: serde_json::Value| crate::rpc::dispatch(&state, o, cmd, a);
    let anon = Origin::Remote(None);
    let boss = Origin::Local;
    rpc(&boss, "login", json!({"username": "admin", "pin": ADMIN_PIN})).unwrap();
    let sugg = rpc(&boss, "suggest_staff", json!({"role": "cashier"})).unwrap();
    assert_eq!(sugg["username"], "caisse3");
    assert_eq!(sugg["pin"].as_str().unwrap().len(), 4);
    // Blocage : la session de la personne est fermée et elle ne peut plus se connecter.
    let t = rpc(&anon, "login", json!({"username": "caisse2", "pin": "6284"})).unwrap()["token"].as_str().unwrap().to_string();
    let c2o = Origin::Remote(Some(t));
    assert!(rpc(&c2o, "list_products", json!({})).is_ok());
    rpc(&boss, "save_user", json!({"id": c2, "input": {"full_name": "Caissière 2", "role": "cashier", "active": false}, "pin": ADMIN_PIN})).unwrap();
    assert!(rpc(&c2o, "list_products", json!({})).is_err());
    assert!(rpc(&anon, "login", json!({"username": "caisse2", "pin": "6284"})).unwrap_err().to_string().contains("bloqué"));
    // Suppression : compte qui a travaillé (connexions au journal) → gardé pour l'historique, identifiant libéré.
    let r = rpc(&boss, "delete_user", json!({"id": c2, "pin": ADMIN_PIN})).unwrap();
    assert_eq!(r["erased"], false);
    assert!(rpc(&anon, "login", json!({"username": "caisse2", "pin": "6284"})).is_err());
    assert_eq!(rpc(&boss, "list_users", json!({})).unwrap().as_array().unwrap().len(), 3);
    let c3 = rpc(&boss, "save_user", json!({"input": {"username": "caisse2", "full_name": "Nouvelle", "role": "cashier", "pin": "7395"}, "pin": ADMIN_PIN}));
    assert!(c3.is_ok(), "identifiant réutilisable : {c3:?}");
    // Compte jamais utilisé → effacé.
    let id = state.conn().query_row("SELECT id FROM users WHERE username = 'caisse2'", [], |r| r.get::<_, i64>(0)).unwrap();
    assert_eq!(rpc(&boss, "delete_user", json!({"id": id, "pin": ADMIN_PIN})).unwrap()["erased"], true);
    // Le dernier administrateur ne peut être ni supprimé ni bloqué.
    assert!(rpc(&boss, "delete_user", json!({"id": admin.id, "pin": ADMIN_PIN})).is_err());
    // Actions d'une personne (journal filtré).
    let log = rpc(&boss, "list_audit_log", json!({"filter": {"user_id": c2}})).unwrap();
    assert!(log.as_array().unwrap().iter().all(|e| e["username"] == "caisse2"));
    assert!(!log.as_array().unwrap().is_empty());
}

#[test]
fn internet_phones_access_codes_and_admin_pin_reset() {
    use crate::state::{AppState, Origin};
    use serde_json::json;
    let (conn, admin) = setup();
    let fatou = users::create(&conn, &admin, users::UserInput {
        username: Some("fatou".into()), full_name: "Fatou".into(), role: "cashier".into(), pin: Some("4826".into()), ..Default::default()
    }).unwrap();
    users::create(&conn, &admin, users::UserInput {
        username: Some("moussa".into()), full_name: "Moussa".into(), role: "manager".into(), pin: Some("7395".into()), ..Default::default()
    }).unwrap();
    let state = AppState::new(conn, std::path::PathBuf::from(":memory:"));
    let rpc = |o: &Origin, cmd: &str, a: serde_json::Value| crate::rpc::dispatch(&state, o, cmd, a);
    let anon = Origin::Remote(None);
    let net = |mut a: serde_json::Value| {
        a["__route"] = json!("internet");
        a["__ip"] = json!("41.73.10.40");
        a
    };
    // Sans téléphone autorisé : refus, même avec le bon PIN.
    assert!(rpc(&anon, "login", net(json!({"username": "fatou", "pin": "4826"}))).unwrap_err().to_string().contains("pas encore autorisé"));
    let info = rpc(&anon, "login_info", net(json!({}))).unwrap();
    assert_eq!((info["internet"].as_bool(), info["device"].is_null()), (Some(true), true));

    // L'administrateur génère un code d'accès (8 lettres et chiffres) pour Fatou.
    let boss = Origin::Local;
    rpc(&boss, "login", json!({"username": "admin", "pin": ADMIN_PIN})).unwrap();
    assert!(rpc(&boss, "create_access_code", json!({"user_id": fatou})).is_err(), "PIN administrateur exigé");
    let code = rpc(&boss, "create_access_code", json!({"user_id": fatou, "pin": ADMIN_PIN})).unwrap();
    let code = code["code"].as_str().unwrap().to_string();
    assert_eq!(code.len(), 8);
    let fatou_row = rpc(&boss, "list_users", json!({})).unwrap();
    let fr = fatou_row.as_array().unwrap().iter().find(|u| u["username"] == "fatou").unwrap().clone();
    assert_eq!(fr["internet_access"], true, "le code autorise l'accès Internet");
    // Code faux, puis bon code (tapé en minuscules avec un tiret) : le téléphone est autorisé et connecté.
    let authz = |code: &str, pin: &str| rpc(&anon, "authorize_device_code", net(json!({"username": "fatou", "pin": pin, "code": code, "label": "Tecno de Fatou"})));
    assert!(authz("ABCDEFGH", "4826").unwrap_err().to_string().contains("Code d'accès"));
    assert!(authz(&code, "9157").is_err());
    let typed = format!("{}-{}", &code[..4], &code[4..]).to_lowercase();
    let r = authz(&typed, "4826").unwrap();
    let device = r["device"].as_str().unwrap().to_string();
    assert_eq!(r["user"]["username"], "fatou");
    assert!(authz(&code, "4826").is_err(), "un code ne sert qu'une fois");
    // Ensuite : identifiant + PIN suffisent sur ce téléphone, pour Fatou seulement.
    let info = rpc(&anon, "login_info", net(json!({"device": device}))).unwrap();
    assert_eq!(info["device"]["user_name"], "Fatou");
    let t = rpc(&anon, "login", net(json!({"username": "fatou", "pin": "4826", "device": device}))).unwrap()["token"].as_str().unwrap().to_string();
    let phone = Origin::Remote(Some(t));
    assert!(rpc(&phone, "list_products", json!({})).is_ok());
    assert!(rpc(&anon, "login", net(json!({"username": "moussa", "pin": "7395", "device": device}))).unwrap_err().to_string().contains("autre personne"));
    // L'administrateur retire le téléphone : la session se ferme, la connexion est refusée.
    let devices = rpc(&boss, "list_devices", json!({})).unwrap();
    assert_eq!(devices.as_array().unwrap().len(), 1);
    assert_eq!(devices[0]["label"], "Tecno de Fatou");
    rpc(&boss, "revoke_device", json!({"id": devices[0]["id"]})).unwrap();
    assert!(rpc(&phone, "list_products", json!({})).is_err());
    assert!(rpc(&anon, "login", net(json!({"username": "fatou", "pin": "4826", "device": device}))).is_err());

    // Téléphone autorisé par le compte boutique : tout le personnel qui a l'accès Internet.
    let (_, owner_device) = devices::register(&state.conn(), None, "account", "Téléphone de la patronne").unwrap();
    assert!(rpc(&anon, "login", net(json!({"username": "admin", "pin": ADMIN_PIN, "device": owner_device}))).is_ok());
    let refused = rpc(&anon, "login", net(json!({"username": "moussa", "pin": "7395", "device": owner_device}))).unwrap_err();
    assert!(refused.to_string().contains("pas autorisé pour ce compte"), "{refused}");
    // Au magasin (réseau local), pas besoin de téléphone autorisé.
    assert!(rpc(&anon, "login", json!({"username": "moussa", "pin": "7395"})).is_ok());

    // PIN administrateur oublié : refait après vérification du compte boutique (6 chiffres, compte débloqué).
    let conn = state.conn();
    assert!(auth::reset_admin_pin(&conn, None, "4826").is_err());
    assert!(auth::reset_admin_pin(&conn, Some("fatou"), "618273").is_err(), "seulement un administrateur");
    let r = auth::reset_admin_pin(&conn, None, "618273").unwrap();
    assert_eq!(r.username, "admin");
    let a = auth::account_by_username(&conn, "admin").unwrap().unwrap();
    assert!(auth::check_pin(&conn, &a, "618273").unwrap().is_some());
}

#[test]
fn migration_to_pin_only_staff() {
    let conn = Connection::open_in_memory().unwrap();
    for i in 0..8 {
        conn.execute_batch(db::migration_sql(i)).unwrap();
    }
    conn.execute_batch("PRAGMA user_version = 8; PRAGMA foreign_keys = ON;").unwrap();
    let pin = auth::hash_password("4826").unwrap();
    let pwd = auth::hash_password("secret123").unwrap();
    conn.execute(
        "INSERT INTO users (id, username, full_name, password_hash, pin_hash, role) VALUES
             (1, 'admin', 'Admin', ?2, NULL, 'admin'), (2, 'awa', 'Awa', ?2, ?1, 'cashier'), (3, 'issa', 'Issa', ?2, NULL, 'manager')",
        rusqlite::params![pin, pwd],
    )
    .unwrap();
    db::migrate_for_test(&conn).unwrap();
    let count = |sql: &str| -> i64 { conn.query_row(sql, [], |r| r.get(0)).unwrap() };
    assert_eq!(count("PRAGMA user_version"), 11);
    // Plus de mot de passe, sauf pour l'administrateur qui n'a pas encore de PIN.
    assert_eq!(count("SELECT COUNT(*) FROM users WHERE password_hash <> ''"), 1);
    assert_eq!(count("SELECT internet_access FROM users WHERE id = 1"), 1);
    assert_eq!(count("SELECT internet_access FROM users WHERE id = 2"), 0);
    let awa = auth::account_by_username(&conn, "awa").unwrap().unwrap();
    assert!(auth::check_pin(&conn, &awa, "4826").unwrap().is_some());
    let issa = auth::account_by_username(&conn, "issa").unwrap().unwrap();
    assert!(auth::check_pin(&conn, &issa, "4826").unwrap_err().to_string().contains("l'administrateur doit"));
    // L'administrateur sans PIN : ancien mot de passe une dernière fois, puis création de son PIN (6 chiffres).
    let admin = auth::login_password(&conn, "admin", "secret123").unwrap();
    assert!(auth::set_own_pin(&conn, &admin, "secret123", "4826").is_err());
    auth::set_own_pin(&conn, &admin, "secret123", "604813").unwrap();
    assert!(auth::login_password(&conn, "admin", "secret123").is_err());
    let users = auth::login_users(&conn).unwrap();
    assert!(users.iter().all(|u| !u.legacy_password));
}

#[test]
fn several_activities_and_layout_preview() {
    use crate::state::{AppState, Origin};
    use serde_json::json;
    let (conn, admin) = setup();
    let state = AppState::new(conn, std::path::PathBuf::from(":memory:"));
    let rpc = |cmd: &str, a: serde_json::Value| crate::rpc::dispatch(&state, &Origin::Local, cmd, a);
    rpc("login", json!({"username": "admin", "pin": ADMIN_PIN})).unwrap();
    // Premier choix sans PIN ; supérette + quincaillerie : fonctions et catégories réunies.
    let r = rpc("set_business_type", json!({"ids": ["superette", "hardware"], "seed": true})).unwrap();
    assert_eq!(r["settings"]["business_type"], "superette");
    assert_eq!(r["settings"]["business_types"], "superette,hardware");
    let features = r["settings"]["enabled_features"].as_str().unwrap().to_string();
    assert!(features.contains("expiry") && features.contains("sku"), "{features}");
    // Changer ensuite demande le PIN ; plus de 3 activités refusé.
    assert!(rpc("set_business_type", json!({"ids": ["bar"]})).is_err());
    assert!(rpc("set_business_type", json!({"ids": ["bar", "restaurant", "kiosk", "phones"], "pin": ADMIN_PIN})).is_err());

    // Aperçu : rien n'est enregistré ; rayons nommés ; hauteur sous plafond respectée.
    let floors = plan::get(&state.conn()).unwrap().floors.len();
    let preview = rpc("plan_preview_layout", json!({"input": {"width": 12.0, "depth": 9.0, "height": 2.6, "entry": "bottom", "storage_room": true}})).unwrap();
    assert_eq!(plan::get(&state.conn()).unwrap().floors.len(), floors);
    assert_eq!(preview["floor"]["wall_height"], 2.6);
    let fx = preview["fixtures"].as_array().unwrap();
    let names: Vec<&str> = fx.iter().filter(|f| f["type_code"] == "zone_vente").map(|f| f["name"].as_str().unwrap()).collect();
    assert_eq!(names, vec!["Alimentation", "Quincaillerie"]);
    assert!(fx.iter().all(|f| f["type_code"] == "zone_vente" || f["type_code"] == "zone_reserve" || f["height"].as_f64().unwrap() <= 2.6 + 1e-9));
    assert!(fx.iter().any(|f| f["type_code"] == "gondole") && fx.iter().any(|f| f["type_code"] == "rack"));
    // Garder ce plan : même proposition, enregistrée, avec la hauteur des murs.
    let floor_id = rpc("plan_generate_layout", json!({"input": {"name": "Rez-de-chaussée", "width": 12.0, "depth": 9.0, "height": 2.6, "entry": "bottom", "storage_room": true}})).unwrap();
    let p = plan::get(&state.conn()).unwrap();
    let floor = p.floors.iter().find(|f| Some(f.id) == floor_id.as_i64()).unwrap();
    assert_eq!((floor.name.as_str(), floor.wall_height, floor.width, floor.depth), ("Rez-de-chaussée", 2.6, 14.0, 11.0));
    let saved = p.fixtures.iter().filter(|f| f.floor_id == floor.id).count();
    assert_eq!(saved, fx.len());
    let rack_heights: Vec<f64> = p.fixtures.iter().filter(|f| f.floor_id == floor.id && f.type_code == "rack").map(|f| f.height).collect();
    assert!(!rack_heights.is_empty() && rack_heights.iter().all(|h| (*h - 2.5).abs() < 1e-9), "{rack_heights:?}");
    // Étage : escalier, ni porte d'entrée ni caisse.
    let up = rpc("plan_preview_layout", json!({"input": {"width": 8.0, "depth": 6.0, "entry": "left", "upstairs": true, "activities": ["fashion"]}})).unwrap();
    let up = up["fixtures"].as_array().unwrap();
    assert!(up.iter().any(|f| f["type_code"] == "escalier") && !up.iter().any(|f| f["type_code"] == "caisse"));

    // Dessin du bâtiment en fond : posé, puis retiré (l'image est supprimée).
    let media = rpc("upload_image", json!({"mime": "image/png", "data": "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="})).unwrap();
    let fid = floor.id;
    assert!(rpc("plan_set_backdrop", json!({"input": {"floor_id": fid, "media_id": media, "x": 1.0, "y": 1.0, "w": 0.1, "h": 8.0}})).is_err());
    rpc("plan_set_backdrop", json!({"input": {"floor_id": fid, "media_id": media, "x": 1.0, "y": 1.0, "w": 12.0, "h": 9.0, "opacity": 0.5}})).unwrap();
    let f = plan::get(&state.conn()).unwrap().floors.into_iter().find(|f| f.id == fid).unwrap();
    assert_eq!(f.backdrop_id, media.as_i64());
    assert_eq!(f.backdrop.unwrap()["w"], 12.0);
    rpc("plan_set_backdrop", json!({"input": {"floor_id": fid, "media_id": null}})).unwrap();
    let left: i64 = state.conn().query_row("SELECT COUNT(*) FROM media", [], |r| r.get(0)).unwrap();
    assert_eq!(left, 0);
    let _ = admin;
}

// ───────────────────────────── 0.15 : prix de gros, promotions, retours, avoirs, rapports Z ─────────────────────────────

fn customer(conn: &Connection, user: &SessionUser, name: &str, wholesale: bool) -> partners::Customer {
    partners::save_customer(
        conn,
        user,
        None,
        partners::CustomerInput {
            name: name.into(),
            phone: None,
            email: None,
            address: None,
            notes: None,
            credit_limit: None,
            wholesale: Some(wholesale),
        },
    )
    .unwrap()
}

fn promotion(name: &str, kind: &str, value: i64, product_id: Option<i64>, category_id: Option<i64>, from: &str, to: &str) -> promotions::PromotionInput {
    promotions::PromotionInput {
        id: None,
        name: name.into(),
        kind: kind.into(),
        value,
        product_id,
        category_id,
        starts_on: from.into(),
        ends_on: to.into(),
        active: None,
    }
}

#[test]
fn wholesale_prices_promotions_and_quotes() {
    let (mut conn, admin) = setup();
    let caisse = cashier(&conn, &admin);
    let riz = product(&mut conn, &admin, "Riz 25kg", 9000, 12_000, 100.0);
    conn.execute("UPDATE products SET wholesale_price = 11000, wholesale_min_qty = 5 WHERE id = ?1", [riz]).unwrap();
    let today = chrono::Local::now().format("%Y-%m-%d").to_string();
    let quote = |conn: &Connection, qty: f64, customer: Option<i64>| {
        sales::quote(conn, &[sales::QuoteItem { product_id: riz, quantity: qty, packaging_id: None }], customer).unwrap().remove(0).price
    };

    // Prix de gros à partir de 5 sacs ; tout de suite pour un client grossiste.
    assert_eq!((quote(&conn, 4.0, None).unit_price, quote(&conn, 4.0, None).kind), (12_000, "retail"));
    assert_eq!((quote(&conn, 5.0, None).unit_price, quote(&conn, 5.0, None).kind), (11_000, "wholesale"));
    let grossiste = customer(&conn, &admin, "Grossiste Diallo", true);
    assert!(grossiste.wholesale);
    assert_eq!(quote(&conn, 1.0, Some(grossiste.id)).kind, "wholesale");
    // Une caissière ne peut pas faire d'un client un grossiste.
    assert!(!customer(&conn, &caisse, "Client", true).wholesale);
    // Prix de gros supérieur au prix normal : refusé.
    let p = catalog::get_product(&conn, riz).unwrap();
    let bad = catalog::ProductInput {
        barcode: p.barcode.clone(), name: p.name.clone(), description: None, category_id: None, supplier_id: None, unit: None,
        purchase_price: 9000, sale_price: 12_000, tax_rate: None, min_stock: None, track_stock: Some(true), active: Some(true),
        image_id: None, location_id: None, expiry_date: None, initial_stock: None, brand: None, sku: None, packagings: None,
        wholesale_price: Some(13_000), wholesale_min_qty: Some(5.0),
    };
    assert!(catalog::save_product(&mut conn, &admin, Some(riz), bad).is_err());

    // Promotion de catégorie -20 % (catégorie parente) : 9 600, plus bas que le prix de gros.
    let cereales = templates::find_or_create(&conn, "Céréales", None, "#a16207", 0).unwrap().0;
    let riz_cat = templates::find_or_create(&conn, "Riz", Some(cereales), "#a16207", 0).unwrap().0;
    conn.execute("UPDATE products SET category_id = ?1 WHERE id = ?2", [riz_cat, riz]).unwrap();
    let promo = promotions::save(&conn, &admin, promotion("Fin d'année", "percent", 20, None, Some(cereales), &today, &today)).unwrap();
    assert_eq!(promo.state, "current");
    let p = quote(&conn, 5.0, None);
    assert_eq!((p.unit_price, p.kind, p.regular_price), (9600, "promo", 12_000));
    assert_eq!(p.promotion_name.as_deref(), Some("Fin d'année"));
    // Prix promo : sur un article seulement, et inférieur au prix normal.
    assert!(promotions::save(&conn, &admin, promotion("X", "price", 12_000, Some(riz), None, &today, &today)).is_err());
    assert!(promotions::save(&conn, &admin, promotion("X", "price", 9000, None, Some(cereales), &today, &today)).is_err());
    assert!(promotions::save(&conn, &admin, promotion("X", "percent", 95, Some(riz), None, &today, &today)).is_err());
    // Promotion à venir : sans effet aujourd'hui.
    let later = promotions::save(&conn, &admin, promotion("Plus tard", "price", 5000, Some(riz), None, "2999-01-01", "2999-01-31")).unwrap();
    assert_eq!(later.state, "upcoming");
    assert_eq!(quote(&conn, 1.0, None).unit_price, 9600);

    // La vente enregistre le prix appliqué et le prix normal.
    cash::open(&conn, &caisse, 0).unwrap();
    let sale = sales::create_sale(&mut conn, &caisse, sale_input(vec![(riz, 2.0)], "cash", 20_000, None)).unwrap();
    assert_eq!(sale.total, 19_200);
    assert_eq!((sale.items[0].price_kind.as_str(), sale.items[0].regular_price), ("promo", Some(12_000)));
    // Promotion supprimée : prix normal.
    promotions::delete(&conn, &admin, promo.id).unwrap();
    assert_eq!(quote(&conn, 2.0, None).kind, "retail");
}

#[test]
fn returns_credit_notes_and_z_reports() {
    let (mut conn, admin) = setup();
    let caisse = cashier(&conn, &admin);
    let manager_id = users::create(&conn, &admin, users::UserInput {
        username: Some("gerant".into()), full_name: "Gérant".into(), role: "manager".into(), active: Some(true), pin: Some("7391".into()), internet_access: None,
    }).unwrap();
    let gerant = SessionUser { id: manager_id, username: "gerant".into(), full_name: "Gérant".into(), role: "manager".into(), has_pin: true, lang: None };
    let riz = product(&mut conn, &admin, "Riz 5kg", 3000, 3500, 10.0);
    let huile = product(&mut conn, &admin, "Huile 1L", 900, 1200, 5.0);
    let session = cash::open(&conn, &caisse, 10_000).unwrap();
    let sale = sales::create_sale(&mut conn, &caisse, sale_input(vec![(riz, 2.0), (huile, 2.0)], "cash", 10_000, None)).unwrap();
    assert_eq!(sale.total, 9400);
    let item = |name: &str| sale.items.iter().find(|i| i.product_name.starts_with(name)).unwrap().id;
    let ret = |items: Vec<(i64, f64, bool)>, method: &str| returns::ReturnInput {
        sale_id: sale.id,
        items: items.into_iter().map(|(sale_item_id, quantity, restock)| returns::ReturnItemInput { sale_item_id, quantity, restock }).collect(),
        refund_method: method.into(),
        refund_reference: None,
        reason: "Client mécontent".into(),
    };

    // Seule une caissière rend (caisse ouverte).
    assert!(returns::create_return(&mut conn, &gerant, &gerant, ret(vec![(item("Riz"), 1.0, true)], "cash")).is_err());
    // Espèces : 1 riz remis en rayon, 1 huile abîmée (pas remise en stock).
    let r = returns::create_return(&mut conn, &caisse, &gerant, ret(vec![(item("Riz"), 1.0, true), (item("Huile"), 1.0, false)], "cash")).unwrap();
    assert_eq!(r.total, 4700);
    assert!(r.number.starts_with('R'));
    assert_eq!(r.approved_by_name.as_deref(), Some("Gérant"));
    assert_eq!(stock_of(&conn, riz), 9.0);
    assert_eq!(stock_of(&conn, huile), 3.0);
    let s = cash::current_session(&conn, &caisse).unwrap().unwrap();
    assert_eq!((s.returns_count, s.refunds_cash, s.expected_now), (1, 4700, 10_000 + 9400 - 4700));
    // Pas plus que ce qui reste ; une vente avec retour ne s'annule plus.
    assert!(returns::create_return(&mut conn, &caisse, &gerant, ret(vec![(item("Riz"), 2.0, true)], "cash")).is_err());
    assert!(sales::cancel_sale(&mut conn, &admin, sale.id, "test").is_err());
    let again = sales::get_sale(&conn, sale.id).unwrap();
    assert_eq!(again.returned_total, 4700);
    assert_eq!(again.items.iter().map(|i| i.returned_quantity).sum::<f64>(), 2.0);

    // Avoir : créé par un retour, utilisé en partie, recrédité si la vente est annulée.
    let r2 = returns::create_return(&mut conn, &caisse, &gerant, ret(vec![(item("Riz"), 1.0, true)], "credit_note")).unwrap();
    let note = r2.credit_note.expect("avoir créé");
    assert_eq!((note.amount, note.balance, note.status.as_str()), (3500, 3500, "active"));
    assert!(note.code.starts_with(&note.number) && note.code.len() == note.number.len() + 5);
    assert!(sales::credit_note_by_code(&conn, &note.number).is_err(), "le numéro seul ne suffit pas");
    let pay = |method: &str, amount: i64, reference: &str| sales::PaymentInput { method: method.into(), amount, reference: Some(reference.into()), phone: None };
    let mut input = sale_input(vec![(huile, 1.0)], "cash", 0, None);
    input.payments = vec![pay("credit_note", 1200, &note.code.to_lowercase())];
    let s2 = sales::create_sale(&mut conn, &caisse, input).unwrap();
    assert_eq!(s2.payments[0].method, "credit_note");
    assert_eq!(sales::credit_note_by_code(&conn, &note.code).unwrap().balance, 2300);
    let mut input = sale_input(vec![(riz, 1.0)], "cash", 0, None);
    input.payments = vec![pay("credit_note", 3500, &note.code)];
    assert!(sales::create_sale(&mut conn, &caisse, input).is_err(), "plus que le reste de l'avoir");
    sales::cancel_sale(&mut conn, &admin, s2.id, "erreur").unwrap();
    assert_eq!(sales::credit_note_by_code(&conn, &note.code).unwrap().balance, 3500);
    conn.execute("UPDATE credit_notes SET expires_on = '2000-01-01' WHERE id = ?1", [note.id]).unwrap();
    let mut input = sale_input(vec![(huile, 1.0)], "cash", 0, None);
    input.payments = vec![pay("credit_note", 1200, &note.code)];
    assert!(sales::create_sale(&mut conn, &caisse, input).unwrap_err().to_string().contains("expiré"));

    // Délai de retour dépassé (7 jours par défaut).
    conn.execute("UPDATE sales SET created_at = '2000-01-01 10:00:00' WHERE id = ?1", [sale.id]).unwrap();
    let late = returns::create_return(&mut conn, &caisse, &gerant, ret(vec![(item("Huile"), 1.0, true)], "cash")).unwrap_err();
    assert!(late.to_string().contains("jours"));

    // Rapport X, puis Z à la clôture : numéroté, chaîné, non modifiable.
    let x = zreport::build(&conn, session.id).unwrap();
    assert_eq!(x["returns"]["count"], 2);
    assert_eq!(x["returns"]["damaged"], 1200);
    assert_eq!(x["sales"]["cancelled_count"], 1);
    let expected = x["cash"]["expected"].as_i64().unwrap();
    let closed = cash::close(&conn, &caisse, cash::CloseInput { counted_amount: expected, note: None }).unwrap();
    assert_eq!(closed.z_number, Some(1));
    cash::open(&conn, &caisse, 5000).unwrap();
    sales::create_sale(&mut conn, &caisse, sale_input(vec![(huile, 1.0)], "cash", 1200, None)).unwrap();
    let closed = cash::close(&conn, &caisse, cash::CloseInput { counted_amount: 6200, note: None }).unwrap();
    assert_eq!(closed.z_number, Some(2));
    let list = zreport::list(&conn, &zreport::ZFilter::default()).unwrap();
    assert_eq!(list.iter().map(|z| z.number).collect::<Vec<_>>(), vec![2, 1]);
    assert!(list.iter().all(|z| z.intact));
    assert_eq!(list[1].data["net_total"], 9400 - 8200);
    assert_eq!(list[0].data["cash"]["difference"], 0);
    assert!(conn.execute("UPDATE z_reports SET data = '{}' WHERE number = 1", []).is_err());
    assert!(conn.execute("DELETE FROM z_reports", []).is_err());
}

#[test]
fn discounts_need_validation_and_sales_are_not_duplicated() {
    let (mut conn, admin) = setup();
    let p = product(&mut conn, &admin, "Riz 5 kg", 2000, 4000, 50.0);
    let caisse = cashier(&conn, &admin);
    let gerant_id = users::create(&conn, &admin, users::UserInput {
        username: Some("gerant".into()), full_name: "Gérant Test".into(), role: "manager".into(), active: Some(true), pin: Some("5937".into()), internet_access: None,
    }).unwrap();
    let gerant = SessionUser { id: gerant_id, username: "gerant".into(), full_name: "Gérant Test".into(), role: "manager".into(), has_pin: true, lang: None };
    cash::open(&conn, &caisse, 0).unwrap();
    let today = chrono::Local::now().format("%Y-%m-%d").to_string();
    let with_line_discount = |d: i64| {
        let mut input = sale_input(vec![(p, 2.0)], "cash", 8000, None);
        input.items[0].discount = Some(d);
        input
    };

    // 2 × 4 000 = 8 000 : remise de 400 (5 %) sans validation.
    let mut input = sale_input(vec![(p, 2.0)], "cash", 8000, None);
    input.discount = Some(400);
    assert_eq!(sales::create_sale(&mut conn, &caisse, input).unwrap().total, 7600);
    // 10 % : refusée sans validation, même envoyée directement au serveur (sans passer par l'écran).
    let err = sales::create_sale(&mut conn, &caisse, with_line_discount(800)).unwrap_err().to_string();
    assert!(err.contains("10 %") && err.contains("gestionnaire"), "{err}");
    // Ligne et ticket cumulés : 300 + 300 = 7,5 % → refusée aussi.
    let mut input = with_line_discount(300);
    input.discount = Some(300);
    assert!(sales::create_sale(&mut conn, &caisse, input).unwrap_err().to_string().contains("7,5 %"));
    // Une caissière ne valide pas ; le gérant oui (son PIN est vérifié par rpc), et c'est tracé.
    assert!(sales::create_sale_with(&mut conn, &caisse, with_line_discount(800), Some(&caisse)).is_err());
    let s = sales::create_sale_with(&mut conn, &caisse, with_line_discount(800), Some(&gerant)).unwrap();
    assert_eq!(s.total, 7200);
    let approved: Option<i64> = conn.query_row("SELECT discount_approved_by FROM sales WHERE id = ?1", [s.id], |r| r.get(0)).unwrap();
    assert_eq!(approved, Some(gerant_id));
    let trace: String = conn
        .query_row("SELECT details FROM audit_log WHERE action = 'Remise' AND entity_id = ?1", [s.id], |r| r.get(0))
        .unwrap();
    assert!(trace.contains("10 %") && trace.contains("validée par Gérant Test"), "{trace}");
    // Seuil réglable : à 10 %, la même remise passe sans validation.
    settings::set(&conn, "discount_free_percent", "10").unwrap();
    sales::create_sale(&mut conn, &caisse, with_line_discount(800)).unwrap();

    // Même ticket envoyé deux fois (réseau coupé pendant l'encaissement) : une seule vente, stock décompté une fois.
    let mut input = sale_input(vec![(p, 1.0)], "cash", 4000, None);
    input.client_ref = Some("caisse1-k3x9".into());
    let first = sales::create_sale(&mut conn, &caisse, input).unwrap();
    let stock_after = stock_of(&conn, p);
    let mut again = sale_input(vec![(p, 1.0)], "cash", 4000, None);
    again.client_ref = Some("caisse1-k3x9".into());
    let second = sales::create_sale(&mut conn, &caisse, again).unwrap();
    assert_eq!((first.id, first.number.clone()), (second.id, second.number));
    assert_eq!(stock_of(&conn, p), stock_after);
    // Le numéro d'un autre ne rend pas sa vente.
    let mut other = sale_input(vec![(p, 1.0)], "cash", 4000, None);
    other.client_ref = Some("caisse1-k3x9".into());
    assert!(sales::create_sale(&mut conn, &gerant, other).unwrap_err().to_string().contains("autre vente"));

    // Rapport : remises par caissier (lignes + ticket), dont celles validées par un responsable.
    let r = reports::sales_report(&conn, &today, &today).unwrap();
    assert_eq!(r.discount_total, 2000);
    assert_eq!(r.discounts_by_user.len(), 1);
    let d = &r.discounts_by_user[0];
    assert_eq!((d.label.as_str(), d.count, d.amount, d.approved), ("Caissière Test", 3, 2000, 1));
}

#[test]
fn plan_refuses_overlaps_and_shows_stock_and_sales() {
    let (mut conn, admin) = setup();
    let floor = plan::save_floor(&conn, &admin, None, plan::FloorInput { name: "Salle test".into(), width: 10.0, depth: 6.0, wall_height: None, floor_style: None }).unwrap();
    let types = plan::get(&conn).unwrap().types;
    let ty = |code: &str| types.iter().find(|t| t.code == code).unwrap().id;
    let new = |conn: &Connection, code: &str, x: f64, y: f64| {
        plan::create_fixture(conn, Some(&admin), plan::FixtureInput { type_id: Some(ty(code)), floor_id: Some(floor), x: Some(x), y: Some(y), ..Default::default() }).unwrap()
    };
    let geo = |f: &plan::Fixture, x: f64, y: f64| plan::Geometry { id: f.id, x, y, w: f.w, h: f.h, rotation: f.rotation };
    let go1 = new(&conn, "gondole", 1.0, 1.0);
    let go2 = new(&conn, "gondole", 1.0, 3.0);
    let zone = new(&conn, "zone_vente", 0.0, 0.0);

    // Vue de dessus comme en 3D : chevauchement refusé, sortie du niveau refusée ; rien n'a bougé.
    let err = plan::move_fixtures(&mut conn, vec![geo(&go2, 1.5, 1.5)]).unwrap_err().to_string();
    assert!(err.contains(&format!("Place occupée par {}", go1.name)), "{err}");
    let err = plan::move_fixtures(&mut conn, vec![geo(&go2, 8.0, 3.0)]).unwrap_err().to_string();
    assert!(err.contains("sortirait du niveau « Salle test »"), "{err}");
    assert_eq!((plan::get_fixture(&conn, go2.id).unwrap().x, plan::get_fixture(&conn, go2.id).unwrap().y), (1.0, 3.0));
    // Une pièce se pose librement ; des meubles déplacés ensemble sont contrôlés à leurs nouvelles places.
    plan::move_fixtures(&mut conn, vec![geo(&zone, 0.5, 0.0)]).unwrap();
    plan::move_fixtures(&mut conn, vec![geo(&go1, 5.0, 3.0), geo(&go2, 5.0, 5.0)]).unwrap();
    // Plan dessiné avant la 0.17 : deux meubles qui se chevauchaient déjà peuvent encore bouger.
    conn.execute("UPDATE fixtures SET x = 5.5, y = 3.3 WHERE id = ?1", [go2.id]).unwrap();
    plan::move_fixtures(&mut conn, vec![geo(&go2, 5.6, 3.3)]).unwrap();
    // Une nouvelle taille passe par le même contrôle.
    let err = plan::update_fixture(&mut conn, &admin, go1.id, plan::FixtureInput { w: Some(6.0), ..Default::default() }).unwrap_err().to_string();
    assert!(err.contains("sortirait du niveau"), "{err}");
    plan::move_fixtures(&mut conn, vec![geo(&go2, 1.0, 1.0)]).unwrap();

    // Meuble posé sur un autre (dupliquer, palette) : il prend la place libre la plus proche.
    let dup = plan::create_fixture_free(&conn, Some(&admin), plan::FixtureInput { type_id: Some(ty("gondole")), floor_id: Some(floor), x: Some(1.2), y: Some(1.2), ..Default::default() }).unwrap();
    assert_eq!((dup.x, dup.y), (1.2, 1.9), "juste sous la gondole occupée");

    // État du stock : rupture, stock bas, péremption proche (le plus grave colore la case).
    let slots = plan::contents(&conn, go1.id).unwrap().slots;
    let out = product(&mut conn, &admin, "Lait en poudre", 900, 1200, 0.0);
    let low = product(&mut conn, &admin, "Sucre 1kg", 500, 700, 1.0);
    let ok = product(&mut conn, &admin, "Riz 5kg", 3000, 3500, 10.0);
    let exp = product(&mut conn, &admin, "Yaourt", 200, 300, 10.0);
    conn.execute("UPDATE products SET expiry_date = date('now', 'localtime', '+3 days') WHERE id = ?1", [exp]).unwrap();
    for (p, s) in [(out, 0), (low, 0), (ok, 1), (exp, 2)] {
        plan::put(&mut conn, &admin, plan::PutInput { product_id: p, location_id: slots[s].id, from_location_id: None, primary: None }).unwrap();
    }
    let st = plan::floor_status(&conn, floor).unwrap();
    assert_eq!(st.alert_days, 30);
    let f = st.fixtures.iter().find(|f| f.fixture_id == go1.id).unwrap();
    assert_eq!((f.products, f.out_of_stock, f.low_stock, f.expiring, f.alerts), (4, 1, 1, 1, 3));
    let cell = |s: usize| st.cells.iter().find(|c| c.fixture_id == go1.id && c.level == slots[s].level && c.section == slots[s].section).map(|c| c.status);
    assert_eq!((cell(0), cell(1), cell(2)), (Some("out"), None, Some("expiring")));
    let alerts = plan::fixture_alerts(&conn, go1.id).unwrap();
    assert_eq!(
        alerts.iter().map(|a| (a.name.as_str(), a.status)).collect::<Vec<_>>(),
        vec![("Lait en poudre", "out"), ("Sucre 1kg", "low"), ("Yaourt", "expiring")]
    );
    let in_fixture = catalog::list_products(&conn, &catalog::ProductFilter { fixture_id: Some(go1.id), ..Default::default() }).unwrap();
    assert_eq!(in_fixture.len(), 4, "étiquettes de rayon du meuble");

    // Carte des ventes : chaque vente compte pour le meuble de l'emplacement principal ; un produit non rangé à part.
    let caisse = cashier(&conn, &admin);
    cash::open(&conn, &caisse, 0).unwrap();
    let loose = product(&mut conn, &admin, "Pain", 100, 150, 20.0);
    sales::create_sale(&mut conn, &caisse, sale_input(vec![(ok, 2.0), (loose, 4.0)], "cash", 10_000, None)).unwrap();
    let today = chrono::Local::now().format("%Y-%m-%d").to_string();
    let map = plan::sales_map(&conn, &today, &today).unwrap();
    assert_eq!((map.total, map.unplaced), (7600, 600));
    let s = map.fixtures.iter().find(|s| s.fixture_id == go1.id).unwrap();
    assert_eq!((s.revenue, s.margin, s.quantity, s.products), (7000, 1000, 2.0, 1));
    assert!(plan::sales_map(&conn, "2026-13-01", &today).is_err());
    assert!(plan::sales_map(&conn, &today, "2020-01-01").is_err());
}
