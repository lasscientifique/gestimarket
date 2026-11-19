-- Console Eden Dev 1.1.2 — paiements Orange Money, Wave et Moov Money sans ID de transaction (avec gestimarket_0_34_2.sql).
--   - Paiements → Valider : l'ID de la transaction lu dans le SMS de l'opérateur peut être collé (facultatif) ; il est
--     gardé sur le paiement et contrôlé (jamais deux fois le même). La console 1.1.1 valide toujours sans ID.
--   - Fiche boutique → « Enregistrer un paiement reçu » (Direction, Paiements) : paiement payé hors de GestiMarket
--     (« c'est payé » sur WhatsApp) ; l'abonnement est activé tout de suite et compte dans les recettes.
-- Fichier rejouable.

drop function if exists public.gm_console_payment_decide(text, uuid, text, text);
create or replace function public.gm_console_payment_decide(p_device text, p_payment_id uuid, p_decision text, p_reason text default '',
                                                            p_reference text default '')
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
  v_ref   text := upper(left(regexp_replace(trim(coalesce(p_reference, '')), '\s+', '', 'g'), 80));
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
    if v_ref <> '' and length(v_ref) < 4 then
      raise exception 'ID de transaction trop court : recopiez-le du SMS, ou laissez la case vide.';
    end if;
    if v_ref <> '' and exists (select 1 from public.gm_payments where id <> v_pay.id and upper(reference) = v_ref
                                 and method = v_pay.method and status <> 'refused') then
      raise exception 'Cet ID de transaction est déjà sur un autre paiement : vérifiez le SMS.';
    end if;
    update public.gm_payments set status = 'validated',
           reference = case when v_ref <> '' then v_ref else reference end,
           note = case when v_why <> '' then v_why else 'Validé par Eden Dev' end
     where id = v_pay.id;
  elsif p_decision = 'refuse' then
    v_why := public.gm_admin_reason(p_reason);
    update public.gm_payments set status = 'refused', note = v_why where id = v_pay.id;
  else
    raise exception 'Décision inconnue.';
  end if;
  perform public.gm_admin_log(v_admin, case when p_decision = 'validate' then 'Paiement validé' else 'Paiement refusé' end,
    v_store.code, v_why, jsonb_build_object('payment_id', v_pay.id, 'method', v_pay.method, 'amount', v_pay.amount,
                                            'reference', case when p_decision = 'validate' and v_ref <> '' then v_ref else v_pay.reference end,
                                            'declared_reference', v_pay.reference));
  return jsonb_build_object('ok', true, 'status', (select status from public.gm_payments where id = v_pay.id));
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
    if v_method not in ('orange_money', 'moov_money', 'wave', 'virement', 'especes', 'autre') then
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

revoke all on function public.gm_console_payment_decide(text, uuid, text, text, text) from public, anon;
grant execute on function public.gm_console_payment_decide(text, uuid, text, text, text) to authenticated;
revoke all on function public.gm_console_store_action(text, uuid, text, jsonb, text) from public, anon;
grant execute on function public.gm_console_store_action(text, uuid, text, jsonb, text) to authenticated;

notify pgrst, 'reload schema';
