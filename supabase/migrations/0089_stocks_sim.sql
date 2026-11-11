-- 0089: Börse vereinfacht. Keine echten Kurse mehr: der Server simuliert die Preise selbst (läuft immer, braucht keinen Schlüssel).
-- Jede Aktie hat einen Grundpreis in Coins; der Kurs schwankt zufällig im Minutentakt um diesen Grundpreis. Wiederholbar.

do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'stock_symbols' and column_name = 'base_cents') then
    alter table public.stock_symbols add column base_cents bigint;
    -- bisherige Dollar-Kurse werden zu Coins (Faktor wie bisher eingestellt)
    update public.stock_symbols s set base_cents = greatest(coalesce((select q.price_cents from public.stock_quotes q where q.symbol = s.symbol), 10000) * greatest(public.setting('stock_koin_per_usd'), 1), 100);
    update public.stock_quotes q set price_cents = greatest(price_cents * greatest(public.setting('stock_koin_per_usd'), 1), 100), prev_close_cents = greatest(prev_close_cents * greatest(public.setting('stock_koin_per_usd'), 1), 100);
  end if;
end $$;
alter table public.stock_symbols alter column base_cents set default 100000;
update public.stock_symbols set base_cents = 100000 where base_cents is null;
alter table public.stock_symbols alter column base_cents set not null;

insert into public.app_settings (key, value, mod_editable) values ('stock_volatility_permille', 15, false)
on conflict (key) do nothing;

drop function if exists public.stock_report(text, numeric, numeric);
drop function if exists public.stock_config();
drop function if exists public.admin_stock_get_key();
drop function if exists public.admin_stock_set_key(text);
drop function if exists public.admin_stock_save(text, text);
drop function if exists public._stock_tick();

-- Kurse bis jetzt weiterrechnen (höchstens 120 Minuten-Schritte am Stück).
create or replace function public._stock_tick()
returns void language plpgsql security definer set search_path = public as $$
declare
  s record; q public.stock_quotes; v_steps integer; v_p numeric; i integer;
  v_vol numeric := greatest(public.setting('stock_volatility_permille'), 0) / 1000.0;
  v_today date := (now() at time zone 'Europe/Berlin')::date;
begin
  perform pg_advisory_xact_lock(hashtext('stock_tick'));
  for s in select symbol, base_cents from public.stock_symbols loop
    select * into q from public.stock_quotes where symbol = s.symbol;
    if q.symbol is null then
      insert into public.stock_quotes (symbol, price_cents, prev_close_cents, updated_at) values (s.symbol, s.base_cents, s.base_cents, now());
      continue;
    end if;
    v_steps := least(120, floor(extract(epoch from now() - q.updated_at) / 60)::integer);
    if v_steps < 1 then continue; end if;
    v_p := q.price_cents;
    for i in 1..v_steps loop
      -- Zufallsschritt (ungefähr glockenförmig) plus leichter Zug zurück zum Grundpreis
      v_p := v_p * (1 + (random() + random() + random() - 1.5) * 2 * v_vol) + (s.base_cents - v_p) * 0.02;
      v_p := least(greatest(v_p, s.base_cents * 0.2, 100), s.base_cents * 5);
    end loop;
    update public.stock_quotes
       set price_cents = round(v_p),
           prev_close_cents = case when (q.updated_at at time zone 'Europe/Berlin')::date < v_today then q.price_cents else q.prev_close_cents end,
           updated_at = case when v_steps >= 120 then now() else q.updated_at + v_steps * interval '1 minute' end
     where symbol = s.symbol;
  end loop;
end;
$$;

create or replace function public.admin_stock_save(p_symbol text, p_name text, p_price integer)
returns void language plpgsql security definer set search_path = public as $$
declare v_s text := upper(btrim(coalesce(p_symbol, '')));
begin
  perform public._require_admin();
  if v_s !~ '^[A-Z0-9.\-]{1,12}$' then raise exception 'Ungültiges Kürzel.' using errcode = '22023'; end if;
  if p_price is null or p_price < 1 or p_price > 100000000 then raise exception 'Der Preis muss zwischen 1 und 100.000.000 Coins liegen.' using errcode = '22023'; end if;
  insert into public.stock_symbols (symbol, name, sort, base_cents)
  values (v_s, left(btrim(coalesce(nullif(p_name, ''), v_s)), 60), (select coalesce(max(sort), 0) + 1 from public.stock_symbols), p_price::bigint * 100)
  on conflict (symbol) do update set name = excluded.name, base_cents = excluded.base_cents;
  insert into public.stock_quotes (symbol, price_cents, prev_close_cents, updated_at) values (v_s, p_price::bigint * 100, p_price::bigint * 100, now())
  on conflict (symbol) do nothing;
end;
$$;

drop function if exists public.stock_list();
create or replace function public.stock_list()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_me uuid := public._og_check();
begin
  perform public._feature_guard('stocks');
  perform public._stock_tick();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'symbol', s.symbol, 'name', s.name,
      'price_cents', q.price_cents, 'prev_close_cents', q.prev_close_cents, 'updated_at', q.updated_at,
      'fresh', true,
      'unit_koins', greatest(1, round(q.price_cents / 100.0))::bigint,
      'base_koins', greatest(1, round(s.base_cents / 100.0))::bigint,
      'shares', coalesce(h.shares, 0), 'cost', coalesce(h.cost, 0)) order by s.sort)
    from public.stock_symbols s
    join public.stock_quotes q on q.symbol = s.symbol
    left join public.stock_holdings h on h.symbol = s.symbol and h.user_id = v_me), '[]'::jsonb);
end;
$$;

drop function if exists public.stock_trade(text, text, bigint);
create or replace function public.stock_trade(p_symbol text, p_side text, p_shares bigint)
returns bigint language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := public._og_check();
  q public.stock_quotes; h public.stock_holdings;
  v_unit bigint; v_gross bigint; v_fee bigint; v_bal bigint; v_cost_part bigint;
begin
  perform public._feature_guard('stocks');
  if p_side not in ('buy', 'sell') or p_shares is null or p_shares < 1 or p_shares > 1000000 then raise exception 'Ungültige Menge.' using errcode = '22023'; end if;
  perform public._stock_tick();
  select * into q from public.stock_quotes where symbol = p_symbol;
  if q.symbol is null then raise exception 'Diese Aktie gibt es nicht.' using errcode = '22023'; end if;
  v_unit := greatest(1, round(q.price_cents / 100.0))::bigint;
  v_gross := v_unit * p_shares;
  v_fee := ceil(v_gross * public.setting('stock_fee_permille') / 1000.0)::bigint;
  perform pg_advisory_xact_lock(hashtext('stock:' || v_me::text));
  if p_side = 'buy' then
    v_bal := public._grant_koins(v_me, -(v_gross + v_fee), 'stock_buy', p_symbol);
    insert into public.stock_holdings (user_id, symbol, shares, cost) values (v_me, p_symbol, p_shares, v_gross)
    on conflict (user_id, symbol) do update set shares = public.stock_holdings.shares + excluded.shares, cost = public.stock_holdings.cost + excluded.cost;
  else
    select * into h from public.stock_holdings where user_id = v_me and symbol = p_symbol for update;
    if h.user_id is null or h.shares < p_shares then raise exception 'So viele Aktien besitzt du nicht.' using errcode = '23514'; end if;
    v_cost_part := (h.cost * p_shares) / h.shares;
    update public.stock_holdings set shares = shares - p_shares, cost = cost - v_cost_part where user_id = v_me and symbol = p_symbol;
    v_bal := public._grant_koins(v_me, v_gross - v_fee, 'pay_in', 'stock_sell:' || p_symbol);
  end if;
  insert into public.stock_trades (user_id, symbol, side, shares, unit_koins, fee, total) values (v_me, p_symbol, p_side, p_shares, v_unit, v_fee, v_gross);
  return v_bal;
end;
$$;

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and (p.proname like 'stock\_%' or p.proname like '\_stock\_%' or p.proname like 'admin\_stock\_%')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    if left(r.proname, 1) <> '_' then
      execute format('grant execute on function %s to authenticated', r.sig);
    end if;
  end loop;
end;
$$;
