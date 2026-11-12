-- 0095: 3D-Rennspiel als Online-Spiel (2–4 Personen). Lobby und Einladungen wie bei den anderen Spielen.
-- Die Fahrt selbst läuft in Echtzeit über die Spiel-Datenbanken (Broadcast); hier liegen Strecke, Runden, Zielzeiten und der Sieger.
-- Wiederholbar.

alter table public.og_games drop constraint if exists og_games_kind_check;
alter table public.og_games add constraint og_games_kind_check check (kind in ('rps', 'ludo', 'ships', 'shooter', 'chess', 'checkers', 'race'));

-- Bestehende Funktionen gezielt erweitern (nur, wenn noch nicht geschehen)
create or replace function public._patch_race(p_name text, p_from text, p_to text)
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
  v_def := replace(pg_get_functiondef(v_oid), chr(13), '');
  if position(p_to in v_def) > 0 then
    return;  -- schon angewendet
  end if;
  v_new := replace(v_def, p_from, p_to);
  if v_new = v_def then
    raise exception 'Patch für % nicht anwendbar: %', p_name, p_from;
  end if;
  execute v_new;
end;
$$;

select public._patch_race('og_create', $a$p_kind not in ('rps', 'ludo', 'ships', 'shooter', 'chess', 'checkers')$a$, $b$p_kind not in ('rps', 'ludo', 'ships', 'shooter', 'chess', 'checkers', 'race')$b$);
select public._patch_race('og_create', $a$(case when p_kind in ('ludo', 'shooter') then 3 else 1 end)$a$, $b$(case when p_kind in ('ludo', 'shooter', 'race') then 3 else 1 end)$b$);
select public._patch_race('og_respond', $a$if not p_accept and g.kind not in ('ludo', 'shooter') then$a$, $b$if not p_accept and g.kind not in ('ludo', 'shooter', 'race') then$b$);
select public._patch_race('og_respond', $a$elsif p_accept and g.kind not in ('ludo', 'shooter') then$a$, $b$elsif p_accept and g.kind not in ('ludo', 'shooter', 'race') then$b$);
select public._patch_race('og_leave', $a$if g.kind not in ('ludo', 'shooter') then update public.og_games set status = 'cancelled'$a$, $b$if g.kind not in ('ludo', 'shooter', 'race') then update public.og_games set status = 'cancelled'$b$);
select public._patch_race('_og_start', $a$elsif g.kind in ('ludo', 'shooter') and v_n not between 2 and 4 then$a$, $b$elsif g.kind in ('ludo', 'shooter', 'race') and v_n not between 2 and 4 then$b$);
select public._patch_race('_og_start', $a$when g.kind in ('ludo', 'shooter') then array(select generate_series(0, v_n - 1))$a$, $b$when g.kind in ('ludo', 'shooter', 'race') then array(select generate_series(0, v_n - 1))$b$);
select public._patch_race('_og_start', E'  elsif g.kind = ''shooter'' then',
$b$  elsif g.kind = 'race' then
    update public.og_games
       set status = 'running', turn_seat = null,
           state = jsonb_build_object('track', coalesce((state ->> 'track')::integer, 0), 'laps', coalesce((state ->> 'laps')::integer, 3),
                                      't0', (extract(epoch from now()) * 1000)::bigint, 'results', '{}'::jsonb)
     where id = p_id;
  elsif g.kind = 'shooter' then$b$);

drop function public._patch_race(text, text, text);

-- Der Gastgeber wählt in der Lobby Strecke (0–5) und Rundenzahl (1–10)
create or replace function public.og_race_set(p_id uuid, p_track integer, p_laps integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := public._og_check();
  g public.og_games;
begin
  select * into g from public.og_games where id = p_id for update;
  if g.id is null or g.kind <> 'race' or g.host_id <> v_me then
    raise exception 'Spiel nicht gefunden.' using errcode = 'P0002';
  end if;
  if g.status <> 'lobby' then
    return public._og_view(p_id, v_me);
  end if;
  update public.og_games
     set state = jsonb_build_object('track', least(greatest(coalesce(p_track, 0), 0), 5), 'laps', least(greatest(coalesce(p_laps, 3), 1), 10)),
         updated_at = now()
   where id = p_id;
  perform public._og_bump(p_id);
  return public._og_view(p_id, v_me);
end;
$$;

-- Eigene Zielzeit melden (Millisekunden). p_ms = null: prüfen, ob das Rennen wegen Zeitüberschreitung beendet werden kann
-- (60 Sekunden nach dem ersten Zieleinlauf). Das Ende gilt nur einmal; der Sieger ist die kleinste Zeit.
create or replace function public.og_race_report(p_id uuid, p_ms integer default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := public._og_check();
  g public.og_games;
  mp public.og_players;
  v_res jsonb;
  v_first bigint;
  v_n integer;
  v_done integer;
  v_win integer;
  v_best bigint;
  v_now bigint := (extract(epoch from now()) * 1000)::bigint;
begin
  select * into g from public.og_games where id = p_id for update;
  select * into mp from public.og_players where game_id = p_id and user_id = v_me;
  if g.id is null or g.kind <> 'race' or mp.seat is null then
    raise exception 'Spiel nicht gefunden.' using errcode = 'P0002';
  end if;
  if g.status <> 'running' then
    return public._og_view(p_id, v_me);
  end if;
  v_res := coalesce(g.state -> 'results', '{}'::jsonb);
  -- Eine Zielzeit: nicht schneller als 8 s, nicht schneller als seit dem Start möglich, nur einmal pro Person
  if p_ms is not null and not (v_res ? mp.seat::text)
     and p_ms >= 8000 and p_ms <= 3600000
     and (v_now - coalesce((g.state ->> 't0')::bigint, v_now)) >= p_ms - 5000 then
    v_res := v_res || jsonb_build_object(mp.seat::text, p_ms);
    update public.og_games
       set state = jsonb_set(jsonb_set(state, '{results}', v_res), '{first_at}', to_jsonb(coalesce((state ->> 'first_at')::bigint, v_now))),
           updated_at = now()
     where id = p_id;
    g.state := jsonb_set(jsonb_set(g.state, '{results}', v_res), '{first_at}', to_jsonb(coalesce((g.state ->> 'first_at')::bigint, v_now)));
  end if;
  v_first := (g.state ->> 'first_at')::bigint;
  select count(*) into v_n from public.og_players where game_id = p_id and join_state = 'joined' and seat is not null;
  select count(*) into v_done from public.og_players s where s.game_id = p_id and s.join_state = 'joined' and s.seat is not null and v_res ? s.seat::text;
  if v_done > 0 and (v_done >= v_n or (v_first is not null and v_now - v_first >= 60000)) then
    select s.seat, (v_res ->> s.seat::text)::bigint into v_win, v_best
      from public.og_players s where s.game_id = p_id and s.seat is not null and v_res ? s.seat::text
     order by (v_res ->> s.seat::text)::bigint limit 1;
    perform public._og_finish(p_id, v_win);
  else
    perform public._og_bump(p_id);
  end if;
  return public._og_view(p_id, v_me);
end;
$$;

-- Laufendes Rennen verlassen: endet, wenn weniger als 2 übrig sind
create or replace function public.og_race_leave(p_id uuid)
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
  if g.id is null or g.kind <> 'race' or not exists (select 1 from public.og_players where game_id = p_id and user_id = v_me) then
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
     where n.nspname = 'public' and p.proname in ('og_race_set', 'og_race_report', 'og_race_leave')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;
end $$;
