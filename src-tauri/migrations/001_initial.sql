-- GestiMarket — schéma initial
-- Tous les montants sont stockés en ENTIERS, dans la plus petite unité de la devise
-- (ex. 1 FCFA, ou 1 centime d'euro). Les quantités sont des REAL (produits au poids).

CREATE TABLE users (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    username        TEXT    NOT NULL UNIQUE COLLATE NOCASE,
    full_name       TEXT    NOT NULL,
    password_hash   TEXT    NOT NULL,
    role            TEXT    NOT NULL CHECK (role IN ('admin', 'manager', 'cashier')),
    active          INTEGER NOT NULL DEFAULT 1,
    created_at      TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
    last_login_at   TEXT
);

CREATE TABLE settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE categories (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL UNIQUE COLLATE NOCASE,
    color       TEXT NOT NULL DEFAULT '#64748b',
    created_at  TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE suppliers (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL,
    contact     TEXT,
    phone       TEXT,
    email       TEXT,
    address     TEXT,
    notes       TEXT,
    active      INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE customers (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    name            TEXT    NOT NULL,
    phone           TEXT,
    email           TEXT,
    address         TEXT,
    notes           TEXT,
    credit_limit    INTEGER NOT NULL DEFAULT 0,   -- 0 = crédit non autorisé
    balance         INTEGER NOT NULL DEFAULT 0,   -- montant dû par le client
    loyalty_points  INTEGER NOT NULL DEFAULT 0,
    active          INTEGER NOT NULL DEFAULT 1,
    created_at      TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE products (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    barcode         TEXT UNIQUE,
    name            TEXT    NOT NULL,
    description     TEXT,
    category_id     INTEGER REFERENCES categories(id) ON DELETE SET NULL,
    supplier_id     INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
    unit            TEXT    NOT NULL DEFAULT 'pce',
    purchase_price  INTEGER NOT NULL DEFAULT 0,
    sale_price      INTEGER NOT NULL DEFAULT 0,
    tax_rate        REAL    NOT NULL DEFAULT 0,
    stock           REAL    NOT NULL DEFAULT 0,
    min_stock       REAL    NOT NULL DEFAULT 0,
    track_stock     INTEGER NOT NULL DEFAULT 1,
    active          INTEGER NOT NULL DEFAULT 1,
    created_at      TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
    updated_at      TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
);
CREATE INDEX idx_products_name     ON products(name COLLATE NOCASE);
CREATE INDEX idx_products_category ON products(category_id);

CREATE TABLE cash_sessions (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id          INTEGER NOT NULL REFERENCES users(id),
    opened_at        TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
    closed_at        TEXT,
    opening_amount   INTEGER NOT NULL DEFAULT 0,
    expected_amount  INTEGER,
    counted_amount   INTEGER,
    difference       INTEGER,
    status           TEXT    NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
    note             TEXT
);
CREATE INDEX idx_cash_sessions_user ON cash_sessions(user_id, status);

CREATE TABLE cash_movements (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id  INTEGER NOT NULL REFERENCES cash_sessions(id),
    kind        TEXT    NOT NULL CHECK (kind IN ('in', 'out')),
    amount      INTEGER NOT NULL,
    reason      TEXT    NOT NULL,
    user_id     INTEGER REFERENCES users(id),
    created_at  TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE sales (
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
    payment_method  TEXT    NOT NULL CHECK (payment_method IN ('cash', 'mobile_money', 'card', 'credit', 'other')),
    status          TEXT    NOT NULL DEFAULT 'completed' CHECK (status IN ('completed', 'cancelled')),
    note            TEXT,
    created_at      TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
    cancelled_at    TEXT,
    cancelled_by    INTEGER REFERENCES users(id),
    cancel_reason   TEXT
);
CREATE INDEX idx_sales_created  ON sales(created_at);
CREATE INDEX idx_sales_session  ON sales(session_id);
CREATE INDEX idx_sales_customer ON sales(customer_id);

CREATE TABLE sale_items (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    sale_id       INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
    product_id    INTEGER NOT NULL REFERENCES products(id),
    product_name  TEXT    NOT NULL,
    unit          TEXT    NOT NULL DEFAULT 'pce',
    quantity      REAL    NOT NULL,
    unit_price    INTEGER NOT NULL,
    unit_cost     INTEGER NOT NULL DEFAULT 0,
    discount      INTEGER NOT NULL DEFAULT 0,
    tax_rate      REAL    NOT NULL DEFAULT 0,
    total         INTEGER NOT NULL
);
CREATE INDEX idx_sale_items_sale    ON sale_items(sale_id);
CREATE INDEX idx_sale_items_product ON sale_items(product_id);

CREATE TABLE customer_payments (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id  INTEGER NOT NULL REFERENCES customers(id),
    amount       INTEGER NOT NULL,
    method       TEXT    NOT NULL CHECK (method IN ('cash', 'mobile_money', 'card', 'other')),
    note         TEXT,
    user_id      INTEGER REFERENCES users(id),
    session_id   INTEGER REFERENCES cash_sessions(id),
    created_at   TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
);
CREATE INDEX idx_customer_payments_customer ON customer_payments(customer_id);

CREATE TABLE purchases (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    number       TEXT    NOT NULL UNIQUE,
    supplier_id  INTEGER REFERENCES suppliers(id),
    user_id      INTEGER NOT NULL REFERENCES users(id),
    total        INTEGER NOT NULL,
    note         TEXT,
    created_at   TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE purchase_items (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    purchase_id   INTEGER NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
    product_id    INTEGER NOT NULL REFERENCES products(id),
    product_name  TEXT    NOT NULL,
    quantity      REAL    NOT NULL,
    unit_cost     INTEGER NOT NULL,
    total         INTEGER NOT NULL
);

CREATE TABLE stock_movements (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id   INTEGER NOT NULL REFERENCES products(id),
    kind         TEXT    NOT NULL CHECK (kind IN ('initial', 'sale', 'sale_cancel', 'purchase', 'adjustment', 'loss', 'return')),
    quantity     REAL    NOT NULL,          -- signé : + entrée, - sortie
    stock_after  REAL    NOT NULL,
    unit_cost    INTEGER,
    reference    TEXT,
    note         TEXT,
    user_id      INTEGER REFERENCES users(id),
    created_at   TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
);
CREATE INDEX idx_stock_movements_product ON stock_movements(product_id, created_at);
CREATE INDEX idx_stock_movements_created ON stock_movements(created_at);

-- Journal d'activité (traçabilité / redevabilité)
CREATE TABLE audit_log (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER REFERENCES users(id),
    username    TEXT,
    action      TEXT NOT NULL,
    entity      TEXT,
    entity_id   INTEGER,
    details     TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);
CREATE INDEX idx_audit_log_created ON audit_log(created_at);
