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
    audit, auth, backup, cash, catalog, devices, locations, loyalty, media, partners, plan, promotions, purchases, reports, returns, sales,
    settings, stock, templates, users, zreport,
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
    let Some(raw) = pin.filter(|p| !p.trim().is_empty()) else {
        return invalid("Code PIN requis pour confirmer cette action.");
    };
    approve_pin(state, conn, user, &raw, level, action)
}

/// Vérifie un code PIN donné (« PIN » ou « id:PIN ») au niveau demandé, avec l'anti force brute par compte.
fn approve_pin(
    state: &AppState,
    conn: &rusqlite::Connection,
    user: &crate::state::SessionUser,
    raw: &str,
    level: u8,
    action: Option<&str>,
) -> AppResult<crate::state::SessionUser> {
    let (approver, pin) = parse_pin(raw);
    state.account_guard(approver.unwrap_or(user.id))?;
    match auth::approve(conn, user, approver, &pin, level)? {
        auth::Approval::Approved(approver) => {
            state.account_result(approver.id, true);
            if let Some(action) = action {
                let detail = if approver.id == user.id { action.to_string() } else { format!("{action} — validé par {}", approver.full_name) };
                audit::log(conn, user, "Confirmation par PIN", "pin", Some(approver.id), detail)?;
            }
            Ok(approver)
        }
        auth::Approval::WrongPin(id) => {
            state.account_result(id, false);
            invalid("Code PIN incorrect.")
        }
        auth::Approval::NotAllowed => invalid(match level {
            3 => "Cette action doit être validée par un administrateur : choisissez-le, puis tapez son code PIN.",
            2 => "Cette action doit être validée par un gestionnaire ou un administrateur : choisissez-le, puis tapez son code PIN.",
            _ => "Code PIN incorrect.",
        }),
    }
}

/// PIN de la fenêtre de validation : « PIN » (la personne connectée) ou « id:PIN » (le responsable
/// choisi dans la liste). Deux personnes pouvant avoir le même PIN, celui-ci ne vaut que pour elle.
fn parse_pin(raw: &str) -> (Option<i64>, String) {
    match raw.split_once(':') {
        Some((id, pin)) => (id.trim().parse().ok(), pin.trim().to_string()),
        None => (None, raw.trim().to_string()),
    }
}

/// Depuis Internet, le téléphone doit avoir été autorisé (jeton « device ») : son identifiant et,
/// s'il a été autorisé par un code d'accès, la seule personne qui peut s'y connecter.
fn internet_device(state: &AppState, a: &Value, from_internet: bool) -> AppResult<Option<(i64, Option<i64>)>> {
    if !from_internet {
        return Ok(None);
    }
    let token: Option<String> = arg(a, "device")?;
    let found = match token {
        Some(t) => devices::check(&state.conn(), &t)?,
        None => None,
    };
    match found {
        Some(d) => Ok(Some(d)),
        None => invalid(
            "Ce téléphone n'est pas encore autorisé : utilisez le code d'accès donné par l'administrateur, ou le compte boutique.",
        ),
    }
}

/// Connexion par code PIN (tuile du nom, ou identifiant tapé) : anti force brute par appareil et par
/// compte, puis contrôle du téléphone autorisé depuis Internet.
#[allow(clippy::too_many_arguments)]
fn pin_login(
    state: &AppState,
    origin: &Origin,
    ip: &str,
    route: &str,
    account: auth::Account,
    pin: &str,
    device: Option<(i64, Option<i64>)>,
    wrong: &str,
) -> AppResult<Value> {
    state.account_guard(account.id)?;
    let checked = auth::check_pin(&state.conn(), &account, pin)?;
    let Some(user) = checked else {
        state.login_result(ip, false);
        state.account_result(account.id, false);
        return invalid(wrong.to_string());
    };
    state.login_result(ip, true);
    state.account_result(account.id, true);
    if let Some((_, owner)) = device {
        if owner.is_some_and(|o| o != user.id) {
            return invalid("Ce téléphone est autorisé pour une autre personne.");
        }
        if !account.internet_access {
            return invalid("L'accès depuis Internet n'est pas autorisé pour ce compte : demandez-le à l'administrateur.");
        }
    }
    let what = if device.is_some() { "Connexion depuis Internet" } else { "Connexion" };
    audit::log(&state.conn(), &user, what, "user", Some(user.id), "")?;
    let token = state.start_session(origin, user.clone(), ip, route, device.map(|d| d.0))?;
    out(json!({ "user": user, "token": token }))
}

fn out<T: Serialize>(v: T) -> AppResult<Value> {
    serde_json::to_value(v).map_err(|e| AppError::Internal(e.to_string()))
}

/// Paramètres lisibles sans connexion depuis Internet (écran de connexion) : rien d'autre ne sort.
const PUBLIC_SETTINGS: &[&str] =
    &["shop_name", "shop_logo_id", "currency_symbol", "currency_decimals", "theme_color", "theme_mode", "sidebar_style", "enabled_features", "business_type", "business_types"];

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
            let r = auth::initial_setup(&mut state.conn(), arg(&a, "input")?)?;
            let token = state.start_session(origin, r.user.clone(), &ip, &route, None)?;
            out(json!({ "user": r.user, "token": token, "team": r.team }))
        }
        // Écran de connexion : depuis Internet ? téléphone autorisé ? compte boutique relié ?
        "login_info" => {
            let device: Option<String> = arg(&a, "device")?;
            let dev = match (from_internet, device) {
                (true, Some(t)) => devices::describe(&state.conn(), &t)?,
                _ => None,
            };
            out(json!({ "internet": from_internet, "device": dev, "account": !crate::license::account().store_code.is_empty() }))
        }
        // Identifiant et code PIN (clavier, ou depuis Internet avec un téléphone autorisé).
        "login" => {
            state.login_guard(&ip)?;
            let device = internet_device(state, &a, from_internet)?;
            let username: String = arg(&a, "username")?;
            let pin: String = arg(&a, "pin")?;
            let account = auth::account_by_username(&state.conn(), &username)?;
            let Some(account) = account else {
                state.login_result(&ip, false);
                return invalid("Identifiant ou code PIN incorrect.");
            };
            pin_login(state, origin, &ip, &route, account, &pin, device, "Identifiant ou code PIN incorrect.")
        }
        "logout" => {
            if let Some(user) = state.user(origin) {
                audit::log(&state.conn(), &user, "Déconnexion", "user", Some(user.id), "")?;
            }
            state.set_user(origin, None);
            out(())
        }
        "current_user" => out(state.user(origin)),
        // Depuis Internet : pas de liste du personnel (identifiant et code PIN à taper).
        "list_login_users" if from_internet => out(Vec::<Value>::new()),
        "list_login_users" => out(auth::login_users(&state.conn())?),
        // On touche son nom, puis on tape son code PIN (réseau du magasin).
        "login_pin" => {
            if from_internet {
                return invalid("Depuis Internet, tapez votre identifiant et votre code PIN.");
            }
            state.login_guard(&ip)?;
            let account = auth::account_by_id(&state.conn(), arg(&a, "user_id")?)?;
            let Some(account) = account else { return invalid("Compte introuvable.") };
            pin_login(state, origin, &ip, &route, account, &arg::<String>(&a, "pin")?, None, "Code PIN incorrect.")
        }
        // Ancien mot de passe : administrateur sans PIN (mise à jour depuis la 0.13), au magasin seulement.
        "login_password" => {
            if from_internet {
                return invalid("Depuis Internet, tapez votre identifiant et votre code PIN.");
            }
            state.login_guard(&ip)?;
            let result = auth::login_password(&state.conn(), &arg::<String>(&a, "username")?, &arg::<String>(&a, "password")?);
            state.login_result(&ip, result.is_ok());
            let user = result?;
            let token = state.start_session(origin, user.clone(), &ip, &route, None)?;
            out(json!({ "user": user, "token": token }))
        }
        // Téléphone autorisé une fois par le compte boutique (e-mail et mot de passe Eden Dev).
        "authorize_device_account" => {
            state.login_guard(&ip)?;
            let checked = crate::account::verify_owner(&arg::<String>(&a, "email")?, &arg::<String>(&a, "password")?);
            state.login_result(&ip, checked.is_ok());
            checked.map_err(AppError::Validation)?;
            let label = arg::<Option<String>>(&a, "label")?.unwrap_or_default();
            let conn = state.conn();
            let (id, token) = devices::register(&conn, None, "account", &label)?;
            audit::log_system(&conn, "Téléphone autorisé par le compte boutique", "device", Some(id), &label)?;
            out(json!({ "device": token }))
        }
        // Téléphone d'un gestionnaire ou d'une caissière : identifiant, PIN et code d'accès de l'administrateur.
        "authorize_device_code" => {
            state.login_guard(&ip)?;
            let account = auth::account_by_username(&state.conn(), &arg::<String>(&a, "username")?)?;
            let Some(account) = account else {
                state.login_result(&ip, false);
                return invalid("Identifiant ou code PIN incorrect.");
            };
            state.account_guard(account.id)?;
            let pin: String = arg(&a, "pin")?;
            let checked = auth::check_pin(&state.conn(), &account, &pin)?;
            let Some(user) = checked else {
                state.login_result(&ip, false);
                state.account_result(account.id, false);
                return invalid("Identifiant ou code PIN incorrect.");
            };
            let label = arg::<Option<String>>(&a, "label")?.unwrap_or_default();
            let used = devices::use_code(&state.conn(), account.id, &arg::<String>(&a, "code")?, &label)?;
            let Some((device_id, token)) = used else {
                state.login_result(&ip, false);
                return invalid("Code d'accès faux, déjà utilisé ou expiré : demandez un nouveau code à l'administrateur.");
            };
            state.login_result(&ip, true);
            state.account_result(account.id, true);
            audit::log(&state.conn(), &user, "Téléphone autorisé par code d'accès", "device", Some(device_id), &label)?;
            let session = state.start_session(origin, user.clone(), &ip, &route, Some(device_id))?;
            out(json!({ "device": token, "user": user, "token": session }))
        }
        // Code PIN administrateur oublié : refait avec le compte boutique, au magasin seulement.
        "reset_admin_pin" => {
            if from_internet {
                return invalid("À faire au magasin (sur un poste du réseau de la boutique).");
            }
            state.login_guard(&ip)?;
            let checked = crate::account::verify_owner(&arg::<String>(&a, "email")?, &arg::<String>(&a, "password")?);
            state.login_result(&ip, checked.is_ok());
            checked.map_err(AppError::Validation)?;
            let pin: String = arg(&a, "pin")?;
            auth::validate_pin(pin.trim(), "admin")?;
            let username: Option<String> = arg(&a, "username")?;
            let conn = state.conn();
            out(auth::reset_admin_pin(&conn, username.as_deref(), pin.trim())?)
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
        // Création du PIN avec l'ancien mot de passe (administrateur, mise à jour depuis la 0.13).
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
        // Changer son propre code PIN (l'actuel est demandé).
        "change_my_pin" => run(Any, &|c, u| {
            state.account_guard(u.id)?;
            let ok = auth::change_own_pin(c, u, &arg::<String>(&a, "current")?, &arg::<String>(&a, "pin")?)?;
            state.account_result(u.id, ok);
            if !ok {
                return invalid("Code PIN actuel incorrect.");
            }
            out(())
        }),
        // Responsables pouvant valider une action (fenêtre de validation).
        "list_approvers" => run(Any, &|c, _| {
            let level = level_of(&arg::<Option<String>>(&a, "level")?.unwrap_or_default());
            out(auth::approvers(c, level)?)
        }),

        // ───── Utilisateurs ─────
        "list_users" => run(Admin, &|c, _| out(users::list(c)?)),
        // Identifiant et PIN proposés pour un nouveau poste.
        "suggest_staff" => run(Admin, &|c, _| {
            let role: String = arg(&a, "role")?;
            let len = if role == "admin" { auth::ADMIN_PIN_LEN } else { 4 };
            out(json!({ "username": users::next_username(c, &role)?, "pin": auth::random_pin(len) }))
        }),
        "save_user" => run(Admin, &|c, u| {
            confirm_pin(state, c, u, &a, 3, "Modification du personnel")?;
            match arg::<Option<i64>>(&a, "id")? {
                Some(id) => {
                    if users::update(c, u, id, arg(&a, "input")?)? {
                        state.kick_user(id);
                    }
                    out(())
                }
                None => out(users::create(c, u, arg(&a, "input")?).map(|_| ())?),
            }
        }),
        "reset_user_pin" => run(Admin, &|c, u| {
            confirm_pin(state, c, u, &a, 3, "Nouveau code PIN")?;
            out(users::reset_pin(c, u, arg(&a, "id")?, arg::<String>(&a, "new_pin")?.trim())?)
        }),
        "delete_user" => run(Admin, &|c, u| {
            confirm_pin(state, c, u, &a, 3, "Suppression d'un compte du personnel")?;
            let id: i64 = arg(&a, "id")?;
            let erased = users::delete(c, u, id)?;
            state.kick_user(id);
            out(json!({ "erased": erased }))
        }),
        // Téléphones autorisés pour l'accès Internet.
        "list_devices" => run(Admin, &|c, _| out(devices::list(c)?)),
        "revoke_device" => run(Admin, &|c, u| {
            let id: i64 = arg(&a, "id")?;
            devices::revoke(c, u, id)?;
            state.kick_device(id);
            out(())
        }),
        // Code d'accès téléphone (8 lettres et chiffres) pour une personne.
        "create_access_code" => run(Admin, &|c, u| {
            confirm_pin(state, c, u, &a, 3, "Code d'accès téléphone")?;
            out(devices::create_code(c, u, arg(&a, "user_id")?)?)
        }),
        "update_settings" => run(Admin, &|c, u| {
            confirm_pin(state, c, u, &a, 3, "Modification des paramètres")?;
            let values: std::collections::BTreeMap<String, String> = arg(&a, "values")?;
            if let Some(logo) = values.get("shop_logo_id") {
                if !logo.trim().is_empty() && *logo != settings::get(c, "shop_logo_id")? && !crate::license::allows("logo") {
                    return invalid("Le logo personnalisé est inclus à partir de la formule PRO.");
                }
            }
            let saved = settings::update(c, u, values)?;
            crate::report::refresh(c);
            out(saved)
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
        // Activités de la boutique (la principale d'abord, 3 au plus) : profils, fonctions et catégories réunis.
        "set_business_type" => run(Admin, &|c, u| {
            let mut ids: Vec<String> = arg::<Option<Vec<String>>>(&a, "ids")?.unwrap_or_default();
            if ids.is_empty() {
                ids.push(arg(&a, "id")?);
            }
            ids.dedup();
            if ids.len() > 3 {
                return invalid("Trois activités au plus : une principale et deux autres.");
            }
            let all = templates::profiles();
            let mut chosen = Vec::new();
            for id in &ids {
                let Some(p) = all.iter().find(|p| p.id == id.as_str()) else { return invalid("Type de commerce inconnu.") };
                if !chosen.iter().any(|c: &&templates::BusinessProfile| c.id == p.id) {
                    chosen.push(p);
                }
            }
            // PIN exigé, sauf au premier choix (première configuration).
            if !settings::get(c, "business_type")?.trim().is_empty() {
                confirm_pin(state, c, u, &a, 3, "Changement du type de commerce")?;
            }
            let features: Option<Vec<String>> = arg(&a, "features")?;
            let features = features.unwrap_or_else(|| {
                let mut f: Vec<String> = Vec::new();
                for p in &chosen {
                    for x in &p.features {
                        if !f.iter().any(|y| y == x) {
                            f.push(x.to_string());
                        }
                    }
                }
                f
            });
            let mut categories: Vec<usize> = Vec::new();
            for p in &chosen {
                for i in &p.categories {
                    if !categories.contains(i) {
                        categories.push(*i);
                    }
                }
            }
            let ids: Vec<&str> = chosen.iter().map(|p| p.id).collect();
            settings::set(c, "business_type", ids[0])?;
            settings::set(c, "business_types", &ids.join(","))?;
            settings::set(c, "enabled_features", &features.join(","))?;
            let created = if arg::<Option<bool>>(&a, "seed")?.unwrap_or(false) { templates::seed(c, u, &categories)? } else { 0 };
            let labels: Vec<&str> = chosen.iter().map(|p| p.label).collect();
            audit::log(c, u, "Type de commerce", "settings", None, format!("{} — {}", labels.join(" + "), features.join(", ")))?;
            out(json!({ "created": created, "settings": settings::get_all(c)? }))
        }),
        "find_product_by_barcode" => run(Any, &|c, _| out(catalog::find_by_barcode(c, &arg::<String>(&a, "code")?)?)),
        "save_product" => run(Manager, &|c, u| {
            let id: Option<i64> = arg(&a, "id")?;
            let input: catalog::ProductInput = arg(&a, "input")?;
            // Changer un prix d'un produit existant est une action critique.
            if let Some(id) = id {
                let p = catalog::get_product(c, id)?;
                if p.sale_price != input.sale_price
                    || p.purchase_price != input.purchase_price
                    || p.wholesale_price != input.wholesale_price.unwrap_or(0)
                    || p.active && input.active == Some(false)
                {
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
        "plan_floor_fill" => run(Any, &|c, _| out(plan::floor_fill(c, arg(&a, "floor_id")?)?)),
        // Affichages du plan : état du stock des meubles (rupture, stock bas, péremption) et carte des ventes.
        "plan_floor_status" => run(Any, &|c, _| out(plan::floor_status(c, arg(&a, "floor_id")?)?)),
        "plan_fixture_alerts" => run(Any, &|c, _| out(plan::fixture_alerts(c, arg(&a, "id")?)?)),
        "plan_sales_map" => run(Admin, &|c, _| out(plan::sales_map(c, &arg::<String>(&a, "from")?, &arg::<String>(&a, "to")?)?)),
        "plan_generate_layout" => run(Manager, &|c, u| out(plan::generate_layout(c, u, arg(&a, "input")?)?)),
        // Aperçu du plan proposé (rien n'est enregistré) : configuration et assistant.
        "plan_preview_layout" => run(Any, &|c, _| out(plan::preview_layout(c, arg(&a, "input")?)?)),
        // Dessin du bâtiment (photo, PDF) en fond d'un niveau.
        "plan_set_backdrop" => run(Manager, &|c, u| out(plan::set_backdrop(c, u, arg(&a, "input")?)?)),
        "product_places" => run(Any, &|c, _| out(plan::product_places(c, arg(&a, "product_id")?)?)),
        "plan_save_floor" => run(Manager, &|c, u| out(plan::save_floor(c, u, arg(&a, "id")?, arg(&a, "input")?)?)),
        "plan_delete_floor" => run(Manager, &|c, u| {
            confirm_pin(state, c, u, &a, 2, "Suppression d'un niveau du plan")?;
            out(plan::delete_floor(c, u, arg(&a, "id")?)?)
        }),
        "plan_save_fixture" => run(Manager, &|c, u| match arg::<Option<i64>>(&a, "id")? {
            Some(id) => out(plan::update_fixture(c, u, id, arg(&a, "input")?)?),
            None => out(plan::create_fixture_free(c, Some(u), arg(&a, "input")?)?),
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
        // Fonds rendus au client : PIN d'un gestionnaire ou de l'administrateur.
        "refund_customer_funds" => run(Any, &|c, u| {
            let approver = confirm_pin(state, c, u, &a, 2, "Fonds rendus au client")?;
            out(partners::refund_funds(c, u, &approver, arg(&a, "input")?)?)
        }),
        "customer_statement" => run(Any, &|c, _| out(partners::statement(c, arg(&a, "id")?)?)),
        // ───── Programme client fidèle ─────
        "customer_loyalty_history" => run(Any, &|c, _| out(loyalty::history(c, arg(&a, "id")?)?)),
        "customer_card" => run(Any, &|c, _| out(loyalty::card_code(c, arg(&a, "id")?)?)),
        "customer_by_card" => run(Any, &|c, _| match loyalty::customer_by_card(c, &arg::<String>(&a, "code")?)? {
            Some(id) => out(Some(partners::get_customer(c, id)?)),
            None => out(None::<partners::Customer>),
        }),
        "loyalty_convert_points" => run(Admin, &|c, u| out(loyalty::convert_points(c, u, arg(&a, "per_point")?)?)),

        // ───── Ventes ─────
        // Remise au-delà du seuil : le PIN envoyé avec la vente est vérifié ici (niveau « pin_discount_level »),
        // puis la vente contrôle elle-même le seuil et trace la remise.
        "create_sale" => run(Any, &|c, u| {
            let input: sales::SaleInput = arg(&a, "input")?;
            let approver = match input.discount_pin.as_deref().map(str::trim).filter(|p| !p.is_empty()) {
                Some(pin) => {
                    let level = level_of(&settings::get(c, "pin_discount_level")?);
                    Some(approve_pin(state, c, u, pin, level, None)?)
                }
                None => None,
            };
            out(sales::create_sale_with(c, u, input, approver.as_ref())?)
        }),
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
        // Prix affichés en caisse : normal, gros ou promotion (mêmes règles qu'à l'encaissement).
        "sale_quote" => run(Any, &|c, _| {
            let items: Vec<sales::QuoteItem> = arg(&a, "items")?;
            out(sales::quote(c, &items, arg(&a, "customer_id")?)?)
        }),

        // ───── Retours et avoirs ─────
        // La caissière (caisse ouverte) rend ; un gestionnaire ou l'administrateur valide par son PIN.
        "create_return" => run(Any, &|c, u| {
            let approver = confirm_pin(state, c, u, &a, 2, "Retour d'articles")?;
            out(returns::create_return(c, u, &approver, arg(&a, "input")?)?)
        }),
        "list_returns" => run(Any, &|c, u| {
            let mut f = arg::<Option<returns::ReturnFilter>>(&a, "filter")?.unwrap_or_default();
            if !u.is_admin() {
                f.user_id = Some(u.id);
            }
            out(returns::list_returns(c, &f)?)
        }),
        "get_return" => run(Any, &|c, _| out(returns::get_return(c, arg(&a, "id")?)?)),
        "get_credit_note" => run(Any, &|c, _| out(sales::credit_note_by_code(c, &arg::<String>(&a, "code")?)?)),
        "list_credit_notes" => run(Manager, &|c, _| {
            out(sales::list_credit_notes(c, &arg::<Option<sales::CreditNoteFilter>>(&a, "filter")?.unwrap_or_default())?)
        }),

        // ───── Promotions ─────
        "list_promotions" => run(Any, &|c, _| out(promotions::list(c)?)),
        "save_promotion" => run(Manager, &|c, u| out(promotions::save(c, u, arg(&a, "input")?)?)),
        "delete_promotion" => run(Manager, &|c, u| {
            promotions::delete(c, u, arg(&a, "id")?)?;
            out(json!({ "ok": true }))
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
        // Rapport X : chiffres de la caisse en cours, sans la clôturer (l'administrateur voit toutes les caisses).
        "cash_x_report" => run(Any, &|c, u| {
            let id = match arg::<Option<i64>>(&a, "session_id")? {
                Some(id) if u.is_admin() => id,
                _ => match cash::open_session_id(c, u.id)? {
                    Some(id) => id,
                    None => return invalid("Aucune session de caisse ouverte."),
                },
            };
            out(zreport::build(c, id)?)
        }),
        "list_z_reports" => run(Any, &|c, u| {
            let mut f = arg::<Option<zreport::ZFilter>>(&a, "filter")?.unwrap_or_default();
            if !u.is_admin() {
                f.user_id = Some(u.id);
            }
            out(zreport::list(c, &f)?)
        }),
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
        // Adresse Internet automatique (tunnel Cloudflare créé par Eden Dev pour la boutique).
        "tunnel_status" => {
            state.require(origin, Admin)?;
            out(crate::tunnel::status(&state.conn()))
        }
        "tunnel_setup" => {
            account_access(state, origin)?;
            let port = crate::cloud::port();
            if port == 0 {
                return invalid("Seul le poste serveur reçoit l'adresse Internet de la boutique.");
            }
            state.login_guard(&ip)?;
            let asked = crate::account::request_tunnel(&arg::<String>(&a, "email")?, &arg::<String>(&a, "password")?, port);
            state.login_result(&ip, !matches!(&asked, Err(e) if e.contains("mot de passe")));
            let (url, token) = asked.map_err(AppError::Validation)?;
            let conn = state.conn();
            crate::tunnel::save(&conn, &url, &token).map_err(AppError::Validation)?;
            audit::log_system(&conn, "Adresse Internet automatique activée", "settings", None, &url)?;
            drop(conn);
            let _ = crate::cloud::publish_once(state, true);
            out(crate::tunnel::status(&state.conn()))
        }
        "tunnel_remove" => {
            account_access(state, origin)?;
            let conn = state.conn();
            crate::tunnel::remove(&conn).map_err(AppError::Validation)?;
            audit::log_system(&conn, "Adresse Internet automatique retirée de ce PC", "settings", None, "")?;
            drop(conn);
            let _ = crate::cloud::publish_once(state, true);
            out(crate::tunnel::status(&state.conn()))
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

        // ───── Nouvelle version et erreurs du programme ─────
        "update_status" => {
            state.require(origin, Any)?;
            Ok(crate::report::update_status())
        }
        // Erreur imprévue de l'interface (aussi avant la connexion) : envoyée à Eden Dev si la boutique le permet.
        "report_error" => {
            if crate::report::allowed(&state.conn()) {
                let text = |k: &str| a.get(k).and_then(Value::as_str).unwrap_or_default().to_string();
                crate::report::send(&text("kind"), &text("message"), &text("stack"), &text("page"), &text("device"));
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
        // Sauvegarde automatique : dossier utilisé, dernière copie, erreur (bandeau du tableau de bord).
        "backup_status" => run(Admin, &|c, _| out(backup::status(c)?)),
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
