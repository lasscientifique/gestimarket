-- ═══════════════════════════════════════════════════════════════════════════
-- Sugu Eden 0.31 : classement de référence (Catégorie → Section → Sous-catégorie), plusieurs photos par produit,
-- état, public visé et mots-clés. À appliquer après sugu_eden_0_30.sql, puis sugu_classement.sql (contenu).
-- Le classement est celui de GestiMarket (src-tauri/data/sugu_classement.txt) : aucun lien avec la base Sugu Eden v1.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.sugu_taxonomy (
  code     text primary key,
  parent   text,
  level    int  not null check (level between 1 and 3),
  name     text not null,
  sort     int  not null default 0,
  synonyms text not null default ''
);
create index if not exists sugu_taxonomy_parent_idx on public.sugu_taxonomy (parent, sort);
alter table public.sugu_taxonomy enable row level security;
revoke all on public.sugu_taxonomy from anon, authenticated;

alter table public.sugu_products add column if not exists code text;
alter table public.sugu_products add column if not exists condition text not null default 'new';
alter table public.sugu_products add column if not exists audience text;
alter table public.sugu_products add column if not exists keywords text not null default '';
alter table public.sugu_products add column if not exists photos jsonb not null default '[]'::jsonb;
create index if not exists sugu_products_code_idx on public.sugu_products (code text_pattern_ops);

-- Recherche : nom, marque, description, mots-clés, et les noms du classement (catégorie, section, sous-catégorie).
create or replace function public.sugu_products_search()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_path text := '';
begin
  if new.code is not null then
    select string_agg(t.name || ' ' || t.synonyms, ' ') into v_path
    from public.sugu_taxonomy t
    where new.code = t.code or new.code like t.code || '/%';
  end if;
  new.search_text := public.sugu_norm(concat_ws(' ', new.name, new.brand, new.category, new.description, new.keywords, v_path));
  new.updated_at := now();
  return new;
end;
$$;

-- Classement complet (GestiMarket le reprend quand sa version est plus ancienne ; le site l'affiche).
create or replace function public.sugu_taxonomy()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'version', coalesce((select value from public.gm_config where key = 'sugu_taxonomy_version'), '0')::int,
    'items', coalesce((select jsonb_agg(jsonb_build_object('code', code, 'parent', parent, 'level', level, 'name', name,
                                                           'synonyms', synonyms) order by sort) from public.sugu_taxonomy), '[]'::jsonb)
  )
$$;

-- Nombre de produits par ligne du classement (pays facultatif) : navigation du site.
create or replace function public.sugu_counts(p_country text default null)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_object_agg(t.code, t.n), '{}'::jsonb)
  from (
    select tx.code, count(*) n
    from public.sugu_products p
    join public.sugu_shops s on s.store_id = p.store_id
    join public.sugu_taxonomy tx on p.code = tx.code or p.code like tx.code || '/%'
    where s.active and s.visible_until > now()
      and (coalesce(p_country, '') = '' or s.country = upper(p_country))
    group by tx.code
  ) t
$$;

create or replace function public.sugu_product_json(p public.sugu_products, s public.sugu_shops)
returns jsonb
language sql
stable
set search_path = public
as $$
  select jsonb_build_object(
    'id', p.id, 'name', p.name, 'price', p.price, 'unit', p.unit, 'brand', p.brand, 'category', p.category,
    'code', p.code, 'condition', p.condition, 'audience', p.audience,
    'in_stock', p.in_stock, 'stock', p.stock_shown, 'photo', p.photo_path,
    'photos', coalesce((select jsonb_agg(e ->> 'path') from jsonb_array_elements(p.photos) e where e ->> 'path' is not null), '[]'::jsonb),
    'currency', s.currency, 'decimals', s.decimals,
    'shop', jsonb_build_object('slug', s.slug, 'name', s.name, 'city', s.city, 'country', s.country)
  )
$$;

drop function if exists public.sugu_search(text, text, text, text, text, int, int);
create or replace function public.sugu_search(
  p_q text default null, p_country text default null, p_city text default null,
  p_category text default null, p_shop text default null, p_limit int default 24, p_offset int default 0,
  p_code text default null, p_audience text default null)
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
      and (coalesce(p_code, '') = '' or p.code = p_code or p.code like p_code || '/%')
      and (coalesce(p_audience, '') = '' or p.audience = p_audience or p.audience = 'unisex')
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

-- Accueil : les catégories du classement qui ont des produits (au lieu des rayons de chaque boutique).
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
  ), counts as (
    select public.sugu_counts(p_country) c
  )
  select jsonb_build_object(
    'countries', coalesce((select jsonb_agg(jsonb_build_object('code', c.country, 'shops', c.n) order by c.n desc)
                           from (select country, count(*) n from public.sugu_shops
                                 where active and visible_until > now() and products > 0 group by country) c), '[]'::jsonb),
    'cities', coalesce((select jsonb_agg(jsonb_build_object('city', c.city, 'shops', c.n) order by c.n desc, c.city)
                        from (select min(city) city, count(*) n from shops group by public.sugu_norm(city)) c), '[]'::jsonb),
    'categories', coalesce((select jsonb_agg(jsonb_build_object('code', t.code, 'category', t.name,
                                                                'products', ((select c from counts) ->> t.code)::int) order by t.sort)
                            from public.sugu_taxonomy t
                            where t.level = 1 and (select c from counts) ? t.code), '[]'::jsonb),
    'shops', coalesce((select jsonb_agg(jsonb_build_object('slug', s.slug, 'name', s.name, 'city', s.city,
                                                           'country', s.country, 'logo', s.logo_path, 'products', s.products,
                                                           'shop_type', s.shop_type)
                                        order by s.updated_at desc)
                       from (select * from shops order by updated_at desc limit 12) s), '[]'::jsonb)
  )
$$;

revoke all on function public.sugu_taxonomy() from public;
revoke all on function public.sugu_counts(text) from public;
revoke all on function public.sugu_search(text, text, text, text, text, int, int, text, text) from public;
grant execute on function public.sugu_taxonomy() to anon, authenticated;
grant execute on function public.sugu_counts(text) to anon, authenticated;
grant execute on function public.sugu_search(text, text, text, text, text, int, int, text, text) to anon, authenticated;
