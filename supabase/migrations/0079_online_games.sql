-- 0079: Online-Spiele gegeneinander (Schnick Schnack Schnuck, Mensch ärgere dich nicht, Schiffe versenken)
-- + Admin: Parkour-Rekorde löschen. Die Regeln laufen komplett auf dem Server (Würfel, Treffer, Gewinner), versteckte Infos
-- (Schiffe, geheime Auswahl) sieht nur die jeweilige Person. Die Echtzeit-Benachrichtigung („du bist dran") läuft im Browser über
-- die Spiel-Datenbanken (Broadcast), nicht über die Haupt-Datenbank. Wiederholbar.

-- Sperr-Schlüssel 'online'
create or replace function public._lock_keys()
returns text[]
language sql
immutable
set search_path = public
as $$
  select array['games', 'gambling', 'sprint', 'duels', 'chat', 'shop', 'quests', 'print',
               'parkour', 'learn', 'copy', 'cards', 'cram', 'test', 'practice', 'grammar', 'irregular', 'conjugate', 'gender',
               'books', 'search', 'math', 'memorize', 'homework', 'advent', 'ranking', 'stats', 'presence', 'websites', 'plus',
               'board', 'feedback', 'loot', 'online'];
$$;
alter table public.feature_locks drop constraint if exists feature_locks_key_check;
alter table public.feature_locks add constraint feature_locks_key_check check (key = any (public._lock_keys()));

-- ---------------------------------------------------------------------------------------------
-- Admin: Parkour-Rekorde löschen (Deathrun: Rekord einer Person; Team: Rekord eines Teams; ohne Namen: alle)
-- ---------------------------------------------------------------------------------------------
create or replace function public.admin_parkour_delete(p_kind text, p_name text default null, p_name2 text default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_a uuid;
  v_b uuid;
  v_n integer;
begin
  perform public._require_admin();
  if p_kind not in ('deathrun', 'team') then
    raise exception 'Unbekannte Art.' using errcode = '22023';
  end if;
  if p_name is not null then
    select id into v_a from public.profiles where lower(display_name) = lower(p_name);
    if v_a is null then raise exception 'Person nicht gefunden.' using errcode = 'P0002'; end if;
  end if;
  if p_kind = 'deathrun' then
    delete from public.deathrun_results where v_a is null or user_id = v_a;
  else
    if p_name2 is not null then
      select id into v_b from public.profiles where lower(display_name) = lower(p_name2);
    end if;
    update public.team_runs set levels = null
     where kind = 'parkour' and levels is not null
       and (v_a is null or (host_id = v_a and (v_b is null or partner_id = v_b)) or (partner_id = v_a and (v_b is null or host_id = v_b)));
  end if;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Tabellen
-- ---------------------------------------------------------------------------------------------
create table if not exists public.og_games (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('rps', 'ludo', 'ships')),
  host_id uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'lobby' check (status in ('lobby', 'running', 'finished', 'cancelled')),
  state jsonb not null default '{}'::jsonb,
  turn_seat integer,
  winner_seat integer,
  version integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.og_players (
  game_id uuid not null references public.og_games (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  seat integer,
  join_state text not null default 'invited' check (join_state in ('invited', 'joined', 'declined', 'left')),
  secret jsonb not null default '{}'::jsonb,
  primary key (game_id, user_id)
);
create index if not exists og_players_user_idx on public.og_players (user_id);
alter table public.og_games enable row level security;
alter table public.og_players enable row level security;
revoke all on public.og_games, public.og_players from anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- Mensch ärgere dich nicht: Regeln
-- Feld einer Figur (relativ zum eigenen Start): -1 = im Haus, 0..39 = Rundweg, 40..43 = Zielfelder.
-- Brett-Platz (Seat) 0..3, Start jeweils um 10 Felder versetzt.
-- ---------------------------------------------------------------------------------------------
create or replace function public._ludo_pcs(p_state jsonb, p_seat integer)
returns integer[]
language sql
immutable
set search_path = public
as $$
  select array(select e::integer from jsonb_array_elements_text(p_state -> 'pieces' -> p_seat::text) with ordinality t (e, n) order by n);
$$;

create or replace function public._ludo_target(p_pcs integer[], p_i integer, p_d integer)
returns integer
language plpgsql
immutable
set search_path = public
as $$
declare
  p integer := p_pcs[p_i + 1];
  t integer;
  j integer;
begin
  if p = -1 then
    if p_d <> 6 then return null; end if;
    t := 0;
  else
    t := p + p_d;
    if t > 43 then return null; end if;
  end if;
  for j in 1..4 loop
    if j <> p_i + 1 and p_pcs[j] = t then return null; end if;
  end loop;
  return t;
end;
$$;

create or replace function public._ludo_legal(p_state jsonb, p_seat integer, p_d integer)
returns integer[]
language plpgsql
immutable
set search_path = public
as $$
declare
  v_pcs integer[] := public._ludo_pcs(p_state, p_seat);
  v_out integer[] := '{}';
  i integer;
  v_house integer[] := '{}';
  v_on_start integer := null;
begin
  for i in 0..3 loop
    if v_pcs[i + 1] = -1 then v_house := v_house || i; end if;
    if v_pcs[i + 1] = 0 then v_on_start := i; end if;
  end loop;
  if p_d = 6 and array_length(v_house, 1) > 0 then
    if v_on_start is null then
      return v_house; -- Sechs: man muss eine Figur ins Spiel bringen
    elsif public._ludo_target(v_pcs, v_on_start, p_d) is not null then
      return array[v_on_start]; -- Startfeld frei machen
    end if;
  end if;
  for i in 0..3 loop
    if public._ludo_target(v_pcs, i, p_d) is not null then v_out := v_out || i; end if;
  end loop;
  return v_out;
end;
$$;

-- nächster Platz am Zug (überspringt ausgestiegene)
create or replace function public._ludo_next(p_state jsonb, p_seat integer)
returns integer
language plpgsql
immutable
set search_path = public
as $$
declare
  v_seats integer[] := array(select e::integer from jsonb_array_elements_text(p_state -> 'seats') e order by e::integer);
  v_out integer[] := array(select e::integer from jsonb_array_elements_text(coalesce(p_state -> 'out', '[]'::jsonb)) e);
  v_n integer := array_length(v_seats, 1);
  v_idx integer;
  k integer;
  s integer;
begin
  select i into v_idx from generate_subscripts(v_seats, 1) i where v_seats[i] = p_seat;
  for k in 1..v_n loop
    s := v_seats[((v_idx - 1 + k) % v_n) + 1];
    if not (s = any (v_out)) then return s; end if;
  end loop;
  return p_seat;
end;
$$;

-- hat die Person nur Figuren im Haus/Ziel (dann gibt es 3 Würfe)?
create or replace function public._ludo_idle(p_state jsonb, p_seat integer)
returns boolean
language sql
immutable
set search_path = public
as $$
  select bool_and(p = -1 or p >= 40) and bool_or(p = -1) from unnest(public._ludo_pcs(p_state, p_seat)) p;
$$;

-- Zug ausführen: gibt neuen Zustand zurück; 'winner' (Platz) wird gesetzt, wenn jemand fertig ist.
create or replace function public._ludo_move(p_state jsonb, p_seat integer, p_piece integer, p_d integer)
returns jsonb
language plpgsql
immutable
set search_path = public
as $$
declare
  v_pcs integer[] := public._ludo_pcs(p_state, p_seat);
  v_from integer := v_pcs[p_piece + 1];
  v_to integer := public._ludo_target(v_pcs, p_piece, p_d);
  v_state jsonb := p_state;
  v_abs integer;
  v_caps jsonb := '[]'::jsonb;
  s integer;
  j integer;
  v_o integer[];
  v_next integer;
begin
  v_pcs[p_piece + 1] := v_to;
  v_state := jsonb_set(v_state, array['pieces', p_seat::text], to_jsonb(v_pcs));
  if v_to between 0 and 39 then
    v_abs := (v_to + p_seat * 10) % 40;
    for s in select e::integer from jsonb_array_elements_text(v_state -> 'seats') e loop
      continue when s = p_seat;
      v_o := public._ludo_pcs(v_state, s);
      for j in 0..3 loop
        if v_o[j + 1] between 0 and 39 and (v_o[j + 1] + s * 10) % 40 = v_abs then
          v_o[j + 1] := -1;
          v_caps := v_caps || jsonb_build_object('seat', s, 'piece', j);
        end if;
      end loop;
      v_state := jsonb_set(v_state, array['pieces', s::text], to_jsonb(v_o));
    end loop;
  end if;
  v_state := v_state - 'dice';
  if (select bool_and(p >= 40) from unnest(v_pcs) p) then
    v_state := jsonb_set(v_state, '{winner}', to_jsonb(p_seat));
    v_next := p_seat;
  elsif p_d = 6 then
    v_next := p_seat;
  else
    v_next := public._ludo_next(v_state, p_seat);
  end if;
  v_state := jsonb_set(v_state, '{tries}', to_jsonb(case when public._ludo_idle(v_state, v_next) then 3 else 1 end));
  v_state := jsonb_set(v_state, '{last}', jsonb_build_object('seat', p_seat, 'dice', p_d, 'piece', p_piece, 'from', v_from, 'to', v_to, 'caps', v_caps));
  return jsonb_set(v_state, '{turn}', to_jsonb(v_next));
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Hilfen
-- ---------------------------------------------------------------------------------------------
create or replace function public._og_check()
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_me uuid := (select auth.uid());
begin
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht erlaubt.' using errcode = '42501';
  end if;
  return v_me;
end;
$$;

-- Ansicht eines Spiels für mich (ohne fremde Geheimnisse)
create or replace function public._og_view(p_id uuid, p_me uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  g public.og_games;
  mp public.og_players;
  v_players jsonb;
  v_mine jsonb := '{}'::jsonb;
  v_state jsonb;
  v_opp public.og_players;
begin
  select * into g from public.og_games where id = p_id;
  select * into mp from public.og_players where game_id = p_id and user_id = p_me;
  if g.id is null or mp.user_id is null or mp.join_state in ('declined') then
    raise exception 'Spiel nicht gefunden.' using errcode = 'P0002';
  end if;
  v_state := g.state;
  select coalesce(jsonb_agg(jsonb_build_object('user_id', p.user_id, 'name', pr.display_name, 'seat', p.seat, 'join_state', p.join_state,
                                               'avatar_id', pr.avatar_id, 'color_id', pr.color_id) order by coalesce(p.seat, 9), pr.display_name), '[]'::jsonb)
    into v_players
    from public.og_players p join public.profiles pr on pr.id = p.user_id where p.game_id = p_id;

  if g.kind = 'rps' then
    select * into v_opp from public.og_players where game_id = p_id and user_id <> p_me and seat is not null limit 1;
    v_mine := jsonb_build_object('pick', mp.secret -> 'pick', 'opp_picked', coalesce(v_opp.secret ? 'pick', false));
  elsif g.kind = 'ships' then
    select * into v_opp from public.og_players where game_id = p_id and user_id <> p_me and seat is not null limit 1;
    v_mine := jsonb_build_object('ships', mp.secret -> 'ships', 'placed', mp.secret ? 'ships', 'opp_placed', coalesce(v_opp.secret ? 'ships', false));
    if g.status = 'finished' then
      v_mine := v_mine || jsonb_build_object('opp_ships', v_opp.secret -> 'ships');
    end if;
  elsif g.kind = 'ludo' then
    if g.status = 'running' and g.turn_seat = mp.seat and v_state ? 'dice' then
      v_mine := jsonb_build_object('legal', to_jsonb(public._ludo_legal(v_state, mp.seat, (v_state ->> 'dice')::integer)));
    end if;
  end if;

  return jsonb_build_object('id', g.id, 'kind', g.kind, 'status', g.status, 'version', g.version, 'host_id', g.host_id,
                            'me', jsonb_build_object('user_id', p_me, 'seat', mp.seat, 'join_state', mp.join_state),
                            'turn_seat', g.turn_seat, 'winner_seat', g.winner_seat, 'state', v_state, 'players', v_players, 'mine', v_mine);
end;
$$;

create or replace function public._og_bump(p_id uuid)
returns void
language sql
security definer
set search_path = public
as $$ update public.og_games set version = version + 1, updated_at = now() where id = p_id; $$;

-- Spiel starten (alle zugesagten Personen): Plätze vergeben und Anfangszustand setzen
create or replace function public._og_start(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  g public.og_games;
  v_users uuid[];
  v_n integer;
  v_seats integer[];
  i integer;
  v_state jsonb;
  v_pieces jsonb := '{}'::jsonb;
begin
  select * into g from public.og_games where id = p_id for update;
  select array_agg(user_id order by (user_id = g.host_id) desc, user_id) into v_users from public.og_players where game_id = p_id and join_state = 'joined';
  v_n := coalesce(array_length(v_users, 1), 0);
  if g.kind in ('rps', 'ships') and v_n <> 2 then
    raise exception 'Für dieses Spiel braucht es genau zwei Personen.' using errcode = '22023';
  elsif g.kind = 'ludo' and v_n not between 2 and 4 then
    raise exception 'Mensch ärgere dich nicht: 2 bis 4 Personen.' using errcode = '22023';
  end if;
  update public.og_players set join_state = 'declined' where game_id = p_id and join_state = 'invited';
  v_seats := case when g.kind = 'ludo' and v_n = 2 then array[0, 2] when g.kind = 'ludo' then array(select generate_series(0, v_n - 1)) else array[0, 1] end;
  for i in 1..v_n loop
    update public.og_players set seat = v_seats[i] where game_id = p_id and user_id = v_users[i];
  end loop;
  if g.kind = 'rps' then
    v_state := jsonb_build_object('to_win', 2, 'score', jsonb_build_object('0', 0, '1', 0), 'rounds', '[]'::jsonb);
    update public.og_games set status = 'running', state = v_state, turn_seat = null where id = p_id;
  elsif g.kind = 'ships' then
    v_state := jsonb_build_object('phase', 'placing', 'shots', jsonb_build_object('0', '[]'::jsonb, '1', '[]'::jsonb));
    update public.og_games set status = 'running', state = v_state, turn_seat = null where id = p_id;
  else
    for i in 1..v_n loop
      v_pieces := v_pieces || jsonb_build_object(v_seats[i]::text, jsonb_build_array(-1, -1, -1, -1));
    end loop;
    v_state := jsonb_build_object('seats', to_jsonb(v_seats), 'pieces', v_pieces, 'turn', v_seats[1], 'tries', 3, 'out', '[]'::jsonb);
    update public.og_games set status = 'running', state = v_state, turn_seat = v_seats[1] where id = p_id;
  end if;
  perform public._og_bump(p_id);
end;
$$;

create or replace function public._og_finish(p_id uuid, p_winner integer)
returns void
language sql
security definer
set search_path = public
as $$ update public.og_games set status = 'finished', winner_seat = p_winner, turn_seat = null, updated_at = now(), version = version + 1 where id = p_id; $$;

-- ---------------------------------------------------------------------------------------------
-- Öffentliche Funktionen
-- ---------------------------------------------------------------------------------------------
create or replace function public.og_create(p_kind text, p_opponents uuid[])
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := public._og_check();
  v_id uuid;
  v_ids uuid[];
  u uuid;
begin
  perform public._feature_guard('online');
  if p_kind not in ('rps', 'ludo', 'ships') then
    raise exception 'Unbekanntes Spiel.' using errcode = '22023';
  end if;
  select array_agg(distinct x) into v_ids from unnest(coalesce(p_opponents, '{}')) x where x <> v_me;
  if coalesce(array_length(v_ids, 1), 0) < 1 or array_length(v_ids, 1) > (case when p_kind = 'ludo' then 3 else 1 end) then
    raise exception 'Falsche Anzahl Mitspieler.' using errcode = '22023';
  end if;
  if (select count(*) from public.profiles where id = any (v_ids) and not blocked) <> array_length(v_ids, 1) then
    raise exception 'Person nicht gefunden.' using errcode = 'P0002';
  end if;
  -- Aufräumen: alte Spiele
  update public.og_games set status = 'cancelled' where status in ('lobby', 'running') and updated_at < now() - interval '2 days';
  delete from public.og_games where status in ('finished', 'cancelled') and updated_at < now() - interval '14 days';
  if (select count(*) from public.og_players p join public.og_games g on g.id = p.game_id
       where p.user_id = v_me and p.join_state = 'joined' and g.status in ('lobby', 'running')) >= 12 then
    raise exception 'Du hast schon viele offene Spiele. Beende zuerst ein paar.' using errcode = '54000';
  end if;
  insert into public.og_games (kind, host_id) values (p_kind, v_me) returning id into v_id;
  insert into public.og_players (game_id, user_id, join_state) values (v_id, v_me, 'joined');
  foreach u in array v_ids loop
    insert into public.og_players (game_id, user_id, join_state) values (v_id, u, 'invited');
  end loop;
  return v_id;
end;
$$;

create or replace function public.og_list()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_me uuid := public._og_check();
begin
  return coalesce((
    select jsonb_agg(x.j order by x.upd desc) from (
      select g.updated_at as upd,
             jsonb_build_object('id', g.id, 'kind', g.kind, 'status', g.status, 'my_state', mp.join_state, 'host', hp.display_name,
                                'host_id', g.host_id,
                                'my_turn', (g.status = 'running' and g.turn_seat is not null and g.turn_seat = mp.seat)
                                           or (g.status = 'running' and g.kind = 'rps' and not (mp.secret ? 'pick'))
                                           or (g.status = 'running' and g.kind = 'ships' and g.state ->> 'phase' = 'placing' and not (mp.secret ? 'ships')),
                                'winner_me', (g.status = 'finished' and g.winner_seat = mp.seat),
                                'names', (select jsonb_agg(pr.display_name order by coalesce(p.seat, 9), pr.display_name)
                                            from public.og_players p join public.profiles pr on pr.id = p.user_id
                                           where p.game_id = g.id and p.join_state in ('joined', 'invited')),
                                'updated_at', g.updated_at) as j
        from public.og_players mp
        join public.og_games g on g.id = mp.game_id
        join public.profiles hp on hp.id = g.host_id
       where mp.user_id = v_me and mp.join_state in ('invited', 'joined')
         and (g.status in ('lobby', 'running') or (g.status = 'finished' and g.updated_at > now() - interval '1 day'))
         and g.updated_at > now() - interval '2 days'
    ) x), '[]'::jsonb);
end;
$$;

create or replace function public.og_get(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  return public._og_view(p_id, public._og_check());
end;
$$;

create or replace function public.og_respond(p_id uuid, p_accept boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := public._og_check();
  g public.og_games;
begin
  perform public._feature_guard('online');
  select * into g from public.og_games where id = p_id for update;
  if g.id is null or g.status <> 'lobby' or not exists (select 1 from public.og_players where game_id = p_id and user_id = v_me and join_state = 'invited') then
    raise exception 'Einladung nicht mehr gültig.' using errcode = 'P0002';
  end if;
  update public.og_players set join_state = case when p_accept then 'joined' else 'declined' end where game_id = p_id and user_id = v_me;
  if not p_accept and g.kind <> 'ludo' then
    update public.og_games set status = 'cancelled', updated_at = now(), version = version + 1 where id = p_id;
  elsif p_accept and g.kind <> 'ludo' then
    perform public._og_start(p_id);
  else
    perform public._og_bump(p_id);
  end if;
  return public._og_view(p_id, v_me);
end;
$$;

create or replace function public.og_start(p_id uuid)
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
  if g.id is null or g.host_id <> v_me or g.status <> 'lobby' then
    raise exception 'Das Spiel kann nicht gestartet werden.' using errcode = '22023';
  end if;
  perform public._og_start(p_id);
  return public._og_view(p_id, v_me);
end;
$$;

-- Aufgeben / verlassen
create or replace function public.og_leave(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := public._og_check();
  g public.og_games;
  mp public.og_players;
  v_out jsonb;
  v_rest integer[];
begin
  select * into g from public.og_games where id = p_id for update;
  select * into mp from public.og_players where game_id = p_id and user_id = v_me;
  if g.id is null or mp.user_id is null then
    raise exception 'Spiel nicht gefunden.' using errcode = 'P0002';
  end if;
  if g.status = 'lobby' then
    if g.host_id = v_me then
      update public.og_games set status = 'cancelled', updated_at = now(), version = version + 1 where id = p_id;
    else
      update public.og_players set join_state = 'left' where game_id = p_id and user_id = v_me;
      if g.kind <> 'ludo' then update public.og_games set status = 'cancelled', updated_at = now(), version = version + 1 where id = p_id;
      else perform public._og_bump(p_id); end if;
    end if;
  elsif g.status = 'running' then
    update public.og_players set join_state = 'left' where game_id = p_id and user_id = v_me;
    if g.kind = 'ludo' then
      v_out := coalesce(g.state -> 'out', '[]'::jsonb) || to_jsonb(mp.seat);
      select array_agg(e::integer) into v_rest from jsonb_array_elements_text(g.state -> 'seats') e where not (e::integer in (select x::integer from jsonb_array_elements_text(v_out) x));
      update public.og_games set state = jsonb_set(g.state, '{out}', v_out) where id = p_id;
      if coalesce(array_length(v_rest, 1), 0) <= 1 then
        perform public._og_finish(p_id, v_rest[1]);
      else
        if g.turn_seat = mp.seat then
          update public.og_games set turn_seat = public._ludo_next(jsonb_set(g.state, '{out}', v_out), mp.seat),
                 state = jsonb_set(jsonb_set(jsonb_set(g.state, '{out}', v_out), '{turn}', to_jsonb(public._ludo_next(jsonb_set(g.state, '{out}', v_out), mp.seat))), '{dice}', 'null'::jsonb) - 'dice'
           where id = p_id;
        end if;
        perform public._og_bump(p_id);
      end if;
    else
      perform public._og_finish(p_id, (select seat from public.og_players where game_id = p_id and user_id <> v_me and seat is not null limit 1));
    end if;
  end if;
  return public._og_view(p_id, v_me);
end;
$$;

-- Schnick Schnack Schnuck
create or replace function public.og_rps_pick(p_id uuid, p_pick text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := public._og_check();
  g public.og_games;
  a public.og_players;
  b public.og_players;
  v_w integer;
  v_score jsonb;
  v_rounds jsonb;
begin
  if p_pick not in ('rock', 'paper', 'scissors') then
    raise exception 'Unbekannte Auswahl.' using errcode = '22023';
  end if;
  select * into g from public.og_games where id = p_id for update;
  if g.id is null or g.kind <> 'rps' or g.status <> 'running' then
    raise exception 'Das Spiel läuft nicht.' using errcode = '22023';
  end if;
  select * into a from public.og_players where game_id = p_id and seat = 0;
  select * into b from public.og_players where game_id = p_id and seat = 1;
  if v_me not in (a.user_id, b.user_id) then
    raise exception 'Du spielst hier nicht mit.' using errcode = '42501';
  end if;
  if (select secret ? 'pick' from public.og_players where game_id = p_id and user_id = v_me) then
    raise exception 'Du hast schon gewählt.' using errcode = '23505';
  end if;
  update public.og_players set secret = secret || jsonb_build_object('pick', p_pick) where game_id = p_id and user_id = v_me;
  select * into a from public.og_players where game_id = p_id and seat = 0;
  select * into b from public.og_players where game_id = p_id and seat = 1;
  if a.secret ? 'pick' and b.secret ? 'pick' then
    v_w := case when a.secret ->> 'pick' = b.secret ->> 'pick' then null
                when (a.secret ->> 'pick', b.secret ->> 'pick') in (('rock', 'scissors'), ('scissors', 'paper'), ('paper', 'rock')) then 0
                else 1 end;
    v_score := g.state -> 'score';
    if v_w is not null then
      v_score := jsonb_set(v_score, array[v_w::text], to_jsonb((v_score ->> v_w::text)::integer + 1));
    end if;
    v_rounds := (g.state -> 'rounds') || jsonb_build_object('a', a.secret ->> 'pick', 'b', b.secret ->> 'pick', 'w', v_w);
    update public.og_players set secret = secret - 'pick' where game_id = p_id;
    update public.og_games set state = jsonb_set(jsonb_set(g.state, '{score}', v_score), '{rounds}', v_rounds) where id = p_id;
    if (v_score ->> '0')::integer >= (g.state ->> 'to_win')::integer then
      perform public._og_finish(p_id, 0);
    elsif (v_score ->> '1')::integer >= (g.state ->> 'to_win')::integer then
      perform public._og_finish(p_id, 1);
    else
      perform public._og_bump(p_id);
    end if;
  else
    perform public._og_bump(p_id);
  end if;
  return public._og_view(p_id, v_me);
end;
$$;

-- Mensch ärgere dich nicht: würfeln
create or replace function public.og_ludo_roll(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := public._og_check();
  g public.og_games;
  mp public.og_players;
  v_d integer := 1 + floor(random() * 6)::integer;
  v_state jsonb;
  v_tries integer;
  v_next integer;
begin
  select * into g from public.og_games where id = p_id for update;
  select * into mp from public.og_players where game_id = p_id and user_id = v_me;
  if g.id is null or g.kind <> 'ludo' or g.status <> 'running' or mp.seat is distinct from g.turn_seat then
    raise exception 'Du bist nicht dran.' using errcode = '22023';
  end if;
  v_state := g.state;
  if v_state ? 'dice' then
    raise exception 'Du hast schon gewürfelt. Wähle eine Figur.' using errcode = '22023';
  end if;
  if cardinality(public._ludo_legal(v_state, mp.seat, v_d)) > 0 then
    v_state := jsonb_set(v_state, '{dice}', to_jsonb(v_d));
    v_state := jsonb_set(v_state, '{last}', jsonb_build_object('seat', mp.seat, 'dice', v_d, 'rolled', true));
    update public.og_games set state = v_state where id = p_id;
  else
    v_tries := coalesce((v_state ->> 'tries')::integer, 1);
    if v_tries > 1 then
      v_state := jsonb_set(v_state, '{tries}', to_jsonb(v_tries - 1));
      v_state := jsonb_set(v_state, '{last}', jsonb_build_object('seat', mp.seat, 'dice', v_d, 'nomove', true, 'again', true));
    else
      v_next := public._ludo_next(v_state, mp.seat);
      v_state := jsonb_set(v_state, '{turn}', to_jsonb(v_next));
      v_state := jsonb_set(v_state, '{tries}', to_jsonb(case when public._ludo_idle(v_state, v_next) then 3 else 1 end));
      v_state := jsonb_set(v_state, '{last}', jsonb_build_object('seat', mp.seat, 'dice', v_d, 'nomove', true));
      update public.og_games set turn_seat = v_next where id = p_id;
    end if;
    update public.og_games set state = v_state where id = p_id;
  end if;
  perform public._og_bump(p_id);
  return public._og_view(p_id, v_me);
end;
$$;

create or replace function public.og_ludo_move(p_id uuid, p_piece integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := public._og_check();
  g public.og_games;
  mp public.og_players;
  v_d integer;
  v_state jsonb;
begin
  select * into g from public.og_games where id = p_id for update;
  select * into mp from public.og_players where game_id = p_id and user_id = v_me;
  if g.id is null or g.kind <> 'ludo' or g.status <> 'running' or mp.seat is distinct from g.turn_seat or not (g.state ? 'dice') then
    raise exception 'Du kannst gerade nicht ziehen.' using errcode = '22023';
  end if;
  v_d := (g.state ->> 'dice')::integer;
  if p_piece is null or not (p_piece = any (public._ludo_legal(g.state, mp.seat, v_d))) then
    raise exception 'Mit dieser Figur geht das nicht.' using errcode = '22023';
  end if;
  v_state := public._ludo_move(g.state, mp.seat, p_piece, v_d);
  update public.og_games set state = v_state, turn_seat = (v_state ->> 'turn')::integer where id = p_id;
  if v_state ? 'winner' then
    perform public._og_finish(p_id, (v_state ->> 'winner')::integer);
  else
    perform public._og_bump(p_id);
  end if;
  return public._og_view(p_id, v_me);
end;
$$;

-- Schiffe versenken: Schiffe setzen. p_ships: [{"len":5,"r":0,"c":0,"h":true}, …] (Längen 5,4,3,3,2)
create or replace function public.og_ships_place(p_id uuid, p_ships jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := public._og_check();
  g public.og_games;
  s jsonb;
  k integer;
  v_cells integer[] := '{}';
  v_len integer;
  v_r integer;
  v_c integer;
  v_h boolean;
  v_lens integer[] := '{}';
  v_idx integer;
  v_norm jsonb := '[]'::jsonb;
begin
  select * into g from public.og_games where id = p_id for update;
  if g.id is null or g.kind <> 'ships' or g.status <> 'running' or g.state ->> 'phase' <> 'placing' then
    raise exception 'Du kannst gerade keine Schiffe setzen.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.og_players where game_id = p_id and user_id = v_me and seat is not null) then
    raise exception 'Du spielst hier nicht mit.' using errcode = '42501';
  end if;
  if (select secret ? 'ships' from public.og_players where game_id = p_id and user_id = v_me) then
    raise exception 'Du hast deine Schiffe schon gesetzt.' using errcode = '23505';
  end if;
  if jsonb_typeof(p_ships) <> 'array' or jsonb_array_length(p_ships) <> 5 then
    raise exception 'Es braucht genau 5 Schiffe.' using errcode = '22023';
  end if;
  for s in select * from jsonb_array_elements(p_ships) loop
    v_len := (s ->> 'len')::integer;
    v_r := (s ->> 'r')::integer;
    v_c := (s ->> 'c')::integer;
    v_h := (s ->> 'h')::boolean;
    if v_len is null or v_r is null or v_c is null or v_h is null or v_r not between 0 and 9 or v_c not between 0 and 9
       or (v_h and v_c + v_len > 10) or (not v_h and v_r + v_len > 10) then
      raise exception 'Ein Schiff liegt außerhalb des Feldes.' using errcode = '22023';
    end if;
    v_lens := v_lens || v_len;
    for k in 0..v_len - 1 loop
      v_idx := case when v_h then v_r * 10 + v_c + k else (v_r + k) * 10 + v_c end;
      if v_idx = any (v_cells) then
        raise exception 'Schiffe dürfen sich nicht überlappen.' using errcode = '22023';
      end if;
      v_cells := v_cells || v_idx;
    end loop;
    v_norm := v_norm || jsonb_build_object('len', v_len, 'r', v_r, 'c', v_c, 'h', v_h);
  end loop;
  if (select array_agg(x order by x) from unnest(v_lens) x) <> array[2, 3, 3, 4, 5] then
    raise exception 'Die Schiffe müssen die Längen 5, 4, 3, 3 und 2 haben.' using errcode = '22023';
  end if;
  update public.og_players set secret = secret || jsonb_build_object('ships', v_norm) where game_id = p_id and user_id = v_me;
  if (select count(*) from public.og_players where game_id = p_id and seat is not null and secret ? 'ships') = 2 then
    update public.og_games set state = jsonb_set(g.state, '{phase}', '"running"'), turn_seat = floor(random() * 2)::integer where id = p_id;
  end if;
  perform public._og_bump(p_id);
  return public._og_view(p_id, v_me);
end;
$$;

-- alle Felder eines Schiffs
create or replace function public._ships_cells(p_ship jsonb)
returns integer[]
language sql
immutable
set search_path = public
as $$
  select array(select case when (p_ship ->> 'h')::boolean then (p_ship ->> 'r')::integer * 10 + (p_ship ->> 'c')::integer + k
                           else ((p_ship ->> 'r')::integer + k) * 10 + (p_ship ->> 'c')::integer end
                 from generate_series(0, (p_ship ->> 'len')::integer - 1) k);
$$;

-- Schiffe versenken: schießen. Bei Treffer darf man nochmal.
create or replace function public.og_ships_shoot(p_id uuid, p_r integer, p_c integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := public._og_check();
  g public.og_games;
  mp public.og_players;
  op public.og_players;
  v_idx integer := p_r * 10 + p_c;
  v_mine jsonb;
  v_ship jsonb;
  v_hit boolean := false;
  v_sunk jsonb := null;
  v_res text := 'miss';
  v_all integer[];
  v_hits integer[];
  v_total integer;
begin
  select * into g from public.og_games where id = p_id for update;
  select * into mp from public.og_players where game_id = p_id and user_id = v_me;
  if g.id is null or g.kind <> 'ships' or g.status <> 'running' or g.state ->> 'phase' <> 'running' or mp.seat is distinct from g.turn_seat then
    raise exception 'Du bist nicht dran.' using errcode = '22023';
  end if;
  if p_r not between 0 and 9 or p_c not between 0 and 9 then
    raise exception 'Das Feld gibt es nicht.' using errcode = '22023';
  end if;
  v_mine := g.state -> 'shots' -> mp.seat::text;
  if exists (select 1 from jsonb_array_elements(v_mine) x where (x ->> 'r')::integer = p_r and (x ->> 'c')::integer = p_c) then
    raise exception 'Dort hast du schon geschossen.' using errcode = '23505';
  end if;
  select * into op from public.og_players where game_id = p_id and seat is not null and user_id <> v_me;
  for v_ship in select * from jsonb_array_elements(op.secret -> 'ships') loop
    if v_idx = any (public._ships_cells(v_ship)) then
      v_hit := true;
      v_all := public._ships_cells(v_ship);
      select coalesce(array_agg((x ->> 'r')::integer * 10 + (x ->> 'c')::integer), '{}') into v_hits
        from jsonb_array_elements(v_mine) x where x ->> 'res' <> 'miss';
      v_hits := v_hits || v_idx;
      if v_all <@ v_hits then
        v_sunk := jsonb_build_object('len', (v_ship ->> 'len')::integer, 'r', (v_ship ->> 'r')::integer, 'c', (v_ship ->> 'c')::integer, 'h', (v_ship ->> 'h')::boolean);
        v_res := 'sunk';
      else
        v_res := 'hit';
      end if;
      exit;
    end if;
  end loop;
  v_mine := (g.state -> 'shots' -> mp.seat::text) || jsonb_build_array(
    case when v_sunk is null then jsonb_build_object('r', p_r, 'c', p_c, 'res', v_res)
         else jsonb_build_object('r', p_r, 'c', p_c, 'res', v_res, 'sunk', v_sunk) end);
  update public.og_games set state = jsonb_set(g.state, array['shots', mp.seat::text], v_mine) where id = p_id;
  -- gewonnen?
  select coalesce(sum(array_length(public._ships_cells(sh), 1)), 0) into v_total from jsonb_array_elements(op.secret -> 'ships') sh;
  if (select count(*) from jsonb_array_elements(v_mine) x where x ->> 'res' <> 'miss') >= v_total then
    perform public._og_finish(p_id, mp.seat);
  else
    if not v_hit then
      update public.og_games set turn_seat = op.seat where id = p_id;
    end if;
    perform public._og_bump(p_id);
  end if;
  return public._og_view(p_id, v_me);
end;
$$;

-- Meldung bei der Fortschritts-Abfrage: Einladungen zu Spielen
create or replace function public.watch_progress()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  v_claim jsonb;
  v_rows jsonb;
  v_rank bigint;
  v_pts bigint;
  v_inv jsonb;
begin
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht erlaubt.' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', q.id, 'family', q.family, 'stage', q.stage, 'reward', q.reward) order by q.id), '[]'::jsonb)
    into v_claim from public.get_quests() q where q.progress >= q.goal and not q.claimed;

  create temporary table if not exists _wp_tmp (rank bigint, display_name text, points bigint, is_me boolean, avatar_id text, color_id text) on commit drop;
  delete from _wp_tmp where true;
  insert into _wp_tmp select l.rank, l.display_name, l.points, l.is_me, l.avatar_id, l.color_id from public.get_leaderboard('week') l;
  select t.rank, t.points into v_rank, v_pts from _wp_tmp t where t.is_me;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.rank, x.display_name), '[]'::jsonb) into v_rows
    from (select * from _wp_tmp t where v_rank is null and t.rank <= 6 or v_rank is not null and t.rank between v_rank - 4 and v_rank + 4) x;
  select coalesce(jsonb_agg(jsonb_build_object('id', g.id, 'kind', g.kind, 'host', hp.display_name) order by g.created_at), '[]'::jsonb)
    into v_inv
    from public.og_players mp join public.og_games g on g.id = mp.game_id join public.profiles hp on hp.id = g.host_id
   where mp.user_id = v_me and mp.join_state = 'invited' and g.status = 'lobby' and g.updated_at > now() - interval '2 days';
  return jsonb_build_object('claimable', v_claim, 'rank', v_rank, 'points', v_pts, 'rows', v_rows, 'invites', v_inv);
end;
$$;

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and (p.proname like '\_ludo\_%' or p.proname like '\_og\_%' or p.proname like 'og\_%' or p.proname in ('_ships_cells', '_lock_keys', 'admin_parkour_delete', 'watch_progress'))
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    if left(r.proname, 1) <> '_' then
      execute format('grant execute on function %s to authenticated', r.sig);
    end if;
  end loop;
end;
$$;
