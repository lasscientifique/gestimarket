//! Commandes Tauri. Presque toutes les opérations passent par la commande unique `rpc`
//! (voir `rpc.rs`), partagée avec le serveur réseau. Les autres commandes concernent
//! uniquement ce PC : fichiers locaux, configuration réseau, fenêtre de l'écran client.

use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Manager, State};
#[cfg(desktop)]
use tauri::{WebviewUrl, WebviewWindowBuilder};

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

/// Contact Eden Dev (Paramètres → Développeur Eden Dev) : ouvre la messagerie, WhatsApp ou l'appel
/// avec le programme par défaut de ce PC. Seules ces adresses fixes peuvent être ouvertes
/// (« releases » : page de téléchargement de la dernière version de GestiMarket).
#[tauri::command]
pub async fn open_contact(app: AppHandle, kind: String) -> AppResult<()> {
    let url = match kind.as_str() {
        "email" => "mailto:lasscientifique@gmail.com",
        "whatsapp" => "https://wa.me/22376593676",
        "phone" => "tel:+22376593676",
        "releases" => "https://github.com/lasscientifique/gestimarket/releases/latest",
        _ => return invalid("Contact inconnu."),
    };
    open_url(&app, url)
}

/// Téléphone et tablette : WhatsApp, la messagerie ou le téléphone, ouverts par le système.
#[cfg(mobile)]
fn open_url(app: &AppHandle, url: &str) -> AppResult<()> {
    use tauri_plugin_opener::OpenerExt;
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|e| AppError::Validation(format!("Impossible d'ouvrir le lien : {e}")))
}

/// PC : programme par défaut du système.
#[cfg(desktop)]
fn open_url(_app: &AppHandle, url: &str) -> AppResult<()> {
    #[cfg(windows)]
    let mut cmd = {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let mut c = std::process::Command::new("cmd");
        c.args(["/C", "start", "", url]).creation_flags(CREATE_NO_WINDOW);
        c
    };
    #[cfg(target_os = "macos")]
    let mut cmd = {
        let mut c = std::process::Command::new("open");
        c.arg(url);
        c
    };
    #[cfg(all(unix, not(target_os = "macos")))]
    let mut cmd = {
        let mut c = std::process::Command::new("xdg-open");
        c.arg(url);
        c
    };
    cmd.spawn().map_err(|e| AppError::Validation(format!("Impossible d'ouvrir le lien : {e}")))?;
    Ok(())
}

/// Journal de ce PC (Paramètres → Développeur Eden Dev) : dernières lignes, à copier dans un message.
#[tauri::command]
pub async fn journal_text() -> AppResult<String> {
    Ok(crate::journal::tail(300))
}

/// Enregistre le journal (14 derniers jours et description du poste) dans Documents\GestiMarket,
/// puis montre le fichier dans l'explorateur, prêt à être glissé dans WhatsApp ou un e-mail.
#[tauri::command]
pub async fn journal_export(app: AppHandle) -> AppResult<String> {
    if cfg!(mobile) {
        return invalid("Sur téléphone ou tablette, copiez le journal et collez-le dans WhatsApp.");
    }
    let docs = app.path().document_dir().or_else(|_| app.path().home_dir().map(|h| h.join("Documents"))).map_err(internal)?;
    let dir = docs.join("GestiMarket");
    std::fs::create_dir_all(&dir)?;
    let now = chrono::Local::now();
    let path = dir.join(format!("journal-gestimarket-{}.txt", now.format("%Y-%m-%d-%Hh%M")));
    let config = app.try_state::<NetworkState>().map(|n| n.get()).unwrap_or_default();
    let text = format!(
        "GestiMarket {}\nPC : {} ({} {})\nPoste : {} — mode {} (port {})\nJournal enregistré le {}\n\n{}\n",
        env!("CARGO_PKG_VERSION"),
        network::hostname(),
        std::env::consts::OS,
        std::env::consts::ARCH,
        config.poste_name,
        config.mode,
        config.port,
        now.format("%d/%m/%Y à %H:%M"),
        crate::journal::tail(5000),
    );
    std::fs::write(&path, text)?;
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let _ = std::process::Command::new("explorer").raw_arg(format!("/select,\"{}\"", path.display())).spawn();
    }
    Ok(path.display().to_string())
}

// ───────────────────────────── Imprimante à tickets de ce poste ─────────────────────────────

fn printer_path(app: &AppHandle) -> AppResult<std::path::PathBuf> {
    let dir = app.path().app_data_dir().map_err(internal)?;
    std::fs::create_dir_all(&dir)?;
    Ok(dir.join("imprimante.json"))
}

#[tauri::command]
pub async fn printer_list() -> AppResult<Vec<String>> {
    Ok(tauri::async_runtime::spawn_blocking(crate::printer::list).await.unwrap_or_default())
}

#[tauri::command]
pub async fn printer_get_config(app: AppHandle) -> AppResult<crate::printer::PrinterConfig> {
    Ok(crate::printer::load(&printer_path(&app)?))
}

#[tauri::command]
pub async fn printer_save_config(app: AppHandle, config: crate::printer::PrinterConfig) -> AppResult<()> {
    crate::printer::save(&printer_path(&app)?, &config)?;
    Ok(())
}

/// Envoie un ticket déjà préparé (ESC/POS, en base64) à l'imprimante de ce poste.
#[tauri::command]
pub async fn printer_send(app: AppHandle, data: String) -> AppResult<()> {
    use base64::Engine;
    let config = crate::printer::load(&printer_path(&app)?);
    let bytes = base64::engine::general_purpose::STANDARD.decode(data.trim()).map_err(|_| AppError::Validation("Ticket à imprimer invalide.".into()))?;
    tauri::async_runtime::spawn_blocking(move || crate::printer::send(&config.printer, &bytes))
        .await
        .map_err(internal)?
        .map_err(AppError::Validation)
}

/// Écrit un fichier texte (export CSV) sur ce PC.
#[tauri::command]
pub async fn save_text_file(path: String, contents: String) -> AppResult<()> {
    if path.trim().is_empty() {
        return invalid("Chemin invalide.");
    }
    std::fs::write(&path, contents)?;
    Ok(())
}

/// Écrit un fichier binaire (photo PNG ou PDF du plan), reçu en base64.
#[tauri::command]
pub async fn save_binary_file(path: String, base64: String) -> AppResult<()> {
    use base64::Engine;
    if path.trim().is_empty() {
        return invalid("Chemin invalide.");
    }
    let bytes = base64::engine::general_purpose::STANDARD.decode(base64.trim()).map_err(internal)?;
    std::fs::write(&path, bytes)?;
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
    app: AppHandle,
    state: State<'_, AppState>,
    net: State<'_, NetworkState>,
    config: NetworkConfig,
    pin: Option<String>,
) -> AppResult<()> {
    let current = net.get();
    // iPhone et iPad : jamais serveur (iOS arrête les applications en arrière-plan). Android : oui, avec un
    // service permanent (notification « serveur de la boutique actif »), voir scripts/mobile/android-init.sh.
    if config.mode == "server" && cfg!(target_os = "ios") {
        return invalid("Un iPhone ou un iPad ne peut pas être poste serveur : choisissez « Poste client » ou « Poste unique ».");
    }
    if config.mode == "server" && current.mode != "server" && !crate::license::allows("server") {
        return invalid("Le mode serveur (autres PC, téléphones, tablettes) est inclus à partir de la formule PRO : voir « Abonnement & licence ».");
    }
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
    let port = config.port;
    let server = config.mode == "server";
    net.save(config)?;
    // Téléphone Android : le serveur démarre ou s'arrête tout de suite (l'application n'est pas relancée).
    if cfg!(target_os = "android") {
        if server {
            network::start_server(app, port);
        } else {
            network::stop_server();
        }
    }
    Ok(())
}

/// Aide hors ligne de ce poste : fichiers présents et téléchargement en cours.
#[tauri::command]
pub async fn help_offline_status(state: State<'_, AppState>) -> AppResult<serde_json::Value> {
    Ok(crate::aide::status(&crate::aide::dir_of(&state.db_path)))
}

/// Télécharge les vidéos d'aide et le manuel (en arrière-plan) pour les lire sans Internet.
#[tauri::command]
pub async fn help_offline_download(state: State<'_, AppState>, names: Vec<String>) -> AppResult<()> {
    crate::aide::start_download(crate::aide::dir_of(&state.db_path), names).map_err(AppError::Validation)
}

/// Ouvre un fichier d'aide (manuel PDF) : celui de ce poste s'il est téléchargé, sinon l'adresse en ligne.
#[tauri::command]
pub async fn open_help(app: AppHandle, state: State<'_, AppState>, name: String) -> AppResult<()> {
    if !crate::aide::valid_name(&name) {
        return invalid("Fichier d'aide inconnu.");
    }
    let path = crate::aide::dir_of(&state.db_path).join(&name);
    if path.exists() {
        #[cfg(mobile)]
        {
            use tauri_plugin_opener::OpenerExt;
            return app
                .opener()
                .open_path(path.to_string_lossy(), None::<&str>)
                .map_err(|e| AppError::Validation(format!("Impossible d'ouvrir le lien : {e}")));
        }
        #[cfg(desktop)]
        return open_url(&app, &path.to_string_lossy());
    }
    open_url(&app, &format!("{}/{name}", crate::aide::HELP_RELEASE))
}

/// Boutiques GestiMarket trouvées sur le Wi-Fi ou le partage de connexion de cet appareil.
#[tauri::command]
pub async fn discover_servers() -> AppResult<Vec<serde_json::Value>> {
    tauri::async_runtime::spawn_blocking(network::discover).await.map_err(internal)
}

/// Espace propriétaire (compte Eden Dev sur ce téléphone) : boutiques, état de leur PC serveur, paiements.
/// Commande locale seulement : jamais accessible depuis le réseau (la session reste sur cet appareil).
#[tauri::command]
pub async fn owner(state: State<'_, AppState>, action: String, args: Option<serde_json::Value>) -> AppResult<serde_json::Value> {
    let dir = state.db_path.parent().map(std::path::Path::to_path_buf).unwrap_or_default();
    let a = args.unwrap_or(serde_json::Value::Null);
    let name = action.clone();
    let result = tauri::async_runtime::spawn_blocking(move || crate::account::owner_action(&dir, &action, &a)).await.map_err(internal)?;
    if let Ok(v) = &result {
        crate::account::after_owner_action(&state.conn(), &name, v);
    }
    result.map_err(AppError::Validation)
}

// ───────────────────────────── Restauration des sauvegardes ─────────────────────────────
// Commandes de cet appareil seulement (jamais servies au réseau), voir local.rs. Commandes asynchrones :
// elles tournent hors du fil de l'interface (pas de copie de l'AppHandle vers un autre fil, voir network.rs).

/// Ce que contient une sauvegarde (avant de la restaurer), ou le mot de passe qu'il faut.
#[tauri::command]
pub async fn backup_inspect(state: State<'_, AppState>, path: String, password: Option<String>) -> AppResult<Value> {
    crate::local::call(&state, &Origin::Local, "backup_inspect", serde_json::json!({ "path": path, "password": password }))
}

/// Remplace la base de cette boutique par une sauvegarde (appareil neuf, ou administrateur et son code PIN).
#[tauri::command]
pub async fn backup_restore(state: State<'_, AppState>, path: String, password: Option<String>, pin: Option<String>) -> AppResult<Value> {
    crate::local::call(&state, &Origin::Local, "backup_restore", serde_json::json!({ "path": path, "password": password, "pin": pin }))
}

/// Copies de sauvegarde gardées sur cet appareil.
#[tauri::command]
pub async fn backup_list(state: State<'_, AppState>) -> AppResult<Value> {
    crate::local::call(&state, &Origin::Local, "backup_list", Value::Null)
}

/// Relance l'application (nouveau mode réseau). Sur téléphone et tablette, l'interface se recharge elle-même :
/// rien à relancer côté Rust (pas de serveur sur mobile).
#[tauri::command]
pub async fn restart_app(app: AppHandle) {
    #[cfg(desktop)]
    app.restart();
    #[cfg(mobile)]
    let _ = app;
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

#[cfg(desktop)]
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
#[cfg(desktop)]
#[tauri::command]
pub async fn toggle_customer_display(app: AppHandle, monitor: Option<usize>, poste: String) -> AppResult<bool> {
    if let Some(w) = app.get_webview_window("display") {
        w.close().map_err(internal)?;
        return Ok(false);
    }
    if !crate::license::allows("customer_display") {
        return invalid("L'écran client est inclus à partir de la formule PRO : voir « Abonnement & licence ».");
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
    if let Some(d) = webview_dir(&app) {
        builder = builder.data_directory(d);
    }
    if let Some(m) = &target {
        let scale = m.scale_factor();
        builder = builder.position(m.position().x as f64 / scale, m.position().y as f64 / scale).fullscreen(true);
    }
    builder.build().map_err(internal)?;
    Ok(true)
}

/// Téléphone et tablette : pas de 2ᵉ écran. L'écran client s'ouvre sur un autre appareil, par son lien.
#[cfg(mobile)]
#[tauri::command]
pub async fn list_monitors() -> AppResult<Vec<MonitorInfo>> {
    Ok(Vec::new())
}

#[cfg(mobile)]
#[tauri::command]
pub async fn toggle_customer_display(monitor: Option<usize>, poste: String) -> AppResult<bool> {
    let _ = (monitor, poste);
    invalid("Sur téléphone ou tablette, ouvrez l'écran client sur un autre appareil avec le lien affiché.")
}

// ───────────────────────────── Plusieurs boutiques ─────────────────────────────

/// Données de navigateur propres à la boutique (stockage local, session). `None` pour la boutique 1,
/// qui garde le dossier par défaut (installations existantes inchangées).
pub fn webview_dir(app: &AppHandle) -> Option<std::path::PathBuf> {
    let slot = app.try_state::<crate::boutique::Current>().map(|c| c.slot).unwrap_or(1);
    if slot <= 1 {
        return None;
    }
    app.path().app_local_data_dir().ok().map(|d| d.join("boutiques").join(slot.to_string()).join("webview"))
}

#[derive(Serialize)]
pub struct BoutiquesInfo {
    pub current: u8,
    pub max: u8,
    pub boutiques: Vec<crate::boutique::BoutiqueInfo>,
    /// Encore possible d'en créer une ?
    pub can_create: bool,
}

fn boutiques_root(app: &AppHandle) -> AppResult<std::path::PathBuf> {
    app.path().app_data_dir().map_err(internal)
}

#[tauri::command]
pub async fn list_boutiques(app: AppHandle, current: State<'_, crate::boutique::Current>) -> AppResult<BoutiquesInfo> {
    let root = boutiques_root(&app)?;
    Ok(BoutiquesInfo {
        current: current.slot,
        max: crate::boutique::MAX,
        boutiques: crate::boutique::list(&root, current.slot),
        can_create: crate::boutique::next_free(&root).is_some(),
    })
}

/// Ouvre une autre boutique de ce PC dans sa propre fenêtre (elle demande sa propre connexion).
#[tauri::command]
pub async fn open_boutique(app: AppHandle, current: State<'_, crate::boutique::Current>, slot: u8) -> AppResult<String> {
    if cfg!(mobile) {
        return invalid("Plusieurs boutiques : sur PC seulement.");
    }
    let root = boutiques_root(&app)?;
    if !(1..=crate::boutique::MAX).contains(&slot) || (slot > 1 && !crate::boutique::data_dir(&root, slot).exists()) {
        return invalid("Cette boutique n'existe pas sur ce PC.");
    }
    if slot == current.slot {
        return Ok("Vous êtes déjà dans cette boutique.".into());
    }
    if crate::boutique::is_open(slot) {
        return Ok("Cette boutique est déjà ouverte dans une autre fenêtre (barre des tâches).".into());
    }
    crate::boutique::launch(slot).map_err(internal)?;
    Ok("Ouverture de la boutique…".into())
}

/// Crée une nouvelle boutique (5 au maximum) et l'ouvre : sa première configuration démarre.
/// Réservé à l'administrateur connecté sur ce PC.
#[tauri::command]
pub async fn create_boutique(app: AppHandle, state: State<'_, AppState>) -> AppResult<u8> {
    if cfg!(mobile) {
        return invalid("Plusieurs boutiques : sur PC seulement.");
    }
    let Some(admin) = state.user(&Origin::Local).filter(|u| u.is_admin()) else {
        return invalid("Seul l'administrateur peut créer une nouvelle boutique.");
    };
    let root = boutiques_root(&app)?;
    let Some(slot) = crate::boutique::next_free(&root) else {
        return invalid(format!("{} boutiques au maximum sur un même PC.", crate::boutique::MAX));
    };
    std::fs::create_dir_all(crate::boutique::data_dir(&root, slot))?;
    let _ = crate::services::audit::log(&state.conn(), &admin, "Création d'une boutique", "settings", None, format!("Boutique {slot} créée sur ce PC"));
    crate::boutique::launch(slot).map_err(internal)?;
    Ok(slot)
}
