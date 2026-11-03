//! Promotions datées : remise en pourcentage (article ou catégorie) ou prix promo (article),
//! appliquées automatiquement en caisse du premier au dernier jour inclus (voir sales::price_line).

use rusqlite::{params, Connection, Row};
use serde::{Deserialize, Serialize};

use crate::db;
use crate::error::{invalid, AppResult};
use crate::services::audit;
use crate::state::SessionUser;

#[derive(Debug, Serialize)]
pub struct Promotion {
    pub id: i64,
    pub name: String,
    pub kind: String,
    pub value: i64,
    pub product_id: Option<i64>,
    pub product_name: Option<String>,
    pub regular_price: Option<i64>,
    pub category_id: Option<i64>,
    pub category_name: Option<String>,
    pub starts_on: String,
    pub ends_on: String,
    pub active: bool,
    /// « current » (en cours), « upcoming » (à venir), « ended » (terminée) ou « off » (désactivée).
    pub state: String,
}

const SELECT: &str = "SELECT p.id, p.name, p.kind, p.value, p.product_id, pr.name, pr.sale_price, p.category_id, c.name,
        p.starts_on, p.ends_on, p.active
    FROM promotions p
    LEFT JOIN products pr ON pr.id = p.product_id
    LEFT JOIN categories c ON c.id = p.category_id";

fn from_row(r: &Row, today: &str) -> rusqlite::Result<Promotion> {
    let starts_on: String = r.get(9)?;
    let ends_on: String = r.get(10)?;
    let active: bool = r.get(11)?;
    let state = if !active {
        "off"
    } else if ends_on.as_str() < today {
        "ended"
    } else if starts_on.as_str() > today {
        "upcoming"
    } else {
        "current"
    };
    Ok(Promotion {
        id: r.get(0)?,
        name: r.get(1)?,
        kind: r.get(2)?,
        value: r.get(3)?,
        product_id: r.get(4)?,
        product_name: r.get(5)?,
        regular_price: r.get(6)?,
        category_id: r.get(7)?,
        category_name: r.get(8)?,
        starts_on,
        ends_on,
        active,
        state: state.into(),
    })
}

fn today() -> String {
    chrono::Local::now().format("%Y-%m-%d").to_string()
}

pub fn list(conn: &Connection) -> AppResult<Vec<Promotion>> {
    let t = today();
    let mut stmt = conn.prepare(&format!("{SELECT} ORDER BY p.ends_on < ?1, p.starts_on DESC, p.id DESC"))?;
    let rows = stmt.query_map([&t], |r| from_row(r, &t))?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

#[derive(Debug, Deserialize)]
pub struct PromotionInput {
    pub id: Option<i64>,
    pub name: String,
    pub kind: String,
    pub value: i64,
    pub product_id: Option<i64>,
    pub category_id: Option<i64>,
    pub starts_on: String,
    pub ends_on: String,
    pub active: Option<bool>,
}

fn valid_date(d: &str) -> bool {
    chrono::NaiveDate::parse_from_str(d, "%Y-%m-%d").is_ok()
}

pub fn save(conn: &Connection, user: &SessionUser, input: PromotionInput) -> AppResult<Promotion> {
    let name = input.name.trim();
    if name.is_empty() {
        return invalid("Donnez un nom à la promotion (ex. « Fête de fin d'année »).");
    }
    if input.product_id.is_some() == input.category_id.is_some() {
        return invalid("Choisissez un article ou une catégorie.");
    }
    match input.kind.as_str() {
        "percent" if (1..=90).contains(&input.value) => {}
        "percent" => return invalid("La remise va de 1 à 90 %."),
        "price" if input.product_id.is_none() => return invalid("Un prix promo se fixe sur un article ; pour une catégorie, choisissez un pourcentage."),
        "price" => {
            let regular: i64 = conn.query_row("SELECT sale_price FROM products WHERE id = ?1", [input.product_id], |r| r.get(0))?;
            if input.value <= 0 || input.value >= regular {
                return invalid("Le prix promo doit être inférieur au prix normal de l'article.");
            }
        }
        _ => return invalid("Type de promotion invalide."),
    }
    if !valid_date(&input.starts_on) || !valid_date(&input.ends_on) {
        return invalid("Dates invalides.");
    }
    if input.ends_on < input.starts_on {
        return invalid("La date de fin est avant la date de début.");
    }
    let active = input.active.unwrap_or(true);
    let id = match input.id {
        Some(id) => {
            conn.execute(
                "UPDATE promotions SET name = ?1, kind = ?2, value = ?3, product_id = ?4, category_id = ?5,
                        starts_on = ?6, ends_on = ?7, active = ?8 WHERE id = ?9",
                params![name, input.kind, input.value, input.product_id, input.category_id, input.starts_on, input.ends_on, active, id],
            )?;
            id
        }
        None => {
            conn.execute(
                "INSERT INTO promotions (name, kind, value, product_id, category_id, starts_on, ends_on, active, created_by, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
                params![name, input.kind, input.value, input.product_id, input.category_id, input.starts_on, input.ends_on, active,
                        user.id, db::now()],
            )?;
            conn.last_insert_rowid()
        }
    };
    let what = if input.kind == "percent" { format!("-{} %", input.value) } else { format!("prix {}", input.value) };
    audit::log(conn, user, if input.id.is_some() { "Promotion modifiée" } else { "Promotion créée" }, "promotion", Some(id),
               format!("{name} : {what}, du {} au {}", input.starts_on, input.ends_on))?;
    let t = today();
    Ok(conn.query_row(&format!("{SELECT} WHERE p.id = ?1"), [id], |r| from_row(r, &t))?)
}

pub fn delete(conn: &Connection, user: &SessionUser, id: i64) -> AppResult<()> {
    let name: String = conn.query_row("SELECT name FROM promotions WHERE id = ?1", [id], |r| r.get(0))?;
    conn.execute("DELETE FROM promotions WHERE id = ?1", [id])?;
    audit::log(conn, user, "Promotion supprimée", "promotion", Some(id), name)?;
    Ok(())
}
