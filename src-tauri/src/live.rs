//! État « temps réel » partagé par le poste serveur (en mémoire, non enregistré en base) :
//!  - présence des postes connectés (PC clients, tablettes, téléphones, écrans clients) ;
//!  - tickets en cours de chaque caisse, pour qu'un caissier puisse suivre un collègue
//!    et reprendre son client sans tout ressaisir.

use std::collections::HashMap;
use std::sync::{Mutex, MutexGuard};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Un poste est « en ligne » s'il s'est signalé récemment.
pub const ONLINE: Duration = Duration::from_secs(25);
/// Au-delà, il disparaît de la liste.
const FORGET: Duration = Duration::from_secs(6 * 3600);
/// Un ticket non mis à jour depuis ce délai n'est plus proposé.
const CART_TTL: Duration = Duration::from_secs(4 * 3600);

#[derive(Debug, Clone, Deserialize)]
pub struct Heartbeat {
    /// Identifiant unique et permanent de l'appareil.
    pub id: String,
    /// Nom du poste (« Caisse 2 », « Tablette rayon »…).
    pub name: String,
    /// desktop, browser, mobile, display
    pub kind: Option<String>,
    /// Nom de l'appareil (nom du PC, « iPhone », « Android »…).
    pub device: Option<String>,
    /// local, server, client, browser
    pub mode: Option<String>,
    pub version: Option<String>,
    pub page: Option<String>,
    /// Posé par le serveur (jamais par l'appareil) : « local » (même réseau) ou « internet » (tunnel / adresse publique).
    #[serde(rename = "__route")]
    pub route: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct Poste {
    pub id: String,
    pub name: String,
    pub kind: String,
    pub device: String,
    pub mode: String,
    pub ip: String,
    /// local (même réseau que le serveur) ou internet (adresse publique).
    pub route: String,
    pub version: String,
    pub page: String,
    pub user: Option<String>,
    pub first_seen_at: String,
    pub last_seen_at: String,
    /// Secondes depuis le dernier signal.
    pub seen_ago: u64,
    pub online: bool,
    /// Un autre poste en ligne porte le même nom (écran client et ticket risquent de se mélanger).
    pub duplicate_name: bool,
    #[serde(skip)]
    last_seen: Option<Instant>,
}

#[derive(Debug, Clone, Serialize)]
pub struct LiveCart {
    pub poste_id: String,
    pub poste: String,
    pub user_id: i64,
    pub user_name: String,
    /// Contenu du ticket (lignes, client, remise) tel qu'envoyé par la caisse.
    pub cart: Value,
    pub total: i64,
    pub items: f64,
    pub lines: usize,
    /// cart, payment
    pub status: String,
    pub updated_at: String,
    pub seen_ago: u64,
    #[serde(skip)]
    updated: Option<Instant>,
    #[serde(skip)]
    taken_by: Option<String>,
}

#[derive(Default)]
pub struct LiveState {
    postes: Mutex<HashMap<String, Poste>>,
    carts: Mutex<HashMap<String, LiveCart>>,
}

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

fn now_str() -> String {
    chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string()
}

impl LiveState {
    pub fn heartbeat(&self, hb: Heartbeat, ip: String, user: Option<String>) -> usize {
        let mut postes = lock(&self.postes);
        let now = Instant::now();
        let first = postes.get(&hb.id).map(|p| p.first_seen_at.clone()).unwrap_or_else(now_str);
        let clean = |s: Option<String>, d: &str| s.map(|x| x.trim().chars().take(80).collect::<String>()).filter(|x| !x.is_empty()).unwrap_or_else(|| d.to_string());
        let id: String = hb.id.chars().take(64).collect();
        postes.insert(
            id.clone(),
            Poste {
                id,
                name: clean(Some(hb.name), "Poste"),
                kind: clean(hb.kind, "browser"),
                device: clean(hb.device, "Appareil"),
                mode: clean(hb.mode, "browser"),
                ip,
                route: if hb.route.as_deref() == Some("internet") { "internet".into() } else { "local".into() },
                version: clean(hb.version, ""),
                page: clean(hb.page, ""),
                user,
                first_seen_at: first,
                last_seen_at: now_str(),
                seen_ago: 0,
                online: true,
                duplicate_name: false,
                last_seen: Some(now),
            },
        );
        postes.retain(|_, p| p.last_seen.map(|t| t.elapsed() < FORGET).unwrap_or(false));
        postes.values().filter(|p| p.last_seen.map(|t| t.elapsed() < ONLINE).unwrap_or(false)).count()
    }

    /// Liste des postes : en ligne d'abord, puis par nom.
    pub fn postes(&self) -> Vec<Poste> {
        let postes = lock(&self.postes);
        let mut list: Vec<Poste> = postes
            .values()
            .cloned()
            .map(|mut p| {
                let ago = p.last_seen.map(|t| t.elapsed()).unwrap_or(FORGET);
                p.seen_ago = ago.as_secs();
                p.online = ago < ONLINE;
                p
            })
            .collect();
        let names: Vec<(String, String)> = list
            .iter()
            .filter(|p| p.online && p.kind != "display")
            .map(|p| (p.id.clone(), p.name.to_lowercase()))
            .collect();
        for p in list.iter_mut() {
            p.duplicate_name = p.online && p.kind != "display" && names.iter().any(|(id, n)| *id != p.id && *n == p.name.to_lowercase());
        }
        list.sort_by(|a, b| b.online.cmp(&a.online).then(a.name.to_lowercase().cmp(&b.name.to_lowercase())));
        list
    }

    pub fn online_count(&self) -> usize {
        self.postes().iter().filter(|p| p.online).count()
    }

    /// Mise à jour du ticket en cours d'une caisse. Retourne le nom du caissier qui l'a repris, le cas échéant.
    pub fn update_cart(&self, poste_id: &str, poste: &str, user_id: i64, user_name: &str, cart: Value, status: &str) -> Option<String> {
        let mut carts = lock(&self.carts);
        if let Some(existing) = carts.get(poste_id) {
            if let Some(by) = existing.taken_by.clone() {
                // Le ticket a été repris ailleurs : on prévient la caisse d'origine, une seule fois.
                carts.remove(poste_id);
                return Some(by);
            }
        }
        let lines = cart.get("lines").and_then(|l| l.as_array()).map(|l| l.len()).unwrap_or(0);
        if lines == 0 {
            carts.remove(poste_id);
            return None;
        }
        let total = cart.get("total").and_then(|v| v.as_i64()).unwrap_or(0);
        let items = cart.get("items").and_then(|v| v.as_f64()).unwrap_or(0.0);
        carts.insert(
            poste_id.to_string(),
            LiveCart {
                poste_id: poste_id.to_string(),
                poste: poste.to_string(),
                user_id,
                user_name: user_name.to_string(),
                cart,
                total,
                items,
                lines,
                status: status.to_string(),
                updated_at: now_str(),
                seen_ago: 0,
                updated: Some(Instant::now()),
                taken_by: None,
            },
        );
        None
    }

    /// Tickets en cours des autres caisses.
    pub fn carts(&self, except_poste: Option<&str>) -> Vec<LiveCart> {
        let mut carts = lock(&self.carts);
        carts.retain(|_, c| c.updated.map(|t| t.elapsed() < CART_TTL).unwrap_or(false));
        let mut list: Vec<LiveCart> = carts
            .values()
            .filter(|c| c.taken_by.is_none() && Some(c.poste_id.as_str()) != except_poste)
            .cloned()
            .map(|mut c| {
                c.seen_ago = c.updated.map(|t| t.elapsed().as_secs()).unwrap_or(0);
                c
            })
            .collect();
        list.sort_by_key(|a| a.poste.to_lowercase());
        list
    }

    /// Reprise d'un ticket par un autre caissier : le ticket est retiré de la caisse d'origine.
    pub fn take_cart(&self, poste_id: &str, by: &str) -> Option<LiveCart> {
        let mut carts = lock(&self.carts);
        let c = carts.get_mut(poste_id)?;
        if c.taken_by.is_some() {
            return None;
        }
        c.taken_by = Some(by.to_string());
        Some(c.clone())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn hb(id: &str, name: &str) -> Heartbeat {
        Heartbeat { id: id.into(), name: name.into(), kind: Some("desktop".into()), device: Some("PC".into()), mode: Some("client".into()), version: None, page: None, route: None }
    }

    #[test]
    fn presence_and_duplicates() {
        let s = LiveState::default();
        assert_eq!(s.heartbeat(hb("a", "Caisse 1"), "192.168.1.20".into(), Some("Mariam".into())), 1);
        assert_eq!(s.heartbeat(hb("b", "caisse 1"), "192.168.1.21".into(), None), 2);
        s.heartbeat(hb("c", "Caisse 2"), "192.168.1.22".into(), None);
        let list = s.postes();
        assert_eq!(list.len(), 3);
        assert!(list.iter().filter(|p| p.duplicate_name).count() == 2);
        assert_eq!(s.online_count(), 3);
    }

    #[test]
    fn cart_follow_and_take_over() {
        let s = LiveState::default();
        let cart = json!({"lines": [{"product_id": 1, "quantity": 2.0}], "total": 1300, "items": 2.0});
        assert_eq!(s.update_cart("p1", "Caisse 1", 2, "Mariam", cart.clone(), "payment"), None);
        assert_eq!(s.carts(Some("p1")).len(), 0, "sa propre caisse n'est pas proposée");
        let others = s.carts(Some("p2"));
        assert_eq!(others.len(), 1);
        assert_eq!(others[0].total, 1300);
        let taken = s.take_cart("p1", "Fatou").unwrap();
        assert_eq!(taken.user_name, "Mariam");
        assert!(s.take_cart("p1", "Awa").is_none(), "déjà repris");
        assert_eq!(s.carts(Some("p2")).len(), 0);
        // La caisse d'origine est prévenue à sa prochaine mise à jour
        assert_eq!(s.update_cart("p1", "Caisse 1", 2, "Mariam", cart.clone(), "cart"), Some("Fatou".into()));
        assert_eq!(s.update_cart("p1", "Caisse 1", 2, "Mariam", json!({"lines": []}), "cart"), None);
    }
}
