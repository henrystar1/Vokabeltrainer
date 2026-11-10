-- 0084: Limitierte Artikel (4 Stück), Handel zwischen Nutzern, Admin-Übersicht, Mod-Zuschauen bei Online-Spielen.
-- Behebt außerdem: Update-100-Artikel hatten Preis 0 und galten damit für alle als „besessen" (Limit wirkte nicht).
-- Wiederholbar.

alter table public.shop_items add column if not exists claim_only boolean not null default false;
alter table public.shop_items add column if not exists source text not null default 'shop';
alter table public.shop_items drop constraint if exists shop_items_source_check;
alter table public.shop_items add constraint shop_items_source_check check (source in ('shop', 'advent', 'both'));

-- ---------------------------------------------------------------------------------------------
-- 1) Update-100-Fix: echte Besitzpflicht
-- ---------------------------------------------------------------------------------------------
update public.shop_items set price = 1, claim_only = true where id in ('tag_u100', 'theme_u100_gold');

-- Wer die Artikel ausgewählt hat, ohne sie zu besitzen: die ältesten Konten bekommen sie bis zum Limit, alle anderen verlieren sie.
do $$
declare
  v_id text;
  v_kind text;
  v_lim integer;
  v_taken bigint;
  r record;
begin
  for v_id in select unnest(array['tag_u100', 'theme_u100_gold']) loop
    select kind, limited into v_kind, v_lim from public.shop_items where id = v_id;
    select count(*) into v_taken from public.user_items where item_id = v_id;
    for r in
      select p.id as uid
        from public.profiles p
       where ((v_kind = 'tag' and p.tag_id = v_id) or (v_kind = 'theme' and p.theme_id = v_id))
         and not exists (select 1 from public.user_items u where u.user_id = p.id and u.item_id = v_id)
       order by p.created_at
    loop
      if v_taken < v_lim then
        insert into public.user_items (user_id, item_id) values (r.uid, v_id) on conflict do nothing;
        v_taken := v_taken + 1;
      else
        update public.profiles
           set tag_id = case when v_kind = 'tag' then null else tag_id end,
               theme_id = case when v_kind = 'theme' then null else theme_id end
         where id = r.uid;
      end if;
    end loop;
  end loop;
end $$;

-- ---------------------------------------------------------------------------------------------
-- 2) Neue limitierte Artikel (je 4 Stück). source: shop | advent | both
-- ---------------------------------------------------------------------------------------------
insert into public.shop_items (id, kind, name, price, sort, active, limited, source) values
  ('tag_ltd_phoenix', 'tag',   'Phönix',        8000,  9100, true, 4, 'shop'),
  ('theme_ltd_polar', 'theme', 'Polarlicht Deluxe', 12000, 9101, true, 4, 'shop'),
  ('tag_ltd_glitch',  'tag',   'Glitch',        6000,  9102, true, 4, 'advent'),
  ('theme_ltd_void',  'theme', 'Die Leere',     10000, 9103, true, 4, 'advent')
on conflict (id) do update set name = excluded.name, limited = excluded.limited, source = excluded.source, price = excluded.price;

-- ---------------------------------------------------------------------------------------------
-- 3) Kaufen: nur wenn nicht „nur abholbar"; das Limit sichert der Trigger aus 0083
-- ---------------------------------------------------------------------------------------------
create or replace function public.buy_item(p_item_id text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  v_price integer;
  v_req text;
  v_claim boolean;
  v_source text;
  v_balance integer;
begin
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  select price, required_role, claim_only, source into v_price, v_req, v_claim, v_source from public.shop_items where id = p_item_id and active;
  if v_price is null then
    raise exception 'Artikel nicht gefunden.' using errcode = 'P0002';
  end if;
  if v_req is not null or v_claim or v_source = 'advent' then
    raise exception 'Dieser Artikel ist nicht kaufbar.' using errcode = '42501';
  end if;
  if exists (select 1 from public.user_items where user_id = v_me and item_id = p_item_id) or v_price = 0 then
    raise exception 'Das gehört dir schon.' using errcode = '23505';
  end if;
  v_balance := public._grant_koins(v_me, -v_price, 'shop', p_item_id);
  begin
    insert into public.user_items (user_id, item_id) values (v_me, p_item_id);
  exception when sqlstate 'P0001' then
    raise exception 'Zu spät – alle sind schon vergeben.' using errcode = 'P0001';
  end;
  return v_balance;
end;
$$;

-- get_shop: zusätzlich Limit, Vergebene, „nur abholbar", Herkunft
drop function if exists public.get_shop();
create function public.get_shop()
returns table (id text, kind text, name text, price integer, sort integer, owned boolean, equipped boolean,
               required_role text, active boolean, custom boolean, style jsonb, svg text, plus_only boolean,
               limited integer, taken bigint, claim_only boolean, source text)
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
         i.required_role, i.active, i.custom, i.style, i.svg, i.plus_only,
         i.limited,
         case when i.limited is null then null else (select count(*) from public.user_items t where t.item_id = i.id) end,
         i.claim_only, i.source
    from public.shop_items i
    left join public.user_items o on o.item_id = i.id and o.user_id = (select auth.uid())
   where (select auth.uid()) is not null
     and (i.active or o.item_id is not null)
     and (i.source <> 'advent' or o.item_id is not null)
     and (i.required_role is null
          or public._role_rank(i.required_role) <= public._role_rank(
               (select p.role from public.profiles p where p.id = (select auth.uid()))))
   order by i.kind, i.sort, i.name;
$$;

-- u100_status zählt weiter über user_items – unverändert gültig.

-- ---------------------------------------------------------------------------------------------
-- 4) Adventskalender: Zufalls-Artikel nie limitiert; zusätzlich kleine Chance auf einen limitierten (Herkunft advent/both)
-- ---------------------------------------------------------------------------------------------
insert into public.app_settings (key, value, mod_editable) values ('advent_limited_chance', 4, false) on conflict (key) do nothing;

create or replace function public._advent_plan(p_day integer)
returns jsonb
language plpgsql
volatile
set search_path = public
as $$
declare
  v_plan jsonb := public._advent_plan_base(p_day);
  v_mult numeric := greatest(public._pls('pro_advent_mult'), 1);
  v_out jsonb := '[]'::jsonb;
  e jsonb;
begin
  if public._pro_active((select auth.uid())) then
    for e in select * from jsonb_array_elements(v_plan)
    loop
      e := case e ->> 'type'
        when 'coins' then jsonb_set(e, '{amount}', to_jsonb(round((e ->> 'amount')::numeric * v_mult)::bigint))
        when 'points' then jsonb_set(e, '{amount}', to_jsonb(round((e ->> 'amount')::numeric * v_mult)::bigint))
        when 'item' then jsonb_set(e, '{max_price}', to_jsonb(round((e ->> 'max_price')::numeric * v_mult)::bigint))
        when 'plus' then jsonb_set(e, '{days}', to_jsonb((e ->> 'days')::integer + public._pls('pro_advent_plus_days')::integer))
        else e end;
      v_out := v_out || jsonb_build_array(e);
    end loop;
  else
    v_out := v_plan;
  end if;
  if random() * 100 < public.setting('advent_limited_chance') then
    v_out := v_out || jsonb_build_array(jsonb_build_object('type', 'limited'));
  end if;
  return v_out;
end;
$$;

create or replace function public.advent_open(p_day integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  v_today integer := public._advent_today();
  v_year integer := public._advent_year();
  v_plan jsonb;
  v_r jsonb;
  v_out jsonb := '[]'::jsonb;
  v_item record;
  v_amount bigint;
begin
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht erlaubt.' using errcode = '42501';
  end if;
  if v_today = 0 then
    raise exception 'Der Adventskalender ist nur vom 1. bis 24. Dezember offen.' using errcode = '22023';
  end if;
  if p_day is distinct from v_today then
    raise exception 'Heute kannst du nur Türchen % öffnen.', v_today using errcode = '22023';
  end if;
  begin
    insert into public.advent_opened (user_id, year, day) values (v_me, v_year, p_day);
  exception when unique_violation then
    raise exception 'Dieses Türchen hast du schon geöffnet.' using errcode = '23505';
  end;

  v_plan := public._advent_plan(p_day);
  for v_r in select * from jsonb_array_elements(v_plan) loop
    case v_r ->> 'type'
      when 'coins' then
        perform public._grant_koins(v_me, (v_r ->> 'amount')::bigint, 'advent', 'day' || p_day);
        v_out := v_out || v_r;
      when 'points' then
        insert into public.points_adjustments (user_id, points, reason, created_by)
        values (v_me, (v_r ->> 'amount')::integer, 'Adventskalender ' || p_day, null);
        v_out := v_out || v_r;
      when 'plus' then
        update public.profiles
           set plus_until = greatest(coalesce(plus_until, now()), now()) + make_interval(days => (v_r ->> 'days')::integer)
         where id = v_me;
        v_out := v_out || v_r;
      when 'limited' then
        -- Limitierter Artikel: nur wenn noch einer frei ist und ich ihn nicht habe; sonst gibt es dazu nichts.
        select i.id, i.kind, i.name, i.price into v_item
          from public.shop_items i
         where i.limited is not null and i.active and i.source in ('advent', 'both')
           and not exists (select 1 from public.user_items u where u.user_id = v_me and u.item_id = i.id)
           and (select count(*) from public.user_items t where t.item_id = i.id) < i.limited
         order by random() limit 1;
        if found then
          begin
            insert into public.user_items (user_id, item_id) values (v_me, v_item.id);
            v_out := v_out || jsonb_build_object('type', 'item', 'id', v_item.id, 'kind', v_item.kind, 'name', v_item.name, 'price', v_item.price);
          exception when sqlstate 'P0001' then
            null;
          end;
        end if;
      when 'item' then
        if v_r ? 'id' then
          select i.id, i.kind, i.name, i.price into v_item from public.shop_items i where i.id = v_r ->> 'id';
        else
          select i.id, i.kind, i.name, i.price into v_item
            from public.shop_items i
           where i.kind in ('avatar', 'color', 'effect', 'theme')
             and i.limited is null and i.claim_only = false
             and i.price > 0 and i.price <= coalesce((v_r ->> 'max_price')::integer, 1000)
             and not exists (select 1 from public.user_items u where u.user_id = v_me and u.item_id = i.id)
           order by random() limit 1;
        end if;
        if not found then
          v_amount := 100;
          perform public._grant_koins(v_me, v_amount, 'advent', 'day' || p_day);
          v_out := v_out || jsonb_build_object('type', 'coins', 'amount', v_amount);
        elsif exists (select 1 from public.user_items where user_id = v_me and item_id = v_item.id) then
          v_amount := greatest(v_item.price / 2, 50);
          perform public._grant_koins(v_me, v_amount, 'advent', 'day' || p_day);
          v_out := v_out || jsonb_build_object('type', 'coins', 'amount', v_amount, 'dup', v_item.name);
        else
          insert into public.user_items (user_id, item_id) values (v_me, v_item.id);
          v_out := v_out || jsonb_build_object('type', 'item', 'id', v_item.id, 'kind', v_item.kind, 'name', v_item.name, 'price', v_item.price);
        end if;
      else null;
    end case;
  end loop;

  update public.advent_opened set rewards = v_out where user_id = v_me and year = v_year and day = p_day;
  return jsonb_build_object('day', p_day, 'rewards', v_out);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- 5) Admin: wem gehören die limitierten Artikel?
-- ---------------------------------------------------------------------------------------------
create or replace function public.admin_limited_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public._require_admin();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'item_id', i.id, 'name', i.name, 'kind', i.kind, 'limited', i.limited, 'source', i.source, 'price', i.price,
      'holders', coalesce((
        select jsonb_agg(jsonb_build_object('user_id', u.user_id, 'name', p.display_name, 'at', u.acquired_at,
                                            'listed_price', (select o.price from public.item_offers o where o.item_id = i.id and o.seller_id = u.user_id and o.status = 'open' limit 1))
                         order by u.acquired_at)
          from public.user_items u join public.profiles p on p.id = u.user_id where u.item_id = i.id), '[]'::jsonb)
    ) order by i.sort)
    from public.shop_items i where i.limited is not null), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- 6) Handel zwischen Nutzern (Angebote + Gebote, Preise verhandelbar)
-- ---------------------------------------------------------------------------------------------
create table if not exists public.item_offers (
  id uuid primary key default gen_random_uuid(),
  item_id text not null references public.shop_items (id) on delete cascade,
  seller_id uuid not null references public.profiles (id) on delete cascade,
  price integer not null check (price between 1 and 1000000000),
  status text not null default 'open' check (status in ('open', 'sold', 'cancelled')),
  buyer_id uuid references public.profiles (id) on delete set null,
  sold_price integer,
  created_at timestamptz not null default now(),
  closed_at timestamptz
);
create unique index if not exists item_offers_open_idx on public.item_offers (item_id, seller_id) where status = 'open';
create table if not exists public.item_bids (
  id uuid primary key default gen_random_uuid(),
  offer_id uuid not null references public.item_offers (id) on delete cascade,
  bidder_id uuid not null references public.profiles (id) on delete cascade,
  price integer not null check (price between 1 and 1000000000),
  status text not null default 'open' check (status in ('open', 'accepted', 'declined', 'withdrawn')),
  created_at timestamptz not null default now()
);
create unique index if not exists item_bids_open_idx on public.item_bids (offer_id, bidder_id) where status = 'open';
alter table public.item_offers enable row level security;
alter table public.item_bids enable row level security;
revoke all on public.item_offers, public.item_bids from anon, authenticated;

create or replace function public._trade_check()
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_me uuid := (select auth.uid());
begin
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht erlaubt.' using errcode = '42501';
  end if;
  return v_me;
end;
$$;

-- Verkauf ausführen: Coins buyer → seller (ohne Plus-Bonus), Artikel wechselt den Besitzer, Auswahl des Verkäufers fällt weg.
create or replace function public._trade_execute(p_offer uuid, p_buyer uuid, p_price integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  o public.item_offers;
begin
  select * into o from public.item_offers where id = p_offer for update;
  if o.id is null or o.status <> 'open' then
    raise exception 'Das Angebot gibt es nicht mehr.' using errcode = 'P0002';
  end if;
  if p_buyer = o.seller_id then
    raise exception 'Du kannst nicht von dir selbst kaufen.' using errcode = '22023';
  end if;
  if exists (select 1 from public.user_items where user_id = p_buyer and item_id = o.item_id) then
    raise exception 'Das gehört dir schon.' using errcode = '23505';
  end if;
  if not exists (select 1 from public.user_items where user_id = o.seller_id and item_id = o.item_id) then
    update public.item_offers set status = 'cancelled', closed_at = now() where id = o.id;
    raise exception 'Der Verkäufer besitzt den Artikel nicht mehr.' using errcode = 'P0002';
  end if;
  perform public._grant_koins(p_buyer, -p_price, 'trade_buy', o.item_id);
  perform public._grant_koins(o.seller_id, p_price, 'pay_in', 'trade:' || o.item_id);
  update public.user_items set user_id = p_buyer, acquired_at = now() where user_id = o.seller_id and item_id = o.item_id;
  update public.profiles
     set avatar_id = case when avatar_id = o.item_id then null else avatar_id end,
         color_id = case when color_id = o.item_id then null else color_id end,
         effect_id = case when effect_id = o.item_id then null else effect_id end,
         theme_id = case when theme_id = o.item_id then null else theme_id end,
         tag_id = case when tag_id = o.item_id then null else tag_id end
   where id = o.seller_id;
  update public.item_offers set status = 'sold', buyer_id = p_buyer, sold_price = p_price, closed_at = now() where id = o.id;
  update public.item_bids set status = case when bidder_id = p_buyer and price = p_price then 'accepted' else 'declined' end
   where offer_id = o.id and status = 'open';
  -- eigene offene Gebote des Käufers auf diesen Artikel bei anderen Angeboten sind jetzt sinnlos
  update public.item_bids b set status = 'withdrawn'
   where b.bidder_id = p_buyer and b.status = 'open'
     and b.offer_id in (select id from public.item_offers where item_id = o.item_id and status = 'open');
end;
$$;

create or replace function public.trade_list(p_item text, p_price integer)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := public._trade_check();
  v_id uuid;
begin
  if p_price is null or p_price < 1 then
    raise exception 'Bitte einen Preis ab 1 Coin angeben.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.shop_items where id = p_item and limited is not null) then
    raise exception 'Dieser Artikel ist nicht handelbar.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.user_items where user_id = v_me and item_id = p_item) then
    raise exception 'Das gehört dir nicht.' using errcode = '42501';
  end if;
  insert into public.item_offers (item_id, seller_id, price) values (p_item, v_me, p_price)
  on conflict (item_id, seller_id) where status = 'open' do update set price = excluded.price
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.trade_cancel(p_offer uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_me uuid := public._trade_check();
begin
  update public.item_offers set status = 'cancelled', closed_at = now() where id = p_offer and seller_id = v_me and status = 'open';
  if not found then
    raise exception 'Angebot nicht gefunden.' using errcode = 'P0002';
  end if;
  update public.item_bids set status = 'declined' where offer_id = p_offer and status = 'open';
end;
$$;

create or replace function public.trade_buy(p_offer uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := public._trade_check();
  v_price integer;
begin
  select price into v_price from public.item_offers where id = p_offer and status = 'open';
  if v_price is null then
    raise exception 'Das Angebot gibt es nicht mehr.' using errcode = 'P0002';
  end if;
  perform public._trade_execute(p_offer, v_me, v_price);
end;
$$;

create or replace function public.trade_bid(p_offer uuid, p_price integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := public._trade_check();
  o public.item_offers;
begin
  if p_price is null or p_price < 1 then
    raise exception 'Bitte ein Gebot ab 1 Coin angeben.' using errcode = '22023';
  end if;
  select * into o from public.item_offers where id = p_offer and status = 'open';
  if o.id is null then
    raise exception 'Das Angebot gibt es nicht mehr.' using errcode = 'P0002';
  end if;
  if o.seller_id = v_me then
    raise exception 'Auf dein eigenes Angebot kannst du nicht bieten.' using errcode = '22023';
  end if;
  if exists (select 1 from public.user_items where user_id = v_me and item_id = o.item_id) then
    raise exception 'Das gehört dir schon.' using errcode = '23505';
  end if;
  insert into public.item_bids (offer_id, bidder_id, price) values (p_offer, v_me, p_price)
  on conflict (offer_id, bidder_id) where status = 'open' do update set price = excluded.price, created_at = now();
end;
$$;

create or replace function public.trade_bid_cancel(p_bid uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_me uuid := public._trade_check();
begin
  update public.item_bids set status = 'withdrawn' where id = p_bid and bidder_id = v_me and status = 'open';
end;
$$;

create or replace function public.trade_accept(p_bid uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := public._trade_check();
  b public.item_bids;
begin
  select b2.* into b from public.item_bids b2 join public.item_offers o on o.id = b2.offer_id
   where b2.id = p_bid and b2.status = 'open' and o.seller_id = v_me and o.status = 'open';
  if b.id is null then
    raise exception 'Gebot nicht gefunden.' using errcode = 'P0002';
  end if;
  perform public._trade_execute(b.offer_id, b.bidder_id, b.price);
end;
$$;

create or replace function public.trade_decline(p_bid uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_me uuid := public._trade_check();
begin
  update public.item_bids b set status = 'declined'
   where b.id = p_bid and b.status = 'open'
     and exists (select 1 from public.item_offers o where o.id = b.offer_id and o.seller_id = v_me);
end;
$$;

-- Marktplatz: offene Angebote, meine Gebote, (als Verkäufer) die Gebote auf meine Angebote, letzte Verkäufe
create or replace function public.trade_market()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_me uuid := public._trade_check();
begin
  return jsonb_build_object(
    'offers', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', o.id, 'item_id', o.item_id, 'name', i.name, 'kind', i.kind, 'price', o.price,
        'seller', p.display_name, 'mine', o.seller_id = v_me, 'since', o.created_at,
        'my_bid', (select b.price from public.item_bids b where b.offer_id = o.id and b.bidder_id = v_me and b.status = 'open'),
        'my_bid_id', (select b.id from public.item_bids b where b.offer_id = o.id and b.bidder_id = v_me and b.status = 'open'),
        'bid_count', (select count(*) from public.item_bids b where b.offer_id = o.id and b.status = 'open'),
        'bids', case when o.seller_id = v_me then coalesce((
                   select jsonb_agg(jsonb_build_object('id', b.id, 'name', bp.display_name, 'price', b.price) order by b.price desc)
                     from public.item_bids b join public.profiles bp on bp.id = b.bidder_id
                    where b.offer_id = o.id and b.status = 'open'), '[]'::jsonb) else '[]'::jsonb end,
        'owned', exists (select 1 from public.user_items u where u.user_id = v_me and u.item_id = o.item_id)
      ) order by o.created_at desc)
        from public.item_offers o
        join public.shop_items i on i.id = o.item_id
        join public.profiles p on p.id = o.seller_id
       where o.status = 'open'), '[]'::jsonb),
    'history', coalesce((
      select jsonb_agg(h.j order by h.at desc) from (
        select o.closed_at as at, jsonb_build_object('name', i.name, 'price', o.sold_price, 'at', o.closed_at) as j
          from public.item_offers o join public.shop_items i on i.id = o.item_id
         where o.status = 'sold' order by o.closed_at desc limit 10) h), '[]'::jsonb),
    'mine', coalesce((
      select jsonb_agg(jsonb_build_object('item_id', i.id, 'name', i.name, 'kind', i.kind,
                       'listed', exists (select 1 from public.item_offers o where o.item_id = i.id and o.seller_id = v_me and o.status = 'open')) order by i.sort)
        from public.user_items u join public.shop_items i on i.id = u.item_id
       where u.user_id = v_me and i.limited is not null), '[]'::jsonb)
  );
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- 7) Mods dürfen Online-Spiele ansehen (inkl. gegnerischer Schiffe) – pro Person / als Standard
-- ---------------------------------------------------------------------------------------------
insert into public.app_settings (key, value, mod_editable) values ('mod_see_games', 0, false) on conflict (key) do nothing;
alter table public.staff_extra add column if not exists see_games boolean;

create or replace function public._can_see_games()
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when public.is_admin() then true
    when not public.is_staff() then false
    else coalesce((select e.see_games from public.staff_extra e where e.user_id = (select auth.uid())),
                  public.setting('mod_see_games') = 1)
  end;
$$;

create or replace function public.staff_can_see_games()
returns boolean language sql stable security definer set search_path = public as $$
  select public._can_see_games();
$$;

drop function if exists public.admin_get_staff_extra(uuid);
create function public.admin_get_staff_extra(p_user uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public._require_admin();
  return coalesce((select jsonb_build_object('see_online', e.see_online, 'see_games', e.see_games) from public.staff_extra e where e.user_id = p_user),
                  jsonb_build_object('see_online', null, 'see_games', null));
end;
$$;

drop function if exists public.admin_set_staff_extra(uuid, boolean);
create function public.admin_set_staff_extra(p_user uuid, p_key text, p_value boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public._require_admin();
  if p_key not in ('see_online', 'see_games') then
    raise exception 'Unbekanntes Recht.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.profiles where id = p_user and role in ('mod', 'alphamod')) then
    raise exception 'Nur für Mods und Alphamods.' using errcode = '22023';
  end if;
  insert into public.staff_extra (user_id) values (p_user) on conflict do nothing;
  if p_key = 'see_online' then
    update public.staff_extra set see_online = p_value where user_id = p_user;
  else
    update public.staff_extra set see_games = p_value where user_id = p_user;
  end if;
end;
$$;

-- Laufende Spiele (Zuschauen)
create or replace function public.og_spectate_list()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public._can_see_games() then
    raise exception 'Dafür fehlt dir das Recht.' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', g.id, 'kind', g.kind, 'status', g.status, 'updated_at', g.updated_at,
      'players', (select jsonb_agg(pr.display_name order by coalesce(p.seat, 9)) from public.og_players p join public.profiles pr on pr.id = p.user_id
                   where p.game_id = g.id and p.join_state = 'joined')) order by g.updated_at desc)
      from public.og_games g where g.status in ('lobby', 'running')), '[]'::jsonb);
end;
$$;

-- Vollständige Sicht auf ein Spiel: alle Geheimnisse (Schiffe, Auswahl) sichtbar
create or replace function public.og_spectate_view(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  g public.og_games;
begin
  if not public._can_see_games() then
    raise exception 'Dafür fehlt dir das Recht.' using errcode = '42501';
  end if;
  select * into g from public.og_games where id = p_id;
  if g.id is null then
    raise exception 'Spiel nicht gefunden.' using errcode = 'P0002';
  end if;
  return jsonb_build_object('id', g.id, 'kind', g.kind, 'status', g.status, 'version', g.version, 'host_id', g.host_id,
    'turn_seat', g.turn_seat, 'winner_seat', g.winner_seat, 'state', g.state,
    'players', coalesce((select jsonb_agg(jsonb_build_object('user_id', p.user_id, 'name', pr.display_name, 'seat', p.seat,
                                                              'join_state', p.join_state, 'secret', p.secret) order by coalesce(p.seat, 9))
                           from public.og_players p join public.profiles pr on pr.id = p.user_id where p.game_id = g.id), '[]'::jsonb));
end;
$$;

-- Rechte
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig, p.proname
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('buy_item', 'get_shop', 'advent_open', '_advent_plan', 'admin_limited_overview',
       '_trade_check', '_trade_execute', 'trade_list', 'trade_cancel', 'trade_buy', 'trade_bid', 'trade_bid_cancel', 'trade_accept',
       'trade_decline', 'trade_market', '_can_see_games', 'staff_can_see_games', 'admin_get_staff_extra', 'admin_set_staff_extra',
       'og_spectate_list', 'og_spectate_view')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    if r.proname not like '\_%' then execute format('grant execute on function %s to authenticated', r.sig); end if;
  end loop;
end $$;
