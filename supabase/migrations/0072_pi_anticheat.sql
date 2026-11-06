-- 0072: Pi schwerer zu schummeln + Admin kann Rekorde löschen. Wiederholbar.
-- Pi-Lauf wird auf dem Server gestartet (memo_pi_start); beim Melden muss genug echte Zeit vergangen sein
-- (Einstellung memo_pi_min_ms = Millisekunden pro Stelle, Verwaltung → Zahlen), sonst wird der Wert abgelehnt.
insert into public.app_settings (key, value, mod_editable) values
  ('memo_pi_min_ms', 450, false),
  ('memo_pi_max_minutes', 60, false)
on conflict (key) do nothing;

create table if not exists public.memo_pi_runs (
  user_id uuid primary key references auth.users (id) on delete cascade,
  started_at timestamptz not null default now()
);
alter table public.memo_pi_runs enable row level security;
revoke all on public.memo_pi_runs from anon, authenticated;

create or replace function public.memo_pi_start()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if (select auth.uid()) is null or public.is_blocked() then
    raise exception 'Nicht erlaubt.' using errcode = '42501';
  end if;
  insert into public.memo_pi_runs (user_id, started_at) values ((select auth.uid()), now())
  on conflict (user_id) do update set started_at = now();
end;
$$;

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
  v_start timestamptz;
  v_ms numeric;
begin
  if v_uid is null or public.is_blocked() then
    raise exception 'Nicht erlaubt.' using errcode = '42501';
  end if;
  if p_game not in ('pi', 'flags') then
    raise exception 'Unbekanntes Spiel.' using errcode = '22023';
  end if;
  if p_score is null or p_score < 0 then
    raise exception 'Ungültiger Wert.' using errcode = '22023';
  end if;
  if p_game = 'pi' and p_score > 500 then
    raise exception 'Ungültiger Wert.' using errcode = '22023';
  end if;
  if p_game = 'flags' and p_score > 1500 then
    raise exception 'Ungültiger Wert.' using errcode = '22023';
  end if;

  if p_game = 'pi' then
    -- Lauf muss vom Server gestartet sein, wird einmalig verbraucht und braucht plausible Zeit.
    delete from public.memo_pi_runs where user_id = v_uid returning started_at into v_start;
    if v_start is null then
      raise exception 'Kein laufender Pi-Versuch.' using errcode = '22023';
    end if;
    v_ms := extract(epoch from (now() - v_start)) * 1000;
    if v_ms > public.setting('memo_pi_max_minutes') * 60000 or v_ms < p_score * public.setting('memo_pi_min_ms') then
      return jsonb_build_object('best', coalesce((select best from public.memo_scores where user_id = v_uid and game = 'pi'), 0),
                                'coins', 0, 'points', 0, 'rejected', true);
    end if;
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
      v_coins := v_delta * public.setting('memo_pi_coins_per_10') / 10;
      v_points := v_delta * public.setting('memo_pi_points_per_10') / 10;
    else
      v_coins := v_delta * public.setting('memo_flags_coins_per_10') / 10;
      v_points := v_delta * public.setting('memo_flags_points_per_100') / 100;
    end if;
    if v_coins > 0 then
      perform public._grant_koins(v_uid, v_coins, 'memo_' || p_game, null);
    end if;
    if v_points > 0 then
      insert into public.points_adjustments (user_id, points, reason, created_by)
      values (v_uid, v_points, case p_game when 'pi' then 'Pi auswendig' else 'Flaggen lernen' end, null);
    end if;
  end if;
  return jsonb_build_object('best', v_best, 'coins', v_coins, 'points', v_points);
end;
$$;

-- Admin: Rekord einer Person (oder alle Rekorde eines Spiels) löschen. Coins bleiben unverändert.
create or replace function public.admin_memo_delete(p_game text, p_user uuid default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare v_n integer;
begin
  perform public._require_admin();
  if p_game not in ('pi', 'flags') then
    raise exception 'Unbekanntes Spiel.' using errcode = '22023';
  end if;
  delete from public.memo_scores where game = p_game and (p_user is null or user_id = p_user);
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('memo_score_submit', 'memo_pi_start', 'admin_memo_delete')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;
end;
$$;
