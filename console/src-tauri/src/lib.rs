//! Console Eden Dev : l'interface (React) fait tout le travail avec Supabase ; ici, seulement l'enregistrement
//! des fichiers sur PC, le nom de l'ordinateur (appareil autorisé) et les modules de Tauri.

/// Enregistre un texte (CSV, fichier de licence) au chemin choisi dans « Enregistrer sous » (PC).
#[tauri::command]
fn save_text(path: String, contents: String) -> Result<(), String> {
    std::fs::write(&path, contents.as_bytes()).map_err(|e| format!("Enregistrement impossible : {e}"))
}

/// Nom de l'ordinateur, proposé comme nom de l'appareil autorisé.
#[tauri::command]
fn device_name() -> String {
    std::env::var("COMPUTERNAME")
        .or_else(|_| std::env::var("HOSTNAME"))
        .unwrap_or_default()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init());

    #[cfg(desktop)]
    let builder = builder
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init());

    builder
        .invoke_handler(tauri::generate_handler![save_text, device_name])
        .run(tauri::generate_context!())
        .expect("Console Eden Dev : démarrage impossible");
}
