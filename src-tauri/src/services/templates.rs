//! Catalogue de catégories prédéfini et profils de commerce.
//!
//! L'administrateur choisit le type de son commerce : GestiMarket propose alors les catégories
//! adaptées (chargeables en un clic) et active les fonctions utiles (péremption, marque, conditionnements…).
//! Les catégories restent indépendantes du type : on peut en activer, en ajouter ou en créer d'autres.

use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;

use crate::error::{invalid, AppResult};
use crate::services::{audit, settings};
use crate::state::SessionUser;

// Mêmes lignes et même arborescence dans les deux langues : les index des profils restent valables.
const CATALOGUE_FR: &str = include_str!("../../data/catalogue_fr.txt");
const CATALOGUE_EN: &str = include_str!("../../data/catalogue_en.txt");

#[derive(Debug, Clone, Serialize)]
pub struct TemplateNode {
    pub name: String,
    pub children: Vec<TemplateNode>,
}

/// Catalogue en français.
#[cfg(test)]
pub fn catalogue() -> Vec<TemplateNode> {
    catalogue_in("fr")
}

/// Catalogue dans la langue de la boutique (paramètre « shop_lang »).
pub fn shop_catalogue(conn: &Connection) -> AppResult<Vec<TemplateNode>> {
    Ok(catalogue_in(&settings::get(conn, "shop_lang")?))
}

/// Lit le catalogue d'une langue (une ligne par catégorie, 2 espaces d'indentation par niveau).
pub fn catalogue_in(lang: &str) -> Vec<TemplateNode> {
    fn insert(tree: &mut Vec<TemplateNode>, depth: usize, name: String) {
        if depth == 0 {
            tree.push(TemplateNode { name, children: Vec::new() });
        } else if let Some(last) = tree.last_mut() {
            insert(&mut last.children, depth - 1, name);
        }
    }
    let mut roots = Vec::new();
    let text = if lang == "en" { CATALOGUE_EN } else { CATALOGUE_FR };
    for line in text.lines() {
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
    /// Meubles proposés en tête de la palette du plan de la boutique (codes des types).
    pub fixtures: Vec<&'static str>,
    /// Nom du rayon sur le plan quand plusieurs activités se partagent la salle (français, anglais).
    pub department: &'static str,
    pub department_en: &'static str,
    /// Taille habituelle de la salle de vente (largeur × profondeur, mètres) : plan de départ.
    pub size: [f64; 2],
}

/// Rayon et taille habituelle de la salle pour chaque type de commerce.
fn department(id: &str) -> (&'static str, &'static str, [f64; 2]) {
    match id {
        "boutique" => ("Alimentation", "Groceries", [5.0, 4.0]),
        "general" => ("Commerce général", "General store", [12.0, 9.0]),
        "supermarket" => ("Alimentation", "Groceries", [25.0, 18.0]),
        "superette" => ("Alimentation", "Groceries", [10.0, 8.0]),
        "wholesale" => ("Vente en gros", "Wholesale", [15.0, 10.0]),
        "pharmacy" => ("Pharmacie", "Pharmacy", [8.0, 6.0]),
        "fashion" => ("Vêtements", "Clothing", [10.0, 7.0]),
        "hardware" => ("Quincaillerie", "Hardware", [10.0, 8.0]),
        "building" => ("Matériaux", "Building materials", [15.0, 10.0]),
        "electronics" => ("Électronique", "Electronics", [8.0, 6.0]),
        "phones" => ("Téléphonie", "Phones", [4.0, 3.5]),
        "bakery" => ("Boulangerie", "Bakery", [7.0, 5.0]),
        "butcher" => ("Boucherie", "Butcher", [6.0, 5.0]),
        "greengrocer" => ("Fruits et légumes", "Fruit & vegetables", [6.0, 5.0]),
        "cosmetics" => ("Cosmétiques", "Cosmetics", [6.0, 5.0]),
        "bookshop" => ("Librairie", "Books & stationery", [8.0, 6.0]),
        "autoparts" => ("Pièces auto", "Auto parts", [8.0, 6.0]),
        "agrovet" => ("Agro-vétérinaire", "Agrovet", [8.0, 6.0]),
        "bar" => ("Bar", "Bar", [8.0, 6.0]),
        "kiosk" => ("Kiosque", "Kiosk", [4.0, 3.5]),
        "restaurant" => ("Restaurant", "Restaurant", [10.0, 8.0]),
        _ => ("Spécialités", "Specialty", [6.0, 5.0]),
    }
}

/// Les 22 profils de commerce (mêmes codes que les types de boutique du compte Eden Dev).
pub fn profiles() -> Vec<BusinessProfile> {
    fn p(
        id: &'static str,
        label: &'static str,
        description: &'static str,
        categories: &[usize],
        features: &[&'static str],
        track_stock: bool,
        fixtures: &[&'static str],
    ) -> BusinessProfile {
        let (department, department_en, size) = department(id);
        BusinessProfile {
            id,
            label,
            description,
            categories: categories.to_vec(),
            features: features.to_vec(),
            track_stock,
            fixtures: fixtures.to_vec(),
            department,
            department_en,
            size,
        }
    }
    vec![
        p("boutique", "Boutique de quartier", "Configuration légère : alimentation, boissons, hygiène, entretien, produits divers.",
          &[1, 2, 3, 8, 9, 10, 11, 32], &["expiry"], true, &["etagere_murale", "comptoir", "refrigerateur", "presentoir"]),
        p("general", "Magasin de commerce général", "Alimentation, maison, papeterie et produits courants, vente au détail et par conditionnement.",
          &[1, 2, 3, 8, 9, 10, 11, 18, 23, 32], &["expiry", "brand", "packagings"], true, &["gondole", "etagere_murale", "refrigerateur", "palette", "rack"]),
        p("supermarket", "Supermarché / hypermarché", "Configuration complète : toutes les catégories de grande distribution, marques, références, conditionnements, péremption.",
          &[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 15, 17, 18, 23, 24, 25, 32], &["expiry", "brand", "sku", "packagings", "decimal"], true,
          &["gondole", "tete_gondole", "refrigerateur", "vitrine_refrigeree", "congelateur_coffre", "chambre_froide", "rack"]),
        p("superette", "Supérette", "Proximité : alimentation, frais, boulangerie, hygiène et entretien.",
          &[1, 2, 3, 4, 5, 7, 8, 9, 10, 11, 32], &["expiry", "brand", "packagings", "decimal"], true,
          &["gondole", "etagere_murale", "refrigerateur", "congelateur_coffre", "presentoir"]),
        p("wholesale", "Grossiste / demi-grossiste", "Achats en gros, ventes en détail et en gros : sacs, cartons, conversions d'unités.",
          &[1, 2, 3, 8, 9, 10, 11, 32], &["expiry", "brand", "sku", "packagings", "decimal"], true, &["rack", "palette", "zone_entrepot", "etagere_murale", "comptoir"]),
        p("pharmacy", "Pharmacie / parapharmacie", "Parapharmacie, hygiène, bébé : lots et dates de péremption. Les médicaments sur ordonnance demandent un module réglementaire dédié.",
          &[9, 11, 12, 32], &["expiry", "brand", "sku"], true, &["armoire_tiroirs", "etagere_murale", "comptoir", "refrigerateur", "vitrine_fermee"]),
        p("fashion", "Vêtements et chaussures", "Habillement, chaussures, maroquinerie, accessoires et bijoux.",
          &[13, 14, 15, 28, 32], &["brand", "sku"], true, &["portant", "etagere_murale", "presentoir", "vitrine_fermee", "comptoir"]),
        p("hardware", "Quincaillerie", "Outillage, plomberie, électricité, peinture : ventes au mètre, au sac, à la barre.",
          &[19, 20, 21, 22, 26, 27, 32], &["brand", "sku", "packagings", "decimal"], true, &["rack", "etagere_murale", "armoire_tiroirs", "palette", "comptoir"]),
        p("building", "Matériaux de construction", "Ciment, fer, sable, gravier, tôles, carreaux, bois : ventes au sac, à la tonne, au mètre.",
          &[20, 19, 26, 32], &["brand", "packagings", "decimal"], true, &["palette", "rack", "zone_entrepot", "comptoir"]),
        p("electronics", "Électronique / électroménager", "Informatique, électroménager, solaire et services de réparation.",
          &[16, 17, 27, 31, 32], &["brand", "sku", "services"], true, &["vitrine_fermee", "etagere_murale", "presentoir", "comptoir", "rack"]),
        p("phones", "Téléphonie et accessoires", "Téléphones, cartes, chargeurs, écouteurs, réparations et transferts.",
          &[16, 27, 31, 32], &["brand", "sku", "services"], true, &["vitrine_fermee", "presentoir", "comptoir", "armoire_tiroirs"]),
        p("bakery", "Boulangerie / pâtisserie", "Pains, viennoiseries, gâteaux, boissons et produits laitiers.",
          &[4, 2, 3, 8, 32], &["expiry", "decimal"], true, &["vitrine_refrigeree", "etagere_murale", "comptoir", "refrigerateur", "rack"]),
        p("butcher", "Boucherie / poissonnerie", "Viandes, volailles, poissons et surgelés : vente au poids, péremption.",
          &[6, 7, 32], &["expiry", "decimal"], true, &["vitrine_refrigeree", "chambre_froide", "congelateur_coffre", "comptoir"]),
        p("greengrocer", "Fruits et légumes", "Fruits, légumes, tubercules et épices : vente au poids et au tas.",
          &[5, 32], &["expiry", "decimal"], true, &["bac_vrac", "presentoir", "palette", "refrigerateur"]),
        p("cosmetics", "Cosmétiques / parfumerie", "Soins, maquillage, parfums, coiffure, accessoires et bijoux.",
          &[9, 15, 32], &["expiry", "brand", "sku"], true, &["vitrine_fermee", "etagere_murale", "presentoir", "comptoir"]),
        p("bookshop", "Librairie / papeterie", "Livres, fournitures scolaires et de bureau, jeux, articles religieux et culturels.",
          &[23, 24, 29, 32], &["brand", "sku"], true, &["etagere_murale", "gondole", "presentoir", "comptoir"]),
        p("autoparts", "Pièces auto / moto", "Pièces détachées, pneus, huiles, accessoires et outillage.",
          &[21, 19, 32], &["brand", "sku"], true, &["rack", "armoire_tiroirs", "etagere_murale", "comptoir"]),
        p("agrovet", "Agro-vétérinaire / animalerie", "Semences, engrais, aliments du bétail, produits vétérinaires, matériel agricole.",
          &[22, 26, 32], &["expiry", "brand", "packagings", "decimal"], true, &["rack", "palette", "etagere_murale", "comptoir"]),
        p("bar", "Bar / maquis / café", "Boissons fraîches, café, grillades et snacks : stock des boissons, menu sans stock.",
          &[2, 8, 33, 30], &["packagings", "services"], true, &["refrigerateur", "congelateur_coffre", "comptoir", "etagere_murale"]),
        p("kiosk", "Kiosque / boutique de station-service", "Boissons, snacks, hygiène, accessoires auto, cartes et petits services.",
          &[2, 8, 9, 10, 21, 30, 32], &["expiry", "brand"], true, &["presentoir", "refrigerateur", "etagere_murale", "comptoir"]),
        p("specialty", "Boutique spécialisée", "Catalogue libre : choisissez vous-même les catégories de votre spécialité.",
          &[32], &["brand", "sku"], true, &["etagere_murale", "presentoir", "vitrine_fermee", "comptoir"]),
        p("restaurant", "Restaurant / fast-food", "Menu (plats, desserts, boissons, pâtisseries) : les plats ne suivent pas de stock.",
          &[33, 2], &["services"], false, &["refrigerateur", "congelateur_armoire", "chambre_froide", "comptoir", "etagere_murale"]),
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

pub fn summaries(tree: &[TemplateNode]) -> Vec<TemplateSummary> {
    tree
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
    let tree = shop_catalogue(conn)?;
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
