-- GestiMarket 0.12 : tous les pays, devises ISO 4217 et prix des formules par devise.
-- À exécuter après gestimarket_licences.sql et gestimarket_paiements.sql (peut être relancé sans risque).
--
-- Prix : XOF et XAF (franc CFA) = colonne price_month de gm_plans (cartes de bon, Orange Money, prorata).
-- Les autres devises se règlent dans gm_plan_prices, en unités entières de la devise (8 = 8 €).
-- Carte Visa : payée dans la devise de la boutique si elle figure dans gm_config.card_currencies
-- (devises acceptées par le profil Cybersource, ex. « XOF,EUR,USD ») et a un prix ; sinon en card_currency.

-- ───────────────────────────── Pays ─────────────────────────────

alter table public.gm_countries alter column currency set default 'XOF';
insert into public.gm_countries (code, label, currency, sort) values
  ('AD', 'Andorre', 'EUR', 50),
  ('AE', 'Émirats arabes unis', 'AED', 50),
  ('AF', 'Afghanistan', 'AFN', 50),
  ('AG', 'Antigua-et-Barbuda', 'XCD', 50),
  ('AI', 'Anguilla', 'XCD', 50),
  ('AL', 'Albanie', 'ALL', 50),
  ('AM', 'Arménie', 'AMD', 50),
  ('AO', 'Angola', 'AOA', 50),
  ('AR', 'Argentine', 'ARS', 50),
  ('AS', 'Samoa américaines', 'USD', 50),
  ('AT', 'Autriche', 'EUR', 50),
  ('AU', 'Australie', 'AUD', 50),
  ('AW', 'Aruba', 'AWG', 50),
  ('AX', 'Îles Åland', 'EUR', 50),
  ('AZ', 'Azerbaïdjan', 'AZN', 50),
  ('BA', 'Bosnie-Herzégovine', 'BAM', 50),
  ('BB', 'Barbade', 'BBD', 50),
  ('BD', 'Bangladesh', 'BDT', 50),
  ('BE', 'Belgique', 'EUR', 50),
  ('BF', 'Burkina Faso', 'XOF', 4),
  ('BG', 'Bulgarie', 'BGN', 50),
  ('BH', 'Bahreïn', 'BHD', 50),
  ('BI', 'Burundi', 'BIF', 50),
  ('BJ', 'Bénin', 'XOF', 8),
  ('BL', 'Saint-Barthélemy', 'EUR', 50),
  ('BM', 'Bermudes', 'BMD', 50),
  ('BN', 'Brunei', 'BND', 50),
  ('BO', 'Bolivie', 'BOB', 50),
  ('BQ', 'Pays-Bas caribéens', 'USD', 50),
  ('BR', 'Brésil', 'BRL', 50),
  ('BS', 'Bahamas', 'BSD', 50),
  ('BT', 'Bhoutan', 'BTN', 50),
  ('BW', 'Botswana', 'BWP', 50),
  ('BY', 'Biélorussie', 'BYN', 50),
  ('BZ', 'Belize', 'BZD', 50),
  ('CA', 'Canada', 'CAD', 50),
  ('CC', 'Îles Cocos', 'AUD', 50),
  ('CD', 'Congo-Kinshasa', 'CDF', 50),
  ('CF', 'République centrafricaine', 'XAF', 50),
  ('CG', 'Congo-Brazzaville', 'XAF', 50),
  ('CH', 'Suisse', 'CHF', 50),
  ('CI', 'Côte d’Ivoire', 'XOF', 3),
  ('CK', 'Îles Cook', 'NZD', 50),
  ('CL', 'Chili', 'CLP', 50),
  ('CM', 'Cameroun', 'XAF', 50),
  ('CN', 'Chine', 'CNY', 50),
  ('CO', 'Colombie', 'COP', 50),
  ('CR', 'Costa Rica', 'CRC', 50),
  ('CU', 'Cuba', 'CUP', 50),
  ('CV', 'Cap-Vert', 'CVE', 50),
  ('CW', 'Curaçao', 'ANG', 50),
  ('CX', 'Île Christmas', 'AUD', 50),
  ('CY', 'Chypre', 'EUR', 50),
  ('CZ', 'Tchéquie', 'CZK', 50),
  ('DE', 'Allemagne', 'EUR', 50),
  ('DJ', 'Djibouti', 'DJF', 50),
  ('DK', 'Danemark', 'DKK', 50),
  ('DM', 'Dominique', 'XCD', 50),
  ('DO', 'République dominicaine', 'DOP', 50),
  ('DZ', 'Algérie', 'DZD', 50),
  ('EC', 'Équateur', 'USD', 50),
  ('EE', 'Estonie', 'EUR', 50),
  ('EG', 'Égypte', 'EGP', 50),
  ('EH', 'Sahara occidental', 'MAD', 50),
  ('ER', 'Érythrée', 'ERN', 50),
  ('ES', 'Espagne', 'EUR', 50),
  ('ET', 'Éthiopie', 'ETB', 50),
  ('FI', 'Finlande', 'EUR', 50),
  ('FJ', 'Fidji', 'FJD', 50),
  ('FK', 'Îles Malouines', 'FKP', 50),
  ('FM', 'Micronésie', 'USD', 50),
  ('FO', 'Îles Féroé', 'DKK', 50),
  ('FR', 'France', 'EUR', 50),
  ('GA', 'Gabon', 'XAF', 50),
  ('GB', 'Royaume-Uni', 'GBP', 50),
  ('GD', 'Grenade', 'XCD', 50),
  ('GE', 'Géorgie', 'GEL', 50),
  ('GF', 'Guyane française', 'EUR', 50),
  ('GG', 'Guernesey', 'GBP', 50),
  ('GH', 'Ghana', 'GHS', 50),
  ('GI', 'Gibraltar', 'GIP', 50),
  ('GL', 'Groenland', 'DKK', 50),
  ('GM', 'Gambie', 'GMD', 50),
  ('GN', 'Guinée', 'GNF', 6),
  ('GP', 'Guadeloupe', 'EUR', 50),
  ('GQ', 'Guinée équatoriale', 'XAF', 50),
  ('GR', 'Grèce', 'EUR', 50),
  ('GT', 'Guatemala', 'GTQ', 50),
  ('GU', 'Guam', 'USD', 50),
  ('GW', 'Guinée-Bissau', 'XOF', 50),
  ('GY', 'Guyana', 'GYD', 50),
  ('HK', 'R.A.S. chinoise de Hong Kong', 'HKD', 50),
  ('HN', 'Honduras', 'HNL', 50),
  ('HR', 'Croatie', 'EUR', 50),
  ('HT', 'Haïti', 'HTG', 50),
  ('HU', 'Hongrie', 'HUF', 50),
  ('ID', 'Indonésie', 'IDR', 50),
  ('IE', 'Irlande', 'EUR', 50),
  ('IL', 'Israël', 'ILS', 50),
  ('IM', 'Île de Man', 'GBP', 50),
  ('IN', 'Inde', 'INR', 50),
  ('IQ', 'Irak', 'IQD', 50),
  ('IR', 'Iran', 'IRR', 50),
  ('IS', 'Islande', 'ISK', 50),
  ('IT', 'Italie', 'EUR', 50),
  ('JE', 'Jersey', 'GBP', 50),
  ('JM', 'Jamaïque', 'JMD', 50),
  ('JO', 'Jordanie', 'JOD', 50),
  ('JP', 'Japon', 'JPY', 50),
  ('KE', 'Kenya', 'KES', 50),
  ('KG', 'Kirghizstan', 'KGS', 50),
  ('KH', 'Cambodge', 'KHR', 50),
  ('KI', 'Kiribati', 'AUD', 50),
  ('KM', 'Comores', 'KMF', 50),
  ('KN', 'Saint-Christophe-et-Niévès', 'XCD', 50),
  ('KP', 'Corée du Nord', 'KPW', 50),
  ('KR', 'Corée du Sud', 'KRW', 50),
  ('KW', 'Koweït', 'KWD', 50),
  ('KY', 'Îles Caïmans', 'KYD', 50),
  ('KZ', 'Kazakhstan', 'KZT', 50),
  ('LA', 'Laos', 'LAK', 50),
  ('LB', 'Liban', 'LBP', 50),
  ('LC', 'Sainte-Lucie', 'XCD', 50),
  ('LI', 'Liechtenstein', 'CHF', 50),
  ('LK', 'Sri Lanka', 'LKR', 50),
  ('LR', 'Liberia', 'LRD', 50),
  ('LS', 'Lesotho', 'LSL', 50),
  ('LT', 'Lituanie', 'EUR', 50),
  ('LU', 'Luxembourg', 'EUR', 50),
  ('LV', 'Lettonie', 'EUR', 50),
  ('LY', 'Libye', 'LYD', 50),
  ('MA', 'Maroc', 'MAD', 50),
  ('MC', 'Monaco', 'EUR', 50),
  ('MD', 'Moldavie', 'MDL', 50),
  ('ME', 'Monténégro', 'EUR', 50),
  ('MF', 'Saint-Martin', 'EUR', 50),
  ('MG', 'Madagascar', 'MGA', 50),
  ('MH', 'Îles Marshall', 'USD', 50),
  ('MK', 'Macédoine du Nord', 'MKD', 50),
  ('ML', 'Mali', 'XOF', 1),
  ('MM', 'Myanmar (Birmanie)', 'MMK', 50),
  ('MN', 'Mongolie', 'MNT', 50),
  ('MO', 'R.A.S. chinoise de Macao', 'MOP', 50),
  ('MP', 'Îles Mariannes du Nord', 'USD', 50),
  ('MQ', 'Martinique', 'EUR', 50),
  ('MR', 'Mauritanie', 'MRU', 50),
  ('MS', 'Montserrat', 'XCD', 50),
  ('MT', 'Malte', 'EUR', 50),
  ('MU', 'Maurice', 'MUR', 50),
  ('MV', 'Maldives', 'MVR', 50),
  ('MW', 'Malawi', 'MWK', 50),
  ('MX', 'Mexique', 'MXN', 50),
  ('MY', 'Malaisie', 'MYR', 50),
  ('MZ', 'Mozambique', 'MZN', 50),
  ('NA', 'Namibie', 'NAD', 50),
  ('NC', 'Nouvelle-Calédonie', 'XPF', 50),
  ('NE', 'Niger', 'XOF', 5),
  ('NF', 'Île Norfolk', 'AUD', 50),
  ('NG', 'Nigeria', 'NGN', 50),
  ('NI', 'Nicaragua', 'NIO', 50),
  ('NL', 'Pays-Bas', 'EUR', 50),
  ('NO', 'Norvège', 'NOK', 50),
  ('NP', 'Népal', 'NPR', 50),
  ('NR', 'Nauru', 'AUD', 50),
  ('NU', 'Niue', 'NZD', 50),
  ('NZ', 'Nouvelle-Zélande', 'NZD', 50),
  ('OM', 'Oman', 'OMR', 50),
  ('PA', 'Panama', 'PAB', 50),
  ('PE', 'Pérou', 'PEN', 50),
  ('PF', 'Polynésie française', 'XPF', 50),
  ('PG', 'Papouasie-Nouvelle-Guinée', 'PGK', 50),
  ('PH', 'Philippines', 'PHP', 50),
  ('PK', 'Pakistan', 'PKR', 50),
  ('PL', 'Pologne', 'PLN', 50),
  ('PM', 'Saint-Pierre-et-Miquelon', 'EUR', 50),
  ('PN', 'Îles Pitcairn', 'NZD', 50),
  ('PR', 'Porto Rico', 'USD', 50),
  ('PS', 'Territoires palestiniens', 'ILS', 50),
  ('PT', 'Portugal', 'EUR', 50),
  ('PW', 'Palaos', 'USD', 50),
  ('PY', 'Paraguay', 'PYG', 50),
  ('QA', 'Qatar', 'QAR', 50),
  ('RE', 'La Réunion', 'EUR', 50),
  ('RO', 'Roumanie', 'RON', 50),
  ('RS', 'Serbie', 'RSD', 50),
  ('RU', 'Russie', 'RUB', 50),
  ('RW', 'Rwanda', 'RWF', 50),
  ('SA', 'Arabie saoudite', 'SAR', 50),
  ('SB', 'Îles Salomon', 'SBD', 50),
  ('SC', 'Seychelles', 'SCR', 50),
  ('SD', 'Soudan', 'SDG', 50),
  ('SE', 'Suède', 'SEK', 50),
  ('SG', 'Singapour', 'SGD', 50),
  ('SH', 'Sainte-Hélène', 'SHP', 50),
  ('SI', 'Slovénie', 'EUR', 50),
  ('SK', 'Slovaquie', 'EUR', 50),
  ('SL', 'Sierra Leone', 'SLE', 50),
  ('SM', 'Saint-Marin', 'EUR', 50),
  ('SN', 'Sénégal', 'XOF', 2),
  ('SO', 'Somalie', 'SOS', 50),
  ('SR', 'Suriname', 'SRD', 50),
  ('SS', 'Soudan du Sud', 'SSP', 50),
  ('ST', 'Sao Tomé-et-Principe', 'STN', 50),
  ('SV', 'Salvador', 'USD', 50),
  ('SX', 'Saint-Martin (partie néerlandaise)', 'ANG', 50),
  ('SY', 'Syrie', 'SYP', 50),
  ('SZ', 'Eswatini', 'SZL', 50),
  ('TC', 'Îles Turques-et-Caïques', 'USD', 50),
  ('TD', 'Tchad', 'XAF', 50),
  ('TG', 'Togo', 'XOF', 7),
  ('TH', 'Thaïlande', 'THB', 50),
  ('TJ', 'Tadjikistan', 'TJS', 50),
  ('TK', 'Tokelau', 'NZD', 50),
  ('TL', 'Timor oriental', 'USD', 50),
  ('TM', 'Turkménistan', 'TMT', 50),
  ('TN', 'Tunisie', 'TND', 50),
  ('TO', 'Tonga', 'TOP', 50),
  ('TR', 'Turquie', 'TRY', 50),
  ('TT', 'Trinité-et-Tobago', 'TTD', 50),
  ('TV', 'Tuvalu', 'AUD', 50),
  ('TW', 'Taïwan', 'TWD', 50),
  ('TZ', 'Tanzanie', 'TZS', 50),
  ('UA', 'Ukraine', 'UAH', 50),
  ('UG', 'Ouganda', 'UGX', 50),
  ('US', 'États-Unis', 'USD', 50),
  ('UY', 'Uruguay', 'UYU', 50),
  ('UZ', 'Ouzbékistan', 'UZS', 50),
  ('VA', 'État de la Cité du Vatican', 'EUR', 50),
  ('VC', 'Saint-Vincent-et-les Grenadines', 'XCD', 50),
  ('VE', 'Venezuela', 'VES', 50),
  ('VG', 'Îles Vierges britanniques', 'USD', 50),
  ('VI', 'Îles Vierges des États-Unis', 'USD', 50),
  ('VN', 'Viêt Nam', 'VND', 50),
  ('VU', 'Vanuatu', 'VUV', 50),
  ('WF', 'Wallis-et-Futuna', 'XPF', 50),
  ('WS', 'Samoa', 'WST', 50),
  ('XK', 'Kosovo', 'EUR', 50),
  ('YE', 'Yémen', 'YER', 50),
  ('YT', 'Mayotte', 'EUR', 50),
  ('ZA', 'Afrique du Sud', 'ZAR', 50),
  ('ZM', 'Zambie', 'ZMW', 50),
  ('ZW', 'Zimbabwe', 'ZWL', 50),
  ('XX', 'Autre pays', 'XOF', 99)
on conflict (code) do update set currency = excluded.currency;

-- ───────────────────────────── Prix par devise ─────────────────────────────

create table if not exists public.gm_plan_prices (
  plan_code   text    not null references public.gm_plans(code) on delete cascade,
  currency    text    not null check (currency ~ '^[A-Z]{3}$' and currency not in ('XOF', 'XAF')),
  price_month integer not null check (price_month >= 0),
  primary key (plan_code, currency)
);
alter table public.gm_plan_prices enable row level security;
drop policy if exists "gm lecture publique" on public.gm_plan_prices;
create policy "gm lecture publique" on public.gm_plan_prices for select to anon, authenticated using (true);

-- Prix de départ (modifiables) : arrondis à partir des prix en FCFA.
insert into public.gm_plan_prices (plan_code, currency, price_month) values
  ('free', 'GNF', 0), ('starter', 'GNF', 75000), ('pro', 'GNF', 270000), ('business', 'GNF', 750000),
  ('free', 'EUR', 0), ('starter', 'EUR', 8),     ('pro', 'EUR', 28),     ('business', 'EUR', 76),
  ('free', 'USD', 0), ('starter', 'USD', 9),     ('pro', 'USD', 32),     ('business', 'USD', 88)
on conflict (plan_code, currency) do nothing;

-- Prix mensuel d'une formule dans une devise (null si Eden Dev ne l'a pas fixé).
create or replace function public.gm_plan_price(p_plan text, p_currency text)
returns integer
language sql
stable
set search_path = public
as $$
  select case when upper(p_currency) in ('XOF', 'XAF') then (select price_month from public.gm_plans where code = p_plan)
              else (select price_month from public.gm_plan_prices where plan_code = p_plan and currency = upper(p_currency)) end
$$;

alter table public.gm_payments add column if not exists currency text not null default 'XOF';
insert into public.gm_config (key, value) values ('card_currencies', 'XOF') on conflict (key) do nothing;

-- ───────────────────────────── Fonctions mises à jour ─────────────────────────────

-- Formulaire d'inscription, formules (prix par devise) et moyens de paiement (sans connexion).
create or replace function public.gm_public_options()
returns jsonb
language sql
stable
set search_path = public
as $$
  select jsonb_build_object(
    'shop_types', (select coalesce(jsonb_agg(jsonb_build_object('code', code, 'label', label) order by sort, label), '[]'::jsonb) from public.gm_shop_types),
    'countries', (select coalesce(jsonb_agg(jsonb_build_object('code', code, 'label', label, 'currency', currency) order by sort, label), '[]'::jsonb) from public.gm_countries),
    'plans', (select coalesce(jsonb_agg(jsonb_build_object('code', p.code, 'label', p.label, 'price_month', p.price_month, 'max_postes', p.max_postes,
                                                          'features', to_jsonb(p.features), 'description', p.description,
                                                          'prices', jsonb_build_object('XOF', p.price_month, 'XAF', p.price_month)
                                                                    || coalesce((select jsonb_object_agg(pp.currency, pp.price_month) from public.gm_plan_prices pp
                                                                                 where pp.plan_code = p.code), '{}'::jsonb))
                                       order by p.sort), '[]'::jsonb)
              from public.gm_plans p where p.active),
    'payment_instructions', coalesce((select value from public.gm_config where key = 'payment_instructions'), ''),
    'trial_days', coalesce((select value from public.gm_config where key = 'trial_days'), '0')::int,
    'payment', jsonb_build_object(
      'om_merchant_code', coalesce((select value from public.gm_config where key = 'om_merchant_code'), ''),
      'om_merchant_name', coalesce((select value from public.gm_config where key = 'om_merchant_name'), ''),
      'om_qr_payload', coalesce((select value from public.gm_config where key = 'om_qr_payload'), ''),
      'card_enabled', coalesce((select value from public.gm_config where key = 'card_enabled'), 'false') = 'true',
      'card_currency', upper(coalesce((select value from public.gm_config where key = 'card_currency'), 'XOF')),
      'card_currencies', to_jsonb(string_to_array(replace(upper(coalesce((select value from public.gm_config where key = 'card_currencies'), 'XOF')), ' ', ''), ','))
    )
  )
$$;

-- Derniers paiements de la boutique d'un PC (avec leur devise).
create or replace function public.gm_pc_payments(p_pc_id text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', p.id, 'created_at', p.created_at, 'method', p.method, 'plan', x.plan_code, 'plan_label', pl.label,
           'months', x.months, 'amount', p.amount, 'currency', p.currency, 'status', p.status, 'note', p.note,
           'starts_at', x.starts_at, 'ends_at', x.ends_at,
           'abandoned', p.status = 'pending' and p.created_at < now() - interval '2 hours'
         ) order by p.created_at desc), '[]'::jsonb)
  from (
    select * from public.gm_payments
    where store_id = (select store_id from public.gm_store_pcs
                      where pc_id = upper(regexp_replace(coalesce(p_pc_id, ''), '[^0-9A-Za-z]', '', 'g')))
    order by created_at desc limit 12
  ) p
  join public.gm_subscriptions x on x.id = p.subscription_id
  join public.gm_plans pl on pl.code = x.plan_code
$$;

-- Début d'un paiement par carte Visa : dans la devise de la boutique si Cybersource l'accepte.
create or replace function public.gm_card_start(p_pc_id text, p_plan text, p_months int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_store  public.gm_stores := public.gm_pc_store(p_pc_id);
  v_plan   public.gm_plans;
  v_sub    uuid;
  v_pay    uuid;
  v_cur    text := upper(coalesce((select value from public.gm_config where key = 'card_currency'), 'XOF'));
  v_local  text;
  v_price  int;
  v_amount int;
begin
  if coalesce((select value from public.gm_config where key = 'card_enabled'), 'false') <> 'true' then
    raise exception 'Le paiement par carte Visa n''est pas encore ouvert : utilisez une carte de bon ou Orange Money.';
  end if;
  select * into v_plan from public.gm_plans where code = p_plan and active and code <> 'free';
  if not found then
    raise exception 'Formule inconnue.';
  end if;
  if p_months is null or p_months not in (1, 3, 6) then
    raise exception 'Durée invalide : 1, 3 ou 6 mois.';
  end if;
  if (select count(*) from public.gm_payments where store_id = v_store.id and method = 'carte_visa'
      and status = 'pending' and created_at > now() - interval '1 hour') >= 5 then
    raise exception 'Trop de paiements par carte commencés : réessayez dans une heure.';
  end if;

  v_price := public.gm_plan_price(v_plan.code, v_cur);
  v_local := (select c.currency from public.gm_countries c where c.code = v_store.country);
  if v_local is not null and v_local <> v_cur
     and v_local = any (string_to_array(replace(upper(coalesce((select value from public.gm_config where key = 'card_currencies'), '')), ' ', ''), ','))
     and coalesce(public.gm_plan_price(v_plan.code, v_local), 0) > 0 then
    v_cur := v_local;
    v_price := public.gm_plan_price(v_plan.code, v_local);
  end if;
  if coalesce(v_price, 0) <= 0 then
    raise exception 'Prix de la formule non défini pour la carte Visa : contactez Eden Dev.';
  end if;
  v_amount := v_price * p_months;

  insert into public.gm_subscriptions (store_id, plan_code, months, status, source)
  values (v_store.id, v_plan.code, p_months, 'pending', 'payment')
  returning id into v_sub;
  insert into public.gm_payments (store_id, subscription_id, amount, currency, method, status)
  values (v_store.id, v_sub, v_amount, v_cur, 'carte_visa', 'pending')
  returning id into v_pay;
  return jsonb_build_object(
    'payment_id', v_pay, 'amount', v_amount, 'plan_label', v_plan.label, 'months', p_months, 'currency', v_cur,
    'store', jsonb_build_object('code', v_store.code, 'name', v_store.name, 'owner_name', v_store.owner_name, 'email', v_store.email,
                                'phone', v_store.phone, 'country', v_store.country, 'city', v_store.city, 'address', v_store.address)
  );
end;
$$;

-- Résultat signé envoyé par Cybersource (vérifié par « gm-pay ») : montant et devise du paiement.
create or replace function public.gm_card_result(p_payment_id uuid, p_decision text, p_amount numeric, p_currency text,
                                                 p_transaction_id text, p_message text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pay public.gm_payments;
  v_msg text := left(coalesce(p_message, ''), 200);
begin
  select * into v_pay from public.gm_payments where id = p_payment_id for update;
  if not found or v_pay.method <> 'carte_visa' then
    return jsonb_build_object('ok', false, 'error', 'Paiement inconnu.');
  end if;
  if v_pay.status <> 'pending' then
    return jsonb_build_object('ok', true, 'status', v_pay.status);   -- notification répétée
  end if;
  update public.gm_payments set provider_ref = left(coalesce(p_transaction_id, ''), 80), reference = left(coalesce(p_transaction_id, ''), 80)
   where id = v_pay.id;
  if upper(p_decision) = 'ACCEPT' and p_amount = v_pay.amount and upper(coalesce(p_currency, '')) = upper(v_pay.currency) then
    update public.gm_payments set status = 'validated', note = 'Carte Visa acceptée (Cybersource)' where id = v_pay.id;
  elsif upper(p_decision) in ('ACCEPT', 'REVIEW') then
    update public.gm_payments set status = 'declared',
           note = case when upper(p_decision) = 'REVIEW' then 'Carte Visa : paiement en vérification chez Cybersource. '
                       else 'Carte Visa : montant ou devise inattendus, à vérifier. ' end || v_msg
     where id = v_pay.id;
  else
    update public.gm_payments set status = 'refused', note = 'Carte Visa refusée ou annulée : ' || v_msg where id = v_pay.id;
  end if;
  return jsonb_build_object('ok', true, 'status', (select status from public.gm_payments where id = v_pay.id));
end;
$$;

revoke all on function public.gm_card_start(text, text, int) from public, anon, authenticated;
grant execute on function public.gm_card_start(text, text, int) to service_role;
revoke all on function public.gm_card_result(uuid, text, numeric, text, text, text) from public, anon, authenticated;
grant execute on function public.gm_card_result(uuid, text, numeric, text, text, text) to service_role;
