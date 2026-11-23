-- Codes WhatsApp pour Sugu Eden (base commune avec GestiMarket, 22 novembre 2026).
--   Le numéro d'Eden Dev envoie les codes des deux applications. Pour choisir le texte (« Votre code Sugu Eden » ou
--   « GestiMarket : votre code »), gm-whatsapp-webhook note d'où vient la personne d'après son dernier message :
--   « Sugu Eden » → 'sugu', « GestiMarket » → 'gestimarket', sinon on garde la valeur connue. Seul ce mot-clé est
--   gardé, jamais le texte du message.
-- Fichier rejouable.

alter table public.gm_whatsapp_contacts add column if not exists app text not null default '';
alter table public.gm_whatsapp_contacts drop constraint if exists gm_whatsapp_contacts_app_check;
alter table public.gm_whatsapp_contacts add constraint gm_whatsapp_contacts_app_check check (app in ('', 'gestimarket', 'sugu'));

drop function if exists public.gm_whatsapp_inbound(text, timestamptz);
create or replace function public.gm_whatsapp_inbound(p_phone text, p_at timestamptz, p_app text default '')
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.gm_whatsapp_contacts where updated_at < now() - interval '30 days';
  insert into public.gm_whatsapp_contacts (phone, last_inbound_at, updated_at, app)
  values (p_phone, least(p_at, now()), now(), case when p_app in ('gestimarket', 'sugu') then p_app else '' end)
  on conflict (phone) do update
    set last_inbound_at = greatest(coalesce(gm_whatsapp_contacts.last_inbound_at, excluded.last_inbound_at), excluded.last_inbound_at),
        app = case when excluded.app <> '' then excluded.app else gm_whatsapp_contacts.app end,
        updated_at = now();
$$;

-- Application d'où vient le numéro ('sugu', 'gestimarket' ou '' si inconnu) : lue par gm-whatsapp.
create or replace function public.gm_whatsapp_app(p_phone text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select app from public.gm_whatsapp_contacts where phone = p_phone), '');
$$;

revoke all on function public.gm_whatsapp_inbound(text, timestamptz, text) from public, anon, authenticated;
grant execute on function public.gm_whatsapp_inbound(text, timestamptz, text) to service_role;
revoke all on function public.gm_whatsapp_app(text) from public, anon, authenticated;
grant execute on function public.gm_whatsapp_app(text) to service_role;

notify pgrst, 'reload schema';
