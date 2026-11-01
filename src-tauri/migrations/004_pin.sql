-- GestiMarket — migration 004 : code PIN par utilisateur (confirmation des actions critiques et connexion rapide).
ALTER TABLE users ADD COLUMN pin_hash TEXT;
