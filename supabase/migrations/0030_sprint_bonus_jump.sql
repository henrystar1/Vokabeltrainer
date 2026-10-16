-- 0030: Sprint-Zeit wird dauerhaft gekauft (einmal bezahlen, für immer behalten) und das Spiel „Hüpfer“ (Plattformer).
-- Wiederholbar. Nach 0029 ausführen.

-- ----------------------------------------------------------------------------
-- A. Dauerhafte Sprint-Zusatzzeit
-- ----------------------------------------------------------------------------

create table if not exists public.sprint_upgrades (
  user_id uuid primary key references auth.users (id) on delete cascade,
  seconds integer not null default 0 check (seconds >= 0)
);
alter table public.sprint_upgrades enable row level security;
revoke all on public.sprint_upgrades from anon, authenticated;

create or replace function public.get_sprint_bonus()
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select u.seconds from public.sprint_upgrades u where u.user_id = (select auth.uid())), 0);
$$;

drop function if exists public.buy_sprint_time(integer);
create function public.buy_sprint_time(p_seconds integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  v_have integer;
  v_max integer := public.setting('sprint_extra_max');
  v_cost bigint;
  v_balance bigint;
begin
  perform public._feature_guard('sprint');
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  v_have := public.get_sprint_bonus();
  if p_seconds is null or p_seconds < 1 or v_have + p_seconds > v_max then
    raise exception 'Du hast +% Sekunden, höchstens +% sind möglich.', v_have, v_max using errcode = '22023';
  end if;
  v_cost := p_seconds::bigint * public.setting('sprint_extra_cost')::bigint;
  if coalesce((select balance from public.koin_wallets where user_id = v_me), 0) < v_cost then
    raise exception 'Nicht genug Coins – % Sekunden kosten % Coins.', p_seconds, v_cost using errcode = '23514';
  end if;
  v_balance := public._grant_koins(v_me, -v_cost, 'game_fee', 'sprint_time');
  insert into public.sprint_upgrades (user_id, seconds) values (v_me, p_seconds)
  on conflict (user_id) do update set seconds = public.sprint_upgrades.seconds + excluded.seconds;
  return jsonb_build_object('balance', v_balance, 'bonus', v_have + p_seconds, 'cost', v_cost);
end;
$$;

-- ----------------------------------------------------------------------------
-- B. Spiel „Hüpfer“ (id jump)
-- ----------------------------------------------------------------------------

alter table public.game_runs drop constraint if exists game_runs_game_check;
alter table public.game_runs add constraint game_runs_game_check
  check (game in ('snake', 'tetris', 'blast', 'crossy', 'flappy', 'wave', 'g2048', 'memory', 'bricks', 'mole', 'jump'));

do $$
declare
  r record;
  v_def text;
  v_new text;
begin
  for r in select * from (values
      ('start_game',     array[array['''mole'')', '''mole'', ''jump'')']]),
      ('get_game_board', array[array['''mole'')', '''mole'', ''jump'')']]),
      ('finish_game',    array[array['when ''mole'' then 4 else', 'when ''mole'' then 4 when ''jump'' then 14 else']])
    ) as t(fn, reps)
  loop
    select pg_get_functiondef(p.oid) into v_def
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

do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('get_sprint_bonus', 'buy_sprint_time', 'start_game', 'finish_game', 'get_game_board')
  loop
    execute format('revoke all on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;
end;
$$;
