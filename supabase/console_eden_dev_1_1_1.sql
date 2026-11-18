-- Console Eden Dev 1.1.1 — carte bancaire (Visa, Mastercard) en mode essai (avec gestimarket_0_34_1.sql, à appliquer avant).
--   - Réglages → Carte bancaire : « card_test_stores », codes GM-… des boutiques d'essai (existantes, 20 au plus) ;
--     nombre de paiements par carte d'essai et réels acceptés ;
--   - recettes du tableau de bord sans les paiements d'essai ; liste des paiements et fiche boutique : « test ».
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
                             'whatsapp_enabled', 'whatsapp_number', 'payment_instructions', 'console_owner_email', 'cinetpay_enabled')),
    'plans', (select coalesce(jsonb_agg(jsonb_build_object('code', code, 'label', label, 'price_month', price_month,
                                                           'max_postes', max_postes, 'active', active, 'description', description)
                                        order by sort), '[]'::jsonb) from public.gm_plans),
    'whatsapp_ready', exists (select 1 from public.gm_whatsapp_contacts where last_inbound_at > now() - interval '30 days'),
    'cinetpay', jsonb_build_object(
      'orders', (select count(*) from public.gm_cinetpay_orders),
      'success', (select count(*) from public.gm_cinetpay_orders where status = 'success'),
      'last_error', (select last_error from public.gm_cinetpay_orders where last_error <> '' order by updated_at desc limit 1)),
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
                   'whatsapp_enabled', 'payment_instructions', 'cinetpay_enabled') then
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

-- Recettes, liste des paiements et fiche boutique : un paiement d'essai par carte compte comme les cartes de bon « TEST ».
do $$
declare
  d text;
  n text;
begin
  -- Tableau de bord : recettes sans les paiements d'essai.
  d := pg_get_functiondef('public.gm_console_dashboard(text)'::regprocedure);
  if position('not p.test' in d) = 0 then
    n := replace(replace(d,
      'where p.status = ''validated'' and p.validated_at >= v_month',
      'where p.status = ''validated'' and not p.test and p.validated_at >= v_month'),
      'where p.status = ''validated'' and p.validated_at >= v_prev',
      'where p.status = ''validated'' and not p.test and p.validated_at >= v_prev');
    if n = d then
      raise exception using message = 'gm_console_dashboard: expected text not found';
    end if;
    execute n;
  end if;

  -- Liste des paiements : colonne « test ».
  d := pg_get_functiondef('public.gm_console_payments(text, text, text, text, date, date)'::regprocedure);
  if position('(p.test or exists' in d) = 0 then
    n := replace(d,
      'exists (select 1 from public.gm_vouchers v where v.payment_id = p.id and v.batch = ''TEST'') as test',
      '(p.test or exists (select 1 from public.gm_vouchers v where v.payment_id = p.id and v.batch = ''TEST'')) as test');
    if n = d then
      raise exception using message = 'gm_console_payments: expected text not found';
    end if;
    execute n;
  end if;

  -- Fiche boutique : paiements, champ « test ».
  d := pg_get_functiondef('public.gm_console_store(text, uuid)'::regprocedure);
  if position('''test'', p.test or exists' in d) = 0 then
    n := replace(d,
      '''test'', exists (select 1 from public.gm_vouchers v where v.payment_id = p.id and v.batch = ''TEST'')',
      '''test'', p.test or exists (select 1 from public.gm_vouchers v where v.payment_id = p.id and v.batch = ''TEST'')');
    if n = d then
      raise exception using message = 'gm_console_store: expected text not found';
    end if;
    execute n;
  end if;
end;
$$;
