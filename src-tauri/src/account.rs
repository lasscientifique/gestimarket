//! Compte boutique Eden Dev (Supabase) : inscription, connexion, rattachement de ce PC,
//! déclaration d'un paiement et téléchargement de la licence signée (bucket « licences »).
//!
//! Seuls transitent : l'e-mail et le mot de passe du compte, les informations de la boutique
//! (nom, propriétaire, pays, ville, adresse, type), l'identifiant du PC et la version.
//! Aucune donnée commerciale (ventes, produits, stocks, clients) n'est envoyée.

use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Deserialize;
use serde_json::{json, Value};

use crate::license::{self, SUPABASE_KEY};
use crate::state::AppState;

fn agent() -> ureq::Agent {
    ureq::AgentBuilder::new().timeout_connect(Duration::from_secs(8)).timeout(Duration::from_secs(25)).build()
}

fn request(path: &str, token: Option<&str>) -> ureq::Request {
    request_method("POST", path, token)
}

fn request_method(method: &str, path: &str, token: Option<&str>) -> ureq::Request {
    let r = agent()
        .request(method, &format!("{}{path}", license::supabase_url()))
        .set("apikey", SUPABASE_KEY)
        .set("Content-Type", "application/json");
    match token {
        Some(t) => r.set("Authorization", &format!("Bearer {t}")),
        None => r,
    }
}

/// Message d'erreur en français à partir d'une réponse Supabase (Auth, PostgREST, fonction).
fn error_message(code: u16, v: &Value) -> String {
    let error_code = v["error_code"].as_str().unwrap_or_default();
    let mapped = match error_code {
        "user_already_exists" | "email_exists" => Some("Un compte existe déjà avec cet e-mail : choisissez « J'ai déjà un compte »."),
        "phone_exists" => Some("Un compte existe déjà avec ce numéro WhatsApp : choisissez « J'ai déjà un compte »."),
        "weak_password" => Some("Mot de passe trop faible : au moins 8 caractères, avec des lettres et des chiffres."),
        "email_address_invalid" | "validation_failed" => Some("Adresse e-mail invalide."),
        "invalid_credentials" => Some("E-mail, numéro ou mot de passe incorrect."),
        "email_not_confirmed" => Some("Adresse e-mail pas encore confirmée : tapez le code reçu par e-mail."),
        "phone_not_confirmed" => Some("Numéro WhatsApp pas encore confirmé : tapez le code reçu sur WhatsApp."),
        "phone_provider_disabled" => Some("La connexion par WhatsApp n'est pas encore ouverte : utilisez votre e-mail."),
        "over_email_send_rate_limit" | "over_sms_send_rate_limit" | "over_request_rate_limit" => {
            Some("Trop de tentatives : réessayez dans quelques minutes.")
        }
        "signup_disabled" => Some("Les inscriptions sont fermées pour le moment : contactez Eden Dev."),
        "same_password" => Some("Le nouveau mot de passe doit être différent de l'ancien."),
        "otp_expired" | "otp_disabled" => Some("Code incorrect ou expiré : demandez un nouveau code."),
        "reauthentication_needed" | "session_not_found" | "bad_jwt" => Some("Session expirée : recommencez."),
        "email_address_not_authorized" => {
            Some("Inscription impossible : Eden Dev doit désactiver la confirmation des e-mails dans Supabase.")
        }
        _ => None,
    };
    if let Some(m) = mapped {
        return m.to_string();
    }
    for key in ["message", "msg", "error_description", "error"] {
        if let Some(m) = v[key].as_str().filter(|m| !m.trim().is_empty()) {
            return m.to_string();
        }
    }
    format!("Erreur du service Eden Dev ({code}).")
}

const NO_INTERNET: &str = "Connexion à Internet impossible : vérifiez la connexion de ce PC, puis réessayez.";
const CODE_REFUSED: &str = "Code incorrect ou expiré : demandez un nouveau code.";

/// Appel à Supabase : la réponse, ou le code d'erreur de Supabase (« email_not_confirmed »…) et le message
/// en français.
fn call_full(req: ureq::Request, body: Value) -> Result<Value, (String, String)> {
    match req.send_json(body) {
        Ok(resp) => {
            let text = resp.into_string().map_err(|e| (String::new(), e.to_string()))?;
            Ok(serde_json::from_str(&text).unwrap_or(Value::Null))
        }
        Err(ureq::Error::Status(code, resp)) => {
            let v: Value = resp.into_json().unwrap_or(Value::Null);
            Err((v["error_code"].as_str().unwrap_or_default().to_string(), error_message(code, &v)))
        }
        Err(_) => Err((String::new(), NO_INTERNET.to_string())),
    }
}

fn call(req: ureq::Request, body: Value) -> Result<Value, String> {
    call_full(req, body).map_err(|(_, m)| m)
}

/// Adresse e-mail en minuscules, refusée si elle n'en a pas la forme.
fn valid_email(email: &str) -> Result<String, String> {
    let email = email.trim().to_lowercase();
    if !email.contains('@') || !email.contains('.') || email.contains(char::is_whitespace) {
        return Err("Adresse e-mail invalide.".into());
    }
    Ok(email)
}

const PHONE_INVALID: &str = "Numéro WhatsApp invalide : tapez-le avec l'indicatif du pays (ex. +223 76 59 36 76).";

/// Numéro WhatsApp au format international (+22376593676) : espaces, points et tirets ignorés, « 00 » vaut « + ».
/// Sans indicatif, un numéro à 8 chiffres est pris pour un numéro du Mali.
fn valid_phone(s: &str) -> Result<String, String> {
    let t: String = s.chars().filter(|c| !c.is_whitespace() && !matches!(c, '-' | '.' | '(' | ')')).collect();
    let (international, digits) = match (t.strip_prefix('+'), t.strip_prefix("00")) {
        (Some(d), _) | (None, Some(d)) => (true, d),
        _ => (false, t.as_str()),
    };
    if digits.is_empty() || !digits.chars().all(|c| c.is_ascii_digit()) {
        return Err(PHONE_INVALID.into());
    }
    let full = if international || digits.len() >= 11 {
        digits.to_string()
    } else if digits.len() == 8 {
        format!("223{digits}")
    } else {
        return Err(PHONE_INVALID.into());
    };
    if !(8..=15).contains(&full.len()) || full.starts_with('0') {
        return Err(PHONE_INVALID.into());
    }
    Ok(format!("+{full}"))
}

/// Identifiant du compte Eden Dev : adresse e-mail, ou numéro WhatsApp au format international.
#[derive(Debug, Clone, PartialEq)]
enum Login {
    Email(String),
    Phone(String),
}

impl Login {
    /// E-mail si l'identifiant contient « @ », sinon numéro WhatsApp.
    fn parse(s: &str) -> Result<Login, String> {
        if s.contains('@') {
            valid_email(s).map(Login::Email)
        } else {
            valid_phone(s).map(Login::Phone)
        }
    }

    fn value(&self) -> &str {
        match self {
            Login::Email(v) | Login::Phone(v) => v,
        }
    }

    fn is_phone(&self) -> bool {
        matches!(self, Login::Phone(_))
    }

    /// Corps d'une requête Supabase Auth avec l'identifiant (« email » ou « phone »).
    fn body(&self, mut body: Value) -> Value {
        let (key, value) = match self {
            Login::Email(v) => ("email", v),
            Login::Phone(v) => ("phone", v),
        };
        body[key] = json!(value);
        body
    }

    /// Type du code à vérifier : celui des e-mails (`email_kind`), ou « sms » pour un code reçu sur WhatsApp.
    fn code_kind<'a>(&self, email_kind: &'a str) -> &'a str {
        if self.is_phone() {
            "sms"
        } else {
            email_kind
        }
    }
}

/// Code à 6 chiffres reçu par e-mail ou sur WhatsApp (inscription, connexion, mot de passe oublié, changement
/// d'adresse ou de numéro), vérifié par Supabase : la réponse contient la session du compte.
fn verify_code(kind: &str, login: &Login, code: &str) -> Result<Value, String> {
    let code: String = code.chars().filter(char::is_ascii_digit).collect();
    if code.len() < 6 {
        return Err("Tapez le code reçu (6 chiffres).".into());
    }
    call(request("/auth/v1/verify", None), login.body(json!({ "type": kind, "token": code })))
}

/// À confirmer avec le code reçu : « confirm_email » (code par e-mail) ou « confirm_phone » (code sur WhatsApp).
fn confirm_status(login: &Login) -> Value {
    let status = if login.is_phone() { "confirm_phone" } else { "confirm_email" };
    json!({ "status": status, "email": login.value() })
}

/// Utilisateur Supabase de la session (e-mail, numéro).
fn get_user(token: &str) -> Result<Value, String> {
    match request_method("GET", "/auth/v1/user", Some(token)).call() {
        Ok(resp) => resp.into_json().map_err(|e| e.to_string()),
        Err(ureq::Error::Status(code, resp)) => Err(error_message(code, &resp.into_json().unwrap_or(Value::Null))),
        Err(_) => Err(NO_INTERNET.to_string()),
    }
}

fn rpc_call(name: &str, token: &str, body: Value) -> Result<Value, String> {
    call(request(&format!("/rest/v1/rpc/{name}"), Some(token)), body)
}

/// Jeton de la propriétaire connectée (en mémoire uniquement, le temps de l'activation).
static SESSION: Mutex<Option<(String, String, Instant)>> = Mutex::new(None);

fn remember(email: &str, token: &str) {
    *SESSION.lock().unwrap_or_else(|e| e.into_inner()) = Some((email.to_string(), token.to_string(), Instant::now()));
}

fn session() -> Result<(String, String), String> {
    match SESSION.lock().unwrap_or_else(|e| e.into_inner()).as_ref() {
        Some((email, token, at)) if at.elapsed() < Duration::from_secs(50 * 60) => Ok((email.clone(), token.clone())),
        _ => Err("Connectez-vous d'abord à votre compte boutique.".into()),
    }
}

/// Connexion par mot de passe, avec l'e-mail ou le numéro WhatsApp du compte.
fn password_login_full(login: &str, password: &str) -> Result<String, (String, String)> {
    let login = Login::parse(login).map_err(|m| (String::new(), m))?;
    let v = call_full(request("/auth/v1/token?grant_type=password", None), login.body(json!({ "password": password })))?;
    v["access_token"].as_str().map(String::from).ok_or_else(|| (String::new(), "Réponse de connexion invalide.".to_string()))
}

fn password_login(login: &str, password: &str) -> Result<String, String> {
    password_login_full(login, password).map_err(|(_, m)| m)
}

#[derive(Debug, Deserialize)]
pub struct StoreInput {
    pub name: String,
    pub owner_name: String,
    pub phone: Option<String>,
    pub country: String,
    pub city: String,
    pub address: String,
    pub shop_type: String,
}

impl StoreInput {
    fn validate(&self) -> Result<(), String> {
        for (value, label) in [
            (&self.name, "le nom de la boutique"),
            (&self.owner_name, "le nom complet de la propriétaire"),
            (&self.country, "le pays"),
            (&self.city, "la ville"),
            (&self.address, "l'adresse"),
            (&self.shop_type, "le type de boutique"),
        ] {
            if value.trim().is_empty() {
                return Err(format!("Renseignez {label}."));
            }
        }
        Ok(())
    }

    fn to_json(&self) -> Value {
        json!({
            "name": self.name.trim(), "owner_name": self.owner_name.trim(), "phone": self.phone.as_deref().unwrap_or("").trim(),
            "country": self.country, "city": self.city.trim(), "address": self.address.trim(), "shop_type": self.shop_type,
        })
    }
}

#[derive(Debug, Deserialize)]
pub struct SignupInput {
    /// Compte créé avec un e-mail…
    #[serde(default)]
    pub email: String,
    /// … ou avec un numéro WhatsApp (le téléphone de la boutique est `store.phone`).
    #[serde(default)]
    pub whatsapp: String,
    pub password: String,
    /// Version des conditions d'utilisation et de la licence acceptée avant la création du compte.
    #[serde(default)]
    pub terms_version: Option<String>,
    #[serde(flatten)]
    pub store: StoreInput,
}

/// Listes du formulaire (pays, types de boutique) et formules.
pub fn options() -> Result<Value, String> {
    call(request("/rest/v1/rpc/gm_public_options", None), json!({}))
}

/// Création du compte (e-mail ou numéro WhatsApp), de la boutique (essai gratuit) et rattachement de ce PC.
pub fn signup(state: &AppState, input: SignupInput) -> Result<Value, String> {
    let login = if input.whatsapp.trim().is_empty() {
        Login::Email(valid_email(&input.email)?)
    } else {
        Login::Phone(valid_phone(&input.whatsapp)?)
    };
    password_ok(&input.password)?;
    let mut store = input.store;
    store.validate()?;
    // Compte WhatsApp : le téléphone de la boutique, s'il manque, est ce numéro.
    if let Login::Phone(p) = &login {
        if store.phone.as_deref().unwrap_or("").trim().is_empty() {
            store.phone = Some(p.clone());
        }
    }
    let data = json!({
        "owner_name": store.owner_name.trim(), "shop_name": store.name.trim(),
        "terms_version": input.terms_version.as_deref().unwrap_or(crate::services::terms::TERMS_VERSION),
        "terms_accepted_at": chrono::Utc::now().to_rfc3339(),
    });
    let v = call(request("/auth/v1/signup", None), login.body(json!({ "password": input.password, "data": data })))?;
    let Some(token) = v["access_token"].as_str() else {
        // Confirmation activée dans Supabase : un code part (e-mail ou WhatsApp) ; la boutique sera créée
        // quand il sera tapé (signup_confirm).
        return Ok(confirm_status(&login));
    };
    remember(login.value(), token);
    let created = rpc_call("gm_register_store", token, json!({ "p": store.to_json() }))?;
    link(state, created["code"].as_str().unwrap_or_default())
}

/// Inscription confirmée avec le code reçu (e-mail ou WhatsApp) : la boutique est créée, puis ce PC y est rattaché.
pub fn signup_confirm(state: &AppState, login: &str, code: &str, store: StoreInput) -> Result<Value, String> {
    store.validate()?;
    let login = Login::parse(login)?;
    let v = verify_code(login.code_kind("signup"), &login, code)?;
    let token = v["access_token"].as_str().ok_or(CODE_REFUSED)?;
    remember(login.value(), token);
    let created = rpc_call("gm_register_store", token, json!({ "p": store.to_json() }))?;
    link(state, created["code"].as_str().unwrap_or_default())
}

/// Nouveau code d'inscription (le premier n'est pas arrivé, ou a expiré), par e-mail ou sur WhatsApp.
pub fn signup_resend(login: &str) -> Result<Value, String> {
    let login = Login::parse(login)?;
    call(request("/auth/v1/resend", None), login.body(json!({ "type": login.code_kind("signup") })))?;
    Ok(json!({ "sent": true }))
}

/// Connexion par un code reçu sur WhatsApp, sans mot de passe : Supabase envoie le code au numéro du compte
/// (aucun compte n'est créé ainsi). Le code se vérifie ensuite comme celui de l'inscription.
pub fn otp_send(login: &str) -> Result<Value, String> {
    let login = Login::parse(login)?;
    if !login.is_phone() {
        return Err("Le code sur WhatsApp demande le numéro du compte : tapez-le à la place de l'e-mail.".into());
    }
    call_full(request("/auth/v1/otp", None), login.body(json!({ "create_user": false }))).map_err(|(code, m)| {
        if code == "otp_disabled" || code == "user_not_found" {
            "Aucun compte avec ce numéro WhatsApp : créez d'abord le compte.".to_string()
        } else {
            m
        }
    })?;
    Ok(json!({ "sent": true }))
}

/// Nouveau mot de passe du compte Eden Dev : 8 caractères au moins, des lettres et des chiffres, et pas un
/// mot de passe connu de tous (ce compte ouvre la boutique à distance et paie l'abonnement).
pub fn password_ok(password: &str) -> Result<(), String> {
    const COMMON: &[&str] = &[
        "12345678", "123456789", "1234567890", "87654321", "12341234", "11223344", "a1234567", "aa123456", "abc12345",
        "abcd1234", "password", "password1", "password123", "motdepasse", "motdepasse1", "azerty123", "azerty1234",
        "qwerty123", "qwerty1234", "azertyuiop", "gestimarket", "gestimarket1", "boutique1", "bamako123", "mali2024",
        "mali2025", "mali2026", "iloveyou1", "bonjour1", "bonjour123",
    ];
    if password.chars().count() < 8 {
        return Err("Mot de passe trop court : au moins 8 caractères, avec des lettres et des chiffres.".into());
    }
    if !password.chars().any(char::is_alphabetic) || !password.chars().any(|c| c.is_ascii_digit()) {
        return Err("Mot de passe trop faible : mélangez des lettres et des chiffres.".into());
    }
    let lower = password.to_lowercase();
    let first = lower.chars().next().unwrap_or(' ');
    if COMMON.contains(&lower.as_str()) || lower.chars().all(|c| c == first) {
        return Err("Mot de passe trop connu : choisissez-en un autre.".into());
    }
    Ok(())
}

/// « Mot de passe oublié » : Supabase envoie un code à l'adresse du compte, ou sur WhatsApp au numéro du compte
/// (rien n'indique si le compte existe : même réponse dans tous les cas).
pub fn password_recover(login: &str) -> Result<Value, String> {
    match Login::parse(login)? {
        Login::Email(email) => {
            call(request("/auth/v1/recover", None), json!({ "email": email }))?;
        }
        phone => match call_full(request("/auth/v1/otp", None), phone.body(json!({ "create_user": false }))) {
            Ok(_) => {}
            Err((code, _)) if code == "otp_disabled" || code == "user_not_found" => {}
            Err((_, m)) => return Err(m),
        },
    }
    Ok(json!({ "sent": true }))
}

fn set_password(access: &str, password: &str) -> Result<(), String> {
    call(request_method("PUT", "/auth/v1/user", Some(access)), json!({ "password": password })).map(|_| ())
}

/// Code reçu (e-mail ou WhatsApp) et nouveau mot de passe. `stay` : la propriétaire reste connectée sur cet
/// appareil (Espace propriétaire).
pub fn password_reset(dir: &std::path::Path, login: &str, code: &str, password: &str, stay: bool) -> Result<Value, String> {
    password_ok(password)?;
    let login = Login::parse(login)?;
    let v = verify_code(login.code_kind("recovery"), &login, code)?;
    let access = v["access_token"].as_str().ok_or(CODE_REFUSED)?;
    set_password(access, password)?;
    if stay {
        owner_login(dir, login.value(), password)?;
    }
    Ok(json!({ "ok": true }))
}

/// Changer le mot de passe : l'actuel est vérifié d'abord. L'Espace propriétaire de cet appareil reste connecté.
pub fn password_change(dir: &std::path::Path, login: &str, current: &str, password: &str) -> Result<Value, String> {
    password_ok(password)?;
    if current == password {
        return Err("Le nouveau mot de passe doit être différent de l'actuel.".into());
    }
    let login = Login::parse(login)?;
    let access = password_login(login.value(), current)?;
    set_password(&access, password)?;
    // Supabase peut fermer les autres sessions du compte : on reconnecte celle de cet appareil.
    if owner_saved(dir).is_some_and(|(e, _)| e == login.value()) {
        let _ = owner_login(dir, login.value(), password);
    }
    Ok(json!({ "ok": true }))
}

/// Connexion (e-mail ou numéro WhatsApp) : retourne les boutiques du compte (à rattacher, ou à créer). Compte
/// pas encore confirmé : `status` « confirm_email » ou « confirm_phone » (le code reçu se tape alors, voir
/// login_confirm).
pub fn login(login: &str, password: &str) -> Result<Value, String> {
    let login = Login::parse(login)?;
    let token = match password_login_full(login.value(), password) {
        Ok(t) => t,
        Err((code, _)) if code == "email_not_confirmed" || code == "phone_not_confirmed" => return Ok(confirm_status(&login)),
        Err((_, m)) => return Err(m),
    };
    remember(login.value(), &token);
    let stores = rpc_call("gm_my_stores", &token, json!({}))?;
    Ok(json!({ "status": "ok", "email": login.value(), "stores": stores }))
}

/// Code reçu (confirmation de l'inscription, ou connexion par code WhatsApp) : boutiques du compte.
pub fn login_confirm(login: &str, code: &str) -> Result<Value, String> {
    let login = Login::parse(login)?;
    let v = verify_code(login.code_kind("signup"), &login, code)?;
    let token = v["access_token"].as_str().ok_or(CODE_REFUSED)?;
    remember(login.value(), token);
    let stores = rpc_call("gm_my_stores", token, json!({}))?;
    Ok(json!({ "status": "ok", "email": login.value(), "stores": stores }))
}

/// Vérifie que l'identifiant (e-mail ou numéro WhatsApp) et le mot de passe sont ceux du compte de la boutique
/// reliée à ce PC (autoriser un téléphone, refaire le PIN administrateur oublié). Le jeton n'est pas gardé.
pub fn verify_owner(login: &str, password: &str) -> Result<(), String> {
    let store_code = license::account().store_code;
    if store_code.is_empty() {
        return Err("Ce PC n'est relié à aucun compte boutique (menu Abonnement & licence).".into());
    }
    let token = password_login(login, password)?;
    let stores = rpc_call("gm_my_stores", &token, json!({}))?;
    let owns = stores.as_array().is_some_and(|list| list.iter().any(|s| s["code"].as_str() == Some(store_code.as_str())));
    if !owns {
        return Err("Ce compte n'est pas celui de cette boutique.".into());
    }
    Ok(())
}

/// Adresse Internet automatique : Eden Dev crée (ou redonne) le tunnel Cloudflare de la boutique de ce PC,
/// vers le port du poste serveur. Retourne l'adresse publique et le jeton à donner à cloudflared.
pub fn request_tunnel(email: &str, password: &str, port: u16) -> Result<(String, String), String> {
    let store_code = license::account().store_code;
    if store_code.is_empty() {
        return Err("Ce PC n'est relié à aucun compte boutique (menu Abonnement & licence).".into());
    }
    let token = password_login(email, password)?;
    let v = call(request("/functions/v1/gm-tunnel", Some(&token)), json!({ "store_code": store_code, "port": port }))?;
    match (v["status"].as_str(), v["url"].as_str(), v["token"].as_str()) {
        (Some("ok"), Some(url), Some(t)) if url.starts_with("https://") && !t.is_empty() => Ok((url.to_string(), t.to_string())),
        _ => Err(v["message"].as_str().unwrap_or("Réponse inattendue d'Eden Dev.").to_string()),
    }
}

/// Nouvelle boutique sur le compte connecté (5 au maximum), rattachée à ce PC.
pub fn create_store(state: &AppState, input: StoreInput) -> Result<Value, String> {
    input.validate()?;
    let (_, token) = session()?;
    let store = rpc_call("gm_register_store", &token, json!({ "p": input.to_json() }))?;
    link(state, store["code"].as_str().unwrap_or_default())
}

/// Rattache ce PC (et ce numéro de boutique sur le PC) à une boutique du compte, puis télécharge la licence.
pub fn link(state: &AppState, store_code: &str) -> Result<Value, String> {
    let (email, token) = session()?;
    let store = rpc_call(
        "gm_register_pc",
        &token,
        json!({
            "p_store_code": store_code, "p_pc_id": license::pc_id(), "p_slot": license::slot(),
            "p_hostname": crate::network::hostname(), "p_version": env!("CARGO_PKG_VERSION"),
        }),
    )?;
    {
        let conn = state.conn();
        license::set_account(&conn, &email, store["code"].as_str().unwrap_or(store_code), store["name"].as_str().unwrap_or_default());
    }
    let synced = sync(state);
    Ok(json!({ "status": "linked", "store": store, "sync_error": synced.err() }))
}

// ───────────────────────────── Paiement de l'abonnement ─────────────────────────────
// Le PC est identifié par son identifiant, relié à la boutique lors de l'activation : pas de mot de
// passe à retaper. Trois moyens : carte de bon, Orange Money (Sarali), carte Visa (Cybersource).

/// Fonction Supabase appelée au nom de ce PC (sans compte).
fn pc_rpc(name: &str, body: Value) -> Result<Value, String> {
    call(request(&format!("/rest/v1/rpc/{name}"), None), body)
}

/// Erreur du programme envoyée à Eden Dev (voir report.rs : aucune donnée commerciale).
pub fn report_error(body: Value) -> Result<Value, String> {
    pc_rpc("gm_report_error", body)
}

/// Après un paiement, la licence est vérifiée toutes les 2 minutes pendant 24 h (au lieu de 30 minutes),
/// pour qu'elle se mette à jour peu après la validation par Eden Dev ou par Cybersource.
static FAST_SYNC_UNTIL: Mutex<Option<Instant>> = Mutex::new(None);

fn sync_soon() {
    *FAST_SYNC_UNTIL.lock().unwrap_or_else(|e| e.into_inner()) = Some(Instant::now() + Duration::from_secs(24 * 3600));
}

pub fn fast_sync() -> bool {
    matches!(*FAST_SYNC_UNTIL.lock().unwrap_or_else(|e| e.into_inner()), Some(t) if Instant::now() < t)
}

/// Derniers paiements de la boutique (état : en attente, validé, refusé…).
pub fn payments() -> Result<Value, String> {
    pc_rpc("gm_pc_payments", json!({ "p_pc_id": license::pc_id() }))
}

/// Carte de bon : l'abonnement est activé tout de suite, puis la licence est téléchargée.
pub fn redeem_voucher(state: &AppState, code: &str) -> Result<Value, String> {
    let v = pc_rpc("gm_redeem_voucher", json!({ "p_pc_id": license::pc_id(), "p_code": code.trim() }))?;
    if v["ok"].as_bool() != Some(true) {
        return Err(v["error"].as_str().unwrap_or("Carte de bon refusée.").to_string());
    }
    let synced = sync(state);
    Ok(json!({ "voucher": v, "sync_error": synced.err() }))
}

/// Orange Money (Sarali) : l'ID de transaction est envoyé à Eden Dev, qui valide le paiement.
pub fn declare_orange_money(plan: &str, months: i64, reference: &str, payer_phone: &str) -> Result<Value, String> {
    let r = pc_rpc(
        "gm_pc_declare_payment",
        json!({
            "p_pc_id": license::pc_id(), "p_plan": plan, "p_months": months,
            "p_reference": reference.trim(), "p_payer_phone": payer_phone.trim(),
        }),
    )?;
    sync_soon();
    Ok(r)
}

fn html_escape(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;").replace('\'', "&#39;")
}

/// Page locale qui envoie aussitôt le formulaire signé à la page de paiement sécurisée de Cybersource.
pub fn card_page(endpoint: &str, fields: &serde_json::Map<String, Value>) -> Result<String, String> {
    if !(endpoint.starts_with("https://secureacceptance.cybersource.com/") || endpoint.starts_with("https://testsecureacceptance.cybersource.com/")) {
        return Err("Adresse de paiement inattendue : paiement annulé.".into());
    }
    let inputs: String = fields
        .iter()
        .map(|(k, v)| format!("<input type=\"hidden\" name=\"{}\" value=\"{}\">\n", html_escape(k), html_escape(v.as_str().unwrap_or_default())))
        .collect();
    Ok(format!(
        "<!doctype html>\n<html lang=\"fr\"><head><meta charset=\"utf-8\"><title>Paiement par carte Visa — GestiMarket</title></head>\n\
         <body onload=\"document.forms[0].submit()\" style=\"font-family:system-ui,sans-serif;text-align:center;padding:48px\">\n\
         <h2>Paiement de l'abonnement GestiMarket</h2>\n<p>Ouverture de la page de paiement sécurisée de Visa (Cybersource)…</p>\n\
         <form method=\"post\" action=\"{}\" accept-charset=\"UTF-8\">\n{inputs}<button type=\"submit\" style=\"font-size:16px;padding:10px 18px\">Continuer vers le paiement</button>\n</form>\n\
         </body></html>\n",
        html_escape(endpoint)
    ))
}

/// Ouvre un fichier ou une adresse avec le navigateur par défaut.
fn open_in_browser(path: &std::path::Path) -> Result<(), String> {
    #[cfg(windows)]
    let r = std::process::Command::new("explorer").arg(path).spawn();
    #[cfg(target_os = "macos")]
    let r = std::process::Command::new("open").arg(path).spawn();
    #[cfg(all(unix, not(target_os = "macos")))]
    let r = std::process::Command::new("xdg-open").arg(path).spawn();
    r.map(|_| ()).map_err(|e| format!("Impossible d'ouvrir le navigateur : {e}"))
}

/// Carte Visa : la fonction « gm-pay » signe la demande ; la page de paiement de Cybersource s'ouvre
/// dans le navigateur. Le résultat arrive à Supabase ; l'application suit l'état du paiement.
pub fn card_start(plan: &str, months: i64) -> Result<Value, String> {
    let v = call(request("/functions/v1/gm-pay", None), json!({ "pc_id": license::pc_id(), "plan": plan, "months": months }))?;
    if v["status"].as_str() != Some("ok") {
        return Err(v["message"].as_str().unwrap_or("Paiement par carte indisponible.").to_string());
    }
    let fields = v["fields"].as_object().ok_or("Réponse de paiement invalide.")?;
    let html = card_page(v["endpoint"].as_str().unwrap_or_default(), fields)?;
    let id: String = v["payment_id"].as_str().unwrap_or_default().chars().filter(char::is_ascii_alphanumeric).take(12).collect();
    let path = std::env::temp_dir().join(format!("gestimarket-paiement-{id}.html"));
    std::fs::write(&path, html).map_err(|e| format!("Page de paiement impossible à préparer : {e}"))?;
    open_in_browser(&path)?;
    sync_soon();
    Ok(json!({
        "payment_id": v["payment_id"], "amount": v["amount"], "currency": v["currency"],
        "plan_label": v["plan_label"], "months": v["months"],
    }))
}

// ───────────────────────────── Espace propriétaire (téléphone, tablette) ─────────────────────────────
// Ce que faisait l'application FlutterFlow, dans l'application GestiMarket : le compte Eden Dev de la
// propriétaire, ses boutiques (PC serveur allumé ou éteint, abonnement), ses paiements.
// La connexion reste ouverte (jeton de rafraîchissement gardé dans le dossier privé de l'application,
// effacé par « Se déconnecter »). La liste des boutiques est gardée : elle reste lisible sans Internet.
// Ces fonctions ne sont appelées que par cet appareil (commande Tauri « owner »), jamais par le réseau.

const OWNER_FILE: &str = "proprietaire.json";
const OWNER_CACHE: &str = "proprietaire-boutiques.json";

static OWNER: Mutex<Option<(String, Instant)>> = Mutex::new(None);

/// Connexion par e-mail et mot de passe : jeton d'accès et jeton de rafraîchissement.
fn owner_tokens(body: Value, grant: &str) -> Result<(String, String), String> {
    let v = call(request(&format!("/auth/v1/token?grant_type={grant}"), None), body)?;
    let access = v["access_token"].as_str().ok_or("Réponse de connexion invalide.")?;
    let refresh = v["refresh_token"].as_str().ok_or("Réponse de connexion invalide.")?;
    Ok((access.to_string(), refresh.to_string()))
}

fn owner_save(dir: &std::path::Path, email: &str, refresh: &str) {
    let _ = std::fs::create_dir_all(dir);
    let _ = std::fs::write(dir.join(OWNER_FILE), json!({ "email": email, "refresh_token": refresh }).to_string());
}

fn owner_saved(dir: &std::path::Path) -> Option<(String, String)> {
    let v: Value = serde_json::from_str(&std::fs::read_to_string(dir.join(OWNER_FILE)).ok()?).ok()?;
    Some((v["email"].as_str()?.to_string(), v["refresh_token"].as_str()?.to_string()))
}

/// Jeton d'accès de la propriétaire : gardé 50 minutes, puis renouvelé avec le jeton de rafraîchissement.
fn owner_token(dir: &std::path::Path) -> Result<String, String> {
    if let Some((token, at)) = OWNER.lock().unwrap_or_else(|e| e.into_inner()).clone() {
        if at.elapsed() < Duration::from_secs(50 * 60) {
            return Ok(token);
        }
    }
    let Some((email, refresh)) = owner_saved(dir) else {
        return Err("Connectez-vous à votre compte boutique (Espace propriétaire).".into());
    };
    let (access, refresh) = owner_tokens(json!({ "refresh_token": refresh }), "refresh_token").map_err(|e| {
        if e == NO_INTERNET {
            e
        } else {
            // Session révoquée ou expirée : il faut se reconnecter.
            let _ = std::fs::remove_file(dir.join(OWNER_FILE));
            "Votre connexion au compte boutique a expiré : reconnectez-vous.".to_string()
        }
    })?;
    owner_save(dir, &email, &refresh);
    *OWNER.lock().unwrap_or_else(|e| e.into_inner()) = Some((access.clone(), Instant::now()));
    Ok(access)
}

/// Connexion de la propriétaire (e-mail ou numéro WhatsApp), puis ses boutiques. Compte pas encore confirmé :
/// `status` « confirm_email » ou « confirm_phone » (le code reçu se tape alors, voir owner_confirm).
pub fn owner_login(dir: &std::path::Path, login: &str, password: &str) -> Result<Value, String> {
    let login = Login::parse(login)?;
    match call_full(request("/auth/v1/token?grant_type=password", None), login.body(json!({ "password": password }))) {
        Ok(v) => owner_start(dir, login.value(), &v),
        Err((code, _)) if code == "email_not_confirmed" || code == "phone_not_confirmed" => Ok(confirm_status(&login)),
        Err((_, m)) => Err(m),
    }
}

/// Session reçue de Supabase (connexion, code confirmé) : gardée sur l'appareil, puis les boutiques.
fn owner_start(dir: &std::path::Path, email: &str, v: &Value) -> Result<Value, String> {
    let access = v["access_token"].as_str().ok_or(CODE_REFUSED)?;
    let refresh = v["refresh_token"].as_str().ok_or("Réponse de connexion invalide.")?;
    owner_save(dir, email, refresh);
    *OWNER.lock().unwrap_or_else(|e| e.into_inner()) = Some((access.to_string(), Instant::now()));
    owner_stores(dir)
}

/// Espace propriétaire : code reçu (confirmation de l'inscription, ou connexion par code WhatsApp), et la
/// propriétaire connectée.
pub fn owner_confirm(dir: &std::path::Path, login: &str, code: &str) -> Result<Value, String> {
    let login = Login::parse(login)?;
    let v = verify_code(login.code_kind("signup"), &login, code)?;
    owner_start(dir, login.value(), &v)
}

/// « Se déconnecter » : la session et la liste gardée sont effacées de l'appareil.
pub fn owner_logout(dir: &std::path::Path) {
    *OWNER.lock().unwrap_or_else(|e| e.into_inner()) = None;
    let _ = std::fs::remove_file(dir.join(OWNER_FILE));
    let _ = std::fs::remove_file(dir.join(OWNER_CACHE));
}

/// Boutiques de la propriétaire, avec l'état du PC serveur de chacune. Sans Internet : la dernière liste.
pub fn owner_stores(dir: &std::path::Path) -> Result<Value, String> {
    let saved = owner_saved(dir);
    let cached = || -> Option<Value> { serde_json::from_str(&std::fs::read_to_string(dir.join(OWNER_CACHE)).ok()?).ok() };
    let fresh = (|| -> Result<Value, String> {
        let token = owner_token(dir)?;
        let stores = rpc_call("gm_my_stores", &token, json!({}))?;
        let mut list = Vec::new();
        for mut s in stores.as_array().cloned().unwrap_or_default() {
            let code = s["code"].as_str().unwrap_or_default().to_string();
            s["server"] = rpc_call("gm_my_server", &token, json!({ "p_store_code": code })).unwrap_or(json!({ "found": false }));
            list.push(s);
        }
        Ok(json!({
            "email": saved.as_ref().map(|(e, _)| e.clone()).unwrap_or_default(),
            "stores": list,
            "offline": false,
            "at": chrono::Utc::now().to_rfc3339(),
        }))
    })();
    match fresh {
        Ok(v) => {
            let _ = std::fs::write(dir.join(OWNER_CACHE), v.to_string());
            Ok(v)
        }
        Err(e) if e == NO_INTERNET => match cached() {
            Some(mut v) => {
                v["offline"] = json!(true);
                Ok(v)
            }
            None => Err(e),
        },
        Err(e) => Err(e),
    }
}

/// La propriétaire est-elle connectée sur cet appareil ? (sans appel réseau)
pub fn owner_status(dir: &std::path::Path) -> Value {
    match owner_saved(dir) {
        Some((email, _)) => json!({ "connected": true, "email": email }),
        None => json!({ "connected": false }),
    }
}

/// Derniers paiements d'une boutique (en attente, validés, refusés).
pub fn owner_payments(dir: &std::path::Path, store_code: &str) -> Result<Value, String> {
    let token = owner_token(dir)?;
    rpc_call("gm_my_payments", &token, json!({ "p_store_code": store_code }))
}

/// Carte de bon saisie sur le téléphone : l'abonnement de la boutique est activé tout de suite.
pub fn owner_redeem(dir: &std::path::Path, store_code: &str, code: &str) -> Result<Value, String> {
    let token = owner_token(dir)?;
    let r = rpc_call("gm_my_redeem_voucher", &token, json!({ "p_store_code": store_code, "p_code": code.trim() }))?;
    if r["ok"].as_bool() == Some(false) {
        return Err(r["error"].as_str().unwrap_or("Carte de bon refusée.").to_string());
    }
    Ok(r)
}

/// Paiement mobile (Orange Money, Moov Money) déclaré avec la référence reçue par SMS : Eden Dev le valide.
pub fn owner_declare(dir: &std::path::Path, store_code: &str, plan: &str, months: i64, method: &str, reference: &str, phone: &str) -> Result<Value, String> {
    let token = owner_token(dir)?;
    rpc_call(
        "gm_declare_payment",
        &token,
        json!({
            "p_store_code": store_code, "p_plan": plan, "p_months": months, "p_method": method,
            "p_reference": reference.trim(), "p_payer_phone": phone.trim(),
        }),
    )
}

// ───────────────────────────── Adresse e-mail du compte ─────────────────────────────
// Le mot de passe actuel est vérifié, puis Supabase envoie un code à la nouvelle adresse (et un autre à
// l'ancienne si « Secure email change » est activé). Sans confirmation des e-mails (réglage « Confirm email »
// de Supabase), l'adresse change tout de suite. Les boutiques du compte suivent (déclencheur gm_account_email).

/// Demande de changement : `done` si l'adresse a déjà changé, sinon un code est parti à la nouvelle adresse.
/// `login` : l'identifiant avec lequel la propriétaire se connecte (un compte WhatsApp peut ainsi ajouter un e-mail).
pub fn email_change_start(dir: &std::path::Path, login: &str, password: &str, new_email: &str) -> Result<Value, String> {
    let old = Login::parse(login)?;
    let new = valid_email(new_email)?;
    if new == old.value() {
        return Err("La nouvelle adresse est la même que l'actuelle.".into());
    }
    let access = password_login(old.value(), password)?;
    let v = call_full(request_method("PUT", "/auth/v1/user", Some(&access)), json!({ "email": new })).map_err(|(code, m)| {
        if code == "email_exists" || code == "user_already_exists" {
            "Cette adresse e-mail est déjà celle d'un autre compte.".to_string()
        } else {
            m
        }
    })?;
    let done = v["email"].as_str().is_some_and(|e| e.eq_ignore_ascii_case(&new));
    if done {
        login_changed(dir, old.value(), &new, None);
    }
    Ok(json!({ "done": done, "email": new, "old_email": old.value(), "old_login": old.value(), "new_login": new }))
}

/// Code reçu à la nouvelle adresse (`which` « new »), ou à l'ancienne (« old ») quand Supabase en demande deux.
pub fn email_change_confirm(dir: &std::path::Path, old: &str, new: &str, code: &str, which: &str) -> Result<Value, String> {
    let old = Login::parse(old)?;
    let new = valid_email(new)?;
    let target = if which == "old" { old.clone() } else { Login::Email(new.clone()) };
    let v = verify_code("email_change", &target, code)?;
    let done = v["access_token"].is_string();
    if done {
        login_changed(dir, old.value(), &new, v["refresh_token"].as_str());
    }
    // Pas encore fait : « Secure email change », le code envoyé à l'autre adresse est aussi demandé.
    Ok(json!({ "done": done, "other": !done, "email": new, "old_email": old.value(), "old_login": old.value(), "new_login": new }))
}

// ───────────────────────────── Numéro WhatsApp du compte ─────────────────────────────
// Ajouter ou changer le numéro : le mot de passe est vérifié, puis un code part sur WhatsApp au nouveau numéro
// (fonction gm-whatsapp). Le compte s'ouvre ensuite aussi avec ce numéro.

/// Demande d'ajout ou de changement : `done` si Supabase l'a fait tout de suite (numéros sans confirmation).
pub fn phone_change_start(dir: &std::path::Path, login: &str, password: &str, new_phone: &str) -> Result<Value, String> {
    let old = Login::parse(login)?;
    let new = valid_phone(new_phone)?;
    if new == old.value() {
        return Err("Ce numéro est déjà celui du compte.".into());
    }
    let access = password_login(old.value(), password)?;
    let v = call_full(request_method("PUT", "/auth/v1/user", Some(&access)), json!({ "phone": new })).map_err(|(code, m)| {
        if code == "phone_exists" || code == "user_already_exists" {
            "Ce numéro WhatsApp est déjà celui d'un autre compte.".to_string()
        } else {
            m
        }
    })?;
    let done = v["phone"].as_str().is_some_and(|p| p.trim_start_matches('+') == new.trim_start_matches('+'));
    if done {
        login_changed(dir, old.value(), &new, None);
    }
    Ok(json!({ "done": done, "phone": new, "old_login": old.value(), "new_login": new }))
}

/// Code reçu sur WhatsApp au nouveau numéro.
pub fn phone_change_confirm(dir: &std::path::Path, old: &str, new_phone: &str, code: &str) -> Result<Value, String> {
    let old = Login::parse(old)?;
    let new = valid_phone(new_phone)?;
    let v = verify_code("phone_change", &Login::Phone(new.clone()), code)?;
    if !v["access_token"].is_string() {
        return Err(CODE_REFUSED.into());
    }
    login_changed(dir, old.value(), &new, v["refresh_token"].as_str());
    Ok(json!({ "done": true, "phone": new, "old_login": old.value(), "new_login": new }))
}

/// E-mail et numéro WhatsApp du compte (Mon compte).
pub fn account_info(dir: &std::path::Path, login: &str, password: &str) -> Result<Value, String> {
    let token = account_token(dir, login, password)?;
    let u = get_user(&token)?;
    let phone = u["phone"].as_str().map(|p| p.trim_start_matches('+')).filter(|p| !p.is_empty()).map(|p| format!("+{p}"));
    Ok(json!({ "email": u["email"].as_str().unwrap_or_default(), "phone": phone.unwrap_or_default() }))
}

/// Nouvel identifiant : la connexion gardée de l'Espace propriétaire et celle du compte sur ce PC suivent, quand
/// elles utilisaient l'ancien (un e-mail remplace un e-mail, un numéro remplace un numéro).
fn login_changed(dir: &std::path::Path, old: &str, new: &str, refresh: Option<&str>) {
    if old.contains('@') != new.contains('@') {
        return;
    }
    if let Some((saved, saved_refresh)) = owner_saved(dir) {
        if saved == old {
            owner_save(dir, new, refresh.unwrap_or(&saved_refresh));
        }
    }
    if let Some((email, _, _)) = SESSION.lock().unwrap_or_else(|e| e.into_inner()).as_mut() {
        if email == old {
            *email = new.to_string();
        }
    }
}

/// Après une commande « owner » réussie : le nouvel identifiant du compte (e-mail ou numéro) est reporté sur la
/// boutique de ce PC (Abonnement & licence), si c'est l'ancien qui y était enregistré.
pub fn after_owner_action(conn: &rusqlite::Connection, action: &str, v: &Value) {
    let changes = matches!(action, "email_change_start" | "email_change_confirm" | "phone_change_start" | "phone_change_confirm");
    if !changes || v["done"].as_bool() != Some(true) {
        return;
    }
    let (Some(old), Some(new)) = (v["old_login"].as_str(), v["new_login"].as_str()) else { return };
    if old.contains('@') != new.contains('@') {
        return;
    }
    let account = license::account();
    if account.email.eq_ignore_ascii_case(old) {
        license::set_account(conn, new, &account.store_code, &account.store_name);
    }
}

// ───────────────────────────── Informations de la boutique ─────────────────────────────
// Nom complet de la propriétaire, téléphone, ville et adresse, enregistrés chez Eden Dev (gm_update_store).
// Le nom de la boutique, le pays et le type restent ceux de l'inscription.

/// Jeton du compte : avec le mot de passe (PC), ou la connexion gardée de l'Espace propriétaire (téléphone).
fn account_token(dir: &std::path::Path, login: &str, password: &str) -> Result<String, String> {
    if password.is_empty() {
        owner_token(dir)
    } else {
        password_login(login, password)
    }
}

/// Informations d'une boutique du compte, pour les modifier.
pub fn store_info(dir: &std::path::Path, store_code: &str, email: &str, password: &str) -> Result<Value, String> {
    let token = account_token(dir, email, password)?;
    let stores = rpc_call("gm_my_stores", &token, json!({}))?;
    stores
        .as_array()
        .and_then(|list| list.iter().find(|s| s["code"].as_str() == Some(store_code)).cloned())
        .ok_or_else(|| "Boutique introuvable sur ce compte.".to_string())
}

/// Enregistre les informations modifiées ; retourne la boutique à jour.
pub fn update_store(dir: &std::path::Path, a: &Value) -> Result<Value, String> {
    let text = |k: &str| a.get(k).and_then(Value::as_str).unwrap_or_default().trim().to_string();
    for (k, label) in [("owner_name", "le nom complet de la propriétaire"), ("city", "la ville"), ("address", "l'adresse")] {
        if text(k).is_empty() {
            return Err(format!("Renseignez {label}."));
        }
    }
    let token = account_token(dir, &text("email"), a.get("password").and_then(Value::as_str).unwrap_or_default())?;
    let info = json!({ "owner_name": text("owner_name"), "phone": text("phone"), "city": text("city"), "address": text("address") });
    let store = rpc_call("gm_update_store", &token, json!({ "p_store_code": text("store_code"), "p": info }))?;
    // Liste gardée de l'Espace propriétaire : relue au prochain affichage.
    let _ = std::fs::remove_file(dir.join(OWNER_CACHE));
    Ok(store)
}

/// Espace propriétaire et compte Eden Dev (mot de passe, e-mail, informations de la boutique) : commande
/// « owner » de cet appareil (jamais servie au réseau).
pub fn owner_action(dir: &std::path::Path, action: &str, a: &Value) -> Result<Value, String> {
    let text = |k: &str| a.get(k).and_then(Value::as_str).unwrap_or_default().to_string();
    match action {
        "status" => Ok(owner_status(dir)),
        "login" => owner_login(dir, &text("email"), &text("password")),
        "logout" => {
            owner_logout(dir);
            Ok(Value::Null)
        }
        "stores" => owner_stores(dir),
        "payments" => owner_payments(dir, &text("store_code")),
        "redeem" => owner_redeem(dir, &text("store_code"), &text("code")),
        "declare" => owner_declare(
            dir,
            &text("store_code"),
            &text("plan"),
            a.get("months").and_then(Value::as_i64).unwrap_or(1),
            &text("method"),
            &text("reference"),
            &text("phone"),
        ),
        "options" => options(),
        "recover" => password_recover(&text("email")),
        "reset_password" => password_reset(
            dir,
            &text("email"),
            &text("code"),
            &text("password"),
            a.get("login").and_then(Value::as_bool).unwrap_or(false),
        ),
        "change_password" => password_change(dir, &text("email"), &text("current"), &text("password")),
        "confirm_signup" => owner_confirm(dir, &text("email"), &text("code")),
        "resend_signup" => signup_resend(&text("email")),
        "otp_send" => otp_send(&text("email")),
        "account" => account_info(dir, &text("email"), &text("password")),
        "phone_change_start" => phone_change_start(dir, &text("email"), &text("password"), &text("new_phone")),
        "phone_change_confirm" => phone_change_confirm(dir, &text("old_login"), &text("new_phone"), &text("code")),
        "email_change_start" => email_change_start(dir, &text("email"), &text("password"), &text("new_email")),
        "email_change_confirm" => email_change_confirm(dir, &text("old_email"), &text("new_email"), &text("code"), &text("which")),
        "store_info" => store_info(dir, &text("store_code"), &text("email"), &text("password")),
        "update_store" => update_store(dir, a),
        _ => Err("Action inconnue.".to_string()),
    }
}

/// Synchronise la licence : la fonction « gm-license » la (re)signe si l'abonnement a changé,
/// puis le fichier est téléchargé depuis le bucket public et vérifié ici.
pub fn sync(state: &AppState) -> Result<String, String> {
    let result = (|| -> Result<String, String> {
        let v = call(request("/functions/v1/gm-license", None), json!({ "pc_id": license::pc_id() }))?;
        if let Some(t) = v["server_time"].as_str() {
            license::note_server_time(&state.conn(), t);
        }
        let current = license::current_license_id();
        if let (Some(cur), Some(revoked)) = (&current, v["revoked"].as_array()) {
            if revoked.iter().any(|x| x.as_str() == Some(cur.as_str())) {
                license::remove(&state.conn());
            }
        }
        let status = v["status"].as_str().unwrap_or("error").to_string();
        match status.as_str() {
            "ok" => {
                let id = v["license_id"].as_str().unwrap_or_default();
                let path = v["path"].as_str().unwrap_or_default();
                let path_ok = path.len() == 16 && path.ends_with(".gml") && path.as_bytes()[..12].iter().all(u8::is_ascii_alphanumeric);
                if license::current_license_id().as_deref() != Some(id) && path_ok {
                    let url = format!("{}/storage/v1/object/public/licences/{path}?v={id}", license::supabase_url());
                    let text = agent()
                        .get(&url)
                        .call()
                        .map_err(|_| "Téléchargement de la licence impossible : réessayez plus tard.".to_string())?
                        .into_string()
                        .map_err(|e| e.to_string())?;
                    license::install(&state.conn(), &text)?;
                }
            }
            "suspended" => license::remove(&state.conn()),
            "unregistered" | "none" => {}
            _ => return Err(v["message"].as_str().unwrap_or("Service des licences indisponible.").to_string()),
        }
        Ok(status)
    })();
    license::set_sync_result(&result);
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mots_de_passe_refuses() {
        for weak in ["court1", "12345678", "abcdefgh", "Azerty123", "11111111", "GestiMarket"] {
            assert!(password_ok(weak).is_err(), "{weak}");
        }
        for ok in ["Boutique-Eden-2026", "kadi7seydou", "Sikasso4892"] {
            assert!(password_ok(ok).is_ok(), "{ok}");
        }
    }

    #[test]
    fn adresses_et_codes_recus_par_email() {
        assert_eq!(valid_email("  Awa.Traore@Exemple.ML ").unwrap(), "awa.traore@exemple.ml");
        for bad in ["", "awa", "awa@exemple", "awa traore@exemple.ml"] {
            assert!(valid_email(bad).is_err(), "{bad}");
        }
        // Code trop court : refusé avant tout appel à Supabase.
        let awa = Login::Email("awa@exemple.ml".into());
        assert_eq!(verify_code("signup", &awa, "12 34").unwrap_err(), "Tapez le code reçu (6 chiffres).");
    }

    #[test]
    fn numeros_whatsapp() {
        for (typed, e164) in [
            ("+223 76 59 36 76", "+22376593676"),
            ("76 59 36 76", "+22376593676"),
            ("76-59-36-76", "+22376593676"),
            ("0022376593676", "+22376593676"),
            ("22376593676", "+22376593676"),
            ("+33 6 12 34 56 78", "+33612345678"),
            ("+221 77 123 45 67", "+221771234567"),
        ] {
            assert_eq!(valid_phone(typed).unwrap(), e164, "{typed}");
        }
        // Trop court, lettres, numéro local d'un autre pays sans indicatif, indicatif commençant par 0.
        for bad in ["", "123", "+223 76 AB 36 76", "77 123 45 67", "+0 123 456 789", "+1234567890123456"] {
            assert!(valid_phone(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn identifiant_email_ou_numero() {
        let email = Login::parse(" Awa@Exemple.ML").unwrap();
        assert_eq!(email, Login::Email("awa@exemple.ml".into()));
        assert_eq!(email.body(json!({ "password": "x" })), json!({ "email": "awa@exemple.ml", "password": "x" }));
        assert_eq!(email.code_kind("signup"), "signup");
        let phone = Login::parse("76 59 36 76").unwrap();
        assert_eq!(phone, Login::Phone("+22376593676".into()));
        assert_eq!(phone.body(json!({ "type": "sms" })), json!({ "phone": "+22376593676", "type": "sms" }));
        assert_eq!(phone.code_kind("recovery"), "sms");
        assert_eq!(confirm_status(&phone)["status"], "confirm_phone");
        assert_eq!(confirm_status(&email)["status"], "confirm_email");
    }

    #[test]
    fn card_page_posts_escaped_fields_to_cybersource_only() {
        let mut fields = serde_json::Map::new();
        fields.insert("amount".into(), json!("18000"));
        fields.insert("bill_to_address_line1".into(), json!("Rue \"12\" <ACI>"));
        let page = card_page("https://testsecureacceptance.cybersource.com/pay", &fields).unwrap();
        assert!(page.contains("action=\"https://testsecureacceptance.cybersource.com/pay\""));
        assert!(page.contains("name=\"amount\" value=\"18000\""));
        assert!(page.contains("value=\"Rue &quot;12&quot; &lt;ACI&gt;\""));
        assert!(card_page("https://pirate.example.com/pay", &fields).is_err());
        assert!(card_page("https://secureacceptance.cybersource.com.pirate.example/pay", &fields).is_err());
    }
}
