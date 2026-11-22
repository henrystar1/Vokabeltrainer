-- ============================================================================
-- 0116: Waffenladen (Weste, Helm, Schlagstock, Pistole) mit Coins und Geldautomaten-Raub (Update 144). Wiederholbar.
-- ============================================================================
create table if not exists public.race_gear (
  user_id uuid not null,
  item text not null,
  bought_at timestamptz not null default now(),
  primary key (user_id, item)
);
alter table public.race_gear enable row level security;

create or replace function public.race_gear_list()
returns text[] language plpgsql security definer set search_path = public as $$
declare v_me uuid := public._og_check();
begin
  perform public._feature_guard('cars');
  return coalesce((select array_agg(item) from public.race_gear where user_id = v_me), '{}');
end;
$$;

create or replace function public.race_gear_buy(p_item text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_me uuid := public._og_check(); v_price bigint; v_bal bigint;
begin
  perform public._feature_guard('cars');
  v_price := case p_item when 'vest' then 400 when 'helmet' then 300 when 'baton' then 250 when 'pistol' then 600 else null end;
  if v_price is null then raise exception 'Unbekannter Artikel.' using errcode = '22023'; end if;
  if exists (select 1 from public.race_gear where user_id = v_me and item = p_item) then
    raise exception 'Das hast du schon.' using errcode = '22023';
  end if;
  if public.is_admin() then
    v_bal := coalesce((select balance from public.koin_wallets where user_id = v_me), 0);
  else
    v_bal := public._grant_koins(v_me, -v_price, 'shop', 'gear_' || p_item);
  end if;
  insert into public.race_gear (user_id, item) values (v_me, p_item);
  return jsonb_build_object('item', p_item, 'koins', v_bal);
end;
$$;

create table if not exists public.race_atm (user_id uuid primary key, last_at timestamptz not null default now() - interval '1 day');
alter table public.race_atm enable row level security;

create or replace function public.race_atm_pay()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_me uuid := public._og_check(); v_last timestamptz; v_amt bigint; v_bal bigint;
begin
  perform public._feature_guard('cars');
  insert into public.race_atm (user_id) values (v_me) on conflict do nothing;
  select last_at into v_last from public.race_atm where user_id = v_me for update;
  if v_last > now() - interval '40 seconds' then return jsonb_build_object('coins', 0, 'koins', null); end if;
  v_amt := 30 + floor(random() * 41)::bigint;
  update public.race_atm set last_at = now() where user_id = v_me;
  v_bal := public._grant_koins(v_me, v_amt, 'race_atm', 'atm');
  return jsonb_build_object('coins', v_amt, 'koins', v_bal);
end;
$$;

do $$
declare r record;
begin
  for r in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('race_gear_list', 'race_gear_buy', 'race_atm_pay') loop
    execute format('revoke all on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;
end $$;
