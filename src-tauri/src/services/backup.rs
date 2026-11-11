//! Sauvegardes : manuelle (choix du fichier), automatique quotidienne, protégée par un mot de passe
//! (au choix du commerçant), et restauration.
//!
//! Sans dossier choisi dans les Paramètres, la sauvegarde automatique se fait quand même, dans
//! `Documents\GestiMarket\Sauvegardes` (un sous-dossier par boutique à partir de la 2e) : une boutique
//! qui n'y a pas pensé n'est jamais sans copie. Chaque copie est vérifiée avant d'être gardée.
//!
//! Sauvegarde protégée (fichier `.gmsave`) : la base est chiffrée (ChaCha20-Poly1305, par morceaux de 1 Mo)
//! avec une clé tirée du mot de passe (Argon2id). Sans le mot de passe, personne ne peut la lire ni la
//! modifier sans que cela se voie. Le mot de passe n'est pas gardé : seule la clé l'est, dans la base,
//! pour chiffrer les copies suivantes et relire sans mot de passe les copies de cet appareil.
//!
//! Restauration : le fichier est vérifié (intégrité, tables, version), une copie de sécurité de la base
//! actuelle est faite, puis la base est remplacée en place (API de sauvegarde de SQLite), sans redémarrer.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

use rusqlite::{Connection, OpenFlags, OptionalExtension};
use serde::Serialize;

use crate::db;
use crate::error::{invalid, AppError, AppResult};
use crate::services::settings;

const AUTO_PREFIX: &str = "gestimarket-auto-";
const SAFETY_PREFIX: &str = "gestimarket-avant-restauration-";
/// Extension d'une sauvegarde protégée par un mot de passe.
pub const PROTECTED_EXT: &str = "gmsave";

/// Une sauvegarde automatique plus vieille que ce délai est signalée (tableau de bord).
const STALE_HOURS: i64 = 48;

static DEFAULT_DIR: OnceLock<PathBuf> = OnceLock::new();
static LAST_ERROR: Mutex<Option<String>> = Mutex::new(None);

/// Dossier par défaut des sauvegardes automatiques (fixé au démarrage).
pub fn set_default_dir(dir: PathBuf) {
    let _ = DEFAULT_DIR.set(dir);
}

/// Dossier réellement utilisé : celui des Paramètres, sinon le dossier par défaut.
pub fn effective_dir(conn: &Connection) -> AppResult<Option<PathBuf>> {
    let dir = settings::get(conn, "auto_backup_dir")?;
    if !dir.trim().is_empty() {
        return Ok(Some(PathBuf::from(dir.trim())));
    }
    Ok(DEFAULT_DIR.get().cloned())
}

fn with_suffix(path: &Path, suffix: &str) -> PathBuf {
    let mut s = path.as_os_str().to_owned();
    s.push(suffix);
    PathBuf::from(s)
}

fn remove_db_files(path: &Path) {
    for suffix in ["", "-wal", "-shm", "-journal"] {
        let _ = std::fs::remove_file(with_suffix(path, suffix));
    }
}

/// Copie cohérente de la base (fonctionne pendant l'utilisation), vérifiée avant de remplacer
/// une copie existante du même nom. Sauvegardes protégées : la copie est chiffrée.
pub fn backup_to(conn: &Connection, path: &Path) -> AppResult<()> {
    if path.as_os_str().is_empty() {
        return invalid("Chemin de sauvegarde invalide.");
    }
    // Copie de passage de l'application mobile (dossier de cache, pas forcément encore créé).
    if let Some(parent) = path.parent().filter(|p| !p.as_os_str().is_empty()) {
        std::fs::create_dir_all(parent)?;
    }
    let tmp = with_suffix(path, ".tmp");
    remove_db_files(&tmp);
    conn.execute("VACUUM INTO ?1", [tmp.to_string_lossy().as_ref()])?;
    if let Err(e) = verify(&tmp) {
        remove_db_files(&tmp);
        return Err(e);
    }
    let ready = match stored_key(conn)? {
        Some(key) => {
            let sealed = with_suffix(path, ".tmp2");
            let r = encrypt_file(&tmp, &sealed, &key);
            remove_db_files(&tmp);
            if let Err(e) = r {
                let _ = std::fs::remove_file(&sealed);
                return Err(e);
            }
            sealed
        }
        None => tmp,
    };
    if path.exists() {
        std::fs::remove_file(path)?;
    }
    std::fs::rename(&ready, path)?;
    Ok(())
}

/// Relit la copie : elle doit s'ouvrir et passer le contrôle d'intégrité de SQLite.
fn verify(path: &Path) -> AppResult<()> {
    let copy = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    let check: String = copy.query_row("PRAGMA quick_check", [], |r| r.get(0))?;
    if check != "ok" {
        return Err(AppError::Internal(format!("La copie de sauvegarde est abîmée ({check}).")));
    }
    Ok(())
}

/// Les sauvegardes de cette boutique sont-elles protégées par un mot de passe ?
pub fn is_protected(conn: &Connection) -> AppResult<bool> {
    Ok(stored_key(conn)?.is_some())
}

/// Nom d'une copie selon la protection : `.gmsave` (protégée) ou `.db`.
fn ext(conn: &Connection) -> AppResult<&'static str> {
    Ok(if is_protected(conn)? { PROTECTED_EXT } else { "db" })
}

/// Sauvegarde automatique : une copie par jour, en ne conservant que les N plus récentes.
/// Retourne le fichier créé, s'il y en a un. L'erreur éventuelle est retenue pour le tableau de bord.
pub fn auto_backup(conn: &Connection, force: bool) -> AppResult<Option<PathBuf>> {
    let result = auto_backup_inner(conn, force);
    let mut last = LAST_ERROR.lock().unwrap_or_else(|e| e.into_inner());
    match &result {
        Ok(Some(_)) => *last = None,
        Err(e) => *last = Some(e.to_string()),
        Ok(None) => {}
    }
    result
}

fn is_backup_name(name: &str, prefix: &str) -> bool {
    name.starts_with(prefix) && (name.ends_with(".db") || name.ends_with(&format!(".{PROTECTED_EXT}")))
}

fn auto_backup_inner(conn: &Connection, force: bool) -> AppResult<Option<PathBuf>> {
    let Some(dir) = effective_dir(conn)? else {
        return Ok(None);
    };
    let keep = settings::get_i64(conn, "auto_backup_keep")?.clamp(1, 365) as usize;
    std::fs::create_dir_all(&dir)?;
    let day = chrono::Local::now().format("%Y-%m-%d").to_string();
    let path = dir.join(format!("{AUTO_PREFIX}{day}.{}", ext(conn)?));
    if path.exists() && !force {
        return Ok(None);
    }
    backup_to(conn, &path)?;
    settings::set(conn, "last_auto_backup", &db::now())?;

    // Rotation : suppression des sauvegardes automatiques les plus anciennes (jamais les copies de sécurité
    // faites avant une restauration).
    let mut files: Vec<PathBuf> = std::fs::read_dir(&dir)?
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| p.file_name().and_then(|n| n.to_str()).map(|n| is_backup_name(n, AUTO_PREFIX)).unwrap_or(false))
        .collect();
    files.sort();
    if files.len() > keep {
        for old in &files[..files.len() - keep] {
            let _ = std::fs::remove_file(old);
        }
    }
    Ok(Some(path))
}

pub fn last_auto_backup(conn: &Connection) -> AppResult<Option<String>> {
    let v = settings::get(conn, "last_auto_backup")?;
    Ok(if v.is_empty() { None } else { Some(v) })
}

#[derive(Debug, Serialize)]
pub struct BackupStatus {
    /// Dossier utilisé (celui des Paramètres ou le dossier par défaut), chemin du poste qui a la base.
    pub dir: Option<String>,
    /// Aucun dossier choisi : c'est le dossier par défaut.
    pub is_default: bool,
    pub default_dir: Option<String>,
    pub last: Option<String>,
    /// Dernière erreur de la sauvegarde automatique (depuis le démarrage).
    pub error: Option<String>,
    /// Pas de sauvegarde automatique réussie depuis 48 h (ou jamais) : à signaler.
    pub stale: bool,
    /// Copies protégées par un mot de passe (fichiers `.gmsave`).
    pub protected: bool,
}

pub fn status(conn: &Connection) -> AppResult<BackupStatus> {
    let chosen = settings::get(conn, "auto_backup_dir")?;
    let dir = effective_dir(conn)?;
    let last = last_auto_backup(conn)?;
    let stale = match &last {
        Some(t) => chrono::NaiveDateTime::parse_from_str(t, "%Y-%m-%d %H:%M:%S")
            .map(|d| (chrono::Local::now().naive_local() - d).num_hours() >= STALE_HOURS)
            .unwrap_or(true),
        None => true,
    };
    Ok(BackupStatus {
        dir: dir.map(|d| d.display().to_string()),
        is_default: chosen.trim().is_empty(),
        default_dir: DEFAULT_DIR.get().map(|d| d.display().to_string()),
        last,
        error: LAST_ERROR.lock().unwrap_or_else(|e| e.into_inner()).clone(),
        stale,
        protected: is_protected(conn)?,
    })
}

// ───────────────────────────── Sauvegarde protégée par un mot de passe ─────────────────────────────

const MAGIC: &[u8; 8] = b"GMSAUV01";
const SQLITE_MAGIC: &[u8; 16] = b"SQLite format 3\0";
const SALT_LEN: usize = 16;
const PREFIX_LEN: usize = 7;
const HEADER_LEN: usize = MAGIC.len() + SALT_LEN + PREFIX_LEN;
const CHUNK: usize = 1 << 20;
const TAG: usize = 16;

/// Clé de chiffrement des sauvegardes : sel et clé tirée du mot de passe.
#[derive(Clone, PartialEq, Debug)]
pub struct BackupKey {
    salt: [u8; SALT_LEN],
    key: [u8; 32],
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn unhex(s: &str) -> Option<Vec<u8>> {
    if !s.len().is_multiple_of(2) {
        return None;
    }
    (0..s.len()).step_by(2).map(|i| u8::from_str_radix(s.get(i..i + 2)?, 16).ok()).collect()
}

fn derive(password: &str, salt: &[u8]) -> AppResult<[u8; 32]> {
    let mut key = [0u8; 32];
    argon2::Argon2::default()
        .hash_password_into(password.as_bytes(), salt, &mut key)
        .map_err(|e| AppError::Internal(format!("Clé de la sauvegarde impossible à calculer : {e}")))?;
    Ok(key)
}

impl BackupKey {
    pub fn new(password: &str) -> AppResult<Self> {
        use password_hash::rand_core::{OsRng, RngCore};
        let mut salt = [0u8; SALT_LEN];
        OsRng.fill_bytes(&mut salt);
        Ok(Self { salt, key: derive(password, &salt)? })
    }

    fn encode(&self) -> String {
        format!("{}:{}", hex(&self.salt), hex(&self.key))
    }

    fn decode(s: &str) -> Option<Self> {
        let (salt, key) = s.trim().split_once(':')?;
        Some(Self { salt: unhex(salt)?.try_into().ok()?, key: unhex(key)?.try_into().ok()? })
    }
}

fn stored_key(conn: &Connection) -> AppResult<Option<BackupKey>> {
    Ok(BackupKey::decode(&settings::get(conn, "backup_key")?))
}

/// Protège (ou ne protège plus) les sauvegardes de la boutique par un mot de passe.
pub fn set_password(conn: &Connection, password: Option<&str>) -> AppResult<()> {
    match password.map(str::trim).filter(|p| !p.is_empty()) {
        None => settings::set(conn, "backup_key", ""),
        Some(p) => {
            if p.chars().count() < 8 {
                return invalid("Mot de passe des sauvegardes : au moins 8 caractères.");
            }
            settings::set(conn, "backup_key", &BackupKey::new(p)?.encode())
        }
    }
}

fn nonce(prefix: &[u8; PREFIX_LEN], index: usize, last: bool) -> AppResult<ring::aead::Nonce> {
    let index = u32::try_from(index).map_err(|_| AppError::Internal("Sauvegarde trop volumineuse.".into()))?;
    let mut n = [0u8; 12];
    n[..PREFIX_LEN].copy_from_slice(prefix);
    n[PREFIX_LEN..PREFIX_LEN + 4].copy_from_slice(&index.to_be_bytes());
    n[11] = u8::from(last);
    Ok(ring::aead::Nonce::assume_unique_for_key(n))
}

fn aead_key(key: &[u8; 32]) -> AppResult<ring::aead::LessSafeKey> {
    let unbound = ring::aead::UnboundKey::new(&ring::aead::CHACHA20_POLY1305, key)
        .map_err(|_| AppError::Internal("Clé de la sauvegarde invalide.".into()))?;
    Ok(ring::aead::LessSafeKey::new(unbound))
}

/// Chiffre `src` dans `dst` : en-tête (signature, sel, préfixe des nonces), puis morceaux de 1 Mo chacun
/// suivi de son code d'authentification. Le numéro du morceau et la marque du dernier entrent dans le
/// nonce : un fichier coupé, réordonné ou modifié est refusé à la lecture.
fn encrypt_file(src: &Path, dst: &Path, k: &BackupKey) -> AppResult<()> {
    use password_hash::rand_core::{OsRng, RngCore};
    let sealing = aead_key(&k.key)?;
    let mut prefix = [0u8; PREFIX_LEN];
    OsRng.fill_bytes(&mut prefix);
    let mut header = Vec::with_capacity(HEADER_LEN);
    header.extend_from_slice(MAGIC);
    header.extend_from_slice(&k.salt);
    header.extend_from_slice(&prefix);
    let total = usize::try_from(std::fs::metadata(src)?.len()).map_err(|_| AppError::Internal("Sauvegarde trop volumineuse.".into()))?;
    let mut input = std::fs::File::open(src)?;
    let mut out = std::io::BufWriter::new(std::fs::File::create(dst)?);
    out.write_all(&header)?;
    let chunks = total.div_ceil(CHUNK).max(1);
    let mut buf: Vec<u8> = Vec::with_capacity(CHUNK + TAG);
    for i in 0..chunks {
        let last = i + 1 == chunks;
        let len = if last { total - i * CHUNK } else { CHUNK };
        buf.clear();
        buf.resize(len, 0);
        input.read_exact(&mut buf)?;
        sealing
            .seal_in_place_append_tag(nonce(&prefix, i, last)?, ring::aead::Aad::from(&header[..]), &mut buf)
            .map_err(|_| AppError::Internal("Chiffrement de la sauvegarde impossible.".into()))?;
        out.write_all(&buf)?;
    }
    out.into_inner().map_err(|e| AppError::Internal(e.to_string()))?.sync_all()?;
    Ok(())
}

/// Résultat de la lecture d'une sauvegarde protégée.
enum Opened {
    Ready,
    NeedsPassword,
}

fn decrypt_file(src: &Path, dst: &Path, password: Option<&str>, stored: Option<&BackupKey>) -> AppResult<Opened> {
    let damaged = || AppError::Validation("Sauvegarde protégée incomplète ou abîmée.".into());
    let total = usize::try_from(std::fs::metadata(src)?.len()).map_err(|_| damaged())?;
    if total < HEADER_LEN + TAG {
        return Err(damaged());
    }
    let mut input = std::fs::File::open(src)?;
    let mut header = [0u8; HEADER_LEN];
    input.read_exact(&mut header)?;
    if &header[..MAGIC.len()] != MAGIC {
        return invalid("Ce fichier n'est pas une sauvegarde GestiMarket.");
    }
    let salt = &header[MAGIC.len()..MAGIC.len() + SALT_LEN];
    let prefix: [u8; PREFIX_LEN] = header[MAGIC.len() + SALT_LEN..].try_into().map_err(|_| damaged())?;
    let key = match (password.map(str::trim).filter(|p| !p.is_empty()), stored) {
        (Some(p), _) => derive(p, salt)?,
        // Copie faite par cette boutique avec le mot de passe actuel : pas besoin de le retaper.
        (None, Some(k)) if k.salt == salt => k.key,
        _ => return Ok(Opened::NeedsPassword),
    };
    let opening = aead_key(&key)?;
    let body = total - HEADER_LEN;
    let full = CHUNK + TAG;
    let chunks = body.div_ceil(full);
    let mut out = std::io::BufWriter::new(std::fs::File::create(dst)?);
    let mut buf = vec![0u8; full];
    for i in 0..chunks {
        let last = i + 1 == chunks;
        let len = if last { body - i * full } else { full };
        if len < TAG {
            return Err(damaged());
        }
        let part = &mut buf[..len];
        input.read_exact(part)?;
        let plain = opening.open_in_place(nonce(&prefix, i, last)?, ring::aead::Aad::from(&header[..]), part).map_err(|_| {
            if i == 0 {
                AppError::Validation("Mot de passe de la sauvegarde incorrect.".into())
            } else {
                damaged()
            }
        })?;
        out.write_all(plain)?;
    }
    out.into_inner().map_err(|e| AppError::Internal(e.to_string()))?.sync_all()?;
    Ok(Opened::Ready)
}

// ───────────────────────────── Restauration ─────────────────────────────

/// Ce que contient une sauvegarde (montré avant de la restaurer).
#[derive(Debug, Serialize, Default)]
pub struct BackupInfo {
    pub file: String,
    pub size: u64,
    /// Sauvegarde protégée par un mot de passe.
    pub protected: bool,
    /// Protégée, et le mot de passe est nécessaire (rien d'autre n'est lu).
    pub needs_password: bool,
    pub shop_name: Option<String>,
    pub products: i64,
    pub customers: i64,
    pub sales: i64,
    pub users: i64,
    /// Dernière activité enregistrée (vente ou action du journal) : date approximative de la copie.
    pub last_activity: Option<String>,
    /// Faite par une version plus récente de GestiMarket : à mettre à jour d'abord.
    pub newer: bool,
}

/// Prépare une copie en clair de la sauvegarde dans le dossier de travail.
fn prepare(src: &Path, work: &Path, password: Option<&str>, stored: Option<&BackupKey>) -> AppResult<(PathBuf, BackupInfo)> {
    let meta = std::fs::metadata(src).map_err(|_| AppError::Validation("Fichier de sauvegarde introuvable.".into()))?;
    if !meta.is_file() {
        return invalid("Choisissez un fichier de sauvegarde.");
    }
    let mut info = BackupInfo {
        file: src.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default(),
        size: meta.len(),
        ..Default::default()
    };
    let mut head = [0u8; 16];
    let n = std::fs::File::open(src)?.read(&mut head)?;
    std::fs::create_dir_all(work)?;
    let plain = work.join("sauvegarde-a-restaurer.db");
    remove_db_files(&plain);
    if n >= MAGIC.len() && &head[..MAGIC.len()] == MAGIC {
        info.protected = true;
        match decrypt_file(src, &plain, password, stored) {
            Ok(Opened::Ready) => {}
            Ok(Opened::NeedsPassword) => {
                info.needs_password = true;
                return Ok((plain, info));
            }
            Err(e) => {
                remove_db_files(&plain);
                return Err(e);
            }
        }
    } else if n == SQLITE_MAGIC.len() && &head == SQLITE_MAGIC {
        std::fs::copy(src, &plain)?;
    } else {
        return invalid("Ce fichier n'est pas une sauvegarde GestiMarket.");
    }
    if let Err(e) = describe(&plain, &mut info) {
        remove_db_files(&plain);
        return Err(e);
    }
    Ok((plain, info))
}

/// Vérifie la copie en clair (intégrité, tables de GestiMarket, version) et compte son contenu.
fn describe(plain: &Path, info: &mut BackupInfo) -> AppResult<()> {
    let not_ours = || AppError::Validation("Ce fichier n'est pas une sauvegarde GestiMarket.".into());
    // Copie de travail : ouverte normalement (une base en mode WAL a besoin de ses fichiers annexes).
    let conn = Connection::open(plain).map_err(|_| not_ours())?;
    let check: String = conn.query_row("PRAGMA quick_check", [], |r| r.get(0)).map_err(|_| not_ours())?;
    if check != "ok" {
        return invalid(format!("Cette sauvegarde est abîmée ({check}) : choisissez-en une autre."));
    }
    let tables: i64 = conn.query_row(
        "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name IN ('settings', 'users', 'products', 'sales', 'customers', 'audit_log')",
        [],
        |r| r.get(0),
    )?;
    if tables != 6 {
        return Err(not_ours());
    }
    let version: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    info.newer = version > db::schema_version();
    let count = |table: &str| -> i64 { conn.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |r| r.get(0)).unwrap_or(0) };
    info.products = count("products");
    info.customers = count("customers");
    info.sales = count("sales");
    info.users = count("users");
    info.shop_name = conn
        .query_row("SELECT value FROM settings WHERE key = 'shop_name'", [], |r| r.get::<_, String>(0))
        .optional()?
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    info.last_activity = conn
        .query_row(
            "SELECT MAX(d) FROM (SELECT MAX(created_at) AS d FROM sales UNION ALL SELECT MAX(created_at) FROM audit_log)",
            [],
            |r| r.get::<_, Option<String>>(0),
        )
        .optional()?
        .flatten();
    Ok(())
}

/// Lit une sauvegarde sans rien changer : ce qu'elle contient, ou le mot de passe qu'il faut.
pub fn inspect(conn: &Connection, src: &Path, work: &Path, password: Option<&str>) -> AppResult<BackupInfo> {
    let (plain, info) = prepare(src, work, password, stored_key(conn)?.as_ref())?;
    remove_db_files(&plain);
    Ok(info)
}

/// Paramètres propres à cet appareil, relus avant la restauration (voir `license::after_restore`).
pub const DEVICE_KEYS: &[&str] =
    &["license_file", "license_clock", "account_email", "account_store_code", "account_store_name", "auto_backup_dir", "trial_started_at"];

#[derive(Debug, Serialize)]
pub struct Restored {
    pub shop_name: Option<String>,
    /// Copie de la base remplacée (pour revenir en arrière).
    pub safety_copy: Option<String>,
    #[serde(skip)]
    pub before: HashMap<&'static str, String>,
}

/// Remplace la base de cette boutique par une sauvegarde. La base actuelle est d'abord copiée (sauf sur un
/// appareil neuf), puis remplacée en place : l'application continue sans redémarrer. Les migrations de la
/// version actuelle sont appliquées à la base restaurée. Le dossier de sauvegarde de cet appareil est gardé.
pub fn restore(conn: &mut Connection, src: &Path, work: &Path, password: Option<&str>, fresh: bool) -> AppResult<Restored> {
    let (plain, info) = prepare(src, work, password, stored_key(conn)?.as_ref())?;
    let result = (|| -> AppResult<Restored> {
        if info.needs_password {
            return invalid("Cette sauvegarde est protégée : tapez son mot de passe.");
        }
        if info.newer {
            return invalid("Cette sauvegarde a été faite avec une version plus récente de GestiMarket : mettez d'abord GestiMarket à jour sur cet appareil.");
        }
        if info.users == 0 {
            return invalid("Cette sauvegarde est vide (boutique pas encore configurée) : choisissez-en une autre.");
        }
        let mut before = HashMap::new();
        for k in DEVICE_KEYS {
            before.insert(*k, settings::get(conn, k)?);
        }
        // Copie de sécurité de la base actuelle, dans le dossier des sauvegardes de cet appareil.
        let safety_copy = if fresh {
            None
        } else {
            let dir = effective_dir(conn)?.unwrap_or_else(|| work.to_path_buf());
            let stamp = chrono::Local::now().format("%Y-%m-%d-%Hh%M%S");
            let path = dir.join(format!("{SAFETY_PREFIX}{stamp}.{}", ext(conn)?));
            backup_to(conn, &path).map_err(|e| AppError::Validation(format!("Copie de sécurité de la base actuelle impossible, rien n'a été changé : {e}")))?;
            Some(path.display().to_string())
        };
        {
            let source = Connection::open(&plain)?;
            let copy = rusqlite::backup::Backup::new(&source, conn)?;
            copy.run_to_completion(256, std::time::Duration::from_millis(5), None)?;
        }
        db::upgrade(conn)?;
        // Dossier de sauvegarde : celui de cet appareil (le chemin d'un autre PC n'existe pas forcément ici).
        settings::set(conn, "auto_backup_dir", before.get("auto_backup_dir").map(String::as_str).unwrap_or_default())?;
        settings::set(conn, "last_auto_backup", "")?;
        Ok(Restored { shop_name: info.shop_name.clone(), safety_copy, before })
    })();
    remove_db_files(&plain);
    result
}

/// Copie de sauvegarde gardée sur cet appareil (automatique ou faite avant une restauration).
#[derive(Debug, Serialize)]
pub struct BackupFile {
    pub name: String,
    pub path: String,
    pub size: u64,
    pub modified: Option<String>,
    pub protected: bool,
    /// Copie faite juste avant une restauration.
    pub safety: bool,
}

/// Copies de cet appareil, la plus récente d'abord (téléphone : seules copies accessibles sans fichier).
pub fn list(conn: &Connection) -> AppResult<Vec<BackupFile>> {
    let Some(dir) = effective_dir(conn)? else {
        return Ok(Vec::new());
    };
    let Ok(entries) = std::fs::read_dir(&dir) else {
        return Ok(Vec::new());
    };
    let mut files: Vec<BackupFile> = entries
        .filter_map(|e| e.ok())
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().into_owned();
            let safety = is_backup_name(&name, SAFETY_PREFIX);
            if !safety && !is_backup_name(&name, AUTO_PREFIX) {
                return None;
            }
            let meta = e.metadata().ok()?;
            let modified = meta
                .modified()
                .ok()
                .map(|t| chrono::DateTime::<chrono::Local>::from(t).format("%Y-%m-%d %H:%M:%S").to_string());
            Some(BackupFile {
                protected: name.ends_with(&format!(".{PROTECTED_EXT}")),
                path: e.path().display().to_string(),
                size: meta.len(),
                modified,
                safety,
                name,
            })
        })
        .collect();
    files.sort_by(|a, b| b.modified.cmp(&a.modified).then(b.name.cmp(&a.name)));
    Ok(files)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("gm-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn copie_verifiee_et_remplacee() {
        let conn = db::open_in_memory().unwrap();
        settings::set(&conn, "shop_name", "Boutique Sauvegarde").unwrap();
        let dir = temp_dir("backup-test");
        let path = dir.join("copie.db");
        backup_to(&conn, &path).unwrap();
        // Deuxième copie au même nom : remplacée, sans fichier temporaire laissé.
        backup_to(&conn, &path).unwrap();
        assert!(!dir.join("copie.db.tmp").exists());
        let copy = Connection::open(&path).unwrap();
        let name: String = copy.query_row("SELECT value FROM settings WHERE key = 'shop_name'", [], |r| r.get(0)).unwrap();
        assert_eq!(name, "Boutique Sauvegarde");
        // Fichier qui n'est pas une base : refusé par la vérification.
        let bad = dir.join("abimee.db");
        std::fs::write(&bad, b"pas une base SQLite").unwrap();
        assert!(verify(&bad).is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn sans_dossier_choisi_la_sauvegarde_est_a_signaler() {
        let conn = db::open_in_memory().unwrap();
        let s = status(&conn).unwrap();
        assert!(s.is_default);
        assert!(s.stale);
        assert!(!s.protected);
        settings::set(&conn, "last_auto_backup", &db::now()).unwrap();
        assert!(!status(&conn).unwrap().stale);
        settings::set(&conn, "last_auto_backup", "2020-01-01 08:00:00").unwrap();
        assert!(status(&conn).unwrap().stale);
    }

    /// Fichier de plusieurs morceaux (2,5 Mo) : chiffré, relu avec le bon mot de passe, refusé sinon,
    /// et refusé s'il est coupé ou modifié.
    #[test]
    fn chiffrement_par_morceaux() {
        let dir = temp_dir("chiffrement");
        let src = dir.join("clair.bin");
        let data: Vec<u8> = (0..(2 * CHUNK + CHUNK / 2)).map(|i| (i % 251) as u8).collect();
        std::fs::write(&src, &data).unwrap();
        let key = BackupKey::new("Mot-de-passe-2026").unwrap();
        assert_eq!(BackupKey::decode(&key.encode()), Some(key.clone()));
        let sealed = dir.join("protege.gmsave");
        encrypt_file(&src, &sealed, &key).unwrap();
        let bytes = std::fs::read(&sealed).unwrap();
        assert_eq!(&bytes[..8], MAGIC);
        assert_eq!(bytes.len(), HEADER_LEN + data.len() + 3 * TAG);
        let out = dir.join("relu.bin");
        assert!(matches!(decrypt_file(&sealed, &out, Some("Mot-de-passe-2026"), None).unwrap(), Opened::Ready));
        assert_eq!(std::fs::read(&out).unwrap(), data);
        // Clé gardée par la boutique : pas besoin du mot de passe.
        assert!(matches!(decrypt_file(&sealed, &out, None, Some(&key)).unwrap(), Opened::Ready));
        // Autre boutique (autre sel), sans mot de passe : il faut le taper.
        let other = BackupKey::new("Mot-de-passe-2026").unwrap();
        assert!(matches!(decrypt_file(&sealed, &out, None, Some(&other)).unwrap(), Opened::NeedsPassword));
        let wrong = decrypt_file(&sealed, &out, Some("mauvais-mot-de-passe"), None).err().unwrap().to_string();
        assert!(wrong.contains("incorrect"), "{wrong}");
        // Coupé après le premier morceau : refusé.
        let cut = dir.join("coupe.gmsave");
        std::fs::write(&cut, &bytes[..HEADER_LEN + CHUNK + TAG]).unwrap();
        assert!(decrypt_file(&cut, &out, Some("Mot-de-passe-2026"), None).is_err());
        // Un octet modifié dans le 2ᵉ morceau : refusé.
        let mut changed = bytes.clone();
        changed[HEADER_LEN + CHUNK + TAG + 10] ^= 1;
        let bad = dir.join("modifie.gmsave");
        std::fs::write(&bad, &changed).unwrap();
        assert!(decrypt_file(&bad, &out, Some("Mot-de-passe-2026"), None).is_err());
        // Fichier vide : un seul morceau (le code d'authentification).
        let empty = dir.join("vide.bin");
        std::fs::write(&empty, b"").unwrap();
        encrypt_file(&empty, &sealed, &key).unwrap();
        assert_eq!(std::fs::metadata(&sealed).unwrap().len() as usize, HEADER_LEN + TAG);
        assert!(matches!(decrypt_file(&sealed, &out, None, Some(&key)).unwrap(), Opened::Ready));
        assert!(std::fs::read(&out).unwrap().is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }

    fn shop(path: &Path, name: &str) -> Connection {
        let conn = db::open(path).unwrap();
        settings::set(&conn, "shop_name", name).unwrap();
        conn.execute(
            "INSERT INTO users (username, full_name, password_hash, role) VALUES ('admin', 'Admin', 'x', 'admin')",
            [],
        )
        .unwrap();
        conn
    }

    /// Restauration complète : sauvegarde protégée d'une boutique, puis restaurée sur un autre appareil
    /// qui a déjà sa propre base (copie de sécurité faite, dossier de sauvegarde de l'appareil gardé).
    #[test]
    fn restauration_d_une_sauvegarde_protegee() {
        let dir = temp_dir("restauration");
        let a = shop(&dir.join("a.db"), "Boutique A");
        a.execute("INSERT INTO categories (name) VALUES ('Boissons')", []).unwrap();
        set_password(&a, Some("Sauvegarde-2026")).unwrap();
        assert!(set_password(&a, Some("court")).is_err());
        let saved = dir.join("boutique-a.gmsave");
        backup_to(&a, &saved).unwrap();
        assert_eq!(&std::fs::read(&saved).unwrap()[..8], MAGIC);

        let mut b = shop(&dir.join("b.db"), "Boutique B");
        let device_dir = dir.join("copies-b");
        settings::set(&b, "auto_backup_dir", &device_dir.display().to_string()).unwrap();
        let work = dir.join("travail");
        // Autre boutique, sans le mot de passe : il faut le taper.
        let info = inspect(&b, &saved, &work, None).unwrap();
        assert!(info.protected && info.needs_password && info.shop_name.is_none());
        assert!(inspect(&b, &saved, &work, Some("faux-mot-de-passe")).is_err());
        let info = inspect(&b, &saved, &work, Some("Sauvegarde-2026")).unwrap();
        assert_eq!(info.shop_name.as_deref(), Some("Boutique A"));
        assert_eq!((info.users, info.newer), (1, false));
        assert!(restore(&mut b, &saved, &work, None, false).is_err());

        let r = restore(&mut b, &saved, &work, Some("Sauvegarde-2026"), false).unwrap();
        assert_eq!(r.shop_name.as_deref(), Some("Boutique A"));
        assert_eq!(settings::get(&b, "shop_name").unwrap(), "Boutique A");
        let cats: i64 = b.query_row("SELECT COUNT(*) FROM categories WHERE name = 'Boissons'", [], |r| r.get(0)).unwrap();
        assert_eq!(cats, 1);
        // Dossier de sauvegarde de cet appareil gardé ; la protection de la boutique restaurée aussi.
        assert_eq!(settings::get(&b, "auto_backup_dir").unwrap(), device_dir.display().to_string());
        assert!(is_protected(&b).unwrap());
        // Copie de sécurité de la base B, faite avant (non protégée : B ne l'était pas).
        let safety = PathBuf::from(r.safety_copy.unwrap());
        assert!(safety.starts_with(&device_dir) && safety.extension().unwrap() == "db");
        let old = Connection::open(&safety).unwrap();
        let name: String = old.query_row("SELECT value FROM settings WHERE key = 'shop_name'", [], |r| r.get(0)).unwrap();
        assert_eq!(name, "Boutique B");
        assert!(list(&b).unwrap().iter().any(|f| f.safety && f.path == safety.display().to_string()));
        // Rien ne reste dans le dossier de travail.
        assert!(!work.join("sauvegarde-a-restaurer.db").exists());
        // Les migrations sont à jour et la base est saine.
        let v: i64 = b.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
        assert_eq!(v, db::schema_version());
        let check: String = b.query_row("PRAGMA quick_check", [], |r| r.get(0)).unwrap();
        assert_eq!(check, "ok");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn fichiers_refuses() {
        let dir = temp_dir("refus");
        let conn = db::open_in_memory().unwrap();
        let work = dir.join("travail");
        let text = dir.join("notes.txt");
        std::fs::write(&text, b"bonjour").unwrap();
        assert!(inspect(&conn, &text, &work, None).unwrap_err().to_string().contains("pas une sauvegarde"));
        // Base SQLite qui n'est pas une base GestiMarket.
        let other = dir.join("autre.db");
        Connection::open(&other).unwrap().execute("CREATE TABLE t (x)", []).unwrap();
        assert!(inspect(&conn, &other, &work, None).unwrap_err().to_string().contains("pas une sauvegarde"));
        // Base GestiMarket d'une version plus récente : signalée, et la restauration refusée.
        let newer = dir.join("future.db");
        {
            let c = shop(&newer, "Future");
            c.execute_batch(&format!("PRAGMA user_version = {}", db::schema_version() + 1)).unwrap();
        }
        assert!(inspect(&conn, &newer, &work, None).unwrap().newer);
        let mut target = db::open_in_memory().unwrap();
        assert!(restore(&mut target, &newer, &work, None, true).unwrap_err().to_string().contains("plus récente"));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
