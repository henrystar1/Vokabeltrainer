-- 0010: Coins im Sprint, Bot-Spiele (Snake, Tetris, Block Blast) gegen Eintritt, Klavier-Artikel.
-- Wiederholbar. Nach 0009 ausführen.

-- ----------------------------------------------------------------------------
-- 1. Einstellungen
-- ----------------------------------------------------------------------------

insert into public.app_settings (key, value, mod_editable) values
  ('sprint_coin_every', 5, false),     -- Sprint: 1 Coin je so viele richtige Antworten
  ('sprint_coin_cap', 20, false),      -- Sprint: höchstens so viele Coins pro Tag
  ('game_fee', 10, false),             -- Bot-Spiele: Eintritt in Coins
  ('game_reward', 20, false),          -- Bot-Spiele: Gewinn bei Sieg über den Bot (Coins)
  ('game_daily_cap', 200, false),      -- Bot-Spiele: höchstens so viele Gewinn-Coins pro Tag
  ('bot_snake', 15, true),             -- Stärke des Bots: höchstes Ziel (Äpfel)
  ('bot_tetris', 1200, true),          -- Stärke des Bots: höchstes Ziel (Punkte)
  ('bot_blast', 500, true)             -- Stärke des Bots: höchstes Ziel (Punkte)
on conflict (key) do nothing;

-- ----------------------------------------------------------------------------
-- 2. Sprint verdient Coins
-- ----------------------------------------------------------------------------

drop function if exists public.submit_sprint(integer, integer);
create function public.submit_sprint(p_score integer, p_total integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  v_week date := date_trunc('week', timezone('Europe/Berlin', now()))::date;
  v_today date := (now() at time zone 'Europe/Berlin')::date;
  v_every integer := greatest(public.setting('sprint_coin_every'), 1);
  v_earned integer;
  v_got integer;
  v_best integer;
begin
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  if p_score is null or p_total is null or p_score < 0 or p_score > p_total or p_total > 150 then
    raise exception 'Ungültiges Ergebnis.' using errcode = '22023';
  end if;
  if (select count(*) from public.sprint_scores s where s.user_id = v_me and s.created_at > now() - interval '24 hours') >= 30 then
    raise exception 'Heute gab es schon viele Sprints – morgen geht es weiter.' using errcode = '54000';
  end if;
  insert into public.sprint_scores (user_id, score, total) values (v_me, p_score, p_total);

  select coalesce(sum(l.amount), 0) into v_got
    from public.koin_ledger l
   where l.user_id = v_me and l.reason = 'sprint' and (l.created_at at time zone 'Europe/Berlin')::date = v_today;
  v_earned := least(p_score / v_every, greatest(public.setting('sprint_coin_cap') - v_got, 0));
  if v_earned > 0 then
    perform public._grant_koins(v_me, v_earned, 'sprint');
  end if;

  select max(s.score) into v_best from public.sprint_scores s
   where s.user_id = v_me and (s.created_at at time zone 'Europe/Berlin')::date >= v_week;
  return jsonb_build_object('best', v_best, 'earned', v_earned);
end;
$$;

-- ----------------------------------------------------------------------------
-- 3. Bot-Spiele
-- ----------------------------------------------------------------------------

create table if not exists public.game_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  game text not null check (game in ('snake', 'tetris', 'blast')),
  bot_score integer not null,
  fee integer not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  score integer,
  won boolean,
  reward integer not null default 0
);
create index if not exists game_runs_user_idx on public.game_runs (user_id, started_at desc);

alter table public.game_runs enable row level security;
revoke all on public.game_runs from anon, authenticated;

-- Bezahlt den Eintritt und würfelt das Ziel des Bots (25 % bis 100 % seiner Maximalstärke).
drop function if exists public.start_game(text);
create function public.start_game(p_game text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  v_fee integer := public.setting('game_fee');
  v_max integer;
  v_bot integer;
  v_id uuid;
  v_balance integer;
begin
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  if p_game not in ('snake', 'tetris', 'blast') then
    raise exception 'Unbekanntes Spiel.' using errcode = '22023';
  end if;
  v_max := greatest(public.setting('bot_' || p_game), 1);
  v_bot := greatest(1, round(v_max * (0.25 + 0.75 * random()))::integer);
  if coalesce((select balance from public.koin_wallets where user_id = v_me), 0) < v_fee then
    raise exception 'Nicht genug Coins – der Eintritt kostet % Coins.', v_fee using errcode = '23514';
  end if;
  insert into public.game_runs (user_id, game, bot_score, fee) values (v_me, p_game, v_bot, v_fee) returning id into v_id;
  v_balance := public._grant_koins(v_me, -v_fee, 'game_fee', v_id::text);
  return jsonb_build_object('id', v_id, 'bot_score', v_bot, 'fee', v_fee, 'balance', v_balance);
end;
$$;

-- Wertet das Spiel. Die Punkte werden auf das begrenzt, was in der vergangenen Zeit möglich war.
drop function if exists public.finish_game(uuid, integer);
create function public.finish_game(p_id uuid, p_score integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  r public.game_runs;
  v_elapsed numeric;
  v_rate numeric;
  v_score integer;
  v_won boolean;
  v_reward integer := 0;
  v_today date := (now() at time zone 'Europe/Berlin')::date;
  v_paid integer;
  v_balance integer;
begin
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  select * into r from public.game_runs where id = p_id and user_id = v_me for update;
  if not found then
    raise exception 'Spiel nicht gefunden.' using errcode = 'P0002';
  end if;
  if r.finished_at is not null then
    raise exception 'Dieses Spiel ist schon gewertet.' using errcode = '22023';
  end if;
  if p_score is null or p_score < 0 then
    raise exception 'Ungültiges Ergebnis.' using errcode = '22023';
  end if;
  v_elapsed := extract(epoch from (now() - r.started_at));
  v_rate := case r.game when 'snake' then 2 when 'tetris' then 50 else 60 end;
  v_score := least(p_score, floor(v_elapsed * v_rate)::integer);
  v_won := v_score > r.bot_score;
  if v_won and v_elapsed <= 7200 then
    select coalesce(sum(l.amount), 0) into v_paid
      from public.koin_ledger l
     where l.user_id = v_me and l.reason = 'game_win' and (l.created_at at time zone 'Europe/Berlin')::date = v_today;
    v_reward := least(public.setting('game_reward'), greatest(public.setting('game_daily_cap') - v_paid, 0));
  end if;
  update public.game_runs set finished_at = now(), score = v_score, won = v_won, reward = v_reward where id = r.id;
  if v_reward > 0 then
    v_balance := public._grant_koins(v_me, v_reward, 'game_win', r.id::text);
  else
    v_balance := coalesce((select balance from public.koin_wallets where user_id = v_me), 0);
  end if;
  return jsonb_build_object('won', v_won, 'score', v_score, 'bot_score', r.bot_score, 'reward', v_reward, 'balance', v_balance);
end;
$$;

-- ----------------------------------------------------------------------------
-- 4. Shop: Klavier
-- ----------------------------------------------------------------------------

insert into public.shop_items (id, kind, name, price, sort, required_role) values
  ('avatar_piano', 'avatar', 'Klavier',    2800, 290, null),
  ('effect_piano', 'effect', 'Klaviertasten', 3500, 150, null)
on conflict (id) do nothing;

-- ----------------------------------------------------------------------------
-- 5. Rechte
-- ----------------------------------------------------------------------------

do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('submit_sprint', 'start_game', 'finish_game')
  loop
    execute format('revoke all on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;
end;
$$;
