-- GestiMarket 0.25 « Compte » — à exécuter après gestimarket_abonnement_mobile.sql (SQL Editor → Run).
--
-- 1. La propriétaire modifie les informations de sa boutique (nom complet, téléphone, ville, adresse) depuis
--    GestiMarket : Espace propriétaire (téléphone) ou Abonnement & licence (PC). Le nom de la boutique, le pays
--    et le type restent ceux de l'inscription (licence, monnaie, tarifs).
-- 2. Nouvelle adresse e-mail du compte : recopiée dans ses boutiques (gm_stores.email, utilisée par Eden Dev et
--    pour les paiements par carte) dès que Supabase l'a changée.

create or replace function public.gm_update_store(p_store_code text, p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_store public.gm_stores := public.gm_owner_store(p_store_code);
  f       text;
begin
  foreach f in array array['owner_name', 'city', 'address'] loop
    if coalesce(trim(p ->> f), '') = '' then
      raise exception 'Champ obligatoire manquant : %', case f
        when 'owner_name' then 'nom complet de la propriétaire' when 'city' then 'ville' else 'adresse' end;
    end if;
  end loop;
  update public.gm_stores
     set owner_name = left(trim(p ->> 'owner_name'), 120),
         phone      = left(trim(coalesce(p ->> 'phone', '')), 40),
         city       = left(trim(p ->> 'city'), 80),
         address    = left(trim(p ->> 'address'), 200)
   where id = v_store.id;
  insert into public.gm_license_events (store_id, kind, detail)
  values (v_store.id, 'store_updated', jsonb_build_object('before', jsonb_build_object(
    'owner_name', v_store.owner_name, 'phone', v_store.phone, 'city', v_store.city, 'address', v_store.address)));
  return public.gm_store_json(v_store.id);
end;
$$;

revoke all on function public.gm_update_store(text, jsonb) from public, anon;
grant execute on function public.gm_update_store(text, jsonb) to authenticated;

-- Adresse e-mail du compte changée (code confirmé, ou changement direct) : ses boutiques suivent.
create or replace function public.gm_on_account_email()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.email is distinct from old.email and coalesce(new.email, '') <> '' then
    update public.gm_stores set email = new.email where owner_id = new.id and email is distinct from new.email;
    insert into public.gm_license_events (store_id, kind, detail)
    select s.id, 'account_email_changed', jsonb_build_object('before', old.email)
    from public.gm_stores s where s.owner_id = new.id;
  end if;
  return new;
end;
$$;

revoke all on function public.gm_on_account_email() from public, anon, authenticated;

drop trigger if exists gm_account_email on auth.users;
create trigger gm_account_email
  after update of email on auth.users
  for each row execute function public.gm_on_account_email();
