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

use crate::license::{self, SUPABASE_KEY, SUPABASE_URL};
use crate::state::AppState;

fn agent() -> ureq::Agent {
    ureq::AgentBuilder::new().timeout_connect(Duration::from_secs(8)).timeout(Duration::from_secs(25)).build()
}

fn request(path: &str, token: Option<&str>) -> ureq::Request {
    let r = agent().post(&format!("{SUPABASE_URL}{path}")).set("apikey", SUPABASE_KEY).set("Content-Type", "application/json");
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
        "weak_password" => Some("Mot de passe trop faible : au moins 8 caractères, avec des lettres et des chiffres."),
        "email_address_invalid" | "validation_failed" => Some("Adresse e-mail invalide."),
        "invalid_credentials" => Some("E-mail ou mot de passe incorrect."),
        "email_not_confirmed" => Some("Confirmez d'abord votre adresse e-mail (lien reçu par e-mail), puis reconnectez-vous."),
        "over_email_send_rate_limit" | "over_request_rate_limit" => Some("Trop de tentatives : réessayez dans quelques minutes."),
        "signup_disabled" => Some("Les inscriptions sont fermées pour le moment : contactez Eden Dev."),
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

fn call(req: ureq::Request, body: Value) -> Result<Value, String> {
    match req.send_json(body) {
        Ok(resp) => {
            let text = resp.into_string().map_err(|e| e.to_string())?;
            Ok(serde_json::from_str(&text).unwrap_or(Value::Null))
        }
        Err(ureq::Error::Status(code, resp)) => {
            let v: Value = resp.into_json().unwrap_or(Value::Null);
            Err(error_message(code, &v))
        }
        Err(_) => Err("Connexion à Internet impossible : vérifiez la connexion de ce PC, puis réessayez.".into()),
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

fn password_login(email: &str, password: &str) -> Result<String, String> {
    let v = call(request("/auth/v1/token?grant_type=password", None), json!({ "email": email.trim(), "password": password }))?;
    v["access_token"].as_str().map(String::from).ok_or_else(|| "Réponse de connexion invalide.".to_string())
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
    pub email: String,
    pub password: String,
    #[serde(flatten)]
    pub store: StoreInput,
}

/// Listes du formulaire (pays, types de boutique) et formules.
pub fn options() -> Result<Value, String> {
    call(request("/rest/v1/rpc/gm_public_options", None), json!({}))
}

/// Création du compte, de la boutique (essai gratuit) et rattachement de ce PC.
pub fn signup(state: &AppState, input: SignupInput) -> Result<Value, String> {
    let email = input.email.trim().to_lowercase();
    if !email.contains('@') || !email.contains('.') {
        return Err("Adresse e-mail invalide.".into());
    }
    if input.password.chars().count() < 8 {
        return Err("Le mot de passe doit contenir au moins 8 caractères.".into());
    }
    input.store.validate()?;
    let v = call(
        request("/auth/v1/signup", None),
        json!({ "email": email, "password": input.password, "data": { "owner_name": input.store.owner_name.trim(), "shop_name": input.store.name.trim() } }),
    )?;
    let Some(token) = v["access_token"].as_str() else {
        // Confirmation des e-mails activée dans Supabase : la boutique sera créée après la première connexion.
        return Ok(json!({ "status": "confirm_email" }));
    };
    remember(&email, token);
    let store = rpc_call("gm_register_store", token, json!({ "p": input.store.to_json() }))?;
    link(state, store["code"].as_str().unwrap_or_default())
}

/// Connexion : retourne les boutiques du compte (à rattacher, ou à créer).
pub fn login(email: &str, password: &str) -> Result<Value, String> {
    let email = email.trim().to_lowercase();
    let token = password_login(&email, password)?;
    remember(&email, &token);
    let stores = rpc_call("gm_my_stores", &token, json!({}))?;
    Ok(json!({ "status": "ok", "email": email, "stores": stores }))
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

/// Déclaration d'un paiement (mot de passe du compte redemandé) : Eden Dev le valide ensuite.
pub fn declare_payment(password: &str, plan: &str, months: i64, method: &str, reference: &str, payer_phone: &str) -> Result<Value, String> {
    let acc = license::account();
    if acc.email.is_empty() || acc.store_code.is_empty() {
        return Err("Reliez d'abord ce PC au compte de la boutique.".into());
    }
    let token = password_login(&acc.email, password)?;
    rpc_call(
        "gm_declare_payment",
        &token,
        json!({
            "p_store_code": acc.store_code, "p_plan": plan, "p_months": months, "p_method": method,
            "p_reference": reference.trim(), "p_payer_phone": payer_phone.trim(),
        }),
    )
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
                    let url = format!("{SUPABASE_URL}/storage/v1/object/public/licences/{path}?v={id}");
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
