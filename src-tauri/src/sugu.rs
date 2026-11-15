//! Sugu Eden (0.30, étape « Vitrine ») : la place de marché d'Eden Dev.
//!
//! La boutique choisit les produits à publier : case « Publier sur Sugu Eden » de la fiche produit, ou
//! sélection dans la liste. Toutes les 2 minutes (et juste après un changement), le PC qui garde la base
//! (poste serveur ou poste unique), relié au compte boutique, envoie à Eden Dev seulement ce qui a changé :
//! nom, prix (prix Sugu Eden, sinon prix de vente), catégorie, marque, description, disponibilité et photo
//! (640 pixels). L'acheteur commande par WhatsApp ou par téléphone, directement à la boutique : aucun paiement
//! ne passe par Eden Dev.
//!
//! Formules PRO et BUSINESS (fonction « sugu » de la licence). Rien ne part sans l'accord de la boutique
//! (« sugu_enabled », date d'accord). Couper Sugu Eden retire tout de suite la boutique et ses produits.
//! Le PC se présente avec son jeton d'appareil (0.27) : pas de mot de passe. Fonction Eden Dev : gm-sugu.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Condvar, Mutex};
use std::time::{Duration, Instant};

use base64::Engine;
use rusqlite::{params, Connection};
use serde::Serialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager};

use crate::services::{media, settings};
use crate::state::AppState;

/// Taille des photos publiées (plus grand côté) et poids maximal accepté par Eden Dev.
const PHOTO_SIZE: u32 = 1000;
/// Photos d'un produit sur Sugu Eden : la principale et 7 autres.
pub const MAX_PHOTOS_PER_PRODUCT: usize = 8;
/// Le classement d'Eden Dev est relu une fois par jour.
const TAXONOMY_REFRESH: Duration = Duration::from_secs(24 * 3600);
const PHOTO_MAX_BYTES: usize = 680 * 1024;
/// Envoi par paquets : produits et photos par appel.
const BATCH_ITEMS: usize = 60;
const BATCH_PHOTOS: usize = 12;
/// Fiche de la boutique renvoyée au moins toutes les 6 heures : l'abonnement renouvelé prolonge sa visibilité.
const SHOP_REFRESH: Duration = Duration::from_secs(6 * 3600);

#[derive(Debug, Clone, Default, Serialize)]
pub struct SuguStatus {
    /// La boutique publie sur Sugu Eden (son accord est donné).
    pub enabled: bool,
    /// Formule avec Sugu Eden (PRO, BUSINESS).
    pub allowed: bool,
    /// PC relié au compte boutique (code de la boutique et jeton d'appareil).
    pub linked: bool,
    /// Ce PC garde la base (poste serveur ou poste unique) : c'est lui qui publie.
    pub here: bool,
    pub accepted_at: Option<String>,
    pub whatsapp: String,
    pub description: String,
    /// « available » : En stock / Épuisé ; « quantity » : la quantité disponible.
    pub stock_mode: String,
    /// Marge de sécurité retirée du stock affiché.
    pub stock_margin: i64,
    /// Produits cochés « Publier sur Sugu Eden » (actifs).
    pub chosen: i64,
    /// Produits déjà sur Sugu Eden, à jour ou non.
    pub online: i64,
    /// Produits à envoyer ou à retirer.
    pub pending: i64,
    pub shop_url: Option<String>,
    pub busy: bool,
    pub last_ok_at: Option<String>,
    pub last_error: Option<String>,
}

#[derive(Default)]
struct Runtime {
    busy: bool,
    last_ok_at: Option<String>,
    last_error: Option<String>,
    shop_sent: Option<Instant>,
    taxonomy_checked: Option<Instant>,
}

static RUNTIME: Mutex<Option<Runtime>> = Mutex::new(None);
/// La publication tourne sur ce PC (il garde la base : poste serveur ou poste unique).
static STARTED: AtomicBool = AtomicBool::new(false);
static WAKE: (Mutex<bool>, Condvar) = (Mutex::new(false), Condvar::new());

fn runtime<T>(f: impl FnOnce(&mut Runtime) -> T) -> T {
    let mut guard = RUNTIME.lock().unwrap_or_else(|e| e.into_inner());
    f(guard.get_or_insert_with(Runtime::default))
}

/// Un changement (réglage, produit coché) : la publication repart tout de suite.
pub fn wake() {
    let (lock, cvar) = &WAKE;
    *lock.lock().unwrap_or_else(|e| e.into_inner()) = true;
    cvar.notify_all();
}

fn now() -> String {
    chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string()
}

fn get(conn: &Connection, key: &str) -> String {
    settings::get(conn, key).unwrap_or_default()
}

/// Ce PC garde-t-il la base de la boutique ? (un poste client ne publie jamais)
fn here(app: &AppHandle) -> bool {
    app.try_state::<crate::network::NetworkState>().map(|n| n.get().mode != "client").unwrap_or(true)
}

fn count(conn: &Connection, sql: &str) -> i64 {
    conn.query_row(sql, [], |r| r.get(0)).unwrap_or(0)
}

pub fn status(conn: &Connection) -> SuguStatus {
    let account = crate::license::account();
    let (busy, last_ok_at, last_error) = runtime(|r| (r.busy, r.last_ok_at.clone(), r.last_error.clone()));
    let margin = get(conn, "sugu_stock_margin").trim().parse().unwrap_or(1);
    let chosen = count(conn, "SELECT COUNT(*) FROM products WHERE sugu_publish = 1 AND active = 1");
    let online = count(conn, "SELECT COUNT(*) FROM sugu_sync");
    let pending = published_rows(conn)
        .map(|rows| {
            let (send, remove) = diff(conn, &rows);
            (send.len() + remove.len()) as i64
        })
        .unwrap_or(0);
    let mode = get(conn, "sugu_stock_mode");
    SuguStatus {
        enabled: get(conn, "sugu_enabled") == "1",
        allowed: crate::license::allows("sugu"),
        linked: !account.store_code.is_empty() && get(conn, "device_token").len() >= 40,
        here: STARTED.load(Ordering::Relaxed),
        accepted_at: Some(get(conn, "sugu_accepted_at")).filter(|s| !s.is_empty()),
        whatsapp: get(conn, "sugu_whatsapp"),
        description: get(conn, "sugu_description"),
        stock_mode: if mode == "quantity" { mode } else { "available".into() },
        stock_margin: margin,
        chosen,
        online,
        pending,
        shop_url: Some(get(conn, "sugu_shop_url")).filter(|s| !s.is_empty()),
        busy,
        last_ok_at,
        last_error,
    }
}

/// Réglages de Paramètres → Sugu Eden. `accept` : accord de la boutique (obligatoire pour publier).
pub fn configure(conn: &Connection, a: &Value) -> Result<(), String> {
    let text = |k: &str| a.get(k).and_then(Value::as_str).map(str::trim).map(String::from);
    let enabled = a.get("enabled").and_then(Value::as_bool);
    if let Some(w) = text("whatsapp") {
        let w = if w.is_empty() { String::new() } else { crate::account::valid_phone(&w)? };
        settings::set(conn, "sugu_whatsapp", &w).map_err(|e| e.to_string())?;
    }
    if let Some(d) = text("description") {
        let d: String = d.chars().take(600).collect();
        settings::set(conn, "sugu_description", &d).map_err(|e| e.to_string())?;
    }
    if let Some(m) = text("stock_mode") {
        let m = if m == "quantity" { "quantity" } else { "available" };
        settings::set(conn, "sugu_stock_mode", m).map_err(|e| e.to_string())?;
    }
    if let Some(n) = a.get("stock_margin").and_then(Value::as_i64) {
        settings::set(conn, "sugu_stock_margin", &n.clamp(0, 1000).to_string()).map_err(|e| e.to_string())?;
    }
    match enabled {
        Some(true) => {
            if !crate::license::allows("sugu") {
                return Err("Sugu Eden est inclus dans les formules PRO et BUSINESS : voir « Abonnement & licence ».".into());
            }
            if crate::license::account().store_code.is_empty() {
                return Err("Reliez d'abord ce PC au compte de la boutique (Abonnement & licence).".into());
            }
            if get(conn, "sugu_whatsapp").is_empty() {
                return Err("Indiquez le numéro WhatsApp qui reçoit les commandes.".into());
            }
            let accepted = a.get("accept").and_then(Value::as_bool).unwrap_or(false);
            if accepted {
                settings::set(conn, "sugu_accepted_at", &now()).map_err(|e| e.to_string())?;
            } else if get(conn, "sugu_accepted_at").is_empty() {
                return Err("Cochez l'accord pour publier la boutique sur Sugu Eden.".into());
            }
            settings::set(conn, "sugu_enabled", "1").map_err(|e| e.to_string())?;
        }
        Some(false) => settings::set(conn, "sugu_enabled", "0").map_err(|e| e.to_string())?,
        None => {}
    }
    // La fiche de la boutique est renvoyée au prochain passage (numéro, présentation…).
    settings::set(conn, "sugu_shop_hash", "").map_err(|e| e.to_string())?;
    wake();
    Ok(())
}

/// Coche ou décoche « Publier sur Sugu Eden » pour ces produits.
pub fn publish(conn: &Connection, ids: &[i64], on: bool) -> rusqlite::Result<usize> {
    let mut n = 0;
    for id in ids {
        n += conn.execute("UPDATE products SET sugu_publish = ?1 WHERE id = ?2", params![on, id])?;
    }
    wake();
    Ok(n)
}

/// Fiche produit, onglet Sugu Eden : publication, prix Sugu Eden (vide ou 0 : le prix de vente), classement
/// (sous-catégorie), état, public visé et mots-clés.
#[derive(Debug, Clone, Default, serde::Deserialize)]
pub struct ProductFields {
    pub on: bool,
    #[serde(default)]
    pub price: Option<i64>,
    #[serde(default)]
    pub code: Option<String>,
    #[serde(default)]
    pub condition: Option<String>,
    #[serde(default)]
    pub audience: Option<String>,
    #[serde(default)]
    pub keywords: Option<String>,
}

pub fn set_product(conn: &Connection, id: i64, f: &ProductFields) -> Result<(), String> {
    if f.price.is_some_and(|p| p < 0) {
        return Err("Le prix Sugu Eden ne peut pas être négatif.".into());
    }
    let code = f.code.as_deref().map(str::trim).filter(|c| !c.is_empty());
    if code.is_some_and(|c| !crate::sugu_tax::is_leaf(c)) {
        return Err("Classement Sugu Eden inconnu : choisissez une sous-catégorie de la liste.".into());
    }
    let condition = match f.condition.as_deref().map(str::trim) {
        Some("used") => "used",
        Some("refurbished") => "refurbished",
        _ => "new",
    };
    let audience = f.audience.as_deref().map(str::trim).filter(|a| ["women", "men", "unisex", "kids"].contains(a));
    let keywords: Option<String> = f.keywords.as_deref().map(|k| k.trim().chars().take(200).collect::<String>()).filter(|k| !k.is_empty());
    conn.execute(
        "UPDATE products SET sugu_publish = ?1, sugu_price = ?2, sugu_code = ?3, sugu_condition = ?4, sugu_audience = ?5,
                sugu_keywords = ?6 WHERE id = ?7",
        params![f.on, f.price.filter(|p| *p > 0), code, condition, audience, keywords, id],
    )
    .map_err(|e| e.to_string())?;
    wake();
    Ok(())
}

/// Classement Sugu Eden de plusieurs produits d'un coup (liste des produits).
pub fn classify(conn: &Connection, ids: &[i64], code: &str) -> Result<usize, String> {
    let code = code.trim();
    if !crate::sugu_tax::is_leaf(code) {
        return Err("Classement Sugu Eden inconnu : choisissez une sous-catégorie de la liste.".into());
    }
    let audience = crate::sugu_tax::audience_of(code);
    let mut n = 0;
    for id in ids {
        n += conn
            .execute(
                "UPDATE products SET sugu_code = ?1, sugu_audience = COALESCE(sugu_audience, ?2) WHERE id = ?3",
                params![code, audience, id],
            )
            .map_err(|e| e.to_string())?;
    }
    wake();
    Ok(n)
}

// ───────────────────────────── Ce qui part sur Sugu Eden ─────────────────────────────

/// Un produit tel qu'il est publié, son empreinte et ses photos (la principale d'abord ; la clé d'une photo est
/// son numéro).
#[derive(Debug, Clone, PartialEq)]
pub struct Row {
    pub id: i64,
    pub item: Value,
    pub hash: String,
    pub photos: Vec<i64>,
}

impl Row {
    fn keys(&self) -> Vec<String> {
        self.photos.iter().map(i64::to_string).collect()
    }
}

fn hash_of(v: &Value) -> String {
    format!("{:x}", Sha256::digest(v.to_string().as_bytes()))
}

/// Disponibilité affichée : stock moins la marge de sécurité ; un produit sans suivi de stock est toujours dispo.
pub fn availability(track: bool, stock: f64, margin: i64, mode: &str) -> (bool, Value) {
    if !track {
        return (true, Value::Null);
    }
    let left = stock - margin as f64;
    let shown = if mode == "quantity" { json!((left.max(0.0) * 1000.0).round() / 1000.0) } else { Value::Null };
    (left > 0.0, shown)
}

pub fn published_rows(conn: &Connection) -> rusqlite::Result<Vec<Row>> {
    let margin: i64 = get(conn, "sugu_stock_margin").trim().parse().unwrap_or(1);
    let mode = get(conn, "sugu_stock_mode");
    // Photos en plus de la principale, dans l'ordre.
    let mut extra: std::collections::HashMap<i64, Vec<i64>> = std::collections::HashMap::new();
    let mut stmt = conn.prepare(
        "SELECT pp.product_id, pp.media_id FROM product_photos pp JOIN products p ON p.id = pp.product_id
         WHERE p.sugu_publish = 1 ORDER BY pp.product_id, pp.position, pp.id",
    )?;
    for row in stmt.query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?)))? {
        let (pid, media) = row?;
        extra.entry(pid).or_default().push(media);
    }
    let mut stmt = conn.prepare(
        "SELECT p.id, p.name, COALESCE(p.description, ''), COALESCE(pc.name, c.name, ''), COALESCE(p.brand, ''), p.unit,
                COALESCE(NULLIF(p.sugu_price, 0), p.sale_price), p.track_stock, p.stock, p.image_id,
                COALESCE(p.sugu_code, ''), p.sugu_condition, COALESCE(p.sugu_audience, ''), COALESCE(p.sugu_keywords, '')
         FROM products p
         LEFT JOIN categories c ON c.id = p.category_id
         LEFT JOIN categories pc ON pc.id = c.parent_id
         WHERE p.sugu_publish = 1 AND p.active = 1
         ORDER BY p.id",
    )?;
    let rows = stmt.query_map([], |r| {
        let id: i64 = r.get(0)?;
        let (in_stock, stock) = availability(r.get(7)?, r.get(8)?, margin, &mode);
        let main: Option<i64> = r.get(9)?;
        let mut photos: Vec<i64> = main.into_iter().collect();
        for m in extra.get(&id).cloned().unwrap_or_default() {
            if photos.len() < MAX_PHOTOS_PER_PRODUCT && !photos.contains(&m) {
                photos.push(m);
            }
        }
        let item = json!({
            "local_id": id, "name": r.get::<_, String>(1)?, "description": r.get::<_, String>(2)?,
            "category": r.get::<_, String>(3)?, "brand": r.get::<_, String>(4)?, "unit": r.get::<_, String>(5)?,
            "price": r.get::<_, i64>(6)?, "in_stock": in_stock, "stock": stock,
            "code": r.get::<_, String>(10)?, "condition": r.get::<_, String>(11)?, "audience": r.get::<_, String>(12)?,
            "keywords": r.get::<_, String>(13)?,
            "photos": photos.iter().map(|m| json!({ "key": m.to_string() })).collect::<Vec<_>>(),
        });
        Ok(Row { id, hash: hash_of(&item), item, photos })
    })?;
    rows.collect()
}

/// À envoyer (nouveaux ou changés, avec les photos qu'Eden Dev n'a pas encore) et à retirer (plus cochés,
/// archivés, effacés). La colonne « photo_key » de sugu_sync garde les numéros des photos déjà envoyées.
pub fn diff(conn: &Connection, rows: &[Row]) -> (Vec<(Row, Vec<String>)>, Vec<i64>) {
    let mut synced = std::collections::HashMap::<i64, (String, String)>::new();
    if let Ok(mut stmt) = conn.prepare("SELECT product_id, hash, photo_key FROM sugu_sync") {
        if let Ok(it) = stmt.query_map([], |r| Ok((r.get::<_, i64>(0)?, (r.get::<_, String>(1)?, r.get::<_, String>(2)?)))) {
            synced.extend(it.flatten());
        }
    }
    let mut send = Vec::new();
    for row in rows {
        match synced.remove(&row.id) {
            Some((hash, _)) if hash == row.hash => {}
            Some((_, sent)) => {
                let sent: Vec<&str> = sent.split(',').filter(|k| !k.is_empty()).collect();
                let missing = row.keys().into_iter().filter(|k| !sent.contains(&k.as_str())).collect();
                send.push((row.clone(), missing));
            }
            None => send.push((row.clone(), row.keys())),
        }
    }
    let mut remove: Vec<i64> = synced.into_keys().collect();
    remove.sort_unstable();
    (send, remove)
}

/// Photo publiée : 1 000 pixels au plus ; trop lourde ou illisible : pas de photo.
fn photo(conn: &Connection, image_id: i64) -> Option<Value> {
    let (mime, data) = media::get(conn, image_id).ok()??;
    let (mime, data) = match media::shrink(PHOTO_SIZE, &mime, &data) {
        Some((m, d)) => (m.to_string(), d),
        None if matches!(mime.as_str(), "image/jpeg" | "image/png" | "image/webp") => (mime, data),
        None => return None,
    };
    if data.len() > PHOTO_MAX_BYTES {
        return None;
    }
    Some(json!({ "mime": mime, "data": base64::engine::general_purpose::STANDARD.encode(data) }))
}

// ───────────────────────────── Envoi à Eden Dev ─────────────────────────────

fn call(body: Value) -> Result<Value, String> {
    let url = format!("{}/functions/v1/gm-sugu", crate::license::supabase_url().trim_end_matches('/'));
    let res = ureq::AgentBuilder::new()
        .timeout_connect(Duration::from_secs(10))
        .timeout(Duration::from_secs(90))
        .build()
        .post(&url)
        .set("apikey", crate::license::SUPABASE_KEY)
        .set("Content-Type", "application/json")
        .send_json(body);
    let v: Value = match res {
        Ok(r) => r.into_json().map_err(|_| "Réponse inattendue d'Eden Dev.".to_string())?,
        Err(ureq::Error::Status(..)) => return Err("Sugu Eden est momentanément indisponible : réessayez plus tard.".into()),
        Err(_) => return Err("Sugu Eden injoignable : vérifiez la connexion à Internet de ce PC.".into()),
    };
    match v["status"].as_str() {
        Some("ok") => Ok(v),
        _ => Err(v["message"].as_str().unwrap_or("Réponse inattendue d'Eden Dev.").to_string()),
    }
}

fn base(device: &str, action: &str) -> Value {
    json!({ "pc_id": crate::license::pc_id(), "device_token": device, "action": action })
}

/// Fiche de la boutique : nom, pays, ville et adresse viennent du compte ; ici le numéro WhatsApp des commandes,
/// le téléphone, la présentation, la monnaie et le logo.
fn shop_profile(conn: &Connection) -> (Value, Option<i64>) {
    let logo = get(conn, "shop_logo_id").trim().parse::<i64>().ok();
    let decimals: i64 = get(conn, "currency_decimals").trim().parse().unwrap_or(0);
    let profile = json!({
        "whatsapp": get(conn, "sugu_whatsapp"), "phone": get(conn, "shop_phone"), "description": get(conn, "sugu_description"),
        "currency": get(conn, "currency_code"), "decimals": decimals, "logo_key": logo.map(|l| l.to_string()).unwrap_or_default(),
    });
    (profile, logo)
}

/// Classement plus récent chez Eden Dev : repris et gardé sur ce PC (clé interne « sugu_taxonomy_cache »).
fn refresh_taxonomy(conn_of: impl Fn() -> Result<(), String>) {
    let due = runtime(|r| r.taxonomy_checked.is_none_or(|t| t.elapsed() > TAXONOMY_REFRESH));
    if !due {
        return;
    }
    runtime(|r| r.taxonomy_checked = Some(Instant::now()));
    let _ = conn_of();
}

fn fetch_taxonomy() -> Option<crate::sugu_tax::Taxonomy> {
    let url = format!("{}/rest/v1/rpc/sugu_taxonomy", crate::license::supabase_url().trim_end_matches('/'));
    let key = crate::license::SUPABASE_KEY;
    let v: Value = ureq::post(&url)
        .timeout(Duration::from_secs(20))
        .set("apikey", key)
        .set("Authorization", &format!("Bearer {key}"))
        .set("Content-Type", "application/json")
        .send_json(json!({}))
        .ok()?
        .into_json()
        .ok()?;
    crate::sugu_tax::from_remote(&v)
}

fn tick(app: &AppHandle) -> Result<(), String> {
    let state = app.state::<AppState>();
    // Classement d'Eden Dev : seulement pour un PC relié au compte (il publie, ou le fera).
    if !crate::license::account().store_code.is_empty() {
        refresh_taxonomy(|| {
            if let Some(t) = fetch_taxonomy() {
                if crate::sugu_tax::adopt(t.clone()) {
                    let raw = serde_json::to_string(&t).map_err(|e| e.to_string())?;
                    settings::set(&state.conn(), "sugu_taxonomy_cache", &raw).map_err(|e| e.to_string())?;
                }
            }
            Ok(())
        });
    }
    let device = {
        let conn = state.conn();
        let device = get(&conn, "device_token");
        if !here(app) || crate::license::account().store_code.is_empty() || device.len() < 40 {
            return Ok(());
        }
        // Sugu Eden coupé : la boutique et ses produits sont retirés (une seule fois).
        if get(&conn, "sugu_enabled") != "1" {
            let online = count(&conn, "SELECT COUNT(*) FROM sugu_sync");
            if online == 0 && get(&conn, "sugu_shop_url").is_empty() {
                return Ok(());
            }
            drop(conn);
            call(base(&device, "off"))?;
            let conn = state.conn();
            conn.execute("DELETE FROM sugu_sync", []).map_err(|e| e.to_string())?;
            for k in ["sugu_shop_hash", "sugu_shop_url"] {
                settings::set(&conn, k, "").map_err(|e| e.to_string())?;
            }
            return Ok(());
        }
        if !crate::license::allows("sugu") {
            return Err("Sugu Eden est inclus dans les formules PRO et BUSINESS : la boutique n'est plus montrée.".into());
        }
        device
    };

    // Fiche de la boutique : quand elle change, et toutes les 6 heures (visibilité prolongée).
    let (profile, logo, sent_hash) = {
        let conn = state.conn();
        let (profile, logo) = shop_profile(&conn);
        (profile, logo, get(&conn, "sugu_shop_hash"))
    };
    // Empreinte gardée : « numéro du logo:empreinte de la fiche » (le logo n'est renvoyé que s'il a changé).
    let key = profile["logo_key"].as_str().unwrap_or_default().to_string();
    let wanted = format!("{key}:{}", hash_of(&profile));
    let stale = runtime(|r| r.shop_sent.is_none_or(|t| t.elapsed() > SHOP_REFRESH));
    if wanted != sent_hash || stale {
        let mut shop = profile.clone();
        let logo_changed = sent_hash.is_empty() || sent_hash.split(':').next() != Some(key.as_str());
        if let (Some(id), true) = (logo, logo_changed) {
            if let Some(p) = photo(&state.conn(), id) {
                shop["logo"] = p;
            }
        }
        let mut body = base(&device, "shop");
        body["shop"] = shop;
        let v = call(body)?;
        let conn = state.conn();
        settings::set(&conn, "sugu_shop_hash", &wanted).map_err(|e| e.to_string())?;
        settings::set(&conn, "sugu_shop_url", v["shop_url"].as_str().unwrap_or_default()).map_err(|e| e.to_string())?;
        runtime(|r| r.shop_sent = Some(Instant::now()));
    }

    // Produits : seulement ce qui a changé, par paquets.
    let (send, remove) = {
        let conn = state.conn();
        let rows = published_rows(&conn).map_err(|e| e.to_string())?;
        diff(&conn, &rows)
    };
    for chunk in send.chunks(BATCH_ITEMS) {
        let mut items = Vec::new();
        let mut budget = BATCH_PHOTOS;
        for (row, missing) in chunk {
            if missing.len() > budget && budget < BATCH_PHOTOS {
                // Photos pour le paquet suivant : le produit sera renvoyé au prochain passage.
                continue;
            }
            // Photos dans l'ordre ; celles qu'Eden Dev a déjà sont désignées par leur numéro seulement. Une photo
            // illisible ou trop lourde est laissée de côté.
            let mut photos = Vec::new();
            for key in row.keys() {
                if missing.contains(&key) {
                    let data = key.parse().ok().and_then(|id| photo(&state.conn(), id));
                    if let Some(p) = data {
                        photos.push(json!({ "key": key, "photo": p }));
                        budget = budget.saturating_sub(1);
                    }
                } else {
                    photos.push(json!({ "key": key }));
                }
            }
            let mut item = row.item.clone();
            item["photos"] = Value::Array(photos);
            items.push((row, item));
        }
        let mut body = base(&device, "products");
        body["upsert"] = Value::Array(items.iter().map(|(_, i)| i.clone()).collect());
        body["remove"] = json!([]);
        call(body)?;
        let conn = state.conn();
        for (row, item) in &items {
            let sent: Vec<&str> = item["photos"].as_array().map(|a| a.iter().filter_map(|p| p["key"].as_str()).collect()).unwrap_or_default();
            conn.execute(
                "INSERT INTO sugu_sync (product_id, hash, photo_key, synced_at) VALUES (?1, ?2, ?3, ?4)
                 ON CONFLICT(product_id) DO UPDATE SET hash = excluded.hash, photo_key = excluded.photo_key, synced_at = excluded.synced_at",
                params![row.id, row.hash, sent.join(","), now()],
            )
            .map_err(|e| e.to_string())?;
        }
    }
    for chunk in remove.chunks(500) {
        let mut body = base(&device, "products");
        body["upsert"] = json!([]);
        body["remove"] = json!(chunk);
        call(body)?;
        let conn = state.conn();
        for id in chunk {
            conn.execute("DELETE FROM sugu_sync WHERE product_id = ?1", [id]).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

/// Publication en arrière-plan : toutes les 2 minutes, ou tout de suite après un changement.
pub fn start(app: AppHandle) {
    STARTED.store(true, Ordering::Relaxed);
    if let Some(state) = app.try_state::<AppState>() {
        crate::sugu_tax::load_cache(&state.conn());
    }
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(20));
        loop {
            runtime(|r| r.busy = true);
            let result = tick(&app);
            runtime(|r| {
                r.busy = false;
                match &result {
                    Ok(()) => {
                        r.last_ok_at = Some(now());
                        r.last_error = None;
                    }
                    Err(e) => r.last_error = Some(e.clone()),
                }
            });
            if let Err(e) = &result {
                crate::journal::error(format!("Sugu Eden : {e}"));
            }
            let (lock, cvar) = &WAKE;
            let mut woken = lock.lock().unwrap_or_else(|e| e.into_inner());
            if !*woken {
                woken = cvar.wait_timeout(woken, Duration::from_secs(120)).map(|(g, _)| g).unwrap_or_else(|e| e.into_inner().0);
            }
            *woken = false;
            drop(woken);
            // Plusieurs produits cochés à la suite : un seul envoi.
            std::thread::sleep(Duration::from_secs(3));
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn conn() -> Connection {
        crate::db::open_in_memory().unwrap()
    }

    #[test]
    fn disponibilite_avec_marge() {
        assert_eq!(availability(false, 0.0, 1, "available"), (true, Value::Null));
        assert_eq!(availability(true, 1.0, 1, "available"), (false, Value::Null));
        assert_eq!(availability(true, 3.0, 1, "available"), (true, Value::Null));
        assert_eq!(availability(true, 3.5, 1, "quantity"), (true, json!(2.5)));
        assert_eq!(availability(true, 0.0, 1, "quantity"), (false, json!(0.0)));
    }

    #[test]
    fn seulement_les_changements_sont_envoyes() {
        let c = conn();
        c.execute("INSERT INTO products (name, sale_price, stock, track_stock, sugu_publish) VALUES ('Riz 25 kg', 15000, 10, 1, 1)", []).unwrap();
        c.execute("INSERT INTO products (name, sale_price, stock, track_stock, sugu_publish) VALUES ('Sucre', 800, 5, 1, 0)", []).unwrap();
        let rows = published_rows(&c).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].item["price"], json!(15000));
        assert_eq!(rows[0].item["in_stock"], json!(true));
        let (send, remove) = diff(&c, &rows);
        assert_eq!((send.len(), remove.len()), (1, 0));
        // Déjà envoyé, inchangé : rien à envoyer.
        c.execute("INSERT INTO sugu_sync (product_id, hash, photo_key, synced_at) VALUES (?1, ?2, '', 'x')", params![rows[0].id, rows[0].hash]).unwrap();
        assert_eq!(diff(&c, &rows).0.len(), 0);
        // Prix Sugu Eden et classement : le produit change.
        let fields = ProductFields { on: true, price: Some(14000), code: Some("alimentation/epicerie/riz-cereales".into()), ..Default::default() };
        set_product(&c, rows[0].id, &fields).unwrap();
        let rows = published_rows(&c).unwrap();
        assert_eq!(rows[0].item["price"], json!(14000));
        assert_eq!(rows[0].item["code"], json!("alimentation/epicerie/riz-cereales"));
        assert_eq!(rows[0].item["condition"], json!("new"));
        assert_eq!(diff(&c, &rows).0.len(), 1);
        // Décoché : à retirer.
        publish(&c, &[rows[0].id], false).unwrap();
        let rows = published_rows(&c).unwrap();
        assert_eq!(diff(&c, &rows), (vec![], vec![1]));
        assert!(set_product(&c, 1, &ProductFields { on: true, price: Some(-5), ..Default::default() }).is_err());
        assert!(set_product(&c, 1, &ProductFields { on: true, code: Some("femmes".into()), ..Default::default() }).is_err(), "pas une sous-catégorie");
        // Classement de plusieurs produits : le public est proposé (Femmes → women).
        assert_eq!(classify(&c, &[1, 2], "femmes/vetements/robes").unwrap(), 2);
        let audience: Option<String> = c.query_row("SELECT sugu_audience FROM products WHERE id = 2", [], |r| r.get(0)).unwrap();
        assert_eq!(audience.as_deref(), Some("women"));
        assert!(classify(&c, &[1], "inconnu").is_err());
    }
}
