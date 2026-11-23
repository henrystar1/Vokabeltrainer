-- ============================================================================
-- 0117: Pro-Mitglieder beleben sich in der Stadt gratis wieder (Update 148). Wiederholbar. Nach 0116 ausführen.
-- ============================================================================
create or replace function public.race_revive_pay()
returns bigint language plpgsql security definer set search_path = public as $$
declare v_me uuid := public._og_check(); v_bal bigint;
begin
  perform public._feature_guard('cars');
  if public.is_admin() or public._pro_active(v_me) then
    return coalesce((select balance from public.koin_wallets where user_id = v_me), 0);
  end if;
  v_bal := public._grant_koins(v_me, -10, 'shop', 'revive');
  return v_bal;
end;
$$;

do $$
declare r record;
begin
  for r in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname = 'race_revive_pay' loop
    execute format('revoke all on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;
end $$;
