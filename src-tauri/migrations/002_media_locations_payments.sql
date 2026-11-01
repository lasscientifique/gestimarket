-- GestiMarket — migration 002
-- Photos, emplacements (bloc / étage / rangée), dates de péremption,
-- paiements multiples (Orange Money / Sarali, mobile money, carte…) et références de transaction.
-- Exécutée avec les clés étrangères désactivées (voir db.rs) pour reconstruire les tables.

-- ───────────── Photos ─────────────
CREATE TABLE media (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    mime        TEXT    NOT NULL,
    data        BLOB    NOT NULL,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
);

-- ───────────── Emplacements ─────────────
CREATE TABLE locations (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    bloc        TEXT    NOT NULL,
    etage       TEXT    NOT NULL DEFAULT '',
    rangee      TEXT    NOT NULL DEFAULT '',
    label       TEXT,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
    UNIQUE (bloc, etage, rangee)
);

ALTER TABLE categories ADD COLUMN image_id INTEGER REFERENCES media(id) ON DELETE SET NULL;
ALTER TABLE products   ADD COLUMN image_id INTEGER REFERENCES media(id) ON DELETE SET NULL;
ALTER TABLE products   ADD COLUMN location_id INTEGER REFERENCES locations(id) ON DELETE SET NULL;
ALTER TABLE products   ADD COLUMN expiry_date TEXT;
ALTER TABLE purchase_items ADD COLUMN expiry_date TEXT;
CREATE INDEX idx_products_location ON products(location_id);
CREATE INDEX idx_products_expiry   ON products(expiry_date);

-- ───────────── Ventes : suppression de la contrainte sur le mode de paiement ─────────────
CREATE TABLE sales_new (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    number          TEXT    NOT NULL UNIQUE,
    customer_id     INTEGER REFERENCES customers(id),
    user_id         INTEGER NOT NULL REFERENCES users(id),
    session_id      INTEGER REFERENCES cash_sessions(id),
    subtotal        INTEGER NOT NULL,
    discount        INTEGER NOT NULL DEFAULT 0,
    tax_total       INTEGER NOT NULL DEFAULT 0,
    total           INTEGER NOT NULL,
    cost_total      INTEGER NOT NULL DEFAULT 0,
    amount_paid     INTEGER NOT NULL DEFAULT 0,
    change_due      INTEGER NOT NULL DEFAULT 0,
    credit_amount   INTEGER NOT NULL DEFAULT 0,
    payment_method  TEXT    NOT NULL,
    status          TEXT    NOT NULL DEFAULT 'completed' CHECK (status IN ('completed', 'cancelled')),
    note            TEXT,
    created_at      TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
    cancelled_at    TEXT,
    cancelled_by    INTEGER REFERENCES users(id),
    cancel_reason   TEXT
);
INSERT INTO sales_new (id, number, customer_id, user_id, session_id, subtotal, discount, tax_total, total, cost_total,
                       amount_paid, change_due, credit_amount, payment_method, status, note, created_at,
                       cancelled_at, cancelled_by, cancel_reason)
SELECT id, number, customer_id, user_id, session_id, subtotal, discount, tax_total, total, cost_total,
       amount_paid, change_due, credit_amount, payment_method, status, note, created_at,
       cancelled_at, cancelled_by, cancel_reason
FROM sales;
DROP TABLE sales;
ALTER TABLE sales_new RENAME TO sales;
CREATE INDEX idx_sales_created  ON sales(created_at);
CREATE INDEX idx_sales_session  ON sales(session_id);
CREATE INDEX idx_sales_customer ON sales(customer_id);

-- ───────────── Détail des paiements d'une vente (paiements multiples) ─────────────
CREATE TABLE sale_payments (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    sale_id     INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
    method      TEXT    NOT NULL,          -- cash, orange_money, mobile_money, card, other
    amount      INTEGER NOT NULL,          -- montant imputé à la vente (monnaie rendue déduite)
    tendered    INTEGER NOT NULL DEFAULT 0,-- montant remis par le client (espèces)
    reference   TEXT,                      -- ID de transaction Orange Money / mobile money / carte
    phone       TEXT,                      -- numéro du payeur
    created_at  TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
);
CREATE INDEX idx_sale_payments_sale      ON sale_payments(sale_id);
CREATE INDEX idx_sale_payments_reference ON sale_payments(reference);
CREATE INDEX idx_sale_payments_method    ON sale_payments(method, created_at);

-- Reprise des ventes existantes
INSERT INTO sale_payments (sale_id, method, amount, tendered, created_at)
SELECT id, payment_method, amount_paid - change_due, amount_paid, created_at
FROM sales WHERE payment_method <> 'credit' AND amount_paid > 0;

-- ───────────── Règlements clients : références de transaction ─────────────
CREATE TABLE customer_payments_new (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id  INTEGER NOT NULL REFERENCES customers(id),
    amount       INTEGER NOT NULL,
    method       TEXT    NOT NULL,
    reference    TEXT,
    phone        TEXT,
    note         TEXT,
    user_id      INTEGER REFERENCES users(id),
    session_id   INTEGER REFERENCES cash_sessions(id),
    created_at   TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
);
INSERT INTO customer_payments_new (id, customer_id, amount, method, note, user_id, session_id, created_at)
SELECT id, customer_id, amount, method, note, user_id, session_id, created_at FROM customer_payments;
DROP TABLE customer_payments;
ALTER TABLE customer_payments_new RENAME TO customer_payments;
CREATE INDEX idx_customer_payments_customer  ON customer_payments(customer_id);
CREATE INDEX idx_customer_payments_reference ON customer_payments(reference);
