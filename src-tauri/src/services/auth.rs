//! Personnel : identifiant et code PIN, sans mot de passe (seule la boutique a un compte en ligne).
//! Le PIN de l'administrateur a 6 chiffres, celui des autres 4 à 6. Chacun peut changer le sien ;
//! l'administrateur les attribue, les remet à zéro et valide les actions des autres par son propre PIN.

use argon2::password_hash::rand_core::{OsRng, RngCore};
use argon2::password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString};
use argon2::Argon2;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

use crate::db;
use crate::error::{invalid, AppError, AppResult};
use crate::services::{audit, settings};
use crate::state::SessionUser;

/// Longueur du PIN d'un administrateur.
pub const ADMIN_PIN_LEN: usize = 6;

pub fn hash_password(password: &str) -> AppResult<String> {
    let salt = SaltString::generate(&mut OsRng);
    Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map(|h| h.to_string())
        .map_err(|e| AppError::Internal(format!("hachage du code : {e}")))
}

pub fn verify_password(password: &str, hash: &str) -> bool {
    PasswordHash::new(hash)
        .map(|parsed| Argon2::default().verify_password(password.as_bytes(), &parsed).is_ok())
        .unwrap_or(false)
}

pub fn validate_username(username: &str) -> AppResult<String> {
    let u = username.trim().to_lowercase();
    if u.len() < 3 || u.len() > 32 || !u.chars().all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '_' || c == '-') {
        return invalid(
            "Identifiant invalide : 3 à 32 caractères, lettres sans accent, chiffres, « . », « _ » ou « - ».",
        );
    }
    Ok(u)
}

pub fn needs_setup(conn: &Connection) -> AppResult<bool> {
    let count: i64 = conn.query_row("SELECT COUNT(*) FROM users", [], |r| r.get(0))?;
    Ok(count == 0)
}

/// Langue acceptée (fr, en), sinon aucune.
pub fn valid_lang(lang: &Option<String>) -> Option<String> {
    lang.as_deref().map(str::trim).filter(|l| matches!(*l, "fr" | "en")).map(String::from)
}

// ───────────────────────────── Code PIN ─────────────────────────────

/// PIN trop simple : un seul chiffre répété, ou suite (1234, 987654…).
fn too_simple(pin: &str) -> bool {
    pin.chars().all(|c| pin.starts_with(c)) || "0123456789".contains(pin) || "9876543210".contains(pin)
}

/// PIN valable pour un rôle : 6 chiffres pour un administrateur, 4 à 6 pour les autres.
pub fn validate_pin(pin: &str, role: &str) -> AppResult<()> {
    if !pin.chars().all(|c| c.is_ascii_digit()) || pin.is_empty() {
        return invalid("Le code PIN ne contient que des chiffres.");
    }
    if role == "admin" && pin.len() != ADMIN_PIN_LEN {
        return invalid("Le code PIN de l'administrateur doit contenir 6 chiffres.");
    }
    if !(4..=6).contains(&pin.len()) {
        return invalid("Le code PIN doit contenir 4 à 6 chiffres.");
    }
    if too_simple(pin) {
        return invalid("Code PIN trop simple (évitez 1111, 1234…).");
    }
    Ok(())
}

/// Code PIN tiré au hasard, jamais trop simple.
pub fn random_pin(len: usize) -> String {
    loop {
        let pin: String = (0..len).map(|_| char::from(b'0' + (OsRng.next_u32() % 10) as u8)).collect();
        if !too_simple(&pin) {
            return pin;
        }
    }
}

// ───────────────────────────── Première configuration ─────────────────────────────

/// Poste de l'équipe créé à la première configuration (ou proposé par défaut).
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct TeamMember {
    pub role: String,
    pub full_name: String,
    pub username: String,
    pub pin: String,
}

#[derive(Debug, Deserialize)]
pub struct SetupInput {
    pub shop_name: String,
    pub shop_phone: Option<String>,
    pub shop_address: Option<String>,
    pub currency_symbol: String,
    pub currency_decimals: i64,
    /// Administrateur : nom, identifiant (admin par défaut) et PIN de 6 chiffres.
    pub full_name: String,
    #[serde(default)]
    pub username: Option<String>,
    pub pin: String,
    /// Autres postes. Absent : un gestionnaire et une caissière, avec un PIN tiré au hasard.
    #[serde(default)]
    pub team: Option<Vec<TeamMember>>,
    /// Langue de la boutique et de l'administrateur (fr, en).
    #[serde(default)]
    pub lang: Option<String>,
    /// Pays de la boutique (code ISO à 2 lettres).
    #[serde(default)]
    pub country: Option<String>,
    /// Devise (code ISO 4217, ex. XOF) et place du symbole (before, after).
    #[serde(default)]
    pub currency_code: Option<String>,
    #[serde(default)]
    pub currency_position: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct SetupResult {
    pub user: SessionUser,
    /// Postes créés, avec leur PIN en clair (fiches d'accès à imprimer, une seule fois).
    pub team: Vec<TeamMember>,
}

/// Équipe par défaut d'une boutique : un gestionnaire et une caissière.
pub fn default_team() -> Vec<TeamMember> {
    vec![
        TeamMember { role: "manager".into(), full_name: "Gestionnaire".into(), username: "gestionnaire".into(), pin: random_pin(4) },
        TeamMember { role: "cashier".into(), full_name: "Caissière 1".into(), username: "caisse1".into(), pin: random_pin(4) },
    ]
}

/// Premier démarrage : crée l'administrateur, son équipe et les paramètres du commerce.
pub fn initial_setup(conn: &mut Connection, input: SetupInput) -> AppResult<SetupResult> {
    if !needs_setup(conn)? {
        return invalid("L'application est déjà configurée.");
    }
    if input.shop_name.trim().is_empty() {
        return invalid("Le nom du commerce est obligatoire.");
    }
    if input.full_name.trim().is_empty() {
        return invalid("Le nom de l'administrateur est obligatoire.");
    }
    if input.currency_symbol.trim().is_empty() {
        return invalid("Le symbole de la devise est obligatoire.");
    }
    if !(0..=3).contains(&input.currency_decimals) {
        return invalid("Le nombre de décimales doit être compris entre 0 et 3.");
    }
    let username = validate_username(input.username.as_deref().unwrap_or("admin"))?;
    validate_pin(&input.pin, "admin")?;
    let team = input.team.clone().unwrap_or_else(default_team);
    let mut names = vec![username.clone()];
    for m in &team {
        if !matches!(m.role.as_str(), "manager" | "cashier") {
            return invalid("Équipe : rôle invalide (gestionnaire ou caissière).");
        }
        if m.full_name.trim().is_empty() {
            return invalid("Équipe : chaque poste a un nom.");
        }
        let u = validate_username(&m.username)?;
        if names.contains(&u) {
            return invalid(format!("L'identifiant « {u} » est utilisé deux fois."));
        }
        names.push(u);
        validate_pin(m.pin.trim(), &m.role)?;
    }

    let tx = conn.transaction()?;
    let lang = valid_lang(&input.lang);
    tx.execute(
        "INSERT INTO users (username, full_name, password_hash, pin_hash, role, created_at, lang, internet_access)
         VALUES (?1, ?2, '', ?3, 'admin', ?4, ?5, 1)",
        params![username, input.full_name.trim(), hash_password(&input.pin)?, db::now(), lang],
    )?;
    let user = SessionUser {
        id: tx.last_insert_rowid(),
        username,
        full_name: input.full_name.trim().to_string(),
        role: "admin".into(),
        has_pin: true,
        lang: lang.clone(),
    };
    let mut created = Vec::new();
    for m in team {
        let u = validate_username(&m.username)?;
        tx.execute(
            "INSERT INTO users (username, full_name, password_hash, pin_hash, role, created_at) VALUES (?1, ?2, '', ?3, ?4, ?5)",
            params![u, m.full_name.trim(), hash_password(m.pin.trim())?, m.role, db::now()],
        )?;
        created.push(TeamMember { role: m.role, full_name: m.full_name.trim().to_string(), username: u, pin: m.pin.trim().to_string() });
    }
    if let Some(l) = &lang {
        settings::set(&tx, "shop_lang", l)?;
    }
    if let Some(c) = db::clean(&input.country).map(|c| c.to_uppercase()).filter(|c| c.len() == 2 && c.chars().all(|x| x.is_ascii_uppercase())) {
        settings::set(&tx, "country", &c)?;
    }
    if let Some(code) = db::clean(&input.currency_code).map(|c| c.to_uppercase()).filter(|c| c.len() == 3 && c.chars().all(|x| x.is_ascii_uppercase())) {
        settings::set(&tx, "currency_code", &code)?;
    }
    if let Some(pos) = db::clean(&input.currency_position).filter(|p| p == "before" || p == "after") {
        settings::set(&tx, "currency_position", &pos)?;
    }
    settings::set(&tx, "shop_name", input.shop_name.trim())?;
    settings::set(&tx, "currency_symbol", input.currency_symbol.trim())?;
    settings::set(&tx, "currency_decimals", &input.currency_decimals.to_string())?;
    if let Some(phone) = db::clean(&input.shop_phone) {
        settings::set(&tx, "shop_phone", &phone)?;
    }
    if let Some(address) = db::clean(&input.shop_address) {
        settings::set(&tx, "shop_address", &address)?;
    }
    let detail = created.iter().map(|m| format!("{} ({})", m.username, m.role)).collect::<Vec<_>>().join(", ");
    audit::log(&tx, &user, "Configuration initiale", "settings", None, format!("Administrateur et équipe : {detail}"))?;
    tx.commit()?;
    Ok(SetupResult { user, team: created })
}

// ───────────────────────────── Connexion ─────────────────────────────

/// Compte du personnel (jamais un compte supprimé).
pub struct Account {
    pub id: i64,
    pub username: String,
    pub full_name: String,
    pub role: String,
    pub active: bool,
    pub pin_hash: Option<String>,
    pub password_hash: String,
    pub lang: Option<String>,
    pub internet_access: bool,
}

impl Account {
    pub fn session(&self) -> SessionUser {
        SessionUser {
            id: self.id,
            username: self.username.clone(),
            full_name: self.full_name.clone(),
            role: self.role.clone(),
            has_pin: self.pin_hash.is_some(),
            lang: self.lang.clone(),
        }
    }
}

const ACCOUNT_SELECT: &str =
    "SELECT id, username, full_name, role, active, pin_hash, password_hash, lang, internet_access FROM users WHERE deleted_at IS NULL";

fn account_row(r: &rusqlite::Row) -> rusqlite::Result<Account> {
    Ok(Account {
        id: r.get(0)?,
        username: r.get(1)?,
        full_name: r.get(2)?,
        role: r.get(3)?,
        active: r.get(4)?,
        pin_hash: r.get(5)?,
        password_hash: r.get(6)?,
        lang: r.get(7)?,
        internet_access: r.get(8)?,
    })
}

pub fn account_by_id(conn: &Connection, id: i64) -> AppResult<Option<Account>> {
    Ok(conn.query_row(&format!("{ACCOUNT_SELECT} AND id = ?1"), [id], account_row).optional()?)
}

pub fn account_by_username(conn: &Connection, username: &str) -> AppResult<Option<Account>> {
    Ok(conn.query_row(&format!("{ACCOUNT_SELECT} AND username = ?1"), [username.trim()], account_row).optional()?)
}

/// Compte prêt à se connecter par PIN (actif, PIN attribué), sinon un message clair.
pub fn can_use_pin(a: &Account) -> AppResult<&str> {
    if !a.active {
        return invalid("Ce compte est bloqué. Contactez l'administrateur.");
    }
    match a.pin_hash.as_deref() {
        Some(h) => Ok(h),
        None if a.role == "admin" && !a.password_hash.is_empty() => {
            invalid("Ce compte n'a pas encore de code PIN : connectez-vous une dernière fois avec votre ancien mot de passe pour le créer.")
        }
        None => invalid("Ce compte n'a pas encore de code PIN : l'administrateur doit vous en donner un."),
    }
}

/// Vérifie le PIN d'un compte. `Ok(None)` : PIN faux (compté par l'appelant contre la force brute).
pub fn check_pin(conn: &Connection, a: &Account, pin: &str) -> AppResult<Option<SessionUser>> {
    let hash = can_use_pin(a)?;
    if !verify_password(pin.trim(), hash) {
        return Ok(None);
    }
    conn.execute("UPDATE users SET last_login_at = ?1 WHERE id = ?2", params![db::now(), a.id])?;
    Ok(Some(a.session()))
}

/// Ancien mot de passe : seulement pour un administrateur qui n'a pas encore de PIN (mise à jour depuis la 0.13).
pub fn login_password(conn: &Connection, username: &str, password: &str) -> AppResult<SessionUser> {
    let bad = || invalid("Identifiant ou mot de passe incorrect.");
    let Some(a) = account_by_username(conn, username)? else { return bad() };
    if a.pin_hash.is_some() || a.password_hash.is_empty() {
        return invalid("Les mots de passe n'existent plus : connectez-vous avec votre identifiant et votre code PIN.");
    }
    if !verify_password(password, &a.password_hash) {
        return bad();
    }
    if !a.active {
        return invalid("Ce compte est bloqué. Contactez l'administrateur.");
    }
    conn.execute("UPDATE users SET last_login_at = ?1 WHERE id = ?2", params![db::now(), a.id])?;
    let user = a.session();
    audit::log(conn, &user, "Connexion (ancien mot de passe)", "user", Some(a.id), "")?;
    Ok(user)
}

/// Crée son code PIN avec l'ancien mot de passe (mise à jour depuis la 0.13) ; le mot de passe est effacé.
pub fn set_own_pin(conn: &Connection, user: &SessionUser, password: &str, pin: &str) -> AppResult<()> {
    let hash: String = conn.query_row("SELECT password_hash FROM users WHERE id = ?1", [user.id], |r| r.get(0))?;
    if hash.is_empty() || !verify_password(password, &hash) {
        return invalid("Mot de passe incorrect.");
    }
    validate_pin(pin, &user.role)?;
    conn.execute("UPDATE users SET pin_hash = ?1, password_hash = '' WHERE id = ?2", params![hash_password(pin)?, user.id])?;
    audit::log(conn, user, "Création du code PIN", "user", Some(user.id), "")?;
    Ok(())
}

/// Changer son propre code PIN (l'actuel est demandé). `Ok(false)` : PIN actuel faux.
pub fn change_own_pin(conn: &Connection, user: &SessionUser, current: &str, pin: &str) -> AppResult<bool> {
    let hash: Option<String> = conn.query_row("SELECT pin_hash FROM users WHERE id = ?1", [user.id], |r| r.get(0))?;
    if !hash.is_some_and(|h| verify_password(current.trim(), &h)) {
        return Ok(false);
    }
    validate_pin(pin.trim(), &user.role)?;
    if current.trim() == pin.trim() {
        return invalid("Choisissez un code différent de l'actuel.");
    }
    conn.execute("UPDATE users SET pin_hash = ?1 WHERE id = ?2", params![hash_password(pin.trim())?, user.id])?;
    audit::log(conn, user, "Changement de son code PIN", "user", Some(user.id), "")?;
    Ok(true)
}

#[derive(Debug, Serialize)]
pub struct ResetAdmin {
    pub username: String,
    pub full_name: String,
}

/// PIN administrateur oublié : nouveau PIN (6 chiffres), après vérification du compte boutique par l'appelant.
/// Sans identifiant précisé : le premier administrateur. Le compte est débloqué.
pub fn reset_admin_pin(conn: &Connection, username: Option<&str>, pin: &str) -> AppResult<ResetAdmin> {
    validate_pin(pin, "admin")?;
    let admin = match username.map(str::trim).filter(|u| !u.is_empty()) {
        Some(u) => account_by_username(conn, u)?,
        None => {
            let id: Option<i64> = conn
                .query_row("SELECT id FROM users WHERE role = 'admin' AND deleted_at IS NULL ORDER BY active DESC, id LIMIT 1", [], |r| r.get(0))
                .optional()?;
            match id {
                Some(id) => account_by_id(conn, id)?,
                None => None,
            }
        }
    };
    let Some(admin) = admin.filter(|x| x.role == "admin") else { return invalid("Administrateur introuvable.") };
    conn.execute(
        "UPDATE users SET pin_hash = ?1, password_hash = '', active = 1 WHERE id = ?2",
        params![hash_password(pin)?, admin.id],
    )?;
    audit::log_system(conn, "Code PIN administrateur refait avec le compte boutique", "user", Some(admin.id), &admin.username)?;
    Ok(ResetAdmin { username: admin.username, full_name: admin.full_name })
}

#[derive(Debug, Serialize)]
pub struct LoginUser {
    pub id: i64,
    pub username: String,
    pub full_name: String,
    pub role: String,
    pub has_pin: bool,
    /// Ancien mot de passe utilisable (administrateur sans PIN, mise à jour depuis la 0.13).
    pub legacy_password: bool,
}

/// Comptes actifs affichés sur l'écran de connexion rapide (nom et rôle uniquement).
pub fn login_users(conn: &Connection) -> AppResult<Vec<LoginUser>> {
    let mut stmt = conn.prepare(
        "SELECT id, username, full_name, role, pin_hash IS NOT NULL, pin_hash IS NULL AND role = 'admin' AND password_hash <> ''
         FROM users WHERE active = 1 AND deleted_at IS NULL
         ORDER BY CASE role WHEN 'cashier' THEN 0 WHEN 'manager' THEN 1 ELSE 2 END, full_name COLLATE NOCASE",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(LoginUser {
            id: r.get(0)?,
            username: r.get(1)?,
            full_name: r.get(2)?,
            role: r.get(3)?,
            has_pin: r.get(4)?,
            legacy_password: r.get(5)?,
        })
    })?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

/// Responsables pouvant valider une action d'un niveau donné (fenêtre de validation).
pub fn approvers(conn: &Connection, min_level: u8) -> AppResult<Vec<LoginUser>> {
    Ok(login_users(conn)?
        .into_iter()
        .filter(|u| u.has_pin && crate::state::role_level(&u.role) >= min_level)
        .rev()
        .collect())
}

// ───────────────────────────── Validation des actions ─────────────────────────────

pub enum Approval {
    Approved(SessionUser),
    /// PIN faux pour cette personne.
    WrongPin(i64),
    /// La personne n'a pas le rôle suffisant : un responsable doit être choisi.
    NotAllowed,
}

/// Valide une action : par la personne connectée si son rôle suffit, sinon par le responsable choisi
/// (`approver`). Les PIN pouvant se ressembler, le PIN n'est vérifié que pour cette personne-là.
pub fn approve(conn: &Connection, current: &SessionUser, approver: Option<i64>, pin: &str, min_level: u8) -> AppResult<Approval> {
    let id = approver.unwrap_or(current.id);
    let Some(a) = account_by_id(conn, id)? else { return Ok(Approval::NotAllowed) };
    if crate::state::role_level(&a.role) < min_level {
        return Ok(Approval::NotAllowed);
    }
    let Some(hash) = a.pin_hash.as_deref().filter(|_| a.active) else { return Ok(Approval::NotAllowed) };
    if !verify_password(pin.trim(), hash) {
        return Ok(Approval::WrongPin(a.id));
    }
    Ok(Approval::Approved(SessionUser { lang: None, ..a.session() }))
}
