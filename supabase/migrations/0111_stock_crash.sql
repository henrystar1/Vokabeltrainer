-- 0111: Börsencrash (Admin): alle Aktien fallen innerhalb von 5 Stunden auf 0 bis 10 % ihres Kurses
alter table public.stock_symbols add column if not exists crash_at timestamptz, add column if not exists crash_from_cents bigint, add column if not exists crash_ratio numeric;

create or replace function public.admin_stock_crash()
returns integer language plpgsql security definer set search_path = public as $$
declare v_n integer;
begin
  perform public._require_admin();
  perform public._stock_tick();
  update public.stock_symbols s
     set crash_at = now(), crash_from_cents = q.price_cents, crash_ratio = random() * 0.10
    from public.stock_quotes q where q.symbol = s.symbol;
  get diagnostics v_n = row_count;
  return v_n;
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
  v_jump numeric; v_floor numeric; v_prog numeric; v_tgt numeric;
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
  for s in select symbol, base_cents, driver, trend_percent, driver_mult_percent, crash_at, crash_from_cents, crash_ratio from public.stock_symbols loop
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
    v_floor := case when s.crash_ratio is not null then 100 else s.base_cents * 0.2 end;
    v_prev_h := date_trunc('hour', q.updated_at);
    for i in 1..v_n loop
      v_p := v_p * exp(v_d * v_k + (random() + random() + random() - 1.5) * 2 * v_vol * sqrt(v_k));
      v_p := least(greatest(v_p, v_floor, 100), 1000000000000);
      v_t := q.updated_at + (i * v_k) * interval '1 minute';
      v_h := date_trunc('hour', v_t);
      if v_h > v_prev_h then
        insert into public.stock_history (symbol, at, price_cents) values (s.symbol, v_h, round(v_p)) on conflict do nothing;
        v_prev_h := v_h;
      end if;
    end loop;
    if s.driver = 'gambling' then
      v_jump := exp(v_str * (s.driver_mult_percent / 100.0) * tanh(v_gd / v_scale)); v_gdone := true;
      v_p := least(greatest(v_p * v_jump, v_floor, 100), 1000000000000);
    elsif s.driver = 'shop' then
      v_jump := exp(v_str * (s.driver_mult_percent / 100.0) * tanh(v_sd / v_scale)); v_sdone := true;
      v_p := least(greatest(v_p * v_jump, v_floor, 100), 1000000000000);
    end if;
    if s.crash_ratio is not null and s.crash_at is not null then
      -- Börsencrash: Kurs sinkt in 5 Stunden linear auf crash_ratio (0 bis 10 %) des Startkurses
      v_prog := least(1, extract(epoch from now() - s.crash_at) / 18000.0);
      v_tgt := s.crash_from_cents * (1 - v_prog * (1 - s.crash_ratio));
      v_p := greatest(least(v_p, v_tgt * (0.985 + random() * 0.03)), 100);
    end if;
    update public.stock_symbols set crash_at = null, crash_from_cents = null, crash_ratio = null
     where symbol = s.symbol and crash_ratio is not null and (extract(epoch from now() - crash_at) > 18000 and v_p >= base_cents * 0.2);
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

revoke all on function public.admin_stock_crash() from public, anon;
grant execute on function public.admin_stock_crash() to authenticated;
revoke all on function public._stock_tick() from public, anon, authenticated;
