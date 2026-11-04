mod account;
mod boutique;
mod cloud;
mod commands;
mod db;
mod error;
mod license;
mod live;
mod network;
mod rpc;
mod services;
mod state;
mod tunnel;

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
            // Plusieurs boutiques sur ce PC : chacune a son dossier, sa base et sa fenêtre.
            let slot = boutique::slot_from_args(std::env::args());
            let Some(current) = boutique::acquire(slot) else {
                // Déjà ouverte : on ne lance pas une deuxième fenêtre sur la même base.
                eprintln!("La boutique {slot} est déjà ouverte sur ce PC.");
                std::process::exit(0);
            };
            let root = app.path().app_data_dir()?;
            let dir = boutique::data_dir(&root, slot);
            std::fs::create_dir_all(&dir)?;
            let db_path = dir.join("gestimarket.db");
            let conn = db::open(&db_path)?;
            let shop_name = services::settings::get(&conn, "shop_name").unwrap_or_default();
            // Le code-barres est obligatoire : on en attribue un aux anciens produits qui n'en ont pas.
            if let Err(e) = services::catalog::fill_missing_barcodes(&conn) {
                eprintln!("Attribution des codes-barres impossible : {e}");
            }
            if let Err(e) = services::backup::auto_backup(&conn, false) {
                eprintln!("Sauvegarde automatique impossible : {e}");
            }
            // Licence de cette boutique (vérifiée hors ligne) et horloge mémorisée.
            license::init(&conn, &root, &dir, slot);
            app.manage(AppState::new(conn, db_path));
            app.manage(current);

            // Fenêtre principale (créée ici pour séparer les données de navigateur de chaque boutique).
            if let Some(cfg) = app.config().app.windows.iter().find(|w| w.label == "main").cloned() {
                let mut title = if shop_name.trim().is_empty() {
                    "GestiMarket — Gestion commerciale".to_string()
                } else {
                    format!("GestiMarket — {}", shop_name.trim())
                };
                if slot > 1 {
                    title.push_str(&format!(" (boutique {slot})"));
                }
                let mut builder = tauri::WebviewWindowBuilder::from_config(app.handle(), &cfg)?.title(title);
                if let Some(d) = commands::webview_dir(app.handle()) {
                    builder = builder.data_directory(d);
                }
                builder.build()?;
            }

            // Multi-postes : en mode serveur, la base est partagée sur le réseau local.
            // Chaque boutique a son propre port par défaut (7878, 7888, 7898…).
            let net = network::NetworkState::load(dir.join("network.json"), boutique::default_port(slot));
            let config = net.get();
            app.manage(net);
            if config.mode == "server" {
                network::start_server(app.handle().clone(), config.port);
                // Application mobile : adresse du serveur publiée sur Supabase (si activé).
                cloud::start(app.handle().clone(), config.port);
                // Adresse Internet automatique : cloudflared lancé avec le jeton du tunnel de la boutique.
                tunnel::start(app.handle().clone());
            }

            // Licence : horloge mémorisée chaque minute ; synchronisation avec Eden Dev toutes les 30 min
            // (nouvelle licence après un paiement, renouvellement, révocation), si Internet est disponible.
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_secs(8));
                let mut minutes: u32 = 0;
                loop {
                    if let Some(state) = handle.try_state::<AppState>() {
                        license::tick(&state.conn());
                        // Toutes les 30 minutes ; toutes les 2 minutes dans les 24 h qui suivent un paiement.
                        let due = minutes % 30 == 0 || (minutes % 2 == 0 && account::fast_sync());
                        if due && license::should_sync() {
                            if let Err(e) = account::sync(&state) {
                                eprintln!("Synchronisation de la licence impossible : {e}");
                            }
                        }
                    }
                    minutes = minutes.wrapping_add(1);
                    std::thread::sleep(Duration::from_secs(60));
                }
            });

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
            commands::open_contact,
            commands::save_text_file,
            commands::save_binary_file,
            commands::read_text_file,
            commands::get_network_config,
            commands::save_network_config,
            commands::restart_app,
            commands::list_monitors,
            commands::toggle_customer_display,
            commands::list_boutiques,
            commands::open_boutique,
            commands::create_boutique,
        ])
        .build(tauri::generate_context!())
        .expect("erreur au lancement de GestiMarket")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                // Le poste serveur s'arrête : l'application mobile l'affiche aussitôt.
                cloud::publish_offline(app);
                tunnel::stop();
            }
        });
}
