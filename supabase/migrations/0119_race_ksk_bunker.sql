-- ============================================================================
-- 0119: KSK-Bunker (Update 154): Quad-Farbe/-Waffe und gekaufte Ausrüstung. Wiederholbar.
-- ============================================================================
create table if not exists public.race_ksk (
  user_id uuid primary key,
  color text not null default '#3d4a32',
  weapon text not null default 'minigun',
  updated_at timestamptz not null default now()
);
alter table public.race_ksk enable row level security;

create table if not exists public.race_ksk_items (
  user_id uuid not null,
  item text not null,
  bought_at timestamptz not null default now(),
  primary key (user_id, item)
);
alter table public.race_ksk_items enable row level security;

create or replace function public.race_ksk_get()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_me uuid := public._og_check(); v_color text := '#3d4a32'; v_weapon text := 'minigun';
begin
  perform public._feature_guard('cars');
  select color, weapon into v_color, v_weapon from public.race_ksk where user_id = v_me;
  return jsonb_build_object(
    'color', coalesce(v_color, '#3d4a32'),
    'weapon', coalesce(v_weapon, 'minigun'),
    'items', coalesce((select jsonb_agg(item) from public.race_ksk_items where user_id = v_me), '[]'::jsonb));
end;
$$;

create or replace function public.race_ksk_set(p_color text, p_weapon text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_me uuid := public._og_check();
begin
  perform public._feature_guard('cars');
  if p_color !~ '^#[0-9a-fA-F]{6}$' then raise exception 'Ungültige Farbe.' using errcode = '22023'; end if;
  if p_weapon not in ('minigun', 'rocket') then raise exception 'Unbekannte Waffe.' using errcode = '22023'; end if;
  if p_weapon = 'rocket' and not exists (select 1 from public.race_ksk_items where user_id = v_me and item = 'w_rocket') then
    raise exception 'Den Raketenwerfer hast du noch nicht gekauft.' using errcode = '22023';
  end if;
  insert into public.race_ksk (user_id, color, weapon) values (v_me, lower(p_color), p_weapon)
    on conflict (user_id) do update set color = excluded.color, weapon = excluded.weapon, updated_at = now();
  return public.race_ksk_get();
end;
$$;

create or replace function public.race_ksk_buy(p_item text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_me uuid := public._og_check(); v_price bigint; v_bal bigint;
begin
  perform public._feature_guard('cars');
  v_price := case p_item when 'w_rocket' then 1500 when 'turbo' then 900 when 'armor' then 1000 when 'rate' then 800 else null end;
  if v_price is null then raise exception 'Unbekannter Artikel.' using errcode = '22023'; end if;
  if exists (select 1 from public.race_ksk_items where user_id = v_me and item = p_item) then
    raise exception 'Das hast du schon.' using errcode = '22023';
  end if;
  if public.is_admin() then
    v_bal := coalesce((select balance from public.koin_wallets where user_id = v_me), 0);
  else
    v_bal := public._grant_koins(v_me, -v_price, 'shop', 'ksk_' || p_item);
  end if;
  insert into public.race_ksk_items (user_id, item) values (v_me, p_item);
  return jsonb_build_object('item', p_item, 'koins', v_bal);
end;
$$;

do $$
declare r record;
begin
  for r in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('race_ksk_get', 'race_ksk_set', 'race_ksk_buy') loop
    execute format('revoke all on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;
end $$;
