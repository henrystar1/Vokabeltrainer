-- 0085: 3D-Shooter als Online-Spiel (2–4 Personen). Der Ersteller zahlt beim Start 50 Coins (einstellbar).
-- Bewegung/Schüsse laufen in Echtzeit über die Spiel-Datenbanken (Broadcast); hier liegen nur Lobby, Start, Punkte und Ergebnis.
-- Wiederholbar.

alter table public.og_games drop constraint if exists og_games_kind_check;
alter table public.og_games add constraint og_games_kind_check check (kind in ('rps', 'ludo', 'ships', 'shooter'));

insert into public.app_settings (key, value, mod_editable) values
  ('shooter_fee', 50, false), ('shooter_to_win', 10, false), ('shooter_minutes', 5, false)
on conflict (key) do nothing;

-- Bestehende Funktionen aus 0079 gezielt erweitern (Text ersetzen; bricht ab, falls eine Stelle nicht gefunden wird).
create or replace function public._patch_fn(p_name text, p_from text, p_to text)
returns void
language plpgsql
as $$
declare
  v_oid oid;
  v_def text;
  v_new text;
begin
  select p.oid into v_oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = p_name limit 1;
  v_def := pg_get_functiondef(v_oid);
  if position(p_to in v_def) > 0 and position(p_from in v_def) = 0 then
    return;  -- schon angewendet
  end if;
  v_new := replace(v_def, p_from, p_to);
  if v_new = v_def then
    raise exception 'Patch für % nicht anwendbar: %', p_name, p_from;
  end if;
  execute v_new;
end;
$$;

select public._patch_fn('og_create', $a$p_kind not in ('rps', 'ludo', 'ships')$a$, $b$p_kind not in ('rps', 'ludo', 'ships', 'shooter')$b$);
select public._patch_fn('og_create', $a$(case when p_kind = 'ludo' then 3 else 1 end)$a$, $b$(case when p_kind in ('ludo', 'shooter') then 3 else 1 end)$b$);
select public._patch_fn('og_respond', $a$if not p_accept and g.kind <> 'ludo' then$a$, $b$if not p_accept and g.kind not in ('ludo', 'shooter') then$b$);
select public._patch_fn('og_respond', $a$elsif p_accept and g.kind <> 'ludo' then$a$, $b$elsif p_accept and g.kind not in ('ludo', 'shooter') then$b$);
-- Fix aus Update 99: Eine Einladung ablehnen warf „Spiel nicht gefunden" (die Ansicht für Abgelehnte ist absichtlich gesperrt) und wurde dadurch zurückgerollt.
select public._patch_fn('og_respond', E'  end if;\n  return public._og_view(p_id, v_me);', E'  end if;\n  if not p_accept then\n    return null;\n  end if;\n  return public._og_view(p_id, v_me);');
select public._patch_fn('og_leave', $a$if g.kind <> 'ludo' then update public.og_games set status = 'cancelled'$a$, $b$if g.kind not in ('ludo', 'shooter') then update public.og_games set status = 'cancelled'$b$);
select public._patch_fn('_og_start', $a$elsif g.kind = 'ludo' and v_n not between 2 and 4 then$a$, $b$elsif g.kind in ('ludo', 'shooter') and v_n not between 2 and 4 then$b$);
select public._patch_fn('_og_start', $a$when g.kind = 'ludo' then array(select generate_series(0, v_n - 1))$a$, $b$when g.kind in ('ludo', 'shooter') then array(select generate_series(0, v_n - 1))$b$);
select public._patch_fn('_og_start', E'  else\n    for i in 1..v_n loop\n      v_pieces := v_pieces',
$b$  elsif g.kind = 'shooter' then
    perform public._grant_koins(g.host_id, -public.setting('shooter_fee')::bigint, 'game_fee', p_id::text);
    v_state := jsonb_build_object('t0', (extract(epoch from now()) * 1000)::bigint, 'to_win', public.setting('shooter_to_win'),
                                  'minutes', public.setting('shooter_minutes'), 'scores', '{}'::jsonb);
    update public.og_games set status = 'running', state = v_state, turn_seat = null where id = p_id;
  else
    for i in 1..v_n loop
      v_pieces := v_pieces$b$);

drop function public._patch_fn(text, text, text);

-- Punktestand melden (Zwischenstand oder Ende). Jede zugesagte, sitzende Person darf melden; das Ende gilt nur einmal.
create or replace function public.og_shooter_report(p_id uuid, p_scores jsonb, p_final boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := public._og_check();
  g public.og_games;
  mp public.og_players;
  v_best integer := -1;
  v_win integer;
  v_tie boolean := false;
  r record;
begin
  select * into g from public.og_games where id = p_id for update;
  select * into mp from public.og_players where game_id = p_id and user_id = v_me;
  if g.id is null or g.kind <> 'shooter' or mp.seat is null then
    raise exception 'Spiel nicht gefunden.' using errcode = 'P0002';
  end if;
  if g.status <> 'running' then
    return public._og_view(p_id, v_me);
  end if;
  if jsonb_typeof(p_scores) <> 'object' then
    raise exception 'Ungültiger Spielstand.' using errcode = '22023';
  end if;
  -- nur Plätze der Mitspielenden übernehmen, Werte begrenzen
  update public.og_games
     set state = jsonb_set(state, '{scores}', coalesce((
           select jsonb_object_agg(s.seat::text, least(greatest(coalesce((p_scores ->> s.seat::text)::integer, 0), 0), 200))
             from public.og_players s where s.game_id = p_id and s.seat is not null), '{}'::jsonb)),
         updated_at = now()
   where id = p_id;
  if p_final then
    for r in select s.seat, coalesce((p_scores ->> s.seat::text)::integer, 0) as pts
               from public.og_players s where s.game_id = p_id and s.seat is not null order by 2 desc
    loop
      if r.pts > v_best then v_best := r.pts; v_win := r.seat; v_tie := false;
      elsif r.pts = v_best then v_tie := true; end if;
    end loop;
    perform public._og_finish(p_id, case when v_tie then null else v_win end);
  else
    perform public._og_bump(p_id);
  end if;
  return public._og_view(p_id, v_me);
end;
$$;

-- Laufendes Shooter-Spiel verlassen: Spiel endet, wenn weniger als 2 übrig sind
create or replace function public.og_shooter_leave(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := public._og_check();
  g public.og_games;
  v_left integer;
begin
  select * into g from public.og_games where id = p_id for update;
  if g.id is null or g.kind <> 'shooter' or not exists (select 1 from public.og_players where game_id = p_id and user_id = v_me) then
    raise exception 'Spiel nicht gefunden.' using errcode = 'P0002';
  end if;
  if g.status = 'running' then
    update public.og_players set join_state = 'left' where game_id = p_id and user_id = v_me;
    select count(*) into v_left from public.og_players where game_id = p_id and join_state = 'joined' and seat is not null;
    if v_left < 2 then
      perform public._og_finish(p_id, (select seat from public.og_players where game_id = p_id and join_state = 'joined' and seat is not null limit 1));
    else
      perform public._og_bump(p_id);
    end if;
  end if;
  return public._og_view(p_id, v_me);
end;
$$;

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('og_shooter_report', 'og_shooter_leave')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;
  -- die neu erzeugten Kopien der Spielfunktionen behalten ihre Rechte (create or replace)
end $$;
