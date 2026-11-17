-- GestiMarket 0.33 : Wave (PC et téléphone), Moov Money sur PC, carte de bon réservée à une boutique.
--
-- À appliquer après console_eden_dev_1_0.sql (ventes de cartes par WhatsApp : gm_card_sales, gm_cartes_ping,
-- colonnes bound_store_id et sale_id des cartes).
--   - gm_pc_declare_payment : moyen de paiement en plus (orange_money par défaut : GestiMarket 0.32 et avant) ;
--   - gm_declare_payment (téléphone, compte de la boutique) : Wave en plus ;
--   - gm_public_options : numéros marchands Wave et Moov Money (réglés dans la Console Eden Dev) ;
--   - gm_redeem_voucher_store : carte réservée à une boutique ; carte vendue par WhatsApp utilisée → suivi de la
--     vente et confirmation « Abonnement … actif jusqu'au … » au client (fonction gm-cartes).

-- ───────────────────────────── Wave, Moov Money sur PC ─────────────────────────────

alter table public.gm_payments drop constraint if exists gm_payments_method_check;
alter table public.gm_payments add constraint gm_payments_method_check
  check (method in ('carte_bon', 'orange_money', 'carte_visa', 'moov_money', 'wave', 'virement', 'especes', 'autre'));

-- PC : Orange Money (par défaut, versions 0.32 et avant), Moov Money ou Wave.
drop function if exists public.gm_pc_declare_payment(text, text, integer, text, text);
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
  v_name   text := case v_method when 'wave' then 'Wave' when 'moov_money' then 'Moov Money' else 'Orange Money' end;
  v_min    int := case when coalesce(nullif(p_method, ''), 'orange_money') = 'orange_money' then 6 else 4 end;
begin
  if v_method not in ('orange_money', 'moov_money', 'wave') then
    raise exception 'Moyen de paiement inconnu.';
  end if;
  select * into v_plan from public.gm_plans where code = p_plan and active and code <> 'free';
  if not found then
    raise exception 'Formule inconnue.';
  end if;
  if p_months is null or p_months not in (1, 3, 6, 12) then
    raise exception 'Durée invalide : 1, 3, 6 ou 12 mois.';
  end if;
  if length(v_ref) < v_min then
    raise exception 'Saisissez l''ID de la transaction % (reçu par SMS après le paiement).', v_name;
  end if;
  if (select count(*) from public.gm_payments where store_id = v_store.id and status = 'declared') >= 3 then
    raise exception 'Trois paiements attendent déjà la validation d''Eden Dev : patientez.';
  end if;
  if exists (select 1 from public.gm_payments where upper(reference) = v_ref and method = v_method and status <> 'refused') then
    raise exception 'Cet ID de transaction a déjà été déclaré.';
  end if;

  v_amount := v_plan.price_month * public.gm_billed_months(p_months);
  insert into public.gm_subscriptions (store_id, plan_code, months, status, source)
  values (v_store.id, v_plan.code, p_months, 'pending', 'payment')
  returning id into v_sub;
  insert into public.gm_payments (store_id, subscription_id, amount, method, reference, payer_phone)
  values (v_store.id, v_sub, v_amount, v_method, v_ref, left(trim(coalesce(p_payer_phone, '')), 40))
  returning id into v_pay;
  insert into public.gm_license_events (store_id, kind, detail)
  values (v_store.id, 'payment_declared', jsonb_build_object('payment_id', v_pay, 'plan', v_plan.code, 'months', p_months, 'amount', v_amount, 'method', v_method));
  return jsonb_build_object('payment_id', v_pay, 'amount', v_amount, 'plan', v_plan.code, 'plan_label', v_plan.label, 'months', p_months, 'method', v_method);
end;
$$;

-- Téléphone (compte de la boutique) : Wave en plus.
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
  if p_method is null or p_method not in ('orange_money', 'moov_money', 'wave', 'virement', 'especes', 'autre') then
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
  values (v_store.id, 'payment_declared', jsonb_build_object('payment_id', v_pay, 'plan', v_plan.code, 'months', p_months, 'amount', v_amount, 'method', p_method));
  return jsonb_build_object('payment_id', v_pay, 'amount', v_amount, 'plan', v_plan.code, 'plan_label', v_plan.label, 'months', p_months);
end;
$$;

-- Options publiques : numéros marchands Wave et Moov Money en plus.
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
      'card_currencies', to_jsonb(string_to_array(replace(upper(coalesce((select value from public.gm_config where key = 'card_currencies'), 'XOF')), ' ', ''), ','))
    ),
    'whatsapp', coalesce((select value from public.gm_config where key = 'whatsapp_enabled'), 'false') = 'true',
    'whatsapp_number', coalesce((select value from public.gm_config where key = 'whatsapp_number'), '')
  )
$$;

-- ───────────────────────────── Cartes de bon ─────────────────────────────

-- Utilisation d'une carte (PC, téléphone) : carte réservée à une boutique, suivi de la vente par WhatsApp.
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
  if v_v.bound_store_id is not null and v_v.bound_store_id <> p_store.id then
    return jsonb_build_object('ok', false, 'error',
      'Cette carte est réservée à la boutique ' || coalesce((select code from public.gm_stores where id = v_v.bound_store_id), '?')
      || ' : contactez Eden Dev si c''est une erreur.');
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
  if v_v.sale_id is not null then
    update public.gm_card_sales set status = 'used', used_at = now(), store_id = coalesce(store_id, p_store.id)
     where id = v_v.sale_id;
    perform public.gm_cartes_ping();
  end if;
  return jsonb_build_object('ok', true, 'serial', v_v.serial, 'plan', v_plan.code, 'plan_label', v_plan.label,
                            'months', v_v.months, 'starts_at', v_sub.starts_at, 'ends_at', v_sub.ends_at);
end;
$$;

-- ───────────────────────────── Droits d'exécution ─────────────────────────────

revoke all on function public.gm_redeem_voucher_store(public.gm_stores, text, jsonb) from public, anon, authenticated;
revoke all on function public.gm_pc_declare_payment(text, text, integer, text, text, text) from public;
grant execute on function public.gm_pc_declare_payment(text, text, integer, text, text, text) to anon, authenticated;
revoke all on function public.gm_declare_payment(text, text, integer, text, text, text) from public, anon;
grant execute on function public.gm_declare_payment(text, text, integer, text, text, text) to authenticated;
