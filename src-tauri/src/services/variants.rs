//! Déclinaisons d'un produit : une couleur (palette fixe, `data/couleurs.txt`) et/ou une valeur d'un second axe
//! (taille, pointure, âge, capacité, contenance ou modèle), chacune avec son stock, et au besoin son code-barres,
//! son prix et sa photo. Le stock du produit reste le total : une vente, une réception, un retour ou un
//! inventaire sur une déclinaison change les deux (`stock::apply_change_v`).

use std::collections::HashMap;
use std::sync::OnceLock;

use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};

use crate::db;
use crate::error::{invalid, AppResult};
use crate::services::{audit, catalog, stock};
use crate::state::SessionUser;

const COLORS_TXT: &str = include_str!("../../data/couleurs.txt");

/// Second axe : code enregistré → nom affiché.
pub const AXES: [(&str, &str); 6] =
    [("size", "Taille"), ("shoe", "Pointure"), ("age", "Âge"), ("storage", "Capacité"), ("volume", "Contenance"), ("model", "Modèle")];

/// Au plus 120 déclinaisons par produit (ex. 12 couleurs × 10 tailles).
pub const MAX_VARIANTS: usize = 120;

/// Une couleur de la palette : code (jamais changé) et nom français. Nom anglais et teinte servent aux écrans.
#[derive(Debug, Clone, Copy)]
pub struct Color {
    pub code: &'static str,
    pub name: &'static str,
}

pub fn colors() -> &'static [Color] {
    static LIST: OnceLock<Vec<Color>> = OnceLock::new();
    LIST.get_or_init(|| {
        COLORS_TXT
            .lines()
            .map(str::trim)
            .filter(|l| !l.is_empty() && !l.starts_with('#'))
            .filter_map(|l| {
                let mut f = l.split(';');
                Some(Color { code: f.next()?, name: f.next()? })
            })
            .collect()
    })
}

pub fn color(code: &str) -> Option<&'static Color> {
    colors().iter().find(|c| c.code == code)
}

pub fn axis_name(code: &str) -> Option<&'static str> {
    AXES.iter().find(|(c, _)| *c == code).map(|(_, n)| *n)
}

/// « Rouge, M » : nom de la couleur puis valeur du second axe.
pub fn label(color_code: Option<&str>, size: Option<&str>) -> String {
    let c = color_code.map(|c| color(c).map(|x| x.name).unwrap_or(c));
    [c, size].into_iter().flatten().collect::<Vec<_>>().join(", ")
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Variant {
    pub id: i64,
    pub product_id: i64,
    pub color: Option<String>,
    pub size: Option<String>,
    pub barcode: Option<String>,
    /// Prix propre (vide : prix du produit).
    pub price: Option<i64>,
    pub stock: f64,
    /// Une des photos du produit (montrée quand on choisit cette couleur).
    pub photo_id: Option<i64>,
    pub active: bool,
    pub label: String,
}

const SELECT: &str = "SELECT id, product_id, color, size, barcode, price, stock, photo_id, active FROM product_variants";

fn from_row(r: &Row) -> rusqlite::Result<Variant> {
    let color: Option<String> = r.get(2)?;
    let size: Option<String> = r.get(3)?;
    Ok(Variant {
        id: r.get(0)?,
        product_id: r.get(1)?,
        label: label(color.as_deref(), size.as_deref()),
        color,
        size,
        barcode: r.get(4)?,
        price: r.get(5)?,
        stock: r.get(6)?,
        photo_id: r.get(7)?,
        active: r.get(8)?,
    })
}

pub fn of_product(conn: &Connection, product_id: i64) -> AppResult<Vec<Variant>> {
    let mut stmt = conn.prepare(&format!("{SELECT} WHERE product_id = ?1 ORDER BY position, id"))?;
    let rows = stmt.query_map([product_id], from_row)?.collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

/// Déclinaisons de tous les produits (liste des produits).
pub fn all(conn: &Connection) -> AppResult<HashMap<i64, Vec<Variant>>> {
    let mut map: HashMap<i64, Vec<Variant>> = HashMap::new();
    let mut stmt = conn.prepare(&format!("{SELECT} ORDER BY product_id, position, id"))?;
    for v in stmt.query_map([], from_row)? {
        let v = v?;
        map.entry(v.product_id).or_default().push(v);
    }
    Ok(map)
}

/// La déclinaison, si elle appartient bien au produit.
pub fn of(conn: &Connection, product_id: i64, variant_id: i64) -> AppResult<Variant> {
    let v = conn.query_row(&format!("{SELECT} WHERE id = ?1"), [variant_id], from_row).optional()?;
    match v {
        Some(v) if v.product_id == product_id => Ok(v),
        _ => invalid("Cette couleur ou taille n'existe plus pour ce produit : rechargez la liste."),
    }
}

/// Déclinaison en vente d'un produit actif, par son code-barres.
pub fn by_barcode(conn: &Connection, code: &str) -> AppResult<Option<Variant>> {
    Ok(conn
        .query_row(
            &format!("{SELECT} WHERE barcode = ?1 AND active = 1 AND product_id IN (SELECT id FROM products WHERE active = 1)"),
            [code],
            from_row,
        )
        .optional()?)
}

#[derive(Debug, Clone, Deserialize)]
pub struct VariantInput {
    pub id: Option<i64>,
    pub color: Option<String>,
    pub size: Option<String>,
    pub barcode: Option<String>,
    pub price: Option<i64>,
    #[serde(default)]
    pub stock: f64,
    pub photo_id: Option<i64>,
    #[serde(default = "yes")]
    pub active: bool,
}

fn yes() -> bool {
    true
}

/// Liste contrôlée et nettoyée (couleur de la palette, taille courte, pas de doublon, codes-barres libres).
fn checked(conn: &Connection, product_id: i64, axis: Option<&str>, list: &[VariantInput]) -> AppResult<Vec<VariantInput>> {
    if list.len() > MAX_VARIANTS {
        return invalid(format!("{MAX_VARIANTS} couleurs ou tailles au plus par produit."));
    }
    if let Some(a) = axis {
        if axis_name(a).is_none() {
            return invalid("Type de taille inconnu.");
        }
    }
    let (main_code, main_photo): (Option<String>, Option<i64>) =
        conn.query_row("SELECT barcode, image_id FROM products WHERE id = ?1", [product_id], |r| Ok((r.get(0)?, r.get(1)?)))?;
    let photos: Vec<i64> = {
        let mut stmt = conn.prepare("SELECT media_id FROM product_photos WHERE product_id = ?1")?;
        let rows = stmt.query_map([product_id], |r| r.get(0))?.collect::<Result<Vec<i64>, _>>()?;
        rows
    };
    let mut out: Vec<VariantInput> = Vec::with_capacity(list.len());
    for v in list {
        let col = db::clean(&v.color);
        if let Some(c) = &col {
            if color(c).is_none() {
                return invalid(format!("Couleur inconnue : {c}."));
            }
        }
        let size = db::clean(&v.size).map(|s| s.split_whitespace().collect::<Vec<_>>().join(" "));
        if let Some(s) = &size {
            if s.chars().count() > 40 {
                return invalid("Taille trop longue (40 caractères au plus).");
            }
            if axis.is_none() {
                return invalid("Choisissez d'abord le type de taille (taille, pointure, âge…).");
            }
        }
        if col.is_none() && size.is_none() {
            return invalid("Chaque ligne doit avoir une couleur ou une taille.");
        }
        let name = label(col.as_deref(), size.as_deref());
        let same = |o: &VariantInput| {
            o.color == col && o.size.as_deref().map(str::to_lowercase) == size.as_deref().map(str::to_lowercase)
        };
        if out.iter().any(same) {
            return invalid(format!("« {name} » est en double."));
        }
        let price = match v.price {
            Some(p) if p < 0 => return invalid(format!("« {name} » : le prix ne peut pas être négatif.")),
            Some(0) | None => None,
            Some(p) => Some(p),
        };
        if !v.stock.is_finite() || v.stock < 0.0 {
            return invalid(format!("« {name} » : le stock ne peut pas être négatif."));
        }
        let barcode = db::clean(&v.barcode);
        if let Some(b) = &barcode {
            if b.chars().count() > 200 {
                return invalid("Code-barres trop long (200 caractères maximum).");
            }
            if main_code.as_deref() == Some(b.as_str()) {
                return invalid(format!("« {name} » : le code-barres doit être différent de celui du produit."));
            }
            if out.iter().any(|o| o.barcode.as_deref() == Some(b.as_str())) {
                return invalid(format!("Le code-barres {b} est donné deux fois."));
            }
            // Les autres lignes de ce produit sont contrôlées ci-dessus (elles sont toutes remplacées).
            catalog::ensure_barcode_free(conn, b, Some(-1), Some(-1), Some(product_id))?;
        }
        if let Some(p) = v.photo_id {
            if main_photo != Some(p) && !photos.contains(&p) {
                return invalid(format!("« {name} » : choisissez une des photos du produit."));
            }
        }
        out.push(VariantInput { id: v.id, color: col, size, barcode, price, stock: db::round_qty(v.stock), photo_id: v.photo_id, active: v.active });
    }
    Ok(out)
}

/// Le changement demande-t-il le code PIN d'un responsable ? Oui s'il touche le stock ou le prix d'une
/// déclinaison existante, ou s'il retire une déclinaison qui a du stock.
pub fn needs_pin(conn: &Connection, product_id: i64, list: &[VariantInput]) -> AppResult<bool> {
    let before = of_product(conn, product_id)?;
    for old in &before {
        match list.iter().find(|v| v.id == Some(old.id)) {
            Some(v) => {
                let price = v.price.filter(|p| *p > 0);
                if (db::round_qty(v.stock) - old.stock).abs() > 1e-9 || price != old.price {
                    return Ok(true);
                }
            }
            None if old.stock > 1e-9 => return Ok(true),
            None => {}
        }
    }
    Ok(false)
}

/// Remplace les déclinaisons du produit. Les stocks saisis deviennent ceux des déclinaisons (mouvement de stock
/// pour chaque écart) et le stock du produit devient leur total.
pub fn set_variants(conn: &mut Connection, user: &SessionUser, product_id: i64, axis: Option<String>, list: &[VariantInput]) -> AppResult<Vec<Variant>> {
    let axis = db::clean(&axis);
    let (name, track): (String, bool) =
        conn.query_row("SELECT name, track_stock FROM products WHERE id = ?1", [product_id], |r| Ok((r.get(0)?, r.get(1)?)))?;
    let list = checked(conn, product_id, axis.as_deref(), list)?;
    let before = of_product(conn, product_id)?;
    let tx = conn.transaction()?;
    // Déclinaisons retirées : leur stock sort avec le total plus bas. Les ventes passées gardent leur libellé.
    for old in before.iter().filter(|o| !list.iter().any(|v| v.id == Some(o.id))) {
        tx.execute("DELETE FROM product_variants WHERE id = ?1", [old.id])?;
    }
    // Codes-barres et couples couleur/taille libérés avant d'être repris par une autre ligne.
    tx.execute(
        "UPDATE product_variants SET barcode = NULL, color = '#' || id, size = NULL WHERE product_id = ?1",
        [product_id],
    )?;
    let note = "Couleurs et tailles";
    for (i, v) in list.iter().enumerate() {
        let existing = v.id.and_then(|id| before.iter().find(|o| o.id == id));
        let id = match existing {
            Some(old) => {
                tx.execute(
                    "UPDATE product_variants SET color = ?1, size = ?2, barcode = ?3, price = ?4, photo_id = ?5, active = ?6, position = ?7
                     WHERE id = ?8",
                    params![v.color, v.size, v.barcode, v.price, v.photo_id, v.active, i as i64, old.id],
                )?;
                old.id
            }
            None => {
                tx.execute(
                    "INSERT INTO product_variants (product_id, color, size, barcode, price, stock, photo_id, active, position)
                     VALUES (?1, ?2, ?3, ?4, ?5, 0, ?6, ?7, ?8)",
                    params![product_id, v.color, v.size, v.barcode, v.price, v.photo_id, v.active, i as i64],
                )?;
                tx.last_insert_rowid()
            }
        };
        let current = existing.map(|o| o.stock).unwrap_or(0.0);
        let delta = db::round_qty(v.stock - current);
        if delta != 0.0 {
            if track {
                stock::apply_change_v(&tx, product_id, Some(id), delta, "adjustment", None, None, Some(note), user.id)?;
            } else {
                tx.execute("UPDATE product_variants SET stock = ?1 WHERE id = ?2", params![v.stock, id])?;
            }
        }
    }
    // Le stock du produit devient le total des déclinaisons (stock non réparti, déclinaisons retirées).
    if track && !list.is_empty() {
        let (stock_now, total): (f64, f64) = tx.query_row(
            "SELECT p.stock, COALESCE((SELECT SUM(stock) FROM product_variants WHERE product_id = p.id), 0) FROM products p WHERE p.id = ?1",
            [product_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )?;
        let delta = db::round_qty(total - stock_now);
        if delta != 0.0 {
            stock::apply_change(&tx, product_id, delta, "adjustment", None, None, Some("Répartition entre les couleurs et tailles"), user.id)?;
        }
    }
    tx.execute(
        "UPDATE products SET variant_axis = ?1, updated_at = ?2 WHERE id = ?3",
        params![if list.is_empty() { None } else { axis }, db::now(), product_id],
    )?;
    audit::log(&tx, user, "Couleurs et tailles du produit", "product", Some(product_id), format!("{name} : {} déclinaison(s)", list.len()))?;
    tx.commit()?;
    of_product(conn, product_id)
}

/// Contrôle d'une ligne de vente, de réception ou de retour : la déclinaison existe, appartient au produit et
/// est en vente (sauf pour un retour ou une réception, `selling = false`).
pub fn check_line(conn: &Connection, product_id: i64, variant_id: Option<i64>, selling: bool) -> AppResult<Option<Variant>> {
    let Some(id) = variant_id else { return Ok(None) };
    let v = of(conn, product_id, id)?;
    if selling && !v.active {
        return invalid(format!("« {} » n'est plus en vente.", v.label));
    }
    Ok(Some(v))
}
