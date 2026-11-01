-- ═══════════════════════════════════════════════════════════════════════════
-- GestiMarket — annuaire des postes serveurs pour l'application mobile
-- À exécuter une fois dans Supabase : SQL Editor → New query → coller → Run.
--
-- Le poste serveur publie toutes les 30 s son état et ses adresses (gm_publish_server).
-- L'application mobile (FlutterFlow, WebView) lit l'adresse avec le code du commerce
-- (gm_get_server) puis ouvre cette adresse dans sa WebView.
-- La table n'est pas lisible directement : seules les deux fonctions sont exposées.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.gm_servers (
  shop_code    text primary key,                 -- ex. GM-7KQ2PX (affiché dans GestiMarket)
  secret_hash  text not null,                    -- empreinte du secret du poste serveur
  shop_name    text,
  url          text,                             -- http://192.168.1.10:7878 (réseau local)
  https_url    text,                             -- https://192.168.1.10:7879 (caméra)
  public_url   text,                             -- adresse publique facultative
  payload      jsonb not null default '{}'::jsonb,
  active       boolean not null default false,
  last_seen    timestamptz not null default now(),
  created_at   timestamptz not null default now()
);

alter table public.gm_servers enable row level security;
-- Aucune politique : ni lecture ni écriture directes avec la clé publique.
revoke all on public.gm_servers from anon, authenticated;

-- Publication par le poste serveur. Le premier poste qui publie un code en devient propriétaire
-- (son secret est mémorisé) ; ensuite seul ce poste peut le mettre à jour.
create or replace function public.gm_publish_server(p_shop_code text, p_secret text, p_active boolean, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hash text := encode(sha256(convert_to(p_secret, 'UTF8')), 'hex');
  v_row  public.gm_servers;
begin
  if p_shop_code is null or length(trim(p_shop_code)) < 4 or p_secret is null or length(p_secret) < 20 then
    raise exception 'Code ou secret invalide';
  end if;
  select * into v_row from public.gm_servers where shop_code = upper(trim(p_shop_code));
  if found and v_row.secret_hash <> v_hash then
    raise exception 'Ce code de commerce appartient à un autre poste serveur';
  end if;
  insert into public.gm_servers as s (shop_code, secret_hash, shop_name, url, https_url, public_url, payload, active, last_seen)
  values (upper(trim(p_shop_code)), v_hash, p_payload->>'shop_name', p_payload->>'url', p_payload->>'https_url',
          p_payload->>'public_url', coalesce(p_payload, '{}'::jsonb), coalesce(p_active, false), now())
  on conflict (shop_code) do update set
    shop_name = excluded.shop_name, url = excluded.url, https_url = excluded.https_url,
    public_url = excluded.public_url, payload = excluded.payload, active = excluded.active, last_seen = now();
  return jsonb_build_object('ok', true, 'shop_code', upper(trim(p_shop_code)));
end;
$$;

-- Lecture par l'application mobile : un serveur est « actif » s'il a publié il y a moins de 90 s.
create or replace function public.gm_get_server(p_shop_code text)
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  select jsonb_build_object(
    'found', true,
    'shop_code', shop_code,
    'shop_name', shop_name,
    'active', active and last_seen > now() - interval '90 seconds',
    'url', url,
    'https_url', https_url,
    'public_url', public_url,
    'urls', coalesce(payload->'urls', '[]'::jsonb),
    'https_urls', coalesce(payload->'https_urls', '[]'::jsonb),
    'postes_online', coalesce((payload->>'postes_online')::int, 0),
    'version', payload->>'version',
    'last_seen', last_seen,
    'seconds_ago', extract(epoch from (now() - last_seen))::int
  )
  from public.gm_servers
  where shop_code = upper(trim(p_shop_code))
  union all
  select jsonb_build_object('found', false, 'active', false)
  where not exists (select 1 from public.gm_servers where shop_code = upper(trim(p_shop_code)))
$$;

revoke all on function public.gm_publish_server(text, text, boolean, jsonb) from public;
revoke all on function public.gm_get_server(text) from public;
grant execute on function public.gm_publish_server(text, text, boolean, jsonb) to anon, authenticated;
grant execute on function public.gm_get_server(text) to anon, authenticated;
