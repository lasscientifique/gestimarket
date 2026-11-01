-- GestiMarket — migration 005
-- Catégories hiérarchiques illimitées (activation / masquage), marque et référence interne des produits,
-- conditionnements (1 carton = 12 bouteilles…) avec leur propre code-barres et leur prix.

ALTER TABLE categories ADD COLUMN active INTEGER NOT NULL DEFAULT 1;
ALTER TABLE products ADD COLUMN brand TEXT;
ALTER TABLE products ADD COLUMN sku TEXT;
CREATE INDEX idx_products_sku ON products(sku);

CREATE TABLE product_packagings (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id  INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    name        TEXT    NOT NULL,           -- ex. « Carton de 12 »
    quantity    REAL    NOT NULL,           -- nombre d'unités de base contenues
    barcode     TEXT    UNIQUE,
    sale_price  INTEGER NOT NULL,           -- prix de vente du conditionnement entier
    created_at  TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
);
CREATE INDEX idx_packagings_product ON product_packagings(product_id);

-- Quantité en unités de base d'une ligne de vente (différente de `quantity` si vendue par conditionnement).
ALTER TABLE sale_items ADD COLUMN base_quantity REAL;
ALTER TABLE sale_items ADD COLUMN packaging_id INTEGER REFERENCES product_packagings(id) ON DELETE SET NULL;
