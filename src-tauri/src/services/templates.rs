//! Catalogue de catégories prédéfini et profils de commerce.
//!
//! L'administrateur choisit le type de son commerce : GestiMarket propose alors les catégories
//! adaptées (chargeables en un clic) et active les fonctions utiles (péremption, marque, conditionnements…).
//! Les catégories restent indépendantes du type : on peut en activer, en ajouter ou en créer d'autres.

use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;

use crate::error::{invalid, AppResult};
use crate::services::audit;
use crate::state::SessionUser;

const CATALOGUE: &str = include_str!("../../data/catalogue_fr.txt");

#[derive(Debug, Clone, Serialize)]
pub struct TemplateNode {
    pub name: String,
    pub children: Vec<TemplateNode>,
}

/// Lit le catalogue (une ligne par catégorie, 2 espaces d'indentation par niveau).
pub fn catalogue() -> Vec<TemplateNode> {
    fn insert(tree: &mut Vec<TemplateNode>, depth: usize, name: String) {
        if depth == 0 {
            tree.push(TemplateNode { name, children: Vec::new() });
        } else if let Some(last) = tree.last_mut() {
            insert(&mut last.children, depth - 1, name);
        }
    }
    let mut roots = Vec::new();
    for line in CATALOGUE.lines() {
        if line.trim().is_empty() || line.trim_start().starts_with('#') {
            continue;
        }
        let depth = (line.len() - line.trim_start().len()) / 2;
        insert(&mut roots, depth, line.trim().to_string());
    }
    roots
}

#[derive(Debug, Serialize)]
pub struct BusinessProfile {
    pub id: &'static str,
    pub label: &'static str,
    pub description: &'static str,
    /// Catégories recommandées (index à partir de 1 dans le catalogue).
    pub categories: Vec<usize>,
    /// Fonctions activées par défaut : expiry, brand, sku, packagings, services, decimal.
    pub features: Vec<&'static str>,
    /// Les nouveaux produits suivent-ils le stock par défaut ?
    pub track_stock: bool,
}

/// Les 11 profils de commerce.
pub fn profiles() -> Vec<BusinessProfile> {
    let p = |id, label, description, categories: &[usize], features: &[&'static str], track_stock| BusinessProfile {
        id,
        label,
        description,
        categories: categories.to_vec(),
        features: features.to_vec(),
        track_stock,
    };
    vec![
        p("boutique", "Boutique de quartier", "Configuration légère : alimentation, boissons, hygiène, entretien, produits divers.",
          &[1, 2, 3, 8, 9, 10, 11, 32], &["expiry"], true),
        p("general", "Magasin de commerce général", "Alimentation, maison, papeterie et produits courants, vente au détail et par conditionnement.",
          &[1, 2, 3, 8, 9, 10, 11, 18, 23, 32], &["expiry", "brand", "packagings"], true),
        p("supermarket", "Supermarché / hypermarché", "Configuration complète : toutes les catégories de grande distribution, marques, références, conditionnements, péremption.",
          &[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 15, 17, 18, 23, 24, 25, 32], &["expiry", "brand", "sku", "packagings", "decimal"], true),
        p("superette", "Supérette", "Proximité : alimentation, frais, boulangerie, hygiène et entretien.",
          &[1, 2, 3, 4, 5, 7, 8, 9, 10, 11, 32], &["expiry", "brand", "packagings", "decimal"], true),
        p("wholesale", "Grossiste / demi-grossiste", "Achats en gros, ventes en détail et en gros : sacs, cartons, conversions d'unités.",
          &[1, 2, 3, 8, 9, 10, 11, 32], &["expiry", "brand", "sku", "packagings", "decimal"], true),
        p("pharmacy", "Pharmacie / parapharmacie", "Parapharmacie, hygiène, bébé : lots et dates de péremption. Les médicaments sur ordonnance demandent un module réglementaire dédié.",
          &[9, 11, 12, 32], &["expiry", "brand", "sku"], true),
        p("fashion", "Vêtements et chaussures", "Habillement, chaussures, maroquinerie, accessoires et bijoux.",
          &[13, 14, 15, 28, 32], &["brand", "sku"], true),
        p("hardware", "Quincaillerie / matériaux", "Outillage, plomberie, électricité, matériaux : ventes au mètre, au sac, à la barre.",
          &[19, 20, 21, 22, 26, 27, 32], &["brand", "sku", "packagings", "decimal"], true),
        p("electronics", "Électronique / électroménager", "Téléphones, informatique, électroménager, solaire et services de réparation.",
          &[16, 17, 27, 31, 32], &["brand", "sku", "services"], true),
        p("specialty", "Boutique spécialisée", "Catalogue libre : choisissez vous-même les catégories de votre spécialité.",
          &[32], &["brand", "sku"], true),
        p("restaurant", "Restaurant / pâtisserie", "Menu (plats, desserts, boissons, pâtisseries) : les plats ne suivent pas de stock.",
          &[33, 2], &["services"], false),
    ]
}

#[derive(Debug, Serialize)]
pub struct TemplateSummary {
    pub index: usize,
    pub name: String,
    pub subcategories: usize,
    pub total: usize,
    pub examples: Vec<String>,
}

fn count(n: &TemplateNode) -> usize {
    1 + n.children.iter().map(count).sum::<usize>()
}

pub fn summaries() -> Vec<TemplateSummary> {
    catalogue()
        .iter()
        .enumerate()
        .map(|(i, n)| TemplateSummary {
            index: i + 1,
            name: n.name.clone(),
            subcategories: n.children.len(),
            total: count(n) - 1,
            examples: n.children.iter().take(5).map(|c| c.name.clone()).collect(),
        })
        .collect()
}

const COLORS: &[&str] = &[
    "#0f766e", "#2563eb", "#ca8a04", "#b45309", "#16a34a", "#dc2626", "#0891b2", "#db2777", "#7c3aed", "#0d9488", "#f59e0b",
    "#059669", "#e11d48", "#4f46e5", "#9333ea", "#c026d3", "#0284c7", "#475569", "#78716c", "#a16207", "#334155", "#ea580c",
    "#65a30d", "#1d4ed8", "#be185d", "#15803d", "#facc15", "#0e7490", "#92400e", "#57534e", "#64748b", "#6b7280", "#b91c1c",
];

/// Trouve (sans tenir compte de la casse) ou crée une catégorie sous un parent donné.
pub fn find_or_create(conn: &Connection, name: &str, parent: Option<i64>, color: &str, order: i64) -> AppResult<(i64, bool)> {
    let existing: Option<i64> = conn
        .query_row(
            "SELECT id FROM categories WHERE name = ?1 COLLATE NOCASE AND COALESCE(parent_id, 0) = COALESCE(?2, 0)",
            params![name, parent],
            |r| r.get(0),
        )
        .optional()?;
    if let Some(id) = existing {
        return Ok((id, false));
    }
    conn.execute(
        "INSERT INTO categories (name, parent_id, color, sort_order) VALUES (?1, ?2, ?3, ?4)",
        params![name, parent, color, order],
    )?;
    Ok((conn.last_insert_rowid(), true))
}

/// Charge les catégories choisies du catalogue (sans doublon). Retourne le nombre de catégories créées.
pub fn seed(conn: &mut Connection, user: &SessionUser, indexes: &[usize]) -> AppResult<i64> {
    let tree = catalogue();
    if indexes.iter().any(|&i| i == 0 || i > tree.len()) {
        return invalid("Catégorie du catalogue inconnue.");
    }
    fn walk(conn: &Connection, node: &TemplateNode, parent: Option<i64>, color: &str, order: i64, created: &mut i64) -> AppResult<()> {
        let (id, new) = find_or_create(conn, &node.name, parent, color, order)?;
        if new {
            *created += 1;
        }
        for (i, child) in node.children.iter().enumerate() {
            walk(conn, child, Some(id), color, i as i64, created)?;
        }
        Ok(())
    }
    let tx = conn.transaction()?;
    let mut created = 0;
    for &i in indexes {
        walk(&tx, &tree[i - 1], None, COLORS[(i - 1) % COLORS.len()], i as i64, &mut created)?;
    }
    audit::log(&tx, user, "Chargement du catalogue de catégories", "category", None, format!("{} catégorie(s) créée(s)", created))?;
    tx.commit()?;
    Ok(created)
}

/// Importe des chemins « Catégorie > Sous-catégorie > Famille » (fichier Excel / CSV).
pub fn import_paths(conn: &mut Connection, user: &SessionUser, paths: Vec<String>) -> AppResult<i64> {
    let tx = conn.transaction()?;
    let mut created = 0;
    for path in &paths {
        let mut parent: Option<i64> = None;
        for part in path.split('>').map(str::trim).filter(|p| !p.is_empty()) {
            let (id, new) = find_or_create(&tx, part, parent, "#64748b", 0)?;
            if new {
                created += 1;
            }
            parent = Some(id);
        }
    }
    audit::log(&tx, user, "Import de catégories", "category", None, format!("{} ligne(s), {created} catégorie(s) créée(s)", paths.len()))?;
    tx.commit()?;
    Ok(created)
}
