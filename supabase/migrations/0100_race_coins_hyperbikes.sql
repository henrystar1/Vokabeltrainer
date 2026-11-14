-- ============================================================================
-- 0100: Renn-Coins und schnellere Motorräder (Update 114). Wiederholbar. Nach 0099 ausführen.
--  * race_reward(place, field, ms, online): Coins fürs Rennfahren, vom Server berechnet und pro Tag gedeckelt
--      Coins = (Grundbetrag + 12 × Gegner) × Platzfaktor (1.: 100 %, 2.: 60 %, 3.: 40 %, sonst 20 %), online × 1,5
--      Sperren: Rennen unter 15 s zählen nicht, mindestens 15 s Abstand zwischen zwei Belohnungen, Tageslimit (24 h)
--  * Einstellungen race_coin_base (25) und race_coin_daily (2000)
--  * Neue Motorräder: Hyper-Bike (420 km/h), Raketen-Bike (520 km/h)
-- ============================================================================

insert into public.app_settings (key, value, mod_editable) values ('race_coin_base', 25, false) on conflict (key) do nothing;
insert into public.app_settings (key, value, mod_editable) values ('race_coin_daily', 2000, false) on conflict (key) do nothing;

drop function if exists public.race_reward(integer, integer, integer, boolean);
create or replace function public.race_reward(p_place integer, p_field integer, p_ms integer, p_online boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := public._og_check();
  v_opp integer;
  v_factor numeric;
  v_coins bigint;
  v_cap bigint := greatest(public.setting('race_coin_daily'), 0);
  v_today bigint;
  v_bal bigint;
begin
  perform public._feature_guard('cars');
  if p_place is null or p_field is null or p_ms is null or p_place < 1 or p_field < 1 or p_field > 12 or p_place > p_field or p_ms < 15000 then
    return jsonb_build_object('coins', 0, 'koins', null, 'capped', false);
  end if;
  -- höchstens alle 15 s eine Belohnung
  if exists (select 1 from public.koin_ledger where user_id = v_me and reason = 'race' and created_at > now() - interval '15 seconds') then
    return jsonb_build_object('coins', 0, 'koins', null, 'capped', false);
  end if;
  v_opp := least(p_field - 1, 11);
  v_factor := case p_place when 1 then 1 when 2 then 0.6 when 3 then 0.4 else 0.2 end;
  v_coins := round((public.setting('race_coin_base') + 12 * v_opp) * v_factor * case when coalesce(p_online, false) and v_opp > 0 then 1.5 else 1 end);
  select coalesce(sum(amount), 0) into v_today from public.koin_ledger where user_id = v_me and reason = 'race' and created_at > now() - interval '24 hours';
  if v_today + v_coins > v_cap then v_coins := greatest(v_cap - v_today, 0); end if;
  if v_coins <= 0 then
    return jsonb_build_object('coins', 0, 'koins', null, 'capped', true);
  end if;
  v_bal := public._grant_koins(v_me, v_coins, 'race', 'p' || p_place || '/' || p_field);
  return jsonb_build_object('coins', v_coins, 'koins', v_bal, 'capped', false);
end;
$$;

-- Höchsttempo-Grenze der Autos von 400 auf 600 km/h anheben (Hyper-/Raketen-Bike)
alter table public.cars drop constraint if exists cars_top_kmh_check;
alter table public.cars add constraint cars_top_kmh_check check (top_kmh is null or top_kmh between 50 and 600);

insert into public.cars (id, name, kind, color, price, top_kmh, sort) values
  ('hyper_bike',   'Hyper-Bike',   'hyperbike', '#a855f7', 150000, 420, 66),
  ('rocket_bike',  'Raketen-Bike', 'hyperbike', '#06b6d4', 400000, 520, 67)
on conflict (id) do nothing;

do $$
declare r record;
begin
  for r in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('race_reward') loop
    execute format('revoke all on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;
end $$;
