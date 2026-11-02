-- GestiMarket — migration 007
-- Langue de chaque utilisateur (fr, en ; vide : langue de la boutique, paramètre « shop_lang »).
ALTER TABLE users ADD COLUMN lang TEXT;
