-- GestiMarket 0.31 : produits mieux décrits pour Sugu Eden.
-- Classement Sugu Eden (code de sous-catégorie, ex. « femmes/vetements/robes »), état, public visé, mots-clés.
ALTER TABLE products ADD COLUMN sugu_code      TEXT;
ALTER TABLE products ADD COLUMN sugu_condition TEXT NOT NULL DEFAULT 'new';
ALTER TABLE products ADD COLUMN sugu_audience  TEXT;
ALTER TABLE products ADD COLUMN sugu_keywords  TEXT;

-- Photos en plus de la photo principale (products.image_id) : 7 au plus, dans l'ordre.
CREATE TABLE product_photos (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    media_id   INTEGER NOT NULL REFERENCES media(id) ON DELETE CASCADE,
    position   INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_product_photos ON product_photos(product_id, position);
