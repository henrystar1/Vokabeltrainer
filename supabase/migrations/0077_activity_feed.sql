-- 0077: 1) „Zuletzt gekauft" bei Plus & Pro  2) Admin: Person in der Liga hoch/runter  3) watch_progress: ein leichter Aufruf für
-- „Quest abholbar" und „Du hast jemanden überholt" (Wochenrangliste). Wiederholbar.

-- 1) Letzte Käufe (nur mit Coins bezahlt; Pro erkennt man am Text der Notiz)
create or replace function public.plus_recent_buys()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if (select auth.uid()) is null or public.is_blocked() then
    raise exception 'Nicht erlaubt.' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', s.id, 'name', p.display_name, 'pro', s.note like 'Pro ·%', 'days', s.days, 'coins', s.coins, 'at', s.created_at)
           order by s.created_at desc)
      from (select * from public.plus_sales where kind = 'coins' and user_id is not null order by created_at desc limit 12) s
      join public.profiles p on p.id = s.user_id and not p.blocked), '[]'::jsonb);
end;
$$;

-- 2) Liga: Stufe 1 bis 5 (Bronze bis Diamant)
create or replace function public.admin_league_move(p_user uuid, p_delta integer)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tier integer;
begin
  perform public._require_admin();
  insert into public.league_members (user_id) values (p_user) on conflict do nothing;
  update public.league_members set tier = least(5, greatest(1, tier + coalesce(p_delta, 0))) where user_id = p_user returning tier into v_tier;
  return v_tier;
end;
$$;

create or replace function public.admin_league_tier(p_user uuid)
returns integer
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public._require_admin();
  return (select tier from public.league_members where user_id = p_user);
end;
$$;

-- 3) Ein Aufruf: abholbare Quests + Platz in der Wochenrangliste mit Nachbarn
create or replace function public.watch_progress()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  v_claim jsonb;
  v_rows jsonb;
  v_rank bigint;
  v_pts bigint;
begin
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht erlaubt.' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', q.id, 'family', q.family, 'stage', q.stage, 'reward', q.reward) order by q.id), '[]'::jsonb)
    into v_claim from public.get_quests() q where q.progress >= q.goal and not q.claimed;

  create temporary table if not exists _wp_tmp (rank bigint, display_name text, points bigint, is_me boolean, avatar_id text, color_id text) on commit drop;
  delete from _wp_tmp where true;
  insert into _wp_tmp select l.rank, l.display_name, l.points, l.is_me, l.avatar_id, l.color_id from public.get_leaderboard('week') l;
  select t.rank, t.points into v_rank, v_pts from _wp_tmp t where t.is_me;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.rank, x.display_name), '[]'::jsonb) into v_rows
    from (select * from _wp_tmp t where v_rank is null and t.rank <= 6 or v_rank is not null and t.rank between v_rank - 4 and v_rank + 4) x;
  return jsonb_build_object('claimable', v_claim, 'rank', v_rank, 'points', v_pts, 'rows', v_rows);
end;
$$;

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('plus_recent_buys', 'admin_league_move', 'admin_league_tier', 'watch_progress')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;
end;
$$;
