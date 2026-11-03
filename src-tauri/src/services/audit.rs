use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

use crate::db::{self, Query};
use crate::error::AppResult;
use crate::state::SessionUser;

#[derive(Debug, Serialize)]
pub struct AuditEntry {
    pub id: i64,
    pub username: Option<String>,
    pub action: String,
    pub entity: Option<String>,
    pub entity_id: Option<i64>,
    pub details: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Default, Deserialize)]
pub struct AuditFilter {
    pub search: Option<String>,
    pub from: Option<String>,
    pub to: Option<String>,
    pub limit: Option<i64>,
    /// Actions d'une personne seulement (« Voir ses actions » dans Personnel).
    #[serde(default)]
    pub user_id: Option<i64>,
}

/// Action sans personne connectée (téléphone autorisé ou PIN refait avec le compte boutique).
pub fn log_system(conn: &Connection, action: &str, entity: &str, entity_id: Option<i64>, details: impl AsRef<str>) -> AppResult<()> {
    conn.execute(
        "INSERT INTO audit_log (user_id, username, action, entity, entity_id, details, created_at)
         VALUES (NULL, 'compte boutique', ?1, ?2, ?3, ?4, ?5)",
        params![action, entity, entity_id, details.as_ref(), db::now()],
    )?;
    Ok(())
}

/// Enregistre une action dans le journal d'activité.
pub fn log(
    conn: &Connection,
    user: &SessionUser,
    action: &str,
    entity: &str,
    entity_id: Option<i64>,
    details: impl AsRef<str>,
) -> AppResult<()> {
    conn.execute(
        "INSERT INTO audit_log (user_id, username, action, entity, entity_id, details, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![user.id, user.username, action, entity, entity_id, details.as_ref(), db::now()],
    )?;
    Ok(())
}

pub fn list(conn: &Connection, filter: &AuditFilter) -> AppResult<Vec<AuditEntry>> {
    let mut q = Query::new(
        "SELECT id, username, action, entity, entity_id, details, created_at FROM audit_log",
    );
    if let Some(s) = db::clean(&filter.search) {
        let like = format!("%{s}%");
        q.and(
            "(action LIKE ? OR details LIKE ? OR username LIKE ?)",
            vec![db::text(&like), db::text(&like), db::text(&like)],
        );
    }
    if let Some(id) = filter.user_id {
        q.and("user_id = ?", vec![db::int(id)]);
    }
    if let Some(from) = db::clean(&filter.from) {
        q.and("created_at >= ?", vec![db::text(from)]);
    }
    if let Some(to) = db::clean(&filter.to) {
        q.and("created_at < date(?, '+1 day')", vec![db::text(to)]);
    }
    q.tail("ORDER BY id DESC LIMIT ?", vec![db::int(filter.limit.unwrap_or(500).clamp(1, 5000))]);

    let mut stmt = conn.prepare(&q.sql)?;
    let rows = stmt.query_map(q.params(), |r| {
        Ok(AuditEntry {
            id: r.get(0)?,
            username: r.get(1)?,
            action: r.get(2)?,
            entity: r.get(3)?,
            entity_id: r.get(4)?,
            details: r.get(5)?,
            created_at: r.get(6)?,
        })
    })?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}
