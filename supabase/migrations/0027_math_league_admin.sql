-- ============================================================================
-- 0027: Mathe gibt Coins und Ranglistenpunkte, Admin sieht jede Liga, Korrektur der Wochenpunkte
-- - Behebt einen Fehler aus 0024: Die Wochenpunkte der Liga rechneten fest (2 Punkte je Antwort) und ließen
--   Einstellungen, Multiple-Choice-Punkte und Admin-Anpassungen weg. Jetzt wieder wie in der Rangliste, plus Plus ×1,5.
-- - Die Rangliste (Woche/Monat/Gesamt) zählt Plus ×1,5 ebenfalls.
-- Wiederholbar. Nach 0026 ausführen.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Mathe: Einstellungen und Zähler
-- ----------------------------------------------------------------------------

insert into public.app_settings (key, value, mod_editable) values
  ('math_points_per_answer', 1, false),   -- Mathe: Ranglistenpunkte je richtiger Antwort
  ('math_daily_cap', 100, false),         -- Mathe: höchstens so viele richtige pro Tag zählen
  ('math_coin_every', 10, false),         -- Mathe: 1 Coin je so viele richtige Antworten
  ('math_coin_cap', 10, false),           -- Mathe: höchstens so viele Coins pro Tag
  ('math_min_seconds', 1, false)          -- Mathe: Mindestzeit je Aufgabe (Sekunden), gegen Schummeln
on conflict (key) do nothing;

alter table public.daily_stats add column if not exists math_correct integer not null default 0;

create or replace function public._math_points(p_math integer)
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select (least(p_math, public.setting('math_daily_cap')) * public.setting('math_points_per_answer'))::bigint;
$$;

create or replace function public.submit_math(p_correct integer, p_total integer, p_seconds integer default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  v_today date := (now() at time zone 'Europe/Berlin')::date;
  v_before integer;
  v_counted integer;
  v_after integer;
  v_every integer := greatest(public.setting('math_coin_every'), 1);
  v_paid integer;
  v_coins integer;
begin
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  if p_correct is null or p_total is null or p_correct < 0 or p_total < 1 or p_total > 100 or p_correct > p_total then
    raise exception 'Ungültiges Ergebnis.' using errcode = '22023';
  end if;
  if p_seconds is null or p_seconds < p_total * public.setting('math_min_seconds') then
    raise exception 'Das ging zu schnell, um echt zu sein. Das Ergebnis zählt nicht.' using errcode = '22023';
  end if;
  select coalesce(math_correct, 0) into v_before from public.daily_stats where user_id = v_me and day = v_today;
  v_before := coalesce(v_before, 0);
  v_counted := greatest(least(p_correct, public.setting('math_daily_cap') - v_before), 0);
  insert into public.daily_stats (user_id, day, answers_total, answers_correct, math_correct)
  values (v_me, v_today, 0, 0, v_counted)
  on conflict (user_id, day) do update set math_correct = public.daily_stats.math_correct + v_counted;
  v_after := v_before + v_counted;
  select coalesce(sum(l.amount), 0) into v_paid
    from public.koin_ledger l
   where l.user_id = v_me and l.reason = 'math'
     and (l.created_at at time zone 'Europe/Berlin')::date = v_today;
  v_coins := least(v_after / v_every - v_before / v_every, greatest(public.setting('math_coin_cap') - v_paid, 0));
  if v_coins > 0 then
    perform public._grant_koins(v_me, v_coins, 'math', null);
  end if;
  return jsonb_build_object('points', v_counted * public.setting('math_points_per_answer'), 'coins', greatest(v_coins, 0));
end;
$$;

-- ----------------------------------------------------------------------------
-- 2. Wochenpunkte und Rangliste: Einstellungen + Multiple Choice + Mathe + Admin-Anpassungen, Plus ×1,5
-- ----------------------------------------------------------------------------

create or replace function public._plus_points_factor(p_user uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select case when public._plus_active(p_user) then greatest(public._pls('plus_points_mult'), 1) else 1 end;
$$;

create or replace function public._week_points(p_user uuid, p_from date)
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select round(coalesce((select sum(public._day_points(d.answers_correct, d.answers_total)
                                    + public._choice_points(d.choice_correct)
                                    + public._math_points(d.math_correct))
                           from public.daily_stats d
                          where d.user_id = p_user and d.day between p_from and p_from + 6), 0)
               * public._plus_points_factor(p_user))::bigint
       + coalesce((select sum(a.points) from public.points_adjustments a
                    where a.user_id = p_user
                      and (a.created_at at time zone 'Europe/Berlin')::date between p_from and p_from + 6), 0)::bigint;
$$;

drop function if exists public.get_leaderboard(text);
create function public.get_leaderboard(p_period text default 'week')
returns table (rank bigint, display_name text, points bigint, is_me boolean,
               avatar_id text, color_id text, effect_id text, role text, tag_id text, theme_id text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_from date;
  v_me uuid := (select auth.uid());
begin
  if v_me is null then
    raise exception 'Nicht angemeldet' using errcode = '28000';
  end if;

  if p_period = 'week' then
    v_from := date_trunc('week', timezone('Europe/Berlin', now()))::date;
  elsif p_period = 'month' then
    v_from := date_trunc('month', timezone('Europe/Berlin', now()))::date;
  elsif p_period = 'all' then
    v_from := null;
  else
    raise exception 'Ungültiger Zeitraum: %', p_period using errcode = '22023';
  end if;

  return query
  with days as (
    select d.user_id as uid,
           sum(public._day_points(d.answers_correct, d.answers_total)
               + public._choice_points(d.choice_correct)
               + public._math_points(d.math_correct)) as pts
      from public.daily_stats d
     where v_from is null or d.day >= v_from
     group by d.user_id
  ), parts as (
    select x.uid, round(x.pts * public._plus_points_factor(x.uid))::bigint as pts from days x
    union all
    select a.user_id, a.points::bigint
      from public.points_adjustments a
     where v_from is null or (a.created_at at time zone 'Europe/Berlin')::date >= v_from
  ), scored as (
    select uid, sum(pts)::bigint as pts from parts group by uid
  )
  select
    (rank() over (order by s.pts desc))::bigint,
    pr.display_name,
    s.pts,
    (s.uid = v_me),
    pr.avatar_id, pr.color_id, pr.effect_id, pr.role, pr.tag_id, pr.theme_id
  from scored s
  join public.profiles pr on pr.id = s.uid and not pr.blocked
  where s.pts > 0
  order by s.pts desc, pr.display_name
  limit 100;
end;
$$;

-- ----------------------------------------------------------------------------
-- 3. Admin: jede Liga ansehen
-- ----------------------------------------------------------------------------

create or replace function public.admin_get_league(p_tier integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_week date := date_trunc('week', timezone('Europe/Berlin', now()))::date;
begin
  perform public._require_admin();
  if p_tier is null or p_tier < 1 or p_tier > 5 then
    raise exception 'Unbekannte Liga.' using errcode = '22023';
  end if;
  perform public._league_rollover();
  return jsonb_build_object(
    'tier', p_tier,
    'week_start', v_week,
    'ends_at', ((v_week + 7)::timestamp at time zone 'Europe/Berlin'),
    'counts', (select coalesce(jsonb_agg(jsonb_build_object('tier', t.tier, 'members', t.members, 'active', t.active) order by t.tier), '[]'::jsonb)
                 from (select g.tier,
                              count(m.user_id) filter (where p.id is not null) as members,
                              count(m.user_id) filter (where p.id is not null and public._week_points(m.user_id, v_week) > 0) as active
                         from generate_series(1, 5) as g(tier)
                         left join public.league_members m on m.tier = g.tier
                         left join public.profiles p on p.id = m.user_id and not p.blocked
                        group by g.tier) t),
    'min_points', public.setting('league_min_points'),
    'rewards', jsonb_build_array(public.setting('league_reward_1'), public.setting('league_reward_2'), public.setting('league_reward_3')),
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
               'rank', s.rnk, 'display_name', pr.display_name, 'points', s.pts, 'is_me', s.user_id = (select auth.uid()),
               'avatar_id', pr.avatar_id, 'color_id', pr.color_id, 'effect_id', pr.effect_id,
               'role', pr.role, 'tag_id', pr.tag_id, 'theme_id', pr.theme_id) order by s.pts desc, pr.display_name)
        from (
          select x.user_id, x.pts, rank() over (order by x.pts desc) as rnk
            from (
              select m.user_id, public._week_points(m.user_id, v_week) as pts
                from public.league_members m join public.profiles p on p.id = m.user_id and not p.blocked
               where m.tier = p_tier
            ) x
        ) s
        join public.profiles pr on pr.id = s.user_id), '[]'::jsonb));
end;
$$;

-- ----------------------------------------------------------------------------
-- 4. Rechte
-- ----------------------------------------------------------------------------

do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig, p.proname
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('_math_points', '_plus_points_factor', '_week_points', 'submit_math', 'get_leaderboard', 'admin_get_league')
  loop
    if left(r.proname, 1) = '_' then
      execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    else
      execute format('revoke all on function %s from public, anon', r.sig);
      execute format('grant execute on function %s to authenticated', r.sig);
    end if;
  end loop;
end;
$$;
