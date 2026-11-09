//! Nouvelle version disponible, et remontée des erreurs vers Eden Dev.
//!
//! **Nouvelle version** : la page « dernière version » de GitHub redirige vers l'étiquette de la version
//! (…/releases/tag/v0.20.1). Une seule requête, sans l'API GitHub (limitée) et sans rien envoyer.
//! Résultat gardé 6 heures.
//!
//! **Erreurs** (réglage `error_reports`, activé par défaut, désactivable dans Paramètres) : une panne du
//! programme (erreur JavaScript imprévue, panique Rust) est envoyée à Eden Dev pour être corrigée sans
//! attendre l'appel de la boutique. Seuls partent : le message et l'endroit de l'erreur, l'écran, la version,
//! le système, le modèle d'appareil et une empreinte anonyme du PC. **Aucune donnée commerciale.**
//! Au plus 20 erreurs différentes par heure ; jamais pendant les tests ni dans une version de développement.
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde_json::{json, Value};
use sha2::{Digest, Sha256};

const LATEST_URL: &str = "https://github.com/lasscientifique/gestimarket/releases/latest";
const RELEASES_URL: &str = "https://github.com/lasscientifique/gestimarket/releases";

static LATEST: Mutex<Option<(Instant, Option<String>)>> = Mutex::new(None);

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

/// Numéro de version « 0.20.1 » → (0, 20, 1).
fn parse_version(v: &str) -> Option<(u32, u32, u32)> {
    let mut parts = v.trim().trim_start_matches('v').split('.').map(|p| p.parse::<u32>().ok());
    Some((parts.next()??, parts.next()??, parts.next().flatten().unwrap_or(0)))
}

/// Version annoncée par l'adresse de redirection de GitHub (« …/releases/tag/v0.20.1 »).
fn version_from_location(location: &str) -> Option<String> {
    let tag = location.trim_end_matches('/').rsplit('/').next()?;
    let v = tag.trim_start_matches('v');
    parse_version(v).map(|_| v.to_string())
}

fn fetch_latest() -> Option<String> {
    let agent = ureq::AgentBuilder::new()
        .redirects(0)
        .timeout_connect(Duration::from_secs(8))
        .timeout(Duration::from_secs(12))
        .build();
    let resp = agent.get(LATEST_URL).set("User-Agent", "GestiMarket").call().ok()?;
    version_from_location(resp.header("location")?)
}

/// Dernière version publiée (gardée 6 h ; 30 min après un échec, par exemple sans Internet).
pub fn latest_version() -> Option<String> {
    if cfg!(test) {
        return None;
    }
    if let Some((at, v)) = lock(&LATEST).clone() {
        let keep = if v.is_some() { Duration::from_secs(6 * 3600) } else { Duration::from_secs(1800) };
        if at.elapsed() < keep {
            return v;
        }
    }
    let v = fetch_latest();
    *lock(&LATEST) = Some((Instant::now(), v.clone()));
    v
}

/// État pour l'écran : version installée, dernière version, plus récente ou non, page de téléchargement.
pub fn update_status() -> Value {
    let current = env!("CARGO_PKG_VERSION");
    let latest = latest_version();
    let newer = match (latest.as_deref().and_then(parse_version), parse_version(current)) {
        (Some(l), Some(c)) => l > c,
        _ => false,
    };
    json!({
        "current": current,
        "latest": latest,
        "newer": newer,
        "url": latest.as_ref().map(|v| format!("{RELEASES_URL}/tag/v{v}")).unwrap_or_else(|| RELEASES_URL.to_string()),
    })
}

// ───────────────────────────── Erreurs ─────────────────────────────

static SENT: Mutex<Vec<(String, Instant)>> = Mutex::new(Vec::new());
const MAX_PER_HOUR: usize = 20;

fn cut(s: &str, max: usize) -> String {
    s.chars().take(max).collect()
}

/// Empreinte anonyme du PC (16 caractères) : regrouper les erreurs d'une même boutique sans l'identifier.
/// Calculée au démarrage (le crochet de panique ne doit verrouiller aucune donnée).
static PC: std::sync::OnceLock<String> = std::sync::OnceLock::new();

fn pc_hash() -> String {
    PC.get().cloned().unwrap_or_default()
}

/// Au démarrage, après la licence : empreinte du PC et réglage de la boutique.
pub fn init(conn: &rusqlite::Connection) {
    let digest = Sha256::digest(format!("gestimarket-erreurs:{}", crate::license::pc_id()).as_bytes());
    let _ = PC.set(digest.iter().take(8).map(|b| format!("{b:02x}")).collect());
    refresh(conn);
}

/// Après une modification des paramètres : le réglage « Envoyer les erreurs » est relu.
pub fn refresh(conn: &rusqlite::Connection) {
    PANIC_REPORTS.store(allowed(conn), std::sync::atomic::Ordering::Relaxed);
}

/// Envoi désactivé : tests, version de développement, ou variable `GM_NO_ERROR_REPORTS` (tests d'interface).
fn disabled() -> bool {
    cfg!(test) || cfg!(debug_assertions) || std::env::var_os("GM_NO_ERROR_REPORTS").is_some()
}

/// Erreur à envoyer à Eden Dev, en arrière-plan (sans jamais bloquer ni faire échouer l'appelant).
pub fn send(kind: &str, message: &str, stack: &str, page: &str, device: &str) {
    if disabled() || message.trim().is_empty() {
        return;
    }
    let key = format!("{kind}|{}", cut(message, 200));
    {
        let mut sent = lock(&SENT);
        sent.retain(|(_, t)| t.elapsed() < Duration::from_secs(3600));
        if sent.len() >= MAX_PER_HOUR || sent.iter().any(|(k, _)| *k == key) {
            return;
        }
        sent.push((key, Instant::now()));
    }
    let body = json!({ "p": {
        "pc": pc_hash(),
        "version": env!("CARGO_PKG_VERSION"),
        "os": std::env::consts::OS,
        "kind": cut(kind, 20),
        "message": cut(message, 500),
        "stack": cut(stack, 2000),
        "page": cut(page, 100),
        "device": cut(device, 200),
    }});
    std::thread::spawn(move || {
        if let Err(e) = crate::account::report_error(body) {
            crate::journal::info(format!("Erreur non envoyée à Eden Dev : {e}"));
        }
    });
}

/// Le réglage de la boutique autorise-t-il l'envoi ?
pub fn allowed(conn: &rusqlite::Connection) -> bool {
    crate::services::settings::get(conn, "error_reports").map(|v| v.trim() != "0").unwrap_or(true)
}

/// Pannes du moteur (Rust) : notées dans le journal et envoyées si le réglage le permet.
pub fn install_panic_hook() {
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let message = info
            .payload()
            .downcast_ref::<&str>()
            .map(|s| s.to_string())
            .or_else(|| info.payload().downcast_ref::<String>().cloned())
            .unwrap_or_else(|| "panique".into());
        let place = info.location().map(|l| format!("{}:{}", l.file(), l.line())).unwrap_or_default();
        crate::journal::error(format!("Panne du moteur : {message} ({place})"));
        if PANIC_REPORTS.load(std::sync::atomic::Ordering::Relaxed) {
            send("panic", &message, &place, "", std::env::consts::OS);
        }
        previous(info);
    }));
}

/// Réglage lu au démarrage et à chaque modification des paramètres (le crochet de panique ne lit pas la base).
pub static PANIC_REPORTS: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(true);

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn versions_and_redirects() {
        assert_eq!(parse_version("0.20.1"), Some((0, 20, 1)));
        assert_eq!(parse_version("v1.2"), Some((1, 2, 0)));
        assert_eq!(parse_version("abc"), None);
        assert!(parse_version("0.20.0") > parse_version("0.19.9"));
        assert_eq!(version_from_location("https://github.com/lasscientifique/gestimarket/releases/tag/v0.20.1").as_deref(), Some("0.20.1"));
        assert_eq!(version_from_location("https://github.com/lasscientifique/gestimarket/releases"), None);
        // Jamais d'envoi ni de requête pendant les tests.
        assert!(disabled());
        assert_eq!(latest_version(), None);
        assert_eq!(update_status()["newer"], json!(false));
    }
}
