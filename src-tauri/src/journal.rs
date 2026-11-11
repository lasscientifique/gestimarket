//! Journal de GestiMarket : un fichier texte par jour (`journaux/gestimarket-AAAA-MM-JJ.log` dans le dossier
//! de la boutique), gardé 14 jours. Démarrage, erreurs internes, sauvegardes ratées, tunnel, licence…
//! Dans la version installée, rien ne s'affiche dans une console : sans ce fichier, impossible de savoir
//! ce qui s'est passé quand une boutique appelle. Paramètres → Développeur Eden Dev l'envoie à Eden Dev.

use std::collections::HashMap;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

const KEEP_DAYS: i64 = 14;
const PREFIX: &str = "gestimarket-";

static DIR: OnceLock<PathBuf> = OnceLock::new();
static WRITE: Mutex<()> = Mutex::new(());
/// Dernier état des tâches répétées (tunnel, publication, licence) : seuls les changements sont écrits.
static STATES: OnceLock<Mutex<HashMap<String, Option<String>>>> = OnceLock::new();

/// À appeler au démarrage : dossier du journal, ménage des vieux fichiers, erreurs internes (panic) tracées.
pub fn init(dir: PathBuf) {
    let _ = std::fs::create_dir_all(&dir);
    let _ = DIR.set(dir.clone());
    prune(&dir, chrono::Local::now().date_naive());
    let default_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        error(format!("Erreur interne : {info}"));
        default_hook(info);
    }));
}

fn write(level: &str, msg: &str) {
    eprintln!("[{level}] {msg}");
    let Some(dir) = DIR.get() else { return };
    let now = chrono::Local::now();
    let path = dir.join(format!("{PREFIX}{}.log", now.format("%Y-%m-%d")));
    let _guard = WRITE.lock().unwrap_or_else(|e| e.into_inner());
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(f, "{} [{level}] {}", now.format("%Y-%m-%d %H:%M:%S"), msg.replace(['\r', '\n'], " | "));
    }
}

pub fn info(msg: impl AsRef<str>) {
    write("INFO", msg.as_ref());
}

pub fn error(msg: impl AsRef<str>) {
    write("ERREUR", msg.as_ref());
}

/// Tâche répétée (toutes les 30 s, toutes les heures…) : l'erreur n'est écrite que si elle change,
/// et le retour à la normale est noté une fois.
pub fn state(task: &str, result: Result<(), &str>) {
    let states = STATES.get_or_init(|| Mutex::new(HashMap::new()));
    let mut map = states.lock().unwrap_or_else(|e| e.into_inner());
    let previous = map.get(task).cloned().flatten();
    match result {
        Err(msg) if previous.as_deref() != Some(msg) => {
            map.insert(task.to_string(), Some(msg.to_string()));
            drop(map);
            error(format!("{task} : {msg}"));
        }
        Ok(()) if previous.is_some() => {
            map.insert(task.to_string(), None);
            drop(map);
            info(format!("{task} : rétabli"));
        }
        _ => {}
    }
}

/// Supprime les journaux de plus de 14 jours.
fn prune(dir: &Path, today: chrono::NaiveDate) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for e in entries.flatten() {
        let name = e.file_name().to_string_lossy().to_string();
        let Some(day) = name.strip_prefix(PREFIX).and_then(|n| n.strip_suffix(".log")) else { continue };
        if let Ok(d) = chrono::NaiveDate::parse_from_str(day, "%Y-%m-%d") {
            if (today - d).num_days() > KEEP_DAYS {
                let _ = std::fs::remove_file(e.path());
            }
        }
    }
}

/// Fichiers du journal, du plus ancien au plus récent.
fn files(dir: &Path) -> Vec<PathBuf> {
    let mut files: Vec<PathBuf> = std::fs::read_dir(dir)
        .map(|r| {
            r.flatten()
                .map(|e| e.path())
                .filter(|p| {
                    p.file_name().and_then(|n| n.to_str()).is_some_and(|n| n.starts_with(PREFIX) && n.ends_with(".log"))
                })
                .collect()
        })
        .unwrap_or_default();
    files.sort();
    files
}

/// Les `max` dernières lignes du journal (tous jours confondus).
pub fn tail(max: usize) -> String {
    let Some(dir) = DIR.get() else { return String::new() };
    tail_in(dir, max)
}

fn tail_in(dir: &Path, max: usize) -> String {
    let mut lines: Vec<String> = Vec::new();
    for f in files(dir).iter().rev() {
        let text = std::fs::read_to_string(f).unwrap_or_default();
        let mut day: Vec<String> = text.lines().map(String::from).collect();
        day.append(&mut lines);
        lines = day;
        if lines.len() >= max {
            break;
        }
    }
    let start = lines.len().saturating_sub(max);
    lines[start..].join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn menage_et_dernieres_lignes() {
        let dir = std::env::temp_dir().join(format!("gm-journal-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("gestimarket-2026-10-01.log"), "vieux\n").unwrap();
        std::fs::write(dir.join("gestimarket-2026-11-03.log"), "a\nb\n").unwrap();
        std::fs::write(dir.join("gestimarket-2026-11-04.log"), "c\nd\n").unwrap();
        std::fs::write(dir.join("autre.txt"), "x").unwrap();
        prune(&dir, chrono::NaiveDate::from_ymd_opt(2026, 11, 4).unwrap());
        assert!(!dir.join("gestimarket-2026-10-01.log").exists());
        assert!(dir.join("autre.txt").exists());
        assert_eq!(tail_in(&dir, 3), "b\nc\nd");
        assert_eq!(tail_in(&dir, 10), "a\nb\nc\nd");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
