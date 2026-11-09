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

/// Vérifie que l'e-mail et le mot de passe sont ceux du compte de la boutique reliée à ce PC
/// (autoriser un téléphone, refaire le PIN administrateur oublié). Le jeton n'est pas gardé.
pub fn verify_owner(email: &str, password: &str) -> Result<(), String> {
    let store_code = license::account().store_code;
    if store_code.is_empty() {
        return Err("Ce PC n'est relié à aucun compte boutique (menu Abonnement & licence).".into());
    }
    let token = password_login(&email.trim().to_lowercase(), password)?;
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
    let token = password_login(&email.trim().to_lowercase(), password)?;
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

#[cfg(test)]
mod tests {
    use super::*;

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
