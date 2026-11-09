-- GestiMarket 0.20 : pannes du programme envoyées par les boutiques (réglage « Envoyer les pannes »,
-- activé par défaut, désactivable dans Paramètres → Sécurité).
-- Contenu : message et endroit de la panne, écran, version, système, modèle d'appareil, empreinte anonyme
-- du PC. Aucune donnée commerciale. Lecture réservée à Eden Dev (tableau de bord Supabase) : aucune règle
-- d'accès pour anon ou authenticated ; l'écriture passe seulement par gm_report_error.

create table if not exists public.gm_error_reports (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  last_at timestamptz not null default now(),
  count integer not null default 1,
  pc text not null default '',
  version text not null default '',
  os text not null default '',
  kind text not null default '',
  message text not null default '',
  stack text not null default '',
  page text not null default '',
  device text not null default ''
);

alter table public.gm_error_reports enable row level security;
revoke all on table public.gm_error_reports from anon, authenticated;

create index if not exists gm_error_reports_pc_message on public.gm_error_reports (pc, message, last_at desc);
create index if not exists gm_error_reports_created on public.gm_error_reports (created_at desc);

create or replace function public.gm_report_error(p jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pc text := left(coalesce(p->>'pc', ''), 32);
  v_message text := left(coalesce(p->>'message', ''), 500);
  v_id bigint;
begin
  if btrim(v_message) = '' then
    return;
  end if;
  -- Protection : au plus 50 pannes différentes par PC et par jour, 2 000 par heure en tout.
  if (select count(*) from gm_error_reports where pc = v_pc and created_at > now() - interval '1 day') >= 50 then
    return;
  end if;
  if (select count(*) from gm_error_reports where created_at > now() - interval '1 hour') >= 2000 then
    return;
  end if;
  -- Même panne sur le même PC dans l'heure : compteur.
  select id into v_id
    from gm_error_reports
   where pc = v_pc and message = v_message and last_at > now() - interval '1 hour'
   order by last_at desc
   limit 1;
  if v_id is not null then
    update gm_error_reports set count = count + 1, last_at = now() where id = v_id;
    return;
  end if;
  insert into gm_error_reports (pc, version, os, kind, message, stack, page, device)
  values (
    v_pc,
    left(coalesce(p->>'version', ''), 20),
    left(coalesce(p->>'os', ''), 20),
    left(coalesce(p->>'kind', ''), 20),
    v_message,
    left(coalesce(p->>'stack', ''), 2000),
    left(coalesce(p->>'page', ''), 100),
    left(coalesce(p->>'device', ''), 200)
  );
  -- Pannes de plus de 90 jours effacées de temps en temps.
  if random() < 0.02 then
    delete from gm_error_reports where created_at < now() - interval '90 days';
  end if;
end;
$$;

revoke all on function public.gm_report_error(jsonb) from public;
grant execute on function public.gm_report_error(jsonb) to anon, authenticated;
