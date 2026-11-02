//! Photos (produits, catégories, logo, QR code marchand) stockées dans la base :
//! elles sont donc incluses dans les sauvegardes. Elles sont servies au frontend
//! par le protocole personnalisé `media://` (voir lib.rs).

use base64::Engine;
use rusqlite::{params, Connection, OptionalExtension};

use crate::db;
use crate::error::{invalid, AppResult};

const MAX_BYTES: usize = 3 * 1024 * 1024;
const ALLOWED: &[&str] = &["image/jpeg", "image/png", "image/webp", "image/gif", "image/svg+xml"];

/// Enregistre une image envoyée en base64 et retourne son identifiant.
pub fn save(conn: &Connection, mime: &str, data_base64: &str) -> AppResult<i64> {
    if !ALLOWED.contains(&mime) {
        return invalid("Format d'image non pris en charge (JPEG, PNG, WebP).");
    }
    let payload = data_base64.split_once(',').map(|(_, d)| d).unwrap_or(data_base64);
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(payload.trim())
        .map_err(|_| crate::error::AppError::Validation("Image illisible.".into()))?;
    if bytes.is_empty() || bytes.len() > MAX_BYTES {
        return invalid("Image trop volumineuse (3 Mo maximum).");
    }
    conn.execute(
        "INSERT INTO media (mime, data, created_at) VALUES (?1, ?2, ?3)",
        params![mime, bytes, db::now()],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn get(conn: &Connection, id: i64) -> AppResult<Option<(String, Vec<u8>)>> {
    Ok(conn
        .query_row("SELECT mime, data FROM media WHERE id = ?1", [id], |r| Ok((r.get(0)?, r.get(1)?)))
        .optional()?)
}

/// Supprime une image si plus rien ne l'utilise.
pub fn cleanup(conn: &Connection, id: Option<i64>) -> AppResult<()> {
    let Some(id) = id else { return Ok(()) };
    conn.execute(
        "DELETE FROM media WHERE id = ?1
           AND NOT EXISTS (SELECT 1 FROM products WHERE image_id = ?1)
           AND NOT EXISTS (SELECT 1 FROM categories WHERE image_id = ?1)
           AND NOT EXISTS (SELECT 1 FROM settings WHERE key IN ('shop_logo_id', 'om_qr_image_id') AND value = CAST(?1 AS TEXT))
           AND NOT EXISTS (SELECT 1 FROM settings WHERE key = 'mobile_operators' AND value LIKE '%"qr_image_id":' || ?1 || '%')",
        [id],
    )?;
    Ok(())
}
