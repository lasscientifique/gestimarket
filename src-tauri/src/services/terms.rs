//! Conditions générales d'utilisation, contrat de licence et politique de données personnelles
//! (textes dans `docs/conditions`) : version acceptée par la boutique, date et administrateur.
//!
//! L'administrateur les accepte à la première configuration ; quand leur version change (mise à jour de
//! GestiMarket), il les accepte de nouveau à sa connexion. Les autres comptes ne sont jamais bloqués.

use rusqlite::Connection;
use serde::Serialize;

use crate::db;
use crate::error::{invalid, AppResult};
use crate::services::settings;

/// Version des textes livrés avec cette version de GestiMarket (à changer avec les textes).
pub const TERMS_VERSION: &str = "2026-11";

#[derive(Debug, Serialize)]
pub struct TermsStatus {
    /// Version des textes de cette version de GestiMarket.
    pub current: &'static str,
    /// Version acceptée par la boutique (aucune : jamais acceptée).
    pub accepted: Option<String>,
    pub accepted_at: Option<String>,
    pub accepted_by: Option<String>,
    /// La version acceptée est la version actuelle.
    pub up_to_date: bool,
}

fn opt(conn: &Connection, key: &str) -> AppResult<Option<String>> {
    let v = settings::get(conn, key)?;
    Ok(if v.trim().is_empty() { None } else { Some(v) })
}

pub fn status(conn: &Connection) -> AppResult<TermsStatus> {
    let accepted = opt(conn, "terms_version")?;
    Ok(TermsStatus {
        current: TERMS_VERSION,
        up_to_date: accepted.as_deref() == Some(TERMS_VERSION),
        accepted,
        accepted_at: opt(conn, "terms_accepted_at")?,
        accepted_by: opt(conn, "terms_accepted_by")?,
    })
}

/// Acceptation des textes de cette version, au nom de la boutique, par son administrateur.
pub fn accept(conn: &Connection, version: &str, by: &str) -> AppResult<TermsStatus> {
    if version.trim() != TERMS_VERSION {
        return invalid("Ces conditions ne sont plus les dernières : rechargez la page, puis acceptez-les de nouveau.");
    }
    settings::set(conn, "terms_version", TERMS_VERSION)?;
    settings::set(conn, "terms_accepted_at", &db::now())?;
    settings::set(conn, "terms_accepted_by", by.trim())?;
    status(conn)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn acceptation_des_conditions() {
        let conn = db::open_in_memory().unwrap();
        let s = status(&conn).unwrap();
        assert!(!s.up_to_date && s.accepted.is_none() && s.current == TERMS_VERSION);
        // Ancienne version (texte changé depuis) : refusée, il faut relire les nouvelles conditions.
        assert!(accept(&conn, "2020-01", "Admin").is_err());
        let s = accept(&conn, TERMS_VERSION, " Awa Traoré ").unwrap();
        assert!(s.up_to_date);
        assert_eq!(s.accepted_by.as_deref(), Some("Awa Traoré"));
        assert!(s.accepted_at.is_some());
        // Mise à jour qui change les textes : la boutique doit accepter de nouveau.
        settings::set(&conn, "terms_version", "2026-01").unwrap();
        assert!(!status(&conn).unwrap().up_to_date);
        // Ni lisibles ni modifiables par l'écran des paramètres.
        let all = settings::get_all(&conn).unwrap();
        assert!(!all.contains_key("terms_version") && !all.contains_key("terms_accepted_by"));
    }
}
