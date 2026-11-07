//! Programme client fidèle (formules PRO et BUSINESS).
//!
//! - Étoiles de 0 à 5 selon le nombre d'achats du client sur les 12 derniers mois (paliers réglables,
//!   un achat sous le minimum ne compte pas).
//! - Bonus à chaque achat : de 0,5 % (0 étoile) à 1 % (5 étoiles) du montant réellement payé
//!   (ni la part payée avec le bonus, ni la part mise en dette : elle donne son bonus une fois réglée).
//! - Le bonus se dépense en caisse comme un moyen de paiement, tout ou partie de l'achat.
//! - Il expire après 12 mois sans achat (réglable, 0 : jamais).
//!
//! Chaque mouvement du bonus est gardé dans `loyalty_moves` (historique du client).

use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;

use crate::error::{invalid, AppResult};
use crate::services::{audit, settings};
use crate::state::SessionUser;

#[derive(Debug, Clone, Serialize)]
pub struct Program {
    pub enabled: bool,
    /// Bonus en % du montant payé, à 0 et à 5 étoiles (entre les deux : progression régulière).
    pub rate_min: f64,
    pub rate_max: f64,
    /// Nombre d'achats sur 12 mois pour 1, 2, 3, 4 et 5 étoiles.
    pub steps: [i64; 5],
    /// Montant minimum d'un achat pour compter une étoile.
    pub min_purchase: i64,
    /// Mois sans achat avant l'expiration du bonus (0 : jamais).
    pub months: i64,
}

impl Program {
    pub fn parse(enabled: &str, rate_min: &str, rate_max: &str, steps: &str, min_purchase: &str, months: &str) -> AppResult<Program> {
        let rate = |s: &str| s.trim().replace(',', ".").parse::<f64>().ok().filter(|r| r.is_finite() && (0.0..=100.0).contains(r));
        let (Some(rate_min), Some(rate_max)) = (rate(rate_min), rate(rate_max)) else {
            return invalid("Les taux du bonus fidélité doivent être compris entre 0 et 100 %.");
        };
        if rate_min > rate_max {
            return invalid("Le bonus à 0 étoile ne peut pas dépasser le bonus à 5 étoiles.");
        }
        let parsed: Vec<i64> = steps.split(',').map(|s| s.trim().parse::<i64>().unwrap_or(-1)).collect();
        if parsed.len() != 5 || parsed[0] < 1 || parsed.windows(2).any(|w| w[1] <= w[0]) {
            return invalid("Paliers des étoiles : 5 nombres d'achats croissants, par exemple 3,10,25,50,100.");
        }
        let Some(min_purchase) = min_purchase.trim().parse::<i64>().ok().filter(|m| *m >= 0) else {
            return invalid("Montant minimum d'un achat pour les étoiles invalide.");
        };
        let Some(months) = months.trim().parse::<i64>().ok().filter(|m| (0..=120).contains(m)) else {
            return invalid("Durée du bonus : de 0 (n'expire jamais) à 120 mois.");
        };
        Ok(Program {
            enabled: matches!(enabled.trim(), "1" | "true"),
            rate_min,
            rate_max,
            steps: [parsed[0], parsed[1], parsed[2], parsed[3], parsed[4]],
            min_purchase,
            months,
        })
    }

    /// Réglages de la boutique ; s'ils sont abîmés, valeurs par défaut (la caisse n'est jamais bloquée).
    pub fn load(conn: &Connection) -> AppResult<Program> {
        let g = |k: &str| settings::get(conn, k);
        let enabled = g("loyalty_enabled")?;
        Ok(Program::parse(
            &enabled,
            &g("loyalty_rate_min")?,
            &g("loyalty_rate_max")?,
            &g("loyalty_star_steps")?,
            &g("loyalty_min_purchase")?,
            &g("loyalty_bonus_months")?,
        )
        .unwrap_or(Program {
            enabled: matches!(enabled.trim(), "1" | "true"),
            rate_min: 0.5,
            rate_max: 1.0,
            steps: [3, 10, 25, 50, 100],
            min_purchase: 500,
            months: 12,
        }))
    }

    /// Programme en marche : activé par la boutique et inclus dans sa formule.
    pub fn active(&self) -> bool {
        self.enabled && crate::license::loyalty_allowed()
    }

    pub fn stars_for(&self, purchases: i64) -> i64 {
        self.steps.iter().filter(|s| purchases >= **s).count() as i64
    }

    /// Taux du bonus (en %) pour un nombre d'étoiles.
    pub fn rate(&self, stars: i64) -> f64 {
        self.rate_min + (self.rate_max - self.rate_min) * stars.clamp(0, 5) as f64 / 5.0
    }

    /// Bonus gagné sur un montant payé (arrondi à l'unité inférieure de la devise).
    pub fn bonus_for(&self, stars: i64, paid: i64) -> i64 {
        if paid <= 0 {
            return 0;
        }
        (paid as f64 * self.rate(stars) / 100.0 + 1e-6).floor() as i64
    }
}

/// Achats du client sur les 12 derniers mois qui comptent pour les étoiles.
pub fn purchases_12m(conn: &Connection, program: &Program, customer_id: i64) -> AppResult<i64> {
    Ok(conn.query_row(
        "SELECT COUNT(*) FROM sales WHERE customer_id = ?1 AND status = 'completed' AND total >= ?2
            AND created_at >= datetime('now', 'localtime', '-12 months')",
        params![customer_id, program.min_purchase],
        |r| r.get(0),
    )?)
}

pub fn stars(conn: &Connection, program: &Program, customer_id: i64) -> AppResult<i64> {
    Ok(program.stars_for(purchases_12m(conn, program, customer_id)?))
}

/// Ajoute (montant +) ou retire (montant −) du bonus d'un client, avec une ligne d'historique.
/// Un retrait ne fait jamais passer le bonus sous zéro : la somme réellement retirée est renvoyée.
pub fn add_move(
    conn: &Connection,
    customer_id: i64,
    kind: &str,
    amount: i64,
    sale_id: Option<i64>,
    return_id: Option<i64>,
    note: Option<&str>,
    user_id: Option<i64>,
) -> AppResult<i64> {
    if amount == 0 {
        return Ok(0);
    }
    let bonus: i64 = conn.query_row("SELECT loyalty_bonus FROM customers WHERE id = ?1", [customer_id], |r| r.get(0))?;
    let applied = if amount < 0 { amount.max(-bonus) } else { amount };
    if applied == 0 {
        return Ok(0);
    }
    conn.execute("UPDATE customers SET loyalty_bonus = loyalty_bonus + ?1 WHERE id = ?2", params![applied, customer_id])?;
    conn.execute(
        "INSERT INTO loyalty_moves (customer_id, kind, amount, sale_id, return_id, note, user_id, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![customer_id, kind, applied, sale_id, return_id, note, user_id, crate::db::now()],
    )?;
    Ok(applied)
}

/// Bonus expiré : aucun achat ni bonus gagné depuis « loyalty_bonus_months » mois.
pub fn expire_customer(conn: &Connection, program: &Program, customer_id: i64) -> AppResult<i64> {
    if program.months <= 0 {
        return Ok(0);
    }
    let bonus: i64 = conn.query_row("SELECT loyalty_bonus FROM customers WHERE id = ?1", [customer_id], |r| r.get(0))?;
    if bonus <= 0 {
        return Ok(0);
    }
    let stale: bool = conn.query_row(
        "SELECT COALESCE(MAX(d) < datetime('now', 'localtime', '-' || ?2 || ' months'), 1) FROM (
            SELECT MAX(created_at) AS d FROM sales WHERE customer_id = ?1 AND status = 'completed'
            UNION ALL
            SELECT MAX(created_at) FROM loyalty_moves WHERE customer_id = ?1 AND amount > 0
         )",
        params![customer_id, program.months],
        |r| r.get(0),
    )?;
    if !stale {
        return Ok(0);
    }
    let note = format!("Aucun achat depuis {} mois", program.months);
    Ok(-add_move(conn, customer_id, "expire", -bonus, None, None, Some(&note), None)?)
}

/// Expiration du bonus de tous les clients concernés (au démarrage, puis chaque heure).
pub fn expire_all(conn: &Connection) -> AppResult<i64> {
    let program = Program::load(conn)?;
    if !program.enabled || program.months <= 0 {
        return Ok(0);
    }
    let ids: Vec<i64> = conn
        .prepare("SELECT id FROM customers WHERE loyalty_bonus > 0")?
        .query_map([], |r| r.get(0))?
        .collect::<Result<_, _>>()?;
    let mut expired = 0;
    for id in ids {
        if expire_customer(conn, &program, id)? > 0 {
            expired += 1;
        }
    }
    Ok(expired)
}

/// Anciens points de fidélité convertis en bonus : `per_point` unités de la devise par point.
pub fn convert_points(conn: &mut Connection, user: &SessionUser, per_point: i64) -> AppResult<i64> {
    if !(1..=1_000_000).contains(&per_point) {
        return invalid("Valeur d'un point invalide.");
    }
    let tx = conn.transaction()?;
    let rows: Vec<(i64, i64)> = tx
        .prepare("SELECT id, loyalty_points FROM customers WHERE loyalty_points > 0")?
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?
        .collect::<Result<_, _>>()?;
    for (id, points) in &rows {
        let note = format!("{points} point(s) × {per_point}");
        add_move(&tx, *id, "convert", points.saturating_mul(per_point), None, None, Some(&note), Some(user.id))?;
        tx.execute("UPDATE customers SET loyalty_points = 0 WHERE id = ?1", [id])?;
    }
    audit::log(&tx, user, "Points de fidélité convertis en bonus", "customer", None, format!("{} client(s), 1 point = {per_point}", rows.len()))?;
    tx.commit()?;
    Ok(rows.len() as i64)
}

#[derive(Debug, Serialize)]
pub struct LoyaltyMove {
    pub id: i64,
    pub kind: String,
    pub amount: i64,
    pub sale_id: Option<i64>,
    pub sale_number: Option<String>,
    pub note: Option<String>,
    pub created_at: String,
}

/// Historique du bonus d'un client, du plus récent au plus ancien.
pub fn history(conn: &Connection, customer_id: i64) -> AppResult<Vec<LoyaltyMove>> {
    let mut stmt = conn.prepare(
        "SELECT m.id, m.kind, m.amount, m.sale_id, s.number, m.note, m.created_at
           FROM loyalty_moves m LEFT JOIN sales s ON s.id = m.sale_id
          WHERE m.customer_id = ?1 ORDER BY m.id DESC LIMIT 300",
    )?;
    let rows = stmt.query_map([customer_id], |r| {
        Ok(LoyaltyMove {
            id: r.get(0)?,
            kind: r.get(1)?,
            amount: r.get(2)?,
            sale_id: r.get(3)?,
            sale_number: r.get(4)?,
            note: r.get(5)?,
            created_at: r.get(6)?,
        })
    })?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

/// Code de la carte de fidélité d'un client (QR code), créé à la première demande : « CL000123-K7QF ».
pub fn card_code(conn: &Connection, customer_id: i64) -> AppResult<String> {
    use password_hash::rand_core::{OsRng, RngCore};
    let existing: Option<String> =
        conn.query_row("SELECT card_code FROM customers WHERE id = ?1", [customer_id], |r| r.get(0)).optional()?.flatten();
    if let Some(code) = existing {
        return Ok(code);
    }
    const ALPHABET: &[u8] = b"ABCDEFGHJKMNPQRSTUVWXYZ23456789";
    let mut bytes = [0u8; 4];
    OsRng.fill_bytes(&mut bytes);
    let suffix: String = bytes.iter().map(|b| ALPHABET[*b as usize % ALPHABET.len()] as char).collect();
    let code = format!("CL{customer_id:06}-{suffix}");
    conn.execute("UPDATE customers SET card_code = ?1 WHERE id = ?2", params![code, customer_id])?;
    Ok(code)
}

/// Client d'une carte de fidélité scannée en caisse (code exact, sans tenir compte des majuscules).
pub fn customer_by_card(conn: &Connection, code: &str) -> AppResult<Option<i64>> {
    Ok(conn
        .query_row("SELECT id FROM customers WHERE card_code = ?1 COLLATE NOCASE AND active = 1", [code.trim()], |r| r.get(0))
        .optional()?)
}
