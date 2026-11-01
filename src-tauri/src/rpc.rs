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
    audit, auth, backup, cash, catalog, locations, media, partners, purchases, reports, sales, settings, stock, templates,
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

pub fn dispatch(state: &AppState, origin: &Origin, cmd: &str, a: Value) -> AppResult<Value> {
    use Access::*;
    let run = |access, f: &dyn Fn(&mut rusqlite::Connection, &crate::state::SessionUser) -> AppResult<Value>| {
        state.run(origin, access, |c, u| f(c, u))
    };

    match cmd {
        // ───── Authentification (sans session) ─────
        "needs_setup" => out(auth::needs_setup(&state.conn())?),
        "initial_setup" => {
            let user = auth::initial_setup(&mut state.conn(), arg(&a, "input")?)?;
            let token = state.set_user(origin, Some(user.clone()));
            out(json!({ "user": user, "token": token }))
        }
        "login" => {
            let username: String = arg(&a, "username")?;
            let password: String = arg(&a, "password")?;
            let user = auth::login(&state.conn(), &username, &password)?;
            let token = state.set_user(origin, Some(user.clone()));
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
        "list_login_users" => out(auth::login_users(&state.conn())?),
        "login_pin" => {
            state.pin_guard()?;
            let user_id: i64 = arg(&a, "user_id")?;
            let pin: String = arg(&a, "pin")?;
            let found = auth::login_pin(&state.conn(), user_id, pin.trim())?;
            state.pin_result(found.is_some());
            let Some(user) = found else { return invalid("Code PIN incorrect.") };
            let token = state.set_user(origin, Some(user.clone()));
            out(json!({ "user": user, "token": token }))
        }
        "get_settings" => out(settings::get_all(&state.conn())?), // nom du commerce, devise : rien de sensible
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
            out(settings::update(c, u, arg(&a, "values")?)?)
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
        "business_profiles" => out(json!({ "profiles": templates::profiles(), "catalogue": templates::summaries() })),
        "catalogue_tree" => out(templates::catalogue()),
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

        // ───── Emplacements ─────
        "list_locations" => run(Any, &|c, _| out(locations::list(c)?)),
        "save_location" => run(Manager, &|c, u| out(locations::save(c, u, arg(&a, "id")?, arg(&a, "input")?)?)),
        "delete_location" => run(Manager, &|c, u| {
            confirm_pin(state, c, u, &a, 2, "Suppression d'emplacement")?;
            out(locations::delete(c, u, arg(&a, "id")?)?)
        }),
        "generate_locations" => run(Manager, &|c, u| out(locations::generate(c, u, arg(&a, "input")?)?)),
        "assign_location" => run(Manager, &|c, u| {
            out(locations::assign(c, u, arg(&a, "location")?, arg(&a, "products")?)?)
        }),

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
            let poste: String = arg(&a, "poste")?;
            state.set_display(&poste, a.get("state").cloned().unwrap_or(Value::Null));
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
