//! Photos (produits, catégories, logo, QR code marchand) stockées dans la base :
//! elles sont donc incluses dans les sauvegardes. Elles sont servies au frontend
//! par le protocole personnalisé `media://` (voir lib.rs).

use std::path::Path;

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
           AND NOT EXISTS (SELECT 1 FROM store_floors WHERE backdrop_id = ?1)
           AND NOT EXISTS (SELECT 1 FROM settings WHERE key IN ('shop_logo_id', 'om_qr_image_id') AND value = CAST(?1 AS TEXT))
           AND NOT EXISTS (SELECT 1 FROM settings WHERE key = 'mobile_operators' AND value LIKE '%\"qr_image_id\":' || ?1 || '%')",
        [id],
    )?;
    Ok(())
}

/// Tailles des vignettes (pixels du plus grand côté). Une demande est arrondie à la taille au-dessus.
pub const THUMB_SIZES: [u32; 3] = [96, 160, 320];

/// Taille de vignette pour une demande `?s=<pixels>` (aucune : image d'origine).
pub fn thumb_size(requested: Option<&str>) -> Option<u32> {
    let wanted: u32 = requested?.trim().parse().ok()?;
    Some(THUMB_SIZES.iter().copied().find(|s| *s >= wanted).unwrap_or(THUMB_SIZES[THUMB_SIZES.len() - 1]))
}

/// Vignette déjà fabriquée.
fn cached_thumb(dir: &Path, id: i64, size: u32) -> Option<(String, Vec<u8>)> {
    for (ext, mime) in [("jpg", "image/jpeg"), ("png", "image/png")] {
        if let Ok(bytes) = std::fs::read(dir.join(format!("{id}-{size}.{ext}"))) {
            return Some((mime.to_string(), bytes));
        }
    }
    None
}

/// Fabrique la vignette d'une photo et la garde dans `dir`. Image illisible, SVG ou GIF, ou déjà
/// petite : l'image d'origine.
fn make_thumb(dir: &Path, id: i64, size: u32, mime: String, data: Vec<u8>) -> (String, Vec<u8>) {
    if !matches!(mime.as_str(), "image/jpeg" | "image/png" | "image/webp") {
        return (mime, data);
    }
    let Ok(img) = image::load_from_memory(&data) else { return (mime, data) };
    if img.width() <= size && img.height() <= size {
        return (mime, data);
    }
    let small = img.thumbnail(size, size);
    let mut out: Vec<u8> = Vec::new();
    let (ext, out_mime) = if small.color().has_alpha() {
        // Logo ou détourage : PNG, pour garder la transparence.
        if small.write_to(&mut std::io::Cursor::new(&mut out), image::ImageFormat::Png).is_err() {
            return (mime, data);
        }
        ("png", "image/png")
    } else {
        let rgb = small.to_rgb8();
        let mut encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, 80);
        if encoder.encode_image(&rgb).is_err() {
            return (mime, data);
        }
        ("jpg", "image/jpeg")
    };
    if std::fs::create_dir_all(dir).is_ok() {
        let _ = std::fs::write(dir.join(format!("{id}-{size}.{ext}")), &out);
    }
    (out_mime.to_string(), out)
}

/// Photo d'origine, ou sa vignette si `size` est donnée.
///
/// Une vignette est bien plus légère que la photo entière (environ 4 Ko au lieu de 50 à 80 Ko) pour
/// les listes, surtout sur téléphone et par Internet. Elle est fabriquée une fois, puis gardée dans le
/// dossier « Vignettes » de la boutique, hors de la base : les sauvegardes ne grossissent pas. Une photo
/// est immuable (une nouvelle photo a un nouveau numéro) : une vignette ne périme jamais. La base n'est
/// verrouillée que le temps de lire la photo, pas pendant sa réduction.
pub fn get_sized(state: &crate::state::AppState, id: i64, size: Option<u32>) -> AppResult<Option<(String, Vec<u8>)>> {
    let Some(size) = size else { return get(&state.conn(), id) };
    let dir = state.thumbs_dir();
    if let Some(hit) = cached_thumb(&dir, id, size) {
        return Ok(Some(hit));
    }
    let original = get(&state.conn(), id)?;
    Ok(original.map(|(mime, data)| make_thumb(&dir, id, size, mime, data)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn thumb_sizes_round_up() {
        assert_eq!(thumb_size(None), None);
        assert_eq!(thumb_size(Some("abc")), None);
        assert_eq!(thumb_size(Some("44")), Some(96));
        assert_eq!(thumb_size(Some("96")), Some(96));
        assert_eq!(thumb_size(Some("120")), Some(160));
        assert_eq!(thumb_size(Some("2000")), Some(320));
    }

    #[test]
    fn thumbnails_are_small_and_kept_on_disk() {
        let dir = std::env::temp_dir().join(format!("gm-vignettes-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        // Photo de 800 × 600 sans transparence : vignette JPEG d'au plus 160 pixels.
        let photo = image::RgbImage::from_fn(800, 600, |x, y| image::Rgb([(x % 256) as u8, (y % 256) as u8, 120]));
        let mut png = Vec::new();
        image::DynamicImage::ImageRgb8(photo).write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png).unwrap();
        let (mime, small) = make_thumb(&dir, 7, 160, "image/png".into(), png.clone());
        assert_eq!(mime, "image/jpeg");
        let decoded = image::load_from_memory(&small).unwrap();
        assert!(decoded.width() <= 160 && decoded.height() <= 160);
        assert!(small.len() < png.len());
        assert_eq!(cached_thumb(&dir, 7, 160).map(|(m, b)| (m, b.len())), Some(("image/jpeg".to_string(), small.len())));
        // Logo transparent : PNG, pour garder la transparence.
        let logo = image::RgbaImage::from_pixel(400, 400, image::Rgba([10, 20, 30, 0]));
        let mut logo_png = Vec::new();
        image::DynamicImage::ImageRgba8(logo).write_to(&mut std::io::Cursor::new(&mut logo_png), image::ImageFormat::Png).unwrap();
        assert_eq!(make_thumb(&dir, 8, 96, "image/png".into(), logo_png).0, "image/png");
        // SVG ou image illisible : l'image d'origine.
        assert_eq!(make_thumb(&dir, 9, 96, "image/svg+xml".into(), b"<svg/>".to_vec()).1, b"<svg/>".to_vec());
        assert_eq!(make_thumb(&dir, 10, 96, "image/jpeg".into(), b"pas une image".to_vec()).1, b"pas une image".to_vec());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
