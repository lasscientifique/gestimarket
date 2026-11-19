-- GestiMarket 0.34.2 — Orange Money, Wave et Moov Money sans ID de transaction.
--   La boutique paie au code marchand (ou au QR code), puis appuie sur « J'ai payé » : l'ID de la transaction devient
--   facultatif. Sans ID, le numéro qui a payé est obligatoire : Eden Dev retrouve le paiement dans le SMS de
--   l'opérateur (montant, numéro, heure), puis le valide dans la console (où il peut coller l'ID du SMS).
--   Un ID donné reste contrôlé : jamais deux fois le même.
--   GestiMarket 0.34.1 et avant envoient encore un ID : ils continuent de marcher.
-- Fichier rejouable.

-- PC de la boutique (licence) : Orange Money (par défaut), Wave ou Moov Money.
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

-- Téléphone de la propriétaire (compte de la boutique).
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
  if p_method is null or p_method not in ('orange_money', 'moov_money', 'wave', 'virement', 'especes', 'autre') then
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
