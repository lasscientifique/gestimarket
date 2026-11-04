-- GestiMarket — statut des postes serveurs pour l'application mobile (FlutterFlow), en temps réel.
-- À exécuter après gestimarket_abonnement_mobile.sql. Puis, dans FlutterFlow :
-- Settings → Integrations → Supabase → Get Schema, pour que la table apparaisse dans les requêtes Supabase.
--
-- Table gm_servers_statut (shop_code, active, last_seen, public_url) : copie de quatre colonnes de gm_servers, tenue à jour
-- par un trigger, et publiée dans Supabase Realtime (une vue ne peut pas l'être). Lecture seule pour le
-- téléphone (anon et authenticated). gm_servers reste fermée au téléphone : ni secret du PC, ni adresses locales.
-- public_url = adresse Internet de la boutique (https://gm-000123.gestimarket.shop), ouverte dans la WebView.
--
-- active = le PC est allumé. Le PC publie toutes les 30 s (gm_publish_server, qui met à jour gm_servers) :
-- le trigger recopie active et last_seen. S'il se tait (coupure de courant), la tâche pg_cron
-- « gm-servers-statut-expire » passe active à false au bout de 90 s : le changement part en temps réel.
--
-- Historique : remplace la vue gm_servers_statut (même nom) et la RPC gm_server_status (4 novembre 2026).

create extension if not exists pg_cron;

-- Ancienne vue et lecture des 3 colonnes de gm_servers ouverte pour elle : retirées.
drop view if exists public.gm_servers_statut;
revoke select (shop_code, active, last_seen) on public.gm_servers from anon, authenticated;
drop policy if exists "gm statut des serveurs" on public.gm_servers;
drop function if exists public.gm_server_status(text);

create table if not exists public.gm_servers_statut (
  shop_code text primary key,
  active boolean not null default false,
  last_seen timestamptz,
  public_url text
);
alter table public.gm_servers_statut add column if not exists public_url text;
alter table public.gm_servers_statut enable row level security;
drop policy if exists "gm statut des serveurs (lecture)" on public.gm_servers_statut;
create policy "gm statut des serveurs (lecture)" on public.gm_servers_statut
  for select to anon, authenticated
  using (true);
revoke all on public.gm_servers_statut from anon, authenticated;
grant select on public.gm_servers_statut to anon, authenticated;

-- Synchronisation depuis gm_servers.
create or replace function public.gm_servers_statut_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    delete from public.gm_servers_statut where shop_code = old.shop_code;
    return old;
  end if;
  if tg_op = 'UPDATE' and old.shop_code is distinct from new.shop_code then
    delete from public.gm_servers_statut where shop_code = old.shop_code;
  end if;
  insert into public.gm_servers_statut (shop_code, active, last_seen, public_url)
  values (new.shop_code, coalesce(new.active, false), new.last_seen, nullif(new.public_url, ''))
  on conflict (shop_code) do update
    set active = excluded.active, last_seen = excluded.last_seen, public_url = excluded.public_url
    where gm_servers_statut.active is distinct from excluded.active
       or gm_servers_statut.last_seen is distinct from excluded.last_seen
       or gm_servers_statut.public_url is distinct from excluded.public_url;
  return new;
end;
$$;
revoke all on function public.gm_servers_statut_sync() from public, anon, authenticated;

drop trigger if exists gm_servers_statut_sync on public.gm_servers;
create trigger gm_servers_statut_sync
  after insert or update of shop_code, active, last_seen, public_url or delete on public.gm_servers
  for each row execute function public.gm_servers_statut_sync();

-- Remplissage initial (PC silencieux depuis plus de 90 s = éteint).
insert into public.gm_servers_statut (shop_code, active, last_seen, public_url)
select shop_code, coalesce(active, false) and last_seen > now() - interval '90 seconds', last_seen, nullif(public_url, '')
from public.gm_servers
on conflict (shop_code) do update
  set active = excluded.active, last_seen = excluded.last_seen, public_url = excluded.public_url;

-- Temps réel.
do $$
begin
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'gm_servers_statut') then
    alter publication supabase_realtime add table public.gm_servers_statut;
  end if;
end;
$$;

-- PC silencieux depuis plus de 90 s (coupure de courant, PC éteint sans fermer GestiMarket) : éteint.
create or replace function public.gm_servers_statut_expire()
returns void
language sql
security definer
set search_path = public
as $$
  update public.gm_servers_statut
     set active = false
   where active and (last_seen is null or last_seen < now() - interval '90 seconds');
$$;
revoke all on function public.gm_servers_statut_expire() from public, anon, authenticated;

select cron.unschedule(jobid) from cron.job where jobname = 'gm-servers-statut-expire';
select cron.schedule('gm-servers-statut-expire', '30 seconds', $$select public.gm_servers_statut_expire()$$);
