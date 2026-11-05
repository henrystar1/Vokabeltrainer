-- 0066: Gambling-Bank (was die Spieler zusammen gesetzt und gewonnen haben) und Zurücksetzen der Statistik (nur Admin). Wiederholbar.
create or replace function public.gambling_bank()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_plays bigint;
  v_wagered numeric;
  v_won numeric;
  v_players bigint;
begin
  if (select auth.uid()) is null or public.is_blocked() then
    raise exception 'Nicht erlaubt.' using errcode = '42501';
  end if;
  select coalesce(sum(plays), 0), coalesce(sum(wagered), 0), coalesce(sum(won), 0), count(*)
    into v_plays, v_wagered, v_won, v_players
    from public.gambling_stats where plays > 0;
  return jsonb_build_object(
    'plays', v_plays,
    'players', v_players,
    'wagered', v_wagered,
    'won', v_won,
    'bank', v_wagered - v_won,
    'avg_per_play', case when v_plays > 0 then round((v_wagered - v_won) / v_plays, 2) else 0 end,
    'payout_percent', case when v_wagered > 0 then round(v_won * 100 / v_wagered, 1) else 0 end
  );
end;
$$;

-- p_user = null: Statistik aller Spieler zurücksetzen, sonst nur die einer Person.
create or replace function public.admin_gambling_reset(p_user uuid default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare v_n integer;
begin
  perform public._require_admin();
  delete from public.gambling_stats where p_user is null or user_id = p_user;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('gambling_bank', 'admin_gambling_reset')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;
end;
$$;
