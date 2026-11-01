use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

use crate::db;
use crate::error::{invalid, AppResult};
use crate::services::{audit, auth};
use crate::state::SessionUser;

pub const ROLES: &[&str] = &["admin", "manager", "cashier"];

#[derive(Debug, Serialize)]
pub struct User {
    pub id: i64,
    pub username: String,
    pub full_name: String,
    pub role: String,
    pub active: bool,
    pub created_at: String,
    pub last_login_at: Option<String>,
    pub has_pin: bool,
}

#[derive(Debug, Deserialize)]
pub struct UserInput {
    pub username: Option<String>,
    pub full_name: String,
    pub role: String,
    pub active: Option<bool>,
    pub password: Option<String>,
}

pub fn list(conn: &Connection) -> AppResult<Vec<User>> {
    let mut stmt = conn.prepare(
        "SELECT id, username, full_name, role, active, created_at, last_login_at, pin_hash IS NOT NULL
         FROM users ORDER BY active DESC, full_name COLLATE NOCASE",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(User {
            id: r.get(0)?,
            username: r.get(1)?,
            full_name: r.get(2)?,
            role: r.get(3)?,
            active: r.get(4)?,
            created_at: r.get(5)?,
            last_login_at: r.get(6)?,
            has_pin: r.get(7)?,
        })
    })?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

fn validate_role(role: &str) -> AppResult<()> {
    if !ROLES.contains(&role) {
        return invalid("Rôle invalide.");
    }
    Ok(())
}

pub fn create(conn: &Connection, actor: &SessionUser, input: UserInput) -> AppResult<i64> {
    let username = auth::validate_username(input.username.as_deref().unwrap_or(""))?;
    if input.full_name.trim().is_empty() {
        return invalid("Le nom complet est obligatoire.");
    }
    validate_role(&input.role)?;
    let password = input.password.unwrap_or_default();
    auth::validate_password(&password)?;
    conn.execute(
        "INSERT INTO users (username, full_name, password_hash, role, active, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![
            username,
            input.full_name.trim(),
            auth::hash_password(&password)?,
            input.role,
            input.active.unwrap_or(true),
            db::now()
        ],
    )?;
    let id = conn.last_insert_rowid();
    audit::log(conn, actor, "Création d'utilisateur", "user", Some(id), format!("{username} ({})", input.role))?;
    Ok(id)
}

pub fn update(conn: &Connection, actor: &SessionUser, id: i64, input: UserInput) -> AppResult<()> {
    if input.full_name.trim().is_empty() {
        return invalid("Le nom complet est obligatoire.");
    }
    validate_role(&input.role)?;
    let active = input.active.unwrap_or(true);
    if id == actor.id && (!active || input.role != "admin") {
        return invalid("Vous ne pouvez pas désactiver votre propre compte ni retirer votre rôle d'administrateur.");
    }
    let (current_role, current_active): (String, bool) =
        conn.query_row("SELECT role, active FROM users WHERE id = ?1", [id], |r| Ok((r.get(0)?, r.get(1)?)))?;
    if current_role == "admin" && current_active && (input.role != "admin" || !active) {
        let admins: i64 = conn.query_row(
            "SELECT COUNT(*) FROM users WHERE role = 'admin' AND active = 1",
            [],
            |r| r.get(0),
        )?;
        if admins <= 1 {
            return invalid("Il doit rester au moins un administrateur actif.");
        }
    }
    conn.execute(
        "UPDATE users SET full_name = ?1, role = ?2, active = ?3 WHERE id = ?4",
        params![input.full_name.trim(), input.role, active, id],
    )?;
    audit::log(
        conn,
        actor,
        "Modification d'utilisateur",
        "user",
        Some(id),
        format!("rôle={}, actif={}", input.role, if active { "oui" } else { "non" }),
    )?;
    Ok(())
}

/// Réinitialise le code PIN d'un utilisateur (administrateur).
pub fn reset_pin(conn: &Connection, actor: &SessionUser, id: i64, pin: &str) -> AppResult<()> {
    auth::validate_pin(pin)?;
    let n = conn.execute("UPDATE users SET pin_hash = ?1 WHERE id = ?2", params![auth::hash_password(pin)?, id])?;
    if n == 0 {
        return invalid("Utilisateur introuvable.");
    }
    audit::log(conn, actor, "Réinitialisation du code PIN", "user", Some(id), "")?;
    Ok(())
}

pub fn reset_password(conn: &Connection, actor: &SessionUser, id: i64, password: &str) -> AppResult<()> {
    auth::validate_password(password)?;
    let n = conn.execute(
        "UPDATE users SET password_hash = ?1 WHERE id = ?2",
        params![auth::hash_password(password)?, id],
    )?;
    if n == 0 {
        return invalid("Utilisateur introuvable.");
    }
    audit::log(conn, actor, "Réinitialisation de mot de passe", "user", Some(id), "")?;
    Ok(())
}
