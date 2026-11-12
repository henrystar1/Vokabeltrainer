-- 0092: Börse mit Aufwärtstrend und Kursverlauf. Wiederholbar. Nach 0089 ausführen.
-- Die Kurse steigen im Schnitt um `stock_weekly_growth_percent` (Standard 50 %) pro Woche und schwanken zufällig darum.
-- Zusätzlich wird stündlich ein Kurspunkt gespeichert (für das Liniendiagramm, 120 Tage lang).

create table if not exists public.stock_history (
  symbol text not null references public.stock_symbols(symbol) on delete cascade,
  at timestamptz not null,
  price_cents bigint not null,
  primary key (symbol, at)
);
alter table public.stock_history enable row level security;

insert into public.app_settings (key, value, mod_editable) values ('stock_weekly_growth_percent', 50, false)
on conflict (key) do nothing;
-- Die alte Standard-Schwankung (15 ‰ pro Minute) war für einen Aufwärtstrend viel zu wild.
update public.app_settings set value = 2 where key = 'stock_volatility_permille' and value = 15;

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
begin
  perform pg_advisory_xact_lock(hashtext('stock_tick'));
  v_d := ln(1 + v_g / 100.0) / 10080.0;
  for s in select symbol, base_cents from public.stock_symbols loop
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
    update public.stock_quotes
       set price_cents = round(v_p),
           prev_close_cents = case when (q.updated_at at time zone 'Europe/Berlin')::date < v_today then q.price_cents else q.prev_close_cents end,
           updated_at = case when v_steps >= 40320 then now() else q.updated_at + v_steps * interval '1 minute' end
     where symbol = s.symbol;
  end loop;
  if random() < 0.02 then delete from public.stock_history where at < now() - interval '120 days'; end if;
end;
$$;

-- Verlauf einer Aktie: Liste aus {t: Sekunden seit 1970, p: Kurs in Coins}; days wird auf 1 bis 100 begrenzt.
drop function if exists public.stock_chart(text, integer);
create or replace function public.stock_chart(p_symbol text, p_days integer)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_days integer := least(greatest(coalesce(p_days, 5), 1), 100); v_out jsonb;
begin
  perform public._og_check();
  perform public._feature_guard('stocks');
  perform public._stock_tick();
  select coalesce(jsonb_agg(jsonb_build_object('t', extract(epoch from x.at)::bigint, 'p', round(x.price_cents / 100.0, 2)) order by x.at), '[]'::jsonb) into v_out
    from (
      select h.at, h.price_cents from public.stock_history h where h.symbol = p_symbol and h.at > now() - make_interval(days => v_days)
      union all
      select q.updated_at, q.price_cents from public.stock_quotes q where q.symbol = p_symbol
    ) x;
  return v_out;
end;
$$;

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('_stock_tick', 'stock_chart')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    if left(r.proname, 1) <> '_' then
      execute format('grant execute on function %s to authenticated', r.sig);
    end if;
  end loop;
end;
$$;
