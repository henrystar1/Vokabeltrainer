-- 0099: Tuning für Autos (Motor, Reifen, Bremsen je bis Stufe 5), Supercar-Tempo einstellbar, neue Autos (Sky-Roadster mit Flug, Motorräder).
-- Wiederholbar. Nach 0098 ausführen.

create table if not exists public.car_upgrades (
  user_id uuid not null references auth.users(id) on delete cascade,
  car_id text not null references public.cars(id) on delete cascade,
  motor integer not null default 0 check (motor between 0 and 5),
  reifen integer not null default 0 check (reifen between 0 and 5),
  bremse integer not null default 0 check (bremse between 0 and 5),
  primary key (user_id, car_id)
);
alter table public.car_upgrades enable row level security;
revoke all on public.car_upgrades from anon, authenticated;

insert into public.app_settings (key, value, mod_editable) values ('supercar_kmh', 700, false) on conflict (key) do nothing;

-- Preis der nächsten Stufe: ein Zehntel des Autopreises (mindestens 500) mal (Stufe + 1)
create or replace function public._car_up_price(p_car_price bigint, p_level integer)
returns bigint language sql immutable as $$ select greatest(500, round(p_car_price / 10.0)::bigint) * (p_level + 1) $$;

drop function if exists public.car_upgrades();
create or replace function public.car_upgrades()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_me uuid := public._og_check();
begin
  perform public._feature_guard('cars');
  return coalesce((select jsonb_agg(jsonb_build_object('car_id', u.car_id, 'motor', u.motor, 'reifen', u.reifen, 'bremse', u.bremse)) from public.car_upgrades u where u.user_id = v_me), '[]'::jsonb);
end;
$$;

drop function if exists public.car_upgrade(text, text);
create or replace function public.car_upgrade(p_car text, p_part text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := public._og_check();
  c public.cars;
  u public.car_upgrades;
  v_lvl integer; v_price bigint; v_bal bigint;
begin
  perform public._feature_guard('cars');
  if p_part not in ('motor', 'reifen', 'bremse') then raise exception 'Unbekanntes Teil.' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtext('car:' || v_me::text));
  select cc.* into c from public.cars cc join public.car_owned o on o.car_id = cc.id and o.user_id = v_me where cc.id = p_car;
  if c.id is null then raise exception 'Dieses Auto gehört dir nicht.' using errcode = '42501'; end if;
  insert into public.car_upgrades (user_id, car_id) values (v_me, c.id) on conflict do nothing;
  select * into u from public.car_upgrades where user_id = v_me and car_id = c.id;
  v_lvl := case p_part when 'motor' then u.motor when 'reifen' then u.reifen else u.bremse end;
  if v_lvl >= 5 then raise exception 'Das ist schon auf der höchsten Stufe.' using errcode = '22023'; end if;
  v_price := public._car_up_price(c.price, v_lvl);
  v_bal := public._grant_koins(v_me, -v_price, 'shop', 'upg:' || c.id || ':' || p_part);
  update public.car_upgrades set motor = motor + (p_part = 'motor')::int, reifen = reifen + (p_part = 'reifen')::int, bremse = bremse + (p_part = 'bremse')::int where user_id = v_me and car_id = c.id;
  select * into u from public.car_upgrades where user_id = v_me and car_id = c.id;
  return jsonb_build_object('koins', v_bal, 'car_id', c.id, 'motor', u.motor, 'reifen', u.reifen, 'bremse', u.bremse);
end;
$$;

-- Supercar: Tempo vom Admin
-- Freigabe-Tabelle: eigenes Tempo je Nutzer (null = Standard-Tempo aus den Einstellungen)
alter table public.race_super_access add column if not exists kmh integer;
alter table public.race_super_access drop constraint if exists race_super_access_kmh_check;
alter table public.race_super_access add constraint race_super_access_kmh_check check (kmh is null or kmh between 100 and 1000);

create or replace function public._race_super_kmh(p_user uuid)
returns integer language sql stable security definer set search_path = public as $$
  select least(greatest(coalesce((select a.kmh from public.race_super_access a where a.user_id = p_user), public.setting('supercar_kmh')), 100), 1000)::integer
$$;

-- Fahrassistent: nur Admins
create or replace function public._race_assist(p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select p.role = 'admin' and not p.blocked from public.profiles p where p.id = p_user), false)
$$;

drop function if exists public.race_super_info();
create or replace function public.race_super_info()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_me uuid := public._og_check();
begin
  return jsonb_build_object('ok', public._race_super(v_me), 'kmh', public._race_super_kmh(v_me), 'assist', public._race_assist(v_me));
end;
$$;

drop function if exists public.admin_super_speed(integer);
create or replace function public.admin_super_speed(p_kmh integer)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public._require_admin();
  if p_kmh is null or p_kmh < 100 or p_kmh > 1000 then raise exception 'Das Tempo muss zwischen 100 und 1000 km/h liegen.' using errcode = '22023'; end if;
  insert into public.app_settings (key, value, mod_editable) values ('supercar_kmh', p_kmh, false) on conflict (key) do update set value = excluded.value;
end;
$$;

-- Auto für das Online-Rennen wählen: jetzt mit Tuning-Stufen und dem eingestellten Supercar-Tempo
drop function if exists public.og_race_pick(uuid, text);
create or replace function public.og_race_pick(p_id uuid, p_car text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := public._og_check();
  g public.og_games;
  c public.cars;
  u public.car_upgrades;
  v_car jsonb;
begin
  select * into g from public.og_games where id = p_id for update;
  if g.id is null or g.kind <> 'race' or not exists (select 1 from public.og_players where game_id = p_id and user_id = v_me and join_state in ('joined', 'invited')) then
    raise exception 'Spiel nicht gefunden.' using errcode = 'P0002';
  end if;
  if g.status <> 'lobby' then return public._og_view(p_id, v_me); end if;
  if p_car = 'supercar' then
    if not public._race_super(v_me) then raise exception 'Das Supercar ist nicht freigegeben.' using errcode = '42501'; end if;
    v_car := jsonb_build_object('id', 'supercar', 'name', 'Admin-Hyperion', 'kind', 'supercar', 'color', '#dc2626', 'top', public._race_super_kmh(v_me));
  else
    select cc.* into c from public.cars cc join public.car_owned o on o.car_id = cc.id and o.user_id = v_me where cc.id = p_car;
    if c.id is null then raise exception 'Dieses Auto gehört dir nicht.' using errcode = '42501'; end if;
    select * into u from public.car_upgrades where user_id = v_me and car_id = c.id;
    v_car := jsonb_build_object('id', c.id, 'name', c.name, 'kind', c.kind, 'color', c.color, 'top', c.top_kmh,
                                'up', jsonb_build_object('m', coalesce(u.motor, 0), 'r', coalesce(u.reifen, 0), 'b', coalesce(u.bremse, 0)));
  end if;
  update public.og_games set state = jsonb_set(coalesce(state, '{}'::jsonb) || jsonb_build_object('cars', coalesce(state -> 'cars', '{}'::jsonb)), array['cars', v_me::text], v_car, true), updated_at = now() where id = p_id;
  perform public._og_bump(p_id);
  return public._og_view(p_id, v_me);
end;
$$;

-- Admin: Tempo des Supercars je Nutzer (null = Standard). Mods nur, wenn sie freigegeben sind.
drop function if exists public.admin_super_user_speed(uuid, integer);
create or replace function public.admin_super_user_speed(p_user uuid, p_kmh integer)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public._require_admin();
  if p_kmh is not null and (p_kmh < 100 or p_kmh > 1000) then raise exception 'Das Tempo muss zwischen 100 und 1000 km/h liegen.' using errcode = '22023'; end if;
  if exists (select 1 from public.profiles where id = p_user and role = 'admin') then
    insert into public.race_super_access (user_id, granted_by, kmh) values (p_user, (select auth.uid()), p_kmh) on conflict (user_id) do update set kmh = excluded.kmh;
  else
    if not exists (select 1 from public.race_super_access where user_id = p_user) then raise exception 'Erst das Supercar freigeben.' using errcode = '22023'; end if;
    update public.race_super_access set kmh = p_kmh where user_id = p_user;
  end if;
end;
$$;

drop function if exists public.admin_super_list();
create or replace function public.admin_super_list()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public._require_admin();
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', p.id, 'name', coalesce(p.display_name, '?'), 'role', p.role, 'granted', p.role = 'admin' or a.user_id is not null,
                                        'kmh', public._race_super_kmh(p.id), 'custom', a.kmh is not null) order by p.role, p.display_name)
    from public.profiles p left join public.race_super_access a on a.user_id = p.id
    where p.role in ('mod', 'alphamod', 'admin') and not p.blocked), '[]'::jsonb);
end;
$$;

-- Drift-Arena (Strecke 10): Ranglisten-Schlüssel t0 … t10, Online-Streckenwahl bis 10
alter table public.race_records drop constraint if exists race_records_track_check;
alter table public.race_records add constraint race_records_track_check check (track ~ '^(t[0-9]|t10|c:[0-9a-f-]{36})$');
do $$
declare v_def text;
begin
  v_def := pg_get_functiondef('public.race_submit(text, text, integer)'::regprocedure);
  v_def := replace(v_def, '^(t[0-9]|c:', '^(t[0-9]|t10|c:');
  execute v_def;
  v_def := pg_get_functiondef('public.og_race_set(uuid, integer, integer, uuid)'::regprocedure);
  v_def := replace(v_def, 'coalesce(p_track, 0), 0), 9)', 'coalesce(p_track, 0), 0), 10)');
  execute v_def;
end $$;

-- Neue Autos
insert into public.cars (id, name, kind, color, price, top_kmh, sort) values
  ('chopper',       'Easy Chopper',  'chopper',   '#f59e0b',   9000, 190, 60),
  ('crossbike',     'Dreck-Bike',    'crossbike', '#22c55e',  12000, 175, 61),
  ('sportbike_r',   'Blitz-Bike',    'sportbike', '#ef4444',  18000, 260, 62),
  ('sportbike_n',   'Nacht-Bike',    'sportbike', '#1e293b',  22000, 275, 63),
  ('sportbike_g',   'Gold-Bike',     'sportbike', '#facc15',  60000, 310, 64),
  ('sky_roadster',  'Sky-Roadster',  'roadster',  '#e5e7eb', 250000, 290, 65)
on conflict (id) do nothing;

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('car_upgrades', 'car_upgrade', '_car_up_price', 'race_super_info', 'admin_super_speed', 'og_race_pick', 'admin_super_user_speed', 'admin_super_list', '_race_super_kmh', '_race_assist', 'race_submit', 'og_race_set')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    if left(r.proname, 1) <> '_' then
      execute format('grant execute on function %s to authenticated', r.sig);
    end if;
  end loop;
end $$;
