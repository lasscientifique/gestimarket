-- Console Eden Dev 1.2 — PI-SPI de la BCEAO (avec gestimarket_0_35.sql, à appliquer avant).
--   - Réglages → PI-SPI : alias du compte d'Eden Dev (vérifié : 36 caractères), nom affiché, numéro facultatif ;
--     nombre de paiements PI-SPI à valider et validés.
--   - « Paiement reçu » (fiche boutique) et « Vendre une carte » : moyen « pispi » (ID de transaction facultatif).
-- Fichier rejouable.

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
                             'moov_merchant_number', 'moov_merchant_name', 'trial_days', 'trial_plan', 'card_enabled', 'card_test_stores',
                             'whatsapp_enabled', 'whatsapp_number', 'payment_instructions', 'console_owner_email', 'cinetpay_enabled',
                             'pispi_alias', 'pispi_name', 'pispi_phone')),
    'plans', (select coalesce(jsonb_agg(jsonb_build_object('code', code, 'label', label, 'price_month', price_month,
                                                           'max_postes', max_postes, 'active', active, 'description', description)
                                        order by sort), '[]'::jsonb) from public.gm_plans),
    'whatsapp_ready', exists (select 1 from public.gm_whatsapp_contacts where last_inbound_at > now() - interval '30 days'),
    'cinetpay', jsonb_build_object(
      'orders', (select count(*) from public.gm_cinetpay_orders),
      'success', (select count(*) from public.gm_cinetpay_orders where status = 'success'),
      'last_error', (select last_error from public.gm_cinetpay_orders where last_error <> '' order by updated_at desc limit 1)),
    'pispi', jsonb_build_object(
      'declared', (select count(*) from public.gm_payments where method = 'pispi' and status = 'declared'),
      'validated', (select count(*) from public.gm_payments where method = 'pispi' and status = 'validated')),
    'card', jsonb_build_object(
      'test_payments', (select count(*) from public.gm_payments where method = 'carte_visa' and test),
      'test_accepted', (select count(*) from public.gm_payments where method = 'carte_visa' and test and status = 'validated'),
      'real_accepted', (select count(*) from public.gm_payments where method = 'carte_visa' and not test and status = 'validated'))
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
  v_bad    text;
begin
  if p_key not in ('om_merchant_code', 'om_merchant_name', 'om_qr_payload', 'wave_merchant_number', 'wave_merchant_name',
                   'moov_merchant_number', 'moov_merchant_name', 'trial_days', 'trial_plan', 'card_enabled', 'card_test_stores',
                   'whatsapp_enabled', 'payment_instructions', 'cinetpay_enabled',
                   'pispi_alias', 'pispi_name', 'pispi_phone') then
    raise exception 'Réglage non modifiable depuis la console.';
  end if;
  if p_key = 'trial_days' and (v_value !~ '^[0-9]{1,2}$' or v_value::int > 60) then
    raise exception 'Durée de l''essai : de 0 à 60 jours.';
  end if;
  if p_key = 'trial_plan' and not exists (select 1 from public.gm_plans where code = v_value and code <> 'free') then
    raise exception 'Formule d''essai inconnue.';
  end if;
  if p_key in ('card_enabled', 'whatsapp_enabled', 'cinetpay_enabled') and v_value not in ('true', 'false') then
    raise exception 'Valeur attendue : oui ou non.';
  end if;
  if p_key in ('wave_merchant_number', 'moov_merchant_number') and v_value <> '' and v_value !~ '^\+?[0-9 ]{8,20}$' then
    raise exception 'Numéro invalide.';
  end if;
  if p_key = 'pispi_alias' then
    -- Alias PI-SPI : identifiant de 36 caractères (application de la banque ou du portefeuille → PI-SPI → Détails du compte).
    v_value := lower(v_value);
    if v_value <> '' and v_value !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'Alias PI-SPI invalide : 36 caractères, comme 341c3e1b-4312-49ec-b75e-4c8c74c10fd7.';
    end if;
  end if;
  if p_key = 'pispi_phone' and v_value <> '' and v_value !~ '^\+?[0-9 ]{8,20}$' then
    raise exception 'Numéro invalide.';
  end if;
  if p_key = 'card_test_stores' then
    -- « gm-000001 ; GM-000002 » → « GM-000001,GM-000002 » ; boutiques existantes seulement, 20 au plus.
    v_value := array_to_string(array(
      select distinct x from unnest(string_to_array(upper(regexp_replace(v_value, '[\s,;]+', ',', 'g')), ',')) x
      where x <> '' order by x), ',');
    if cardinality(string_to_array(nullif(v_value, ''), ',')) > 20 then
      raise exception 'Boutiques d''essai : 20 au plus.';
    end if;
    select string_agg(x, ', ') into v_bad
      from unnest(string_to_array(nullif(v_value, ''), ',')) x
     where not exists (select 1 from public.gm_stores s where s.code = x);
    if v_bad is not null then
      raise exception 'Boutique inconnue : %', v_bad;
    end if;
  end if;
  select value into v_old from public.gm_config where key = p_key;
  insert into public.gm_config (key, value) values (p_key, left(v_value, 2000))
  on conflict (key) do update set value = excluded.value;
  perform public.gm_admin_log(v_admin, 'Réglage modifié', p_key, v_reason,
    jsonb_build_object('before', left(coalesce(v_old, ''), 200), 'after', left(v_value, 200)));
  return jsonb_build_object('ok', true);
end;
$$;

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
  v_months int;
  v_method text;
  v_ref    text;
  v_amount int;
  v_sub    uuid;
  v_pay    uuid;
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

  elsif p_action = 'record_payment' then
    -- Paiement reçu hors de GestiMarket (« c'est payé » sur WhatsApp, espèces…) : activé tout de suite, compté dans les recettes.
    if v_admin.role = 'assistance' then
      raise exception 'Enregistrer un paiement est réservé à la Direction et aux Paiements.';
    end if;
    select * into v_plan from public.gm_plans where code = p_args ->> 'plan' and active and code <> 'free';
    if not found then
      raise exception 'Formule inconnue.';
    end if;
    v_months := case when coalesce(p_args ->> 'months', '') ~ '^[0-9]{1,2}$' then (p_args ->> 'months')::int end;
    if v_months is null or v_months not in (1, 3, 6, 12) then
      raise exception 'Durée invalide : 1, 3, 6 ou 12 mois.';
    end if;
    v_method := coalesce(nullif(p_args ->> 'method', ''), 'orange_money');
    if v_method not in ('orange_money', 'moov_money', 'wave', 'pispi', 'virement', 'especes', 'autre') then
      raise exception 'Moyen de paiement inconnu.';
    end if;
    v_ref := upper(left(regexp_replace(trim(coalesce(p_args ->> 'reference', '')), '\s+', '', 'g'), 80));
    if v_ref <> '' and length(v_ref) < 4 then
      raise exception 'ID de transaction trop court : recopiez-le du SMS, ou laissez la case vide.';
    end if;
    if v_ref <> '' and exists (select 1 from public.gm_payments where upper(reference) = v_ref and method = v_method and status <> 'refused') then
      raise exception 'Cet ID de transaction est déjà sur un autre paiement : vérifiez le SMS.';
    end if;
    v_amount := v_plan.price_month * public.gm_billed_months(v_months);
    insert into public.gm_subscriptions (store_id, plan_code, months, status, source)
    values (v_store.id, v_plan.code, v_months, 'pending', 'payment')
    returning id into v_sub;
    insert into public.gm_payments (store_id, subscription_id, amount, method, reference, payer_phone, note)
    values (v_store.id, v_sub, v_amount, v_method, v_ref, left(trim(coalesce(p_args ->> 'payer_phone', '')), 40), 'Enregistré par Eden Dev')
    returning id into v_pay;
    -- Le passage à « validé » active l'abonnement (déclencheur gm_payment_status) : la licence part toute seule.
    update public.gm_payments set status = 'validated' where id = v_pay;
    v_detail := jsonb_build_object('payment_id', v_pay, 'plan', v_plan.code, 'months', v_months, 'method', v_method,
                                   'amount', v_amount, 'reference', v_ref, 'payer_phone', p_args ->> 'payer_phone');

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
      when 'record_payment' then 'Paiement enregistré'
      else 'Coordonnées corrigées' end,
    v_store.code, v_reason, v_detail);
  return jsonb_build_object('ok', true, 'amount', v_amount, 'plan', v_plan.label, 'months', v_months);
end;
$$;

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
  if p_method not in ('orange_money', 'wave', 'moov_money', 'pispi', 'especes', 'virement', 'autre', 'offert', 'cinetpay') then
    raise exception 'Moyen de paiement inconnu.';
  end if;
  if p_method = 'cinetpay' then
    if coalesce((select value from public.gm_config where key = 'cinetpay_enabled'), 'false') <> 'true' then
      raise exception 'CinetPay n''est pas encore ouvert (Réglages → Paiements).';
    end if;
    v_ref := '';
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
  insert into public.gm_card_sales (created_by, seller_email, phone, client_name, plan_code, months, amount, method, reference, store_id, status)
  values (v_admin.user_id, v_admin.email, v_phone, left(trim(coalesce(p_name, '')), 80), v_plan.code, p_months,
          case when p_method = 'offert' then 0 else v_plan.price_month * public.gm_billed_months(p_months) end,
          p_method, v_ref, v_store.id, case when p_method = 'cinetpay' then 'unpaid' else 'waiting' end)
  returning * into v_sale;
  perform public.gm_admin_log(v_admin, 'Carte vendue par WhatsApp', coalesce(v_store.code, '+' || v_phone), p_method,
    jsonb_build_object('sale_id', v_sale.id, 'phone', v_phone, 'plan', v_plan.code, 'months', p_months, 'amount', v_sale.amount, 'reference', v_ref));
  return jsonb_build_object('id', v_sale.id, 'phone', v_phone, 'amount', v_sale.amount, 'status', v_sale.status,
                            'window_open', public.gm_whatsapp_window_open(v_phone));
end;
$$;

notify pgrst, 'reload schema';
