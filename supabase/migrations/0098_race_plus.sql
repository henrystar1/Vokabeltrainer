-- 0098: Rennspiel Teil 2. Eigene Strecken (malen und speichern), Rangliste (Bestzeiten je Strecke und je Auto), Autos im Online-Lobby-Bild,
-- mehr Autos, Admin-Supercar (Admin immer, Mods nur auf Freigabe). Wiederholbar. Nach 0097 ausführen.

-- ===== Strecken =====
create table if not exists public.race_tracks (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 2 and 40),
  pts jsonb not null,
  width integer not null default 16 check (width between 10 and 30),
  is_public boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists race_tracks_owner_idx on public.race_tracks (owner, created_at desc);
alter table public.race_tracks enable row level security;
revoke all on public.race_tracks from anon, authenticated;

-- Prüft Stützpunkte [[x,z],...]: 8 bis 120 Punkte, Betrag der Koordinaten höchstens 3000, Länge 600 bis 40000 m. Gibt die Länge zurück.
create or replace function public._race_pts_check(p_pts jsonb)
returns numeric language plpgsql immutable set search_path = public as $$
declare v_n integer; v_len numeric := 0; i integer; a jsonb; b jsonb;
begin
  if p_pts is null or jsonb_typeof(p_pts) <> 'array' then raise exception 'Ungültige Strecke.' using errcode = '22023'; end if;
  v_n := jsonb_array_length(p_pts);
  if v_n < 8 or v_n > 120 then raise exception 'Die Strecke braucht 8 bis 120 Punkte.' using errcode = '22023'; end if;
  for i in 0 .. v_n - 1 loop
    a := p_pts -> i;
    b := p_pts -> ((i + 1) % v_n);
    if jsonb_typeof(a) <> 'array' or jsonb_array_length(a) <> 2 or jsonb_typeof(a -> 0) <> 'number' or jsonb_typeof(a -> 1) <> 'number' then
      raise exception 'Ungültige Strecke.' using errcode = '22023';
    end if;
    if abs((a ->> 0)::numeric) > 3000 or abs((a ->> 1)::numeric) > 3000 then raise exception 'Die Strecke ist zu groß.' using errcode = '22023'; end if;
    v_len := v_len + sqrt(power((b ->> 0)::numeric - (a ->> 0)::numeric, 2) + power((b ->> 1)::numeric - (a ->> 1)::numeric, 2));
  end loop;
  if v_len < 600 or v_len > 40000 then raise exception 'Die Strecke muss zwischen 600 m und 40 km lang sein.' using errcode = '22023'; end if;
  return v_len;
end;
$$;

drop function if exists public.race_track_save(text, jsonb, integer, boolean);
create or replace function public.race_track_save(p_name text, p_pts jsonb, p_width integer, p_public boolean)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_me uuid := public._og_check(); v_id uuid;
begin
  perform public._feature_guard('cars');
  perform public._race_pts_check(p_pts);
  if p_name is null or char_length(btrim(p_name)) < 2 or char_length(btrim(p_name)) > 40 then raise exception 'Gib der Strecke einen Namen (2 bis 40 Zeichen).' using errcode = '22023'; end if;
  if (select count(*) from public.race_tracks where owner = v_me) >= 20 then raise exception 'Du hast schon 20 Strecken. Lösche eine, um Platz zu schaffen.' using errcode = '22023'; end if;
  insert into public.race_tracks (owner, name, pts, width, is_public) values (v_me, btrim(p_name), p_pts, least(greatest(coalesce(p_width, 16), 10), 30), coalesce(p_public, true)) returning id into v_id;
  return v_id;
end;
$$;

drop function if exists public.race_track_list();
create or replace function public.race_track_list()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_me uuid := public._og_check();
begin
  perform public._feature_guard('cars');
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'pts', t.pts, 'width', t.width, 'public', t.is_public, 'mine', t.owner = v_me, 'owner', coalesce(p.display_name, '?')) order by (t.owner = v_me) desc, t.created_at desc)
    from (select * from public.race_tracks where owner = v_me or is_public order by (owner = v_me) desc, created_at desc limit 80) t
    left join public.profiles p on p.id = t.owner), '[]'::jsonb);
end;
$$;

drop function if exists public.race_track_delete(uuid);
create or replace function public.race_track_delete(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_me uuid := public._og_check();
begin
  delete from public.race_tracks where id = p_id and (owner = v_me or public.is_staff());
end;
$$;

-- ===== Supercar (Admin immer, Mods nur nach Freigabe) =====
create table if not exists public.race_super_access (
  user_id uuid primary key references auth.users(id) on delete cascade,
  granted_by uuid,
  created_at timestamptz not null default now()
);
alter table public.race_super_access enable row level security;
revoke all on public.race_super_access from anon, authenticated;

create or replace function public._race_super(p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select p.role = 'admin' and not p.blocked from public.profiles p where p.id = p_user), false)
      or (exists (select 1 from public.race_super_access a where a.user_id = p_user)
          and coalesce((select p.role in ('mod', 'alphamod', 'admin') and not p.blocked from public.profiles p where p.id = p_user), false))
$$;

drop function if exists public.race_super_ok();
create or replace function public.race_super_ok()
returns boolean language plpgsql stable security definer set search_path = public as $$
begin
  return public._race_super(public._og_check());
end;
$$;

drop function if exists public.admin_super_list();
create or replace function public.admin_super_list()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public._require_admin();
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', p.id, 'name', coalesce(p.display_name, '?'), 'role', p.role, 'granted', p.role = 'admin' or a.user_id is not null) order by p.role, p.display_name)
    from public.profiles p left join public.race_super_access a on a.user_id = p.id
    where p.role in ('mod', 'alphamod', 'admin') and not p.blocked), '[]'::jsonb);
end;
$$;

drop function if exists public.admin_super_set(uuid, boolean);
create or replace function public.admin_super_set(p_user uuid, p_on boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public._require_admin();
  if p_on then
    if not exists (select 1 from public.profiles where id = p_user and role in ('mod', 'alphamod', 'admin')) then
      raise exception 'Nur Mods und Admins können das Supercar bekommen.' using errcode = '22023';
    end if;
    insert into public.race_super_access (user_id, granted_by) values (p_user, (select auth.uid())) on conflict (user_id) do nothing;
  else
    delete from public.race_super_access where user_id = p_user;
  end if;
end;
$$;

-- ===== Online: Auto wählen (für alle in der Lobby sichtbar), Strecke aus 10 festen oder einer eigenen =====
-- Das Auto wird auf dem Server aus dem Besitz bestimmt (nicht vom Client behauptet).
drop function if exists public.og_race_pick(uuid, text);
create or replace function public.og_race_pick(p_id uuid, p_car text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := public._og_check();
  g public.og_games;
  c public.cars;
  v_car jsonb;
begin
  select * into g from public.og_games where id = p_id for update;
  if g.id is null or g.kind <> 'race' or not exists (select 1 from public.og_players where game_id = p_id and user_id = v_me and join_state in ('joined', 'invited')) then
    raise exception 'Spiel nicht gefunden.' using errcode = 'P0002';
  end if;
  if g.status <> 'lobby' then return public._og_view(p_id, v_me); end if;
  if p_car = 'supercar' then
    if not public._race_super(v_me) then raise exception 'Das Supercar ist nicht freigegeben.' using errcode = '42501'; end if;
    v_car := jsonb_build_object('id', 'supercar', 'name', 'Admin-Hyperion', 'kind', 'hypercar', 'color', '#facc15', 'top', 700);
  else
    select cc.* into c from public.cars cc join public.car_owned o on o.car_id = cc.id and o.user_id = v_me where cc.id = p_car;
    if c.id is null then raise exception 'Dieses Auto gehört dir nicht.' using errcode = '42501'; end if;
    v_car := jsonb_build_object('id', c.id, 'name', c.name, 'kind', c.kind, 'color', c.color, 'top', c.top_kmh);
  end if;
  update public.og_games set state = jsonb_set(coalesce(state, '{}'::jsonb) || jsonb_build_object('cars', coalesce(state -> 'cars', '{}'::jsonb)), array['cars', v_me::text], v_car, true), updated_at = now() where id = p_id;
  perform public._og_bump(p_id);
  return public._og_view(p_id, v_me);
end;
$$;

drop function if exists public.og_race_set(uuid, integer, integer);
drop function if exists public.og_race_set(uuid, integer, integer, uuid);
create or replace function public.og_race_set(p_id uuid, p_track integer, p_laps integer, p_custom uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := public._og_check();
  g public.og_games;
  t public.race_tracks;
  v_state jsonb;
begin
  select * into g from public.og_games where id = p_id for update;
  if g.id is null or g.kind <> 'race' or g.host_id <> v_me then
    raise exception 'Spiel nicht gefunden.' using errcode = 'P0002';
  end if;
  if g.status <> 'lobby' then return public._og_view(p_id, v_me); end if;
  v_state := jsonb_build_object('track', least(greatest(coalesce(p_track, 0), 0), 9), 'laps', least(greatest(coalesce(p_laps, 3), 1), 10), 'cars', coalesce(g.state -> 'cars', '{}'::jsonb));
  if p_custom is not null then
    select * into t from public.race_tracks where id = p_custom and (is_public or owner = v_me);
    if t.id is null then raise exception 'Strecke nicht gefunden.' using errcode = 'P0002'; end if;
    v_state := v_state || jsonb_build_object('custom', jsonb_build_object('id', t.id, 'name', t.name, 'pts', t.pts, 'width', t.width));
  end if;
  update public.og_games set state = v_state, updated_at = now() where id = p_id;
  perform public._og_bump(p_id);
  return public._og_view(p_id, v_me);
end;
$$;

-- Beim Start bleiben gewählte Autos und eigene Strecke im Spielstand
do $$
declare v_oid oid; v_def text; v_new text;
begin
  select p.oid into v_oid from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = '_og_start' limit 1;
  if v_oid is null then raise exception 'Funktion _og_start fehlt.'; end if;
  v_def := replace(pg_get_functiondef(v_oid), chr(13), '');
  if position('''cars'', coalesce(state -> ''cars''' in v_def) > 0 then return; end if;
  v_new := replace(v_def, '''t0'', (extract(epoch from now()) * 1000)::bigint, ''results'', ''{}''::jsonb)',
                          '''t0'', (extract(epoch from now()) * 1000)::bigint, ''results'', ''{}''::jsonb, ''cars'', coalesce(state -> ''cars'', ''{}''::jsonb), ''custom'', coalesce(state -> ''custom'', ''null''::jsonb))');
  if v_new = v_def then raise exception 'Patch für _og_start nicht anwendbar.'; end if;
  execute v_new;
end $$;

-- ===== Rangliste =====
create table if not exists public.race_records (
  user_id uuid not null references auth.users(id) on delete cascade,
  track text not null check (track ~ '^(t[0-9]|c:[0-9a-f-]{36})$'),
  car_id text not null references public.cars(id) on delete cascade,
  lap_ms integer not null check (lap_ms between 8000 and 3600000),
  created_at timestamptz not null default now(),
  primary key (user_id, track, car_id)
);
create index if not exists race_records_track_idx on public.race_records (track, lap_ms);
alter table public.race_records enable row level security;
revoke all on public.race_records from anon, authenticated;

drop function if exists public.race_submit(text, text, integer);
create or replace function public.race_submit(p_track text, p_car text, p_lap_ms integer)
returns void language plpgsql security definer set search_path = public as $$
declare v_me uuid := public._og_check();
begin
  perform public._feature_guard('cars');
  if p_car is null or p_car = 'supercar' then return; end if;
  if p_lap_ms is null or p_lap_ms < 8000 or p_lap_ms > 3600000 then return; end if;
  if p_track !~ '^(t[0-9]|c:[0-9a-f-]{36})$' then return; end if;
  if left(p_track, 2) = 'c:' and not exists (select 1 from public.race_tracks where id = substr(p_track, 3)::uuid) then return; end if;
  if not exists (select 1 from public.car_owned where user_id = v_me and car_id = p_car) then return; end if;
  insert into public.race_records (user_id, track, car_id, lap_ms) values (v_me, p_track, p_car, p_lap_ms)
  on conflict (user_id, track, car_id) do update set lap_ms = least(public.race_records.lap_ms, excluded.lap_ms), created_at = case when excluded.lap_ms < public.race_records.lap_ms then now() else public.race_records.created_at end;
end;
$$;

-- Beste Runde je Spieler auf einer Strecke
drop function if exists public.race_board(text);
create or replace function public.race_board(p_track text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_me uuid := public._og_check();
begin
  perform public._feature_guard('cars');
  return coalesce((
    select jsonb_agg(jsonb_build_object('name', x.pname, 'car', x.cname, 'kind', x.kind, 'color', x.color, 'ms', x.lap_ms, 'me', x.user_id = v_me) order by x.lap_ms)
    from (
      select r.user_id, r.lap_ms, c.name as cname, c.kind, c.color, coalesce(p.display_name, '?') as pname
      from (select distinct on (user_id) * from public.race_records where track = p_track order by user_id, lap_ms) r
      join public.cars c on c.id = r.car_id
      left join public.profiles p on p.id = r.user_id
      order by r.lap_ms limit 25) x), '[]'::jsonb);
end;
$$;

-- Beste Runde je Auto auf einer Strecke (welches Auto ist am schnellsten?)
drop function if exists public.race_car_board(text);
create or replace function public.race_car_board(p_track text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public._og_check();
  perform public._feature_guard('cars');
  return coalesce((
    select jsonb_agg(jsonb_build_object('name', x.cname, 'kind', x.kind, 'color', x.color, 'top', x.top_kmh, 'ms', x.lap_ms, 'driver', x.pname) order by x.lap_ms)
    from (
      select r.lap_ms, c.name as cname, c.kind, c.color, c.top_kmh, coalesce(p.display_name, '?') as pname
      from (select distinct on (car_id) * from public.race_records where track = p_track order by car_id, lap_ms) r
      join public.cars c on c.id = r.car_id
      left join public.profiles p on p.id = r.user_id
      order by r.lap_ms limit 25) x), '[]'::jsonb);
end;
$$;

-- ===== Mehr Autos =====
insert into public.cars (id, name, kind, color, price, top_kmh, sort) values
  ('oldie2',      'Roadster 1950',    'oldtimer',     '#16a34a',   6000, 125, 40),
  ('schulbus',    'Schulbus',         'bus',          '#f59e0b',   9000, 135, 41),
  ('gelbsack',    'Gelber Sack',      'buggy',        '#facc15',  12000, 190, 42),
  ('v8bulle',     'V8-Bulle',         'muscle',       '#eab308',  26000, 235, 43),
  ('drifter',     'Drift-König',      'sportwagen',   '#a855f7',  30000, 255, 44),
  ('dakar',       'Dakar-Bestie',     'rallye',       '#f97316',  38000, 245, 45),
  ('riesenrad',   'Riesenrad',        'monstertruck', '#7c3aed',  40000, 160, 46),
  ('gt_nacht',    'Nacht-GT',         'gt',           '#1e3a8a',  70000, 285, 47),
  ('gt_weiss',    'Weißer Blitz',     'gt',           '#f8fafc',  75000, 290, 48),
  ('phantom',     'Phantom',          'hypercar',     '#0f172a',  90000, 330, 49),
  ('bolide',      'Bolide',           'rennwagen',    '#dc2626', 120000, 340, 50),
  ('komet',       'Komet',            'hypercar',     '#06b6d4', 150000, 350, 51),
  ('silberpfeil', 'Silberpfeil',      'rennwagen',    '#cbd5e1', 200000, 360, 52),
  ('goldpfeil',   'Goldpfeil',        'rennwagen',    '#facc15', 350000, 380, 53),
  ('lava',        'Lava',             'hypercar',     '#ef4444', 500000, 400, 54)
on conflict (id) do nothing;

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('race_track_save', 'race_track_list', 'race_track_delete', 'race_super_ok', 'admin_super_list', 'admin_super_set',
                                                  'og_race_pick', 'og_race_set', 'race_submit', 'race_board', 'race_car_board', '_race_pts_check', '_race_super')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    if left(r.proname, 1) <> '_' then
      execute format('grant execute on function %s to authenticated', r.sig);
    end if;
  end loop;
end $$;
