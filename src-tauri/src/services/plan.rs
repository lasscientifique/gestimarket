//! Plan de la boutique, comme un plan d'architecte : niveaux du bâtiment, palette de meubles
//! (gondoles, frigos, congélateurs, vitrines, présentoirs, réserve… et meubles personnalisés),
//! meubles posés sur le plan (position, taille et rotation en mètres) et leurs cases (étage × case).
//!
//! Rangement : « poser » un produit dans une case, le « prendre » (retirer), le déplacer.
//! Un produit a un emplacement principal (products.location_id) et d'autres emplacements
//! éventuels (product_locations) : rayon, réserve, frigo… Le stock reste global.

use std::collections::HashMap;

use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};

use crate::db;
use crate::error::{invalid, AppResult};
use crate::services::audit;
use crate::state::SessionUser;

pub const MAX_LEVELS: i64 = 30;
pub const MAX_SECTIONS: i64 = 30;
const CATEGORIES: &[&str] = &["rayon", "froid", "presentation", "rangement", "zone", "batiment"];

#[derive(Debug, Serialize)]
pub struct Floor {
    pub id: i64,
    pub name: String,
    pub sort: i64,
    pub width: f64,
    pub depth: f64,
}

#[derive(Debug, Clone, Serialize)]
pub struct FixtureType {
    pub id: i64,
    pub code: String,
    pub name: String,
    pub category: String,
    pub prefix: String,
    pub color: String,
    pub width: f64,
    pub depth: f64,
    pub levels: i64,
    pub sections: i64,
    pub storage: bool,
    pub builtin: bool,
    pub sort: i64,
    /// Nombre de meubles de ce type sur le plan.
    pub used: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct Fixture {
    pub id: i64,
    pub floor_id: i64,
    pub type_id: i64,
    pub type_code: String,
    pub type_name: String,
    pub category: String,
    /// Reçoit des produits (faux pour un mur, une porte, une pièce…).
    pub storage: bool,
    pub code: String,
    pub name: String,
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
    pub rotation: i64,
    /// Couleur affichée (celle du meuble, sinon celle du type).
    pub color: String,
    pub custom_color: Option<String>,
    pub levels: i64,
    pub sections: i64,
    pub notes: Option<String>,
    /// Produits rangés dans ce meuble (emplacement principal ou autre).
    pub product_count: i64,
}

#[derive(Debug, Serialize)]
pub struct Plan {
    pub floors: Vec<Floor>,
    pub types: Vec<FixtureType>,
    pub fixtures: Vec<Fixture>,
}

const TYPE_SELECT: &str = "SELECT t.id, t.code, t.name, t.category, t.prefix, t.color, t.width, t.depth, t.levels, t.sections,
        t.storage, t.builtin, t.sort, (SELECT COUNT(*) FROM fixtures f WHERE f.type_id = t.id)
    FROM fixture_types t";

fn type_from_row(r: &Row) -> rusqlite::Result<FixtureType> {
    Ok(FixtureType {
        id: r.get(0)?,
        code: r.get(1)?,
        name: r.get(2)?,
        category: r.get(3)?,
        prefix: r.get(4)?,
        color: r.get(5)?,
        width: r.get(6)?,
        depth: r.get(7)?,
        levels: r.get(8)?,
        sections: r.get(9)?,
        storage: r.get(10)?,
        builtin: r.get(11)?,
        sort: r.get(12)?,
        used: r.get(13)?,
    })
}

const FIXTURE_SELECT: &str = "SELECT f.id, f.floor_id, f.type_id, t.code, t.name, t.category, t.storage, f.code, f.name,
        f.x, f.y, f.w, f.h, f.rotation, COALESCE(NULLIF(f.color, ''), t.color), NULLIF(f.color, ''), f.levels, f.sections, f.notes
    FROM fixtures f JOIN fixture_types t ON t.id = f.type_id";

fn fixture_from_row(r: &Row) -> rusqlite::Result<Fixture> {
    Ok(Fixture {
        id: r.get(0)?,
        floor_id: r.get(1)?,
        type_id: r.get(2)?,
        type_code: r.get(3)?,
        type_name: r.get(4)?,
        category: r.get(5)?,
        storage: r.get(6)?,
        code: r.get(7)?,
        name: r.get(8)?,
        x: r.get(9)?,
        y: r.get(10)?,
        w: r.get(11)?,
        h: r.get(12)?,
        rotation: r.get(13)?,
        color: r.get(14)?,
        custom_color: r.get(15)?,
        levels: r.get(16)?,
        sections: r.get(17)?,
        notes: r.get(18)?,
        product_count: 0,
    })
}

/// Nombre de produits (actifs) rangés dans chaque meuble.
fn product_counts(conn: &Connection) -> AppResult<HashMap<i64, i64>> {
    let mut stmt = conn.prepare(
        "SELECT l.fixture_id, COUNT(DISTINCT x.pid) FROM (
             SELECT id AS pid, location_id AS lid FROM products WHERE active = 1 AND location_id IS NOT NULL
             UNION ALL
             SELECT pl.product_id, pl.location_id FROM product_locations pl JOIN products p ON p.id = pl.product_id WHERE p.active = 1
         ) x JOIN locations l ON l.id = x.lid GROUP BY l.fixture_id",
    )?;
    let rows = stmt.query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?)))?;
    Ok(rows.collect::<Result<HashMap<_, _>, _>>()?)
}

pub fn get(conn: &Connection) -> AppResult<Plan> {
    let mut stmt = conn.prepare("SELECT id, name, sort, width, depth FROM store_floors ORDER BY sort, id")?;
    let floors = stmt
        .query_map([], |r| Ok(Floor { id: r.get(0)?, name: r.get(1)?, sort: r.get(2)?, width: r.get(3)?, depth: r.get(4)? }))?
        .collect::<Result<Vec<_>, _>>()?;
    let mut stmt = conn.prepare(&format!("{TYPE_SELECT} ORDER BY t.builtin DESC, t.sort, t.name"))?;
    let types = stmt.query_map([], type_from_row)?.collect::<Result<Vec<_>, _>>()?;
    let counts = product_counts(conn)?;
    // Les pièces d'abord (dessinées sous les meubles), puis les meubles.
    let mut stmt = conn.prepare(&format!("{FIXTURE_SELECT} ORDER BY t.category = 'zone' DESC, f.id"))?;
    let fixtures = stmt
        .query_map([], fixture_from_row)?
        .map(|f| {
            f.map(|mut f| {
                f.product_count = counts.get(&f.id).copied().unwrap_or(0);
                f
            })
        })
        .collect::<Result<Vec<_>, _>>()?;
    Ok(Plan { floors, types, fixtures })
}

pub fn get_fixture(conn: &Connection, id: i64) -> AppResult<Fixture> {
    let mut f = conn
        .query_row(&format!("{FIXTURE_SELECT} WHERE f.id = ?1"), [id], fixture_from_row)
        .optional()?
        .ok_or_else(|| crate::error::AppError::Validation("Meuble introuvable.".into()))?;
    f.product_count = product_counts(conn)?.get(&id).copied().unwrap_or(0);
    Ok(f)
}

fn get_type(conn: &Connection, id: i64) -> AppResult<FixtureType> {
    conn.query_row(&format!("{TYPE_SELECT} WHERE t.id = ?1"), [id], type_from_row)
        .optional()?
        .ok_or_else(|| crate::error::AppError::Validation("Type de meuble inconnu.".into()))
}

fn floor_size(conn: &Connection, floor_id: i64) -> AppResult<(f64, f64)> {
    conn.query_row("SELECT width, depth FROM store_floors WHERE id = ?1", [floor_id], |r| Ok((r.get(0)?, r.get(1)?)))
        .optional()?
        .ok_or_else(|| crate::error::AppError::Validation("Niveau du bâtiment introuvable.".into()))
}

// ───────────────────────────── Cases ─────────────────────────────

/// Libellés affichés d'une case : numéro d'étage (si plusieurs) et de case (si plusieurs).
fn slot_labels(levels: i64, sections: i64, level: i64, section: i64) -> (String, String) {
    (
        if levels > 1 { level.to_string() } else { String::new() },
        if sections > 1 { section.to_string() } else { String::new() },
    )
}

/// Crée les cases manquantes d'un meuble (grille étages × cases complète).
pub fn ensure_slots(conn: &Connection, fixture_id: i64) -> AppResult<i64> {
    let (code, levels, sections, storage): (String, i64, i64, bool) = conn.query_row(
        "SELECT f.code, f.levels, f.sections, t.storage FROM fixtures f JOIN fixture_types t ON t.id = f.type_id WHERE f.id = ?1",
        [fixture_id],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
    )?;
    if !storage {
        return Ok(0);
    }
    let mut created = 0;
    let mut stmt = conn.prepare(
        "INSERT OR IGNORE INTO locations (fixture_id, level, section, bloc, etage, rangee) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
    )?;
    for level in 1..=levels {
        for section in 1..=sections {
            let (etage, rangee) = slot_labels(levels, sections, level, section);
            created += stmt.execute(params![fixture_id, level, section, code, etage, rangee])? as i64;
        }
    }
    Ok(created)
}

/// Renumérote les libellés des cases après un changement d'étages ou de cases.
fn relabel(conn: &Connection, fixture_id: i64, levels: i64, sections: i64) -> AppResult<()> {
    conn.execute(
        "UPDATE locations SET etage = CASE WHEN ?2 > 1 THEN CAST(level AS TEXT) ELSE '' END,
                              rangee = CASE WHEN ?3 > 1 THEN CAST(section AS TEXT) ELSE '' END
         WHERE fixture_id = ?1",
        params![fixture_id, levels, sections],
    )?;
    Ok(())
}

/// Texte d'une case : « Réfrigérateur FR1 · Étage 3 · Case 2 ».
pub fn slot_text(conn: &Connection, location_id: i64) -> AppResult<String> {
    let (name, etage, rangee): (String, String, String) = conn
        .query_row(
            "SELECT f.name, l.etage, l.rangee FROM locations l JOIN fixtures f ON f.id = l.fixture_id WHERE l.id = ?1",
            [location_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .optional()?
        .ok_or_else(|| crate::error::AppError::Validation("Emplacement introuvable.".into()))?;
    let mut parts = vec![name];
    if !etage.is_empty() {
        parts.push(format!("Étage {etage}"));
    }
    if !rangee.is_empty() {
        parts.push(format!("Case {rangee}"));
    }
    Ok(parts.join(" · "))
}

// ───────────────────────────── Niveaux du bâtiment ─────────────────────────────

#[derive(Debug, Deserialize)]
pub struct FloorInput {
    pub name: String,
    pub width: f64,
    pub depth: f64,
}

pub fn save_floor(conn: &Connection, user: &SessionUser, id: Option<i64>, input: FloorInput) -> AppResult<i64> {
    let name = input.name.trim();
    if name.is_empty() {
        return invalid("Donnez un nom au niveau (ex. Rez-de-chaussée, 1er étage, Entrepôt).");
    }
    if !(2.0..=500.0).contains(&input.width) || !(2.0..=500.0).contains(&input.depth) {
        return invalid("Dimensions du niveau : de 2 à 500 mètres.");
    }
    let id = match id {
        Some(id) => {
            conn.execute("UPDATE store_floors SET name = ?1, width = ?2, depth = ?3 WHERE id = ?4", params![name, input.width, input.depth, id])?;
            id
        }
        None => {
            let sort: i64 = conn.query_row("SELECT COALESCE(MAX(sort), -1) + 1 FROM store_floors", [], |r| r.get(0))?;
            conn.execute("INSERT INTO store_floors (name, sort, width, depth) VALUES (?1, ?2, ?3, ?4)", params![name, sort, input.width, input.depth])?;
            conn.last_insert_rowid()
        }
    };
    audit::log(conn, user, "Plan : niveau enregistré", "plan", Some(id), format!("{name} ({} × {} m)", input.width, input.depth))?;
    Ok(id)
}

pub fn delete_floor(conn: &Connection, user: &SessionUser, id: i64) -> AppResult<()> {
    let floors: i64 = conn.query_row("SELECT COUNT(*) FROM store_floors", [], |r| r.get(0))?;
    if floors <= 1 {
        return invalid("Le plan garde au moins un niveau.");
    }
    let placed: i64 = conn.query_row(
        "SELECT COUNT(*) FROM locations l JOIN fixtures f ON f.id = l.fixture_id WHERE f.floor_id = ?1
           AND (EXISTS (SELECT 1 FROM products p WHERE p.location_id = l.id)
                OR EXISTS (SELECT 1 FROM product_locations pl WHERE pl.location_id = l.id))",
        [id],
        |r| r.get(0),
    )?;
    if placed > 0 {
        return invalid(format!("Ce niveau contient des produits rangés ({placed} case(s)) : déplacez-les d'abord."));
    }
    let n = conn.execute("DELETE FROM store_floors WHERE id = ?1", [id])?;
    if n == 0 {
        return invalid("Niveau introuvable.");
    }
    audit::log(conn, user, "Plan : niveau supprimé", "plan", Some(id), "")?;
    Ok(())
}

// ───────────────────────────── Meubles ─────────────────────────────

/// Prochain code libre pour un préfixe : FR1, FR2…
fn next_code(conn: &Connection, prefix: &str) -> AppResult<String> {
    let mut stmt = conn.prepare("SELECT code FROM fixtures")?;
    let codes = stmt.query_map([], |r| r.get::<_, String>(0))?.collect::<Result<Vec<_>, _>>()?;
    let prefix = prefix.to_uppercase();
    let max = codes
        .iter()
        .filter_map(|c| c.to_uppercase().strip_prefix(prefix.as_str()).and_then(|n| n.parse::<i64>().ok()))
        .max()
        .unwrap_or(0);
    Ok(format!("{prefix}{}", max + 1))
}

fn check_code(conn: &Connection, code: &str, except: i64) -> AppResult<String> {
    let code = code.trim().to_uppercase();
    if code.is_empty() || code.chars().count() > 12 || !code.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        return invalid("Code du meuble : 1 à 12 lettres ou chiffres (ex. FR1, A, R-12).");
    }
    let taken: Option<i64> = conn
        .query_row("SELECT id FROM fixtures WHERE code = ?1 COLLATE NOCASE AND id <> ?2", params![code, except], |r| r.get(0))
        .optional()?;
    if taken.is_some() {
        return invalid(format!("Le code {code} est déjà utilisé par un autre meuble."));
    }
    Ok(code)
}

/// Nom court d'un type : « Gondole (rayon double face) » → « Gondole ».
fn short_name(name: &str) -> &str {
    name.split(" (").next().unwrap_or(name).split(" / ").next().unwrap_or(name).trim()
}

fn overlaps(a: (f64, f64, f64, f64), b: (f64, f64, f64, f64)) -> bool {
    a.0 < b.0 + b.2 && b.0 < a.0 + a.2 && a.1 < b.1 + b.3 && b.1 < a.1 + a.3
}

/// Place libre sur un niveau pour un meuble de taille w × h (le niveau s'agrandit si besoin).
pub fn free_spot(conn: &Connection, floor_id: i64, w: f64, h: f64) -> AppResult<(f64, f64)> {
    let (fw, fd) = floor_size(conn, floor_id)?;
    let mut stmt = conn.prepare(
        "SELECT f.x, f.y, CASE WHEN f.rotation IN (90, 270) THEN f.h ELSE f.w END, CASE WHEN f.rotation IN (90, 270) THEN f.w ELSE f.h END
         FROM fixtures f JOIN fixture_types t ON t.id = f.type_id WHERE f.floor_id = ?1 AND t.category <> 'zone'",
    )?;
    let taken = stmt
        .query_map([floor_id], |r| Ok((r.get::<_, f64>(0)?, r.get::<_, f64>(1)?, r.get::<_, f64>(2)?, r.get::<_, f64>(3)?)))?
        .collect::<Result<Vec<_>, _>>()?;
    let margin = 0.5;
    let mut y = 1.0;
    while y + h <= fd - margin + 1e-9 {
        let mut x = 1.0;
        while x + w <= fw - margin + 1e-9 {
            let r = (x - margin, y - margin, w + 2.0 * margin, h + 2.0 * margin);
            if !taken.iter().any(|t| overlaps(r, *t)) {
                return Ok((x, y));
            }
            x += 0.5;
        }
        y += 0.5;
    }
    // Plus de place : le niveau s'allonge, le meuble se place en bas.
    let bottom = taken.iter().map(|t| t.1 + t.3).fold(fd, f64::max);
    let y = bottom + 1.0;
    conn.execute("UPDATE store_floors SET depth = ?1 WHERE id = ?2", params![(y + h + 1.0).ceil(), floor_id])?;
    Ok((1.0, y))
}

#[derive(Debug, Default, Deserialize)]
pub struct FixtureInput {
    pub floor_id: Option<i64>,
    pub type_id: Option<i64>,
    pub code: Option<String>,
    pub name: Option<String>,
    pub x: Option<f64>,
    pub y: Option<f64>,
    pub w: Option<f64>,
    pub h: Option<f64>,
    pub rotation: Option<i64>,
    pub color: Option<String>,
    pub levels: Option<i64>,
    pub sections: Option<i64>,
    pub notes: Option<String>,
}

fn norm_rotation(r: i64) -> i64 {
    r.rem_euclid(360)
}

fn check_size(w: f64, h: f64) -> AppResult<()> {
    if !(0.05..=200.0).contains(&w) || !(0.05..=200.0).contains(&h) {
        return invalid("Taille du meuble : de 5 cm à 200 m.");
    }
    Ok(())
}

fn check_color(color: &Option<String>) -> AppResult<Option<String>> {
    match db::clean(color) {
        None => Ok(None),
        Some(c) if c.len() == 7 && c.starts_with('#') && c[1..].chars().all(|x| x.is_ascii_hexdigit()) => Ok(Some(c)),
        Some(_) => invalid("Couleur invalide (format #RRVVBB)."),
    }
}

/// Crée un meuble (position libre si non précisée) et ses cases.
pub fn create_fixture(conn: &Connection, user: Option<&SessionUser>, input: FixtureInput) -> AppResult<Fixture> {
    let t = get_type(conn, input.type_id.ok_or_else(|| crate::error::AppError::Validation("Choisissez un type de meuble.".into()))?)?;
    let floor_id = match input.floor_id {
        Some(f) => f,
        None => conn.query_row("SELECT id FROM store_floors ORDER BY sort, id LIMIT 1", [], |r| r.get(0))?,
    };
    let (fw, fd) = floor_size(conn, floor_id)?;
    let (w, h) = (input.w.unwrap_or(t.width), input.h.unwrap_or(t.depth));
    check_size(w, h)?;
    let (x, y) = match (input.x, input.y) {
        (Some(x), Some(y)) => (x.clamp(0.0, (fw - w).max(0.0)), y.clamp(0.0, (fd - h).max(0.0))),
        _ => free_spot(conn, floor_id, w, h)?,
    };
    let code = match db::clean(&input.code) {
        Some(c) => check_code(conn, &c, 0)?,
        None => next_code(conn, &t.prefix)?,
    };
    let name = db::clean(&input.name).unwrap_or_else(|| format!("{} {code}", short_name(&t.name)));
    let (levels, sections) = if t.storage {
        (input.levels.unwrap_or(t.levels).clamp(1, MAX_LEVELS), input.sections.unwrap_or(t.sections).clamp(1, MAX_SECTIONS))
    } else {
        (1, 1)
    };
    let color = check_color(&input.color)?;
    conn.execute(
        "INSERT INTO fixtures (floor_id, type_id, code, name, x, y, w, h, rotation, color, levels, sections, notes)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
        params![
            floor_id, t.id, code, name, x, y, w, h, norm_rotation(input.rotation.unwrap_or(0)), color, levels, sections,
            db::clean(&input.notes)
        ],
    )?;
    let id = conn.last_insert_rowid();
    ensure_slots(conn, id)?;
    if let Some(u) = user {
        audit::log(conn, u, "Plan : meuble ajouté", "plan", Some(id), format!("{name} ({code})"))?;
    }
    get_fixture(conn, id)
}

/// Modifie un meuble : nom, code, taille, position, couleur, étages et cases.
pub fn update_fixture(conn: &mut Connection, user: &SessionUser, id: i64, input: FixtureInput) -> AppResult<Fixture> {
    let cur = get_fixture(conn, id)?;
    let tx = conn.transaction()?;
    let code = match db::clean(&input.code) {
        Some(c) if !c.eq_ignore_ascii_case(&cur.code) => check_code(&tx, &c, id)?,
        _ => cur.code.clone(),
    };
    let name = db::clean(&input.name).unwrap_or_else(|| cur.name.clone());
    let floor_id = input.floor_id.unwrap_or(cur.floor_id);
    let (w, h) = (input.w.unwrap_or(cur.w), input.h.unwrap_or(cur.h));
    check_size(w, h)?;
    let (fw, fd) = floor_size(&tx, floor_id)?;
    let x = input.x.unwrap_or(cur.x).clamp(-w, fw);
    let y = input.y.unwrap_or(cur.y).clamp(-h, fd);
    let (levels, sections) = if cur.storage {
        (input.levels.unwrap_or(cur.levels).clamp(1, MAX_LEVELS), input.sections.unwrap_or(cur.sections).clamp(1, MAX_SECTIONS))
    } else {
        (1, 1)
    };
    if levels < cur.levels || sections < cur.sections {
        let busy: i64 = tx.query_row(
            "SELECT COUNT(*) FROM locations l WHERE l.fixture_id = ?1 AND (l.level > ?2 OR l.section > ?3)
               AND (EXISTS (SELECT 1 FROM products p WHERE p.location_id = l.id)
                    OR EXISTS (SELECT 1 FROM product_locations pl WHERE pl.location_id = l.id))",
            params![id, levels, sections],
            |r| r.get(0),
        )?;
        if busy > 0 {
            return invalid(format!("{busy} case(s) à retirer contiennent encore des produits : déplacez-les d'abord."));
        }
        tx.execute("DELETE FROM locations WHERE fixture_id = ?1 AND (level > ?2 OR section > ?3)", params![id, levels, sections])?;
    }
    let color = match &input.color {
        Some(_) => check_color(&input.color)?,
        None => cur.custom_color.clone(),
    };
    let notes = match &input.notes {
        Some(_) => db::clean(&input.notes),
        None => cur.notes.clone(),
    };
    tx.execute(
        "UPDATE fixtures SET floor_id = ?1, code = ?2, name = ?3, x = ?4, y = ?5, w = ?6, h = ?7, rotation = ?8, color = ?9,
                levels = ?10, sections = ?11, notes = ?12, updated_at = ?13
         WHERE id = ?14",
        params![
            floor_id, code, name, x, y, w, h, norm_rotation(input.rotation.unwrap_or(cur.rotation)), color, levels, sections, notes,
            db::now(), id
        ],
    )?;
    if code != cur.code {
        tx.execute("UPDATE locations SET bloc = ?1 WHERE fixture_id = ?2", params![code, id])?;
    }
    if levels != cur.levels || sections != cur.sections {
        relabel(&tx, id, levels, sections)?;
    }
    ensure_slots(&tx, id)?;
    if code != cur.code || name != cur.name || levels != cur.levels || sections != cur.sections {
        audit::log(&tx, user, "Plan : meuble modifié", "plan", Some(id), format!("{name} ({code}) — {levels} étage(s) × {sections} case(s)"))?;
    }
    tx.commit()?;
    get_fixture(conn, id)
}

#[derive(Debug, Deserialize)]
pub struct Geometry {
    pub id: i64,
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
    pub rotation: i64,
}

/// Déplacements, redimensionnements et rotations (glisser-déposer, annuler / rétablir).
pub fn move_fixtures(conn: &mut Connection, items: Vec<Geometry>) -> AppResult<()> {
    let tx = conn.transaction()?;
    for g in &items {
        check_size(g.w, g.h)?;
        if !g.x.is_finite() || !g.y.is_finite() || g.x.abs() > 1000.0 || g.y.abs() > 1000.0 {
            return invalid("Position invalide.");
        }
        tx.execute(
            "UPDATE fixtures SET x = ?1, y = ?2, w = ?3, h = ?4, rotation = ?5, updated_at = ?6 WHERE id = ?7",
            params![g.x, g.y, g.w, g.h, norm_rotation(g.rotation), db::now(), g.id],
        )?;
    }
    tx.commit()?;
    Ok(())
}

/// Supprime un meuble. Ses produits gardent leurs autres emplacements (l'un d'eux devient principal).
pub fn delete_fixture(conn: &mut Connection, user: &SessionUser, id: i64) -> AppResult<i64> {
    let f = get_fixture(conn, id)?;
    let tx = conn.transaction()?;
    let mut stmt = tx.prepare("SELECT p.id FROM products p JOIN locations l ON l.id = p.location_id WHERE l.fixture_id = ?1")?;
    let products = stmt.query_map([id], |r| r.get::<_, i64>(0))?.collect::<Result<Vec<_>, _>>()?;
    drop(stmt);
    for pid in &products {
        let next: Option<i64> = tx
            .query_row(
                "SELECT pl.location_id FROM product_locations pl JOIN locations l ON l.id = pl.location_id
                 WHERE pl.product_id = ?1 AND l.fixture_id <> ?2 ORDER BY pl.created_at, pl.location_id LIMIT 1",
                params![pid, id],
                |r| r.get(0),
            )
            .optional()?;
        tx.execute("UPDATE products SET location_id = ?1, updated_at = ?2 WHERE id = ?3", params![next, db::now(), pid])?;
        if let Some(n) = next {
            tx.execute("DELETE FROM product_locations WHERE product_id = ?1 AND location_id = ?2", params![pid, n])?;
        }
    }
    tx.execute("DELETE FROM product_locations WHERE location_id IN (SELECT id FROM locations WHERE fixture_id = ?1)", [id])?;
    tx.execute("DELETE FROM locations WHERE fixture_id = ?1", [id])?;
    tx.execute("DELETE FROM fixtures WHERE id = ?1", [id])?;
    audit::log(&tx, user, "Plan : meuble supprimé", "plan", Some(id), format!("{} ({}) — {} produit(s) concerné(s)", f.name, f.code, f.product_count))?;
    tx.commit()?;
    Ok(f.product_count)
}

// ───────────────────────────── Palette : meubles personnalisés ─────────────────────────────

#[derive(Debug, Deserialize)]
pub struct TypeInput {
    pub name: String,
    pub category: String,
    pub prefix: String,
    pub color: String,
    pub width: f64,
    pub depth: f64,
    pub levels: i64,
    pub sections: i64,
}

pub fn save_type(conn: &Connection, user: &SessionUser, id: Option<i64>, input: TypeInput) -> AppResult<i64> {
    let name = input.name.trim();
    if name.is_empty() {
        return invalid("Donnez un nom au meuble (ex. Frigo à boissons, Étagère à épices).");
    }
    if !CATEGORIES.contains(&input.category.as_str()) {
        return invalid("Famille de meuble inconnue.");
    }
    let prefix = input.prefix.trim().to_uppercase();
    if prefix.is_empty() || prefix.len() > 3 || !prefix.chars().all(|c| c.is_ascii_uppercase()) {
        return invalid("Préfixe des codes : 1 à 3 lettres (ex. FB pour FB1, FB2…).");
    }
    let color = check_color(&Some(input.color.clone()))?.unwrap_or_else(|| "#64748b".into());
    check_size(input.width, input.depth)?;
    let storage = !matches!(input.category.as_str(), "zone" | "batiment");
    let (levels, sections) = if storage { (input.levels.clamp(1, MAX_LEVELS), input.sections.clamp(1, MAX_SECTIONS)) } else { (1, 1) };
    let id = match id {
        Some(id) => {
            let t = get_type(conn, id)?;
            if t.builtin {
                return invalid("Les meubles de base ne se modifient pas : créez un meuble personnalisé.");
            }
            if t.used > 0 && t.storage != storage {
                return invalid("Ce meuble est déjà posé sur le plan : sa famille ne peut plus changer (rangement ou non).");
            }
            conn.execute(
                "UPDATE fixture_types SET name = ?1, category = ?2, prefix = ?3, color = ?4, width = ?5, depth = ?6, levels = ?7, sections = ?8, storage = ?9
                 WHERE id = ?10",
                params![name, input.category, prefix, color, input.width, input.depth, levels, sections, storage, id],
            )?;
            id
        }
        None => {
            let code = format!("perso_{}", chrono::Local::now().format("%Y%m%d%H%M%S%3f"));
            conn.execute(
                "INSERT INTO fixture_types (code, name, category, prefix, color, width, depth, levels, sections, storage, builtin, sort)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 0, 100)",
                params![code, name, input.category, prefix, color, input.width, input.depth, levels, sections, storage],
            )?;
            conn.last_insert_rowid()
        }
    };
    audit::log(conn, user, "Plan : meuble personnalisé enregistré", "plan", Some(id), name)?;
    Ok(id)
}

pub fn delete_type(conn: &Connection, user: &SessionUser, id: i64) -> AppResult<()> {
    let t = get_type(conn, id)?;
    if t.builtin {
        return invalid("Les meubles de base ne se suppriment pas.");
    }
    if t.used > 0 {
        return invalid(format!("Ce meuble est posé {} fois sur le plan : retirez-les d'abord.", t.used));
    }
    conn.execute("DELETE FROM fixture_types WHERE id = ?1", [id])?;
    audit::log(conn, user, "Plan : meuble personnalisé supprimé", "plan", Some(id), &t.name)?;
    Ok(())
}

// ───────────────────────────── Contenu d'un meuble (vue de face) ─────────────────────────────

#[derive(Debug, Serialize)]
pub struct SlotProduct {
    pub product_id: i64,
    pub name: String,
    pub barcode: Option<String>,
    pub image_id: Option<i64>,
    pub stock: f64,
    pub unit: String,
    /// Emplacement principal du produit (sinon : autre emplacement).
    pub primary: bool,
}

#[derive(Debug, Serialize)]
pub struct Slot {
    pub id: i64,
    pub level: i64,
    pub section: i64,
    pub etage: String,
    pub rangee: String,
    pub label: Option<String>,
    pub products: Vec<SlotProduct>,
}

#[derive(Debug, Serialize)]
pub struct FixtureContents {
    pub fixture: Fixture,
    pub slots: Vec<Slot>,
}

pub fn contents(conn: &Connection, fixture_id: i64) -> AppResult<FixtureContents> {
    let fixture = get_fixture(conn, fixture_id)?;
    let mut stmt = conn.prepare("SELECT id, level, section, etage, rangee, label FROM locations WHERE fixture_id = ?1 ORDER BY level, section")?;
    let mut slots = stmt
        .query_map([fixture_id], |r| {
            Ok(Slot { id: r.get(0)?, level: r.get(1)?, section: r.get(2)?, etage: r.get(3)?, rangee: r.get(4)?, label: r.get(5)?, products: Vec::new() })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    let index: HashMap<i64, usize> = slots.iter().enumerate().map(|(i, s)| (s.id, i)).collect();
    let mut stmt = conn.prepare(
        "SELECT x.lid, p.id, p.name, p.barcode, p.image_id, p.stock, p.unit, x.prim FROM (
             SELECT id AS pid, location_id AS lid, 1 AS prim FROM products WHERE location_id IN (SELECT id FROM locations WHERE fixture_id = ?1)
             UNION ALL
             SELECT product_id, location_id, 0 FROM product_locations WHERE location_id IN (SELECT id FROM locations WHERE fixture_id = ?1)
         ) x JOIN products p ON p.id = x.pid
         WHERE p.active = 1
         ORDER BY p.name COLLATE NOCASE",
    )?;
    let rows = stmt.query_map([fixture_id], |r| {
        Ok((
            r.get::<_, i64>(0)?,
            SlotProduct {
                product_id: r.get(1)?,
                name: r.get(2)?,
                barcode: r.get(3)?,
                image_id: r.get(4)?,
                stock: r.get(5)?,
                unit: r.get(6)?,
                primary: r.get(7)?,
            },
        ))
    })?;
    for row in rows {
        let (lid, p) = row?;
        if let Some(&i) = index.get(&lid) {
            slots[i].products.push(p);
        }
    }
    Ok(FixtureContents { fixture, slots })
}

// ───────────────────────────── Où est le produit ? ─────────────────────────────

#[derive(Debug, Serialize)]
pub struct Place {
    pub location_id: i64,
    pub primary: bool,
    pub fixture_id: i64,
    pub fixture_code: String,
    pub fixture_name: String,
    pub type_name: String,
    pub category: String,
    pub floor_id: i64,
    pub floor_name: String,
    pub level: i64,
    pub section: i64,
    pub etage: String,
    pub rangee: String,
    pub levels: i64,
    pub sections: i64,
}

/// Emplacements d'un produit : le principal d'abord.
pub fn product_places(conn: &Connection, product_id: i64) -> AppResult<Vec<Place>> {
    let mut stmt = conn.prepare(
        "SELECT l.id, x.prim, f.id, f.code, f.name, t.name, t.category, s.id, s.name, l.level, l.section, l.etage, l.rangee, f.levels, f.sections
         FROM (SELECT location_id AS lid, 1 AS prim, '' AS at FROM products WHERE id = ?1 AND location_id IS NOT NULL
               UNION ALL
               SELECT location_id, 0, created_at FROM product_locations WHERE product_id = ?1) x
         JOIN locations l ON l.id = x.lid
         JOIN fixtures f ON f.id = l.fixture_id
         JOIN fixture_types t ON t.id = f.type_id
         JOIN store_floors s ON s.id = f.floor_id
         ORDER BY x.prim DESC, x.at, l.id",
    )?;
    let rows = stmt.query_map([product_id], |r| {
        Ok(Place {
            location_id: r.get(0)?,
            primary: r.get(1)?,
            fixture_id: r.get(2)?,
            fixture_code: r.get(3)?,
            fixture_name: r.get(4)?,
            type_name: r.get(5)?,
            category: r.get(6)?,
            floor_id: r.get(7)?,
            floor_name: r.get(8)?,
            level: r.get(9)?,
            section: r.get(10)?,
            etage: r.get(11)?,
            rangee: r.get(12)?,
            levels: r.get(13)?,
            sections: r.get(14)?,
        })
    })?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

// ───────────────────────────── Poser, prendre, déplacer ─────────────────────────────

fn current_primary(conn: &Connection, product_id: i64) -> AppResult<(String, Option<i64>)> {
    conn.query_row("SELECT name, location_id FROM products WHERE id = ?1", [product_id], |r| Ok((r.get(0)?, r.get(1)?)))
        .optional()?
        .ok_or_else(|| crate::error::AppError::Validation("Produit introuvable.".into()))
}

#[derive(Debug, Deserialize)]
pub struct PutInput {
    pub product_id: i64,
    /// Case de destination.
    pub location_id: i64,
    /// Case d'origine quand le produit est déplacé d'une case à une autre.
    pub from_location_id: Option<i64>,
    /// Vrai : la case devient l'emplacement principal (l'ancien reste comme autre emplacement).
    pub primary: Option<bool>,
}

/// Pose un produit dans une case (ou le déplace). Sans emplacement principal, la case le devient ;
/// sinon elle s'ajoute comme autre emplacement (ex. le même produit au rayon et au frigo).
pub fn put(conn: &mut Connection, user: &SessionUser, input: PutInput) -> AppResult<Vec<Place>> {
    let (name, primary) = current_primary(conn, input.product_id)?;
    let target = input.location_id;
    let storage: Option<bool> = conn
        .query_row(
            "SELECT t.storage FROM locations l JOIN fixtures f ON f.id = l.fixture_id JOIN fixture_types t ON t.id = f.type_id WHERE l.id = ?1",
            [target],
            |r| r.get(0),
        )
        .optional()?;
    if storage != Some(true) {
        return invalid("Case introuvable.");
    }
    let tx = conn.transaction()?;
    let set_primary = |id: Option<i64>| tx.execute("UPDATE products SET location_id = ?1, updated_at = ?2 WHERE id = ?3", params![id, db::now(), input.product_id]);
    let add_other = |id: i64| tx.execute("INSERT OR IGNORE INTO product_locations (product_id, location_id) VALUES (?1, ?2)", params![input.product_id, id]);
    let remove_other = |id: i64| tx.execute("DELETE FROM product_locations WHERE product_id = ?1 AND location_id = ?2", params![input.product_id, id]);
    match input.from_location_id {
        Some(from) if from == target => {}
        Some(from) => {
            if primary == Some(from) {
                set_primary(Some(target))?;
                remove_other(target)?;
            } else {
                if remove_other(from)? == 0 {
                    return invalid("Ce produit n'est plus à cet endroit : actualisez le plan.");
                }
                if primary != Some(target) {
                    add_other(target)?;
                }
            }
        }
        None => match primary {
            None => {
                set_primary(Some(target))?;
                remove_other(target)?;
            }
            Some(p) if p == target => {}
            Some(p) => {
                if input.primary == Some(true) {
                    set_primary(Some(target))?;
                    remove_other(target)?;
                    add_other(p)?;
                } else {
                    add_other(target)?;
                }
            }
        },
    }
    let place = slot_text(&tx, target)?;
    audit::log(&tx, user, "Rangement d'un produit", "plan", Some(input.product_id), format!("{name} → {place}"))?;
    tx.commit()?;
    product_places(conn, input.product_id)
}

/// Retire (« prend ») un produit d'une case. S'il s'agissait de l'emplacement principal,
/// son plus ancien autre emplacement le remplace.
pub fn take(conn: &mut Connection, user: &SessionUser, product_id: i64, location_id: i64) -> AppResult<Vec<Place>> {
    let (name, primary) = current_primary(conn, product_id)?;
    let place = slot_text(conn, location_id)?;
    let tx = conn.transaction()?;
    if primary == Some(location_id) {
        let next: Option<i64> = tx
            .query_row(
                "SELECT location_id FROM product_locations WHERE product_id = ?1 ORDER BY created_at, location_id LIMIT 1",
                [product_id],
                |r| r.get(0),
            )
            .optional()?;
        tx.execute("UPDATE products SET location_id = ?1, updated_at = ?2 WHERE id = ?3", params![next, db::now(), product_id])?;
        if let Some(n) = next {
            tx.execute("DELETE FROM product_locations WHERE product_id = ?1 AND location_id = ?2", params![product_id, n])?;
        }
    } else if tx.execute("DELETE FROM product_locations WHERE product_id = ?1 AND location_id = ?2", params![product_id, location_id])? == 0 {
        return invalid("Ce produit n'est pas rangé à cet endroit.");
    }
    audit::log(&tx, user, "Retrait d'un produit", "plan", Some(product_id), format!("{name} ← {place}"))?;
    tx.commit()?;
    product_places(conn, product_id)
}

/// Fait d'un autre emplacement l'emplacement principal du produit.
pub fn set_primary(conn: &mut Connection, user: &SessionUser, product_id: i64, location_id: i64) -> AppResult<Vec<Place>> {
    let (name, primary) = current_primary(conn, product_id)?;
    if primary == Some(location_id) {
        return product_places(conn, product_id);
    }
    let tx = conn.transaction()?;
    if tx.execute("DELETE FROM product_locations WHERE product_id = ?1 AND location_id = ?2", params![product_id, location_id])? == 0 {
        return invalid("Ce produit n'est pas rangé à cet endroit.");
    }
    if let Some(p) = primary {
        tx.execute("INSERT OR IGNORE INTO product_locations (product_id, location_id) VALUES (?1, ?2)", params![product_id, p])?;
    }
    tx.execute("UPDATE products SET location_id = ?1, updated_at = ?2 WHERE id = ?3", params![location_id, db::now(), product_id])?;
    let place = slot_text(&tx, location_id)?;
    audit::log(&tx, user, "Emplacement principal changé", "plan", Some(product_id), format!("{name} → {place}"))?;
    tx.commit()?;
    product_places(conn, product_id)
}
