//! Plusieurs boutiques sur un même PC (5 au maximum).
//!
//! Chaque boutique est une instance séparée de GestiMarket, avec sa propre base, sa configuration
//! réseau et ses données de navigateur. La boutique 1 garde le dossier de données historique
//! (aucune migration pour les installations existantes) ; les boutiques 2 à 5 sont dans
//! `boutiques/<n>/`. On lance une boutique avec `gestimarket.exe --boutique <n>`.
//!
//! Une même boutique ne peut pas être ouverte deux fois : chaque instance réserve un port de
//! contrôle sur 127.0.0.1 (jamais exposé au réseau), libéré automatiquement à la fermeture.

use std::net::{SocketAddr, TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::Serialize;

pub const MAX: u8 = 5;
const GUARD_BASE: u16 = 47870;

/// Boutique de cette instance, et son verrou (tenu tant que l'application est ouverte).
pub struct Current {
    pub slot: u8,
    _guard: Option<TcpListener>,
}

#[derive(Debug, Clone, Serialize)]
pub struct BoutiqueInfo {
    pub slot: u8,
    pub name: String,
    /// Première configuration faite (nom du commerce enregistré).
    pub configured: bool,
    /// Ouverte en ce moment sur ce PC.
    pub open: bool,
    /// C'est la boutique de cette fenêtre.
    pub current: bool,
}

/// Numéro de boutique demandé sur la ligne de commande (`--boutique 3` ou `--boutique=3`), 1 par défaut.
pub fn slot_from_args<I: IntoIterator<Item = String>>(args: I) -> u8 {
    let args: Vec<String> = args.into_iter().collect();
    let mut value = None;
    for (i, a) in args.iter().enumerate() {
        if let Some(v) = a.strip_prefix("--boutique=") {
            value = Some(v.to_string());
        } else if a == "--boutique" {
            value = args.get(i + 1).cloned();
        }
    }
    value.and_then(|v| v.trim().parse::<u8>().ok()).filter(|n| (1..=MAX).contains(n)).unwrap_or(1)
}

/// Dossier de données d'une boutique.
pub fn data_dir(root: &Path, slot: u8) -> PathBuf {
    if slot <= 1 {
        root.to_path_buf()
    } else {
        root.join("boutiques").join(slot.to_string())
    }
}

/// Port réseau par défaut d'une boutique (http ; https = port + 1), pour que deux boutiques
/// en mode serveur sur le même PC n'entrent pas en conflit : 7878, 7888, 7898…
pub fn default_port(slot: u8) -> u16 {
    7878 + (slot.max(1) as u16 - 1) * 10
}

fn guard_addr(slot: u8) -> SocketAddr {
    SocketAddr::from(([127, 0, 0, 1], GUARD_BASE + slot as u16))
}

/// Réserve la boutique pour cette instance. `None` si elle est déjà ouverte.
pub fn acquire(slot: u8) -> Option<Current> {
    TcpListener::bind(guard_addr(slot)).ok().map(|l| Current { slot, _guard: Some(l) })
}

/// Téléphone et tablette : une seule boutique, sans verrou (le système n'ouvre l'application qu'une fois,
/// et une application rouverte dans le même processus ne doit pas se croire déjà ouverte).
#[cfg_attr(not(mobile), allow(dead_code))]
pub fn single() -> Current {
    Current { slot: 1, _guard: None }
}

pub fn is_open(slot: u8) -> bool {
    TcpStream::connect_timeout(&guard_addr(slot), Duration::from_millis(300)).is_ok()
}

/// Nom du commerce lu dans la base d'une boutique (lecture seule, sans gêner l'instance qui l'utilise).
fn shop_name(db: &Path) -> Option<String> {
    if !db.exists() {
        return None;
    }
    let conn = rusqlite::Connection::open_with_flags(db, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY).ok()?;
    conn.query_row("SELECT value FROM settings WHERE key = 'shop_name'", [], |r| r.get::<_, String>(0))
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

/// Boutiques existantes sur ce PC (la boutique 1 existe toujours).
pub fn list(root: &Path, current: u8) -> Vec<BoutiqueInfo> {
    (1..=MAX)
        .filter(|&slot| slot == 1 || data_dir(root, slot).exists())
        .map(|slot| {
            let name = shop_name(&data_dir(root, slot).join("gestimarket.db"));
            BoutiqueInfo {
                slot,
                configured: name.is_some(),
                name: name.unwrap_or_else(|| format!("Boutique {slot} (à configurer)")),
                open: slot == current || is_open(slot),
                current: slot == current,
            }
        })
        .collect()
}

/// Premier numéro libre (2 à 5), ou `None` si les 5 boutiques existent.
pub fn next_free(root: &Path) -> Option<u8> {
    (2..=MAX).find(|&slot| !data_dir(root, slot).exists())
}

/// Lance une boutique dans une nouvelle fenêtre (nouveau processus).
pub fn launch(slot: u8) -> std::io::Result<()> {
    let exe = std::env::current_exe()?;
    std::process::Command::new(exe).arg("--boutique").arg(slot.to_string()).spawn()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(v: &[&str]) -> Vec<String> {
        v.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn slot_parsing() {
        assert_eq!(slot_from_args(args(&["gestimarket"])), 1);
        assert_eq!(slot_from_args(args(&["gestimarket", "--boutique", "3"])), 3);
        assert_eq!(slot_from_args(args(&["gestimarket", "--boutique=5"])), 5);
        assert_eq!(slot_from_args(args(&["gestimarket", "--boutique", "6"])), 1);
        assert_eq!(slot_from_args(args(&["gestimarket", "--boutique", "0"])), 1);
        assert_eq!(slot_from_args(args(&["gestimarket", "--boutique"])), 1);
    }

    #[test]
    fn dirs_and_ports() {
        let root = Path::new("/data");
        assert_eq!(data_dir(root, 1), PathBuf::from("/data"));
        assert_eq!(data_dir(root, 2), Path::new("/data").join("boutiques").join("2"));
        assert_eq!(default_port(1), 7878);
        assert_eq!(default_port(2), 7888);
        assert_eq!(default_port(5), 7918);
    }

    #[test]
    fn list_and_next_free() {
        let root = std::env::temp_dir().join(format!("gm-boutiques-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        assert_eq!(next_free(&root), Some(2));
        std::fs::create_dir_all(data_dir(&root, 2)).unwrap();
        std::fs::create_dir_all(data_dir(&root, 4)).unwrap();
        assert_eq!(next_free(&root), Some(3));
        let l = list(&root, 2);
        assert_eq!(l.iter().map(|b| b.slot).collect::<Vec<_>>(), vec![1, 2, 4]);
        assert!(l.iter().find(|b| b.slot == 2).unwrap().current);
        assert!(!l[0].configured);
        let _ = std::fs::remove_dir_all(&root);
    }
}
