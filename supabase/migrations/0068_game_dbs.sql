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
