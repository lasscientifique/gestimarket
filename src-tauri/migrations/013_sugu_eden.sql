-- Sugu Eden (0.30) : produits publiés sur la place de marché d'Eden Dev.
-- « Publier sur Sugu Eden » est choisi produit par produit ; le prix Sugu Eden est facultatif (vide : prix de vente).
ALTER TABLE products ADD COLUMN sugu_publish INTEGER NOT NULL DEFAULT 0;
ALTER TABLE products ADD COLUMN sugu_price   INTEGER;

-- Ce qui est déjà sur Sugu Eden : empreinte du produit envoyé et photo envoyée, pour n'envoyer que les changements.
CREATE TABLE sugu_sync (
    product_id INTEGER PRIMARY KEY,
    hash       TEXT NOT NULL,
    photo_key  TEXT NOT NULL DEFAULT '',
    synced_at  TEXT NOT NULL
);
