-- 0064: Pi und Flaggen geben Coins und Punkte, aber nur wenn der Bestwert steigt. Wiederholbar.
drop function if exists public.memo_score_submit(text, integer);
create function public.memo_score_submit(p_game text, p_score integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
  v_old integer := 0;
  v_best integer;
  v_delta integer;
  v_coins bigint := 0;
  v_points integer := 0;
begin
  if v_uid is null or public.is_blocked() then
    raise exception 'Nicht erlaubt.' using errcode = '42501';
  end if;
  if p_game not in ('pi', 'flags') then
    raise exception 'Unbekanntes Spiel.' using errcode = '22023';
  end if;
  if p_score is null or p_score < 0 or p_score > case p_game when 'pi' then 500 else 300 end then
    raise exception 'Ungültiger Wert.' using errcode = '22023';
  end if;
  select best into v_old from public.memo_scores where user_id = v_uid and game = p_game for update;
  v_old := coalesce(v_old, 0);
  insert into public.memo_scores (user_id, game, best) values (v_uid, p_game, p_score)
  on conflict (user_id, game) do update
    set best = greatest(public.memo_scores.best, excluded.best),
        updated_at = case when excluded.best > public.memo_scores.best then now() else public.memo_scores.updated_at end
  returning best into v_best;
  v_delta := v_best - v_old;
  if v_delta > 0 then
    if p_game = 'pi' then
      v_coins := v_delta * 3;            -- 3 Coins je neue Stelle
      v_points := greatest(1, v_delta / 5); -- 1 Punkt je 5 neue Stellen
    else
      v_coins := v_delta * 10;           -- 10 Coins je neu gemeistertes Land
      v_points := greatest(1, v_delta / 2);
    end if;
    perform public._grant_koins(v_uid, v_coins, 'memo_' || p_game, null);
    insert into public.points_adjustments (user_id, points, reason, created_by)
    values (v_uid, v_points, case p_game when 'pi' then 'Pi auswendig' else 'Flaggen gemeistert' end, null);
  end if;
  return jsonb_build_object('best', v_best, 'coins', v_coins, 'points', v_points);
end;
$$;

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'memo_score_submit'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;
end;
$$;
