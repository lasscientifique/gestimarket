//! Accès depuis Internet de la boutique : https://gm-000123.<domaine d'Eden Dev>.
//!
//! Eden Dev crée le tunnel Cloudflare de la boutique (fonction « gm-tunnel ») et remet son jeton à ce poste
//! serveur, qui le garde (clé interne « tunnel_token ») et lance cloudflared tant que GestiMarket tourne.
//!
//! 0.27 : tout est automatique pour les formules qui comprennent « internet » (PRO, BUSINESS) :
//!   1. GestiMarket télécharge cloudflared une fois, depuis la publication officielle de Cloudflare (version
//!      fixée, taille et empreinte SHA-256 vérifiées), dans son dossier de données ;
//!   2. il demande l'adresse avec le jeton d'appareil du PC (remis par Eden Dev quand la propriétaire a relié
//!      ce PC à sa boutique : pas de mot de passe à retaper) ;
//!   3. il lance cloudflared et le relance s'il s'arrête.
//! La boutique peut couper l'accès (clé interne « internet_enabled » = « 0 »). Formule sans Internet ou
//! abonnement fini : cloudflared est arrêté. Les écrans ne nomment ni Cloudflare, ni cloudflared, ni tunnel.

use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Condvar, Mutex};
use std::time::{Duration, Instant};

use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager};

use crate::services::settings;
use crate::state::AppState;

/// cloudflared téléchargé par GestiMarket : version officielle fixée, avec sa taille et son empreinte
/// (publiées par GitHub pour cette version). Changer de version = changer les trois ensemble.
const MODULE_VERSION: &str = "2026.10.7";
const MODULE_SIZE: u64 = 55_390_512;
const MODULE_SHA256: &str = "2493dbc168923bb3e59e5e7716f71deced92992eea9acd6e9d74f84ac7751343";
const MODULE_FILE: &str = "cloudflared.exe";

#[derive(Debug, Clone, Default, Serialize)]
pub struct TunnelStatus {
    /// Poste serveur (seul lui porte l'adresse Internet de la boutique).
    pub server: bool,
    /// La formule comprend l'accès depuis Internet (PRO, BUSINESS).
    pub allowed: bool,
    /// La boutique ne l'a pas coupé.
    pub enabled: bool,
    /// Adresse reçue d'Eden Dev (jeton enregistré sur ce PC).
    pub configured: bool,
    /// Accès en marche.
    pub running: bool,
    /// Module d'accès installé sur ce PC.
    pub module: bool,
    /// Téléchargement du module en cours (pourcentage).
    pub installing: Option<u8>,
    /// Ce PC doit être relié de nouveau au compte boutique (pas de jeton d'appareil).
    pub needs_link: bool,
    pub url: String,
    pub error: Option<String>,
}

static CHILD: Mutex<Option<Child>> = Mutex::new(None);
static LAST_ERROR: Mutex<Option<String>> = Mutex::new(None);
static INSTALLING: Mutex<Option<u8>> = Mutex::new(None);
static MODULE_DIR: Mutex<Option<PathBuf>> = Mutex::new(None);
/// Dernière demande d'adresse à Eden Dev et dernier téléchargement raté (pas plus d'un essai par période).
static LAST_ASK: Mutex<Option<Instant>> = Mutex::new(None);
static LAST_DOWNLOAD_FAIL: Mutex<Option<Instant>> = Mutex::new(None);
/// Réveil de la boucle (interrupteur, compte relié) : sans attendre les 30 secondes.
static WAKE: (Mutex<bool>, Condvar) = (Mutex::new(false), Condvar::new());

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

fn set_error(e: Option<String>) {
    *lock(&LAST_ERROR) = e;
}

fn recently(m: &Mutex<Option<Instant>>, d: Duration) -> bool {
    let last: Option<Instant> = *lock(m);
    last.is_some_and(|t| t.elapsed() < d)
}

/// Accès depuis Internet voulu par la boutique (« 0 » = coupé ; vide = en marche).
pub fn enabled(conn: &rusqlite::Connection) -> bool {
    settings::get(conn, "internet_enabled").unwrap_or_default().trim() != "0"
}

/// Le module se télécharge seulement sur un PC Windows 64 bits (version publiée par Cloudflare).
fn download_supported() -> bool {
    cfg!(all(windows, target_arch = "x86_64"))
}

fn module_path() -> Option<PathBuf> {
    lock(&MODULE_DIR).as_ref().map(|d| d.join(MODULE_FILE))
}

/// cloudflared : celui de GestiMarket d'abord, sinon un cloudflared déjà installé (PATH, Program Files, winget).
pub fn find_cloudflared() -> Option<PathBuf> {
    if let Some(p) = module_path().filter(|p| p.is_file()) {
        return Some(p);
    }
    let exe = if cfg!(windows) { "cloudflared.exe" } else { "cloudflared" };
    let mut candidates: Vec<PathBuf> = std::env::var_os("PATH")
        .map(|p| std::env::split_paths(&p).map(|d| d.join(exe)).collect())
        .unwrap_or_default();
    if cfg!(windows) {
        for var in ["ProgramFiles(x86)", "ProgramFiles"] {
            if let Some(dir) = std::env::var_os(var) {
                candidates.push(PathBuf::from(dir).join("cloudflared").join(exe));
            }
        }
        if let Some(dir) = std::env::var_os("LOCALAPPDATA") {
            candidates.push(PathBuf::from(dir).join("Microsoft").join("WinGet").join("Links").join(exe));
        }
    }
    candidates.into_iter().find(|p| p.is_file())
}

/// Empreinte SHA-256 en hexadécimal.
fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// Taille et empreinte attendues du module téléchargé.
fn module_ok(size: u64, sha256: &str) -> bool {
    size == MODULE_SIZE && sha256.eq_ignore_ascii_case(MODULE_SHA256)
}

/// Télécharge le module (publication officielle de Cloudflare), vérifie taille et empreinte, puis le range.
fn download_module(dir: &Path) -> Result<PathBuf, String> {
    const NEED_INTERNET: &str = "Internet est nécessaire pour installer l'accès depuis Internet : nouvel essai dans 30 minutes.";
    let url = format!("https://github.com/cloudflare/cloudflared/releases/download/{MODULE_VERSION}/cloudflared-windows-amd64.exe");
    std::fs::create_dir_all(dir).map_err(|e| format!("Dossier de GestiMarket inaccessible : {e}"))?;
    let part = dir.join(format!("{MODULE_FILE}.part"));
    let agent = ureq::AgentBuilder::new().timeout_connect(Duration::from_secs(15)).timeout_read(Duration::from_secs(60)).build();
    let resp = agent.get(&url).call().map_err(|_| NEED_INTERNET.to_string())?;
    let mut reader = resp.into_reader();
    let mut file = std::fs::File::create(&part).map_err(|e| format!("Écriture impossible dans le dossier de GestiMarket : {e}"))?;
    let mut hasher = Sha256::new();
    let mut done: u64 = 0;
    let mut buf = vec![0u8; 64 * 1024];
    loop {
        let n = reader.read(&mut buf).map_err(|_| NEED_INTERNET.to_string())?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
        file.write_all(&buf[..n]).map_err(|e| format!("Écriture impossible dans le dossier de GestiMarket : {e}"))?;
        done += n as u64;
        *lock(&INSTALLING) = Some((done.saturating_mul(100) / MODULE_SIZE).min(99) as u8);
    }
    file.flush().map_err(|e| e.to_string())?;
    drop(file);
    if !module_ok(done, &hex(&hasher.finalize())) {
        let _ = std::fs::remove_file(&part);
        return Err("Le module d'accès depuis Internet est arrivé abîmé : nouvel essai dans 30 minutes.".into());
    }
    let target = dir.join(MODULE_FILE);
    let _ = std::fs::remove_file(&target);
    std::fs::rename(&part, &target).map_err(|e| format!("Installation du module impossible : {e}"))?;
    Ok(target)
}

/// Arrête cloudflared s'il a été lancé par GestiMarket.
pub fn stop() {
    if let Some(mut child) = lock(&CHILD).take() {
        let _ = child.kill();
        let _ = child.wait();
    }
}

/// Lance (ou relance) cloudflared avec le jeton du tunnel. Le jeton passe par l'environnement
/// (TUNNEL_TOKEN), pas par la ligne de commande visible dans le gestionnaire des tâches.
pub fn launch(token: &str) -> Result<(), String> {
    stop();
    let exe = find_cloudflared().ok_or_else(|| "Le module d'accès depuis Internet n'est pas encore installé.".to_string())?;
    let mut cmd = Command::new(exe);
    cmd.args(["tunnel", "--no-autoupdate", "run"])
        .env("TUNNEL_TOKEN", token)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let child = cmd.spawn().map_err(|e| format!("L'accès depuis Internet n'a pas pu démarrer : {e}"))?;
    *lock(&CHILD) = Some(child);
    set_error(None);
    Ok(())
}

fn running() -> bool {
    match lock(&CHILD).as_mut() {
        Some(child) => matches!(child.try_wait(), Ok(None)),
        None => false,
    }
}

pub fn status(conn: &rusqlite::Connection) -> TunnelStatus {
    let token = settings::get(conn, "tunnel_token").unwrap_or_default();
    let device = settings::get(conn, "device_token").unwrap_or_default();
    TunnelStatus {
        server: crate::cloud::port() != 0,
        allowed: crate::license::allows("internet"),
        enabled: enabled(conn),
        configured: !token.is_empty(),
        running: running(),
        module: find_cloudflared().is_some(),
        installing: *lock(&INSTALLING),
        needs_link: token.is_empty() && device.is_empty(),
        url: if token.is_empty() { String::new() } else { settings::get(conn, "public_url").unwrap_or_default() },
        error: lock(&LAST_ERROR).clone(),
    }
}

/// Enregistre le tunnel remis par Eden Dev : jeton, adresse publique publiée pour l'application mobile.
pub fn save(conn: &rusqlite::Connection, url: &str, token: &str) -> Result<(), String> {
    settings::set(conn, "tunnel_token", token).map_err(|e| e.to_string())?;
    settings::set(conn, "public_url", url).map_err(|e| e.to_string())?;
    Ok(())
}

/// Retire l'adresse automatique de ce PC (le tunnel reste réservé à la boutique chez Eden Dev).
pub fn remove(conn: &rusqlite::Connection) -> Result<(), String> {
    stop();
    settings::set(conn, "tunnel_token", "").map_err(|e| e.to_string())?;
    settings::set(conn, "public_url", "").map_err(|e| e.to_string())?;
    set_error(None);
    Ok(())
}

/// Interrupteur « Accès depuis Internet » : coupé = arrêté tout de suite (l'adresse reste gardée).
pub fn set_enabled(conn: &rusqlite::Connection, on: bool) -> Result<(), String> {
    settings::set(conn, "internet_enabled", if on { "1" } else { "0" }).map_err(|e| e.to_string())?;
    if !on {
        stop();
        set_error(None);
    }
    wake();
    Ok(())
}

/// Compte relié de nouveau : la demande d'adresse peut repartir tout de suite.
pub fn relinked() {
    *lock(&LAST_ASK) = None;
    set_error(None);
    wake();
}

/// Réveille la boucle de l'accès depuis Internet (sans attendre les 30 secondes).
pub fn wake() {
    let (flag, cv) = &WAKE;
    *lock(flag) = true;
    cv.notify_all();
}

fn sleep_or_wake(d: Duration) {
    let (flag, cv) = &WAKE;
    let mut woken = lock(flag);
    if !*woken {
        woken = cv.wait_timeout(woken, d).map(|(g, _)| g).unwrap_or_else(|e| e.into_inner().0);
    }
    *woken = false;
}

/// Ce que la boucle doit faire, d'après la formule, l'interrupteur et ce qui est déjà là.
#[derive(Debug, PartialEq, Eq)]
enum Step {
    /// Rien à faire sur ce PC, ou arrêter l'accès en marche.
    Off,
    InstallModule,
    AskAddress,
    /// Pas de jeton d'appareil : la propriétaire doit relier ce PC de nouveau.
    WaitLink,
    Launch,
    Running,
}

fn next_step(server: bool, allowed: bool, enabled: bool, module: bool, token: bool, device: bool, running: bool) -> Step {
    if !(server && allowed && enabled) {
        Step::Off
    } else if !module {
        Step::InstallModule
    } else if !token {
        if device { Step::AskAddress } else { Step::WaitLink }
    } else if running {
        Step::Running
    } else {
        Step::Launch
    }
}

/// Un passage de la boucle.
fn tick(state: &AppState) {
    let port = crate::cloud::port();
    let (on, token, device) = {
        let conn = state.conn();
        (enabled(&conn), settings::get(&conn, "tunnel_token").unwrap_or_default(), settings::get(&conn, "device_token").unwrap_or_default())
    };
    let step = next_step(port != 0, crate::license::allows("internet"), on, find_cloudflared().is_some(), !token.is_empty(), !device.is_empty(), running());
    match step {
        Step::Off => {
            if running() {
                stop();
                crate::journal::info("Accès depuis Internet arrêté (formule ou réglage de la boutique)");
            }
        }
        Step::InstallModule => {
            if !download_supported() {
                set_error(Some("L'accès depuis Internet automatique se règle sur le PC Windows serveur de la boutique.".into()));
                return;
            }
            if recently(&LAST_DOWNLOAD_FAIL, Duration::from_secs(30 * 60)) {
                return;
            }
            let Some(dir) = lock(&MODULE_DIR).clone() else { return };
            *lock(&INSTALLING) = Some(0);
            let r = download_module(&dir);
            *lock(&INSTALLING) = None;
            crate::journal::state("Installation de l'accès depuis Internet", r.as_ref().map(|_| ()).map_err(|e| e.as_str()));
            match r {
                Ok(_) => {
                    set_error(None);
                    wake();
                }
                Err(e) => {
                    *lock(&LAST_DOWNLOAD_FAIL) = Some(Instant::now());
                    set_error(Some(e));
                }
            }
        }
        Step::AskAddress => {
            if recently(&LAST_ASK, Duration::from_secs(10 * 60)) {
                return;
            }
            *lock(&LAST_ASK) = Some(Instant::now());
            match crate::account::request_tunnel_auto(&device, port) {
                Ok((url, t)) => {
                    let conn = state.conn();
                    if let Err(e) = save(&conn, &url, &t) {
                        set_error(Some(e));
                        return;
                    }
                    let _ = crate::services::audit::log_system(&conn, "Accès depuis Internet activé automatiquement", "settings", None, &url);
                    drop(conn);
                    set_error(None);
                    let _ = crate::cloud::publish_once(state, true);
                    wake();
                }
                Err(e) => {
                    // Jeton d'appareil refusé (PC retiré ou passé à une autre boutique) : il faut relier le PC.
                    if e.contains("relié de nouveau") {
                        let _ = settings::set(&state.conn(), "device_token", "");
                    }
                    crate::journal::state("Adresse Internet de la boutique", Err(&e));
                    set_error(Some(e));
                }
            }
        }
        Step::WaitLink => {}
        Step::Launch => {
            let r = launch(&token);
            crate::journal::state("Accès depuis Internet", r.as_ref().map(|_| ()).map_err(|e| e.as_str()));
            if let Err(e) = r {
                set_error(Some(e));
            }
        }
        Step::Running => {}
    }
}

/// Poste serveur : boucle de l'accès depuis Internet (toutes les 30 secondes, ou réveillée).
pub fn start(app: AppHandle) {
    if let Ok(dir) = app.path().app_data_dir() {
        *lock(&MODULE_DIR) = Some(dir.join("internet"));
    }
    std::thread::spawn(move || loop {
        if let Some(state) = app.try_state::<AppState>() {
            tick(&state);
        }
        sleep_or_wake(Duration::from_secs(30));
    });
}

#[cfg(test)]
mod tests {
    use super::{module_ok, next_step, Step};

    #[test]
    fn acces_internet_selon_formule_et_reglage() {
        // Formule sans Internet, interrupteur coupé ou poste client : rien ne tourne.
        assert_eq!(next_step(true, false, true, true, true, true, true), Step::Off);
        assert_eq!(next_step(true, true, false, true, true, true, true), Step::Off);
        assert_eq!(next_step(false, true, true, true, true, true, false), Step::Off);
        // PRO, poste serveur : module d'abord, puis l'adresse (jeton d'appareil), puis le lancement.
        assert_eq!(next_step(true, true, true, false, false, true, false), Step::InstallModule);
        assert_eq!(next_step(true, true, true, true, false, true, false), Step::AskAddress);
        assert_eq!(next_step(true, true, true, true, false, false, false), Step::WaitLink);
        assert_eq!(next_step(true, true, true, true, true, false, false), Step::Launch);
        assert_eq!(next_step(true, true, true, true, true, true, true), Step::Running);
    }

    #[test]
    fn module_verifie_taille_et_empreinte() {
        assert!(module_ok(55_390_512, "2493DBC168923BB3E59E5E7716F71DECED92992EEA9ACD6E9D74F84AC7751343"));
        assert!(!module_ok(55_390_511, "2493dbc168923bb3e59e5e7716f71deced92992eea9acd6e9d74f84ac7751343"));
        assert!(!module_ok(55_390_512, "0000dbc168923bb3e59e5e7716f71deced92992eea9acd6e9d74f84ac7751343"));
    }
}
