-- 0065: Adventskalender. Vom 1. bis 24. Dezember (Berlin) lässt sich jeden Tag nur das Türchen des Tages öffnen.
-- Die Belohnungen werden pro Person zufällig gewürfelt (Coins, Punkte, Plus-Tage, Verkleidungen/Designs). Wiederholbar.
-- Zum Testen: Einstellung advent_force_day (0 = echtes Datum, 1 bis 24 = so tun, als wäre heute dieser Tag).
insert into public.app_settings (key, value, mod_editable) values ('advent_force_day', 0, false)
on conflict (key) do nothing;

create table if not exists public.advent_opened (
  user_id uuid not null references auth.users (id) on delete cascade,
  year integer not null,
  day integer not null check (day between 1 and 24),
  rewards jsonb not null default '[]'::jsonb,
  opened_at timestamptz not null default now(),
  primary key (user_id, year, day)
);
alter table public.advent_opened enable row level security;
revoke all on public.advent_opened from anon, authenticated;

-- Zufälliger Plan: Jede Person bekommt beim Öffnen ihre eigene Belohnung (nicht für alle gleich).
-- Je später im Dezember, desto mehr ist drin. Tür 24 ist immer groß (Verkleidung + Plus + Coins).
-- type = coins | points | plus | item (item ohne id = zufälliger, noch nicht besessener Artikel bis max_price)
create or replace function public._advent_plan(p_day integer)
returns jsonb
language plpgsql
volatile
set search_path = public
as $$
declare
  v_roll numeric := random() * 100;
  v_maxp integer := 100 + p_day * 60;
begin
  if p_day = 24 then
    return jsonb_build_array(
      jsonb_build_object('type', 'item', 'max_price', 2500),
      jsonb_build_object('type', 'plus', 'days', 7),
      jsonb_build_object('type', 'coins', 'amount', 800 + floor(random() * 400)::integer));
  end if;
  if v_roll < 38 then
    return jsonb_build_array(jsonb_build_object('type', 'coins', 'amount', (30 + floor(random() * (40 + p_day * 15))::integer) / 10 * 10));
  elsif v_roll < 58 then
    return jsonb_build_array(jsonb_build_object('type', 'points', 'amount', 10 + floor(random() * (10 + p_day * 3))::integer));
  elsif v_roll < 73 then
    return jsonb_build_array(jsonb_build_object('type', 'plus', 'days', 2 + floor(random() * (1 + p_day / 6.0))::integer));
  elsif p_day >= 2 then
    return jsonb_build_array(jsonb_build_object('type', 'item', 'max_price', v_maxp));
  end if;
  return jsonb_build_array(jsonb_build_object('type', 'coins', 'amount', 50));
end;
$$;

-- Welcher Tag ist heute? (0 = kein Türchen offen: vor dem 1. oder nach dem 24. Dezember)
create or replace function public._advent_today()
returns integer
language plpgsql
stable
set search_path = public
as $$
declare
  v_force integer := public.setting('advent_force_day');
  v_now timestamp := (now() at time zone 'Europe/Berlin');
begin
  if v_force between 1 and 24 then return v_force; end if;
  if extract(month from v_now) = 12 and extract(day from v_now) between 1 and 24 then
    return extract(day from v_now)::integer;
  end if;
  return 0;
end;
$$;

create or replace function public._advent_year()
returns integer
language sql
stable
set search_path = public
as $$ select extract(year from (now() at time zone 'Europe/Berlin'))::integer; $$;

create or replace function public.advent_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  v_today integer := public._advent_today();
  v_month integer := extract(month from (now() at time zone 'Europe/Berlin'));
  v_state text;
begin
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht erlaubt.' using errcode = '42501';
  end if;
  v_state := case when v_today > 0 then 'active' when v_month = 12 then 'over' else 'before' end;
  return jsonb_build_object(
    'state', v_state,
    'today', v_today,
    'year', public._advent_year(),
    'opened', coalesce((select jsonb_agg(jsonb_build_object('day', o.day, 'rewards', o.rewards) order by o.day)
                          from public.advent_opened o where o.user_id = v_me and o.year = public._advent_year()), '[]'::jsonb)
  );
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
      when 'item' then
        if v_r ? 'id' then
          select i.id, i.kind, i.name, i.price into v_item from public.shop_items i where i.id = v_r ->> 'id';
        else
          select i.id, i.kind, i.name, i.price into v_item
            from public.shop_items i
           where i.kind in ('avatar', 'color', 'effect', 'theme')
             and i.price > 0 and i.price <= coalesce((v_r ->> 'max_price')::integer, 1000)
             and not exists (select 1 from public.user_items u where u.user_id = v_me and u.item_id = i.id)
           order by random() limit 1;
        end if;
        if not found then
          v_amount := 100;
          perform public._grant_koins(v_me, v_amount, 'advent', 'day' || p_day);
          v_out := v_out || jsonb_build_object('type', 'coins', 'amount', v_amount);
        elsif exists (select 1 from public.user_items where user_id = v_me and item_id = v_item.id) then
          v_amount := greatest(v_item.price / 2, 50);  -- schon vorhanden: halber Preis als Coins
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

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('advent_status', 'advent_open', '_advent_plan', '_advent_today', '_advent_year')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    if r.sig::text like 'advent_%' then
      execute format('grant execute on function %s to authenticated', r.sig);
    end if;
  end loop;
end;
$$;
