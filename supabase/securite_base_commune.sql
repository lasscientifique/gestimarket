-- Sécurité de la base commune GestiMarket et Sugu Eden (audit du 22 novembre 2026, points 1 à 5).
--   Demain, n'importe quel acheteur Sugu Eden aura un compte connecté : plus rien ne doit supposer
--   « connecté = propriétaire ou administrateur GestiMarket ».
--   1. gm_servers : plus de lecture pour les comptes connectés (adresses des serveurs, empreinte du secret).
--      L'Espace propriétaire passe par gm_my_server, la recherche par code par gm_get_server.
--   2. gm_servers_statut : plus de lecture publique (liste de toutes les boutiques et de leur adresse).
--   3. gm_config : l'adresse de la Direction (console_owner_email) n'est plus publique, comme card_test_stores.
--   4. Droits d'écriture par défaut retirés aux visiteurs et comptes connectés sur les tables gm_ (déjà bloqués
--      par la RLS ; filet de sécurité). Les écritures passent par des fonctions.
--   5. Déclencheurs du journal des comptes (gm_jc_*) : plus appelables par l'API. Supabase Auth les déclenche
--      toujours (droit gardé pour supabase_auth_admin et postgres).
-- Fichier rejouable.

-- 1.
drop policy if exists "select" on public.gm_servers;

-- 2.
drop policy if exists "gm statut des serveurs (lecture)" on public.gm_servers_statut;

-- 3.
drop policy if exists "gm lecture publique" on public.gm_config;
create policy "gm lecture publique" on public.gm_config for select to anon, authenticated
  using (key not in ('card_test_stores', 'console_owner_email'));

-- 4.
revoke insert, update, delete on public.gm_config, public.gm_countries, public.gm_licenses, public.gm_payments,
  public.gm_plan_prices, public.gm_plans, public.gm_shop_types, public.gm_store_pcs, public.gm_stores,
  public.gm_subscriptions, public.gm_servers, public.gm_servers_statut
  from anon, authenticated;

-- 5.
grant execute on function public.gm_jc_users(), public.gm_jc_amr(), public.gm_jc_factors() to supabase_auth_admin, postgres;
revoke execute on function public.gm_jc_users(), public.gm_jc_amr(), public.gm_jc_factors() from public, anon, authenticated;

notify pgrst, 'reload schema';
