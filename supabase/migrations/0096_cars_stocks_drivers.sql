-- 0096: Mehr Autos (Rennwagen, Rallye, Muscle, Hypercars ...) mit Höchstgeschwindigkeit, und zwei neue Aktien,
-- die von der Spielbank (Gewinn der Bank) und vom Shop (ausgegebene Coins) angetrieben werden. Wiederholbar.

alter table public.cars add column if not exists top_kmh integer check (top_kmh is null or top_kmh between 50 and 400);

insert into public.cars (id, name, kind, color, price, top_kmh, sort) values
  ('flitzer', 'Flitzer', 'kleinwagen', '#f59e0b', 500, 150, 1),
  ('stadtfloh', 'Stadtfloh', 'kleinwagen', '#22c55e', 800, 155, 2),
  ('kombi', 'Familienkombi', 'kombi', '#3b82f6', 2000, 175, 3),
  ('limousine', 'Limousine', 'limousine', '#1e293b', 5000, 185, 4),
  ('gelaende', 'Geländekönig', 'suv', '#a16207', 8000, 170, 5),
  ('pickup', 'Packesel', 'pickup', '#dc2626', 10000, 165, 6),
  ('cabrio', 'Sonnenschein', 'cabrio', '#ec4899', 20000, 210, 7),
  ('sportler', 'Blitz GT', 'sportwagen', '#ef4444', 50000, 240, 8),
  ('bus', 'Partybus', 'bus', '#a855f7', 100000, 130, 9),
  ('oldtimer', 'Opa Otto', 'oldtimer', '#84cc16', 3000, 120, 10),
  ('minirakete', 'Mini-Rakete', 'kleinwagen', '#f472b6', 6000, 165, 11),
  ('schneepflug', 'Schneeflocke', 'suv', '#e2e8f0', 15000, 175, 12),
  ('duenenhuepfer', 'Dünenhüpfer', 'buggy', '#f97316', 12000, 190, 13),
  ('wuestenfuchs', 'Wüstenfuchs', 'buggy', '#eab308', 20000, 195, 14),
  ('strandfloh', 'Strandfloh', 'cabrio', '#22d3ee', 28000, 215, 15),
  ('bergfresser', 'Bergfresser', 'monstertruck', '#2563eb', 30000, 150, 16),
  ('donnerschlag', 'Donnerschlag', 'muscle', '#dc2626', 35000, 225, 17),
  ('strassenkreuzer', 'Straßenkreuzer', 'muscle', '#1e293b', 50000, 230, 18),
  ('schotterkoenig', 'Schotterkönig', 'rallye', '#7c3aed', 60000, 235, 19),
  ('schulbus', 'Turbo-Bus', 'bus', '#facc15', 70000, 150, 20),
  ('eisbaer', 'Eisbär WRX', 'rallye', '#0ea5e9', 75000, 245, 21),
  ('citrusrenner', 'Citrusrenner', 'sportwagen', '#a3e635', 90000, 250, 22),
  ('nachtfalke', 'Nachtfalke GT', 'gt', '#0f172a', 120000, 270, 23),
  ('goldpfeil', 'Goldpfeil', 'gt', '#eab308', 160000, 280, 24),
  ('rennstern', 'Rennstern R1', 'rennwagen', '#ef4444', 300000, 300, 25),
  ('phantom', 'Phantom X', 'hypercar', '#14b8a6', 400000, 300, 26),
  ('silberpfeil', 'Silberpfeil R2', 'rennwagen', '#e2e8f0', 500000, 315, 27),
  ('solar', 'Solar One', 'hypercar', '#f43f5e', 600000, 310, 28),
  ('blitzblau', 'Blauer Blitz R3', 'rennwagen', '#2563eb', 900000, 320, 29)
on conflict (id) do update set top_kmh = coalesce(public.cars.top_kmh, excluded.top_kmh);

-- Reihenfolge im Autohaus: nach Preis
update public.cars c set sort = r.rn from (select id, row_number() over (order by price, id)::integer as rn from public.cars) r where c.id = r.id;

drop function if exists public.car_list();
create or replace function public.car_list()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_me uuid := public._og_check();
begin
  perform public._feature_guard('cars');
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'kind', c.kind, 'color', c.color, 'price', c.price, 'active', c.active, 'owned', o.user_id is not null, 'top_kmh', c.top_kmh) order by c.price, c.sort)
    from public.cars c left join public.car_owned o on o.car_id = c.id and o.user_id = v_me
    where c.active or o.user_id is not null), '[]'::jsonb);
end;
$$;

-- Aktien mit Treiber
alter table public.stock_symbols add column if not exists driver text check (driver is null or driver in ('gambling', 'shop'));
create table if not exists public.stock_driver (driver text primary key, last_id bigint not null default 0);
alter table public.stock_driver enable row level security;
revoke all on public.stock_driver from anon, authenticated;
insert into public.stock_driver (driver, last_id) select d, coalesce((select max(id) from public.koin_ledger), 0) from unnest(array['gambling', 'shop']) d on conflict (driver) do nothing;

insert into public.app_settings (key, value, mod_editable) values ('stock_driver_strength_permille', 60, false), ('stock_driver_scale', 20000, false)
on conflict (key) do nothing;

insert into public.stock_symbols (symbol, name, sort, base_cents, driver) values
  ('BANK', 'Spielbank AG (steigt, wenn die Bank gewinnt)', (select coalesce(max(sort), 0) + 1 from public.stock_symbols), 100000, 'gambling'),
  ('SHOPX', 'Vokabel-Konzern (steigt, wenn im Shop Coins ausgegeben werden)', (select coalesce(max(sort), 0) + 2 from public.stock_symbols), 100000, 'shop')
on conflict (symbol) do update set driver = excluded.driver;

drop function if exists public._stock_tick();
create or replace function public._stock_tick()
returns void language plpgsql security definer set search_path = public as $$
declare
  s record; q public.stock_quotes; v_steps integer; v_n integer; v_k numeric; v_p numeric; i integer;
  v_vol numeric := greatest(public.setting('stock_volatility_permille'), 0) / 1000.0;
  v_g numeric := greatest(public.setting('stock_weekly_growth_percent'), -90);
  v_d numeric;            -- Trend pro Minute (logarithmisch)
  v_t timestamptz; v_prev_h timestamptz; v_h timestamptz;
  v_today date := (now() at time zone 'Europe/Berlin')::date;
  v_gd numeric := 0; v_sd numeric := 0; v_gl bigint; v_sl bigint; v_max bigint;
  v_gdone boolean := false; v_sdone boolean := false;
  v_str numeric := greatest(public.setting('stock_driver_strength_permille'), 0) / 1000.0;
  v_scale numeric := greatest(public.setting('stock_driver_scale'), 1);
  v_jump numeric;
begin
  perform pg_advisory_xact_lock(hashtext('stock_tick'));
  v_d := ln(1 + v_g / 100.0) / 10080.0;
  -- Treiber: Gewinn der Spielbank (Einsätze minus Gewinne) und Ausgaben im Shop seit dem letzten Mal
  select last_id into v_gl from public.stock_driver where driver = 'gambling';
  select last_id into v_sl from public.stock_driver where driver = 'shop';
  select coalesce(max(id), 0) into v_max from public.koin_ledger;
  if v_gl is not null then
    select coalesce(-sum(amount), 0) into v_gd from public.koin_ledger where id > v_gl and id <= v_max and reason in ('gambling_bet', 'gambling_win');
  end if;
  if v_sl is not null then
    select coalesce(-sum(amount), 0) into v_sd from public.koin_ledger where id > v_sl and id <= v_max and amount < 0 and reason in ('shop', 'plus_buy', 'pro_buy', 'trade_buy');
  end if;
  for s in select symbol, base_cents, driver from public.stock_symbols loop
    select * into q from public.stock_quotes where symbol = s.symbol;
    if q.symbol is null then
      insert into public.stock_quotes (symbol, price_cents, prev_close_cents, updated_at) values (s.symbol, s.base_cents, s.base_cents, now());
      insert into public.stock_history (symbol, at, price_cents) values (s.symbol, date_trunc('hour', now()), s.base_cents) on conflict do nothing;
      continue;
    end if;
    v_steps := least(40320, floor(extract(epoch from now() - q.updated_at) / 60)::integer);   -- höchstens 4 Wochen nachrechnen
    if v_steps < 1 then continue; end if;
    v_n := least(v_steps, 120);
    v_k := v_steps::numeric / v_n;                                                           -- Minuten pro Rechenschritt
    v_p := q.price_cents;
    v_prev_h := date_trunc('hour', q.updated_at);
    for i in 1..v_n loop
      v_p := v_p * exp(v_d * v_k + (random() + random() + random() - 1.5) * 2 * v_vol * sqrt(v_k));
      v_p := least(greatest(v_p, s.base_cents * 0.2, 100), 1000000000000);
      v_t := q.updated_at + (i * v_k) * interval '1 minute';
      v_h := date_trunc('hour', v_t);
      if v_h > v_prev_h then
        insert into public.stock_history (symbol, at, price_cents) values (s.symbol, v_h, round(v_p)) on conflict do nothing;
        v_prev_h := v_h;
      end if;
    end loop;
    if s.driver = 'gambling' then
      v_jump := exp(v_str * tanh(v_gd / v_scale)); v_gdone := true;
      v_p := least(greatest(v_p * v_jump, s.base_cents * 0.2, 100), 1000000000000);
    elsif s.driver = 'shop' then
      v_jump := exp(v_str * tanh(v_sd / v_scale)); v_sdone := true;
      v_p := least(greatest(v_p * v_jump, s.base_cents * 0.2, 100), 1000000000000);
    end if;
    update public.stock_quotes
       set price_cents = round(v_p),
           prev_close_cents = case when (q.updated_at at time zone 'Europe/Berlin')::date < v_today then q.price_cents else q.prev_close_cents end,
           updated_at = case when v_steps >= 40320 then now() else q.updated_at + v_steps * interval '1 minute' end
     where symbol = s.symbol;
  end loop;
  if v_gdone and v_gl is not null then update public.stock_driver set last_id = v_max where driver = 'gambling'; end if;
  if v_sdone and v_sl is not null then update public.stock_driver set last_id = v_max where driver = 'shop'; end if;
  if random() < 0.02 then delete from public.stock_history where at < now() - interval '120 days'; end if;
end;
$$;

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('_stock_tick', 'car_list')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    if left(r.proname, 1) <> '_' then
      execute format('grant execute on function %s to authenticated', r.sig);
    end if;
  end loop;
end;
$$;
