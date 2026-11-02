-- GestiMarket — migration 006
-- Plan de la boutique, comme un plan d'architecte : niveaux du bâtiment, palette de meubles (types),
-- meubles posés sur le plan (position, taille et rotation en mètres), cases de chaque meuble
-- (étage × case) et emplacements multiples d'un produit (rayon, réserve, frigo…).
-- Les anciens blocs (A, B, 1, 2…) deviennent des gondoles placées sur le plan ; leurs étages et
-- rangées deviennent des étages et des cases ; les produits gardent leur place.

CREATE TABLE store_floors (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL,
    sort        INTEGER NOT NULL DEFAULT 0,
    width       REAL    NOT NULL DEFAULT 20,     -- mètres
    depth       REAL    NOT NULL DEFAULT 12,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
);
INSERT INTO store_floors (id, name, sort) VALUES (1, 'Rez-de-chaussée', 0);

-- Palette : types prédéfinis (builtin) et meubles personnalisés créés par la boutique.
CREATE TABLE fixture_types (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    code        TEXT    NOT NULL UNIQUE,
    name        TEXT    NOT NULL,
    category    TEXT    NOT NULL CHECK (category IN ('rayon', 'froid', 'presentation', 'rangement', 'zone', 'batiment')),
    prefix      TEXT    NOT NULL,                -- début des codes des meubles : FR1, FR2…
    color       TEXT    NOT NULL DEFAULT '#64748b',
    width       REAL    NOT NULL DEFAULT 1,      -- taille par défaut (mètres)
    depth       REAL    NOT NULL DEFAULT 1,
    levels      INTEGER NOT NULL DEFAULT 1,      -- étages par défaut
    sections    INTEGER NOT NULL DEFAULT 1,      -- cases par étage par défaut
    storage     INTEGER NOT NULL DEFAULT 1,      -- 0 : mur, porte, pièce… (aucun produit)
    builtin     INTEGER NOT NULL DEFAULT 0,
    sort        INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
);
INSERT INTO fixture_types (code, name, category, prefix, color, width, depth, levels, sections, storage, builtin, sort) VALUES
    ('gondole',             'Gondole (rayon double face)',         'rayon',        'GO', '#3b82f6', 3.0, 0.9, 5, 6, 1, 1, 10),
    ('tete_gondole',        'Tête de gondole',                     'rayon',        'TG', '#6366f1', 1.0, 0.9, 4, 2, 1, 1, 11),
    ('etagere_murale',      'Étagère murale',                      'rayon',        'ET', '#0ea5e9', 2.0, 0.5, 5, 4, 1, 1, 12),
    ('refrigerateur',       'Réfrigérateur vitré',                 'froid',        'FR', '#06b6d4', 0.7, 0.7, 5, 1, 1, 1, 20),
    ('congelateur_coffre',  'Congélateur coffre',                  'froid',        'CC', '#0891b2', 1.5, 0.7, 1, 3, 1, 1, 21),
    ('congelateur_armoire', 'Congélateur armoire',                 'froid',        'CA', '#0e7490', 0.7, 0.7, 5, 1, 1, 1, 22),
    ('vitrine_refrigeree',  'Vitrine réfrigérée',                  'froid',        'VR', '#22d3ee', 2.0, 0.9, 2, 4, 1, 1, 23),
    ('chambre_froide',      'Chambre froide',                      'froid',        'CF', '#155e75', 3.0, 2.5, 4, 4, 1, 1, 24),
    ('presentoir',          'Présentoir / stand',                  'presentation', 'PR', '#f59e0b', 1.0, 1.0, 3, 2, 1, 1, 30),
    ('bac_vrac',            'Bac vrac',                            'presentation', 'BV', '#d97706', 1.2, 0.8, 1, 4, 1, 1, 31),
    ('palette',             'Palette au sol',                      'presentation', 'PA', '#a16207', 1.2, 0.8, 1, 1, 1, 1, 32),
    ('portant',             'Portant à vêtements',                 'presentation', 'PV', '#ec4899', 1.5, 0.6, 1, 4, 1, 1, 33),
    ('rack',                'Rack de réserve',                     'rangement',    'RK', '#64748b', 2.5, 1.0, 4, 3, 1, 1, 40),
    ('armoire',             'Armoire / placard',                   'rangement',    'AR', '#78716c', 1.0, 0.6, 4, 2, 1, 1, 41),
    ('armoire_tiroirs',     'Armoire à tiroirs',                   'rangement',    'AT', '#57534e', 1.0, 0.5, 6, 3, 1, 1, 42),
    ('vitrine_fermee',      'Vitrine fermée (téléphones, bijoux)', 'rangement',    'VF', '#8b5cf6', 1.5, 0.6, 3, 3, 1, 1, 43),
    ('comptoir',            'Comptoir',                            'rangement',    'CO', '#a8a29e', 2.0, 0.6, 2, 3, 1, 1, 44),
    ('zone_vente',          'Salle de vente',                      'zone',         'ZV', '#dbeafe', 10.0, 8.0, 1, 1, 0, 1, 50),
    ('zone_reserve',        'Réserve',                             'zone',         'ZR', '#fef3c7', 4.0, 3.0, 1, 1, 0, 1, 51),
    ('zone_entrepot',       'Entrepôt / magasin de stockage',      'zone',         'ZE', '#e7e5e4', 8.0, 6.0, 1, 1, 0, 1, 52),
    ('zone_bureau',         'Bureau',                              'zone',         'ZB', '#ede9fe', 3.0, 3.0, 1, 1, 0, 1, 53),
    ('zone_exterieur',      'Terrasse / extérieur',                'zone',         'ZX', '#dcfce7', 6.0, 3.0, 1, 1, 0, 1, 54),
    ('zone_autre',          'Pièce / zone',                        'zone',         'ZA', '#f1f5f9', 4.0, 4.0, 1, 1, 0, 1, 55),
    ('mur',                 'Mur',                                 'batiment',     'MU', '#334155', 4.0, 0.15, 1, 1, 0, 1, 60),
    ('porte',               'Porte / entrée',                      'batiment',     'PE', '#16a34a', 1.2, 0.2, 1, 1, 0, 1, 61),
    ('fenetre',             'Fenêtre',                             'batiment',     'FN', '#93c5fd', 1.2, 0.15, 1, 1, 0, 1, 62),
    ('poteau',              'Poteau',                              'batiment',     'PX', '#475569', 0.3, 0.3, 1, 1, 0, 1, 63),
    ('escalier',            'Escalier',                            'batiment',     'ES', '#94a3b8', 1.0, 2.5, 1, 1, 0, 1, 64),
    ('caisse',              'Caisse',                              'batiment',     'CS', '#10b981', 1.2, 0.7, 1, 1, 0, 1, 65),
    ('texte',               'Texte / repère',                      'batiment',     'TX', '#0f172a', 2.0, 0.5, 1, 1, 0, 1, 66);

-- Meubles posés sur le plan. x, y : coin haut-gauche avant rotation ; w : largeur, h : profondeur.
CREATE TABLE fixtures (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    floor_id    INTEGER NOT NULL REFERENCES store_floors(id) ON DELETE CASCADE,
    type_id     INTEGER NOT NULL REFERENCES fixture_types(id),
    code        TEXT    NOT NULL,                -- GO1, FR2… (anciens blocs : A, B, 1…)
    name        TEXT    NOT NULL,
    x           REAL    NOT NULL DEFAULT 0,
    y           REAL    NOT NULL DEFAULT 0,
    w           REAL    NOT NULL DEFAULT 1,
    h           REAL    NOT NULL DEFAULT 1,
    rotation    INTEGER NOT NULL DEFAULT 0,      -- degrés
    color       TEXT,                            -- vide : couleur du type
    levels      INTEGER NOT NULL DEFAULT 1,
    sections    INTEGER NOT NULL DEFAULT 1,
    notes       TEXT,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
    updated_at  TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
);
CREATE UNIQUE INDEX idx_fixtures_code ON fixtures(code COLLATE NOCASE);
CREATE INDEX idx_fixtures_floor ON fixtures(floor_id);

-- Anciens blocs → gondoles, rangées de 4 sur le rez-de-chaussée.
WITH blocs AS (
    SELECT l.bloc,
           ROW_NUMBER() OVER (ORDER BY CAST(l.bloc AS INTEGER), l.bloc) - 1 AS idx,
           (SELECT l2.label FROM locations l2 WHERE l2.bloc = l.bloc AND trim(COALESCE(l2.label, '')) <> '' LIMIT 1) AS label,
           COUNT(DISTINCT l.etage) AS levels
    FROM locations l
    GROUP BY l.bloc
)
INSERT INTO fixtures (floor_id, type_id, code, name, x, y, w, h, levels, sections)
SELECT 1, (SELECT id FROM fixture_types WHERE code = 'gondole'), b.bloc,
       COALESCE(b.label, 'Rayon ' || b.bloc),
       1 + (b.idx % 4) * 4.5, 1 + (b.idx / 4) * 2.5, 3.0, 0.9, b.levels,
       (SELECT MAX(n) FROM (SELECT COUNT(*) AS n FROM locations l3 WHERE l3.bloc = b.bloc GROUP BY l3.etage))
FROM blocs b;
UPDATE store_floors
   SET depth = max(12, 2 + ((SELECT COUNT(*) FROM fixtures) + 3) / 4 * 2.5)
 WHERE id = 1;

-- Cases : une ligne par étage × case d'un meuble. bloc / etage / rangee : libellés affichés
-- (code du meuble, numéro d'étage et de case), conservés pour la recherche et l'import.
CREATE TABLE locations_new (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    fixture_id  INTEGER NOT NULL REFERENCES fixtures(id) ON DELETE CASCADE,
    level       INTEGER NOT NULL DEFAULT 1,      -- étage du meuble (1 = en bas)
    section     INTEGER NOT NULL DEFAULT 1,      -- case (1 = à gauche)
    bloc        TEXT    NOT NULL,
    etage       TEXT    NOT NULL DEFAULT '',
    rangee      TEXT    NOT NULL DEFAULT '',
    label       TEXT,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
    UNIQUE (fixture_id, level, section)
);
INSERT INTO locations_new (id, fixture_id, level, section, bloc, etage, rangee, label, created_at)
SELECT l.id, f.id,
       DENSE_RANK() OVER (PARTITION BY l.bloc ORDER BY CAST(l.etage AS INTEGER), l.etage),
       ROW_NUMBER() OVER (PARTITION BY l.bloc, l.etage ORDER BY CAST(l.rangee AS INTEGER), l.rangee),
       l.bloc, l.etage, l.rangee, l.label, l.created_at
FROM locations l
JOIN fixtures f ON f.code = l.bloc;
DROP TABLE locations;
ALTER TABLE locations_new RENAME TO locations;
CREATE INDEX idx_locations_fixture ON locations(fixture_id);
CREATE INDEX idx_locations_bloc ON locations(bloc);

-- Cases manquantes des anciens blocs (étages de longueurs différentes) : la grille est complète.
WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 100)
INSERT OR IGNORE INTO locations (fixture_id, level, section, bloc, etage, rangee)
SELECT f.id, a.i, b.i, f.code,
       COALESCE((SELECT x.etage FROM locations x WHERE x.fixture_id = f.id AND x.level = a.i LIMIT 1),
                CASE WHEN f.levels > 1 THEN CAST(a.i AS TEXT) ELSE '' END),
       CASE WHEN f.sections > 1 THEN CAST(b.i AS TEXT) ELSE '' END
FROM fixtures f
JOIN n a ON a.i <= f.levels
JOIN n b ON b.i <= f.sections;

-- Autres emplacements d'un produit (l'emplacement principal reste products.location_id).
CREATE TABLE product_locations (
    product_id  INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    location_id INTEGER NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
    PRIMARY KEY (product_id, location_id)
);
CREATE INDEX idx_product_locations_location ON product_locations(location_id);
