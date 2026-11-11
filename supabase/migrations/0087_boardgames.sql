-- 0087: Online-Schach und Online-Dame (2 Personen, ohne Uhr). Wiederholbar.
-- Die Regeln prüft der Client (reine, getestete Logik); der Server prüft Reihenfolge, Teilnahme und Größe
-- und beendet das Spiel bei Sieg/Remis/Aufgabe. Mods mit Recht „Spiele ansehen" sehen alle Partien.

alter table public.og_games drop constraint if exists og_games_kind_check;
alter table public.og_games add constraint og_games_kind_check check (kind in ('rps', 'ludo', 'ships', 'shooter', 'chess', 'checkers'));

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
  if v_oid is null then
    raise exception 'Funktion % nicht gefunden', p_name;
  end if;
  -- Windows-Zeilenenden (CRLF) entfernen, damit mehrzeilige Muster passen
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

select public._patch_fn('og_create', $a$p_kind not in ('rps', 'ludo', 'ships', 'shooter')$a$, $b$p_kind not in ('rps', 'ludo', 'ships', 'shooter', 'chess', 'checkers')$b$);
select public._patch_fn('_og_start', $a$g.kind in ('rps', 'ships') and v_n <> 2 then$a$, $b$g.kind in ('rps', 'ships', 'chess', 'checkers') and v_n <> 2 then$b$);
select public._patch_fn('_og_start', E'  elsif g.kind = ''shooter'' then',
$b$  elsif g.kind in ('chess', 'checkers') then
    update public.og_games set status = 'running', state = jsonb_build_object('moves', 0, 'draw_offer', null), turn_seat = 0 where id = p_id;
  elsif g.kind = 'shooter' then$b$);

drop function public._patch_fn(text, text, text);

-- Zug: der Client schickt den neuen Zustand und das Ergebnis (ongoing | win | draw)
create or replace function public.og_board_move(p_id uuid, p_state jsonb, p_result text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := public._og_check();
  g public.og_games;
  mp public.og_players;
begin
  select * into g from public.og_games where id = p_id for update;
  select * into mp from public.og_players where game_id = p_id and user_id = v_me;
  if g.id is null or g.kind not in ('chess', 'checkers') or mp.seat is null then
    raise exception 'Spiel nicht gefunden.' using errcode = 'P0002';
  end if;
  if g.status <> 'running' then
    raise exception 'Das Spiel läuft nicht mehr.' using errcode = '22023';
  end if;
  if g.turn_seat is distinct from mp.seat then
    raise exception 'Du bist nicht am Zug.' using errcode = '22023';
  end if;
  if p_result not in ('ongoing', 'win', 'draw') or jsonb_typeof(p_state) <> 'object' or length(p_state::text) > 6000 then
    raise exception 'Ungültiger Zug.' using errcode = '22023';
  end if;
  update public.og_games
     set state = (p_state - 'draw_offer') || jsonb_build_object('draw_offer', null, 'moves', coalesce((g.state ->> 'moves')::integer, 0) + 1),
         turn_seat = 1 - mp.seat, updated_at = now()
   where id = p_id;
  if p_result = 'win' then
    perform public._og_finish(p_id, mp.seat);
  elsif p_result = 'draw' then
    perform public._og_finish(p_id, null);
  else
    perform public._og_bump(p_id);
  end if;
  return public._og_view(p_id, v_me);
end;
$$;

create or replace function public.og_board_resign(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := public._og_check();
  g public.og_games;
  mp public.og_players;
begin
  select * into g from public.og_games where id = p_id for update;
  select * into mp from public.og_players where game_id = p_id and user_id = v_me;
  if g.id is null or g.kind not in ('chess', 'checkers') or mp.seat is null then
    raise exception 'Spiel nicht gefunden.' using errcode = 'P0002';
  end if;
  if g.status = 'running' then
    perform public._og_finish(p_id, 1 - mp.seat);
  end if;
  return public._og_view(p_id, v_me);
end;
$$;

-- Remis: offer | accept | decline
create or replace function public.og_board_draw(p_id uuid, p_action text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := public._og_check();
  g public.og_games;
  mp public.og_players;
  v_offer integer;
begin
  select * into g from public.og_games where id = p_id for update;
  select * into mp from public.og_players where game_id = p_id and user_id = v_me;
  if g.id is null or g.kind not in ('chess', 'checkers') or mp.seat is null or g.status <> 'running' then
    raise exception 'Spiel nicht gefunden.' using errcode = 'P0002';
  end if;
  v_offer := nullif(g.state ->> 'draw_offer', '')::integer;
  if p_action = 'offer' then
    update public.og_games set state = jsonb_set(state, '{draw_offer}', to_jsonb(mp.seat)) where id = p_id;
    perform public._og_bump(p_id);
  elsif p_action = 'accept' and v_offer is not null and v_offer <> mp.seat then
    perform public._og_finish(p_id, null);
  elsif p_action in ('decline', 'withdraw') then
    update public.og_games set state = jsonb_set(state, '{draw_offer}', 'null'::jsonb) where id = p_id;
    perform public._og_bump(p_id);
  else
    raise exception 'Ungültige Aktion.' using errcode = '22023';
  end if;
  return public._og_view(p_id, v_me);
end;
$$;

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('og_board_move', 'og_board_resign', 'og_board_draw')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;
end $$;
