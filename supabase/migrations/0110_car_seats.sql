-- ============================================================================
-- 0110: Sitzplätze pro Auto, Lauftempo zu Fuß, Auto verkaufen (Update 136/137). Wiederholbar. Nach 0109 ausführen.
--  * Einstellung car_seats (Standard 4); admin_seats_set(n): nur Admin, 1–8
--  * Einstellungen walk_speed / run_speed (in 0,1 m/s, Standard 44 / 76); admin_foot_set(walk, run): nur Admin, 1–40 m/s
--  * race_super_info() liefert zusätzlich seats, walk, run (m/s)
-- ============================================================================
insert into public.app_settings (key, value, mod_editable) values ('car_seats', 4, false) on conflict (key) do nothing;
insert into public.app_settings (key, value, mod_editable) values ('walk_speed', 44, false) on conflict (key) do nothing;
insert into public.app_settings (key, value, mod_editable) values ('run_speed', 76, false) on conflict (key) do nothing;

drop function if exists public.race_super_info();
create or replace function public.race_super_info()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_me uuid := public._og_check();
begin
  return jsonb_build_object(
    'ok', public._race_super(v_me),
    'kmh', public._race_super_kmh(v_me),
    'assist', public._race_assist(v_me),
    'seats', public.setting('car_seats'),
    'walk', public.setting('walk_speed') / 10.0,
    'run', public.setting('run_speed') / 10.0,
    'fly', jsonb_build_object('sec', public.setting('fly_seconds'), 'cool', public.setting('fly_cooldown'), 'roll', public.setting('fly_roll') > 0));
end;
$$;

drop function if exists public.admin_seats_set(integer);
create or replace function public.admin_seats_set(p_n integer)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public._require_admin();
  if p_n is null or p_n < 1 or p_n > 8 then raise exception 'Sitzplätze: 1 bis 8.' using errcode = '22023'; end if;
  insert into public.app_settings (key, value, mod_editable) values ('car_seats', p_n, false) on conflict (key) do update set value = excluded.value;
end;
$$;

drop function if exists public.admin_foot_set(numeric, numeric);
create or replace function public.admin_foot_set(p_walk numeric, p_run numeric)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public._require_admin();
  if p_walk is null or p_walk < 1 or p_walk > 40 then raise exception 'Lauftempo: 1 bis 40 m/s.' using errcode = '22023'; end if;
  if p_run is null or p_run < 1 or p_run > 40 then raise exception 'Sprinttempo: 1 bis 40 m/s.' using errcode = '22023'; end if;
  insert into public.app_settings (key, value, mod_editable) values ('walk_speed', round(p_walk * 10), false) on conflict (key) do update set value = excluded.value;
  insert into public.app_settings (key, value, mod_editable) values ('run_speed', round(p_run * 10), false) on conflict (key) do update set value = excluded.value;
end;
$$;

-- Auto verkaufen: 50 % des bezahlten Preises zurück, Tuning des Autos geht verloren
drop function if exists public.car_sell(text);
create or replace function public.car_sell(p_id text)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_me uuid := public._og_check(); o public.car_owned; v_bal bigint;
begin
  perform public._feature_guard('cars');
  perform pg_advisory_xact_lock(hashtext('car:' || v_me::text));
  select * into o from public.car_owned where user_id = v_me and car_id = p_id;
  if o.car_id is null then raise exception 'Dieses Auto gehört dir nicht.' using errcode = '22023'; end if;
  delete from public.car_upgrades where user_id = v_me and car_id = p_id;
  delete from public.car_owned where user_id = v_me and car_id = p_id;
  v_bal := public._grant_koins(v_me, (o.paid / 2)::integer, 'shop', 'car-sell:' || p_id);
  return v_bal;
end;
$$;

do $$
declare r record;
begin
  for r in select p.oid::regprocedure as sig, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('race_super_info', 'admin_seats_set', 'admin_foot_set', 'car_sell') loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;
end $$;
