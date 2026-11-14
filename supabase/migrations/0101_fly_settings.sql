-- ============================================================================
-- 0101: Flug einstellbar und Supercar-Tempo bis 100.000 km/h (Update 115). Wiederholbar. Nach 0100 ausführen.
--  * Einstellungen fly_seconds (Flugdauer), fly_cooldown (Ladezeit), fly_roll (Rolle im Flug, 0/1)
--  * admin_fly_set(sec, cool, roll): nur Admin; Flugdauer 1–60 s (ganze Sekunden), Ladezeit 0–300 s
--  * race_super_info() liefert zusätzlich fly {sec, cool, roll}
--  * Supercar-Tempo 100–100000 km/h (Standard und je Nutzer)
-- ============================================================================

insert into public.app_settings (key, value, mod_editable) values ('fly_seconds', 2, false) on conflict (key) do nothing;
insert into public.app_settings (key, value, mod_editable) values ('fly_cooldown', 20, false) on conflict (key) do nothing;
insert into public.app_settings (key, value, mod_editable) values ('fly_roll', 0, false) on conflict (key) do nothing;

alter table public.race_super_access drop constraint if exists race_super_access_kmh_check;
alter table public.race_super_access add constraint race_super_access_kmh_check check (kmh is null or kmh between 100 and 100000);

-- Grenzen 1000 -> 100000 in den bestehenden Funktionen (idempotent: nur alleinstehende „1000“)
do $$
declare v_def text; v_sig text;
begin
  foreach v_sig in array array['public._race_super_kmh(uuid)', 'public.admin_super_speed(integer)', 'public.admin_super_user_speed(uuid, integer)'] loop
    v_def := pg_get_functiondef(v_sig::regprocedure);
    v_def := regexp_replace(v_def, '\y1000\y', '100000', 'g');
    execute v_def;
  end loop;
end $$;

drop function if exists public.race_super_info();
create or replace function public.race_super_info()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_me uuid := public._og_check();
begin
  return jsonb_build_object(
    'ok', public._race_super(v_me),
    'kmh', public._race_super_kmh(v_me),
    'assist', public._race_assist(v_me),
    'fly', jsonb_build_object('sec', public.setting('fly_seconds'), 'cool', public.setting('fly_cooldown'), 'roll', public.setting('fly_roll') > 0));
end;
$$;

drop function if exists public.admin_fly_set(integer, integer, boolean);
create or replace function public.admin_fly_set(p_sec integer, p_cool integer, p_roll boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public._require_admin();
  if p_sec is null or p_sec < 1 or p_sec > 60 then raise exception 'Die Flugdauer muss zwischen 1 und 60 Sekunden liegen.' using errcode = '22023'; end if;
  if p_cool is null or p_cool < 0 or p_cool > 300 then raise exception 'Die Ladezeit muss zwischen 0 und 300 Sekunden liegen.' using errcode = '22023'; end if;
  insert into public.app_settings (key, value, mod_editable) values ('fly_seconds', p_sec, false) on conflict (key) do update set value = excluded.value;
  insert into public.app_settings (key, value, mod_editable) values ('fly_cooldown', p_cool, false) on conflict (key) do update set value = excluded.value;
  insert into public.app_settings (key, value, mod_editable) values ('fly_roll', case when coalesce(p_roll, false) then 1 else 0 end, false) on conflict (key) do update set value = excluded.value;
end;
$$;

do $$
declare r record;
begin
  for r in select p.oid::regprocedure as sig, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('race_super_info', 'admin_fly_set', '_race_super_kmh', 'admin_super_speed', 'admin_super_user_speed') loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    if left(r.proname, 1) <> '_' then
      execute format('grant execute on function %s to authenticated', r.sig);
    end if;
  end loop;
end $$;
