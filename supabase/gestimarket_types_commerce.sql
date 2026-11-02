-- GestiMarket 0.11 — Types de boutique du compte Eden Dev = types de commerce de l'application
-- (mêmes codes : le type choisi à l'inscription est proposé dans la première configuration).
-- À exécuter après gestimarket_licences.sql ; sans effet s'il a déjà été exécuté.

insert into public.gm_shop_types (code, label, sort) values
  ('boutique',    'Boutique de quartier',                  1),
  ('general',     'Magasin de commerce général',           2),
  ('supermarket', 'Supermarché / hypermarché',             3),
  ('superette',   'Supérette',                             4),
  ('wholesale',   'Grossiste / demi-grossiste',            5),
  ('pharmacy',    'Pharmacie / parapharmacie',             6),
  ('fashion',     'Vêtements et chaussures',               7),
  ('hardware',    'Quincaillerie',                         8),
  ('building',    'Matériaux de construction',             9),
  ('electronics', 'Électronique / électroménager',        10),
  ('phones',      'Téléphonie et accessoires',            11),
  ('bakery',      'Boulangerie / pâtisserie',             12),
  ('butcher',     'Boucherie / poissonnerie',             13),
  ('greengrocer', 'Fruits et légumes',                    14),
  ('cosmetics',   'Cosmétiques / parfumerie',             15),
  ('bookshop',    'Librairie / papeterie',                16),
  ('autoparts',   'Pièces auto / moto',                   17),
  ('agrovet',     'Agro-vétérinaire / animalerie',        18),
  ('bar',         'Bar / maquis / café',                  19),
  ('kiosk',       'Kiosque / boutique de station-service', 20),
  ('restaurant',  'Restaurant / fast-food',               21),
  ('specialty',   'Boutique spécialisée / autre',         99)
on conflict (code) do update set label = excluded.label, sort = excluded.sort;

-- Anciens codes (0.9 et 0.10) → nouveaux codes.
update public.gm_stores set shop_type = case shop_type
    when 'supermarche'   then 'supermarket'
    when 'grossiste'     then 'wholesale'
    when 'quincaillerie' then 'hardware'
    when 'cosmetiques'   then 'cosmetics'
    when 'pharmacie'     then 'pharmacy'
    when 'boulangerie'   then 'bakery'
    when 'autre'         then 'specialty'
    else shop_type end
where shop_type in ('supermarche', 'grossiste', 'quincaillerie', 'cosmetiques', 'pharmacie', 'boulangerie', 'autre');
delete from public.gm_shop_types
where code in ('supermarche', 'grossiste', 'quincaillerie', 'cosmetiques', 'pharmacie', 'boulangerie', 'autre');
