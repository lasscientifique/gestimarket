-- ═══════════════════════════════════════════════════════════════════════════
-- Sugu Eden 0.30 « Vitrine » : la place de marché d'Eden Dev (étape S1).
--
-- Les boutiques GestiMarket (formules PRO et BUSINESS) publient les produits qu'elles choisissent ; le site
-- Sugu Eden les montre (recherche, catégories, villes, fiche produit, page boutique) et l'acheteur commande
-- par WhatsApp ou par téléphone, directement à la boutique. Aucun paiement ne passe par Eden Dev.
--
-- Écriture : uniquement par la fonction gm-sugu (service_role), appelée par le PC de la boutique avec son
-- jeton d'appareil (0.27). Lecture : uniquement par les fonctions sugu_* ci-dessous (clé publique) ; les
-- tables ne sont pas lisibles directement. Une boutique n'est montrée que tant que son abonnement court
-- (visible_until, mis à jour à chaque publication).
-- ═══════════════════════════════════════════════════════════════════════════

create extension if not exists unaccent with schema extensions;

-- Texte de recherche : minuscules, sans accents (« Café » = « cafe »).
create or replace function public.sugu_norm(p text)
returns text
language sql
immutable
parallel safe
set search_path = public, extensions
as $$
  select lower(extensions.unaccent('extensions.unaccent'::regdictionary, coalesce(p, '')))
$$;

-- Formules qui publient sur Sugu Eden : PRO et BUSINESS.
update public.gm_plans
   set features = array_append(features, 'sugu')
 where code in ('pro', 'business') and not ('sugu' = any (features));

-- Adresse du site Sugu Eden (liens « Voir ma boutique » dans GestiMarket).
insert into public.gm_config (key, value)
values ('sugu_site_url', 'https://lasscientifique.github.io/gestimarket/')
on conflict (key) do nothing;

create table if not exists public.sugu_shops (
  store_id      uuid primary key references public.gm_stores(id) on delete cascade,
  slug          text not null unique,
  name          text not null,
  country       text not null,
  city          text not null,
  address       text not null default '',
  whatsapp      text not null default '',
  phone         text not null default '',
  description   text not null default '',
  shop_type     text not null default '',
  logo_path     text,
  currency      text not null default 'XOF',
  decimals      int  not null default 0,
  active        boolean not null default true,
  visible_until timestamptz not null default now(),
  products      int  not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists sugu_shops_place_idx on public.sugu_shops (country, city);

create table if not exists public.sugu_products (
  id          uuid primary key default gen_random_uuid(),
  store_id    uuid not null references public.sugu_shops(store_id) on delete cascade,
  local_id    bigint not null,
  name        text not null,
  description text not null default '',
  category    text not null default '',
  brand       text not null default '',
  unit        text not null default '',
  price       bigint not null check (price >= 0),
  in_stock    boolean not null default true,
  stock_shown numeric,
  photo_path  text,
  photo_key   text not null default '',
  search_text text not null default '',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (store_id, local_id)
);
create index if not exists sugu_products_store_idx on public.sugu_products (store_id, updated_at desc);
create index if not exists sugu_products_recent_idx on public.sugu_products (updated_at desc);

create or replace function public.sugu_products_search()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.search_text := public.sugu_norm(concat_ws(' ', new.name, new.brand, new.category, new.description));
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists sugu_products_search on public.sugu_products;
create trigger sugu_products_search before insert or update on public.sugu_products
for each row execute function public.sugu_products_search();

alter table public.sugu_shops enable row level security;
alter table public.sugu_products enable row level security;
revoke all on public.sugu_shops, public.sugu_products from anon, authenticated;

-- Photos des produits et logos : publics, 1 Mo au plus, images seulement.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('sugu', 'sugu', true, 1048576, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = true, file_size_limit = 1048576,
  allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

-- ───────────────────────────── Écriture (fonction gm-sugu) ─────────────────────────────

-- Boutique d'un PC qui présente son jeton d'appareil : formule avec « sugu » et fin de l'abonnement.
create or replace function public.sugu_pc_store(p_pc_id text, p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pc_id text := upper(regexp_replace(coalesce(p_pc_id, ''), '[^0-9A-Za-z]', '', 'g'));
  v_store public.gm_stores;
  v_cur   public.gm_subscriptions;
  v_next  public.gm_subscriptions;
  v_plan  public.gm_plans;
  v_end   timestamptz;
begin
  if p_token is null or length(p_token) < 40 then
    raise exception 'Ce PC doit être relié de nouveau au compte boutique.';
  end if;
  select s.* into v_store
  from public.gm_store_pcs pc join public.gm_stores s on s.id = pc.store_id
  where pc.pc_id = v_pc_id and pc.device_token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
  if not found then
    raise exception 'Ce PC doit être relié de nouveau au compte boutique.';
  end if;
  update public.gm_store_pcs set last_seen = now() where pc_id = v_pc_id;
  select * into v_cur from public.gm_subscriptions
  where store_id = v_store.id and status = 'active' and starts_at <= now() and ends_at > now()
  order by starts_at desc limit 1;
  if found then
    select * into v_plan from public.gm_plans where code = v_cur.plan_code;
    v_end := v_cur.ends_at;
    loop
      select * into v_next from public.gm_subscriptions
      where store_id = v_store.id and status = 'active' and plan_code = v_cur.plan_code
        and starts_at <= v_end and ends_at > v_end
      order by ends_at desc limit 1;
      exit when not found;
      v_end := v_next.ends_at;
    end loop;
  end if;
  return jsonb_build_object(
    'store_id', v_store.id, 'code', v_store.code, 'name', v_store.name, 'country', v_store.country,
    'city', v_store.city, 'address', v_store.address, 'phone', v_store.phone, 'shop_type', v_store.shop_type,
    'active', v_store.status = 'active',
    'allowed', v_store.status = 'active' and v_plan.code is not null and 'sugu' = any (v_plan.features),
    'plan', v_plan.code, 'visible_until', v_end,
    'site_url', (select value from public.gm_config where key = 'sugu_site_url')
  );
end;
$$;

-- ───────────────────────────── Lecture (site Sugu Eden, clé publique) ─────────────────────────────

create or replace function public.sugu_product_json(p public.sugu_products, s public.sugu_shops)
returns jsonb
language sql
stable
set search_path = public
as $$
  select jsonb_build_object(
    'id', p.id, 'name', p.name, 'price', p.price, 'unit', p.unit, 'brand', p.brand, 'category', p.category,
    'in_stock', p.in_stock, 'stock', p.stock_shown, 'photo', p.photo_path,
    'currency', s.currency, 'decimals', s.decimals,
    'shop', jsonb_build_object('slug', s.slug, 'name', s.name, 'city', s.city, 'country', s.country)
  )
$$;

-- Recherche : texte (nom, marque, catégorie, description), pays, ville, catégorie, boutique.
create or replace function public.sugu_search(
  p_q text default null, p_country text default null, p_city text default null,
  p_category text default null, p_shop text default null, p_limit int default 24, p_offset int default 0)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with found as (
    select p, s
    from public.sugu_products p
    join public.sugu_shops s on s.store_id = p.store_id
    where s.active and s.visible_until > now()
      and (coalesce(p_q, '') = '' or p.search_text like '%' || public.sugu_norm(trim(p_q)) || '%')
      and (coalesce(p_country, '') = '' or s.country = upper(p_country))
      and (coalesce(p_city, '') = '' or public.sugu_norm(s.city) = public.sugu_norm(p_city))
      and (coalesce(p_category, '') = '' or public.sugu_norm(p.category) = public.sugu_norm(p_category))
      and (coalesce(p_shop, '') = '' or s.slug = lower(p_shop))
  )
  select jsonb_build_object(
    'total', (select count(*) from found),
    'items', coalesce((
      select jsonb_agg(public.sugu_product_json(f.p, f.s) order by (f.p).in_stock desc, (f.p).updated_at desc)
      from (select * from found order by (p).in_stock desc, (p).updated_at desc
            limit least(greatest(coalesce(p_limit, 24), 1), 60) offset greatest(coalesce(p_offset, 0), 0)) f
    ), '[]'::jsonb)
  )
$$;

-- Accueil : pays et villes où des boutiques publient, catégories, boutiques récentes.
create or replace function public.sugu_home(p_country text default null)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with shops as (
    select * from public.sugu_shops
    where active and visible_until > now() and products > 0
      and (coalesce(p_country, '') = '' or country = upper(p_country))
  )
  select jsonb_build_object(
    'countries', coalesce((select jsonb_agg(jsonb_build_object('code', c.country, 'shops', c.n) order by c.n desc)
                           from (select country, count(*) n from public.sugu_shops
                                 where active and visible_until > now() and products > 0 group by country) c), '[]'::jsonb),
    'cities', coalesce((select jsonb_agg(jsonb_build_object('city', c.city, 'shops', c.n) order by c.n desc, c.city)
                        from (select min(city) city, count(*) n from shops group by public.sugu_norm(city)) c), '[]'::jsonb),
    'categories', coalesce((select jsonb_agg(jsonb_build_object('category', c.category, 'products', c.n) order by c.n desc)
                            from (select min(p.category) category, count(*) n
                                  from public.sugu_products p join shops s on s.store_id = p.store_id
                                  where p.category <> '' group by public.sugu_norm(p.category)
                                  order by count(*) desc limit 30) c), '[]'::jsonb),
    'shops', coalesce((select jsonb_agg(jsonb_build_object('slug', s.slug, 'name', s.name, 'city', s.city,
                                                           'country', s.country, 'logo', s.logo_path, 'products', s.products,
                                                           'shop_type', s.shop_type)
                                        order by s.updated_at desc)
                       from (select * from shops order by updated_at desc limit 12) s), '[]'::jsonb)
  )
$$;

-- Fiche produit : le produit, sa boutique (contacts pour commander) et d'autres produits de la boutique.
create or replace function public.sugu_product(p_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'found', true,
    'product', public.sugu_product_json(p, s) || jsonb_build_object('description', p.description),
    'shop', jsonb_build_object('slug', s.slug, 'name', s.name, 'city', s.city, 'country', s.country, 'address', s.address,
                               'whatsapp', s.whatsapp, 'phone', s.phone, 'logo', s.logo_path),
    'more', coalesce((select jsonb_agg(public.sugu_product_json(o, s))
                      from (select * from public.sugu_products o
                            where o.store_id = p.store_id and o.id <> p.id
                            order by o.in_stock desc, o.updated_at desc limit 8) o), '[]'::jsonb)
  )
  from public.sugu_products p join public.sugu_shops s on s.store_id = p.store_id
  where p.id = p_id and s.active and s.visible_until > now()
  union all
  select jsonb_build_object('found', false)
  where not exists (select 1 from public.sugu_products p join public.sugu_shops s on s.store_id = p.store_id
                    where p.id = p_id and s.active and s.visible_until > now())
$$;

-- Page d'une boutique (ses produits : sugu_search avec p_shop).
create or replace function public.sugu_shop(p_slug text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select jsonb_build_object(
      'found', true, 'slug', s.slug, 'name', s.name, 'city', s.city, 'country', s.country, 'address', s.address,
      'whatsapp', s.whatsapp, 'phone', s.phone, 'description', s.description, 'logo', s.logo_path,
      'shop_type', s.shop_type, 'products', s.products, 'since', s.created_at)
    from public.sugu_shops s
    where s.slug = lower(trim(coalesce(p_slug, ''))) and s.active and s.visible_until > now()
  ), jsonb_build_object('found', false))
$$;

revoke all on function public.sugu_pc_store(text, text) from public, anon, authenticated;
grant execute on function public.sugu_pc_store(text, text) to service_role;
revoke all on function public.sugu_product_json(public.sugu_products, public.sugu_shops) from public, anon, authenticated;
revoke all on function public.sugu_products_search() from public, anon, authenticated;
revoke all on function public.sugu_search(text, text, text, text, text, int, int) from public;
revoke all on function public.sugu_home(text) from public;
revoke all on function public.sugu_product(uuid) from public;
revoke all on function public.sugu_shop(text) from public;
grant execute on function public.sugu_search(text, text, text, text, text, int, int) to anon, authenticated;
grant execute on function public.sugu_home(text) to anon, authenticated;
grant execute on function public.sugu_product(uuid) to anon, authenticated;
grant execute on function public.sugu_shop(text) to anon, authenticated;
grant execute on function public.sugu_norm(text) to anon, authenticated, service_role;
