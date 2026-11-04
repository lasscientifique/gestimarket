//! Sauvegardes : manuelle (choix du fichier) et automatique quotidienne.
//!
//! Sans dossier choisi dans les Paramètres, la sauvegarde automatique se fait quand même, dans
//! `Documents\GestiMarket\Sauvegardes` (un sous-dossier par boutique à partir de la 2e) : une boutique
//! qui n'y a pas pensé n'est jamais sans copie. Chaque copie est vérifiée avant d'être gardée.

use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

use rusqlite::{Connection, OpenFlags};
use serde::Serialize;

use crate::db;
use crate::error::{invalid, AppError, AppResult};
use crate::services::settings;

const AUTO_PREFIX: &str = "gestimarket-auto-";

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

/// Copie cohérente de la base (fonctionne pendant l'utilisation), vérifiée avant de remplacer
/// une copie existante du même nom.
pub fn backup_to(conn: &Connection, path: &Path) -> AppResult<()> {
    if path.as_os_str().is_empty() {
        return invalid("Chemin de sauvegarde invalide.");
    }
    let mut tmp = path.as_os_str().to_owned();
    tmp.push(".tmp");
    let tmp = PathBuf::from(tmp);
    if tmp.exists() {
        std::fs::remove_file(&tmp)?;
    }
    conn.execute("VACUUM INTO ?1", [tmp.to_string_lossy().as_ref()])?;
    if let Err(e) = verify(&tmp) {
        let _ = std::fs::remove_file(&tmp);
        return Err(e);
    }
    if path.exists() {
        std::fs::remove_file(path)?;
    }
    std::fs::rename(&tmp, path)?;
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

fn auto_backup_inner(conn: &Connection, force: bool) -> AppResult<Option<PathBuf>> {
    let Some(dir) = effective_dir(conn)? else {
        return Ok(None);
    };
    let keep = settings::get_i64(conn, "auto_backup_keep")?.clamp(1, 365) as usize;
    std::fs::create_dir_all(&dir)?;
    let day = chrono::Local::now().format("%Y-%m-%d").to_string();
    let path = dir.join(format!("{AUTO_PREFIX}{day}.db"));
    if path.exists() && !force {
        return Ok(None);
    }
    backup_to(conn, &path)?;
    settings::set(conn, "last_auto_backup", &db::now())?;

    // Rotation : suppression des sauvegardes automatiques les plus anciennes.
    let mut files: Vec<PathBuf> = std::fs::read_dir(&dir)?
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| {
            p.file_name()
                .and_then(|n| n.to_str())
                .map(|n| n.starts_with(AUTO_PREFIX) && n.ends_with(".db"))
                .unwrap_or(false)
        })
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
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn copie_verifiee_et_remplacee() {
        let conn = db::open_in_memory().unwrap();
        settings::set(&conn, "shop_name", "Boutique Sauvegarde").unwrap();
        let dir = std::env::temp_dir().join(format!("gm-backup-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
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
        settings::set(&conn, "last_auto_backup", &db::now()).unwrap();
        assert!(!status(&conn).unwrap().stale);
        settings::set(&conn, "last_auto_backup", "2020-01-01 08:00:00").unwrap();
        assert!(status(&conn).unwrap().stale);
    }
}
