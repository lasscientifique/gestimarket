-- GestiMarket 0.15 — à exécuter après gestimarket_international.sql (SQL Editor → Run).
--
-- 1. Abonnement de 12 mois avec 2 mois offerts (10 mois payés) : Orange Money, carte Visa, cartes de bon.
-- 2. Application mobile (compte boutique connecté) : paiements, carte de bon et carte Visa depuis le téléphone.
-- 3. Adresse Internet automatique de chaque boutique (https://gm-000123.<domaine>) : table gm_tunnels,
--    remplie par la fonction « gm-tunnel » (secrets CF_API_TOKEN, CF_ACCOUNT_ID, CF_ZONE_ID, TUNNEL_DOMAIN).
-- 4. Poste serveur rattaché à la boutique Eden Dev de son PC (gm_my_server) : à exécuter après gestimarket_mobile.sql.

-- Mois payés pour une durée : 12 mois = 10 payés, sinon la durée elle-même.
create or replace function public.gm_billed_months(p_months int)
returns int
language sql
immutable
as $$
  select case when p_months = 12 then 10 else p_months end
$$;

alter table public.gm_subscriptions drop constraint if exists gm_subscriptions_months_check;
alter table public.gm_subscriptions add constraint gm_subscriptions_months_check check (months in (1, 3, 6, 12));
alter table public.gm_vouchers drop constraint if exists gm_vouchers_months_check;
alter table public.gm_vouchers add constraint gm_vouchers_months_check check (months in (1, 3, 6, 12));

-- Activation : jours restants convertis au prix réellement payé (12 mois = 10 payés).
create or replace function public.gm_activate_subscription(p_sub_id uuid)
returns public.gm_subscriptions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sub     public.gm_subscriptions;
  v_rank    int;
  v_price   int;
  v_upgrade boolean;
  v_credit  numeric := 0;
  v_start   timestamptz;
  v_end     timestamptz;
begin
  select * into v_sub from public.gm_subscriptions where id = p_sub_id for update;
  if not found then
    raise exception 'Abonnement introuvable.';
  end if;
  perform 1 from public.gm_subscriptions where store_id = v_sub.store_id and status = 'active' for update;
  select sort, price_month into v_rank, v_price from public.gm_plans where code = v_sub.plan_code;

  select exists (
    select 1 from public.gm_subscriptions x join public.gm_plans p on p.code = x.plan_code
    where x.store_id = v_sub.store_id and x.status = 'active' and x.id <> v_sub.id
      and x.starts_at <= now() and x.ends_at > now() and p.sort < v_rank
  ) into v_upgrade;

  if v_upgrade then
    select coalesce(sum(extract(epoch from (x.ends_at - greatest(x.starts_at, now()))) * p.price_month * public.gm_billed_months(coalesce(x.months, 1)) / coalesce(x.months, 1)), 0) into v_credit
    from public.gm_subscriptions x join public.gm_plans p on p.code = x.plan_code
    where x.store_id = v_sub.store_id and x.status = 'active' and x.id <> v_sub.id
      and x.ends_at > now() and p.sort < v_rank and x.source <> 'trial';
    update public.gm_subscriptions x set ends_at = now()
      from public.gm_plans p
     where p.code = x.plan_code and x.store_id = v_sub.store_id and x.status = 'active' and x.id <> v_sub.id
       and x.starts_at < now() and x.ends_at > now() and p.sort < v_rank;
    update public.gm_subscriptions x set status = 'cancelled'
      from public.gm_plans p
     where p.code = x.plan_code and x.store_id = v_sub.store_id and x.status = 'active' and x.id <> v_sub.id
       and x.starts_at >= now() and p.sort < v_rank;
  end if;

  select greatest(now(), coalesce(max(ends_at), now())) into v_start
  from public.gm_subscriptions
  where store_id = v_sub.store_id and status = 'active' and id <> v_sub.id and ends_at > now();
  v_end := v_start + make_interval(months => coalesce(v_sub.months, 1)::int);
  if v_credit > 0 and v_price > 0 then
    v_end := v_end + make_interval(secs => floor(v_credit / v_price)::double precision);
  end if;

  update public.gm_subscriptions set status = 'active', starts_at = v_start, ends_at = v_end
   where id = v_sub.id
  returning * into v_sub;
  insert into public.gm_license_events (store_id, kind, detail)
  values (v_sub.store_id, 'subscription_activated', jsonb_build_object(
    'subscription_id', v_sub.id, 'plan', v_sub.plan_code, 'months', v_sub.months, 'upgrade', v_upgrade,
    'credit_seconds', case when v_price > 0 then floor(v_credit / v_price) else 0 end, 'starts_at', v_start, 'ends_at', v_end));
  return v_sub;
end;
$$;

-- Paiement Orange Money (compte boutique).
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
  if p_months is null or p_months not in (1, 3, 6, 12) then
    raise exception 'Durée invalide : 1, 3, 6 ou 12 mois.';
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

  v_amount := v_plan.price_month * public.gm_billed_months(p_months);
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

-- Paiement Orange Money (PC de la boutique).
create or replace function public.gm_pc_declare_payment(p_pc_id text, p_plan text, p_months int, p_reference text, p_payer_phone text)
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
  v_amount int;
  v_ref    text := upper(left(regexp_replace(trim(coalesce(p_reference, '')), '\s+', '', 'g'), 80));
begin
  select * into v_plan from public.gm_plans where code = p_plan and active and code <> 'free';
  if not found then
    raise exception 'Formule inconnue.';
  end if;
  if p_months is null or p_months not in (1, 3, 6, 12) then
    raise exception 'Durée invalide : 1, 3, 6 ou 12 mois.';
  end if;
  if length(v_ref) < 6 then
    raise exception 'Saisissez l''ID de la transaction Orange Money (reçu par SMS après le paiement).';
  end if;
  if (select count(*) from public.gm_payments where store_id = v_store.id and status = 'declared') >= 3 then
    raise exception 'Trois paiements attendent déjà la validation d''Eden Dev : patientez.';
  end if;
  if exists (select 1 from public.gm_payments where upper(reference) = v_ref and method = 'orange_money' and status <> 'refused') then
    raise exception 'Cet ID de transaction a déjà été déclaré.';
  end if;

  v_amount := v_plan.price_month * public.gm_billed_months(p_months);
  insert into public.gm_subscriptions (store_id, plan_code, months, status, source)
  values (v_store.id, v_plan.code, p_months, 'pending', 'payment')
  returning id into v_sub;
  insert into public.gm_payments (store_id, subscription_id, amount, method, reference, payer_phone)
  values (v_store.id, v_sub, v_amount, 'orange_money', v_ref, left(trim(coalesce(p_payer_phone, '')), 40))
  returning id into v_pay;
  insert into public.gm_license_events (store_id, kind, detail)
  values (v_store.id, 'payment_declared', jsonb_build_object('payment_id', v_pay, 'plan', v_plan.code, 'months', p_months, 'amount', v_amount, 'method', 'orange_money'));
  return jsonb_build_object('payment_id', v_pay, 'amount', v_amount, 'plan', v_plan.code, 'plan_label', v_plan.label, 'months', p_months);
end;
$$;

-- Cartes de bon : aussi 12 mois.
create or replace function public.gm_voucher_batch(p_plan text, p_months int, p_count int, p_batch text default null)
returns table (numero text, code_secret text, formule text, duree text, valeur text)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_plan  public.gm_plans;
  v_batch text := upper(coalesce(nullif(trim(p_batch), ''), 'B' || to_char(now(), 'YYMMDD')));
  v_alpha text := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  v_first int;
  v_bytes bytea;
  v_code  text;
  i       int;
  j       int;
begin
  select * into v_plan from public.gm_plans g where g.code = p_plan and g.code <> 'free';
  if not found then
    raise exception 'Formule inconnue : starter, pro ou business.';
  end if;
  if p_months is null or p_months not in (1, 3, 6, 12) then
    raise exception 'Durée : 1, 3, 6 ou 12 mois.';
  end if;
  if p_count is null or p_count < 1 or p_count > 500 then
    raise exception 'Nombre de cartes : de 1 à 500.';
  end if;
  perform pg_advisory_xact_lock(hashtext('gm_voucher_batch|' || v_batch));
  select count(*) into v_first from public.gm_vouchers v where v.batch = v_batch;
  for i in 1..p_count loop
    -- 16 caractères de 5 bits tirés au hasard (80 bits) : impossible à deviner.
    v_bytes := extensions.gen_random_bytes(16);
    v_code := '';
    for j in 0..15 loop
      v_code := v_code || substr(v_alpha, get_byte(v_bytes, j) % 32 + 1, 1);
    end loop;
    numero := v_batch || '-' || lpad((v_first + i)::text, 4, '0');
    insert into public.gm_vouchers (serial, code_hash, plan_code, months, batch)
    values (numero, public.gm_voucher_hash(v_code), v_plan.code, p_months, v_batch);
    code_secret := substr(v_code, 1, 4) || '-' || substr(v_code, 5, 4) || '-' || substr(v_code, 9, 4) || '-' || substr(v_code, 13, 4);
    formule := v_plan.label;
    duree := p_months || ' mois' || case when p_months = 12 then ' (2 offerts)' else '' end;
    valeur := (v_plan.price_month * public.gm_billed_months(p_months)) || ' FCFA';
    return next;
  end loop;
end;
$$;

-- ───────────────────────────── Carte de bon : depuis le PC ou le téléphone ─────────────────────────────

-- Utilisation d'une carte de bon pour une boutique : abonnement activé tout de suite.
-- Les erreurs sont renvoyées (et non levées) pour que les essais ratés soient comptés : 5 par heure.
create or replace function public.gm_redeem_voucher_store(p_store public.gm_stores, p_code text, p_origin jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code  text := public.gm_voucher_normalize(p_code);
  v_v     public.gm_vouchers;
  v_plan  public.gm_plans;
  v_sub   public.gm_subscriptions;
  v_pay   uuid;
  v_fail  int;
  v_found boolean;
begin
  select count(*) into v_fail from public.gm_license_events
  where store_id = p_store.id and kind = 'voucher_failed' and created_at > now() - interval '1 hour';
  if v_fail >= 5 then
    return jsonb_build_object('ok', false, 'error', 'Trop de codes erronés : réessayez dans une heure.');
  end if;
  if length(v_code) <> 16 then
    return jsonb_build_object('ok', false, 'error', 'Le code de la carte comporte 16 caractères (ex. 7K2M-QX9P-4TRD-H8WN).');
  end if;

  select * into v_v from public.gm_vouchers where code_hash = public.gm_voucher_hash(v_code) for update;
  v_found := found;
  if not v_found or v_v.status in ('cancelled', 'used') then
    if v_found and v_v.status = 'used' and v_v.store_id = p_store.id then
      return jsonb_build_object('ok', false, 'error',
        'Cette carte a déjà été utilisée pour votre boutique le ' || to_char(v_v.used_at, 'DD/MM/YYYY') || '.');
    end if;
    insert into public.gm_license_events (store_id, kind, detail)
    values (p_store.id, 'voucher_failed', coalesce(p_origin, '{}'::jsonb) || jsonb_build_object('serial', v_v.serial));
    return jsonb_build_object('ok', false, 'error',
      case when v_found and v_v.status = 'used' then 'Cette carte a déjà été utilisée.'
           when v_found then 'Cette carte a été annulée par Eden Dev.'
           else 'Code de carte invalide : vérifiez les 16 caractères.' end
      || ' Essais restants avant blocage d''une heure : ' || greatest(0, 4 - v_fail) || '.');
  end if;

  select * into v_plan from public.gm_plans where code = v_v.plan_code;
  insert into public.gm_subscriptions (store_id, plan_code, months, status, source)
  values (p_store.id, v_v.plan_code, v_v.months, 'pending', 'voucher')
  returning * into v_sub;
  insert into public.gm_payments (store_id, subscription_id, amount, method, reference, status, validated_at, note)
  values (p_store.id, v_sub.id, v_plan.price_month * public.gm_billed_months(v_v.months), 'carte_bon', v_v.serial,
          'validated', now(), 'Carte de bon ' || v_v.serial)
  returning id into v_pay;
  v_sub := public.gm_activate_subscription(v_sub.id);
  update public.gm_vouchers set status = 'used', used_at = now(), store_id = p_store.id, payment_id = v_pay where id = v_v.id;
  insert into public.gm_license_events (store_id, kind, detail)
  values (p_store.id, 'voucher_used', coalesce(p_origin, '{}'::jsonb)
          || jsonb_build_object('serial', v_v.serial, 'plan', v_v.plan_code, 'months', v_v.months));
  return jsonb_build_object('ok', true, 'serial', v_v.serial, 'plan', v_plan.code, 'plan_label', v_plan.label,
                            'months', v_v.months, 'starts_at', v_sub.starts_at, 'ends_at', v_sub.ends_at);
end;
$$;

-- Depuis le PC de la boutique (identifiant du PC).
create or replace function public.gm_redeem_voucher(p_pc_id text, p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pc    text := upper(regexp_replace(coalesce(p_pc_id, ''), '[^0-9A-Za-z]', '', 'g'));
  v_store public.gm_stores;
begin
  begin
    v_store := public.gm_pc_store(v_pc);
  exception when others then
    return jsonb_build_object('ok', false, 'error', sqlerrm);
  end;
  return public.gm_redeem_voucher_store(v_store, p_code, jsonb_build_object('pc_id', v_pc));
end;
$$;

-- ───────────────────────────── Application mobile : la propriétaire connectée ─────────────────────────────

-- Boutique de la propriétaire connectée (compte boutique), active.
create or replace function public.gm_owner_store(p_store_code text)
returns public.gm_stores
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_store public.gm_stores;
begin
  if auth.uid() is null then
    raise exception 'Connectez-vous à votre compte boutique.';
  end if;
  select * into v_store from public.gm_stores
  where code = upper(trim(coalesce(p_store_code, ''))) and owner_id = auth.uid();
  if not found then
    raise exception 'Boutique introuvable sur ce compte.';
  end if;
  if v_store.status <> 'active' then
    raise exception 'Cette boutique est suspendue : contactez Eden Dev.';
  end if;
  return v_store;
end;
$$;

-- Carte de bon saisie sur le téléphone de la propriétaire.
create or replace function public.gm_my_redeem_voucher(p_store_code text, p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_store public.gm_stores;
begin
  begin
    v_store := public.gm_owner_store(p_store_code);
  exception when others then
    return jsonb_build_object('ok', false, 'error', sqlerrm);
  end;
  return public.gm_redeem_voucher_store(v_store, p_code, jsonb_build_object('via', 'application'));
end;
$$;

-- Derniers paiements d'une boutique de la propriétaire (sans référence ni numéro de téléphone).
create or replace function public.gm_my_payments(p_store_code text)
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
    where store_id = (public.gm_owner_store(p_store_code)).id
    order by created_at desc limit 12
  ) p
  join public.gm_subscriptions x on x.id = p.subscription_id
  join public.gm_plans pl on pl.code = x.plan_code
$$;

-- ───────────────────────────── Carte Visa : depuis le PC ou le téléphone (réservé à « gm-pay ») ─────────────────────────────

-- Début d'un paiement par carte Visa pour une boutique : dans sa devise si Cybersource l'accepte.
create or replace function public.gm_card_start_store(p_store_id uuid, p_plan text, p_months int)
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
  v_cur    text := upper(coalesce((select value from public.gm_config where key = 'card_currency'), 'XOF'));
  v_local  text;
  v_price  int;
  v_amount int;
begin
  select * into v_store from public.gm_stores where id = p_store_id;
  if not found then
    raise exception 'Boutique introuvable.';
  end if;
  if v_store.status <> 'active' then
    raise exception 'Cette boutique est suspendue : contactez Eden Dev.';
  end if;
  if coalesce((select value from public.gm_config where key = 'card_enabled'), 'false') <> 'true' then
    raise exception 'Le paiement par carte Visa n''est pas encore ouvert : utilisez une carte de bon ou Orange Money.';
  end if;
  select * into v_plan from public.gm_plans where code = p_plan and active and code <> 'free';
  if not found then
    raise exception 'Formule inconnue.';
  end if;
  if p_months is null or p_months not in (1, 3, 6, 12) then
    raise exception 'Durée invalide : 1, 3, 6 ou 12 mois.';
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
  v_amount := v_price * public.gm_billed_months(p_months);

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

-- Depuis le PC de la boutique.
create or replace function public.gm_card_start(p_pc_id text, p_plan text, p_months int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  return public.gm_card_start_store((public.gm_pc_store(p_pc_id)).id, p_plan, p_months);
end;
$$;

-- Depuis le téléphone : « gm-pay » vérifie la session puis transmet l'identifiant de la propriétaire.
create or replace function public.gm_card_start_owner(p_uid uuid, p_store_code text, p_plan text, p_months int)
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
  return public.gm_card_start_store(v_id, p_plan, p_months);
end;
$$;

-- ───────────────────────────── Adresse Internet automatique (tunnel Cloudflare) ─────────────────────────────
-- Une adresse par boutique : https://gm-000123.<domaine d'Eden Dev> → PC serveur de la boutique.
-- Créée par la fonction « gm-tunnel » (clé Cloudflare dans ses secrets), jamais lisible depuis l'application.

create table if not exists public.gm_tunnels (
  store_id   uuid primary key references public.gm_stores(id) on delete cascade,
  tunnel_id  text not null,
  hostname   text not null unique,
  port       integer not null check (port between 1024 and 65535),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.gm_tunnels enable row level security;   -- aucune politique : réservé à « gm-tunnel »

-- Boutique de la propriétaire, formule avec accès Internet, 10 demandes par heure au plus.
create or replace function public.gm_tunnel_target(p_uid uuid, p_store_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_store    public.gm_stores;
  v_features text[];
  v_t        public.gm_tunnels;
begin
  select * into v_store from public.gm_stores where code = upper(trim(coalesce(p_store_code, ''))) and owner_id = p_uid;
  if not found then
    raise exception 'Boutique introuvable sur ce compte.';
  end if;
  if v_store.status <> 'active' then
    raise exception 'Cette boutique est suspendue : contactez Eden Dev.';
  end if;
  select p.features into v_features
  from public.gm_subscriptions x join public.gm_plans p on p.code = x.plan_code
  where x.store_id = v_store.id and x.status = 'active' and x.starts_at <= now() and x.ends_at > now()
  order by p.sort desc limit 1;
  if v_features is null or not ('internet' = any (v_features)) then
    raise exception 'L''accès par Internet demande la formule PRO ou BUSINESS.';
  end if;
  if (select count(*) from public.gm_license_events where store_id = v_store.id and kind = 'tunnel_requested'
      and created_at > now() - interval '1 hour') >= 10 then
    raise exception 'Trop de demandes d''adresse Internet : réessayez dans une heure.';
  end if;
  insert into public.gm_license_events (store_id, kind, detail) values (v_store.id, 'tunnel_requested', '{}'::jsonb);
  select * into v_t from public.gm_tunnels where store_id = v_store.id;
  return jsonb_build_object('store_id', v_store.id, 'code', v_store.code, 'tunnel_id', v_t.tunnel_id, 'hostname', v_t.hostname);
end;
$$;

-- Tunnel créé ou mis à jour par « gm-tunnel ».
create or replace function public.gm_tunnel_saved(p_store_id uuid, p_tunnel_id text, p_hostname text, p_port int)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.gm_tunnels (store_id, tunnel_id, hostname, port)
  values (p_store_id, p_tunnel_id, lower(p_hostname), p_port)
  on conflict (store_id) do update
    set tunnel_id = excluded.tunnel_id, hostname = excluded.hostname, port = excluded.port, updated_at = now();
  insert into public.gm_license_events (store_id, kind, detail)
  values (p_store_id, 'tunnel_ready', jsonb_build_object('hostname', lower(p_hostname), 'port', p_port));
end;
$$;

-- ───────────────────────────── Droits ─────────────────────────────

revoke all on function public.gm_billed_months(int) from public;
grant execute on function public.gm_billed_months(int) to anon, authenticated, service_role;
revoke all on function public.gm_redeem_voucher_store(public.gm_stores, text, jsonb) from public, anon, authenticated;
revoke all on function public.gm_owner_store(text) from public, anon, authenticated;
revoke all on function public.gm_my_redeem_voucher(text, text) from public, anon;
grant execute on function public.gm_my_redeem_voucher(text, text) to authenticated;
revoke all on function public.gm_my_payments(text) from public, anon;
grant execute on function public.gm_my_payments(text) to authenticated;
revoke all on function public.gm_card_start_store(uuid, text, int) from public, anon, authenticated;
grant execute on function public.gm_card_start_store(uuid, text, int) to service_role;
revoke all on function public.gm_card_start(text, text, int) from public, anon, authenticated;
grant execute on function public.gm_card_start(text, text, int) to service_role;
revoke all on function public.gm_card_start_owner(uuid, text, text, int) from public, anon, authenticated;
grant execute on function public.gm_card_start_owner(uuid, text, text, int) to service_role;
revoke all on function public.gm_tunnel_target(uuid, text) from public, anon, authenticated;
grant execute on function public.gm_tunnel_target(uuid, text) to service_role;
revoke all on function public.gm_tunnel_saved(uuid, text, text, int) from public, anon, authenticated;
grant execute on function public.gm_tunnel_saved(uuid, text, text, int) to service_role;

-- ───────────────────────────── Poste serveur de la boutique (application mobile) ─────────────────────────────
-- Le poste serveur publié est rattaché à la boutique Eden Dev de son PC, pour que la propriétaire
-- connectée dans l'application mobile ouvre sa boutique sans saisir le code du commerce.

alter table public.gm_servers add column if not exists store_id uuid references public.gm_stores(id) on delete set null;
create index if not exists gm_servers_store on public.gm_servers(store_id);

create or replace function public.gm_publish_server(p_shop_code text, p_secret text, p_active boolean, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hash  text := encode(sha256(convert_to(p_secret, 'UTF8')), 'hex');
  v_row   public.gm_servers;
  v_store uuid;
begin
  if p_shop_code is null or length(trim(p_shop_code)) < 4 or p_secret is null or length(p_secret) < 20 then
    raise exception 'Code ou secret invalide';
  end if;
  select * into v_row from public.gm_servers where shop_code = upper(trim(p_shop_code));
  if found and v_row.secret_hash <> v_hash then
    raise exception 'Ce code de commerce appartient à un autre poste serveur';
  end if;
  -- Boutique Eden Dev du PC : seulement si ce PC y est bien rattaché.
  select pc.store_id into v_store
  from public.gm_store_pcs pc join public.gm_stores s on s.id = pc.store_id
  where pc.pc_id = upper(regexp_replace(coalesce(p_payload->>'pc_id', ''), '[^0-9A-Za-z]', '', 'g'))
    and s.code = upper(trim(coalesce(p_payload->>'store_code', '')));
  insert into public.gm_servers as s (shop_code, secret_hash, shop_name, url, https_url, public_url, payload, active, last_seen, store_id)
  values (upper(trim(p_shop_code)), v_hash, p_payload->>'shop_name', p_payload->>'url', p_payload->>'https_url',
          p_payload->>'public_url', coalesce(p_payload, '{}'::jsonb) - 'pc_id', coalesce(p_active, false), now(), v_store)
  on conflict (shop_code) do update set
    shop_name = excluded.shop_name, url = excluded.url, https_url = excluded.https_url,
    public_url = excluded.public_url, payload = excluded.payload, active = excluded.active, last_seen = now(),
    store_id = coalesce(excluded.store_id, s.store_id);
  return jsonb_build_object('ok', true, 'shop_code', upper(trim(p_shop_code)), 'linked', v_store is not null);
end;
$$;

-- Poste serveur d'une boutique de la propriétaire connectée (le plus récent).
create or replace function public.gm_my_server(p_store_code text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_store public.gm_stores;
  v_code  text;
begin
  begin
    v_store := public.gm_owner_store(p_store_code);
  exception when others then
    return jsonb_build_object('found', false, 'active', false, 'error', sqlerrm);
  end;
  select shop_code into v_code from public.gm_servers where store_id = v_store.id order by last_seen desc limit 1;
  if v_code is null then
    return jsonb_build_object('found', false, 'active', false, 'shop_name', v_store.name,
      'error', 'Le PC serveur de cette boutique n''a pas encore publié son adresse : scannez le code du commerce affiché sur le PC.');
  end if;
  return public.gm_get_server(v_code);
end;
$$;

revoke all on function public.gm_my_server(text) from public, anon;
grant execute on function public.gm_my_server(text) to authenticated;
