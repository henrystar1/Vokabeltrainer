
create or replace function public._ps(p_key text)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select value from public.print_settings where key = p_key), 0);
$$;

-- ----------------------------------------------------------------------------
-- 2. Farben, Katalog, Sperren, Bestellungen
-- ----------------------------------------------------------------------------

create table if not exists public.print_colors (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 30),
  hex text not null check (hex ~ '^#[0-9a-fA-F]{6}$'),
  extra_cents integer not null default 0 check (extra_cents between 0 and 10000),
  active boolean not null default true,
  sort integer not null default 100,
  created_at timestamptz not null default now()
);
alter table public.print_colors enable row level security;
revoke all on public.print_colors from anon, authenticated;

insert into public.print_colors (name, hex, sort)
select v.name, v.hex, v.sort
  from (values ('Schwarz', '#1f2430', 10), ('Weiß', '#f1f5f9', 20), ('Grau', '#8b93a1', 30), ('Rot', '#e11d48', 40),
               ('Orange', '#f97316', 50), ('Gelb', '#facc15', 60), ('Grün', '#22c55e', 70), ('Blau', '#2563eb', 80)) as v(name, hex, sort)
 where not exists (select 1 from public.print_colors);

create table if not exists public.print_products (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 60),
  description text not null default '' check (char_length(description) <= 600),
  price_cents integer not null check (price_cents between 0 and 100000),
  print_minutes integer not null default 60 check (print_minutes between 1 and 6000),
  text_prompt text check (text_prompt is null or char_length(btrim(text_prompt)) between 1 and 40),
  color_ids uuid[],
  image_path text check (image_path is null or image_path ~ '^shop/[A-Za-z0-9._-]+$'),
  model_path text check (model_path is null or model_path ~ '^shop/[A-Za-z0-9._-]+$'),
  active boolean not null default true,
  sort integer not null default 100,
  created_at timestamptz not null default now()
);
alter table public.print_products enable row level security;
revoke all on public.print_products from anon, authenticated;

create table if not exists public.print_bans (
  user_id uuid primary key references auth.users (id) on delete cascade,
  reason text not null default '' check (char_length(reason) <= 200),
  until timestamptz,
  created_at timestamptz not null default now()
);
alter table public.print_bans enable row level security;
revoke all on public.print_bans from anon, authenticated;

create table if not exists public.print_orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('shop', 'custom')),
  product_id uuid references public.print_products (id) on delete set null,
  title text not null check (char_length(btrim(title)) between 1 and 80),
  description text not null default '' check (char_length(description) <= 1000),
  color_id uuid references public.print_colors (id) on delete set null,
  color_name text,
  color_hex text,
  qty integer not null default 1 check (qty between 1 and 100),
  custom_text text check (custom_text is null or char_length(custom_text) <= 40),
  upload_path text,
  photo_paths text[] not null default '{}',
  volume_cm3 numeric check (volume_cm3 is null or volume_cm3 > 0),
  dims_mm jsonb,
  estimate_cents integer,
  offer_cents integer check (offer_cents is null or offer_cents between 0 and 100000),
  price_cents integer check (price_cents is null or price_cents between 0 and 1000000),
  rush_cents integer not null default 0 check (rush_cents >= 0),
  discount_percent integer not null default 0 check (discount_percent between 0 and 100),
  coins_spent integer not null default 0 check (coins_spent >= 0),
  status text not null default 'angefragt'
    check (status in ('angefragt', 'preis_vorgeschlagen', 'in_bearbeitung', 'druckt', 'lieferbereit', 'geliefert', 'abgelehnt', 'storniert')),
  admin_note text not null default '' check (char_length(admin_note) <= 500),
  print_minutes integer check (print_minutes is null or print_minutes between 1 and 100000),
  print_started_at timestamptz,
  progress_override smallint check (progress_override is null or progress_override between 0 and 100),
  breakdown jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  delivered_at timestamptz
);
create index if not exists print_orders_user_idx on public.print_orders (user_id, created_at desc);
create index if not exists print_orders_status_idx on public.print_orders (status, created_at);
alter table public.print_orders enable row level security;
revoke all on public.print_orders from anon, authenticated;

drop trigger if exists print_orders_touch on public.print_orders;
create trigger print_orders_touch before update on public.print_orders
  for each row execute function public.touch_updated_at();

-- ----------------------------------------------------------------------------
-- 3. Hilfsfunktionen
-- ----------------------------------------------------------------------------

create or replace function public._print_banned(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.print_bans b where b.user_id = p_user and (b.until is null or b.until > now()));
$$;

-- Endpreis in Cent: Artikelpreis abzüglich Rabatt plus Aufpreis „Beschleunigt“.
create or replace function public._print_final(p_price integer, p_discount integer, p_rush integer)
returns integer
language sql
immutable
as $$
  select case when p_price is null then null
              else round(p_price * (100 - coalesce(p_discount, 0)) / 100.0)::integer + coalesce(p_rush, 0) end;
$$;

-- Preis eines frei gedruckten Teils aus dem Volumen. Ergebnis: Rechnungszeilen, Gramm, Minuten, Summe in Cent.
create or replace function public._print_calc(p_volume numeric, p_qty integer, p_extra_cents integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_share numeric := public._ps('material_share') / 100.0;
  v_cm3 numeric := p_volume * p_qty * v_share;
  v_grams numeric := v_cm3 * public._ps('filament_density');
  v_speed numeric := greatest(public._ps('extrude_cm3_per_h'), 0.001);
  v_minutes integer := ceil(v_cm3 / v_speed * 60 + public._ps('setup_minutes') * 1)::integer;
  v_material numeric := v_grams / 1000.0 * public._ps('filament_eur_per_kg');
  v_power numeric := v_minutes / 60.0 * public._ps('power_watts') / 1000.0 * public._ps('eur_per_kwh');
  v_machine numeric := v_minutes / 60.0 * public._ps('machine_eur_per_h');
  v_effort numeric := public._ps('base_fee_eur') + (v_material + v_power + v_machine) * public._ps('margin_percent') / 100.0;
  v_color numeric := p_extra_cents * p_qty / 100.0;
  v_sum numeric := v_material + v_power + v_machine + v_effort + v_color;
  v_total integer := (ceil(greatest(v_sum, public._ps('min_price_eur')) * 10) * 10)::integer; -- auf 10 Cent aufrunden
  v_lines jsonb := '[]'::jsonb;
  v_items integer;
begin
  v_lines := v_lines || jsonb_build_array(jsonb_build_object('label', format('Material (%s g)', round(v_grams, 1)), 'cents', round(v_material * 100)::integer));
  v_lines := v_lines || jsonb_build_array(jsonb_build_object('label', format('Strom und Drucker (%s min)', v_minutes), 'cents', round((v_power + v_machine) * 100)::integer));
  v_lines := v_lines || jsonb_build_array(jsonb_build_object('label', 'Aufwand', 'cents', round(v_effort * 100)::integer));
  if p_extra_cents > 0 then
    v_lines := v_lines || jsonb_build_array(jsonb_build_object('label', 'Sonderfarbe', 'cents', round(v_color * 100)::integer));
  end if;
  select coalesce(sum((l->>'cents')::integer), 0) into v_items from jsonb_array_elements(v_lines) l;
  if v_total <> v_items then
    v_lines := v_lines || jsonb_build_array(jsonb_build_object('label', 'Rundung / Mindestpreis', 'cents', v_total - v_items));
  end if;
  return jsonb_build_object('lines', v_lines, 'item_cents', v_total, 'grams', round(v_grams, 1), 'minutes', v_minutes);
end;
$$;

-- Gemeinsame Preisberechnung für Vorschau und Bestellung (damit beides immer übereinstimmt).
create or replace function public._print_quote(
  p_kind text, p_product uuid, p_volume numeric, p_color uuid, p_qty integer, p_rush boolean, p_discount boolean)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_qty integer := coalesce(p_qty, 1);
  v_extra integer := 0;
  v_color public.print_colors;
  v_prod public.print_products;
  v_calc jsonb;
  v_item integer;
  v_lines jsonb;
  v_minutes integer;
  v_grams numeric := 0;
  v_rush integer := case when coalesce(p_rush, false) then round(public._ps('rush_fee_eur') * 100)::integer else 0 end;
  v_pct integer := case when coalesce(p_discount, false) then round(public._ps('discount_percent'))::integer else 0 end;
begin
  if p_kind not in ('shop', 'custom') then
    raise exception 'Unbekannte Art.' using errcode = '22023';
  end if;
  if v_qty < 1 or v_qty > public._ps('max_qty') then
    raise exception 'Die Stückzahl muss zwischen 1 und % liegen.', round(public._ps('max_qty')) using errcode = '22023';
  end if;
  if p_discount and v_pct <= 0 then
    raise exception 'Der Rabatt ist gerade nicht verfügbar.' using errcode = '22023';
  end if;

  if p_color is not null then
    select * into v_color from public.print_colors where id = p_color and active;
    if not found then
      raise exception 'Diese Farbe gibt es nicht (mehr).' using errcode = '22023';
    end if;
    v_extra := v_color.extra_cents;
  end if;

  if p_kind = 'shop' then
    select * into v_prod from public.print_products where id = p_product and active;
    if not found then
      raise exception 'Dieses Produkt gibt es nicht (mehr).' using errcode = 'P0002';
    end if;
    if v_prod.color_ids is not null and (p_color is null or not (p_color = any (v_prod.color_ids))) then
      raise exception 'Bitte eine der angebotenen Farben wählen.' using errcode = '22023';
    end if;
    if p_color is null and exists (select 1 from public.print_colors c where c.active and (v_prod.color_ids is null or c.id = any (v_prod.color_ids))) then
      raise exception 'Bitte eine Farbe wählen.' using errcode = '22023';
    end if;
    v_item := v_prod.price_cents * v_qty + v_extra * v_qty;
    v_lines := jsonb_build_array(jsonb_build_object('label', format('%s × %s', v_qty, v_prod.name), 'cents', v_prod.price_cents * v_qty));
    if v_extra > 0 then
      v_lines := v_lines || jsonb_build_array(jsonb_build_object('label', 'Sonderfarbe', 'cents', v_extra * v_qty));
    end if;
    v_minutes := v_prod.print_minutes * v_qty;
  else
    if p_volume is null then
      v_item := null; v_lines := '[]'::jsonb; v_minutes := null;
    else
      if p_volume <= 0 or p_volume > public._ps('max_volume_cm3') then
        raise exception 'Das Teil ist zu groß oder zu klein (höchstens % cm³).', round(public._ps('max_volume_cm3')) using errcode = '22023';
      end if;
      v_calc := public._print_calc(p_volume, v_qty, v_extra);
      v_item := (v_calc->>'item_cents')::integer;
      v_lines := v_calc->'lines';
      v_minutes := (v_calc->>'minutes')::integer;
      v_grams := (v_calc->>'grams')::numeric;
    end if;
  end if;

  return jsonb_build_object(
    'lines', v_lines,
    'item_cents', v_item,
    'minutes', v_minutes,
    'grams', v_grams,
    'rush_cents', v_rush,
    'discount_percent', v_pct,
    'discount_cents', case when v_item is null then null else v_item - round(v_item * (100 - v_pct) / 100.0)::integer end,
    'final_cents', public._print_final(v_item, v_pct, v_rush));
end;
$$;

create or replace function public._print_notify(p_user uuid, p_body text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.user_messages (user_id, from_id, body)
  values (p_user, (select auth.uid()), left(p_body, 1000));
end;
$$;

-- Bestellung als JSON inklusive Endpreis und Serverzeit (für den Fortschrittsbalken).
create or replace function public._print_order_json(o public.print_orders)
returns jsonb
language sql
stable
as $$
  select to_jsonb(o) || jsonb_build_object(
    'final_cents', public._print_final(coalesce(o.price_cents, o.estimate_cents), o.discount_percent, o.rush_cents),
    'server_now', now());
$$;

-- Coins einer Bestellung zurückgeben (bei Ablehnung/Abbruch), nur einmal.
create or replace function public._print_refund(p_order uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  o public.print_orders;
begin
  select * into o from public.print_orders where id = p_order for update;
  if found and o.coins_spent > 0 then
    perform public._grant_koins(o.user_id, o.coins_spent, 'print_refund', o.id::text);
    update public.print_orders set coins_spent = 0 where id = o.id;
  end if;
end;
$$;

-- ----------------------------------------------------------------------------
-- 4. Kunden: Katalog, Info, Vorschau, Bestellen
-- ----------------------------------------------------------------------------

create or replace function public.print_get_products()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', p.id, 'name', p.name, 'description', p.description, 'price_cents', p.price_cents,
           'text_prompt', p.text_prompt, 'image_path', p.image_path, 'model_path', p.model_path,
           'colors', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'hex', c.hex, 'extra_cents', c.extra_cents)
                                                order by c.sort, c.name), '[]'::jsonb)
                        from public.print_colors c
                       where c.active and (p.color_ids is null or c.id = any (p.color_ids)))
         ) order by p.sort, p.name), '[]'::jsonb)
    from public.print_products p
   where p.active and (select auth.uid()) is not null;
$$;

create or replace function public.print_get_info()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  v_ban public.print_bans;
begin
  if v_me is null then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  select * into v_ban from public.print_bans b where b.user_id = v_me and (b.until is null or b.until > now());
  return jsonb_build_object(
    'open', public._ps('orders_open') >= 1,
    'rush_cents', round(public._ps('rush_fee_eur') * 100)::integer,
    'discount_coins', round(public._ps('discount_coins'))::integer,
    'discount_percent', round(public._ps('discount_percent'))::integer,
    'max_qty', round(public._ps('max_qty'))::integer,
    'max_volume_cm3', public._ps('max_volume_cm3'),
    'max_open_requests', round(public._ps('max_open_requests'))::integer,
    'open_requests', (select count(*) from public.print_orders o where o.user_id = v_me and o.status in ('angefragt', 'preis_vorgeschlagen')),
    'banned', v_ban.user_id is not null,
    'ban_reason', v_ban.reason,
    'ban_until', v_ban.until,
    'colors', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'hex', c.hex, 'extra_cents', c.extra_cents)
                                         order by c.sort, c.name), '[]'::jsonb)
                 from public.print_colors c where c.active));
end;
$$;

create or replace function public.print_quote(
  p_kind text, p_product uuid, p_volume numeric, p_color uuid, p_qty integer, p_rush boolean, p_discount boolean)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  return public._print_quote(p_kind, p_product, p_volume, p_color, p_qty, p_rush, p_discount);
end;
$$;

create or replace function public.print_create_order(
  p_kind text, p_product uuid, p_color uuid, p_qty integer, p_custom_text text, p_title text, p_description text,
  p_upload_path text, p_photo_paths text[], p_volume numeric, p_dims jsonb, p_offer_cents integer,
  p_rush boolean, p_discount boolean)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  v_id uuid := gen_random_uuid();
  v_quote jsonb;
  v_prod public.print_products;
  v_color public.print_colors;
  v_title text;
  v_desc text := btrim(coalesce(p_description, ''));
  v_text text := nullif(btrim(coalesce(p_custom_text, '')), '');
  v_photos text[] := coalesce(p_photo_paths, '{}');
  v_ph text;
  v_item integer;
  v_cost integer := 0;
  v_pct integer;
begin
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  if public._print_banned(v_me) then
    raise exception 'Du kannst im Moment nichts bestellen.' using errcode = '42501';
  end if;
  if public._ps('orders_open') < 1 then
    raise exception 'Bestellungen sind gerade geschlossen.' using errcode = '55000';
  end if;
  if (select count(*) from public.print_orders o where o.user_id = v_me and o.status in ('angefragt', 'preis_vorgeschlagen')) >= public._ps('max_open_requests') then
    raise exception 'Du hast schon genug offene Anfragen. Warte bitte auf eine Antwort.' using errcode = '53400';
  end if;
  if (select count(*) from public.print_orders o where o.user_id = v_me and o.created_at > now() - interval '1 day') >= public._ps('max_orders_per_day') then
    raise exception 'Das waren heute genug Bestellungen. Versuch es morgen wieder.' using errcode = '53400';
  end if;
  if char_length(v_desc) > 1000 then
    raise exception 'Die Beschreibung ist zu lang (höchstens 1000 Zeichen).' using errcode = '22023';
  end if;
  if v_text is not null and char_length(v_text) > 40 then
    raise exception 'Der Text ist zu lang (höchstens 40 Zeichen).' using errcode = '22023';
  end if;
  if p_offer_cents is not null and (p_offer_cents < 0 or p_offer_cents > 100000) then
    raise exception 'Ungültiger Preisvorschlag.' using errcode = '22023';
  end if;
  if cardinality(v_photos) > 5 then
    raise exception 'Höchstens 5 Fotos.' using errcode = '22023';
  end if;
  foreach v_ph in array v_photos loop
    if v_ph !~* ('^' || v_me::text || '/[A-Za-z0-9._-]+\.(jpe?g|png|webp)$') then
      raise exception 'Ungültiges Foto.' using errcode = '22023';
    end if;
  end loop;
  if p_upload_path is not null and p_upload_path !~* ('^' || v_me::text || '/[A-Za-z0-9._-]+\.stl$') then
    raise exception 'Ungültige STL-Datei.' using errcode = '22023';
  end if;
  if p_dims is not null and (jsonb_typeof(p_dims) <> 'object' or char_length(p_dims::text) > 200) then
    raise exception 'Ungültige Maße.' using errcode = '22023';
  end if;

  if p_kind = 'shop' then
    select * into v_prod from public.print_products where id = p_product and active;
    if not found then
      raise exception 'Dieses Produkt gibt es nicht (mehr).' using errcode = 'P0002';
    end if;
    if v_prod.text_prompt is not null and v_text is null then
      raise exception 'Bitte ausfüllen: %', v_prod.text_prompt using errcode = '22023';
    end if;
    if v_prod.text_prompt is null then v_text := null; end if;
    v_title := v_prod.name;
    p_upload_path := null; v_photos := '{}'; p_volume := null; p_dims := null;
  else
    v_title := btrim(coalesce(p_title, ''));
    if char_length(v_title) not between 3 and 80 then
      raise exception 'Der Titel braucht 3 bis 80 Zeichen.' using errcode = '22023';
    end if;
    if char_length(v_desc) < 10 then
      raise exception 'Bitte beschreibe kurz, was du brauchst (mindestens 10 Zeichen).' using errcode = '22023';
    end if;
    if p_upload_path is null then p_volume := null; p_dims := null; end if;
    v_text := null;
  end if;

  v_quote := public._print_quote(p_kind, p_product, p_volume, p_color, p_qty, p_rush, p_discount);
  if p_color is not null then
    select * into v_color from public.print_colors where id = p_color;
  end if;
  v_item := (v_quote->>'item_cents')::integer;
  v_pct := (v_quote->>'discount_percent')::integer;

  if coalesce(p_discount, false) then
    v_cost := round(public._ps('discount_coins'))::integer;
    perform public._grant_koins(v_me, -v_cost, 'print_discount', v_id::text);
  end if;

  insert into public.print_orders (
    id, user_id, kind, product_id, title, description, color_id, color_name, color_hex, qty, custom_text,
    upload_path, photo_paths, volume_cm3, dims_mm, estimate_cents, offer_cents, price_cents, rush_cents,
    discount_percent, coins_spent, status, print_minutes, breakdown)
  values (
    v_id, v_me, p_kind, case when p_kind = 'shop' then p_product end, v_title, left(v_desc, 1000), p_color,
    v_color.name, v_color.hex, coalesce(p_qty, 1), v_text,
    p_upload_path, v_photos, p_volume, p_dims,
    case when p_kind = 'custom' then v_item end,
    p_offer_cents,
    case when p_kind = 'shop' then v_item end,
    (v_quote->>'rush_cents')::integer, v_pct, v_cost, 'angefragt',
    (v_quote->>'minutes')::integer, v_quote->'lines');
  return v_id;
end;
$$;

create or replace function public.print_my_orders()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(public._print_order_json(o) order by o.created_at desc), '[]'::jsonb)
    from public.print_orders o
   where o.user_id = (select auth.uid());
$$;

-- Antwort auf ein Gegenangebot: annehmen, selbst etwas anderes vorschlagen oder ablehnen.
create or replace function public.print_respond(p_id uuid, p_action text, p_offer_cents integer default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  o public.print_orders;
begin
  select * into o from public.print_orders where id = p_id and user_id = (select auth.uid()) for update;
  if not found then
    raise exception 'Bestellung nicht gefunden.' using errcode = 'P0002';
  end if;
  if o.status <> 'preis_vorgeschlagen' then
    raise exception 'Hier gibt es gerade nichts zu beantworten.' using errcode = '55000';
  end if;
  if p_action = 'accept' then
    update public.print_orders set status = 'in_bearbeitung' where id = o.id;
  elsif p_action = 'counter' then
    if public._print_banned(o.user_id) then
      raise exception 'Du kannst im Moment nichts bestellen.' using errcode = '42501';
    end if;
    if p_offer_cents is null or p_offer_cents < 0 or p_offer_cents > 100000 then
      raise exception 'Ungültiger Preisvorschlag.' using errcode = '22023';
    end if;
    update public.print_orders set offer_cents = p_offer_cents, status = 'angefragt' where id = o.id;
  elsif p_action = 'decline' then
    perform public._print_refund(o.id);
    update public.print_orders set status = 'storniert' where id = o.id;
  else
    raise exception 'Unbekannte Aktion.' using errcode = '22023';
  end if;
end;
$$;

create or replace function public.print_cancel(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  o public.print_orders;
begin
  select * into o from public.print_orders where id = p_id and user_id = (select auth.uid()) for update;
  if not found then
    raise exception 'Bestellung nicht gefunden.' using errcode = 'P0002';
  end if;
  if o.status not in ('angefragt', 'preis_vorgeschlagen', 'in_bearbeitung') then
    raise exception 'Diese Bestellung lässt sich nicht mehr abbrechen.' using errcode = '55000';
  end if;
  perform public._print_refund(o.id);
  update public.print_orders set status = 'storniert' where id = o.id;
end;
$$;

-- ----------------------------------------------------------------------------
-- 5. Admin: Warteschlange und Bearbeitung
-- ----------------------------------------------------------------------------

create or replace function public.admin_print_orders(p_scope text default 'open')
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public._require_admin();
  return coalesce((
    select jsonb_agg(public._print_order_json(x.o) || jsonb_build_object(
             'user_name', x.name, 'user_banned', public._print_banned((x.o).user_id))
           order by x.rank, x.rush desc, (case when p_scope = 'done' then x.upd end) desc nulls last, x.created)
      from (
        select o, p.display_name as name,
               case o.status when 'angefragt' then 1 when 'preis_vorgeschlagen' then 4 when 'druckt' then 2
                             when 'in_bearbeitung' then 3 when 'lieferbereit' then 5 else 9 end as rank,
               o.rush_cents > 0 as rush, o.created_at as created, o.updated_at as upd
          from public.print_orders o
          join public.profiles p on p.id = o.user_id
         where case when p_scope = 'done' then o.status in ('geliefert', 'abgelehnt', 'storniert')
                    else o.status not in ('geliefert', 'abgelehnt', 'storniert') end
         order by case when p_scope = 'done' then o.updated_at end desc nulls last, o.created_at
         limit 300
      ) x
  ), '[]'::jsonb);
end;
$$;

create or replace function public.admin_print_counts()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public._require_admin();
  return jsonb_build_object(
    'angefragt', (select count(*) from public.print_orders where status = 'angefragt'),
    'preis_vorgeschlagen', (select count(*) from public.print_orders where status = 'preis_vorgeschlagen'),
    'in_bearbeitung', (select count(*) from public.print_orders where status = 'in_bearbeitung'),
    'druckt', (select count(*) from public.print_orders where status = 'druckt'),
    'lieferbereit', (select count(*) from public.print_orders where status = 'lieferbereit'),
    'todo', (select count(*) from public.print_orders where status in ('angefragt', 'in_bearbeitung', 'druckt')));
end;
$$;

-- Eine Aktion auf eine Bestellung:
--  accept   Anfrage annehmen (Preis = Wunschpreis/Richtpreis → sofort in Bearbeitung, sonst Gegenangebot)
--  counter  Gegenangebot machen (immer)
--  reject   ablehnen (Coins zurück)
--  start    Druck starten (Zeit in Minuten)
--  progress Fortschritt von Hand setzen (null = automatisch nach Zeit)
--  ready    fertig gedruckt, abholbereit
--  delivered übergeben
--  back     zurück in „In Bearbeitung“
--  note     nur Notiz
create or replace function public.admin_print_action(
  p_id uuid, p_action text, p_price_cents integer default null, p_minutes integer default null,
  p_note text default null, p_progress integer default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  o public.print_orders;
  v_note text;
  v_price integer;
  v_status text;
begin
  perform public._require_admin();
  select * into o from public.print_orders where id = p_id for update;
  if not found then
    raise exception 'Bestellung nicht gefunden.' using errcode = 'P0002';
  end if;
  v_note := case when p_note is null then o.admin_note else left(btrim(p_note), 500) end;
  if p_minutes is not null and (p_minutes < 1 or p_minutes > 100000) then
    raise exception 'Ungültige Druckzeit.' using errcode = '22023';
  end if;

  if p_action in ('accept', 'counter') then
    if o.status not in ('angefragt', 'preis_vorgeschlagen') then
      raise exception 'Diese Anfrage ist schon bearbeitet.' using errcode = '55000';
    end if;
    v_price := coalesce(p_price_cents, o.price_cents, o.estimate_cents);
    if v_price is null or v_price < 0 or v_price > 1000000 then
      raise exception 'Bitte einen Preis angeben.' using errcode = '22023';
    end if;
    -- Der Kunde hat diesen Preis schon gesehen oder selbst vorgeschlagen → keine Rückfrage nötig.
    if p_action = 'accept' and o.status = 'angefragt'
       and (o.kind = 'shop' or v_price = o.estimate_cents or v_price = o.offer_cents) then
      v_status := 'in_bearbeitung';
    else
      v_status := 'preis_vorgeschlagen';
    end if;
    update public.print_orders
       set price_cents = v_price, status = v_status, admin_note = v_note,
           print_minutes = coalesce(p_minutes, print_minutes, 60)
     where id = o.id;
    if v_status = 'in_bearbeitung' then
      perform public._print_notify(o.user_id, format('Dein Druckauftrag „%s“ wurde angenommen.', o.title));
    else
      perform public._print_notify(o.user_id, format('Zu deinem Druckauftrag „%s“ gibt es einen Preisvorschlag. Schau im 3D-Druck-Shop unter „Meine Bestellungen“ nach.', o.title));
    end if;

  elsif p_action = 'reject' then
    if o.status in ('geliefert', 'abgelehnt', 'storniert') then
      raise exception 'Diese Bestellung ist schon abgeschlossen.' using errcode = '55000';
    end if;
    perform public._print_refund(o.id);
    update public.print_orders set status = 'abgelehnt', admin_note = v_note, print_started_at = null where id = o.id;
    perform public._print_notify(o.user_id, format('Dein Druckauftrag „%s“ wurde abgelehnt.%s', o.title,
      case when v_note <> '' then ' Grund: ' || v_note else '' end));

  elsif p_action = 'start' then
    if o.status <> 'in_bearbeitung' then
      raise exception 'Nur Aufträge „In Bearbeitung“ lassen sich starten.' using errcode = '55000';
    end if;
    update public.print_orders
       set status = 'druckt', print_started_at = now(), progress_override = null, admin_note = v_note,
           print_minutes = coalesce(p_minutes, print_minutes, 60)
     where id = o.id;
    perform public._print_notify(o.user_id, format('Dein Druckauftrag „%s“ wird jetzt gedruckt. Den Fortschritt siehst du im 3D-Druck-Shop.', o.title));

  elsif p_action = 'progress' then
    if o.status <> 'druckt' then
      raise exception 'Der Fortschritt lässt sich nur beim Drucken setzen.' using errcode = '55000';
    end if;
    if p_progress is not null and (p_progress < 0 or p_progress > 100) then
      raise exception 'Der Fortschritt liegt zwischen 0 und 100.' using errcode = '22023';
    end if;
    update public.print_orders set progress_override = p_progress where id = o.id;

  elsif p_action = 'ready' then
    if o.status not in ('druckt', 'in_bearbeitung') then
      raise exception 'Dieser Auftrag kann nicht fertig gemeldet werden.' using errcode = '55000';
    end if;
    update public.print_orders set status = 'lieferbereit', admin_note = v_note where id = o.id;
    perform public._print_notify(o.user_id, format('Dein Druckauftrag „%s“ ist fertig und liegt zur Übergabe bereit.', o.title));

  elsif p_action = 'delivered' then
    if o.status <> 'lieferbereit' then
      raise exception 'Nur fertige Aufträge lassen sich als übergeben markieren.' using errcode = '55000';
    end if;
    update public.print_orders set status = 'geliefert', delivered_at = now(), admin_note = v_note where id = o.id;

  elsif p_action = 'back' then
    if o.status not in ('druckt', 'lieferbereit') then
      raise exception 'Nur laufende oder fertige Aufträge gehen zurück.' using errcode = '55000';
    end if;
    update public.print_orders set status = 'in_bearbeitung', print_started_at = null, progress_override = null where id = o.id;

  elsif p_action = 'note' then
    update public.print_orders set admin_note = v_note where id = o.id;

  else
    raise exception 'Unbekannte Aktion.' using errcode = '22023';
  end if;

  return public._print_order_json((select x from public.print_orders x where x.id = o.id));
end;
$$;

-- Abgeschlossene Bestellung löschen; gibt die Dateipfade zurück, damit die App sie aus dem Speicher entfernt.
create or replace function public.admin_print_delete_order(p_id uuid)
returns text[]
language plpgsql
security definer
set search_path = public
as $$
declare
  o public.print_orders;
begin
  perform public._require_admin();
  select * into o from public.print_orders where id = p_id for update;
  if not found then
    raise exception 'Bestellung nicht gefunden.' using errcode = 'P0002';
  end if;
  if o.status not in ('geliefert', 'abgelehnt', 'storniert') then
    raise exception 'Nur abgeschlossene Bestellungen lassen sich löschen.' using errcode = '55000';
  end if;
  -- Übergebene Bestellungen zählen weiter zum Verdienst, auch wenn sie gelöscht werden.
  if o.status = 'geliefert' then
    update public.print_settings
       set value = value + coalesce(public._print_final(coalesce(o.price_cents, o.estimate_cents), o.discount_percent, o.rush_cents), 0) / 100.0
     where key = 'goal_offset_eur';
  end if;
  delete from public.print_orders where id = o.id;
  return array_remove(array[o.upload_path] || o.photo_paths, null);
end;
$$;

-- ----------------------------------------------------------------------------
-- 6. Admin: Katalog, Farben, Einstellungen, Sperren
-- ----------------------------------------------------------------------------

create or replace function public.admin_print_list_products()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public._require_admin();
  return coalesce((select jsonb_agg(to_jsonb(p) order by p.sort, p.name) from public.print_products p), '[]'::jsonb);
end;
$$;

create or replace function public.admin_print_save_product(
  p_id uuid, p_name text, p_description text, p_price_cents integer, p_print_minutes integer,
  p_text_prompt text, p_color_ids uuid[], p_image_path text, p_model_path text, p_active boolean, p_sort integer)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid := coalesce(p_id, gen_random_uuid());
  v_prompt text := nullif(btrim(coalesce(p_text_prompt, '')), '');
begin
  perform public._require_admin();
  if char_length(btrim(coalesce(p_name, ''))) not between 1 and 60 then
    raise exception 'Der Name braucht 1 bis 60 Zeichen.' using errcode = '22023';
  end if;
  if p_price_cents is null or p_price_cents < 0 or p_price_cents > 100000 then
    raise exception 'Ungültiger Preis.' using errcode = '22023';
  end if;
  if p_print_minutes is null or p_print_minutes < 1 or p_print_minutes > 6000 then
    raise exception 'Die Druckzeit muss zwischen 1 und 6000 Minuten liegen.' using errcode = '22023';
  end if;
  if p_color_ids is not null and cardinality(p_color_ids) = 0 then
    p_color_ids := null;
  end if;
  if p_id is null then
    insert into public.print_products (id, name, description, price_cents, print_minutes, text_prompt, color_ids, image_path, model_path, active, sort)
    values (v_id, btrim(p_name), left(btrim(coalesce(p_description, '')), 600), p_price_cents, p_print_minutes, v_prompt,
            p_color_ids, p_image_path, p_model_path, coalesce(p_active, true), coalesce(p_sort, 100));
  else
    update public.print_products
       set name = btrim(p_name), description = left(btrim(coalesce(p_description, '')), 600), price_cents = p_price_cents,
           print_minutes = p_print_minutes, text_prompt = v_prompt, color_ids = p_color_ids,
           image_path = p_image_path, model_path = p_model_path, active = coalesce(p_active, true), sort = coalesce(p_sort, 100)
     where id = p_id;
    if not found then
      raise exception 'Produkt nicht gefunden.' using errcode = 'P0002';
    end if;
  end if;
  return v_id;
end;
$$;

create or replace function public.admin_print_delete_product(p_id uuid)
returns text[]
language plpgsql
security definer
set search_path = public
as $$
declare
  p public.print_products;
begin
  perform public._require_admin();
  select * into p from public.print_products where id = p_id;
  if not found then
    raise exception 'Produkt nicht gefunden.' using errcode = 'P0002';
  end if;
  delete from public.print_products where id = p.id;
  return array_remove(array[p.image_path, p.model_path], null);
end;
$$;

create or replace function public.admin_print_list_colors()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public._require_admin();
  return coalesce((select jsonb_agg(to_jsonb(c) order by c.sort, c.name) from public.print_colors c), '[]'::jsonb);
end;
$$;

create or replace function public.admin_print_save_color(
  p_id uuid, p_name text, p_hex text, p_extra_cents integer, p_active boolean, p_sort integer)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid := coalesce(p_id, gen_random_uuid());
begin
  perform public._require_admin();
  if char_length(btrim(coalesce(p_name, ''))) not between 1 and 30 then
    raise exception 'Der Name braucht 1 bis 30 Zeichen.' using errcode = '22023';
  end if;
  if p_hex is null or p_hex !~ '^#[0-9a-fA-F]{6}$' then
    raise exception 'Die Farbe muss wie #22d3ee aussehen.' using errcode = '22023';
  end if;
  if p_extra_cents is null or p_extra_cents < 0 or p_extra_cents > 10000 then
    raise exception 'Ungültiger Aufpreis.' using errcode = '22023';
  end if;
  if p_id is null then
    insert into public.print_colors (id, name, hex, extra_cents, active, sort)
    values (v_id, btrim(p_name), lower(p_hex), p_extra_cents, coalesce(p_active, true), coalesce(p_sort, 100));
  else
    update public.print_colors
       set name = btrim(p_name), hex = lower(p_hex), extra_cents = p_extra_cents,
           active = coalesce(p_active, true), sort = coalesce(p_sort, 100)
     where id = p_id;
    if not found then
      raise exception 'Farbe nicht gefunden.' using errcode = 'P0002';
    end if;
  end if;
  return v_id;
end;
$$;

create or replace function public.admin_print_delete_color(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._require_admin();
  update public.print_products set color_ids = array_remove(color_ids, p_id) where p_id = any (color_ids);
  update public.print_products set color_ids = null where color_ids is not null and cardinality(color_ids) = 0;
  delete from public.print_colors where id = p_id;
end;
$$;

create or replace function public.admin_print_get_settings()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public._require_admin();
  return coalesce((select jsonb_agg(to_jsonb(s) order by s.sort) from public.print_settings s), '[]'::jsonb);
end;
$$;

create or replace function public.admin_print_set_setting(p_key text, p_value numeric)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.print_settings;
begin
  perform public._require_admin();
  select * into s from public.print_settings where key = p_key;
  if not found then
    raise exception 'Unbekannte Einstellung.' using errcode = 'P0002';
  end if;
  if p_value is null or p_value < s.min_value or p_value > s.max_value then
    raise exception '% muss zwischen % und % liegen.', s.label, s.min_value, s.max_value using errcode = '22023';
  end if;
  update public.print_settings set value = p_value where key = p_key;
end;
$$;

-- Spammer sperren; offene Anfragen werden dabei abgelehnt (Coins zurück).
create or replace function public.admin_print_ban(p_user uuid, p_reason text default '', p_days integer default null, p_reject_open boolean default true)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
begin
  perform public._require_admin();
  if p_user = (select auth.uid()) or exists (select 1 from public.profiles where id = p_user and role = 'admin') then
    raise exception 'Admins lassen sich nicht sperren.' using errcode = '22023';
  end if;
  if p_days is not null and (p_days < 1 or p_days > 3650) then
    raise exception 'Ungültige Dauer.' using errcode = '22023';
  end if;
  insert into public.print_bans (user_id, reason, until)
  values (p_user, left(btrim(coalesce(p_reason, '')), 200), case when p_days is null then null else now() + make_interval(days => p_days) end)
  on conflict (user_id) do update set reason = excluded.reason, until = excluded.until, created_at = now();
  if coalesce(p_reject_open, true) then
    for r in select id from public.print_orders where user_id = p_user and status in ('angefragt', 'preis_vorgeschlagen') loop
      perform public._print_refund(r.id);
      update public.print_orders set status = 'abgelehnt', admin_note = 'Gesperrt' where id = r.id;
    end loop;
  end if;
end;
$$;

create or replace function public.admin_print_unban(p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._require_admin();
  delete from public.print_bans where user_id = p_user;
end;
$$;

create or replace function public.admin_print_list_bans()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public._require_admin();
  return coalesce((
    select jsonb_agg(jsonb_build_object('user_id', b.user_id, 'user_name', p.display_name, 'reason', b.reason,
                                        'until', b.until, 'active', (b.until is null or b.until > now()), 'created_at', b.created_at)
                     order by b.created_at desc)
      from public.print_bans b join public.profiles p on p.id = b.user_id), '[]'::jsonb);
end;
$$;

-- ----------------------------------------------------------------------------
-- 6b. Verdienst-Anzeige (Umsatz der übergebenen Bestellungen im Verhältnis zum Ziel)
-- ----------------------------------------------------------------------------

create or replace function public._print_delivered_cents()
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(public._print_final(coalesce(o.price_cents, o.estimate_cents), o.discount_percent, o.rush_cents)), 0)::bigint
    from public.print_orders o where o.status = 'geliefert';
$$;

create or replace function public.print_get_goal()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_goal integer := round(public._ps('goal_eur') * 100)::integer;
  v_earned bigint;
begin
  if (select auth.uid()) is null then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  if public._ps('goal_visible') < 1 and not public.is_admin() then
    return jsonb_build_object('visible', false);
  end if;
  v_earned := public._print_delivered_cents() + round(public._ps('goal_offset_eur') * 100);
  return jsonb_build_object(
    'visible', public._ps('goal_visible') >= 1,
    'goal_cents', v_goal,
    'earned_cents', greatest(v_earned, 0),
    'percent', case when v_goal > 0 then round(greatest(v_earned, 0) * 100.0 / v_goal, 1) else 0 end);
end;
$$;

-- Neues Ziel beginnen: der bisherige Verdienst wird auf 0 gesetzt.
create or replace function public.admin_print_goal_reset()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._require_admin();
  update public.print_settings set value = -(public._print_delivered_cents() / 100.0) where key = 'goal_offset_eur';
end;
$$;

-- ----------------------------------------------------------------------------
-- 7. Dateiablage (Supabase Storage): Bucket „print-files“, privat
--    Kunden:  <eigene-id>/<datei>.stl|jpg|png|webp   Shop (Admin): shop/<datei>
-- ----------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit)
values ('print-files', 'print-files', false, 26214400)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;

-- Zählt die Dateien einer Person (als Funktion, weil eine Regel sich nicht selbst abfragen darf).
create or replace function public._print_files_count(p_user uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::integer from storage.objects o
   where o.bucket_id = 'print-files' and o.name like p_user::text || '/%';
$$;

-- Hängt die Datei an einer Bestellung? Dann darf der Besitzer sie nicht löschen.
create or replace function public._print_file_in_use(p_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.print_orders o where o.upload_path = p_name or p_name = any (o.photo_paths));
$$;

drop policy if exists print_files_select on storage.objects;
create policy print_files_select on storage.objects for select to authenticated
  using (bucket_id = 'print-files'
         and ((storage.foldername(name))[1] = (select auth.uid())::text
              or (storage.foldername(name))[1] = 'shop'
              or public.is_admin()));

drop policy if exists print_files_insert_own on storage.objects;
create policy print_files_insert_own on storage.objects for insert to authenticated
  with check (bucket_id = 'print-files'
              and (storage.foldername(name))[1] = (select auth.uid())::text
              and name ~* '\.(stl|jpe?g|png|webp)$'
              and not public._print_banned((select auth.uid()))
              and public._print_files_count((select auth.uid())) < 40);

drop policy if exists print_files_insert_shop on storage.objects;
create policy print_files_insert_shop on storage.objects for insert to authenticated
  with check (bucket_id = 'print-files'
              and (storage.foldername(name))[1] = 'shop'
              and name ~* '\.(stl|jpe?g|png|webp)$'
              and public.is_admin());

drop policy if exists print_files_delete on storage.objects;
create policy print_files_delete on storage.objects for delete to authenticated
  using (bucket_id = 'print-files'
         and (public.is_admin()
              or ((storage.foldername(name))[1] = (select auth.uid())::text
                  and not public._print_file_in_use(name))));

-- ----------------------------------------------------------------------------
-- 8. Rechte
-- ----------------------------------------------------------------------------

do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig, p.proname
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and (p.proname like 'print\_%' or p.proname like 'admin\_print\_%' or p.proname like '\_print\_%' or p.proname = '_ps')
  loop
    if r.proname like '\_%' and r.proname not in ('_print_banned', '_print_files_count', '_print_file_in_use') then
      execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    else
      execute format('revoke all on function %s from public, anon', r.sig);
      execute format('grant execute on function %s to authenticated', r.sig);
    end if;
  end loop;
end;
$$;


-- ===== 0019_board_mods_repeat_learn_coins.sql =====
-- ============================================================================
-- 0019: Schwarzes Brett auch für Mods, Option „falsche Vokabeln so lange wiederholen,
-- bis sie stimmen“, Coins auch fürs Wiederholen bekannter Vokabeln.
-- Wiederholbar. Nach 0018 ausführen.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Schwarzes Brett: alle Mods (Mod, Alphamod, Admin) dürfen schreiben und löschen
-- ----------------------------------------------------------------------------

create or replace function public.admin_save_board_post(p_id uuid, p_title text, p_body text, p_status text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not public.is_staff() then
    raise exception 'Nur für Mods und Admins.' using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(p_title, ''))) not between 1 and 120 then
    raise exception 'Der Titel braucht 1 bis 120 Zeichen.' using errcode = '22023';
  end if;
  if p_status not in ('planned', 'doing', 'done') then
    raise exception 'Ungültiger Status.' using errcode = '22023';
  end if;
  if p_id is null then
    insert into public.board_posts (title, body, status) values (btrim(p_title), left(coalesce(p_body, ''), 2000), p_status)
    returning id into v_id;
  else
    update public.board_posts
       set title = btrim(p_title), body = left(coalesce(p_body, ''), 2000), status = p_status, updated_at = now()
     where id = p_id returning id into v_id;
    if v_id is null then
      raise exception 'Eintrag nicht gefunden.' using errcode = 'P0002';
    end if;
  end if;
  return v_id;
end;
$$;

create or replace function public.admin_delete_board_post(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_staff() then
    raise exception 'Nur für Mods und Admins.' using errcode = '42501';
  end if;
  delete from public.board_posts where id = p_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- 2. Einstellung: falsche Vokabeln am Ende so oft wiederholen, bis alle richtig sind
-- ----------------------------------------------------------------------------

alter table public.user_settings add column if not exists repeat_until_correct boolean not null default false;

-- ----------------------------------------------------------------------------
-- 3. Coins fürs Lernen: je so viele richtige Antworten 1 Coin (Lernen, nicht Test),
--    zusätzlich zu den Coins für neu gelernte Vokabeln. Nur Online-Bücher, mit Tageslimit.
-- ----------------------------------------------------------------------------

insert into public.app_settings (key, value, mod_editable) values
  ('learn_coin_every', 5, false),   -- Lernen: 1 Coin je so viele richtige Antworten (Hauptrunde)
  ('learn_coin_cap', 20, false)     -- Lernen: höchstens so viele solcher Coins pro Tag
on conflict (key) do nothing;

create table if not exists public.learn_coin_days (
  user_id uuid not null references auth.users (id) on delete cascade,
  day date not null,
  correct integer not null default 0,
  paid integer not null default 0,
  primary key (user_id, day)
);
alter table public.learn_coin_days enable row level security;
revoke all on public.learn_coin_days from anon, authenticated;

create or replace function public.award_answer_koins()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_every integer := greatest(public.setting('learn_coin_every'), 1);
  v_cap integer := public.setting('learn_coin_cap');
  v_user uuid;
  v_mode text;
  v_today date := (now() at time zone 'Europe/Berlin')::date;
  v_correct integer;
  v_paid integer;
  v_due integer;
begin
  if new.is_repeat or not new.is_correct or v_cap <= 0 then
    return new;
  end if;
  select s.user_id, s.mode into v_user, v_mode from public.learning_sessions s where s.id = new.session_id;
  if v_user is null or v_mode <> 'learn' then
    return new;
  end if;
  if coalesce((select p.blocked from public.profiles p where p.id = v_user), true) then
    return new;
  end if;
  -- nur geprüfte Inhalte (Online-Bücher), damit man sich nicht mit eigenen Vokabeln Coins ertippt
  if not exists (
    select 1 from public.vocabulary v join public.books b on b.id = v.book_id
     where v.id = new.vocabulary_id and b.is_public) then
    return new;
  end if;
  insert into public.learn_coin_days (user_id, day, correct) values (v_user, v_today, 1)
  on conflict (user_id, day) do update set correct = public.learn_coin_days.correct + 1
  returning correct, paid into v_correct, v_paid;
  v_due := least(v_correct / v_every, v_cap);
  if v_due > v_paid then
    perform public._grant_koins(v_user, v_due - v_paid, 'learn_answers', null);
    update public.learn_coin_days set paid = v_due where user_id = v_user and day = v_today;
  end if;
  return new;
end;
$$;

drop trigger if exists learning_answers_award_koins on public.learning_answers;
create trigger learning_answers_award_koins
  after insert on public.learning_answers
  for each row execute function public.award_answer_koins();

-- ----------------------------------------------------------------------------
-- 4. Rechte
-- ----------------------------------------------------------------------------

do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig, p.proname
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('admin_save_board_post', 'admin_delete_board_post', 'award_answer_koins')
  loop
    if r.proname = 'award_answer_koins' then
      execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    else
      execute format('revoke all on function %s from public, anon', r.sig);
      execute format('grant execute on function %s to authenticated', r.sig);
    end if;
  end loop;
end;
$$;


-- ===== 0020_notifications.sql =====
-- ============================================================================
-- 0020: Benachrichtigungen (kleine Hinweise am Rand): @-Erwähnungen im Chat, neue Chat-Nachrichten,
-- fertiger 3D-Druck, jemand kommt online, Nachrichten vom Team. Alles pro Nutzer einstellbar.
-- Dazu für Admins: was eine Person gerade macht (Lernen, Spielen, Chat …) und Nachrichten pro Person.
-- Wiederholbar. Nach 0019 ausführen.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Einstellungen
-- ----------------------------------------------------------------------------

alter table public.user_settings add column if not exists notify_mentions boolean not null default true;
alter table public.user_settings add column if not exists notify_chat boolean not null default false;
alter table public.user_settings add column if not exists notify_print boolean not null default true;
alter table public.user_settings add column if not exists notify_online text not null default 'off';
-- Nachrichten vom Team: als Fenster (wie bisher, erst nach Lernen/Spielen) oder als Hinweis am Rand, sofort.
alter table public.user_settings add column if not exists notify_dm text not null default 'window';
alter table public.user_settings drop constraint if exists user_settings_notify_dm_check;
alter table public.user_settings add constraint user_settings_notify_dm_check check (notify_dm in ('window', 'edge'));
alter table public.user_settings drop constraint if exists user_settings_notify_online_check;
alter table public.user_settings add constraint user_settings_notify_online_check check (notify_online in ('off', 'staff', 'all'));

-- ----------------------------------------------------------------------------
-- 2. „Kommt online“: Zeitpunkt, seit dem jemand durchgehend online ist
-- ----------------------------------------------------------------------------

alter table public.profiles add column if not exists online_since timestamptz;
alter table public.profiles add column if not exists activity text;
alter table public.profiles add column if not exists activity_at timestamptz;

-- Neue Fassung mit „was mache ich gerade“ (z. B. 'learn', 'games'); alte Aufrufe ohne Wert gehen weiter.
drop function if exists public.heartbeat();
create or replace function public.heartbeat(p_activity text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
begin
  if v_me is null or public.is_blocked() then
    return;
  end if;
  update public.profiles
     set online_since = case when last_seen_at is null or last_seen_at < now() - interval '3 minutes' then now() else online_since end,
         activity_at = case when activity is distinct from nullif(left(regexp_replace(lower(coalesce(p_activity, '')), '[^a-z_]', '', 'g'), 20), '') then now() else activity_at end,
         activity = nullif(left(regexp_replace(lower(coalesce(p_activity, '')), '[^a-z_]', '', 'g'), 20), ''),
         last_seen_at = now()
   where id = v_me;
end;
$$;

-- Nur Admins: wer ist online und was macht die Person gerade.
create or replace function public.admin_user_status()
returns table (user_id uuid, last_seen_at timestamptz, online boolean, activity text, activity_at timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public._require_admin();
  return query
  select p.id, p.last_seen_at, (p.last_seen_at > now() - interval '3 minutes'),
         case when p.last_seen_at > now() - interval '3 minutes' then p.activity end,
         case when p.last_seen_at > now() - interval '3 minutes' then p.activity_at end
    from public.profiles p
   where p.last_seen_at is not null;
end;
$$;

-- Nur Admins: bisher gesendete Nachrichten an eine Person.
create or replace function public.admin_list_messages_to(p_user uuid)
returns table (id uuid, body text, created_at timestamptz, read_at timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public._require_admin();
  return query
  select m.id, m.body, m.created_at, m.read_at
    from public.user_messages m
   where m.user_id = p_user and m.from_id is not null
   order by m.created_at desc
   limit 20;
end;
$$;

-- ----------------------------------------------------------------------------
-- 3. Druck fertig: Zeitpunkt merken; das große Hinweisfenster entfällt, wenn der kleine Hinweis aktiv ist
-- ----------------------------------------------------------------------------

alter table public.print_orders add column if not exists ready_at timestamptz;

create or replace function public._print_stamp_ready()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'lieferbereit' and old.status is distinct from 'lieferbereit' then
    new.ready_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists print_orders_stamp_ready on public.print_orders;
create trigger print_orders_stamp_ready
  before update on public.print_orders
  for each row execute function public._print_stamp_ready();

create or replace function public._print_notify(p_user uuid, p_body text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- „Fertig“-Meldung: wer den kleinen Hinweis eingeschaltet hat, bekommt kein zweites Fenster.
  if p_body like '%ist fertig und liegt zur Übergabe bereit.'
     and coalesce((select s.notify_print from public.user_settings s where s.user_id = p_user), true) then
    return;
  end if;
  insert into public.user_messages (user_id, from_id, body)
  values (p_user, (select auth.uid()), left(p_body, 1000));
end;
$$;

-- ----------------------------------------------------------------------------
-- 4. Abfrage neuer Ereignisse (wird alle paar Sekunden aufgerufen)
--    p_chat_after = null  → nur Startwerte (kein Nachrichten-Schwall beim Öffnen der App)
-- ----------------------------------------------------------------------------

create or replace function public.notify_poll(p_chat_after bigint, p_since timestamptz)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  v_name text;
  v_set public.user_settings%rowtype;
  v_pattern text;
  v_since timestamptz := coalesce(p_since, now());
  v_max bigint;
  v_chat jsonb := '[]'::jsonb;
  v_ready jsonb := '[]'::jsonb;
  v_online jsonb := '[]'::jsonb;
begin
  if v_me is null or public.is_blocked() then
    raise exception 'Kein Zugriff.' using errcode = '42501';
  end if;
  select * into v_set from public.user_settings where user_id = v_me;
  select display_name into v_name from public.profiles where id = v_me;

  select coalesce(max(c.id), 0) into v_max
    from public.chat_messages c
   where c.kind <> 'whisper' or c.user_id = v_me or c.recipient_id = v_me;

  if p_chat_after is not null and (coalesce(v_set.notify_mentions, true) or coalesce(v_set.notify_chat, false)) then
    v_pattern := '(^|[^[:alnum:]_])@' || regexp_replace(coalesce(v_name, ''), '([.^$*+?()\[\]{}|\\])', '\\\1', 'g') || '($|[^[:alnum:]_])';
    select coalesce(jsonb_agg(x order by (x ->> 'id')::bigint), '[]'::jsonb) into v_chat
      from (
        select jsonb_build_object(
                 'id', c.id,
                 'from', pr.display_name,
                 'body', left(c.body, 140),
                 'whisper', c.kind = 'whisper',
                 'mention', (c.kind = 'whisper' or c.body ~* v_pattern)) as x
          from public.chat_messages c
          join public.profiles pr on pr.id = c.user_id
         where c.id > p_chat_after
           and c.user_id <> v_me
           and c.kind <> 'pay'
           and (c.kind <> 'whisper' or c.recipient_id = v_me)
           and (coalesce(v_set.notify_chat, false)
                or (coalesce(v_set.notify_mentions, true) and (c.kind = 'whisper' or c.body ~* v_pattern)))
         order by c.id desc
         limit 10) t;
  end if;

  if coalesce(v_set.notify_print, true) then
    select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'title', o.title) order by o.ready_at), '[]'::jsonb) into v_ready
      from public.print_orders o
     where o.user_id = v_me and o.status = 'lieferbereit' and o.ready_at > v_since;
  end if;

  if coalesce(v_set.notify_online, 'off') <> 'off' then
    select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.display_name) order by p.online_since), '[]'::jsonb) into v_online
      from (
        select p.* from public.profiles p
         where p.id <> v_me
           and not p.blocked
           and not p.hide_presence
           and p.online_since > v_since
           and p.last_seen_at > now() - interval '3 minutes'
           and (v_set.notify_online = 'all' or (p.role in ('mod', 'admin') and not p.tags_hidden))
         order by p.online_since
         limit 5) p;
  end if;

  return jsonb_build_object('now', now(), 'chat_max', v_max, 'chat', v_chat, 'ready', v_ready, 'online', v_online);
end;
$$;

-- ----------------------------------------------------------------------------
-- 5. Rechte
-- ----------------------------------------------------------------------------

do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig, p.proname
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('notify_poll', 'heartbeat', 'admin_user_status', 'admin_list_messages_to', '_print_notify', '_print_stamp_ready')
  loop
    if r.proname in ('_print_notify', '_print_stamp_ready') then
      execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    else
      execute format('revoke all on function %s from public, anon', r.sig);
      execute format('grant execute on function %s to authenticated', r.sig);
    end if;
  end loop;
end;
$$;

-- ===== 0021_plus_ai.sql =====
-- ============================================================================
-- 0021: Vokabeltrainer + (Abo), KI-Grammatikblätter und Test-Sätze (OpenAI über eine Edge Function),
-- Plus-Designs und -Tag, Verdienst-Konto für das Pro-Abo.
-- Wiederholbar. Nach 0020 ausführen.
--
-- Wichtig: Alles, was die KI schreibt (Status, Blätter, Kosten), geht nur über die Edge Function
-- (Rolle service_role). Der Browser kann diese Funktionen nicht aufrufen.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Einstellungen (alle vom Admin änderbar)
-- ----------------------------------------------------------------------------

create table if not exists public.plus_settings (
  key text primary key,
  value numeric not null,
  label text not null,
  unit text not null default '',
  hint text not null default '',
  min_value numeric not null default 0,
  max_value numeric not null default 100000,
  sort integer not null default 100
);
alter table public.plus_settings enable row level security;
revoke all on public.plus_settings from anon, authenticated;

insert into public.plus_settings (key, value, label, unit, hint, min_value, max_value, sort) values
  ('plus_price_eur',     3,    'Preis eines Plus-Pakets',          '€',        'Wird in der Schule bar bezahlt. Nur zur Anzeige und als Vorgabe beim Vergeben.', 0, 1000, 10),
  ('plus_days',          30,   'Laufzeit eines Pakets',            'Tage',     'So lange gilt Plus nach dem Vergeben (du kannst beim Vergeben auch andere Tage eintragen).', 1, 365, 20),
  ('plus_coin_enabled',  1,    '1 Tag Plus für Coins',             '1 = an',   'Jeder kann sich einmalig einen Tag Plus für Coins kaufen.', 0, 1, 30),
  ('plus_coin_price',    1000, 'Preis des Tages in Coins',         'Coins',    'Gilt nur einmalig pro Person.', 1, 1000000, 40),
  ('plus_coin_days',     1,    'Dauer des Coin-Tages',             'Tage',     '', 1, 30, 50),
  ('ai_enabled',         1,    'KI-Funktionen an',                 '1 = an',   'Bei 0 kann niemand Blätter erzeugen (gespeicherte Blätter bleiben nutzbar).', 0, 1, 60),
  ('ai_usd_in',          0.15, 'Modellpreis Eingabe',              '$ / 1 Mio. Tokens', 'Aus der OpenAI-Preisliste (gpt-4o-mini: 0,15). Daraus werden die Kosten berechnet.', 0, 1000, 70),
  ('ai_usd_out',         0.60, 'Modellpreis Ausgabe',              '$ / 1 Mio. Tokens', 'Aus der OpenAI-Preisliste (gpt-4o-mini: 0,60).', 0, 1000, 80),
  ('ai_usd_eur',         0.92, 'Dollar-Kurs',                      '€ pro $',  'Zum Umrechnen der Kosten in Euro.', 0.1, 10, 90),
  ('ai_user_month_eur',  0.50, 'KI-Budget pro Person und Monat',   '€',        'Wenn die Kosten einer Person diesen Betrag erreichen, kann sie diesen Monat nichts mehr erzeugen.', 0, 100, 100),
  ('ai_user_day_gens',   30,   'Erzeugungen pro Person und Tag',   'Stück',    'Schutz gegen Dauer-Klicken.', 1, 1000, 110),
  ('ai_global_month_eur', 10,  'KI-Budget insgesamt pro Monat',    '€',        'Notbremse für alle zusammen. Zusätzlich solltest du im OpenAI-Konto ein Ausgabenlimit setzen.', 0, 10000, 120),
  ('ai_max_items',       15,   'Aufgaben pro Blatt (höchstens)',   'Stück',    '', 5, 30, 130),
  ('ai_test_sentences',  20,   'Sätze pro Test (höchstens)',       'Stück',    '', 1, 60, 140)
on conflict (key) do update
  set label = excluded.label, unit = excluded.unit, hint = excluded.hint,
      min_value = excluded.min_value, max_value = excluded.max_value, sort = excluded.sort;

create or replace function public._pls(p_key text)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select value from public.plus_settings where key = p_key), 0);
$$;

-- ----------------------------------------------------------------------------
-- 2. Plus pro Person
-- ----------------------------------------------------------------------------

alter table public.profiles add column if not exists plus_until timestamptz;
alter table public.profiles add column if not exists plus_trial_used boolean not null default false;
alter table public.shop_items add column if not exists plus_only boolean not null default false;

-- Admins haben Plus immer (zum Ausprobieren).
create or replace function public._plus_active(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select (p.plus_until > now()) or p.role = 'admin' from public.profiles p where p.id = p_user and not p.blocked), false);
$$;

-- Ohne Plus: Plus-Designs ausziehen.
create or replace function public._plus_sync(p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if public._plus_active(p_user) then
    return;
  end if;
  update public.profiles p
     set avatar_id = case when p.avatar_id in (select id from public.shop_items where plus_only) then null else p.avatar_id end,
         color_id  = case when p.color_id  in (select id from public.shop_items where plus_only) then null else p.color_id end,
         effect_id = case when p.effect_id in (select id from public.shop_items where plus_only) then null else p.effect_id end,
         theme_id  = case when p.theme_id  in (select id from public.shop_items where plus_only) then null else p.theme_id end,
         tag_id    = case when p.tag_id    in (select id from public.shop_items where plus_only) then null else p.tag_id end
   where p.id = p_user
     and (p.avatar_id in (select id from public.shop_items where plus_only)
       or p.color_id  in (select id from public.shop_items where plus_only)
       or p.effect_id in (select id from public.shop_items where plus_only)
       or p.theme_id  in (select id from public.shop_items where plus_only)
       or p.tag_id    in (select id from public.shop_items where plus_only));
end;
$$;

-- Mit Plus: das „+“-Tag gibt es gleich dazu, wenn noch keins getragen wird.
create or replace function public._plus_apply_perks(p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if public._plus_active(p_user) and exists (select 1 from public.shop_items where id = 'tag_plus') then
    update public.profiles set tag_id = 'tag_plus' where id = p_user and tag_id is null;
  end if;
end;
$$;

-- Online-Signal räumt abgelaufene Plus-Designs mit auf.
create or replace function public.heartbeat(p_activity text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
begin
  if v_me is null or public.is_blocked() then
    return;
  end if;
  update public.profiles
     set online_since = case when last_seen_at is null or last_seen_at < now() - interval '3 minutes' then now() else online_since end,
         activity_at = case when activity is distinct from nullif(left(regexp_replace(lower(coalesce(p_activity, '')), '[^a-z_]', '', 'g'), 20), '') then now() else activity_at end,
         activity = nullif(left(regexp_replace(lower(coalesce(p_activity, '')), '[^a-z_]', '', 'g'), 20), ''),
         last_seen_at = now()
   where id = v_me;
  perform public._plus_sync(v_me);
end;
$$;

-- Anfragen („Plus anfordern“), Verkäufe/Vergaben, manuelle Verdienst-Buchungen
create table if not exists public.plus_requests (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.plus_requests enable row level security;
revoke all on public.plus_requests from anon, authenticated;

create table if not exists public.plus_sales (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users (id) on delete set null,
  kind text not null check (kind in ('paid', 'gift', 'coins')),
  cents integer not null default 0 check (cents >= 0),
  days integer not null check (days between 1 and 365),
  note text not null default '' check (char_length(note) <= 200),
  created_at timestamptz not null default now()
);
create index if not exists plus_sales_created_idx on public.plus_sales (created_at desc);
alter table public.plus_sales enable row level security;
revoke all on public.plus_sales from anon, authenticated;

create table if not exists public.goal_entries (
  id bigint generated always as identity primary key,
  cents integer not null check (cents between -1000000 and 1000000 and cents <> 0),
  note text not null default '' check (char_length(note) <= 200),
  created_at timestamptz not null default now()
);
alter table public.goal_entries enable row level security;
revoke all on public.goal_entries from anon, authenticated;

-- ----------------------------------------------------------------------------
-- 3. KI: Status, Verbrauch, Blätter, Satz-Zwischenspeicher, Ergebnisse
-- ----------------------------------------------------------------------------

create table if not exists public.ai_status (
  id boolean primary key default true check (id),
  state text not null default 'no_key' check (state in ('no_key', 'ok', 'empty', 'error')),
  message text not null default '',
  updated_at timestamptz not null default now()
);
insert into public.ai_status (id) values (true) on conflict do nothing;
alter table public.ai_status enable row level security;
revoke all on public.ai_status from anon, authenticated;

create table if not exists public.ai_usage (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users (id) on delete set null,
  kind text not null check (kind in ('grammar', 'sentences')),
  tokens_in integer not null default 0,
  tokens_out integer not null default 0,
  cost_micro bigint not null default 0,   -- Millionstel Euro
  ok boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists ai_usage_user_idx on public.ai_usage (user_id, created_at desc);
create index if not exists ai_usage_created_idx on public.ai_usage (created_at desc);
alter table public.ai_usage enable row level security;
revoke all on public.ai_usage from anon, authenticated;

create table if not exists public.ai_grammar_sets (
  id uuid primary key default gen_random_uuid(),
  language text not null check (language in ('en', 'fr')),
  grade integer not null check (grade between 5 and 13),
  topic_key text not null check (topic_key ~ '^[a-z0-9_]{1,60}$'),
  topic text not null check (char_length(topic) between 2 and 80),
  level text not null check (level in ('einfach', 'mittel', 'schwer')),
  title text not null check (char_length(title) between 2 and 120),
  items jsonb not null check (jsonb_typeof(items) = 'array' and jsonb_array_length(items) between 1 and 40),
  created_by uuid references auth.users (id) on delete set null,
  uses integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists ai_grammar_sets_find_idx on public.ai_grammar_sets (language, grade, topic_key, level, created_at desc);
alter table public.ai_grammar_sets enable row level security;
revoke all on public.ai_grammar_sets from anon, authenticated;

create table if not exists public.ai_vocab_sentences (
  key text primary key,
  language text not null,
  level text not null,
  item jsonb not null,
  uses integer not null default 0,
  created_at timestamptz not null default now()
);
alter table public.ai_vocab_sentences enable row level security;
revoke all on public.ai_vocab_sentences from anon, authenticated;

create table if not exists public.ai_results (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('grammar', 'test')),
  title text not null check (char_length(title) between 1 and 160),
  ref uuid,
  language text not null default '',
  level text not null default '',
  score integer not null check (score >= 0),
  total integer not null check (total >= 1),
  payload jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists ai_results_user_idx on public.ai_results (user_id, kind, created_at desc);
alter table public.ai_results enable row level security;
revoke all on public.ai_results from anon, authenticated;

-- ----------------------------------------------------------------------------
-- 4. Verdienst-Ziel: Druck-Umsatz + Plus-Verkäufe + manuelle Buchungen − KI-Kosten
-- ----------------------------------------------------------------------------

create or replace function public._ai_cost_cents()
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select round(coalesce(sum(cost_micro), 0) / 10000.0)::bigint from public.ai_usage;
$$;

create or replace function public._goal_total_cents()
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select public._print_delivered_cents()
       + coalesce((select sum(cents) from public.plus_sales), 0)
       + coalesce((select sum(cents) from public.goal_entries), 0)
       - public._ai_cost_cents();
$$;

create or replace function public.print_get_goal()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_goal integer := round(public._ps('goal_eur') * 100)::integer;
  v_earned bigint;
begin
  if (select auth.uid()) is null then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  if public._ps('goal_visible') < 1 and not public.is_admin() then
    return jsonb_build_object('visible', false);
  end if;
  v_earned := public._goal_total_cents() + round(public._ps('goal_offset_eur') * 100);
  return jsonb_build_object(
    'visible', public._ps('goal_visible') >= 1,
    'goal_cents', v_goal,
    'earned_cents', greatest(v_earned, 0),
    'percent', case when v_goal > 0 then round(greatest(v_earned, 0) * 100.0 / v_goal, 1) else 0 end);
end;
$$;

create or replace function public.admin_print_goal_reset()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._require_admin();
  update public.print_settings set value = -(public._goal_total_cents() / 100.0) where key = 'goal_offset_eur';
end;
$$;

-- Aufschlüsselung für den Admin
create or replace function public.admin_goal_breakdown()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public._require_admin();
  return jsonb_build_object(
    'print_cents', public._print_delivered_cents(),
    'plus_cents', coalesce((select sum(cents) from public.plus_sales), 0),
    'manual_cents', coalesce((select sum(cents) from public.goal_entries), 0),
    'ai_cost_cents', public._ai_cost_cents(),
    'offset_cents', round(public._ps('goal_offset_eur') * 100),
    'total_cents', public._goal_total_cents() + round(public._ps('goal_offset_eur') * 100),
    'goal_cents', round(public._ps('goal_eur') * 100),
    'entries', coalesce((select jsonb_agg(to_jsonb(e) order by e.id desc) from (select id, cents, note, created_at from public.goal_entries order by id desc limit 50) e), '[]'::jsonb));
end;
$$;

create or replace function public.admin_goal_add(p_cents integer, p_note text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._require_admin();
  if p_cents is null or p_cents = 0 or p_cents < -1000000 or p_cents > 1000000 then
    raise exception 'Der Betrag darf nicht 0 sein.' using errcode = '22023';
  end if;
  insert into public.goal_entries (cents, note) values (p_cents, left(btrim(coalesce(p_note, '')), 200));
end;
$$;

create or replace function public.admin_goal_delete(p_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._require_admin();
  delete from public.goal_entries where id = p_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- 5. Plus: Kunden-Funktionen
-- ----------------------------------------------------------------------------

create or replace function public.plus_status()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  p public.profiles;
  s public.ai_status;
begin
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  select * into p from public.profiles where id = v_me;
  select * into s from public.ai_status where id;
  perform public._plus_sync(v_me);
  return jsonb_build_object(
    'active', public._plus_active(v_me),
    'until', case when p.role = 'admin' then null else p.plus_until end,
    'is_admin', p.role = 'admin',
    'trial_available', public._pls('plus_coin_enabled') >= 1 and not p.plus_trial_used,
    'requested', exists (select 1 from public.plus_requests r where r.user_id = v_me),
    'price_cents', round(public._pls('plus_price_eur') * 100),
    'days', public._pls('plus_days'),
    'coin_price', public._pls('plus_coin_price'),
    'coin_days', public._pls('plus_coin_days'),
    'ai_enabled', public._pls('ai_enabled') >= 1,
    'ai_state', s.state,
    'ai_message', s.message,
    'max_items', public._pls('ai_max_items'),
    'test_sentences', public._pls('ai_test_sentences'));
end;
$$;

create or replace function public.plus_request()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
begin
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  insert into public.plus_requests (user_id) values (v_me) on conflict do nothing;
end;
$$;

create or replace function public.plus_cancel_request()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.plus_requests where user_id = (select auth.uid());
$$;

-- Einmalig: ein Tag Plus für Coins.
create or replace function public.plus_buy_day()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  p public.profiles;
  v_days integer := public._pls('plus_coin_days')::integer;
  v_price bigint := public._pls('plus_coin_price')::bigint;
  v_until timestamptz;
begin
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  if public._pls('plus_coin_enabled') < 1 then
    raise exception 'Das gibt es gerade nicht.' using errcode = '42501';
  end if;
  select * into p from public.profiles where id = v_me for update;
  if p.plus_trial_used then
    raise exception 'Den Tag für Coins hast du schon genutzt.' using errcode = '23505';
  end if;
  perform public._grant_koins(v_me, -v_price, 'plus_day', null);
  v_until := greatest(coalesce(p.plus_until, now()), now()) + make_interval(days => v_days);
  update public.profiles set plus_until = v_until, plus_trial_used = true where id = v_me;
  insert into public.plus_sales (user_id, kind, cents, days, note) values (v_me, 'coins', 0, v_days, format('%s Coins', v_price));
  delete from public.plus_requests where user_id = v_me;
  perform public._plus_apply_perks(v_me);
  return public.plus_status();
end;
$$;

-- ----------------------------------------------------------------------------
-- 6. Plus: Admin
-- ----------------------------------------------------------------------------

create or replace function public.admin_plus_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  s public.ai_status;
  v_month timestamptz := (date_trunc('month', timezone('Europe/Berlin', now())) at time zone 'Europe/Berlin');
begin
  perform public._require_admin();
  select * into s from public.ai_status where id;
  return jsonb_build_object(
    'requests', coalesce((select jsonb_agg(jsonb_build_object('user_id', r.user_id, 'name', p.display_name, 'created_at', r.created_at, 'plus_until', p.plus_until) order by r.created_at)
                            from public.plus_requests r join public.profiles p on p.id = r.user_id), '[]'::jsonb),
    'active', coalesce((select jsonb_agg(jsonb_build_object('user_id', p.id, 'name', p.display_name, 'until', p.plus_until) order by p.plus_until)
                          from public.profiles p where p.plus_until > now()), '[]'::jsonb),
    'sales', coalesce((select jsonb_agg(x order by (x ->> 'id')::bigint desc) from (
                select jsonb_build_object('id', l.id, 'user_id', l.user_id, 'name', coalesce(p.display_name, 'gelöscht'), 'kind', l.kind,
                       'cents', l.cents, 'days', l.days, 'note', l.note, 'created_at', l.created_at) x
                  from public.plus_sales l left join public.profiles p on p.id = l.user_id
                 order by l.id desc limit 50) q), '[]'::jsonb),
    'ai', jsonb_build_object(
      'state', s.state, 'message', s.message, 'updated_at', s.updated_at,
      'month_cost_cents', round(coalesce((select sum(cost_micro) from public.ai_usage where created_at >= v_month), 0) / 10000.0, 2),
      'month_generations', (select count(*) from public.ai_usage where created_at >= v_month and ok),
      'month_tokens', coalesce((select sum(tokens_in + tokens_out) from public.ai_usage where created_at >= v_month), 0),
      'sets', (select count(*) from public.ai_grammar_sets),
      'sentences', (select count(*) from public.ai_vocab_sentences)));
end;
$$;

create or replace function public.admin_plus_counts()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public._require_admin();
  return jsonb_build_object(
    'requests', (select count(*) from public.plus_requests),
    'ai_problem', (select state <> 'ok' from public.ai_status where id));
end;
$$;

create or replace function public.admin_plus_grant(p_user uuid, p_days integer, p_paid_cents integer, p_note text default '')
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_until timestamptz;
  v_paid integer := coalesce(p_paid_cents, 0);
begin
  perform public._require_admin();
  if p_days is null or p_days < 1 or p_days > 365 then
    raise exception 'Die Dauer muss zwischen 1 und 365 Tagen liegen.' using errcode = '22023';
  end if;
  if v_paid < 0 or v_paid > 100000 then
    raise exception 'Der Betrag ist ungültig.' using errcode = '22023';
  end if;
  update public.profiles
     set plus_until = greatest(coalesce(plus_until, now()), now()) + make_interval(days => p_days)
   where id = p_user and not blocked
   returning plus_until into v_until;
  if v_until is null then
    raise exception 'Person nicht gefunden.' using errcode = 'P0002';
  end if;
  insert into public.plus_sales (user_id, kind, cents, days, note)
  values (p_user, case when v_paid > 0 then 'paid' else 'gift' end, v_paid, p_days, left(btrim(coalesce(p_note, '')), 200));
  delete from public.plus_requests where user_id = p_user;
  perform public._plus_apply_perks(p_user);
  insert into public.user_messages (user_id, from_id, body)
  values (p_user, (select auth.uid()), format('Du hast jetzt Vokabeltrainer + bis %s. Viel Spaß!', to_char(v_until at time zone 'Europe/Berlin', 'DD.MM.YYYY')));
  return v_until;
end;
$$;

create or replace function public.admin_plus_reject(p_user uuid, p_note text default '')
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._require_admin();
  delete from public.plus_requests where user_id = p_user;
  insert into public.user_messages (user_id, from_id, body)
  values (p_user, (select auth.uid()), left('Deine Anfrage für Vokabeltrainer + wurde nicht angenommen.' || case when btrim(coalesce(p_note, '')) <> '' then ' ' || btrim(p_note) else '' end, 1000));
end;
$$;

create or replace function public.admin_plus_revoke(p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._require_admin();
  update public.profiles set plus_until = least(plus_until, now()) where id = p_user;
  perform public._plus_sync(p_user);
end;
$$;

-- Verkauf/Vergabe rückgängig (z. B. aus Versehen bestätigt): Verdienst und Laufzeit werden zurückgenommen.
create or replace function public.admin_plus_undo_sale(p_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  l public.plus_sales;
  v_new timestamptz;
begin
  perform public._require_admin();
  select * into l from public.plus_sales where id = p_id for update;
  if not found then
    raise exception 'Eintrag nicht gefunden.' using errcode = 'P0002';
  end if;
  delete from public.plus_sales where id = l.id;
  if l.user_id is not null then
    update public.profiles
       set plus_until = plus_until - make_interval(days => l.days),
           plus_trial_used = case when l.kind = 'coins' then false else plus_trial_used end
     where id = l.user_id and plus_until is not null
     returning plus_until into v_new;
    if l.kind = 'coins' then
      perform public._grant_koins(l.user_id, public._pls('plus_coin_price')::bigint, 'plus_refund', l.id::text);
    end if;
    perform public._plus_sync(l.user_id);
  end if;
end;
$$;

create or replace function public.admin_plus_get_settings()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public._require_admin();
  return coalesce((select jsonb_agg(to_jsonb(s) order by s.sort) from public.plus_settings s), '[]'::jsonb);
end;
$$;

create or replace function public.admin_plus_set_setting(p_key text, p_value numeric)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.plus_settings;
begin
  perform public._require_admin();
  select * into s from public.plus_settings where key = p_key;
  if not found then
    raise exception 'Unbekannte Einstellung.' using errcode = 'P0002';
  end if;
  if p_value is null or p_value < s.min_value or p_value > s.max_value then
    raise exception '% muss zwischen % und % liegen.', s.label, s.min_value, s.max_value using errcode = '22023';
  end if;
  update public.plus_settings set value = p_value where key = p_key;
end;
$$;

-- ----------------------------------------------------------------------------
-- 7. Shop: Plus-Designs (kostenlos mit Plus, sonst gesperrt)
-- ----------------------------------------------------------------------------

drop function if exists public.get_shop();
create function public.get_shop()
returns table (id text, kind text, name text, price integer, sort integer, owned boolean, equipped boolean,
               required_role text, active boolean, custom boolean, style jsonb, svg text, plus_only boolean)
language sql
stable
security definer
set search_path = public
as $$
  select i.id, i.kind, i.name, i.price, i.sort,
         ((i.price = 0 and (not i.plus_only or public._plus_active((select auth.uid())))) or o.item_id is not null),
         exists (select 1 from public.profiles p
                  where p.id = (select auth.uid())
                    and i.id in (p.avatar_id, p.color_id, p.effect_id, p.theme_id, p.tag_id)),
         i.required_role, i.active, i.custom, i.style, i.svg, i.plus_only
    from public.shop_items i
    left join public.user_items o on o.item_id = i.id and o.user_id = (select auth.uid())
   where (select auth.uid()) is not null
     and (i.active or o.item_id is not null)
     and (i.required_role is null
          or public._role_rank(i.required_role) <= public._role_rank(
               (select p.role from public.profiles p where p.id = (select auth.uid()))))
   order by i.kind, i.sort, i.name;
$$;

-- (buy_item bleibt unverändert: Plus-Artikel kosten 0 und gelten als „gehört dir schon“; die App zeigt dafür den Plus-Hinweis.)

create or replace function public.equip_item(p_item_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  v_kind text;
  v_price integer;
  v_req text;
  v_active boolean;
  v_plus boolean;
  v_owned boolean;
begin
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  select kind, price, required_role, active, plus_only into v_kind, v_price, v_req, v_active, v_plus
    from public.shop_items where id = p_item_id;
  v_owned := exists (select 1 from public.user_items where user_id = v_me and item_id = p_item_id);
  if v_kind is null or not (v_active or v_owned) then
    raise exception 'Artikel nicht gefunden.' using errcode = 'P0002';
  end if;
  if v_plus and not public._plus_active(v_me) then
    raise exception 'Das gibt es nur mit Vokabeltrainer +.' using errcode = '42501';
  end if;
  if v_req is not null
     and public._role_rank(v_req) > public._role_rank((select role from public.profiles where id = v_me)) then
    raise exception 'Diesen Artikel gibt es nur für %.',
      case v_req when 'admin' then 'Admins' else 'Mods und Admins' end using errcode = '42501';
  end if;
  if v_price > 0 and not v_owned then
    raise exception 'Diesen Artikel musst du erst kaufen.' using errcode = '42501';
  end if;
  update public.profiles
     set avatar_id = case when v_kind = 'avatar' then p_item_id else avatar_id end,
         color_id  = case when v_kind = 'color'  then p_item_id else color_id end,
         effect_id = case when v_kind = 'effect' then p_item_id else effect_id end,
         theme_id  = case when v_kind = 'theme'  then p_item_id else theme_id end,
         tag_id    = case when v_kind = 'tag'    then p_item_id else tag_id end
   where id = v_me;
end;
$$;

insert into public.shop_items (id, kind, name, price, sort, plus_only) values
  ('tag_plus',            'tag',    '+',                  0, 5,  true),
  ('color_plus_nordlicht','color',  'Plus Nordlicht',     0, 900, true),
  ('color_plus_rosegold', 'color',  'Plus Roségold',      0, 910, true),
  ('color_plus_eis',      'color',  'Plus Eis',           0, 920, true),
  ('effect_plus_glanz',   'effect', 'Plus Glanz',         0, 900, true),
  ('theme_plus_mitternacht','theme','Plus Mitternacht',   0, 900, true),
  ('theme_plus_glut',     'theme',  'Plus Glut',          0, 910, true),
  ('avatar_plus_stern',   'avatar', 'Plus-Stern',         0, 900, true),
  ('avatar_plus_kristall','avatar', 'Plus-Kristall',      0, 910, true)
on conflict (id) do update set name = excluded.name, plus_only = true, kind = excluded.kind;

-- ----------------------------------------------------------------------------
-- 8. KI: nur über die Edge Function (service_role)
-- ----------------------------------------------------------------------------

-- Darf diese Person jetzt etwas erzeugen? (prüft Plus, Schalter, Tages- und Monatsgrenzen)
create or replace function public.ai_begin(p_user uuid, p_kind text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_month timestamptz := (date_trunc('month', timezone('Europe/Berlin', now())) at time zone 'Europe/Berlin');
  v_day timestamptz := (date_trunc('day', timezone('Europe/Berlin', now())) at time zone 'Europe/Berlin');
  v_admin boolean := coalesce((select role = 'admin' from public.profiles where id = p_user), false);
begin
  if p_kind not in ('grammar', 'sentences') then
    raise exception 'Ungültige Art.' using errcode = '22023';
  end if;
  if not public._plus_active(p_user) then
    return jsonb_build_object('ok', false, 'code', 'no_plus');
  end if;
  if public._pls('ai_enabled') < 1 then
    return jsonb_build_object('ok', false, 'code', 'disabled');
  end if;
  if (select coalesce(sum(cost_micro), 0) from public.ai_usage where created_at >= v_month) >= public._pls('ai_global_month_eur') * 1000000 then
    return jsonb_build_object('ok', false, 'code', 'global_budget');
  end if;
  if not v_admin then
    if (select count(*) from public.ai_usage where user_id = p_user and ok and created_at >= v_day) >= public._pls('ai_user_day_gens') then
      return jsonb_build_object('ok', false, 'code', 'user_day');
    end if;
    if (select coalesce(sum(cost_micro), 0) from public.ai_usage where user_id = p_user and created_at >= v_month) >= public._pls('ai_user_month_eur') * 1000000 then
      return jsonb_build_object('ok', false, 'code', 'user_budget');
    end if;
  end if;
  return jsonb_build_object('ok', true, 'max_items', public._pls('ai_max_items'), 'max_sentences', public._pls('ai_test_sentences'));
end;
$$;

create or replace function public.ai_set_status(p_state text, p_message text default '')
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_state not in ('no_key', 'ok', 'empty', 'error') then
    raise exception 'Ungültiger Status.' using errcode = '22023';
  end if;
  update public.ai_status set state = p_state, message = left(coalesce(p_message, ''), 300), updated_at = now() where id;
end;
$$;

-- Verbrauch buchen; Kosten in Millionstel Euro aus Tokens und den Modellpreisen
create or replace function public.ai_record_usage(p_user uuid, p_kind text, p_in integer, p_out integer, p_ok boolean)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_in integer := greatest(coalesce(p_in, 0), 0);
  v_out integer := greatest(coalesce(p_out, 0), 0);
  v_micro bigint;
begin
  v_micro := round((v_in * public._pls('ai_usd_in') + v_out * public._pls('ai_usd_out')) * public._pls('ai_usd_eur'))::bigint;
  insert into public.ai_usage (user_id, kind, tokens_in, tokens_out, cost_micro, ok)
  values (p_user, p_kind, v_in, v_out, v_micro, coalesce(p_ok, true));
  return v_micro;
end;
$$;

create or replace function public.ai_save_grammar_set(p_user uuid, p_language text, p_grade integer, p_topic_key text, p_topic text, p_level text, p_title text, p_items jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  insert into public.ai_grammar_sets (language, grade, topic_key, topic, level, title, items, created_by)
  values (p_language, p_grade, p_topic_key, left(p_topic, 80), p_level, left(p_title, 120), p_items, p_user)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.ai_get_vocab_sentences(p_keys text[])
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_object_agg(key, item), '{}'::jsonb) from public.ai_vocab_sentences where key = any (p_keys);
$$;

create or replace function public.ai_save_vocab_sentences(p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  r jsonb;
  n integer := 0;
begin
  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    insert into public.ai_vocab_sentences (key, language, level, item)
    values (left(r ->> 'key', 300), r ->> 'language', r ->> 'level', r -> 'item')
    on conflict (key) do nothing;
    n := n + 1;
  end loop;
  return n;
end;
$$;

create or replace function public.ai_touch_vocab_sentences(p_keys text[])
returns void
language sql
security definer
set search_path = public
as $$
  update public.ai_vocab_sentences set uses = uses + 1 where key = any (p_keys);
$$;

-- ----------------------------------------------------------------------------
-- 9. KI: Blätter ansehen (nur mit Plus) und eigene Ergebnisse
-- ----------------------------------------------------------------------------

create or replace function public.ai_list_sets(p_language text, p_grade integer, p_topic_key text default null, p_level text default null)
returns table (id uuid, title text, topic text, topic_key text, level text, grade integer, items integer, uses integer, created_at timestamptz, mine boolean)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if (select auth.uid()) is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  if not public._plus_active((select auth.uid())) then
    raise exception 'Dafür brauchst du Vokabeltrainer +.' using errcode = '42501';
  end if;
  return query
  select s.id, s.title, s.topic, s.topic_key, s.level, s.grade, jsonb_array_length(s.items), s.uses, s.created_at, s.created_by = (select auth.uid())
    from public.ai_grammar_sets s
   where s.language = p_language and s.grade = p_grade
     and (p_topic_key is null or s.topic_key = p_topic_key)
     and (p_level is null or s.level = p_level)
   order by s.created_at desc
   limit 60;
end;
$$;

create or replace function public.ai_get_set(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.ai_grammar_sets;
begin
  if (select auth.uid()) is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  if not public._plus_active((select auth.uid())) then
    raise exception 'Dafür brauchst du Vokabeltrainer +.' using errcode = '42501';
  end if;
  update public.ai_grammar_sets set uses = uses + 1 where id = p_id returning * into s;
  if not found then
    raise exception 'Blatt nicht gefunden.' using errcode = 'P0002';
  end if;
  return jsonb_build_object('id', s.id, 'title', s.title, 'topic', s.topic, 'topic_key', s.topic_key, 'level', s.level,
                            'grade', s.grade, 'language', s.language, 'items', s.items, 'created_at', s.created_at);
end;
$$;

create or replace function public.ai_save_result(p_kind text, p_title text, p_ref uuid, p_language text, p_level text, p_score integer, p_total integer, p_payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  v_id uuid;
begin
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  if p_kind not in ('grammar', 'test') then
    raise exception 'Ungültige Art.' using errcode = '22023';
  end if;
  if p_kind = 'grammar' and not public._plus_active(v_me) then
    raise exception 'Dafür brauchst du Vokabeltrainer +.' using errcode = '42501';
  end if;
  if p_total is null or p_total < 1 or p_score is null or p_score < 0 or p_score > p_total then
    raise exception 'Ungültiges Ergebnis.' using errcode = '22023';
  end if;
  if p_payload is null or pg_column_size(p_payload) > 200000 then
    raise exception 'Das Ergebnis ist zu groß.' using errcode = '22023';
  end if;
  insert into public.ai_results (user_id, kind, title, ref, language, level, score, total, payload)
  values (v_me, p_kind, left(btrim(coalesce(p_title, '')), 160), p_ref, left(coalesce(p_language, ''), 10), left(coalesce(p_level, ''), 20), p_score, p_total, p_payload)
  returning id into v_id;
  -- höchstens 100 gespeicherte Ergebnisse je Art
  delete from public.ai_results
   where user_id = v_me and kind = p_kind
     and id in (select r.id from public.ai_results r where r.user_id = v_me and r.kind = p_kind order by r.created_at desc offset 100);
  return v_id;
end;
$$;

create or replace function public.ai_my_results(p_kind text)
returns table (id uuid, kind text, title text, language text, level text, score integer, total integer, created_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select r.id, r.kind, r.title, r.language, r.level, r.score, r.total, r.created_at
    from public.ai_results r
   where r.user_id = (select auth.uid()) and r.kind = p_kind
   order by r.created_at desc
   limit 100;
$$;

create or replace function public.ai_get_result(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  r public.ai_results;
begin
  select * into r from public.ai_results where id = p_id and user_id = (select auth.uid());
  if not found then
    raise exception 'Ergebnis nicht gefunden.' using errcode = 'P0002';
  end if;
  return jsonb_build_object('id', r.id, 'kind', r.kind, 'title', r.title, 'ref', r.ref, 'language', r.language, 'level', r.level,
                            'score', r.score, 'total', r.total, 'payload', r.payload, 'created_at', r.created_at);
end;
$$;

create or replace function public.ai_delete_result(p_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.ai_results where id = p_id and user_id = (select auth.uid());
$$;

-- ----------------------------------------------------------------------------
-- 10. Rechte
-- ----------------------------------------------------------------------------

do $$
declare
  r record;
  has_service boolean := exists (select 1 from pg_roles where rolname = 'service_role');
begin
  for r in
    select p.oid::regprocedure as sig, p.proname
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in (
         'plus_status', 'plus_request', 'plus_cancel_request', 'plus_buy_day', 'heartbeat',
         'admin_plus_overview', 'admin_plus_counts', 'admin_plus_grant', 'admin_plus_reject', 'admin_plus_revoke',
         'admin_plus_undo_sale', 'admin_plus_get_settings', 'admin_plus_set_setting',
         'admin_goal_breakdown', 'admin_goal_add', 'admin_goal_delete', 'print_get_goal', 'admin_print_goal_reset',
         'get_shop', 'equip_item',
         'ai_list_sets', 'ai_get_set', 'ai_save_result', 'ai_my_results', 'ai_get_result', 'ai_delete_result')
  loop
    execute format('revoke all on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;

  -- nur die Edge Function
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('ai_begin', 'ai_set_status', 'ai_record_usage', 'ai_save_grammar_set',
                         'ai_get_vocab_sentences', 'ai_save_vocab_sentences', 'ai_touch_vocab_sentences')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    if has_service then
      execute format('grant execute on function %s to service_role', r.sig);
    end if;
  end loop;

  -- interne Helfer: niemand direkt
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('_pls', '_plus_active', '_plus_sync', '_plus_apply_perks', '_ai_cost_cents', '_goal_total_cents')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
  end loop;
end;
$$;

-- ===== 0022_coin_cap_rewards.sql =====
-- ============================================================================
-- 0022: Automatische Belohnungen (Liga, Quests, Lernen, Duelle, Sprint …) dürfen nie scheitern,
-- wenn jemand schon fast das Höchstguthaben (9 Billiarden) hat. Vorher brach z. B. die Liga-Auswertung
-- mit „Das Guthaben darf 9.000.000.000.000.000 Coins nicht übersteigen.“ ab, und die ganze Liga lud nicht mehr.
-- Jetzt wird die Belohnung gekürzt (oder entfällt), statt einen Fehler auszulösen.
-- Bewusst weiter mit Fehler: Admin-Buchungen, Überweisungen (pay_in) und Rückerstattungen.
-- Wiederholbar. Nach 0021 ausführen.
-- ============================================================================

create or replace function public._grant_koins(p_user uuid, p_amount bigint, p_reason text, p_ref text default null)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  c_max constant bigint := 9000000000000000;
  v_balance bigint;
  v_amount bigint := p_amount;
  v_strict boolean := p_reason in ('admin', 'pay_in', 'print_refund', 'plus_refund');
begin
  if p_amount = 0 then
    return coalesce((select balance from public.koin_wallets where user_id = p_user), 0);
  end if;
  insert into public.koin_wallets (user_id) values (p_user) on conflict do nothing;

  -- Automatische Belohnungen: nur so viel gutschreiben, wie noch unter das Höchstguthaben passt.
  if v_amount > 0 and not v_strict then
    select least(v_amount, greatest(c_max - w.balance, 0)) into v_amount from public.koin_wallets w where w.user_id = p_user;
    if v_amount <= 0 then
      return (select balance from public.koin_wallets where user_id = p_user);
    end if;
  end if;

  update public.koin_wallets
     set balance = balance + v_amount
   where user_id = p_user and balance + v_amount >= 0 and balance + v_amount <= c_max
   returning balance into v_balance;
  if v_balance is null then
    if v_amount > 0 then
      raise exception 'Das Guthaben darf 9.000.000.000.000.000 Coins nicht übersteigen.' using errcode = '22023';
    end if;
    raise exception 'Nicht genug Coins.' using errcode = '23514';
  end if;
  insert into public.koin_ledger (user_id, amount, reason, ref) values (p_user, v_amount, p_reason, p_ref);
  return v_balance;
end;
$$;

revoke all on function public._grant_koins(uuid, bigint, text, text) from public, anon, authenticated;

-- ===== 0023_print_lock_coin_lock.sql =====
-- ============================================================================
-- 0023: 1) 3D-Druck-Shop ausschaltbar (wie die anderen Funktionen unter Verwaltung → Sperren, Schlüssel 'print').
--       2) Coin-Sperre pro Person: Wer gesperrt ist, kann keine Coins mehr ausgeben oder verschenken
--          (Shop, Bücher, Überweisungen, 3D-Druck-Rabatt, Plus). Erlaubt bleiben Gambling und Spiele (Einsatz/Gebühr).
--          Gutschriften (Gewinne, Belohnungen, Geschenke) funktionieren weiter.
-- Wiederholbar. Nach 0022 ausführen.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Sperr-Schlüssel 'print'
-- ----------------------------------------------------------------------------

alter table public.feature_locks drop constraint if exists feature_locks_key_check;
alter table public.feature_locks add constraint feature_locks_key_check
  check (key in ('games', 'gambling', 'sprint', 'duels', 'chat', 'shop', 'quests', 'print'));

do $$
declare
  v_fn text;
  v_def text;
begin
  -- Schlüsselliste in den drei Sperr-Funktionen erweitern
  foreach v_fn in array array['get_locked_features', 'admin_get_feature_locks', 'admin_set_feature_lock'] loop
    select pg_get_functiondef(p.oid) into v_def
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = v_fn limit 1;
    if v_def is not null and position('''print''' in v_def) = 0 then
      v_def := replace(v_def, '''quests'']', '''quests'', ''print'']');
      v_def := replace(v_def, '''quests'')', '''quests'', ''print'')');
      execute v_def;
    end if;
  end loop;

  -- Sperre in die Kunden-Funktionen des Druck-Shops einhängen
  foreach v_fn in array array['print_get_info', 'print_quote', 'print_create_order'] loop
    select pg_get_functiondef(p.oid) into v_def
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = v_fn limit 1;
    if v_def is not null and position('_feature_guard' in v_def) = 0 and v_def ~ E'\nbegin\n' then
      v_def := regexp_replace(v_def, E'\nbegin\n', E'\nbegin\n  perform public._feature_guard(''print'');\n');
      execute v_def;
    end if;
  end loop;
end;
$$;

-- ----------------------------------------------------------------------------
-- 2. Coin-Sperre pro Person
-- ----------------------------------------------------------------------------

alter table public.profiles add column if not exists coins_locked_at timestamptz;
alter table public.profiles add column if not exists coins_lock_note text not null default '';

create or replace function public._grant_koins(p_user uuid, p_amount bigint, p_reason text, p_ref text default null)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  c_max constant bigint := 9000000000000000;
  v_balance bigint;
  v_amount bigint := p_amount;
  v_strict boolean := p_reason in ('admin', 'pay_in', 'print_refund', 'plus_refund');
begin
  if p_amount = 0 then
    return coalesce((select balance from public.koin_wallets where user_id = p_user), 0);
  end if;
  -- Gesperrte Personen dürfen nur noch für Gambling und Spiele zahlen.
  if p_amount < 0 and p_reason not in ('gambling_bet', 'game_fee', 'admin')
     and exists (select 1 from public.profiles where id = p_user and coins_locked_at is not null) then
    raise exception 'Dein Guthaben ist vom Admin gesperrt. Du kannst nur noch spielen und gamblen.' using errcode = '55000';
  end if;
  insert into public.koin_wallets (user_id) values (p_user) on conflict do nothing;

  if v_amount > 0 and not v_strict then
    select least(v_amount, greatest(c_max - w.balance, 0)) into v_amount from public.koin_wallets w where w.user_id = p_user;
    if v_amount <= 0 then
      return (select balance from public.koin_wallets where user_id = p_user);
    end if;
  end if;

  update public.koin_wallets
     set balance = balance + v_amount
   where user_id = p_user and balance + v_amount >= 0 and balance + v_amount <= c_max
   returning balance into v_balance;
  if v_balance is null then
    if v_amount > 0 then
      raise exception 'Das Guthaben darf 9.000.000.000.000.000 Coins nicht übersteigen.' using errcode = '22023';
    end if;
    raise exception 'Nicht genug Coins.' using errcode = '23514';
  end if;
  insert into public.koin_ledger (user_id, amount, reason, ref) values (p_user, v_amount, p_reason, p_ref);
  return v_balance;
end;
$$;

-- Eigener Status (für Hinweis im Shop/Profil)
create or replace function public.coin_lock_status()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object('locked', coins_locked_at is not null, 'note', coins_lock_note)
    from public.profiles where id = (select auth.uid());
$$;

-- Nur Admins: sperren/entsperren
create or replace function public.admin_set_coin_lock(p_user uuid, p_locked boolean, p_note text default '')
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._require_admin();
  if p_locked and exists (select 1 from public.profiles where id = p_user and role = 'admin') then
    raise exception 'Admins kannst du nicht sperren.' using errcode = '22023';
  end if;
  update public.profiles
     set coins_locked_at = case when p_locked then coalesce(coins_locked_at, now()) else null end,
         coins_lock_note = case when p_locked then left(btrim(coalesce(p_note, '')), 200) else '' end
   where id = p_user;
  if not found then
    raise exception 'Person nicht gefunden.' using errcode = 'P0002';
  end if;
  if p_locked then
    insert into public.user_messages (user_id, from_id, body)
    values (p_user, (select auth.uid()), left('Dein Coin-Guthaben wurde gesperrt: Du kannst nur noch spielen und gamblen.' || case when btrim(coalesce(p_note, '')) <> '' then ' Grund: ' || btrim(p_note) else '' end, 1000));
  end if;
end;
$$;

-- Nur Admins: Liste der gesperrten Personen
create or replace function public.admin_coin_locks()
returns table (user_id uuid, locked_at timestamptz, note text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public._require_admin();
  return query select p.id, p.coins_locked_at, p.coins_lock_note from public.profiles p where p.coins_locked_at is not null;
end;
$$;

-- ----------------------------------------------------------------------------
-- 3. Rechte
-- ----------------------------------------------------------------------------

do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig, p.proname
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('_grant_koins', 'coin_lock_status', 'admin_set_coin_lock', 'admin_coin_locks',
                         'get_locked_features', 'admin_get_feature_locks', 'admin_set_feature_lock',
                         'print_get_info', 'print_quote', 'print_create_order')
  loop
    if r.proname = '_grant_koins' then
      execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    else
      execute format('revoke all on function %s from public, anon', r.sig);
      execute format('grant execute on function %s to authenticated', r.sig);
    end if;
  end loop;
end;
$$;

-- ===== 0024_plus_coins_perks =====
-- ============================================================================
-- 0024: Vokabeltrainer + nur noch mit Coins (Stufen), Plus-Vorteile, Quest-Ketten.
--  * Stufen: 1 Tag 100, 1 Woche 600, 1 Monat 3000, 3 Monate 8000, für immer 100000 Coins (im Admin änderbar)
--  * Coins ×1,5 und Ranglistenpunkte ×1,5 mit Plus (Gambling-Gewinne ausgenommen)
--  * Gambling: höhere Gewinnchance mit Plus
--  * „Vokabeln sofort wieder fällig machen“ (nur Plus)
--  * Wiederbeleben im Spiel für 1000 Coins (nur Plus, höchstens 3× pro Runde)
--  * Quests: Ketten (20 → 50 → 100 → 200 Antworten, 1 → 4 → 8 Duelle …) und Plus-Quests
--  * Weitere Plus-Artikel (animierte Profilbilder, Effekte, Farben, Designs)
-- Wiederholbar. Nach 0023 ausführen.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Einstellungen und Verkäufe
-- ----------------------------------------------------------------------------

insert into public.plus_settings (key, value, label, unit, hint, min_value, max_value, sort) values
  ('plus_price_d1',   100,    'Preis: 1 Tag',        'Coins', '', 0, 1000000000, 11),
  ('plus_price_d7',   600,    'Preis: 1 Woche',      'Coins', '', 0, 1000000000, 12),
  ('plus_price_d30',  3000,   'Preis: 1 Monat',      'Coins', '', 0, 1000000000, 13),
  ('plus_price_d90',  8000,   'Preis: 3 Monate',     'Coins', '', 0, 1000000000, 14),
  ('plus_price_life', 100000, 'Preis: für immer',    'Coins', '', 0, 1000000000, 15),
  ('plus_coin_mult',  1.5,    'Coins-Multiplikator mit Plus',  '×', 'Gilt für Lernen, Quests, Spiele, Sprint usw. (nicht für Gambling-Gewinne).', 1, 10, 200),
  ('plus_points_mult', 1.5,   'Ranglistenpunkte-Multiplikator mit Plus', '×', 'Für die Wochenliga.', 1, 10, 210),
  ('plus_gamble_boost_percent', 15, 'Gambling: bessere Gewinnchance mit Plus', '%', 'Relativ zur normalen Gewinnchance (15 % = aus 20 % werden 23 %).', 0, 100, 220),
  ('plus_revive_price', 1000, 'Wiederbeleben im Spiel', 'Coins', 'Nur mit Plus.', 0, 1000000, 230),
  ('plus_revive_max',   3,    'Wiederbeleben pro Runde (höchstens)', 'mal', '', 1, 20, 240)
on conflict (key) do update
  set label = excluded.label, unit = excluded.unit, hint = excluded.hint,
      min_value = excluded.min_value, max_value = excluded.max_value, sort = excluded.sort;

alter table public.plus_sales add column if not exists coins bigint not null default 0;
alter table public.plus_sales drop constraint if exists plus_sales_days_check;
alter table public.plus_sales add constraint plus_sales_days_check check (days between 1 and 36500);
alter table public.game_runs add column if not exists revives smallint not null default 0;

-- ----------------------------------------------------------------------------
-- 2. Plus kaufen (Coins)
-- ----------------------------------------------------------------------------

create or replace function public._plus_tiers()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_array(
    jsonb_build_object('id', 'd1',   'label', '1 Tag',     'days', 1,     'price', public._pls('plus_price_d1')::bigint),
    jsonb_build_object('id', 'd7',   'label', '1 Woche',   'days', 7,     'price', public._pls('plus_price_d7')::bigint),
    jsonb_build_object('id', 'd30',  'label', '1 Monat',   'days', 30,    'price', public._pls('plus_price_d30')::bigint),
    jsonb_build_object('id', 'd90',  'label', '3 Monate',  'days', 90,    'price', public._pls('plus_price_d90')::bigint),
    jsonb_build_object('id', 'life', 'label', 'Für immer', 'days', 36500, 'price', public._pls('plus_price_life')::bigint));
$$;

create or replace function public.plus_status()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  p public.profiles;
  s public.ai_status;
begin
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  select * into p from public.profiles where id = v_me;
  select * into s from public.ai_status where id;
  perform public._plus_sync(v_me);
  return jsonb_build_object(
    'active', public._plus_active(v_me),
    'until', case when p.role = 'admin' then null else p.plus_until end,
    'lifetime', coalesce(p.plus_until >= '2099-01-01'::timestamptz, false),
    'is_admin', p.role = 'admin',
    'trial_available', false,
    'requested', exists (select 1 from public.plus_requests r where r.user_id = v_me),
    'price_cents', round(public._pls('plus_price_eur') * 100),
    'days', public._pls('plus_days'),
    'coin_price', public._pls('plus_price_d1'),
    'coin_days', 1,
    'tiers', public._plus_tiers(),
    'coin_mult', public._pls('plus_coin_mult'),
    'points_mult', public._pls('plus_points_mult'),
    'gamble_boost', public._pls('plus_gamble_boost_percent'),
    'revive_price', public._pls('plus_revive_price'),
    'ai_enabled', public._pls('ai_enabled') >= 1,
    'ai_state', s.state,
    'ai_message', s.message,
    'max_items', public._pls('ai_max_items'),
    'test_sentences', public._pls('ai_test_sentences'));
end;
$$;
