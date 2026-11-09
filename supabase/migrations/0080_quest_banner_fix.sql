-- 0080: Fix „Quest abholen"-Banner: Plus-/Pro-Quests, die man ohne Plus/Pro gar nicht abholen darf, wurden trotzdem gemeldet
-- (Banner kam immer wieder). Jetzt nur noch Quests, die man wirklich abholen kann. Wiederholbar.
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
  v_inv jsonb;
begin
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht erlaubt.' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', q.id, 'family', q.family, 'stage', q.stage, 'reward', q.reward) order by q.id), '[]'::jsonb)
    into v_claim from public.get_quests() q
   where q.progress >= q.goal and not q.claimed
     and (not q.plus_only
          or (q.family like 'pro\_%' and public._pro_active(v_me))
          or (q.family not like 'pro\_%' and public._plus_active(v_me)));

  create temporary table if not exists _wp_tmp (rank bigint, display_name text, points bigint, is_me boolean, avatar_id text, color_id text) on commit drop;
  delete from _wp_tmp where true;
  insert into _wp_tmp select l.rank, l.display_name, l.points, l.is_me, l.avatar_id, l.color_id from public.get_leaderboard('week') l;
  select t.rank, t.points into v_rank, v_pts from _wp_tmp t where t.is_me;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.rank, x.display_name), '[]'::jsonb) into v_rows
    from (select * from _wp_tmp t where v_rank is null and t.rank <= 6 or v_rank is not null and t.rank between v_rank - 4 and v_rank + 4) x;
  select coalesce(jsonb_agg(jsonb_build_object('id', g.id, 'kind', g.kind, 'host', hp.display_name) order by g.created_at), '[]'::jsonb)
    into v_inv
    from public.og_players mp join public.og_games g on g.id = mp.game_id join public.profiles hp on hp.id = g.host_id
   where mp.user_id = v_me and mp.join_state = 'invited' and g.status = 'lobby' and g.updated_at > now() - interval '2 days';
  return jsonb_build_object('claimable', v_claim, 'rank', v_rank, 'points', v_pts, 'rows', v_rows, 'invites', v_inv);
end;
$$;

do $$
declare r record;
begin
  for r in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'watch_progress'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;
end;
$$;
