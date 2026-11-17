-- Console Eden Dev 1.0 et GestiMarket 0.33
--
-- 1. Console Eden Dev (logiciel à installer, réservé à Eden Dev) :
--    - administrateurs (gm_admins), appareils autorisés (gm_admin_devices), journal non modifiable (gm_admin_journal) ;
--    - chaque écran et chaque action passe par une fonction « gm_console_* » qui vérifie : compte administrateur actif,
--      vérification à 2 étapes (aal2), appareil autorisé, rôle. La console n'a que la clé publique de Supabase.
--    - premier administrateur : l'adresse gm_config.console_owner_email devient Direction à sa première connexion
--      (avec la vérification à 2 étapes), tant qu'aucun administrateur n'existe.
-- 2. Cartes de bon vendues par WhatsApp (gm_card_sales) : la carte est fabriquée au moment de l'envoi par la fonction
--    « gm-cartes » (gm_card_sale_issue), son code n'est jamais affiché ni gardé en clair. Client sans message depuis
--    24 heures : la vente attend et part dès qu'il écrit (gm-whatsapp-webhook). Confirmation à l'activation.
-- 3. GestiMarket 0.33 (Wave, Moov Money sur PC, carte réservée à une boutique) : gestimarket_0_33.sql, à appliquer ensuite.

create extension if not exists pg_net with schema extensions;

-- ───────────────────────────── Administrateurs, appareils, journal ─────────────────────────────

create table if not exists public.gm_admins (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  email      text not null default '',
  name       text not null default '',
  role       text not null check (role in ('direction', 'paiements', 'assistance')),
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid
);
alter table public.gm_admins enable row level security;

create table if not exists public.gm_admin_devices (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.gm_admins(user_id) on delete cascade,
  token_hash  text not null unique,                 -- SHA-256 du jeton gardé par la console sur l'appareil
  label       text not null default '',
  platform    text not null default '',
  app_version text not null default '',
  status      text not null default 'pending' check (status in ('pending', 'approved', 'revoked')),
  created_at  timestamptz not null default now(),
  approved_at timestamptz,
  approved_by uuid,
  last_seen   timestamptz
);
alter table public.gm_admin_devices enable row level security;

create table if not exists public.gm_admin_journal (
  id      bigint generated always as identity primary key,
  at      timestamptz not null default now(),
  user_id uuid,
  email   text not null default '',
  role    text not null default '',
  action  text not null,
  target  text not null default '',
  reason  text not null default '',
  detail  jsonb not null default '{}'::jsonb
);
create index if not exists gm_admin_journal_at on public.gm_admin_journal (at desc);
create index if not exists gm_admin_journal_target on public.gm_admin_journal (target);
alter table public.gm_admin_journal enable row level security;

-- Le journal ne se modifie ni ne s'efface.
create or replace function public.gm_admin_journal_lock()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'Le journal de la console ne se modifie pas et ne s''efface pas.';
end;
$$;
drop trigger if exists gm_admin_journal_lock on public.gm_admin_journal;
create trigger gm_admin_journal_lock before update or delete on public.gm_admin_journal
  for each row execute function public.gm_admin_journal_lock();
drop trigger if exists gm_admin_journal_lock_truncate on public.gm_admin_journal;
create trigger gm_admin_journal_lock_truncate before truncate on public.gm_admin_journal
  for each statement execute function public.gm_admin_journal_lock();

insert into public.gm_config (key, value) values
  ('console_owner_email', 'edendev.gestimarket@gmail.com'),
  ('wave_merchant_number', ''),
  ('wave_merchant_name', 'Eden Dev'),
  ('moov_merchant_number', ''),
  ('moov_merchant_name', 'Eden Dev')
on conflict (key) do nothing;

create or replace function public.gm_admin_token_hash(p text)
returns text
language sql
immutable
set search_path = public, extensions
as $$
  select encode(extensions.digest('gm-console|' || coalesce(p, ''), 'sha256'), 'hex')
$$;

create or replace function public.gm_admin_reason(p text)
returns text
language plpgsql
immutable
set search_path = public
as $$
begin
  if length(trim(coalesce(p, ''))) < 3 then
    raise exception 'Indiquez le motif (3 caractères au moins) : il est inscrit au journal.';
  end if;
  return left(trim(p), 300);
end;
$$;

create or replace function public.gm_role_label(p text)
returns text
language sql
immutable
set search_path = public
as $$
  select case p when 'direction' then 'Direction' when 'paiements' then 'Paiements' when 'assistance' then 'Assistance' else coalesce(p, '') end
$$;

-- Administrateur qui appelle : compte actif, vérification à 2 étapes, appareil autorisé, rôle (Direction : tout).
create or replace function public.gm_admin_ctx(p_device text, p_roles text[] default null)
returns public.gm_admins
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin public.gm_admins;
  v_dev   public.gm_admin_devices;
begin
  if auth.uid() is null then
    raise exception 'Connectez-vous à la console.';
  end if;
  select * into v_admin from public.gm_admins where user_id = auth.uid() and active;
  if not found then
    raise exception 'Ce compte n''est pas administrateur Eden Dev.';
  end if;
  if coalesce(auth.jwt() ->> 'aal', '') <> 'aal2' then
    raise exception 'Vérification à 2 étapes requise : reconnectez-vous.';
  end if;
  select * into v_dev from public.gm_admin_devices
  where token_hash = public.gm_admin_token_hash(p_device) and user_id = v_admin.user_id;
  if not found or v_dev.status <> 'approved' or length(coalesce(p_device, '')) < 32 then
    raise exception 'Cet appareil n''est pas autorisé : demandez à la Direction de l''autoriser.';
  end if;
  if v_dev.last_seen is null or v_dev.last_seen < now() - interval '1 minute' then
    update public.gm_admin_devices set last_seen = now() where id = v_dev.id;
  end if;
  if p_roles is not null and v_admin.role <> 'direction' and not (v_admin.role = any (p_roles)) then
    raise exception 'Votre rôle (%) ne permet pas cette action.', public.gm_role_label(v_admin.role);
  end if;
  return v_admin;
end;
$$;

create or replace function public.gm_admin_log(p_admin public.gm_admins, p_action text, p_target text, p_reason text, p_detail jsonb default '{}'::jsonb)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.gm_admin_journal (user_id, email, role, action, target, reason, detail)
  values (p_admin.user_id, p_admin.email, p_admin.role, p_action, coalesce(p_target, ''), left(coalesce(trim(p_reason), ''), 300),
          coalesce(p_detail, '{}'::jsonb));
$$;

-- Fin de l'abonnement en cours (suite d'abonnements de la même formule, comme gm_license_target).
create or replace function public.gm_store_current(p_store_id uuid)
returns public.gm_subscriptions
language sql
stable
security definer
set search_path = public
as $$
  select * from public.gm_subscriptions
  where store_id = p_store_id and status = 'active' and starts_at <= now() and ends_at > now()
  order by starts_at desc limit 1
$$;

create or replace function public.gm_store_chain_end(p_store_id uuid, p_plan text)
returns timestamptz
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_end  timestamptz;
  v_next timestamptz;
begin
  select max(ends_at) into v_end from public.gm_subscriptions
  where store_id = p_store_id and status = 'active' and plan_code = p_plan and starts_at <= now() and ends_at > now();
  if v_end is null then
    return null;
  end if;
  loop
    select max(ends_at) into v_next from public.gm_subscriptions
    where store_id = p_store_id and status = 'active' and plan_code = p_plan and starts_at <= v_end and ends_at > v_end;
    exit when v_next is null;
    v_end := v_next;
  end loop;
  return v_end;
end;
$$;

-- Chiffres de téléphone avec indicatif (8 chiffres : Mali, +223).
create or replace function public.gm_phone_digits(p text)
returns text
language sql
immutable
set search_path = public
as $$
  select case when d ~ '^00' then substr(d, 3) when length(d) = 8 then '223' || d else d end
  from (select regexp_replace(coalesce(p, ''), '\D', '', 'g') as d) x
$$;

-- ───────────────────────────── Connexion, appareils, équipe ─────────────────────────────

-- État de la connexion : administrateur ? vérification à 2 étapes ? appareil autorisé ? L'appareil est
-- enregistré ici (en attente, ou autorisé tout de suite si c'est le premier appareil d'un membre de la Direction).
create or replace function public.gm_console_me(p_device text, p_label text default '', p_platform text default '', p_version text default '')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_aal   text := coalesce(auth.jwt() ->> 'aal', 'aal1');
  v_admin public.gm_admins;
  v_dev   public.gm_admin_devices;
  v_hash  text;
begin
  if v_uid is null then
    raise exception 'Connectez-vous à la console.';
  end if;
  select * into v_admin from public.gm_admins where user_id = v_uid;
  if not found then
    -- Premier administrateur : l'adresse d'Eden Dev, e-mail confirmé, vérification à 2 étapes faite.
    if v_aal = 'aal2' and v_email <> ''
       and not exists (select 1 from public.gm_admins)
       and v_email = lower(coalesce((select value from public.gm_config where key = 'console_owner_email'), ''))
       and exists (select 1 from auth.users where id = v_uid and email_confirmed_at is not null) then
      insert into public.gm_admins (user_id, email, name, role) values (v_uid, v_email, 'Direction Eden Dev', 'direction')
      returning * into v_admin;
      perform public.gm_admin_log(v_admin, 'Premier administrateur', v_email, 'Création de la console', '{}'::jsonb);
    else
      return jsonb_build_object('admin', false, 'email', v_email, 'aal', v_aal,
        'bootstrap', not exists (select 1 from public.gm_admins)
                     and v_email = lower(coalesce((select value from public.gm_config where key = 'console_owner_email'), '')));
    end if;
  end if;
  if not v_admin.active then
    return jsonb_build_object('admin', false, 'disabled', true, 'email', v_email, 'aal', v_aal);
  end if;
  if v_aal <> 'aal2' then
    return jsonb_build_object('admin', true, 'aal', v_aal, 'role', v_admin.role, 'name', v_admin.name, 'email', v_admin.email);
  end if;
  if length(coalesce(p_device, '')) < 32 then
    raise exception 'Jeton d''appareil invalide.';
  end if;

  v_hash := public.gm_admin_token_hash(p_device);
  select * into v_dev from public.gm_admin_devices where token_hash = v_hash;
  if found and v_dev.user_id <> v_uid then
    raise exception 'Cet appareil est déjà enregistré pour un autre administrateur : réinstallez la console.';
  end if;
  if not found then
    insert into public.gm_admin_devices (user_id, token_hash, label, platform, app_version, status, approved_at, last_seen)
    values (v_uid, v_hash, left(coalesce(p_label, ''), 80), left(coalesce(p_platform, ''), 40), left(coalesce(p_version, ''), 20),
            case when v_admin.role = 'direction'
                      and not exists (select 1 from public.gm_admin_devices where user_id = v_uid and status = 'approved')
                 then 'approved' else 'pending' end,
            case when v_admin.role = 'direction'
                      and not exists (select 1 from public.gm_admin_devices where user_id = v_uid and status = 'approved')
                 then now() end,
            now())
    returning * into v_dev;
    perform public.gm_admin_log(v_admin, 'Nouvel appareil', v_dev.label, '',
      jsonb_build_object('device_id', v_dev.id, 'platform', v_dev.platform, 'status', v_dev.status));
  else
    update public.gm_admin_devices
       set last_seen = now(), app_version = left(coalesce(p_version, ''), 20),
           label = case when coalesce(p_label, '') <> '' then left(p_label, 80) else label end,
           platform = case when coalesce(p_platform, '') <> '' then left(p_platform, 40) else platform end
     where id = v_dev.id
    returning * into v_dev;
  end if;

  return jsonb_build_object(
    'admin', true, 'aal', v_aal, 'role', v_admin.role, 'role_label', public.gm_role_label(v_admin.role),
    'name', v_admin.name, 'email', v_admin.email,
    'device', jsonb_build_object('id', v_dev.id, 'status', v_dev.status, 'label', v_dev.label),
    'devices_pending', case when v_admin.role = 'direction' then (select count(*) from public.gm_admin_devices where status = 'pending') else 0 end
  );
end;
$$;

create or replace function public.gm_console_devices(p_device text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin public.gm_admins := public.gm_admin_ctx(p_device);
  v_mine  text := public.gm_admin_token_hash(p_device);
begin
  return (select coalesce(jsonb_agg(jsonb_build_object(
            'id', d.id, 'email', a.email, 'name', a.name, 'role', a.role, 'label', d.label, 'platform', d.platform,
            'app_version', d.app_version, 'status', d.status, 'created_at', d.created_at, 'approved_at', d.approved_at,
            'last_seen', d.last_seen, 'mine', d.token_hash = v_mine
          ) order by (d.status = 'pending') desc, d.last_seen desc nulls last), '[]'::jsonb)
          from public.gm_admin_devices d join public.gm_admins a on a.user_id = d.user_id
          where v_admin.role = 'direction' or d.user_id = v_admin.user_id);
end;
$$;

-- Autoriser ou retirer un appareil (Direction ; chacun peut retirer les siens).
create or replace function public.gm_console_device_set(p_device text, p_id uuid, p_status text, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin  public.gm_admins := public.gm_admin_ctx(p_device);
  v_dev    public.gm_admin_devices;
  v_reason text := public.gm_admin_reason(p_reason);
begin
  if p_status not in ('approved', 'revoked') then
    raise exception 'État inconnu.';
  end if;
  select * into v_dev from public.gm_admin_devices where id = p_id for update;
  if not found then
    raise exception 'Appareil introuvable.';
  end if;
  if v_admin.role <> 'direction' and not (v_dev.user_id = v_admin.user_id and p_status = 'revoked') then
    raise exception 'Seule la Direction autorise les appareils.';
  end if;
  if v_dev.token_hash = public.gm_admin_token_hash(p_device) and p_status = 'revoked' then
    raise exception 'Vous ne pouvez pas retirer l''appareil que vous utilisez.';
  end if;
  update public.gm_admin_devices
     set status = p_status,
         approved_at = case when p_status = 'approved' then now() else approved_at end,
         approved_by = case when p_status = 'approved' then v_admin.user_id else approved_by end
   where id = p_id;
  perform public.gm_admin_log(v_admin, case when p_status = 'approved' then 'Appareil autorisé' else 'Appareil retiré' end,
    v_dev.label, v_reason, jsonb_build_object('device_id', v_dev.id, 'user_id', v_dev.user_id));
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.gm_console_admins(p_device text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin public.gm_admins := public.gm_admin_ctx(p_device, array['direction']);
begin
  return (select coalesce(jsonb_agg(jsonb_build_object(
            'user_id', a.user_id, 'email', a.email, 'name', a.name, 'role', a.role, 'role_label', public.gm_role_label(a.role),
            'active', a.active, 'created_at', a.created_at, 'me', a.user_id = v_admin.user_id,
            'devices', (select count(*) from public.gm_admin_devices d where d.user_id = a.user_id and d.status = 'approved'),
            'mfa', exists (select 1 from auth.mfa_factors f where f.user_id = a.user_id and f.status = 'verified')
          ) order by a.active desc, a.role, a.email), '[]'::jsonb)
          from public.gm_admins a);
end;
$$;

-- Ajouter un membre de l'équipe (compte GestiMarket existant, e-mail confirmé), changer son rôle, le désactiver.
create or replace function public.gm_console_admin_set(p_device text, p_email text, p_role text, p_active boolean, p_name text, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin  public.gm_admins := public.gm_admin_ctx(p_device, array['direction']);
  v_reason text := public.gm_admin_reason(p_reason);
  v_user   uuid;
  v_email  text := lower(trim(coalesce(p_email, '')));
  v_old    public.gm_admins;
begin
  if p_role not in ('direction', 'paiements', 'assistance') then
    raise exception 'Rôle inconnu : Direction, Paiements ou Assistance.';
  end if;
  select id into v_user from auth.users where lower(email) = v_email and email_confirmed_at is not null;
  if not found then
    raise exception 'Aucun compte confirmé avec l''e-mail %. La personne crée d''abord son compte dans la console (« Créer mon compte »).', v_email;
  end if;
  if v_user = v_admin.user_id and (p_role <> 'direction' or not coalesce(p_active, true)) then
    raise exception 'Vous ne pouvez pas retirer votre propre rôle Direction.';
  end if;
  select * into v_old from public.gm_admins where user_id = v_user;
  insert into public.gm_admins (user_id, email, name, role, active, created_by)
  values (v_user, v_email, left(coalesce(trim(p_name), ''), 80), p_role, coalesce(p_active, true), v_admin.user_id)
  on conflict (user_id) do update set role = excluded.role, active = excluded.active,
    name = case when excluded.name <> '' then excluded.name else gm_admins.name end, email = excluded.email;
  if not coalesce(p_active, true) then
    update public.gm_admin_devices set status = 'revoked' where user_id = v_user and status <> 'revoked';
  end if;
  perform public.gm_admin_log(v_admin, case when v_old.user_id is null then 'Membre ajouté' else 'Membre modifié' end, v_email, v_reason,
    jsonb_build_object('role', p_role, 'active', coalesce(p_active, true), 'old_role', v_old.role, 'old_active', v_old.active));
  return jsonb_build_object('ok', true);
end;
$$;

-- ───────────────────────────── Tableau de bord ─────────────────────────────

create or replace function public.gm_console_dashboard(p_device text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin public.gm_admins := public.gm_admin_ctx(p_device);
  v_month timestamptz := date_trunc('month', now());
  v_prev  timestamptz := date_trunc('month', now()) - interval '1 month';
begin
  return jsonb_build_object(
    'stores', (
      select jsonb_build_object(
        'total', count(*),
        'suspended', count(*) filter (where s.status = 'suspended'),
        'paid', count(*) filter (where s.status = 'active' and c.source is not null and c.source <> 'trial'),
        'trial', count(*) filter (where s.status = 'active' and c.source = 'trial'),
        'expired', count(*) filter (where s.status = 'active' and c.id is null),
        'new_month', count(*) filter (where s.created_at >= v_month))
      from public.gm_stores s
      left join lateral (select x.id, x.source from public.gm_subscriptions x
                         where x.store_id = s.id and x.status = 'active' and x.starts_at <= now() and x.ends_at > now()
                         order by x.starts_at desc limit 1) c on true),
    'payments_to_validate', (select count(*) from public.gm_payments where status = 'declared'),
    'cards', jsonb_build_object(
      'waiting', (select count(*) from public.gm_card_sales where status = 'waiting'),
      'failed', (select count(*) from public.gm_card_sales where status = 'failed'),
      'sold_month', (select count(*) from public.gm_card_sales where created_at >= v_month and status <> 'cancelled'),
      'sold_month_amount', (select coalesce(sum(amount), 0) from public.gm_card_sales where created_at >= v_month and status <> 'cancelled'),
      'new_vouchers', (select count(*) from public.gm_vouchers where status = 'new' and batch <> 'TEST')),
    -- Recettes : paiements validés, sans les cartes du lot TEST.
    'revenue', (
      select coalesce(jsonb_agg(jsonb_build_object('method', method, 'amount', amount, 'count', n) order by amount desc), '[]'::jsonb)
      from (select p.method, sum(p.amount) as amount, count(*) as n from public.gm_payments p
            where p.status = 'validated' and p.validated_at >= v_month
              and not exists (select 1 from public.gm_vouchers v where v.payment_id = p.id and v.batch = 'TEST')
            group by p.method) r),
    'revenue_by_plan', (
      select coalesce(jsonb_agg(jsonb_build_object('plan', plan, 'amount', amount, 'count', n) order by amount desc), '[]'::jsonb)
      from (select pl.label as plan, sum(p.amount) as amount, count(*) as n from public.gm_payments p
            join public.gm_subscriptions x on x.id = p.subscription_id join public.gm_plans pl on pl.code = x.plan_code
            where p.status = 'validated' and p.validated_at >= v_month
              and not exists (select 1 from public.gm_vouchers v where v.payment_id = p.id and v.batch = 'TEST')
            group by pl.label) r),
    'revenue_last_month', (
      select coalesce(sum(p.amount), 0) from public.gm_payments p
      where p.status = 'validated' and p.validated_at >= v_prev and p.validated_at < v_month
        and not exists (select 1 from public.gm_vouchers v where v.payment_id = p.id and v.batch = 'TEST')),
    'expiring', (
      select coalesce(jsonb_agg(jsonb_build_object('store_id', id, 'code', code, 'name', name, 'owner_name', owner_name, 'phone', phone,
                                                   'plan', plan, 'source', source, 'ends_at', ends_at) order by ends_at), '[]'::jsonb)
      from (select s.id, s.code, s.name, s.owner_name, s.phone, pl.label as plan, c.source,
                   public.gm_store_chain_end(s.id, c.plan_code) as ends_at
            from public.gm_stores s
            cross join lateral (select * from public.gm_store_current(s.id)) c
            join public.gm_plans pl on pl.code = c.plan_code
            where s.status = 'active' and c.id is not null) e
      where ends_at <= now() + interval '7 days'),
    'servers', jsonb_build_object(
      'published', (select count(*) from public.gm_servers_statut where active),
      'offline', (select count(*) from public.gm_servers_statut where active and (last_seen is null or last_seen < now() - interval '1 hour'))),
    'errors_7d', (select coalesce(sum(count), 0) from public.gm_error_reports where last_at > now() - interval '7 days'),
    'versions', (
      select coalesce(jsonb_agg(jsonb_build_object('version', coalesce(nullif(app_version, ''), '?'), 'count', n) order by app_version desc), '[]'::jsonb)
      from (select app_version, count(*) as n from public.gm_store_pcs where last_seen > now() - interval '30 days' group by app_version) v),
    'devices_pending', case when v_admin.role = 'direction' then (select count(*) from public.gm_admin_devices where status = 'pending') else 0 end
  );
end;
$$;

-- ───────────────────────────── Boutiques ─────────────────────────────

create or replace function public.gm_console_stores(p_device text, p_search text default '', p_filter text default '')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin public.gm_admins := public.gm_admin_ctx(p_device);
  v_q     text := lower(trim(coalesce(p_search, '')));
  v_d     text := regexp_replace(coalesce(p_search, ''), '\D', '', 'g');
begin
  return (
    select coalesce(jsonb_agg(row_to_json(q)::jsonb order by q.created_at desc), '[]'::jsonb)
    from (
      select s.id, s.code, s.name, s.owner_name, s.phone, s.email, s.city, s.country, s.status, s.created_at,
             c.plan_code as plan, pl.label as plan_label, c.source, public.gm_store_chain_end(s.id, c.plan_code) as ends_at,
             (select count(*) from public.gm_store_pcs pc where pc.store_id = s.id) as pcs,
             (select max(last_seen) from public.gm_store_pcs pc where pc.store_id = s.id) as last_seen,
             (select count(*) from public.gm_payments p where p.store_id = s.id and p.status = 'declared') as declared
      from public.gm_stores s
      left join lateral (select * from public.gm_store_current(s.id)) c on c.id is not null
      left join public.gm_plans pl on pl.code = c.plan_code
      where (v_q = '' or lower(s.code) like '%' || v_q || '%' or lower(s.name) like '%' || v_q || '%'
             or lower(s.owner_name) like '%' || v_q || '%' or lower(s.email) like '%' || v_q || '%'
             or (length(v_d) >= 4 and regexp_replace(s.phone, '\D', '', 'g') like '%' || v_d || '%'))
        and case coalesce(p_filter, '')
              when 'suspended' then s.status = 'suspended'
              when 'trial' then s.status = 'active' and c.source = 'trial'
              when 'paid' then s.status = 'active' and c.source is not null and c.source <> 'trial'
              when 'expired' then s.status = 'active' and c.id is null
              when 'expiring' then s.status = 'active' and c.id is not null
                                   and public.gm_store_chain_end(s.id, c.plan_code) <= now() + interval '7 days'
              else true end
      order by s.created_at desc
      limit 300
    ) q);
end;
$$;

create or replace function public.gm_console_store(p_device text, p_store_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin public.gm_admins := public.gm_admin_ctx(p_device);
  v_store public.gm_stores;
  v_cur   public.gm_subscriptions;
begin
  select * into v_store from public.gm_stores where id = p_store_id;
  if not found then
    raise exception 'Boutique introuvable.';
  end if;
  v_cur := public.gm_store_current(v_store.id);
  return jsonb_build_object(
    'store', to_jsonb(v_store) - 'owner_id',
    'account', (select jsonb_build_object('email', u.email, 'phone', u.phone, 'created_at', u.created_at,
                                          'last_sign_in_at', u.last_sign_in_at, 'email_confirmed', u.email_confirmed_at is not null)
                from auth.users u where u.id = v_store.owner_id),
    'current', case when v_cur.id is not null then jsonb_build_object(
                 'plan', v_cur.plan_code, 'plan_label', (select label from public.gm_plans where code = v_cur.plan_code),
                 'source', v_cur.source, 'max_postes', coalesce(v_cur.max_postes, (select max_postes from public.gm_plans where code = v_cur.plan_code)),
                 'ends_at', public.gm_store_chain_end(v_store.id, v_cur.plan_code)) end,
    'subscriptions', (
      select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'plan', x.plan_code, 'plan_label', pl.label, 'months', x.months,
                                                   'status', x.status, 'source', x.source, 'starts_at', x.starts_at, 'ends_at', x.ends_at,
                                                   'created_at', x.created_at) order by x.created_at desc), '[]'::jsonb)
      from (select * from public.gm_subscriptions where store_id = v_store.id order by created_at desc limit 60) x
      join public.gm_plans pl on pl.code = x.plan_code),
    'payments', (
      select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'created_at', p.created_at, 'method', p.method, 'amount', p.amount,
                                                   'currency', p.currency, 'status', p.status, 'reference', p.reference,
                                                   'payer_phone', p.payer_phone, 'note', p.note, 'validated_at', p.validated_at,
                                                   'plan_label', pl.label, 'months', x.months,
                                                   'test', exists (select 1 from public.gm_vouchers v where v.payment_id = p.id and v.batch = 'TEST'))
                                order by p.created_at desc), '[]'::jsonb)
      from (select * from public.gm_payments where store_id = v_store.id order by created_at desc limit 60) p
      join public.gm_subscriptions x on x.id = p.subscription_id join public.gm_plans pl on pl.code = x.plan_code),
    'pcs', (
      select coalesce(jsonb_agg(jsonb_build_object('pc_id', pc.pc_id, 'slot', pc.slot, 'hostname', pc.hostname, 'app_version', pc.app_version,
                                                   'registered_at', pc.registered_at, 'last_seen', pc.last_seen,
                                                   'licence', (select jsonb_build_object('plan', l.plan_code, 'expires_at', l.expires_at, 'issued_at', l.issued_at)
                                                               from public.gm_licenses l where l.pc_id = pc.pc_id and l.status = 'valid'
                                                               order by l.issued_at desc limit 1))
                                order by pc.slot, pc.last_seen desc nulls last), '[]'::jsonb)
      from public.gm_store_pcs pc where pc.store_id = v_store.id),
    'server', (select jsonb_build_object('active', g.active, 'last_seen', g.last_seen, 'public_url', g.public_url)
               from public.gm_servers_statut g where g.shop_code = v_store.code),
    'tunnel', (select jsonb_build_object('hostname', t.hostname, 'port', t.port, 'updated_at', t.updated_at)
               from public.gm_tunnels t where t.store_id = v_store.id),
    'sugu', (select jsonb_build_object('slug', h.slug, 'active', h.active, 'products', h.products, 'visible_until', h.visible_until,
                                       'updated_at', h.updated_at)
             from public.sugu_shops h where h.store_id = v_store.id),
    'card_sales', (
      select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'created_at', c.created_at, 'status', c.status, 'plan', c.plan_code,
                                                   'months', c.months, 'phone', c.phone) order by c.created_at desc), '[]'::jsonb)
      from public.gm_card_sales c where c.store_id = v_store.id),
    'events', (
      select coalesce(jsonb_agg(jsonb_build_object('kind', e.kind, 'detail', e.detail, 'created_at', e.created_at) order by e.created_at desc), '[]'::jsonb)
      from (select * from public.gm_license_events where store_id = v_store.id order by created_at desc limit 80) e),
    'errors', (
      select coalesce(jsonb_agg(jsonb_build_object('last_at', r.last_at, 'count', r.count, 'version', r.version, 'kind', r.kind,
                                                   'message', left(r.message, 300), 'page', r.page) order by r.last_at desc), '[]'::jsonb)
      from (select * from public.gm_error_reports r
            where upper(regexp_replace(r.pc, '[^0-9A-Za-z]', '', 'g')) in (select pc_id from public.gm_store_pcs where store_id = v_store.id)
            order by r.last_at desc limit 20) r),
    'journal', (
      select coalesce(jsonb_agg(jsonb_build_object('at', j.at, 'email', j.email, 'action', j.action, 'reason', j.reason, 'detail', j.detail)
                                order by j.at desc), '[]'::jsonb)
      from (select * from public.gm_admin_journal where target = v_store.code order by at desc limit 40) j)
  );
end;
$$;

-- Actions sur une boutique, chacune avec un motif inscrit au journal.
--   gift          {days, plan?}  jours offerts (Assistance : 7 au plus) ; même formule : à la suite, sinon tout de suite
--   change_plan   {plan}         nouvelle formule tout de suite, jusqu'à la fin de l'abonnement en cours (Direction)
--   free_pc       {pc_id}        libère une place de PC et retire sa licence
--   resend_licence {pc_id}       licence refaite à la prochaine vérification du PC
--   suspend / reactivate         (Direction)
--   edit          {name, owner_name, phone, city, address}
create or replace function public.gm_console_store_action(p_device text, p_store_id uuid, p_action text, p_args jsonb, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin  public.gm_admins := public.gm_admin_ctx(p_device, array['assistance', 'paiements']);
  v_reason text := public.gm_admin_reason(p_reason);
  v_store  public.gm_stores;
  v_cur    public.gm_subscriptions;
  v_plan   public.gm_plans;
  v_days   int;
  v_start  timestamptz;
  v_end    timestamptz;
  v_pc     text := upper(regexp_replace(coalesce(p_args ->> 'pc_id', ''), '[^0-9A-Za-z]', '', 'g'));
  v_n      int;
  v_detail jsonb := coalesce(p_args, '{}'::jsonb);
begin
  select * into v_store from public.gm_stores where id = p_store_id for update;
  if not found then
    raise exception 'Boutique introuvable.';
  end if;
  v_cur := public.gm_store_current(v_store.id);

  if p_action = 'gift' then
    if v_admin.role = 'paiements' then
      raise exception 'Les jours offerts sont réservés à la Direction et à l''Assistance.';
    end if;
    v_days := (p_args ->> 'days')::int;
    if v_days is null or v_days < 1 or v_days > 366 then
      raise exception 'Nombre de jours : de 1 à 366.';
    end if;
    if v_admin.role = 'assistance' and v_days > 7 then
      raise exception 'L''Assistance offre 7 jours au plus : demandez à la Direction.';
    end if;
    select * into v_plan from public.gm_plans
    where code = coalesce(nullif(p_args ->> 'plan', ''), v_cur.plan_code,
                          (select value from public.gm_config where key = 'trial_plan'), 'pro')
      and code <> 'free';
    if not found then
      raise exception 'Formule inconnue.';
    end if;
    if v_cur.id is not null and v_cur.plan_code = v_plan.code then
      v_start := public.gm_store_chain_end(v_store.id, v_plan.code);
    else
      v_start := now();
    end if;
    v_end := v_start + make_interval(days => v_days);
    insert into public.gm_subscriptions (store_id, plan_code, months, status, source, starts_at, ends_at, max_postes)
    values (v_store.id, v_plan.code, null, 'active', 'manual', v_start, v_end,
            case when v_cur.plan_code = v_plan.code then v_cur.max_postes end);
    insert into public.gm_license_events (store_id, kind, detail)
    values (v_store.id, 'gift', jsonb_build_object('days', v_days, 'plan', v_plan.code, 'starts_at', v_start, 'ends_at', v_end, 'by', v_admin.email));
    v_detail := v_detail || jsonb_build_object('plan', v_plan.code, 'starts_at', v_start, 'ends_at', v_end);

  elsif p_action = 'change_plan' then
    if v_admin.role <> 'direction' then
      raise exception 'Le changement de formule est réservé à la Direction.';
    end if;
    if v_cur.id is null then
      raise exception 'Aucun abonnement en cours : offrez des jours ou vendez une carte.';
    end if;
    select * into v_plan from public.gm_plans where code = p_args ->> 'plan' and code <> 'free';
    if not found then
      raise exception 'Formule inconnue.';
    end if;
    if v_plan.code = v_cur.plan_code then
      raise exception 'La boutique a déjà cette formule.';
    end if;
    v_end := public.gm_store_chain_end(v_store.id, v_cur.plan_code);
    if v_end < now() + interval '1 hour' then
      raise exception 'L''abonnement en cours se termine dans moins d''une heure.';
    end if;
    insert into public.gm_subscriptions (store_id, plan_code, months, status, source, starts_at, ends_at)
    values (v_store.id, v_plan.code, null, 'active', 'manual', now(), v_end);
    insert into public.gm_license_events (store_id, kind, detail)
    values (v_store.id, 'plan_changed', jsonb_build_object('from', v_cur.plan_code, 'to', v_plan.code, 'ends_at', v_end, 'by', v_admin.email));
    v_detail := v_detail || jsonb_build_object('from', v_cur.plan_code, 'ends_at', v_end);

  elsif p_action = 'free_pc' then
    if v_admin.role = 'paiements' then
      raise exception 'Réservé à la Direction et à l''Assistance.';
    end if;
    delete from public.gm_store_pcs where store_id = v_store.id and pc_id = v_pc;
    get diagnostics v_n = row_count;
    if v_n = 0 then
      raise exception 'Ce PC n''est pas relié à cette boutique.';
    end if;
    update public.gm_licenses set status = 'revoked' where pc_id = v_pc and status = 'valid';
    insert into public.gm_license_events (store_id, kind, detail)
    values (v_store.id, 'pc_freed', jsonb_build_object('pc_id', v_pc, 'by', v_admin.email));

  elsif p_action = 'resend_licence' then
    if v_admin.role = 'paiements' then
      raise exception 'Réservé à la Direction et à l''Assistance.';
    end if;
    if not exists (select 1 from public.gm_store_pcs where store_id = v_store.id and pc_id = v_pc) then
      raise exception 'Ce PC n''est pas relié à cette boutique.';
    end if;
    update public.gm_licenses set status = 'replaced' where pc_id = v_pc and status = 'valid';
    insert into public.gm_license_events (store_id, kind, detail)
    values (v_store.id, 'licence_reset', jsonb_build_object('pc_id', v_pc, 'by', v_admin.email));

  elsif p_action in ('suspend', 'reactivate') then
    if v_admin.role <> 'direction' then
      raise exception 'Suspendre ou réactiver une boutique est réservé à la Direction.';
    end if;
    update public.gm_stores set status = case when p_action = 'suspend' then 'suspended' else 'active' end where id = v_store.id;
    insert into public.gm_license_events (store_id, kind, detail)
    values (v_store.id, case when p_action = 'suspend' then 'store_suspended' else 'store_reactivated' end,
            jsonb_build_object('by', v_admin.email, 'reason', v_reason));

  elsif p_action = 'edit' then
    if v_admin.role = 'paiements' then
      raise exception 'Réservé à la Direction et à l''Assistance.';
    end if;
    update public.gm_stores set
      name = coalesce(nullif(left(trim(p_args ->> 'name'), 120), ''), name),
      owner_name = coalesce(left(trim(p_args ->> 'owner_name'), 120), owner_name),
      phone = coalesce(left(trim(p_args ->> 'phone'), 40), phone),
      city = coalesce(left(trim(p_args ->> 'city'), 80), city),
      address = coalesce(left(trim(p_args ->> 'address'), 200), address)
    where id = v_store.id;
    v_detail := jsonb_build_object('before', jsonb_build_object('name', v_store.name, 'owner_name', v_store.owner_name, 'phone', v_store.phone,
                                                                'city', v_store.city, 'address', v_store.address), 'after', p_args);
  else
    raise exception 'Action inconnue.';
  end if;

  perform public.gm_admin_log(v_admin, case p_action
      when 'gift' then 'Jours offerts' when 'change_plan' then 'Formule changée' when 'free_pc' then 'Place de PC libérée'
      when 'resend_licence' then 'Licence refaite' when 'suspend' then 'Boutique suspendue' when 'reactivate' then 'Boutique réactivée'
      else 'Coordonnées corrigées' end,
    v_store.code, v_reason, v_detail);
  return jsonb_build_object('ok', true);
end;
$$;

-- ───────────────────────────── Paiements ─────────────────────────────

create or replace function public.gm_console_payments(p_device text, p_status text default '', p_method text default '',
                                                      p_search text default '', p_from date default null, p_to date default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin public.gm_admins := public.gm_admin_ctx(p_device);
  v_q     text := lower(trim(coalesce(p_search, '')));
begin
  return (
    select coalesce(jsonb_agg(row_to_json(q)::jsonb order by q.created_at desc), '[]'::jsonb)
    from (
      select p.id, p.created_at, p.validated_at, p.method, p.amount, p.currency, p.status, p.reference, p.payer_phone, p.note, p.provider_ref,
             s.id as store_id, s.code as store_code, s.name as store_name, s.owner_name, s.phone as store_phone,
             x.plan_code as plan, pl.label as plan_label, x.months, x.starts_at, x.ends_at,
             p.method <> 'carte_bon' and p.reference <> '' and exists (
               select 1 from public.gm_payments q where q.id <> p.id and upper(q.reference) = upper(p.reference) and q.status <> 'refused') as dup_ref,
             exists (select 1 from public.gm_vouchers v where v.payment_id = p.id and v.batch = 'TEST') as test
      from public.gm_payments p
      join public.gm_stores s on s.id = p.store_id
      join public.gm_subscriptions x on x.id = p.subscription_id
      join public.gm_plans pl on pl.code = x.plan_code
      where (coalesce(p_status, '') = '' or p.status = p_status)
        and (coalesce(p_method, '') = '' or p.method = p_method)
        and (v_q = '' or lower(s.code) like '%' || v_q || '%' or lower(s.name) like '%' || v_q || '%'
             or lower(p.reference) like '%' || v_q || '%' or p.payer_phone like '%' || v_q || '%')
        and (p_from is null or p.created_at >= p_from)
        and (p_to is null or p.created_at < p_to + 1)
      order by p.created_at desc
      limit 1000
    ) q);
end;
$$;

-- Valider (la licence part toute seule) ou refuser (motif visible par la boutique dans « Mes paiements »).
create or replace function public.gm_console_payment_decide(p_device text, p_payment_id uuid, p_decision text, p_reason text default '')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin public.gm_admins := public.gm_admin_ctx(p_device, array['paiements']);
  v_pay   public.gm_payments;
  v_store public.gm_stores;
  v_why   text := left(trim(coalesce(p_reason, '')), 300);
begin
  select * into v_pay from public.gm_payments where id = p_payment_id for update;
  if not found then
    raise exception 'Paiement introuvable.';
  end if;
  if v_pay.status <> 'declared' then
    raise exception 'Ce paiement n''est plus à valider (état : %).', v_pay.status;
  end if;
  select * into v_store from public.gm_stores where id = v_pay.store_id;
  if p_decision = 'validate' then
    update public.gm_payments set status = 'validated',
           note = case when v_why <> '' then v_why else 'Validé par Eden Dev' end
     where id = v_pay.id;
  elsif p_decision = 'refuse' then
    v_why := public.gm_admin_reason(p_reason);
    update public.gm_payments set status = 'refused', note = v_why where id = v_pay.id;
  else
    raise exception 'Décision inconnue.';
  end if;
  perform public.gm_admin_log(v_admin, case when p_decision = 'validate' then 'Paiement validé' else 'Paiement refusé' end,
    v_store.code, v_why, jsonb_build_object('payment_id', v_pay.id, 'method', v_pay.method, 'amount', v_pay.amount, 'reference', v_pay.reference));
  return jsonb_build_object('ok', true, 'status', (select status from public.gm_payments where id = v_pay.id));
end;
$$;

-- ───────────────────────────── Cartes de bon ─────────────────────────────

alter table public.gm_vouchers add column if not exists bound_store_id uuid references public.gm_stores(id) on delete set null;

create table if not exists public.gm_card_sales (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  created_by    uuid,
  seller_email  text not null default '',
  phone         text not null check (phone ~ '^[0-9]{8,15}$'),
  client_name   text not null default '',
  plan_code     text not null references public.gm_plans(code),
  months        smallint not null check (months in (1, 3, 6, 12)),
  amount        integer not null default 0 check (amount >= 0),
  method        text not null check (method in ('orange_money', 'wave', 'moov_money', 'especes', 'virement', 'autre', 'offert')),
  reference     text not null default '',
  store_id      uuid references public.gm_stores(id) on delete set null,
  status        text not null default 'waiting'
                check (status in ('waiting', 'sending', 'sent', 'delivered', 'read', 'used', 'failed', 'cancelled')),
  voucher_id    uuid references public.gm_vouchers(id) on delete set null,
  wa_message_id text,
  last_error    text not null default '',
  attempts      integer not null default 0,
  sending_at    timestamptz,
  sent_at       timestamptz,
  delivered_at  timestamptz,
  read_at       timestamptz,
  used_at       timestamptz,
  confirmed_at  timestamptz
);
create unique index if not exists gm_card_sales_wa_message on public.gm_card_sales (wa_message_id) where wa_message_id is not null;
create index if not exists gm_card_sales_waiting on public.gm_card_sales (phone) where status = 'waiting';
alter table public.gm_card_sales enable row level security;

alter table public.gm_vouchers add column if not exists sale_id uuid references public.gm_card_sales(id) on delete set null;

create or replace function public.gm_console_vouchers(p_device text, p_batch text default '', p_status text default '', p_search text default '')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin public.gm_admins := public.gm_admin_ctx(p_device);
  v_q     text := upper(trim(coalesce(p_search, '')));
begin
  return jsonb_build_object(
    'batches', (
      select coalesce(jsonb_agg(jsonb_build_object('batch', batch, 'created_at', created_at, 'total', total, 'new', n_new, 'sold', n_sold,
                                                   'used', n_used, 'cancelled', n_cancelled, 'plans', plans, 'value', value)
                                order by created_at desc), '[]'::jsonb)
      from (select v.batch, min(v.created_at) as created_at, count(*) as total,
                   count(*) filter (where v.status = 'new') as n_new, count(*) filter (where v.status = 'sold') as n_sold,
                   count(*) filter (where v.status = 'used') as n_used, count(*) filter (where v.status = 'cancelled') as n_cancelled,
                   string_agg(distinct pl.label || ' ' || v.months || ' mois', ', ') as plans,
                   sum(pl.price_month * public.gm_billed_months(v.months)) filter (where v.status <> 'cancelled') as value
            from public.gm_vouchers v join public.gm_plans pl on pl.code = v.plan_code
            group by v.batch) b),
    'vouchers', (
      select coalesce(jsonb_agg(row_to_json(q)::jsonb order by q.created_at desc, q.serial), '[]'::jsonb)
      from (select v.id, v.serial, v.batch, v.plan_code as plan, pl.label as plan_label, v.months,
                   pl.price_month * public.gm_billed_months(v.months) as value, v.status, v.note, v.created_at, v.sold_at, v.used_at,
                   s.code as store_code, s.name as store_name, b.code as bound_store_code, v.sale_id
            from public.gm_vouchers v
            join public.gm_plans pl on pl.code = v.plan_code
            left join public.gm_stores s on s.id = v.store_id
            left join public.gm_stores b on b.id = v.bound_store_id
            where (coalesce(p_batch, '') = '' or v.batch = upper(p_batch))
              and (coalesce(p_status, '') = '' or v.status = p_status)
              and (v_q = '' or v.serial like '%' || v_q || '%' or upper(v.note) like '%' || v_q || '%' or upper(coalesce(s.code, '')) like '%' || v_q || '%')
            order by v.created_at desc, v.serial
            limit 1000) q)
  );
end;
$$;

-- Nouveau lot de cartes à imprimer : les codes ne sont rendus qu'ici, une seule fois.
create or replace function public.gm_console_voucher_batch(p_device text, p_plan text, p_months int, p_count int, p_batch text, p_note text default '')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin public.gm_admins := public.gm_admin_ctx(p_device, array['paiements']);
  v_batch text := upper(regexp_replace(coalesce(nullif(trim(p_batch), ''), 'B' || to_char(now(), 'YYMMDD')), '[^0-9A-Za-z_]', '', 'g'));
  v_rows  jsonb;
begin
  if v_batch ~ '^WA[0-9]' then
    raise exception 'Les lots « WA… » sont réservés aux cartes envoyées par WhatsApp.';
  end if;
  if p_count is null or p_count < 1 or p_count > 200 then
    raise exception 'Nombre de cartes : de 1 à 200 par lot.';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('serial', b.numero, 'code', b.code_secret, 'plan_label', b.formule,
                                               'duration', b.duree, 'value', b.valeur)), '[]'::jsonb)
    into v_rows
  from public.gm_voucher_batch(p_plan, p_months, p_count, v_batch) b;
  if coalesce(trim(p_note), '') <> '' then
    update public.gm_vouchers set note = left(trim(p_note), 200)
     where batch = v_batch and status = 'new' and note = '' and created_at > now() - interval '1 minute';
  end if;
  perform public.gm_admin_log(v_admin, 'Lot de cartes créé', v_batch, coalesce(p_note, ''),
    jsonb_build_object('plan', p_plan, 'months', p_months, 'count', p_count));
  return jsonb_build_object('batch', v_batch, 'cards', v_rows);
end;
$$;

-- Cartes remises (revendeur, vente au comptoir), remises en stock ou annulées (perdues, volées).
create or replace function public.gm_console_voucher_set(p_device text, p_ids uuid[], p_action text, p_note text, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin  public.gm_admins := public.gm_admin_ctx(p_device, array['paiements']);
  v_reason text := public.gm_admin_reason(p_reason);
  v_n      int;
  v_list   text;
begin
  if p_ids is null or cardinality(p_ids) = 0 or cardinality(p_ids) > 500 then
    raise exception 'Choisissez de 1 à 500 cartes.';
  end if;
  select string_agg(serial, ', ' order by serial) into v_list from public.gm_vouchers where id = any (p_ids);
  if p_action = 'sold' then
    update public.gm_vouchers set status = 'sold', sold_at = now(), note = left(coalesce(nullif(trim(p_note), ''), note), 200)
     where id = any (p_ids) and status in ('new', 'sold');
  elsif p_action = 'new' then
    update public.gm_vouchers set status = 'new', sold_at = null where id = any (p_ids) and status = 'sold' and sale_id is null;
  elsif p_action = 'cancel' then
    update public.gm_vouchers set status = 'cancelled', note = left(trim(note || ' — annulée : ' || v_reason), 200)
     where id = any (p_ids) and status in ('new', 'sold');
    update public.gm_card_sales set status = 'cancelled', last_error = 'Carte annulée : ' || v_reason
     where voucher_id = any (p_ids) and status not in ('used', 'cancelled');
  else
    raise exception 'Action inconnue.';
  end if;
  get diagnostics v_n = row_count;
  perform public.gm_admin_log(v_admin, case p_action when 'sold' then 'Cartes remises' when 'new' then 'Cartes remises en stock' else 'Cartes annulées' end,
    left(v_list, 200), v_reason, jsonb_build_object('count', cardinality(p_ids), 'note', p_note));
  return jsonb_build_object('ok', true);
end;
$$;

-- Vendre une carte par WhatsApp : la vente est notée ici, la carte est fabriquée et envoyée par « gm-cartes ».
create or replace function public.gm_console_card_sell(p_device text, p_phone text, p_name text, p_plan text, p_months int,
                                                       p_method text, p_reference text, p_store_code text default '')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin public.gm_admins := public.gm_admin_ctx(p_device, array['paiements']);
  v_phone text := public.gm_phone_digits(p_phone);
  v_plan  public.gm_plans;
  v_store public.gm_stores;
  v_ref   text := upper(left(regexp_replace(trim(coalesce(p_reference, '')), '\s+', '', 'g'), 80));
  v_sale  public.gm_card_sales;
begin
  if v_phone !~ '^[0-9]{8,15}$' then
    raise exception 'Numéro WhatsApp invalide : indicatif du pays compris (ex. +223 70 00 00 00).';
  end if;
  if v_phone = public.gm_phone_digits((select value from public.gm_config where key = 'whatsapp_number')) then
    raise exception 'C''est le numéro d''Eden Dev : tapez celui du client.';
  end if;
  select * into v_plan from public.gm_plans where code = p_plan and active and code <> 'free';
  if not found then
    raise exception 'Formule inconnue.';
  end if;
  if p_months is null or p_months not in (1, 3, 6, 12) then
    raise exception 'Durée : 1, 3, 6 ou 12 mois.';
  end if;
  if p_method not in ('orange_money', 'wave', 'moov_money', 'especes', 'virement', 'autre', 'offert') then
    raise exception 'Moyen de paiement inconnu.';
  end if;
  if p_method in ('orange_money', 'wave', 'moov_money') and length(v_ref) < 4 then
    raise exception 'Saisissez l''ID de la transaction (reçu par SMS).';
  end if;
  if p_method = 'offert' and v_admin.role <> 'direction' then
    raise exception 'Une carte offerte est réservée à la Direction.';
  end if;
  if v_ref <> '' and (exists (select 1 from public.gm_card_sales where upper(reference) = v_ref and method = p_method and status <> 'cancelled')
                      or exists (select 1 from public.gm_payments where upper(reference) = v_ref and method = p_method and status <> 'refused')) then
    raise exception 'Cet ID de transaction a déjà servi.';
  end if;
  if coalesce(trim(p_store_code), '') <> '' then
    select * into v_store from public.gm_stores where code = upper(trim(p_store_code));
    if not found then
      raise exception 'Boutique % introuvable.', upper(trim(p_store_code));
    end if;
  end if;
  insert into public.gm_card_sales (created_by, seller_email, phone, client_name, plan_code, months, amount, method, reference, store_id)
  values (v_admin.user_id, v_admin.email, v_phone, left(trim(coalesce(p_name, '')), 80), v_plan.code, p_months,
          case when p_method = 'offert' then 0 else v_plan.price_month * public.gm_billed_months(p_months) end,
          p_method, v_ref, v_store.id)
  returning * into v_sale;
  perform public.gm_admin_log(v_admin, 'Carte vendue par WhatsApp', coalesce(v_store.code, '+' || v_phone), p_method,
    jsonb_build_object('sale_id', v_sale.id, 'phone', v_phone, 'plan', v_plan.code, 'months', p_months, 'amount', v_sale.amount, 'reference', v_ref));
  return jsonb_build_object('id', v_sale.id, 'phone', v_phone, 'amount', v_sale.amount,
                            'window_open', public.gm_whatsapp_window_open(v_phone));
end;
$$;

create or replace function public.gm_console_card_sales(p_device text, p_status text default '', p_search text default '')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin public.gm_admins := public.gm_admin_ctx(p_device);
  v_q     text := lower(trim(coalesce(p_search, '')));
  v_d     text := regexp_replace(coalesce(p_search, ''), '\D', '', 'g');
begin
  return (
    select coalesce(jsonb_agg(row_to_json(q)::jsonb order by q.created_at desc), '[]'::jsonb)
    from (
      select c.id, c.created_at, c.seller_email, c.phone, c.client_name, c.plan_code as plan, pl.label as plan_label, c.months,
             c.amount, c.method, c.reference, c.status, c.last_error, c.sent_at, c.delivered_at, c.read_at, c.used_at, c.confirmed_at,
             v.serial, s.code as store_code, u.code as used_by_code,
             public.gm_whatsapp_window_open(c.phone) as window_open,
             (select last_inbound_at from public.gm_whatsapp_contacts w where w.phone = c.phone) as last_inbound_at
      from public.gm_card_sales c
      join public.gm_plans pl on pl.code = c.plan_code
      left join public.gm_vouchers v on v.id = c.voucher_id
      left join public.gm_stores s on s.id = c.store_id
      left join public.gm_stores u on u.id = v.store_id
      where (coalesce(p_status, '') = '' or c.status = p_status
             or (p_status = 'open' and c.status in ('waiting', 'sending', 'failed')))
        and (v_q = '' or lower(c.client_name) like '%' || v_q || '%' or lower(coalesce(v.serial, '')) like '%' || v_q || '%'
             or lower(coalesce(s.code, '')) like '%' || v_q || '%' or (length(v_d) >= 4 and c.phone like '%' || v_d || '%'))
      order by c.created_at desc
      limit 500
    ) q);
end;
$$;

-- Renvoyer (l'ancienne carte devient inutilisable, une nouvelle part) ou annuler une vente.
create or replace function public.gm_console_card_sale_action(p_device text, p_sale_id uuid, p_action text, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin  public.gm_admins := public.gm_admin_ctx(p_device, array['paiements']);
  v_reason text := public.gm_admin_reason(p_reason);
  v_sale   public.gm_card_sales;
begin
  select * into v_sale from public.gm_card_sales where id = p_sale_id for update;
  if not found then
    raise exception 'Vente introuvable.';
  end if;
  if v_sale.status in ('used', 'cancelled') then
    raise exception 'Cette carte est déjà utilisée ou annulée.';
  end if;
  if v_sale.status = 'sending' and v_sale.sending_at > now() - interval '2 minutes' then
    raise exception 'Envoi en cours : patientez une minute.';
  end if;
  if v_sale.voucher_id is not null then
    update public.gm_vouchers set status = 'cancelled', note = left(trim(note || ' — annulée : ' || v_reason), 200)
     where id = v_sale.voucher_id and status <> 'used';
    if exists (select 1 from public.gm_vouchers where id = v_sale.voucher_id and status = 'used') then
      raise exception 'Le client vient d''utiliser cette carte.';
    end if;
  end if;
  if p_action = 'resend' then
    update public.gm_card_sales set status = 'waiting', voucher_id = null, wa_message_id = null, last_error = '',
           sending_at = null, sent_at = null, delivered_at = null, read_at = null
     where id = v_sale.id;
  elsif p_action = 'cancel' then
    update public.gm_card_sales set status = 'cancelled', last_error = 'Annulée : ' || v_reason where id = v_sale.id;
  else
    raise exception 'Action inconnue.';
  end if;
  perform public.gm_admin_log(v_admin, case when p_action = 'resend' then 'Carte WhatsApp renvoyée' else 'Vente de carte annulée' end,
    '+' || v_sale.phone, v_reason, jsonb_build_object('sale_id', v_sale.id));
  return jsonb_build_object('ok', true);
end;
$$;

-- ───────────────────────────── Envoi par WhatsApp (fonction « gm-cartes », service_role) ─────────────────────────────

-- Ventes à envoyer maintenant : client qui a écrit dans les 24 heures (sinon la vente attend son message).
create or replace function public.gm_card_sales_claim(p_phone text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ids jsonb;
begin
  -- Fonction arrêtée entre la fabrication de la carte et l'envoi : à vérifier par Eden Dev (« Annuler et renvoyer »).
  update public.gm_card_sales set status = 'failed', last_error = 'Envoi non confirmé : vérifiez avec le client, puis « Annuler et renvoyer ».'
   where status = 'sending' and sending_at < now() - interval '10 minutes';
  with c as (
    select s.id from public.gm_card_sales s
    where s.status = 'waiting' and (p_phone is null or s.phone = p_phone) and public.gm_whatsapp_window_open(s.phone)
    order by s.created_at
    limit 20
    for update skip locked
  ), u as (
    update public.gm_card_sales s set status = 'sending', sending_at = now(), attempts = s.attempts + 1
    from c where s.id = c.id
    returning s.id
  )
  select coalesce(jsonb_agg(id), '[]'::jsonb) into v_ids from u;
  return v_ids;
end;
$$;

-- Fabrique la carte au moment de l'envoi : le code est rendu à « gm-cartes » seulement, jamais gardé en clair.
create or replace function public.gm_card_sale_issue(p_sale_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_sale   public.gm_card_sales;
  v_plan   public.gm_plans;
  v_store  public.gm_stores;
  v_alpha  text := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  v_bytes  bytea;
  v_code   text := '';
  v_batch  text := 'WA' || to_char(now(), 'YYMMDD');
  v_n      int;
  v_serial text;
  v_vid    uuid;
  j        int;
begin
  select * into v_sale from public.gm_card_sales where id = p_sale_id for update;
  if not found or v_sale.status <> 'sending' or v_sale.voucher_id is not null then
    return jsonb_build_object('ok', false, 'error', 'Vente déjà traitée.');
  end if;
  select * into v_plan from public.gm_plans where code = v_sale.plan_code;
  perform pg_advisory_xact_lock(hashtext('gm_voucher_batch|' || v_batch));
  select count(*) into v_n from public.gm_vouchers where batch = v_batch;
  v_serial := v_batch || '-' || lpad((v_n + 1)::text, 4, '0');
  v_bytes := extensions.gen_random_bytes(16);
  for j in 0..15 loop
    v_code := v_code || substr(v_alpha, get_byte(v_bytes, j) % 32 + 1, 1);
  end loop;
  insert into public.gm_vouchers (serial, code_hash, plan_code, months, batch, status, sold_at, note, bound_store_id, sale_id)
  values (v_serial, public.gm_voucher_hash(v_code), v_sale.plan_code, v_sale.months, v_batch, 'sold', now(),
          left('WhatsApp +' || v_sale.phone || coalesce(' — ' || nullif(v_sale.client_name, ''), ''), 200), v_sale.store_id, v_sale.id)
  returning id into v_vid;
  update public.gm_card_sales set voucher_id = v_vid where id = v_sale.id;
  if v_sale.store_id is not null then
    select * into v_store from public.gm_stores where id = v_sale.store_id;
  end if;
  return jsonb_build_object('ok', true, 'phone', v_sale.phone, 'name', v_sale.client_name, 'serial', v_serial,
    'code', substr(v_code, 1, 4) || '-' || substr(v_code, 5, 4) || '-' || substr(v_code, 9, 4) || '-' || substr(v_code, 13, 4),
    'plan_label', v_plan.label, 'months', v_sale.months, 'store_code', v_store.code, 'store_name', v_store.name);
end;
$$;

create or replace function public.gm_card_sale_sent(p_sale_id uuid, p_message_id text)
returns void
language sql
security definer
set search_path = public
as $$
  update public.gm_card_sales set status = 'sent', sent_at = now(), wa_message_id = nullif(p_message_id, ''), last_error = ''
   where id = p_sale_id and status = 'sending';
$$;

-- Envoi refusé par Meta : la carte fabriquée est annulée (le client ne l'a pas reçue). Fenêtre fermée : la vente attend.
create or replace function public.gm_card_sale_failed(p_sale_id uuid, p_code int, p_error text, p_retry boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sale public.gm_card_sales;
begin
  select * into v_sale from public.gm_card_sales where id = p_sale_id for update;
  if not found then
    return;
  end if;
  if v_sale.voucher_id is not null then
    update public.gm_vouchers set status = 'cancelled', note = left(trim(note || ' — non envoyée'), 200)
     where id = v_sale.voucher_id and status <> 'used';
  end if;
  update public.gm_card_sales
     set status = case when p_retry then 'waiting' else 'failed' end, voucher_id = null, wa_message_id = null,
         last_error = left(coalesce(p_error, '') || case when p_code is not null and p_code <> 0 then ' (' || p_code || ')' else '' end, 300)
   where id = v_sale.id;
end;
$$;

-- Accusés de WhatsApp (gm-whatsapp-webhook) : remis, lu, ou non remis.
create or replace function public.gm_card_sale_wa_status(p_message_id text, p_status text, p_code int default null, p_error text default '')
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sale public.gm_card_sales;
begin
  select * into v_sale from public.gm_card_sales where wa_message_id = p_message_id for update;
  if not found then
    return;
  end if;
  if p_status = 'delivered' then
    update public.gm_card_sales set delivered_at = coalesce(delivered_at, now()),
           status = case when status = 'sent' then 'delivered' else status end
     where id = v_sale.id;
  elsif p_status = 'read' then
    update public.gm_card_sales set read_at = coalesce(read_at, now()), delivered_at = coalesce(delivered_at, now()),
           status = case when status in ('sent', 'delivered') then 'read' else status end
     where id = v_sale.id;
  elsif p_status = 'failed' and v_sale.status in ('sent', 'delivered') then
    -- Message non remis (fenêtre de 24 heures fermée…) : la carte est annulée et la vente repart en attente.
    perform public.gm_card_sale_failed(v_sale.id, p_code, coalesce(nullif(p_error, ''), 'Message non remis par WhatsApp'), p_code = 131047);
  end if;
end;
$$;

-- Confirmations d'activation à envoyer (cartes vendues par WhatsApp, utilisées depuis moins de 7 jours).
create or replace function public.gm_card_confirm_claim()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows jsonb;
begin
  with c as (
    select s.id from public.gm_card_sales s
    where s.status = 'used' and s.confirmed_at is null and s.used_at > now() - interval '7 days'
      and public.gm_whatsapp_window_open(s.phone)
    limit 20
    for update skip locked
  ), u as (
    update public.gm_card_sales s set confirmed_at = now() from c where s.id = c.id
    returning s.id, s.phone, s.voucher_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'phone', u.phone, 'store_code', st.code, 'store_name', st.name, 'plan_label', pl.label,
           'ends_at', public.gm_store_chain_end(st.id, cur.plan_code))), '[]'::jsonb)
    into v_rows
  from u
  join public.gm_vouchers v on v.id = u.voucher_id
  join public.gm_stores st on st.id = v.store_id
  left join lateral (select * from public.gm_store_current(st.id)) cur on true
  left join public.gm_plans pl on pl.code = cur.plan_code;
  return v_rows;
end;
$$;

-- Appel de « gm-cartes » sans attendre (carte utilisée : confirmation au client).
create or replace function public.gm_cartes_ping()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform net.http_post(
    url := 'https://wpuchfnyuyujdflbmqpn.supabase.co/functions/v1/gm-cartes',
    body := jsonb_build_object('action', 'flush'),
    headers := jsonb_build_object('Content-Type', 'application/json'),
    timeout_milliseconds := 10000);
exception when others then
  null;
end;
$$;

-- ───────────────────────────── Licences ─────────────────────────────

create or replace function public.gm_console_licences(p_device text, p_search text default '')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin public.gm_admins := public.gm_admin_ctx(p_device);
  v_q     text := lower(trim(coalesce(p_search, '')));
begin
  return (
    select coalesce(jsonb_agg(row_to_json(q)::jsonb order by q.expires_at), '[]'::jsonb)
    from (
      select l.pc_id, l.plan_code as plan, pl.label as plan_label, l.max_postes, l.expires_at, l.issued_at, l.file_path,
             s.id as store_id, s.code as store_code, s.name as store_name,
             pc.hostname, pc.app_version, pc.last_seen, pc.slot
      from public.gm_licenses l
      join public.gm_stores s on s.id = l.store_id
      join public.gm_plans pl on pl.code = l.plan_code
      left join public.gm_store_pcs pc on pc.pc_id = l.pc_id
      where l.status = 'valid'
        and (v_q = '' or lower(s.code) like '%' || v_q || '%' or lower(s.name) like '%' || v_q || '%'
             or lower(l.pc_id) like '%' || replace(v_q, '-', '') || '%' or lower(coalesce(pc.hostname, '')) like '%' || v_q || '%')
      order by l.expires_at
      limit 500
    ) q);
end;
$$;

-- Licence d'un PC refaite : la console appelle ensuite « gm-license » et peut télécharger le fichier signé.
create or replace function public.gm_console_licence_reissue(p_device text, p_pc_id text, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin  public.gm_admins := public.gm_admin_ctx(p_device, array['assistance']);
  v_reason text := public.gm_admin_reason(p_reason);
  v_pc     text := upper(regexp_replace(coalesce(p_pc_id, ''), '[^0-9A-Za-z]', '', 'g'));
  v_store  public.gm_stores;
begin
  select s.* into v_store from public.gm_store_pcs pc join public.gm_stores s on s.id = pc.store_id where pc.pc_id = v_pc;
  if not found then
    raise exception 'PC % introuvable.', p_pc_id;
  end if;
  update public.gm_licenses set status = 'replaced' where pc_id = v_pc and status = 'valid';
  insert into public.gm_license_events (store_id, kind, detail)
  values (v_store.id, 'licence_reset', jsonb_build_object('pc_id', v_pc, 'by', v_admin.email));
  perform public.gm_admin_log(v_admin, 'Licence refaite', v_store.code, v_reason, jsonb_build_object('pc_id', v_pc));
  return jsonb_build_object('ok', true, 'pc_id', v_pc);
end;
$$;

-- ───────────────────────────── Réglages ─────────────────────────────

create or replace function public.gm_console_settings(p_device text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin public.gm_admins := public.gm_admin_ctx(p_device);
begin
  return jsonb_build_object(
    'config', (select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) from public.gm_config
               where key in ('om_merchant_code', 'om_merchant_name', 'om_qr_payload', 'wave_merchant_number', 'wave_merchant_name',
                             'moov_merchant_number', 'moov_merchant_name', 'trial_days', 'trial_plan', 'card_enabled',
                             'whatsapp_enabled', 'whatsapp_number', 'payment_instructions', 'console_owner_email')),
    'plans', (select coalesce(jsonb_agg(jsonb_build_object('code', code, 'label', label, 'price_month', price_month,
                                                           'max_postes', max_postes, 'active', active, 'description', description)
                                        order by sort), '[]'::jsonb) from public.gm_plans),
    'whatsapp_ready', exists (select 1 from public.gm_whatsapp_contacts where last_inbound_at > now() - interval '30 days')
  );
end;
$$;

create or replace function public.gm_console_setting_set(p_device text, p_key text, p_value text, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin  public.gm_admins := public.gm_admin_ctx(p_device, array['direction']);
  v_reason text := public.gm_admin_reason(p_reason);
  v_value  text := trim(coalesce(p_value, ''));
  v_old    text;
begin
  if p_key not in ('om_merchant_code', 'om_merchant_name', 'om_qr_payload', 'wave_merchant_number', 'wave_merchant_name',
                   'moov_merchant_number', 'moov_merchant_name', 'trial_days', 'trial_plan', 'card_enabled',
                   'whatsapp_enabled', 'payment_instructions') then
    raise exception 'Réglage non modifiable depuis la console.';
  end if;
  if p_key = 'trial_days' and (v_value !~ '^[0-9]{1,2}$' or v_value::int > 60) then
    raise exception 'Durée de l''essai : de 0 à 60 jours.';
  end if;
  if p_key = 'trial_plan' and not exists (select 1 from public.gm_plans where code = v_value and code <> 'free') then
    raise exception 'Formule d''essai inconnue.';
  end if;
  if p_key in ('card_enabled', 'whatsapp_enabled') and v_value not in ('true', 'false') then
    raise exception 'Valeur attendue : oui ou non.';
  end if;
  if p_key in ('wave_merchant_number', 'moov_merchant_number') and v_value <> '' and v_value !~ '^\+?[0-9 ]{8,20}$' then
    raise exception 'Numéro invalide.';
  end if;
  select value into v_old from public.gm_config where key = p_key;
  insert into public.gm_config (key, value) values (p_key, left(v_value, 2000))
  on conflict (key) do update set value = excluded.value;
  perform public.gm_admin_log(v_admin, 'Réglage modifié', p_key, v_reason,
    jsonb_build_object('before', left(coalesce(v_old, ''), 200), 'after', left(v_value, 200)));
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.gm_console_plan_set(p_device text, p_code text, p_price_month int, p_max_postes int, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin  public.gm_admins := public.gm_admin_ctx(p_device, array['direction']);
  v_reason text := public.gm_admin_reason(p_reason);
  v_old    public.gm_plans;
begin
  select * into v_old from public.gm_plans where code = p_code for update;
  if not found or p_code = 'free' then
    raise exception 'Formule inconnue.';
  end if;
  if p_price_month is null or p_price_month < 0 or p_price_month > 10000000 then
    raise exception 'Prix invalide.';
  end if;
  if p_max_postes is null or p_max_postes < 1 or p_max_postes > 50 then
    raise exception 'Nombre de postes : de 1 à 50.';
  end if;
  update public.gm_plans set price_month = p_price_month, max_postes = p_max_postes where code = p_code;
  perform public.gm_admin_log(v_admin, 'Formule modifiée', p_code, v_reason,
    jsonb_build_object('before', jsonb_build_object('price_month', v_old.price_month, 'max_postes', v_old.max_postes),
                       'after', jsonb_build_object('price_month', p_price_month, 'max_postes', p_max_postes)));
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.gm_console_journal(p_device text, p_search text default '', p_limit int default 200)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin public.gm_admins := public.gm_admin_ctx(p_device);
  v_q     text := lower(trim(coalesce(p_search, '')));
begin
  return (
    select coalesce(jsonb_agg(row_to_json(q)::jsonb order by q.at desc), '[]'::jsonb)
    from (
      select j.id, j.at, j.email, j.role, j.action, j.target, j.reason, j.detail
      from public.gm_admin_journal j
      where (v_admin.role = 'direction' or j.user_id = v_admin.user_id)
        and (v_q = '' or lower(j.action) like '%' || v_q || '%' or lower(j.target) like '%' || v_q || '%'
             or lower(j.reason) like '%' || v_q || '%' or lower(j.email) like '%' || v_q || '%')
      order by j.at desc
      limit greatest(1, least(coalesce(p_limit, 200), 1000))
    ) q);
end;
$$;

-- ───────────────────────────── Droits d'exécution ─────────────────────────────

do $$
declare
  f text;
begin
  -- Fonctions internes : jamais appelées depuis l'extérieur.
  foreach f in array array[
    'gm_admin_journal_lock()', 'gm_admin_token_hash(text)', 'gm_admin_reason(text)', 'gm_role_label(text)',
    'gm_admin_ctx(text, text[])', 'gm_admin_log(public.gm_admins, text, text, text, jsonb)',
    'gm_store_current(uuid)', 'gm_store_chain_end(uuid, text)', 'gm_phone_digits(text)', 'gm_cartes_ping()']
  loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;
  -- Réservées à la fonction « gm-cartes » et au webhook WhatsApp (service_role).
  foreach f in array array[
    'gm_card_sales_claim(text)', 'gm_card_sale_issue(uuid)', 'gm_card_sale_sent(uuid, text)',
    'gm_card_sale_failed(uuid, integer, text, boolean)', 'gm_card_sale_wa_status(text, text, integer, text)', 'gm_card_confirm_claim()']
  loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
  -- Console : comptes connectés seulement ; chaque fonction vérifie administrateur, 2 étapes, appareil et rôle.
  foreach f in array array[
    'gm_console_me(text, text, text, text)', 'gm_console_devices(text)', 'gm_console_device_set(text, uuid, text, text)',
    'gm_console_admins(text)', 'gm_console_admin_set(text, text, text, boolean, text, text)', 'gm_console_dashboard(text)',
    'gm_console_stores(text, text, text)', 'gm_console_store(text, uuid)', 'gm_console_store_action(text, uuid, text, jsonb, text)',
    'gm_console_payments(text, text, text, text, date, date)', 'gm_console_payment_decide(text, uuid, text, text)',
    'gm_console_vouchers(text, text, text, text)', 'gm_console_voucher_batch(text, text, integer, integer, text, text)',
    'gm_console_voucher_set(text, uuid[], text, text, text)',
    'gm_console_card_sell(text, text, text, text, integer, text, text, text)', 'gm_console_card_sales(text, text, text)',
    'gm_console_card_sale_action(text, uuid, text, text)', 'gm_console_licences(text, text)',
    'gm_console_licence_reissue(text, text, text)', 'gm_console_settings(text)', 'gm_console_setting_set(text, text, text, text)',
    'gm_console_plan_set(text, text, integer, integer, text)', 'gm_console_journal(text, text, integer)']
  loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end;
$$;


revoke all on table public.gm_admins, public.gm_admin_devices, public.gm_admin_journal, public.gm_card_sales from anon, authenticated;
