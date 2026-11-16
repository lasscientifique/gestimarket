-- ═══════════════════════════════════════════════════════════════════════════
-- Sugu Eden 0.32 : couleurs et tailles des produits (stock, prix, photo de chaque couleur) et liens de vidéos.
-- À appliquer après sugu_eden_0_31.sql. Fonction gm-sugu v3.
--   variants : [{ color, size, price, in_stock, stock, photo }] — color : code de la palette de GestiMarket
--              (src-tauri/data/couleurs.txt) ; size : valeur du type « axis » (size, shoe, age, storage, volume,
--              model) ; price : prix propre ou null ; photo : chemin d'une des photos du produit ou null.
--   videos   : liens https de TikTok, YouTube, Facebook ou Instagram (3 au plus).
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.sugu_products add column if not exists axis text;
alter table public.sugu_products add column if not exists variants jsonb not null default '[]'::jsonb;
alter table public.sugu_products add column if not exists videos jsonb not null default '[]'::jsonb;
create index if not exists sugu_products_variants_idx on public.sugu_products using gin (variants jsonb_path_ops);

-- Fiche courte (listes) : les couleurs proposées en plus, pour les pastilles des vignettes.
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
    'colors', coalesce((select jsonb_agg(distinct v ->> 'color') from jsonb_array_elements(p.variants) v where v ->> 'color' is not null), '[]'::jsonb),
    'variants_count', jsonb_array_length(p.variants),
    'currency', s.currency, 'decimals', s.decimals,
    'shop', jsonb_build_object('slug', s.slug, 'name', s.name, 'city', s.city, 'country', s.country)
  )
$$;

-- Fiche complète : description, couleurs et tailles, vidéos.
create or replace function public.sugu_product(p_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'found', true,
    'product', public.sugu_product_json(p, s)
               || jsonb_build_object('description', p.description, 'axis', p.axis, 'variants', p.variants, 'videos', p.videos),
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

-- Recherche : filtre par couleur (p_color) ; la réponse donne aussi les couleurs présentes dans les résultats.
drop function if exists public.sugu_search(text, text, text, text, text, int, int, text, text);
create or replace function public.sugu_search(
  p_q text default null, p_country text default null, p_city text default null,
  p_category text default null, p_shop text default null, p_limit int default 24, p_offset int default 0,
  p_code text default null, p_audience text default null, p_color text default null)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with matching as (
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
  ), found as (
    select * from matching m
    where coalesce(p_color, '') = '' or (m.p).variants @> jsonb_build_array(jsonb_build_object('color', p_color))
  )
  select jsonb_build_object(
    'total', (select count(*) from found),
    'colors', coalesce((select jsonb_agg(c.color order by c.n desc)
                        from (select v ->> 'color' color, count(distinct (m.p).id) n
                              from matching m, jsonb_array_elements((m.p).variants) v
                              where v ->> 'color' is not null group by 1) c), '[]'::jsonb),
    'items', coalesce((
      select jsonb_agg(public.sugu_product_json(f.p, f.s) order by (f.p).in_stock desc, (f.p).updated_at desc)
      from (select * from found order by (p).in_stock desc, (p).updated_at desc
            limit least(greatest(coalesce(p_limit, 24), 1), 60) offset greatest(coalesce(p_offset, 0), 0)) f
    ), '[]'::jsonb)
  )
$$;

revoke all on function public.sugu_product(uuid) from public;
revoke all on function public.sugu_search(text, text, text, text, text, int, int, text, text, text) from public;
grant execute on function public.sugu_product(uuid) to anon, authenticated;
grant execute on function public.sugu_search(text, text, text, text, text, int, int, text, text, text) to anon, authenticated;
