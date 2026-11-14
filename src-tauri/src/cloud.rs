//! Publication du poste serveur sur le service d'Eden Dev (Supabase), pour l'application mobile.
//!
//! Toutes les 30 s, le poste serveur publie son état (actif) et ses adresses sur le réseau local
//! via la fonction SQL `gm_publish_server`. L'application mobile appelle `gm_get_server(code)`,
//! reçoit l'adresse et l'ouvre dans sa WebView. Seul le poste qui détient le secret (créé
//! automatiquement à la première publication) peut modifier la fiche de son commerce.
//!
//! 0.27 : publication en marche par défaut sur tout poste serveur (clé interne « mobile_publish », « 0 » =
//! coupée par la boutique dans Paramètres → Réseau). Le projet est toujours celui d'Eden Dev ; les anciens
//! réglages « supabase_url » et « supabase_key » ne servent plus qu'aux tests d'interface et ne sont plus
//! montrés. Aucun message vu par la boutique ne nomme Supabase.

use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Manager};

use crate::services::settings;
use crate::state::AppState;

#[derive(Debug, Clone, Default, Serialize)]
pub struct CloudStatus {
    /// Le poste serveur publie-t-il (mode serveur + option activée) ?
    pub running: bool,
    pub enabled: bool,
    pub shop_code: String,
    pub last_ok_at: Option<String>,
    pub last_try_at: Option<String>,
    pub last_error: Option<String>,
    pub url: Option<String>,
    /// Adresse publique configurée et résultat du dernier test depuis ce poste serveur.
    pub public_url: Option<String>,
    pub public_ok: Option<bool>,
    pub public_ms: Option<u64>,
    pub public_error: Option<String>,
}

static STATUS: Mutex<Option<CloudStatus>> = Mutex::new(None);
static PORT: Mutex<u16> = Mutex::new(0);

fn set_status(f: impl FnOnce(&mut CloudStatus)) {
    let mut g = STATUS.lock().unwrap_or_else(|e| e.into_inner());
    f(g.get_or_insert_with(CloudStatus::default));
}

pub fn status() -> CloudStatus {
    STATUS.lock().unwrap_or_else(|e| e.into_inner()).clone().unwrap_or_default()
}

fn now() -> String {
    chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string()
}

fn random_code(len: usize, alphabet: &[u8]) -> String {
    use password_hash::rand_core::{OsRng, RngCore};
    let mut bytes = vec![0u8; len];
    OsRng.fill_bytes(&mut bytes);
    bytes.iter().map(|b| alphabet[*b as usize % alphabet.len()] as char).collect()
}

/// Code du commerce (saisi ou scanné une fois dans l'application mobile) et secret de publication.
pub fn ensure_identity(conn: &rusqlite::Connection) -> crate::error::AppResult<(String, String)> {
    let mut code = settings::get(conn, "shop_code")?;
    if code.trim().is_empty() {
        code = format!("GM-{}", random_code(6, b"ABCDEFGHJKLMNPQRSTUVWXYZ23456789"));
        settings::set(conn, "shop_code", &code)?;
    }
    let mut secret = settings::get(conn, "supabase_secret")?;
    if secret.len() < 20 {
        secret = random_code(40, b"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789");
        settings::set(conn, "supabase_secret", &secret)?;
    }
    Ok((code.trim().to_uppercase(), secret))
}

/// Contenu publié : nom du commerce et adresses du poste serveur.
pub fn payload(shop_name: &str, port: u16, ips: &[String], public_url: &str, postes_online: usize) -> Value {
    let urls: Vec<String> = ips.iter().map(|ip| format!("http://{ip}:{port}")).collect();
    let https: Vec<String> = ips.iter().map(|ip| format!("https://{ip}:{}", port.saturating_add(1))).collect();
    json!({
        "shop_name": shop_name,
        "version": env!("CARGO_PKG_VERSION"),
        "url": urls.first(),
        "https_url": https.first(),
        "urls": urls,
        "https_urls": https,
        "public_url": if public_url.trim().is_empty() { Value::Null } else { Value::String(public_url.trim().trim_end_matches('/').to_string()) },
        "port": port,
        "postes_online": postes_online,
    })
}

/// Teste l'adresse publique (tunnel) depuis le poste serveur : répond-elle comme un serveur GestiMarket ?
fn check_public(url: &str) -> Result<u64, String> {
    let t0 = std::time::Instant::now();
    let res = ureq::get(&format!("{url}/api/ping")).timeout(Duration::from_secs(6)).call();
    match res {
        Ok(r) => {
            let v: Value = r.into_json().map_err(|_| "Réponse inattendue (ce n'est pas GestiMarket).".to_string())?;
            if v.get("app").and_then(|a| a.as_str()) == Some("GestiMarket") {
                Ok(t0.elapsed().as_millis() as u64)
            } else {
                Err("L'adresse Internet ne mène pas à GestiMarket.".into())
            }
        }
        Err(ureq::Error::Status(code, _)) => Err(format!("L'adresse Internet répond {code} (accès depuis Internet arrêté).")),
        Err(_) => Err("Adresse Internet injoignable pour le moment.".into()),
    }
}

/// Partage avec l'application mobile en marche (sauf si la boutique l'a coupé).
pub fn publish_enabled(conn: &rusqlite::Connection) -> bool {
    settings::get(conn, "mobile_publish").unwrap_or_default().trim() != "0"
}

/// Publie une fois. `active = false` à l'arrêt du poste serveur.
pub fn publish_once(state: &AppState, active: bool) -> Result<(), String> {
    publish(state, active, false)
}

/// Coupure par la boutique : l'application mobile voit tout de suite « serveur arrêté ».
pub fn withdraw(state: &AppState) -> Result<(), String> {
    publish(state, false, true)
}

fn publish(state: &AppState, active: bool, force: bool) -> Result<(), String> {
    let port = *PORT.lock().unwrap_or_else(|e| e.into_inner());
    if port == 0 {
        return Err("Ce poste n'est pas le poste serveur : seul le serveur publie son adresse.".into());
    }
    let (enabled, base, key, public_url, shop_name, code, secret) = {
        let conn = state.conn();
        let s = settings::get_all(&conn).map_err(|e| e.to_string())?;
        let get = |k: &str| s.get(k).cloned().unwrap_or_default();
        let (code, secret) = ensure_identity(&conn).map_err(|e| e.to_string())?;
        (publish_enabled(&conn), get("supabase_url"), get("supabase_key"), get("public_url"), get("shop_name"), code, secret)
    };
    set_status(|s| {
        s.enabled = enabled;
        s.shop_code = code.clone();
        s.running = true;
        if !enabled {
            s.last_error = None;
        }
    });
    if !enabled && !force {
        return Err("Le partage avec l'application mobile est coupé (Paramètres → Réseau & mobile).".into());
    }
    // Sans projet saisi : celui d'Eden Dev, lu par l'application mobile GestiMarket.
    let (base, key) = if base.trim().is_empty() && key.trim().is_empty() {
        (crate::license::supabase_url(), crate::license::SUPABASE_KEY.to_string())
    } else {
        (base, key)
    };
    let base = base.trim().trim_end_matches('/').to_string();
    let local_test = base.starts_with("http://127.0.0.1") || base.starts_with("http://localhost");
    if !(base.starts_with("https://") || local_test) || key.trim().is_empty() {
        return Err("Service Eden Dev mal réglé sur ce PC : contactez Eden Dev.".into());
    }
    // Boutique Eden Dev de ce PC : la propriétaire connectée dans l'application mobile retrouve ce serveur.
    let mut published = payload(&shop_name, port, &crate::network::local_ips(), &public_url, state.live.online_count());
    published["store_code"] = json!(crate::license::account().store_code);
    published["pc_id"] = json!(crate::license::pc_id());
    let body = json!({
        "p_shop_code": code,
        "p_secret": secret,
        "p_active": active,
        "p_payload": published,
    });
    set_status(|s| {
        s.last_try_at = Some(now());
        s.url = Some(base.clone());
    });
    let res = ureq::post(&format!("{base}/rest/v1/rpc/gm_publish_server"))
        .timeout(Duration::from_secs(10))
        .set("apikey", key.trim())
        .set("Authorization", &format!("Bearer {}", key.trim()))
        .set("Content-Type", "application/json")
        .send_json(body);
    match res {
        Ok(_) => {
            set_status(|s| {
                s.last_ok_at = Some(now());
                s.last_error = None;
            });
            crate::journal::state("Partage avec l'application mobile", Ok(()));
            let public = public_url.trim().trim_end_matches('/').to_string();
            if active && !public.is_empty() {
                let r = check_public(&public);
                set_status(|s| {
                    s.public_url = Some(public.clone());
                    s.public_ok = Some(r.is_ok());
                    s.public_ms = r.as_ref().ok().copied();
                    s.public_error = r.err();
                });
            } else if public.is_empty() {
                set_status(|s| {
                    s.public_url = None;
                    s.public_ok = None;
                    s.public_ms = None;
                    s.public_error = None;
                });
            }
            Ok(())
        }
        Err(e) => {
            let msg = match e {
                ureq::Error::Status(code, r) => {
                    let text = r.into_string().unwrap_or_default();
                    // Détail technique pour le journal seulement ; la boutique voit un message simple.
                    crate::journal::error(format!("Publication du poste serveur : réponse {code} {}", text.chars().take(200).collect::<String>()));
                    format!("Service Eden Dev momentanément indisponible (code {code}) : nouvel essai dans 30 secondes.")
                }
                _ => "Service Eden Dev injoignable : vérifiez la connexion à Internet de ce PC.".to_string(),
            };
            set_status(|s| s.last_error = Some(msg.clone()));
            crate::journal::state("Partage avec l'application mobile", Err(&msg));
            Err(msg)
        }
    }
}

/// Port du poste serveur (0 : ce poste n'est pas le serveur).
pub fn port() -> u16 {
    *PORT.lock().unwrap_or_else(|e| e.into_inner())
}

/// Boucle de publication du poste serveur (toutes les 30 secondes).
pub fn start(app: AppHandle, port: u16) {
    *PORT.lock().unwrap_or_else(|e| e.into_inner()) = port;
    set_status(|s| s.running = true);
    std::thread::spawn(move || loop {
        let state = app.state::<AppState>();
        let _ = publish_once(&state, true);
        std::thread::sleep(Duration::from_secs(30));
    });
}

/// À la fermeture du poste serveur : l'application mobile voit immédiatement « serveur arrêté ».
pub fn publish_offline(app: &AppHandle) {
    if *PORT.lock().unwrap_or_else(|e| e.into_inner()) == 0 {
        return;
    }
    let state = app.state::<AppState>();
    let _ = publish_once(&state, false);
}
