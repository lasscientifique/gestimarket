use std::collections::BTreeMap;

use rusqlite::{params, Connection, OptionalExtension};

use crate::error::{invalid, AppResult};
use crate::services::audit;
use crate::state::SessionUser;

/// Paramètres connus et leurs valeurs par défaut.
pub const DEFAULTS: &[(&str, &str)] = &[
    ("shop_name", "Ma Boutique"),
    // Pannes du programme envoyées à Eden Dev (aucune donnée commerciale) : « 0 » pour refuser.
    ("error_reports", "1"),
    ("shop_address", ""),
    ("shop_phone", ""),
    ("shop_email", ""),
    ("shop_tax_id", ""),
    ("currency_symbol", "FCFA"),
    ("currency_decimals", "0"),
    ("receipt_footer", "Merci de votre visite et à bientôt !"),
    ("receipt_width", "80"),
    ("allow_negative_stock", "0"),
    ("require_cash_session", "1"),
    // Anciens points de fidélité (1 point par tranche) : remplacés par le programme client fidèle.
    ("loyalty_step", "0"),
    // Programme client fidèle (formules PRO et BUSINESS) : étoiles de 0 à 5 selon le nombre d'achats
    // des 12 derniers mois (paliers), bonus de « loyalty_rate_min » % (0 étoile) à « loyalty_rate_max » %
    // (5 étoiles) du montant payé, utilisable en caisse. Un achat sous « loyalty_min_purchase » ne compte
    // pas pour les étoiles. Le bonus expire « loyalty_bonus_months » mois après le dernier achat (0 : jamais).
    ("loyalty_enabled", "0"),
    ("loyalty_rate_min", "0.5"),
    ("loyalty_rate_max", "1"),
    ("loyalty_star_steps", "3,10,25,50,100"),
    ("loyalty_min_purchase", "500"),
    ("loyalty_bonus_months", "12"),
    ("default_tax_rate", "0"),
    ("shop_logo_id", ""),
    // International : langue des tickets et du catalogue, pays (formats), devise (code ISO 4217)
    ("shop_lang", "fr"),
    ("country", "ML"),
    ("currency_code", "XOF"),
    ("currency_position", "after"),
    // Taxes : taux nommés (une ligne « Nom=taux »), prix TTC (1) ou HT (0)
    ("tax_rates", ""),
    ("prices_include_tax", "1"),
    // Opérateurs de mobile money proposés en caisse (JSON), en plus d'Orange Money
    ("mobile_operators", ""),
    // Orange Money / Sarali
    ("om_enabled", "1"),
    ("om_label", "Orange Money / Sarali"),
    ("om_merchant_number", ""),
    ("om_merchant_name", ""),
    ("om_qr_image_id", ""),
    ("om_qr_payload", ""),
    ("om_require_reference", "1"),
    // Type de commerce et fonctions activées (expiry, brand, sku, packagings, services, decimal)
    ("business_type", ""),
    // Activités de la boutique (la principale d'abord, 3 au plus), séparées par des virgules
    ("business_types", ""),
    ("enabled_features", "expiry,brand,sku,packagings,decimal"),
    // Application mobile : publication de l'adresse du poste serveur sur Supabase
    ("supabase_enabled", "0"),
    ("supabase_url", ""),
    ("supabase_key", ""),
    ("shop_code", ""),
    ("public_url", ""),
    // Apparence (logo : shop_logo_id)
    ("theme_color", ""),
    ("theme_mode", "light"),
    ("sidebar_style", "dark"),
    // Sécurité : niveau requis pour confirmer par PIN (cashier, manager, admin)
    ("pin_void_level", "cashier"),
    ("pin_discount_level", "manager"),
    // Remise maximale sans validation (% du ticket) ; au-delà, PIN du niveau ci-dessus, contrôlé par le serveur.
    ("discount_free_percent", "5"),
    // Stock
    ("expiry_alert_days", "30"),
    // Retours : délai après la vente (jours) et durée de validité d'un avoir (jours)
    ("return_days", "7"),
    ("credit_note_days", "90"),
    // Sauvegarde automatique
    ("auto_backup_dir", ""),
    ("auto_backup_keep", "14"),
];

/// Clés internes, non modifiables depuis l'écran des paramètres.
const INTERNAL: &[&str] = &[
    "barcode_seq",
    "last_auto_backup",
    "supabase_secret",
    // Jeton du tunnel Cloudflare de la boutique (adresse Internet automatique, voir tunnel.rs).
    "tunnel_token",
    // Licence et compte boutique (voir license.rs) : lus par « license_status », jamais par l'écran des paramètres.
    "license_file",
    "license_clock",
    "account_email",
    "account_store_code",
    "account_store_name",
    // Essai gratuit sans Internet (date de début) et clé des sauvegardes protégées (jamais montrée).
    "trial_started_at",
    "backup_key",
];

pub fn get_all(conn: &Connection) -> AppResult<BTreeMap<String, String>> {
    let mut map: BTreeMap<String, String> =
        DEFAULTS.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect();
    let mut stmt = conn.prepare("SELECT key, value FROM settings")?;
    let rows = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?;
    for row in rows {
        let (k, v) = row?;
        if !INTERNAL.contains(&k.as_str()) {
            map.insert(k, v);
        }
    }
    Ok(map)
}

pub fn get(conn: &Connection, key: &str) -> AppResult<String> {
    let stored: Option<String> = conn
        .query_row("SELECT value FROM settings WHERE key = ?1", [key], |r| r.get(0))
        .optional()?;
    Ok(stored.unwrap_or_else(|| {
        DEFAULTS
            .iter()
            .find(|(k, _)| *k == key)
            .map(|(_, v)| v.to_string())
            .unwrap_or_default()
    }))
}

pub fn get_bool(conn: &Connection, key: &str) -> AppResult<bool> {
    Ok(matches!(get(conn, key)?.as_str(), "1" | "true"))
}

pub fn get_i64(conn: &Connection, key: &str) -> AppResult<i64> {
    Ok(get(conn, key)?.trim().parse().unwrap_or(0))
}

pub fn set(conn: &Connection, key: &str, value: &str) -> AppResult<()> {
    conn.execute(
        "INSERT INTO settings (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value],
    )?;
    Ok(())
}

pub fn update(
    conn: &mut Connection,
    user: &SessionUser,
    values: BTreeMap<String, String>,
) -> AppResult<BTreeMap<String, String>> {
    let current = get_all(conn)?;
    for (key, value) in &values {
        if !DEFAULTS.iter().any(|(k, _)| k == key) {
            return invalid(format!("Paramètre inconnu : {key}"));
        }
        if key == "currency_decimals" {
            let d: i64 = value.parse().unwrap_or(-1);
            if !(0..=3).contains(&d) {
                return invalid("Le nombre de décimales doit être compris entre 0 et 3.");
            }
            if current.get(key) != Some(value) {
                let products: i64 =
                    conn.query_row("SELECT COUNT(*) FROM products", [], |r| r.get(0))?;
                if products > 0 {
                    return invalid(
                        "Impossible de modifier le nombre de décimales de la devise après la création de produits.",
                    );
                }
            }
        }
        if key == "mobile_operators" {
            crate::services::sales::validate_operators(value)?;
        }
        if key == "discount_free_percent" && !matches!(value.trim().parse::<i64>(), Ok(0..=100)) {
            return invalid("La remise maximale sans validation doit être comprise entre 0 et 100 %.");
        }
        if key == "shop_name" && value.trim().is_empty() {
            return invalid("Le nom du commerce est obligatoire.");
        }
        if key == "loyalty_enabled" && value.trim() == "1" && current.get(key) != Some(value) && !crate::license::loyalty_allowed() {
            return invalid("Le programme client fidèle est inclus à partir de la formule PRO : voir « Abonnement & licence ».");
        }
    }
    // Programme client fidèle : taux, paliers d'étoiles, achat minimum, durée du bonus.
    let pick = |k: &str| values.get(k).cloned().or_else(|| current.get(k).cloned()).unwrap_or_default();
    if values.keys().any(|k| k.starts_with("loyalty_")) {
        crate::services::loyalty::Program::parse(
            &pick("loyalty_enabled"),
            &pick("loyalty_rate_min"),
            &pick("loyalty_rate_max"),
            &pick("loyalty_star_steps"),
            &pick("loyalty_min_purchase"),
            &pick("loyalty_bonus_months"),
        )?;
    }

    let tx = conn.transaction()?;
    let mut changed = Vec::new();
    for (key, value) in &values {
        if current.get(key) != Some(value) {
            set(&tx, key, value.trim())?;
            changed.push(key.as_str());
        }
    }
    if !changed.is_empty() {
        audit::log(&tx, user, "Modification des paramètres", "settings", None, changed.join(", "))?;
    }
    tx.commit()?;
    get_all(conn)
}
