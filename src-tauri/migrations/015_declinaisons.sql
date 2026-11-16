-- 0.32 : déclinaisons des produits (couleur et taille, pointure, âge…) avec leur stock, et liens de vidéos.

-- Une déclinaison : couleur de la palette (data/couleurs.txt) et/ou valeur du second axe du produit
-- (products.variant_axis : size, shoe, age, storage, volume, model). Son stock fait partie du stock du produit.
-- Code-barres et prix facultatifs (vide : on choisit la déclinaison à la caisse ; prix du produit).
CREATE TABLE product_variants (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    color      TEXT,
    size       TEXT,
    barcode    TEXT,
    price      INTEGER,
    stock      REAL    NOT NULL DEFAULT 0,
    photo_id   INTEGER REFERENCES media(id) ON DELETE SET NULL,
    active     INTEGER NOT NULL DEFAULT 1,
    position   INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_product_variants_product ON product_variants(product_id, position);
CREATE UNIQUE INDEX idx_product_variants_barcode ON product_variants(barcode) WHERE barcode IS NOT NULL;
CREATE UNIQUE INDEX idx_product_variants_key ON product_variants(product_id, IFNULL(color, ''), IFNULL(size, ''));

ALTER TABLE products ADD COLUMN variant_axis TEXT;
-- Liens de vidéos (TikTok, YouTube, Facebook, Instagram), en JSON : ["https://…"].
ALTER TABLE products ADD COLUMN video_links TEXT;

ALTER TABLE sale_items      ADD COLUMN variant_id INTEGER REFERENCES product_variants(id) ON DELETE SET NULL;
ALTER TABLE return_items    ADD COLUMN variant_id INTEGER REFERENCES product_variants(id) ON DELETE SET NULL;
ALTER TABLE purchase_items  ADD COLUMN variant_id INTEGER REFERENCES product_variants(id) ON DELETE SET NULL;
ALTER TABLE stock_movements ADD COLUMN variant_id INTEGER REFERENCES product_variants(id) ON DELETE SET NULL;

-- Commerces où les couleurs et tailles servent le plus : la fonction est proposée d'office.
UPDATE settings
   SET value = CASE WHEN value = '' THEN 'variants' ELSE value || ',variants' END
 WHERE key = 'enabled_features'
   AND ',' || value || ',' NOT LIKE '%,variants,%'
   AND EXISTS (
       SELECT 1 FROM settings s
        WHERE s.key IN ('business_type', 'business_types')
          AND (',' || s.value || ',' LIKE '%,fashion,%' OR ',' || s.value || ',' LIKE '%,phones,%'
               OR ',' || s.value || ',' LIKE '%,electronics,%' OR ',' || s.value || ',' LIKE '%,cosmetics,%'
               OR ',' || s.value || ',' LIKE '%,specialty,%'));
