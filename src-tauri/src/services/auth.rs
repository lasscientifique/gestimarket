use argon2::password_hash::rand_core::OsRng;
use argon2::password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString};
use argon2::Argon2;
use rusqlite::{params, Connection, OptionalExtension};
use serde::Deserialize;

use crate::db;
use crate::error::{invalid, AppError, AppResult};
use crate::services::{audit, settings};
use crate::state::SessionUser;

pub const MIN_PASSWORD_LEN: usize = 6;

pub fn hash_password(password: &str) -> AppResult<String> {
    let salt = SaltString::generate(&mut OsRng);
    Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map(|h| h.to_string())
        .map_err(|e| AppError::Internal(format!("hachage du mot de passe : {e}")))
}

pub fn verify_password(password: &str, hash: &str) -> bool {
    PasswordHash::new(hash)
        .map(|parsed| Argon2::default().verify_password(password.as_bytes(), &parsed).is_ok())
        .unwrap_or(false)
}

pub fn validate_password(password: &str) -> AppResult<()> {
    if password.chars().count() < MIN_PASSWORD_LEN {
        return invalid(format!(
            "Le mot de passe doit contenir au moins {MIN_PASSWORD_LEN} caractères."
        ));
    }
    Ok(())
}

pub fn validate_username(username: &str) -> AppResult<String> {
    let u = username.trim().to_lowercase();
    if u.len() < 3 || !u.chars().all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '_' || c == '-') {
        return invalid(
            "Identifiant invalide : au moins 3 caractères, lettres sans accent, chiffres, « . », « _ » ou « - ».",
        );
    }
    Ok(u)
}

pub fn needs_setup(conn: &Connection) -> AppResult<bool> {
    let count: i64 = conn.query_row("SELECT COUNT(*) FROM users", [], |r| r.get(0))?;
    Ok(count == 0)
}

#[derive(Debug, Deserialize)]
pub struct SetupInput {
    pub shop_name: String,
    pub shop_phone: Option<String>,
    pub shop_address: Option<String>,
    pub currency_symbol: String,
    pub currency_decimals: i64,
    pub full_name: String,
    pub username: String,
    pub password: String,
}

/// Premier démarrage : crée le compte administrateur et les paramètres du commerce.
pub fn initial_setup(conn: &mut Connection, input: SetupInput) -> AppResult<SessionUser> {
    if !needs_setup(conn)? {
        return invalid("L'application est déjà configurée.");
    }
    if input.shop_name.trim().is_empty() {
        return invalid("Le nom du commerce est obligatoire.");
    }
    if input.full_name.trim().is_empty() {
        return invalid("Le nom complet est obligatoire.");
    }
    if input.currency_symbol.trim().is_empty() {
        return invalid("Le symbole de la devise est obligatoire.");
    }
    if !(0..=3).contains(&input.currency_decimals) {
        return invalid("Le nombre de décimales doit être compris entre 0 et 3.");
    }
    let username = validate_username(&input.username)?;
    validate_password(&input.password)?;
    let hash = hash_password(&input.password)?;

    let tx = conn.transaction()?;
    tx.execute(
        "INSERT INTO users (username, full_name, password_hash, role, created_at) VALUES (?1, ?2, ?3, 'admin', ?4)",
        params![username, input.full_name.trim(), hash, db::now()],
    )?;
    let user = SessionUser {
        id: tx.last_insert_rowid(),
        username,
        full_name: input.full_name.trim().to_string(),
        role: "admin".into(),
        has_pin: false,
    };
    settings::set(&tx, "shop_name", input.shop_name.trim())?;
    settings::set(&tx, "currency_symbol", input.currency_symbol.trim())?;
    settings::set(&tx, "currency_decimals", &input.currency_decimals.to_string())?;
    if let Some(phone) = db::clean(&input.shop_phone) {
        settings::set(&tx, "shop_phone", &phone)?;
    }
    if let Some(address) = db::clean(&input.shop_address) {
        settings::set(&tx, "shop_address", &address)?;
    }
    audit::log(&tx, &user, "Configuration initiale", "settings", None, "Création du compte administrateur")?;
    tx.commit()?;
    Ok(user)
}

pub fn login(conn: &Connection, username: &str, password: &str) -> AppResult<SessionUser> {
    let row: Option<(i64, String, String, String, String, bool, bool)> = conn
        .query_row(
            "SELECT id, username, full_name, role, password_hash, active, pin_hash IS NOT NULL FROM users WHERE username = ?1",
            [username.trim()],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?)),
        )
        .optional()?;

    let bad = || invalid("Identifiant ou mot de passe incorrect.");
    let Some((id, username, full_name, role, hash, active, has_pin)) = row else {
        return bad();
    };
    if !verify_password(password, &hash) {
        return bad();
    }
    if !active {
        return invalid("Ce compte est désactivé. Contactez l'administrateur.");
    }
    conn.execute("UPDATE users SET last_login_at = ?1 WHERE id = ?2", params![db::now(), id])?;
    let user = SessionUser { id, username, full_name, role, has_pin };
    audit::log(conn, &user, "Connexion", "user", Some(id), "")?;
    Ok(user)
}

pub fn change_password(
    conn: &Connection,
    user: &SessionUser,
    current: &str,
    new_password: &str,
) -> AppResult<()> {
    let hash: String =
        conn.query_row("SELECT password_hash FROM users WHERE id = ?1", [user.id], |r| r.get(0))?;
    if !verify_password(current, &hash) {
        return invalid("Le mot de passe actuel est incorrect.");
    }
    validate_password(new_password)?;
    conn.execute(
        "UPDATE users SET password_hash = ?1 WHERE id = ?2",
        params![hash_password(new_password)?, user.id],
    )?;
    audit::log(conn, user, "Changement de mot de passe", "user", Some(user.id), "")?;
    Ok(())
}

// ───────────────────────────── Code PIN ─────────────────────────────

pub fn validate_pin(pin: &str) -> AppResult<()> {
    if !(4..=6).contains(&pin.len()) || !pin.chars().all(|c| c.is_ascii_digit()) {
        return invalid("Le code PIN doit contenir 4 à 6 chiffres.");
    }
    if pin.chars().all(|c| Some(c) == pin.chars().next()) || "0123456789".contains(pin) || "9876543210".contains(pin) {
        return invalid("Code PIN trop simple (évitez 1111, 1234…).");
    }
    Ok(())
}

/// Définit le code PIN de l'utilisateur connecté (son mot de passe est demandé pour confirmer).
pub fn set_own_pin(conn: &Connection, user: &SessionUser, password: &str, pin: &str) -> AppResult<()> {
    let hash: String = conn.query_row("SELECT password_hash FROM users WHERE id = ?1", [user.id], |r| r.get(0))?;
    if !verify_password(password, &hash) {
        return invalid("Mot de passe incorrect.");
    }
    validate_pin(pin)?;
    conn.execute("UPDATE users SET pin_hash = ?1 WHERE id = ?2", params![hash_password(pin)?, user.id])?;
    audit::log(conn, user, "Définition du code PIN", "user", Some(user.id), "")?;
    Ok(())
}

#[derive(Debug, serde::Serialize)]
pub struct LoginUser {
    pub id: i64,
    pub username: String,
    pub full_name: String,
    pub role: String,
    pub has_pin: bool,
}

/// Comptes actifs affichés sur l'écran de connexion rapide (nom et rôle uniquement).
pub fn login_users(conn: &Connection) -> AppResult<Vec<LoginUser>> {
    let mut stmt = conn.prepare(
        "SELECT id, username, full_name, role, pin_hash IS NOT NULL FROM users WHERE active = 1
         ORDER BY CASE role WHEN 'cashier' THEN 0 WHEN 'manager' THEN 1 ELSE 2 END, full_name COLLATE NOCASE",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(LoginUser { id: r.get(0)?, username: r.get(1)?, full_name: r.get(2)?, role: r.get(3)?, has_pin: r.get(4)? })
    })?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

/// Connexion rapide par code PIN.
pub fn login_pin(conn: &Connection, user_id: i64, pin: &str) -> AppResult<Option<SessionUser>> {
    let row: Option<(String, String, String, Option<String>, bool)> = conn
        .query_row(
            "SELECT username, full_name, role, pin_hash, active FROM users WHERE id = ?1",
            [user_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
        )
        .optional()?;
    let Some((username, full_name, role, Some(hash), true)) = row else {
        return invalid("Ce compte n'a pas de code PIN : connectez-vous avec le mot de passe.");
    };
    if !verify_password(pin, &hash) {
        return Ok(None);
    }
    conn.execute("UPDATE users SET last_login_at = ?1 WHERE id = ?2", params![db::now(), user_id])?;
    let user = SessionUser { id: user_id, username, full_name, role, has_pin: true };
    audit::log(conn, &user, "Connexion par PIN", "user", Some(user_id), "")?;
    Ok(Some(user))
}

/// Trouve l'utilisateur autorisant une action : l'utilisateur connecté si son PIN est saisi
/// et que son rôle suffit, sinon un responsable (rôle suffisant) dont c'est le PIN.
pub fn pin_approver(conn: &Connection, current: &SessionUser, pin: &str, min_level: u8) -> AppResult<Option<SessionUser>> {
    let mut stmt = conn.prepare(
        "SELECT id, username, full_name, role, pin_hash FROM users WHERE active = 1 AND pin_hash IS NOT NULL
         ORDER BY id = ?1 DESC",
    )?;
    let rows = stmt
        .query_map([current.id], |r| {
            Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?, r.get::<_, String>(3)?, r.get::<_, String>(4)?))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    for (id, username, full_name, role, hash) in rows {
        if crate::state::role_level(&role) >= min_level && verify_password(pin, &hash) {
            return Ok(Some(SessionUser { id, username, full_name, role, has_pin: true }));
        }
    }
    Ok(None)
}
