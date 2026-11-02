//! Point d'entrée unique de toutes les opérations métier.
//!
//! Le même `dispatch` sert :
//!  - l'application locale (commande Tauri `rpc`, origine `Local`) ;
//!  - les postes clients du réseau (serveur HTTP, origine `Remote(jeton)`), voir `server.rs`.
//! Chaque opération vérifie les droits de l'utilisateur avant d'appeler la logique métier (`services`).

use serde::de::DeserializeOwned;
use serde::Serialize;
use serde_json::{json, Value};

use crate::error::{invalid, AppError, AppResult};
use crate::services::{
    audit, auth, backup, cash, catalog, locations, media, partners, plan, purchases, reports, sales, settings, stock, templates,
    users,
};
use crate::state::{Access, AppState, Origin};

/// Lit un paramètre nommé (absent = `null`, ce qui convient aux `Option`).
fn arg<T: DeserializeOwned>(args: &Value, name: &str) -> AppResult<T> {
    serde_json::from_value(args.get(name).cloned().unwrap_or(Value::Null))
        .map_err(|e| AppError::Validation(format!("Paramètre « {name} » invalide : {e}")))
}

/// Niveau requis à partir d'un nom de rôle (« cashier », « manager », « admin »).
fn level_of(role: &str) -> u8 {
    crate::state::role_level(role)
}

/// Exige le code PIN d'un utilisateur ayant au moins le niveau demandé (lui-même ou un responsable).
/// Si un responsable autorise l'action d'un autre utilisateur, c'est tracé dans le journal.
fn confirm_pin(
    state: &AppState,
    conn: &rusqlite::Connection,
    user: &crate::state::SessionUser,
    a: &Value,
    level: u8,
    action: &str,
) -> AppResult<crate::state::SessionUser> {
    confirm_pin_ex(state, conn, user, a, level, Some(action))
}

fn confirm_pin_ex(
    state: &AppState,
    conn: &rusqlite::Connection,
    user: &crate::state::SessionUser,
    a: &Value,
    level: u8,
    action: Option<&str>,
) -> AppResult<crate::state::SessionUser> {
    let pin: Option<String> = arg(a, "pin")?;
    let Some(pin) = pin.filter(|p| !p.trim().is_empty()) else {
        return invalid("Code PIN requis pour confirmer cette action.");
    };
    state.pin_guard()?;
    match auth::pin_approver(conn, user, pin.trim(), level)? {
        Some(approver) => {
            state.pin_result(true);
            if let Some(action) = action {
                let detail = if approver.id == user.id { action.to_string() } else { format!("{action} — autorisé par {}", approver.full_name) };
                audit::log(conn, user, "Confirmation par PIN", "pin", Some(approver.id), detail)?;
            }
            Ok(approver)
        }
        None => {
            state.pin_result(false);
            invalid(match level {
                3 => "Code PIN incorrect ou insuffisant : un administrateur doit confirmer.",
                2 => "Code PIN incorrect ou insuffisant : un gestionnaire ou un administrateur doit confirmer.",
                _ => "Code PIN incorrect.",
            })
        }
    }
}

fn out<T: Serialize>(v: T) -> AppResult<Value> {
    serde_json::to_value(v).map_err(|e| AppError::Internal(e.to_string()))
}

/// Paramètres lisibles sans connexion depuis Internet (écran de connexion) : rien d'autre ne sort.
const PUBLIC_SETTINGS: &[&str] =
    &["shop_name", "shop_logo_id", "currency_symbol", "currency_decimals", "theme_color", "theme_mode", "sidebar_style", "enabled_features", "business_type"];

/// Opérations du compte boutique : sur ce PC uniquement (poste serveur ou poste unique),
/// à la première configuration ou par l'administrateur.
fn account_access(state: &AppState, origin: &Origin) -> AppResult<()> {
    if !matches!(origin, Origin::Local) {
        return invalid("À faire sur le PC serveur (ou le poste unique) de la boutique.");
    }
    if auth::needs_setup(&state.conn())? {
        return Ok(());
    }
    state.require(origin, Access::Admin).map(|_| ())
}

pub fn dispatch(state: &AppState, origin: &Origin, cmd: &str, a: Value) -> AppResult<Value> {
    use Access::*;
    let run = |access, f: &dyn Fn(&mut rusqlite::Connection, &crate::state::SessionUser) -> AppResult<Value>| {
        state.run(origin, access, |c, u| f(c, u))
    };
    // Abonnement expiré ou absent : lecture seule (toute commande non listée est une écriture).
    crate::license::check_command(cmd)?;
    // Appareil à l'origine de l'appel (ajouté par le serveur réseau) : anti force brute, route.
    let ip = a.get("__ip").and_then(Value::as_str).unwrap_or("local").to_string();
    let route = a.get("__route").and_then(Value::as_str).unwrap_or("local").to_string();
    let from_internet = route == "internet";

    match cmd {
        // ───── Authentification (sans session) ─────
        "needs_setup" => out(auth::needs_setup(&state.conn())?),
        "initial_setup" => {
            let user = auth::initial_setup(&mut state.conn(), arg(&a, "input")?)?;
            let token = state.start_session(origin, user.clone(), &ip, &route)?;
            out(json!({ "user": user, "token": token }))
        }
        "login" => {
            state.login_guard(&ip)?;
            let username: String = arg(&a, "username")?;
            let password: String = arg(&a, "password")?;
            let result = auth::login(&state.conn(), &username, &password);
            state.login_result(&ip, result.is_ok());
            let user = result?;
            let token = state.start_session(origin, user.clone(), &ip, &route)?;
            out(json!({ "user": user, "token": token }))
        }
        "logout" => {
            if let Some(user) = state.user(origin) {
                audit::log(&state.conn(), &user, "Déconnexion", "user", Some(user.id), "")?;
            }
            state.set_user(origin, None);
            out(())
        }
        "current_user" => out(state.user(origin)),
        // Depuis Internet : pas de liste du personnel (connexion par identifiant et mot de passe).
        "list_login_users" if from_internet => out(Vec::<Value>::new()),
        "list_login_users" => out(auth::login_users(&state.conn())?),
        "login_pin" => {
            if from_internet {
                return invalid("Connexion par code PIN impossible depuis Internet : utilisez votre identifiant et votre mot de passe.");
            }
            state.login_guard(&ip)?;
            let user_id: i64 = arg(&a, "user_id")?;
            let pin: String = arg(&a, "pin")?;
            let found = auth::login_pin(&state.conn(), user_id, pin.trim());
            state.login_result(&ip, matches!(found, Ok(Some(_))));
            let Some(user) = found? else { return invalid("Code PIN incorrect.") };
            let token = state.start_session(origin, user.clone(), &ip, &route)?;
            out(json!({ "user": user, "token": token }))
        }
        "get_settings" => {
            let mut all = settings::get_all(&state.conn())?;
            if from_internet && state.user(origin).is_none() {
                all.retain(|k, _| PUBLIC_SETTINGS.contains(&k.as_str()));
            }
            out(all)
        }
        "server_info" => {
            let s = settings::get_all(&state.conn())?;
            out(json!({ "shop_name": s.get("shop_name"), "version": env!("CARGO_PKG_VERSION") }))
        }
        // Écran client : lisible sans connexion (TV, projecteur, navigateur).
        "display_state" => {
            let poste: String = arg(&a, "poste")?;
            out(state.display(&poste))
        }

        // ───── Code PIN ─────
        "set_my_pin" => run(Any, &|c, u| {
            auth::set_own_pin(c, u, &arg::<String>(&a, "password")?, arg::<String>(&a, "pin")?.trim())?;
            let mut updated = u.clone();
            updated.has_pin = true;
            state.update_user(origin, updated.clone());
            out(updated)
        }),
        // Vérifie un PIN pour une action de l'interface (suppression d'article, remise…).
        "verify_pin" => run(Any, &|c, u| {
            let level = level_of(&arg::<Option<String>>(&a, "level")?.unwrap_or_default());
            // Sans « action », simple vérification avant une opération qui sera elle-même contrôlée et tracée.
            let action = arg::<Option<String>>(&a, "action")?;
            let approver = confirm_pin_ex(state, c, u, &a, level, action.as_deref())?;
            out(json!({ "id": approver.id, "full_name": approver.full_name, "role": approver.role }))
        }),

        // ───── Compte ─────
        // Langue de l'utilisateur connecté (fr, en) : retenue pour ses prochaines connexions.
        "set_my_lang" => run(Any, &|c, u| {
            let lang = auth::valid_lang(&arg::<Option<String>>(&a, "lang")?);
            c.execute("UPDATE users SET lang = ?1 WHERE id = ?2", rusqlite::params![lang, u.id])?;
            let mut updated = u.clone();
            updated.lang = lang;
            state.update_user(origin, updated.clone());
            out(updated)
        }),
        "change_password" => run(Any, &|c, u| {
            out(auth::change_password(c, u, &arg::<String>(&a, "current")?, &arg::<String>(&a, "password")?)?)
        }),

        // ───── Utilisateurs ─────
        "list_users" => run(Admin, &|c, _| out(users::list(c)?)),
        "save_user" => run(Admin, &|c, u| {
            confirm_pin(state, c, u, &a, 3, "Modification d'utilisateur")?;
            match arg::<Option<i64>>(&a, "id")? {
                Some(id) => out(users::update(c, u, id, arg(&a, "input")?)?),
                None => out(users::create(c, u, arg(&a, "input")?).map(|_| ())?),
            }
        }),
        "reset_user_password" => run(Admin, &|c, u| {
            confirm_pin(state, c, u, &a, 3, "Réinitialisation de mot de passe")?;
            out(users::reset_password(c, u, arg(&a, "id")?, &arg::<String>(&a, "password")?)?)
        }),
        "reset_user_pin" => run(Admin, &|c, u| {
            confirm_pin(state, c, u, &a, 3, "Réinitialisation de code PIN")?;
            out(users::reset_pin(c, u, arg(&a, "id")?, arg::<String>(&a, "new_pin")?.trim())?)
        }),
        "update_settings" => run(Admin, &|c, u| {
            confirm_pin(state, c, u, &a, 3, "Modification des paramètres")?;
            let values: std::collections::BTreeMap<String, String> = arg(&a, "values")?;
            if let Some(logo) = values.get("shop_logo_id") {
                if !logo.trim().is_empty() && *logo != settings::get(c, "shop_logo_id")? && !crate::license::allows("logo") {
                    return invalid("Le logo personnalisé est inclus à partir de la formule PRO.");
                }
            }
            out(settings::update(c, u, values)?)
        }),

        // ───── Catalogue ─────
        "list_categories" => run(Any, &|c, _| out(catalog::list_categories(c)?)),
        "save_category" => run(Manager, &|c, u| out(catalog::save_category(c, u, arg(&a, "id")?, arg(&a, "input")?)?)),
        "delete_category" => run(Manager, &|c, u| {
            confirm_pin(state, c, u, &a, 2, "Suppression de catégorie")?;
            out(catalog::delete_category(c, u, arg(&a, "id")?)?)
        }),
        "list_products" => run(Any, &|c, _| {
            out(catalog::list_products(c, &arg::<Option<catalog::ProductFilter>>(&a, "filter")?.unwrap_or_default())?)
        }),
        "get_product" => run(Any, &|c, _| out(catalog::get_product(c, arg(&a, "id")?)?)),
        "scan_code" => run(Any, &|c, _| out(catalog::scan(c, &arg::<String>(&a, "code")?)?)),
        "set_category_active" => run(Manager, &|c, u| {
            out(catalog::set_category_active(c, u, arg(&a, "id")?, arg(&a, "active")?)?)
        }),
        // Catalogue prédéfini et profils de commerce (lecture libre : aussi utilisé à la première configuration).
        "business_profiles" => {
            let tree = templates::shop_catalogue(&state.conn())?;
            out(json!({ "profiles": templates::profiles(), "catalogue": templates::summaries(&tree) }))
        }
        "catalogue_tree" => out(templates::shop_catalogue(&state.conn())?),
        "seed_catalogue" => run(Admin, &|c, u| out(templates::seed(c, u, &arg::<Vec<usize>>(&a, "indexes")?)?)),
        "import_categories" => run(Manager, &|c, u| out(templates::import_paths(c, u, arg(&a, "paths")?)?)),
        // Choix du type de commerce : enregistre le profil et ses fonctions, charge ses catégories si demandé.
        "set_business_type" => run(Admin, &|c, u| {
            let id: String = arg(&a, "id")?;
            let profile = templates::profiles().into_iter().find(|p| p.id == id);
            let Some(profile) = profile else { return invalid("Type de commerce inconnu.") };
            // PIN exigé, sauf à la première configuration (l'administrateur n'a pas encore de PIN).
            if u.has_pin {
                confirm_pin(state, c, u, &a, 3, "Changement du type de commerce")?;
            }
            let features: Option<Vec<String>> = arg(&a, "features")?;
            let features = features.unwrap_or_else(|| profile.features.iter().map(|f| f.to_string()).collect());
            settings::set(c, "business_type", &id)?;
            settings::set(c, "enabled_features", &features.join(","))?;
            let created = if arg::<Option<bool>>(&a, "seed")?.unwrap_or(false) { templates::seed(c, u, &profile.categories)? } else { 0 };
            audit::log(c, u, "Type de commerce", "settings", None, format!("{} — {}", profile.label, features.join(", ")))?;
            out(json!({ "created": created, "settings": settings::get_all(c)? }))
        }),
        "find_product_by_barcode" => run(Any, &|c, _| out(catalog::find_by_barcode(c, &arg::<String>(&a, "code")?)?)),
        "save_product" => run(Manager, &|c, u| {
            let id: Option<i64> = arg(&a, "id")?;
            let input: catalog::ProductInput = arg(&a, "input")?;
            // Changer un prix d'un produit existant est une action critique.
            if let Some(id) = id {
                let p = catalog::get_product(c, id)?;
                if p.sale_price != input.sale_price || p.purchase_price != input.purchase_price || p.active && input.active == Some(false) {
                    confirm_pin(state, c, u, &a, 2, &format!("Modification de prix / statut : {}", p.name))?;
                }
            }
            out(catalog::save_product(c, u, id, input)?)
        }),
        "archive_product" => run(Manager, &|c, u| {
            confirm_pin(state, c, u, &a, 2, "Archivage de produit")?;
            out(catalog::archive_product(c, u, arg(&a, "id")?)?)
        }),
        "generate_barcode" => run(Manager, &|c, _| out(catalog::generate_barcode(c)?)),
        "import_products" => run(Manager, &|c, u| {
            confirm_pin(state, c, u, &a, 2, "Import de produits")?;
            out(catalog::import_products(c, u, arg(&a, "rows")?)?)
        }),
        "upload_image" => run(Any, &|c, _| {
            out(media::save(c, &arg::<String>(&a, "mime")?, &arg::<String>(&a, "data")?)?)
        }),

        // ───── Emplacements et plan de la boutique ─────
        "list_locations" => run(Any, &|c, _| out(locations::list(c)?)),
        "delete_location" => run(Manager, &|c, u| {
            confirm_pin(state, c, u, &a, 2, "Suppression d'emplacement")?;
            out(locations::delete(c, u, arg(&a, "id")?)?)
        }),
        "generate_locations" => run(Manager, &|c, u| out(locations::generate(c, u, arg(&a, "input")?)?)),
        "assign_location" => run(Manager, &|c, u| {
            out(locations::assign(c, u, arg(&a, "location")?, arg(&a, "products")?)?)
        }),
        "plan_get" => run(Any, &|c, _| out(plan::get(c)?)),
        "plan_fixture_contents" => run(Any, &|c, _| out(plan::contents(c, arg(&a, "id")?)?)),
        "product_places" => run(Any, &|c, _| out(plan::product_places(c, arg(&a, "product_id")?)?)),
        "plan_save_floor" => run(Manager, &|c, u| out(plan::save_floor(c, u, arg(&a, "id")?, arg(&a, "input")?)?)),
        "plan_delete_floor" => run(Manager, &|c, u| {
            confirm_pin(state, c, u, &a, 2, "Suppression d'un niveau du plan")?;
            out(plan::delete_floor(c, u, arg(&a, "id")?)?)
        }),
        "plan_save_fixture" => run(Manager, &|c, u| match arg::<Option<i64>>(&a, "id")? {
            Some(id) => out(plan::update_fixture(c, u, id, arg(&a, "input")?)?),
            None => out(plan::create_fixture(c, Some(u), arg(&a, "input")?)?),
        }),
        "plan_move_fixtures" => run(Manager, &|c, _| out(plan::move_fixtures(c, arg(&a, "items")?)?)),
        "plan_delete_fixture" => run(Manager, &|c, u| {
            let id: i64 = arg(&a, "id")?;
            // Meuble garni : confirmation par PIN (les produits perdent cet emplacement).
            if plan::get_fixture(c, id)?.product_count > 0 {
                confirm_pin(state, c, u, &a, 2, "Suppression d'un meuble garni")?;
            }
            out(plan::delete_fixture(c, u, id)?)
        }),
        "plan_save_type" => run(Manager, &|c, u| out(plan::save_type(c, u, arg(&a, "id")?, arg(&a, "input")?)?)),
        "plan_delete_type" => run(Manager, &|c, u| out(plan::delete_type(c, u, arg(&a, "id")?)?)),
        "plan_put" => run(Manager, &|c, u| out(plan::put(c, u, arg(&a, "input")?)?)),
        "plan_take" => run(Manager, &|c, u| out(plan::take(c, u, arg(&a, "product_id")?, arg(&a, "location_id")?)?)),
        "plan_set_primary" => run(Manager, &|c, u| out(plan::set_primary(c, u, arg(&a, "product_id")?, arg(&a, "location_id")?)?)),

        // ───── Stock ─────
        "adjust_stock" => run(Manager, &|c, u| {
            confirm_pin(state, c, u, &a, 2, "Ajustement de stock")?;
            out(stock::adjust(c, u, arg(&a, "input")?)?)
        }),
        "list_stock_movements" => run(Manager, &|c, _| {
            out(stock::list_movements(c, &arg::<Option<stock::MovementFilter>>(&a, "filter")?.unwrap_or_default())?)
        }),
        "stock_summary" => run(Manager, &|c, _| out(stock::summary(c)?)),

        // ───── Fournisseurs ─────
        "list_suppliers" => run(Manager, &|c, _| out(partners::list_suppliers(c, arg(&a, "search")?)?)),
        "save_supplier" => run(Manager, &|c, u| out(partners::save_supplier(c, u, arg(&a, "id")?, arg(&a, "input")?)?)),
        "archive_supplier" => run(Manager, &|c, u| {
            confirm_pin(state, c, u, &a, 2, "Archivage de fournisseur")?;
            out(partners::archive_supplier(c, u, arg(&a, "id")?)?)
        }),

        // ───── Clients ─────
        "list_customers" => run(Any, &|c, _| {
            out(partners::list_customers(c, &arg::<Option<partners::CustomerFilter>>(&a, "filter")?.unwrap_or_default())?)
        }),
        "save_customer" => run(Any, &|c, u| out(partners::save_customer(c, u, arg(&a, "id")?, arg(&a, "input")?)?)),
        "archive_customer" => run(Admin, &|c, u| {
            confirm_pin(state, c, u, &a, 3, "Archivage de client")?;
            out(partners::archive_customer(c, u, arg(&a, "id")?)?)
        }),
        "record_customer_payment" => run(Any, &|c, u| out(partners::record_payment(c, u, arg(&a, "input")?)?)),
        "customer_statement" => run(Any, &|c, _| out(partners::statement(c, arg(&a, "id")?)?)),

        // ───── Ventes ─────
        "create_sale" => run(Any, &|c, u| out(sales::create_sale(c, u, arg(&a, "input")?)?)),
        "list_sales" => run(Any, &|c, u| {
            let mut f = arg::<Option<sales::SaleFilter>>(&a, "filter")?.unwrap_or_default();
            if !u.is_admin() {
                f.user_id = Some(u.id); // caissiers et gestionnaires ne voient que leurs ventes
            }
            out(sales::list_sales(c, &f)?)
        }),
        "get_sale" => run(Any, &|c, u| {
            let sale = sales::get_sale(c, arg(&a, "id")?)?;
            if !u.is_admin() && sale.user_id != u.id {
                return Err(AppError::Forbidden);
            }
            out(sale)
        }),
        // Annulation : PIN administrateur (un caissier peut la faire valider sur place par l'administrateur).
        "cancel_sale" => run(Any, &|c, u| {
            let approver = confirm_pin(state, c, u, &a, 3, "Annulation de vente")?;
            out(sales::cancel_sale(c, &approver, arg(&a, "id")?, &arg::<String>(&a, "reason")?)?)
        }),
        "list_electronic_payments" => run(Admin, &|c, _| {
            out(sales::list_electronic(c, &arg::<Option<sales::ElectronicFilter>>(&a, "filter")?.unwrap_or_default())?)
        }),

        // ───── Achats ─────
        "create_purchase" => run(Manager, &|c, u| out(purchases::create_purchase(c, u, arg(&a, "input")?)?)),
        "list_purchases" => run(Manager, &|c, _| {
            out(purchases::list_purchases(c, &arg::<Option<purchases::PurchaseFilter>>(&a, "filter")?.unwrap_or_default())?)
        }),
        "get_purchase" => run(Manager, &|c, _| out(purchases::get_purchase(c, arg(&a, "id")?)?)),

        // ───── Caisse ─────
        "current_cash_session" => run(Any, &|c, u| out(cash::current_session(c, u)?)),
        "open_cash_session" => run(Any, &|c, u| out(cash::open(c, u, arg(&a, "amount")?)?)),
        "add_cash_movement" => run(Any, &|c, u| {
            confirm_pin(state, c, u, &a, 1, "Mouvement d'espèces")?;
            out(cash::add_movement(c, u, arg(&a, "input")?)?)
        }),
        "list_cash_movements" => run(Any, &|c, u| {
            let id: i64 = arg(&a, "id")?;
            let session = cash::get_session(c, id)?;
            if !u.is_admin() && session.user_id != u.id {
                return Err(AppError::Forbidden);
            }
            out(cash::list_movements(c, id)?)
        }),
        "close_cash_session" => run(Any, &|c, u| {
            confirm_pin(state, c, u, &a, 1, "Clôture de caisse")?;
            out(cash::close(c, u, arg(&a, "input")?)?)
        }),
        "force_close_cash_session" => run(Admin, &|c, u| {
            confirm_pin(state, c, u, &a, 3, "Clôture forcée d'une caisse")?;
            out(cash::force_close(c, u, arg(&a, "id")?, arg(&a, "input")?)?)
        }),
        "cashier_stats" => run(Any, &|c, u| out(cash::cashier_stats(c, u)?)),
        "list_cash_sessions" => run(Any, &|c, u| {
            let mut f = arg::<Option<cash::SessionFilter>>(&a, "filter")?.unwrap_or_default();
            if !u.is_admin() {
                f.user_id = Some(u.id);
            }
            out(cash::list_sessions(c, &f)?)
        }),

        // ───── Postes connectés (présence) ─────
        // Chaque poste (PC, tablette, téléphone, écran client) se signale toutes les 10 s, même sans connexion.
        "poste_heartbeat" => {
            let hb: crate::live::Heartbeat = serde_json::from_value(a.clone())
                .map_err(|e| AppError::Validation(format!("Signal de poste invalide : {e}")))?;
            let ip = a.get("__ip").and_then(|v| v.as_str()).map(String::from).unwrap_or_else(|| "ce poste".into());
            let user = state.user(origin).map(|u| u.full_name);
            let route = a.get("__route").and_then(|v| v.as_str()).unwrap_or("local").to_string();
            let online = state.live.heartbeat(hb, ip, user);
            let shop = settings::get(&state.conn(), "shop_name")?;
            let cloud = crate::cloud::status();
            out(json!({
                "online": online,
                "shop_name": shop,
                "server_time": chrono::Local::now().format("%H:%M:%S").to_string(),
                "route": route,
                "internet_ok": cloud.public_ok,
            }))
        }
        "list_postes" => {
            state.require(origin, Any)?;
            let postes = state.live.postes();
            let online = postes.iter().filter(|p| p.online).count();
            out(json!({ "postes": postes, "online": online }))
        }

        // ───── Application mobile (Supabase) ─────
        "cloud_status" => {
            state.require(origin, Admin)?;
            let mut st = crate::cloud::status();
            if st.shop_code.is_empty() {
                st.shop_code = settings::get(&state.conn(), "shop_code")?;
            }
            out(st)
        }
        "cloud_publish_now" => {
            state.require(origin, Admin)?;
            crate::cloud::publish_once(state, true).map_err(AppError::Validation)?;
            out(crate::cloud::status())
        }

        // ───── Tickets en cours : suivre un collègue et reprendre son client ─────
        "live_cart_update" => {
            let u = state.require(origin, Any)?;
            let poste_id: String = arg(&a, "poste_id")?;
            let poste: String = arg(&a, "poste")?;
            let status = arg::<Option<String>>(&a, "status")?.unwrap_or_else(|| "cart".into());
            let taken_by = state.live.update_cart(&poste_id, &poste, u.id, &u.full_name, a.get("cart").cloned().unwrap_or(Value::Null), &status);
            out(json!({ "taken_by": taken_by }))
        }
        "live_carts" => {
            state.require(origin, Any)?;
            let except: Option<String> = arg(&a, "except")?;
            out(state.live.carts(except.as_deref()))
        }
        "live_cart_take" => run(Any, &|c, u| {
            cash::ensure_cashier(u)?;
            let poste_id: String = arg(&a, "poste_id")?;
            confirm_pin(state, c, u, &a, 1, "Reprise du ticket d'une autre caisse")?;
            let Some(cart) = state.live.take_cart(&poste_id, &u.full_name) else {
                return invalid("Ce ticket n'est plus disponible (déjà encaissé, vidé ou repris par un autre caissier).");
            };
            audit::log(c, u, "Reprise d'un ticket", "sale", None, format!("Ticket de {} ({}) — {} ligne(s), total {}", cart.user_name, cart.poste, cart.lines, cart.total))?;
            out(cart)
        }),

        // ───── Écran client ─────
        "display_update" => {
            state.require(origin, Any)?;
            // Écran client non inclus dans la formule : rien n'est affiché (sans erreur pour la caisse).
            if crate::license::allows("customer_display") {
                let poste: String = arg(&a, "poste")?;
                state.set_display(&poste, a.get("state").cloned().unwrap_or(Value::Null));
            }
            out(())
        }

        // ───── Abonnement, licence et postes connectés ─────
        "license_status" => {
            if !matches!(origin, Origin::Local) {
                state.require(origin, Any)?;
            }
            let mut v = out(crate::license::status())?;
            v["postes_used"] = json!(state.active_sessions());
            Ok(v)
        }
        "license_sync" => {
            account_access(state, origin)?;
            crate::account::sync(state).map_err(AppError::Validation)?;
            out(crate::license::status())
        }
        // Fichier de licence reçu à part (WhatsApp, clé USB) : vérifié avant d'être installé.
        "license_import" => {
            let user = if matches!(origin, Origin::Local) && auth::needs_setup(&state.conn())? {
                None
            } else {
                Some(state.require(origin, Admin)?)
            };
            let text: String = arg(&a, "text")?;
            let conn = state.conn();
            let p = crate::license::install(&conn, &text).map_err(AppError::Validation)?;
            if let Some(u) = user {
                audit::log(&conn, &u, "Licence installée", "settings", None, format!("{} — {} jusqu'au {}", p.store_code, p.plan, p.expires_at))?;
            }
            drop(conn);
            out(crate::license::status())
        }
        "account_options" => {
            account_access(state, origin)?;
            out(crate::account::options().map_err(AppError::Validation)?)
        }
        "account_signup" => {
            account_access(state, origin)?;
            out(crate::account::signup(state, arg(&a, "input")?).map_err(AppError::Validation)?)
        }
        "account_login" => {
            account_access(state, origin)?;
            let email: String = arg(&a, "email")?;
            let password: String = arg(&a, "password")?;
            out(crate::account::login(&email, &password).map_err(AppError::Validation)?)
        }
        "account_create_store" => {
            account_access(state, origin)?;
            out(crate::account::create_store(state, arg(&a, "input")?).map_err(AppError::Validation)?)
        }
        "account_link" => {
            account_access(state, origin)?;
            let code: String = arg(&a, "store_code")?;
            let r = crate::account::link(state, &code).map_err(AppError::Validation)?;
            if let Some(u) = state.user(origin) {
                audit::log(&state.conn(), &u, "Compte boutique relié", "settings", None, &code)?;
            }
            out(r)
        }
        // Paiement de l'abonnement : sur ce PC, par l'administrateur.
        "account_payments" => {
            account_access(state, origin)?;
            out(crate::account::payments().map_err(AppError::Validation)?)
        }
        "account_redeem_voucher" => {
            account_access(state, origin)?;
            let code: String = arg(&a, "code")?;
            let r = crate::account::redeem_voucher(state, &code).map_err(AppError::Validation)?;
            if let Some(u) = state.user(origin) {
                let v = &r["voucher"];
                let detail = format!("Carte {} — {} {} mois", v["serial"].as_str().unwrap_or_default(), v["plan_label"].as_str().unwrap_or_default(), v["months"]);
                audit::log(&state.conn(), &u, "Carte de bon utilisée", "settings", None, detail)?;
            }
            out(r)
        }
        "account_declare_orange_money" => {
            account_access(state, origin)?;
            let r = crate::account::declare_orange_money(
                &arg::<String>(&a, "plan")?,
                arg(&a, "months")?,
                &arg::<String>(&a, "reference")?,
                &arg::<Option<String>>(&a, "payer_phone")?.unwrap_or_default(),
            )
            .map_err(AppError::Validation)?;
            if let Some(u) = state.user(origin) {
                let detail = format!("Orange Money — {} {} mois, {} FCFA", r["plan_label"].as_str().unwrap_or_default(), r["months"], r["amount"]);
                audit::log(&state.conn(), &u, "Paiement d'abonnement déclaré", "settings", None, detail)?;
            }
            out(r)
        }
        "account_card_start" => {
            account_access(state, origin)?;
            let r = crate::account::card_start(&arg::<String>(&a, "plan")?, arg(&a, "months")?).map_err(AppError::Validation)?;
            if let Some(u) = state.user(origin) {
                let detail = format!("Carte Visa — {} {} mois, {} FCFA", r["plan_label"].as_str().unwrap_or_default(), r["months"], r["amount"]);
                audit::log(&state.conn(), &u, "Paiement par carte commencé", "settings", None, detail)?;
            }
            out(r)
        }
        "list_sessions" => {
            state.require(origin, Admin)?;
            out(json!({ "sessions": state.sessions(), "max": crate::license::max_postes(), "used": state.active_sessions() }))
        }
        "kick_session" => {
            let u = state.require(origin, Admin)?;
            let id: String = arg(&a, "id")?;
            let Some(kicked) = state.kick(&id) else { return invalid("Cette session est déjà fermée.") };
            audit::log(&state.conn(), &u, "Déconnexion d'un poste", "user", Some(kicked.id), &kicked.full_name)?;
            out(())
        }

        // ───── Rapports, journal, système ─────
        "dashboard" => run(Admin, &|c, _| out(reports::dashboard(c)?)),
        "sales_report" => run(Admin, &|c, _| {
            out(reports::sales_report(c, &arg::<String>(&a, "from")?, &arg::<String>(&a, "to")?)?)
        }),
        "list_audit_log" => run(Admin, &|c, _| {
            out(audit::list(c, &arg::<Option<audit::AuditFilter>>(&a, "filter")?.unwrap_or_default())?)
        }),
        "app_info" => run(Admin, &|c, _| {
            out(json!({
                "version": env!("CARGO_PKG_VERSION"),
                "db_path": state.db_path.display().to_string(),
                "last_auto_backup": backup::last_auto_backup(c)?,
            }))
        }),
        "backup_database" => run(Admin, &|c, u| {
            let path: String = arg(&a, "path")?;
            backup::backup_to(c, std::path::Path::new(&path))?;
            audit::log(c, u, "Sauvegarde de la base", "system", None, &path)?;
            out(())
        }),
        "run_auto_backup" => run(Admin, &|c, u| match backup::auto_backup(c, true)? {
            Some(p) => {
                let p = p.display().to_string();
                audit::log(c, u, "Sauvegarde automatique", "system", None, &p)?;
                out(p)
            }
            None => invalid("Choisissez d'abord un dossier de sauvegarde automatique."),
        }),

        _ => invalid(format!("Opération inconnue : {cmd}")),
    }
}
