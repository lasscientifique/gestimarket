//! Accès depuis Internet : un téléphone (ou un navigateur) doit être autorisé une fois.
//!  - par le compte boutique (e-mail et mot de passe Eden Dev) : téléphone de l'administrateur ;
//!  - par un code d'accès de 8 lettres et chiffres, généré par l'administrateur pour une personne :
//!    valable 7 jours, pour un seul téléphone, qui reste ensuite autorisé pour elle seule.
//!
//! Le jeton du téléphone (gardé par le navigateur) et les codes ne sont enregistrés que hachés.

use argon2::password_hash::rand_core::{OsRng, RngCore};
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use sha2::{Digest, Sha256};

use crate::db;
use crate::error::{invalid, AppResult};
use crate::services::audit;
use crate::state::SessionUser;

/// Lettres et chiffres sans confusion possible (ni 0/O, ni 1/I/L).
const CODE_ALPHABET: &[u8] = b"ABCDEFGHJKMNPQRSTUVWXYZ23456789";
pub const CODE_LEN: usize = 8;
const CODE_DAYS: i64 = 7;

fn sha256(text: &str) -> String {
    Sha256::digest(text.as_bytes()).iter().map(|b| format!("{b:02x}")).collect()
}

fn secret() -> String {
    let mut bytes = [0u8; 32];
    OsRng.fill_bytes(&mut bytes);
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// Code d'accès saisi : majuscules, sans espaces ni tirets.
pub fn normalize_code(code: &str) -> String {
    code.chars().filter(|c| c.is_ascii_alphanumeric()).map(|c| c.to_ascii_uppercase()).collect()
}

fn new_code() -> String {
    (0..CODE_LEN).map(|_| CODE_ALPHABET[(OsRng.next_u32() as usize) % CODE_ALPHABET.len()] as char).collect()
}

fn clean_label(label: &str) -> String {
    let l: String = label.trim().chars().take(60).collect();
    if l.is_empty() {
        "Téléphone".into()
    } else {
        l
    }
}

#[derive(Debug, Serialize)]
pub struct Device {
    pub id: i64,
    pub user_id: Option<i64>,
    /// Personne autorisée (vide : tout le personnel ayant l'accès Internet, téléphone du compte boutique).
    pub user_name: Option<String>,
    pub method: String,
    pub label: String,
    pub created_at: String,
    pub last_used_at: Option<String>,
}

/// Enregistre un téléphone autorisé ; retourne son identifiant et son jeton (à garder par le téléphone).
pub fn register(conn: &Connection, user_id: Option<i64>, method: &str, label: &str) -> AppResult<(i64, String)> {
    let token = secret();
    conn.execute(
        "INSERT INTO trusted_devices (token_hash, user_id, method, label, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![sha256(&token), user_id, method, clean_label(label), db::now()],
    )?;
    Ok((conn.last_insert_rowid(), token))
}

/// Téléphone autorisé correspondant au jeton (non retiré) : identifiant et personne éventuelle.
pub fn check(conn: &Connection, token: &str) -> AppResult<Option<(i64, Option<i64>)>> {
    if token.trim().len() < 32 {
        return Ok(None);
    }
    let found: Option<(i64, Option<i64>)> = conn
        .query_row(
            "SELECT id, user_id FROM trusted_devices WHERE token_hash = ?1 AND revoked_at IS NULL",
            [sha256(token.trim())],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()?;
    if let Some((id, _)) = found {
        conn.execute("UPDATE trusted_devices SET last_used_at = ?1 WHERE id = ?2", params![db::now(), id])?;
    }
    Ok(found)
}

/// Libellé et personne d'un téléphone autorisé (écran de connexion).
pub fn describe(conn: &Connection, token: &str) -> AppResult<Option<Device>> {
    if token.trim().len() < 32 {
        return Ok(None);
    }
    Ok(conn
        .query_row(&format!("{DEVICE_SELECT} WHERE d.token_hash = ?1 AND d.revoked_at IS NULL"), [sha256(token.trim())], device_row)
        .optional()?)
}

const DEVICE_SELECT: &str = "SELECT d.id, d.user_id, u.full_name, d.method, d.label, d.created_at, d.last_used_at
    FROM trusted_devices d LEFT JOIN users u ON u.id = d.user_id";

fn device_row(r: &rusqlite::Row) -> rusqlite::Result<Device> {
    Ok(Device {
        id: r.get(0)?,
        user_id: r.get(1)?,
        user_name: r.get(2)?,
        method: r.get(3)?,
        label: r.get(4)?,
        created_at: r.get(5)?,
        last_used_at: r.get(6)?,
    })
}

/// Téléphones autorisés (non retirés), les plus récents d'abord.
pub fn list(conn: &Connection) -> AppResult<Vec<Device>> {
    let mut stmt = conn.prepare(&format!("{DEVICE_SELECT} WHERE d.revoked_at IS NULL ORDER BY COALESCE(d.last_used_at, d.created_at) DESC"))?;
    let rows = stmt.query_map([], device_row)?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

/// Retire un téléphone : il devra être autorisé de nouveau.
pub fn revoke(conn: &Connection, actor: &SessionUser, id: i64) -> AppResult<()> {
    let label: Option<String> =
        conn.query_row("SELECT label FROM trusted_devices WHERE id = ?1 AND revoked_at IS NULL", [id], |r| r.get(0)).optional()?;
    let Some(label) = label else { return invalid("Ce téléphone est déjà retiré.") };
    conn.execute("UPDATE trusted_devices SET revoked_at = ?1 WHERE id = ?2", params![db::now(), id])?;
    audit::log(conn, actor, "Téléphone retiré de l'accès Internet", "device", Some(id), &label)?;
    Ok(())
}

#[derive(Debug, Serialize)]
pub struct AccessCode {
    pub code: String,
    pub expires_at: String,
    pub full_name: String,
    pub username: String,
}

/// Code d'accès téléphone pour une personne : son accès Internet est autorisé du même coup.
pub fn create_code(conn: &Connection, actor: &SessionUser, user_id: i64) -> AppResult<AccessCode> {
    let row: Option<(String, String, bool)> = conn
        .query_row("SELECT full_name, username, active FROM users WHERE id = ?1 AND deleted_at IS NULL", [user_id], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?))
        })
        .optional()?;
    let Some((full_name, username, active)) = row else { return invalid("Compte introuvable.") };
    if !active {
        return invalid("Ce compte est bloqué : débloquez-le d'abord.");
    }
    let code = new_code();
    let expires = (chrono::Local::now() + chrono::Duration::days(CODE_DAYS)).format("%Y-%m-%d %H:%M:%S").to_string();
    conn.execute(
        "INSERT INTO access_codes (user_id, code_hash, created_by, created_at, expires_at) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![user_id, sha256(&code), actor.id, db::now(), expires],
    )?;
    conn.execute("UPDATE users SET internet_access = 1 WHERE id = ?1", [user_id])?;
    audit::log(conn, actor, "Code d'accès téléphone généré", "user", Some(user_id), &full_name)?;
    Ok(AccessCode { code, expires_at: expires, full_name, username })
}

/// Utilise un code d'accès (une seule fois) : autorise ce téléphone pour la personne.
/// `Ok(None)` : code faux, déjà utilisé ou expiré.
pub fn use_code(conn: &Connection, user_id: i64, code: &str, label: &str) -> AppResult<Option<(i64, String)>> {
    let code = normalize_code(code);
    if code.len() != CODE_LEN {
        return Ok(None);
    }
    let found: Option<i64> = conn
        .query_row(
            "SELECT id FROM access_codes WHERE user_id = ?1 AND code_hash = ?2 AND used_at IS NULL AND expires_at > ?3",
            params![user_id, sha256(&code), db::now()],
            |r| r.get(0),
        )
        .optional()?;
    let Some(code_id) = found else { return Ok(None) };
    let (device_id, token) = register(conn, Some(user_id), "code", label)?;
    conn.execute("UPDATE access_codes SET used_at = ?1, device_id = ?2 WHERE id = ?3", params![db::now(), device_id, code_id])?;
    Ok(Some((device_id, token)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn codes_are_readable_and_normalized() {
        let c = new_code();
        assert_eq!(c.len(), CODE_LEN);
        assert!(c.bytes().all(|b| CODE_ALPHABET.contains(&b)));
        assert_eq!(normalize_code(" ab3d-ef7h "), "AB3DEF7H");
        assert_ne!(sha256("a"), sha256("b"));
    }
}
