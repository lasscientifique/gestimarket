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
use crate::services::{audit, settings, templates};
use crate::state::SessionUser;

pub const MAX_LEVELS: i64 = 30;
pub const MAX_SECTIONS: i64 = 30;
const CATEGORIES: &[&str] = &["rayon", "froid", "presentation", "rangement", "zone", "batiment"];
const FLOOR_STYLES: &[&str] = &["tiles", "concrete", "wood", "vinyl"];

#[derive(Debug, Serialize)]
pub struct Floor {
    pub id: i64,
    pub name: String,
    pub sort: i64,
    pub width: f64,
    pub depth: f64,
    /// Hauteur des murs (mètres) et sol (tiles, concrete, wood, vinyl) pour la vue 3D.
    pub wall_height: f64,
    pub floor_style: String,
    /// Dessin du bâtiment en fond (image) et son cadrage {x, y, w, h, opacity} en mètres.
    pub backdrop_id: Option<i64>,
    pub backdrop: Option<serde_json::Value>,
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
    /// Forme 3D : code d'un meuble de base (gondole, refrigerateur…).
    pub model: String,
    /// Hauteur par défaut (mètres).
    pub height: f64,
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
    /// Forme 3D (celle du type) et hauteur (celle du meuble, sinon celle du type).
    pub model: String,
    pub height: f64,
    pub custom_height: Option<f64>,
}

#[derive(Debug, Serialize)]
pub struct Plan {
    pub floors: Vec<Floor>,
    pub types: Vec<FixtureType>,
    pub fixtures: Vec<Fixture>,
}

const TYPE_SELECT: &str = "SELECT t.id, t.code, t.name, t.category, t.prefix, t.color, t.width, t.depth, t.levels, t.sections,
        t.storage, t.builtin, t.sort, (SELECT COUNT(*) FROM fixtures f WHERE f.type_id = t.id), t.model, t.height
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
        model: r.get(14)?,
        height: r.get(15)?,
    })
}

const FIXTURE_SELECT: &str = "SELECT f.id, f.floor_id, f.type_id, t.code, t.name, t.category, t.storage, f.code, f.name,
        f.x, f.y, f.w, f.h, f.rotation, COALESCE(NULLIF(f.color, ''), t.color), NULLIF(f.color, ''), f.levels, f.sections, f.notes,
        COALESCE(NULLIF(t.model, ''), t.code), COALESCE(f.height, t.height), f.height
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
        model: r.get(19)?,
        height: r.get(20)?,
        custom_height: r.get(21)?,
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
    let mut stmt =
        conn.prepare("SELECT id, name, sort, width, depth, wall_height, floor_style, backdrop_id, backdrop FROM store_floors ORDER BY sort, id")?;
    let floors = stmt
        .query_map([], |r| {
            Ok(Floor {
                id: r.get(0)?,
                name: r.get(1)?,
                sort: r.get(2)?,
                width: r.get(3)?,
                depth: r.get(4)?,
                wall_height: r.get(5)?,
                floor_style: r.get(6)?,
                backdrop_id: r.get(7)?,
                backdrop: r.get::<_, Option<String>>(8)?.and_then(|b| serde_json::from_str(&b).ok()),
            })
        })?
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

#[derive(Debug, Default, Deserialize)]
pub struct FloorInput {
    pub name: String,
    pub width: f64,
    pub depth: f64,
    #[serde(default)]
    pub wall_height: Option<f64>,
    #[serde(default)]
    pub floor_style: Option<String>,
}

pub fn save_floor(conn: &Connection, user: &SessionUser, id: Option<i64>, input: FloorInput) -> AppResult<i64> {
    let name = input.name.trim();
    if name.is_empty() {
        return invalid("Donnez un nom au niveau (ex. Rez-de-chaussée, 1er étage, Entrepôt).");
    }
    if !(2.0..=500.0).contains(&input.width) || !(2.0..=500.0).contains(&input.depth) {
        return invalid("Dimensions du niveau : de 2 à 500 mètres.");
    }
    if input.wall_height.is_some_and(|h| !(2.0..=12.0).contains(&h)) {
        return invalid("Hauteur des murs : de 2 à 12 mètres.");
    }
    if input.floor_style.as_deref().is_some_and(|s| !FLOOR_STYLES.contains(&s)) {
        return invalid("Revêtement de sol inconnu.");
    }
    let id = match id {
        Some(id) => {
            conn.execute(
                "UPDATE store_floors SET name = ?1, width = ?2, depth = ?3, wall_height = COALESCE(?4, wall_height),
                        floor_style = COALESCE(?5, floor_style) WHERE id = ?6",
                params![name, input.width, input.depth, input.wall_height, input.floor_style, id],
            )?;
            id
        }
        None => {
            let sort: i64 = conn.query_row("SELECT COALESCE(MAX(sort), -1) + 1 FROM store_floors", [], |r| r.get(0))?;
            conn.execute(
                "INSERT INTO store_floors (name, sort, width, depth, wall_height, floor_style) VALUES (?1, ?2, ?3, ?4, COALESCE(?5, 3.0), COALESCE(?6, 'tiles'))",
                params![name, sort, input.width, input.depth, input.wall_height, input.floor_style],
            )?;
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
    let backdrop: Option<i64> = conn.query_row("SELECT backdrop_id FROM store_floors WHERE id = ?1", [id], |r| r.get(0)).optional()?.flatten();
    let n = conn.execute("DELETE FROM store_floors WHERE id = ?1", [id])?;
    if n == 0 {
        return invalid("Niveau introuvable.");
    }
    // Le dessin du bâtiment de ce niveau n'est plus utilisé.
    crate::services::media::cleanup(conn, backdrop)?;
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
    /// Hauteur propre (mètres) ; 0 : celle du type.
    pub height: Option<f64>,
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

/// Hauteur d'un meuble : vide ou 0 = celle de son type.
fn check_height(h: Option<f64>) -> AppResult<Option<f64>> {
    match h {
        None => Ok(None),
        Some(h) if h <= 0.0 => Ok(None),
        Some(h) if h.is_finite() && h <= 20.0 => Ok(Some(h)),
        Some(_) => invalid("Hauteur du meuble : 20 mètres au plus."),
    }
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
    // Meuble : « Gondole GO1 » ; pièce, mur, porte… : « Salle de vente » (le code reste interne).
    let name = db::clean(&input.name).unwrap_or_else(|| {
        if t.storage {
            format!("{} {code}", short_name(&t.name))
        } else {
            short_name(&t.name).to_string()
        }
    });
    let (levels, sections) = if t.storage {
        (input.levels.unwrap_or(t.levels).clamp(1, MAX_LEVELS), input.sections.unwrap_or(t.sections).clamp(1, MAX_SECTIONS))
    } else {
        (1, 1)
    };
    let color = check_color(&input.color)?;
    let height = check_height(input.height)?;
    conn.execute(
        "INSERT INTO fixtures (floor_id, type_id, code, name, x, y, w, h, rotation, color, levels, sections, notes, height)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
        params![
            floor_id, t.id, code, name, x, y, w, h, norm_rotation(input.rotation.unwrap_or(0)), color, levels, sections,
            db::clean(&input.notes), height
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
    let height = match input.height {
        Some(_) => check_height(input.height)?,
        None => cur.custom_height,
    };
    let rotation = norm_rotation(input.rotation.unwrap_or(cur.rotation));
    if floor_id != cur.floor_id || x != cur.x || y != cur.y || w != cur.w || h != cur.h || rotation != cur.rotation {
        check_places(&tx, &[(id, floor_id, rect_of(x, y, w, h, rotation))])?;
    }
    tx.execute(
        "UPDATE fixtures SET floor_id = ?1, code = ?2, name = ?3, x = ?4, y = ?5, w = ?6, h = ?7, rotation = ?8, color = ?9,
                levels = ?10, sections = ?11, notes = ?12, updated_at = ?13, height = ?15
         WHERE id = ?14",
        params![floor_id, code, name, x, y, w, h, rotation, color, levels, sections, notes, db::now(), id, height],
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
/// Refusé si un meuble sortirait de son niveau ou chevaucherait un autre meuble (voir `check_places`).
pub fn move_fixtures(conn: &mut Connection, items: Vec<Geometry>) -> AppResult<()> {
    let tx = conn.transaction()?;
    let mut moves = Vec::new();
    for g in &items {
        check_size(g.w, g.h)?;
        if !g.x.is_finite() || !g.y.is_finite() || g.x.abs() > 1000.0 || g.y.abs() > 1000.0 {
            return invalid("Position invalide.");
        }
        let floor: Option<i64> = tx.query_row("SELECT floor_id FROM fixtures WHERE id = ?1", [g.id], |r| r.get(0)).optional()?;
        if let Some(floor_id) = floor {
            moves.push((g.id, floor_id, rect_of(g.x, g.y, g.w, g.h, norm_rotation(g.rotation))));
        }
    }
    check_places(&tx, &moves)?;
    for g in &items {
        tx.execute(
            "UPDATE fixtures SET x = ?1, y = ?2, w = ?3, h = ?4, rotation = ?5, updated_at = ?6 WHERE id = ?7",
            params![g.x, g.y, g.w, g.h, norm_rotation(g.rotation), db::now(), g.id],
        )?;
    }
    tx.commit()?;
    Ok(())
}

// ───────────────────────────── Places libres (chevauchements) ─────────────────────────────

/// Emprise au sol : (x, y, largeur, profondeur) en mètres.
type Rect = (f64, f64, f64, f64);

/// Tolérance : deux meubles qui se touchent (ou presque) ne se chevauchent pas.
const TOUCH: f64 = 0.02;

/// Meuble d'un niveau, pour les contrôles de place.
struct Spot {
    id: i64,
    floor_id: i64,
    name: String,
    /// Pièce, texte, mur, porte, fenêtre… : se pose librement, comme dans la vue 3D.
    free: bool,
    /// Gêne la pose d'un meuble : tout sauf les pièces, les textes et les portes.
    obstacle: bool,
    rect: Rect,
}

/// Emprise au sol d'un meuble posé au coin (x, y), de taille w × h, tourné d'un quart de tour ou non.
fn rect_of(x: f64, y: f64, w: f64, h: f64, rot: i64) -> Rect {
    footprint(x + w / 2.0, y + h / 2.0, w, h, rot)
}

fn clash(a: Rect, b: Rect) -> bool {
    a.0 + TOUCH < b.0 + b.2 && b.0 + TOUCH < a.0 + a.2 && a.1 + TOUCH < b.1 + b.3 && b.1 + TOUCH < a.1 + a.3
}

fn inside(r: Rect, fw: f64, fd: f64) -> bool {
    r.0 >= -TOUCH && r.1 >= -TOUCH && r.0 + r.2 <= fw + TOUCH && r.1 + r.3 <= fd + TOUCH
}

fn spots(conn: &Connection, filter: &str, value: i64) -> AppResult<Vec<Spot>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT f.id, f.floor_id, f.name, t.category, COALESCE(NULLIF(t.model, ''), t.code), f.x, f.y, f.w, f.h, f.rotation
         FROM fixtures f JOIN fixture_types t ON t.id = f.type_id WHERE {filter}"
    ))?;
    let rows = stmt.query_map([value], |r| {
        let category: String = r.get(3)?;
        let model: String = r.get(4)?;
        Ok(Spot {
            id: r.get(0)?,
            floor_id: r.get(1)?,
            name: r.get(2)?,
            free: category == "zone" || category == "batiment" || model == "texte",
            obstacle: !(category == "zone" || model == "texte" || model == "porte"),
            rect: rect_of(r.get(5)?, r.get(6)?, r.get(7)?, r.get(8)?, r.get(9)?),
        })
    })?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

/// Nouvelles places de meubles (id, niveau, emprise) : aucun meuble ne sort de son niveau ni n'en chevauche
/// un autre. Les meubles déplacés ensemble sont contrôlés à leurs nouvelles places. Ce qui était déjà ainsi
/// avant le déplacement (plan dessiné avant la 0.17) reste permis.
fn check_places(conn: &Connection, moves: &[(i64, i64, Rect)]) -> AppResult<()> {
    let moved: HashMap<i64, (i64, Rect)> = moves.iter().map(|&(id, floor, r)| (id, (floor, r))).collect();
    let mut floors: Vec<i64> = moves.iter().map(|m| m.1).collect();
    floors.sort_unstable();
    floors.dedup();
    for floor_id in floors {
        let (fw, fd) = floor_size(conn, floor_id)?;
        let floor_name: String = conn.query_row("SELECT name FROM store_floors WHERE id = ?1", [floor_id], |r| r.get(0))?;
        let mut list = spots(conn, "f.floor_id = ?1", floor_id)?;
        // Meubles qui arrivent d'un autre niveau.
        for (&id, &(floor, _)) in &moved {
            if floor == floor_id && !list.iter().any(|s| s.id == id) {
                list.extend(spots(conn, "f.id = ?1", id)?);
            }
        }
        // Place sur ce niveau après le déplacement, et avant.
        let now = |s: &Spot| match moved.get(&s.id) {
            Some(&(floor, r)) => (floor == floor_id).then_some(r),
            None => Some(s.rect),
        };
        let was = |s: &Spot| (s.floor_id == floor_id).then_some(s.rect);
        for s in &list {
            let Some(&(floor, r)) = moved.get(&s.id) else { continue };
            if floor != floor_id || s.free {
                continue;
            }
            if !inside(r, fw, fd) && was(s).map_or(true, |w| inside(w, fw, fd)) {
                return invalid(format!("{} sortirait du niveau « {} » : le meuble revient à sa place.", s.name, floor_name));
            }
            for o in &list {
                if o.id == s.id || !o.obstacle {
                    continue;
                }
                let Some(ro) = now(o) else { continue };
                let before = matches!((was(s), was(o)), (Some(a), Some(b)) if clash(a, b));
                if clash(r, ro) && !before {
                    return invalid(format!("Place occupée par {} : le meuble revient à sa place.", o.name));
                }
            }
        }
    }
    Ok(())
}

/// Place libre la plus proche de (x, y) pour un meuble w × h : recherche par pas de 10 cm jusqu'à 6 m,
/// sinon la première place libre du niveau.
fn nearest_free(conn: &Connection, floor_id: i64, w: f64, h: f64, rot: i64, x: f64, y: f64) -> AppResult<(f64, f64)> {
    let (fw, fd) = floor_size(conn, floor_id)?;
    let obstacles: Vec<Rect> = spots(conn, "f.floor_id = ?1", floor_id)?.into_iter().filter(|s| s.obstacle).map(|s| s.rect).collect();
    let fits = |px: f64, py: f64| {
        let r = rect_of(px, py, w, h, rot);
        inside(r, fw, fd) && !obstacles.iter().any(|o| clash(r, *o))
    };
    if fits(x, y) {
        return Ok((x, y));
    }
    let mut offsets: Vec<(i32, i32)> = (-60..=60).flat_map(|i| (-60..=60).map(move |j| (i, j))).filter(|&(i, j)| i * i + j * j <= 3600).collect();
    offsets.sort_by_key(|&(i, j)| (i * i + j * j, j, i));
    for (i, j) in offsets {
        let (px, py) = (r2(x + f64::from(i) * 0.1), r2(y + f64::from(j) * 0.1));
        if fits(px, py) {
            return Ok((px, py));
        }
    }
    free_spot(conn, floor_id, w, h)
}

/// Meuble posé par l'utilisateur (palette, dupliquer, répéter) : s'il tombe sur un autre meuble,
/// il prend la place libre la plus proche.
pub fn create_fixture_free(conn: &Connection, user: Option<&SessionUser>, mut input: FixtureInput) -> AppResult<Fixture> {
    if let (Some(x), Some(y), Some(type_id)) = (input.x, input.y, input.type_id) {
        let t = get_type(conn, type_id)?;
        let model = if t.model.is_empty() { t.code.as_str() } else { t.model.as_str() };
        if !(t.category == "zone" || t.category == "batiment" || model == "texte") {
            let floor_id = match input.floor_id {
                Some(f) => f,
                None => conn.query_row("SELECT id FROM store_floors ORDER BY sort, id LIMIT 1", [], |r| r.get(0))?,
            };
            let (fw, fd) = floor_size(conn, floor_id)?;
            let (w, h) = (input.w.unwrap_or(t.width), input.h.unwrap_or(t.depth));
            check_size(w, h)?;
            let (x, y) = (x.clamp(0.0, (fw - w).max(0.0)), y.clamp(0.0, (fd - h).max(0.0)));
            let (x, y) = nearest_free(conn, floor_id, w, h, norm_rotation(input.rotation.unwrap_or(0)), x, y)?;
            input.floor_id = Some(floor_id);
            input.x = Some(x);
            input.y = Some(y);
        }
    }
    create_fixture(conn, user, input)
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

#[derive(Debug, Default, Deserialize)]
pub struct TypeInput {
    pub name: String,
    pub category: String,
    pub prefix: String,
    pub color: String,
    pub width: f64,
    pub depth: f64,
    pub levels: i64,
    pub sections: i64,
    /// Forme 3D : code d'un meuble de base (vide : selon la famille).
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub height: Option<f64>,
}

/// Forme 3D proposée pour une famille de meubles.
fn default_model(category: &str) -> &'static str {
    match category {
        "rayon" => "etagere_murale",
        "froid" => "refrigerateur",
        "presentation" => "presentoir",
        "rangement" => "armoire",
        "zone" => "zone_autre",
        _ => "texte",
    }
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
    let model = db::clean(&input.model).unwrap_or_else(|| default_model(&input.category).to_string());
    let known: bool = conn.query_row("SELECT EXISTS(SELECT 1 FROM fixture_types WHERE builtin = 1 AND code = ?1)", [&model], |r| r.get(0))?;
    if !known {
        return invalid("Forme 3D inconnue.");
    }
    let height = match input.height {
        Some(h) if h.is_finite() && (0.0..=20.0).contains(&h) => h,
        Some(_) => return invalid("Hauteur du meuble : 20 mètres au plus."),
        None if input.category == "zone" => 0.02,
        None => 1.8,
    };
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
                "UPDATE fixture_types SET name = ?1, category = ?2, prefix = ?3, color = ?4, width = ?5, depth = ?6, levels = ?7, sections = ?8, storage = ?9,
                        model = ?11, height = ?12
                 WHERE id = ?10",
                params![name, input.category, prefix, color, input.width, input.depth, levels, sections, storage, id, model, height],
            )?;
            id
        }
        None => {
            let code = format!("perso_{}", chrono::Local::now().format("%Y%m%d%H%M%S%3f"));
            conn.execute(
                "INSERT INTO fixture_types (code, name, category, prefix, color, width, depth, levels, sections, storage, builtin, sort, model, height)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 0, 100, ?11, ?12)",
                params![code, name, input.category, prefix, color, input.width, input.depth, levels, sections, storage, model, height],
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

// ───────────────────────────── Vue 3D : contenu des cases d'un niveau ─────────────────────────────

/// Case garnie d'un meuble (vue 3D) : nombre de produits, couleur de la catégorie et photo du premier.
#[derive(Debug, Serialize)]
pub struct CellFill {
    pub fixture_id: i64,
    pub level: i64,
    pub section: i64,
    pub products: i64,
    pub color: Option<String>,
    pub image_id: Option<i64>,
}

pub fn floor_fill(conn: &Connection, floor_id: i64) -> AppResult<Vec<CellFill>> {
    let mut stmt = conn.prepare(
        "SELECT l.fixture_id, l.level, l.section, c.color, p.image_id FROM (
             SELECT id AS pid, location_id AS lid FROM products WHERE active = 1 AND location_id IS NOT NULL
             UNION
             SELECT pl.product_id, pl.location_id FROM product_locations pl JOIN products pp ON pp.id = pl.product_id WHERE pp.active = 1
         ) x
         JOIN locations l ON l.id = x.lid
         JOIN fixtures f ON f.id = l.fixture_id
         JOIN products p ON p.id = x.pid
         LEFT JOIN categories c ON c.id = p.category_id
         WHERE f.floor_id = ?1
         ORDER BY l.fixture_id, l.level, l.section, p.image_id IS NULL, p.name COLLATE NOCASE",
    )?;
    let rows = stmt.query_map([floor_id], |r| {
        Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?, r.get::<_, i64>(2)?, r.get::<_, Option<String>>(3)?, r.get::<_, Option<i64>>(4)?))
    })?;
    let mut cells: Vec<CellFill> = Vec::new();
    for row in rows {
        let (fixture_id, level, section, color, image_id) = row?;
        match cells.last_mut() {
            Some(c) if c.fixture_id == fixture_id && c.level == level && c.section == section => c.products += 1,
            _ => cells.push(CellFill { fixture_id, level, section, products: 1, color, image_id }),
        }
    }
    Ok(cells)
}

// ───────────────────────────── État du stock et ventes sur le plan ─────────────────────────────

/// Produits d'un meuble à signaler : en rupture, en stock bas (stock ≤ stock minimum),
/// qui périment dans les N jours du réglage (ou sont périmés).
#[derive(Debug, Serialize)]
pub struct FixtureStatus {
    pub fixture_id: i64,
    pub products: i64,
    pub out_of_stock: i64,
    pub low_stock: i64,
    pub expiring: i64,
    /// Produits différents à signaler (un produit en stock bas qui périme compte une fois).
    pub alerts: i64,
}

/// Case à signaler (vue 3D) : « out », « low » ou « expiring », le plus grave.
#[derive(Debug, Serialize)]
pub struct CellStatus {
    pub fixture_id: i64,
    pub level: i64,
    pub section: i64,
    pub status: &'static str,
}

#[derive(Debug, Serialize)]
pub struct FloorStatus {
    /// Délai d'alerte de péremption (Paramètres), en jours.
    pub alert_days: i64,
    pub fixtures: Vec<FixtureStatus>,
    pub cells: Vec<CellStatus>,
}

/// Produits rangés (emplacement principal et autres) avec leur état : rupture, stock bas, péremption proche.
/// Mêmes règles que le tableau de bord. ?2 : « +N days ».
const PLACED_STATE: &str = "SELECT l.fixture_id, l.level, l.section, p.id,
        (p.track_stock = 1 AND p.stock <= 0),
        (p.track_stock = 1 AND p.stock > 0 AND p.stock <= p.min_stock),
        (p.stock > 0 AND p.expiry_date IS NOT NULL AND p.expiry_date <> '' AND p.expiry_date <= date('now', 'localtime', ?2)),
        p.name, p.unit, p.stock, p.min_stock, NULLIF(p.expiry_date, ''), l.etage, l.rangee
    FROM (
        SELECT id AS pid, location_id AS lid FROM products WHERE active = 1 AND location_id IS NOT NULL
        UNION
        SELECT pl.product_id, pl.location_id FROM product_locations pl JOIN products pp ON pp.id = pl.product_id WHERE pp.active = 1
    ) x
    JOIN locations l ON l.id = x.lid
    JOIN fixtures f ON f.id = l.fixture_id
    JOIN products p ON p.id = x.pid";

/// Gravité : 3 rupture, 2 stock bas, 1 péremption proche, 0 rien à signaler.
fn severity(out: bool, low: bool, expiring: bool) -> u8 {
    if out {
        3
    } else if low {
        2
    } else if expiring {
        1
    } else {
        0
    }
}

fn severity_name(s: u8) -> &'static str {
    match s {
        3 => "out",
        2 => "low",
        _ => "expiring",
    }
}

struct PlacedState {
    fixture_id: i64,
    level: i64,
    section: i64,
    product_id: i64,
    out: bool,
    low: bool,
    expiring: bool,
    name: String,
    unit: String,
    stock: f64,
    min_stock: f64,
    expiry_date: Option<String>,
    etage: String,
    rangee: String,
}

fn placed_states(conn: &Connection, filter: &str, value: i64) -> AppResult<(i64, Vec<PlacedState>)> {
    let alert_days = settings::get_i64(conn, "expiry_alert_days")?.max(0);
    let mut stmt = conn.prepare(&format!("{PLACED_STATE} WHERE {filter} ORDER BY l.fixture_id, l.level, l.section"))?;
    let rows = stmt.query_map(params![value, format!("+{alert_days} days")], |r| {
        Ok(PlacedState {
            fixture_id: r.get(0)?,
            level: r.get(1)?,
            section: r.get(2)?,
            product_id: r.get(3)?,
            out: r.get::<_, Option<bool>>(4)?.unwrap_or(false),
            low: r.get::<_, Option<bool>>(5)?.unwrap_or(false),
            expiring: r.get::<_, Option<bool>>(6)?.unwrap_or(false),
            name: r.get(7)?,
            unit: r.get(8)?,
            stock: r.get(9)?,
            min_stock: r.get(10)?,
            expiry_date: r.get(11)?,
            etage: r.get::<_, Option<String>>(12)?.unwrap_or_default(),
            rangee: r.get::<_, Option<String>>(13)?.unwrap_or_default(),
        })
    })?;
    Ok((alert_days, rows.collect::<Result<Vec<_>, _>>()?))
}

/// État du stock des meubles d'un niveau (affichage « État du stock » du plan).
pub fn floor_status(conn: &Connection, floor_id: i64) -> AppResult<FloorStatus> {
    let (alert_days, rows) = placed_states(conn, "f.floor_id = ?1", floor_id)?;
    // Un produit rangé dans deux cases d'un même meuble compte une fois pour le meuble.
    let mut per: std::collections::BTreeMap<i64, [std::collections::HashSet<i64>; 5]> = std::collections::BTreeMap::new();
    let mut cells: std::collections::BTreeMap<(i64, i64, i64), u8> = std::collections::BTreeMap::new();
    for p in &rows {
        let sets = per.entry(p.fixture_id).or_default();
        sets[0].insert(p.product_id);
        for (i, on) in [p.out, p.low, p.expiring].into_iter().enumerate() {
            if on {
                sets[i + 1].insert(p.product_id);
            }
        }
        let s = severity(p.out, p.low, p.expiring);
        if s > 0 {
            sets[4].insert(p.product_id);
            let c = cells.entry((p.fixture_id, p.level, p.section)).or_insert(0);
            *c = (*c).max(s);
        }
    }
    Ok(FloorStatus {
        alert_days,
        fixtures: per
            .into_iter()
            .map(|(fixture_id, s)| FixtureStatus {
                fixture_id,
                products: s[0].len() as i64,
                out_of_stock: s[1].len() as i64,
                low_stock: s[2].len() as i64,
                expiring: s[3].len() as i64,
                alerts: s[4].len() as i64,
            })
            .collect(),
        cells: cells
            .into_iter()
            .map(|((fixture_id, level, section), s)| CellStatus { fixture_id, level, section, status: severity_name(s) })
            .collect(),
    })
}

/// Produit d'un meuble à signaler, avec sa case.
#[derive(Debug, Serialize)]
pub struct StockAlert {
    pub product_id: i64,
    pub name: String,
    pub unit: String,
    pub stock: f64,
    pub min_stock: f64,
    pub expiry_date: Option<String>,
    /// « out », « low » ou « expiring » (le plus grave) ; `expiring` : péremption proche en plus.
    pub status: &'static str,
    pub expiring: bool,
    pub etage: String,
    pub rangee: String,
}

/// Produits à signaler d'un meuble : rupture, puis stock bas, puis péremption proche.
pub fn fixture_alerts(conn: &Connection, fixture_id: i64) -> AppResult<Vec<StockAlert>> {
    let (_, rows) = placed_states(conn, "l.fixture_id = ?1", fixture_id)?;
    let mut seen = std::collections::HashSet::new();
    let mut list: Vec<(u8, StockAlert)> = Vec::new();
    for p in rows {
        let s = severity(p.out, p.low, p.expiring);
        if s == 0 || !seen.insert(p.product_id) {
            continue;
        }
        list.push((
            s,
            StockAlert {
                product_id: p.product_id,
                name: p.name,
                unit: p.unit,
                stock: p.stock,
                min_stock: p.min_stock,
                expiry_date: p.expiry_date,
                status: severity_name(s),
                expiring: p.expiring,
                etage: p.etage,
                rangee: p.rangee,
            },
        ));
    }
    list.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| a.1.name.to_lowercase().cmp(&b.1.name.to_lowercase())));
    Ok(list.into_iter().map(|(_, a)| a).collect())
}

/// Ventes d'un meuble sur une période (produits attribués à leur emplacement principal actuel).
#[derive(Debug, Serialize)]
pub struct FixtureSales {
    pub fixture_id: i64,
    pub revenue: i64,
    pub margin: i64,
    pub quantity: f64,
    /// Produits différents vendus.
    pub products: i64,
}

#[derive(Debug, Serialize)]
pub struct SalesMap {
    pub from: String,
    pub to: String,
    /// Chiffre d'affaires de la période, et part des produits non rangés.
    pub total: i64,
    pub unplaced: i64,
    pub fixtures: Vec<FixtureSales>,
}

/// Carte des ventes : chiffre d'affaires et marge de chaque meuble entre deux dates (AAAA-MM-JJ, incluses).
pub fn sales_map(conn: &Connection, from: &str, to: &str) -> AppResult<SalesMap> {
    let parse = |d: &str| chrono::NaiveDate::parse_from_str(d, "%Y-%m-%d");
    let (Ok(start), Ok(end)) = (parse(from), parse(to)) else {
        return invalid("Date invalide (format AAAA-MM-JJ).");
    };
    if start > end {
        return invalid("La date de début est après la date de fin.");
    }
    let alloc = crate::services::reports::ALLOCATED;
    let mut stmt = conn.prepare(&format!(
        "SELECT l.fixture_id, CAST(ROUND(SUM({alloc})) AS INTEGER),
                CAST(ROUND(SUM({alloc} - COALESCE(si.base_quantity, si.quantity) * si.unit_cost)) AS INTEGER),
                SUM(COALESCE(si.base_quantity, si.quantity)), COUNT(DISTINCT si.product_id)
         FROM sale_items si
         JOIN sales s ON s.id = si.sale_id
         JOIN products p ON p.id = si.product_id
         LEFT JOIN locations l ON l.id = p.location_id
         WHERE s.status = 'completed' AND s.created_at >= ?1 AND s.created_at < date(?2, '+1 day')
         GROUP BY l.fixture_id"
    ))?;
    let rows = stmt.query_map(params![from, to], |r| {
        Ok((
            r.get::<_, Option<i64>>(0)?,
            FixtureSales {
                fixture_id: 0,
                revenue: r.get::<_, Option<i64>>(1)?.unwrap_or(0),
                margin: r.get::<_, Option<i64>>(2)?.unwrap_or(0),
                quantity: r.get::<_, Option<f64>>(3)?.unwrap_or(0.0),
                products: r.get(4)?,
            },
        ))
    })?;
    let (mut total, mut unplaced, mut fixtures) = (0, 0, Vec::new());
    for row in rows {
        let (fixture, mut s) = row?;
        total += s.revenue;
        match fixture {
            Some(id) => {
                s.fixture_id = id;
                fixtures.push(s);
            }
            None => unplaced += s.revenue,
        }
    }
    fixtures.sort_by(|a, b| b.revenue.cmp(&a.revenue));
    Ok(SalesMap { from: from.to_string(), to: to.to_string(), total, unplaced, fixtures })
}

// ───────────────────────────── Assistant « Créer ma boutique » ─────────────────────────────

#[derive(Debug, Default, Deserialize)]
pub struct LayoutInput {
    /// Niveau à remplacer (sans produits rangés) ; vide : nouveau niveau.
    #[serde(default)]
    pub floor_id: Option<i64>,
    #[serde(default)]
    pub name: Option<String>,
    /// Dimensions intérieures de la salle (mètres) : largeur de gauche à droite, profondeur de haut en bas.
    pub width: f64,
    pub depth: f64,
    /// Hauteur sous plafond (mètres) : hauteur des murs ; un meuble plus haut est abaissé.
    #[serde(default)]
    pub height: Option<f64>,
    /// Côté de l'entrée sur le plan : bottom, top, left, right.
    pub entry: String,
    #[serde(default)]
    pub storage_room: bool,
    /// Niveau à l'étage : on y arrive par un escalier (ni porte d'entrée ni caisse).
    #[serde(default)]
    pub upstairs: bool,
    /// Un seul type de commerce (vide : ceux de la boutique).
    #[serde(default)]
    pub business_type: Option<String>,
    /// Activités de la boutique, la principale d'abord (3 au plus) ; vide : celles de la boutique.
    #[serde(default)]
    pub activities: Option<Vec<String>>,
}

/// Meuble à poser dans le repère « entrée en bas » de la salle : centre, taille et rotation.
struct Piece {
    code: &'static str,
    cx: f64,
    cy: f64,
    w: f64,
    h: f64,
    rot: i64,
    sections: Option<i64>,
    /// Nom et couleur propres (rayon d'une activité).
    name: Option<String>,
    color: Option<&'static str>,
}

fn pc(code: &'static str, cx: f64, cy: f64, w: f64, h: f64, rot: i64) -> Piece {
    Piece { code, cx, cy, w, h, rot, sections: None, name: None, color: None }
}

/// Emprise au sol (x, y, largeur, profondeur) d'un rectangle tourné d'un quart de tour ou non.
fn footprint(cx: f64, cy: f64, w: f64, h: f64, rot: i64) -> (f64, f64, f64, f64) {
    let (fw, fh) = if rot.rem_euclid(180) == 90 { (h, w) } else { (w, h) };
    (cx - fw / 2.0, cy - fh / 2.0, fw, fh)
}

fn is_structure(code: &str) -> bool {
    code == "mur" || code == "porte" || code.starts_with("zone_")
}

/// Activité d'une salle partagée : nom de son rayon et meubles proposés.
struct Activity {
    label: String,
    palette: Vec<&'static str>,
}

/// Couleurs des rayons au sol, dans l'ordre des activités.
const DEPT_COLORS: [&str; 3] = ["#dbeafe", "#fef3c7", "#dcfce7"];

/// Part de la salle de chaque activité, la principale d'abord.
fn shares(n: usize) -> &'static [f64] {
    match n {
        0 | 1 => &[1.0],
        2 => &[0.6, 0.4],
        _ => &[0.5, 0.25, 0.25],
    }
}

/// Ce que les rayons partagent : la salle, la réserve au fond à droite, l'entrée au milieu du bas.
struct Room {
    lw: f64,
    ld: f64,
    reserve: bool,
    sw: f64,
    sd: f64,
    dx: f64,
    door: f64,
    upstairs: bool,
    multi: bool,
}

/// Disposition proposée pour une salle lw × ld (entrée au milieu du mur du bas). Avec plusieurs
/// activités, la salle est partagée en rayons côte à côte (60/40 ou 50/25/25), chacun avec ses meubles.
fn layout_pieces(lw: f64, ld: f64, storage_room: bool, acts: &[Activity], upstairs: bool) -> Vec<Piece> {
    const T: f64 = 0.15; // épaisseur des murs, posés autour de la salle
    let reserve = storage_room && lw >= 6.0 && ld >= 6.0;
    let (sw, sd) = ((lw * 0.3).clamp(2.5, 6.0), (ld * 0.25).clamp(2.0, 5.0));
    let room = Room { lw, ld, reserve, sw, sd, dx: lw / 2.0, door: 1.6, upstairs, multi: acts.len() > 1 };
    let mut bands = Vec::new();
    let mut x = 0.0;
    for (i, share) in shares(acts.len()).iter().enumerate().take(acts.len().max(1)) {
        let x1 = if i + 1 >= acts.len() { lw } else { x + lw * share };
        bands.push((x, x1));
        x = x1;
    }
    let mut v: Vec<Piece> = Vec::new();

    // Sol : un rayon par activité (nommé, en couleur), sinon la salle de vente ; réserve au fond à droite.
    if room.multi {
        for (i, (a, (x0, x1))) in acts.iter().zip(&bands).enumerate() {
            let mut z = pc("zone_vente", (x0 + x1) / 2.0, ld / 2.0, x1 - x0, ld, 0);
            z.name = Some(a.label.clone());
            z.color = Some(DEPT_COLORS[i % DEPT_COLORS.len()]);
            v.push(z);
        }
    } else {
        v.push(pc("zone_vente", lw / 2.0, ld / 2.0, lw, ld, 0));
    }
    if reserve {
        v.push(pc("zone_reserve", lw - sw / 2.0, sd / 2.0, sw, sd, 0));
    }

    // Murs ; entrée (porte de 1,6 m au milieu du mur du bas) ou, à l'étage, escalier.
    let (door, dx) = (room.door, room.dx);
    v.push(pc("mur", lw / 2.0, -T / 2.0, lw + 2.0 * T, T, 0));
    v.push(pc("mur", -T / 2.0, ld / 2.0, T, ld, 0));
    v.push(pc("mur", lw + T / 2.0, ld / 2.0, T, ld, 0));
    if upstairs {
        v.push(pc("mur", lw / 2.0, ld + T / 2.0, lw + 2.0 * T, T, 0));
        v.push(pc("escalier", dx, ld - 1.25, 1.0, 2.3, 0));
    } else {
        let left_len = dx - door / 2.0 + T;
        v.push(pc("mur", -T + left_len / 2.0, ld + T / 2.0, left_len, T, 0));
        let right_len = lw + T - (dx + door / 2.0);
        v.push(pc("mur", dx + door / 2.0 + right_len / 2.0, ld + T / 2.0, right_len, T, 0));
        v.push(pc("porte", dx, ld + T / 2.0, door, 0.2, 0));
    }
    if reserve {
        // Cloison de la réserve avec sa porte, rack contre le mur du fond.
        let x0 = lw - sw;
        v.push(pc("mur", x0 - T / 2.0, sd / 2.0, T, sd, 0));
        let gap = 1.0;
        let wall_len = sw - gap - 0.1;
        v.push(pc("mur", x0 + 0.1 + gap + wall_len / 2.0, sd + T / 2.0, wall_len, T, 0));
        v.push(pc("porte", x0 + 0.1 + gap / 2.0, sd + T / 2.0, gap, 0.2, 0));
        let rl = (sw - 0.4).min(2.5);
        if rl >= 1.2 && sd >= 2.0 {
            let mut p = pc("rack", x0 + 0.2 + rl / 2.0, 0.55, rl, 1.0, 0);
            p.sections = Some(((rl * 1.2).round() as i64).max(1));
            v.push(p);
        }
    }

    // Caisse à droite de l'entrée (une seule pour toute la boutique).
    if !upstairs {
        let cash_x = (dx + door / 2.0 + 1.6).min(lw - 0.9);
        v.push(pc("caisse", cash_x, ld - 1.4, 1.2, 0.7, 0));
    }

    for (i, a) in acts.iter().enumerate() {
        department(&mut v, &a.palette, bands[i], i == 0, i + 1 == acts.len(), &room);
    }

    // Aucun meuble ne déborde de la salle ni n'en chevauche un autre.
    let mut kept: Vec<Piece> = Vec::new();
    for p in v {
        if !is_structure(p.code) {
            let a = footprint(p.cx, p.cy, p.w, p.h, p.rot);
            let inside = a.0 >= -1e-6 && a.1 >= -1e-6 && a.0 + a.2 <= lw + 1e-6 && a.1 + a.3 <= ld + 1e-6;
            let shrink = |r: (f64, f64, f64, f64)| (r.0 + 0.01, r.1 + 0.01, r.2 - 0.02, r.3 - 0.02);
            let clash = kept
                .iter()
                .filter(|k| !k.code.starts_with("zone_"))
                .any(|k| overlaps(shrink(a), shrink(footprint(k.cx, k.cy, k.w, k.h, k.rot))));
            if !inside || clash {
                continue;
            }
        }
        kept.push(p);
    }
    kept
}

/// Meubles d'une activité dans sa bande de salle [bx0, bx1] : froid au fond, étagères au mur,
/// allées du meuble principal, comptoir ou vitrine réfrigérée face aux clients.
fn department(v: &mut Vec<Piece>, palette: &[&'static str], (bx0, bx1): (f64, f64), first: bool, last: bool, r: &Room) {
    const AISLE: f64 = 1.3;
    let has = |c: &str| palette.iter().any(|p| *p == c);
    let first_two = &palette[..palette.len().min(2)];
    let (lw, ld) = (r.lw, r.ld);
    let bw = bx1 - bx0;
    let mid = (bx0 + bx1) / 2.0;

    // Comptoir réfrigéré face aux clients (boulangerie, boucherie…).
    let counter_showcase = palette.first() == Some(&"vitrine_refrigeree");
    if counter_showcase {
        let n = (((bw * 0.6) / 2.0).floor() as i64).clamp(1, 2);
        let total = n as f64 * 2.0;
        for i in 0..n {
            v.push(pc("vitrine_refrigeree", mid - total / 2.0 + 1.0 + i as f64 * 2.0, ld * 0.4, 2.0, 0.9, 0));
        }
    }

    // Froid le long du mur du fond (sans entrer dans la réserve).
    let back_end = if r.reserve && bx1 > lw - r.sw { (lw - r.sw - 0.4).min(bx1 - 0.3) } else { bx1 - 0.3 };
    let start = bx0 + 0.3;
    let mut x = start;
    let mut back_used = false;
    let cold = ["refrigerateur", "congelateur_armoire", "vitrine_refrigeree"]
        .into_iter()
        .find(|c| has(c) && !(counter_showcase && *c == "vitrine_refrigeree"));
    if let Some(code) = cold {
        let (uw, ud, max_n) = if code == "vitrine_refrigeree" { (2.0, 0.9, 2) } else { (0.7, 0.7, 8) };
        let limit = (start + (back_end - start) * 0.7).max(start + uw);
        let mut n = 0;
        while n < max_n && x + uw <= limit && x + uw <= back_end {
            v.push(pc(code, x + uw / 2.0, 0.05 + ud / 2.0, uw, ud, 0));
            x += uw;
            n += 1;
        }
        back_used = n > 0;
    }
    if has("congelateur_coffre") {
        x += 0.4;
        for _ in 0..2 {
            if x + 1.5 <= back_end {
                v.push(pc("congelateur_coffre", x + 0.75, 0.4, 1.5, 0.7, 0));
                x += 1.6;
                back_used = true;
            }
        }
    }

    // Étagères murales (2 m, ou 1 m dans une petite salle) : mur de gauche pour la première activité,
    // mur de droite pour la dernière quand la salle est partagée.
    let shelf = if ld < 6.0 { 1.0 } else { 2.0 };
    let left_shelves = first && has("etagere_murale");
    if left_shelves {
        let mut y = if back_used { 1.0 } else { 0.3 };
        while y + shelf <= ld - 2.2 {
            v.push(pc("etagere_murale", 0.3, y + shelf / 2.0, shelf, 0.5, 270));
            y += shelf;
        }
    }
    let mut right_shelves = false;
    if last && r.multi && has("etagere_murale") {
        let mut y = if r.reserve { r.sd + 0.4 } else if back_used { 1.0 } else { 0.3 };
        while y + shelf <= ld - 2.2 {
            v.push(pc("etagere_murale", lw - 0.3, y + shelf / 2.0, shelf, 0.5, 90));
            y += shelf;
            right_shelves = true;
        }
    }

    // Allées : le meuble principal de l'activité, en rangées parallèles à la profondeur.
    let main = ["gondole", "portant", "vitrine_fermee", "presentoir", "bac_vrac", "rack", "palette"]
        .into_iter()
        .find(|c| first_two.contains(c));
    let mut placed_main = false;
    if let Some(code) = main {
        let (uw, ud, linear) = match code {
            "gondole" => (3.0, 0.9, true),
            "rack" => (2.5, 1.0, true),
            "portant" => (1.5, 0.6, true),
            "vitrine_fermee" => (1.5, 0.6, true),
            "presentoir" => (1.0, 1.0, false),
            _ => (1.2, 0.8, false),
        };
        let xl = if first { if left_shelves { 0.55 + AISLE } else { AISLE } } else { bx0 + AISLE / 2.0 };
        let xr = if last { if right_shelves { lw - 0.55 - AISLE } else { lw - AISLE } } else { bx1 - AISLE / 2.0 };
        let yt = if r.reserve && xr > lw - r.sw - AISLE {
            r.sd + 1.2
        } else if back_used {
            0.75 + AISLE
        } else {
            AISLE
        };
        let yb = ld - 2.4;
        let len = yb - yt;
        if xr - xl >= ud && len >= 1.0 {
            placed_main = true;
            let n = (((xr - xl + AISLE) / (ud + AISLE)).floor() as i64).clamp(1, 8);
            let total = n as f64 * ud + (n - 1) as f64 * AISLE;
            let x0 = xl + (xr - xl - total) / 2.0;
            for i in 0..n {
                let cx = x0 + ud / 2.0 + i as f64 * (ud + AISLE);
                if linear {
                    let k = (len / uw).ceil().max(1.0) as i64;
                    let seg = len / k as f64;
                    for j in 0..k {
                        let mut p = pc(code, cx, yt + seg * (j as f64 + 0.5), seg, ud, 90);
                        if code == "gondole" || code == "rack" {
                            let per_metre = if code == "gondole" { 2.0 } else { 1.2 };
                            p.sections = Some(((seg * per_metre).round() as i64).max(1));
                        }
                        v.push(p);
                    }
                } else {
                    let step = uw + 0.8;
                    let k = (((len + 0.8) / step).floor() as i64).max(1);
                    let start = yt + (len - (k as f64 * step - 0.8)) / 2.0;
                    for j in 0..k {
                        v.push(pc(code, cx, start + uw / 2.0 + j as f64 * step, uw, ud, 90));
                    }
                }
            }
        }
    }
    if !placed_main && has("comptoir") && !counter_showcase {
        // Petit commerce ou rayon au comptoir : comptoir au milieu, les étagères derrière.
        // Dans une petite salle, il reste en retrait de la caisse.
        v.push(pc("comptoir", mid, (ld * 0.45).min(ld - 2.2), (bw * 0.5).clamp(1.5, 4.0).min(bw - 0.6), 0.6, 0));
    }

    // Présentoir près de l'entrée.
    let px = r.dx - r.door / 2.0 - 1.2;
    if has("presentoir") && main != Some("presentoir") && !r.upstairs && px - 0.5 > bx0 && px + 0.5 < bx1 {
        v.push(pc("presentoir", px, ld - 1.4, 1.0, 1.0, 0));
    }
}

/// Repère « entrée en bas » (salle lw × ld) → plan : centre et rotation selon le côté de l'entrée.
fn to_plan(p: &Piece, entry: &str, lw: f64, ld: f64) -> (f64, f64, i64) {
    match entry {
        "top" => (lw - p.cx, ld - p.cy, p.rot + 180),
        "left" => (ld - p.cy, p.cx, p.rot + 90),
        "right" => (p.cy, lw - p.cx, p.rot + 270),
        _ => (p.cx, p.cy, p.rot),
    }
}

fn r2(v: f64) -> f64 {
    (v * 100.0).round() / 100.0
}

/// Activités de la salle : celles demandées, sinon celles de la boutique (paramètre « business_types »).
fn layout_activities(conn: &Connection, input: &LayoutInput) -> AppResult<Vec<Activity>> {
    let mut ids: Vec<String> = match (&input.activities, db::clean(&input.business_type)) {
        (Some(list), _) if !list.is_empty() => list.clone(),
        (_, Some(b)) => vec![b],
        _ => {
            let all = settings::get(conn, "business_types")?;
            if all.trim().is_empty() {
                vec![settings::get(conn, "business_type")?]
            } else {
                all.split(',').map(|s| s.trim().to_string()).collect()
            }
        }
    };
    ids.dedup();
    let en = settings::get(conn, "shop_lang")? == "en";
    let profiles = templates::profiles();
    let mut acts: Vec<Activity> = Vec::new();
    for id in ids {
        if acts.len() >= 3 {
            break;
        }
        if let Some(p) = profiles.iter().find(|p| p.id == id) {
            let label = if en { p.department_en } else { p.department }.to_string();
            if !acts.iter().any(|a| a.label == label && a.palette == p.fixtures) {
                acts.push(Activity { label, palette: p.fixtures.clone() });
            }
        }
    }
    if acts.is_empty() {
        acts.push(Activity { label: String::new(), palette: vec!["gondole", "etagere_murale", "refrigerateur", "comptoir"] });
    }
    Ok(acts)
}

/// Meuble proposé, dans le repère du plan (coin haut gauche du rectangle non tourné).
struct Placed {
    t: FixtureType,
    x: f64,
    y: f64,
    w: f64,
    h: f64,
    rot: i64,
    sections: Option<i64>,
    name: Option<String>,
    color: Option<String>,
    height: Option<f64>,
}

/// Marge d'un mètre autour de la salle, sur le niveau.
const ROOM_MARGIN: f64 = 1.0;

/// Calcule le plan proposé (sans rien enregistrer) : hauteur sous plafond et meubles placés.
fn propose(conn: &Connection, input: &LayoutInput) -> AppResult<(f64, Vec<Placed>)> {
    if !(3.0..=200.0).contains(&input.width) || !(3.0..=200.0).contains(&input.depth) {
        return invalid("Dimensions de la salle : de 3 à 200 mètres.");
    }
    let ceiling = input.height.unwrap_or(3.0);
    if !(2.0..=12.0).contains(&ceiling) {
        return invalid("Hauteur sous plafond : de 2 à 12 mètres.");
    }
    let entry = input.entry.as_str();
    if !["bottom", "top", "left", "right"].contains(&entry) {
        return invalid("Côté de l'entrée inconnu.");
    }
    let acts = layout_activities(conn, input)?;
    let (lw, ld) = if matches!(entry, "left" | "right") { (input.depth, input.width) } else { (input.width, input.depth) };
    let pieces = layout_pieces(lw, ld, input.storage_room, &acts, input.upstairs);
    let mut types: HashMap<&'static str, Option<FixtureType>> = HashMap::new();
    let mut placed = Vec::new();
    for p in pieces {
        if !types.contains_key(p.code) {
            let id: Option<i64> = conn.query_row("SELECT id FROM fixture_types WHERE code = ?1", [p.code], |r| r.get(0)).optional()?;
            types.insert(p.code, id.map(|id| get_type(conn, id)).transpose()?);
        }
        let Some(t) = types.get(p.code).cloned().flatten() else { continue };
        let (cx, cy, rot) = to_plan(&p, entry, lw, ld);
        // Murs à hauteur du plafond ; un meuble plus haut que le plafond est abaissé.
        let wanted = if p.code == "mur" { ceiling } else if t.category != "zone" && t.height > ceiling - 0.1 { r2(ceiling - 0.1) } else { t.height };
        placed.push(Placed {
            x: r2(cx + ROOM_MARGIN - p.w / 2.0),
            y: r2(cy + ROOM_MARGIN - p.h / 2.0),
            w: r2(p.w),
            h: r2(p.h),
            rot: norm_rotation(rot),
            sections: p.sections,
            name: p.name,
            color: p.color.map(String::from),
            height: if (wanted - t.height).abs() > 1e-9 { Some(wanted) } else { None },
            t,
        });
    }
    Ok((ceiling, placed))
}

#[derive(Debug, Serialize)]
pub struct LayoutPreview {
    pub floor: Floor,
    pub fixtures: Vec<Fixture>,
}

/// Aperçu du plan proposé (rien n'est enregistré) : affiché en 3D et vu de dessus avant « Garder ce plan ».
pub fn preview_layout(conn: &Connection, input: LayoutInput) -> AppResult<LayoutPreview> {
    let (ceiling, placed) = propose(conn, &input)?;
    let floor = Floor {
        id: 0,
        name: db::clean(&input.name).unwrap_or_else(|| "Boutique".into()),
        sort: 0,
        width: input.width + 2.0 * ROOM_MARGIN,
        depth: input.depth + 2.0 * ROOM_MARGIN,
        wall_height: ceiling,
        floor_style: "tiles".into(),
        backdrop_id: None,
        backdrop: None,
    };
    let mut counters: HashMap<String, i64> = HashMap::new();
    let fixtures = placed
        .into_iter()
        .enumerate()
        .map(|(i, p)| {
            let prefix = p.t.prefix.to_uppercase();
            let n = counters.entry(prefix.clone()).or_insert(0);
            *n += 1;
            let code = format!("{prefix}{n}");
            let t = p.t;
            let name = p.name.unwrap_or_else(|| if t.storage { format!("{} {code}", short_name(&t.name)) } else { short_name(&t.name).to_string() });
            Fixture {
                id: -(i as i64) - 1,
                floor_id: 0,
                type_id: t.id,
                type_code: t.code.clone(),
                type_name: t.name.clone(),
                category: t.category.clone(),
                storage: t.storage,
                code,
                name,
                x: p.x,
                y: p.y,
                w: p.w,
                h: p.h,
                rotation: p.rot,
                color: p.color.clone().unwrap_or_else(|| t.color.clone()),
                custom_color: p.color,
                levels: if t.storage { t.levels } else { 1 },
                sections: if t.storage { p.sections.unwrap_or(t.sections).clamp(1, MAX_SECTIONS) } else { 1 },
                notes: None,
                product_count: 0,
                model: if t.model.is_empty() { t.code.clone() } else { t.model.clone() },
                height: p.height.unwrap_or(t.height),
                custom_height: p.height,
            }
        })
        .collect();
    Ok(LayoutPreview { floor, fixtures })
}

/// Dessine une boutique complète en une fois : murs, entrée, caisse, froid, étagères, allées et réserve,
/// selon les dimensions de la salle et les activités. Retourne le niveau créé ou remplacé.
pub fn generate_layout(conn: &mut Connection, user: &SessionUser, input: LayoutInput) -> AppResult<i64> {
    let (ceiling, placed) = propose(conn, &input)?;
    let (fw, fd) = (input.width + 2.0 * ROOM_MARGIN, input.depth + 2.0 * ROOM_MARGIN);
    let tx = conn.transaction()?;
    let floor_id = match input.floor_id {
        Some(id) => {
            floor_size(&tx, id)?;
            let busy: i64 = tx.query_row(
                "SELECT COUNT(*) FROM locations l JOIN fixtures f ON f.id = l.fixture_id WHERE f.floor_id = ?1
                   AND (EXISTS (SELECT 1 FROM products p WHERE p.location_id = l.id)
                        OR EXISTS (SELECT 1 FROM product_locations pl WHERE pl.location_id = l.id))",
                [id],
                |r| r.get(0),
            )?;
            if busy > 0 {
                return invalid("Ce niveau contient des produits rangés : dessinez la boutique sur un nouveau niveau.");
            }
            tx.execute("DELETE FROM locations WHERE fixture_id IN (SELECT id FROM fixtures WHERE floor_id = ?1)", [id])?;
            tx.execute("DELETE FROM fixtures WHERE floor_id = ?1", [id])?;
            tx.execute(
                "UPDATE store_floors SET width = ?1, depth = ?2, wall_height = ?3, name = COALESCE(?4, name) WHERE id = ?5",
                params![fw, fd, ceiling, db::clean(&input.name), id],
            )?;
            id
        }
        None => {
            let name = db::clean(&input.name).unwrap_or_else(|| "Boutique".to_string());
            let sort: i64 = tx.query_row("SELECT COALESCE(MAX(sort), -1) + 1 FROM store_floors", [], |r| r.get(0))?;
            tx.execute(
                "INSERT INTO store_floors (name, sort, width, depth, wall_height) VALUES (?1, ?2, ?3, ?4, ?5)",
                params![name, sort, fw, fd, ceiling],
            )?;
            tx.last_insert_rowid()
        }
    };
    let mut created = 0;
    for p in placed {
        let f = create_fixture(
            &tx,
            None,
            FixtureInput {
                floor_id: Some(floor_id),
                type_id: Some(p.t.id),
                name: p.name,
                color: p.color,
                x: Some(p.x),
                y: Some(p.y),
                w: Some(p.w),
                h: Some(p.h),
                rotation: Some(p.rot),
                sections: p.sections,
                height: p.height,
                ..Default::default()
            },
        )?;
        // Position exacte (create_fixture ramène dans le niveau la boîte non tournée).
        tx.execute("UPDATE fixtures SET x = ?1, y = ?2 WHERE id = ?3", params![p.x, p.y, f.id])?;
        created += 1;
    }
    audit::log(
        &tx,
        user,
        "Plan : boutique dessinée par l'assistant",
        "plan",
        Some(floor_id),
        format!("{} × {} m, hauteur {ceiling} m, entrée {}, {created} élément(s)", input.width, input.depth, input.entry),
    )?;
    tx.commit()?;
    Ok(floor_id)
}

// ───────────────────────────── Dessin du bâtiment en fond ─────────────────────────────

#[derive(Debug, Deserialize)]
pub struct BackdropInput {
    pub floor_id: i64,
    /// Image du dessin (photo, ou page de PDF convertie en image) ; vide : retirer le dessin.
    pub media_id: Option<i64>,
    #[serde(default)]
    pub x: f64,
    #[serde(default)]
    pub y: f64,
    #[serde(default)]
    pub w: f64,
    #[serde(default)]
    pub h: f64,
    #[serde(default)]
    pub opacity: Option<f64>,
}

/// Pose, recadre ou retire le dessin du bâtiment sous le plan d'un niveau (cadrage en mètres).
pub fn set_backdrop(conn: &Connection, user: &SessionUser, input: BackdropInput) -> AppResult<()> {
    let old: Option<i64> = conn
        .query_row("SELECT backdrop_id FROM store_floors WHERE id = ?1", [input.floor_id], |r| r.get(0))
        .optional()?
        .ok_or_else(|| crate::error::AppError::Validation("Niveau du bâtiment introuvable.".into()))?;
    match input.media_id {
        None => {
            conn.execute("UPDATE store_floors SET backdrop_id = NULL, backdrop = NULL WHERE id = ?1", [input.floor_id])?;
            audit::log(conn, user, "Plan : dessin du bâtiment retiré", "plan", Some(input.floor_id), "")?;
        }
        Some(media) => {
            let ok = |v: f64| v.is_finite() && v.abs() <= 1000.0;
            if !(ok(input.x) && ok(input.y) && ok(input.w) && ok(input.h)) || input.w < 0.5 || input.h < 0.5 {
                return invalid("Cadrage du dessin invalide.");
            }
            let opacity = input.opacity.unwrap_or(0.6).clamp(0.1, 1.0);
            let frame = serde_json::json!({ "x": r2(input.x), "y": r2(input.y), "w": r2(input.w), "h": r2(input.h), "opacity": opacity });
            conn.execute(
                "UPDATE store_floors SET backdrop_id = ?1, backdrop = ?2 WHERE id = ?3",
                params![media, frame.to_string(), input.floor_id],
            )?;
            if old != Some(media) {
                audit::log(conn, user, "Plan : dessin du bâtiment posé", "plan", Some(input.floor_id), "")?;
            }
        }
    }
    if old.is_some() && old != input.media_id {
        crate::services::media::cleanup(conn, old)?;
    }
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

#[cfg(test)]
mod layout_tests {
    use super::*;

    fn activity(id: &str) -> Activity {
        let p = templates::profiles().into_iter().find(|p| p.id == id).unwrap();
        Activity { label: p.department.into(), palette: p.fixtures }
    }

    /// Vérifie une proposition : rien ne déborde ni ne se chevauche ; porte (ou escalier) et caisse ;
    /// si `each` : chaque activité a au moins un de ses meubles dans son rayon.
    fn check(ids: &[&str], lw: f64, ld: f64, storage: bool, upstairs: bool, each: bool) {
        let acts: Vec<Activity> = ids.iter().map(|id| activity(id)).collect();
        let v = layout_pieces(lw, ld, storage, &acts, upstairs);
        let what = format!("{ids:?} {lw}×{ld} réserve={storage} étage={upstairs}");
        let items: Vec<&Piece> = v.iter().filter(|p| !is_structure(p.code)).collect();
        for (i, a) in items.iter().enumerate() {
            let ra = footprint(a.cx, a.cy, a.w, a.h, a.rot);
            assert!(ra.0 >= -1e-6 && ra.1 >= -1e-6 && ra.0 + ra.2 <= lw + 1e-6 && ra.1 + ra.3 <= ld + 1e-6, "{what} : {} déborde", a.code);
            for b in &items[i + 1..] {
                let rb = footprint(b.cx, b.cy, b.w, b.h, b.rot);
                let clash = ra.0 + 0.02 < rb.0 + rb.2 && rb.0 + 0.02 < ra.0 + ra.2 && ra.1 + 0.02 < rb.1 + rb.3 && rb.1 + 0.02 < ra.1 + ra.3;
                assert!(!clash, "{what} : {} chevauche {}", a.code, b.code);
            }
        }
        let n = |code: &str| v.iter().filter(|p| p.code == code).count();
        if upstairs {
            assert_eq!((n("escalier"), n("caisse")), (1, 0), "{what}");
        } else {
            assert_eq!(n("caisse"), 1, "{what}");
            assert!(n("porte") >= 1, "{what}");
        }
        if each {
            let mut x = 0.0;
            for (i, (a, share)) in acts.iter().zip(shares(acts.len())).enumerate() {
                let x1 = if i + 1 == acts.len() { lw } else { x + lw * share };
                let found = items.iter().any(|p| a.palette.contains(&p.code) && p.cx >= x - 1e-6 && p.cx <= x1 + 1e-6);
                assert!(found, "{what} : rien pour {}", a.label);
                x = x1;
            }
            if acts.len() > 1 {
                let zones = v.iter().filter(|p| p.code == "zone_vente" && p.name.is_some()).count();
                assert_eq!(zones, acts.len(), "{what} : un rayon nommé par activité");
            }
        }
    }

    #[test]
    fn every_type_and_every_pair_gets_a_clean_plan() {
        let ids: Vec<&str> = templates::profiles().iter().map(|p| p.id).collect();
        assert_eq!(ids.len(), 22);
        for a in &ids {
            for (w, d) in [(4.0, 3.5), (5.0, 3.5), (12.0, 9.0), (25.0, 18.0)] {
                check(&[*a], w, d, true, false, w >= 5.0);
                check(&[*a], w, d, false, false, w >= 5.0);
            }
            check(&[*a], 10.0, 8.0, false, true, true);
            for b in &ids {
                if a != b {
                    for (w, d) in [(5.0, 4.0), (12.0, 9.0), (25.0, 18.0)] {
                        check(&[*a, *b], w, d, true, false, w >= 12.0);
                    }
                }
            }
        }
        // Trios : la principale avec deux autres.
        for (i, a) in ids.iter().enumerate() {
            let b = ids[(i + 7) % ids.len()];
            let c = ids[(i + 13) % ids.len()];
            check(&[*a, b, c], 25.0, 18.0, true, false, true);
            check(&[*a, b, c], 8.0, 6.0, true, false, false);
        }
    }

    #[test]
    fn single_activity_keeps_the_0_13_layout() {
        let v = layout_pieces(14.0, 10.0, true, &[activity("supermarket")], false);
        let n = |code: &str| v.iter().filter(|p| p.code == code).count();
        assert!(n("gondole") >= 4 && n("refrigerateur") >= 2 && n("caisse") == 1 && n("zone_vente") == 1);
        assert!(v.iter().all(|p| p.name.is_none()), "une seule activité : pas de rayon nommé");
    }
}
