-- GestiMarket 0.16 : durcissement signalé par les contrôles de sécurité et de performance Supabase.
-- Appliqué le 4 novembre 2026 (migration « gm_durcissement_016 »). Peut être rejoué sans risque.

-- 1. Fonction de déclencheur d'événement (RLS automatique) : jamais appelable par l'API.
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;

-- 2. search_path fixe (fonction de calcul pure).
alter function public.gm_billed_months(integer) set search_path = '';

-- 3. Index des clés étrangères.
create index if not exists gm_licenses_store_id_idx on public.gm_licenses (store_id);
create index if not exists gm_licenses_subscription_id_idx on public.gm_licenses (subscription_id);
create index if not exists gm_stores_country_idx on public.gm_stores (country);
create index if not exists gm_stores_shop_type_idx on public.gm_stores (shop_type);
create index if not exists gm_subscriptions_plan_code_idx on public.gm_subscriptions (plan_code);
create index if not exists gm_vouchers_payment_id_idx on public.gm_vouchers (payment_id);
create index if not exists gm_vouchers_plan_code_idx on public.gm_vouchers (plan_code);
create index if not exists gm_vouchers_store_id_idx on public.gm_vouchers (store_id);
