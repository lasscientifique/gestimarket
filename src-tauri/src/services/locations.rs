//! Emplacements physiques des produits : Bloc → Étage → Rangée.
//! Permet de retrouver immédiatement où se trouve un produit dans le magasin.

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

use crate::error::{invalid, AppResult};
use crate::services::audit;
use crate::state::SessionUser;

#[derive(Debug, Serialize)]
pub struct Location {
    pub id: i64,
    pub bloc: String,
    pub etage: String,
    pub rangee: String,
    pub label: Option<String>,
    pub product_count: i64,
    pub stock_value: i64,
}

#[derive(Debug, Deserialize)]
pub struct LocationInput {
    pub bloc: String,
    pub etage: Option<String>,
    pub rangee: Option<String>,
    pub label: Option<String>,
}

/// Tri « naturel » : 2 avant 10, puis ordre alphabétique.
const ORDER: &str = "ORDER BY CAST(l.bloc AS INTEGER), l.bloc, CAST(l.etage AS INTEGER), l.etage, CAST(l.rangee AS INTEGER), l.rangee";

pub fn list(conn: &Connection) -> AppResult<Vec<Location>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT l.id, l.bloc, l.etage, l.rangee, l.label,
                (SELECT COUNT(*) FROM products p WHERE p.location_id = l.id AND p.active = 1),
                (SELECT COALESCE(CAST(ROUND(SUM(CASE WHEN p.stock > 0 THEN p.stock * p.purchase_price ELSE 0 END)) AS INTEGER), 0)
                   FROM products p WHERE p.location_id = l.id AND p.active = 1)
         FROM locations l {ORDER}"
    ))?;
    let rows = stmt.query_map([], |r| {
        Ok(Location {
            id: r.get(0)?,
            bloc: r.get(1)?,
            etage: r.get(2)?,
            rangee: r.get(3)?,
            label: r.get(4)?,
            product_count: r.get(5)?,
            stock_value: r.get(6)?,
        })
    })?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

fn norm(s: &Option<String>) -> String {
    s.as_deref().unwrap_or("").trim().to_string()
}

/// Retourne l'emplacement existant ou le crée (utilisé par l'import).
pub fn find_or_create(conn: &Connection, bloc: &str, etage: &str, rangee: &str) -> AppResult<Option<i64>> {
    let bloc_up = bloc.trim().to_uppercase();
    let (bloc, etage, rangee) = (bloc_up.as_str(), etage.trim(), rangee.trim());
    if bloc.is_empty() {
        return Ok(None);
    }
    let existing: Option<i64> = conn
        .query_row(
            "SELECT id FROM locations WHERE bloc = ?1 AND etage = ?2 AND rangee = ?3",
            params![bloc, etage, rangee],
            |r| r.get(0),
        )
        .optional()?;
    if existing.is_some() {
        return Ok(existing);
    }
    conn.execute("INSERT INTO locations (bloc, etage, rangee) VALUES (?1, ?2, ?3)", params![bloc, etage, rangee])?;
    Ok(Some(conn.last_insert_rowid()))
}

pub fn save(conn: &Connection, user: &SessionUser, id: Option<i64>, input: LocationInput) -> AppResult<i64> {
    let bloc_up = input.bloc.trim().to_uppercase();
    let bloc = bloc_up.as_str();
    if bloc.is_empty() {
        return invalid("Le bloc est obligatoire.");
    }
    let (etage, rangee) = (norm(&input.etage), norm(&input.rangee));
    let label = input.label.as_deref().map(str::trim).filter(|s| !s.is_empty());
    let dup: Option<i64> = conn
        .query_row(
            "SELECT id FROM locations WHERE bloc = ?1 AND etage = ?2 AND rangee = ?3 AND id <> ?4",
            params![bloc, etage, rangee, id.unwrap_or(0)],
            |r| r.get(0),
        )
        .optional()?;
    if dup.is_some() {
        return invalid("Cet emplacement existe déjà.");
    }
    let id = match id {
        Some(id) => {
            conn.execute(
                "UPDATE locations SET bloc = ?1, etage = ?2, rangee = ?3, label = ?4 WHERE id = ?5",
                params![bloc, etage, rangee, label, id],
            )?;
            id
        }
        None => {
            conn.execute(
                "INSERT INTO locations (bloc, etage, rangee, label) VALUES (?1, ?2, ?3, ?4)",
                params![bloc, etage, rangee, label],
            )?;
            conn.last_insert_rowid()
        }
    };
    audit::log(conn, user, "Enregistrement d'emplacement", "location", Some(id), format!("Bloc {bloc} / Étage {etage} / Rangée {rangee}"))?;
    Ok(id)
}

pub fn delete(conn: &Connection, user: &SessionUser, id: i64) -> AppResult<()> {
    conn.execute("UPDATE products SET location_id = NULL WHERE location_id = ?1", [id])?;
    let n = conn.execute("DELETE FROM locations WHERE id = ?1", [id])?;
    if n == 0 {
        return invalid("Emplacement introuvable.");
    }
    audit::log(conn, user, "Suppression d'emplacement", "location", Some(id), "")?;
    Ok(())
}

#[derive(Debug, Deserialize)]
pub struct GenerateInput {
    pub bloc: String,
    /// Dernier bloc de la série (ex. bloc « A » à « F », ou 1 à 6).
    pub bloc_to: Option<String>,
    pub etage_from: i64,
    pub etage_to: i64,
    pub rangee_from: i64,
    pub rangee_to: i64,
    pub label: Option<String>,
}

/// Liste des blocs d'une série : lettres (A → F) ou nombres (1 → 6).
pub fn bloc_series(from: &str, to: Option<&str>) -> AppResult<Vec<String>> {
    let from = from.trim().to_uppercase();
    let to = to.map(|t| t.trim().to_uppercase()).filter(|t| !t.is_empty());
    let Some(to) = to else { return Ok(vec![from]) };
    let (fc, tc) = (from.chars().collect::<Vec<_>>(), to.chars().collect::<Vec<_>>());
    if fc.len() == 1 && tc.len() == 1 && fc[0].is_ascii_alphabetic() && tc[0].is_ascii_alphabetic() {
        let (a, b) = (fc[0] as u8, tc[0] as u8);
        if a > b {
            return invalid("Le premier bloc doit précéder le dernier (ex. A à F).");
        }
        return Ok((a..=b).map(|c| (c as char).to_string()).collect());
    }
    if let (Ok(a), Ok(b)) = (from.parse::<i64>(), to.parse::<i64>()) {
        if a > b || b - a > 100 {
            return invalid("Série de blocs invalide.");
        }
        return Ok((a..=b).map(|n| n.to_string()).collect());
    }
    invalid("Série de blocs invalide : utilisez des lettres (A à F) ou des nombres (1 à 6).")
}

/// Crée en une fois toutes les combinaisons Bloc × Étage × Rangée.
pub fn generate(conn: &mut Connection, user: &SessionUser, input: GenerateInput) -> AppResult<i64> {
    if input.bloc.trim().is_empty() {
        return invalid("Le bloc est obligatoire.");
    }
    let blocs = bloc_series(&input.bloc, input.bloc_to.as_deref())?;
    if input.etage_from > input.etage_to || input.rangee_from > input.rangee_to || input.etage_from < 0 || input.rangee_from < 0 {
        return invalid("Intervalles invalides.");
    }
    let count = blocs.len() as i64 * (input.etage_to - input.etage_from + 1) * (input.rangee_to - input.rangee_from + 1);
    if count > 2000 {
        return invalid("Trop d'emplacements à créer en une fois (2000 maximum).");
    }
    let label = input.label.as_deref().map(str::trim).filter(|s| !s.is_empty()).map(String::from);
    let tx = conn.transaction()?;
    let mut created = 0;
    for bloc in &blocs {
        for e in input.etage_from..=input.etage_to {
            for r in input.rangee_from..=input.rangee_to {
                created += tx.execute(
                    "INSERT OR IGNORE INTO locations (bloc, etage, rangee, label) VALUES (?1, ?2, ?3, ?4)",
                    params![bloc, e.to_string(), r.to_string(), label],
                )? as i64;
            }
        }
    }
    audit::log(&tx, user, "Création d'emplacements", "location", None, format!("Blocs {} : {created} emplacement(s)", blocs.join(", ")))?;
    tx.commit()?;
    Ok(created)
}

/// Range une liste de produits dans un emplacement (ou les retire si `location_id` est vide).
pub fn assign(conn: &mut Connection, user: &SessionUser, location_id: Option<i64>, product_ids: Vec<i64>) -> AppResult<()> {
    let tx = conn.transaction()?;
    for id in &product_ids {
        tx.execute(
            "UPDATE products SET location_id = ?1, updated_at = ?2 WHERE id = ?3",
            params![location_id, crate::db::now(), id],
        )?;
    }
    audit::log(&tx, user, "Rangement de produits", "location", location_id, format!("{} produit(s)", product_ids.len()))?;
    tx.commit()?;
    Ok(())
}
