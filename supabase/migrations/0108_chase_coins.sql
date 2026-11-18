-- ============================================================================
-- 0108: Coins für die Polizeijagd (Update 127). Wiederholbar. Nach 0107 ausführen.
--  * race_chase_reward(p_humans, p_bots, p_win, p_secs): Coins vom Server berechnet, pro Tag gedeckelt
--      Jagd mit Menschen:  80 + 25 × weitere Spieler + 6 × Bots
--      Jagd nur mit Bots:  40 + 6 × Bots
--      Sieger 100 %, Verlierer 50 % (beide bekommen etwas)
--      Sperren: Jagd unter 20 s zählt nicht, mindestens 60 s Abstand zwischen zwei Belohnungen, Tageslimit (24 h)
--  * Einstellung chase_coin_daily (3000)
-- ============================================================================

insert into public.app_settings (key, value, mod_editable) values ('chase_coin_daily', 3000, false) on conflict (key) do nothing;

drop function if exists public.race_chase_reward(integer, integer, boolean, integer);
create or replace function public.race_chase_reward(p_humans integer, p_bots integer, p_win boolean, p_secs integer)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := public._og_check();
  v_h integer := least(greatest(coalesce(p_humans, 0), 0), 8);
  v_b integer := least(greatest(coalesce(p_bots, 0), 0), 6);
  v_coins bigint;
  v_cap bigint := greatest(public.setting('chase_coin_daily'), 0);
  v_today bigint;
  v_bal bigint;
begin
  perform public._feature_guard('cars');
  if p_secs is null or p_secs < 20 or (v_h = 0 and v_b = 0) then
    return jsonb_build_object('coins', 0, 'koins', null, 'capped', false);
  end if;
  if exists (select 1 from public.koin_ledger where user_id = v_me and reason = 'chase' and created_at > now() - interval '60 seconds') then
    return jsonb_build_object('coins', 0, 'koins', null, 'capped', false);
  end if;
  if v_h > 0 then v_coins := 80 + 25 * v_h + 6 * v_b; else v_coins := 40 + 6 * v_b; end if;
  if not coalesce(p_win, false) then v_coins := round(v_coins * 0.5); end if;
  select coalesce(sum(amount), 0) into v_today from public.koin_ledger where user_id = v_me and reason = 'chase' and created_at > now() - interval '24 hours';
  if v_today + v_coins > v_cap then v_coins := greatest(v_cap - v_today, 0); end if;
  if v_coins <= 0 then
    return jsonb_build_object('coins', 0, 'koins', null, 'capped', true);
  end if;
  v_bal := public._grant_koins(v_me, v_coins, 'chase', case when v_h > 0 then 'humans' else 'bots' end);
  return jsonb_build_object('coins', v_coins, 'koins', v_bal, 'capped', false);
end;
$$;

do $$
declare r record;
begin
  for r in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('race_chase_reward') loop
    execute format('revoke all on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;
end $$;
