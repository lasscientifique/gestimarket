-- GestiMarket — statut du poste serveur d'une boutique, pour l'application mobile (FlutterFlow).
-- À exécuter après gestimarket_abonnement_mobile.sql. Puis, dans FlutterFlow :
-- Settings → Integrations → Supabase → Get Schema, pour que la fonction apparaisse dans l'action « Call RPC ».
--
-- gm_server_status(p_shop_code) → liste JSON d'une ligne : [{"check": bool, "active": bool}]
--   check   le code du commerce existe dans gm_servers
--   active  le PC serveur a donné signe de vie depuis moins de 90 s (coupure de courant = false)
-- Appelable avec la clé publique (anon). Security definer : la table gm_servers reste fermée au téléphone,
-- sans policy. Le code est accepté en minuscules et avec des espaces autour.
-- Adresse Internet de la boutique : https://<code en minuscules>.gestimarket.shop (ex. gm-000001.gestimarket.shop).

drop function if exists public.gm_server_status(text);

create function public.gm_server_status(p_shop_code text)
returns table ("check" boolean, active boolean)
language sql
stable
security definer
set search_path = public
as $$
  select
    exists (select 1 from public.gm_servers s where s.shop_code = upper(trim(coalesce(p_shop_code, '')))) as "check",
    exists (select 1 from public.gm_servers s
            where s.shop_code = upper(trim(coalesce(p_shop_code, '')))
              and s.active and s.last_seen > now() - interval '90 seconds') as active;
$$;

revoke all on function public.gm_server_status(text) from public;
grant execute on function public.gm_server_status(text) to anon, authenticated;
