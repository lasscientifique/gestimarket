-- GestiMarket 0.35 — PI-SPI de la BCEAO (paiement instantané interopérable de l'UEMOA).
--   - Abonnement : nouveau moyen « pispi ». La boutique paie l'alias PI-SPI d'Eden Dev depuis n'importe quelle banque
--     ou portefeuille (QR avec le montant exact et une référence), puis « J'ai payé » ; Eden Dev valide dans la console.
--   - Réglages d'Eden Dev (gm_config) : pispi_alias (36 caractères ; vide : fermé), pispi_name, pispi_phone.
--   - La caisse des boutiques (QR PI-SPI avec le montant de la vente) n'a besoin de rien ici : tout est dans GestiMarket.
-- Fichier rejouable.

alter table public.gm_payments drop constraint if exists gm_payments_method_check;
alter table public.gm_payments add constraint gm_payments_method_check
  check (method = any (array['carte_bon', 'orange_money', 'carte_visa', 'moov_money', 'wave', 'virement', 'especes', 'autre', 'cinetpay', 'pispi']));
alter table public.gm_card_sales drop constraint if exists gm_card_sales_method_check;
alter table public.gm_card_sales add constraint gm_card_sales_method_check
  check (method = any (array['orange_money', 'wave', 'moov_money', 'especes', 'virement', 'autre', 'offert', 'cinetpay', 'pispi']));

insert into public.gm_config (key, value) values ('pispi_alias', ''), ('pispi_name', ''), ('pispi_phone', '')
on conflict (key) do nothing;

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
      'cinetpay_enabled', coalesce((select value from public.gm_config where key = 'cinetpay_enabled'), 'false') = 'true',
      -- 0.35 : PI-SPI de la BCEAO (alias du compte d'Eden Dev ; vide : fermé), validé par Eden Dev.
      'pispi_alias', coalesce((select value from public.gm_config where key = 'pispi_alias'), ''),
      'pispi_name', coalesce((select value from public.gm_config where key = 'pispi_name'), ''),
      'pispi_phone', coalesce((select value from public.gm_config where key = 'pispi_phone'), '')
    ),
    'whatsapp', coalesce((select value from public.gm_config where key = 'whatsapp_enabled'), 'false') = 'true',
    'whatsapp_number', coalesce((select value from public.gm_config where key = 'whatsapp_number'), '')
  )
$$;

create or replace function public.gm_pc_declare_payment(p_pc_id text, p_plan text, p_months integer, p_reference text, p_payer_phone text,
                                                         p_method text default 'orange_money')
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
  v_method text := coalesce(nullif(p_method, ''), 'orange_money');
  v_ref    text := upper(left(regexp_replace(trim(coalesce(p_reference, '')), '\s+', '', 'g'), 80));
  v_phone  text := left(trim(coalesce(p_payer_phone, '')), 40);
begin
  if v_method not in ('orange_money', 'moov_money', 'wave', 'pispi') then
    raise exception 'Moyen de paiement inconnu.';
  end if;
  select * into v_plan from public.gm_plans where code = p_plan and active and code <> 'free';
  if not found then
    raise exception 'Formule inconnue.';
  end if;
  if p_months is null or p_months not in (1, 3, 6, 12) then
    raise exception 'Durée invalide : 1, 3, 6 ou 12 mois.';
  end if;
  if v_ref <> '' and length(v_ref) < 4 then
    raise exception 'ID de transaction trop court : recopiez-le du SMS, ou laissez la case vide.';
  end if;
  if v_ref = '' and length(regexp_replace(v_phone, '\D', '', 'g')) < 8 then
    raise exception 'Saisissez le numéro qui a payé : Eden Dev retrouve votre paiement grâce à ce numéro.';
  end if;
  if (select count(*) from public.gm_payments where store_id = v_store.id and status = 'declared') >= 3 then
    raise exception 'Trois paiements attendent déjà la validation d''Eden Dev : patientez.';
  end if;
  if v_ref <> '' and exists (select 1 from public.gm_payments where upper(reference) = v_ref and method = v_method and status <> 'refused') then
    raise exception 'Cet ID de transaction a déjà été déclaré.';
  end if;

  v_amount := v_plan.price_month * public.gm_billed_months(p_months);
  insert into public.gm_subscriptions (store_id, plan_code, months, status, source)
  values (v_store.id, v_plan.code, p_months, 'pending', 'payment')
  returning id into v_sub;
  insert into public.gm_payments (store_id, subscription_id, amount, method, reference, payer_phone)
  values (v_store.id, v_sub, v_amount, v_method, v_ref, v_phone)
  returning id into v_pay;
  insert into public.gm_license_events (store_id, kind, detail)
  values (v_store.id, 'payment_declared', jsonb_build_object('payment_id', v_pay, 'plan', v_plan.code, 'months', p_months, 'amount', v_amount, 'method', v_method));
  return jsonb_build_object('payment_id', v_pay, 'amount', v_amount, 'plan', v_plan.code, 'plan_label', v_plan.label, 'months', p_months, 'method', v_method);
end;
$$;

create or replace function public.gm_declare_payment(p_store_code text, p_plan text, p_months integer, p_method text, p_reference text, p_payer_phone text)
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
  v_phone  text := left(trim(coalesce(p_payer_phone, '')), 40);
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
  if p_method is null or p_method not in ('orange_money', 'moov_money', 'wave', 'pispi', 'virement', 'especes', 'autre') then
    raise exception 'Moyen de paiement inconnu.';
  end if;
  if v_ref <> '' and length(v_ref) < 4 then
    raise exception 'ID de transaction trop court : recopiez-le du SMS, ou laissez la case vide.';
  end if;
  if v_ref = '' and length(regexp_replace(v_phone, '\D', '', 'g')) < 8 then
    raise exception 'Saisissez le numéro qui a payé : Eden Dev retrouve votre paiement grâce à ce numéro.';
  end if;
  if (select count(*) from public.gm_payments where store_id = v_store.id and status = 'declared') >= 3 then
    raise exception 'Trois paiements attendent déjà la validation d''Eden Dev : patientez.';
  end if;
  if v_ref <> '' and exists (select 1 from public.gm_payments where upper(reference) = upper(v_ref) and method = p_method and status <> 'refused') then
    raise exception 'Cette référence de transaction a déjà été déclarée.';
  end if;

  v_amount := v_plan.price_month * public.gm_billed_months(p_months);
  insert into public.gm_subscriptions (store_id, plan_code, months, status, source)
  values (v_store.id, v_plan.code, p_months, 'pending', 'payment')
  returning id into v_sub;
  insert into public.gm_payments (store_id, subscription_id, amount, method, reference, payer_phone)
  values (v_store.id, v_sub, v_amount, p_method, v_ref, v_phone)
  returning id into v_pay;
  insert into public.gm_license_events (store_id, kind, detail)
  values (v_store.id, 'payment_declared', jsonb_build_object('payment_id', v_pay, 'plan', v_plan.code, 'months', p_months, 'amount', v_amount, 'method', p_method));
  return jsonb_build_object('payment_id', v_pay, 'amount', v_amount, 'plan', v_plan.code, 'plan_label', v_plan.label, 'months', p_months);
end;
$$;
