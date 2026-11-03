-- Personnel : identifiant et code PIN, plus de mot de passe (seule la boutique a un compte en ligne).
-- Accès Internet : téléphones autorisés (compte boutique ou code d'accès donné par l'administrateur).
-- Plan : dessin du bâtiment (photo, PDF) en fond d'un niveau.

-- Accès depuis Internet, autorisé par l'administrateur ; compte supprimé (gardé pour l'historique).
ALTER TABLE users ADD COLUMN internet_access INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN deleted_at TEXT;
UPDATE users SET internet_access = 1 WHERE role = 'admin';
-- Les mots de passe disparaissent. Un administrateur qui n'a pas encore de PIN garde le sien
-- le temps de le créer ; les autres comptes sans PIN attendent celui que l'administrateur leur donne.
UPDATE users SET password_hash = '' WHERE pin_hash IS NOT NULL OR role <> 'admin';

-- Téléphones (ou navigateurs) autorisés à se connecter depuis Internet. Le jeton n'est gardé que haché.
-- user_id vide : autorisé par le compte boutique (tout le personnel ayant l'accès Internet) ;
-- sinon : autorisé par un code d'accès, pour cette personne seulement.
CREATE TABLE trusted_devices (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    token_hash    TEXT    NOT NULL UNIQUE,
    user_id       INTEGER REFERENCES users(id),
    method        TEXT    NOT NULL CHECK (method IN ('account', 'code')),
    label         TEXT    NOT NULL,
    created_at    TEXT    NOT NULL,
    last_used_at  TEXT,
    revoked_at    TEXT
);
CREATE INDEX idx_trusted_devices_user ON trusted_devices(user_id);

-- Codes d'accès téléphone (8 lettres et chiffres) : un code = un téléphone, valable 7 jours.
CREATE TABLE access_codes (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id),
    code_hash   TEXT    NOT NULL,
    created_by  INTEGER REFERENCES users(id),
    created_at  TEXT    NOT NULL,
    expires_at  TEXT    NOT NULL,
    used_at     TEXT,
    device_id   INTEGER REFERENCES trusted_devices(id)
);
CREATE INDEX idx_access_codes_user ON access_codes(user_id);

-- Dessin du bâtiment : image (media) et cadrage en mètres sur le niveau {x, y, w, h, opacity}.
ALTER TABLE store_floors ADD COLUMN backdrop_id INTEGER REFERENCES media(id) ON DELETE SET NULL;
ALTER TABLE store_floors ADD COLUMN backdrop TEXT;
