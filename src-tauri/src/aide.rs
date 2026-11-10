//! Aide hors ligne : vidéos d'aide et manuel PDF téléchargés une fois depuis la pré-release « aide »
//! de GitHub, dans le dossier « Aide » de la boutique. Ce poste les lit sans Internet (protocole
//! `aide://`), et, s'il est le poste serveur, les sert aux téléphones et tablettes de la boutique
//! (`/aide/<fichier>`). Seuls des noms de fichiers simples (.mp4, .pdf) sont acceptés.
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

use serde_json::{json, Value};

pub const HELP_RELEASE: &str = "https://github.com/lasscientifique/gestimarket/releases/download/aide";

/// Nom de fichier d'aide valide : lettres, chiffres, tirets, points ; vidéo ou PDF ; jamais de dossier.
pub fn valid_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 80
        && !name.starts_with('.')
        && name.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
        && (name.ends_with(".mp4") || name.ends_with(".pdf"))
}

pub fn dir_of(db_path: &Path) -> PathBuf {
    db_path.parent().map(|d| d.join("Aide")).unwrap_or_else(|| PathBuf::from("Aide"))
}

/// Fichiers d'aide déjà présents sur ce poste.
pub fn files(dir: &Path) -> Vec<String> {
    let mut out: Vec<String> = std::fs::read_dir(dir)
        .map(|it| {
            it.filter_map(|e| e.ok())
                .filter_map(|e| e.file_name().into_string().ok())
                .filter(|n| valid_name(n))
                .collect()
        })
        .unwrap_or_default();
    out.sort();
    out
}

/// Contenu d'un fichier d'aide (type et octets), s'il est présent.
pub fn read(dir: &Path, name: &str) -> Option<(&'static str, Vec<u8>)> {
    if !valid_name(name) {
        return None;
    }
    let bytes = std::fs::read(dir.join(name)).ok()?;
    let mime = if name.ends_with(".pdf") { "application/pdf" } else { "video/mp4" };
    Some((mime, bytes))
}

#[derive(Default, Clone)]
struct Progress {
    running: bool,
    done: usize,
    total: usize,
    bytes: u64,
    error: Option<String>,
}

static PROGRESS: Mutex<Option<Progress>> = Mutex::new(None);

fn progress() -> Progress {
    PROGRESS.lock().unwrap_or_else(|e| e.into_inner()).clone().unwrap_or_default()
}

fn update(f: impl FnOnce(&mut Progress)) {
    let mut g = PROGRESS.lock().unwrap_or_else(|e| e.into_inner());
    let p = g.get_or_insert_with(Progress::default);
    f(p);
}

/// État du téléchargement et fichiers présents.
pub fn status(dir: &Path) -> Value {
    let p = progress();
    let present = files(dir);
    let size: u64 = present.iter().filter_map(|n| std::fs::metadata(dir.join(n)).ok()).map(|m| m.len()).sum();
    json!({
        "files": present, "size": size, "running": p.running, "done": p.done, "total": p.total,
        "bytes": p.bytes, "error": p.error,
    })
}

/// Télécharge en arrière-plan les fichiers demandés qui manquent (un à la fois, reprise propre).
pub fn start_download(dir: PathBuf, names: Vec<String>) -> Result<(), String> {
    let names: Vec<String> = names.into_iter().filter(|n| valid_name(n)).collect();
    if names.is_empty() {
        return Err("Aucun fichier d'aide à télécharger.".into());
    }
    {
        let mut g = PROGRESS.lock().unwrap_or_else(|e| e.into_inner());
        if g.as_ref().map(|p| p.running).unwrap_or(false) {
            return Ok(());
        }
        *g = Some(Progress { running: true, done: 0, total: names.len(), bytes: 0, error: None });
    }
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    std::thread::spawn(move || {
        let agent = ureq::AgentBuilder::new().timeout_connect(Duration::from_secs(15)).timeout(Duration::from_secs(600)).build();
        let mut failed: Vec<String> = Vec::new();
        for name in &names {
            let target = dir.join(name);
            if !target.exists() {
                let part = dir.join(format!("{name}.part"));
                let result = agent.get(&format!("{HELP_RELEASE}/{name}")).call().map_err(|e| e.to_string()).and_then(|resp| {
                    let mut file = std::fs::File::create(&part).map_err(|e| e.to_string())?;
                    let n = std::io::copy(&mut resp.into_reader(), &mut file).map_err(|e| e.to_string())?;
                    drop(file);
                    std::fs::rename(&part, &target).map_err(|e| e.to_string())?;
                    Ok(n)
                });
                match result {
                    Ok(n) => update(|p| p.bytes += n),
                    Err(e) => {
                        let _ = std::fs::remove_file(&part);
                        crate::journal::error(format!("Aide hors ligne : {name} non téléchargé ({e})"));
                        failed.push(name.clone());
                    }
                }
            }
            update(|p| p.done += 1);
        }
        update(|p| {
            p.running = false;
            if !failed.is_empty() {
                p.error = Some(format!("{} fichier(s) non téléchargé(s) : vérifiez Internet, puis recommencez.", failed.len()));
            }
        });
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn noms_de_fichiers_d_aide() {
        assert!(valid_name("ecran-pos-fr.mp4"));
        assert!(valid_name("GestiMarket_manuel_en.pdf"));
        assert!(!valid_name("../gestimarket.db"));
        assert!(!valid_name("aide/ecran.mp4"));
        assert!(!valid_name(".mp4"));
        assert!(!valid_name("programme.exe"));
        assert!(!valid_name("c:\\windows\\x.pdf"));
        let dir = std::env::temp_dir().join(format!("gm-aide-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("vente-fr.mp4"), b"video").unwrap();
        std::fs::write(dir.join("notes.txt"), b"x").unwrap();
        assert_eq!(files(&dir), vec!["vente-fr.mp4".to_string()]);
        assert_eq!(read(&dir, "vente-fr.mp4").map(|(m, b)| (m, b.len())), Some(("video/mp4", 5)));
        assert!(read(&dir, "../vente-fr.mp4").is_none());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
