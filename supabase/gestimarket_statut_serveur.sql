-- GestiMarket — statut des postes serveurs, lisible par l'application mobile (FlutterFlow).
-- À exécuter après gestimarket_abonnement_mobile.sql. Puis, dans FlutterFlow :
-- Settings → Integrations → Supabase → Get Schema, pour que la vue apparaisse dans les requêtes Supabase.
--
-- Vue gm_servers_statut : shop_code, active, last_seen (rien d'autre : ni secret du PC, ni adresses, ni nom).
-- L'application l'interroge par une requête Supabase native (filtre shop_code = code en MAJUSCULES, une ligne)
-- et passe active et last_seen à la fonction FlutterFlow isServerActive (vrai si active et last_seen < 90 s).
--
-- La vue est en security_invoker : les droits sont ceux du téléphone. Il a la lecture de ces trois colonnes
-- de gm_servers, et seulement elles : « select * » sur gm_servers reste refusé.
-- Remplace la fonction RPC gm_server_status (supprimée le 4 novembre 2026).

drop function if exists public.gm_server_status(text);

create or replace view public.gm_servers_statut
with (security_invoker = true) as
  select shop_code, active, last_seen
  from public.gm_servers;

grant select (shop_code, active, last_seen) on public.gm_servers to anon, authenticated;

drop policy if exists "gm statut des serveurs" on public.gm_servers;
create policy "gm statut des serveurs" on public.gm_servers
  for select to anon, authenticated
  using (true);

grant select on public.gm_servers_statut to anon, authenticated;
