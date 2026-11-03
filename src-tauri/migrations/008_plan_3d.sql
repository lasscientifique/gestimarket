-- Plan de la boutique en 3D : hauteur des meubles, forme 3D de chaque type, hauteur des murs et sol de chaque niveau.

-- Forme 3D : code d'un meuble de base (gondole, refrigerateur…) ; un meuble personnalisé en choisit une.
ALTER TABLE fixture_types ADD COLUMN model  TEXT NOT NULL DEFAULT '';
ALTER TABLE fixture_types ADD COLUMN height REAL NOT NULL DEFAULT 1.8;   -- mètres
-- Hauteur propre d'un meuble posé (vide : celle de son type).
ALTER TABLE fixtures ADD COLUMN height REAL;
ALTER TABLE store_floors ADD COLUMN wall_height REAL NOT NULL DEFAULT 3.0;
ALTER TABLE store_floors ADD COLUMN floor_style TEXT NOT NULL DEFAULT 'tiles';   -- tiles, concrete, wood, vinyl

UPDATE fixture_types SET model = code WHERE builtin = 1;
UPDATE fixture_types SET model = CASE category
        WHEN 'rayon' THEN 'etagere_murale'
        WHEN 'froid' THEN 'refrigerateur'
        WHEN 'presentation' THEN 'presentoir'
        WHEN 'rangement' THEN 'armoire'
        WHEN 'zone' THEN 'zone_autre'
        ELSE 'texte' END
 WHERE builtin = 0;

UPDATE fixture_types SET height = CASE code
        WHEN 'gondole' THEN 1.8
        WHEN 'tete_gondole' THEN 1.6
        WHEN 'etagere_murale' THEN 2.0
        WHEN 'refrigerateur' THEN 2.0
        WHEN 'congelateur_coffre' THEN 0.9
        WHEN 'congelateur_armoire' THEN 2.0
        WHEN 'vitrine_refrigeree' THEN 1.3
        WHEN 'chambre_froide' THEN 2.6
        WHEN 'presentoir' THEN 1.4
        WHEN 'bac_vrac' THEN 0.9
        WHEN 'palette' THEN 1.2
        WHEN 'portant' THEN 1.6
        WHEN 'rack' THEN 3.0
        WHEN 'armoire' THEN 2.0
        WHEN 'armoire_tiroirs' THEN 1.2
        WHEN 'vitrine_fermee' THEN 1.0
        WHEN 'comptoir' THEN 1.0
        WHEN 'mur' THEN 3.0
        WHEN 'porte' THEN 2.1
        WHEN 'fenetre' THEN 1.2
        WHEN 'poteau' THEN 3.0
        WHEN 'escalier' THEN 3.0
        WHEN 'caisse' THEN 0.9
        WHEN 'texte' THEN 0.0
        ELSE 0.02 END
 WHERE builtin = 1;

-- Pièces personnalisées : posées au sol.
UPDATE fixture_types SET height = 0.02 WHERE builtin = 0 AND category = 'zone';
