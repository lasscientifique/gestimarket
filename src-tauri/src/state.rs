use std::collections::HashMap;
use std::sync::{Mutex, MutexGuard};
use std::time::{Duration, Instant};

use rusqlite::Connection;
use serde::Serialize;

use crate::error::{AppError, AppResult};

/// Utilisateur connecté (gardé côté Rust : l'interface ne peut pas le falsifier).
#[derive(Debug, Clone, Serialize)]
pub struct SessionUser {
    pub id: i64,
    pub username: String,
    pub full_name: String,
    pub role: String,
    /// L'utilisateur a-t-il défini son code PIN ?
    #[serde(default)]
    pub has_pin: bool,
}

impl SessionUser {
    /// Gestionnaire ou administrateur.
    pub fn is_manager(&self) -> bool {
        self.role == "admin" || self.role == "manager"
    }
    pub fn is_admin(&self) -> bool {
        self.role == "admin"
    }
}

/// Niveau hiérarchique d'un rôle (caissier < gestionnaire < administrateur).
pub fn role_level(role: &str) -> u8 {
    match role {
        "admin" => 3,
        "manager" => 2,
        _ => 1,
    }
}

/// Niveaux d'accès des commandes.
#[derive(Debug, Clone, Copy)]
pub enum Access {
    /// Tout utilisateur connecté (caissier inclus).
    Any,
    /// Gérant ou administrateur.
    Manager,
    /// Administrateur uniquement.
    Admin,
}

/// Provenance d'un appel : l'application locale, ou un poste client du réseau (jeton de session).
#[derive(Debug, Clone)]
pub enum Origin {
    Local,
    Remote(Option<String>),
}

/// Durée de validité d'une session réseau sans activité.
const REMOTE_SESSION_TTL: Duration = Duration::from_secs(12 * 3600);

pub struct AppState {
    db: Mutex<Connection>,
    session: Mutex<Option<SessionUser>>,
    remote_sessions: Mutex<HashMap<String, (SessionUser, Instant)>>,
    /// Contenu des écrans clients, par poste de caisse.
    displays: Mutex<HashMap<String, serde_json::Value>>,
    /// Tentatives de code PIN erronées (anti force brute) : nombre, dernier échec.
    pin_failures: Mutex<(u32, Option<Instant>)>,
    pub db_path: std::path::PathBuf,
    /// Présence des postes et tickets en cours (temps réel).
    pub live: crate::live::LiveState,
}

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    // En cas de panique précédente, on récupère quand même la donnée.
    m.lock().unwrap_or_else(|e| e.into_inner())
}

impl AppState {
    pub fn new(conn: Connection, db_path: std::path::PathBuf) -> Self {
        Self {
            db: Mutex::new(conn),
            session: Mutex::new(None),
            remote_sessions: Mutex::new(HashMap::new()),
            displays: Mutex::new(HashMap::new()),
            pin_failures: Mutex::new((0, None)),
            db_path,
            live: Default::default(),
        }
    }

    pub fn conn(&self) -> MutexGuard<'_, Connection> {
        lock(&self.db)
    }

    /// Utilisateur associé à l'appel.
    pub fn user(&self, origin: &Origin) -> Option<SessionUser> {
        match origin {
            Origin::Local => lock(&self.session).clone(),
            Origin::Remote(Some(token)) => {
                let mut sessions = lock(&self.remote_sessions);
                sessions.retain(|_, (_, seen)| seen.elapsed() < REMOTE_SESSION_TTL);
                sessions.get_mut(token).map(|(u, seen)| {
                    *seen = Instant::now();
                    u.clone()
                })
            }
            Origin::Remote(None) => None,
        }
    }

    /// Ouvre (ou ferme) la session. Pour un poste distant, retourne le jeton créé.
    pub fn set_user(&self, origin: &Origin, user: Option<SessionUser>) -> Option<String> {
        match origin {
            Origin::Local => {
                *lock(&self.session) = user;
                None
            }
            Origin::Remote(token) => {
                let mut sessions = lock(&self.remote_sessions);
                if let Some(t) = token {
                    sessions.remove(t);
                }
                user.map(|u| {
                    let t = new_token();
                    sessions.insert(t.clone(), (u, Instant::now()));
                    t
                })
            }
        }
    }

    /// Met à jour les informations de l'utilisateur connecté sans changer sa session (ni son jeton).
    pub fn update_user(&self, origin: &Origin, user: SessionUser) {
        match origin {
            Origin::Local => *lock(&self.session) = Some(user),
            Origin::Remote(Some(token)) => {
                if let Some(entry) = lock(&self.remote_sessions).get_mut(token) {
                    entry.0 = user;
                }
            }
            Origin::Remote(None) => {}
        }
    }

    pub fn require(&self, origin: &Origin, access: Access) -> AppResult<SessionUser> {
        let user = self.user(origin).ok_or(AppError::Unauthenticated)?;
        let allowed = match access {
            Access::Any => true,
            Access::Manager => user.is_manager(),
            Access::Admin => user.role == "admin",
        };
        if allowed {
            Ok(user)
        } else {
            Err(AppError::Forbidden)
        }
    }

    /// Vérifie les droits puis exécute `f` avec la connexion verrouillée.
    pub fn run<T>(
        &self,
        origin: &Origin,
        access: Access,
        f: impl FnOnce(&mut Connection, &SessionUser) -> AppResult<T>,
    ) -> AppResult<T> {
        let user = self.require(origin, access)?;
        let mut conn = self.conn();
        f(&mut conn, &user)
    }

    /// Refuse temporairement les codes PIN après 5 échecs consécutifs (1 minute).
    pub fn pin_guard(&self) -> AppResult<()> {
        let f = lock(&self.pin_failures);
        if f.0 >= 5 {
            if let Some(t) = f.1 {
                let wait = 60u64.saturating_sub(t.elapsed().as_secs());
                if wait > 0 {
                    return Err(AppError::Validation(format!("Trop d'essais de code PIN. Réessayez dans {wait} s.")));
                }
            }
        }
        Ok(())
    }

    pub fn pin_result(&self, ok: bool) {
        let mut f = lock(&self.pin_failures);
        if ok {
            *f = (0, None);
        } else {
            f.0 = if f.0 >= 5 { 1 } else { f.0 + 1 };
            f.1 = Some(Instant::now());
        }
    }

    pub fn set_display(&self, poste: &str, value: serde_json::Value) {
        lock(&self.displays).insert(poste.to_string(), value);
    }

    pub fn display(&self, poste: &str) -> serde_json::Value {
        lock(&self.displays).get(poste).cloned().unwrap_or(serde_json::Value::Null)
    }
}

fn new_token() -> String {
    use password_hash::rand_core::{OsRng, RngCore};
    let mut bytes = [0u8; 24];
    OsRng.fill_bytes(&mut bytes);
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}
