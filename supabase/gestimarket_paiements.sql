-- GestiMarket 0.10 — Paiement des abonnements Eden Dev
--
-- À exécuter après gestimarket_licences.sql (SQL Editor de Supabase). Trois moyens de paiement :
--   carte_bon     carte prépayée Eden Dev (code secret de 16 caractères) : activation immédiate ;
--   orange_money  Orange Money / Sarali (code marchand ou QR) : ID de transaction saisi, validé par Eden Dev ;
--   carte_visa    carte Visa par Cybersource (Visa), fonction « gm-pay » : validation automatique.
--
-- Le PC est identifié par son identifiant (relié à la boutique lors de l'activation) : plus besoin de
-- retaper le mot de passe du compte pour payer.
--
-- Changement de formule : une formule supérieure s'applique tout de suite, les jours restants des
-- formules inférieures payées étant convertis au prorata du prix ; même formule ou formule inférieure :
-- à la suite de la période en cours.
--
-- Eden Dev — cartes de bon : `select * from public.gm_voucher_batch('pro', 1, 20);` (formule, mois,
-- nombre de cartes) dans le SQL Editor, puis « Export → CSV » ; imprimer avec cartes_de_bon.html.
-- Les codes ne sont affichés qu'à cette création : ils sont gardés hachés (SHA-256).

-- ───────────────────────────── Moyens et états des paiements ─────────────────────────────

alter table public.gm_payments drop constraint if exists gm_payments_method_check;
alter table public.gm_payments add constraint gm_payments_method_check
  check (method in ('carte_bon', 'orange_money', 'carte_visa', 'moov_money', 'virement', 'especes', 'autre'));
-- pending : paiement par carte commencé (page Cybersource ouverte) ; declared : à valider par Eden Dev.
alter table public.gm_payments drop constraint if exists gm_payments_status_check;
alter table public.gm_payments add constraint gm_payments_status_check
  check (status in ('pending', 'declared', 'validated', 'refused'));
-- Numéro de transaction du prestataire (Cybersource).
alter table public.gm_payments add column if not exists provider_ref text not null default '';

alter table public.gm_subscriptions drop constraint if exists gm_subscriptions_source_check;
alter table public.gm_subscriptions add constraint gm_subscriptions_source_check
  check (source in ('trial', 'payment', 'manual', 'voucher'));

insert into public.gm_config (key, value) values
  ('om_merchant_code', ''),          -- code marchand Sarali d'Eden Dev
  ('om_merchant_name', 'Eden Dev'),  -- nom affiché par Orange Money au moment du paiement
  ('om_qr_payload', ''),             -- contenu du QR code marchand (facultatif)
  ('card_enabled', 'false'),         -- 'true' quand les clés Cybersource sont dans les secrets de « gm-pay »
  ('card_currency', 'XOF')
on conflict (key) do nothing;
update public.gm_config
   set value = 'Payez avec une carte de bon Eden Dev (activation immédiate), par Orange Money (Sarali) ou par carte Visa.'
 where key = 'payment_instructions' and value like 'Payez par Orange Money ou Moov Money%';

-- Formulaire d'inscription, formules et moyens de paiement (sans connexion).
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
    'trial_days', coalesce((select value from public.gm_config where key = 'trial_days'), '0')::int,
    'payment', jsonb_build_object(
      'om_merchant_code', coalesce((select value from public.gm_config where key = 'om_merchant_code'), ''),
      'om_merchant_name', coalesce((select value from public.gm_config where key = 'om_merchant_name'), ''),
      'om_qr_payload', coalesce((select value from public.gm_config where key = 'om_qr_payload'), ''),
      'card_enabled', coalesce((select value from public.gm_config where key = 'card_enabled'), 'false') = 'true'
    )
  )
$$;

-- ───────────────────────────── Activation d'un abonnement ─────────────────────────────

-- Active un abonnement payé (paiement validé ou carte de bon). Formule supérieure à celle en cours :
-- effet immédiat ; les jours restants des formules inférieures payées sont convertis en jours de la
-- nouvelle formule, au prorata du prix (l'essai gratuit ne compte pas). Sinon : à la suite.
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
    select coalesce(sum(extract(epoch from (x.ends_at - greatest(x.starts_at, now()))) * p.price_month), 0) into v_credit
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

-- Validation (ou refus) d'un paiement : par Eden Dev (Table Editor) ou par « gm-pay » (carte).
create or replace function public.gm_on_payment_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status is not distinct from old.status then
    return new;
  end if;
  if old.status not in ('pending', 'declared') then
    raise exception 'Un paiement validé ou refusé ne change plus de statut : créez un nouveau paiement.';
  end if;
  if new.status = 'validated' then
    perform public.gm_activate_subscription(new.subscription_id);
    new.validated_at := now();
  elsif new.status = 'refused' then
    update public.gm_subscriptions set status = 'cancelled' where id = new.subscription_id;
  end if;
  insert into public.gm_license_events (store_id, kind, detail)
  values (new.store_id, 'payment_' || new.status, jsonb_build_object('payment_id', new.id, 'amount', new.amount, 'method', new.method, 'reference', new.reference));
  return new;
end;
$$;

-- ───────────────────────────── Paiements depuis le PC de la boutique ─────────────────────────────

-- Boutique reliée à un PC (identifiant de 12 caractères).
create or replace function public.gm_pc_store(p_pc_id text)
returns public.gm_stores
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_store public.gm_stores;
begin
  select s.* into v_store
  from public.gm_store_pcs pc join public.gm_stores s on s.id = pc.store_id
  where pc.pc_id = upper(regexp_replace(coalesce(p_pc_id, ''), '[^0-9A-Za-z]', '', 'g'));
  if not found then
    raise exception 'Ce PC n''est relié à aucune boutique : créez ou reliez d''abord le compte de la boutique.';
  end if;
  if v_store.status <> 'active' then
    raise exception 'Cette boutique est suspendue : contactez Eden Dev.';
  end if;
  return v_store;
end;
$$;

-- Derniers paiements de la boutique du PC (sans référence ni numéro de téléphone).
create or replace function public.gm_pc_payments(p_pc_id text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', p.id, 'created_at', p.created_at, 'method', p.method, 'plan', x.plan_code, 'plan_label', pl.label,
           'months', x.months, 'amount', p.amount, 'status', p.status, 'note', p.note,
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

-- Paiement Orange Money (Sarali) : l'ID de transaction est vérifié puis validé par Eden Dev.
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
  if p_months is null or p_months not in (1, 3, 6) then
    raise exception 'Durée invalide : 1, 3 ou 6 mois.';
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

  v_amount := v_plan.price_month * p_months;
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

-- ───────────────────────────── Cartes de bon (prépayées) ─────────────────────────────

create table if not exists public.gm_vouchers (
  id         uuid primary key default gen_random_uuid(),
  serial     text not null unique,                    -- numéro imprimé sur la carte (suivi, assistance)
  code_hash  text not null unique,                    -- SHA-256 du code secret : jamais stocké en clair
  plan_code  text not null references public.gm_plans(code) check (plan_code <> 'free'),
  months     smallint not null check (months in (1, 3, 6)),
  batch      text not null default '',
  status     text not null default 'new' check (status in ('new', 'sold', 'used', 'cancelled')),
  note       text not null default '',                -- revendeur, client…
  created_at timestamptz not null default now(),
  sold_at    timestamptz,
  used_at    timestamptz,
  store_id   uuid references public.gm_stores(id) on delete set null,
  payment_id uuid references public.gm_payments(id) on delete set null
);
create index if not exists gm_vouchers_batch on public.gm_vouchers(batch);
alter table public.gm_vouchers enable row level security;   -- aucune politique : tableau de bord uniquement

-- Code saisi → forme canonique (alphabet de Crockford : O → 0, I et L → 1, sans tirets ni espaces).
create or replace function public.gm_voucher_normalize(p text)
returns text
language sql
immutable
set search_path = public
as $$
  select translate(upper(regexp_replace(coalesce(p, ''), '[^0-9A-Za-z]', '', 'g')), 'OIL', '011')
$$;

create or replace function public.gm_voucher_hash(p_code text)
returns text
language sql
immutable
set search_path = public, extensions
as $$
  select encode(extensions.digest('gestimarket-bon|' || public.gm_voucher_normalize(p_code), 'sha256'), 'hex')
$$;

-- Création d'un lot de cartes (Eden Dev, SQL Editor). Les codes ne sont visibles qu'ici.
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
  if p_months is null or p_months not in (1, 3, 6) then
    raise exception 'Durée : 1, 3 ou 6 mois.';
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
    duree := p_months || ' mois';
    valeur := (v_plan.price_month * p_months) || ' FCFA';
    return next;
  end loop;
end;
$$;

-- Utilisation d'une carte de bon depuis le PC de la boutique : abonnement activé tout de suite.
-- Les erreurs sont renvoyées (et non levées) pour que les essais ratés soient comptés : 5 par heure.
create or replace function public.gm_redeem_voucher(p_pc_id text, p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pc    text := upper(regexp_replace(coalesce(p_pc_id, ''), '[^0-9A-Za-z]', '', 'g'));
  v_code  text := public.gm_voucher_normalize(p_code);
  v_store public.gm_stores;
  v_v     public.gm_vouchers;
  v_plan  public.gm_plans;
  v_sub   public.gm_subscriptions;
  v_pay   uuid;
  v_fail  int;
  v_found boolean;
begin
  begin
    v_store := public.gm_pc_store(v_pc);
  exception when others then
    return jsonb_build_object('ok', false, 'error', sqlerrm);
  end;
  select count(*) into v_fail from public.gm_license_events
  where store_id = v_store.id and kind = 'voucher_failed' and created_at > now() - interval '1 hour';
  if v_fail >= 5 then
    return jsonb_build_object('ok', false, 'error', 'Trop de codes erronés : réessayez dans une heure.');
  end if;
  if length(v_code) <> 16 then
    return jsonb_build_object('ok', false, 'error', 'Le code de la carte comporte 16 caractères (ex. 7K2M-QX9P-4TRD-H8WN).');
  end if;

  select * into v_v from public.gm_vouchers where code_hash = public.gm_voucher_hash(v_code) for update;
  v_found := found;
  if not v_found or v_v.status in ('cancelled', 'used') then
    if v_found and v_v.status = 'used' and v_v.store_id = v_store.id then
      return jsonb_build_object('ok', false, 'error',
        'Cette carte a déjà été utilisée pour votre boutique le ' || to_char(v_v.used_at, 'DD/MM/YYYY') || '.');
    end if;
    insert into public.gm_license_events (store_id, kind, detail)
    values (v_store.id, 'voucher_failed', jsonb_build_object('pc_id', v_pc, 'serial', v_v.serial));
    return jsonb_build_object('ok', false, 'error',
      case when v_found and v_v.status = 'used' then 'Cette carte a déjà été utilisée.'
           when v_found then 'Cette carte a été annulée par Eden Dev.'
           else 'Code de carte invalide : vérifiez les 16 caractères.' end
      || ' Essais restants avant blocage d''une heure : ' || greatest(0, 4 - v_fail) || '.');
  end if;

  select * into v_plan from public.gm_plans where code = v_v.plan_code;
  insert into public.gm_subscriptions (store_id, plan_code, months, status, source)
  values (v_store.id, v_v.plan_code, v_v.months, 'pending', 'voucher')
  returning * into v_sub;
  insert into public.gm_payments (store_id, subscription_id, amount, method, reference, status, validated_at, note)
  values (v_store.id, v_sub.id, v_plan.price_month * v_v.months, 'carte_bon', v_v.serial, 'validated', now(), 'Carte de bon ' || v_v.serial)
  returning id into v_pay;
  v_sub := public.gm_activate_subscription(v_sub.id);
  update public.gm_vouchers set status = 'used', used_at = now(), store_id = v_store.id, payment_id = v_pay where id = v_v.id;
  insert into public.gm_license_events (store_id, kind, detail)
  values (v_store.id, 'voucher_used', jsonb_build_object('serial', v_v.serial, 'plan', v_v.plan_code, 'months', v_v.months, 'pc_id', v_pc));
  return jsonb_build_object('ok', true, 'serial', v_v.serial, 'plan', v_plan.code, 'plan_label', v_plan.label,
                            'months', v_v.months, 'starts_at', v_sub.starts_at, 'ends_at', v_sub.ends_at);
end;
$$;

-- ───────────────────────────── Carte Visa (Cybersource), réservé à « gm-pay » ─────────────────────────────

-- Début d'un paiement par carte : abonnement et paiement « pending » ; « gm-pay » signe la demande.
create or replace function public.gm_card_start(p_pc_id text, p_plan text, p_months int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_store public.gm_stores := public.gm_pc_store(p_pc_id);
  v_plan  public.gm_plans;
  v_sub   uuid;
  v_pay   uuid;
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

  v_amount := v_plan.price_month * p_months;
  insert into public.gm_subscriptions (store_id, plan_code, months, status, source)
  values (v_store.id, v_plan.code, p_months, 'pending', 'payment')
  returning id into v_sub;
  insert into public.gm_payments (store_id, subscription_id, amount, method, status)
  values (v_store.id, v_sub, v_amount, 'carte_visa', 'pending')
  returning id into v_pay;
  return jsonb_build_object(
    'payment_id', v_pay, 'amount', v_amount, 'plan_label', v_plan.label, 'months', p_months,
    'currency', coalesce((select value from public.gm_config where key = 'card_currency'), 'XOF'),
    'store', jsonb_build_object('code', v_store.code, 'name', v_store.name, 'owner_name', v_store.owner_name, 'email', v_store.email,
                                'phone', v_store.phone, 'country', v_store.country, 'city', v_store.city, 'address', v_store.address)
  );
end;
$$;

-- Résultat signé envoyé par Cybersource (vérifié par « gm-pay ») : validé, refusé, ou à vérifier.
create or replace function public.gm_card_result(p_payment_id uuid, p_decision text, p_amount numeric, p_currency text,
                                                 p_transaction_id text, p_message text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pay public.gm_payments;
  v_cur text := coalesce((select value from public.gm_config where key = 'card_currency'), 'XOF');
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
  if upper(p_decision) = 'ACCEPT' and p_amount = v_pay.amount and upper(coalesce(p_currency, '')) = upper(v_cur) then
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

-- ───────────────────────────── Tableau de bord Eden Dev ─────────────────────────────

create or replace view public.gm_paiements_a_valider
with (security_invoker = true)
as
select p.id, p.created_at, s.code as boutique, s.name as nom_boutique, s.owner_name as proprietaire, s.phone as telephone,
       pl.label as formule, x.months as mois, p.amount as montant, p.method as moyen, p.reference, p.payer_phone, p.status,
       p.note, p.provider_ref
from public.gm_payments p
join public.gm_stores s on s.id = p.store_id
join public.gm_subscriptions x on x.id = p.subscription_id
join public.gm_plans pl on pl.code = x.plan_code
order by p.created_at desc;
revoke all on public.gm_paiements_a_valider from anon, authenticated;

-- Cartes de bon avec la boutique qui les a utilisées.
create or replace view public.gm_cartes_de_bon
with (security_invoker = true)
as
select v.serial as numero, v.batch as lot, pl.label as formule, v.months as mois, pl.price_month * v.months as valeur,
       v.status, v.note, v.created_at, v.sold_at, v.used_at, s.code as boutique, s.name as nom_boutique
from public.gm_vouchers v
join public.gm_plans pl on pl.code = v.plan_code
left join public.gm_stores s on s.id = v.store_id
order by v.created_at desc, v.serial;
revoke all on public.gm_cartes_de_bon from anon, authenticated;

-- ───────────────────────────── Droits d'exécution ─────────────────────────────

revoke all on function public.gm_activate_subscription(uuid) from public, anon, authenticated;
revoke all on function public.gm_pc_store(text) from public, anon, authenticated;
revoke all on function public.gm_voucher_batch(text, int, int, text) from public, anon, authenticated;
revoke all on function public.gm_voucher_hash(text) from public, anon, authenticated;
revoke all on function public.gm_voucher_normalize(text) from public, anon, authenticated;
revoke all on function public.gm_card_start(text, text, int) from public, anon, authenticated;
revoke all on function public.gm_card_result(uuid, text, numeric, text, text, text) from public, anon, authenticated;
grant execute on function public.gm_card_start(text, text, int) to service_role;
grant execute on function public.gm_card_result(uuid, text, numeric, text, text, text) to service_role;

revoke all on function public.gm_pc_payments(text) from public;
revoke all on function public.gm_pc_declare_payment(text, text, int, text, text) from public;
revoke all on function public.gm_redeem_voucher(text, text) from public;
grant execute on function public.gm_pc_payments(text) to anon, authenticated;
grant execute on function public.gm_pc_declare_payment(text, text, int, text, text) to anon, authenticated;
grant execute on function public.gm_redeem_voucher(text, text) to anon, authenticated;
