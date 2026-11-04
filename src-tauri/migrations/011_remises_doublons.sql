-- GestiMarket 0.16 : remises validées par le serveur, ventes sans doublon.

-- Responsable qui a validé une remise au-delà du seuil autorisé à la caissière (code PIN).
ALTER TABLE sales ADD COLUMN discount_approved_by INTEGER REFERENCES users(id);

-- Numéro unique du ticket, choisi par la caisse : la même vente envoyée deux fois (réseau coupé
-- pendant l'encaissement, nouvel essai) n'est enregistrée qu'une fois.
ALTER TABLE sales ADD COLUMN client_ref TEXT;
CREATE UNIQUE INDEX idx_sales_client_ref ON sales(client_ref) WHERE client_ref IS NOT NULL;

-- Jusqu'ici, le PIN de remise n'était demandé que par l'écran, et « caissier » revenait à taper son
-- propre code. Désormais le serveur l'exige au-delà du seuil : la validation passe au gestionnaire.
UPDATE settings SET value = 'manager' WHERE key = 'pin_discount_level' AND value = 'cashier';
