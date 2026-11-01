//! Sauvegardes : manuelle (choix du fichier) et automatique quotidienne (dossier configuré).

use std::path::{Path, PathBuf};

use rusqlite::Connection;

use crate::db;
use crate::error::{invalid, AppResult};
use crate::services::settings;

const AUTO_PREFIX: &str = "gestimarket-auto-";

/// Copie cohérente de la base (fonctionne pendant l'utilisation).
pub fn backup_to(conn: &Connection, path: &Path) -> AppResult<()> {
    if path.as_os_str().is_empty() {
        return invalid("Chemin de sauvegarde invalide.");
    }
    if path.exists() {
        std::fs::remove_file(path)?;
    }
    conn.execute("VACUUM INTO ?1", [path.to_string_lossy().as_ref()])?;
    Ok(())
}

/// Sauvegarde automatique : une copie par jour dans le dossier configuré,
/// en ne conservant que les N plus récentes. Retourne le fichier créé, s'il y en a un.
pub fn auto_backup(conn: &Connection, force: bool) -> AppResult<Option<PathBuf>> {
    let dir = settings::get(conn, "auto_backup_dir")?;
    if dir.trim().is_empty() {
        return Ok(None);
    }
    let keep = settings::get_i64(conn, "auto_backup_keep")?.clamp(1, 365) as usize;
    let dir = PathBuf::from(dir.trim());
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
