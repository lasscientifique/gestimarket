-- ═══════════════════════════════════════════════════════════════════════════
-- GestiMarket — comptes boutique, abonnements et licences (Eden Dev)
-- À exécuter une fois dans Supabase : SQL Editor → New query → coller → Run (réexécutable).
--
-- Supabase ne contient AUCUNE donnée commerciale (ventes, produits, stocks, clients).
--  1. La propriétaire crée son compte (Supabase Auth : e-mail + mot de passe) puis sa boutique
--     (5 au maximum par compte) : code GM-000001, 14 jours d'essai PRO.
--  2. Chaque PC (et chaque boutique d'un même PC) est rattaché à sa boutique par son identifiant.
--  3. La propriétaire déclare un paiement (référence de la transaction Orange Money, Moov…).
--  4. Eden Dev le valide dans le tableau de bord : table gm_payments, colonne status → validated.
--     L'abonnement est prolongé automatiquement (à la suite de la période en cours).
--  5. La fonction Edge « gm-license » signe la licence (Ed25519) et la dépose dans le bucket public
--     « licences » ; GestiMarket la télécharge à l'adresse licences/<identifiant du PC>.gml.
--
-- Lecture directe des tables : seulement ses propres lignes (RLS). Toute écriture passe par les
-- fonctions ci-dessous ; valider un paiement, suspendre une boutique ou révoquer une licence
-- est réservé à Eden Dev (tableau de bord Supabase).
-- ═══════════════════════════════════════════════════════════════════════════

-- ───────────────────────────── Listes de référence ─────────────────────────────

create sequence if not exists public.gm_store_seq;

create table if not exists public.gm_shop_types (
  code  text primary key,
  label text not null,
  sort  int  not null default 0
);

create table if not exists public.gm_countries (
  code     text primary key,
  label    text not null,
  currency text not null default 'FCFA',   -- devise proposée à la première configuration
  sort     int  not null default 0
);

-- Formules : les prix sont modifiables ici (FCFA par mois) ; les fonctions sont lues par la licence.
--   write            ventes et modifications (sans elle : lecture seule)
--   server           mode serveur : autres PC, téléphones et tablettes
--   internet         accès par Internet (tunnel Cloudflare)
--   customer_display écran client
--   logo             logo personnalisé
create table if not exists public.gm_plans (
  code        text primary key check (code in ('free', 'starter', 'pro', 'business')),
  label       text    not null,
  price_month integer not null check (price_month >= 0),
  max_postes  integer not null check (max_postes >= 1),
  features    text[]  not null default '{}',
  description text    not null default '',
  sort        int     not null default 0,
  active      boolean not null default true
);

-- Paramètres publics (lisibles par l'application) : instructions de paiement, essai, clé publique.
create table if not exists public.gm_config (
  key   text primary key,
  value text not null
);

-- Mêmes codes que les types de commerce de l'application (voir gestimarket_types_commerce.sql).
insert into public.gm_shop_types (code, label, sort) values
  ('boutique', 'Boutique de quartier', 1),
  ('general', 'Magasin de commerce général', 2),
  ('supermarket', 'Supermarché / hypermarché', 3),
  ('superette', 'Supérette', 4),
  ('wholesale', 'Grossiste / demi-grossiste', 5),
  ('pharmacy', 'Pharmacie / parapharmacie', 6),
  ('fashion', 'Vêtements et chaussures', 7),
  ('hardware', 'Quincaillerie', 8),
  ('building', 'Matériaux de construction', 9),
  ('electronics', 'Électronique / électroménager', 10),
  ('phones', 'Téléphonie et accessoires', 11),
  ('bakery', 'Boulangerie / pâtisserie', 12),
  ('butcher', 'Boucherie / poissonnerie', 13),
  ('greengrocer', 'Fruits et légumes', 14),
  ('cosmetics', 'Cosmétiques / parfumerie', 15),
  ('bookshop', 'Librairie / papeterie', 16),
  ('autoparts', 'Pièces auto / moto', 17),
  ('agrovet', 'Agro-vétérinaire / animalerie', 18),
  ('bar', 'Bar / maquis / café', 19),
  ('kiosk', 'Kiosque / boutique de station-service', 20),
  ('restaurant', 'Restaurant / fast-food', 21),
  ('specialty', 'Boutique spécialisée / autre', 99)
on conflict (code) do nothing;

insert into public.gm_countries (code, label, currency, sort) values
  ('ML', 'Mali', 'FCFA', 1),
  ('SN', 'Sénégal', 'FCFA', 2),
  ('CI', 'Côte d''Ivoire', 'FCFA', 3),
  ('BF', 'Burkina Faso', 'FCFA', 4),
  ('NE', 'Niger', 'FCFA', 5),
  ('GN', 'Guinée', 'GNF', 6),
  ('TG', 'Togo', 'FCFA', 7),
  ('BJ', 'Bénin', 'FCFA', 8),
  ('XX', 'Autre pays', 'FCFA', 99)
on conflict (code) do nothing;

insert into public.gm_plans (code, label, price_month, max_postes, features, description, sort) values
  ('free', 'FREE', 0, 1, '{}', 'Consultation uniquement : aucune vente ni modification.', 1),
  ('starter', 'STARTER', 5000, 1, '{write}', '1 poste : ordinateur seul, sans Internet obligatoire.', 2),
  ('pro', 'PRO', 18000, 3, '{write,server,internet,customer_display,logo}',
   '3 postes : ordinateurs, téléphones et tablettes, réseau local et Internet, écran client, logo.', 3),
  ('business', 'BUSINESS', 50000, 10, '{write,server,internet,customer_display,logo}',
   'Postes selon le contrat, toutes les fonctions.', 4)
on conflict (code) do nothing;

insert into public.gm_config (key, value) values
  ('payment_instructions',
   'Payez par Orange Money ou Moov Money au numéro communiqué par Eden Dev, puis saisissez ici la référence de la transaction (reçue par SMS). La licence est mise à jour dès la validation du paiement.'),
  ('trial_days', '14'),
  ('trial_plan', 'pro')
on conflict (key) do nothing;

-- ───────────────────────────── Boutiques, PC, abonnements ─────────────────────────────

create table if not exists public.gm_stores (
  id         uuid primary key default gen_random_uuid(),
  code       text not null unique default ('GM-' || lpad(nextval('public.gm_store_seq')::text, 6, '0')),
  owner_id   uuid not null references auth.users(id) on delete restrict,
  name       text not null,
  owner_name text not null,
  email      text not null,
  phone      text not null default '',
  country    text not null references public.gm_countries(code),
  city       text not null,
  address    text not null,
  shop_type  text not null references public.gm_shop_types(code),
  status     text not null default 'active' check (status in ('active', 'suspended')),
  created_at timestamptz not null default now()
);
create index if not exists gm_stores_owner on public.gm_stores(owner_id);

-- Identifiant d'un PC : 12 caractères calculés par GestiMarket (PC + numéro de boutique sur ce PC).
create table if not exists public.gm_store_pcs (
  id            uuid primary key default gen_random_uuid(),
  store_id      uuid not null references public.gm_stores(id) on delete cascade,
  pc_id         text not null unique check (pc_id ~ '^[0-9A-Z]{12}$'),
  slot          smallint not null default 1,
  hostname      text not null default '',
  app_version   text not null default '',
  registered_at timestamptz not null default now(),
  last_seen     timestamptz
);
create index if not exists gm_store_pcs_store on public.gm_store_pcs(store_id);

create table if not exists public.gm_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  store_id   uuid not null references public.gm_stores(id) on delete cascade,
  plan_code  text not null references public.gm_plans(code),
  months     smallint check (months in (1, 3, 6)),
  max_postes integer check (max_postes >= 1),   -- BUSINESS : postes du contrat (sinon ceux de la formule)
  status     text not null default 'pending' check (status in ('pending', 'active', 'cancelled')),
  source     text not null default 'payment' check (source in ('trial', 'payment', 'manual')),
  starts_at  timestamptz,
  ends_at    timestamptz,                         -- exclu : la licence n'est plus valable à cet instant
  created_at timestamptz not null default now(),
  check (status <> 'active' or (starts_at is not null and ends_at > starts_at))
);
create index if not exists gm_subscriptions_store on public.gm_subscriptions(store_id, status);

create table if not exists public.gm_payments (
  id              uuid primary key default gen_random_uuid(),
  store_id        uuid not null references public.gm_stores(id) on delete cascade,
  subscription_id uuid not null unique references public.gm_subscriptions(id) on delete cascade,
  amount          integer not null check (amount >= 0),
  method          text not null check (method in ('orange_money', 'moov_money', 'virement', 'especes', 'autre')),
  reference       text not null default '',
  payer_phone     text not null default '',
  status          text not null default 'declared' check (status in ('declared', 'validated', 'refused')),
  note            text not null default '',
  validated_at    timestamptz,
  created_at      timestamptz not null default now()
);
create index if not exists gm_payments_store on public.gm_payments(store_id, status);

create table if not exists public.gm_licenses (
  id              uuid primary key,                 -- identifiant inscrit dans le fichier signé
  store_id        uuid not null references public.gm_stores(id) on delete cascade,
  pc_id           text not null,
  subscription_id uuid references public.gm_subscriptions(id) on delete set null,
  plan_code       text not null,
  max_postes      integer not null,
  features        text[] not null,
  starts_at       timestamptz not null,
  expires_at      timestamptz not null,
  issued_at       timestamptz not null default now(),
  kid             integer not null,
  file_path       text not null,
  status          text not null default 'valid' check (status in ('valid', 'replaced', 'revoked'))
);
create index if not exists gm_licenses_pc on public.gm_licenses(pc_id, status);

create table if not exists public.gm_license_events (
  id         bigint generated always as identity primary key,
  store_id   uuid references public.gm_stores(id) on delete cascade,
  kind       text not null,
  detail     jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists gm_license_events_store on public.gm_license_events(store_id, created_at);

-- ───────────────────────────── Droits de lecture (RLS) ─────────────────────────────

alter table public.gm_shop_types     enable row level security;
alter table public.gm_countries      enable row level security;
alter table public.gm_plans          enable row level security;
alter table public.gm_config         enable row level security;
alter table public.gm_stores         enable row level security;
alter table public.gm_store_pcs      enable row level security;
alter table public.gm_subscriptions  enable row level security;
alter table public.gm_payments       enable row level security;
alter table public.gm_licenses       enable row level security;
alter table public.gm_license_events enable row level security;   -- aucune politique : interne

drop policy if exists "gm lecture publique" on public.gm_shop_types;
create policy "gm lecture publique" on public.gm_shop_types for select to anon, authenticated using (true);
drop policy if exists "gm lecture publique" on public.gm_countries;
create policy "gm lecture publique" on public.gm_countries for select to anon, authenticated using (true);
drop policy if exists "gm lecture publique" on public.gm_plans;
create policy "gm lecture publique" on public.gm_plans for select to anon, authenticated using (active);
drop policy if exists "gm lecture publique" on public.gm_config;
create policy "gm lecture publique" on public.gm_config for select to anon, authenticated using (true);

drop policy if exists "gm mes boutiques" on public.gm_stores;
create policy "gm mes boutiques" on public.gm_stores for select to authenticated
  using (owner_id = (select auth.uid()));
drop policy if exists "gm mes PC" on public.gm_store_pcs;
create policy "gm mes PC" on public.gm_store_pcs for select to authenticated
  using (exists (select 1 from public.gm_stores s where s.id = store_id and s.owner_id = (select auth.uid())));
drop policy if exists "gm mes abonnements" on public.gm_subscriptions;
create policy "gm mes abonnements" on public.gm_subscriptions for select to authenticated
  using (exists (select 1 from public.gm_stores s where s.id = store_id and s.owner_id = (select auth.uid())));
drop policy if exists "gm mes paiements" on public.gm_payments;
create policy "gm mes paiements" on public.gm_payments for select to authenticated
  using (exists (select 1 from public.gm_stores s where s.id = store_id and s.owner_id = (select auth.uid())));
drop policy if exists "gm mes licences" on public.gm_licenses;
create policy "gm mes licences" on public.gm_licenses for select to authenticated
  using (exists (select 1 from public.gm_stores s where s.id = store_id and s.owner_id = (select auth.uid())));

-- ───────────────────────────── Fonctions de l'application ─────────────────────────────

-- Listes du formulaire d'inscription et formules (sans connexion).
create or replace function public.gm_public_options()
returns jsonb
language sql
stable
set search_path = public
as $$
  select jsonb_build_object(
    'shop_types', (select coalesce(jsonb_agg(jsonb_build_object('code', code, 'label', label) order by sort, label), '[]'::jsonb) from public.gm_shop_types),
    'countries', (select coalesce(jsonb_agg(jsonb_build_object('code', code, 'label', label, 'currency', currency) order by sort, label), '[]'::jsonb) from public.gm_countries),
    'plans', (select coalesce(jsonb_agg(jsonb_build_object('code', code, 'label', label, 'price_month', price_month, 'max_postes', max_postes,
                                                          'features', to_jsonb(features), 'description', description) order by sort), '[]'::jsonb)
              from public.gm_plans where active),
    'payment_instructions', coalesce((select value from public.gm_config where key = 'payment_instructions'), ''),
    'trial_days', coalesce((select value from public.gm_config where key = 'trial_days'), '0')::int
  )
$$;

-- Résumé d'une boutique (formule en cours).
create or replace function public.gm_store_json(p_store_id uuid)
returns jsonb
language sql
stable
set search_path = public
as $$
  select jsonb_build_object(
    'code', s.code, 'name', s.name, 'owner_name', s.owner_name, 'email', s.email, 'phone', s.phone,
    'country', s.country, 'city', s.city, 'address', s.address, 'shop_type', s.shop_type, 'status', s.status,
    'currency', (select c.currency from public.gm_countries c where c.code = s.country),
    'plan', cur.plan_code, 'plan_label', p.label, 'ends_at', cur.ends_at, 'trial', cur.source = 'trial',
    'pcs', (select count(*) from public.gm_store_pcs pc where pc.store_id = s.id)
  )
  from public.gm_stores s
  left join lateral (
    select * from public.gm_subscriptions x
    where x.store_id = s.id and x.status = 'active' and x.starts_at <= now() and x.ends_at > now()
    order by x.starts_at desc limit 1
  ) cur on true
  left join public.gm_plans p on p.code = cur.plan_code
  where s.id = p_store_id
$$;

-- Création d'une boutique par la propriétaire connectée (essai offert).
create or replace function public.gm_register_store(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_email text;
  v_store public.gm_stores;
  v_days  int  := coalesce((select value from public.gm_config where key = 'trial_days'), '0')::int;
  v_trial text := coalesce((select value from public.gm_config where key = 'trial_plan'), 'pro');
  f       text;
begin
  if v_uid is null then
    raise exception 'Connectez-vous à votre compte boutique.';
  end if;
  if (select count(*) from public.gm_stores where owner_id = v_uid) >= 5 then
    raise exception '5 boutiques au maximum par compte.';
  end if;
  foreach f in array array['name', 'owner_name', 'country', 'city', 'address', 'shop_type'] loop
    if coalesce(trim(p ->> f), '') = '' then
      raise exception 'Champ obligatoire manquant : %', case f
        when 'name' then 'nom de la boutique' when 'owner_name' then 'nom complet de la propriétaire'
        when 'country' then 'pays' when 'city' then 'ville' when 'address' then 'adresse' else 'type de boutique' end;
    end if;
  end loop;
  if not exists (select 1 from public.gm_countries where code = p ->> 'country') then
    raise exception 'Pays inconnu.';
  end if;
  if not exists (select 1 from public.gm_shop_types where code = p ->> 'shop_type') then
    raise exception 'Type de boutique inconnu.';
  end if;
  select email into v_email from auth.users where id = v_uid;

  insert into public.gm_stores (owner_id, name, owner_name, email, phone, country, city, address, shop_type)
  values (v_uid, left(trim(p ->> 'name'), 120), left(trim(p ->> 'owner_name'), 120), coalesce(v_email, ''),
          left(trim(coalesce(p ->> 'phone', '')), 40), p ->> 'country', left(trim(p ->> 'city'), 80),
          left(trim(p ->> 'address'), 200), p ->> 'shop_type')
  returning * into v_store;

  if v_days > 0 then
    insert into public.gm_subscriptions (store_id, plan_code, status, source, starts_at, ends_at)
    values (v_store.id, v_trial, 'active', 'trial', now(), now() + make_interval(days => v_days));
  end if;
  insert into public.gm_license_events (store_id, kind, detail)
  values (v_store.id, 'store_created', jsonb_build_object('trial_days', v_days, 'trial_plan', v_trial));
  return public.gm_store_json(v_store.id);
end;
$$;

-- Boutiques de la propriétaire connectée.
create or replace function public.gm_my_stores()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(public.gm_store_json(s.id) order by s.created_at), '[]'::jsonb)
  from public.gm_stores s
  where s.owner_id = auth.uid()
$$;

-- Rattache ce PC (et ce numéro de boutique sur le PC) à une boutique de la propriétaire.
create or replace function public.gm_register_pc(p_store_code text, p_pc_id text, p_slot int, p_hostname text, p_version text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_store public.gm_stores;
  v_pc    public.gm_store_pcs;
  v_pc_id text := upper(regexp_replace(coalesce(p_pc_id, ''), '[^0-9A-Za-z]', '', 'g'));
begin
  if v_uid is null then
    raise exception 'Connectez-vous à votre compte boutique.';
  end if;
  select * into v_store from public.gm_stores where code = upper(trim(p_store_code)) and owner_id = v_uid;
  if not found then
    raise exception 'Boutique introuvable sur ce compte.';
  end if;
  if v_store.status <> 'active' then
    raise exception 'Cette boutique est suspendue : contactez Eden Dev.';
  end if;
  if v_pc_id !~ '^[0-9A-Z]{12}$' then
    raise exception 'Identifiant de PC invalide.';
  end if;
  select * into v_pc from public.gm_store_pcs where pc_id = v_pc_id;
  if found and v_pc.store_id <> v_store.id
     and not exists (select 1 from public.gm_stores where id = v_pc.store_id and owner_id = v_uid) then
    raise exception 'Ce PC est déjà rattaché à la boutique d''un autre compte.';
  end if;

  insert into public.gm_store_pcs (store_id, pc_id, slot, hostname, app_version, last_seen)
  values (v_store.id, v_pc_id, greatest(1, least(coalesce(p_slot, 1), 5)), left(coalesce(p_hostname, ''), 80), left(coalesce(p_version, ''), 20), now())
  on conflict (pc_id) do update set
    store_id = excluded.store_id, slot = excluded.slot, hostname = excluded.hostname,
    app_version = excluded.app_version, last_seen = now();
  -- Le PC change de boutique : son ancienne licence ne vaut plus.
  update public.gm_licenses set status = 'replaced' where pc_id = v_pc_id and status = 'valid' and store_id <> v_store.id;
  insert into public.gm_license_events (store_id, kind, detail)
  values (v_store.id, 'pc_registered', jsonb_build_object('pc_id', v_pc_id, 'hostname', p_hostname, 'slot', p_slot));
  return public.gm_store_json(v_store.id);
end;
$$;

-- Déclaration d'un paiement : abonnement en attente, validé ensuite par Eden Dev.
create or replace function public.gm_declare_payment(p_store_code text, p_plan text, p_months int, p_method text, p_reference text, p_payer_phone text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_store  public.gm_stores;
  v_plan   public.gm_plans;
  v_sub    uuid;
  v_pay    uuid;
  v_amount int;
  v_ref    text := left(trim(coalesce(p_reference, '')), 80);
begin
  if v_uid is null then
    raise exception 'Connectez-vous à votre compte boutique.';
  end if;
  select * into v_store from public.gm_stores where code = upper(trim(p_store_code)) and owner_id = v_uid;
  if not found then
    raise exception 'Boutique introuvable sur ce compte.';
  end if;
  select * into v_plan from public.gm_plans where code = p_plan and active and code <> 'free';
  if not found then
    raise exception 'Formule inconnue.';
  end if;
  if p_months is null or p_months not in (1, 3, 6) then
    raise exception 'Durée invalide : 1, 3 ou 6 mois.';
  end if;
  if p_method is null or p_method not in ('orange_money', 'moov_money', 'virement', 'especes', 'autre') then
    raise exception 'Moyen de paiement inconnu.';
  end if;
  if length(v_ref) < 4 then
    raise exception 'Saisissez la référence de la transaction (reçue par SMS).';
  end if;
  if (select count(*) from public.gm_payments where store_id = v_store.id and status = 'declared') >= 3 then
    raise exception 'Trois paiements attendent déjà la validation d''Eden Dev : patientez.';
  end if;
  if exists (select 1 from public.gm_payments where upper(reference) = upper(v_ref) and method = p_method and status <> 'refused') then
    raise exception 'Cette référence de transaction a déjà été déclarée.';
  end if;

  v_amount := v_plan.price_month * p_months;
  insert into public.gm_subscriptions (store_id, plan_code, months, status, source)
  values (v_store.id, v_plan.code, p_months, 'pending', 'payment')
  returning id into v_sub;
  insert into public.gm_payments (store_id, subscription_id, amount, method, reference, payer_phone)
  values (v_store.id, v_sub, v_amount, p_method, v_ref, left(trim(coalesce(p_payer_phone, '')), 40))
  returning id into v_pay;
  insert into public.gm_license_events (store_id, kind, detail)
  values (v_store.id, 'payment_declared', jsonb_build_object('payment_id', v_pay, 'plan', v_plan.code, 'months', p_months, 'amount', v_amount));
  return jsonb_build_object('payment_id', v_pay, 'amount', v_amount, 'plan', v_plan.code, 'plan_label', v_plan.label, 'months', p_months);
end;
$$;

-- Validation (ou refus) d'un paiement par Eden Dev : l'abonnement démarre à la fin de la période
-- en cours (renouvellement) ou tout de suite si la boutique n'a plus d'abonnement actif.
create or replace function public.gm_on_payment_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sub   public.gm_subscriptions;
  v_start timestamptz;
begin
  if new.status is not distinct from old.status then
    return new;
  end if;
  if old.status <> 'declared' then
    raise exception 'Un paiement validé ou refusé ne change plus de statut : créez un nouveau paiement.';
  end if;
  select * into v_sub from public.gm_subscriptions where id = new.subscription_id for update;
  if new.status = 'validated' then
    select greatest(now(), coalesce(max(ends_at), now())) into v_start
    from public.gm_subscriptions
    where store_id = new.store_id and status = 'active' and ends_at > now();
    update public.gm_subscriptions
       set status = 'active', starts_at = v_start, ends_at = v_start + make_interval(months => coalesce(v_sub.months, 1)::int)
     where id = v_sub.id;
    new.validated_at := now();
  elsif new.status = 'refused' then
    update public.gm_subscriptions set status = 'cancelled' where id = v_sub.id;
  end if;
  insert into public.gm_license_events (store_id, kind, detail)
  values (new.store_id, 'payment_' || new.status, jsonb_build_object('payment_id', new.id, 'amount', new.amount, 'reference', new.reference));
  return new;
end;
$$;

drop trigger if exists gm_payment_status on public.gm_payments;
create trigger gm_payment_status
  before update of status on public.gm_payments
  for each row execute function public.gm_on_payment_status();

-- ───────────────────────────── Fonctions réservées à « gm-license » ─────────────────────────────

-- Licence attendue pour un PC : abonnement en cours, prolongé par les abonnements suivants de
-- même formule qui s'enchaînent sans interruption.
create or replace function public.gm_license_target(p_pc_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pc      public.gm_store_pcs;
  v_store   public.gm_stores;
  v_cur     public.gm_subscriptions;
  v_next    public.gm_subscriptions;
  v_plan    public.gm_plans;
  v_lic     public.gm_licenses;
  v_end     timestamptz;
  v_mp      int;
  v_revoked jsonb;
begin
  select * into v_pc from public.gm_store_pcs where pc_id = p_pc_id;
  if not found then
    return jsonb_build_object('status', 'unregistered', 'server_time', now());
  end if;
  update public.gm_store_pcs set last_seen = now() where id = v_pc.id;
  select coalesce(jsonb_agg(id), '[]'::jsonb) into v_revoked
  from public.gm_licenses where pc_id = p_pc_id and status = 'revoked';
  select * into v_store from public.gm_stores where id = v_pc.store_id;
  if v_store.status <> 'active' then
    return jsonb_build_object('status', 'suspended', 'server_time', now(), 'revoked', v_revoked, 'store_code', v_store.code);
  end if;

  select * into v_cur from public.gm_subscriptions
  where store_id = v_store.id and status = 'active' and starts_at <= now() and ends_at > now()
  order by starts_at desc limit 1;
  if not found then
    return jsonb_build_object('status', 'none', 'server_time', now(), 'revoked', v_revoked,
                              'store_code', v_store.code, 'store_name', v_store.name);
  end if;
  v_end := v_cur.ends_at;
  loop
    select * into v_next from public.gm_subscriptions
    where store_id = v_store.id and status = 'active' and plan_code = v_cur.plan_code
      and coalesce(max_postes, 0) = coalesce(v_cur.max_postes, 0)
      and starts_at <= v_end and ends_at > v_end
    order by ends_at desc limit 1;
    exit when not found;
    v_end := v_next.ends_at;
  end loop;

  select * into v_plan from public.gm_plans where code = v_cur.plan_code;
  v_mp := coalesce(v_cur.max_postes, v_plan.max_postes);
  select * into v_lic from public.gm_licenses where pc_id = p_pc_id and status = 'valid' order by issued_at desc limit 1;

  return jsonb_build_object(
    'status', 'ok', 'server_time', now(), 'revoked', v_revoked,
    'store_id', v_store.id, 'store_code', v_store.code, 'store_name', v_store.name,
    'subscription_id', v_cur.id, 'plan', v_plan.code, 'plan_label', v_plan.label,
    'max_postes', v_mp, 'features', to_jsonb(v_plan.features),
    'starts_at', v_cur.starts_at, 'expires_at', v_end,
    'current', case
      when v_lic.id is not null and v_lic.store_id = v_store.id and v_lic.plan_code = v_plan.code
           and v_lic.max_postes = v_mp and v_lic.expires_at = v_end and v_lic.features = v_plan.features
      then jsonb_build_object('license_id', v_lic.id, 'file_path', v_lic.file_path, 'kid', v_lic.kid)
    end
  );
end;
$$;

-- Enregistre une licence signée (la précédente du PC est remplacée).
create or replace function public.gm_license_record(p jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.gm_licenses set status = 'replaced' where pc_id = p ->> 'pc_id' and status = 'valid';
  insert into public.gm_licenses (id, store_id, pc_id, subscription_id, plan_code, max_postes, features, starts_at, expires_at, kid, file_path)
  values ((p ->> 'license_id')::uuid, (p ->> 'store_id')::uuid, p ->> 'pc_id', (p ->> 'subscription_id')::uuid, p ->> 'plan',
          (p ->> 'max_postes')::int, array(select jsonb_array_elements_text(p -> 'features')),
          (p ->> 'starts_at')::timestamptz, (p ->> 'expires_at')::timestamptz, (p ->> 'kid')::int, p ->> 'file_path');
  insert into public.gm_license_events (store_id, kind, detail)
  values ((p ->> 'store_id')::uuid, 'license_issued',
          jsonb_build_object('license_id', p ->> 'license_id', 'pc_id', p ->> 'pc_id', 'plan', p ->> 'plan', 'expires_at', p ->> 'expires_at'));
end;
$$;

-- Clé de signature Ed25519 : la clé privée est créée par « gm-license » au premier appel et rangée
-- dans Vault (chiffrée) ; elle ne sort jamais de Supabase. La clé publique est publiée dans gm_config
-- et intégrée à GestiMarket.
create or replace function public.gm_signing_key()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'kid', 1,
    'private', (select decrypted_secret from vault.decrypted_secrets where name = 'gm_license_private_key_1'),
    'public', (select value from public.gm_config where key = 'license_public_key_1')
  )
$$;

create or replace function public.gm_signing_key_init(p_private text, p_public text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform pg_advisory_xact_lock(hashtext('gm_signing_key'));
  if not exists (select 1 from vault.secrets where name = 'gm_license_private_key_1') then
    perform vault.create_secret(p_private, 'gm_license_private_key_1', 'Clé privée Ed25519 de signature des licences GestiMarket (kid 1)');
    insert into public.gm_config (key, value) values ('license_public_key_1', p_public)
    on conflict (key) do update set value = excluded.value;
  end if;
  return public.gm_signing_key();
end;
$$;

-- ───────────────────────────── Droits d'exécution ─────────────────────────────

revoke all on function public.gm_public_options() from public;
grant execute on function public.gm_public_options() to anon, authenticated;

revoke all on function public.gm_store_json(uuid) from public, anon, authenticated;

revoke all on function public.gm_register_store(jsonb) from public, anon;
revoke all on function public.gm_my_stores() from public, anon;
revoke all on function public.gm_register_pc(text, text, int, text, text) from public, anon;
revoke all on function public.gm_declare_payment(text, text, int, text, text, text) from public, anon;
grant execute on function public.gm_register_store(jsonb) to authenticated;
grant execute on function public.gm_my_stores() to authenticated;
grant execute on function public.gm_register_pc(text, text, int, text, text) to authenticated;
grant execute on function public.gm_declare_payment(text, text, int, text, text, text) to authenticated;

revoke all on function public.gm_on_payment_status() from public, anon, authenticated;

revoke all on function public.gm_license_target(text) from public, anon, authenticated;
revoke all on function public.gm_license_record(jsonb) from public, anon, authenticated;
revoke all on function public.gm_signing_key() from public, anon, authenticated;
revoke all on function public.gm_signing_key_init(text, text) from public, anon, authenticated;
grant execute on function public.gm_license_target(text) to service_role;
grant execute on function public.gm_license_record(jsonb) to service_role;
grant execute on function public.gm_signing_key() to service_role;
grant execute on function public.gm_signing_key_init(text, text) to service_role;

-- ───────────────────────────── Tableau de bord Eden Dev ─────────────────────────────

-- Paiements à valider, avec la boutique (Table Editor → gm_paiements_a_valider).
-- Pour valider : ouvrir la table gm_payments et passer « status » à validated (ou refused).
create or replace view public.gm_paiements_a_valider
with (security_invoker = true)
as
select p.id, p.created_at, s.code as boutique, s.name as nom_boutique, s.owner_name as proprietaire, s.phone as telephone,
       pl.label as formule, x.months as mois, p.amount as montant, p.method as moyen, p.reference, p.payer_phone, p.status
from public.gm_payments p
join public.gm_stores s on s.id = p.store_id
join public.gm_subscriptions x on x.id = p.subscription_id
join public.gm_plans pl on pl.code = x.plan_code
order by p.created_at desc;
revoke all on public.gm_paiements_a_valider from anon, authenticated;

-- ───────────────────────────── Bucket des licences ─────────────────────────────
-- Public en lecture (fichiers signés, liés à un PC ; adresse impossible à deviner sans l'identifiant du PC).
-- Aucune politique sur storage.objects : impossible de lister ou de déposer sans la clé de service.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('licences', 'licences', true, 16384, array['application/json'])
on conflict (id) do update set public = true, file_size_limit = 16384, allowed_mime_types = array['application/json'];
