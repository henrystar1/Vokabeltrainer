-- 0028: Latein und Spanisch als Sprachen (Bücher, Grammatik). Wiederholbar.

insert into public.languages (code, name) values
  ('la', 'Latein'),
  ('es', 'Spanisch')
on conflict (code) do update set name = excluded.name;

-- Grammatik-Aufgabensätze: weitere Sprachen erlauben.
do $$
begin
  alter table public.ai_grammar_sets drop constraint if exists ai_grammar_sets_language_check;
  alter table public.ai_grammar_sets
    add constraint ai_grammar_sets_language_check check (language in ('en', 'fr', 'la', 'es'));
end;
$$;

-- ============================================================================
-- Teil 2 (gleiche Datei, Update 28): Sprint-Zeit kaufen, Liga für alle, vier neue Spiele
-- ============================================================================

-- ----------------------------------------------------------------------------
-- A. Sprint: zusätzliche Sekunden für Coins (Standard 100 Coins je Sekunde)
-- ----------------------------------------------------------------------------

insert into public.app_settings (key, value, mod_editable) values
  ('sprint_extra_cost', 100, false),   -- Coins je zusätzlicher Sprint-Sekunde
  ('sprint_extra_max', 30, false)      -- höchstens so viele Sekunden pro Sprint kaufbar
on conflict (key) do nothing;

create or replace function public.buy_sprint_time(p_seconds integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  v_cost bigint;
  v_balance bigint;
begin
  perform public._feature_guard('sprint');
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  if p_seconds is null or p_seconds < 1 or p_seconds > public.setting('sprint_extra_max') then
    raise exception 'Du kannst 1 bis % Sekunden dazukaufen.', public.setting('sprint_extra_max') using errcode = '22023';
  end if;
  v_cost := p_seconds::bigint * public.setting('sprint_extra_cost')::bigint;
  if coalesce((select balance from public.koin_wallets where user_id = v_me), 0) < v_cost then
    raise exception 'Nicht genug Coins – % Sekunden kosten % Coins.', p_seconds, v_cost using errcode = '23514';
  end if;
  v_balance := public._grant_koins(v_me, -v_cost, 'game_fee', 'sprint_time');
  return jsonb_build_object('balance', v_balance, 'seconds', p_seconds, 'cost', v_cost);
end;
$$;

-- ----------------------------------------------------------------------------
-- B. Liga: alle Nutzer sind Mitglied (bisher nur, wer die Liga geöffnet oder Punkte hatte),
--    und die eigene Liga zeigt alle Mitglieder – auch mit 0 Punkten.
-- ----------------------------------------------------------------------------

insert into public.league_members (user_id)
select p.id from public.profiles p where not p.blocked
on conflict do nothing;

create or replace function public._league_member_on_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.league_members (user_id) values (new.id) on conflict do nothing;
  return new;
end;
$$;

drop trigger if exists profiles_league_member on public.profiles;
create trigger profiles_league_member
  after insert on public.profiles
  for each row execute function public._league_member_on_profile();

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
  v_parts integer;
begin
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  perform public._league_rollover();
  insert into public.league_members (user_id) values (v_me) on conflict do nothing;
  select m.tier into v_tier from public.league_members m where m.user_id = v_me;

  select count(*) into v_parts
    from public.league_members m join public.profiles p on p.id = m.user_id and not p.blocked
   where m.tier = v_tier and public._week_points(m.user_id, v_week) > 0;

  return jsonb_build_object(
    'tier', v_tier,
    'week_start', v_week,
    'ends_at', ((v_week + 7)::timestamp at time zone 'Europe/Berlin'),
    'participants', v_parts,
    'relegation_active', v_parts >= 8,
    'min_points', public.setting('league_min_points'),
    'rewards', jsonb_build_array(public.setting('league_reward_1'), public.setting('league_reward_2'), public.setting('league_reward_3')),
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
               'rank', s.rnk, 'display_name', pr.display_name, 'points', s.pts, 'is_me', s.user_id = v_me,
               'avatar_id', pr.avatar_id, 'color_id', pr.color_id, 'effect_id', pr.effect_id,
               'role', pr.role, 'tag_id', pr.tag_id, 'theme_id', pr.theme_id) order by s.pts desc, pr.display_name)
        from (
          select x.user_id, x.pts, rank() over (order by x.pts desc) as rnk
            from (
              select m.user_id, public._week_points(m.user_id, v_week) as pts
                from public.league_members m join public.profiles p on p.id = m.user_id and not p.blocked
               where m.tier = v_tier
            ) x
        ) s
        join public.profiles pr on pr.id = s.user_id), '[]'::jsonb),
    'last', (select to_jsonb(h) - 'user_id' from public.league_history h where h.user_id = v_me order by h.week_start desc limit 1)
  );
end;
$$;

-- ----------------------------------------------------------------------------
-- C. Vier neue Spiele: 2048, Memory, Bricks, Maulwurf
-- ----------------------------------------------------------------------------

alter table public.game_runs drop constraint if exists game_runs_game_check;
alter table public.game_runs add constraint game_runs_game_check
  check (game in ('snake', 'tetris', 'blast', 'crossy', 'flappy', 'wave', 'g2048', 'memory', 'bricks', 'mole'));

do $$
declare
  r record;
  v_def text;
  v_new text;
  v_args text;
begin
  for r in select * from (values
      ('start_game',     array[array['''crossy'', ''flappy'', ''wave''', '''crossy'', ''flappy'', ''wave'', ''g2048'', ''memory'', ''bricks'', ''mole''']]),
      ('get_game_board', array[array['''crossy'', ''flappy'', ''wave''', '''crossy'', ''flappy'', ''wave'', ''g2048'', ''memory'', ''bricks'', ''mole''']]),
      ('finish_game',    array[array['when ''wave'' then 2 else', 'when ''wave'' then 2 when ''g2048'' then 40 when ''memory'' then 2 when ''bricks'' then 4 when ''mole'' then 4 else']])
    ) as t(fn, reps)
  loop
    select pg_get_functiondef(p.oid), pg_get_function_identity_arguments(p.oid) into v_def, v_args
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = r.fn
     limit 1;
    continue when v_def is null;
    v_new := v_def;
    for i in 1 .. array_length(r.reps, 1) loop
      v_new := replace(v_new, r.reps[i][1], r.reps[i][2]);
    end loop;
    continue when v_new = v_def;
    execute v_new;
  end loop;
end;
$$;

-- ----------------------------------------------------------------------------
-- D. Rechte
-- ----------------------------------------------------------------------------

do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig, p.proname
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('buy_sprint_time', 'get_league', '_league_member_on_profile', 'start_game', 'finish_game', 'get_game_board')
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
