-- ============================================================================
-- 0018: 3D-Druck-Shop – Katalog, Farben, Preisrechner, Bestellungen, eigene Anfragen,
-- Fortschritt, Rabatt per Coins, Sperren für Spam, Dateiablage.
-- Wiederholbar. Nach 0017 ausführen. Alle Tabellen nur per Funktion erreichbar (kein RLS-Zugriff).
-- Geld wird in Cent gespeichert; bezahlt wird bei der Übergabe (kein Bezahlsystem).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Einstellungen (alle Werte stellt der Admin selbst ein)
-- ----------------------------------------------------------------------------

create table if not exists public.print_settings (
  key text primary key,
  value numeric not null,
  label text not null,
  unit text not null default '',
  hint text not null default '',
  min_value numeric not null default 0,
  max_value numeric not null default 100000,
  sort integer not null default 100
);
alter table public.print_settings enable row level security;
revoke all on public.print_settings from anon, authenticated;

-- Beschriftungen und Grenzen werden bei jedem Lauf aktualisiert, die Werte des Admins bleiben erhalten.
insert into public.print_settings (key, value, label, unit, hint, min_value, max_value, sort) values
  ('orders_open',        1,     'Bestellungen offen',                 '1 = ja, 0 = nein', 'Bei 0 kann niemand etwas Neues bestellen (z. B. Urlaub, Drucker kaputt).', 0, 1, 10),
  ('filament_eur_per_kg', 22,   'Filamentpreis',                      '€ pro kg',  'Was dich 1 kg Filament kostet.', 0, 500, 20),
  ('filament_density',   1.24,  'Dichte des Filaments',               'g/cm³',     'PLA ≈ 1,24, PETG ≈ 1,27, ABS ≈ 1,04.', 0.5, 3, 30),
  ('material_share',     35,    'Materialanteil (Wände + Füllung)',   '%',         'Welcher Teil des Modellvolumens wirklich Filament ist. Typisch 20–40.', 5, 100, 40),
  ('extrude_cm3_per_h',  20,    'Druckgeschwindigkeit',               'cm³ Material/h', 'Wie viel Filament dein Drucker pro Stunde verarbeitet. Daraus entsteht die geschätzte Druckzeit.', 1, 500, 50),
  ('setup_minutes',      5,     'Rüstzeit pro Auftrag',               'Minuten',   'Aufheizen, Ablösen, Nacharbeit.', 0, 600, 60),
  ('power_watts',        120,   'Stromverbrauch des Druckers',        'Watt',      'Durchschnitt während des Drucks.', 1, 3000, 70),
  ('eur_per_kwh',        0.35,  'Strompreis',                         '€ pro kWh', '', 0, 5, 80),
  ('machine_eur_per_h',  0.30,  'Maschinenkosten (Verschleiß)',       '€ pro Stunde', 'Düse, Riemen, Druckbett usw.', 0, 100, 90),
  ('base_fee_eur',       1.00,  'Aufwand pro Auftrag',                '€',         'Feste Pauschale für Vorbereitung und Übergabe.', 0, 100, 100),
  ('margin_percent',     25,    'Aufschlag',                          '%',         'Auf Material, Strom und Maschine.', 0, 500, 110),
  ('min_price_eur',      1.50,  'Mindestpreis',                       '€',         'Darunter wird nichts verkauft.', 0, 100, 120),
  ('rush_fee_eur',       2.00,  'Aufpreis „Beschleunigt“',            '€',         'Beschleunigte Aufträge kommen in der Warteschlange nach vorn.', 0, 100, 130),
  ('discount_coins',     1000,  'Rabatt: Preis in Coins',             'Coins',     'So viele Coins kostet der Rabatt (einmal je Bestellung).', 1, 1000000000, 140),
  ('discount_percent',   10,    'Rabatt: Höhe',                       '%',         'Gilt für den Artikelpreis, nicht für „Beschleunigt“. Nicht stapelbar.', 0, 50, 150),
  ('max_open_requests',  3,     'Offene Anfragen pro Person',         'Stück',     'Anti-Spam: so viele unbeantwortete Anfragen gleichzeitig.', 1, 50, 160),
  ('max_orders_per_day', 8,     'Bestellungen pro Person und Tag',    'Stück',     'Anti-Spam.', 1, 100, 170),
  ('max_qty',            10,    'Höchste Stückzahl',                  'Stück',     'Pro Bestellung.', 1, 100, 180),
  ('max_volume_cm3',     2000,  'Größtes Teil (Volumen)',             'cm³',       'Größere STL-Dateien werden abgelehnt.', 1, 20000, 190),
  ('goal_visible',       1,     'Verdienst-Anzeige zeigen',           '1 = ja, 0 = nein', 'Balken „So viel vom Ziel ist schon verdient“ oben im 3D-Druck-Shop.', 0, 1, 200),
  ('goal_eur',           20,    'Ziel (z. B. Claude Pro)',            '€',         'Betrag, den der Balken als 100 % nimmt.', 1, 100000, 210),
  ('goal_offset_eur',    0,     'Verdienst-Korrektur',                '€',         'Wird zum Umsatz der übergebenen Bestellungen addiert (auch negativ, z. B. für Bargeld ohne Bestellung).', -100000, 100000, 220)
on conflict (key) do update
  set label = excluded.label, unit = excluded.unit, hint = excluded.hint,
      min_value = excluded.min_value, max_value = excluded.max_value, sort = excluded.sort;

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
