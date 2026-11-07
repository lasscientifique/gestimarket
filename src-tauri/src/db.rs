use std::path::Path;

use rusqlite::{types::Value, Connection, OptionalExtension};

use crate::error::AppResult;

/// Migrations appliquées dans l'ordre. `PRAGMA user_version` mémorise la dernière appliquée.
/// Pour faire évoluer le schéma : ajouter un fichier `00N_xxx.sql` à la fin de cette liste.
const MIGRATIONS: &[&str] = &[
    include_str!("../migrations/001_initial.sql"),
    include_str!("../migrations/002_media_locations_payments.sql"),
    include_str!("../migrations/003_subcategories.sql"),
    include_str!("../migrations/004_pin.sql"),
    include_str!("../migrations/005_catalog_v2.sql"),
    include_str!("../migrations/006_store_plan.sql"),
    include_str!("../migrations/007_international.sql"),
    include_str!("../migrations/008_plan_3d.sql"),
    include_str!("../migrations/009_personnel.sql"),
    include_str!("../migrations/010_retours_promotions_z.sql"),
    include_str!("../migrations/011_remises_doublons.sql"),
    include_str!("../migrations/012_compte_client_fidelite.sql"),
];

pub fn open(path: &Path) -> AppResult<Connection> {
    let conn = Connection::open(path)?;
    configure(&conn)?;
    migrate(&conn)?;
    Ok(conn)
}

#[cfg(test)]
pub fn open_in_memory() -> AppResult<Connection> {
    let conn = Connection::open_in_memory()?;
    configure(&conn)?;
    migrate(&conn)?;
    Ok(conn)
}

fn configure(conn: &Connection) -> AppResult<()> {
    conn.query_row("PRAGMA journal_mode = WAL", [], |_| Ok(()))?;
    conn.execute_batch(
        "PRAGMA foreign_keys = ON;
         PRAGMA synchronous = NORMAL;
         PRAGMA busy_timeout = 5000;",
    )?;
    Ok(())
}

fn migrate(conn: &Connection) -> AppResult<()> {
    let current: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    if current >= MIGRATIONS.len() as i64 {
        return Ok(());
    }
    // Les migrations peuvent reconstruire des tables : on suspend les clés étrangères
    // (sinon un DROP TABLE déclencherait les suppressions en cascade), puis on vérifie l'intégrité.
    conn.execute_batch("PRAGMA foreign_keys = OFF")?;
    let result = (|| -> AppResult<()> {
        for (index, sql) in MIGRATIONS.iter().enumerate() {
            let version = index as i64 + 1;
            if version > current {
                let tx = conn.unchecked_transaction()?;
                tx.execute_batch(sql)?;
                let broken: i64 =
                    tx.query_row("SELECT COUNT(*) FROM pragma_foreign_key_check", [], |r| r.get(0))?;
                if broken > 0 {
                    return Err(crate::error::AppError::Internal(format!(
                        "migration {version} : {broken} référence(s) invalide(s)"
                    )));
                }
                tx.execute_batch(&format!("PRAGMA user_version = {version}"))?;
                tx.commit()?;
            }
        }
        Ok(())
    })();
    conn.execute_batch("PRAGMA foreign_keys = ON")?;
    result
}

/// Ouvre une base existante sans appliquer les migrations (tests de migration).
#[cfg(test)]
pub fn migrate_for_test(conn: &Connection) -> AppResult<()> {
    migrate(conn)
}

#[cfg(test)]
pub fn migration_sql(index: usize) -> &'static str {
    MIGRATIONS[index]
}

/// Date/heure locale au format SQLite (`YYYY-MM-DD HH:MM:SS`).
pub fn now() -> String {
    chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string()
}

/// Génère le prochain numéro de pièce du jour, ex. `V20261031-0007`.
/// `table` est toujours une constante interne (jamais une saisie utilisateur).
pub fn next_number(conn: &Connection, table: &str, prefix: &str) -> AppResult<String> {
    let day = chrono::Local::now().format("%Y%m%d").to_string();
    let base = format!("{prefix}{day}-");
    let last: Option<String> = conn
        .query_row(
            &format!("SELECT number FROM {table} WHERE number LIKE ?1 ORDER BY number DESC LIMIT 1"),
            [format!("{base}%")],
            |r| r.get(0),
        )
        .optional()?;
    let next = last
        .and_then(|n| n.rsplit('-').next().and_then(|s| s.parse::<i64>().ok()))
        .unwrap_or(0)
        + 1;
    Ok(format!("{base}{next:04}"))
}

/// Normalise une chaîne optionnelle : espaces retirés, vide => None.
pub fn clean(s: &Option<String>) -> Option<String> {
    s.as_ref()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
}

/// Arrondit une quantité à 3 décimales (évite le bruit des flottants).
pub fn round_qty(q: f64) -> f64 {
    (q * 1000.0).round() / 1000.0
}

/// Petit constructeur de requêtes avec clauses WHERE dynamiques.
pub struct Query {
    pub sql: String,
    pub params: Vec<Value>,
}

impl Query {
    pub fn new(base: &str) -> Self {
        Self { sql: format!("{base} WHERE 1 = 1"), params: Vec::new() }
    }

    /// Numérote les `?` du fragment et enregistre les valeurs associées.
    fn bind(&mut self, fragment: &str, values: Vec<Value>) -> String {
        let mut values = values.into_iter();
        let mut out = String::with_capacity(fragment.len() + 8);
        for c in fragment.chars() {
            if c == '?' {
                if let Some(v) = values.next() {
                    self.params.push(v);
                    out.push_str(&format!("?{}", self.params.len()));
                    continue;
                }
            }
            out.push(c);
        }
        debug_assert!(values.next().is_none(), "plus de valeurs que de marqueurs « ? »");
        out
    }

    /// Ajoute une condition. Utiliser `?` comme marqueur de paramètre.
    pub fn and(&mut self, clause: &str, values: Vec<Value>) -> &mut Self {
        let c = self.bind(clause, values);
        self.sql.push_str(" AND ");
        self.sql.push_str(&c);
        self
    }

    /// Ajoute une fin de requête (GROUP BY, ORDER BY, LIMIT ?...).
    pub fn tail(&mut self, sql: &str, values: Vec<Value>) -> &mut Self {
        let c = self.bind(sql, values);
        self.sql.push(' ');
        self.sql.push_str(&c);
        self
    }

    pub fn params(&self) -> rusqlite::ParamsFromIter<std::slice::Iter<'_, Value>> {
        rusqlite::params_from_iter(self.params.iter())
    }
}

pub fn text(s: impl Into<String>) -> Value {
    Value::Text(s.into())
}

pub fn int(i: i64) -> Value {
    Value::Integer(i)
}
