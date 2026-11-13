-- GestiMarket 0.26 « WhatsApp » — à exécuter après gestimarket_compte.sql (SQL Editor → Run).
--
-- Compte de la boutique créé et ouvert avec un numéro WhatsApp : Supabase Auth (fournisseur « Phone »)
-- envoie le code par le crochet « Send SMS » → fonction gm-whatsapp → WhatsApp Cloud API de Meta.
-- gm_config.whatsapp_enabled montre l'option dans GestiMarket (0.26 et suivantes) : à mettre à 'true'
-- seulement quand le numéro Meta, le modèle de message, la fonction et le crochet sont prêts.

insert into public.gm_config (key, value) values ('whatsapp_enabled', 'false') on conflict (key) do nothing;
-- Numéro WhatsApp d'envoi de GestiMarket (format international, ex. +22376000000). Sans entreprise vérifiée chez
-- Meta, le code part en message simple : la personne écrit d'abord à ce numéro (fenêtre de 24 heures).
insert into public.gm_config (key, value) values ('whatsapp_number', '') on conflict (key) do nothing;

-- Formulaire d'inscription, formules (prix par devise), moyens de paiement et WhatsApp (sans connexion).
create or replace function public.gm_public_options()
returns jsonb
language sql
stable
set search_path = public
as $$
  select jsonb_build_object(
    'shop_types', (select coalesce(jsonb_agg(jsonb_build_object('code', code, 'label', label) order by sort, label), '[]'::jsonb) from public.gm_shop_types),
    'countries', (select coalesce(jsonb_agg(jsonb_build_object('code', code, 'label', label, 'currency', currency) order by sort, label), '[]'::jsonb) from public.gm_countries),
    'plans', (select coalesce(jsonb_agg(jsonb_build_object('code', p.code, 'label', p.label, 'price_month', p.price_month, 'max_postes', p.max_postes,
                                                          'features', to_jsonb(p.features), 'description', p.description,
                                                          'prices', jsonb_build_object('XOF', p.price_month, 'XAF', p.price_month)
                                                                    || coalesce((select jsonb_object_agg(pp.currency, pp.price_month) from public.gm_plan_prices pp
                                                                                 where pp.plan_code = p.code), '{}'::jsonb))
                                       order by p.sort), '[]'::jsonb)
              from public.gm_plans p where p.active),
    'payment_instructions', coalesce((select value from public.gm_config where key = 'payment_instructions'), ''),
    'trial_days', coalesce((select value from public.gm_config where key = 'trial_days'), '0')::int,
    'payment', jsonb_build_object(
      'om_merchant_code', coalesce((select value from public.gm_config where key = 'om_merchant_code'), ''),
      'om_merchant_name', coalesce((select value from public.gm_config where key = 'om_merchant_name'), ''),
      'om_qr_payload', coalesce((select value from public.gm_config where key = 'om_qr_payload'), ''),
      'card_enabled', coalesce((select value from public.gm_config where key = 'card_enabled'), 'false') = 'true',
      'card_currency', upper(coalesce((select value from public.gm_config where key = 'card_currency'), 'XOF')),
      'card_currencies', to_jsonb(string_to_array(replace(upper(coalesce((select value from public.gm_config where key = 'card_currencies'), 'XOF')), ' ', ''), ','))
    ),
    'whatsapp', coalesce((select value from public.gm_config where key = 'whatsapp_enabled'), 'false') = 'true',
    'whatsapp_number', coalesce((select value from public.gm_config where key = 'whatsapp_number'), '')
  )
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- Fenêtre de 24 heures (0.26, sans entreprise vérifiée). Meta accepte un message simple même quand la personne n'a
-- pas écrit depuis 24 heures, puis l'abandonne plus tard (erreur 131047 envoyée par notification) : GestiMarket
-- croirait le code parti. La fonction gm-whatsapp-webhook reçoit les notifications de Meta et note ici le dernier
-- message reçu de chaque numéro ; gm-whatsapp n'envoie un code que si la personne a écrit dans les 24 heures.
-- Accès réservé aux fonctions (service_role) ; lignes effacées 30 jours après la dernière activité.
create table if not exists public.gm_whatsapp_contacts (
  phone text primary key check (phone ~ '^[0-9]{8,15}$'),  -- indicatif compris, sans « + » (22376000000)
  last_inbound_at timestamptz,                               -- dernier message reçu de ce numéro
  last_failed_at timestamptz,                                -- dernier message de GestiMarket non remis
  last_error_code int,
  last_error text,
  updated_at timestamptz not null default now()
);
alter table public.gm_whatsapp_contacts enable row level security;
revoke all on public.gm_whatsapp_contacts from public, anon, authenticated;

-- Message reçu d'un numéro (notification « messages » de Meta).
create or replace function public.gm_whatsapp_inbound(p_phone text, p_at timestamptz)
returns void
language sql
set search_path = public
as $$
  delete from public.gm_whatsapp_contacts where updated_at < now() - interval '30 days';
  insert into public.gm_whatsapp_contacts (phone, last_inbound_at, updated_at)
  values (p_phone, least(p_at, now()), now())
  on conflict (phone) do update
    set last_inbound_at = greatest(coalesce(gm_whatsapp_contacts.last_inbound_at, excluded.last_inbound_at), excluded.last_inbound_at),
        updated_at = now();
$$;

-- Message de GestiMarket non remis (statut « failed » de Meta, ou refus à l'envoi).
create or replace function public.gm_whatsapp_failed(p_phone text, p_code int, p_error text)
returns void
language sql
set search_path = public
as $$
  insert into public.gm_whatsapp_contacts (phone, last_failed_at, last_error_code, last_error, updated_at)
  values (p_phone, now(), p_code, left(p_error, 300), now())
  on conflict (phone) do update
    set last_failed_at = now(), last_error_code = excluded.last_error_code, last_error = excluded.last_error, updated_at = now();
$$;

-- La personne a-t-elle écrit dans les 24 heures ? (5 minutes de marge : le code doit arriver avant la fin.)
create or replace function public.gm_whatsapp_window_open(p_phone text)
returns boolean
language sql
stable
set search_path = public
as $$
  select exists (select 1 from public.gm_whatsapp_contacts
                 where phone = p_phone and last_inbound_at > now() - interval '23 hours 55 minutes')
$$;

revoke all on function public.gm_whatsapp_inbound(text, timestamptz) from public, anon, authenticated;
revoke all on function public.gm_whatsapp_failed(text, int, text) from public, anon, authenticated;
revoke all on function public.gm_whatsapp_window_open(text) from public, anon, authenticated;
grant execute on function public.gm_whatsapp_inbound(text, timestamptz) to service_role;
grant execute on function public.gm_whatsapp_failed(text, int, text) to service_role;
grant execute on function public.gm_whatsapp_window_open(text) to service_role;
