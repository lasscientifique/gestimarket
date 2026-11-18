-- Console Eden Dev 1.1 « Sécurité » (avec GestiMarket 0.34 : gestimarket_0_34.sql, à appliquer avant ce fichier).
--
-- 1. Carte annulée : le client est prévenu sur WhatsApp (et la boutique, si la carte lui était réservée), avec une
--    raison choisie dans une liste (gm_wa_notices, envoyés par « gm-cartes » dès que la fenêtre de 24 heures est
--    ouverte). « Annuler et renvoyer » : la nouvelle carte dit quelle carte elle remplace.
-- 2. Journal des boutiques : recherche par code GM-…, téléphone, e-mail ou adresse IP (gm_console_store_journal).
-- 3. Alertes (gm_alertes) calculées chaque minute par la base (pg_cron) : critique, attention, info. La console les lit
--    toutes les 30 secondes et sonne. « Vu » est inscrit au journal de la console.
-- 4. Vérification à 2 étapes d'un membre réinitialisée par la Direction ; nombre de téléphones de chaque membre.
-- 5. CinetPay : « Vendre une carte » avec un lien de paiement envoyé au client ; réglage « CinetPay ouvert ».
-- 6. Journal des comptes gardé 6 mois, alertes 12 mois, messages aux clients 90 jours (pg_cron, chaque nuit).

-- ───────────────────────────── Ventes de cartes : lien de paiement, carte remplacée ─────────────────────────────

alter table public.gm_card_sales drop constraint if exists gm_card_sales_status_check;
alter table public.gm_card_sales add constraint gm_card_sales_status_check
  check (status in ('unpaid', 'waiting', 'sending', 'sent', 'delivered', 'read', 'used', 'failed', 'cancelled'));
alter table public.gm_card_sales drop constraint if exists gm_card_sales_method_check;
alter table public.gm_card_sales add constraint gm_card_sales_method_check
  check (method in ('orange_money', 'wave', 'moov_money', 'especes', 'virement', 'autre', 'offert', 'cinetpay'));
alter table public.gm_card_sales add column if not exists replaces_serial text not null default '';
alter table public.gm_card_sales add column if not exists pay_url text not null default '';
alter table public.gm_card_sales add column if not exists cancel_reason text not null default '';

-- ───────────────────────────── Messages WhatsApp aux clients ─────────────────────────────

create table if not exists public.gm_wa_notices (
  id               uuid primary key default gen_random_uuid(),
  created_at       timestamptz not null default now(),
  kind             text not null check (kind in ('annulation', 'lien_paiement')),
  phone            text not null check (phone ~ '^[0-9]{8,15}$'),
  body             text not null,
  sale_id          uuid references public.gm_card_sales(id) on delete set null,
  store_id         uuid references public.gm_stores(id) on delete set null,
  status           text not null default 'waiting'
                   check (status in ('waiting', 'sending', 'sent', 'delivered', 'read', 'failed', 'expired', 'cancelled')),
  attempts         integer not null default 0,
  sending_at       timestamptz,
  sent_at          timestamptz,
  wa_message_id    text unique,
  last_error       text not null default '',
  created_by_email text not null default ''
);
create index if not exists gm_wa_notices_waiting on public.gm_wa_notices (phone) where status = 'waiting';
create index if not exists gm_wa_notices_sale on public.gm_wa_notices (sale_id);
alter table public.gm_wa_notices enable row level security;
revoke all on table public.gm_wa_notices from public, anon, authenticated;

-- Raison montrée au client (le motif du journal reste interne).
create or replace function public.gm_client_reason(p_code text, p_text text)
returns text
language sql
immutable
set search_path = public
as $$
  select case coalesce(p_code, '')
    when 'paiement_non_recu' then 'paiement non reçu'
    when 'erreur_formule' then 'erreur de formule'
    when 'carte_remplacee' then 'carte remplacée'
    when 'demande_client' then 'à votre demande'
    when 'autre' then nullif(left(regexp_replace(trim(coalesce(p_text, '')), '\s+', ' ', 'g'), 150), '')
    else null end
$$;

create or replace function public.gm_months_label(p int)
returns text
language sql
immutable
set search_path = public
as $$
  select case when p = 12 then '12 mois' else p || ' mois' end
$$;

-- Messages d'annulation d'une vente : au client, et à la boutique à qui la carte était réservée.
create or replace function public.gm_card_notify_cancel(p_sale public.gm_card_sales, p_serial text, p_reason text, p_by text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_what  text := coalesce((select label from public.gm_plans where code = p_sale.plan_code), p_sale.plan_code) || ' '
                  || public.gm_months_label(p_sale.months);
  v_store public.gm_stores;
  v_phone text;
  v_out   jsonb := '[]'::jsonb;
  v_end   text := E'\n\nSi vous avez payé, contactez-nous : nous vous rembourserons ou vous enverrons une nouvelle carte. '
                  || 'Répondez simplement à ce message.';
begin
  insert into public.gm_wa_notices (kind, phone, body, sale_id, store_id, created_by_email)
  values ('annulation', p_sale.phone,
          E'GestiMarket · Eden Dev\n\n'
          || case when coalesce(p_serial, '') <> '' then 'Votre carte de bon n° ' || p_serial || ' (' || v_what || ') a été annulée.'
                  else 'Votre commande de carte de bon ' || v_what || ' a été annulée.' end
          || coalesce(E'\nRaison : ' || p_reason || '.', '') || v_end,
          p_sale.id, p_sale.store_id, coalesce(p_by, ''));
  v_out := v_out || jsonb_build_array(jsonb_build_object('to', 'client', 'phone', p_sale.phone,
                                                         'window_open', public.gm_whatsapp_window_open(p_sale.phone)));
  if p_sale.store_id is not null and coalesce(p_serial, '') <> '' then
    select * into v_store from public.gm_stores where id = p_sale.store_id;
    v_phone := public.gm_phone_digits(coalesce(nullif(v_store.phone, ''), (select phone from auth.users where id = v_store.owner_id), ''));
    if v_phone ~ '^[0-9]{8,15}$' and v_phone <> p_sale.phone then
      insert into public.gm_wa_notices (kind, phone, body, sale_id, store_id, created_by_email)
      values ('annulation', v_phone,
              E'GestiMarket · Eden Dev\n\nLa carte de bon n° ' || p_serial || ' (' || v_what || ') réservée à votre boutique '
              || v_store.code || ' a été annulée.' || coalesce(E'\nRaison : ' || p_reason || '.', '')
              || E'\n\nUne question ? Répondez simplement à ce message.',
              p_sale.id, p_sale.store_id, coalesce(p_by, ''));
      v_out := v_out || jsonb_build_array(jsonb_build_object('to', 'boutique', 'phone', v_phone, 'store_code', v_store.code,
                                                             'window_open', public.gm_whatsapp_window_open(v_phone)));
    end if;
  end if;
  return v_out;
end;
$$;

-- Messages à envoyer maintenant (fonction « gm-cartes ») : destinataire qui a écrit dans les 24 heures.
create or replace function public.gm_wa_notices_claim(p_phone text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows jsonb;
begin
  update public.gm_wa_notices set status = 'expired', last_error = 'Le destinataire n''a pas écrit en 7 jours.'
   where status = 'waiting' and created_at < now() - interval '7 days';
  update public.gm_wa_notices set status = case when attempts >= 3 then 'failed' else 'waiting' end,
         last_error = 'Envoi non confirmé'
   where status = 'sending' and sending_at < now() - interval '10 minutes';
  with c as (
    select n.id from public.gm_wa_notices n
    where n.status = 'waiting' and (p_phone is null or n.phone = p_phone) and public.gm_whatsapp_window_open(n.phone)
    order by n.created_at
    limit 20
    for update skip locked
  ), u as (
    update public.gm_wa_notices n set status = 'sending', sending_at = now(), attempts = n.attempts + 1
    from c where n.id = c.id
    returning n.id, n.phone, n.body
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'phone', phone, 'body', body)), '[]'::jsonb) into v_rows from u;
  return v_rows;
end;
$$;

create or replace function public.gm_wa_notice_sent(p_id uuid, p_message_id text)
returns void
language sql
security definer
set search_path = public
as $$
  update public.gm_wa_notices set status = 'sent', sent_at = now(), wa_message_id = nullif(p_message_id, ''), last_error = ''
   where id = p_id and status = 'sending';
$$;

create or replace function public.gm_wa_notice_failed(p_id uuid, p_code int, p_error text, p_retry boolean)
returns void
language sql
security definer
set search_path = public
as $$
  update public.gm_wa_notices
     set status = case when p_retry and attempts < 3 then 'waiting' else 'failed' end,
         last_error = left(coalesce(p_error, '') || case when p_code is not null and p_code <> 0 then ' (' || p_code || ')' else '' end, 300)
   where id = p_id and status = 'sending';
$$;

-- Accusés de WhatsApp (gm-whatsapp-webhook) : messages aux clients, puis cartes de bon.
create or replace function public.gm_card_sale_wa_status(p_message_id text, p_status text, p_code int default null, p_error text default '')
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sale public.gm_card_sales;
begin
  update public.gm_wa_notices
     set status = case
                    when p_status = 'delivered' and status = 'sent' then 'delivered'
                    when p_status = 'read' and status in ('sent', 'delivered') then 'read'
                    when p_status = 'failed' and status in ('sent', 'delivered') then case when p_code = 131047 then 'waiting' else 'failed' end
                    else status end,
         wa_message_id = case when p_status = 'failed' and p_code = 131047 then null else wa_message_id end,
         last_error = case when p_status = 'failed' then left(coalesce(nullif(p_error, ''), 'Message non remis par WhatsApp'), 300) else last_error end
   where wa_message_id = p_message_id;
  if found then
    return;
  end if;
  select * into v_sale from public.gm_card_sales where wa_message_id = p_message_id for update;
  if not found then
    return;
  end if;
  if p_status = 'delivered' then
    update public.gm_card_sales set delivered_at = coalesce(delivered_at, now()),
           status = case when status = 'sent' then 'delivered' else status end
     where id = v_sale.id;
  elsif p_status = 'read' then
    update public.gm_card_sales set read_at = coalesce(read_at, now()), delivered_at = coalesce(delivered_at, now()),
           status = case when status in ('sent', 'delivered') then 'read' else status end
     where id = v_sale.id;
  elsif p_status = 'failed' and v_sale.status in ('sent', 'delivered') then
    perform public.gm_card_sale_failed(v_sale.id, p_code, coalesce(nullif(p_error, ''), 'Message non remis par WhatsApp'), p_code = 131047);
  end if;
end;
$$;

-- La carte fabriquée dit quelle carte elle remplace (« Annuler et renvoyer »).
create or replace function public.gm_card_sale_issue(p_sale_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_sale   public.gm_card_sales;
  v_plan   public.gm_plans;
  v_store  public.gm_stores;
  v_alpha  text := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  v_bytes  bytea;
  v_code   text := '';
  v_batch  text := 'WA' || to_char(now(), 'YYMMDD');
  v_n      int;
  v_serial text;
  v_vid    uuid;
  j        int;
begin
  select * into v_sale from public.gm_card_sales where id = p_sale_id for update;
  if not found or v_sale.status <> 'sending' or v_sale.voucher_id is not null then
    return jsonb_build_object('ok', false, 'error', 'Vente déjà traitée.');
  end if;
  select * into v_plan from public.gm_plans where code = v_sale.plan_code;
  perform pg_advisory_xact_lock(hashtext('gm_voucher_batch|' || v_batch));
  select count(*) into v_n from public.gm_vouchers where batch = v_batch;
  v_serial := v_batch || '-' || lpad((v_n + 1)::text, 4, '0');
  v_bytes := extensions.gen_random_bytes(16);
  for j in 0..15 loop
    v_code := v_code || substr(v_alpha, get_byte(v_bytes, j) % 32 + 1, 1);
  end loop;
  insert into public.gm_vouchers (serial, code_hash, plan_code, months, batch, status, sold_at, note, bound_store_id, sale_id)
  values (v_serial, public.gm_voucher_hash(v_code), v_sale.plan_code, v_sale.months, v_batch, 'sold', now(),
          left('WhatsApp +' || v_sale.phone || coalesce(' — ' || nullif(v_sale.client_name, ''), ''), 200), v_sale.store_id, v_sale.id)
  returning id into v_vid;
  update public.gm_card_sales set voucher_id = v_vid where id = v_sale.id;
  if v_sale.store_id is not null then
    select * into v_store from public.gm_stores where id = v_sale.store_id;
  end if;
  return jsonb_build_object('ok', true, 'phone', v_sale.phone, 'name', v_sale.client_name, 'serial', v_serial,
    'code', substr(v_code, 1, 4) || '-' || substr(v_code, 5, 4) || '-' || substr(v_code, 9, 4) || '-' || substr(v_code, 13, 4),
    'plan_label', v_plan.label, 'months', v_sale.months, 'store_code', v_store.code, 'store_name', v_store.name,
    'replaces', nullif(v_sale.replaces_serial, ''));
end;
$$;

-- Vendre une carte : « cinetpay » = le client paie par un lien CinetPay (la vente attend le paiement).
create or replace function public.gm_console_card_sell(p_device text, p_phone text, p_name text, p_plan text, p_months int,
                                                       p_method text, p_reference text, p_store_code text default '')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin public.gm_admins := public.gm_admin_ctx(p_device, array['paiements']);
  v_phone text := public.gm_phone_digits(p_phone);
  v_plan  public.gm_plans;
  v_store public.gm_stores;
  v_ref   text := upper(left(regexp_replace(trim(coalesce(p_reference, '')), '\s+', '', 'g'), 80));
  v_sale  public.gm_card_sales;
begin
  if v_phone !~ '^[0-9]{8,15}$' then
    raise exception 'Numéro WhatsApp invalide : indicatif du pays compris (ex. +223 70 00 00 00).';
  end if;
  if v_phone = public.gm_phone_digits((select value from public.gm_config where key = 'whatsapp_number')) then
    raise exception 'C''est le numéro d''Eden Dev : tapez celui du client.';
  end if;
  select * into v_plan from public.gm_plans where code = p_plan and active and code <> 'free';
  if not found then
    raise exception 'Formule inconnue.';
  end if;
  if p_months is null or p_months not in (1, 3, 6, 12) then
    raise exception 'Durée : 1, 3, 6 ou 12 mois.';
  end if;
  if p_method not in ('orange_money', 'wave', 'moov_money', 'especes', 'virement', 'autre', 'offert', 'cinetpay') then
    raise exception 'Moyen de paiement inconnu.';
  end if;
  if p_method = 'cinetpay' then
    if coalesce((select value from public.gm_config where key = 'cinetpay_enabled'), 'false') <> 'true' then
      raise exception 'CinetPay n''est pas encore ouvert (Réglages → Paiements).';
    end if;
    v_ref := '';
  end if;
  if p_method in ('orange_money', 'wave', 'moov_money') and length(v_ref) < 4 then
    raise exception 'Saisissez l''ID de la transaction (reçu par SMS).';
  end if;
  if p_method = 'offert' and v_admin.role <> 'direction' then
    raise exception 'Une carte offerte est réservée à la Direction.';
  end if;
  if v_ref <> '' and (exists (select 1 from public.gm_card_sales where upper(reference) = v_ref and method = p_method and status <> 'cancelled')
                      or exists (select 1 from public.gm_payments where upper(reference) = v_ref and method = p_method and status <> 'refused')) then
    raise exception 'Cet ID de transaction a déjà servi.';
  end if;
  if coalesce(trim(p_store_code), '') <> '' then
    select * into v_store from public.gm_stores where code = upper(trim(p_store_code));
    if not found then
      raise exception 'Boutique % introuvable.', upper(trim(p_store_code));
    end if;
  end if;
  insert into public.gm_card_sales (created_by, seller_email, phone, client_name, plan_code, months, amount, method, reference, store_id, status)
  values (v_admin.user_id, v_admin.email, v_phone, left(trim(coalesce(p_name, '')), 80), v_plan.code, p_months,
          case when p_method = 'offert' then 0 else v_plan.price_month * public.gm_billed_months(p_months) end,
          p_method, v_ref, v_store.id, case when p_method = 'cinetpay' then 'unpaid' else 'waiting' end)
  returning * into v_sale;
  perform public.gm_admin_log(v_admin, 'Carte vendue par WhatsApp', coalesce(v_store.code, '+' || v_phone), p_method,
    jsonb_build_object('sale_id', v_sale.id, 'phone', v_phone, 'plan', v_plan.code, 'months', p_months, 'amount', v_sale.amount, 'reference', v_ref));
  return jsonb_build_object('id', v_sale.id, 'phone', v_phone, 'amount', v_sale.amount, 'status', v_sale.status,
                            'window_open', public.gm_whatsapp_window_open(v_phone));
end;
$$;

create or replace function public.gm_console_card_sales(p_device text, p_status text default '', p_search text default '')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin public.gm_admins := public.gm_admin_ctx(p_device);
  v_q     text := lower(trim(coalesce(p_search, '')));
  v_d     text := regexp_replace(coalesce(p_search, ''), '\D', '', 'g');
begin
  return (
    select coalesce(jsonb_agg(row_to_json(q)::jsonb order by q.created_at desc), '[]'::jsonb)
    from (
      select c.id, c.created_at, c.seller_email, c.phone, c.client_name, c.plan_code as plan, pl.label as plan_label, c.months,
             c.amount, c.method, c.reference, c.status, c.last_error, c.sent_at, c.delivered_at, c.read_at, c.used_at, c.confirmed_at,
             c.replaces_serial, c.pay_url, c.cancel_reason,
             v.serial, s.code as store_code, u.code as used_by_code,
             public.gm_whatsapp_window_open(c.phone) as window_open,
             (select last_inbound_at from public.gm_whatsapp_contacts w where w.phone = c.phone) as last_inbound_at,
             (select coalesce(jsonb_agg(jsonb_build_object('kind', n.kind, 'phone', n.phone, 'status', n.status, 'created_at', n.created_at,
                                                           'sent_at', n.sent_at, 'last_error', n.last_error) order by n.created_at), '[]'::jsonb)
              from public.gm_wa_notices n where n.sale_id = c.id) as notices
      from public.gm_card_sales c
      join public.gm_plans pl on pl.code = c.plan_code
      left join public.gm_vouchers v on v.id = c.voucher_id
      left join public.gm_stores s on s.id = c.store_id
      left join public.gm_stores u on u.id = v.store_id
      where (coalesce(p_status, '') = '' or c.status = p_status
             or (p_status = 'open' and c.status in ('unpaid', 'waiting', 'sending', 'failed')))
        and (v_q = '' or lower(c.client_name) like '%' || v_q || '%' or lower(coalesce(v.serial, '')) like '%' || v_q || '%'
             or lower(coalesce(s.code, '')) like '%' || v_q || '%' or (length(v_d) >= 4 and c.phone like '%' || v_d || '%'))
      order by c.created_at desc
      limit 500
    ) q);
end;
$$;

-- Renvoyer (l'ancienne carte devient inutilisable, une nouvelle part et dit laquelle elle remplace) ou annuler une
-- vente (le client est prévenu, avec la raison choisie).
drop function if exists public.gm_console_card_sale_action(text, uuid, text, text);
create or replace function public.gm_console_card_sale_action(p_device text, p_sale_id uuid, p_action text, p_reason text,
                                                              p_client_reason text default '', p_client_text text default '',
                                                              p_notify boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin   public.gm_admins := public.gm_admin_ctx(p_device, array['paiements']);
  v_reason  text := public.gm_admin_reason(p_reason);
  v_sale    public.gm_card_sales;
  v_serial  text;
  v_client  text;
  v_notices jsonb := '[]'::jsonb;
begin
  select * into v_sale from public.gm_card_sales where id = p_sale_id for update;
  if not found then
    raise exception 'Vente introuvable.';
  end if;
  if v_sale.status in ('used', 'cancelled') then
    raise exception 'Cette carte est déjà utilisée ou annulée.';
  end if;
  if v_sale.status = 'sending' and v_sale.sending_at > now() - interval '2 minutes' then
    raise exception 'Envoi en cours : patientez une minute.';
  end if;
  if p_action = 'resend' and v_sale.status = 'unpaid' then
    raise exception 'Le client n''a pas encore payé : renvoyez-lui le lien de paiement.';
  end if;
  -- Raison montrée au client (Console 1.0 : aucune, le message dit seulement que la carte est annulée).
  v_client := public.gm_client_reason(p_client_reason, p_client_text);
  select serial into v_serial from public.gm_vouchers where id = v_sale.voucher_id;
  if v_sale.voucher_id is not null then
    update public.gm_vouchers set status = 'cancelled', note = left(trim(note || ' — annulée : ' || v_reason), 200)
     where id = v_sale.voucher_id and status <> 'used';
    if exists (select 1 from public.gm_vouchers where id = v_sale.voucher_id and status = 'used') then
      raise exception 'Le client vient d''utiliser cette carte.';
    end if;
  end if;
  if p_action = 'resend' then
    update public.gm_card_sales set status = 'waiting', voucher_id = null, wa_message_id = null, last_error = '',
           sending_at = null, sent_at = null, delivered_at = null, read_at = null,
           replaces_serial = coalesce(v_serial, replaces_serial)
     where id = v_sale.id;
    perform public.gm_cartes_ping();
  elsif p_action = 'cancel' then
    update public.gm_card_sales set status = 'cancelled', last_error = 'Annulée : ' || v_reason, cancel_reason = coalesce(v_client, '')
     where id = v_sale.id;
    -- Lien de paiement encore ouvert : fermé (un paiement arrivé quand même crée une alerte « à vérifier »).
    update public.gm_cinetpay_orders set status = 'expired', last_error = 'Vente annulée', updated_at = now()
     where sale_id = v_sale.id and status in ('new', 'open');
    if coalesce(p_notify, true) then
      v_notices := public.gm_card_notify_cancel(v_sale, v_serial, v_client, v_admin.email);
      perform public.gm_cartes_ping();
    end if;
  else
    raise exception 'Action inconnue.';
  end if;
  perform public.gm_admin_log(v_admin, case when p_action = 'resend' then 'Carte WhatsApp renvoyée' else 'Vente de carte annulée' end,
    '+' || v_sale.phone, v_reason, jsonb_build_object('sale_id', v_sale.id, 'serial', v_serial, 'client_reason', v_client,
                                                      'notices', jsonb_array_length(v_notices)));
  return jsonb_build_object('ok', true, 'notices', v_notices);
end;
$$;

-- Cartes remises, remises en stock ou annulées. Annulée et vendue par WhatsApp : le client est prévenu ; carte
-- imprimée (revendeur) : personne n'est connu (« non joignables »).
drop function if exists public.gm_console_voucher_set(text, uuid[], text, text, text);
create or replace function public.gm_console_voucher_set(p_device text, p_ids uuid[], p_action text, p_note text, p_reason text,
                                                         p_client_reason text default '', p_client_text text default '')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin   public.gm_admins := public.gm_admin_ctx(p_device, array['paiements']);
  v_reason  text := public.gm_admin_reason(p_reason);
  v_list    text;
  v_client  text := public.gm_client_reason(p_client_reason, p_client_text);
  v_sale    public.gm_card_sales;
  v_serial  text;
  v_notices jsonb := '[]'::jsonb;
  v_unreach int := 0;
  r         record;
begin
  if p_ids is null or cardinality(p_ids) = 0 or cardinality(p_ids) > 500 then
    raise exception 'Choisissez de 1 à 500 cartes.';
  end if;
  select string_agg(serial, ', ' order by serial) into v_list from public.gm_vouchers where id = any (p_ids);
  if p_action = 'sold' then
    update public.gm_vouchers set status = 'sold', sold_at = now(), note = left(coalesce(nullif(trim(p_note), ''), note), 200)
     where id = any (p_ids) and status in ('new', 'sold');
  elsif p_action = 'new' then
    update public.gm_vouchers set status = 'new', sold_at = null where id = any (p_ids) and status = 'sold' and sale_id is null;
  elsif p_action = 'cancel' then
    select count(*) into v_unreach from public.gm_vouchers where id = any (p_ids) and status = 'sold' and sale_id is null;
    for r in
      select v.sale_id, v.serial from public.gm_vouchers v join public.gm_card_sales s on s.id = v.sale_id
      where v.id = any (p_ids) and v.status in ('new', 'sold') and s.status not in ('used', 'cancelled')
    loop
      select * into v_sale from public.gm_card_sales where id = r.sale_id for update;
      v_serial := r.serial;
      update public.gm_card_sales set status = 'cancelled', last_error = 'Carte annulée : ' || v_reason, cancel_reason = coalesce(v_client, '')
       where id = v_sale.id;
      v_notices := v_notices || public.gm_card_notify_cancel(v_sale, v_serial, v_client, v_admin.email);
    end loop;
    update public.gm_vouchers set status = 'cancelled', note = left(trim(note || ' — annulée : ' || v_reason), 200)
     where id = any (p_ids) and status in ('new', 'sold');
    if jsonb_array_length(v_notices) > 0 then
      perform public.gm_cartes_ping();
    end if;
  else
    raise exception 'Action inconnue.';
  end if;
  perform public.gm_admin_log(v_admin, case p_action when 'sold' then 'Cartes remises' when 'new' then 'Cartes remises en stock' else 'Cartes annulées' end,
    left(v_list, 200), v_reason, jsonb_build_object('count', cardinality(p_ids), 'note', p_note, 'client_reason', v_client,
                                                    'notices', jsonb_array_length(v_notices), 'unreachable', v_unreach));
  return jsonb_build_object('ok', true, 'notices', v_notices, 'unreachable', v_unreach);
end;
$$;

-- Lien de paiement CinetPay d'une vente « en attente de paiement » : commande préparée ici, ouverte chez CinetPay par
-- la fonction « gm-cinetpay » (appelée par la console avec la session de l'administrateur).
create or replace function public.gm_console_card_pay_link(p_device text, p_sale_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin public.gm_admins := public.gm_admin_ctx(p_device, array['paiements']);
  v_sale  public.gm_card_sales;
  v_plan  public.gm_plans;
  v_id    text := public.gm_cinetpay_new_id();
  v_names text[];
begin
  if coalesce((select value from public.gm_config where key = 'cinetpay_enabled'), 'false') <> 'true' then
    raise exception 'CinetPay n''est pas encore ouvert (Réglages → Paiements).';
  end if;
  select * into v_sale from public.gm_card_sales where id = p_sale_id for update;
  if not found or v_sale.status <> 'unpaid' then
    raise exception 'Cette vente n''attend pas de paiement.';
  end if;
  if v_sale.amount <= 0 or v_sale.amount % 5 <> 0 then
    raise exception 'Montant non accepté par CinetPay (multiple de 5 FCFA).';
  end if;
  select * into v_plan from public.gm_plans where code = v_sale.plan_code;
  update public.gm_cinetpay_orders set status = 'expired', last_error = 'Nouveau lien demandé', updated_at = now()
   where sale_id = v_sale.id and status in ('new', 'open');
  insert into public.gm_cinetpay_orders (id, sale_id, amount, currency) values (v_id, v_sale.id, v_sale.amount, 'XOF');
  perform public.gm_admin_log(v_admin, 'Lien de paiement CinetPay', '+' || v_sale.phone, '', jsonb_build_object('sale_id', v_sale.id, 'order', v_id));
  v_names := regexp_split_to_array(trim(coalesce(nullif(v_sale.client_name, ''), 'Client GestiMarket')), '\s+');
  return jsonb_build_object(
    'order_id', v_id, 'amount', v_sale.amount, 'currency', 'XOF',
    'designation', left('Carte de bon GestiMarket ' || v_plan.label || ' ' || public.gm_months_label(v_sale.months), 120),
    'first_name', v_names[1], 'last_name', coalesce(nullif(array_to_string(v_names[2:], ' '), ''), 'GestiMarket'),
    'email', '', 'phone', v_sale.phone);
end;
$$;

-- Lien ouvert chez CinetPay : gardé sur la vente et envoyé au client sur WhatsApp (dès que sa fenêtre est ouverte).
create or replace function public.gm_cinetpay_sale_link_ready(p_order_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_o    public.gm_cinetpay_orders;
  v_sale public.gm_card_sales;
  v_plan text;
begin
  select * into v_o from public.gm_cinetpay_orders where id = p_order_id and status = 'open' and payment_url <> '';
  if not found or v_o.sale_id is null then
    return jsonb_build_object('ok', false);
  end if;
  select * into v_sale from public.gm_card_sales where id = v_o.sale_id;
  select label into v_plan from public.gm_plans where code = v_sale.plan_code;
  update public.gm_card_sales set pay_url = v_o.payment_url where id = v_sale.id;
  update public.gm_wa_notices set status = 'cancelled' where sale_id = v_sale.id and kind = 'lien_paiement' and status = 'waiting';
  insert into public.gm_wa_notices (kind, phone, body, sale_id, store_id)
  values ('lien_paiement', v_sale.phone,
          E'GestiMarket · Eden Dev\n\n' || case when v_sale.client_name <> '' then 'Bonjour ' || v_sale.client_name || ', voici' else 'Voici' end
          || ' le lien pour payer votre carte de bon ' || v_plan || ' ' || public.gm_months_label(v_sale.months)
          || ' (' || replace(to_char(v_sale.amount, 'FM999G999G999'), ',', ' ') || ' FCFA) par Orange Money, Moov Money ou carte bancaire :'
          || E'\n' || v_o.payment_url
          || E'\n\nDès le paiement reçu, votre carte vous est envoyée ici automatiquement.',
          v_sale.id, v_sale.store_id);
  perform public.gm_cartes_ping();
  return jsonb_build_object('ok', true, 'payment_url', v_o.payment_url, 'window_open', public.gm_whatsapp_window_open(v_sale.phone));
end;
$$;

-- ───────────────────────────── Alertes ─────────────────────────────

create table if not exists public.gm_alertes (
  id          bigint generated always as identity primary key,
  at          timestamptz not null default now(),
  level       text not null check (level in ('critique', 'attention', 'info')),
  rule        text not null,
  title       text not null,
  detail      jsonb not null default '{}'::jsonb,
  store_id    uuid,
  user_id     uuid,
  login       text not null default '',
  ip          inet,
  dedup       text not null unique,                  -- une seule alerte par cause et par période
  seen_at     timestamptz,
  seen_by     uuid,
  seen_email  text not null default '',
  seen_note   text not null default '',
  resolved_at timestamptz                            -- cause disparue (paiement validé, appareil autorisé…)
);
create index if not exists gm_alertes_at on public.gm_alertes (at desc);
create index if not exists gm_alertes_open on public.gm_alertes (level, at desc) where seen_at is null and resolved_at is null;
alter table public.gm_alertes enable row level security;
revoke all on table public.gm_alertes from public, anon, authenticated;

create or replace function public.gm_user_stores(p_user uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(string_agg(code, ', ' order by code), '') from public.gm_stores where owner_id = p_user
$$;

-- Appareil sans les numéros de version (« GestiMarket · PC Windows ») : un nouvel appareil n'est pas une mise à jour.
create or replace function public.gm_device_family(p text)
returns text
language sql
immutable
set search_path = public
as $$
  select regexp_replace(coalesce(p, ''), '[0-9]+(\.[0-9]+)*', '', 'g')
$$;

-- Calcul des alertes (pg_cron, chaque minute). Rend le nombre d'alertes créées.
create or replace function public.gm_alertes_scan()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total int := 0;
  v_n     int;
  v_hour  text := to_char(date_trunc('hour', now()), 'YYMMDDHH24');
  v_day   text := to_char(now(), 'YYMMDD');
begin
  -- CRITIQUE : 10 mots de passe ou codes faux en 15 minutes sur un même compte.
  insert into public.gm_alertes (level, rule, title, detail, user_id, login, ip, dedup)
  select 'critique', 'mots_de_passe_faux', x.n || ' mots de passe ou codes faux en 15 minutes : ' || x.login,
         jsonb_build_object('nombre', x.n, 'adresses_ip', x.ips, 'boutiques', public.gm_user_stores(x.uid), 'source', 'signalé par le logiciel'),
         x.uid, x.login, x.last_ip, 'r1:' || x.login || ':' || v_hour
  from (select j.login, count(*) as n, count(distinct j.ip) as ips, (array_agg(j.user_id) filter (where j.user_id is not null))[1] as uid,
               (array_agg(j.ip order by j.at desc))[1] as last_ip
        from public.gm_journal_comptes j
        where j.kind in ('mot_de_passe_faux', 'code_faux', 'code_2_etapes_faux') and j.at > now() - interval '15 minutes'
        group by j.login having count(*) >= 10) x
  on conflict (dedup) do nothing;
  get diagnostics v_n = row_count; v_total := v_total + v_n;

  -- CRITIQUE : e-mail ou numéro changé, puis connexion depuis un appareil jamais vu sur ce compte (60 jours).
  insert into public.gm_alertes (level, rule, title, detail, user_id, login, ip, dedup)
  select 'critique', 'changement_puis_nouvel_appareil',
         case c.kind when 'email_change' then 'E-mail changé' else 'Numéro changé' end
           || ' puis connexion depuis un nouvel appareil : ' || c.login,
         jsonb_build_object('changement', c.detail, 'connexion', jsonb_build_object('at', n.at, 'appareil', n.device, 'ip', host(n.ip)),
                            'boutiques', public.gm_user_stores(c.user_id)),
         c.user_id, c.login, n.ip, 'r2:' || c.id
  from public.gm_journal_comptes c
  cross join lateral (
    select j.at, j.device, j.ip from public.gm_journal_comptes j
    where j.user_id = c.user_id and j.kind = 'connexion' and j.at > c.at and j.at < c.at + interval '24 hours'
      and not exists (select 1 from public.gm_journal_comptes o
                      where o.user_id = c.user_id and o.kind in ('connexion', 'verification_2_etapes')
                        and o.at < c.at and o.at > c.at - interval '60 days'
                        and public.gm_device_family(o.device) = public.gm_device_family(j.device))
    order by j.at limit 1) n
  where c.kind in ('email_change', 'numero_change') and c.at > now() - interval '2 days' and c.user_id is not null
  on conflict (dedup) do nothing;
  get diagnostics v_n = row_count; v_total := v_total + v_n;

  -- CRITIQUE : 3 cartes de bon refusées en 1 heure dans une boutique (codes essayés au hasard ?).
  insert into public.gm_alertes (level, rule, title, detail, store_id, dedup)
  select 'critique', 'cartes_refusees', e.n || ' cartes de bon refusées en 1 heure : ' || s.code || ' (' || s.name || ')',
         jsonb_build_object('nombre', e.n, 'bloquee', e.n >= 5), s.id, 'r3:' || s.id || ':' || v_hour
  from (select store_id, count(*) as n from public.gm_license_events
        where kind = 'voucher_failed' and created_at > now() - interval '1 hour' group by store_id having count(*) >= 3) e
  join public.gm_stores s on s.id = e.store_id
  on conflict (dedup) do nothing;
  get diagnostics v_n = row_count; v_total := v_total + v_n;

  -- CRITIQUE : référence de paiement mobile déjà utilisée par un autre paiement.
  insert into public.gm_alertes (level, rule, title, detail, store_id, dedup)
  select 'critique', 'reference_en_double', 'Référence de paiement en double : ' || p.reference || ' (' || s.code || ')',
         jsonb_build_object('payment_id', p.id, 'method', p.method, 'amount', p.amount, 'status', p.status), s.id, 'r4:' || p.id
  from public.gm_payments p join public.gm_stores s on s.id = p.store_id
  where p.created_at > now() - interval '7 days' and p.method in ('orange_money', 'wave', 'moov_money', 'virement')
    and p.reference <> '' and p.status <> 'refused'
    and exists (select 1 from public.gm_payments q where q.id <> p.id and q.created_at <= p.created_at
                and upper(q.reference) = upper(p.reference) and q.status <> 'refused')
  on conflict (dedup) do nothing;
  get diagnostics v_n = row_count; v_total := v_total + v_n;

  -- CRITIQUE : vérification à 2 étapes d'un administrateur retirée (hors réinitialisation par la Direction).
  insert into public.gm_alertes (level, rule, title, detail, user_id, login, dedup)
  select 'critique', 'admin_2_etapes_retiree', 'Vérification à 2 étapes retirée : ' || j.login,
         j.detail, j.user_id, j.login, 'r5:' || j.id
  from public.gm_journal_comptes j join public.gm_admins a on a.user_id = j.user_id
  where j.kind = 'verification_2_etapes_retiree' and j.at > now() - interval '1 day' and coalesce(j.detail ->> 'par', '') = ''
  on conflict (dedup) do nothing;
  get diagnostics v_n = row_count; v_total := v_total + v_n;

  -- ATTENTION : nouvel appareil sur la console, en attente d'autorisation.
  insert into public.gm_alertes (level, rule, title, detail, user_id, login, dedup)
  select 'attention', 'appareil_console', 'Nouvel appareil sur la console : ' || coalesce(nullif(d.label, ''), '?') || ' (' || a.email || ')',
         jsonb_build_object('device_id', d.id, 'platform', d.platform), d.user_id, a.email, 'r6:' || d.id
  from public.gm_admin_devices d join public.gm_admins a on a.user_id = d.user_id
  where d.status = 'pending'
  on conflict (dedup) do nothing;
  get diagnostics v_n = row_count; v_total := v_total + v_n;

  -- ATTENTION : mot de passe changé.
  insert into public.gm_alertes (level, rule, title, detail, user_id, login, ip, dedup)
  select 'attention', 'mot_de_passe_change',
         'Mot de passe changé : ' || j.login || coalesce(' (' || nullif(public.gm_user_stores(j.user_id), '') || ')', ''),
         jsonb_build_object('appareil', j.device, 'admin', exists (select 1 from public.gm_admins a where a.user_id = j.user_id)),
         j.user_id, j.login, j.ip, 'r7:' || j.id
  from public.gm_journal_comptes j
  where j.kind = 'mot_de_passe_change' and j.at > now() - interval '1 day'
  on conflict (dedup) do nothing;
  get diagnostics v_n = row_count; v_total := v_total + v_n;

  -- ATTENTION : connexions depuis 3 adresses IP différentes en 1 heure.
  insert into public.gm_alertes (level, rule, title, detail, user_id, login, dedup)
  select 'attention', 'adresses_ip_multiples', x.ips || ' adresses IP en 1 heure : ' || x.login,
         jsonb_build_object('adresses', x.list, 'boutiques', public.gm_user_stores(x.user_id)), x.user_id, x.login, 'r8:' || x.user_id || ':' || v_hour
  from (select j.user_id, max(j.login) as login, count(distinct j.ip) as ips,
               jsonb_agg(distinct host(j.ip)) as list
        from public.gm_journal_comptes j
        where j.kind = 'connexion' and j.at > now() - interval '1 hour' and j.ip is not null and j.user_id is not null
        group by j.user_id having count(distinct j.ip) >= 3) x
  on conflict (dedup) do nothing;
  get diagnostics v_n = row_count; v_total := v_total + v_n;

  -- ATTENTION : même erreur du logiciel sur 3 PC ou plus en 24 heures.
  insert into public.gm_alertes (level, rule, title, detail, dedup)
  select 'attention', 'meme_erreur', 'Même erreur sur ' || x.pcs || ' PC : ' || left(x.message, 120),
         jsonb_build_object('message', left(x.message, 300), 'pcs', x.pcs, 'fois', x.n, 'versions', x.versions),
         'r9:' || md5(x.message) || ':' || v_day
  from (select r.message, count(distinct r.pc) as pcs, sum(r.count) as n, jsonb_agg(distinct r.version) as versions
        from public.gm_error_reports r where r.last_at > now() - interval '24 hours'
        group by r.message having count(distinct r.pc) >= 3) x
  on conflict (dedup) do nothing;
  get diagnostics v_n = row_count; v_total := v_total + v_n;

  -- ATTENTION : carte de bon ou message au client non envoyé sur WhatsApp.
  insert into public.gm_alertes (level, rule, title, detail, dedup)
  select 'attention', 'whatsapp_echec', 'Carte WhatsApp non envoyée : +' || c.phone || ' — ' || left(c.last_error, 120),
         jsonb_build_object('sale_id', c.id, 'error', c.last_error), 'r10:' || c.id || ':' || c.attempts
  from public.gm_card_sales c where c.status = 'failed'
  on conflict (dedup) do nothing;
  get diagnostics v_n = row_count; v_total := v_total + v_n;
  insert into public.gm_alertes (level, rule, title, detail, dedup)
  select 'attention', 'whatsapp_echec', 'Message au client non envoyé : +' || n.phone || ' — ' || left(n.last_error, 120),
         jsonb_build_object('notice_id', n.id, 'sale_id', n.sale_id, 'kind', n.kind, 'error', n.last_error), 'r10n:' || n.id
  from public.gm_wa_notices n where n.status = 'failed'
  on conflict (dedup) do nothing;
  get diagnostics v_n = row_count; v_total := v_total + v_n;

  -- ATTENTION : 3 échecs de connexion à la console en 15 minutes.
  insert into public.gm_alertes (level, rule, title, detail, login, ip, dedup)
  select 'attention', 'console_echecs', x.n || ' échecs de connexion à la console : ' || x.login,
         jsonb_build_object('nombre', x.n), x.login, x.last_ip, 'r11:' || x.login || ':' || v_hour
  from (select j.login, count(*) as n, (array_agg(j.ip order by j.at desc))[1] as last_ip
        from public.gm_journal_comptes j
        where j.source = 'console' and j.at > now() - interval '15 minutes' group by j.login having count(*) >= 3) x
  on conflict (dedup) do nothing;
  get diagnostics v_n = row_count; v_total := v_total + v_n;

  -- ATTENTION : paiement CinetPay à vérifier (montant inattendu, payé après fermeture).
  insert into public.gm_alertes (level, rule, title, detail, dedup)
  select 'attention', 'cinetpay_a_verifier', 'CinetPay : paiement à vérifier (' || o.id || ') — ' || left(o.last_error, 120),
         jsonb_build_object('order', o.id, 'payment_id', o.payment_id, 'sale_id', o.sale_id, 'amount', o.amount, 'cp_status', o.cp_status),
         'r14:' || o.id
  from public.gm_cinetpay_orders o where o.status = 'error' and o.cp_status = 'SUCCESS'
  on conflict (dedup) do nothing;
  get diagnostics v_n = row_count; v_total := v_total + v_n;

  -- ATTENTION : numéro bloqué pour les codes WhatsApp (plus de 6 codes en 1 heure).
  insert into public.gm_alertes (level, rule, title, detail, user_id, login, dedup)
  select 'attention', 'codes_whatsapp', 'Trop de codes WhatsApp demandés : +' || j.login,
         j.detail || jsonb_build_object('boutiques', public.gm_user_stores(j.user_id)), j.user_id, j.login, 'r15:' || j.login || ':' || v_hour
  from public.gm_journal_comptes j
  where j.kind = 'code_whatsapp_bloque' and j.at > now() - interval '1 hour'
  on conflict (dedup) do nothing;
  get diagnostics v_n = row_count; v_total := v_total + v_n;

  -- INFO : paiement à valider.
  insert into public.gm_alertes (level, rule, title, detail, store_id, dedup)
  select 'info', 'paiement_a_valider',
         'Paiement à valider : ' || s.code || ' — ' || replace(to_char(p.amount, 'FM999G999G999'), ',', ' ') || ' ' || p.currency || ' ('
           || case p.method when 'orange_money' then 'Orange Money' when 'moov_money' then 'Moov Money' when 'wave' then 'Wave'
                            when 'cinetpay' then 'CinetPay' when 'carte_visa' then 'Visa' else p.method end || ')',
         jsonb_build_object('payment_id', p.id), s.id, 'r12:' || p.id
  from public.gm_payments p join public.gm_stores s on s.id = p.store_id where p.status = 'declared'
  on conflict (dedup) do nothing;
  get diagnostics v_n = row_count; v_total := v_total + v_n;

  -- INFO : carte vendue qui attend depuis 30 minutes (le client n'a pas écrit à Eden Dev).
  insert into public.gm_alertes (level, rule, title, detail, dedup)
  select 'info', 'carte_en_attente', 'Carte en attente : +' || c.phone || ' n''a pas écrit à Eden Dev sur WhatsApp',
         jsonb_build_object('sale_id', c.id), 'r13:' || c.id
  from public.gm_card_sales c where c.status = 'waiting' and c.created_at < now() - interval '30 minutes'
  on conflict (dedup) do nothing;
  get diagnostics v_n = row_count; v_total := v_total + v_n;

  -- Causes disparues : alertes closes toutes seules.
  update public.gm_alertes a set resolved_at = now()
  where a.resolved_at is null and (
       (a.rule = 'appareil_console' and not exists (select 1 from public.gm_admin_devices d where d.id = (a.detail ->> 'device_id')::uuid and d.status = 'pending'))
    or (a.rule = 'paiement_a_valider' and not exists (select 1 from public.gm_payments p where p.id = (a.detail ->> 'payment_id')::uuid and p.status = 'declared'))
    or (a.rule = 'carte_en_attente' and not exists (select 1 from public.gm_card_sales c where c.id = (a.detail ->> 'sale_id')::uuid and c.status = 'waiting'))
    or (a.rule = 'whatsapp_echec' and a.detail ? 'notice_id'
        and not exists (select 1 from public.gm_wa_notices n where n.id = (a.detail ->> 'notice_id')::uuid and n.status = 'failed'))
    or (a.rule = 'whatsapp_echec' and not a.detail ? 'notice_id'
        and not exists (select 1 from public.gm_card_sales c where c.id = (a.detail ->> 'sale_id')::uuid and c.status = 'failed')));
  return v_total;
end;
$$;

-- Effacement automatique : journal des comptes 6 mois, alertes 12 mois, messages aux clients 90 jours.
create or replace function public.gm_journal_purge()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.gm_journal_comptes where at < now() - interval '6 months';
  delete from public.gm_alertes where coalesce(seen_at, resolved_at, at) < now() - interval '12 months';
  delete from public.gm_wa_notices where created_at < now() - interval '90 days';
$$;

select cron.unschedule(jobid) from cron.job where jobname in ('gm-alertes', 'gm-journal-purge');
select cron.schedule('gm-alertes', '* * * * *', 'select public.gm_alertes_scan()');
select cron.schedule('gm-journal-purge', '17 3 * * *', 'select public.gm_journal_purge()');

-- Alertes ouvertes (non vues, cause toujours là) et, à la demande, l'historique.
create or replace function public.gm_console_alerts(p_device text, p_history boolean default false, p_search text default '')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin public.gm_admins := public.gm_admin_ctx(p_device);
  v_q     text := lower(trim(coalesce(p_search, '')));
begin
  return jsonb_build_object(
    'open', (select coalesce(jsonb_agg(x order by x.rank, x.at desc), '[]'::jsonb) from (
               select a.id, a.at, a.level, a.rule, a.title, a.detail, a.login, host(a.ip) as ip, s.code as store_code, s.name as store_name,
                      case a.level when 'critique' then 0 when 'attention' then 1 else 2 end as rank
               from public.gm_alertes a left join public.gm_stores s on s.id = a.store_id
               where a.seen_at is null and a.resolved_at is null
               order by rank, a.at desc limit 300) x),
    'history', case when coalesce(p_history, false) then (
               select coalesce(jsonb_agg(x order by x.at desc), '[]'::jsonb) from (
                 select a.id, a.at, a.level, a.rule, a.title, a.detail, a.login, host(a.ip) as ip, s.code as store_code,
                        a.seen_at, a.seen_email, a.seen_note, a.resolved_at
                 from public.gm_alertes a left join public.gm_stores s on s.id = a.store_id
                 where (a.seen_at is not null or a.resolved_at is not null)
                   and (v_q = '' or lower(a.title || ' ' || a.login || ' ' || coalesce(s.code, '') || ' ' || a.seen_email) like '%' || v_q || '%')
                 order by a.at desc limit 500) x)
               else '[]'::jsonb end,
    'now', now());
end;
$$;

create or replace function public.gm_console_alert_seen(p_device text, p_ids bigint[], p_note text default '')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin public.gm_admins := public.gm_admin_ctx(p_device);
  v_n     int;
  v_list  text;
begin
  if p_ids is null or cardinality(p_ids) = 0 or cardinality(p_ids) > 500 then
    raise exception 'Choisissez de 1 à 500 alertes.';
  end if;
  update public.gm_alertes set seen_at = now(), seen_by = v_admin.user_id, seen_email = v_admin.email, seen_note = left(trim(coalesce(p_note, '')), 300)
   where id = any (p_ids) and seen_at is null;
  get diagnostics v_n = row_count;
  if v_n > 0 then
    select string_agg(left(title, 80), ' ; ' order by id) into v_list from public.gm_alertes where id = any (p_ids);
    perform public.gm_admin_log(v_admin, case when v_n = 1 then 'Alerte vue' else 'Alertes vues' end, left(coalesce(v_list, ''), 200),
      coalesce(p_note, ''), jsonb_build_object('ids', to_jsonb(p_ids), 'count', v_n));
  end if;
  return jsonb_build_object('ok', true, 'count', v_n);
end;
$$;

-- ───────────────────────────── Journal des boutiques ─────────────────────────────

-- Famille d'un événement (filtres de la console).
create or replace function public.gm_jc_cat(p_kind text)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when p_kind in ('connexion', 'verification_2_etapes') then 'connexions'
    when p_kind in ('mot_de_passe_faux', 'code_faux', 'code_2_etapes_faux', 'code_whatsapp_bloque', 'voucher_failed') then 'echecs'
    when p_kind in ('inscription', 'compte_confirme', 'mot_de_passe_change', 'mot_de_passe_oublie', 'email_change', 'email_change_demande',
                    'numero_change', 'compte_supprime', 'verification_2_etapes_ajoutee', 'verification_2_etapes_retiree', 'code_whatsapp',
                    'store_created', 'store_suspended', 'store_reactivated') then 'compte'
    when p_kind like 'voucher%' then 'cartes'
    when p_kind like 'payment%' or p_kind in ('subscription_activated', 'gift', 'plan_changed') then 'paiements'
    when p_kind like 'pc%' or p_kind like 'licen%' or p_kind like 'tunnel%' then 'appareils'
    when p_kind = 'action_eden_dev' then 'eden_dev'
    when p_kind = 'erreur' then 'erreurs'
    else 'autres' end
$$;

-- Tout ce qu'on sait d'une boutique, d'un compte ou d'une adresse IP : code GM-…, téléphone, e-mail ou adresse IP.
-- Un nom de boutique donne la liste des boutiques qui lui ressemblent. Chaque recherche est inscrite au journal de la
-- console (données personnelles consultées).
create or replace function public.gm_console_store_journal(p_device text, p_query text, p_cats text[] default null,
                                                           p_from date default null, p_to date default null, p_text text default '')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin  public.gm_admins := public.gm_admin_ctx(p_device);
  v_q      text := trim(coalesce(p_query, ''));
  v_t      text := lower(trim(coalesce(p_text, '')));
  v_kind   text;
  v_ip     inet;
  v_digits text := regexp_replace(coalesce(p_query, ''), '\D', '', 'g');
  v_stores uuid[] := '{}';
  v_users  uuid[] := '{}';
  v_logins text[] := '{}';
  v_codes  text[] := '{}';
  v_pcs    text[] := '{}';
  v_events jsonb;
begin
  if length(v_q) < 3 then
    raise exception 'Tapez le code de la boutique (GM-…), son téléphone, son e-mail ou une adresse IP.';
  end if;
  if v_q ~ '^[0-9]{1,3}(\.[0-9]{1,3}){3}$' or (v_q ~ ':' and v_q ~ '^[0-9A-Fa-f:]+$') then
    begin
      v_ip := v_q::inet;
    exception when others then
      raise exception 'Adresse IP invalide.';
    end;
    v_kind := 'ip';
    select coalesce(array_agg(distinct user_id), '{}') into v_users from public.gm_journal_comptes where ip = v_ip and user_id is not null;
  elsif upper(v_q) ~ '^GM-?[0-9]{1,8}$' then
    v_kind := 'boutique';
    select coalesce(array_agg(id), '{}') into v_stores from public.gm_stores
    where code = upper(v_q) or code = 'GM-' || lpad(v_digits, 6, '0');
    if cardinality(v_stores) = 0 then
      raise exception 'Aucune boutique %.', upper(v_q);
    end if;
  elsif position('@' in v_q) > 0 then
    v_kind := 'compte';
    v_logins := array[lower(v_q)];
    select coalesce(array_agg(id), '{}') into v_users from auth.users where lower(email) = lower(v_q);
    select coalesce(array_agg(id), '{}') into v_stores from public.gm_stores where lower(email) = lower(v_q);
  elsif length(v_digits) >= 8 then
    v_kind := 'telephone';
    v_logins := array[public.gm_phone_digits(v_q)];
    select coalesce(array_agg(id), '{}') into v_users from auth.users where phone = public.gm_phone_digits(v_q);
    select coalesce(array_agg(id), '{}') into v_stores from public.gm_stores
    where public.gm_phone_digits(phone) = public.gm_phone_digits(v_q);
  else
    return jsonb_build_object('kind', 'noms', 'matches', (
      select coalesce(jsonb_agg(jsonb_build_object('code', s.code, 'name', s.name, 'owner_name', s.owner_name, 'city', s.city) order by s.name), '[]'::jsonb)
      from (select * from public.gm_stores
            where lower(name) like '%' || lower(v_q) || '%' or lower(owner_name) like '%' || lower(v_q) || '%'
            order by name limit 30) s),
      'events', '[]'::jsonb, 'stores', '[]'::jsonb, 'accounts', '[]'::jsonb);
  end if;

  -- Boutique → compte de la propriétaire ; compte → ses boutiques ; puis e-mails, numéros et PC.
  v_users := v_users || coalesce((select array_agg(distinct owner_id) from public.gm_stores where id = any (v_stores) and owner_id is not null), '{}');
  select coalesce(array_agg(id), '{}'), coalesce(array_agg(code), '{}') into v_stores, v_codes
  from public.gm_stores where id = any (v_stores) or owner_id = any (v_users);
  if v_kind <> 'ip' then
    v_logins := v_logins
      || coalesce((select array_agg(lower(email)) from auth.users where id = any (v_users) and coalesce(email, '') <> ''), '{}')
      || coalesce((select array_agg(phone) from auth.users where id = any (v_users) and coalesce(phone, '') <> ''), '{}');
  end if;
  select coalesce(array_agg(pc_id), '{}') into v_pcs from public.gm_store_pcs where store_id = any (v_stores);

  select coalesce(jsonb_agg(to_jsonb(e) order by e.at desc), '[]'::jsonb) into v_events from (
    select * from (
      select j.at, 'compte' as src, j.kind, j.login, coalesce(host(j.ip), '') as ip, j.device, j.source as via, j.detail,
             public.gm_user_stores(j.user_id) as store_code, public.gm_jc_cat(j.kind) as cat
      from public.gm_journal_comptes j
      where (v_kind = 'ip' and j.ip = v_ip) or (v_kind <> 'ip' and (j.user_id = any (v_users) or j.login = any (v_logins)))
      union all
      select e.created_at, 'licence', e.kind, '', '', '', 'base', e.detail, s.code, public.gm_jc_cat(e.kind)
      from public.gm_license_events e join public.gm_stores s on s.id = e.store_id
      where v_kind <> 'ip' and e.store_id = any (v_stores)
      union all
      select a.at, 'eden_dev', 'action_eden_dev', a.email, '', '', 'console',
             jsonb_build_object('action', a.action, 'motif', a.reason) || a.detail, a.target, 'eden_dev'
      from public.gm_admin_journal a
      where v_kind <> 'ip' and (a.target = any (v_codes) or a.target = any (v_logins)
                                or a.target in (select '+' || l from unnest(v_logins) l))
      union all
      select r.last_at, 'erreur', 'erreur', '', '', r.device, r.version,
             jsonb_build_object('message', left(r.message, 300), 'fois', r.count, 'page', r.page, 'version', r.version, 'pc', r.pc),
             null, 'erreurs'
      from public.gm_error_reports r
      where v_kind <> 'ip' and upper(regexp_replace(r.pc, '[^0-9A-Za-z]', '', 'g')) = any (v_pcs)
    ) u
    where (p_cats is null or cardinality(p_cats) = 0 or u.cat = any (p_cats))
      and (p_from is null or u.at >= p_from) and (p_to is null or u.at < p_to + 1)
      and (v_t = '' or lower(u.kind || ' ' || u.login || ' ' || u.ip || ' ' || u.device || ' ' || coalesce(u.store_code, '') || ' ' || u.detail::text)
                       like '%' || v_t || '%')
    order by u.at desc
    limit 1500) e;

  perform public.gm_admin_log(v_admin, 'Journal des boutiques consulté', left(v_q, 120), '', jsonb_build_object('type', v_kind));

  return jsonb_build_object(
    'kind', v_kind, 'ip', host(v_ip),
    'stores', (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'code', s.code, 'name', s.name, 'owner_name', s.owner_name,
                                                            'phone', s.phone, 'email', s.email, 'city', s.city, 'status', s.status,
                                                            'created_at', s.created_at) order by s.code), '[]'::jsonb)
               from public.gm_stores s where s.id = any (v_stores)),
    'accounts', (select coalesce(jsonb_agg(jsonb_build_object('id', u.id, 'email', u.email, 'phone', u.phone, 'created_at', u.created_at,
                                                              'last_sign_in_at', u.last_sign_in_at,
                                                              'confirmed', coalesce(u.email_confirmed_at, u.phone_confirmed_at) is not null,
                                                              'admin', exists (select 1 from public.gm_admins a where a.user_id = u.id),
                                                              'factors', (select count(*) from auth.mfa_factors f where f.user_id = u.id and f.status = 'verified'))
                                            order by u.created_at), '[]'::jsonb)
                 from auth.users u where u.id = any (v_users)),
    'ips', (select coalesce(jsonb_agg(jsonb_build_object('ip', host(x.ip), 'n', x.n, 'last', x.last, 'devices', x.devices) order by x.last desc), '[]'::jsonb)
            from (select j.ip, count(*) as n, max(j.at) as last, jsonb_agg(distinct j.device) as devices
                  from public.gm_journal_comptes j
                  where j.ip is not null and ((v_kind = 'ip' and j.ip = v_ip) or (v_kind <> 'ip' and j.user_id = any (v_users)))
                  group by j.ip order by max(j.at) desc limit 30) x),
    'events', v_events);
end;
$$;

-- ───────────────────────────── Équipe : vérification à 2 étapes ─────────────────────────────

create or replace function public.gm_console_admins(p_device text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin public.gm_admins := public.gm_admin_ctx(p_device, array['direction']);
begin
  return (select coalesce(jsonb_agg(jsonb_build_object(
            'user_id', a.user_id, 'email', a.email, 'name', a.name, 'role', a.role, 'role_label', public.gm_role_label(a.role),
            'active', a.active, 'created_at', a.created_at, 'me', a.user_id = v_admin.user_id,
            'devices', (select count(*) from public.gm_admin_devices d where d.user_id = a.user_id and d.status = 'approved'),
            'mfa', exists (select 1 from auth.mfa_factors f where f.user_id = a.user_id and f.status = 'verified'),
            'mfa_count', (select count(*) from auth.mfa_factors f where f.user_id = a.user_id and f.status = 'verified')
          ) order by a.active desc, a.role, a.email), '[]'::jsonb)
          from public.gm_admins a);
end;
$$;

-- Téléphone perdu : la Direction efface la vérification à 2 étapes d'un membre (et ferme ses sessions). À sa
-- prochaine connexion, le membre scanne un nouveau code QR. Jamais pour soi-même : un autre membre de la Direction.
create or replace function public.gm_console_admin_mfa_reset(p_device text, p_user_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin  public.gm_admins := public.gm_admin_ctx(p_device, array['direction']);
  v_reason text := public.gm_admin_reason(p_reason);
  v_target public.gm_admins;
  v_n      int;
begin
  if p_user_id = v_admin.user_id then
    raise exception 'Vous ne pouvez pas réinitialiser votre propre vérification : demandez à un autre membre de la Direction.';
  end if;
  select * into v_target from public.gm_admins where user_id = p_user_id;
  if not found then
    raise exception 'Membre introuvable.';
  end if;
  perform set_config('gm.mfa_reset_by', v_admin.email, true);
  delete from auth.mfa_factors where user_id = p_user_id;
  get diagnostics v_n = row_count;
  delete from auth.sessions where user_id = p_user_id;
  perform public.gm_admin_log(v_admin, 'Vérification à 2 étapes réinitialisée', v_target.email, v_reason, jsonb_build_object('factors', v_n));
  return jsonb_build_object('ok', true, 'factors', v_n);
end;
$$;

-- ───────────────────────────── Réglages : CinetPay ─────────────────────────────

create or replace function public.gm_console_settings(p_device text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin public.gm_admins := public.gm_admin_ctx(p_device);
begin
  return jsonb_build_object(
    'config', (select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) from public.gm_config
               where key in ('om_merchant_code', 'om_merchant_name', 'om_qr_payload', 'wave_merchant_number', 'wave_merchant_name',
                             'moov_merchant_number', 'moov_merchant_name', 'trial_days', 'trial_plan', 'card_enabled',
                             'whatsapp_enabled', 'whatsapp_number', 'payment_instructions', 'console_owner_email', 'cinetpay_enabled')),
    'plans', (select coalesce(jsonb_agg(jsonb_build_object('code', code, 'label', label, 'price_month', price_month,
                                                           'max_postes', max_postes, 'active', active, 'description', description)
                                        order by sort), '[]'::jsonb) from public.gm_plans),
    'whatsapp_ready', exists (select 1 from public.gm_whatsapp_contacts where last_inbound_at > now() - interval '30 days'),
    'cinetpay', jsonb_build_object(
      'orders', (select count(*) from public.gm_cinetpay_orders),
      'success', (select count(*) from public.gm_cinetpay_orders where status = 'success'),
      'last_error', (select last_error from public.gm_cinetpay_orders where last_error <> '' order by updated_at desc limit 1))
  );
end;
$$;

create or replace function public.gm_console_setting_set(p_device text, p_key text, p_value text, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin  public.gm_admins := public.gm_admin_ctx(p_device, array['direction']);
  v_reason text := public.gm_admin_reason(p_reason);
  v_value  text := trim(coalesce(p_value, ''));
  v_old    text;
begin
  if p_key not in ('om_merchant_code', 'om_merchant_name', 'om_qr_payload', 'wave_merchant_number', 'wave_merchant_name',
                   'moov_merchant_number', 'moov_merchant_name', 'trial_days', 'trial_plan', 'card_enabled',
                   'whatsapp_enabled', 'payment_instructions', 'cinetpay_enabled') then
    raise exception 'Réglage non modifiable depuis la console.';
  end if;
  if p_key = 'trial_days' and (v_value !~ '^[0-9]{1,2}$' or v_value::int > 60) then
    raise exception 'Durée de l''essai : de 0 à 60 jours.';
  end if;
  if p_key = 'trial_plan' and not exists (select 1 from public.gm_plans where code = v_value and code <> 'free') then
    raise exception 'Formule d''essai inconnue.';
  end if;
  if p_key in ('card_enabled', 'whatsapp_enabled', 'cinetpay_enabled') and v_value not in ('true', 'false') then
    raise exception 'Valeur attendue : oui ou non.';
  end if;
  if p_key in ('wave_merchant_number', 'moov_merchant_number') and v_value <> '' and v_value !~ '^\+?[0-9 ]{8,20}$' then
    raise exception 'Numéro invalide.';
  end if;
  select value into v_old from public.gm_config where key = p_key;
  insert into public.gm_config (key, value) values (p_key, left(v_value, 2000))
  on conflict (key) do update set value = excluded.value;
  perform public.gm_admin_log(v_admin, 'Réglage modifié', p_key, v_reason,
    jsonb_build_object('before', left(coalesce(v_old, ''), 200), 'after', left(v_value, 200)));
  return jsonb_build_object('ok', true);
end;
$$;

-- ───────────────────────────── Droits d'exécution ─────────────────────────────

do $$
declare
  f text;
begin
  -- Internes.
  foreach f in array array[
    'gm_client_reason(text, text)', 'gm_months_label(integer)',
    'gm_card_notify_cancel(public.gm_card_sales, text, text, text)', 'gm_user_stores(uuid)', 'gm_device_family(text)',
    'gm_alertes_scan()', 'gm_journal_purge()', 'gm_jc_cat(text)']
  loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;
  -- Fonctions d'Eden Dev (service_role) : gm-cartes, gm-whatsapp-webhook, gm-cinetpay.
  foreach f in array array[
    'gm_wa_notices_claim(text)', 'gm_wa_notice_sent(uuid, text)', 'gm_wa_notice_failed(uuid, integer, text, boolean)',
    'gm_card_sale_wa_status(text, text, integer, text)', 'gm_card_sale_issue(uuid)', 'gm_cinetpay_sale_link_ready(text)']
  loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
  -- Console : comptes connectés ; chaque fonction vérifie administrateur, 2 étapes, appareil et rôle.
  foreach f in array array[
    'gm_console_card_sell(text, text, text, text, integer, text, text, text)', 'gm_console_card_sales(text, text, text)',
    'gm_console_card_sale_action(text, uuid, text, text, text, text, boolean)',
    'gm_console_voucher_set(text, uuid[], text, text, text, text, text)', 'gm_console_card_pay_link(text, uuid)',
    'gm_console_alerts(text, boolean, text)', 'gm_console_alert_seen(text, bigint[], text)',
    'gm_console_store_journal(text, text, text[], date, date, text)', 'gm_console_admins(text)',
    'gm_console_admin_mfa_reset(text, uuid, text)', 'gm_console_settings(text)', 'gm_console_setting_set(text, text, text, text)']
  loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end;
$$;
