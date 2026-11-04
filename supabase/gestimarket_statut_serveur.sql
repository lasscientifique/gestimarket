-- GestiMarket — statut du poste serveur d'une boutique, pour l'application mobile (FlutterFlow).
-- À exécuter après gestimarket_abonnement_mobile.sql. Puis, dans FlutterFlow :
-- Settings → Integrations → Supabase → Get Schema, pour que la fonction apparaisse dans l'action « Call RPC ».
--
-- gm_server_status(p_shop_code) → jsonb, appelable avec la clé publique (anon) :
--   found        le code du commerce existe
--   online       le PC serveur a donné signe de vie depuis moins de 90 s (coupure de courant = false)
--   active       online et adresse Internet connue : l'application peut ouvrir la boutique
--   shop_code, shop_name, public_url (adresse Internet de la boutique), seconds_ago
-- Rien d'autre : ni adresses locales, ni empreinte du secret du PC. La table gm_servers reste fermée au téléphone.

create or replace function public.gm_server_status(p_shop_code text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select jsonb_build_object(
        'found', true,
        'online', s.active and s.last_seen > now() - interval '90 seconds',
        'active', s.active and s.last_seen > now() - interval '90 seconds' and coalesce(s.public_url, '') <> '',
        'shop_code', s.shop_code,
        'shop_name', s.shop_name,
        'public_url', coalesce(s.public_url, ''),
        'seconds_ago', extract(epoch from (now() - s.last_seen))::int
      )
     from public.gm_servers s
     where s.shop_code = upper(trim(coalesce(p_shop_code, '')))),
    jsonb_build_object('found', false, 'online', false, 'active', false,
                       'shop_code', upper(trim(coalesce(p_shop_code, ''))), 'shop_name', '', 'public_url', '')
  );
$$;

revoke all on function public.gm_server_status(text) from public;
grant execute on function public.gm_server_status(text) to anon, authenticated;
