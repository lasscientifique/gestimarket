//! Emplacements (cases) des produits : une case = un étage × une case d'un meuble du plan
//! (voir `plan.rs`). Les libellés bloc / étage / rangée affichés sont le code du meuble, le numéro
//! d'étage et le numéro de case (« FR1 · Étage 3 · Case 2 », anciens blocs « A · Étage 2 · Case 4 »).

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

use crate::error::{invalid, AppResult};
use crate::services::{audit, plan};
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
    pub fixture_id: i64,
    pub fixture_name: String,
    pub fixture_type: String,
    pub category: String,
    pub floor_id: i64,
    pub floor_name: String,
    pub level: i64,
    pub section: i64,
}

/// Toutes les cases, par niveau, meuble (tri naturel des codes : 2 avant 10), étage et case.
pub fn list(conn: &Connection) -> AppResult<Vec<Location>> {
    let mut stmt = conn.prepare(
        "SELECT l.id, l.bloc, l.etage, l.rangee, l.label,
                (SELECT COUNT(*) FROM products p WHERE p.location_id = l.id AND p.active = 1),
                (SELECT COALESCE(CAST(ROUND(SUM(CASE WHEN p.stock > 0 THEN p.stock * p.purchase_price ELSE 0 END)) AS INTEGER), 0)
                   FROM products p WHERE p.location_id = l.id AND p.active = 1),
                f.id, f.name, t.name, t.category, s.id, s.name, l.level, l.section
         FROM locations l
         JOIN fixtures f ON f.id = l.fixture_id
         JOIN fixture_types t ON t.id = f.type_id
         JOIN store_floors s ON s.id = f.floor_id
         ORDER BY s.sort, s.id, CAST(f.code AS INTEGER), f.code, l.level, l.section",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(Location {
            id: r.get(0)?,
            bloc: r.get(1)?,
            etage: r.get(2)?,
            rangee: r.get(3)?,
            label: r.get(4)?,
            product_count: r.get(5)?,
            stock_value: r.get(6)?,
            fixture_id: r.get(7)?,
            fixture_name: r.get(8)?,
            fixture_type: r.get(9)?,
            category: r.get(10)?,
            floor_id: r.get(11)?,
            floor_name: r.get(12)?,
            level: r.get(13)?,
            section: r.get(14)?,
        })
    })?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

fn gondole_type(conn: &Connection) -> AppResult<i64> {
    Ok(conn.query_row("SELECT id FROM fixture_types WHERE code = 'gondole'", [], |r| r.get(0))?)
}

/// Nombre ≥ 1 lu dans un libellé (« 3 » → 3), sinon 1.
fn number(s: &str, max: i64) -> i64 {
    s.trim().parse::<i64>().ok().filter(|n| *n >= 1).unwrap_or(1).min(max)
}

/// Case désignée par bloc / étage / rangée (import Excel) : case existante portant ces libellés,
/// sinon le meuble de ce code (une gondole est créée et placée sur le plan s'il n'existe pas),
/// agrandi si besoin.
pub fn find_or_create(conn: &Connection, bloc: &str, etage: &str, rangee: &str) -> AppResult<Option<i64>> {
    let code = bloc.trim().to_uppercase();
    let (etage, rangee) = (etage.trim(), rangee.trim());
    if code.is_empty() {
        return Ok(None);
    }
    let existing: Option<i64> = conn
        .query_row(
            "SELECT l.id FROM locations l JOIN fixtures f ON f.id = l.fixture_id
             WHERE f.code = ?1 COLLATE NOCASE AND l.etage = ?2 AND l.rangee = ?3",
            params![code, etage, rangee],
            |r| r.get(0),
        )
        .optional()?;
    if existing.is_some() {
        return Ok(existing);
    }
    let (level, section) = (number(etage, plan::MAX_LEVELS), number(rangee, plan::MAX_SECTIONS));
    let fixture: Option<(i64, i64, i64)> = conn
        .query_row("SELECT id, levels, sections FROM fixtures WHERE code = ?1 COLLATE NOCASE", [&code], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?))
        })
        .optional()?;
    let fixture_id = match fixture {
        Some((id, levels, sections)) => {
            if level > levels || section > sections {
                let (l, s) = (levels.max(level), sections.max(section));
                conn.execute("UPDATE fixtures SET levels = ?1, sections = ?2 WHERE id = ?3", params![l, s, id])?;
                conn.execute(
                    "UPDATE locations SET etage = CASE WHEN ?2 > 1 THEN CAST(level AS TEXT) ELSE '' END,
                                          rangee = CASE WHEN ?3 > 1 THEN CAST(section AS TEXT) ELSE '' END
                     WHERE fixture_id = ?1",
                    params![id, l, s],
                )?;
                plan::ensure_slots(conn, id)?;
            }
            id
        }
        None => {
            let input = plan::FixtureInput {
                type_id: Some(gondole_type(conn)?),
                code: Some(code.clone()),
                name: Some(format!("Rayon {code}")),
                levels: Some(level),
                sections: Some(section),
                ..Default::default()
            };
            plan::create_fixture(conn, None, input)?.id
        }
    };
    Ok(conn
        .query_row("SELECT id FROM locations WHERE fixture_id = ?1 AND level = ?2 AND section = ?3", params![fixture_id, level, section], |r| r.get(0))
        .optional()?)
}

/// Supprime une case : ses produits ne sont plus rangés à cet endroit (ils existent toujours).
pub fn delete(conn: &Connection, user: &SessionUser, id: i64) -> AppResult<()> {
    let place = plan::slot_text(conn, id)?;
    conn.execute(
        "UPDATE products SET location_id = (SELECT pl.location_id FROM product_locations pl
                                            WHERE pl.product_id = products.id AND pl.location_id <> ?1
                                            ORDER BY pl.created_at, pl.location_id LIMIT 1)
         WHERE location_id = ?1",
        [id],
    )?;
    // L'autre emplacement devenu principal ne reste pas aussi en « autre emplacement ».
    conn.execute(
        "DELETE FROM product_locations
         WHERE location_id = (SELECT p.location_id FROM products p WHERE p.id = product_locations.product_id)",
        [],
    )?;
    conn.execute("DELETE FROM product_locations WHERE location_id = ?1", [id])?;
    let n = conn.execute("DELETE FROM locations WHERE id = ?1", [id])?;
    if n == 0 {
        return invalid("Emplacement introuvable.");
    }
    audit::log(conn, user, "Suppression d'emplacement", "location", Some(id), place)?;
    Ok(())
}

#[derive(Debug, Deserialize)]
pub struct GenerateInput {
    pub bloc: String,
    /// Dernier rayon de la série (ex. rayons « A » à « F », ou 1 à 6).
    pub bloc_to: Option<String>,
    pub etage_from: i64,
    pub etage_to: i64,
    pub rangee_from: i64,
    pub rangee_to: i64,
    pub label: Option<String>,
}

/// Liste des codes d'une série : lettres (A → F) ou nombres (1 → 6).
pub fn bloc_series(from: &str, to: Option<&str>) -> AppResult<Vec<String>> {
    let from = from.trim().to_uppercase();
    let to = to.map(|t| t.trim().to_uppercase()).filter(|t| !t.is_empty());
    let Some(to) = to else { return Ok(vec![from]) };
    let (fc, tc) = (from.chars().collect::<Vec<_>>(), to.chars().collect::<Vec<_>>());
    if fc.len() == 1 && tc.len() == 1 && fc[0].is_ascii_alphabetic() && tc[0].is_ascii_alphabetic() {
        let (a, b) = (fc[0] as u8, tc[0] as u8);
        if a > b {
            return invalid("Le premier rayon doit précéder le dernier (ex. A à F).");
        }
        return Ok((a..=b).map(|c| (c as char).to_string()).collect());
    }
    if let (Ok(a), Ok(b)) = (from.parse::<i64>(), to.parse::<i64>()) {
        if a > b || b - a > 100 {
            return invalid("Série de rayons invalide.");
        }
        return Ok((a..=b).map(|n| n.to_string()).collect());
    }
    invalid("Série de rayons invalide : utilisez des lettres (A à F) ou des nombres (1 à 6).")
}

/// Crée en une fois une série de gondoles (rayons A à F, N étages × M cases), placées sur le plan.
/// Retourne le nombre de cases créées.
pub fn generate(conn: &mut Connection, user: &SessionUser, input: GenerateInput) -> AppResult<i64> {
    if input.bloc.trim().is_empty() {
        return invalid("Le code du premier rayon est obligatoire.");
    }
    let codes = bloc_series(&input.bloc, input.bloc_to.as_deref())?;
    if input.etage_from > input.etage_to || input.rangee_from > input.rangee_to || input.etage_from < 0 || input.rangee_from < 0 {
        return invalid("Intervalles invalides.");
    }
    let levels = input.etage_to - input.etage_from + 1;
    let sections = input.rangee_to - input.rangee_from + 1;
    if levels > plan::MAX_LEVELS || sections > plan::MAX_SECTIONS {
        return invalid(format!("{} étages et {} cases au plus par meuble.", plan::MAX_LEVELS, plan::MAX_SECTIONS));
    }
    let label = input.label.as_deref().map(str::trim).filter(|s| !s.is_empty()).map(String::from);
    let tx = conn.transaction()?;
    let gondole = gondole_type(&tx)?;
    let mut created = 0;
    for code in &codes {
        let exists: Option<i64> = tx.query_row("SELECT id FROM fixtures WHERE code = ?1 COLLATE NOCASE", [code], |r| r.get(0)).optional()?;
        let id = match exists {
            Some(id) => {
                tx.execute(
                    "UPDATE fixtures SET levels = max(levels, ?1), sections = max(sections, ?2) WHERE id = ?3",
                    params![levels, sections, id],
                )?;
                id
            }
            None => {
                let input = plan::FixtureInput {
                    type_id: Some(gondole),
                    code: Some(code.clone()),
                    name: Some(match &label {
                        Some(l) if codes.len() == 1 => l.clone(),
                        Some(l) => format!("{l} {code}"),
                        None => format!("Rayon {code}"),
                    }),
                    levels: Some(1),
                    sections: Some(1),
                    ..Default::default()
                };
                let id = plan::create_fixture(&tx, None, input)?.id;
                // Pas de case 1 × 1 provisoire : la grille est créée ci-dessous avec ses libellés.
                tx.execute("DELETE FROM locations WHERE fixture_id = ?1", [id])?;
                tx.execute("UPDATE fixtures SET levels = ?1, sections = ?2 WHERE id = ?3", params![levels, sections, id])?;
                id
            }
        };
        // Libellés d'origine : étages etage_from..etage_to, rangées rangee_from..rangee_to.
        for (li, e) in (input.etage_from..=input.etage_to).enumerate() {
            for (si, r) in (input.rangee_from..=input.rangee_to).enumerate() {
                created += tx.execute(
                    "INSERT OR IGNORE INTO locations (fixture_id, level, section, bloc, etage, rangee, label) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                    params![
                        id,
                        li as i64 + 1,
                        si as i64 + 1,
                        code,
                        if levels > 1 { e.to_string() } else { String::new() },
                        if sections > 1 { r.to_string() } else { String::new() },
                        label
                    ],
                )? as i64;
            }
        }
        plan::ensure_slots(&tx, id)?;
    }
    audit::log(&tx, user, "Création de rayons", "location", None, format!("Rayons {} : {created} case(s)", codes.join(", ")))?;
    tx.commit()?;
    Ok(created)
}

/// Range une liste de produits dans une case (emplacement principal), ou les retire de tout
/// rangement si `location_id` est vide.
pub fn assign(conn: &mut Connection, user: &SessionUser, location_id: Option<i64>, product_ids: Vec<i64>) -> AppResult<()> {
    let tx = conn.transaction()?;
    for id in &product_ids {
        tx.execute(
            "UPDATE products SET location_id = ?1, updated_at = ?2 WHERE id = ?3",
            params![location_id, crate::db::now(), id],
        )?;
        match location_id {
            Some(l) => tx.execute("DELETE FROM product_locations WHERE product_id = ?1 AND location_id = ?2", params![id, l])?,
            None => tx.execute("DELETE FROM product_locations WHERE product_id = ?1", [id])?,
        };
    }
    audit::log(&tx, user, "Rangement de produits", "location", location_id, format!("{} produit(s)", product_ids.len()))?;
    tx.commit()?;
    Ok(())
}
