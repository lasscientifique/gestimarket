-- GestiMarket 0.29 : un seul pays par boutique.
-- Le pays du compte (gm_stores.country) est la référence : le logiciel le reprend quand le PC est relié et à
-- chaque vérification de la licence (gm-license renvoie « country »). La propriétaire peut le changer dans
-- « Informations de la boutique » (gm_update_store, champ facultatif « country »).

-- Informations de la boutique : le pays devient modifiable (facultatif : absent = inchangé).
create or replace function public.gm_update_store(p_store_code text, p jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_store   public.gm_stores := public.gm_owner_store(p_store_code);
  v_country text := upper(trim(coalesce(p ->> 'country', '')));
  f         text;
begin
  foreach f in array array['owner_name', 'city', 'address'] loop
    if coalesce(trim(p ->> f), '') = '' then
      raise exception 'Champ obligatoire manquant : %', case f
        when 'owner_name' then 'nom complet de la propriétaire' when 'city' then 'ville' else 'adresse' end;
    end if;
  end loop;
  if v_country = '' then
    v_country := v_store.country;
  elsif not exists (select 1 from public.gm_countries where code = v_country) then
    raise exception 'Pays inconnu.';
  end if;
  update public.gm_stores
     set owner_name = left(trim(p ->> 'owner_name'), 120),
         phone      = left(trim(coalesce(p ->> 'phone', '')), 40),
         city       = left(trim(p ->> 'city'), 80),
         address    = left(trim(p ->> 'address'), 200),
         country    = v_country
   where id = v_store.id;
  insert into public.gm_license_events (store_id, kind, detail)
  values (v_store.id, 'store_updated', jsonb_build_object('before', jsonb_build_object(
    'owner_name', v_store.owner_name, 'phone', v_store.phone, 'city', v_store.city, 'address', v_store.address,
    'country', v_store.country)));
  return public.gm_store_json(v_store.id);
end;
$function$;

-- Licence : le pays de la boutique est renvoyé au PC (repris dans ses réglages).
create or replace function public.gm_license_target(p_pc_id text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_pc      public.gm_store_pcs;
  v_store   public.gm_stores;
  v_cur     public.gm_subscriptions;
  v_next    public.gm_subscriptions;
  v_plan    public.gm_plans;
  v_lic     public.gm_licenses;
  v_end     timestamptz;
  v_mp      int;
  v_revoked jsonb;
begin
  select * into v_pc from public.gm_store_pcs where pc_id = p_pc_id;
  if not found then
    return jsonb_build_object('status', 'unregistered', 'server_time', now());
  end if;
  update public.gm_store_pcs set last_seen = now() where id = v_pc.id;
  select coalesce(jsonb_agg(id), '[]'::jsonb) into v_revoked
  from public.gm_licenses where pc_id = p_pc_id and status = 'revoked';
  select * into v_store from public.gm_stores where id = v_pc.store_id;
  if v_store.status <> 'active' then
    return jsonb_build_object('status', 'suspended', 'server_time', now(), 'revoked', v_revoked, 'store_code', v_store.code,
                              'country', v_store.country);
  end if;

  select * into v_cur from public.gm_subscriptions
  where store_id = v_store.id and status = 'active' and starts_at <= now() and ends_at > now()
  order by starts_at desc limit 1;
  if not found then
    return jsonb_build_object('status', 'none', 'server_time', now(), 'revoked', v_revoked,
                              'store_code', v_store.code, 'store_name', v_store.name, 'country', v_store.country);
  end if;
  v_end := v_cur.ends_at;
  loop
    select * into v_next from public.gm_subscriptions
    where store_id = v_store.id and status = 'active' and plan_code = v_cur.plan_code
      and coalesce(max_postes, 0) = coalesce(v_cur.max_postes, 0)
      and starts_at <= v_end and ends_at > v_end
    order by ends_at desc limit 1;
    exit when not found;
    v_end := v_next.ends_at;
  end loop;

  select * into v_plan from public.gm_plans where code = v_cur.plan_code;
  v_mp := coalesce(v_cur.max_postes, v_plan.max_postes);
  select * into v_lic from public.gm_licenses where pc_id = p_pc_id and status = 'valid' order by issued_at desc limit 1;

  return jsonb_build_object(
    'status', 'ok', 'server_time', now(), 'revoked', v_revoked,
    'store_id', v_store.id, 'store_code', v_store.code, 'store_name', v_store.name, 'country', v_store.country,
    'subscription_id', v_cur.id, 'plan', v_plan.code, 'plan_label', v_plan.label,
    'max_postes', v_mp, 'features', to_jsonb(v_plan.features),
    'starts_at', v_cur.starts_at, 'expires_at', v_end,
    'current', case
      when v_lic.id is not null and v_lic.store_id = v_store.id and v_lic.plan_code = v_plan.code
           and v_lic.max_postes = v_mp and v_lic.expires_at = v_end and v_lic.features = v_plan.features
      then jsonb_build_object('license_id', v_lic.id, 'file_path', v_lic.file_path, 'kid', v_lic.kid)
    end
  );
end;
$function$;
