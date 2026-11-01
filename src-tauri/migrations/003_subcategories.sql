-- GestiMarket — migration 003
-- Catégories hiérarchiques : catégorie → sous-catégories → produits.
-- Un même nom de sous-catégorie peut exister dans deux catégories différentes (ex. « Autres »).

CREATE TABLE categories_new (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    parent_id   INTEGER REFERENCES categories(id) ON DELETE CASCADE,
    name        TEXT    NOT NULL,
    color       TEXT    NOT NULL DEFAULT '#64748b',
    image_id    INTEGER REFERENCES media(id) ON DELETE SET NULL,
    sort_order  INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
);
INSERT INTO categories_new (id, name, color, image_id, created_at)
SELECT id, name, color, image_id, created_at FROM categories;
DROP TABLE categories;
ALTER TABLE categories_new RENAME TO categories;
CREATE UNIQUE INDEX idx_categories_unique ON categories(COALESCE(parent_id, 0), name COLLATE NOCASE);
CREATE INDEX idx_categories_parent ON categories(parent_id);
