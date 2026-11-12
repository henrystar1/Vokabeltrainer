
create or replace function public.notify_poll(p_chat_after bigint, p_since timestamptz)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  v_name text;
  v_set public.user_settings%rowtype;
  v_pattern text;
  v_since timestamptz := coalesce(p_since, now());
  v_max bigint;
  v_chat jsonb := '[]'::jsonb;
  v_ready jsonb := '[]'::jsonb;
  v_online jsonb := '[]'::jsonb;
begin
  if v_me is null or public.is_blocked() then
    raise exception 'Kein Zugriff.' using errcode = '42501';
  end if;
  select * into v_set from public.user_settings where user_id = v_me;
  select display_name into v_name from public.profiles where id = v_me;

  select coalesce(max(c.id), 0) into v_max
    from public.chat_messages c
   where c.kind <> 'whisper' or c.user_id = v_me or c.recipient_id = v_me;

  if p_chat_after is not null and (coalesce(v_set.notify_mentions, true) or coalesce(v_set.notify_chat, false)) then
    v_pattern := '(^|[^[:alnum:]_])@' || regexp_replace(coalesce(v_name, ''), '([.^$*+?()\[\]{}|\\])', '\\\1', 'g') || '($|[^[:alnum:]_])';
    select coalesce(jsonb_agg(x order by (x ->> 'id')::bigint), '[]'::jsonb) into v_chat
      from (
        select jsonb_build_object(
                 'id', c.id,
                 'from', pr.display_name,
                 'body', left(c.body, 140),
                 'whisper', c.kind = 'whisper',
                 'mention', (c.kind = 'whisper' or c.body ~* v_pattern or c.body ~* '(^|[^[:alnum:]_])@everyone($|[^[:alnum:]_])')) as x
          from public.chat_messages c
          join public.profiles pr on pr.id = c.user_id
         where c.id > p_chat_after
           and c.user_id <> v_me
           and c.kind <> 'pay'
           and (c.kind <> 'whisper' or c.recipient_id = v_me)
           and (coalesce(v_set.notify_chat, false)
                or (coalesce(v_set.notify_mentions, true) and (c.kind = 'whisper' or c.body ~* v_pattern or c.body ~* '(^|[^[:alnum:]_])@everyone($|[^[:alnum:]_])')))
         order by c.id desc
         limit 10) t;
  end if;

  if coalesce(v_set.notify_print, true) then
    select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'title', o.title) order by o.ready_at), '[]'::jsonb) into v_ready
      from public.print_orders o
     where o.user_id = v_me and o.status = 'lieferbereit' and o.ready_at > v_since;
  end if;

  if coalesce(v_set.notify_online, 'off') <> 'off' then
    select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.display_name) order by p.online_since), '[]'::jsonb) into v_online
      from (
        select p.* from public.profiles p
         where p.id <> v_me
           and not p.blocked
           and not p.hide_presence
           and p.online_since > v_since
           and p.last_seen_at > now() - interval '3 minutes'
           and (v_set.notify_online = 'all' or (p.role in ('mod', 'admin') and not p.tags_hidden))
         order by p.online_since
         limit 5) p;
  end if;

  return jsonb_build_object('now', now(), 'chat_max', v_max, 'chat', v_chat, 'ready', v_ready, 'online', v_online);
end;
$$;
-- 0064: Pi und Flaggen geben Coins und Punkte, aber nur wenn der Bestwert steigt. Wiederholbar.
-- Einstellbar in Verwaltung → Zahlen: Coins je 10 neue Pi-Stellen bzw. Flaggen-Lernpunkte, Punkte je 10 / 100.
insert into public.app_settings (key, value, mod_editable) values
  ('memo_pi_coins_per_10', 10, false),
  ('memo_flags_coins_per_10', 2, false),
  ('memo_pi_points_per_10', 2, false),
  ('memo_flags_points_per_100', 5, false)
on conflict (key) do nothing;

drop function if exists public.memo_score_submit(text, integer);
create function public.memo_score_submit(p_game text, p_score integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
  v_old integer := 0;
  v_best integer;
  v_delta integer;
  v_coins bigint := 0;
  v_points integer := 0;
begin
  if v_uid is null or public.is_blocked() then
    raise exception 'Nicht erlaubt.' using errcode = '42501';
  end if;
  if p_game not in ('pi', 'flags') then
    raise exception 'Unbekanntes Spiel.' using errcode = '22023';
  end if;
  if p_score is null or p_score < 0 then
    raise exception 'Ungültiger Wert.' using errcode = '22023';
  end if;
  if p_game = 'pi' and p_score > 500 then
    raise exception 'Ungültiger Wert.' using errcode = '22023';
  end if;
  if p_game = 'flags' and p_score > 1500 then
    raise exception 'Ungültiger Wert.' using errcode = '22023';
  end if;
  select best into v_old from public.memo_scores where user_id = v_uid and game = p_game for update;
  v_old := coalesce(v_old, 0);
  insert into public.memo_scores (user_id, game, best) values (v_uid, p_game, p_score)
  on conflict (user_id, game) do update
    set best = greatest(public.memo_scores.best, excluded.best),
        updated_at = case when excluded.best > public.memo_scores.best then now() else public.memo_scores.updated_at end
  returning best into v_best;
  v_delta := v_best - v_old;
  if v_delta > 0 then
    if p_game = 'pi' then
      v_coins := v_delta * public.setting('memo_pi_coins_per_10') / 10;
      v_points := v_delta * public.setting('memo_pi_points_per_10') / 10;
    else
      v_coins := v_delta * public.setting('memo_flags_coins_per_10') / 10;
      v_points := v_delta * public.setting('memo_flags_points_per_100') / 100;
    end if;
    if v_coins > 0 then
      perform public._grant_koins(v_uid, v_coins, 'memo_' || p_game, null);
    end if;
    if v_points > 0 then
      insert into public.points_adjustments (user_id, points, reason, created_by)
      values (v_uid, v_points, case p_game when 'pi' then 'Pi auswendig' else 'Flaggen lernen' end, null);
    end if;
  end if;
  return jsonb_build_object('best', v_best, 'coins', v_coins, 'points', v_points);
end;
$$;

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'memo_score_submit'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;
end;
$$;
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
-- 0066: Gambling-Bank (was die Spieler zusammen gesetzt und gewonnen haben) und Zurücksetzen der Statistik (nur Admin). Wiederholbar.
create or replace function public.gambling_bank()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_plays bigint;
  v_wagered numeric;
  v_won numeric;
  v_players bigint;
begin
  if (select auth.uid()) is null or public.is_blocked() then
    raise exception 'Nicht erlaubt.' using errcode = '42501';
  end if;
  select coalesce(sum(plays), 0), coalesce(sum(wagered), 0), coalesce(sum(won), 0), count(*)
    into v_plays, v_wagered, v_won, v_players
    from public.gambling_stats where plays > 0;
  return jsonb_build_object(
    'plays', v_plays,
    'players', v_players,
    'wagered', v_wagered,
    'won', v_won,
    'bank', v_wagered - v_won,
    'avg_per_play', case when v_plays > 0 then round((v_wagered - v_won) / v_plays, 2) else 0 end,
    'payout_percent', case when v_wagered > 0 then round(v_won * 100 / v_wagered, 1) else 0 end
  );
end;
$$;

-- p_user = null: Statistik aller Spieler zurücksetzen, sonst nur die einer Person.
create or replace function public.admin_gambling_reset(p_user uuid default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare v_n integer;
begin
  perform public._require_admin();
  delete from public.gambling_stats where p_user is null or user_id = p_user;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('gambling_bank', 'admin_gambling_reset')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;
end;
$$;
-- 0067: Parkour läuft über zwei Spiel-Datenbanken (zwei fremde Supabase-Projekte, nur Realtime).
-- Ist das Monatsbudget der ersten voll, wechseln alle zur zweiten. Sind beide voll, ist Parkour bis Monatsende gesperrt.
-- parkour_msg_month_k = Budget je Datenbank (in Tausend), parkour_projects = Anzahl der Spiel-Datenbanken (1 oder 2). Wiederholbar.
insert into public.app_settings (key, value, mod_editable) values ('parkour_projects', 2, false)
on conflict (key) do nothing;

create or replace function public._parkour_usage_state(p_msgs bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_today date := (now() at time zone 'Europe/Berlin')::date;
  v_first date := date_trunc('month', v_today)::date;
  v_k integer := public.setting('parkour_msg_month_k');
  v_n integer := greatest(1, least(public.setting('parkour_projects'), 2));
  v_each bigint := v_k::bigint * 1000;
  v_budget bigint := v_each * v_n;
  v_before bigint;
  v_left integer;
  v_day_cap bigint;
  v_month bigint;
  v_slot integer := 0;
begin
  select coalesce(sum(msgs), 0) into v_before from public.parkour_usage where day >= v_first and day < v_today;
  v_month := v_before + p_msgs;
  v_left := (date_trunc('month', v_today) + interval '1 month')::date - v_today;
  v_day_cap := (greatest(v_budget - v_before, 0) / greatest(v_left, 1)) * 4;
  if v_each > 0 then
    v_slot := least((v_month / v_each)::integer, v_n - 1);
  end if;
  return jsonb_build_object(
    'msgs', p_msgs,
    'limit', v_day_cap,
    'month', v_month,
    'budget', v_budget,
    'slot', v_slot,
    'blocked', v_k > 0 and (v_month >= v_budget or p_msgs >= v_day_cap)
  );
end;
$$;

do $$
declare r record;
begin
  for r in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = '_parkour_usage_state'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
  end loop;
end;
$$;
-- 0068: Spiel-Datenbanken für Parkour (nur Realtime) in der Verwaltung pflegen. Wiederholbar.
-- Reihenfolge = Reihenfolge der Nutzung: ist das Monatsbudget (parkour_msg_month_k) der ersten voll, gilt die zweite usw.
-- Es kommen nur öffentliche Publishable Keys hinein (kein Secret/Service-Key).
create table if not exists public.game_dbs (
  id uuid primary key default gen_random_uuid(),
  name text not null default '',
  url text not null,
  publishable_key text not null,
  sort integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.game_dbs enable row level security;
revoke all on public.game_dbs from anon, authenticated;

-- Die zwei bisherigen Projekte übernehmen, falls noch nichts drin steht.
insert into public.game_dbs (name, url, publishable_key, sort)
select v.name, v.url, v.k, v.sort
from (values
  ('Spiel 1', 'https://xuqwinmiborgjvgsxscv.supabase.co', 'sb_publishable_G6CP3tpWXtrN0tsZN9V7KA_RkOnrtYB', 1),
  ('Spiel 2', 'https://kvkpjbdkezquvfdrdkjo.supabase.co', 'sb_publishable_RFKGqSIUdOHXX68MGN0H3A_fH5V8YT4', 2)
) as v(name, url, k, sort)
where not exists (select 1 from public.game_dbs);

-- Liste für das Spiel (jede angemeldete Person; die Keys sind öffentlich und stehen ohnehin in der Website).
create or replace function public.parkour_game_dbs()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'Nicht angemeldet.' using errcode = '42501';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object('url', g.url, 'key', g.publishable_key) order by g.sort, g.created_at)
                     from public.game_dbs g where g.active), '[]'::jsonb);
end;
$$;

create or replace function public.admin_game_dbs_list()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public._require_admin();
  return coalesce((select jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name, 'url', g.url, 'key', g.publishable_key, 'active', g.active) order by g.sort, g.created_at)
                     from public.game_dbs g), '[]'::jsonb);
end;
$$;

create or replace function public._game_db_check(p_url text, p_key text)
returns void
language plpgsql
immutable
set search_path = public
as $$
begin
  if p_url is null or p_url !~ '^https://[a-z0-9-]+\.supabase\.co/?$' then
    raise exception 'Die Projekt-URL muss so aussehen: https://xxxx.supabase.co' using errcode = '22023';
  end if;
  if p_key is null or length(p_key) < 20 then
    raise exception 'Der Publishable Key fehlt.' using errcode = '22023';
  end if;
  if p_key like 'sb_secret_%' or p_key ~* 'service_role' then
    raise exception 'Das ist ein geheimer Schlüssel. Bitte nur den Publishable Key (sb_publishable_…) eintragen.' using errcode = '22023';
  end if;
end;
$$;

create or replace function public.admin_game_db_add(p_name text, p_url text, p_key text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid;
begin
  perform public._require_admin();
  p_url := rtrim(btrim(p_url), '/');
  p_key := btrim(p_key);
  perform public._game_db_check(p_url, p_key);
  if exists (select 1 from public.game_dbs where url = p_url) then
    raise exception 'Dieses Projekt ist schon in der Liste.' using errcode = '23505';
  end if;
  insert into public.game_dbs (name, url, publishable_key, sort)
  values (left(btrim(coalesce(p_name, '')), 60), p_url, p_key, coalesce((select max(sort) from public.game_dbs), 0) + 1)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.admin_game_db_update(p_id uuid, p_name text, p_url text, p_key text, p_active boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._require_admin();
  p_url := rtrim(btrim(p_url), '/');
  p_key := btrim(p_key);
  perform public._game_db_check(p_url, p_key);
  update public.game_dbs set name = left(btrim(coalesce(p_name, '')), 60), url = p_url, publishable_key = p_key, active = coalesce(p_active, true) where id = p_id;
  if not found then raise exception 'Nicht gefunden.' using errcode = 'P0002'; end if;
end;
$$;

create or replace function public.admin_game_db_delete(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._require_admin();
  delete from public.game_dbs where id = p_id;
end;
$$;

-- Eine Stelle nach oben (p_dir = -1) oder unten (1) schieben.
create or replace function public.admin_game_db_move(p_id uuid, p_dir integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare r record; v_prev uuid := null; v_ids uuid[] := '{}'; v_i integer; v_j integer;
begin
  perform public._require_admin();
  select array_agg(id order by sort, created_at) into v_ids from public.game_dbs;
  v_i := array_position(v_ids, p_id);
  if v_i is null then return; end if;
  v_j := v_i + case when p_dir < 0 then -1 else 1 end;
  if v_j < 1 or v_j > array_length(v_ids, 1) then return; end if;
  v_ids[v_i] := v_ids[v_j];
  v_ids[v_j] := p_id;
  for v_i in 1 .. array_length(v_ids, 1) loop
    update public.game_dbs set sort = v_i where id = v_ids[v_i];
  end loop;
end;
$$;

-- Budget und Datenbank-Nummer: Anzahl = aktive Einträge (mindestens 1).
create or replace function public._parkour_usage_state(p_msgs bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_today date := (now() at time zone 'Europe/Berlin')::date;
  v_first date := date_trunc('month', v_today)::date;
  v_k integer := public.setting('parkour_msg_month_k');
  v_n integer := greatest(1, (select count(*)::integer from public.game_dbs where active));
  v_each bigint := v_k::bigint * 1000;
  v_budget bigint := v_each * v_n;
  v_before bigint;
  v_left integer;
  v_day_cap bigint;
  v_month bigint;
  v_slot integer := 0;
begin
  select coalesce(sum(msgs), 0) into v_before from public.parkour_usage where day >= v_first and day < v_today;
  v_month := v_before + p_msgs;
  v_left := (date_trunc('month', v_today) + interval '1 month')::date - v_today;
  v_day_cap := (greatest(v_budget - v_before, 0) / greatest(v_left, 1)) * 4;
  if v_each > 0 then
    v_slot := least((v_month / v_each)::integer, v_n - 1);
  end if;
  return jsonb_build_object(
    'msgs', p_msgs,
    'limit', v_day_cap,
    'month', v_month,
    'budget', v_budget,
    'slot', v_slot,
    'blocked', v_k > 0 and (v_month >= v_budget or p_msgs >= v_day_cap)
  );
end;
$$;

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('parkour_game_dbs', 'admin_game_dbs_list', 'admin_game_db_add', 'admin_game_db_update', 'admin_game_db_delete', 'admin_game_db_move', '_game_db_check', '_parkour_usage_state')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    if r.proname not like '\_%' then
      execute format('grant execute on function %s to authenticated', r.sig);
    end if;
  end loop;
end;
$$;
-- 0069: 1) Alle Menüpunkte lassen sich in Verwaltung → Sperren abschalten.
--       2) Heilen und Wiederbeleben im Parkour nur für ausgewählte Mods (Recht „heal“ je Mod). Wiederholbar.

-- ---------------------------------------------------------------------------
-- 1. Sperr-Schlüssel: eine Liste für alles
-- ---------------------------------------------------------------------------
create or replace function public._lock_keys()
returns text[]
language sql
immutable
set search_path = public
as $$
  select array['games', 'gambling', 'sprint', 'duels', 'chat', 'shop', 'quests', 'print',
               'parkour', 'learn', 'copy', 'cards', 'cram', 'test', 'practice', 'grammar', 'irregular', 'conjugate', 'gender',
               'books', 'search', 'math', 'memorize', 'homework', 'advent', 'ranking', 'stats', 'presence', 'websites', 'plus',
               'board', 'feedback'];
$$;

alter table public.feature_locks drop constraint if exists feature_locks_key_check;
alter table public.feature_locks add constraint feature_locks_key_check check (key = any (public._lock_keys()));

create or replace function public.get_locked_features()
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(k order by k), '{}'::text[])
    from unnest(public._lock_keys()) k
   where (select auth.uid()) is not null and public._feature_locked(k);
$$;

drop function if exists public.admin_get_feature_locks();
create function public.admin_get_feature_locks()
returns table (key text, off_until timestamptz, rules jsonb, note text, locked_now boolean)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public._require_admin();
  return query
  select k, l.off_until, coalesce(l.rules, '[]'::jsonb), coalesce(l.note, ''), public._feature_locked_raw(k)
    from unnest(public._lock_keys()) k
    left join public.feature_locks l on l.key = k;
end;
$$;

create or replace function public.admin_set_feature_lock(p_key text, p_off_until timestamptz, p_rules jsonb, p_note text default '')
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._require_admin();
  if not (p_key = any (public._lock_keys())) then
    raise exception 'Unbekannte Funktion.' using errcode = '22023';
  end if;
  if not public._valid_lock_rules(coalesce(p_rules, '[]'::jsonb)) then
    raise exception 'Ungültiger Zeitplan.' using errcode = '22023';
  end if;
  if p_off_until is null and coalesce(p_rules, '[]'::jsonb) = '[]'::jsonb and btrim(coalesce(p_note, '')) = '' then
    delete from public.feature_locks where key = p_key;
    return;
  end if;
  insert into public.feature_locks (key, off_until, rules, note, updated_at)
  values (p_key, p_off_until, coalesce(p_rules, '[]'::jsonb), left(btrim(coalesce(p_note, '')), 200), now())
  on conflict (key) do update
    set off_until = excluded.off_until, rules = excluded.rules, note = excluded.note, updated_at = now();
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Recht „heal“ je Mod
-- ---------------------------------------------------------------------------
alter table public.staff_rights add column if not exists heal boolean not null default false;

create or replace function public.can_heal()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.is_admin(), false)
      or coalesce((select s.heal from public.staff_rights s where s.user_id = (select auth.uid())), false);
$$;

create or replace function public.my_run_perks()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object('spectate', public.can_spectate(), 'heal', public.can_heal(), 'look', public._staff_look((select auth.uid())),
                            'allowed', to_jsonb(public._allowed_looks((select auth.uid()))),
                            'entrance', (select pp.entrance from public.parkour_profiles pp where pp.user_id = (select auth.uid())))
   where (select auth.uid()) is not null;
$$;

create or replace function public.admin_get_staff_rights(p_user uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public._require_admin();
  return jsonb_build_object(
    'books_mode', (select books_mode from public.staff_rights where user_id = p_user),
    'set_mode', (select set_mode from public.staff_rights where user_id = p_user),
    'shop', (select shop from public.staff_rights where user_id = p_user),
    'timeout_max', (select timeout_max from public.staff_rights where user_id = p_user),
    'spectate', coalesce((select spectate from public.staff_rights where user_id = p_user), false),
    'heal', coalesce((select heal from public.staff_rights where user_id = p_user), false),
    'looks', to_jsonb(coalesce((select looks from public.staff_rights where user_id = p_user), '{}'::text[])),
    'book_ids', coalesce((select jsonb_agg(book_id) from public.staff_book_access where user_id = p_user), '[]'::jsonb),
    'setting_keys', coalesce((select jsonb_agg(key) from public.staff_setting_access where user_id = p_user), '[]'::jsonb));
end;
$$;

create or replace function public.admin_set_staff_heal(p_user uuid, p_heal boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._require_admin();
  if not exists (select 1 from public.profiles where id = p_user and role in ('mod', 'alphamod')) then
    raise exception 'Nur für Mods und Alphamods.' using errcode = '22023';
  end if;
  insert into public.staff_rights (user_id, heal) values (p_user, coalesce(p_heal, false))
  on conflict (user_id) do update set heal = excluded.heal;
end;
$$;

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig, p.proname
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('_lock_keys', 'get_locked_features', 'admin_get_feature_locks', 'admin_set_feature_lock',
                                                  'can_heal', 'my_run_perks', 'admin_get_staff_rights', 'admin_set_staff_heal')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    if r.proname not like '\_%' then
      execute format('grant execute on function %s to authenticated', r.sig);
    end if;
  end loop;
end;
$$;
-- 0070: Alle Werte des Adventskalenders einstellbar (Verwaltung → Zahlen → Adventskalender). Wiederholbar.
insert into public.app_settings (key, value, mod_editable) values
  ('advent_w_coins', 38, false), ('advent_w_points', 20, false), ('advent_w_plus', 15, false), ('advent_w_item', 27, false),
  ('advent_coins_min', 30, false), ('advent_coins_spread', 40, false), ('advent_coins_per_day', 15, false),
  ('advent_points_min', 10, false), ('advent_points_spread', 10, false), ('advent_points_per_day', 3, false),
  ('advent_plus_days_min', 2, false), ('advent_plus_days_per_6', 1, false),
  ('advent_item_price_base', 100, false), ('advent_item_price_per_day', 60, false),
  ('advent_final_coins', 800, false), ('advent_final_coins_spread', 400, false), ('advent_final_plus_days', 7, false), ('advent_final_item_price', 2500, false)
on conflict (key) do nothing;

create or replace function public._advent_plan(p_day integer)
returns jsonb
language plpgsql
volatile
set search_path = public
as $$
declare
  v_wc integer := public.setting('advent_w_coins');
  v_wp integer := public.setting('advent_w_points');
  v_wl integer := public.setting('advent_w_plus');
  v_wi integer := case when p_day >= 2 then public.setting('advent_w_item') else 0 end;
  v_total integer;
  v_roll numeric;
begin
  if p_day = 24 then
    return jsonb_build_array(
      jsonb_build_object('type', 'item', 'max_price', public.setting('advent_final_item_price')),
      jsonb_build_object('type', 'plus', 'days', public.setting('advent_final_plus_days')),
      jsonb_build_object('type', 'coins', 'amount', public.setting('advent_final_coins') + floor(random() * (public.setting('advent_final_coins_spread') + 1))::integer));
  end if;
  v_total := v_wc + v_wp + v_wl + v_wi;
  if v_total <= 0 then
    return '[]'::jsonb;
  end if;
  v_roll := random() * v_total;
  if v_roll < v_wc then
    return jsonb_build_array(jsonb_build_object('type', 'coins',
      'amount', (public.setting('advent_coins_min') + floor(random() * (public.setting('advent_coins_spread') + p_day * public.setting('advent_coins_per_day') + 1))::integer) / 10 * 10));
  elsif v_roll < v_wc + v_wp then
    return jsonb_build_array(jsonb_build_object('type', 'points',
      'amount', public.setting('advent_points_min') + floor(random() * (public.setting('advent_points_spread') + p_day * public.setting('advent_points_per_day') + 1))::integer));
  elsif v_roll < v_wc + v_wp + v_wl then
    return jsonb_build_array(jsonb_build_object('type', 'plus',
      'days', public.setting('advent_plus_days_min') + floor(random() * (1 + p_day * public.setting('advent_plus_days_per_6') / 6.0))::integer));
  end if;
  return jsonb_build_array(jsonb_build_object('type', 'item', 'max_price', public.setting('advent_item_price_base') + p_day * public.setting('advent_item_price_per_day')));
end;
$$;

do $$
declare r record;
begin
  for r in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = '_advent_plan'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
  end loop;
end;
$$;
-- 0071: Liga: Auf- und Abstieg einstellbar, schnelleres Laden, mehr Infos für die Spieler. Wiederholbar.
-- Neue Zahlen (Verwaltung → Zahlen → Liga): league_promote (wie viele steigen auf), league_relegate (wie viele ab),
-- league_relegate_min_group (ab wie vielen Aktiven in der Stufe es überhaupt Abstiege gibt), league_rows_max (Zeilen in der Liste).
insert into public.app_settings (key, value, mod_editable) values
  ('league_promote', 3, false), ('league_relegate', 3, false), ('league_relegate_min_group', 8, false), ('league_rows_max', 30, false)
on conflict (key) do nothing;

create or replace function public._league_rollover()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now_week date := date_trunc('week', timezone('Europe/Berlin', now()))::date;
  v_last date;
  v_min integer := public.setting('league_min_points');
  v_up integer := greatest(public.setting('league_promote'), 0);
  v_down integer := greatest(public.setting('league_relegate'), 0);
  v_group integer := greatest(public.setting('league_relegate_min_group'), 1);
  v_names text[] := array['Bronze', 'Silber', 'Gold', 'Saphir', 'Diamant'];
  r record;
  v_new integer;
  v_result text;
  v_reward integer;
  v_text text;
begin
  perform pg_advisory_xact_lock(70071);
  select m.last_week into v_last from public.league_meta m where m.id;
  if not found then
    insert into public.league_meta (id, last_week) values (true, v_now_week);
    return;
  end if;
  if v_last < v_now_week - 56 then
    v_last := v_now_week - 56;
  end if;

  while v_last < v_now_week loop
    insert into public.league_members (user_id)
    select distinct d.user_id
      from public.daily_stats d join public.profiles p on p.id = d.user_id and not p.blocked
     where d.day between v_last and v_last + 6
    on conflict do nothing;

    for r in
      with pts as (
        select m.user_id, m.tier, public._week_points(m.user_id, v_last) as pts
          from public.league_members m
          join public.profiles p on p.id = m.user_id and not p.blocked
      )
      select x.*,
             case when x.pts > 0 then rank() over (partition by x.tier order by x.pts desc) end as rnk,
             count(*) filter (where x.pts > 0) over (partition by x.tier) as parts
        from pts x
    loop
      v_new := r.tier;
      v_result := 'stayed';
      v_reward := 0;
      if r.pts > 0 and r.rnk <= v_up and r.tier < 5 then
        v_new := r.tier + 1;
        v_result := 'promoted';
      elsif r.tier > 1 and (r.pts = 0 or (v_down > 0 and r.parts >= v_group and r.rnk > r.parts - v_down)) then
        v_new := r.tier - 1;
        v_result := 'relegated';
      end if;
      if r.pts >= v_min and r.rnk <= 3 then
        v_reward := public.setting('league_reward_' || r.rnk);
      end if;

      if v_new <> r.tier then
        update public.league_members set tier = v_new where user_id = r.user_id;
      end if;
      if r.pts > 0 or v_result <> 'stayed' then
        insert into public.league_history (user_id, week_start, tier, rank, points, result, reward)
        values (r.user_id, v_last, r.tier, r.rnk, r.pts, v_result, v_reward)
        on conflict do nothing;
        v_text := 'Wochenliga ' || to_char(v_last, 'DD.MM.') || ' (' || v_names[r.tier] || '): '
          || case when r.rnk is not null then 'Platz ' || r.rnk || ' mit ' || r.pts || ' Punkten. ' else 'keine Punkte. ' end
          || case v_result when 'promoted' then 'Aufstieg in ' || v_names[v_new] || '!'
                           when 'relegated' then 'Abstieg in ' || v_names[v_new] || '.'
                           else 'Du bleibst in ' || v_names[r.tier] || '.' end
          || case when v_reward > 0 then ' +' || v_reward || ' Coins.' else '' end;
        insert into public.user_messages (user_id, from_id, body) values (r.user_id, null, v_text);
        if v_reward > 0 then
          perform public._grant_koins(r.user_id, v_reward, 'league', v_last::text);
        end if;
      end if;
    end loop;

    v_last := v_last + 7;
    update public.league_meta set last_week = v_last where id;
  end loop;
end;
$$;

-- Wochenpunkte werden nur einmal je Person berechnet (vorher zweimal), die Liste ist auf die obersten Plätze und dich begrenzt.
create or replace function public.get_league()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  v_week date := date_trunc('week', timezone('Europe/Berlin', now()))::date;
  v_tier integer;
  v_up integer := greatest(public.setting('league_promote'), 0);
  v_down integer := greatest(public.setting('league_relegate'), 0);
  v_group integer := greatest(public.setting('league_relegate_min_group'), 1);
  v_max integer := greatest(public.setting('league_rows_max'), 5);
  v_parts integer;
  v_total integer;
  v_rows jsonb;
  v_my_rank integer;
  v_my_pts integer;
  v_up_pts integer;
  v_down_pts integer;
begin
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  perform public._league_rollover();
  insert into public.league_members (user_id) values (v_me) on conflict do nothing;
  select m.tier into v_tier from public.league_members m where m.user_id = v_me;

  create temporary table if not exists _lg_tmp (user_id uuid, pts integer, rnk bigint) on commit drop;
  delete from _lg_tmp where true;
  insert into _lg_tmp
    select x.user_id, x.pts, rank() over (order by x.pts desc)
      from (
        select m.user_id, public._week_points(m.user_id, v_week) as pts
          from public.league_members m join public.profiles p on p.id = m.user_id and not p.blocked
         where m.tier = v_tier
      ) x;

  select count(*) filter (where pts > 0), count(*) into v_parts, v_total from _lg_tmp;
  select rnk, pts into v_my_rank, v_my_pts from _lg_tmp where user_id = v_me;
  -- Punkte des letzten Aufstiegsplatzes und des ersten Abstiegsplatzes (für „noch X Punkte“)
  select min(pts) into v_up_pts from _lg_tmp where pts > 0 and rnk <= v_up;
  select max(pts) into v_down_pts from _lg_tmp t
   where v_tier > 1 and v_down > 0 and v_parts >= v_group and pts > 0 and rnk > v_parts - v_down;

  select coalesce(jsonb_agg(jsonb_build_object(
           'rank', t.rnk, 'display_name', pr.display_name, 'points', t.pts, 'is_me', t.user_id = v_me,
           'avatar_id', pr.avatar_id, 'color_id', pr.color_id, 'effect_id', pr.effect_id,
           'role', pr.role, 'tag_id', pr.tag_id, 'theme_id', pr.theme_id) order by t.pts desc, pr.display_name), '[]'::jsonb)
    into v_rows
    from (
      select * from _lg_tmp
       where user_id = v_me or (pts > 0 and rnk <= v_max)
          or (pts = 0 and (select count(*) from _lg_tmp t2 where t2.pts = 0 and t2.user_id <= _lg_tmp.user_id) <= 5)
    ) t
    join public.profiles pr on pr.id = t.user_id;

  return jsonb_build_object(
    'tier', v_tier,
    'week_start', v_week,
    'ends_at', ((v_week + 7)::timestamp at time zone 'Europe/Berlin'),
    'participants', v_parts,
    'members', v_total,
    'relegation_active', v_parts >= v_group and v_down > 0,
    'promote', case when v_tier < 5 then v_up else 0 end,
    'relegate', case when v_tier > 1 then v_down else 0 end,
    'min_points', public.setting('league_min_points'),
    'rewards', jsonb_build_array(public.setting('league_reward_1'), public.setting('league_reward_2'), public.setting('league_reward_3')),
    'my_rank', case when v_my_pts > 0 then v_my_rank end,
    'my_points', coalesce(v_my_pts, 0),
    'promote_points', v_up_pts,
    'relegate_points', v_down_pts,
    'rows', v_rows,
    'last', (select to_jsonb(h) - 'user_id' from public.league_history h where h.user_id = v_me order by h.week_start desc limit 1)
  );
end;
$$;

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('_league_rollover', 'get_league')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    if r.proname not like '\_%' then
      execute format('grant execute on function %s to authenticated', r.sig);
    end if;
  end loop;
end;
$$;
-- 0072: Pi schwerer zu schummeln + Admin kann Rekorde löschen. Wiederholbar.
-- Pi-Lauf wird auf dem Server gestartet (memo_pi_start); beim Melden muss genug echte Zeit vergangen sein
-- (Einstellung memo_pi_min_ms = Millisekunden pro Stelle, Verwaltung → Zahlen), sonst wird der Wert abgelehnt.
insert into public.app_settings (key, value, mod_editable) values
  ('memo_pi_min_ms', 450, false),
  ('memo_pi_max_minutes', 60, false)
on conflict (key) do nothing;

create table if not exists public.memo_pi_runs (
  user_id uuid primary key references auth.users (id) on delete cascade,
  started_at timestamptz not null default now()
);
alter table public.memo_pi_runs enable row level security;
revoke all on public.memo_pi_runs from anon, authenticated;

create or replace function public.memo_pi_start()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if (select auth.uid()) is null or public.is_blocked() then
    raise exception 'Nicht erlaubt.' using errcode = '42501';
  end if;
  insert into public.memo_pi_runs (user_id, started_at) values ((select auth.uid()), now())
  on conflict (user_id) do update set started_at = now();
end;
$$;

drop function if exists public.memo_score_submit(text, integer);
create function public.memo_score_submit(p_game text, p_score integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
  v_old integer := 0;
  v_best integer;
  v_delta integer;
  v_coins bigint := 0;
  v_points integer := 0;
  v_start timestamptz;
  v_ms numeric;
begin
  if v_uid is null or public.is_blocked() then
    raise exception 'Nicht erlaubt.' using errcode = '42501';
  end if;
  if p_game not in ('pi', 'flags') then
    raise exception 'Unbekanntes Spiel.' using errcode = '22023';
  end if;
  if p_score is null or p_score < 0 then
    raise exception 'Ungültiger Wert.' using errcode = '22023';
  end if;
  if p_game = 'pi' and p_score > 500 then
    raise exception 'Ungültiger Wert.' using errcode = '22023';
  end if;
  if p_game = 'flags' and p_score > 1500 then
    raise exception 'Ungültiger Wert.' using errcode = '22023';
  end if;

  if p_game = 'pi' then
    -- Lauf muss vom Server gestartet sein, wird einmalig verbraucht und braucht plausible Zeit.
    delete from public.memo_pi_runs where user_id = v_uid returning started_at into v_start;
    if v_start is null then
      raise exception 'Kein laufender Pi-Versuch.' using errcode = '22023';
    end if;
    v_ms := extract(epoch from (now() - v_start)) * 1000;
    if v_ms > public.setting('memo_pi_max_minutes') * 60000 or v_ms < p_score * public.setting('memo_pi_min_ms') then
      return jsonb_build_object('best', coalesce((select best from public.memo_scores where user_id = v_uid and game = 'pi'), 0),
                                'coins', 0, 'points', 0, 'rejected', true);
    end if;
  end if;

  select best into v_old from public.memo_scores where user_id = v_uid and game = p_game for update;
  v_old := coalesce(v_old, 0);
  insert into public.memo_scores (user_id, game, best) values (v_uid, p_game, p_score)
  on conflict (user_id, game) do update
    set best = greatest(public.memo_scores.best, excluded.best),
        updated_at = case when excluded.best > public.memo_scores.best then now() else public.memo_scores.updated_at end
  returning best into v_best;
  v_delta := v_best - v_old;
  if v_delta > 0 then
    if p_game = 'pi' then
      v_coins := v_delta * public.setting('memo_pi_coins_per_10') / 10;
      v_points := v_delta * public.setting('memo_pi_points_per_10') / 10;
    else
      v_coins := v_delta * public.setting('memo_flags_coins_per_10') / 10;
      v_points := v_delta * public.setting('memo_flags_points_per_100') / 100;
    end if;
    if v_coins > 0 then
      perform public._grant_koins(v_uid, v_coins, 'memo_' || p_game, null);
    end if;
    if v_points > 0 then
      insert into public.points_adjustments (user_id, points, reason, created_by)
      values (v_uid, v_points, case p_game when 'pi' then 'Pi auswendig' else 'Flaggen lernen' end, null);
    end if;
  end if;
  return jsonb_build_object('best', v_best, 'coins', v_coins, 'points', v_points);
end;
$$;

-- Admin: Rekord einer Person (oder alle Rekorde eines Spiels) löschen. Coins bleiben unverändert.
create or replace function public.admin_memo_delete(p_game text, p_user uuid default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare v_n integer;
begin
  perform public._require_admin();
  if p_game not in ('pi', 'flags') then
    raise exception 'Unbekanntes Spiel.' using errcode = '22023';
  end if;
  delete from public.memo_scores where game = p_game and (p_user is null or user_id = p_user);
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('memo_score_submit', 'memo_pi_start', 'admin_memo_delete')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;
end;
$$;
-- ============================================================================
-- 0073: Vokabeltrainer Pro (über Plus). Wiederholbar. Nach 0072 ausführen.
-- Pro zählt überall auch als Plus. Alle Zahlen stehen in Verwaltung → Plus.
--  * Preis: 1 Tag 800 Coins, längere Stufen günstiger pro Tag
--  * mehr Coins/Punkte, bessere Gambling-Chance, Foto-Scan, Parkour zuschauen, begrenztes Heilen,
--    +3 Herzen, feste Sprünge (mit gekauftem Dreiersprung einer mehr), keine Vokabeln im Parkour,
--    höheres Parkour-Limit, alle Premium-Skins, bessere Adventskalender-Türchen, mehr Quests
-- ============================================================================

alter table public.profiles add column if not exists pro_until timestamptz;
alter table public.parkour_profiles add column if not exists pro_granted text[] not null default '{}';

insert into public.plus_settings (key, value, label, unit, hint, min_value, max_value, sort) values
  ('pro_price_d1',   800,    'Pro Preis: 1 Tag',      'Coins', '', 0, 1000000000, 311),
  ('pro_price_d7',   5000,   'Pro Preis: 1 Woche',    'Coins', '', 0, 1000000000, 312),
  ('pro_price_d30',  20000,  'Pro Preis: 1 Monat',    'Coins', '', 0, 1000000000, 313),
  ('pro_price_d90',  54000,  'Pro Preis: 3 Monate',   'Coins', '', 0, 1000000000, 314),
  ('pro_price_life', 600000, 'Pro Preis: für immer',  'Coins', '', 0, 1000000000, 315),
  ('pro_coin_mult',  2.5,    'Pro: Coins-Multiplikator', '×', 'Ersetzt den Plus-Wert, wenn er höher ist.', 1, 20, 320),
  ('pro_points_mult', 2.5,   'Pro: Ranglistenpunkte-Multiplikator', '×', 'Für die Wochenliga.', 1, 20, 321),
  ('pro_gamble_boost_percent', 30, 'Pro: Gambling-Gewinnchance besser', '%', 'Relativ zur normalen Chance (ersetzt den Plus-Wert, wenn höher).', 0, 100, 322),
  ('pro_hearts', 3, 'Pro: zusätzliche Herzen im Parkour', 'Herzen', 'Zusätzlich zu den gekauften Herzen.', 0, 20, 330),
  ('pro_jumps', 3, 'Pro: feste Sprünge im Parkour', 'Sprünge', 'Dauerhaft. 2 = normal.', 2, 10, 331),
  ('pro_jump_extra', 1, 'Pro: Extra-Sprung mit gekauftem Dreiersprung', 'Sprünge', 'Wer schon 3 Sprünge gekauft hat, bekommt so viele dazu (3 + 1 = 4).', 0, 5, 332),
  ('pro_no_learn', 1, 'Pro: keine Vokabeln im Parkour', '0/1', '1 = Pro-Spieler müssen im Parkour nicht lernen.', 0, 1, 333),
  ('pro_spectate', 1, 'Pro: im Parkour zuschauen', '0/1', '1 = erlaubt (wenn Parkour nicht gesperrt ist).', 0, 1, 334),
  ('pro_heal_per_run', 2, 'Pro: Heilen/Wiederbeleben pro Runde', 'mal', '0 = nicht erlaubt.', 0, 50, 335),
  ('pro_parkour_limit_mult', 2, 'Pro: Parkour-Tageslimit', '×', 'Vielfaches des normalen Limits.', 1, 20, 336),
  ('pro_advent_mult', 2, 'Pro: Adventskalender-Gewinne', '×', 'Coins, Punkte und Artikelwert.', 1, 10, 340),
  ('pro_advent_plus_days', 3, 'Pro: Adventskalender extra Plus-Tage', 'Tage', 'Zusätzlich bei Plus-Gewinnen.', 0, 30, 341),
  ('pro_quest_base', 25, 'Pro-Quests: Grundbelohnung', 'Coins', 'Wird je Stufe vervielfacht.', 0, 100000, 342),
  ('pro_ocr_plus', 0, 'Foto-Scan auch mit Plus', '0/1', '1 = Foto-Scan schon mit Plus erlaubt, sonst nur Pro.', 0, 1, 343)
on conflict (key) do update
  set label = excluded.label, unit = excluded.unit, hint = excluded.hint,
      min_value = excluded.min_value, max_value = excluded.max_value, sort = excluded.sort;

create or replace function public._pro_active(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select (p.pro_until > now()) or p.role = 'admin' from public.profiles p where p.id = p_user and not p.blocked), false);
$$;

-- Pro zählt auch als Plus.
create or replace function public._plus_active(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select (p.plus_until > now()) or (p.pro_until > now()) or p.role = 'admin' from public.profiles p where p.id = p_user and not p.blocked), false);
$$;

create or replace function public._pro_tiers()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_array(
    jsonb_build_object('id', 'd1',   'label', '1 Tag',     'days', 1,     'price', public._pls('pro_price_d1')::bigint),
    jsonb_build_object('id', 'd7',   'label', '1 Woche',   'days', 7,     'price', public._pls('pro_price_d7')::bigint),
    jsonb_build_object('id', 'd30',  'label', '1 Monat',   'days', 30,    'price', public._pls('pro_price_d30')::bigint),
    jsonb_build_object('id', 'd90',  'label', '3 Monate',  'days', 90,    'price', public._pls('pro_price_d90')::bigint),
    jsonb_build_object('id', 'life', 'label', 'Für immer', 'days', 36500, 'price', public._pls('pro_price_life')::bigint));
$$;

-- Foto-Scan: Pro (oder Plus, wenn eingestellt)
create or replace function public._ocr_allowed(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public._pro_active(p_user) or (public._pls('pro_ocr_plus') >= 1 and public._plus_active(p_user));
$$;

-- Premium-Skins im Parkour für Pro-Mitglieder (beim Ablauf werden nur die von Pro geschenkten wieder entfernt)
create or replace function public._pro_sync(p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_items text[] := array[
    'color:gold', 'color:neon', 'color:regenbogen', 'color:galaxie', 'color:lava',
    'hat:krone', 'hat:feuer', 'hat:zauberer', 'hat:einhorn', 'hat:heiligenschein',
    'fx:schwarzesloch', 'fx:blitz', 'fx:feuerspur', 'fx:galaxiewirbel', 'fx:regenbogenstrahl'];
  v_pp public.parkour_profiles;
  v_new text[];
begin
  insert into public.parkour_profiles (user_id) values (p_user) on conflict do nothing;
  select * into v_pp from public.parkour_profiles where user_id = p_user;
  if public._pro_active(p_user) then
    v_new := array(select i from unnest(v_items) i where not (i = any (v_pp.owned)));
    if cardinality(v_new) > 0 then
      update public.parkour_profiles
         set owned = owned || v_new, pro_granted = array(select distinct x from unnest(pro_granted || v_new) x)
       where user_id = p_user;
    end if;
  elsif cardinality(v_pp.pro_granted) > 0 then
    update public.parkour_profiles
       set owned = array(select o from unnest(owned) o where not (o = any (v_pp.pro_granted))),
           pro_granted = '{}',
           color = case when 'color:' || color = any (v_pp.pro_granted) then null else color end,
           hat = case when 'hat:' || hat = any (v_pp.pro_granted) then null else hat end,
           fx = case when 'fx:' || fx = any (v_pp.pro_granted) then null else fx end
     where user_id = p_user;
  end if;
end;
$$;

create or replace function public._pk_hearts(p_user uuid, p_extra integer)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(p_extra, 0) + case when public._pro_active(p_user) then public._pls('pro_hearts')::integer else 0 end;
$$;

-- Pro kaufen (Coins)
create or replace function public.pro_buy(p_tier text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  p public.profiles;
  t jsonb;
  v_days integer;
  v_price bigint;
begin
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  select e into t from jsonb_array_elements(public._pro_tiers()) e where e ->> 'id' = p_tier;
  if t is null then
    raise exception 'Unbekannte Stufe.' using errcode = '22023';
  end if;
  v_days := (t ->> 'days')::integer;
  v_price := (t ->> 'price')::bigint;
  select * into p from public.profiles where id = v_me for update;
  if p.pro_until >= '2099-01-01'::timestamptz then
    raise exception 'Du hast Pro schon für immer.' using errcode = '23505';
  end if;
  perform public._grant_koins(v_me, -v_price, 'pro_buy', p_tier);
  update public.profiles
     set pro_until = case when v_days >= 36500 then '2100-01-01'::timestamptz
                          else greatest(coalesce(pro_until, now()), now()) + make_interval(days => v_days) end
   where id = v_me;
  insert into public.plus_sales (user_id, kind, cents, days, coins, note)
  values (v_me, 'coins', 0, v_days, v_price, format('Pro · %s · %s Coins', t ->> 'label', v_price));
  perform public._plus_apply_perks(v_me);
  perform public._pro_sync(v_me);
  return public.plus_status();
end;
$$;

-- Admin: Pro schenken (Tage, 36500 = für immer, 0 = entfernen)
create or replace function public.admin_pro_grant(p_user uuid, p_days integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._require_admin();
  if p_days is null or p_days < 0 or p_days > 36500 then
    raise exception 'Ungültige Tage.' using errcode = '22023';
  end if;
  update public.profiles
     set pro_until = case when p_days = 0 then null
                          when p_days >= 36500 then '2100-01-01'::timestamptz
                          else greatest(coalesce(pro_until, now()), now()) + make_interval(days => p_days) end
   where id = p_user;
  perform public._pro_sync(p_user);
end;
$$;

-- Parkour: Sprünge, Lernen aus, Zuschauen, Heilen
create or replace function public.can_spectate()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_admin()
      or (public.is_staff() and coalesce((select r.spectate from public.staff_rights r where r.user_id = (select auth.uid())), false))
      or (public._pro_active((select auth.uid())) and public._pls('pro_spectate') >= 1);
$$;

create or replace function public.my_run_perks()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'spectate', public.can_spectate(),
    'heal', public.can_heal() or (public._pro_active((select auth.uid())) and public._pls('pro_heal_per_run') >= 1),
    'heal_limit', case when public.can_heal() then null
                       when public._pro_active((select auth.uid())) then public._pls('pro_heal_per_run')::integer else 0 end,
    'look', public._staff_look((select auth.uid())),
    'allowed', to_jsonb(public._allowed_looks((select auth.uid()))),
    'entrance', (select pp.entrance from public.parkour_profiles pp where pp.user_id = (select auth.uid())))
   where (select auth.uid()) is not null;
$$;

-- ----------------------------------------------------------------------------
-- Vorhandene Funktionen gezielt anpassen (Text ersetzen); schon angepasste werden übersprungen.
-- ----------------------------------------------------------------------------
create or replace function public._pro_patch(p_from text, p_to text, p_marker text, p_names text[] default null)
returns integer
language plpgsql
as $$
declare
  r record;
  v_def text;
  v_new text;
  n integer := 0;
begin
  for r in
    select p.oid, p.proname, p.prosrc
      from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public' and position(p_from in p.prosrc) > 0 and position(p_marker in p.prosrc) = 0
       and (p_names is null or p.proname = any (p_names))
  loop
    v_def := pg_get_functiondef(r.oid);
    v_new := replace(v_def, p_from, p_to);
    if v_new <> v_def then
      execute v_new;
      n := n + 1;
    end if;
  end loop;
  return n;
end;
$$;

do $$
declare n integer;
begin
  -- Coins und Punkte
  perform public._pro_patch($f$greatest(public._pls('plus_coin_mult'), 1)$f$,
    $t$greatest(public._pls('plus_coin_mult'), case when public._pro_active(p_user) then public._pls('pro_coin_mult') else 1 end, 1)$t$, 'pro_coin_mult');
  perform public._pro_patch($f$greatest(public._pls('plus_points_mult'), 1)$f$,
    $t$greatest(public._pls('plus_points_mult'), case when public._pro_active(p_user) then public._pls('pro_points_mult') else 1 end, 1)$t$, 'pro_points_mult');
  -- Gambling (Plus- und Pro-Bonus; die Plus-Anpassung aus 0024 war durch spätere Fassungen von gambling_play verloren gegangen)
  perform public._pro_patch($f$v_win integer := least(greatest(public.setting('gambling_win_permille'), 0), 1000);$f$,
    $t$v_win integer := least(round(greatest(public.setting('gambling_win_permille'), 0) * (1 + case when public._plus_active((select auth.uid()))
      then greatest(public._pls('plus_gamble_boost_percent'), case when public._pro_active((select auth.uid())) then public._pls('pro_gamble_boost_percent') else 0 end) / 100.0 else 0 end))::integer, 1000);$t$,
    'plus_gamble_boost_percent', array['gambling_play']);
  perform public._pro_patch($f$public._pls('plus_gamble_boost_percent') / 100.0$f$,
    $t$greatest(public._pls('plus_gamble_boost_percent'), case when public._pro_active((select auth.uid())) then public._pls('pro_gamble_boost_percent') else 0 end) / 100.0$t$,
    'pro_gamble_boost_percent', array['gambling_play']);
  -- Parkour-Limit
  perform public._pro_patch($f$v_day_cap := (greatest(v_budget - v_before, 0) / greatest(v_left, 1)) * 4;$f$,
    $t$v_day_cap := (greatest(v_budget - v_before, 0) / greatest(v_left, 1)) * 4;
  if public._pro_active((select auth.uid())) then v_day_cap := (v_day_cap * public._pls('pro_parkour_limit_mult'))::bigint; end if;$t$,
    'pro_parkour_limit_mult', array['_parkour_usage_state']);
  -- Herzen aller Mitspieler
  select public._pro_patch($f$'pk_hearts', coalesce(pp.extra_hearts, 0)$f$,
    $t$'pk_hearts', public._pk_hearts(pr.id, pp.extra_hearts)$t$, '_pk_hearts(') into n;
  -- Quests
  perform public._pro_patch($f$('plus_games', 2, 8, 2, 10, true)),$f$,
    $t$('plus_games', 2, 8, 2, 10, true),
    ('pro_answers', 1, 400, 1, public._pls('pro_quest_base')::integer, true),
    ('pro_answers', 2, 800, 3, public._pls('pro_quest_base')::integer, true),
    ('pro_perfect', 1, 4, 2, public._pls('pro_quest_base')::integer, true),
    ('pro_perfect', 2, 6, 4, public._pls('pro_quest_base')::integer, true),
    ('pro_sprint', 1, 60, 2, public._pls('pro_quest_base')::integer, true),
    ('pro_duel', 1, 12, 3, public._pls('pro_quest_base')::integer, true),
    ('pro_duel', 2, 20, 5, public._pls('pro_quest_base')::integer, true),
    ('pro_games', 1, 15, 2, public._pls('pro_quest_base')::integer, true),
    ('pro_games', 2, 30, 4, public._pls('pro_quest_base')::integer, true)),$t$, 'pro_answers', array['get_quests']);
  perform public._pro_patch($f$when 'plus_answers' then v_answers else v_games end$f$,
    $t$when 'plus_answers' then v_answers when 'pro_answers' then v_answers when 'pro_perfect' then v_perfect
                         when 'pro_sprint' then v_sprint when 'pro_duel' then v_duel else v_games end$t$, 'pro_perfect', array['get_quests']);
  perform public._pro_patch($f$if q.plus_only and not public._plus_active(v_me) then$f$,
    $t$if (q.plus_only and not public._plus_active(v_me)) or (q.family like 'pro\_%' and not public._pro_active(v_me)) then$t$, 'pro\_%', array['claim_quest']);
end;
$$;
drop function public._pro_patch(text, text, text, text[]);

-- plus_status um Pro erweitern
do $$
declare
  r record;
  v_def text;
  v_new text;
begin
  for r in select p.oid, p.prosrc from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace where ns.nspname = 'public' and p.proname = 'plus_status'
  loop
    if position('pro_until' in r.prosrc) > 0 then continue; end if;
    v_def := pg_get_functiondef(r.oid);
    v_new := replace(v_def, 'perform public._plus_sync(v_me);', E'perform public._plus_sync(v_me);\n  perform public._pro_sync(v_me);');
    v_new := replace(v_new, $f$'revive_price', public._pls('plus_revive_price'),$f$, $t$'revive_price', public._pls('plus_revive_price'),
    'pro', coalesce(p.pro_until > now(), false) or p.role = 'admin',
    'pro_until', case when p.role = 'admin' then null else p.pro_until end,
    'pro_lifetime', coalesce(p.pro_until >= '2099-01-01'::timestamptz, false),
    'pro_tiers', public._pro_tiers(),
    'ocr_allowed', public._ocr_allowed(v_me),
    'pro_perks', jsonb_build_object(
      'coin_mult', public._pls('pro_coin_mult'), 'points_mult', public._pls('pro_points_mult'), 'gamble_boost', public._pls('pro_gamble_boost_percent'),
      'hearts', public._pls('pro_hearts'), 'jumps', public._pls('pro_jumps'), 'jump_extra', public._pls('pro_jump_extra'),
      'no_learn', public._pls('pro_no_learn') >= 1, 'spectate', public._pls('pro_spectate') >= 1, 'heal_per_run', public._pls('pro_heal_per_run'),
      'parkour_limit_mult', public._pls('pro_parkour_limit_mult'), 'advent_mult', public._pls('pro_advent_mult')),$t$);
    if v_new = v_def then
      raise exception 'plus_status konnte nicht für Pro angepasst werden.';
    end if;
    execute v_new;
  end loop;
end;
$$;

-- Adventskalender: Pro zieht bessere Türchen
do $$
declare r record;
begin
  -- Grundlogik (wie 0070) unter neuem Namen sichern, falls noch nicht geschehen
  if not exists (select 1 from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace where ns.nspname = 'public' and p.proname = '_advent_plan_base') then
    for r in select p.oid from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace where ns.nspname = 'public' and p.proname = '_advent_plan'
    loop
      execute regexp_replace(pg_get_functiondef(r.oid), 'function public\._advent_plan\(', 'function public._advent_plan_base(', 'i');
    end loop;
  end if;
end;
$$;

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
  if not public._pro_active((select auth.uid())) then
    return v_plan;
  end if;
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
  return v_out;
end;
$$;

-- Rechte
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('pro_buy', 'admin_pro_grant', '_pro_active', '_pro_tiers', '_ocr_allowed', '_pro_sync', '_pk_hearts', '_advent_plan_base')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    if r.proname in ('pro_buy', 'admin_pro_grant') then
      execute format('grant execute on function %s to authenticated', r.sig);
    end if;
  end loop;
end;
$$;

-- Parkour: Pro-Sprünge und "keine Vokabeln" für Pro
create or replace function public.parkour_jumps_list(p_ids uuid[])
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_object_agg(x.uid::text, x.jumps), '{}'::jsonb)
    from (
      select u.uid,
             case when public._pro_active(u.uid)
                  then greatest(public._pls('pro_jumps')::integer,
                                case when coalesce(j.jumps, 2) >= 3 then j.jumps + public._pls('pro_jump_extra')::integer else 0 end)
                  else j.jumps end as jumps
        from unnest(coalesce(p_ids, '{}'::uuid[])) as u(uid)
        left join public.parkour_jumps j on j.user_id = u.uid
    ) x
   where x.jumps is not null and (select auth.uid()) is not null;
$$;

create or replace function public.parkour_learn_off_list(p_ids uuid[])
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(u.uid), '{}'::uuid[])
    from unnest(coalesce(p_ids, '{}'::uuid[])) as u(uid)
   where (exists (select 1 from public.parkour_learn_off o where o.user_id = u.uid)
          or (public._pro_active(u.uid) and public._pls('pro_no_learn') >= 1))
     and (select auth.uid()) is not null;
$$;

-- Pi-Schutz: Standard von 450 auf 200 ms pro Stelle gesenkt (schnelles Tippen auswendig gelernter Stellen wurde fälschlich abgelehnt).
update public.app_settings set value = 200 where key = 'memo_pi_min_ms' and value = 450;
-- 0074: Loot Drop (neuer Menüpunkt). Jeden Tag ein Paket für alle (nur die schnellste Person bekommt es, etwas besser)
-- und ein persönliches Paket für jede Person. Inhalt: Coins, Punkte oder Verkleidungen/Designs.
-- Dazu: Adventskalender zurücksetzen (Admin) und Coins an zufällige Personen verschenken (Admin). Wiederholbar.

-- Sperr-Schlüssel um 'loot' erweitern
create or replace function public._lock_keys()
returns text[]
language sql
immutable
set search_path = public
as $$
  select array['games', 'gambling', 'sprint', 'duels', 'chat', 'shop', 'quests', 'print',
               'parkour', 'learn', 'copy', 'cards', 'cram', 'test', 'practice', 'grammar', 'irregular', 'conjugate', 'gender',
               'books', 'search', 'math', 'memorize', 'homework', 'advent', 'ranking', 'stats', 'presence', 'websites', 'plus',
               'board', 'feedback', 'loot'];
$$;
alter table public.feature_locks drop constraint if exists feature_locks_key_check;
alter table public.feature_locks add constraint feature_locks_key_check check (key = any (public._lock_keys()));

-- Einstellungen (Verwaltung → Zahlen → Loot Drop)
insert into public.app_settings (key, value, mod_editable) values
  ('loot_p_w_coins', 55, false), ('loot_p_w_points', 30, false), ('loot_p_w_item', 15, false),
  ('loot_p_coins_min', 20, false), ('loot_p_coins_spread', 60, false),
  ('loot_p_points_min', 5, false), ('loot_p_points_spread', 10, false), ('loot_p_item_price', 300, false),
  ('loot_g_w_coins', 40, false), ('loot_g_w_points', 30, false), ('loot_g_w_item', 30, false),
  ('loot_g_coins_min', 150, false), ('loot_g_coins_spread', 250, false),
  ('loot_g_points_min', 20, false), ('loot_g_points_spread', 30, false), ('loot_g_item_price', 1500, false)
on conflict (key) do nothing;

create table if not exists public.loot_global (
  day date primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  rewards jsonb not null default '[]'::jsonb,
  opened_at timestamptz not null default now()
);
create table if not exists public.loot_personal (
  user_id uuid not null references auth.users (id) on delete cascade,
  day date not null,
  rewards jsonb not null default '[]'::jsonb,
  opened_at timestamptz not null default now(),
  primary key (user_id, day)
);
create table if not exists public.loot_gifts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  amount bigint not null,
  seen boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.loot_global enable row level security;
alter table public.loot_personal enable row level security;
alter table public.loot_gifts enable row level security;
revoke all on public.loot_global, public.loot_personal, public.loot_gifts from anon, authenticated;

create or replace function public._loot_today()
returns date
language sql
stable
set search_path = public
as $$ select (now() at time zone 'Europe/Berlin')::date; $$;

-- Würfelt den Inhalt eines Pakets und schreibt ihn gut. p_kind: 'p' (persönlich) oder 'g' (für alle). Pro: Beträge/Artikelwert × pro_advent_mult.
create or replace function public._loot_roll(p_user uuid, p_kind text, p_ref text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_wc integer := public.setting('loot_' || p_kind || '_w_coins');
  v_wp integer := public.setting('loot_' || p_kind || '_w_points');
  v_wi integer := public.setting('loot_' || p_kind || '_w_item');
  v_mult numeric := case when public._pro_active(p_user) then greatest(public._pls('pro_advent_mult'), 1) else 1 end;
  v_roll numeric;
  v_amount bigint;
  v_item record;
  v_out jsonb;
begin
  if v_wc + v_wp + v_wi <= 0 then
    return '[]'::jsonb;
  end if;
  v_roll := random() * (v_wc + v_wp + v_wi);
  if v_roll < v_wc then
    v_amount := round((public.setting('loot_' || p_kind || '_coins_min')
      + floor(random() * (public.setting('loot_' || p_kind || '_coins_spread') + 1))) * v_mult)::bigint;
    perform public._grant_koins(p_user, v_amount, 'loot', p_ref);
    return jsonb_build_array(jsonb_build_object('type', 'coins', 'amount', v_amount));
  elsif v_roll < v_wc + v_wp then
    v_amount := round((public.setting('loot_' || p_kind || '_points_min')
      + floor(random() * (public.setting('loot_' || p_kind || '_points_spread') + 1))) * v_mult)::bigint;
    insert into public.points_adjustments (user_id, points, reason, created_by)
    values (p_user, v_amount::integer, 'Loot Drop', null);
    return jsonb_build_array(jsonb_build_object('type', 'points', 'amount', v_amount));
  end if;
  select i.id, i.kind, i.name, i.price into v_item
    from public.shop_items i
   where i.kind in ('avatar', 'color', 'effect', 'theme')
     and i.price > 0 and i.price <= public.setting('loot_' || p_kind || '_item_price') * v_mult
     and not exists (select 1 from public.user_items u where u.user_id = p_user and u.item_id = i.id)
   order by random() limit 1;
  if not found then
    v_amount := round((public.setting('loot_' || p_kind || '_coins_min') + public.setting('loot_' || p_kind || '_coins_spread') / 2) * v_mult)::bigint;
    perform public._grant_koins(p_user, v_amount, 'loot', p_ref);
    return jsonb_build_array(jsonb_build_object('type', 'coins', 'amount', v_amount));
  end if;
  insert into public.user_items (user_id, item_id) values (p_user, v_item.id);
  v_out := jsonb_build_array(jsonb_build_object('type', 'item', 'id', v_item.id, 'kind', v_item.kind, 'name', v_item.name, 'price', v_item.price));
  return v_out;
end;
$$;

create or replace function public.loot_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  v_day date := public._loot_today();
  v_g public.loot_global;
  v_p public.loot_personal;
begin
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht erlaubt.' using errcode = '42501';
  end if;
  select * into v_g from public.loot_global where day = v_day;
  select * into v_p from public.loot_personal where user_id = v_me and day = v_day;
  return jsonb_build_object(
    'day', v_day,
    'personal', jsonb_build_object('opened', v_p.user_id is not null, 'rewards', coalesce(v_p.rewards, '[]'::jsonb)),
    'global', jsonb_build_object(
      'opened', v_g.user_id is not null,
      'mine', v_g.user_id = v_me,
      'by', (select p.display_name from public.profiles p where p.id = v_g.user_id),
      'rewards', case when v_g.user_id = v_me then v_g.rewards else '[]'::jsonb end),
    'gifts', coalesce((select jsonb_agg(jsonb_build_object('id', g.id, 'amount', g.amount) order by g.created_at)
                         from public.loot_gifts g where g.user_id = v_me and not g.seen), '[]'::jsonb));
end;
$$;

create or replace function public.loot_open(p_kind text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  v_day date := public._loot_today();
  v_rows integer;
  v_by text;
  v_out jsonb;
begin
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht erlaubt.' using errcode = '42501';
  end if;
  if p_kind = 'global' then
    insert into public.loot_global (day, user_id) values (v_day, v_me) on conflict (day) do nothing;
    get diagnostics v_rows = row_count;
    if v_rows = 0 then
      select p.display_name into v_by from public.loot_global g join public.profiles p on p.id = g.user_id where g.day = v_day;
      raise exception 'Zu langsam! % hat das Paket heute schon geöffnet.', coalesce(v_by, 'Jemand') using errcode = '23505';
    end if;
    v_out := public._loot_roll(v_me, 'g', 'global');
    update public.loot_global set rewards = v_out where day = v_day;
  elsif p_kind = 'personal' then
    insert into public.loot_personal (user_id, day) values (v_me, v_day) on conflict do nothing;
    get diagnostics v_rows = row_count;
    if v_rows = 0 then
      raise exception 'Dein Paket für heute hast du schon geöffnet.' using errcode = '23505';
    end if;
    v_out := public._loot_roll(v_me, 'p', 'personal');
    update public.loot_personal set rewards = v_out where user_id = v_me and day = v_day;
  else
    raise exception 'Unbekanntes Paket.' using errcode = '22023';
  end if;
  return jsonb_build_object('kind', p_kind, 'rewards', v_out);
end;
$$;

create or replace function public.loot_gifts_seen()
returns void
language sql
security definer
set search_path = public
as $$
  update public.loot_gifts set seen = true where user_id = (select auth.uid()) and not seen;
$$;

-- Admin: Coins an zufällige Personen verschenken (ohne dich selbst, ohne gesperrte Konten)
create or replace function public.admin_loot_gift(p_count integer, p_amount bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  r record;
  v_names jsonb := '[]'::jsonb;
begin
  perform public._require_admin();
  if p_count is null or p_count < 1 or p_count > 100 then
    raise exception 'Anzahl: 1 bis 100.' using errcode = '22023';
  end if;
  if p_amount is null or p_amount < 1 or p_amount > 1000000 then
    raise exception 'Betrag: 1 bis 1.000.000 Coins.' using errcode = '22023';
  end if;
  for r in
    select p.id, p.display_name from public.profiles p
     where p.id <> v_me and not p.blocked
     order by random() limit p_count
  loop
    perform public._grant_koins(r.id, p_amount, 'admin', 'loot_gift');
    insert into public.loot_gifts (user_id, amount) values (r.id, p_amount);
    v_names := v_names || to_jsonb(r.display_name);
  end loop;
  return v_names;
end;
$$;

-- Admin: Adventskalender zurücksetzen (alle Türchen dieses Jahres wieder zu). Schon erhaltene Belohnungen bleiben.
create or replace function public.admin_advent_reset(p_all boolean)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n integer;
begin
  perform public._require_admin();
  delete from public.advent_opened where year = public._advent_year() and (p_all or user_id = (select auth.uid()));
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- Admin: Loot Drop von heute zurücksetzen (zum Testen)
create or replace function public.admin_loot_reset(p_all boolean)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n integer;
  v_m integer;
begin
  perform public._require_admin();
  delete from public.loot_personal where day = public._loot_today() and (p_all or user_id = (select auth.uid()));
  get diagnostics v_n = row_count;
  delete from public.loot_global where day = public._loot_today();
  get diagnostics v_m = row_count;
  return v_n + v_m;
end;
$$;

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('_lock_keys', '_loot_today', '_loot_roll', 'loot_status', 'loot_open', 'loot_gifts_seen',
                                                  'admin_loot_gift', 'admin_advent_reset', 'admin_loot_reset')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    if r.proname in ('loot_status', 'loot_open', 'loot_gifts_seen', 'admin_loot_gift', 'admin_advent_reset', 'admin_loot_reset') then
      execute format('grant execute on function %s to authenticated', r.sig);
    end if;
  end loop;
end;
$$;
-- 0075: Foto-Scan einzelnen Personen freischalten (ohne Pro). Admins haben ihn ohnehin. Wiederholbar.
alter table public.profiles add column if not exists ocr_granted boolean not null default false;

create or replace function public._ocr_allowed(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public._pro_active(p_user)
      or (public._pls('pro_ocr_plus') >= 1 and public._plus_active(p_user))
      or coalesce((select p.ocr_granted and not p.blocked from public.profiles p where p.id = p_user), false);
$$;

create or replace function public.admin_set_ocr(p_user uuid, p_on boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._require_admin();
  update public.profiles set ocr_granted = coalesce(p_on, false) where id = p_user;
end;
$$;

create or replace function public.admin_get_ocr(p_user uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public._require_admin();
  return coalesce((select ocr_granted from public.profiles where id = p_user), false);
end;
$$;

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('_ocr_allowed', 'admin_set_ocr', 'admin_get_ocr')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    if r.proname like 'admin\_%' then
      execute format('grant execute on function %s to authenticated', r.sig);
    end if;
  end loop;
end;
$$;

-- 0076: Reparatur für 0073. Dort wurde die Grundfunktion für den Adventskalender (_advent_plan_base) wegen Groß-/Kleinschreibung
-- nicht angelegt, dadurch kam beim Türchen-Öffnen „Eine Datenbankfunktion fehlt". Diese Datei legt sie an (Logik wie 0070). Wiederholbar.
create or replace function public._advent_plan_base(p_day integer)
returns jsonb
language plpgsql
volatile
set search_path = public
as $$
declare
  v_wc integer := public.setting('advent_w_coins');
  v_wp integer := public.setting('advent_w_points');
  v_wl integer := public.setting('advent_w_plus');
  v_wi integer := case when p_day >= 2 then public.setting('advent_w_item') else 0 end;
  v_total integer;
  v_roll numeric;
begin
  if p_day = 24 then
    return jsonb_build_array(
      jsonb_build_object('type', 'item', 'max_price', public.setting('advent_final_item_price')),
      jsonb_build_object('type', 'plus', 'days', public.setting('advent_final_plus_days')),
      jsonb_build_object('type', 'coins', 'amount', public.setting('advent_final_coins') + floor(random() * (public.setting('advent_final_coins_spread') + 1))::integer));
  end if;
  v_total := v_wc + v_wp + v_wl + v_wi;
  if v_total <= 0 then
    return '[]'::jsonb;
  end if;
  v_roll := random() * v_total;
  if v_roll < v_wc then
    return jsonb_build_array(jsonb_build_object('type', 'coins',
      'amount', (public.setting('advent_coins_min') + floor(random() * (public.setting('advent_coins_spread') + p_day * public.setting('advent_coins_per_day') + 1))::integer) / 10 * 10));
  elsif v_roll < v_wc + v_wp then
    return jsonb_build_array(jsonb_build_object('type', 'points',
      'amount', public.setting('advent_points_min') + floor(random() * (public.setting('advent_points_spread') + p_day * public.setting('advent_points_per_day') + 1))::integer));
  elsif v_roll < v_wc + v_wp + v_wl then
    return jsonb_build_array(jsonb_build_object('type', 'plus',
      'days', public.setting('advent_plus_days_min') + floor(random() * (1 + p_day * public.setting('advent_plus_days_per_6') / 6.0))::integer));
  end if;
  return jsonb_build_array(jsonb_build_object('type', 'item', 'max_price', public.setting('advent_item_price_base') + p_day * public.setting('advent_item_price_per_day')));
end;
$$;

do $$
declare r record;
begin
  for r in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = '_advent_plan_base'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
  end loop;
end;
$$;
-- 0077: 1) „Zuletzt gekauft" bei Plus & Pro  2) Admin: Person in der Liga hoch/runter  3) watch_progress: ein leichter Aufruf für
-- „Quest abholbar" und „Du hast jemanden überholt" (Wochenrangliste). Wiederholbar.

-- 1) Letzte Käufe (nur mit Coins bezahlt; Pro erkennt man am Text der Notiz)
create or replace function public.plus_recent_buys()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if (select auth.uid()) is null or public.is_blocked() then
    raise exception 'Nicht erlaubt.' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', s.id, 'name', p.display_name, 'pro', s.note like 'Pro ·%', 'days', s.days, 'coins', s.coins, 'at', s.created_at)
           order by s.created_at desc)
      from (select * from public.plus_sales where kind = 'coins' and user_id is not null order by created_at desc limit 12) s
      join public.profiles p on p.id = s.user_id and not p.blocked), '[]'::jsonb);
end;
$$;

-- 2) Liga: Stufe 1 bis 5 (Bronze bis Diamant)
create or replace function public.admin_league_move(p_user uuid, p_delta integer)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tier integer;
begin
  perform public._require_admin();
  insert into public.league_members (user_id) values (p_user) on conflict do nothing;
  update public.league_members set tier = least(5, greatest(1, tier + coalesce(p_delta, 0))) where user_id = p_user returning tier into v_tier;
  return v_tier;
end;
$$;

create or replace function public.admin_league_tier(p_user uuid)
returns integer
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public._require_admin();
  return (select tier from public.league_members where user_id = p_user);
end;
$$;

-- 3) Ein Aufruf: abholbare Quests + Platz in der Wochenrangliste mit Nachbarn
create or replace function public.watch_progress()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  v_claim jsonb;
  v_rows jsonb;
  v_rank bigint;
  v_pts bigint;
begin
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht erlaubt.' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', q.id, 'family', q.family, 'stage', q.stage, 'reward', q.reward) order by q.id), '[]'::jsonb)
    into v_claim from public.get_quests() q where q.progress >= q.goal and not q.claimed;

  create temporary table if not exists _wp_tmp (rank bigint, display_name text, points bigint, is_me boolean, avatar_id text, color_id text) on commit drop;
  delete from _wp_tmp where true;
  insert into _wp_tmp select l.rank, l.display_name, l.points, l.is_me, l.avatar_id, l.color_id from public.get_leaderboard('week') l;
  select t.rank, t.points into v_rank, v_pts from _wp_tmp t where t.is_me;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.rank, x.display_name), '[]'::jsonb) into v_rows
    from (select * from _wp_tmp t where v_rank is null and t.rank <= 6 or v_rank is not null and t.rank between v_rank - 4 and v_rank + 4) x;
  return jsonb_build_object('claimable', v_claim, 'rank', v_rank, 'points', v_pts, 'rows', v_rows);
end;
$$;

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('plus_recent_buys', 'admin_league_move', 'admin_league_tier', 'watch_progress')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;
end;
$$;

-- 0078: Plus-/Pro-Punkte-Multiplikator gilt nur für Punkte, die man verdient, solange Plus/Pro aktiv ist.
-- Vorher wurde der Multiplikator beim Anzeigen auf ALLE Punkte gerechnet: Beim Kauf verdoppelte sich der Stand rückwirkend,
-- beim Ablauf ging er wieder weg. Jetzt wird der Bonus beim Verdienen gespeichert (daily_stats.bonus_pts) und bleibt.
-- Hinweis: Alte Tage haben Bonus 0; es zählt ab jetzt nur, was bei aktivem Plus/Pro verdient wird. Wiederholbar.
alter table public.daily_stats add column if not exists bonus_pts numeric not null default 0;

create or replace function public._daily_bonus()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new numeric;
  v_old numeric := 0;
  v_f numeric;
begin
  v_f := public._plus_points_factor(new.user_id);
  v_new := public._day_points(new.answers_correct, new.answers_total) + public._choice_points(new.choice_correct) + public._math_points(new.math_correct);
  if tg_op = 'UPDATE' then
    v_old := public._day_points(old.answers_correct, old.answers_total) + public._choice_points(old.choice_correct) + public._math_points(old.math_correct);
    new.bonus_pts := greatest(0, coalesce(old.bonus_pts, 0) + (v_new - v_old) * (v_f - 1));
  else
    new.bonus_pts := greatest(0, v_new * (v_f - 1));
  end if;
  return new;
end;
$$;

drop trigger if exists daily_bonus on public.daily_stats;
create trigger daily_bonus before insert or update of answers_correct, answers_total, choice_correct, math_correct on public.daily_stats
  for each row execute function public._daily_bonus();

create or replace function public._week_points(p_user uuid, p_from date)
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select round(coalesce((select sum(public._day_points(d.answers_correct, d.answers_total)
                                    + public._choice_points(d.choice_correct)
                                    + public._math_points(d.math_correct) + d.bonus_pts)
                           from public.daily_stats d
                          where d.user_id = p_user and d.day between p_from and p_from + 6), 0))::bigint
       + coalesce((select sum(a.points) from public.points_adjustments a
                    where a.user_id = p_user
                      and (a.created_at at time zone 'Europe/Berlin')::date between p_from and p_from + 6), 0)::bigint;
$$;

create or replace function public.get_leaderboard(p_period text default 'week')
returns table (rank bigint, display_name text, points bigint, is_me boolean,
               avatar_id text, color_id text, effect_id text, role text, tag_id text, theme_id text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_from date;
  v_me uuid := (select auth.uid());
begin
  if v_me is null then
    raise exception 'Nicht angemeldet' using errcode = '28000';
  end if;

  if p_period = 'week' then
    v_from := date_trunc('week', timezone('Europe/Berlin', now()))::date;
  elsif p_period = 'month' then
    v_from := date_trunc('month', timezone('Europe/Berlin', now()))::date;
  elsif p_period = 'all' then
    v_from := null;
  else
    raise exception 'Ungültiger Zeitraum: %', p_period using errcode = '22023';
  end if;

  return query
  with days as (
    select d.user_id as uid,
           sum(public._day_points(d.answers_correct, d.answers_total)
               + public._choice_points(d.choice_correct)
               + public._math_points(d.math_correct) + d.bonus_pts) as pts
      from public.daily_stats d
     where v_from is null or d.day >= v_from
     group by d.user_id
  ), parts as (
    select x.uid, round(x.pts)::bigint as pts from days x
    union all
    select a.user_id, a.points::bigint
      from public.points_adjustments a
     where v_from is null or (a.created_at at time zone 'Europe/Berlin')::date >= v_from
  ), scored as (
    select uid, sum(pts)::bigint as pts from parts group by uid
  )
  select
    (rank() over (order by s.pts desc))::bigint,
    pr.display_name,
    s.pts,
    (s.uid = v_me),
    pr.avatar_id, pr.color_id, pr.effect_id, pr.role, pr.tag_id, pr.theme_id
  from scored s
  join public.profiles pr on pr.id = s.uid and not pr.blocked
  where s.pts > 0
  order by s.pts desc, pr.display_name
  limit 100;
end;
$$;

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('_daily_bonus', '_week_points', 'get_leaderboard')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    if r.proname = 'get_leaderboard' then
      execute format('grant execute on function %s to authenticated', r.sig);
    end if;
  end loop;
end;
$$;
-- 0079: Online-Spiele gegeneinander (Schnick Schnack Schnuck, Mensch ärgere dich nicht, Schiffe versenken)
-- + Admin: Parkour-Rekorde löschen. Die Regeln laufen komplett auf dem Server (Würfel, Treffer, Gewinner), versteckte Infos
-- (Schiffe, geheime Auswahl) sieht nur die jeweilige Person. Die Echtzeit-Benachrichtigung („du bist dran") läuft im Browser über
-- die Spiel-Datenbanken (Broadcast), nicht über die Haupt-Datenbank. Wiederholbar.

-- Sperr-Schlüssel 'online'
create or replace function public._lock_keys()
returns text[]
language sql
immutable
set search_path = public
as $$
  select array['games', 'gambling', 'sprint', 'duels', 'chat', 'shop', 'quests', 'print',
               'parkour', 'learn', 'copy', 'cards', 'cram', 'test', 'practice', 'grammar', 'irregular', 'conjugate', 'gender',
               'books', 'search', 'math', 'memorize', 'homework', 'advent', 'ranking', 'stats', 'presence', 'websites', 'plus',
               'board', 'feedback', 'loot', 'online'];
$$;
alter table public.feature_locks drop constraint if exists feature_locks_key_check;
alter table public.feature_locks add constraint feature_locks_key_check check (key = any (public._lock_keys()));

-- ---------------------------------------------------------------------------------------------
-- Admin: Parkour-Rekorde löschen (Deathrun: Rekord einer Person; Team: Rekord eines Teams; ohne Namen: alle)
-- ---------------------------------------------------------------------------------------------
create or replace function public.admin_parkour_delete(p_kind text, p_name text default null, p_name2 text default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_a uuid;
  v_b uuid;
  v_n integer;
begin
  perform public._require_admin();
  if p_kind not in ('deathrun', 'team') then
    raise exception 'Unbekannte Art.' using errcode = '22023';
  end if;
  if p_name is not null then
    select id into v_a from public.profiles where lower(display_name) = lower(p_name);
    if v_a is null then raise exception 'Person nicht gefunden.' using errcode = 'P0002'; end if;
  end if;
  if p_kind = 'deathrun' then
    delete from public.deathrun_results where v_a is null or user_id = v_a;
  else
    if p_name2 is not null then
      select id into v_b from public.profiles where lower(display_name) = lower(p_name2);
    end if;
    update public.team_runs set levels = null
     where kind = 'parkour' and levels is not null
       and (v_a is null or (host_id = v_a and (v_b is null or partner_id = v_b)) or (partner_id = v_a and (v_b is null or host_id = v_b)));
  end if;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Tabellen
-- ---------------------------------------------------------------------------------------------
create table if not exists public.og_games (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('rps', 'ludo', 'ships')),
  host_id uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'lobby' check (status in ('lobby', 'running', 'finished', 'cancelled')),
  state jsonb not null default '{}'::jsonb,
  turn_seat integer,
  winner_seat integer,
  version integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.og_players (
  game_id uuid not null references public.og_games (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  seat integer,
  join_state text not null default 'invited' check (join_state in ('invited', 'joined', 'declined', 'left')),
  secret jsonb not null default '{}'::jsonb,
  primary key (game_id, user_id)
);
create index if not exists og_players_user_idx on public.og_players (user_id);
alter table public.og_games enable row level security;
alter table public.og_players enable row level security;
revoke all on public.og_games, public.og_players from anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- Mensch ärgere dich nicht: Regeln
-- Feld einer Figur (relativ zum eigenen Start): -1 = im Haus, 0..39 = Rundweg, 40..43 = Zielfelder.
-- Brett-Platz (Seat) 0..3, Start jeweils um 10 Felder versetzt.
-- ---------------------------------------------------------------------------------------------
create or replace function public._ludo_pcs(p_state jsonb, p_seat integer)
returns integer[]
language sql
immutable
set search_path = public
as $$
  select array(select e::integer from jsonb_array_elements_text(p_state -> 'pieces' -> p_seat::text) with ordinality t (e, n) order by n);
$$;

create or replace function public._ludo_target(p_pcs integer[], p_i integer, p_d integer)
returns integer
language plpgsql
immutable
set search_path = public
as $$
declare
  p integer := p_pcs[p_i + 1];
  t integer;
  j integer;
begin
  if p = -1 then
    if p_d <> 6 then return null; end if;
    t := 0;
  else
    t := p + p_d;
    if t > 43 then return null; end if;
  end if;
  for j in 1..4 loop
    if j <> p_i + 1 and p_pcs[j] = t then return null; end if;
  end loop;
  return t;
end;
$$;

create or replace function public._ludo_legal(p_state jsonb, p_seat integer, p_d integer)
returns integer[]
language plpgsql
immutable
set search_path = public
as $$
declare
  v_pcs integer[] := public._ludo_pcs(p_state, p_seat);
  v_out integer[] := '{}';
  i integer;
  v_house integer[] := '{}';
  v_on_start integer := null;
begin
  for i in 0..3 loop
    if v_pcs[i + 1] = -1 then v_house := v_house || i; end if;
    if v_pcs[i + 1] = 0 then v_on_start := i; end if;
  end loop;
  if p_d = 6 and array_length(v_house, 1) > 0 then
    if v_on_start is null then
      return v_house; -- Sechs: man muss eine Figur ins Spiel bringen
    elsif public._ludo_target(v_pcs, v_on_start, p_d) is not null then
      return array[v_on_start]; -- Startfeld frei machen
    end if;
  end if;
  for i in 0..3 loop
    if public._ludo_target(v_pcs, i, p_d) is not null then v_out := v_out || i; end if;
  end loop;
  return v_out;
end;
$$;

-- nächster Platz am Zug (überspringt ausgestiegene)
create or replace function public._ludo_next(p_state jsonb, p_seat integer)
returns integer
language plpgsql
immutable
set search_path = public
as $$
declare
  v_seats integer[] := array(select e::integer from jsonb_array_elements_text(p_state -> 'seats') e order by e::integer);
  v_out integer[] := array(select e::integer from jsonb_array_elements_text(coalesce(p_state -> 'out', '[]'::jsonb)) e);
  v_n integer := array_length(v_seats, 1);
  v_idx integer;
  k integer;
  s integer;
begin
  select i into v_idx from generate_subscripts(v_seats, 1) i where v_seats[i] = p_seat;
  for k in 1..v_n loop
    s := v_seats[((v_idx - 1 + k) % v_n) + 1];
    if not (s = any (v_out)) then return s; end if;
  end loop;
  return p_seat;
end;
$$;

-- hat die Person nur Figuren im Haus/Ziel (dann gibt es 3 Würfe)?
create or replace function public._ludo_idle(p_state jsonb, p_seat integer)
returns boolean
language sql
immutable
set search_path = public
as $$
  select bool_and(p = -1 or p >= 40) and bool_or(p = -1) from unnest(public._ludo_pcs(p_state, p_seat)) p;
$$;

-- Zug ausführen: gibt neuen Zustand zurück; 'winner' (Platz) wird gesetzt, wenn jemand fertig ist.
create or replace function public._ludo_move(p_state jsonb, p_seat integer, p_piece integer, p_d integer)
returns jsonb
language plpgsql
immutable
set search_path = public
as $$
declare
  v_pcs integer[] := public._ludo_pcs(p_state, p_seat);
  v_from integer := v_pcs[p_piece + 1];
  v_to integer := public._ludo_target(v_pcs, p_piece, p_d);
  v_state jsonb := p_state;
  v_abs integer;
  v_caps jsonb := '[]'::jsonb;
  s integer;
  j integer;
  v_o integer[];
  v_next integer;
begin
  v_pcs[p_piece + 1] := v_to;
  v_state := jsonb_set(v_state, array['pieces', p_seat::text], to_jsonb(v_pcs));
  if v_to between 0 and 39 then
    v_abs := (v_to + p_seat * 10) % 40;
    for s in select e::integer from jsonb_array_elements_text(v_state -> 'seats') e loop
      continue when s = p_seat;
      v_o := public._ludo_pcs(v_state, s);
      for j in 0..3 loop
        if v_o[j + 1] between 0 and 39 and (v_o[j + 1] + s * 10) % 40 = v_abs then
          v_o[j + 1] := -1;
          v_caps := v_caps || jsonb_build_object('seat', s, 'piece', j);
        end if;
      end loop;
      v_state := jsonb_set(v_state, array['pieces', s::text], to_jsonb(v_o));
    end loop;
  end if;
  v_state := v_state - 'dice';
  if (select bool_and(p >= 40) from unnest(v_pcs) p) then
    v_state := jsonb_set(v_state, '{winner}', to_jsonb(p_seat));
    v_next := p_seat;
  elsif p_d = 6 then
    v_next := p_seat;
  else
    v_next := public._ludo_next(v_state, p_seat);
  end if;
  v_state := jsonb_set(v_state, '{tries}', to_jsonb(case when public._ludo_idle(v_state, v_next) then 3 else 1 end));
  v_state := jsonb_set(v_state, '{last}', jsonb_build_object('seat', p_seat, 'dice', p_d, 'piece', p_piece, 'from', v_from, 'to', v_to, 'caps', v_caps));
  return jsonb_set(v_state, '{turn}', to_jsonb(v_next));
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Hilfen
-- ---------------------------------------------------------------------------------------------
create or replace function public._og_check()
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

-- Ansicht eines Spiels für mich (ohne fremde Geheimnisse)
create or replace function public._og_view(p_id uuid, p_me uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  g public.og_games;
  mp public.og_players;
  v_players jsonb;
  v_mine jsonb := '{}'::jsonb;
  v_state jsonb;
  v_opp public.og_players;
begin
  select * into g from public.og_games where id = p_id;
  select * into mp from public.og_players where game_id = p_id and user_id = p_me;
  if g.id is null or mp.user_id is null or mp.join_state in ('declined') then
    raise exception 'Spiel nicht gefunden.' using errcode = 'P0002';
  end if;
  v_state := g.state;
  select coalesce(jsonb_agg(jsonb_build_object('user_id', p.user_id, 'name', pr.display_name, 'seat', p.seat, 'join_state', p.join_state,
                                               'avatar_id', pr.avatar_id, 'color_id', pr.color_id) order by coalesce(p.seat, 9), pr.display_name), '[]'::jsonb)
    into v_players
    from public.og_players p join public.profiles pr on pr.id = p.user_id where p.game_id = p_id;

  if g.kind = 'rps' then
    select * into v_opp from public.og_players where game_id = p_id and user_id <> p_me and seat is not null limit 1;
    v_mine := jsonb_build_object('pick', mp.secret -> 'pick', 'opp_picked', coalesce(v_opp.secret ? 'pick', false));
  elsif g.kind = 'ships' then
    select * into v_opp from public.og_players where game_id = p_id and user_id <> p_me and seat is not null limit 1;
    v_mine := jsonb_build_object('ships', mp.secret -> 'ships', 'placed', mp.secret ? 'ships', 'opp_placed', coalesce(v_opp.secret ? 'ships', false));
    if g.status = 'finished' then
      v_mine := v_mine || jsonb_build_object('opp_ships', v_opp.secret -> 'ships');
    end if;
  elsif g.kind = 'ludo' then
    if g.status = 'running' and g.turn_seat = mp.seat and v_state ? 'dice' then
      v_mine := jsonb_build_object('legal', to_jsonb(public._ludo_legal(v_state, mp.seat, (v_state ->> 'dice')::integer)));
    end if;
  end if;

  return jsonb_build_object('id', g.id, 'kind', g.kind, 'status', g.status, 'version', g.version, 'host_id', g.host_id,
                            'me', jsonb_build_object('user_id', p_me, 'seat', mp.seat, 'join_state', mp.join_state),
                            'turn_seat', g.turn_seat, 'winner_seat', g.winner_seat, 'state', v_state, 'players', v_players, 'mine', v_mine);
end;
$$;

create or replace function public._og_bump(p_id uuid)
returns void
language sql
security definer
set search_path = public
as $$ update public.og_games set version = version + 1, updated_at = now() where id = p_id; $$;

-- Spiel starten (alle zugesagten Personen): Plätze vergeben und Anfangszustand setzen
create or replace function public._og_start(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  g public.og_games;
  v_users uuid[];
  v_n integer;
  v_seats integer[];
  i integer;
  v_state jsonb;
  v_pieces jsonb := '{}'::jsonb;
begin
  select * into g from public.og_games where id = p_id for update;
  select array_agg(user_id order by (user_id = g.host_id) desc, user_id) into v_users from public.og_players where game_id = p_id and join_state = 'joined';
  v_n := coalesce(array_length(v_users, 1), 0);
  if g.kind in ('rps', 'ships') and v_n <> 2 then
    raise exception 'Für dieses Spiel braucht es genau zwei Personen.' using errcode = '22023';
  elsif g.kind = 'ludo' and v_n not between 2 and 4 then
    raise exception 'Mensch ärgere dich nicht: 2 bis 4 Personen.' using errcode = '22023';
  end if;
  update public.og_players set join_state = 'declined' where game_id = p_id and join_state = 'invited';
  v_seats := case when g.kind = 'ludo' and v_n = 2 then array[0, 2] when g.kind = 'ludo' then array(select generate_series(0, v_n - 1)) else array[0, 1] end;
  for i in 1..v_n loop
    update public.og_players set seat = v_seats[i] where game_id = p_id and user_id = v_users[i];
  end loop;
  if g.kind = 'rps' then
    v_state := jsonb_build_object('to_win', 2, 'score', jsonb_build_object('0', 0, '1', 0), 'rounds', '[]'::jsonb);
    update public.og_games set status = 'running', state = v_state, turn_seat = null where id = p_id;
  elsif g.kind = 'ships' then
    v_state := jsonb_build_object('phase', 'placing', 'shots', jsonb_build_object('0', '[]'::jsonb, '1', '[]'::jsonb));
    update public.og_games set status = 'running', state = v_state, turn_seat = null where id = p_id;
  else
    for i in 1..v_n loop
      v_pieces := v_pieces || jsonb_build_object(v_seats[i]::text, jsonb_build_array(-1, -1, -1, -1));
    end loop;
    v_state := jsonb_build_object('seats', to_jsonb(v_seats), 'pieces', v_pieces, 'turn', v_seats[1], 'tries', 3, 'out', '[]'::jsonb);
    update public.og_games set status = 'running', state = v_state, turn_seat = v_seats[1] where id = p_id;
  end if;
  perform public._og_bump(p_id);
end;
$$;

create or replace function public._og_finish(p_id uuid, p_winner integer)
returns void
language sql
security definer
set search_path = public
as $$ update public.og_games set status = 'finished', winner_seat = p_winner, turn_seat = null, updated_at = now(), version = version + 1 where id = p_id; $$;

-- ---------------------------------------------------------------------------------------------
-- Öffentliche Funktionen
-- ---------------------------------------------------------------------------------------------
create or replace function public.og_create(p_kind text, p_opponents uuid[])
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := public._og_check();
  v_id uuid;
  v_ids uuid[];
  u uuid;
begin
  perform public._feature_guard('online');
  if p_kind not in ('rps', 'ludo', 'ships') then
    raise exception 'Unbekanntes Spiel.' using errcode = '22023';
  end if;
  select array_agg(distinct x) into v_ids from unnest(coalesce(p_opponents, '{}')) x where x <> v_me;
  if coalesce(array_length(v_ids, 1), 0) < 1 or array_length(v_ids, 1) > (case when p_kind = 'ludo' then 3 else 1 end) then
    raise exception 'Falsche Anzahl Mitspieler.' using errcode = '22023';
  end if;
  if (select count(*) from public.profiles where id = any (v_ids) and not blocked) <> array_length(v_ids, 1) then
    raise exception 'Person nicht gefunden.' using errcode = 'P0002';
  end if;
  -- Aufräumen: alte Spiele
  update public.og_games set status = 'cancelled' where status in ('lobby', 'running') and updated_at < now() - interval '2 days';
  delete from public.og_games where status in ('finished', 'cancelled') and updated_at < now() - interval '14 days';
  if (select count(*) from public.og_players p join public.og_games g on g.id = p.game_id
       where p.user_id = v_me and p.join_state = 'joined' and g.status in ('lobby', 'running')) >= 12 then
    raise exception 'Du hast schon viele offene Spiele. Beende zuerst ein paar.' using errcode = '54000';
  end if;
  insert into public.og_games (kind, host_id) values (p_kind, v_me) returning id into v_id;
  insert into public.og_players (game_id, user_id, join_state) values (v_id, v_me, 'joined');
  foreach u in array v_ids loop
    insert into public.og_players (game_id, user_id, join_state) values (v_id, u, 'invited');
  end loop;
  return v_id;
end;
$$;

create or replace function public.og_list()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_me uuid := public._og_check();
begin
  return coalesce((
    select jsonb_agg(x.j order by x.upd desc) from (
      select g.updated_at as upd,
             jsonb_build_object('id', g.id, 'kind', g.kind, 'status', g.status, 'my_state', mp.join_state, 'host', hp.display_name,
                                'host_id', g.host_id,
                                'my_turn', (g.status = 'running' and g.turn_seat is not null and g.turn_seat = mp.seat)
                                           or (g.status = 'running' and g.kind = 'rps' and not (mp.secret ? 'pick'))
                                           or (g.status = 'running' and g.kind = 'ships' and g.state ->> 'phase' = 'placing' and not (mp.secret ? 'ships')),
                                'winner_me', (g.status = 'finished' and g.winner_seat = mp.seat),
                                'names', (select jsonb_agg(pr.display_name order by coalesce(p.seat, 9), pr.display_name)
                                            from public.og_players p join public.profiles pr on pr.id = p.user_id
                                           where p.game_id = g.id and p.join_state in ('joined', 'invited')),
                                'updated_at', g.updated_at) as j
        from public.og_players mp
        join public.og_games g on g.id = mp.game_id
        join public.profiles hp on hp.id = g.host_id
       where mp.user_id = v_me and mp.join_state in ('invited', 'joined')
         and (g.status in ('lobby', 'running') or (g.status = 'finished' and g.updated_at > now() - interval '1 day'))
         and g.updated_at > now() - interval '2 days'
    ) x), '[]'::jsonb);
end;
$$;

create or replace function public.og_get(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  return public._og_view(p_id, public._og_check());
end;
$$;

create or replace function public.og_respond(p_id uuid, p_accept boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := public._og_check();
  g public.og_games;
begin
  perform public._feature_guard('online');
  select * into g from public.og_games where id = p_id for update;
  if g.id is null or g.status <> 'lobby' or not exists (select 1 from public.og_players where game_id = p_id and user_id = v_me and join_state = 'invited') then
    raise exception 'Einladung nicht mehr gültig.' using errcode = 'P0002';
  end if;
  update public.og_players set join_state = case when p_accept then 'joined' else 'declined' end where game_id = p_id and user_id = v_me;
  if not p_accept and g.kind <> 'ludo' then
    update public.og_games set status = 'cancelled', updated_at = now(), version = version + 1 where id = p_id;
  elsif p_accept and g.kind <> 'ludo' then
    perform public._og_start(p_id);
  else
    perform public._og_bump(p_id);
  end if;
  return public._og_view(p_id, v_me);
end;
$$;

create or replace function public.og_start(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := public._og_check();
  g public.og_games;
begin
  select * into g from public.og_games where id = p_id for update;
  if g.id is null or g.host_id <> v_me or g.status <> 'lobby' then
    raise exception 'Das Spiel kann nicht gestartet werden.' using errcode = '22023';
  end if;
  perform public._og_start(p_id);
  return public._og_view(p_id, v_me);
end;
$$;

-- Aufgeben / verlassen
create or replace function public.og_leave(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := public._og_check();
  g public.og_games;
  mp public.og_players;
  v_out jsonb;
  v_rest integer[];
begin
  select * into g from public.og_games where id = p_id for update;
  select * into mp from public.og_players where game_id = p_id and user_id = v_me;
  if g.id is null or mp.user_id is null then
    raise exception 'Spiel nicht gefunden.' using errcode = 'P0002';
  end if;
  if g.status = 'lobby' then
    if g.host_id = v_me then
      update public.og_games set status = 'cancelled', updated_at = now(), version = version + 1 where id = p_id;
    else
      update public.og_players set join_state = 'left' where game_id = p_id and user_id = v_me;
      if g.kind <> 'ludo' then update public.og_games set status = 'cancelled', updated_at = now(), version = version + 1 where id = p_id;
      else perform public._og_bump(p_id); end if;
    end if;
  elsif g.status = 'running' then
    update public.og_players set join_state = 'left' where game_id = p_id and user_id = v_me;
    if g.kind = 'ludo' then
      v_out := coalesce(g.state -> 'out', '[]'::jsonb) || to_jsonb(mp.seat);
      select array_agg(e::integer) into v_rest from jsonb_array_elements_text(g.state -> 'seats') e where not (e::integer in (select x::integer from jsonb_array_elements_text(v_out) x));
      update public.og_games set state = jsonb_set(g.state, '{out}', v_out) where id = p_id;
      if coalesce(array_length(v_rest, 1), 0) <= 1 then
        perform public._og_finish(p_id, v_rest[1]);
      else
        if g.turn_seat = mp.seat then
          update public.og_games set turn_seat = public._ludo_next(jsonb_set(g.state, '{out}', v_out), mp.seat),
                 state = jsonb_set(jsonb_set(jsonb_set(g.state, '{out}', v_out), '{turn}', to_jsonb(public._ludo_next(jsonb_set(g.state, '{out}', v_out), mp.seat))), '{dice}', 'null'::jsonb) - 'dice'
           where id = p_id;
        end if;
        perform public._og_bump(p_id);
      end if;
    else
      perform public._og_finish(p_id, (select seat from public.og_players where game_id = p_id and user_id <> v_me and seat is not null limit 1));
    end if;
  end if;
  return public._og_view(p_id, v_me);
end;
$$;

-- Schnick Schnack Schnuck
create or replace function public.og_rps_pick(p_id uuid, p_pick text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := public._og_check();
  g public.og_games;
  a public.og_players;
  b public.og_players;
  v_w integer;
  v_score jsonb;
  v_rounds jsonb;
begin
  if p_pick not in ('rock', 'paper', 'scissors') then
    raise exception 'Unbekannte Auswahl.' using errcode = '22023';
  end if;
  select * into g from public.og_games where id = p_id for update;
  if g.id is null or g.kind <> 'rps' or g.status <> 'running' then
    raise exception 'Das Spiel läuft nicht.' using errcode = '22023';
  end if;
  select * into a from public.og_players where game_id = p_id and seat = 0;
  select * into b from public.og_players where game_id = p_id and seat = 1;
  if v_me not in (a.user_id, b.user_id) then
    raise exception 'Du spielst hier nicht mit.' using errcode = '42501';
  end if;
  if (select secret ? 'pick' from public.og_players where game_id = p_id and user_id = v_me) then
    raise exception 'Du hast schon gewählt.' using errcode = '23505';
  end if;
  update public.og_players set secret = secret || jsonb_build_object('pick', p_pick) where game_id = p_id and user_id = v_me;
  select * into a from public.og_players where game_id = p_id and seat = 0;
  select * into b from public.og_players where game_id = p_id and seat = 1;
  if a.secret ? 'pick' and b.secret ? 'pick' then
    v_w := case when a.secret ->> 'pick' = b.secret ->> 'pick' then null
                when (a.secret ->> 'pick', b.secret ->> 'pick') in (('rock', 'scissors'), ('scissors', 'paper'), ('paper', 'rock')) then 0
                else 1 end;
    v_score := g.state -> 'score';
    if v_w is not null then
      v_score := jsonb_set(v_score, array[v_w::text], to_jsonb((v_score ->> v_w::text)::integer + 1));
    end if;
    v_rounds := (g.state -> 'rounds') || jsonb_build_object('a', a.secret ->> 'pick', 'b', b.secret ->> 'pick', 'w', v_w);
    update public.og_players set secret = secret - 'pick' where game_id = p_id;
    update public.og_games set state = jsonb_set(jsonb_set(g.state, '{score}', v_score), '{rounds}', v_rounds) where id = p_id;
    if (v_score ->> '0')::integer >= (g.state ->> 'to_win')::integer then
      perform public._og_finish(p_id, 0);
    elsif (v_score ->> '1')::integer >= (g.state ->> 'to_win')::integer then
      perform public._og_finish(p_id, 1);
    else
      perform public._og_bump(p_id);
    end if;
  else
    perform public._og_bump(p_id);
  end if;
  return public._og_view(p_id, v_me);
end;
$$;

-- Mensch ärgere dich nicht: würfeln
create or replace function public.og_ludo_roll(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := public._og_check();
  g public.og_games;
  mp public.og_players;
  v_d integer := 1 + floor(random() * 6)::integer;
  v_state jsonb;
  v_tries integer;
  v_next integer;
begin
  select * into g from public.og_games where id = p_id for update;
  select * into mp from public.og_players where game_id = p_id and user_id = v_me;
  if g.id is null or g.kind <> 'ludo' or g.status <> 'running' or mp.seat is distinct from g.turn_seat then
    raise exception 'Du bist nicht dran.' using errcode = '22023';
  end if;
  v_state := g.state;
  if v_state ? 'dice' then
    raise exception 'Du hast schon gewürfelt. Wähle eine Figur.' using errcode = '22023';
  end if;
  if cardinality(public._ludo_legal(v_state, mp.seat, v_d)) > 0 then
    v_state := jsonb_set(v_state, '{dice}', to_jsonb(v_d));
    v_state := jsonb_set(v_state, '{last}', jsonb_build_object('seat', mp.seat, 'dice', v_d, 'rolled', true));
    update public.og_games set state = v_state where id = p_id;
  else
    v_tries := coalesce((v_state ->> 'tries')::integer, 1);
    if v_tries > 1 then
      v_state := jsonb_set(v_state, '{tries}', to_jsonb(v_tries - 1));
      v_state := jsonb_set(v_state, '{last}', jsonb_build_object('seat', mp.seat, 'dice', v_d, 'nomove', true, 'again', true));
    else
      v_next := public._ludo_next(v_state, mp.seat);
      v_state := jsonb_set(v_state, '{turn}', to_jsonb(v_next));
      v_state := jsonb_set(v_state, '{tries}', to_jsonb(case when public._ludo_idle(v_state, v_next) then 3 else 1 end));
      v_state := jsonb_set(v_state, '{last}', jsonb_build_object('seat', mp.seat, 'dice', v_d, 'nomove', true));
      update public.og_games set turn_seat = v_next where id = p_id;
    end if;
    update public.og_games set state = v_state where id = p_id;
  end if;
  perform public._og_bump(p_id);
  return public._og_view(p_id, v_me);
end;
$$;
