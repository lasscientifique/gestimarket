-- GestiMarket 0.34 « Sécurité » (avec la Console Eden Dev 1.1 : console_eden_dev_1_1.sql, à appliquer ensuite).
--
-- 1. Journal des comptes (gm_journal_comptes), chez Eden Dev, gardé 6 mois :
--    - inscriptions, comptes confirmés, mots de passe changés ou oubliés, e-mails et numéros changés, comptes effacés
--      (déclencheur sur auth.users) ;
--    - connexions avec la date, l'adresse IP, le type d'appareil et la manière (mot de passe, code, Google Authenticator)
--      (déclencheur sur auth.mfa_amr_claims : une ligne par connexion ouverte par Supabase Auth) ;
--    - vérification à 2 étapes ajoutée ou retirée (auth.mfa_factors) ;
--    - mots de passe et codes faux, signalés par GestiMarket 0.34 et la console (gm_report_auth_failure) : indicatif,
--      seul le logiciel les voit ;
--    - codes envoyés sur WhatsApp, et refusés au-delà de 6 par heure et par numéro (gm_whatsapp_code_check).
--    Jamais : ventes, produits, stocks, clients, ni les mots de passe ou les codes eux-mêmes.
--    Les déclencheurs ne bloquent jamais Supabase Auth : toute erreur du journal est ignorée.
-- 2. CinetPay (paiement direct Orange Money, Moov Money, carte) : nouvelle API REST de CinetPay (2026), fonction
--    « gm-cinetpay ». Fermé tant que gm_config.cinetpay_enabled ≠ 'true' (réglé dans la Console Eden Dev).

-- ───────────────────────────── Journal des comptes ─────────────────────────────

create table if not exists public.gm_journal_comptes (
  id      bigint generated always as identity primary key,
  at      timestamptz not null default now(),
  user_id uuid,                                 -- compte Supabase (sans clé étrangère : la ligne reste si le compte est effacé)
  login   text not null default '',             -- e-mail en minuscules, ou numéro sans « + » (22376000000)
  kind    text not null,
  ip      inet,
  device  text not null default '',             -- type d'appareil lisible (« GestiMarket 0.34.0 · PC Windows »…)
  agent   text not null default '',             -- en-tête User-Agent, 200 caractères au plus
  source  text not null default 'base',         -- base, gestimarket, console, whatsapp
  detail  jsonb not null default '{}'::jsonb
);
create index if not exists gm_journal_comptes_at on public.gm_journal_comptes (at desc);
create index if not exists gm_journal_comptes_user on public.gm_journal_comptes (user_id, at desc);
create index if not exists gm_journal_comptes_login on public.gm_journal_comptes (login, at desc);
create index if not exists gm_journal_comptes_kind on public.gm_journal_comptes (kind, at desc);
create index if not exists gm_journal_comptes_ip on public.gm_journal_comptes (ip, at desc) where ip is not null;
alter table public.gm_journal_comptes enable row level security;
revoke all on table public.gm_journal_comptes from public, anon, authenticated;

-- Identifiant d'un compte tel qu'il est gardé : e-mail en minuscules, ou chiffres du numéro (avec l'indicatif).
create or replace function public.gm_login_key(p text)
returns text
language sql
immutable
set search_path = public
as $$
  select case when position('@' in coalesce(p, '')) > 0 then lower(trim(p))
              else public.gm_phone_digits(p) end
$$;

-- Type d'appareil lisible à partir de l'en-tête User-Agent.
create or replace function public.gm_ua_device(p text)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  v    text := coalesce(p, '');
  m    text[];
  plat text;
begin
  if v = '' then
    return '';
  end if;
  m := regexp_match(v, '^GestiMarket/([0-9A-Za-z.+-]{1,20})(?: \(([a-z0-9_]+))?');
  if m is not null then
    plat := case m[2] when 'windows' then 'PC Windows' when 'android' then 'Android' when 'ios' then 'iPhone / iPad'
                      when 'macos' then 'Mac' when 'linux' then 'PC Linux' else coalesce(m[2], '?') end;
    return 'GestiMarket ' || m[1] || ' · ' || plat;
  end if;
  return case
    when v ~* '^ureq/' then 'GestiMarket 0.33 ou avant'
    when v ~* '^Dart/' then 'Ancienne application mobile'
    when v ~* 'Deno|supabase-edge|^node' then 'Service Eden Dev'
    when v ~* 'iPhone|iPad' then 'iPhone / iPad · navigateur'
    when v ~* 'Android' then 'Android · navigateur'
    when v ~* 'Windows' then 'PC Windows · navigateur ou console'
    when v ~* 'Macintosh|Mac OS' then 'Mac · navigateur'
    when v ~* 'Linux' then 'PC Linux · navigateur'
    else 'Autre (' || left(v, 40) || ')' end;
end;
$$;

-- Adresse IP et User-Agent de la requête en cours (appel par l'API de Supabase : en-têtes transmis par PostgREST).
create or replace function public.gm_request_ip()
returns inet
language plpgsql
stable
set search_path = public
as $$
declare
  h jsonb;
  v text;
begin
  h := nullif(current_setting('request.headers', true), '')::jsonb;
  v := coalesce(h ->> 'cf-connecting-ip', split_part(coalesce(h ->> 'x-forwarded-for', ''), ',', 1), h ->> 'x-real-ip', '');
  return nullif(trim(v), '')::inet;
exception when others then
  return null;
end;
$$;

create or replace function public.gm_request_agent()
returns text
language plpgsql
stable
set search_path = public
as $$
begin
  return left(coalesce(nullif(current_setting('request.headers', true), '')::jsonb ->> 'user-agent', ''), 200);
exception when others then
  return '';
end;
$$;

-- Ligne du journal (fonctions et déclencheurs internes).
create or replace function public.gm_jc_add(p_user uuid, p_login text, p_kind text, p_ip inet, p_agent text, p_source text, p_detail jsonb)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.gm_journal_comptes (user_id, login, kind, ip, device, agent, source, detail)
  values (p_user, left(coalesce(p_login, ''), 120), p_kind, p_ip, public.gm_ua_device(p_agent), left(coalesce(p_agent, ''), 200),
          coalesce(p_source, 'base'), coalesce(p_detail, '{}'::jsonb));
$$;

-- Comptes : inscription, confirmation, mot de passe, e-mail, numéro, effacement. L'adresse IP est celle de la
-- dernière session du compte (Supabase Auth ne la donne pas ici) : indiquée « adresse de la dernière session ».
create or replace function public.gm_jc_users()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_login text;
  v_ip    inet;
  v_ua    text;
  v_sess  boolean := false;
begin
  begin
    if tg_op = 'DELETE' then
      perform public.gm_jc_add(old.id, coalesce(lower(old.email), old.phone, ''), 'compte_supprime', null, '', 'base', '{}'::jsonb);
      return null;
    end if;
    v_login := coalesce(nullif(lower(new.email), ''), new.phone, '');
    if tg_op = 'INSERT' then
      perform public.gm_jc_add(new.id, v_login, 'inscription', null, '', 'base',
        jsonb_build_object('avec', case when coalesce(new.email, '') <> '' then 'email' else 'whatsapp' end,
                           'boutique', left(coalesce(new.raw_user_meta_data ->> 'shop_name', ''), 80)));
      return null;
    end if;
    select s.ip, s.user_agent into v_ip, v_ua from auth.sessions s
    where s.user_id = new.id order by coalesce(s.refreshed_at, s.updated_at, s.created_at) desc limit 1;
    v_sess := found;
    if (old.email_confirmed_at is null and new.email_confirmed_at is not null)
       or (old.phone_confirmed_at is null and new.phone_confirmed_at is not null and coalesce(old.phone, '') = coalesce(new.phone, '')) then
      perform public.gm_jc_add(new.id, v_login, 'compte_confirme', null, '', 'base', '{}'::jsonb);
    end if;
    if new.encrypted_password is distinct from old.encrypted_password and coalesce(old.encrypted_password, '') <> '' then
      perform public.gm_jc_add(new.id, v_login, 'mot_de_passe_change', v_ip, coalesce(v_ua, ''), 'base',
        jsonb_build_object('adresse', case when v_sess then 'dernière session' end));
    end if;
    if new.recovery_sent_at is distinct from old.recovery_sent_at and new.recovery_sent_at is not null then
      perform public.gm_jc_add(new.id, v_login, 'mot_de_passe_oublie', null, '', 'base', '{}'::jsonb);
    end if;
    if lower(coalesce(new.email, '')) is distinct from lower(coalesce(old.email, '')) then
      perform public.gm_jc_add(new.id, v_login, 'email_change', v_ip, coalesce(v_ua, ''), 'base',
        jsonb_build_object('avant', lower(coalesce(old.email, '')), 'apres', lower(coalesce(new.email, '')),
                           'adresse', case when v_sess then 'dernière session' end));
    end if;
    if coalesce(new.email_change, '') <> '' and coalesce(new.email_change, '') is distinct from coalesce(old.email_change, '') then
      perform public.gm_jc_add(new.id, v_login, 'email_change_demande', v_ip, coalesce(v_ua, ''), 'base',
        jsonb_build_object('nouvelle', lower(new.email_change)));
    end if;
    if coalesce(new.phone, '') is distinct from coalesce(old.phone, '') then
      perform public.gm_jc_add(new.id, v_login, 'numero_change', v_ip, coalesce(v_ua, ''), 'base',
        jsonb_build_object('avant', coalesce(old.phone, ''), 'apres', coalesce(new.phone, ''),
                           'adresse', case when v_sess then 'dernière session' end));
    end if;
  exception when others then
    null; -- le journal ne bloque jamais la connexion ni l'inscription
  end;
  return null;
end;
$$;

drop trigger if exists gm_jc_users on auth.users;
create trigger gm_jc_users after insert or update or delete on auth.users
  for each row execute function public.gm_jc_users();

-- Connexions : chaque session ouverte reçoit une « manière de se connecter » (mot de passe, code, Google
-- Authenticator…). L'adresse IP et le User-Agent sont ceux de la session.
create or replace function public.gm_jc_amr()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_s     record;
  v_login text;
begin
  begin
    select s.user_id, s.ip, s.user_agent, s.aal into v_s from auth.sessions s where s.id = new.session_id;
    if found then
      select coalesce(nullif(lower(u.email), ''), u.phone, '') into v_login from auth.users u where u.id = v_s.user_id;
      perform public.gm_jc_add(v_s.user_id, v_login,
        case when new.authentication_method = 'totp' then 'verification_2_etapes' else 'connexion' end,
        v_s.ip, coalesce(v_s.user_agent, ''), 'base',
        jsonb_build_object('par', new.authentication_method::text, 'session', left(new.session_id::text, 8)));
    end if;
  exception when others then
    null;
  end;
  return null;
end;
$$;

drop trigger if exists gm_jc_amr on auth.mfa_amr_claims;
create trigger gm_jc_amr after insert on auth.mfa_amr_claims
  for each row execute function public.gm_jc_amr();

-- Vérification à 2 étapes (Google Authenticator) ajoutée ou retirée. Retrait fait par la Direction depuis la console :
-- gm.mfa_reset_by (réglage local à la transaction) donne son adresse.
create or replace function public.gm_jc_factors()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_login text;
  v_by    text := coalesce(nullif(current_setting('gm.mfa_reset_by', true), ''), '');
begin
  begin
    if tg_op = 'DELETE' then
      if old.status::text = 'verified' then
        select coalesce(nullif(lower(u.email), ''), u.phone, '') into v_login from auth.users u where u.id = old.user_id;
        perform public.gm_jc_add(old.user_id, v_login, 'verification_2_etapes_retiree', null, '', 'base',
          jsonb_build_object('nom', coalesce(old.friendly_name, ''), 'par', v_by));
      end if;
    elsif new.status::text = 'verified' then
      if tg_op = 'INSERT' then
        null;
      elsif old.status::text = 'verified' then
        return null;
      end if;
      select coalesce(nullif(lower(u.email), ''), u.phone, '') into v_login from auth.users u where u.id = new.user_id;
      perform public.gm_jc_add(new.user_id, v_login, 'verification_2_etapes_ajoutee', null, '', 'base',
        jsonb_build_object('nom', coalesce(new.friendly_name, '')));
    end if;
  exception when others then
    null;
  end;
  return null;
end;
$$;

drop trigger if exists gm_jc_factors on auth.mfa_factors;
create trigger gm_jc_factors after insert or update or delete on auth.mfa_factors
  for each row execute function public.gm_jc_factors();

-- Mot de passe faux ou code faux, signalé par GestiMarket (0.34 et suivants) ou par la console. Indicatif : seul le
-- logiciel les voit. Au plus 60 signalements par heure et par adresse IP, 3 000 par heure en tout.
--   p : { login, kind (mot_de_passe_faux | code_faux | code_2_etapes_faux), app (gestimarket | console), version, platform }
create or replace function public.gm_report_auth_failure(p jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_kind  text := coalesce(p ->> 'kind', '');
  v_app   text := case when p ->> 'app' = 'console' then 'console' else 'gestimarket' end;
  v_login text := public.gm_login_key(left(coalesce(p ->> 'login', ''), 120));
  v_ip    inet := public.gm_request_ip();
  v_ua    text := public.gm_request_agent();
  v_user  uuid;
begin
  if v_kind not in ('mot_de_passe_faux', 'code_faux', 'code_2_etapes_faux') or length(v_login) < 6 then
    return;
  end if;
  if (select count(*) from public.gm_journal_comptes
      where source in ('gestimarket', 'console') and at > now() - interval '1 hour' and ip is not distinct from v_ip) >= 60 then
    return;
  end if;
  if (select count(*) from public.gm_journal_comptes where source in ('gestimarket', 'console') and at > now() - interval '1 hour') >= 3000 then
    return;
  end if;
  select id into v_user from auth.users
  where (position('@' in v_login) > 0 and lower(email) = v_login) or (position('@' in v_login) = 0 and phone = v_login)
  limit 1;
  -- Compte inconnu : l'identifiant tapé n'est gardé qu'en partie.
  if v_user is null then
    v_login := case when position('@' in v_login) > 0 then left(v_login, 2) || '…@' || split_part(v_login, '@', 2)
                    else left(v_login, 5) || '…' || right(v_login, 2) end;
  end if;
  insert into public.gm_journal_comptes (user_id, login, kind, ip, device, agent, source, detail)
  values (v_user, v_login, v_kind, v_ip,
          case when v_app = 'console' then 'Console Eden Dev · ' || coalesce(nullif(left(p ->> 'platform', 20), ''), '?')
               else public.gm_ua_device(v_ua) end,
          v_ua, v_app,
          jsonb_build_object('version', left(coalesce(p ->> 'version', ''), 20), 'platform', left(coalesce(p ->> 'platform', ''), 20),
                             'compte_connu', v_user is not null));
end;
$$;

-- Codes envoyés sur WhatsApp (fonction gm-whatsapp) : 6 par heure et par numéro au plus (le premier et 5 renvois).
-- Rend { allowed, minutes } : minutes à attendre quand l'envoi est refusé.
create or replace function public.gm_whatsapp_code_check(p_phone text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_phone text := public.gm_phone_digits(p_phone);
  v_n     int;
  v_first timestamptz;
  v_user  uuid;
begin
  select count(*), min(at) into v_n, v_first from public.gm_journal_comptes
  where login = v_phone and kind = 'code_whatsapp' and at > now() - interval '1 hour';
  select id into v_user from auth.users where phone = v_phone limit 1;
  if v_n >= 6 then
    if not exists (select 1 from public.gm_journal_comptes
                   where login = v_phone and kind = 'code_whatsapp_bloque' and at > now() - interval '10 minutes') then
      perform public.gm_jc_add(v_user, v_phone, 'code_whatsapp_bloque', null, '', 'whatsapp', jsonb_build_object('envois_1h', v_n));
    end if;
    return jsonb_build_object('allowed', false, 'minutes', greatest(1, ceil(extract(epoch from (v_first + interval '1 hour' - now())) / 60)::int));
  end if;
  perform public.gm_jc_add(v_user, v_phone, 'code_whatsapp', null, '', 'whatsapp', jsonb_build_object('envoi', v_n + 1));
  return jsonb_build_object('allowed', true, 'minutes', 0);
end;
$$;

-- ───────────────────────────── CinetPay ─────────────────────────────

alter table public.gm_payments drop constraint if exists gm_payments_method_check;
alter table public.gm_payments add constraint gm_payments_method_check
  check (method in ('carte_bon', 'orange_money', 'carte_visa', 'moov_money', 'wave', 'virement', 'especes', 'autre', 'cinetpay'));

insert into public.gm_config (key, value) values ('cinetpay_enabled', 'false') on conflict (key) do nothing;

-- Paiements commencés chez CinetPay : abonnement d'une boutique (payment_id) ou carte de bon vendue par la console (sale_id).
create table if not exists public.gm_cinetpay_orders (
  id                text primary key,             -- merchant_transaction_id envoyé à CinetPay (30 caractères au plus)
  created_at        timestamptz not null default now(),
  payment_id        uuid unique references public.gm_payments(id) on delete set null,
  sale_id           uuid references public.gm_card_sales(id) on delete set null,
  amount            integer not null check (amount > 0),
  currency          text not null default 'XOF',
  status            text not null default 'new' check (status in ('new', 'open', 'success', 'failed', 'expired', 'error')),
  cp_transaction_id text not null default '',
  notify_hash       text not null default '',     -- SHA-256 du notify_token de CinetPay (jamais gardé en clair)
  payment_url       text not null default '',
  cp_status         text not null default '',
  checked_at        timestamptz,
  updated_at        timestamptz not null default now(),
  last_error        text not null default ''
);
create index if not exists gm_cinetpay_orders_open on public.gm_cinetpay_orders (created_at) where status in ('new', 'open');
alter table public.gm_cinetpay_orders enable row level security;
revoke all on table public.gm_cinetpay_orders from public, anon, authenticated;

-- Numéro de commande court et unique : « GM » + date + 10 caractères tirés au sort (22 caractères).
create or replace function public.gm_cinetpay_new_id()
returns text
language sql
volatile
set search_path = public, extensions
as $$
  select 'GM' || to_char(now() at time zone 'UTC', 'YYMMDDHH24MI') || upper(encode(extensions.gen_random_bytes(5), 'hex'))
$$;

-- Abonnement payé par CinetPay : abonnement et paiement « en attente », commande CinetPay (fonction gm-cinetpay).
create or replace function public.gm_cinetpay_start_store(p_store_id uuid, p_plan text, p_months int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_store  public.gm_stores;
  v_plan   public.gm_plans;
  v_sub    uuid;
  v_pay    uuid;
  v_amount int;
  v_id     text := public.gm_cinetpay_new_id();
  v_names  text[];
begin
  if coalesce((select value from public.gm_config where key = 'cinetpay_enabled'), 'false') <> 'true' then
    raise exception 'Le paiement direct (CinetPay) n''est pas encore ouvert : utilisez une carte de bon ou déclarez votre paiement mobile.';
  end if;
  select * into v_store from public.gm_stores where id = p_store_id;
  if not found then
    raise exception 'Boutique introuvable.';
  end if;
  if v_store.status <> 'active' then
    raise exception 'Cette boutique est suspendue : contactez Eden Dev.';
  end if;
  select * into v_plan from public.gm_plans where code = p_plan and active and code <> 'free';
  if not found then
    raise exception 'Formule inconnue.';
  end if;
  if p_months is null or p_months not in (1, 3, 6, 12) then
    raise exception 'Durée invalide : 1, 3, 6 ou 12 mois.';
  end if;
  if (select count(*) from public.gm_payments where store_id = v_store.id and method = 'cinetpay'
      and status = 'pending' and created_at > now() - interval '1 hour') >= 5 then
    raise exception 'Trop de paiements commencés : réessayez dans une heure.';
  end if;
  v_amount := v_plan.price_month * public.gm_billed_months(p_months);
  if v_amount <= 0 or v_amount % 5 <> 0 then
    raise exception 'Montant non accepté par CinetPay (multiple de 5 FCFA) : contactez Eden Dev.';
  end if;

  insert into public.gm_subscriptions (store_id, plan_code, months, status, source)
  values (v_store.id, v_plan.code, p_months, 'pending', 'payment')
  returning id into v_sub;
  insert into public.gm_payments (store_id, subscription_id, amount, currency, method, status, reference, note)
  values (v_store.id, v_sub, v_amount, 'XOF', 'cinetpay', 'pending', v_id, 'Paiement direct CinetPay commencé')
  returning id into v_pay;
  insert into public.gm_cinetpay_orders (id, payment_id, amount, currency) values (v_id, v_pay, v_amount, 'XOF');
  insert into public.gm_license_events (store_id, kind, detail)
  values (v_store.id, 'payment_started', jsonb_build_object('payment_id', v_pay, 'method', 'cinetpay', 'amount', v_amount, 'order', v_id));

  v_names := regexp_split_to_array(trim(coalesce(nullif(v_store.owner_name, ''), 'Client GestiMarket')), '\s+');
  return jsonb_build_object(
    'order_id', v_id, 'payment_id', v_pay, 'amount', v_amount, 'currency', 'XOF', 'plan_label', v_plan.label, 'months', p_months,
    'designation', left('GestiMarket ' || v_plan.label || ' ' || p_months || ' mois — ' || v_store.code, 120),
    'first_name', v_names[1],
    'last_name', coalesce(nullif(array_to_string(v_names[2:], ' '), ''), v_store.name),
    'email', coalesce(nullif(v_store.email, ''), ''));
end;
$$;

create or replace function public.gm_cinetpay_start_pc(p_pc_id text, p_plan text, p_months int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  return public.gm_cinetpay_start_store((public.gm_pc_store(p_pc_id)).id, p_plan, p_months);
end;
$$;

create or replace function public.gm_cinetpay_start_owner(p_uid uuid, p_store_code text, p_plan text, p_months int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  select id into v_id from public.gm_stores where code = upper(trim(coalesce(p_store_code, ''))) and owner_id = p_uid;
  if not found then
    raise exception 'Boutique introuvable sur ce compte.';
  end if;
  return public.gm_cinetpay_start_store(v_id, p_plan, p_months);
end;
$$;

-- Réponse de CinetPay à l'ouverture du paiement : identifiant CinetPay, empreinte du jeton de notification, adresse.
create or replace function public.gm_cinetpay_opened(p_order_id text, p_transaction_id text, p_notify_hash text, p_payment_url text)
returns void
language sql
security definer
set search_path = public
as $$
  update public.gm_cinetpay_orders
     set status = 'open', cp_transaction_id = left(coalesce(p_transaction_id, ''), 80), notify_hash = coalesce(p_notify_hash, ''),
         payment_url = left(coalesce(p_payment_url, ''), 500), updated_at = now()
   where id = p_order_id and status = 'new';
$$;

-- CinetPay a refusé d'ouvrir le paiement : la commande et le paiement sont fermés.
create or replace function public.gm_cinetpay_init_failed(p_order_id text, p_error text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_o public.gm_cinetpay_orders;
begin
  update public.gm_cinetpay_orders set status = 'error', last_error = left(coalesce(p_error, ''), 300), updated_at = now()
   where id = p_order_id and status = 'new'
  returning * into v_o;
  if found and v_o.payment_id is not null then
    update public.gm_payments set status = 'refused', note = left('Paiement CinetPay non ouvert : ' || coalesce(p_error, ''), 300)
     where id = v_o.payment_id and status = 'pending';
  end if;
end;
$$;

create or replace function public.gm_cinetpay_order_get(p_order_id text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select to_jsonb(o) from public.gm_cinetpay_orders o where o.id = p_order_id
$$;

-- Résultat lu chez CinetPay (GET /v1/payment/{commande}) : jamais celui du message de notification seul.
--   SUCCESS au bon montant : paiement validé (licence envoyée toute seule) ou carte vendue envoyée au client ;
--   SUCCESS avec un montant inattendu : à vérifier par Eden Dev (« à valider » dans la console) ;
--   FAILED, INSUFFICIENT_BALANCE, EXPIRED : paiement fermé ; autres états : on attend.
create or replace function public.gm_cinetpay_result(p_order_id text, p_cp_status text, p_transaction_id text, p_amount numeric, p_currency text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_o    public.gm_cinetpay_orders;
  v_st   text := upper(coalesce(p_cp_status, ''));
  v_ref  text := left(coalesce(nullif(p_transaction_id, ''), ''), 80);
begin
  select * into v_o from public.gm_cinetpay_orders where id = p_order_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Commande inconnue.');
  end if;
  if v_o.status in ('success', 'failed') then
    return jsonb_build_object('ok', true, 'status', v_o.status);
  end if;
  -- Commande déjà close (délai dépassé, vente annulée) mais payée quand même : à vérifier par Eden Dev (alerte).
  if v_o.status in ('expired', 'error') then
    if v_st = 'SUCCESS' and v_o.cp_status <> 'SUCCESS' then
      update public.gm_cinetpay_orders set status = 'error', cp_status = v_st, checked_at = now(), updated_at = now(),
             last_error = 'Payé après la fermeture de la commande : rembourser ou servir le client.'
       where id = v_o.id;
    end if;
    return jsonb_build_object('ok', true, 'status', v_o.status);
  end if;
  if v_ref <> '' and v_o.cp_transaction_id <> '' and v_o.cp_transaction_id <> v_ref then
    update public.gm_cinetpay_orders set last_error = 'Identifiant CinetPay différent : ' || v_ref, checked_at = now(), updated_at = now()
     where id = v_o.id;
    return jsonb_build_object('ok', false, 'error', 'Identifiant de transaction différent.');
  end if;
  v_ref := coalesce(nullif(v_ref, ''), nullif(v_o.cp_transaction_id, ''), v_o.id);

  if v_st = 'SUCCESS' and (p_amount is null or p_amount = v_o.amount) and (coalesce(p_currency, '') = '' or upper(p_currency) = v_o.currency) then
    update public.gm_cinetpay_orders set status = 'success', cp_status = v_st, cp_transaction_id = v_ref, checked_at = now(), updated_at = now()
     where id = v_o.id;
    if v_o.payment_id is not null then
      update public.gm_payments set status = 'validated', provider_ref = v_ref, note = 'Payé par CinetPay (vérifié automatiquement)'
       where id = v_o.payment_id and status in ('pending', 'declared');
    end if;
    if v_o.sale_id is not null then
      update public.gm_card_sales set status = 'waiting', reference = left('CINETPAY ' || v_ref, 80), last_error = ''
       where id = v_o.sale_id and status = 'unpaid';
      if found then
        perform public.gm_cartes_ping();
      else
        update public.gm_cinetpay_orders set status = 'error', last_error = 'Vente annulée ou déjà payée : rembourser ou servir le client.'
         where id = v_o.id;
      end if;
    end if;
  elsif v_st = 'SUCCESS' then
    update public.gm_cinetpay_orders set status = 'error', cp_status = v_st, cp_transaction_id = v_ref, checked_at = now(), updated_at = now(),
           last_error = 'Montant ou devise inattendus : ' || coalesce(p_amount::text, '?') || ' ' || coalesce(p_currency, '')
     where id = v_o.id;
    if v_o.payment_id is not null then
      update public.gm_payments set status = 'declared', provider_ref = v_ref,
             note = 'CinetPay : montant ou devise inattendus, à vérifier (' || coalesce(p_amount::text, '?') || ' ' || coalesce(p_currency, '') || ')'
       where id = v_o.payment_id and status = 'pending';
    end if;
  elsif v_st in ('FAILED', 'INSUFFICIENT_BALANCE', 'EXPIRED') then
    update public.gm_cinetpay_orders set status = case when v_st = 'EXPIRED' then 'expired' else 'failed' end, cp_status = v_st,
           checked_at = now(), updated_at = now()
     where id = v_o.id;
    if v_o.payment_id is not null then
      update public.gm_payments set status = 'refused',
             note = case v_st when 'INSUFFICIENT_BALANCE' then 'Paiement CinetPay refusé : solde insuffisant.'
                              when 'EXPIRED' then 'Paiement CinetPay non terminé (délai dépassé).'
                              else 'Paiement CinetPay refusé ou annulé.' end
       where id = v_o.payment_id and status = 'pending';
    end if;
  else
    update public.gm_cinetpay_orders set cp_status = v_st, checked_at = now(), updated_at = now() where id = v_o.id;
  end if;
  return jsonb_build_object('ok', true, 'status', (select status from public.gm_cinetpay_orders where id = v_o.id));
end;
$$;

-- Commandes à vérifier chez CinetPay (notification perdue) : ouvertes depuis plus de 2 minutes, vérifiées il y a plus de
-- 5 minutes. Au-delà de 48 heures, la commande est close (paiement non terminé).
create or replace function public.gm_cinetpay_due()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_o public.gm_cinetpay_orders;
begin
  for v_o in select * from public.gm_cinetpay_orders
             where status in ('new', 'open') and created_at < now() - interval '48 hours' for update skip locked loop
    perform public.gm_cinetpay_result(v_o.id, 'EXPIRED', null, null, null);
  end loop;
  return (select coalesce(jsonb_agg(id order by created_at), '[]'::jsonb) from (
            select id, created_at from public.gm_cinetpay_orders
            where status = 'open' and created_at < now() - interval '2 minutes'
              and (checked_at is null or checked_at < now() - interval '5 minutes')
            order by created_at limit 20) d);
end;
$$;

-- Commande d'un paiement (vérification demandée par GestiMarket ou la console).
create or replace function public.gm_cinetpay_order_of_payment(p_payment_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select id from public.gm_cinetpay_orders where payment_id = p_payment_id
$$;

-- Appel de « gm-cinetpay » sans attendre (vérification des commandes ouvertes, toutes les 10 minutes).
create or replace function public.gm_cinetpay_ping()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (select 1 from public.gm_cinetpay_orders where status in ('new', 'open')) then
    perform net.http_post(
      url := 'https://wpuchfnyuyujdflbmqpn.supabase.co/functions/v1/gm-cinetpay',
      body := jsonb_build_object('action', 'sweep'),
      headers := jsonb_build_object('Content-Type', 'application/json'),
      timeout_milliseconds := 20000);
  end if;
exception when others then
  null;
end;
$$;

select cron.unschedule(jobid) from cron.job where jobname = 'gm-cinetpay-sweep';
select cron.schedule('gm-cinetpay-sweep', '*/10 * * * *', 'select public.gm_cinetpay_ping()');

-- Options publiques : paiement direct CinetPay ouvert ou non.
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
      'wave_merchant_number', coalesce((select value from public.gm_config where key = 'wave_merchant_number'), ''),
      'wave_merchant_name', coalesce((select value from public.gm_config where key = 'wave_merchant_name'), ''),
      'moov_merchant_number', coalesce((select value from public.gm_config where key = 'moov_merchant_number'), ''),
      'moov_merchant_name', coalesce((select value from public.gm_config where key = 'moov_merchant_name'), ''),
      'card_enabled', coalesce((select value from public.gm_config where key = 'card_enabled'), 'false') = 'true',
      'card_currency', upper(coalesce((select value from public.gm_config where key = 'card_currency'), 'XOF')),
      'card_currencies', to_jsonb(string_to_array(replace(upper(coalesce((select value from public.gm_config where key = 'card_currencies'), 'XOF')), ' ', ''), ',')),
      'cinetpay_enabled', coalesce((select value from public.gm_config where key = 'cinetpay_enabled'), 'false') = 'true'
    ),
    'whatsapp', coalesce((select value from public.gm_config where key = 'whatsapp_enabled'), 'false') = 'true',
    'whatsapp_number', coalesce((select value from public.gm_config where key = 'whatsapp_number'), '')
  )
$$;

-- ───────────────────────────── Droits d'exécution ─────────────────────────────

do $$
declare
  f text;
begin
  -- Internes (aides). Les fonctions des déclencheurs gardent leurs droits : elles ne s'appellent pas directement,
  -- et Supabase Auth ne doit jamais être gêné.
  foreach f in array array[
    'gm_login_key(text)', 'gm_ua_device(text)', 'gm_request_ip()', 'gm_request_agent()',
    'gm_jc_add(uuid, text, text, inet, text, text, jsonb)',
    'gm_cinetpay_new_id()', 'gm_cinetpay_start_store(uuid, text, integer)', 'gm_cinetpay_ping()']
  loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;
  -- Réservées aux fonctions d'Eden Dev (service_role) : gm-whatsapp, gm-cinetpay.
  foreach f in array array[
    'gm_whatsapp_code_check(text)', 'gm_cinetpay_start_pc(text, text, integer)', 'gm_cinetpay_start_owner(uuid, text, text, integer)',
    'gm_cinetpay_opened(text, text, text, text)', 'gm_cinetpay_init_failed(text, text)', 'gm_cinetpay_order_get(text)',
    'gm_cinetpay_result(text, text, text, numeric, text)', 'gm_cinetpay_due()', 'gm_cinetpay_order_of_payment(uuid)']
  loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end;
$$;

revoke all on function public.gm_report_auth_failure(jsonb) from public;
grant execute on function public.gm_report_auth_failure(jsonb) to anon, authenticated;
grant execute on function public.gm_public_options() to anon, authenticated;
