//! Commandes Tauri. Presque toutes les opérations passent par la commande unique `rpc`
//! (voir `rpc.rs`), partagée avec le serveur réseau. Les autres commandes concernent
//! uniquement ce PC : fichiers locaux, configuration réseau, fenêtre de l'écran client.

use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Manager, State, WebviewUrl, WebviewWindowBuilder};

use crate::error::{invalid, AppError, AppResult};
use crate::network::{self, NetworkConfig, NetworkState};
use crate::state::{AppState, Origin};

fn internal(e: impl std::fmt::Display) -> AppError {
    AppError::Internal(e.to_string())
}

/// Toutes les opérations métier (connexion, ventes, stock…).
#[tauri::command]
pub async fn rpc(state: State<'_, AppState>, cmd: String, args: Option<Value>) -> AppResult<Value> {
    crate::rpc::dispatch(&state, &Origin::Local, &cmd, args.unwrap_or(Value::Null))
}

// ───────────────────────────── Fichiers locaux ─────────────────────────────
// Les chemins proviennent toujours des boîtes de dialogue du système (choix de l'utilisateur).

/// Écrit un fichier texte (export CSV) sur ce PC.
#[tauri::command]
pub async fn save_text_file(path: String, contents: String) -> AppResult<()> {
    if path.trim().is_empty() {
        return invalid("Chemin invalide.");
    }
    std::fs::write(&path, contents)?;
    Ok(())
}

/// Lit un fichier texte choisi par l'utilisateur (import CSV).
#[tauri::command]
pub async fn read_text_file(path: String) -> AppResult<String> {
    let bytes = std::fs::read(&path)?;
    if bytes.len() > 20 * 1024 * 1024 {
        return invalid("Fichier trop volumineux (20 Mo maximum).");
    }
    // Excel enregistre souvent en Windows-1252 : conversion si ce n'est pas de l'UTF-8 valide.
    Ok(match String::from_utf8(bytes) {
        Ok(s) => s,
        Err(e) => e.into_bytes().iter().map(|&b| cp1252(b)).collect(),
    })
}

fn cp1252(b: u8) -> char {
    const HIGH: [char; 32] = [
        '€', '\u{81}', '‚', 'ƒ', '„', '…', '†', '‡', 'ˆ', '‰', 'Š', '‹', 'Œ', '\u{8d}', 'Ž', '\u{8f}', '\u{90}', '‘', '’',
        '“', '”', '•', '–', '—', '˜', '™', 'š', '›', 'œ', '\u{9d}', 'ž', 'Ÿ',
    ];
    match b {
        0x80..=0x9f => HIGH[(b - 0x80) as usize],
        _ => b as char,
    }
}

// ───────────────────────────── Multi-postes ─────────────────────────────

#[derive(Serialize)]
pub struct NetworkInfo {
    pub config: NetworkConfig,
    pub local_ips: Vec<String>,
    /// Nom de ce PC (affiché dans la liste des postes connectés).
    pub hostname: String,
    pub os: String,
}

#[tauri::command]
pub async fn get_network_config(net: State<'_, NetworkState>) -> AppResult<NetworkInfo> {
    Ok(NetworkInfo { config: net.get(), local_ips: network::local_ips(), hostname: network::hostname(), os: std::env::consts::OS.into() })
}

/// Modifie le mode réseau de ce poste (serveur, client, poste unique), depuis n'importe quel poste.
/// Sur un poste qui détient la base (serveur ou poste unique) : administrateur connecté,
/// ou confirmation par le code PIN d'un gestionnaire / de l'administrateur.
/// Libre pour un poste client (aucune donnée locale) ou une installation pas encore configurée.
#[tauri::command]
pub async fn save_network_config(
    state: State<'_, AppState>,
    net: State<'_, NetworkState>,
    config: NetworkConfig,
    pin: Option<String>,
) -> AppResult<()> {
    let current = net.get();
    let fresh = crate::services::auth::needs_setup(&state.conn())?;
    if current.mode != "client" && !fresh {
        let is_admin = state.user(&Origin::Local).map(|u| u.is_admin()).unwrap_or(false);
        if !is_admin {
            let Some(pin) = pin.filter(|p| !p.trim().is_empty()) else {
                return invalid("Code PIN d'un gestionnaire ou de l'administrateur requis pour modifier le réseau de ce poste.");
            };
            crate::rpc::dispatch(
                &state,
                &Origin::Local,
                "verify_pin",
                serde_json::json!({ "pin": pin, "level": "manager", "action": "Configuration réseau du poste" }),
            )?;
        }
    }
    net.save(config)?;
    Ok(())
}

#[tauri::command]
pub async fn restart_app(app: AppHandle) {
    app.restart();
}

// ───────────────────────────── Écran client ─────────────────────────────

#[derive(Serialize)]
pub struct MonitorInfo {
    pub index: usize,
    pub name: String,
    pub width: u32,
    pub height: u32,
    pub primary: bool,
}

#[tauri::command]
pub async fn list_monitors(app: AppHandle) -> AppResult<Vec<MonitorInfo>> {
    let primary = app.primary_monitor().map_err(internal)?.and_then(|m| m.name().cloned());
    Ok(app
        .available_monitors()
        .map_err(internal)?
        .iter()
        .enumerate()
        .map(|(index, m)| MonitorInfo {
            index,
            name: m.name().cloned().unwrap_or_else(|| format!("Écran {}", index + 1)),
            width: m.size().width,
            height: m.size().height,
            primary: m.name().cloned() == primary,
        })
        .collect())
}

/// Ouvre (ou ferme) la fenêtre « écran client » sur le 2ᵉ moniteur, en plein écran.
#[tauri::command]
pub async fn toggle_customer_display(app: AppHandle, monitor: Option<usize>, poste: String) -> AppResult<bool> {
    if let Some(w) = app.get_webview_window("display") {
        w.close().map_err(internal)?;
        return Ok(false);
    }
    let monitors = app.available_monitors().map_err(internal)?;
    let primary = app.primary_monitor().map_err(internal)?.and_then(|m| m.name().cloned());
    let target = match monitor {
        Some(i) => monitors.get(i).cloned(),
        None => monitors.iter().find(|m| m.name().cloned() != primary).cloned(),
    };
    let script = format!(
        "window.__GM_DISPLAY_POSTE__ = {}; if (!location.hash.startsWith('#/display')) location.hash = '#/display';",
        serde_json::to_string(&poste).unwrap_or_else(|_| "\"\"".into())
    );
    let mut builder = WebviewWindowBuilder::new(&app, "display", WebviewUrl::App("index.html".into()))
        .title("Écran client")
        .initialization_script(&script)
        .inner_size(1024.0, 640.0);
    if let Some(m) = &target {
        let scale = m.scale_factor();
        builder = builder.position(m.position().x as f64 / scale, m.position().y as f64 / scale).fullscreen(true);
    }
    builder.build().map_err(internal)?;
    Ok(true)
}
