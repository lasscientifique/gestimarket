//! Classement Sugu Eden (0.31) : Catégorie → Section → Sous-catégorie, géré par Eden Dev.
//!
//! Une copie est intégrée à GestiMarket (`data/sugu_classement.txt`) pour travailler sans Internet. Quand Eden Dev
//! publie une version plus récente (fonction `sugu_taxonomy`), la publication Sugu Eden la reprend et la garde
//! (clé interne « sugu_taxonomy_cache »). Aucun lien avec la base Sugu Eden v1.
//!
//! Le produit garde ses rayons GestiMarket (catégories de la boutique) ; le classement Sugu Eden est un champ en
//! plus (`products.sugu_code`, une sous-catégorie), proposé tout seul à partir du nom, du rayon et de la marque.

use std::sync::{Arc, RwLock};

use serde::{Deserialize, Serialize};
use serde_json::Value;

const EMBEDDED: &str = include_str!("../data/sugu_classement.txt");

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Node {
    pub code: String,
    pub parent: Option<String>,
    pub level: u8,
    pub name: String,
    #[serde(default)]
    pub synonyms: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Taxonomy {
    pub version: i64,
    pub items: Vec<Node>,
}

static CURRENT: RwLock<Option<Arc<Taxonomy>>> = RwLock::new(None);

/// Code à partir d'un nom : minuscules sans accents, tirets (mêmes règles que scripts/sugu-classement.py).
pub fn slug(name: &str) -> String {
    let mut out = String::new();
    let mut dash = false;
    for ch in name.to_lowercase().chars() {
        let mapped: &str = match ch {
            'à' | 'â' | 'ä' | 'á' => "a",
            'é' | 'è' | 'ê' | 'ë' => "e",
            'î' | 'ï' | 'í' => "i",
            'ô' | 'ö' | 'ó' => "o",
            'ù' | 'û' | 'ü' | 'ú' => "u",
            'ç' => "c",
            'œ' => "oe",
            'æ' => "ae",
            'ñ' => "n",
            _ => "",
        };
        if !mapped.is_empty() {
            out.push_str(mapped);
            dash = false;
        } else if ch.is_ascii_alphanumeric() {
            out.push(ch);
            dash = false;
        } else if !dash && !out.is_empty() {
            out.push('-');
            dash = true;
        }
    }
    out.trim_matches('-').to_string()
}

/// Lit le fichier du classement (2 espaces par niveau, « ; » synonymes, « = code » pour garder un ancien code).
pub fn parse(text: &str) -> Taxonomy {
    let mut version = 0;
    let mut items: Vec<Node> = Vec::new();
    let mut stack: Vec<String> = Vec::new();
    for raw in text.lines() {
        let trimmed = raw.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        if let Some(v) = trimmed.strip_prefix("@version") {
            version = v.trim().parse().unwrap_or(0);
            continue;
        }
        let depth = (raw.len() - raw.trim_start_matches(' ').len()) / 2;
        if depth > 2 || depth > stack.len() {
            continue;
        }
        let (text, synonyms) = trimmed.split_once(';').map_or((trimmed, ""), |(t, s)| (t.trim(), s.trim()));
        let (name, own) = text.split_once(" = ").map_or((text, None), |(n, c)| (n.trim(), Some(c.trim())));
        stack.truncate(depth);
        let parent = stack.last().cloned();
        let leaf = own.map(String::from).unwrap_or_else(|| slug(name));
        let code = parent.as_ref().map_or(leaf.clone(), |p| format!("{p}/{leaf}"));
        items.push(Node { code: code.clone(), parent, level: depth as u8 + 1, name: name.to_string(), synonyms: synonyms.to_string() });
        stack.push(code);
    }
    Taxonomy { version, items }
}

/// Classement en cours : la copie d'Eden Dev si elle est plus récente que celle de GestiMarket.
pub fn current() -> Arc<Taxonomy> {
    if let Some(t) = CURRENT.read().unwrap_or_else(|e| e.into_inner()).as_ref() {
        return t.clone();
    }
    let t = Arc::new(parse(EMBEDDED));
    *CURRENT.write().unwrap_or_else(|e| e.into_inner()) = Some(t.clone());
    t
}

/// Reprend la copie gardée sur ce PC (clé interne), si elle est plus récente que celle intégrée.
pub fn load_cache(conn: &rusqlite::Connection) {
    let raw = crate::services::settings::get(conn, "sugu_taxonomy_cache").unwrap_or_default();
    if let Ok(t) = serde_json::from_str::<Taxonomy>(&raw) {
        adopt(t);
    }
}

/// Nouvelle version reçue d'Eden Dev : gardée si elle est plus récente et complète.
pub fn adopt(t: Taxonomy) -> bool {
    let valid = t.items.iter().any(|n| n.level == 3) && t.items.iter().all(|n| (1..=3).contains(&n.level) && !n.code.is_empty());
    if !valid || t.version <= current().version {
        return false;
    }
    *CURRENT.write().unwrap_or_else(|e| e.into_inner()) = Some(Arc::new(t));
    true
}

/// Réponse de la fonction `sugu_taxonomy` d'Eden Dev.
pub fn from_remote(v: &Value) -> Option<Taxonomy> {
    serde_json::from_value(v.clone()).ok()
}

pub fn find(code: &str) -> Option<Node> {
    current().items.iter().find(|n| n.code == code).cloned()
}

/// Sous-catégorie connue (seul le dernier niveau se choisit pour un produit).
pub fn is_leaf(code: &str) -> bool {
    find(code).is_some_and(|n| n.level == 3)
}

/// « Femmes › Vêtements › Robes ».
pub fn label(code: &str) -> String {
    let t = current();
    let mut parts = Vec::new();
    let mut at = Some(code.to_string());
    while let Some(c) = at {
        match t.items.iter().find(|n| n.code == c) {
            Some(n) => {
                parts.push(n.name.clone());
                at = n.parent.clone();
            }
            None => break,
        }
    }
    parts.reverse();
    parts.join(" › ")
}

/// Public visé proposé d'après le classement (Femmes, Hommes, Enfants).
pub fn audience_of(code: &str) -> Option<&'static str> {
    match code.split('/').next()? {
        "femmes" => Some("women"),
        "hommes" => Some("men"),
        "enfants" => Some("kids"),
        _ => None,
    }
}

/// Catégories Sugu Eden proposées en premier pour un type de commerce (mêmes codes que les 22 profils).
pub fn priorities(shop_type: &str) -> &'static [&'static str] {
    match shop_type {
        "fashion" => &["femmes", "hommes", "enfants"],
        "phones" => &["electronique"],
        "electronics" => &["electronique", "maison-decoration"],
        "autoparts" => &["automobile-moto"],
        "cosmetics" => &["beaute-cosmetiques", "sante-bien-etre", "femmes"],
        "pharmacy" => &["sante-bien-etre", "beaute-cosmetiques", "enfants"],
        "bookshop" => &["librairie-education", "bureautique-fournitures", "enfants"],
        "agrovet" => &["agriculture-elevage"],
        "hardware" => &["maison-decoration", "automobile-moto"],
        "building" => &["maison-decoration"],
        "bakery" | "butcher" | "greengrocer" | "bar" | "restaurant" => &["alimentation"],
        "kiosk" => &["alimentation", "automobile-moto", "electronique"],
        "boutique" | "superette" | "wholesale" => &["alimentation", "maison-decoration", "beaute-cosmetiques"],
        "general" | "supermarket" => &["alimentation", "maison-decoration", "beaute-cosmetiques", "enfants", "bureautique-fournitures"],
        _ => &[],
    }
}

/// Types de commerce de la boutique (activités choisies, sinon le type principal).
pub fn shop_types(conn: &rusqlite::Connection) -> Vec<String> {
    let get = |k: &str| crate::services::settings::get(conn, k).unwrap_or_default();
    let mut types: Vec<String> = get("business_types").split(',').map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect();
    if types.is_empty() {
        types.extend(Some(get("business_type")).filter(|s| !s.trim().is_empty()));
    }
    types
}

/// Mots d'un texte, sans accents ni pluriel (« Robes » → « robe »), sans les petits mots.
fn words(text: &str) -> Vec<String> {
    const SMALL: &[&str] = &["de", "des", "du", "la", "le", "les", "et", "en", "pour", "avec", "sans", "aux", "une", "un", "pce"];
    slug(text)
        .split('-')
        .filter(|w| w.len() >= 2 && !SMALL.contains(w))
        .map(|w| {
            let w = w.strip_suffix('x').filter(|r| r.len() >= 3).unwrap_or(w);
            w.strip_suffix('s').filter(|r| r.len() >= 3).unwrap_or(w).to_string()
        })
        .collect()
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Suggestion {
    pub code: String,
    pub label: String,
    pub score: i64,
}

/// Classements proposés pour un produit : nom (compte le plus), rayon GestiMarket et marque, puis catégories du
/// type de commerce de la boutique. Seulement des sous-catégories.
pub fn suggest(name: &str, aisle: &str, brand: &str, shop_types: &[String], limit: usize) -> Vec<Suggestion> {
    let t = current();
    let name_words = words(name);
    let other_words: Vec<String> = words(&format!("{aisle} {brand}"));
    let norm_text = format!(" {} ", slug(&format!("{name} {aisle} {brand}")).replace('-', " "));
    let favored: Vec<&str> = shop_types.iter().flat_map(|s| priorities(s).iter().copied()).collect();
    let mut found: Vec<Suggestion> = Vec::new();
    for leaf in t.items.iter().filter(|n| n.level == 3) {
        let section = leaf.parent.as_deref().and_then(|p| t.items.iter().find(|n| n.code == p));
        // Le premier mot du nom dit souvent ce qu'est l'article (« Robe longue wax ») : il compte davantage.
        let first = name_words.first().map(String::as_str).unwrap_or_default();
        let mut score = 0;
        for w in words(&leaf.name) {
            if name_words.contains(&w) {
                score += if w == first { 9 } else { 6 };
            } else if other_words.contains(&w) {
                score += 3;
            }
        }
        // Mots de recherche (« iphone », « pagne ») : seulement si le nom de la sous-catégorie n'a rien trouvé.
        if score == 0 {
            for syn in leaf.synonyms.split(',').map(str::trim).filter(|s| !s.is_empty()) {
                let s = slug(syn).replace('-', " ");
                if !s.is_empty() && norm_text.contains(&format!(" {s} ")) {
                    score += if s.split(' ').next() == Some(first) { 8 } else { 5 };
                }
            }
        }
        if score == 0 {
            continue;
        }
        // Section et catégorie qui reprennent un mot du nom ou du rayon (« Huile » rangée en « Alimentation »).
        let top = leaf.code.split('/').next().unwrap_or_default();
        let category = t.items.iter().find(|n| n.code == top);
        for node in [section, category].into_iter().flatten() {
            for w in words(&node.name) {
                if name_words.contains(&w) || other_words.contains(&w) {
                    score += 1;
                }
            }
        }
        if favored.contains(&top) {
            score += 2;
        }
        // Le public écrit dans le rayon ou le nom (« Femme », « Homme », « Enfant ») départage les mêmes articles.
        for (word, cat) in [("femme", "femmes"), ("homme", "hommes"), ("enfant", "enfants"), ("bebe", "enfants")] {
            if (name_words.iter().chain(other_words.iter())).any(|w| w == word) && top == cat {
                score += 3;
            }
        }
        found.push(Suggestion { code: leaf.code.clone(), label: label(&leaf.code), score });
    }
    found.sort_by(|a, b| b.score.cmp(&a.score).then_with(|| a.code.cmp(&b.code)));
    found.truncate(limit);
    found
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classement_integre_complet() {
        let t = parse(EMBEDDED);
        assert!(t.version >= 1);
        let codes: std::collections::HashSet<&str> = t.items.iter().map(|n| n.code.as_str()).collect();
        assert_eq!(codes.len(), t.items.len(), "codes en double");
        assert!(t.items.iter().filter(|n| n.level == 1).count() >= 15);
        assert!(t.items.iter().filter(|n| n.level == 3).count() >= 400);
        // Mêmes codes que le SQL d'Eden Dev (scripts/sugu-classement.py).
        for code in ["femmes/vetements/robes", "femmes/vetements/tops-t-shirts", "maison-decoration/electromenager/machines-a-laver",
            "femmes/bijoux/boucles-d-oreilles", "alimentation/produits-laitiers-oeufs/oeufs", "electronique/telephones-tablettes/smartphones"] {
            assert!(codes.contains(code), "{code}");
        }
        // Chaque section et chaque catégorie ont des sous-catégories.
        for n in t.items.iter().filter(|n| n.level < 3) {
            assert!(t.items.iter().any(|m| m.parent.as_deref() == Some(n.code.as_str())), "{}", n.code);
        }
    }

    #[test]
    fn codes_comme_le_script() {
        assert_eq!(slug("Maison & Décoration"), "maison-decoration");
        assert_eq!(slug("Boucles d'oreilles"), "boucles-d-oreilles");
        assert_eq!(slug("Cravates & Nœuds papillon"), "cravates-noeuds-papillon");
        assert_eq!(slug("Répéteurs Wi-Fi"), "repeteurs-wi-fi");
    }

    #[test]
    fn suggestions_utiles() {
        let first = |name: &str, aisle: &str, types: &[&str]| {
            let t: Vec<String> = types.iter().map(|s| s.to_string()).collect();
            suggest(name, aisle, "", &t, 3).first().map(|s| s.code.clone()).unwrap_or_default()
        };
        assert_eq!(first("iPhone 14 Pro 128 Go", "Électronique et informatique", &["phones"]), "electronique/telephones-tablettes/smartphones");
        assert_eq!(first("Robe longue wax", "Vêtements et habillement > Femme", &["fashion"]), "femmes/vetements/robes");
        assert_eq!(first("Riz parfumé 25 kg", "Alimentation générale", &["boutique"]), "alimentation/epicerie/riz-cereales");
        assert!(suggest("zzzz", "", "", &[], 5).is_empty());
        assert_eq!(label("femmes/vetements/robes"), "Femmes › Vêtements › Robes");
        assert_eq!(audience_of("hommes/chaussures/mocassins"), Some("men"));
    }

    #[test]
    fn nouvelle_version_seulement_si_plus_recente() {
        let mut t = parse(EMBEDDED);
        assert!(!adopt(t.clone()), "même version");
        t.version += 1;
        t.items.retain(|n| n.level < 3);
        assert!(!adopt(t), "incomplète");
    }
}
