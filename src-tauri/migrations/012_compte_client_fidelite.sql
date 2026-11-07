-- 0.19 : compte client (fonds et dettes) et programme client fidèle (étoiles et bonus).
--
-- Compte client : `customers.balance` garde son sens (montant dû par le client). Un solde négatif
-- veut dire que le client a déposé des fonds à la boutique (-5 000 = 5 000 de fonds disponibles).

-- Bonus fidélité disponible (en unités de la devise, comme les prix) et carte de fidélité (QR code).
ALTER TABLE customers ADD COLUMN loyalty_bonus INTEGER NOT NULL DEFAULT 0;
ALTER TABLE customers ADD COLUMN card_code TEXT;
CREATE UNIQUE INDEX idx_customers_card ON customers(card_code) WHERE card_code IS NOT NULL;

-- Vente : part payée avec les fonds du compte client (la part mise en dette reste `credit_amount`)
-- et bonus gagné par le client sur cette vente.
ALTER TABLE sales ADD COLUMN account_amount INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sales ADD COLUMN loyalty_earned INTEGER NOT NULL DEFAULT 0;
CREATE INDEX idx_sales_customer_date ON sales(customer_id, created_at);

-- Retour : part rendue en bonus (vente payée en partie avec le bonus), le reste par le moyen choisi.
ALTER TABLE returns ADD COLUMN loyalty_refund INTEGER NOT NULL DEFAULT 0;

-- Versements des clients : « payment » (versement : rembourse la dette, puis devient des fonds)
-- ou « refund » (fonds rendus au client, montant négatif, validé par un responsable).
ALTER TABLE customer_payments ADD COLUMN kind TEXT NOT NULL DEFAULT 'payment';

-- Historique du bonus : gagné (+), dépensé (−), rendu, retiré, expiré, converti depuis les anciens points.
CREATE TABLE loyalty_moves (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id  INTEGER NOT NULL REFERENCES customers(id),
    kind         TEXT    NOT NULL,   -- earn, spend, cancel, return, expire, convert, debt_paid
    amount       INTEGER NOT NULL,   -- + ajouté au bonus, − retiré du bonus
    sale_id      INTEGER REFERENCES sales(id),
    return_id    INTEGER REFERENCES returns(id),
    note         TEXT,
    user_id      INTEGER REFERENCES users(id),
    created_at   TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
);
CREATE INDEX idx_loyalty_moves_customer ON loyalty_moves(customer_id, created_at);

-- Les boutiques qui utilisaient déjà les points de fidélité passent au programme client fidèle.
-- Leurs points restent affichés et se convertissent en bonus depuis les paramètres.
INSERT OR IGNORE INTO settings (key, value)
SELECT 'loyalty_enabled', '1' FROM settings WHERE key = 'loyalty_step' AND CAST(value AS INTEGER) > 0;
