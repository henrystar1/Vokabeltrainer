-- 0097: Chips fürs Gambling. Gespielt wird nur noch mit Chips (1 Chip = 10 Coins), nicht mehr mit Coins.
-- Chips kauft man mit Coins (höchstens 1.000 pro Tag), dazu gibt es jeden Tag 100 Chips geschenkt, Chips lassen sich zurücktauschen.
-- Nach 3 Verlusten hintereinander sind Einsätze 10 Sekunden gesperrt (das Portemonnaie wird leer geschüttelt). Wiederholbar.
-- Die Spiele selbst (Automat, Roulette, Würfeln, Glücksrad, Black Jack) bleiben, rechnen aber mit Chips.

create table if not exists public.chip_wallets (
  user_id uuid primary key references auth.users(id) on delete cascade,
  chips bigint not null default 0 check (chips >= 0 and chips <= 9000000000000000),
  loss_streak integer not null default 0,
  locked_until timestamptz,
  bought_day date,
  bought bigint not null default 0,
  bonus_day date
);
alter table public.chip_wallets enable row level security;
revoke all on public.chip_wallets from anon, authenticated;

create table if not exists public.chip_ledger (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  amount bigint not null check (amount <> 0),
  reason text not null,
  created_at timestamptz not null default now()
);
create index if not exists chip_ledger_user_idx on public.chip_ledger (user_id, created_at desc);
alter table public.chip_ledger enable row level security;
revoke all on public.chip_ledger from anon, authenticated;

insert into public.app_settings (key, value, mod_editable) values
  ('chip_rate', 10, false), ('chip_daily_bonus', 100, false), ('chip_daily_buy_limit', 1000, false),
  ('chip_lock_losses', 3, false), ('chip_lock_seconds', 10, false)
on conflict (key) do nothing;

create or replace function public._chip_balance(p_user uuid)
returns bigint language sql stable security definer set search_path = public as $$
  select coalesce((select chips from public.chip_wallets where user_id = p_user), 0)
$$;

-- Einzige Stelle, an der Chips bewegt werden. Einsätze sind während der Sperre nach drei Verlusten nicht möglich.
create or replace function public._chip_grant(p_user uuid, p_amount bigint, p_reason text)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_chips bigint; v_lock timestamptz;
begin
  if p_amount = 0 then return public._chip_balance(p_user); end if;
  insert into public.chip_wallets (user_id) values (p_user) on conflict do nothing;
  if p_reason = 'gambling_bet' then
    select locked_until into v_lock from public.chip_wallets where user_id = p_user;
    if v_lock is not null and v_lock > now() then
      raise exception 'Dein Portemonnaie ist leer geschüttelt. Warte einen Moment.' using errcode = '55000';
    end if;
  end if;
  update public.chip_wallets set chips = chips + p_amount
   where user_id = p_user and chips + p_amount >= 0 and chips + p_amount <= 9000000000000000
   returning chips into v_chips;
  if v_chips is null then
    if p_amount > 0 then raise exception 'So viele Chips kannst du nicht haben.' using errcode = '22023'; end if;
    raise exception 'Nicht genug Chips.' using errcode = '23514';
  end if;
  insert into public.chip_ledger (user_id, amount, reason) values (p_user, p_amount, p_reason);
  return v_chips;
end;
$$;

-- Verlustserie: bei weniger Auszahlung als Einsatz zählt eine Runde als Verlust; nach 3 in Folge gibt es die Sperre.
create or replace function public._chip_streak(p_user uuid, p_bet bigint, p_payout bigint)
returns void language plpgsql security definer set search_path = public as $$
declare v integer;
begin
  update public.chip_wallets set loss_streak = case when p_payout < p_bet then least(loss_streak + 1, 1000) else 0 end
   where user_id = p_user returning loss_streak into v;
  if v is not null and v >= greatest(public.setting('chip_lock_losses'), 1) then
    update public.chip_wallets set loss_streak = 0, locked_until = now() + make_interval(secs => greatest(public.setting('chip_lock_seconds'), 1)) where user_id = p_user;
  end if;
end;
$$;

-- Abrechnung einer Runde (wie bisher, aber in Chips) und Verlustserie
create or replace function public._gamble_settle(p_user uuid, p_bet bigint, p_payout bigint, p_jackpot boolean)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_balance bigint;
begin
  v_balance := public._chip_grant(p_user, -p_bet, 'gambling_bet');
  if p_payout > 0 then
    v_balance := public._chip_grant(p_user, p_payout, 'gambling_win');
  end if;
  perform public._chip_streak(p_user, p_bet, p_payout);
  insert into public.gambling_feed (user_id, bet, payout, jackpot) values (p_user, p_bet, p_payout, p_jackpot);
  delete from public.gambling_feed where created_at < now() - interval '3 days';
  insert into public.gambling_stats (user_id, plays, wagered, won, best_win)
  values (p_user, 1, p_bet, p_payout, p_payout)
  on conflict (user_id) do update
    set plays = least(public.gambling_stats.plays::bigint + 1, 2000000000)::integer,
        wagered = least(public.gambling_stats.wagered::numeric + p_bet, 4000000000000000000)::bigint,
        won = least(public.gambling_stats.won::numeric + p_payout, 4000000000000000000)::bigint,
        best_win = greatest(public.gambling_stats.best_win, p_payout);
  return v_balance;
end;
$$;

create or replace function public._bj_finish(p_user uuid, p_bet bigint, p_payout bigint)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_balance bigint;
begin
  delete from public.blackjack_hands where user_id = p_user;
  if p_payout > 0 then
    v_balance := public._chip_grant(p_user, p_payout, 'gambling_win');
  else
    v_balance := public._chip_balance(p_user);
  end if;
  perform public._chip_streak(p_user, p_bet, p_payout);
  insert into public.gambling_feed (user_id, bet, payout, jackpot) values (p_user, p_bet, p_payout, false);
  delete from public.gambling_feed where created_at < now() - interval '3 days';
  insert into public.gambling_stats (user_id, plays, wagered, won, best_win)
  values (p_user, 1, p_bet, p_payout, p_payout)
  on conflict (user_id) do update
    set plays = least(public.gambling_stats.plays::bigint + 1, 2000000000)::integer,
        wagered = least(public.gambling_stats.wagered::numeric + p_bet, 4000000000000000000)::bigint,
        won = least(public.gambling_stats.won::numeric + p_payout, 4000000000000000000)::bigint,
        best_win = greatest(public.gambling_stats.best_win, p_payout);
  return v_balance;
end;
$$;

-- Die Spiele lesen und ändern jetzt Chips statt Coins (gezielter Austausch im Funktionstext, wiederholbar)
do $$
declare
  r record;
  v_def text;
  v_new text;
  k text;
begin
  for r in
    select p.oid, p.proname from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.proname in ('gambling_play', 'gambling_roulette', 'gambling_dice', 'gambling_wheel', 'blackjack_start', 'blackjack_action', 'blackjack_current')
  loop
    v_def := replace(pg_get_functiondef(r.oid), chr(13), '');
    v_new := v_def;
    foreach k in array array['v_me', 'p_user', '(select auth.uid())'] loop
      v_new := replace(v_new, 'coalesce((select balance from public.koin_wallets where user_id = ' || k || '), 0)', 'public._chip_balance(' || k || ')');
    end loop;
    v_new := regexp_replace(v_new, 'public\._grant_koins\(([^()]*?), ''gambling_(bet|win)'', null\)', 'public._chip_grant(\1, ''gambling_\2'')', 'g');
    if v_new <> v_def then
      if v_new ~ 'koin_wallets|_grant_koins' then raise exception 'Funktion %: Es sind noch Coin-Zugriffe übrig.', r.proname; end if;
      execute v_new;
    end if;
  end loop;
end $$;

-- Status: Chips, Tagesgeschenk (wird beim ersten Aufruf des Tages gutgeschrieben), Kauflimit, Sperre
drop function if exists public.chip_status();
create or replace function public.chip_status()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := public._og_check();
  v_today date := (now() at time zone 'Europe/Berlin')::date;
  v_gift bigint := 0;
  w public.chip_wallets;
  v_limit bigint := greatest(public.setting('chip_daily_buy_limit'), 0);
begin
  perform public._feature_guard('gambling');
  insert into public.chip_wallets (user_id) values (v_me) on conflict do nothing;
  select * into w from public.chip_wallets where user_id = v_me for update;
  if w.bought_day is distinct from v_today then
    update public.chip_wallets set bought_day = v_today, bought = 0 where user_id = v_me;
    w.bought := 0;
  end if;
  if w.bonus_day is distinct from v_today then
    v_gift := greatest(public.setting('chip_daily_bonus'), 0);
    update public.chip_wallets set bonus_day = v_today where user_id = v_me;
    if v_gift > 0 then perform public._chip_grant(v_me, v_gift, 'daily'); end if;
  end if;
  select * into w from public.chip_wallets where user_id = v_me;
  return jsonb_build_object(
    'chips', w.chips, 'gift', v_gift, 'bought_today', w.bought, 'buy_left', greatest(v_limit - w.bought, 0),
    'limit', v_limit, 'rate', greatest(public.setting('chip_rate'), 1), 'daily', greatest(public.setting('chip_daily_bonus'), 0),
    'lock_ms', case when w.locked_until is not null and w.locked_until > now() then ceil(extract(epoch from (w.locked_until - now())) * 1000)::bigint else 0 end);
end;
$$;

drop function if exists public.chip_buy(bigint);
create or replace function public.chip_buy(p_chips bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := public._og_check();
  v_today date := (now() at time zone 'Europe/Berlin')::date;
  v_rate bigint := greatest(public.setting('chip_rate'), 1);
  v_limit bigint := greatest(public.setting('chip_daily_buy_limit'), 0);
  v_bought bigint; v_koins bigint; st jsonb;
begin
  perform public._feature_guard('gambling');
  perform pg_advisory_xact_lock(hashtext('chips:' || v_me::text));
  if p_chips is null or p_chips < 1 or p_chips > 1000000 then raise exception 'Gib eine Anzahl Chips an.' using errcode = '22023'; end if;
  perform public.chip_status();
  select bought into v_bought from public.chip_wallets where user_id = v_me;
  if v_bought + p_chips > v_limit then
    raise exception 'Du kannst heute nur noch % Chips kaufen.', greatest(v_limit - v_bought, 0) using errcode = '22023';
  end if;
  v_koins := public._grant_koins(v_me, -(p_chips * v_rate), 'chip_buy', 'chips:' || p_chips);
  perform public._chip_grant(v_me, p_chips, 'buy');
  update public.chip_wallets set bought = bought + p_chips, bought_day = v_today where user_id = v_me;
  st := public.chip_status();
  return st || jsonb_build_object('koins', v_koins);
end;
$$;

drop function if exists public.chip_sell(bigint);
create or replace function public.chip_sell(p_chips bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := public._og_check();
  v_rate bigint := greatest(public.setting('chip_rate'), 1);
  v_koins bigint; st jsonb;
begin
  perform public._feature_guard('gambling');
  perform pg_advisory_xact_lock(hashtext('chips:' || v_me::text));
  if p_chips is null or p_chips < 1 or p_chips > 9000000000000000 / v_rate then raise exception 'Gib eine Anzahl Chips an.' using errcode = '22023'; end if;
  perform public._chip_grant(v_me, -p_chips, 'sell');
  v_koins := public._grant_koins(v_me, p_chips * v_rate, 'pay_in', 'chip_sell');
  st := public.chip_status();
  return st || jsonb_build_object('koins', v_koins);
end;
$$;

-- BANK-Aktie folgt jetzt dem Chip-Gewinn der Spielbank
update public.stock_driver set last_id = least(last_id, coalesce((select max(id) from public.chip_ledger), 0)) where driver = 'gambling';
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
  v_gd numeric := 0; v_sd numeric := 0; v_gl bigint; v_sl bigint; v_max bigint; v_cmax bigint;
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
  select coalesce(max(id), 0) into v_cmax from public.chip_ledger;
  if v_gl is not null then
    select coalesce(-sum(amount), 0) * greatest(public.setting('chip_rate'), 1) into v_gd from public.chip_ledger where id > v_gl and id <= v_cmax and reason in ('gambling_bet', 'gambling_win');
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
     where n.nspname = 'public' and p.proname in ('chip_status', 'chip_buy', 'chip_sell', '_chip_balance', '_chip_grant', '_chip_streak', '_gamble_settle', '_bj_finish', '_stock_tick')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    if left(r.proname, 1) <> '_' then
      execute format('grant execute on function %s to authenticated', r.sig);
    end if;
  end loop;
end;
$$;
