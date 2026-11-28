-- ============================================================================
-- 0120: Häuser kaufen (Möbel, Garage) und KSK-Aufträge (Update 155). Wiederholbar.
-- ============================================================================
create table if not exists public.race_houses (
  user_id uuid not null,
  bld int not null,
  furniture jsonb not null default '[]'::jsonb,
  garage jsonb not null default '[]'::jsonb,
  bought_at timestamptz not null default now(),
  primary key (user_id, bld)
);
alter table public.race_houses enable row level security;

create table if not exists public.race_ksk_mission_pay (
  user_id uuid primary key,
  last_at timestamptz not null default now()
);
alter table public.race_ksk_mission_pay enable row level security;

create or replace function public.race_house_list()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_me uuid := public._og_check();
begin
  perform public._feature_guard('cars');
  return coalesce((select jsonb_agg(jsonb_build_object('bld', bld, 'furniture', furniture, 'garage', garage)) from public.race_houses where user_id = v_me), '[]'::jsonb);
end;
$$;

create or replace function public.race_house_buy(p_bld int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_me uuid := public._og_check(); v_bal bigint; v_price constant bigint := 3000;
begin
  perform public._feature_guard('cars');
  if p_bld < 0 or p_bld > 5000 then raise exception 'Unbekanntes Haus.' using errcode = '22023'; end if;
  if exists (select 1 from public.race_houses where bld = p_bld) then
    raise exception 'Dieses Haus gehört schon jemandem.' using errcode = '22023';
  end if;
  if (select count(*) from public.race_houses where user_id = v_me) >= 5 then
    raise exception 'Du kannst höchstens 5 Häuser besitzen.' using errcode = '22023';
  end if;
  if public.is_admin() then
    v_bal := coalesce((select balance from public.koin_wallets where user_id = v_me), 0);
  else
    v_bal := public._grant_koins(v_me, -v_price, 'shop', 'house_' || p_bld);
  end if;
  insert into public.race_houses (user_id, bld) values (v_me, p_bld);
  return jsonb_build_object('bld', p_bld, 'koins', v_bal);
end;
$$;

create or replace function public.race_house_save(p_bld int, p_furniture jsonb, p_garage jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_me uuid := public._og_check();
begin
  perform public._feature_guard('cars');
  if jsonb_typeof(p_furniture) <> 'array' or jsonb_array_length(p_furniture) > 80 then raise exception 'Zu viele Möbel.' using errcode = '22023'; end if;
  if jsonb_typeof(p_garage) <> 'array' or jsonb_array_length(p_garage) > 6 then raise exception 'Die Garage ist voll.' using errcode = '22023'; end if;
  update public.race_houses set furniture = p_furniture, garage = p_garage where user_id = v_me and bld = p_bld;
  if not found then raise exception 'Das ist nicht dein Haus.' using errcode = '22023'; end if;
end;
$$;

create or replace function public.race_ksk_mission_pay(p_kind text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_me uuid := public._og_check(); v_amt bigint; v_bal bigint; v_last timestamptz;
begin
  perform public._feature_guard('cars');
  v_amt := case p_kind when 'kill' then 400 when 'car' then 500 else null end;
  if v_amt is null then raise exception 'Unbekannter Auftrag.' using errcode = '22023'; end if;
  select last_at into v_last from public.race_ksk_mission_pay where user_id = v_me;
  if v_last is not null and v_last > now() - interval '60 seconds' then raise exception 'Zu schnell – der Auftraggeber braucht eine Minute.' using errcode = '22023'; end if;
  insert into public.race_ksk_mission_pay (user_id, last_at) values (v_me, now())
    on conflict (user_id) do update set last_at = now();
  v_bal := public._grant_koins(v_me, v_amt, 'race_duty', 'ksk_' || p_kind);
  return jsonb_build_object('coins', v_amt, 'koins', v_bal);
end;
$$;

do $$
declare r record;
begin
  for r in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('race_house_list', 'race_house_buy', 'race_house_save', 'race_ksk_mission_pay') loop
    execute format('revoke all on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;
end $$;
