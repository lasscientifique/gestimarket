//! Licence d'utilisation (abonnement Eden Dev).
//!
//! - Fichier signé Ed25519 par Supabase (fonction « gm-license »), lié à ce PC et à cette boutique :
//!   l'identifiant du PC est une empreinte de la machine et du numéro de boutique (12 caractères).
//! - Téléchargé depuis le bucket public « licences » quand Internet est disponible (voir `account.rs`),
//!   ou importé à la main (fichier reçu par WhatsApp, clé USB…).
//! - Vérifié ici, sans Internet : formule, fonctions, nombre de postes, dates.
//! - Sans licence valide : lecture seule (FREE). Licence expirée : lecture seule ; le réseau et
//!   l'accès par Internet restent ouverts pour consulter. Les données ne sont jamais supprimées.
//! - Horloge : la date la plus avancée déjà vue est mémorisée (base + fichier) ; reculer l'horloge
//!   du PC ne prolonge pas la licence.

use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard, OnceLock};

use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine as _;
use chrono::{DateTime, Duration, Local, Utc};
use ed25519_dalek::{Signature, VerifyingKey};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::error::{AppError, AppResult};
use crate::services::settings;

/// Projet Supabase d'Eden Dev (comptes boutique et licences). Clé publique : sans danger dans l'application.
pub const SUPABASE_URL: &str = "https://wpuchfnyuyujdflbmqpn.supabase.co";
pub const SUPABASE_KEY: &str = "sb_publishable_cbsxEz9jKifmGN8ahIIYcg_M14lFLv3";

/// Adresse du projet Supabase. Compilations de développement seulement : `GM_SUPABASE_URL` la remplace
/// (faux Supabase des tests d'interface). Une compilation publiée utilise toujours celle d'Eden Dev.
pub fn supabase_url() -> String {
    if cfg!(debug_assertions) {
        if let Ok(url) = std::env::var("GM_SUPABASE_URL") {
            if !url.trim().is_empty() {
                return url.trim().trim_end_matches('/').to_string();
            }
        }
    }
    SUPABASE_URL.to_string()
}

/// Essai gratuit sans Internet : dès la première configuration, une fois par boutique (la date de début
/// voyage avec les sauvegardes). Mêmes fonctions que l'essai en ligne (formule PRO, 3 postes), sans
/// l'accès par Internet, qui demande le compte de la boutique.
pub const TRIAL_DAYS: i64 = 14;
const TRIAL_PLAN: &str = "pro";
const TRIAL_FEATURES: &[&str] = &["write", "server", "customer_display", "logo"];
const TRIAL_POSTES: u32 = 3;

/// Clés publiques de vérification : (numéro de clé, clé Ed25519 en base64).
/// La clé privée correspondante est rangée dans Vault (Supabase) et n'en sort jamais.
const PUBLIC_KEYS: &[(u32, &str)] = &[(1, "A1fkc7Q+x/In+KcnyrD6Shx73x2Nd4KmQM6jzj2pteM=")];

/// Clé de test, reconnue uniquement par les compilations de développement (tests d'interface).
#[cfg(debug_assertions)]
pub const TEST_KID: u32 = 99;
#[cfg(debug_assertions)]
pub const TEST_SEED: [u8; 32] = *b"gestimarket-cle-de-test-e2e-0001";

/// Fonctions qu'une licence peut ouvrir.
pub const ALL_FEATURES: &[&str] = &["write", "server", "internet", "customer_display", "logo"];

// ───────────────────────────── Fichier signé ─────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Payload {
    pub v: u32,
    pub license_id: String,
    pub store_code: String,
    pub store_name: String,
    pub plan: String,
    pub max_postes: u32,
    pub features: Vec<String>,
    pub pc_id: String,
    pub issued_at: String,
    pub starts_at: String,
    /// Exclu : la licence n'est plus valable à cet instant.
    pub expires_at: String,
}

#[derive(Deserialize)]
struct LicenseFile {
    format: String,
    kid: u32,
    payload: String,
    sig: String,
}

fn verifying_key(kid: u32) -> Option<VerifyingKey> {
    #[cfg(debug_assertions)]
    {
        if kid == TEST_KID {
            return Some(ed25519_dalek::SigningKey::from_bytes(&TEST_SEED).verifying_key());
        }
    }
    let (_, b64) = PUBLIC_KEYS.iter().find(|(k, _)| *k == kid)?;
    let bytes: [u8; 32] = B64.decode(b64).ok()?.try_into().ok()?;
    VerifyingKey::from_bytes(&bytes).ok()
}

pub fn parse_time(s: &str) -> Result<DateTime<Utc>, String> {
    DateTime::parse_from_rfc3339(s.trim())
        .map(|d| d.with_timezone(&Utc))
        .map_err(|_| format!("Date invalide dans la licence : {s}"))
}

/// Vérifie la signature et le contenu d'un fichier de licence (sans regarder les dates ni le PC).
pub fn verify(text: &str) -> Result<Payload, String> {
    let file: LicenseFile = serde_json::from_str(text.trim()).map_err(|_| "Fichier de licence illisible.".to_string())?;
    if file.format != "gestimarket-licence" {
        return Err("Ce fichier n'est pas une licence GestiMarket.".into());
    }
    let key = verifying_key(file.kid).ok_or("Licence signée avec une clé inconnue : mettez GestiMarket à jour.")?;
    let payload = B64.decode(file.payload.trim()).map_err(|_| "Fichier de licence illisible.".to_string())?;
    let sig = B64.decode(file.sig.trim()).map_err(|_| "Signature de la licence illisible.".to_string())?;
    let sig = Signature::from_slice(&sig).map_err(|_| "Signature de la licence illisible.".to_string())?;
    key.verify_strict(&payload, &sig)
        .map_err(|_| "Signature de la licence invalide : fichier modifié ou contrefait.".to_string())?;
    let p: Payload = serde_json::from_slice(&payload).map_err(|_| "Contenu de la licence illisible.".to_string())?;
    if p.v != 1 {
        return Err("Format de licence non pris en charge : mettez GestiMarket à jour.".into());
    }
    parse_time(&p.issued_at)?;
    parse_time(&p.starts_at)?;
    parse_time(&p.expires_at)?;
    Ok(p)
}

// ───────────────────────────── Identifiant du PC ─────────────────────────────

const ALPHABET: &[u8; 32] = b"0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/// Identifiant du PC pour une boutique : 60 bits d'une empreinte SHA-256, 12 caractères.
pub fn compute_pc_id(machine: &str, slot: u8) -> String {
    let digest = Sha256::digest(format!("gestimarket-pc|{}|{}", machine.trim().to_lowercase(), slot).as_bytes());
    let mut n = u64::from_be_bytes(digest[..8].try_into().unwrap_or([0; 8])) >> 4;
    let mut out = [b'0'; 12];
    for c in out.iter_mut().rev() {
        *c = ALPHABET[(n & 31) as usize];
        n >>= 5;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// « K7QM2XPA9DTR » → « K7QM-2XPA-9DTR ».
pub fn format_pc_id(id: &str) -> String {
    let id = normalize_pc_id(id);
    id.as_bytes().chunks(4).map(|c| String::from_utf8_lossy(c).into_owned()).collect::<Vec<_>>().join("-")
}

pub fn normalize_pc_id(id: &str) -> String {
    id.chars().filter(|c| c.is_ascii_alphanumeric()).map(|c| c.to_ascii_uppercase()).collect()
}

/// Identifiant stable de la machine (MachineGuid sous Windows, machine-id sous Linux),
/// sinon un identifiant aléatoire conservé dans le dossier de données.
fn machine_id(root: &Path) -> String {
    use password_hash::rand_core::{OsRng, RngCore};
    #[cfg(windows)]
    {
        use winreg::enums::{HKEY_LOCAL_MACHINE, KEY_READ, KEY_WOW64_64KEY};
        if let Ok(key) = winreg::RegKey::predef(HKEY_LOCAL_MACHINE)
            .open_subkey_with_flags(r"SOFTWARE\Microsoft\Cryptography", KEY_READ | KEY_WOW64_64KEY)
        {
            if let Ok(v) = key.get_value::<String, _>("MachineGuid") {
                if !v.trim().is_empty() {
                    return v;
                }
            }
        }
    }
    #[cfg(not(windows))]
    {
        for p in ["/etc/machine-id", "/var/lib/dbus/machine-id"] {
            if let Ok(s) = std::fs::read_to_string(p) {
                if !s.trim().is_empty() {
                    return s.trim().to_string();
                }
            }
        }
    }
    let file = root.join("machine.id");
    if let Ok(s) = std::fs::read_to_string(&file) {
        if s.trim().len() >= 16 {
            return s.trim().to_string();
        }
    }
    let mut bytes = [0u8; 16];
    OsRng.fill_bytes(&mut bytes);
    let id: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
    let _ = std::fs::write(&file, &id);
    id
}

// ───────────────────────────── Droits effectifs ─────────────────────────────

#[derive(Debug, Clone, PartialEq)]
pub struct Effective {
    /// none (aucune licence), not_yet (pas encore commencée), active, expired,
    /// trial (essai sans Internet en cours), trial_over (essai terminé, sans licence)
    pub phase: &'static str,
    pub plan: String,
    pub features: Vec<String>,
    pub max_postes: u32,
    pub read_only: bool,
}

impl Effective {
    pub fn allows(&self, feature: &str) -> bool {
        self.features.iter().any(|f| f == feature)
    }
}

fn free(phase: &'static str) -> Effective {
    Effective { phase, plan: "free".into(), features: Vec::new(), max_postes: 1, read_only: true }
}

/// Droits accordés par une licence à un instant donné. Licence expirée : plus d'écriture, mais le
/// réseau et Internet restent ouverts pour consulter.
pub fn evaluate(p: Option<&Payload>, now: DateTime<Utc>) -> Effective {
    let Some(p) = p else { return free("none") };
    let (Ok(starts), Ok(expires)) = (parse_time(&p.starts_at), parse_time(&p.expires_at)) else {
        return free("none");
    };
    // Tolérance d'un jour : horloge du PC légèrement en retard sur celle de Supabase.
    if now + Duration::days(1) < starts {
        return free("not_yet");
    }
    let mut features: Vec<String> = p.features.iter().filter(|f| ALL_FEATURES.contains(&f.as_str())).cloned().collect();
    let max_postes = p.max_postes.max(1);
    if now >= expires {
        features.retain(|f| f != "write");
        return Effective { phase: "expired", plan: p.plan.clone(), features, max_postes, read_only: true };
    }
    let read_only = !features.iter().any(|f| f == "write");
    Effective { phase: "active", plan: p.plan.clone(), features, max_postes, read_only }
}

/// Droits de l'essai sans Internet commencé à `start`.
pub fn evaluate_trial(start: DateTime<Utc>, now: DateTime<Utc>) -> Effective {
    if now < start + Duration::days(TRIAL_DAYS) {
        Effective {
            phase: "trial",
            plan: TRIAL_PLAN.into(),
            features: TRIAL_FEATURES.iter().map(|f| f.to_string()).collect(),
            max_postes: TRIAL_POSTES,
            read_only: false,
        }
    } else {
        free("trial_over")
    }
}

/// Droits de la boutique : la licence si elle existe (même expirée), sinon l'essai sans Internet.
pub fn evaluate_all(p: Option<&Payload>, trial: Option<DateTime<Utc>>, now: DateTime<Utc>) -> Effective {
    match (p, trial) {
        (None, Some(start)) => evaluate_trial(start, now),
        _ => evaluate(p, now),
    }
}

pub fn plan_label(code: &str) -> String {
    match code {
        "free" => "FREE".into(),
        "starter" => "STARTER".into(),
        "pro" => "PRO".into(),
        "business" => "BUSINESS".into(),
        other => other.to_uppercase(),
    }
}

// ───────────────────────────── État de cette boutique ─────────────────────────────

struct Installed {
    payload: Payload,
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct Account {
    pub email: String,
    pub store_code: String,
    pub store_name: String,
}

struct Engine {
    pc_id: String,
    slot: u8,
    clock_file: PathBuf,
    license: Option<Installed>,
    load_error: Option<String>,
    /// Date la plus avancée déjà vue (horloge du PC ou de Supabase).
    clock: DateTime<Utc>,
    /// Écart constaté avec l'heure de Supabase lors de la dernière synchronisation (secondes).
    server_offset: Option<i64>,
    last_sync: Option<DateTime<Utc>>,
    last_sync_error: Option<String>,
    remote_status: Option<String>,
    account: Account,
    /// Début de l'essai gratuit sans Internet.
    trial_start: Option<DateTime<Utc>>,
}

static ENGINE: OnceLock<Mutex<Engine>> = OnceLock::new();

fn lock(m: &Mutex<Engine>) -> MutexGuard<'_, Engine> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

fn now_of(e: &Engine) -> DateTime<Utc> {
    Utc::now().max(e.clock)
}

/// Charge la licence et l'horloge de la boutique au démarrage.
pub fn init(conn: &Connection, root: &Path, dir: &Path, slot: u8) {
    let get = |k: &str| settings::get(conn, k).unwrap_or_default();
    let clock_file = dir.join("licence-horloge.txt");
    let clock = [get("license_clock"), std::fs::read_to_string(&clock_file).unwrap_or_default()]
        .iter()
        .filter_map(|s| parse_time(s).ok())
        .fold(Utc::now(), |a, b| a.max(b));
    let pc_id = compute_pc_id(&machine_id(root), slot);
    let mut engine = Engine {
        pc_id,
        slot,
        clock_file,
        license: None,
        load_error: None,
        clock,
        server_offset: None,
        last_sync: None,
        last_sync_error: None,
        remote_status: None,
        account: Account { email: get("account_email"), store_code: get("account_store_code"), store_name: get("account_store_name") },
        trial_start: parse_time(&get("trial_started_at")).ok(),
    };
    let text = get("license_file");
    if !text.trim().is_empty() {
        match verify(&text).and_then(|p| check_pc(&p, &engine.pc_id).map(|_| p)) {
            Ok(payload) => engine.license = Some(Installed { payload }),
            Err(e) => engine.load_error = Some(e),
        }
    }
    persist_clock(conn, &engine);
    let _ = ENGINE.set(Mutex::new(engine));
    ensure_trial(conn);
}

/// Commence l'essai gratuit sans Internet si la boutique est configurée, sans licence ni compte, et ne l'a
/// jamais eu. Appelé au démarrage, après la première configuration et après une restauration.
pub fn ensure_trial(conn: &Connection) {
    let Some(m) = ENGINE.get() else { return };
    let mut e = lock(m);
    if e.trial_start.is_some() || e.license.is_some() || !e.account.store_code.is_empty() {
        return;
    }
    if crate::services::auth::needs_setup(conn).unwrap_or(true) {
        return;
    }
    let start = now_of(&e);
    if settings::set(conn, "trial_started_at", &start.to_rfc3339()).is_ok() {
        e.trial_start = Some(start);
        crate::journal::info(format!("Essai gratuit de {TRIAL_DAYS} jours commencé (sans Internet)"));
    }
}

/// Base remplacée par une sauvegarde (`before` : paramètres de cet appareil relus juste avant).
/// - Licence : celle de cet appareil s'il en a une ; sinon celle de la sauvegarde si elle a été émise pour
///   cet appareil ; sinon aucune (l'appareil sera relié au compte de la boutique) et le compte de la
///   sauvegarde n'est pas repris.
/// - Essai sans Internet : la date la plus ancienne des deux (l'essai ne recommence pas avec une restauration).
/// - Horloge mémorisée : celle de cet appareil.
pub fn after_restore(conn: &Connection, before: &std::collections::HashMap<&'static str, String>) {
    const LICENSE_KEYS: [&str; 4] = ["license_file", "account_email", "account_store_code", "account_store_name"];
    let Some(m) = ENGINE.get() else { return };
    let mut e = lock(m);
    let get = |k: &str| settings::get(conn, k).unwrap_or_default();
    let device = |k: &str| before.get(k).cloned().unwrap_or_default();
    if e.license.is_some() {
        for k in LICENSE_KEYS {
            let _ = settings::set(conn, k, &device(k));
        }
    } else {
        let restored = get("license_file");
        match verify(&restored).and_then(|p| check_pc(&p, &e.pc_id).map(|_| p)) {
            Ok(payload) => {
                e.license = Some(Installed { payload });
                e.load_error = None;
            }
            Err(_) => {
                let had_account = !device("account_store_code").is_empty();
                for k in LICENSE_KEYS {
                    let value = if had_account { device(k) } else { String::new() };
                    let _ = settings::set(conn, k, &value);
                }
            }
        }
    }
    e.account = Account { email: get("account_email"), store_code: get("account_store_code"), store_name: get("account_store_name") };
    let trial = [device("trial_started_at"), get("trial_started_at")].iter().filter_map(|s| parse_time(s).ok()).min();
    let _ = settings::set(conn, "trial_started_at", &trial.map(|t| t.to_rfc3339()).unwrap_or_default());
    e.trial_start = trial;
    persist_clock(conn, &e);
}

fn check_pc(p: &Payload, pc_id: &str) -> Result<(), String> {
    if normalize_pc_id(&p.pc_id) != pc_id {
        return Err(format!(
            "Cette licence a été émise pour un autre PC ({}). Identifiant de ce PC : {}.",
            format_pc_id(&p.pc_id),
            format_pc_id(pc_id)
        ));
    }
    Ok(())
}

fn persist_clock(conn: &Connection, e: &Engine) {
    let s = e.clock.to_rfc3339();
    let _ = settings::set(conn, "license_clock", &s);
    let _ = std::fs::write(&e.clock_file, &s);
}

/// Sans initialisation (tests unitaires) : aucune restriction. En production, `init` est toujours appelé.
fn uninitialized() -> Effective {
    if cfg!(test) {
        Effective { phase: "active", plan: "business".into(), features: ALL_FEATURES.iter().map(|f| f.to_string()).collect(), max_postes: 1000, read_only: false }
    } else {
        free("none")
    }
}

pub fn effective() -> Effective {
    match ENGINE.get() {
        Some(m) => {
            let e = lock(m);
            evaluate_all(e.license.as_ref().map(|l| &l.payload), e.trial_start, now_of(&e))
        }
        None => uninitialized(),
    }
}

pub fn allows(feature: &str) -> bool {
    effective().allows(feature)
}

/// Programme client fidèle (étoiles et bonus) : formules PRO et BUSINESS.
pub fn loyalty_allowed() -> bool {
    matches!(effective().plan.as_str(), "pro" | "business")
}

pub fn max_postes() -> usize {
    effective().max_postes as usize
}

pub fn pc_id() -> String {
    ENGINE.get().map(|m| lock(m).pc_id.clone()).unwrap_or_default()
}

pub fn slot() -> u8 {
    ENGINE.get().map(|m| lock(m).slot).unwrap_or(1)
}

pub fn account() -> Account {
    ENGINE.get().map(|m| lock(m).account.clone()).unwrap_or_default()
}

pub fn current_license_id() -> Option<String> {
    ENGINE.get().and_then(|m| lock(m).license.as_ref().map(|l| l.payload.license_id.clone()))
}

/// Installe une licence (téléchargée ou importée) après vérification.
pub fn install(conn: &Connection, text: &str) -> Result<Payload, String> {
    let p = verify(text)?;
    let m = ENGINE.get().ok_or("Licence indisponible.")?;
    let mut e = lock(m);
    check_pc(&p, &e.pc_id)?;
    if let Some(cur) = &e.license {
        let older = matches!((parse_time(&p.issued_at), parse_time(&cur.payload.issued_at)), (Ok(a), Ok(b)) if a < b);
        if cur.payload.license_id != p.license_id && older {
            return Err("Cette licence est plus ancienne que celle déjà installée.".into());
        }
    }
    settings::set(conn, "license_file", text.trim()).map_err(|e| e.to_string())?;
    e.license = Some(Installed { payload: p.clone() });
    e.load_error = None;
    Ok(p)
}

/// Retire la licence (boutique suspendue, licence révoquée par Eden Dev).
pub fn remove(conn: &Connection) {
    if let Some(m) = ENGINE.get() {
        let _ = settings::set(conn, "license_file", "");
        lock(m).license = None;
    }
}

pub fn set_account(conn: &Connection, email: &str, store_code: &str, store_name: &str) {
    let _ = settings::set(conn, "account_email", email);
    let _ = settings::set(conn, "account_store_code", store_code);
    let _ = settings::set(conn, "account_store_name", store_name);
    if let Some(m) = ENGINE.get() {
        lock(m).account = Account { email: email.into(), store_code: store_code.into(), store_name: store_name.into() };
    }
}

/// Avance l'horloge mémorisée (appelée chaque minute).
pub fn tick(conn: &Connection) {
    if let Some(m) = ENGINE.get() {
        let mut e = lock(m);
        e.clock = e.clock.max(Utc::now());
        persist_clock(conn, &e);
    }
}

/// Heure de Supabase reçue lors d'une synchronisation : corrige l'horloge mémorisée.
pub fn note_server_time(conn: &Connection, server: &str) {
    let (Ok(server), Some(m)) = (parse_time(server), ENGINE.get()) else { return };
    let mut e = lock(m);
    e.server_offset = Some((Utc::now() - server).num_seconds());
    e.clock = next_clock(e.clock, server);
    persist_clock(conn, &e);
}

/// Horloge mémorisée après réception de l'heure de Supabase : on avance, ou l'on répare une date
/// enregistrée par erreur dans le futur (PC mal réglé un temps).
pub fn next_clock(clock: DateTime<Utc>, server: DateTime<Utc>) -> DateTime<Utc> {
    if clock > server + Duration::hours(1) {
        server
    } else {
        clock.max(server)
    }
}

pub fn should_sync() -> bool {
    ENGINE.get().map(|m| {
        let e = lock(m);
        !e.account.store_code.is_empty() || e.license.is_some()
    }) == Some(true)
}

pub fn set_sync_result(result: &Result<String, String>) {
    if let Some(m) = ENGINE.get() {
        let mut e = lock(m);
        match result {
            Ok(status) => {
                e.last_sync = Some(Utc::now());
                e.last_sync_error = None;
                e.remote_status = Some(status.clone());
            }
            Err(err) => e.last_sync_error = Some(err.clone()),
        }
    }
}

// ───────────────────────────── Commandes autorisées en lecture seule ─────────────────────────────

/// Toujours possibles : connexion, sécurité des comptes, licence, sauvegardes, consultation des rapports,
/// paramètres (dossier de sauvegarde…) et clôture des caisses ouvertes avant l'expiration.
const ALWAYS: &[&str] = &[
    "needs_setup", "initial_setup", "login", "logout", "current_user", "list_login_users", "login_pin",
    "get_settings", "update_settings", "set_my_lang", "server_info", "display_state", "display_update", "set_my_pin", "verify_pin", "change_my_pin",
    "login_info", "login_password", "authorize_device_account", "authorize_device_code", "reset_admin_pin", "list_approvers",
    "suggest_staff", "delete_user", "list_devices", "revoke_device", "create_access_code",
    "close_cash_session", "force_close_cash_session",
    "save_user", "reset_user_pin", "set_business_type", "business_profiles", "catalogue_tree",
    "poste_heartbeat", "list_postes", "live_cart_update", "live_carts", "cloud_status", "cloud_publish_now",
    "tunnel_status", "tunnel_setup", "tunnel_remove",
    "dashboard", "sales_report", "list_audit_log", "app_info", "backup_database", "run_auto_backup", "backup_status", "backup_protect", "terms_status", "accept_terms",
    "license_status", "license_sync", "license_import", "account_options", "account_signup", "account_login",
    "account_confirm_signup", "account_confirm_login", "account_resend_code", "account_otp_send",
    "account_create_store", "account_link", "account_payments", "account_redeem_voucher", "account_declare_orange_money",
    "account_card_start", "list_sessions", "kick_session", "update_status", "report_error", "display_postes", "help_offline_files",
];

/// Consultation des données.
const READ: &[&str] = &[
    "list_users", "list_categories", "list_products", "get_product", "scan_code", "find_product_by_barcode",
    "list_locations", "list_stock_movements", "stock_summary", "list_suppliers", "list_customers", "customer_statement", "customer_loyalty_history", "customer_by_card",
    "list_sales", "get_sale", "list_electronic_payments", "list_purchases", "get_purchase", "current_cash_session",
    "list_cash_movements", "cashier_stats", "list_cash_sessions", "plan_get", "plan_fixture_contents", "product_places", "plan_floor_fill", "plan_floor_status", "plan_fixture_alerts", "plan_sales_map", "plan_preview_layout",
    "sale_quote", "list_returns", "get_return", "get_credit_note", "list_credit_notes", "list_promotions", "cash_x_report", "list_z_reports",
];

pub fn command_allowed_read_only(cmd: &str) -> bool {
    ALWAYS.contains(&cmd) || READ.contains(&cmd)
}

fn read_only_reason(e: &Effective, expires: Option<DateTime<Utc>>) -> String {
    match e.phase {
        "trial_over" => format!("l'essai gratuit de {TRIAL_DAYS} jours est terminé"),
        "expired" => format!(
            "l'abonnement {} a expiré{}",
            plan_label(&e.plan),
            expires.map(|d| format!(" le {}", d.with_timezone(&Local).format("%d/%m/%Y"))).unwrap_or_default()
        ),
        "not_yet" => "la licence n'a pas encore commencé (vérifiez la date et l'heure de ce PC)".into(),
        "active" => format!("la formule {} permet seulement la consultation", plan_label(&e.plan)),
        _ => "aucune licence active pour cette boutique".into(),
    }
}

/// Refuse les opérations d'écriture en lecture seule (toute commande non listée est une écriture).
pub fn check_command(cmd: &str) -> AppResult<()> {
    let e = effective();
    if !e.read_only || command_allowed_read_only(cmd) {
        return Ok(());
    }
    let expires = ENGINE.get().and_then(|m| lock(m).license.as_ref().and_then(|l| parse_time(&l.payload.expires_at).ok()));
    Err(AppError::Validation(format!(
        "Lecture seule : {}. Les ventes et les modifications sont bloquées ; vos données restent consultables. \
         Un administrateur peut activer ou renouveler l'abonnement dans « Abonnement & licence ».",
        read_only_reason(&e, expires)
    )))
}

/// Appareils du réseau (autres PC, téléphones, tablettes) et accès par Internet selon la formule.
pub fn remote_allowed(route: &str) -> Result<(), String> {
    let e = effective();
    if !e.allows("server") {
        return Err(format!(
            "Ce poste serveur n'accepte pas d'autres appareils : la formule {} ne comprend pas les postes clients \
             (PC, téléphones, tablettes). Activez la licence ou passez à la formule PRO (Abonnement & licence, sur le PC serveur).",
            plan_label(&e.plan)
        ));
    }
    if route == "internet" && !e.allows("internet") {
        return Err(format!(
            "L'accès par Internet n'est pas inclus dans la formule {} : connectez-vous depuis le réseau de la boutique.",
            plan_label(&e.plan)
        ));
    }
    Ok(())
}

// ───────────────────────────── État affiché ─────────────────────────────

#[derive(Debug, Clone, Serialize)]
pub struct LicenseStatus {
    pub pc_id: String,
    pub phase: String,
    pub plan: String,
    pub plan_label: String,
    /// Formule inscrite dans la licence (même expirée).
    pub licensed_plan: Option<String>,
    pub features: Vec<String>,
    pub max_postes: u32,
    pub read_only: bool,
    pub store_code: Option<String>,
    pub store_name: Option<String>,
    pub starts_at: Option<String>,
    pub expires_at: Option<String>,
    /// Jours calendaires restants (0 = expire aujourd'hui).
    pub days_left: Option<i64>,
    pub message: String,
    /// Bandeau : J-7, J-3, J-1, jour J, lecture seule.
    pub warning: Option<String>,
    /// ok, warning, danger
    pub level: String,
    pub clock_warning: Option<String>,
    pub load_error: Option<String>,
    /// Essai gratuit sans Internet (en cours ou terminé) : `starts_at` et `expires_at` en sont les dates.
    pub trial: bool,
    pub account: Account,
    pub last_sync: Option<String>,
    pub last_sync_error: Option<String>,
    pub remote_status: Option<String>,
}

fn fmt_local(d: DateTime<Utc>) -> String {
    d.with_timezone(&Local).format("%d/%m/%Y à %H:%M").to_string()
}

/// Message et avertissement d'expiration (fonction pure, testée). `expires` : fin de la licence ou de l'essai.
pub fn describe(e: &Effective, expires: Option<DateTime<Utc>>, now: DateTime<Utc>) -> (String, Option<String>, String, Option<i64>) {
    let label = plan_label(&e.plan);
    let days_left = expires.map(|x| (x.with_timezone(&Local).date_naive() - now.with_timezone(&Local).date_naive()).num_days());
    match e.phase {
        "trial" => {
            let until = expires.map(fmt_local).unwrap_or_default();
            let d = days_left.unwrap_or(0).max(0);
            let message = format!(
                "Essai gratuit sans Internet (formule {label}) : {d} jour(s) restant(s), jusqu'au {until}. Créez le compte de la boutique \
                 dès que vous avez Internet (Abonnement & licence) pour continuer ensuite."
            );
            let warning = match d {
                0 => Some(format!(
                    "L'essai gratuit se termine aujourd'hui ({until}) : créez le compte de la boutique et choisissez une formule (Internet nécessaire)."
                )),
                1..=3 => Some(format!(
                    "L'essai gratuit se termine dans {d} jour(s), le {until} : créez le compte de la boutique et choisissez une formule (Internet nécessaire)."
                )),
                _ => None,
            };
            let level = match d {
                0 | 1 => "danger",
                2 | 3 => "warning",
                _ => "ok",
            };
            (message, warning, level.into(), Some(d))
        }
        "trial_over" => {
            let m = format!(
                "L'essai gratuit de {TRIAL_DAYS} jours est terminé : GestiMarket est en lecture seule. Vos données sont conservées ; \
                 créez ou reliez le compte de la boutique (Abonnement & licence, Internet nécessaire) pour reprendre les ventes."
            );
            (m.clone(), Some(m), "danger".into(), days_left)
        }
        "active" if e.read_only => {
            let m = format!("Formule {label} : consultation uniquement (aucune vente ni modification).");
            (m.clone(), Some(m), "danger".into(), days_left)
        }
        "active" => {
            let until = expires.map(fmt_local).unwrap_or_default();
            let message = format!("Formule {label} active jusqu'au {until}.");
            let warning = match days_left {
                Some(d) if d <= 0 => Some(format!(
                    "Votre abonnement {label} expire aujourd'hui à {} : renouvelez-le maintenant pour éviter la lecture seule.",
                    expires.map(|x| x.with_timezone(&Local).format("%H:%M").to_string()).unwrap_or_default()
                )),
                Some(1) => Some(format!("Dernier avertissement : votre abonnement {label} expire demain ({until}).")),
                Some(d) if d <= 7 => Some(format!("Votre abonnement {label} expire dans {d} jours (le {until}). Pensez à le renouveler.")),
                _ => None,
            };
            let level = match days_left {
                Some(d) if d <= 1 => "danger",
                Some(d) if d <= 7 => "warning",
                _ => "ok",
            };
            (message, warning, level.into(), days_left)
        }
        "expired" => {
            let m = format!(
                "Abonnement {label} expiré depuis le {} : GestiMarket est en lecture seule. Vos données sont conservées ; \
                 renouvelez l'abonnement pour reprendre les ventes.",
                expires.map(fmt_local).unwrap_or_default()
            );
            (m.clone(), Some(m), "danger".into(), days_left)
        }
        "not_yet" => {
            let m = "La licence n'a pas encore commencé : vérifiez la date et l'heure de ce PC.".to_string();
            (m.clone(), Some(m), "danger".into(), None)
        }
        _ => {
            let m = "Aucune licence active : GestiMarket est en lecture seule. Créez ou reliez le compte de la boutique \
                     (essai gratuit) dans « Abonnement & licence »."
                .to_string();
            (m.clone(), Some(m), "danger".into(), None)
        }
    }
}

pub fn status() -> LicenseStatus {
    let Some(m) = ENGINE.get() else {
        let e = uninitialized();
        return LicenseStatus {
            pc_id: String::new(),
            phase: e.phase.into(),
            plan_label: plan_label(&e.plan),
            plan: e.plan,
            licensed_plan: None,
            features: e.features,
            max_postes: e.max_postes,
            read_only: e.read_only,
            store_code: None,
            store_name: None,
            starts_at: None,
            expires_at: None,
            days_left: None,
            message: String::new(),
            warning: None,
            level: "ok".into(),
            clock_warning: None,
            load_error: None,
            trial: false,
            account: Account::default(),
            last_sync: None,
            last_sync_error: None,
            remote_status: None,
        };
    };
    let g = lock(m);
    let now = now_of(&g);
    let payload = g.license.as_ref().map(|l| &l.payload);
    let e = evaluate_all(payload, g.trial_start, now);
    // Essai sans Internet : ses dates de début et de fin sont montrées comme celles d'une licence.
    let trial = if payload.is_none() { g.trial_start } else { None };
    let expires = match trial {
        Some(t) => Some(t + Duration::days(TRIAL_DAYS)),
        None => payload.and_then(|p| parse_time(&p.expires_at).ok()),
    };
    let (message, warning, level, days_left) = describe(&e, expires, now);
    let clock_warning = if Utc::now() + Duration::minutes(10) < g.clock {
        Some(format!("L'horloge de ce PC a été reculée : GestiMarket utilise la date du {}. Corrigez la date et l'heure dans Windows.", fmt_local(g.clock)))
    } else {
        g.server_offset.filter(|s| s.abs() > 3600).map(|s| {
            format!(
                "La date ou l'heure de ce PC est fausse ({} de {} h avec Internet) : corrigez-la dans Windows.",
                if s > 0 { "avance" } else { "retard" },
                s.abs() / 3600
            )
        })
    };
    LicenseStatus {
        pc_id: format_pc_id(&g.pc_id),
        phase: e.phase.into(),
        plan_label: plan_label(&e.plan),
        plan: e.plan.clone(),
        licensed_plan: payload.map(|p| plan_label(&p.plan)),
        features: e.features.clone(),
        max_postes: e.max_postes,
        read_only: e.read_only,
        store_code: payload.map(|p| p.store_code.clone()),
        store_name: payload.map(|p| p.store_name.clone()),
        starts_at: trial.map(|t| t.to_rfc3339()).or_else(|| payload.map(|p| p.starts_at.clone())),
        expires_at: expires.filter(|_| trial.is_some()).map(|t| t.to_rfc3339()).or_else(|| payload.map(|p| p.expires_at.clone())),
        days_left,
        message,
        warning,
        level,
        clock_warning,
        load_error: g.load_error.clone(),
        trial: trial.is_some(),
        account: g.account.clone(),
        last_sync: g.last_sync.map(fmt_local),
        last_sync_error: g.last_sync_error.clone(),
        remote_status: g.remote_status.clone(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};

    /// Licence réelle signée par la fonction « gm-license » (Supabase, clé 1) pour le PC de test.
    const SIGNED_BY_SUPABASE: &str = include_str!("testdata_licence.gml");

    fn sign_test(p: &Payload) -> String {
        let bytes = serde_json::to_vec(p).unwrap();
        let sig = SigningKey::from_bytes(&TEST_SEED).sign(&bytes);
        serde_json::json!({ "format": "gestimarket-licence", "kid": TEST_KID, "payload": B64.encode(&bytes), "sig": B64.encode(sig.to_bytes()) })
            .to_string()
    }

    fn payload(plan: &str, features: &[&str], starts: &str, expires: &str) -> Payload {
        Payload {
            v: 1,
            license_id: "l-1".into(),
            store_code: "GM-000001".into(),
            store_name: "Eden Superrette".into(),
            plan: plan.into(),
            max_postes: 3,
            features: features.iter().map(|f| f.to_string()).collect(),
            pc_id: "K7QM2XPA9DTR".into(),
            issued_at: starts.into(),
            starts_at: starts.into(),
            expires_at: expires.into(),
        }
    }

    fn at(s: &str) -> DateTime<Utc> {
        parse_time(s).unwrap()
    }

    #[test]
    fn supabase_signature_is_verified() {
        let p = verify(SIGNED_BY_SUPABASE).expect("licence signée par Supabase");
        assert_eq!(p.pc_id, "TESTE2E00001");
        assert_eq!(p.plan, "pro");
        assert_eq!(p.max_postes, 3);
        assert!(p.features.contains(&"server".to_string()));
        // Nombre de postes modifié dans le contenu (3 → 9) : refus.
        let mut file: serde_json::Value = serde_json::from_str(SIGNED_BY_SUPABASE).unwrap();
        let text = String::from_utf8(B64.decode(file["payload"].as_str().unwrap()).unwrap()).unwrap();
        let bytes = text.replace("\"max_postes\":3", "\"max_postes\":9").into_bytes();
        assert_ne!(bytes, text.as_bytes());
        file["payload"] = B64.encode(&bytes).into();
        assert!(verify(&file.to_string()).unwrap_err().contains("Signature"));
        // Clé inconnue : refus.
        let mut other: serde_json::Value = serde_json::from_str(SIGNED_BY_SUPABASE).unwrap();
        other["kid"] = 7.into();
        assert!(verify(&other.to_string()).unwrap_err().contains("clé inconnue"));
        assert!(verify("pas une licence").is_err());
    }

    #[test]
    fn test_key_round_trip() {
        let p = payload("starter", &["write"], "2026-11-01T00:00:00Z", "2026-12-01T00:00:00Z");
        assert_eq!(verify(&sign_test(&p)).unwrap(), p);
    }

    #[test]
    fn pc_ids_are_stable_and_distinct() {
        let a = compute_pc_id("4c4c4544-0042-3510-8051-b4c04f4d4a32", 1);
        assert_eq!(a, compute_pc_id("4C4C4544-0042-3510-8051-B4C04F4D4A32 ", 1));
        assert_ne!(a, compute_pc_id("4c4c4544-0042-3510-8051-b4c04f4d4a32", 2));
        assert_eq!(a.len(), 12);
        assert!(a.bytes().all(|c| ALPHABET.contains(&c)));
        assert_eq!(format_pc_id("k7qm2xpa9dtr"), "K7QM-2XPA-9DTR");
        assert_eq!(normalize_pc_id("K7QM-2XPA-9DTR"), "K7QM2XPA9DTR");
    }

    #[test]
    fn rights_by_phase() {
        let pro = payload("pro", &["write", "server", "internet", "customer_display", "logo", "inconnue"], "2026-11-01T00:00:00Z", "2026-12-01T00:00:00Z");
        let e = evaluate(Some(&pro), at("2026-11-15T10:00:00Z"));
        assert_eq!((e.phase, e.read_only, e.max_postes), ("active", false, 3));
        assert!(e.allows("internet") && !e.allows("inconnue"));
        // Expirée : lecture seule, mais le réseau reste ouvert pour consulter.
        let e = evaluate(Some(&pro), at("2026-12-01T00:00:00Z"));
        assert_eq!((e.phase, e.read_only), ("expired", true));
        assert!(!e.allows("write") && e.allows("server"));
        // Pas encore commencée (au-delà d'un jour de tolérance).
        assert_eq!(evaluate(Some(&pro), at("2026-10-30T00:00:00Z")).phase, "not_yet");
        assert_eq!(evaluate(Some(&pro), at("2026-10-31T12:00:00Z")).phase, "active");
        // Sans licence : FREE, lecture seule, 1 poste, pas de serveur.
        let e = evaluate(None, at("2026-11-15T10:00:00Z"));
        assert_eq!((e.plan.as_str(), e.read_only, e.max_postes), ("free", true, 1));
        assert!(!e.allows("server"));
        // STARTER : écriture, pas de serveur.
        let st = payload("starter", &["write"], "2026-11-01T00:00:00Z", "2026-12-01T00:00:00Z");
        let e = evaluate(Some(&st), at("2026-11-15T10:00:00Z"));
        assert!(!e.read_only && !e.allows("server"));
    }

    #[test]
    fn clock_cannot_go_back() {
        let saved = at("2026-12-05T00:00:00Z");
        // Supabase en retard sur l'horloge mémorisée de moins d'une heure : on garde la plus avancée.
        assert_eq!(next_clock(saved, at("2026-12-04T23:30:00Z")), saved);
        assert_eq!(next_clock(saved, at("2026-12-06T00:00:00Z")), at("2026-12-06T00:00:00Z"));
        // Date enregistrée par erreur dans le futur : réparée par l'heure de Supabase.
        assert_eq!(next_clock(at("2030-01-01T00:00:00Z"), at("2026-12-06T00:00:00Z")), at("2026-12-06T00:00:00Z"));
    }

    #[test]
    fn expiry_warnings() {
        let p = payload("pro", &["write", "server"], "2026-11-01T00:00:00Z", "2026-12-01T12:00:00Z");
        let warn = |now: &str| {
            let now = at(now);
            describe(&evaluate(Some(&p), now), parse_time(&p.expires_at).ok(), now)
        };
        assert!(warn("2026-11-10T12:00:00Z").1.is_none());
        let (_, w, level, days) = warn("2026-11-24T12:00:00Z");
        assert_eq!((days, level.as_str()), (Some(7), "warning"));
        assert!(w.unwrap().contains("dans 7 jours"));
        assert!(warn("2026-11-30T12:00:00Z").1.unwrap().contains("demain"));
        assert!(warn("2026-12-01T06:00:00Z").1.unwrap().contains("aujourd'hui"));
        let (m, w, level, _) = warn("2026-12-02T00:00:00Z");
        assert!(m.contains("lecture seule") && w.is_some() && level == "danger");
    }

    #[test]
    fn essai_sans_internet() {
        let start = at("2026-11-01T10:00:00Z");
        let e = evaluate_all(None, Some(start), at("2026-11-05T10:00:00Z"));
        assert_eq!((e.phase, e.plan.as_str(), e.read_only, e.max_postes), ("trial", "pro", false, 3));
        assert!(e.allows("write") && e.allows("server") && !e.allows("internet"));
        // 14 jours pile : terminé, lecture seule.
        let e = evaluate_all(None, Some(start), at("2026-11-15T10:00:00Z"));
        assert_eq!((e.phase, e.read_only), ("trial_over", true));
        // Une licence (même expirée) passe avant l'essai.
        let p = payload("starter", &["write"], "2026-10-01T00:00:00Z", "2026-10-31T00:00:00Z");
        assert_eq!(evaluate_all(Some(&p), Some(start), at("2026-11-05T10:00:00Z")).phase, "expired");
        // Messages : jours restants, avertissement les 3 derniers jours.
        let end = start + Duration::days(TRIAL_DAYS);
        let now = at("2026-11-05T10:00:00Z");
        let (m, w, level, days) = describe(&evaluate_all(None, Some(start), now), Some(end), now);
        assert!(m.contains("Essai gratuit") && w.is_none() && level == "ok", "{m}");
        assert_eq!(days, Some(10));
        let now = at("2026-11-13T10:00:00Z");
        let (_, w, level, _) = describe(&evaluate_all(None, Some(start), now), Some(end), now);
        assert!(w.unwrap().contains("se termine dans") && level == "warning");
        let now = at("2026-11-16T10:00:00Z");
        let (m, w, level, _) = describe(&evaluate_all(None, Some(start), now), Some(end), now);
        assert!(m.contains("terminé") && w.is_some() && level == "danger");
        assert!(read_only_reason(&evaluate_all(None, Some(start), now), None).contains("essai"));
    }

    #[test]
    fn read_only_commands() {
        for cmd in ["list_products", "get_sale", "login", "backup_database", "license_import", "account_signup", "save_user", "update_settings", "close_cash_session"] {
            assert!(command_allowed_read_only(cmd), "{cmd}");
        }
        for cmd in ["create_sale", "save_product", "adjust_stock", "create_purchase", "open_cash_session", "add_cash_movement", "commande_future"] {
            assert!(!command_allowed_read_only(cmd), "{cmd}");
        }
    }
}
