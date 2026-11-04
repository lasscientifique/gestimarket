//! Configuration multi-postes et serveur réseau local (Wi-Fi / Ethernet).
//!
//! Trois modes :
//!  - `local`  : poste unique, base de données sur ce PC ;
//!  - `server` : ce PC garde la base et la partage aux autres postes du réseau (port HTTP, 7878 par défaut) ;
//!  - `client` : ce PC travaille sur la base du poste serveur.
//! Le serveur sert aussi l'application aux navigateurs du réseau (tablette, téléphone, TV de l'écran client).

use std::path::PathBuf;
use std::sync::Mutex;

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

/// Adresses IP locales de ce PC (à saisir sur les postes clients).
pub fn local_ips() -> Vec<String> {
    let mut ips = Vec::new();
    // Astuce sans envoi de paquet : « connecter » un socket UDP révèle l'interface réseau utilisée.
    for target in ["8.8.8.8:80", "192.168.1.1:80", "10.0.0.1:80"] {
        if let Ok(sock) = std::net::UdpSocket::bind("0.0.0.0:0") {
            if sock.connect(target).is_ok() {
                if let Ok(addr) = sock.local_addr() {
                    let ip = addr.ip().to_string();
                    if !ip.starts_with("127.") && !ips.contains(&ip) {
                        ips.push(ip);
                    }
                }
            }
        }
    }
    ips
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

/// Démarre le serveur HTTP du poste serveur.
pub fn start_server(app: AppHandle, port: u16) {
    tauri::async_runtime::spawn(async move {
        let router = Router::new()
            .route("/rpc/{cmd}", post(rpc_handler))
            .route("/media/{id}", get(media_handler))
            .route("/api/ping", get(ping_handler))
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
                    .serve(https.into_make_service_with_connect_info::<std::net::SocketAddr>())
                    .await
                {
                    crate::journal::error(format!("Serveur HTTPS arrêté : {e}"));
                }
            });
        }
        match tokio::net::TcpListener::bind(("0.0.0.0", port)).await {
            Ok(listener) => {
                if let Err(e) = axum::serve(listener, router.into_make_service_with_connect_info::<std::net::SocketAddr>()).await {
                    crate::journal::error(format!("Serveur réseau arrêté : {e}"));
                }
            }
            Err(e) => crate::journal::error(format!("Impossible d'ouvrir le port {port} : {e}")),
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
    State(app): State<AppHandle>,
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

/// Photos (produits, logo, QR code). Depuis Internet, une session est exigée (`?t=<jeton>`).
async fn media_handler(
    State(app): State<AppHandle>,
    Path(id): Path<String>,
    axum::extract::ConnectInfo(addr): axum::extract::ConnectInfo<std::net::SocketAddr>,
    headers: HeaderMap,
    axum::extract::Query(query): axum::extract::Query<std::collections::HashMap<String, String>>,
) -> Response {
    let id: i64 = id.split('.').next().and_then(|s| s.parse().ok()).unwrap_or(0);
    let (_, route) = client_route(&addr, &headers);
    let token = query.get("t").cloned();
    let found = tokio::task::spawn_blocking(move || {
        let state = app.state::<AppState>();
        if route == "internet" && state.user(&Origin::Remote(token)).is_none() {
            return Err(StatusCode::UNAUTHORIZED);
        }
        let found = crate::services::media::get(&state.conn(), id).ok().flatten();
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

async fn ping_handler(State(app): State<AppHandle>) -> Response {
    let state = app.state::<AppState>();
    let name = { let conn = state.conn(); crate::services::settings::get(&conn, "shop_name").unwrap_or_default() };
    Json(json!({ "app": "GestiMarket", "shop_name": name, "version": env!("CARGO_PKG_VERSION") })).into_response()
}

/// Sert l'interface (fichiers intégrés à l'application) aux navigateurs du réseau.
async fn asset_handler(State(app): State<AppHandle>, uri: Uri) -> Response {
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
