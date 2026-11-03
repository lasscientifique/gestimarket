-- GestiMarket 0.15 : retours et avoirs, prix de gros, promotions, rapports Z.

-- ───────────── Avoirs : bon numéroté, utilisable en caisse comme moyen de paiement ─────────────
CREATE TABLE credit_notes (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    number      TEXT    NOT NULL UNIQUE,            -- AV20261103-0001
    code        TEXT    NOT NULL UNIQUE,            -- numéro + 4 caractères tirés au hasard (imprimé, scanné)
    customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
    amount      INTEGER NOT NULL CHECK (amount > 0),
    balance     INTEGER NOT NULL CHECK (balance >= 0), -- reste utilisable
    status      TEXT    NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'used', 'cancelled')),
    expires_on  TEXT    NOT NULL,                   -- date (AAAA-MM-JJ) : utilisable jusqu'à ce jour inclus
    user_id     INTEGER REFERENCES users(id),
    return_id   INTEGER REFERENCES returns(id),     -- retour qui l'a créé
    created_at  TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
);
CREATE INDEX idx_credit_notes_customer ON credit_notes(customer_id);

-- ───────────── Retours d'articles sur une vente ─────────────
CREATE TABLE returns (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    number          TEXT    NOT NULL UNIQUE,        -- R20261103-0001
    sale_id         INTEGER NOT NULL REFERENCES sales(id),
    customer_id     INTEGER REFERENCES customers(id),
    user_id         INTEGER NOT NULL REFERENCES users(id),     -- caissière qui rend
    approved_by     INTEGER REFERENCES users(id),              -- responsable qui a validé (PIN)
    session_id      INTEGER REFERENCES cash_sessions(id),
    total           INTEGER NOT NULL,               -- montant rendu (TTC)
    tax_total       INTEGER NOT NULL DEFAULT 0,
    cost_total      INTEGER NOT NULL DEFAULT 0,
    refund_method   TEXT    NOT NULL,               -- cash, orange_money, mm:<id>, card, other, credit_note, debt
    refund_reference TEXT,
    credit_note_id  INTEGER REFERENCES credit_notes(id),
    reason          TEXT    NOT NULL,
    created_at      TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
);
CREATE INDEX idx_returns_sale    ON returns(sale_id);
CREATE INDEX idx_returns_session ON returns(session_id);
CREATE INDEX idx_returns_created ON returns(created_at);

CREATE TABLE return_items (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    return_id     INTEGER NOT NULL REFERENCES returns(id) ON DELETE CASCADE,
    sale_item_id  INTEGER NOT NULL REFERENCES sale_items(id),
    product_id    INTEGER NOT NULL REFERENCES products(id),
    product_name  TEXT    NOT NULL,
    quantity      REAL    NOT NULL,                 -- en unités de vente (conditionnements si vendu par carton)
    base_quantity REAL    NOT NULL,
    total         INTEGER NOT NULL,                 -- montant rendu pour la ligne (remise du ticket déduite)
    tax           INTEGER NOT NULL DEFAULT 0,
    cost          INTEGER NOT NULL DEFAULT 0,
    restock       INTEGER NOT NULL DEFAULT 1        -- 1 : remis en rayon ; 0 : abîmé (perte)
);
CREATE INDEX idx_return_items_sale_item ON return_items(sale_item_id);

-- ───────────── Prix de gros (à partir d'une quantité, ou pour un client grossiste) ─────────────
ALTER TABLE products           ADD COLUMN wholesale_price   INTEGER NOT NULL DEFAULT 0;   -- 0 : pas de prix de gros
ALTER TABLE products           ADD COLUMN wholesale_min_qty REAL    NOT NULL DEFAULT 0;   -- 0 : client grossiste seulement
ALTER TABLE product_packagings ADD COLUMN wholesale_price   INTEGER NOT NULL DEFAULT 0;
ALTER TABLE product_packagings ADD COLUMN wholesale_min_qty REAL    NOT NULL DEFAULT 0;
ALTER TABLE customers          ADD COLUMN wholesale         INTEGER NOT NULL DEFAULT 0;   -- 1 : toujours au prix de gros

-- ───────────── Promotions datées : remise en % ou prix promo, sur un article ou une catégorie ─────────────
CREATE TABLE promotions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL,
    kind        TEXT    NOT NULL CHECK (kind IN ('percent', 'price')),
    value       INTEGER NOT NULL CHECK (value > 0),  -- % (1 à 90) ou prix promo de l'unité de base
    product_id  INTEGER REFERENCES products(id) ON DELETE CASCADE,
    category_id INTEGER REFERENCES categories(id) ON DELETE CASCADE,
    starts_on   TEXT    NOT NULL,                    -- AAAA-MM-JJ
    ends_on     TEXT    NOT NULL,                    -- AAAA-MM-JJ (inclus)
    active      INTEGER NOT NULL DEFAULT 1,
    created_by  INTEGER REFERENCES users(id),
    created_at  TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
    CHECK ((product_id IS NULL) <> (category_id IS NULL)),
    CHECK (kind = 'percent' OR product_id IS NOT NULL),
    CHECK (ends_on >= starts_on)
);
CREATE INDEX idx_promotions_product  ON promotions(product_id);
CREATE INDEX idx_promotions_category ON promotions(category_id);

-- Prix appliqué à une ligne de vente : normal, gros ou promotion (avec le prix normal pour l'économie).
ALTER TABLE sale_items ADD COLUMN price_kind    TEXT    NOT NULL DEFAULT 'retail';
ALTER TABLE sale_items ADD COLUMN regular_price INTEGER;
ALTER TABLE sale_items ADD COLUMN promotion_id  INTEGER REFERENCES promotions(id) ON DELETE SET NULL;

-- ───────────── Rapports Z : un par clôture de caisse, numérotés, non modifiables ─────────────
CREATE TABLE z_reports (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    number      INTEGER NOT NULL UNIQUE,            -- Z-0001, Z-0002…
    session_id  INTEGER NOT NULL UNIQUE REFERENCES cash_sessions(id),
    user_id     INTEGER REFERENCES users(id),       -- qui a clôturé
    data        TEXT    NOT NULL,                   -- contenu figé (JSON)
    prev_hash   TEXT    NOT NULL,
    hash        TEXT    NOT NULL,                   -- SHA-256(prev_hash + data) : toute retouche se voit
    created_at  TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
);
CREATE TRIGGER z_reports_no_update BEFORE UPDATE ON z_reports
BEGIN
    SELECT RAISE(ABORT, 'Un rapport Z ne peut pas être modifié.');
END;
CREATE TRIGGER z_reports_no_delete BEFORE DELETE ON z_reports
BEGIN
    SELECT RAISE(ABORT, 'Un rapport Z ne peut pas être supprimé.');
END;
