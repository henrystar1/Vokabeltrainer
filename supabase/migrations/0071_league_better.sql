-- 0071: Liga: Auf- und Abstieg einstellbar, schnelleres Laden, mehr Infos für die Spieler. Wiederholbar.
-- Neue Zahlen (Verwaltung → Zahlen → Liga): league_promote (wie viele steigen auf), league_relegate (wie viele ab),
-- league_relegate_min_group (ab wie vielen Aktiven in der Stufe es überhaupt Abstiege gibt), league_rows_max (Zeilen in der Liste).
insert into public.app_settings (key, value, mod_editable) values
  ('league_promote', 3, false), ('league_relegate', 3, false), ('league_relegate_min_group', 8, false), ('league_rows_max', 30, false)
on conflict (key) do nothing;

create or replace function public._league_rollover()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now_week date := date_trunc('week', timezone('Europe/Berlin', now()))::date;
  v_last date;
  v_min integer := public.setting('league_min_points');
  v_up integer := greatest(public.setting('league_promote'), 0);
  v_down integer := greatest(public.setting('league_relegate'), 0);
  v_group integer := greatest(public.setting('league_relegate_min_group'), 1);
  v_names text[] := array['Bronze', 'Silber', 'Gold', 'Saphir', 'Diamant'];
  r record;
  v_new integer;
  v_result text;
  v_reward integer;
  v_text text;
begin
  perform pg_advisory_xact_lock(70071);
  select m.last_week into v_last from public.league_meta m where m.id;
  if not found then
    insert into public.league_meta (id, last_week) values (true, v_now_week);
    return;
  end if;
  if v_last < v_now_week - 56 then
    v_last := v_now_week - 56;
  end if;

  while v_last < v_now_week loop
    insert into public.league_members (user_id)
    select distinct d.user_id
      from public.daily_stats d join public.profiles p on p.id = d.user_id and not p.blocked
     where d.day between v_last and v_last + 6
    on conflict do nothing;

    for r in
      with pts as (
        select m.user_id, m.tier, public._week_points(m.user_id, v_last) as pts
          from public.league_members m
          join public.profiles p on p.id = m.user_id and not p.blocked
      )
      select x.*,
             case when x.pts > 0 then rank() over (partition by x.tier order by x.pts desc) end as rnk,
             count(*) filter (where x.pts > 0) over (partition by x.tier) as parts
        from pts x
    loop
      v_new := r.tier;
      v_result := 'stayed';
      v_reward := 0;
      if r.pts > 0 and r.rnk <= v_up and r.tier < 5 then
        v_new := r.tier + 1;
        v_result := 'promoted';
      elsif r.tier > 1 and (r.pts = 0 or (v_down > 0 and r.parts >= v_group and r.rnk > r.parts - v_down)) then
        v_new := r.tier - 1;
        v_result := 'relegated';
      end if;
      if r.pts >= v_min and r.rnk <= 3 then
        v_reward := public.setting('league_reward_' || r.rnk);
      end if;

      if v_new <> r.tier then
        update public.league_members set tier = v_new where user_id = r.user_id;
      end if;
      if r.pts > 0 or v_result <> 'stayed' then
        insert into public.league_history (user_id, week_start, tier, rank, points, result, reward)
        values (r.user_id, v_last, r.tier, r.rnk, r.pts, v_result, v_reward)
        on conflict do nothing;
        v_text := 'Wochenliga ' || to_char(v_last, 'DD.MM.') || ' (' || v_names[r.tier] || '): '
          || case when r.rnk is not null then 'Platz ' || r.rnk || ' mit ' || r.pts || ' Punkten. ' else 'keine Punkte. ' end
          || case v_result when 'promoted' then 'Aufstieg in ' || v_names[v_new] || '!'
                           when 'relegated' then 'Abstieg in ' || v_names[v_new] || '.'
                           else 'Du bleibst in ' || v_names[r.tier] || '.' end
          || case when v_reward > 0 then ' +' || v_reward || ' Coins.' else '' end;
        insert into public.user_messages (user_id, from_id, body) values (r.user_id, null, v_text);
        if v_reward > 0 then
          perform public._grant_koins(r.user_id, v_reward, 'league', v_last::text);
        end if;
      end if;
    end loop;

    v_last := v_last + 7;
    update public.league_meta set last_week = v_last where id;
  end loop;
end;
$$;

-- Wochenpunkte werden nur einmal je Person berechnet (vorher zweimal), die Liste ist auf die obersten Plätze und dich begrenzt.
create or replace function public.get_league()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  v_week date := date_trunc('week', timezone('Europe/Berlin', now()))::date;
  v_tier integer;
  v_up integer := greatest(public.setting('league_promote'), 0);
  v_down integer := greatest(public.setting('league_relegate'), 0);
  v_group integer := greatest(public.setting('league_relegate_min_group'), 1);
  v_max integer := greatest(public.setting('league_rows_max'), 5);
  v_parts integer;
  v_total integer;
  v_rows jsonb;
  v_my_rank integer;
  v_my_pts integer;
  v_up_pts integer;
  v_down_pts integer;
begin
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  perform public._league_rollover();
  insert into public.league_members (user_id) values (v_me) on conflict do nothing;
  select m.tier into v_tier from public.league_members m where m.user_id = v_me;

  create temporary table if not exists _lg_tmp (user_id uuid, pts integer, rnk bigint) on commit drop;
  delete from _lg_tmp;
  insert into _lg_tmp
    select x.user_id, x.pts, rank() over (order by x.pts desc)
      from (
        select m.user_id, public._week_points(m.user_id, v_week) as pts
          from public.league_members m join public.profiles p on p.id = m.user_id and not p.blocked
         where m.tier = v_tier
      ) x;

  select count(*) filter (where pts > 0), count(*) into v_parts, v_total from _lg_tmp;
  select rnk, pts into v_my_rank, v_my_pts from _lg_tmp where user_id = v_me;
  -- Punkte des letzten Aufstiegsplatzes und des ersten Abstiegsplatzes (für „noch X Punkte“)
  select min(pts) into v_up_pts from _lg_tmp where pts > 0 and rnk <= v_up;
  select max(pts) into v_down_pts from _lg_tmp t
   where v_tier > 1 and v_down > 0 and v_parts >= v_group and pts > 0 and rnk > v_parts - v_down;

  select coalesce(jsonb_agg(jsonb_build_object(
           'rank', t.rnk, 'display_name', pr.display_name, 'points', t.pts, 'is_me', t.user_id = v_me,
           'avatar_id', pr.avatar_id, 'color_id', pr.color_id, 'effect_id', pr.effect_id,
           'role', pr.role, 'tag_id', pr.tag_id, 'theme_id', pr.theme_id) order by t.pts desc, pr.display_name), '[]'::jsonb)
    into v_rows
    from (
      select * from _lg_tmp
       where user_id = v_me or (pts > 0 and rnk <= v_max)
          or (pts = 0 and (select count(*) from _lg_tmp t2 where t2.pts = 0 and t2.user_id <= _lg_tmp.user_id) <= 5)
    ) t
    join public.profiles pr on pr.id = t.user_id;

  return jsonb_build_object(
    'tier', v_tier,
    'week_start', v_week,
    'ends_at', ((v_week + 7)::timestamp at time zone 'Europe/Berlin'),
    'participants', v_parts,
    'members', v_total,
    'relegation_active', v_parts >= v_group and v_down > 0,
    'promote', case when v_tier < 5 then v_up else 0 end,
    'relegate', case when v_tier > 1 then v_down else 0 end,
    'min_points', public.setting('league_min_points'),
    'rewards', jsonb_build_array(public.setting('league_reward_1'), public.setting('league_reward_2'), public.setting('league_reward_3')),
    'my_rank', case when v_my_pts > 0 then v_my_rank end,
    'my_points', coalesce(v_my_pts, 0),
    'promote_points', v_up_pts,
    'relegate_points', v_down_pts,
    'rows', v_rows,
    'last', (select to_jsonb(h) - 'user_id' from public.league_history h where h.user_id = v_me order by h.week_start desc limit 1)
  );
end;
$$;

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('_league_rollover', 'get_league')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    if r.proname not like '\_%' then
      execute format('grant execute on function %s to authenticated', r.sig);
    end if;
  end loop;
end;
$$;
