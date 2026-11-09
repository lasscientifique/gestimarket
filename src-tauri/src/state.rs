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
    /// Langue choisie (fr, en) ; vide : langue de la boutique.
    #[serde(default)]
    pub lang: Option<String>,
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

/// Une session réseau sans signal depuis ce délai ne compte plus parmi les postes connectés
/// (appareil éteint, onglet fermé) : sa place peut être prise par un autre appareil.
pub const SESSION_ACTIVE: Duration = Duration::from_secs(180);

struct RemoteSession {
    /// Identifiant affichable (jamais le jeton).
    id: String,
    user: SessionUser,
    seen: Instant,
    ip: String,
    route: String,
    since: chrono::DateTime<chrono::Local>,
    /// Téléphone autorisé utilisé pour une connexion depuis Internet.
    device: Option<i64>,
}

/// Session ouverte, pour la liste « Postes connectés » de l'administrateur.
#[derive(Debug, Clone, Serialize)]
pub struct SessionInfo {
    pub id: String,
    pub user: String,
    pub role: String,
    pub ip: String,
    pub route: String,
    /// Ce PC (session de l'application elle-même).
    pub local: bool,
    /// Compte parmi les postes connectés.
    pub active: bool,
    pub idle_secs: u64,
    pub since: String,
}

pub struct AppState {
    db: Mutex<Connection>,
    session: Mutex<Option<(SessionUser, chrono::DateTime<chrono::Local>)>>,
    remote_sessions: Mutex<HashMap<String, RemoteSession>>,
    /// Contenu des écrans clients, par poste de caisse.
    displays: Mutex<HashMap<String, serde_json::Value>>,
    /// Échecs de connexion par appareil (adresse IP, ou « local ») et codes PIN faux par compte
    /// (« compte:<id> ») : nombre, dernier échec.
    login_failures: Mutex<HashMap<String, (u32, Instant)>>,
    pub db_path: std::path::PathBuf,
    /// Présence des postes et tickets en cours (temps réel).
    pub live: crate::live::LiveState,
}

/// Attente imposée après des échecs de connexion répétés (secondes).
fn login_lockout(failures: u32) -> u64 {
    match failures {
        0..=4 => 0,
        5..=9 => 60,
        10..=19 => 300,
        _ => 1800,
    }
}

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    // En cas de panique précédente, on récupère quand même la donnée.
    m.lock().unwrap_or_else(|e| e.into_inner())
}

impl AppState {
    /// Dossier des vignettes de photos de cette boutique (à côté de la base).
    pub fn thumbs_dir(&self) -> std::path::PathBuf {
        self.db_path.parent().map(|d| d.join("Vignettes")).unwrap_or_else(|| std::path::PathBuf::from("Vignettes"))
    }

    pub fn new(conn: Connection, db_path: std::path::PathBuf) -> Self {
        Self {
            db: Mutex::new(conn),
            session: Mutex::new(None),
            remote_sessions: Mutex::new(HashMap::new()),
            displays: Mutex::new(HashMap::new()),
            login_failures: Mutex::new(HashMap::new()),
            db_path,
            live: Default::default(),
        }
    }

    pub fn conn(&self) -> MutexGuard<'_, Connection> {
        lock(&self.db)
    }

    /// Utilisateur associé à l'appel. Une session réseau restée sans signal perd sa place si
    /// tous les postes autorisés par la licence sont déjà occupés.
    pub fn user(&self, origin: &Origin) -> Option<SessionUser> {
        match origin {
            Origin::Local => lock(&self.session).as_ref().map(|(u, _)| u.clone()),
            Origin::Remote(Some(token)) => {
                let local_on = lock(&self.session).is_some();
                let mut sessions = lock(&self.remote_sessions);
                sessions.retain(|_, s| s.seen.elapsed() < REMOTE_SESSION_TTL);
                let idle = sessions.get(token)?.seen.elapsed() >= SESSION_ACTIVE;
                if idle {
                    let others = sessions.iter().filter(|(t, s)| *t != token && s.seen.elapsed() < SESSION_ACTIVE).count() + local_on as usize;
                    if others >= crate::license::max_postes() {
                        sessions.remove(token);
                        return None;
                    }
                }
                sessions.get_mut(token).map(|s| {
                    s.seen = Instant::now();
                    s.user.clone()
                })
            }
            Origin::Remote(None) => None,
        }
    }

    /// Ouvre (ou ferme) la session, sans contrôle du nombre de postes. Pour un poste distant,
    /// retourne le jeton créé.
    pub fn set_user(&self, origin: &Origin, user: Option<SessionUser>) -> Option<String> {
        self.open_session(origin, user, "", "local", None)
    }

    fn open_session(&self, origin: &Origin, user: Option<SessionUser>, ip: &str, route: &str, device: Option<i64>) -> Option<String> {
        match origin {
            Origin::Local => {
                *lock(&self.session) = user.map(|u| (u, chrono::Local::now()));
                None
            }
            Origin::Remote(token) => {
                let mut sessions = lock(&self.remote_sessions);
                if let Some(t) = token {
                    sessions.remove(t);
                }
                user.map(|u| {
                    let t = new_token();
                    let id = new_token()[..12].to_string();
                    sessions.insert(
                        t.clone(),
                        RemoteSession {
                            id,
                            user: u,
                            seen: Instant::now(),
                            ip: ip.to_string(),
                            route: route.to_string(),
                            since: chrono::Local::now(),
                            device,
                        },
                    );
                    t
                })
            }
        }
    }

    /// Postes connectés en ce moment : ce PC (s'il a une session) et les appareils actifs.
    pub fn active_sessions(&self) -> usize {
        let local_on = lock(&self.session).is_some();
        let remote = lock(&self.remote_sessions).values().filter(|s| s.seen.elapsed() < SESSION_ACTIVE).count();
        remote + local_on as usize
    }

    /// Vérifie qu'une place est libre pour une nouvelle connexion (nombre de postes de la licence).
    /// L'administrateur peut toujours se connecter sur ce PC, pour libérer des places.
    pub fn ensure_slot(&self, origin: &Origin, user: &SessionUser, max: usize) -> AppResult<()> {
        if matches!(origin, Origin::Local) && user.is_admin() {
            return Ok(());
        }
        let local_on = lock(&self.session).is_some();
        let except = match origin {
            Origin::Remote(Some(t)) => Some(t.as_str()),
            _ => None,
        };
        let remote = lock(&self.remote_sessions)
            .iter()
            .filter(|(t, s)| Some(t.as_str()) != except && s.seen.elapsed() < SESSION_ACTIVE)
            .count();
        // Une nouvelle connexion sur ce PC remplace sa propre session.
        let used = remote + (local_on && !matches!(origin, Origin::Local)) as usize;
        if used >= max {
            let plan = crate::license::plan_label(&crate::license::effective().plan);
            return Err(AppError::Validation(format!(
                "Nombre maximal de postes connectés atteint ({max} avec la formule {plan}). Déconnectez un appareil \
                 (Poste & réseau → Postes connectés, administrateur) ou passez à une formule supérieure."
            )));
        }
        Ok(())
    }

    /// Connexion d'un utilisateur : contrôle du nombre de postes, puis ouverture de la session.
    /// `device` : téléphone autorisé utilisé depuis Internet (sa session se ferme s'il est retiré).
    pub fn start_session(
        &self,
        origin: &Origin,
        user: SessionUser,
        ip: &str,
        route: &str,
        device: Option<i64>,
    ) -> AppResult<Option<String>> {
        self.ensure_slot(origin, &user, crate::license::max_postes())?;
        Ok(self.open_session(origin, Some(user), ip, route, device))
    }

    /// Ferme toutes les sessions d'une personne (compte bloqué ou supprimé). Retourne leur nombre.
    pub fn kick_user(&self, user_id: i64) -> usize {
        let mut n = 0;
        {
            let mut local = lock(&self.session);
            if local.as_ref().is_some_and(|(u, _)| u.id == user_id) {
                *local = None;
                n += 1;
            }
        }
        let mut sessions = lock(&self.remote_sessions);
        let before = sessions.len();
        sessions.retain(|_, s| s.user.id != user_id);
        n + before - sessions.len()
    }

    /// Ferme les sessions ouvertes depuis un téléphone retiré.
    pub fn kick_device(&self, device_id: i64) -> usize {
        let mut sessions = lock(&self.remote_sessions);
        let before = sessions.len();
        sessions.retain(|_, s| s.device != Some(device_id));
        before - sessions.len()
    }

    /// Sessions ouvertes (liste de l'administrateur).
    pub fn sessions(&self) -> Vec<SessionInfo> {
        let mut out = Vec::new();
        if let Some((u, since)) = lock(&self.session).as_ref() {
            out.push(SessionInfo {
                id: "local".into(),
                user: u.full_name.clone(),
                role: u.role.clone(),
                ip: "ce PC".into(),
                route: "local".into(),
                local: true,
                active: true,
                idle_secs: 0,
                since: since.format("%d/%m %H:%M").to_string(),
            });
        }
        let mut remote: Vec<SessionInfo> = lock(&self.remote_sessions)
            .values()
            .filter(|s| s.seen.elapsed() < REMOTE_SESSION_TTL)
            .map(|s| SessionInfo {
                id: s.id.clone(),
                user: s.user.full_name.clone(),
                role: s.user.role.clone(),
                ip: s.ip.clone(),
                route: s.route.clone(),
                local: false,
                active: s.seen.elapsed() < SESSION_ACTIVE,
                idle_secs: s.seen.elapsed().as_secs(),
                since: s.since.format("%d/%m %H:%M").to_string(),
            })
            .collect();
        remote.sort_by_key(|s| s.idle_secs);
        out.extend(remote);
        out
    }

    /// Ferme la session réseau d'un appareil (l'appareil revient à l'écran de connexion).
    pub fn kick(&self, id: &str) -> Option<SessionUser> {
        let mut sessions = lock(&self.remote_sessions);
        let token = sessions.iter().find(|(_, s)| s.id == id).map(|(t, _)| t.clone())?;
        sessions.remove(&token).map(|s| s.user)
    }

    /// Refuse temporairement les connexions d'un appareil après des échecs répétés.
    pub fn login_guard(&self, key: &str) -> AppResult<()> {
        if let Some((n, last)) = lock(&self.login_failures).get(key) {
            let wait = login_lockout(*n).saturating_sub(last.elapsed().as_secs());
            if wait > 0 {
                return Err(AppError::Validation(format!("Trop d'essais de connexion depuis cet appareil. Réessayez dans {wait} s.")));
            }
        }
        Ok(())
    }

    /// Refuse temporairement un compte après des codes PIN faux répétés (connexion ou validation).
    pub fn account_guard(&self, user_id: i64) -> AppResult<()> {
        if let Some((n, last)) = lock(&self.login_failures).get(&format!("compte:{user_id}")) {
            let wait = login_lockout(*n).saturating_sub(last.elapsed().as_secs());
            if wait > 0 {
                return Err(AppError::Validation(format!("Trop de codes PIN faux pour ce compte. Réessayez dans {wait} s.")));
            }
        }
        Ok(())
    }

    pub fn account_result(&self, user_id: i64, ok: bool) {
        self.login_result(&format!("compte:{user_id}"), ok);
    }

    pub fn login_result(&self, key: &str, ok: bool) {
        let mut m = lock(&self.login_failures);
        m.retain(|_, (_, last)| last.elapsed() < Duration::from_secs(3600));
        if ok {
            m.remove(key);
        } else {
            let e = m.entry(key.to_string()).or_insert((0, Instant::now()));
            e.0 += 1;
            e.1 = Instant::now();
        }
    }

    /// Met à jour les informations de l'utilisateur connecté sans changer sa session (ni son jeton).
    pub fn update_user(&self, origin: &Origin, user: SessionUser) {
        match origin {
            Origin::Local => {
                if let Some(entry) = lock(&self.session).as_mut() {
                    entry.0 = user;
                }
            }
            Origin::Remote(Some(token)) => {
                if let Some(entry) = lock(&self.remote_sessions).get_mut(token) {
                    entry.user = user;
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
