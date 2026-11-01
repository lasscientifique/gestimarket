mod cloud;
mod commands;
mod db;
mod error;
mod live;
mod network;
mod rpc;
mod services;
mod state;

use std::time::Duration;

use tauri::http::Response;
use tauri::Manager;

use crate::state::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        // Photos servies depuis la base : media://localhost/<id> (http://media.localhost/<id> sous Windows).
        .register_uri_scheme_protocol("media", |ctx, request| {
            let id: i64 = request
                .uri()
                .path()
                .trim_start_matches('/')
                .split(['.', '?'])
                .next()
                .and_then(|s| s.parse().ok())
                .unwrap_or(0);
            let found = ctx
                .app_handle()
                .try_state::<AppState>()
                .and_then(|state| services::media::get(&state.conn(), id).ok().flatten());
            match found {
                Some((mime, data)) => Response::builder()
                    .header("Content-Type", mime)
                    .header("Cache-Control", "public, max-age=31536000, immutable")
                    .header("Access-Control-Allow-Origin", "*")
                    .body(data)
                    .unwrap_or_default(),
                None => Response::builder().status(404).body(Vec::new()).unwrap_or_default(),
            }
        })
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&dir)?;
            let db_path = dir.join("gestimarket.db");
            let conn = db::open(&db_path)?;
            // Le code-barres est obligatoire : on en attribue un aux anciens produits qui n'en ont pas.
            if let Err(e) = services::catalog::fill_missing_barcodes(&conn) {
                eprintln!("Attribution des codes-barres impossible : {e}");
            }
            if let Err(e) = services::backup::auto_backup(&conn, false) {
                eprintln!("Sauvegarde automatique impossible : {e}");
            }
            app.manage(AppState::new(conn, db_path));

            // Multi-postes : en mode serveur, la base est partagée sur le réseau local.
            let net = network::NetworkState::load(dir.join("network.json"));
            let config = net.get();
            app.manage(net);
            if config.mode == "server" {
                network::start_server(app.handle().clone(), config.port);
                // Application mobile : adresse du serveur publiée sur Supabase (si activé).
                cloud::start(app.handle().clone(), config.port);
            }

            // Sauvegarde automatique vérifiée toutes les heures (une copie par jour au maximum).
            let handle = app.handle().clone();
            std::thread::spawn(move || loop {
                std::thread::sleep(Duration::from_secs(3600));
                if let Some(state) = handle.try_state::<AppState>() {
                    if let Err(e) = services::backup::auto_backup(&state.conn(), false) {
                        eprintln!("Sauvegarde automatique impossible : {e}");
                    }
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::rpc,
            commands::save_text_file,
            commands::read_text_file,
            commands::get_network_config,
            commands::save_network_config,
            commands::restart_app,
            commands::list_monitors,
            commands::toggle_customer_display,
        ])
        .build(tauri::generate_context!())
        .expect("erreur au lancement de GestiMarket")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                // Le poste serveur s'arrête : l'application mobile l'affiche aussitôt.
                cloud::publish_offline(app);
            }
        });
}
