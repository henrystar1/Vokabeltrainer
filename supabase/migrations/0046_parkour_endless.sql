-- 0046: Team-Parkour endlos: nach den 8 handgebauten Leveln kommen zufällige, immer schwerere.
--  * team_parkour_finish: bis zu 500 Level, Zusatz-Coins ab Level 9 (parkour_coins_endless je Level).
-- Wiederholbar. Nach 0045 ausführen.

insert into public.app_settings (key, value, mod_editable) values ('parkour_coins_endless', 5, false)
on conflict (key) do nothing;

create or replace function public.team_parkour_finish(p_id uuid, p_millis integer, p_deaths integer, p_levels integer, p_cps integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  t public.team_runs;
  v_lv integer := least(greatest(coalesce(p_levels, 0), 0), 500);
  v_cp integer := least(greatest(coalesce(p_cps, 0), 0), 2000);
  v_coins integer;
begin
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  select * into t from public.team_runs where id = p_id for update;
  if not found or t.kind <> 'parkour' or t.status <> 'running' or v_me not in (t.host_id, t.partner_id) then return; end if;
  -- Ein Level dauert mindestens 12 Sekunden; schneller kann die Meldung nicht stimmen.
  if t.starts_at + make_interval(secs => 12 * v_lv) > now() then return; end if;
  v_coins := least(v_lv, 8) * public.setting('parkour_coins_level')
             + greatest(v_lv - 8, 0) * (public.setting('parkour_coins_level') + public.setting('parkour_coins_endless'))
             + v_cp * public.setting('parkour_coins_cp')
             + case when v_lv >= 8 then public.setting('parkour_coins_bonus') else 0 end;
  update public.team_runs
     set status = case when v_lv >= 8 then 'won' else 'lost' end, finished_at = now(), updated_at = now(),
         millis = least(greatest(coalesce(p_millis, 0), 0), 7200000), deaths = least(greatest(coalesce(p_deaths, 0), 0), 9999),
         levels = v_lv, cps = v_cp, step = least(v_lv, 2000),
         paid_host = public._team_pay(t.host_id, v_coins, p_id::text),
         paid_partner = public._team_pay(t.partner_id, v_coins, p_id::text)
   where id = p_id;
end;
$$;

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'team_parkour_finish'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;
end;
$$;
