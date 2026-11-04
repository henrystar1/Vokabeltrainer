-- 0062: Ranglisten für Pi (Stellen ohne Tipp) und Flaggen (gemeisterte Länder). Wiederholbar.
create table if not exists public.memo_scores (
  user_id uuid not null references auth.users (id) on delete cascade,
  game text not null check (game in ('pi', 'flags')),
  best integer not null check (best >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, game)
);
alter table public.memo_scores enable row level security;
revoke all on public.memo_scores from anon, authenticated;

-- Bestwert melden (es zählt immer der höchste).
create or replace function public.memo_score_submit(p_game text, p_score integer)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare v_best integer;
begin
  if (select auth.uid()) is null or public.is_blocked() then
    raise exception 'Nicht erlaubt.' using errcode = '42501';
  end if;
  if p_game not in ('pi', 'flags') then
    raise exception 'Unbekanntes Spiel.' using errcode = '22023';
  end if;
  if p_score is null or p_score < 0 or p_score > case p_game when 'pi' then 500 else 300 end then
    raise exception 'Ungültiger Wert.' using errcode = '22023';
  end if;
  insert into public.memo_scores (user_id, game, best) values ((select auth.uid()), p_game, p_score)
  on conflict (user_id, game) do update
    set best = greatest(public.memo_scores.best, excluded.best),
        updated_at = case when excluded.best > public.memo_scores.best then now() else public.memo_scores.updated_at end
  returning best into v_best;
  return v_best;
end;
$$;

drop function if exists public.memo_leaderboard(text);
create function public.memo_leaderboard(p_game text)
returns table (rank bigint, user_id uuid, display_name text, best integer, is_me boolean)
language sql
stable
security definer
set search_path = public
as $$
  select rank() over (order by s.best desc, s.updated_at) as rank,
         s.user_id, p.display_name, s.best, s.user_id = (select auth.uid())
    from public.memo_scores s
    join public.profiles p on p.id = s.user_id
   where s.game = p_game and s.best > 0 and not p.blocked and p.approved
     and (select auth.uid()) is not null and not public.is_blocked()
   order by s.best desc, s.updated_at
   limit 30;
$$;

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('memo_score_submit', 'memo_leaderboard')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;
end;
$$;
