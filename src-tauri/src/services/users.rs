//! Personnel de la boutique, géré par l'administrateur : identifiant, rôle, code PIN, blocage,
//! accès Internet et suppression (un compte qui a travaillé reste dans l'historique).

use rusqlite::{params, Connection, OptionalExtension};
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
    /// Accès depuis Internet autorisé par l'administrateur.
    pub internet_access: bool,
    /// Téléphones autorisés pour cette personne (code d'accès).
    pub devices: i64,
}

#[derive(Debug, Default, Deserialize)]
pub struct UserInput {
    pub username: Option<String>,
    pub full_name: String,
    pub role: String,
    pub active: Option<bool>,
    /// PIN : obligatoire à la création ; à la modification, seulement pour le changer.
    #[serde(default)]
    pub pin: Option<String>,
    #[serde(default)]
    pub internet_access: Option<bool>,
}

pub fn list(conn: &Connection) -> AppResult<Vec<User>> {
    let mut stmt = conn.prepare(
        "SELECT u.id, u.username, u.full_name, u.role, u.active, u.created_at, u.last_login_at, u.pin_hash IS NOT NULL, u.internet_access,
                (SELECT COUNT(*) FROM trusted_devices d WHERE d.user_id = u.id AND d.revoked_at IS NULL)
         FROM users u WHERE u.deleted_at IS NULL
         ORDER BY u.active DESC, CASE u.role WHEN 'admin' THEN 0 WHEN 'manager' THEN 1 ELSE 2 END, u.full_name COLLATE NOCASE",
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
            internet_access: r.get(8)?,
            devices: r.get(9)?,
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

/// Identifiant libre (y compris parmi les comptes supprimés, renommés avec « ~ »).
fn check_free(conn: &Connection, username: &str, except: i64) -> AppResult<()> {
    let taken: Option<i64> = conn
        .query_row("SELECT id FROM users WHERE username = ?1 AND id <> ?2", params![username, except], |r| r.get(0))
        .optional()?;
    if taken.is_some() {
        return invalid(format!("L'identifiant « {username} » est déjà utilisé."));
    }
    Ok(())
}

/// Identifiant proposé pour un nouveau poste : gestionnaire, gestionnaire2… ; caisse1, caisse2…
pub fn next_username(conn: &Connection, role: &str) -> AppResult<String> {
    let base = match role {
        "admin" => "admin",
        "manager" => "gestionnaire",
        _ => "caisse",
    };
    for n in 1.. {
        let candidate = if n == 1 && role != "cashier" { base.to_string() } else { format!("{base}{n}") };
        let taken: i64 = conn.query_row("SELECT COUNT(*) FROM users WHERE username = ?1", [&candidate], |r| r.get(0))?;
        if taken == 0 {
            return Ok(candidate);
        }
    }
    unreachable!()
}

fn active_admins(conn: &Connection) -> AppResult<i64> {
    Ok(conn.query_row("SELECT COUNT(*) FROM users WHERE role = 'admin' AND active = 1 AND deleted_at IS NULL", [], |r| r.get(0))?)
}

pub fn create(conn: &Connection, actor: &SessionUser, input: UserInput) -> AppResult<i64> {
    let username = auth::validate_username(input.username.as_deref().unwrap_or(""))?;
    if input.full_name.trim().is_empty() {
        return invalid("Le nom est obligatoire.");
    }
    validate_role(&input.role)?;
    check_free(conn, &username, 0)?;
    let pin = input.pin.as_deref().map(str::trim).unwrap_or_default();
    auth::validate_pin(pin, &input.role)?;
    let internet = input.internet_access.unwrap_or(input.role == "admin");
    conn.execute(
        "INSERT INTO users (username, full_name, password_hash, pin_hash, role, active, created_at, internet_access)
         VALUES (?1, ?2, '', ?3, ?4, ?5, ?6, ?7)",
        params![username, input.full_name.trim(), auth::hash_password(pin)?, input.role, input.active.unwrap_or(true), db::now(), internet],
    )?;
    let id = conn.last_insert_rowid();
    audit::log(conn, actor, "Création d'un poste du personnel", "user", Some(id), format!("{username} ({})", input.role))?;
    Ok(id)
}

/// Modifie un compte. Retourne vrai si la personne doit être déconnectée (bloquée, rôle changé).
pub fn update(conn: &Connection, actor: &SessionUser, id: i64, input: UserInput) -> AppResult<bool> {
    if input.full_name.trim().is_empty() {
        return invalid("Le nom est obligatoire.");
    }
    validate_role(&input.role)?;
    let active = input.active.unwrap_or(true);
    if id == actor.id && (!active || input.role != "admin") {
        return invalid("Vous ne pouvez pas bloquer votre propre compte ni retirer votre rôle d'administrateur.");
    }
    let (current_role, current_active, current_name, current_internet): (String, bool, String, bool) = conn
        .query_row("SELECT role, active, username, internet_access FROM users WHERE id = ?1 AND deleted_at IS NULL", [id], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))
        })
        .optional()?
        .ok_or_else(|| crate::error::AppError::Validation("Compte introuvable.".into()))?;
    if current_role == "admin" && current_active && (input.role != "admin" || !active) && active_admins(conn)? <= 1 {
        return invalid("Il doit rester au moins un administrateur actif.");
    }
    let username = match input.username.as_deref().filter(|u| !u.trim().is_empty()) {
        Some(u) => {
            let u = auth::validate_username(u)?;
            check_free(conn, &u, id)?;
            u
        }
        None => current_name,
    };
    let pin = input.pin.as_deref().map(str::trim).filter(|p| !p.is_empty());
    // Devenir administrateur : un PIN de 6 chiffres est exigé.
    if input.role == "admin" && current_role != "admin" && pin.is_none() {
        return invalid("Un administrateur a un code PIN de 6 chiffres : donnez-lui un nouveau PIN.");
    }
    if let Some(p) = pin {
        auth::validate_pin(p, &input.role)?;
        conn.execute("UPDATE users SET pin_hash = ?1 WHERE id = ?2", params![auth::hash_password(p)?, id])?;
    }
    let internet = input.internet_access.unwrap_or(current_internet);
    conn.execute(
        "UPDATE users SET username = ?1, full_name = ?2, role = ?3, active = ?4, internet_access = ?5 WHERE id = ?6",
        params![username, input.full_name.trim(), input.role, active, internet, id],
    )?;
    audit::log(
        conn,
        actor,
        "Modification d'un poste du personnel",
        "user",
        Some(id),
        format!(
            "{username} : rôle={}, {}, Internet={}{}",
            input.role,
            if active { "actif" } else { "bloqué" },
            if internet { "oui" } else { "non" },
            if pin.is_some() { ", nouveau PIN" } else { "" }
        ),
    )?;
    Ok(!active || input.role != current_role)
}

/// Donne un nouveau code PIN à une personne (administrateur).
pub fn reset_pin(conn: &Connection, actor: &SessionUser, id: i64, pin: &str) -> AppResult<()> {
    let role: String = conn
        .query_row("SELECT role FROM users WHERE id = ?1 AND deleted_at IS NULL", [id], |r| r.get(0))
        .optional()?
        .ok_or_else(|| crate::error::AppError::Validation("Compte introuvable.".into()))?;
    auth::validate_pin(pin, &role)?;
    conn.execute("UPDATE users SET pin_hash = ?1, password_hash = '' WHERE id = ?2", params![auth::hash_password(pin)?, id])?;
    audit::log(conn, actor, "Nouveau code PIN attribué", "user", Some(id), "")?;
    Ok(())
}

/// Supprime un compte. Sans activité, il est effacé ; sinon il quitte les listes et ne peut plus se
/// connecter, mais son nom reste dans l'historique (ventes, caisses, journal). Retourne vrai si effacé.
pub fn delete(conn: &mut Connection, actor: &SessionUser, id: i64) -> AppResult<bool> {
    if id == actor.id {
        return invalid("Vous ne pouvez pas supprimer votre propre compte.");
    }
    let (username, role, active): (String, String, bool) = conn
        .query_row("SELECT username, role, active FROM users WHERE id = ?1 AND deleted_at IS NULL", [id], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?))
        })
        .optional()?
        .ok_or_else(|| crate::error::AppError::Validation("Compte introuvable.".into()))?;
    if role == "admin" && active && active_admins(conn)? <= 1 {
        return invalid("Il doit rester au moins un administrateur actif.");
    }
    let tx = conn.transaction()?;
    tx.execute("UPDATE trusted_devices SET revoked_at = ?1 WHERE user_id = ?2 AND revoked_at IS NULL", params![db::now(), id])?;
    tx.execute("DELETE FROM access_codes WHERE user_id = ?1 AND used_at IS NULL", [id])?;
    // Effacement réel s'il ne reste aucune trace de la personne (les clés étrangères le refusent sinon).
    tx.execute_batch("SAVEPOINT effacer")?;
    let erased = tx
        .execute("DELETE FROM access_codes WHERE user_id = ?1", [id])
        .and_then(|_| tx.execute("DELETE FROM trusted_devices WHERE user_id = ?1", [id]))
        .and_then(|_| tx.execute("DELETE FROM users WHERE id = ?1", [id]));
    let erased = match erased {
        Ok(n) => {
            tx.execute_batch("RELEASE effacer")?;
            n > 0
        }
        Err(_) => {
            tx.execute_batch("ROLLBACK TO effacer; RELEASE effacer")?;
            false
        }
    };
    if !erased {
        // L'identifiant est libéré (renommé avec « ~ », caractère interdit dans un identifiant).
        tx.execute(
            "UPDATE users SET deleted_at = ?1, active = 0, internet_access = 0, pin_hash = NULL, password_hash = '',
                    username = username || '~' || id WHERE id = ?2",
            params![db::now(), id],
        )?;
    }
    audit::log(&tx, actor, "Suppression d'un poste du personnel", "user", Some(id), &username)?;
    tx.commit()?;
    Ok(erased)
}
