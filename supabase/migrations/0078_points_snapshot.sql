-- 0078: Plus-/Pro-Punkte-Multiplikator gilt nur für Punkte, die man verdient, solange Plus/Pro aktiv ist.
-- Vorher wurde der Multiplikator beim Anzeigen auf ALLE Punkte gerechnet: Beim Kauf verdoppelte sich der Stand rückwirkend,
-- beim Ablauf ging er wieder weg. Jetzt wird der Bonus beim Verdienen gespeichert (daily_stats.bonus_pts) und bleibt.
-- Hinweis: Alte Tage haben Bonus 0; es zählt ab jetzt nur, was bei aktivem Plus/Pro verdient wird. Wiederholbar.
alter table public.daily_stats add column if not exists bonus_pts numeric not null default 0;

create or replace function public._daily_bonus()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new numeric;
  v_old numeric := 0;
  v_f numeric;
begin
  v_f := public._plus_points_factor(new.user_id);
  v_new := public._day_points(new.answers_correct, new.answers_total) + public._choice_points(new.choice_correct) + public._math_points(new.math_correct);
  if tg_op = 'UPDATE' then
    v_old := public._day_points(old.answers_correct, old.answers_total) + public._choice_points(old.choice_correct) + public._math_points(old.math_correct);
    new.bonus_pts := greatest(0, coalesce(old.bonus_pts, 0) + (v_new - v_old) * (v_f - 1));
  else
    new.bonus_pts := greatest(0, v_new * (v_f - 1));
  end if;
  return new;
end;
$$;

drop trigger if exists daily_bonus on public.daily_stats;
create trigger daily_bonus before insert or update of answers_correct, answers_total, choice_correct, math_correct on public.daily_stats
  for each row execute function public._daily_bonus();

create or replace function public._week_points(p_user uuid, p_from date)
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select round(coalesce((select sum(public._day_points(d.answers_correct, d.answers_total)
                                    + public._choice_points(d.choice_correct)
                                    + public._math_points(d.math_correct) + d.bonus_pts)
                           from public.daily_stats d
                          where d.user_id = p_user and d.day between p_from and p_from + 6), 0))::bigint
       + coalesce((select sum(a.points) from public.points_adjustments a
                    where a.user_id = p_user
                      and (a.created_at at time zone 'Europe/Berlin')::date between p_from and p_from + 6), 0)::bigint;
$$;

create or replace function public.get_leaderboard(p_period text default 'week')
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
               + public._math_points(d.math_correct) + d.bonus_pts) as pts
      from public.daily_stats d
     where v_from is null or d.day >= v_from
     group by d.user_id
  ), parts as (
    select x.uid, round(x.pts)::bigint as pts from days x
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

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('_daily_bonus', '_week_points', 'get_leaderboard')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    if r.proname = 'get_leaderboard' then
      execute format('grant execute on function %s to authenticated', r.sig);
    end if;
  end loop;
end;
$$;
