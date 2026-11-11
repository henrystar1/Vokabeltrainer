-- 0088: Börse. Echte Aktienkurse (der Browser holt sie über einen Finnhub-Schlüssel, den der Admin einträgt) gegen Coins handeln.
-- Kurse werden nur übernommen, wenn mindestens 2 verschiedene Personen (oder der Admin) einen ähnlichen Wert melden. Wiederholbar.

create table if not exists public.stock_config (key text primary key, value text not null);
alter table public.stock_config enable row level security;
create table if not exists public.stock_symbols (symbol text primary key check (symbol ~ '^[A-Z0-9.\-]{1,12}$'), name text not null, sort integer not null default 0);
alter table public.stock_symbols enable row level security;
create table if not exists public.stock_quotes (symbol text primary key references public.stock_symbols(symbol) on delete cascade, price_cents bigint not null, prev_close_cents bigint not null, updated_at timestamptz not null default now());
alter table public.stock_quotes enable row level security;
create table if not exists public.stock_reports (symbol text not null references public.stock_symbols(symbol) on delete cascade, user_id uuid not null references auth.users(id) on delete cascade, price_cents bigint not null, prev_close_cents bigint not null, is_admin boolean not null default false, at timestamptz not null default now(), primary key (symbol, user_id));
alter table public.stock_reports enable row level security;
create table if not exists public.stock_holdings (user_id uuid not null references auth.users(id) on delete cascade, symbol text not null references public.stock_symbols(symbol) on delete cascade, shares bigint not null check (shares >= 0), cost bigint not null default 0, primary key (user_id, symbol));
alter table public.stock_holdings enable row level security;
create table if not exists public.stock_trades (id bigserial primary key, user_id uuid not null references auth.users(id) on delete cascade, symbol text not null, side text not null check (side in ('buy','sell')), shares bigint not null, unit_koins bigint not null, fee bigint not null, total bigint not null, at timestamptz not null default now());
alter table public.stock_trades enable row level security;
create index if not exists stock_trades_user_idx on public.stock_trades (user_id, at desc);

insert into public.app_settings (key, value, mod_editable) values
  ('stock_koin_per_usd', 10, false), ('stock_fee_permille', 10, false), ('stock_max_age_min', 15, false), ('stock_min_reporters', 2, false)
on conflict (key) do nothing;

create or replace function public._lock_keys()
returns text[]
language sql
immutable
set search_path = public
as $$
  select array['games', 'gambling', 'sprint', 'duels', 'chat', 'shop', 'quests', 'print',
               'parkour', 'learn', 'copy', 'cards', 'cram', 'test', 'practice', 'grammar', 'irregular', 'conjugate', 'gender',
               'books', 'search', 'math', 'memorize', 'homework', 'advent', 'ranking', 'stats', 'presence', 'websites', 'plus',
               'board', 'feedback', 'loot', 'online', 'stocks'];
$$;
alter table public.feature_locks drop constraint if exists feature_locks_key_check;
alter table public.feature_locks add constraint feature_locks_key_check check (key = any (public._lock_keys()));

-- Gutschriften beim Verkauf laufen mit dem strikten Grund 'pay_in' (kein Plus-Bonus), Ref 'stock_sell:KÜRZEL'.

-- Verwaltung ------------------------------------------------------------------------------------
drop function if exists public.admin_stock_get_key();
create or replace function public.admin_stock_get_key()
returns text language plpgsql stable security definer set search_path = public as $$
begin
  perform public._require_admin();
  return coalesce((select value from public.stock_config where key = 'finnhub'), '');
end;
$$;

drop function if exists public.admin_stock_set_key(text);
create or replace function public.admin_stock_set_key(p_key text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public._require_admin();
  if p_key is null or btrim(p_key) = '' then
    delete from public.stock_config where key = 'finnhub';
  else
    insert into public.stock_config (key, value) values ('finnhub', btrim(p_key)) on conflict (key) do update set value = excluded.value;
  end if;
end;
$$;

drop function if exists public.admin_stock_save(text, text);
create or replace function public.admin_stock_save(p_symbol text, p_name text)
returns void language plpgsql security definer set search_path = public as $$
declare v_s text := upper(btrim(coalesce(p_symbol, '')));
begin
  perform public._require_admin();
  if v_s !~ '^[A-Z0-9.\-]{1,12}$' then raise exception 'Ungültiges Kürzel.' using errcode = '22023'; end if;
  insert into public.stock_symbols (symbol, name, sort) values (v_s, left(btrim(coalesce(nullif(p_name, ''), v_s)), 60), (select coalesce(max(sort), 0) + 1 from public.stock_symbols))
  on conflict (symbol) do update set name = excluded.name;
end;
$$;

drop function if exists public.admin_stock_remove(text);
create or replace function public.admin_stock_remove(p_symbol text)
returns integer language plpgsql security definer set search_path = public as $$
declare r record; v_n integer := 0;
begin
  perform public._require_admin();
  -- Bestände werden zum letzten Kurs ausgezahlt (ohne Gebühr), dann wird die Aktie entfernt.
  for r in select h.user_id, h.shares, h.cost from public.stock_holdings h where h.symbol = upper(p_symbol) and h.shares > 0 loop
    perform public._grant_koins(r.user_id, r.cost, 'pay_in', 'stock_sell:' || upper(p_symbol));
    v_n := v_n + 1;
  end loop;
  delete from public.stock_symbols where symbol = upper(p_symbol);
  return v_n;
end;
$$;

-- Kurse -----------------------------------------------------------------------------------------
drop function if exists public.stock_config();
create or replace function public.stock_config()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public._og_check();
  perform public._feature_guard('stocks');
  return jsonb_build_object(
    'key', coalesce((select value from public.stock_config where key = 'finnhub'), ''),
    'symbols', coalesce((select jsonb_agg(symbol order by sort) from public.stock_symbols), '[]'::jsonb),
    'rate', public.setting('stock_koin_per_usd'), 'fee_permille', public.setting('stock_fee_permille'));
end;
$$;

drop function if exists public.stock_report(text, numeric, numeric);
create or replace function public.stock_report(p_symbol text, p_price numeric, p_prev numeric)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := public._og_check();
  v_p bigint; v_pc bigint; v_med bigint; v_n integer; v_adm boolean := public.is_admin();
  v_need integer := greatest(public.setting('stock_min_reporters'), 1);
begin
  perform public._feature_guard('stocks');
  if not exists (select 1 from public.stock_symbols where symbol = p_symbol) then return; end if;
  if p_price is null or p_price <= 0 or p_price > 10000000 then raise exception 'Ungültiger Kurs.' using errcode = '22023'; end if;
  v_p := round(p_price * 100)::bigint;
  v_pc := case when p_prev is null or p_prev <= 0 or p_prev > 10000000 then v_p else round(p_prev * 100)::bigint end;
  insert into public.stock_reports (symbol, user_id, price_cents, prev_close_cents, is_admin, at)
  values (p_symbol, v_me, v_p, v_pc, v_adm, now())
  on conflict (symbol, user_id) do update set price_cents = excluded.price_cents, prev_close_cents = excluded.prev_close_cents, is_admin = excluded.is_admin, at = now();
  delete from public.stock_reports where at < now() - interval '1 hour';
  -- Admin-Meldung gilt allein; sonst müssen genug verschiedene Personen ähnliche Werte (±1 %) melden.
  if v_adm then
    v_med := v_p;
  else
    select count(*), (percentile_disc(0.5) within group (order by price_cents))::bigint into v_n, v_med
      from public.stock_reports where symbol = p_symbol and at > now() - interval '5 minutes';
    if v_n < v_need then return; end if;
    select count(*) into v_n from public.stock_reports
     where symbol = p_symbol and at > now() - interval '5 minutes' and abs(price_cents - v_med) <= greatest(v_med / 100, 1);
    if v_n < v_need then return; end if;
  end if;
  insert into public.stock_quotes (symbol, price_cents, prev_close_cents, updated_at) values (p_symbol, v_med, v_pc, now())
  on conflict (symbol) do update set price_cents = excluded.price_cents, prev_close_cents = excluded.prev_close_cents, updated_at = now();
end;
$$;

drop function if exists public.stock_list();
create or replace function public.stock_list()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_me uuid := public._og_check(); v_age integer := greatest(public.setting('stock_max_age_min'), 1);
begin
  perform public._feature_guard('stocks');
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'symbol', s.symbol, 'name', s.name,
      'price_cents', q.price_cents, 'prev_close_cents', q.prev_close_cents, 'updated_at', q.updated_at,
      'fresh', coalesce(q.updated_at > now() - make_interval(mins => v_age), false),
      'unit_koins', case when q.price_cents is null then null else greatest(1, round(q.price_cents * public.setting('stock_koin_per_usd') / 100.0))::bigint end,
      'shares', coalesce(h.shares, 0), 'cost', coalesce(h.cost, 0)) order by s.sort)
    from public.stock_symbols s
    left join public.stock_quotes q on q.symbol = s.symbol
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
  v_age integer := greatest(public.setting('stock_max_age_min'), 1);
begin
  perform public._feature_guard('stocks');
  if p_side not in ('buy', 'sell') or p_shares is null or p_shares < 1 or p_shares > 1000000 then raise exception 'Ungültige Menge.' using errcode = '22023'; end if;
  select * into q from public.stock_quotes where symbol = p_symbol;
  if q.symbol is null or q.updated_at < now() - make_interval(mins => v_age) then
    raise exception 'Für diese Aktie gibt es gerade keinen aktuellen Kurs. Handel ist erst wieder möglich, wenn der Kurs bestätigt ist.' using errcode = '55000';
  end if;
  v_unit := greatest(1, round(q.price_cents * public.setting('stock_koin_per_usd') / 100.0))::bigint;
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

drop function if exists public.stock_history();
create or replace function public.stock_history()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public._og_check();
  return coalesce((select jsonb_agg(to_jsonb(t)) from (select symbol, side, shares, unit_koins, fee, total, at from public.stock_trades where user_id = auth.uid() order by at desc limit 30) t), '[]'::jsonb);
end;
$$;

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and (p.proname like 'stock\_%' or p.proname like 'admin\_stock\_%' or p.proname in ('_lock_keys'))
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    if left(r.proname, 1) <> '_' then
      execute format('grant execute on function %s to authenticated', r.sig);
    end if;
  end loop;
end;
$$;
