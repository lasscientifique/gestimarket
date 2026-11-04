//! Adresse Internet automatique de la boutique : https://gm-000123.<domaine d'Eden Dev>.
//!
//! Eden Dev crée le tunnel Cloudflare de la boutique (fonction « gm-tunnel ») et remet son jeton à ce
//! poste serveur, qui le garde (paramètre interne « tunnel_token ») et lance `cloudflared` tant que
//! GestiMarket tourne. cloudflared s'installe une fois : `winget install --id Cloudflare.cloudflared`.

use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Manager};

use crate::services::settings;
use crate::state::AppState;

#[derive(Debug, Clone, Default, Serialize)]
pub struct TunnelStatus {
    /// Un jeton de tunnel est enregistré sur ce poste serveur.
    pub configured: bool,
    /// cloudflared est lancé par GestiMarket.
    pub running: bool,
    /// Chemin de cloudflared (None : pas installé).
    pub cloudflared: Option<String>,
    pub url: String,
    pub error: Option<String>,
}

static CHILD: Mutex<Option<Child>> = Mutex::new(None);
static LAST_ERROR: Mutex<Option<String>> = Mutex::new(None);

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

/// cloudflared installé (winget, installateur MSI ou dans le PATH).
pub fn find_cloudflared() -> Option<PathBuf> {
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
    let exe = find_cloudflared().ok_or_else(|| {
        "cloudflared n'est pas installé sur ce PC : ouvrez une invite de commandes et tapez « winget install --id Cloudflare.cloudflared », puis redémarrez GestiMarket.".to_string()
    })?;
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
    let child = cmd.spawn().map_err(|e| format!("cloudflared n'a pas pu démarrer : {e}"))?;
    *lock(&CHILD) = Some(child);
    *lock(&LAST_ERROR) = None;
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
    TunnelStatus {
        configured: !token.is_empty(),
        running: running(),
        cloudflared: find_cloudflared().map(|p| p.display().to_string()),
        url: if token.is_empty() { String::new() } else { settings::get(conn, "public_url").unwrap_or_default() },
        error: lock(&LAST_ERROR).clone(),
    }
}

/// Enregistre le tunnel remis par Eden Dev : jeton, adresse publique publiée pour l'application mobile.
pub fn save(conn: &rusqlite::Connection, url: &str, token: &str) -> Result<(), String> {
    settings::set(conn, "tunnel_token", token).map_err(|e| e.to_string())?;
    settings::set(conn, "public_url", url).map_err(|e| e.to_string())?;
    if let Err(e) = launch(token) {
        *lock(&LAST_ERROR) = Some(e);
    }
    Ok(())
}

/// Retire l'adresse automatique de ce PC (le tunnel reste réservé à la boutique chez Eden Dev).
pub fn remove(conn: &rusqlite::Connection) -> Result<(), String> {
    stop();
    settings::set(conn, "tunnel_token", "").map_err(|e| e.to_string())?;
    settings::set(conn, "public_url", "").map_err(|e| e.to_string())?;
    *lock(&LAST_ERROR) = None;
    Ok(())
}

/// Poste serveur : lance cloudflared si la boutique a son adresse automatique, et le relance s'il s'arrête.
pub fn start(app: AppHandle) {
    std::thread::spawn(move || loop {
        if let Some(state) = app.try_state::<AppState>() {
            let token = settings::get(&state.conn(), "tunnel_token").unwrap_or_default();
            if !token.is_empty() && !running() {
                let r = launch(&token);
                crate::journal::state("Adresse Internet (cloudflared)", r.as_ref().map(|_| ()).map_err(|e| e.as_str()));
                if let Err(e) = r {
                    *lock(&LAST_ERROR) = Some(e);
                }
            }
        }
        std::thread::sleep(Duration::from_secs(30));
    });
}
