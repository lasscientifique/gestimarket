mod account;
mod boutique;
mod cloud;
mod commands;
mod db;
mod error;
mod journal;
mod license;
mod live;
mod network;
mod printer;
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
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init());
    // Téléphone et tablette : scanner natif (caméra) pour les codes-barres et QR codes.
    #[cfg(mobile)]
    let builder = builder.plugin(tauri_plugin_barcode_scanner::init());
    builder
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
            #[cfg(desktop)]
            let (slot, current) = {
                let slot = boutique::slot_from_args(std::env::args());
                let Some(current) = boutique::acquire(slot) else {
                    // Déjà ouverte : on ne lance pas une deuxième fenêtre sur la même base.
                    eprintln!("La boutique {slot} est déjà ouverte sur ce PC.");
                    std::process::exit(0);
                };
                (slot, current)
            };
            // Téléphone et tablette : une seule boutique, et le système n'ouvre qu'une fois l'application.
            #[cfg(mobile)]
            let (slot, current) = (1u8, boutique::single());
            let root = app.path().app_data_dir()?;
            let dir = boutique::data_dir(&root, slot);
            std::fs::create_dir_all(&dir)?;
            journal::init(dir.join("journaux"));
            journal::info(format!("Démarrage de GestiMarket {} (boutique {slot}, {})", env!("CARGO_PKG_VERSION"), std::env::consts::OS));
            let db_path = dir.join("gestimarket.db");
            let conn = db::open(&db_path)?;
            let shop_name = services::settings::get(&conn, "shop_name").unwrap_or_default();
            // Le code-barres est obligatoire : on en attribue un aux anciens produits qui n'en ont pas.
            if let Err(e) = services::catalog::fill_missing_barcodes(&conn) {
                journal::error(format!("Attribution des codes-barres impossible : {e}"));
            }
            // Sauvegarde automatique, même sans dossier choisi : Documents\GestiMarket\Sauvegardes.
            // Dossier Documents ; à défaut (Linux sans dossiers utilisateur déclarés), ~/Documents.
            #[cfg(desktop)]
            {
                let docs = app.path().document_dir().or_else(|_| app.path().home_dir().map(|h| h.join("Documents")));
                if let Ok(docs) = docs {
                    let mut d = docs.join("GestiMarket").join("Sauvegardes");
                    if slot > 1 {
                        d = d.join(format!("Boutique {slot}"));
                    }
                    services::backup::set_default_dir(d);
                }
            }
            // Téléphone et tablette : copies dans le dossier de l'application (à enregistrer ailleurs
            // depuis Paramètres → Sauvegarde, le téléphone pouvant être perdu).
            #[cfg(mobile)]
            services::backup::set_default_dir(dir.join("Sauvegardes"));
            if let Err(e) = services::backup::auto_backup(&conn, false) {
                journal::error(format!("Sauvegarde automatique impossible : {e}"));
            }
            // Licence de cette boutique (vérifiée hors ligne) et horloge mémorisée.
            license::init(&conn, &root, &dir, slot);
            app.manage(AppState::new(conn, db_path));
            app.manage(current);

            // Fenêtre principale (créée ici pour séparer les données de navigateur de chaque boutique).
            if let Some(cfg) = app.config().app.windows.iter().find(|w| w.label == "main").cloned() {
                let mut builder = tauri::WebviewWindowBuilder::from_config(app.handle(), &cfg)?;
                #[cfg(desktop)]
                {
                    let mut title = if shop_name.trim().is_empty() {
                        "GestiMarket — Gestion commerciale".to_string()
                    } else {
                        format!("GestiMarket — {}", shop_name.trim())
                    };
                    if slot > 1 {
                        title.push_str(&format!(" (boutique {slot})"));
                    }
                    builder = builder.title(title);
                }
                #[cfg(mobile)]
                let _ = &shop_name;
                if let Some(d) = commands::webview_dir(app.handle()) {
                    builder = builder.data_directory(d);
                }
                builder.build()?;
            }

            // Multi-postes : en mode serveur, la base est partagée sur le réseau local.
            // Chaque boutique a son propre port par défaut (7878, 7888, 7898…).
            let net = network::NetworkState::load(dir.join("network.json"), boutique::default_port(slot));
            let config = net.get();
            journal::info(format!("Poste « {} » en mode {} (port {})", config.poste_name, config.mode, config.port));
            app.manage(net);
            // Le mode serveur est réservé au PC : Android et iOS arrêtent les applications en arrière-plan.
            if config.mode == "server" && cfg!(desktop) {
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
                            let r = account::sync(&state);
                            journal::state("Synchronisation de la licence", r.as_ref().map(|_| ()).map_err(|e| e.as_str()));
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
                        journal::error(format!("Sauvegarde automatique impossible : {e}"));
                    }
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::rpc,
            commands::open_contact,
            commands::journal_text,
            commands::journal_export,
            commands::printer_list,
            commands::printer_get_config,
            commands::printer_save_config,
            commands::printer_send,
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
