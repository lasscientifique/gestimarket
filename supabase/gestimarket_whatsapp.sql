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
