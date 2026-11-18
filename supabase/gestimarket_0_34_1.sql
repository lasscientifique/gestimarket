-- GestiMarket 0.34.1 / Console Eden Dev 1.1.1 — carte bancaire (Visa, Mastercard) : mode essai sans risque.
--
-- Avant d'ouvrir la carte à toutes les boutiques, Eden Dev l'essaie avec un compte d'essai Cybersource
-- (secret CYBS_ENV = test, cartes de test publiques, aucun argent). Sans garde, la carte ouverte en mode essai
-- laisserait n'importe quelle boutique payer avec une carte de test et recevoir une vraie licence. Donc :
--   - réglage « card_test_stores » (Console → Réglages → Carte bancaire) : codes GM-… des boutiques d'essai ;
--     il n'est pas lisible publiquement (gm_config) ;
--   - ces boutiques voient la carte même fermée : gm_public_options(p_store) ;
--   - gm-pay en mode essai (p_test) : paiement commencé puis résultat acceptés seulement pour ces boutiques ;
--     le paiement est marqué (gm_payments.test) et n'entre pas dans les recettes de la console ;
--   - carte ouverte à toutes (card_enabled = true) : seulement avec CYBS_ENV = live ; en essai, gm-pay refuse
--     toujours les autres boutiques ;
--   - libellés : « carte Visa » devient « carte bancaire » (Visa, Mastercard).
-- Console (réglage, recettes, colonne « test ») : console_eden_dev_1_1_1.sql.
-- Fichier rejouable.

alter table public.gm_payments add column if not exists test boolean not null default false;
comment on column public.gm_payments.test is 'Paiement d''essai (Cybersource en mode test) : hors des recettes.';

insert into public.gm_config (key, value) values ('card_test_stores', '') on conflict (key) do nothing;

-- La liste des boutiques d'essai n'est pas publique (le reste de gm_config l'est : moyens de paiement, essai…).
alter policy "gm lecture publique" on public.gm_config using (key <> 'card_test_stores');

-- Boutique d'essai de la carte ?
create or replace function public.gm_card_test_store(p_code text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(nullif(upper(trim(p_code)), ''), '-') = any (
    string_to_array(replace(upper(coalesce((select value from public.gm_config where key = 'card_test_stores'), '')), ' ', ''), ','))
$$;

-- ───────────────────────────── Options publiques ─────────────────────────────
-- p_store (0.34.1) : code de la boutique de ce PC. Boutique d'essai : carte ouverte (card_test).
-- Sans argument (versions précédentes, formulaire d'inscription) : comme avant.

drop function if exists public.gm_public_options();
create or replace function public.gm_public_options(p_store text default null)
returns jsonb
language sql
stable
security definer
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
      'card_enabled', coalesce((select value from public.gm_config where key = 'card_enabled'), 'false') = 'true'
                      or public.gm_card_test_store(p_store),
      'card_test', public.gm_card_test_store(p_store),
      'card_currency', upper(coalesce((select value from public.gm_config where key = 'card_currency'), 'XOF')),
      'card_currencies', to_jsonb(string_to_array(replace(upper(coalesce((select value from public.gm_config where key = 'card_currencies'), 'XOF')), ' ', ''), ',')),
      'cinetpay_enabled', coalesce((select value from public.gm_config where key = 'cinetpay_enabled'), 'false') = 'true'
    ),
    'whatsapp', coalesce((select value from public.gm_config where key = 'whatsapp_enabled'), 'false') = 'true',
    'whatsapp_number', coalesce((select value from public.gm_config where key = 'whatsapp_number'), '')
  )
$$;

-- ───────────────────────────── Paiement par carte (gm-pay) ─────────────────────────────
-- p_test : gm-pay en mode essai (CYBS_ENV ≠ live). Les anciennes signatures sont remplacées (argument par défaut :
-- un gm-pay pas encore redéployé continue de marcher).

drop function if exists public.gm_card_start(text, text, int);
drop function if exists public.gm_card_start_owner(uuid, text, text, int);
drop function if exists public.gm_card_start_store(uuid, text, int);
drop function if exists public.gm_card_result(uuid, text, numeric, text, text, text);

create or replace function public.gm_card_start_store(p_store_id uuid, p_plan text, p_months int, p_test boolean default false)
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
  v_test   boolean := coalesce(p_test, false);
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
  -- Mode essai : boutiques d'essai seulement (cartes de test, aucun argent).
  if v_test and not public.gm_card_test_store(v_store.code) then
    raise exception 'Le paiement par carte bancaire est en essai chez Eden Dev : utilisez un autre moyen de paiement.';
  end if;
  if not v_test and not public.gm_card_test_store(v_store.code)
     and coalesce((select value from public.gm_config where key = 'card_enabled'), 'false') <> 'true' then
    raise exception 'Le paiement par carte bancaire n''est pas encore ouvert : utilisez un autre moyen de paiement.';
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
    raise exception 'Prix de la formule non défini pour la carte bancaire : contactez Eden Dev.';
  end if;
  v_amount := v_price * public.gm_billed_months(p_months);

  insert into public.gm_subscriptions (store_id, plan_code, months, status, source)
  values (v_store.id, v_plan.code, p_months, 'pending', 'payment')
  returning id into v_sub;
  insert into public.gm_payments (store_id, subscription_id, amount, currency, method, status, test)
  values (v_store.id, v_sub, v_amount, v_cur, 'carte_visa', 'pending', v_test)
  returning id into v_pay;
  return jsonb_build_object(
    'payment_id', v_pay, 'amount', v_amount, 'plan_label', v_plan.label, 'months', p_months, 'currency', v_cur, 'test', v_test,
    'store', jsonb_build_object('code', v_store.code, 'name', v_store.name, 'owner_name', v_store.owner_name, 'email', v_store.email,
                                'phone', v_store.phone, 'country', v_store.country, 'city', v_store.city, 'address', v_store.address)
  );
end;
$$;

create or replace function public.gm_card_start(p_pc_id text, p_plan text, p_months int, p_test boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  return public.gm_card_start_store((public.gm_pc_store(p_pc_id)).id, p_plan, p_months, p_test);
end;
$$;

create or replace function public.gm_card_start_owner(p_uid uuid, p_store_code text, p_plan text, p_months int, p_test boolean default false)
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
  return public.gm_card_start_store(v_id, p_plan, p_months, p_test);
end;
$$;

-- Résultat signé envoyé par Cybersource. Mode essai : accepté seulement pour un paiement commencé en essai par une
-- boutique encore dans la liste d'essai.
create or replace function public.gm_card_result(p_payment_id uuid, p_decision text, p_amount numeric, p_currency text,
                                                 p_transaction_id text, p_message text, p_test boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pay  public.gm_payments;
  v_test boolean := coalesce(p_test, false);
  v_msg  text := left(coalesce(p_message, ''), 200);
begin
  select * into v_pay from public.gm_payments where id = p_payment_id for update;
  if not found or v_pay.method <> 'carte_visa' then
    return jsonb_build_object('ok', false, 'error', 'Paiement inconnu.');
  end if;
  if v_pay.status <> 'pending' then
    return jsonb_build_object('ok', true, 'status', v_pay.status);
  end if;
  update public.gm_payments set provider_ref = left(coalesce(p_transaction_id, ''), 80), reference = left(coalesce(p_transaction_id, ''), 80)
   where id = v_pay.id;
  if v_test and (not v_pay.test or not public.gm_card_test_store((select s.code from public.gm_stores s where s.id = v_pay.store_id))) then
    update public.gm_payments set status = 'refused', test = true,
           note = 'Paiement d''essai refusé : boutique hors de la liste d''essai d''Eden Dev.'
     where id = v_pay.id;
  elsif not v_test and v_pay.test then
    -- Commencé en essai mais confirmé par le profil réel : de l'argent a pu être pris, Eden Dev vérifie.
    update public.gm_payments set status = 'declared', test = false,
           note = 'Carte bancaire : paiement commencé en essai et confirmé en réel, à vérifier. ' || v_msg
     where id = v_pay.id;
  elsif upper(p_decision) = 'ACCEPT' and p_amount = v_pay.amount and upper(coalesce(p_currency, '')) = upper(v_pay.currency) then
    update public.gm_payments set status = 'validated', note = 'Carte bancaire acceptée (Cybersource)' where id = v_pay.id;
  elsif upper(p_decision) in ('ACCEPT', 'REVIEW') then
    update public.gm_payments set status = 'declared',
           note = case when upper(p_decision) = 'REVIEW' then 'Carte bancaire : paiement en vérification chez Cybersource. '
                       else 'Carte bancaire : montant ou devise inattendus, à vérifier. ' end || v_msg
     where id = v_pay.id;
  else
    update public.gm_payments set status = 'refused', note = 'Carte bancaire refusée ou annulée : ' || v_msg where id = v_pay.id;
  end if;
  return jsonb_build_object('ok', true, 'status', (select status from public.gm_payments where id = v_pay.id));
end;
$$;

-- ───────────────────────────── Droits d'exécution ─────────────────────────────

revoke all on function public.gm_card_test_store(text) from public, anon, authenticated;
revoke all on function public.gm_public_options(text) from public;
grant execute on function public.gm_public_options(text) to anon, authenticated;

do $$
declare
  f text;
begin
  -- Réservées à gm-pay (service_role).
  foreach f in array array[
    'gm_card_test_store(text)', 'gm_card_start_store(uuid, text, integer, boolean)', 'gm_card_start(text, text, integer, boolean)',
    'gm_card_start_owner(uuid, text, text, integer, boolean)', 'gm_card_result(uuid, text, numeric, text, text, text, boolean)']
  loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end;
$$;
