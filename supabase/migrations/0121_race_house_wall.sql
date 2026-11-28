-- ============================================================================
-- 0121: Wandfarbe für gekaufte Häuser (Update 156). Wiederholbar.
-- ============================================================================
alter table public.race_houses add column if not exists wall text;

create or replace function public.race_house_list()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_me uuid := public._og_check();
begin
  perform public._feature_guard('cars');
  return coalesce((select jsonb_agg(jsonb_build_object('bld', bld, 'furniture', furniture, 'garage', garage, 'wall', wall)) from public.race_houses where user_id = v_me), '[]'::jsonb);
end;
$$;

drop function if exists public.race_house_save(int, jsonb, jsonb);
create or replace function public.race_house_save(p_bld int, p_furniture jsonb, p_garage jsonb, p_wall text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_me uuid := public._og_check();
begin
  perform public._feature_guard('cars');
  if jsonb_typeof(p_furniture) <> 'array' or jsonb_array_length(p_furniture) > 80 then raise exception 'Zu viele Möbel.' using errcode = '22023'; end if;
  if jsonb_typeof(p_garage) <> 'array' or jsonb_array_length(p_garage) > 6 then raise exception 'Die Garage ist voll.' using errcode = '22023'; end if;
  if p_wall is not null and p_wall !~ '^#[0-9a-fA-F]{6}$' then raise exception 'Ungültige Farbe.' using errcode = '22023'; end if;
  update public.race_houses set furniture = p_furniture, garage = p_garage, wall = p_wall where user_id = v_me and bld = p_bld;
  if not found then raise exception 'Das ist nicht dein Haus.' using errcode = '22023'; end if;
end;
$$;

do $$
declare r record;
begin
  for r in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('race_house_list', 'race_house_save') loop
    execute format('revoke all on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;
end $$;
