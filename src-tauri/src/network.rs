//! Configuration multi-postes et serveur réseau local (Wi-Fi / Ethernet).
//!
//! Trois modes :
//!  - `local`  : poste unique, base de données sur ce PC ;
//!  - `server` : ce PC garde la base et la partage aux autres postes du réseau (port HTTP, 7878 par défaut) ;
//!  - `client` : ce PC travaille sur la base du poste serveur.
//!
//! Le serveur sert aussi l'application aux navigateurs du réseau (tablette, téléphone, TV de l'écran client).

use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use axum::body::Bytes;
use axum::extract::{Path, State};
use axum::http::{header, HeaderMap, StatusCode, Uri};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Manager};
use tower_http::compression::CompressionLayer;
use tower_http::cors::{AllowOrigin, CorsLayer};

use crate::state::{AppState, Origin};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct NetworkConfig {
    /// `local`, `server` ou `client`
    pub mode: String,
    /// Nom de ce poste (sert à associer l'écran client à la bonne caisse).
    pub poste_name: String,
    /// Port d'écoute du serveur.
    pub port: u16,
    /// Adresse du serveur pour un poste client, ex. `http://192.168.1.10:7878`.
    pub server_url: String,
}

impl Default for NetworkConfig {
    fn default() -> Self {
        Self { mode: "local".into(), poste_name: "Caisse 1".into(), port: 7878, server_url: String::new() }
    }
}

pub struct NetworkState {
    path: PathBuf,
    pub config: Mutex<NetworkConfig>,
}

impl NetworkState {
    /// `default_port` : port proposé tant que ce poste n'a pas de configuration (dépend de la boutique).
    pub fn load(path: PathBuf, default_port: u16) -> Self {
        let config = std::fs::read_to_string(&path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_else(|| NetworkConfig { port: default_port, ..NetworkConfig::default() });
        Self { path, config: Mutex::new(config) }
    }

    pub fn get(&self) -> NetworkConfig {
        self.config.lock().unwrap_or_else(|e| e.into_inner()).clone()
    }

    pub fn save(&self, mut c: NetworkConfig) -> std::io::Result<()> {
        if !["local", "server", "client"].contains(&c.mode.as_str()) {
            c.mode = "local".into();
        }
        c.server_url = c.server_url.trim().trim_end_matches('/').to_string();
        if !c.server_url.is_empty() && !c.server_url.starts_with("http") {
            c.server_url = format!("http://{}", c.server_url);
        }
        if c.port == 0 {
            c.port = 7878;
        }
        if c.poste_name.trim().is_empty() {
            c.poste_name = "Caisse 1".into();
        }
        std::fs::write(&self.path, serde_json::to_string_pretty(&c).unwrap_or_default())?;
        *self.config.lock().unwrap_or_else(|e| e.into_inner()) = c;
        Ok(())
    }
}

/// Adresse IPv4 privée du réseau local (Wi-Fi, câble, point d'accès d'un téléphone).
fn private_v4(ip: &std::net::Ipv4Addr) -> bool {
    ip.is_private() && !ip.is_loopback()
}

/// Carte que les autres appareils ne joignent pas : données mobiles d'un téléphone, machines virtuelles,
/// VPN, Bluetooth (noms Android, Linux et Windows).
fn unreachable_card(name: &str) -> bool {
    let n = name.to_ascii_lowercase();
    const PREFIXES: [&str; 12] = ["rmnet", "ccmni", "v4-", "dummy", "tun", "ppp", "docker", "veth", "br-", "virbr", "vboxnet", "vmnet"];
    const PARTS: [&str; 10] = ["vethernet", "virtualbox", "vmware", "hyper-v", "zerotier", "tailscale", "hamachi", "loopback", "bluetooth", "wsl"];
    PREFIXES.iter().any(|p| n.starts_with(p)) || PARTS.iter().any(|p| n.contains(p))
}

/// Ordre des adresses : celle que les téléphones et les autres caisses joignent d'abord.
/// 0 = carte de la route vers Internet ou le routeur (Wi-Fi, câble, point d'accès) ; 1 = autre carte ;
/// 2 = carte injoignable (données mobiles, VirtualBox, Hyper-V, VPN…).
fn card_rank(name: &str, ip: &str, route: &[String]) -> u8 {
    if unreachable_card(name) {
        2
    } else if route.iter().any(|r| r == ip) {
        0
    } else {
        1
    }
}

/// Adresses IP locales de cet appareil (à saisir sur les postes clients, QR codes des téléphones).
///
/// La première est celle que les autres appareils joignent. Sur un PC avec plusieurs cartes (VirtualBox,
/// Hyper-V, prise débranchée…), les adresses virtuelles passaient avant le Wi-Fi : le premier QR code
/// affiché ne marchait pas. La carte de la route est trouvée sans envoi de paquet : « connecter » un socket
/// UDP révèle celle que choisit la table de routage. Sur un téléphone serveur, cette route passe souvent
/// par les données mobiles : leur carte (rmnet…) est mise après le point d'accès.
pub fn local_ips() -> Vec<String> {
    let mut route = Vec::new();
    for target in ["8.8.8.8:80", "192.168.1.1:80", "10.0.0.1:80"] {
        if let Ok(sock) = std::net::UdpSocket::bind("0.0.0.0:0") {
            if sock.connect(target).is_ok() {
                if let Ok(std::net::SocketAddr::V4(addr)) = sock.local_addr() {
                    let ip = addr.ip().to_string();
                    if !addr.ip().is_loopback() && !addr.ip().is_unspecified() && !route.contains(&ip) {
                        route.push(ip);
                    }
                }
            }
        }
    }
    let mut cards: Vec<(u8, String)> = Vec::new();
    if let Ok(list) = if_addrs::get_if_addrs() {
        for i in list {
            if let std::net::IpAddr::V4(v4) = i.ip() {
                let ip = v4.to_string();
                if private_v4(&v4) && !cards.iter().any(|(_, c)| c == &ip) {
                    cards.push((card_rank(&i.name, &ip, &route), ip));
                }
            }
        }
    }
    // Adresse de la route qui n'est pas une adresse privée de carte (données mobiles en 100.x, adresse
    // publique) : gardée, mais en dernier.
    for ip in &route {
        if !cards.iter().any(|(_, c)| c == ip) {
            cards.push((2, ip.clone()));
        }
    }
    cards.sort_by_key(|(rank, _)| *rank); // tri stable : l'ordre des cartes est gardé dans chaque groupe
    cards.into_iter().map(|(_, ip)| ip).collect()
}

/// Adresses à essayer pour trouver un serveur GestiMarket : tout le réseau /24 de chaque adresse locale.
pub fn scan_candidates(local: &[String]) -> Vec<std::net::Ipv4Addr> {
    let mut out = Vec::new();
    for ip in local {
        let Ok(v4) = ip.parse::<std::net::Ipv4Addr>() else { continue };
        if !private_v4(&v4) {
            continue;
        }
        let [a, b, c, _] = v4.octets();
        for d in 1..=254u8 {
            let cand = std::net::Ipv4Addr::new(a, b, c, d);
            if !out.contains(&cand) {
                out.push(cand);
            }
        }
    }
    out
}

/// Boutiques GestiMarket sur le Wi-Fi ou le partage de connexion de cet appareil : chaque adresse du
/// réseau local est essayée sur les ports des boutiques (7878, 7888, 7898), 64 à la fois. Sans
/// diffusion ni autorisation spéciale : marche sur les téléphones, les TV et tous les réseaux, même sans Internet.
pub fn discover() -> Vec<Value> {
    use std::net::{SocketAddr, TcpStream};
    use std::time::Duration;
    let candidates: Vec<SocketAddr> = scan_candidates(&local_ips())
        .into_iter()
        .flat_map(|ip| [7878u16, 7888, 7898].into_iter().map(move |p| SocketAddr::from((ip, p))))
        .collect();
    let found = Arc::new(Mutex::new(Vec::<Value>::new()));
    let size = candidates.len().div_ceil(64).max(1);
    let workers: Vec<_> = candidates
        .chunks(size)
        .map(|chunk| {
            let chunk = chunk.to_vec();
            let found = found.clone();
            std::thread::spawn(move || {
                for addr in chunk {
                    if TcpStream::connect_timeout(&addr, Duration::from_millis(350)).is_err() {
                        continue;
                    }
                    let url = format!("http://{addr}");
                    let agent = ureq::AgentBuilder::new().timeout(Duration::from_secs(2)).build();
                    let Ok(resp) = agent.get(&format!("{url}/api/ping")).call() else { continue };
                    let Ok(v) = resp.into_json::<Value>() else { continue };
                    if v["app"].as_str() == Some("GestiMarket") {
                        found.lock().unwrap_or_else(|e| e.into_inner()).push(json!({
                            "url": url, "shop_name": v["shop_name"], "version": v["version"],
                            "poste": v["poste"], "device": v["device"],
                        }));
                    }
                }
            })
        })
        .collect();
    for w in workers {
        let _ = w.join();
    }
    let mut list = found.lock().unwrap_or_else(|e| e.into_inner()).clone();
    list.sort_by(|a, b| a["shop_name"].as_str().unwrap_or_default().cmp(b["shop_name"].as_str().unwrap_or_default()));
    list
}

/// Nom de ce PC.
pub fn hostname() -> String {
    std::env::var("COMPUTERNAME")
        .or_else(|_| std::env::var("HOSTNAME"))
        .ok()
        .or_else(|| std::fs::read_to_string("/etc/hostname").ok())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "PC".into())
}

/// Poignée de l'application partagée par les requêtes du serveur.
///
/// Une `AppHandle` ne se clone pas sur les fils du serveur : elle contient un compteur `Rc` non atomique
/// (fenêtres de tao, sous Windows comme sous Linux). Clonée puis relâchée à chaque requête, en parallèle,
/// elle corrompait la mémoire et arrêtait net le poste serveur (test d'interface, visite téléphone).
/// Une seule `AppHandle`, créée sur le fil principal, est gardée dans un `Arc`, qui se clone sans risque.
type App = Arc<AppHandle>;

/// Serveur en marche : port, signal d'arrêt (http) et poignée (https).
static RUNNING: Mutex<Option<(u16, tokio::sync::watch::Sender<bool>, axum_server::Handle)>> = Mutex::new(None);

/// Arrête le serveur (téléphone qui quitte le mode serveur sans redémarrer l'application).
pub fn stop_server() {
    if let Some((port, stop, https)) = RUNNING.lock().unwrap_or_else(|e| e.into_inner()).take() {
        let _ = stop.send(true);
        https.graceful_shutdown(Some(std::time::Duration::from_secs(2)));
        crate::journal::info(format!("Serveur de la boutique arrêté (port {port})"));
    }
}

/// Démarre le serveur HTTP du poste serveur (appelé sur le fil principal). Sans effet s'il tourne déjà.
pub fn start_server(app: AppHandle, port: u16) {
    let (stop_tx, mut stop_rx) = tokio::sync::watch::channel(false);
    let https_handle = axum_server::Handle::new();
    {
        let mut running = RUNNING.lock().unwrap_or_else(|e| e.into_inner());
        if running.is_some() {
            return;
        }
        *running = Some((port, stop_tx, https_handle.clone()));
    }
    let app: App = Arc::new(app);
    tauri::async_runtime::spawn(async move {
        let router = Router::new()
            .route("/rpc/{cmd}", post(rpc_handler))
            .route("/rpc-batch", post(rpc_batch_handler))
            .route("/media/{id}", get(media_handler))
            .route("/aide/{file}", get(aide_handler))
            .route("/api/ping", get(ping_handler));
        // Tests d'interface : commandes propres à l'appareil (restauration, Espace propriétaire).
        // Absent des compilations publiées.
        #[cfg(debug_assertions)]
        let router = router.route("/__test/local/{cmd}", post(test_local_handler));
        let router = router
            .fallback(get(asset_handler))
            .layer(cors())
            // gzip / brotli selon le navigateur (les photos, déjà compressées, ne le sont pas).
            .layer(CompressionLayer::new())
            .with_state(app.clone());
        // HTTPS (port + 1) : indispensable pour utiliser la caméra des téléphones et tablettes (scanner).
        if let Some(tls) = tls_config(&app).await {
            let https = router.clone();
            tauri::async_runtime::spawn(async move {
                let addr = std::net::SocketAddr::from(([0, 0, 0, 0], port.saturating_add(1)));
                if let Err(e) = axum_server::bind_rustls(addr, tls)
                    .handle(https_handle)
                    .serve(https.into_make_service_with_connect_info::<std::net::SocketAddr>())
                    .await
                {
                    crate::journal::error(format!("Serveur HTTPS arrêté : {e}"));
                }
            });
        }
        match tokio::net::TcpListener::bind(("0.0.0.0", port)).await {
            Ok(listener) => {
                if let Err(e) = axum::serve(listener, router.into_make_service_with_connect_info::<std::net::SocketAddr>())
                    .with_graceful_shutdown(async move {
                        let _ = stop_rx.changed().await;
                    })
                    .await
                {
                    crate::journal::error(format!("Serveur réseau arrêté : {e}"));
                }
            }
            Err(e) => {
                crate::journal::error(format!("Impossible d'ouvrir le port {port} : {e}"));
                RUNNING.lock().unwrap_or_else(|e| e.into_inner()).take();
            }
        }
    });
}

/// Certificat auto-signé du poste serveur (régénéré si l'adresse IP du PC change).
/// Les navigateurs affichent un avertissement la première fois : il suffit de l'accepter.
async fn tls_config(app: &AppHandle) -> Option<axum_server::tls_rustls::RustlsConfig> {
    let _ = rustls::crypto::ring::default_provider().install_default();
    let dir = app.path().app_data_dir().ok()?;
    let (cert_path, key_path, ips_path) = (dir.join("https-cert.pem"), dir.join("https-key.pem"), dir.join("https-ips.txt"));
    let ips = local_ips();
    let mut names: Vec<String> = vec!["localhost".into(), "127.0.0.1".into(), "gestimarket.local".into()];
    names.extend(ips.iter().cloned());
    let wanted = names.join(",");
    let current = std::fs::read_to_string(&ips_path).unwrap_or_default();
    let have_all = names.iter().all(|n| current.split(',').any(|c| c == n));
    if !(cert_path.exists() && key_path.exists() && have_all) {
        // On garde aussi les anciennes adresses (point d'accès du téléphone, Wi-Fi du magasin…).
        let mut all: Vec<String> = current.split(',').filter(|c| !c.is_empty()).map(String::from).collect();
        for n in wanted.split(',') {
            if !all.iter().any(|x| x == n) {
                all.push(n.to_string());
            }
        }
        let mut params = rcgen::CertificateParams::new(all.clone()).ok()?;
        params.distinguished_name.push(rcgen::DnType::CommonName, "GestiMarket (poste serveur)");
        params.not_after = rcgen::date_time_ymd(2045, 1, 1);
        let key = rcgen::KeyPair::generate().ok()?;
        let cert = params.self_signed(&key).ok()?;
        std::fs::create_dir_all(&dir).ok()?;
        std::fs::write(&cert_path, cert.pem()).ok()?;
        std::fs::write(&key_path, key.serialize_pem()).ok()?;
        std::fs::write(&ips_path, all.join(",")).ok()?;
    }
    match axum_server::tls_rustls::RustlsConfig::from_pem_file(&cert_path, &key_path).await {
        Ok(c) => Some(c),
        Err(e) => {
            crate::journal::error(format!("HTTPS indisponible : {e}"));
            None
        }
    }
}

/// Adresse et route d'un appareil. Le tunnel (cloudflared) tourne sur ce PC : ses requêtes arrivent
/// depuis 127.0.0.1 avec les en-têtes Cloudflare. Ces en-têtes ne sont crus que depuis cette boucle locale.
fn client_route(addr: &std::net::SocketAddr, headers: &HeaderMap) -> (String, &'static str) {
    let peer = addr.ip().to_canonical();
    let header = |name: &str| headers.get(name).and_then(|v| v.to_str().ok()).map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
    if peer.is_loopback() {
        if let Some(real) = header("cf-connecting-ip").or_else(|| header("x-forwarded-for").map(|s| s.split(',').next().unwrap_or("").trim().to_string())) {
            return (real.chars().take(64).collect(), "internet");
        }
        if headers.contains_key("cf-ray") {
            return (peer.to_string(), "internet");
        }
    }
    (peer.to_string(), "local")
}

/// Origines autorisées à appeler ce serveur depuis une autre adresse : les postes clients (application de
/// bureau) et le développement. Tablettes, téléphones et écran client chargent l'interface depuis ce serveur
/// lui-même (même origine) : un site web quelconque ouvert sur un appareil du magasin ne peut pas l'appeler.
fn cors() -> CorsLayer {
    CorsLayer::new()
        .allow_origin(AllowOrigin::predicate(|origin, _| allowed_origin(origin.as_bytes())))
        .allow_methods([axum::http::Method::GET, axum::http::Method::POST])
        .allow_headers([header::CONTENT_TYPE, header::AUTHORIZATION])
}

fn allowed_origin(origin: &[u8]) -> bool {
    matches!(origin, b"tauri://localhost" | b"http://tauri.localhost" | b"https://tauri.localhost" | b"http://localhost:1420")
}

/// Paramètres d'un appel venu du réseau : toujours un objet JSON (sinon refusé), auquel le serveur ajoute
/// l'adresse et la route de l'appareil. Celles qu'un appareil enverrait lui-même sont remplacées.
/// Sans ce contrôle, une liste (`[]`) passait sans route et l'appel venu d'Internet semblait venir du magasin.
fn remote_args(body: &[u8], ip: String, route: &str) -> Result<Value, &'static str> {
    let parsed: Value = if body.iter().all(|b| b.is_ascii_whitespace()) {
        Value::Null
    } else {
        serde_json::from_slice(body).map_err(|_| "Requête invalide : paramètres JSON illisibles.")?
    };
    remote_value_args(parsed, ip, route)
}

/// Comme `remote_args`, pour des paramètres déjà lus (appels groupés).
fn remote_value_args(parsed: Value, ip: String, route: &str) -> Result<Value, &'static str> {
    let mut map = match parsed {
        Value::Object(m) => m,
        Value::Null => serde_json::Map::new(),
        _ => return Err("Requête invalide : les paramètres doivent être un objet JSON."),
    };
    map.insert("__ip".into(), Value::String(ip));
    map.insert("__route".into(), Value::String(route.into()));
    Ok(Value::Object(map))
}

async fn rpc_handler(
    State(app): State<App>,
    Path(cmd): Path<String>,
    axum::extract::ConnectInfo(addr): axum::extract::ConnectInfo<std::net::SocketAddr>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    let token = headers
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.strip_prefix("Bearer "))
        .map(String::from);
    let (ip, route) = client_route(&addr, &headers);
    // Autres appareils et accès par Internet : selon la formule. Ce PC lui-même (127.0.0.1 hors tunnel)
    // n'est pas un poste client.
    let this_pc = route == "local" && addr.ip().to_canonical().is_loopback();
    if !this_pc {
        if let Err(msg) = crate::license::remote_allowed(route) {
            return Json(json!({ "error": msg })).into_response();
        }
    }
    // Adresse IP et route de l'appareil (postes connectés, anti force brute, restrictions Internet).
    let args = match remote_args(&body, ip, route) {
        Ok(a) => a,
        Err(msg) => return (StatusCode::BAD_REQUEST, Json(json!({ "error": msg }))).into_response(),
    };
    let result = tokio::task::spawn_blocking(move || {
        let state = app.state::<AppState>();
        crate::rpc::dispatch(&state, &Origin::Remote(token), &cmd, args)
    })
    .await;
    match result {
        Ok(Ok(v)) => Json(json!({ "ok": v })).into_response(),
        Ok(Err(e)) => Json(json!({ "error": e.to_string() })).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": e.to_string() }))).into_response(),
    }
}

/// Tests d'interface (compilations de développement seulement, depuis ce PC) : les commandes que
/// l'application appelle sur l'appareil lui-même (local.rs), avec la session du jeton du test.
#[cfg(debug_assertions)]
async fn test_local_handler(
    State(app): State<App>,
    Path(cmd): Path<String>,
    axum::extract::ConnectInfo(addr): axum::extract::ConnectInfo<std::net::SocketAddr>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    if !addr.ip().to_canonical().is_loopback() || headers.contains_key("cf-ray") {
        return StatusCode::FORBIDDEN.into_response();
    }
    let token = headers
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.strip_prefix("Bearer "))
        .map(String::from);
    let args: Value = serde_json::from_slice(&body).unwrap_or(Value::Null);
    let result = tokio::task::spawn_blocking(move || {
        let state = app.state::<AppState>();
        crate::local::call(&state, &Origin::Remote(token), &cmd, args)
    })
    .await;
    match result {
        Ok(Ok(v)) => Json(json!({ "ok": v })).into_response(),
        Ok(Err(e)) => Json(json!({ "error": e.to_string() })).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": e.to_string() }))).into_response(),
    }
}

/// Nombre maximum d'appels dans un envoi groupé.
const MAX_BATCH: usize = 20;

/// Appels groupés : `{"calls": [{"cmd": "…", "args": {…}}, …]}` → `{"results": [{"ok": …} | {"error": "…"}, …]}`.
///
/// Un écran qui demande plusieurs choses à son ouverture (produits, catégories, emplacements…) les envoie
/// en un seul aller-retour : par Internet ou en 4G, chaque aller-retour coûte 0,2 à 0,5 s. Les appels sont
/// faits dans l'ordre, chacun avec les mêmes contrôles qu'un appel seul (session, formule, droits).
async fn rpc_batch_handler(
    State(app): State<App>,
    axum::extract::ConnectInfo(addr): axum::extract::ConnectInfo<std::net::SocketAddr>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    let token = headers
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.strip_prefix("Bearer "))
        .map(String::from);
    let (ip, route) = client_route(&addr, &headers);
    let this_pc = route == "local" && addr.ip().to_canonical().is_loopback();
    if !this_pc {
        if let Err(msg) = crate::license::remote_allowed(route) {
            return Json(json!({ "error": msg })).into_response();
        }
    }
    let parsed: Value = match serde_json::from_slice(&body) {
        Ok(v) => v,
        Err(_) => return (StatusCode::BAD_REQUEST, Json(json!({ "error": "Requête invalide : paramètres JSON illisibles." }))).into_response(),
    };
    let Some(calls) = parsed.get("calls").and_then(Value::as_array).cloned() else {
        return (StatusCode::BAD_REQUEST, Json(json!({ "error": "Requête invalide : liste d'appels absente." }))).into_response();
    };
    if calls.is_empty() || calls.len() > MAX_BATCH {
        return (StatusCode::BAD_REQUEST, Json(json!({ "error": "Requête invalide : nombre d'appels groupés." }))).into_response();
    }
    let route = route.to_string();
    let result = tokio::task::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let origin = Origin::Remote(token);
        calls
            .into_iter()
            .map(|call| {
                let Some(cmd) = call.get("cmd").and_then(Value::as_str).map(String::from) else {
                    return json!({ "error": "Requête invalide : commande absente." });
                };
                let args = match remote_value_args(call.get("args").cloned().unwrap_or(Value::Null), ip.clone(), &route) {
                    Ok(a) => a,
                    Err(msg) => return json!({ "error": msg }),
                };
                match crate::rpc::dispatch(&state, &origin, &cmd, args) {
                    Ok(v) => json!({ "ok": v }),
                    Err(e) => json!({ "error": e.to_string() }),
                }
            })
            .collect::<Vec<Value>>()
    })
    .await;
    match result {
        Ok(results) => Json(json!({ "results": results })).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": e.to_string() }))).into_response(),
    }
}

/// Photos (produits, logo, QR code). Depuis Internet, une session est exigée (`?t=<jeton>`).
async fn media_handler(
    State(app): State<App>,
    Path(id): Path<String>,
    axum::extract::ConnectInfo(addr): axum::extract::ConnectInfo<std::net::SocketAddr>,
    headers: HeaderMap,
    axum::extract::Query(query): axum::extract::Query<std::collections::HashMap<String, String>>,
) -> Response {
    let id: i64 = id.split('.').next().and_then(|s| s.parse().ok()).unwrap_or(0);
    let (_, route) = client_route(&addr, &headers);
    let token = query.get("t").cloned();
    let size = crate::services::media::thumb_size(query.get("s").map(String::as_str));
    let found = tokio::task::spawn_blocking(move || {
        let state = app.state::<AppState>();
        if route == "internet" && state.user(&Origin::Remote(token)).is_none() {
            return Err(StatusCode::UNAUTHORIZED);
        }
        let found = crate::services::media::get_sized(&state, id, size).ok().flatten();
        found.ok_or(StatusCode::NOT_FOUND)
    })
    .await
    .unwrap_or(Err(StatusCode::INTERNAL_SERVER_ERROR));
    match found {
        // « private » : ne pas laisser un cache partagé (tunnel) servir l'image sans contrôle.
        Ok((mime, data)) => ([(header::CONTENT_TYPE, mime), (header::CACHE_CONTROL, "private, max-age=31536000, immutable".into())], data).into_response(),
        Err(code) => code.into_response(),
    }
}

/// Aide hors ligne servie aux téléphones et tablettes de la boutique (vidéos, manuel), sans Internet.
async fn aide_handler(State(app): State<App>, Path(file): Path<String>) -> Response {
    let found = tokio::task::spawn_blocking(move || {
        let state = app.state::<AppState>();
        crate::aide::read(&crate::aide::dir_of(&state.db_path), &file)
    })
    .await
    .ok()
    .flatten();
    match found {
        Some((mime, data)) => ([(header::CONTENT_TYPE, mime.to_string()), (header::CACHE_CONTROL, "public, max-age=86400".to_string())], data).into_response(),
        None => StatusCode::NOT_FOUND.into_response(),
    }
}

async fn ping_handler(State(app): State<App>) -> Response {
    let state = app.state::<AppState>();
    let name = { let conn = state.conn(); crate::services::settings::get(&conn, "shop_name").unwrap_or_default() };
    // Nom du poste serveur et type d'appareil : la TV et les téléphones les montrent dans la liste des boutiques.
    let poste = app.try_state::<NetworkState>().map(|n| n.get().poste_name).unwrap_or_default();
    Json(json!({
        "app": "GestiMarket", "shop_name": name, "version": env!("CARGO_PKG_VERSION"),
        "poste": poste, "device": if cfg!(mobile) { "phone" } else { "pc" },
    }))
    .into_response()
}

/// Sert l'interface (fichiers intégrés à l'application) aux navigateurs du réseau.
async fn asset_handler(State(app): State<App>, uri: Uri) -> Response {
    let path = match uri.path() {
        "/" | "" => "index.html".to_string(),
        p => p.trim_start_matches('/').to_string(),
    };
    // Tauri renvoie de lui-même la page d'accueil pour une adresse inconnue (pages de l'application).
    let asset = app.asset_resolver().get(path.clone()).or_else(|| app.asset_resolver().get("index.html".into()));
    match asset.and_then(|a| served(&path, &a.mime_type).map(|cache| (a, cache))) {
        Some((a, cache)) => ([(header::CONTENT_TYPE, a.mime_type), (header::CACHE_CONTROL, cache.to_string())], a.bytes).into_response(),
        None => StatusCode::NOT_FOUND.into_response(),
    }
}

/// Règle de cache d'un fichier servi, ou `None` pour un 404 : un script ou un style d'une ancienne version
/// (téléphone resté ouvert pendant une mise à jour) ne doit pas recevoir la page d'accueil à sa place.
fn served(path: &str, mime: &str) -> Option<&'static str> {
    let html = mime.starts_with("text/html");
    if html && path.starts_with("assets/") {
        return None;
    }
    Some(if html { "no-cache" } else { cache_policy(path) })
}

/// Fichiers de l'interface : les scripts et styles portent une empreinte dans leur nom (gardés un an sur
/// l'appareil) ; la page d'accueil est toujours revérifiée, pour qu'une nouvelle version arrive aussitôt.
fn cache_policy(path: &str) -> &'static str {
    if path.starts_with("assets/") {
        "public, max-age=31536000, immutable"
    } else if path == "index.html" || path.ends_with(".html") {
        "no-cache"
    } else {
        "public, max-age=86400"
    }
}

#[cfg(test)]
mod tests {
    use super::{allowed_origin, cache_policy, client_route, remote_args, served};
    use serde_json::json;
    use axum::http::{HeaderMap, HeaderValue};
    use std::net::SocketAddr;

    fn headers(pairs: &[(&'static str, &'static str)]) -> HeaderMap {
        let mut h = HeaderMap::new();
        for (k, v) in pairs {
            h.insert(*k, HeaderValue::from_static(v));
        }
        h
    }

    #[test]
    fn recherche_des_boutiques_sur_le_reseau_local() {
        let c = super::scan_candidates(&["192.168.43.1".into(), "10.0.2.15".into(), "8.8.8.8".into(), "abc".into()]);
        assert_eq!(c.len(), 2 * 254);
        assert!(c.contains(&"192.168.43.254".parse().unwrap()));
        assert!(c.contains(&"10.0.2.15".parse().unwrap()));
        assert!(!c.iter().any(|ip| ip.octets()[0] == 8));
        // Deux adresses du même réseau : chaque appareil n'est essayé qu'une fois.
        assert_eq!(super::scan_candidates(&["192.168.1.10".into(), "192.168.1.20".into()]).len(), 254);
    }

    #[test]
    fn adresse_joignable_en_premier() {
        let route = vec!["192.168.100.20".to_string()];
        // PC de l'essai du 13 novembre : 8 cartes VirtualBox (« Ethernet 3 »…), Hyper-V, Wi-Fi.
        assert_eq!(super::card_rank("Wi-Fi", "192.168.100.20", &route), 0);
        assert_eq!(super::card_rank("Ethernet 10", "192.168.208.2", &route), 1);
        assert_eq!(super::card_rank("vEthernet (Default Switch)", "172.18.112.1", &route), 2);
        assert_eq!(super::card_rank("VirtualBox Host-Only Network", "192.168.56.1", &route), 2);
        // Téléphone serveur avec données mobiles : la route passe par rmnet, le point d'accès reste devant.
        let phone = vec!["10.161.4.7".to_string()];
        assert_eq!(super::card_rank("rmnet_data0", "10.161.4.7", &phone), 2);
        assert_eq!(super::card_rank("ap0", "192.168.43.1", &phone), 1);
        assert_eq!(super::card_rank("wlan0", "192.168.1.15", &["192.168.1.15".to_string()]), 0);
        assert!(super::unreachable_card("ccmni1") && super::unreachable_card("tun0") && !super::unreachable_card("swlan0"));
    }

    #[test]
    fn route_tunnel_cloudflare() {
        let lo: SocketAddr = "127.0.0.1:50000".parse().unwrap();
        assert_eq!(client_route(&lo, &headers(&[("cf-connecting-ip", "41.73.10.20"), ("cf-ray", "abc")])), ("41.73.10.20".to_string(), "internet"));
        assert_eq!(client_route(&lo, &headers(&[("cf-ray", "abc")])), ("127.0.0.1".to_string(), "internet"));
        assert_eq!(client_route(&lo, &headers(&[("x-forwarded-for", "41.73.10.21, 10.0.0.1")])), ("41.73.10.21".to_string(), "internet"));
    }

    #[test]
    fn route_reseau_local() {
        let lo: SocketAddr = "127.0.0.1:50000".parse().unwrap();
        assert_eq!(client_route(&lo, &HeaderMap::new()), ("127.0.0.1".to_string(), "local"));
        let lan: SocketAddr = "192.168.1.30:50000".parse().unwrap();
        assert_eq!(client_route(&lan, &HeaderMap::new()), ("192.168.1.30".to_string(), "local"));
        // En-têtes Cloudflare forgés depuis le réseau local : ignorés.
        assert_eq!(client_route(&lan, &headers(&[("cf-connecting-ip", "8.8.8.8"), ("cf-ray", "x")])), ("192.168.1.30".to_string(), "local"));
        // IPv4 vue en IPv6 (::ffff:192.168.1.30) : même adresse.
        let mapped: SocketAddr = "[::ffff:192.168.1.30]:50000".parse().unwrap();
        assert_eq!(client_route(&mapped, &HeaderMap::new()), ("192.168.1.30".to_string(), "local"));
    }

    #[test]
    fn parametres_toujours_un_objet_avec_la_route_du_serveur() {
        // Liste, texte, nombre : refusés (avant, la route manquait et Internet passait pour le magasin).
        for body in [&b"[]"[..], &b"\"x\""[..], &b"1"[..], &b"true"[..], &b"{"[..]] {
            assert!(remote_args(body, "41.73.10.20".into(), "internet").is_err(), "{:?}", std::str::from_utf8(body));
        }
        // Corps vide : objet vide avec la route.
        let a = remote_args(b"", "41.73.10.20".into(), "internet").unwrap();
        assert_eq!(a, json!({"__ip": "41.73.10.20", "__route": "internet"}));
        // Route et adresse envoyées par l'appareil : remplacées.
        let a = remote_args(br#"{"pin":"1234","__route":"local","__ip":"192.168.1.2"}"#, "41.73.10.20".into(), "internet").unwrap();
        assert_eq!(a["__route"], "internet");
        assert_eq!(a["__ip"], "41.73.10.20");
        assert_eq!(a["pin"], "1234");
    }

    #[test]
    fn cors_postes_clients_seulement() {
        assert!(allowed_origin(b"http://tauri.localhost"));
        assert!(allowed_origin(b"tauri://localhost"));
        assert!(!allowed_origin(b"https://site-piege.example"));
        assert!(!allowed_origin(b"http://192.168.1.10:7878"));
    }

    #[test]
    fn cache_des_fichiers_de_l_interface() {
        assert_eq!(cache_policy("assets/index-4f2a9c.js"), "public, max-age=31536000, immutable");
        assert_eq!(cache_policy("index.html"), "no-cache");
        assert_eq!(cache_policy("icon.png"), "public, max-age=86400");
        // Page d'accueil renvoyée par Tauri à la place d'un script disparu : 404 ; pages de l'application : jamais en cache.
        assert_eq!(served("assets/index-ancien.js", "text/html"), None);
        assert_eq!(served("assets/index-4f2a9c.js", "text/javascript"), Some("public, max-age=31536000, immutable"));
        assert_eq!(served("settings", "text/html"), Some("no-cache"));
    }
}
