-- GestiMarket 0.27 « Internet automatique » — à exécuter après gestimarket_abonnement_mobile.sql.
--
-- Le PC serveur d'une boutique PRO ou BUSINESS reçoit son adresse Internet sans que personne tape le mot de
-- passe du compte. Quand la propriétaire relie le PC à sa boutique (connectée à son compte), Eden Dev remet au
-- PC un jeton d'appareil secret ; seule son empreinte (SHA-256) est gardée ici. Le PC présente ensuite ce jeton
-- à la fonction gm-tunnel, qui vérifie la boutique et la formule comme pour une demande faite avec le compte.

alter table public.gm_store_pcs add column if not exists device_token_hash text;

-- Jeton d'appareil d'un PC de la boutique de la propriétaire connectée (un nouveau à chaque appel :
-- l'ancien ne vaut plus).
create or replace function public.gm_pc_token(p_store_code text, p_pc_id text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_pc_id text := upper(regexp_replace(coalesce(p_pc_id, ''), '[^0-9A-Za-z]', '', 'g'));
  v_pc    public.gm_store_pcs;
  v_token text;
begin
  if v_uid is null then
    raise exception 'Connectez-vous à votre compte boutique.';
  end if;
  select pc.* into v_pc
  from public.gm_store_pcs pc join public.gm_stores s on s.id = pc.store_id
  where pc.pc_id = v_pc_id and s.code = upper(trim(coalesce(p_store_code, ''))) and s.owner_id = v_uid;
  if not found then
    raise exception 'Ce PC n''est pas rattaché à cette boutique.';
  end if;
  v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  update public.gm_store_pcs set device_token_hash = encode(sha256(convert_to(v_token, 'UTF8')), 'hex') where id = v_pc.id;
  insert into public.gm_license_events (store_id, kind, detail)
  values (v_pc.store_id, 'pc_token', jsonb_build_object('pc_id', v_pc_id));
  return v_token;
end;
$$;

-- Fonction gm-tunnel (service_role) : boutique d'un PC qui présente son jeton d'appareil, avec les mêmes
-- vérifications que gm_tunnel_target (boutique active, formule avec « internet », 10 demandes par heure).
create or replace function public.gm_tunnel_target_pc(p_pc_id text, p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pc_id text := upper(regexp_replace(coalesce(p_pc_id, ''), '[^0-9A-Za-z]', '', 'g'));
  v_owner uuid;
  v_code  text;
begin
  if p_token is null or length(p_token) < 40 then
    raise exception 'Ce PC doit être relié de nouveau au compte boutique.';
  end if;
  select s.owner_id, s.code into v_owner, v_code
  from public.gm_store_pcs pc join public.gm_stores s on s.id = pc.store_id
  where pc.pc_id = v_pc_id and pc.device_token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
  if not found then
    raise exception 'Ce PC doit être relié de nouveau au compte boutique.';
  end if;
  return public.gm_tunnel_target(v_owner, v_code);
end;
$$;

-- Un PC qui change de boutique perd son jeton d'appareil (la nouvelle propriétaire lui en remet un).
create or replace function public.gm_pc_token_reset()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.store_id is distinct from old.store_id then
    new.device_token_hash := null;
  end if;
  return new;
end;
$$;
drop trigger if exists gm_pc_token_reset on public.gm_store_pcs;
create trigger gm_pc_token_reset before update of store_id on public.gm_store_pcs
for each row execute function public.gm_pc_token_reset();

revoke all on function public.gm_pc_token(text, text) from public, anon;
grant execute on function public.gm_pc_token(text, text) to authenticated;
revoke all on function public.gm_tunnel_target_pc(text, text) from public, anon, authenticated;
grant execute on function public.gm_tunnel_target_pc(text, text) to service_role;
revoke all on function public.gm_pc_token_reset() from public, anon, authenticated;
