-- 0105: Chips-Rangliste, Gambling-Auszahlung in Prozent, Börse: Trend und Treiber-Multiplikator je Aktie. Wiederholbar. Nach 0104 ausführen.

-- 1. Chips-Rangliste (Top 50 nach Chip-Guthaben) und eigener Platz
create or replace function public.get_chip_leaderboard()
returns table (rank integer, user_id uuid, display_name text, avatar_id text, color_id text, effect_id text, role text,
               tag_id text, theme_id text, chips bigint)
language sql stable security definer set search_path = public as $$
  select (row_number() over (order by w.chips desc, p.display_name))::integer,
         p.id, p.display_name, p.avatar_id, p.color_id, p.effect_id,
         case when p.tags_hidden then 'user' else p.role end,
         case when p.tags_hidden then null else p.tag_id end,
         p.theme_id, w.chips
    from public.chip_wallets w
    join public.profiles p on p.id = w.user_id
   where (select auth.uid()) is not null and not public.is_blocked() and not p.blocked and w.chips > 0
   order by w.chips desc, p.display_name
   limit 50;
$$;

create or replace function public.get_my_chip_rank()
returns integer language sql stable security definer set search_path = public as $$
  select (select count(*) + 1
            from public.chip_wallets w join public.profiles p on p.id = w.user_id
           where not p.blocked and w.chips > coalesce((select chips from public.chip_wallets where user_id = (select auth.uid())), 0))::integer;
$$;

-- 2. Gambling: Auszahlung in % des Normalen (100 = normal, 0 = −100 %, 150 = +50 %)
insert into public.app_settings (key, value, mod_editable) values ('gambling_payout_percent', 100, false) on conflict (key) do nothing;

create or replace function public._pay_adj(p_pay bigint)
returns bigint language sql stable security definer set search_path = public as $$
  select case when coalesce(p_pay, 0) <= 0 then 0::bigint
              else least(floor(p_pay::numeric * greatest(coalesce((select value from public.app_settings where key = 'gambling_payout_percent'), 100), 0) / 100.0), 9000000000000000)::bigint end
$$;

do $$
declare r record; v_def text; v_new text;
begin
  for r in
    select p.oid, p.proname from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.proname in ('gambling_play', 'gambling_roulette', 'gambling_dice', 'gambling_wheel', 'blackjack_start', 'blackjack_action')
  loop
    v_def := pg_get_functiondef(r.oid);
    if position('_pay_adj' in v_def) > 0 then continue; end if;
    v_new := regexp_replace(v_def, 'v_balance := public\._gamble_settle\(v_me, ([^,]+), (v_pay|v_payout),', E'\\2 := public._pay_adj(\\2); v_balance := public._gamble_settle(v_me, \\1, \\2,', 'g');
    v_new := regexp_replace(v_new, 'v_balance := public\._bj_finish\(([^,]+), ([^,]+), v_pay\)', E'v_pay := public._pay_adj(v_pay); v_balance := public._bj_finish(\\1, \\2, v_pay)', 'g');
    if v_new <> v_def then execute v_new; end if;
  end loop;
end;
$$;

-- 3. Börse: je Aktie eigener Trend (% pro Woche, auch negativ) und Stärke des Treibers (% vom Normalwert)
alter table public.stock_symbols add column if not exists trend_percent numeric check (trend_percent is null or (trend_percent >= -90 and trend_percent <= 1000));
alter table public.stock_symbols add column if not exists driver_mult_percent numeric not null default 100 check (driver_mult_percent >= 0 and driver_mult_percent <= 10000);
-- SHOPX stieg viel zu schnell: Standard jetzt nur noch ein Viertel der Treiber-Stärke
update public.stock_symbols set driver_mult_percent = 25 where symbol = 'SHOPX' and driver_mult_percent = 100;

create or replace function public.admin_stock_tune(p_symbol text, p_trend numeric, p_mult numeric)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public._require_admin();
  if p_trend is not null and (p_trend < -90 or p_trend > 1000) then raise exception 'Trend: -90 bis 1000 %% pro Woche.' using errcode = '22023'; end if;
  if p_mult is null or p_mult < 0 or p_mult > 10000 then raise exception 'Multiplikator: 0 bis 10000 %%.' using errcode = '22023'; end if;
  update public.stock_symbols set trend_percent = p_trend, driver_mult_percent = p_mult where symbol = p_symbol;
  if not found then raise exception 'Aktie nicht gefunden.' using errcode = 'P0002'; end if;
end;
$$;

create or replace function public.admin_stock_tune_list()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public._require_admin();
  return coalesce((select jsonb_agg(jsonb_build_object('symbol', s.symbol, 'name', s.name, 'driver', s.driver, 'trend', s.trend_percent, 'mult', s.driver_mult_percent) order by s.sort, s.symbol) from public.stock_symbols s), '[]'::jsonb);
end;
$$;

create or replace function public._stock_tick()
returns void language plpgsql security definer set search_path = public as $$
declare
  s record; q public.stock_quotes; v_steps integer; v_n integer; v_k numeric; v_p numeric; i integer;
  v_vol numeric := greatest(public.setting('stock_volatility_permille'), 0) / 1000.0;
  v_g numeric := greatest(public.setting('stock_weekly_growth_percent'), -90);
  v_d numeric;
  v_t timestamptz; v_prev_h timestamptz; v_h timestamptz;
  v_today date := (now() at time zone 'Europe/Berlin')::date;
  v_gd numeric := 0; v_sd numeric := 0; v_gl bigint; v_sl bigint; v_max bigint; v_cmax bigint;
  v_gdone boolean := false; v_sdone boolean := false;
  v_str numeric := greatest(public.setting('stock_driver_strength_permille'), 0) / 1000.0;
  v_scale numeric := greatest(public.setting('stock_driver_scale'), 1);
  v_jump numeric;
begin
  perform pg_advisory_xact_lock(hashtext('stock_tick'));
  select last_id into v_gl from public.stock_driver where driver = 'gambling';
  select last_id into v_sl from public.stock_driver where driver = 'shop';
  select coalesce(max(id), 0) into v_max from public.koin_ledger;
  select coalesce(max(id), 0) into v_cmax from public.chip_ledger;
  if v_gl is not null then
    select coalesce(-sum(amount), 0) * greatest(public.setting('chip_rate'), 1) into v_gd from public.chip_ledger where id > v_gl and id <= v_cmax and reason in ('gambling_bet', 'gambling_win');
  end if;
  if v_sl is not null then
    select coalesce(-sum(amount), 0) into v_sd from public.koin_ledger where id > v_sl and id <= v_max and amount < 0 and reason in ('shop', 'plus_buy', 'pro_buy', 'trade_buy');
  end if;
  for s in select symbol, base_cents, driver, trend_percent, driver_mult_percent from public.stock_symbols loop
    select * into q from public.stock_quotes where symbol = s.symbol;
    if q.symbol is null then
      insert into public.stock_quotes (symbol, price_cents, prev_close_cents, updated_at) values (s.symbol, s.base_cents, s.base_cents, now());
      insert into public.stock_history (symbol, at, price_cents) values (s.symbol, date_trunc('hour', now()), s.base_cents) on conflict do nothing;
      continue;
    end if;
    v_steps := least(40320, floor(extract(epoch from now() - q.updated_at) / 60)::integer);
    if v_steps < 1 then continue; end if;
    v_d := ln(1 + coalesce(s.trend_percent, v_g) / 100.0) / 10080.0;
    v_n := least(v_steps, 120);
    v_k := v_steps::numeric / v_n;
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
      v_jump := exp(v_str * (s.driver_mult_percent / 100.0) * tanh(v_gd / v_scale)); v_gdone := true;
      v_p := least(greatest(v_p * v_jump, s.base_cents * 0.2, 100), 1000000000000);
    elsif s.driver = 'shop' then
      v_jump := exp(v_str * (s.driver_mult_percent / 100.0) * tanh(v_sd / v_scale)); v_sdone := true;
      v_p := least(greatest(v_p * v_jump, s.base_cents * 0.2, 100), 1000000000000);
    end if;
    update public.stock_quotes
       set price_cents = round(v_p),
           prev_close_cents = case when (q.updated_at at time zone 'Europe/Berlin')::date < v_today then q.price_cents else q.prev_close_cents end,
           updated_at = case when v_steps >= 40320 then now() else q.updated_at + v_steps * interval '1 minute' end
     where symbol = s.symbol;
  end loop;
  if v_gdone and v_gl is not null then update public.stock_driver set last_id = v_cmax where driver = 'gambling'; end if;
  if v_sdone and v_sl is not null then update public.stock_driver set last_id = v_max where driver = 'shop'; end if;
  if random() < 0.02 then delete from public.stock_history where at < now() - interval '120 days'; end if;
end;
$$;

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('get_chip_leaderboard', 'get_my_chip_rank', '_pay_adj', 'admin_stock_tune', 'admin_stock_tune_list', '_stock_tick')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    if left(r.proname, 1) <> '_' then
      execute format('grant execute on function %s to authenticated', r.sig);
    end if;
  end loop;
end;
$$;
