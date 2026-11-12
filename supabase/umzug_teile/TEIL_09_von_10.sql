
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

-- 0080: Fix „Quest abholen"-Banner: Plus-/Pro-Quests, die man ohne Plus/Pro gar nicht abholen darf, wurden trotzdem gemeldet
-- (Banner kam immer wieder). Jetzt nur noch Quests, die man wirklich abholen kann. Wiederholbar.
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
    into v_claim from public.get_quests() q
   where q.progress >= q.goal and not q.claimed
     and (not q.plus_only
          or (q.family like 'pro\_%' and public._pro_active(v_me))
          or (q.family not like 'pro\_%' and public._plus_active(v_me)));

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
  for r in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'watch_progress'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;
end;
$$;
-- 0081: Pro Sprache merken: Anzahl der Vokabeln pro Runde und Richtung (Einstellungen → Lernen). Wiederholbar.
alter table public.user_settings add column if not exists language_defaults jsonb not null default '{}'::jsonb;
-- 0082: Update 100 – Jubiläums-Artikel (begrenzt + für alle). Wiederholbar.
alter table public.shop_items add column if not exists limited integer;

insert into public.shop_items (id, kind, name, price, sort, active, limited) values
  ('tag_u100', 'tag', 'Update 100 · Gold', 0, 9000, true, 10),
  ('theme_u100_gold', 'theme', 'Update 100 · Goldenes Feuerwerk', 0, 9001, true, 10),
  ('theme_u100', 'theme', 'Update 100 · Luftballons', 0, 9002, true, null)
on conflict (id) do update set name = excluded.name, limited = excluded.limited;

-- Stand: wie viele der begrenzten Artikel sind vergeben, was habe ich schon.
create or replace function public.u100_status()
returns table (item_id text, limited integer, taken bigint, mine boolean)
language sql stable security definer set search_path = public as $$
  select i.id, i.limited,
         (select count(*) from public.user_items u where u.item_id = i.id),
         exists (select 1 from public.user_items u where u.item_id = i.id and u.user_id = (select auth.uid()))
    from public.shop_items i
   where i.id in ('tag_u100', 'theme_u100_gold', 'theme_u100') and i.active;
$$;

-- Holen: begrenzte Artikel nur solange noch Plätze frei sind (die Schnellsten gewinnen).
create or replace function public.u100_claim(p_item_id text)
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := (select auth.uid());
  v_lim integer;
  v_n bigint;
begin
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  if p_item_id not in ('tag_u100', 'theme_u100_gold', 'theme_u100') then
    raise exception 'Artikel nicht gefunden.' using errcode = 'P0002';
  end if;
  select limited into v_lim from public.shop_items where id = p_item_id and active;
  if not found then
    raise exception 'Artikel nicht gefunden.' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.user_items where user_id = v_me and item_id = p_item_id) then
    return 'owned';
  end if;
  perform pg_advisory_xact_lock(hashtext('u100:' || p_item_id));
  if v_lim is not null then
    select count(*) into v_n from public.user_items where item_id = p_item_id;
    if v_n >= v_lim then
      return 'gone';
    end if;
  end if;
  insert into public.user_items (user_id, item_id) values (v_me, p_item_id) on conflict do nothing;
  return 'ok';
end;
$$;

do $$
declare f text;
begin
  for f in select unnest(array['u100_status()', 'u100_claim(text)']) loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- ----------------------------------------------------------------------------
-- Mods dürfen (wenn der Admin es freigibt) sehen, wer online ist und was die Leute gerade tun – auch Versteckte.
-- Standard: app_settings 'mod_see_online' (0/1). Pro Person überschreibbar (null = Standard).
-- ----------------------------------------------------------------------------
insert into public.app_settings (key, value, mod_editable) values ('mod_see_online', 0, false) on conflict (key) do nothing;

create table if not exists public.staff_extra (
  user_id uuid primary key references auth.users (id) on delete cascade,
  see_online boolean
);
alter table public.staff_extra enable row level security;
revoke all on public.staff_extra from anon, authenticated;

create or replace function public._can_see_online()
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when public.is_admin() then true
    when not public.is_staff() then false
    else coalesce((select e.see_online from public.staff_extra e where e.user_id = (select auth.uid())),
                  public.setting('mod_see_online') = 1)
  end;
$$;

create or replace function public.staff_can_see_online()
returns boolean language sql stable security definer set search_path = public as $$
  select public._can_see_online();
$$;

create or replace function public.admin_get_staff_extra(p_user uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public._require_admin();
  return jsonb_build_object('see_online', (select see_online from public.staff_extra where user_id = p_user));
end;
$$;

create or replace function public.admin_set_staff_extra(p_user uuid, p_see_online boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public._require_admin();
  if not exists (select 1 from public.profiles where id = p_user and role in ('mod', 'alphamod')) then
    raise exception 'Nur für Mods und Alphamods.' using errcode = '22023';
  end if;
  insert into public.staff_extra (user_id, see_online) values (p_user, p_see_online)
  on conflict (user_id) do update set see_online = excluded.see_online;
end;
$$;

create or replace function public.admin_list_online()
returns table (user_id uuid, display_name text, role text, last_seen_at timestamptz,
               avatar_id text, color_id text, effect_id text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public._can_see_online() then
    raise exception 'Dafür fehlt dir das Recht.' using errcode = '42501';
  end if;
  return query
  select p.id, p.display_name, p.role, p.last_seen_at, p.avatar_id, p.color_id, p.effect_id
    from public.profiles p
   where p.last_seen_at > now() - interval '3 minutes' and not p.blocked
   order by p.display_name;
end;
$$;

create or replace function public.admin_user_status()
returns table (user_id uuid, last_seen_at timestamptz, online boolean, activity text, activity_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public._can_see_online() then
    raise exception 'Dafür fehlt dir das Recht.' using errcode = '42501';
  end if;
  return query
  select p.id, p.last_seen_at, (p.last_seen_at > now() - interval '3 minutes'),
         case when p.last_seen_at > now() - interval '3 minutes' then p.activity end,
         case when p.last_seen_at > now() - interval '3 minutes' then p.activity_at end
    from public.profiles p
   where p.last_seen_at is not null;
end;
$$;

drop function if exists public.get_presence();
create function public.get_presence()
returns table (user_id uuid, display_name text, avatar_id text, color_id text, effect_id text, role text, tag_id text,
               theme_id text, last_seen_at timestamptz, online boolean, hidden boolean)
language sql stable security definer set search_path = public as $$
  select p.id, p.display_name, p.avatar_id, p.color_id, p.effect_id,
         case when p.tags_hidden then 'user' else p.role end,
         case when p.tags_hidden then null else p.tag_id end,
         p.theme_id, p.last_seen_at, (p.last_seen_at > now() - interval '3 minutes'), p.hide_presence
    from public.profiles p
   where (select auth.uid()) is not null and not public.is_blocked()
     and not p.blocked and p.last_seen_at is not null
     and (not p.hide_presence or p.id = (select auth.uid()) or public._can_see_online())
   order by (p.last_seen_at > now() - interval '3 minutes') desc, p.last_seen_at desc
   limit 200;
$$;

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig, p.proname
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('_can_see_online', 'staff_can_see_online', 'admin_get_staff_extra',
       'admin_set_staff_extra', 'admin_list_online', 'admin_user_status', 'get_presence')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    if r.proname not like '\_%' then execute format('grant execute on function %s to authenticated', r.sig); end if;
  end loop;
end $$;

-- ----------------------------------------------------------------------------
-- Karteikasten: alle aktiven Karten mit Fach (= Lernstufe) und richtig/falsch-Zähler.
-- Liest nur; der bisherige Lernstand bleibt unverändert.
-- ----------------------------------------------------------------------------
create or replace function public.get_card_box(p_language text default null, p_book_id uuid default null)
returns jsonb
language sql
stable
set search_path = public
as $$
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'vocabulary_id', v.id,
      'book_id', v.book_id,
      'german', v.german,
      'translations', coalesce((
         select jsonb_agg(t.translation order by t.sort_order, t.created_at)
           from public.translations t where t.vocabulary_id = v.id), '[]'::jsonb),
      'level', coalesce(pr.learning_level, 1)::float8,
      'right', coalesce(pr.times_correct, 0),
      'wrong', coalesce(pr.times_wrong, 0),
      'last_at', pr.last_answered_at
    ) order by v.german), '[]'::jsonb)
  from public.vocabulary v
  join public.books b on b.id = v.book_id
  left join public.user_vocabulary_progress pr
    on pr.vocabulary_id = v.id and pr.user_id = (select auth.uid())
  where (select auth.uid()) is not null
    and ((p_book_id is null and public.in_library(v.book_id)) or v.book_id = p_book_id)
    and public.is_active_vocab(v.id)
    and (p_language is null or b.language = p_language);
$$;

revoke all on function public.get_card_box(text, uuid) from public, anon, authenticated;
grant execute on function public.get_card_box(text, uuid) to authenticated;

-- Kasten pro Buch: wie viele aktive Karten liegen in welchem Fach (nur lesend).
create or replace function public.get_book_boxes()
returns jsonb
language sql
stable
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object('book_id', x.book_id, 'fach', x.fach)), '[]'::jsonb)
  from (
    select v.book_id,
           jsonb_build_array(
             count(*) filter (where floor(coalesce(pr.learning_level, 1)) <= 1),
             count(*) filter (where floor(coalesce(pr.learning_level, 1)) = 2),
             count(*) filter (where floor(coalesce(pr.learning_level, 1)) = 3),
             count(*) filter (where floor(coalesce(pr.learning_level, 1)) = 4),
             count(*) filter (where floor(coalesce(pr.learning_level, 1)) >= 5)) as fach
      from public.vocabulary v
      left join public.user_vocabulary_progress pr
        on pr.vocabulary_id = v.id and pr.user_id = (select auth.uid())
     where (select auth.uid()) is not null
       and public.in_library(v.book_id)
       and public.is_active_vocab(v.id)
     group by v.book_id
  ) x;
$$;

revoke all on function public.get_book_boxes() from public, anon, authenticated;
grant execute on function public.get_book_boxes() to authenticated;
-- 0083: Update-100-Limit hart absichern. Wiederholbar.
-- Egal auf welchem Weg ein begrenzter Artikel vergeben wird: ab dem (limited+1). Eintrag gibt es einen Fehler.
create or replace function public._limited_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lim integer;
begin
  select limited into v_lim from public.shop_items where id = new.item_id;
  if v_lim is null then
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtext('u100:' || new.item_id));
  if (select count(*) from public.user_items where item_id = new.item_id) >= v_lim then
    raise exception 'Zu spät – alle % sind schon vergeben.', v_lim using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists user_items_limited_guard on public.user_items;
create trigger user_items_limited_guard
  before insert on public.user_items
  for each row execute function public._limited_guard();

revoke all on function public._limited_guard() from public, anon, authenticated;

-- Die Beanspruchung meldet „gone“ auch dann sauber, wenn der Trigger zuschlägt.
create or replace function public.u100_claim(p_item_id text)
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := (select auth.uid());
begin
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  if p_item_id not in ('tag_u100', 'theme_u100_gold', 'theme_u100') then
    raise exception 'Artikel nicht gefunden.' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.user_items where user_id = v_me and item_id = p_item_id) then
    return 'owned';
  end if;
  begin
    insert into public.user_items (user_id, item_id) values (v_me, p_item_id);
  exception when sqlstate 'P0001' then
    return 'gone';
  end;
  return 'ok';
end;
$$;

revoke all on function public.u100_claim(text) from public, anon, authenticated;
grant execute on function public.u100_claim(text) to authenticated;
-- 0084: Limitierte Artikel (4 Stück), Handel zwischen Nutzern, Admin-Übersicht, Mod-Zuschauen bei Online-Spielen.
-- Behebt außerdem: Update-100-Artikel hatten Preis 0 und galten damit für alle als „besessen" (Limit wirkte nicht).
-- Wiederholbar.

alter table public.shop_items add column if not exists claim_only boolean not null default false;
alter table public.shop_items add column if not exists source text not null default 'shop';
alter table public.shop_items drop constraint if exists shop_items_source_check;
alter table public.shop_items add constraint shop_items_source_check check (source in ('shop', 'advent', 'both'));

-- ---------------------------------------------------------------------------------------------
-- 1) Update-100-Fix: echte Besitzpflicht
-- ---------------------------------------------------------------------------------------------
update public.shop_items set price = 1, claim_only = true where id in ('tag_u100', 'theme_u100_gold');

-- Wer die Artikel ausgewählt hat, ohne sie zu besitzen: die ältesten Konten bekommen sie bis zum Limit, alle anderen verlieren sie.
do $$
declare
  v_id text;
  v_kind text;
  v_lim integer;
  v_taken bigint;
  r record;
begin
  for v_id in select unnest(array['tag_u100', 'theme_u100_gold']) loop
    select kind, limited into v_kind, v_lim from public.shop_items where id = v_id;
    select count(*) into v_taken from public.user_items where item_id = v_id;
    for r in
      select p.id as uid
        from public.profiles p
       where ((v_kind = 'tag' and p.tag_id = v_id) or (v_kind = 'theme' and p.theme_id = v_id))
         and not exists (select 1 from public.user_items u where u.user_id = p.id and u.item_id = v_id)
       order by p.created_at
    loop
      if v_taken < v_lim then
        insert into public.user_items (user_id, item_id) values (r.uid, v_id) on conflict do nothing;
        v_taken := v_taken + 1;
      else
        update public.profiles
           set tag_id = case when v_kind = 'tag' then null else tag_id end,
               theme_id = case when v_kind = 'theme' then null else theme_id end
         where id = r.uid;
      end if;
    end loop;
  end loop;
end $$;

-- ---------------------------------------------------------------------------------------------
-- 2) Neue limitierte Artikel (je 4 Stück). source: shop | advent | both
-- ---------------------------------------------------------------------------------------------
insert into public.shop_items (id, kind, name, price, sort, active, limited, source) values
  ('tag_ltd_phoenix', 'tag',   'Phönix',        8000,  9100, true, 4, 'shop'),
  ('theme_ltd_polar', 'theme', 'Polarlicht Deluxe', 12000, 9101, true, 4, 'shop'),
  ('tag_ltd_glitch',  'tag',   'Glitch',        6000,  9102, true, 4, 'advent'),
  ('theme_ltd_void',  'theme', 'Die Leere',     10000, 9103, true, 4, 'advent')
on conflict (id) do update set name = excluded.name, limited = excluded.limited, source = excluded.source, price = excluded.price;

-- ---------------------------------------------------------------------------------------------
-- 3) Kaufen: nur wenn nicht „nur abholbar"; das Limit sichert der Trigger aus 0083
-- ---------------------------------------------------------------------------------------------
drop function if exists public.buy_item(text);
create or replace function public.buy_item(p_item_id text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  v_price integer;
  v_req text;
  v_claim boolean;
  v_source text;
  v_balance integer;
begin
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  select price, required_role, claim_only, source into v_price, v_req, v_claim, v_source from public.shop_items where id = p_item_id and active;
  if v_price is null then
    raise exception 'Artikel nicht gefunden.' using errcode = 'P0002';
  end if;
  if v_req is not null or v_claim or v_source = 'advent' then
    raise exception 'Dieser Artikel ist nicht kaufbar.' using errcode = '42501';
  end if;
  if exists (select 1 from public.user_items where user_id = v_me and item_id = p_item_id) or v_price = 0 then
    raise exception 'Das gehört dir schon.' using errcode = '23505';
  end if;
  v_balance := public._grant_koins(v_me, -v_price, 'shop', p_item_id);
  begin
    insert into public.user_items (user_id, item_id) values (v_me, p_item_id);
  exception when sqlstate 'P0001' then
    raise exception 'Zu spät – alle sind schon vergeben.' using errcode = 'P0001';
  end;
  return v_balance;
end;
$$;

-- get_shop: zusätzlich Limit, Vergebene, „nur abholbar", Herkunft
drop function if exists public.get_shop();
create function public.get_shop()
returns table (id text, kind text, name text, price integer, sort integer, owned boolean, equipped boolean,
               required_role text, active boolean, custom boolean, style jsonb, svg text, plus_only boolean,
               limited integer, taken bigint, claim_only boolean, source text)
language sql
stable
security definer
set search_path = public
as $$
  select i.id, i.kind, i.name, i.price, i.sort,
         ((i.price = 0 and (not i.plus_only or public._plus_active((select auth.uid())))) or o.item_id is not null),
         exists (select 1 from public.profiles p
                  where p.id = (select auth.uid())
                    and i.id in (p.avatar_id, p.color_id, p.effect_id, p.theme_id, p.tag_id)),
         i.required_role, i.active, i.custom, i.style, i.svg, i.plus_only,
         i.limited,
         case when i.limited is null then null else (select count(*) from public.user_items t where t.item_id = i.id) end,
         i.claim_only, i.source
    from public.shop_items i
    left join public.user_items o on o.item_id = i.id and o.user_id = (select auth.uid())
   where (select auth.uid()) is not null
     and (i.active or o.item_id is not null)
     and (i.source <> 'advent' or o.item_id is not null)
     and (i.required_role is null
          or public._role_rank(i.required_role) <= public._role_rank(
               (select p.role from public.profiles p where p.id = (select auth.uid()))))
   order by i.kind, i.sort, i.name;
$$;

-- u100_status zählt weiter über user_items – unverändert gültig.

-- ---------------------------------------------------------------------------------------------
-- 4) Adventskalender: Zufalls-Artikel nie limitiert; zusätzlich kleine Chance auf einen limitierten (Herkunft advent/both)
-- ---------------------------------------------------------------------------------------------
insert into public.app_settings (key, value, mod_editable) values ('advent_limited_chance', 4, false) on conflict (key) do nothing;

drop function if exists public._advent_plan(integer);
create or replace function public._advent_plan(p_day integer)
returns jsonb
language plpgsql
volatile
set search_path = public
as $$
declare
  v_plan jsonb := public._advent_plan_base(p_day);
  v_mult numeric := greatest(public._pls('pro_advent_mult'), 1);
  v_out jsonb := '[]'::jsonb;
  e jsonb;
begin
  if public._pro_active((select auth.uid())) then
    for e in select * from jsonb_array_elements(v_plan)
    loop
      e := case e ->> 'type'
        when 'coins' then jsonb_set(e, '{amount}', to_jsonb(round((e ->> 'amount')::numeric * v_mult)::bigint))
        when 'points' then jsonb_set(e, '{amount}', to_jsonb(round((e ->> 'amount')::numeric * v_mult)::bigint))
        when 'item' then jsonb_set(e, '{max_price}', to_jsonb(round((e ->> 'max_price')::numeric * v_mult)::bigint))
        when 'plus' then jsonb_set(e, '{days}', to_jsonb((e ->> 'days')::integer + public._pls('pro_advent_plus_days')::integer))
        else e end;
      v_out := v_out || jsonb_build_array(e);
    end loop;
  else
    v_out := v_plan;
  end if;
  if random() * 100 < public.setting('advent_limited_chance') then
    v_out := v_out || jsonb_build_array(jsonb_build_object('type', 'limited'));
  end if;
  return v_out;
end;
$$;

drop function if exists public.advent_open(integer);
create or replace function public.advent_open(p_day integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  v_today integer := public._advent_today();
  v_year integer := public._advent_year();
  v_plan jsonb;
  v_r jsonb;
  v_out jsonb := '[]'::jsonb;
  v_item record;
  v_amount bigint;
begin
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht erlaubt.' using errcode = '42501';
  end if;
  if v_today = 0 then
    raise exception 'Der Adventskalender ist nur vom 1. bis 24. Dezember offen.' using errcode = '22023';
  end if;
  if p_day is distinct from v_today then
    raise exception 'Heute kannst du nur Türchen % öffnen.', v_today using errcode = '22023';
  end if;
  begin
    insert into public.advent_opened (user_id, year, day) values (v_me, v_year, p_day);
  exception when unique_violation then
    raise exception 'Dieses Türchen hast du schon geöffnet.' using errcode = '23505';
  end;

  v_plan := public._advent_plan(p_day);
  for v_r in select * from jsonb_array_elements(v_plan) loop
    case v_r ->> 'type'
      when 'coins' then
        perform public._grant_koins(v_me, (v_r ->> 'amount')::bigint, 'advent', 'day' || p_day);
        v_out := v_out || v_r;
      when 'points' then
        insert into public.points_adjustments (user_id, points, reason, created_by)
        values (v_me, (v_r ->> 'amount')::integer, 'Adventskalender ' || p_day, null);
        v_out := v_out || v_r;
      when 'plus' then
        update public.profiles
           set plus_until = greatest(coalesce(plus_until, now()), now()) + make_interval(days => (v_r ->> 'days')::integer)
         where id = v_me;
        v_out := v_out || v_r;
      when 'limited' then
        -- Limitierter Artikel: nur wenn noch einer frei ist und ich ihn nicht habe; sonst gibt es dazu nichts.
        select i.id, i.kind, i.name, i.price into v_item
          from public.shop_items i
         where i.limited is not null and i.active and i.source in ('advent', 'both')
           and not exists (select 1 from public.user_items u where u.user_id = v_me and u.item_id = i.id)
           and (select count(*) from public.user_items t where t.item_id = i.id) < i.limited
         order by random() limit 1;
        if found then
          begin
            insert into public.user_items (user_id, item_id) values (v_me, v_item.id);
            v_out := v_out || jsonb_build_object('type', 'item', 'id', v_item.id, 'kind', v_item.kind, 'name', v_item.name, 'price', v_item.price);
          exception when sqlstate 'P0001' then
            null;
          end;
        end if;
      when 'item' then
        if v_r ? 'id' then
          select i.id, i.kind, i.name, i.price into v_item from public.shop_items i where i.id = v_r ->> 'id';
        else
          select i.id, i.kind, i.name, i.price into v_item
            from public.shop_items i
           where i.kind in ('avatar', 'color', 'effect', 'theme')
             and i.limited is null and i.claim_only = false
             and i.price > 0 and i.price <= coalesce((v_r ->> 'max_price')::integer, 1000)
             and not exists (select 1 from public.user_items u where u.user_id = v_me and u.item_id = i.id)
           order by random() limit 1;
        end if;
        if not found then
          v_amount := 100;
          perform public._grant_koins(v_me, v_amount, 'advent', 'day' || p_day);
          v_out := v_out || jsonb_build_object('type', 'coins', 'amount', v_amount);
        elsif exists (select 1 from public.user_items where user_id = v_me and item_id = v_item.id) then
          v_amount := greatest(v_item.price / 2, 50);
          perform public._grant_koins(v_me, v_amount, 'advent', 'day' || p_day);
          v_out := v_out || jsonb_build_object('type', 'coins', 'amount', v_amount, 'dup', v_item.name);
        else
          insert into public.user_items (user_id, item_id) values (v_me, v_item.id);
          v_out := v_out || jsonb_build_object('type', 'item', 'id', v_item.id, 'kind', v_item.kind, 'name', v_item.name, 'price', v_item.price);
        end if;
      else null;
    end case;
  end loop;

  update public.advent_opened set rewards = v_out where user_id = v_me and year = v_year and day = p_day;
  return jsonb_build_object('day', p_day, 'rewards', v_out);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- 5) Admin: wem gehören die limitierten Artikel?
-- ---------------------------------------------------------------------------------------------
drop function if exists public.admin_limited_overview();
create or replace function public.admin_limited_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public._require_admin();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'item_id', i.id, 'name', i.name, 'kind', i.kind, 'limited', i.limited, 'source', i.source, 'price', i.price,
      'holders', coalesce((
        select jsonb_agg(jsonb_build_object('user_id', u.user_id, 'name', p.display_name, 'at', u.acquired_at,
                                            'listed_price', (select o.price from public.item_offers o where o.item_id = i.id and o.seller_id = u.user_id and o.status = 'open' limit 1))
                         order by u.acquired_at)
          from public.user_items u join public.profiles p on p.id = u.user_id where u.item_id = i.id), '[]'::jsonb)
    ) order by i.sort)
    from public.shop_items i where i.limited is not null), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- 6) Handel zwischen Nutzern (Angebote + Gebote, Preise verhandelbar)
-- ---------------------------------------------------------------------------------------------
create table if not exists public.item_offers (
  id uuid primary key default gen_random_uuid(),
  item_id text not null references public.shop_items (id) on delete cascade,
  seller_id uuid not null references public.profiles (id) on delete cascade,
  price integer not null check (price between 1 and 1000000000),
  status text not null default 'open' check (status in ('open', 'sold', 'cancelled')),
  buyer_id uuid references public.profiles (id) on delete set null,
  sold_price integer,
  created_at timestamptz not null default now(),
  closed_at timestamptz
);
create unique index if not exists item_offers_open_idx on public.item_offers (item_id, seller_id) where status = 'open';
create table if not exists public.item_bids (
  id uuid primary key default gen_random_uuid(),
  offer_id uuid not null references public.item_offers (id) on delete cascade,
  bidder_id uuid not null references public.profiles (id) on delete cascade,
  price integer not null check (price between 1 and 1000000000),
  status text not null default 'open' check (status in ('open', 'accepted', 'declined', 'withdrawn')),
  created_at timestamptz not null default now()
);
create unique index if not exists item_bids_open_idx on public.item_bids (offer_id, bidder_id) where status = 'open';
alter table public.item_offers enable row level security;
alter table public.item_bids enable row level security;
revoke all on public.item_offers, public.item_bids from anon, authenticated;

drop function if exists public._trade_check();
create or replace function public._trade_check()
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

-- Verkauf ausführen: Coins buyer → seller (ohne Plus-Bonus), Artikel wechselt den Besitzer, Auswahl des Verkäufers fällt weg.
drop function if exists public._trade_execute(uuid, uuid, integer);
create or replace function public._trade_execute(p_offer uuid, p_buyer uuid, p_price integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  o public.item_offers;
begin
  select * into o from public.item_offers where id = p_offer for update;
  if o.id is null or o.status <> 'open' then
    raise exception 'Das Angebot gibt es nicht mehr.' using errcode = 'P0002';
  end if;
  if p_buyer = o.seller_id then
    raise exception 'Du kannst nicht von dir selbst kaufen.' using errcode = '22023';
  end if;
  if exists (select 1 from public.user_items where user_id = p_buyer and item_id = o.item_id) then
    raise exception 'Das gehört dir schon.' using errcode = '23505';
  end if;
  if not exists (select 1 from public.user_items where user_id = o.seller_id and item_id = o.item_id) then
    update public.item_offers set status = 'cancelled', closed_at = now() where id = o.id;
    raise exception 'Der Verkäufer besitzt den Artikel nicht mehr.' using errcode = 'P0002';
  end if;
  perform public._grant_koins(p_buyer, -p_price, 'trade_buy', o.item_id);
  perform public._grant_koins(o.seller_id, p_price, 'pay_in', 'trade:' || o.item_id);
  update public.user_items set user_id = p_buyer, acquired_at = now() where user_id = o.seller_id and item_id = o.item_id;
  update public.profiles
     set avatar_id = case when avatar_id = o.item_id then null else avatar_id end,
         color_id = case when color_id = o.item_id then null else color_id end,
         effect_id = case when effect_id = o.item_id then null else effect_id end,
         theme_id = case when theme_id = o.item_id then null else theme_id end,
         tag_id = case when tag_id = o.item_id then null else tag_id end
   where id = o.seller_id;
  update public.item_offers set status = 'sold', buyer_id = p_buyer, sold_price = p_price, closed_at = now() where id = o.id;
  update public.item_bids set status = case when bidder_id = p_buyer and price = p_price then 'accepted' else 'declined' end
   where offer_id = o.id and status = 'open';
  -- eigene offene Gebote des Käufers auf diesen Artikel bei anderen Angeboten sind jetzt sinnlos
  update public.item_bids b set status = 'withdrawn'
   where b.bidder_id = p_buyer and b.status = 'open'
     and b.offer_id in (select id from public.item_offers where item_id = o.item_id and status = 'open');
end;
$$;

drop function if exists public.trade_list(text, integer);
create or replace function public.trade_list(p_item text, p_price integer)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := public._trade_check();
  v_id uuid;
begin
  if p_price is null or p_price < 1 then
    raise exception 'Bitte einen Preis ab 1 Coin angeben.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.shop_items where id = p_item and limited is not null) then
    raise exception 'Dieser Artikel ist nicht handelbar.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.user_items where user_id = v_me and item_id = p_item) then
    raise exception 'Das gehört dir nicht.' using errcode = '42501';
  end if;
  insert into public.item_offers (item_id, seller_id, price) values (p_item, v_me, p_price)
  on conflict (item_id, seller_id) where status = 'open' do update set price = excluded.price
  returning id into v_id;
  return v_id;
end;
$$;

drop function if exists public.trade_cancel(uuid);
create or replace function public.trade_cancel(p_offer uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_me uuid := public._trade_check();
begin
  update public.item_offers set status = 'cancelled', closed_at = now() where id = p_offer and seller_id = v_me and status = 'open';
  if not found then
    raise exception 'Angebot nicht gefunden.' using errcode = 'P0002';
  end if;
  update public.item_bids set status = 'declined' where offer_id = p_offer and status = 'open';
end;
$$;

drop function if exists public.trade_buy(uuid);
create or replace function public.trade_buy(p_offer uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := public._trade_check();
  v_price integer;
begin
  select price into v_price from public.item_offers where id = p_offer and status = 'open';
  if v_price is null then
    raise exception 'Das Angebot gibt es nicht mehr.' using errcode = 'P0002';
  end if;
  perform public._trade_execute(p_offer, v_me, v_price);
end;
$$;

drop function if exists public.trade_bid(uuid, integer);
create or replace function public.trade_bid(p_offer uuid, p_price integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := public._trade_check();
  o public.item_offers;
begin
  if p_price is null or p_price < 1 then
    raise exception 'Bitte ein Gebot ab 1 Coin angeben.' using errcode = '22023';
  end if;
  select * into o from public.item_offers where id = p_offer and status = 'open';
  if o.id is null then
    raise exception 'Das Angebot gibt es nicht mehr.' using errcode = 'P0002';
  end if;
  if o.seller_id = v_me then
    raise exception 'Auf dein eigenes Angebot kannst du nicht bieten.' using errcode = '22023';
  end if;
  if exists (select 1 from public.user_items where user_id = v_me and item_id = o.item_id) then
    raise exception 'Das gehört dir schon.' using errcode = '23505';
  end if;
  insert into public.item_bids (offer_id, bidder_id, price) values (p_offer, v_me, p_price)
  on conflict (offer_id, bidder_id) where status = 'open' do update set price = excluded.price, created_at = now();
end;
$$;

drop function if exists public.trade_bid_cancel(uuid);
create or replace function public.trade_bid_cancel(p_bid uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_me uuid := public._trade_check();
begin
  update public.item_bids set status = 'withdrawn' where id = p_bid and bidder_id = v_me and status = 'open';
end;
$$;

drop function if exists public.trade_accept(uuid);
create or replace function public.trade_accept(p_bid uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := public._trade_check();
  b public.item_bids;
begin
  select b2.* into b from public.item_bids b2 join public.item_offers o on o.id = b2.offer_id
   where b2.id = p_bid and b2.status = 'open' and o.seller_id = v_me and o.status = 'open';
  if b.id is null then
    raise exception 'Gebot nicht gefunden.' using errcode = 'P0002';
  end if;
  perform public._trade_execute(b.offer_id, b.bidder_id, b.price);
end;
$$;

drop function if exists public.trade_decline(uuid);
create or replace function public.trade_decline(p_bid uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_me uuid := public._trade_check();
begin
  update public.item_bids b set status = 'declined'
   where b.id = p_bid and b.status = 'open'
     and exists (select 1 from public.item_offers o where o.id = b.offer_id and o.seller_id = v_me);
end;
$$;

-- Marktplatz: offene Angebote, meine Gebote, (als Verkäufer) die Gebote auf meine Angebote, letzte Verkäufe
drop function if exists public.trade_market();
create or replace function public.trade_market()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_me uuid := public._trade_check();
begin
  return jsonb_build_object(
    'offers', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', o.id, 'item_id', o.item_id, 'name', i.name, 'kind', i.kind, 'price', o.price,
        'seller', p.display_name, 'mine', o.seller_id = v_me, 'since', o.created_at,
        'my_bid', (select b.price from public.item_bids b where b.offer_id = o.id and b.bidder_id = v_me and b.status = 'open'),
        'my_bid_id', (select b.id from public.item_bids b where b.offer_id = o.id and b.bidder_id = v_me and b.status = 'open'),
        'bid_count', (select count(*) from public.item_bids b where b.offer_id = o.id and b.status = 'open'),
        'bids', case when o.seller_id = v_me then coalesce((
                   select jsonb_agg(jsonb_build_object('id', b.id, 'name', bp.display_name, 'price', b.price) order by b.price desc)
                     from public.item_bids b join public.profiles bp on bp.id = b.bidder_id
                    where b.offer_id = o.id and b.status = 'open'), '[]'::jsonb) else '[]'::jsonb end,
        'owned', exists (select 1 from public.user_items u where u.user_id = v_me and u.item_id = o.item_id)
      ) order by o.created_at desc)
        from public.item_offers o
        join public.shop_items i on i.id = o.item_id
        join public.profiles p on p.id = o.seller_id
       where o.status = 'open'), '[]'::jsonb),
    'history', coalesce((
      select jsonb_agg(h.j order by h.at desc) from (
        select o.closed_at as at, jsonb_build_object('name', i.name, 'price', o.sold_price, 'at', o.closed_at) as j
          from public.item_offers o join public.shop_items i on i.id = o.item_id
         where o.status = 'sold' order by o.closed_at desc limit 10) h), '[]'::jsonb),
    'mine', coalesce((
      select jsonb_agg(jsonb_build_object('item_id', i.id, 'name', i.name, 'kind', i.kind,
                       'listed', exists (select 1 from public.item_offers o where o.item_id = i.id and o.seller_id = v_me and o.status = 'open')) order by i.sort)
        from public.user_items u join public.shop_items i on i.id = u.item_id
       where u.user_id = v_me and i.limited is not null), '[]'::jsonb)
  );
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- 7) Mods dürfen Online-Spiele ansehen (inkl. gegnerischer Schiffe) – pro Person / als Standard
-- ---------------------------------------------------------------------------------------------
insert into public.app_settings (key, value, mod_editable) values ('mod_see_games', 0, false) on conflict (key) do nothing;
alter table public.staff_extra add column if not exists see_games boolean;

drop function if exists public._can_see_games();
create or replace function public._can_see_games()
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when public.is_admin() then true
    when not public.is_staff() then false
    else coalesce((select e.see_games from public.staff_extra e where e.user_id = (select auth.uid())),
                  public.setting('mod_see_games') = 1)
  end;
$$;

drop function if exists public.staff_can_see_games();
create or replace function public.staff_can_see_games()
returns boolean language sql stable security definer set search_path = public as $$
  select public._can_see_games();
$$;

drop function if exists public.admin_get_staff_extra(uuid);
create or replace function public.admin_get_staff_extra(p_user uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public._require_admin();
  return coalesce((select jsonb_build_object('see_online', e.see_online, 'see_games', e.see_games) from public.staff_extra e where e.user_id = p_user),
                  jsonb_build_object('see_online', null, 'see_games', null));
end;
$$;

drop function if exists public.admin_set_staff_extra(uuid, boolean);
create or replace function public.admin_set_staff_extra(p_user uuid, p_key text, p_value boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public._require_admin();
  if p_key not in ('see_online', 'see_games') then
    raise exception 'Unbekanntes Recht.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.profiles where id = p_user and role in ('mod', 'alphamod')) then
    raise exception 'Nur für Mods und Alphamods.' using errcode = '22023';
  end if;
  insert into public.staff_extra (user_id) values (p_user) on conflict do nothing;
  if p_key = 'see_online' then
    update public.staff_extra set see_online = p_value where user_id = p_user;
  else
    update public.staff_extra set see_games = p_value where user_id = p_user;
  end if;
end;
$$;

-- Laufende Spiele (Zuschauen)
drop function if exists public.og_spectate_list();
create or replace function public.og_spectate_list()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public._can_see_games() then
    raise exception 'Dafür fehlt dir das Recht.' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', g.id, 'kind', g.kind, 'status', g.status, 'updated_at', g.updated_at,
      'players', (select jsonb_agg(pr.display_name order by coalesce(p.seat, 9)) from public.og_players p join public.profiles pr on pr.id = p.user_id
                   where p.game_id = g.id and p.join_state = 'joined')) order by g.updated_at desc)
      from public.og_games g where g.status in ('lobby', 'running')), '[]'::jsonb);
end;
$$;

-- Vollständige Sicht auf ein Spiel: alle Geheimnisse (Schiffe, Auswahl) sichtbar
drop function if exists public.og_spectate_view(uuid);
create or replace function public.og_spectate_view(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  g public.og_games;
begin
  if not public._can_see_games() then
    raise exception 'Dafür fehlt dir das Recht.' using errcode = '42501';
  end if;
  select * into g from public.og_games where id = p_id;
  if g.id is null then
    raise exception 'Spiel nicht gefunden.' using errcode = 'P0002';
  end if;
  return jsonb_build_object('id', g.id, 'kind', g.kind, 'status', g.status, 'version', g.version, 'host_id', g.host_id,
    'turn_seat', g.turn_seat, 'winner_seat', g.winner_seat, 'state', g.state,
    'players', coalesce((select jsonb_agg(jsonb_build_object('user_id', p.user_id, 'name', pr.display_name, 'seat', p.seat,
                                                              'join_state', p.join_state, 'secret', p.secret) order by coalesce(p.seat, 9))
                           from public.og_players p join public.profiles pr on pr.id = p.user_id where p.game_id = g.id), '[]'::jsonb));
end;
$$;

-- Rechte
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig, p.proname
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('buy_item', 'get_shop', 'advent_open', '_advent_plan', 'admin_limited_overview',
       '_trade_check', '_trade_execute', 'trade_list', 'trade_cancel', 'trade_buy', 'trade_bid', 'trade_bid_cancel', 'trade_accept',
       'trade_decline', 'trade_market', '_can_see_games', 'staff_can_see_games', 'admin_get_staff_extra', 'admin_set_staff_extra',
       'og_spectate_list', 'og_spectate_view')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    if r.proname not like '\_%' then execute format('grant execute on function %s to authenticated', r.sig); end if;
  end loop;
end $$;
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
  -- Windows-Zeilenenden (CRLF) aus dem SQL-Editor entfernen, damit mehrzeilige Muster passen
  v_def := replace(pg_get_functiondef(v_oid), chr(13), '');
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

-- ===== 0086_more_limited.sql =====
-- 0086: Weitere limitierte Artikel (je 4 Stück). Wiederholbar.
insert into public.shop_items (id, kind, name, price, sort, active, limited, source) values
  ('tag_ltd_frost',     'tag',   'Frost',               5000, 9104, true, 4, 'shop'),
  ('tag_ltd_royal',     'tag',   'Krone',               9000, 9105, true, 4, 'both'),
  ('tag_ltd_neon',      'tag',   'Neon',                7000, 9106, true, 4, 'advent'),
  ('theme_ltd_sakura',  'theme', 'Kirschblüten Deluxe', 11000, 9107, true, 4, 'shop'),
  ('theme_ltd_lava',    'theme', 'Lava',                10000, 9108, true, 4, 'both'),
  ('theme_ltd_matrix',  'theme', 'Matrix',              9000, 9109, true, 4, 'advent')
on conflict (id) do update set name = excluded.name, limited = excluded.limited, source = excluded.source, price = excluded.price;

-- ===== 0087_boardgames.sql =====
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

-- ===== 0088_stocks.sql =====
-- 0088: Börse. Echte Aktienkurse (der Browser holt sie über einen Finnhub-Schlüssel, den der Admin einträgt) gegen Coins handeln.
-- Kurse werden nur übernommen, wenn mindestens 2 verschiedene Personen (oder der Admin) einen ähnlichen Wert melden. Wiederholbar.

create table if not exists public.stock_config (key text primary key, value text not null);
alter table public.stock_config enable row level security;
create table if not exists public.stock_symbols (symbol text primary key check (symbol ~ '^[A-Z0-9.\-]{1,12}$'), name text not null, sort integer not null default 0);
alter table public.stock_symbols enable row level security;
create table if not exists public.stock_quotes (symbol text primary key references public.stock_symbols(symbol) on delete cascade, price_cents bigint not null, prev_close_cents bigint not null, updated_at timestamptz not null default now());
alter table public.stock_quotes enable row level security;
create table if not exists public.stock_reports (symbol text not null references public.stock_symbols(symbol) on delete cascade, user_id uuid not null references auth.users(id) on delete cascade, price_cents bigint not null, prev_close_cents bigint not null, is_admin boolean not null default false, at timestamptz not null default now(), primary key (symbol, user_id));
alter table public.stock_reports enable row level security;
create table if not exists public.stock_holdings (user_id uuid not null references auth.users(id) on delete cascade, symbol text not null references public.stock_symbols(symbol) on delete cascade, shares bigint not null check (shares >= 0), cost bigint not null default 0, primary key (user_id, symbol));
alter table public.stock_holdings enable row level security;
create table if not exists public.stock_trades (id bigserial primary key, user_id uuid not null references auth.users(id) on delete cascade, symbol text not null, side text not null check (side in ('buy','sell')), shares bigint not null, unit_koins bigint not null, fee bigint not null, total bigint not null, at timestamptz not null default now());
alter table public.stock_trades enable row level security;
create index if not exists stock_trades_user_idx on public.stock_trades (user_id, at desc);

insert into public.app_settings (key, value, mod_editable) values
  ('stock_koin_per_usd', 10, false), ('stock_fee_permille', 10, false), ('stock_max_age_min', 15, false), ('stock_min_reporters', 2, false)
on conflict (key) do nothing;

create or replace function public._lock_keys()
returns text[]
language sql
immutable
set search_path = public
as $$
  select array['games', 'gambling', 'sprint', 'duels', 'chat', 'shop', 'quests', 'print',
               'parkour', 'learn', 'copy', 'cards', 'cram', 'test', 'practice', 'grammar', 'irregular', 'conjugate', 'gender',
               'books', 'search', 'math', 'memorize', 'homework', 'advent', 'ranking', 'stats', 'presence', 'websites', 'plus',
               'board', 'feedback', 'loot', 'online', 'stocks'];
$$;
alter table public.feature_locks drop constraint if exists feature_locks_key_check;
alter table public.feature_locks add constraint feature_locks_key_check check (key = any (public._lock_keys()));

-- Gutschriften beim Verkauf laufen mit dem strikten Grund 'pay_in' (kein Plus-Bonus), Ref 'stock_sell:KÜRZEL'.

-- Verwaltung ------------------------------------------------------------------------------------
drop function if exists public.admin_stock_get_key();
create or replace function public.admin_stock_get_key()
returns text language plpgsql stable security definer set search_path = public as $$
begin
  perform public._require_admin();
  return coalesce((select value from public.stock_config where key = 'finnhub'), '');
end;
$$;

drop function if exists public.admin_stock_set_key(text);
create or replace function public.admin_stock_set_key(p_key text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public._require_admin();
  if p_key is null or btrim(p_key) = '' then
    delete from public.stock_config where key = 'finnhub';
  else
    insert into public.stock_config (key, value) values ('finnhub', btrim(p_key)) on conflict (key) do update set value = excluded.value;
  end if;
end;
$$;

drop function if exists public.admin_stock_save(text, text);
create or replace function public.admin_stock_save(p_symbol text, p_name text)
returns void language plpgsql security definer set search_path = public as $$
declare v_s text := upper(btrim(coalesce(p_symbol, '')));
begin
  perform public._require_admin();
  if v_s !~ '^[A-Z0-9.\-]{1,12}$' then raise exception 'Ungültiges Kürzel.' using errcode = '22023'; end if;
  insert into public.stock_symbols (symbol, name, sort) values (v_s, left(btrim(coalesce(nullif(p_name, ''), v_s)), 60), (select coalesce(max(sort), 0) + 1 from public.stock_symbols))
  on conflict (symbol) do update set name = excluded.name;
end;
$$;

drop function if exists public.admin_stock_remove(text);
create or replace function public.admin_stock_remove(p_symbol text)
returns integer language plpgsql security definer set search_path = public as $$
declare r record; v_n integer := 0;
begin
  perform public._require_admin();
  -- Bestände werden zum letzten Kurs ausgezahlt (ohne Gebühr), dann wird die Aktie entfernt.
  for r in select h.user_id, h.shares, h.cost from public.stock_holdings h where h.symbol = upper(p_symbol) and h.shares > 0 loop
    perform public._grant_koins(r.user_id, r.cost, 'pay_in', 'stock_sell:' || upper(p_symbol));
    v_n := v_n + 1;
  end loop;
  delete from public.stock_symbols where symbol = upper(p_symbol);
  return v_n;
end;
$$;

-- Kurse -----------------------------------------------------------------------------------------
drop function if exists public.stock_config();
create or replace function public.stock_config()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public._og_check();
  perform public._feature_guard('stocks');
  return jsonb_build_object(
    'key', coalesce((select value from public.stock_config where key = 'finnhub'), ''),
    'symbols', coalesce((select jsonb_agg(symbol order by sort) from public.stock_symbols), '[]'::jsonb),
    'rate', public.setting('stock_koin_per_usd'), 'fee_permille', public.setting('stock_fee_permille'));
end;
$$;

drop function if exists public.stock_report(text, numeric, numeric);
create or replace function public.stock_report(p_symbol text, p_price numeric, p_prev numeric)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := public._og_check();
  v_p bigint; v_pc bigint; v_med bigint; v_n integer; v_adm boolean := public.is_admin();
  v_need integer := greatest(public.setting('stock_min_reporters'), 1);
begin
  perform public._feature_guard('stocks');
  if not exists (select 1 from public.stock_symbols where symbol = p_symbol) then return; end if;
  if p_price is null or p_price <= 0 or p_price > 10000000 then raise exception 'Ungültiger Kurs.' using errcode = '22023'; end if;
  v_p := round(p_price * 100)::bigint;
  v_pc := case when p_prev is null or p_prev <= 0 or p_prev > 10000000 then v_p else round(p_prev * 100)::bigint end;
  insert into public.stock_reports (symbol, user_id, price_cents, prev_close_cents, is_admin, at)
  values (p_symbol, v_me, v_p, v_pc, v_adm, now())
  on conflict (symbol, user_id) do update set price_cents = excluded.price_cents, prev_close_cents = excluded.prev_close_cents, is_admin = excluded.is_admin, at = now();
  delete from public.stock_reports where at < now() - interval '1 hour';
  -- Admin-Meldung gilt allein; sonst müssen genug verschiedene Personen ähnliche Werte (±1 %) melden.
  if v_adm then
    v_med := v_p;
  else
    select count(*), (percentile_disc(0.5) within group (order by price_cents))::bigint into v_n, v_med
      from public.stock_reports where symbol = p_symbol and at > now() - interval '5 minutes';
    if v_n < v_need then return; end if;
    select count(*) into v_n from public.stock_reports
     where symbol = p_symbol and at > now() - interval '5 minutes' and abs(price_cents - v_med) <= greatest(v_med / 100, 1);
    if v_n < v_need then return; end if;
  end if;
  insert into public.stock_quotes (symbol, price_cents, prev_close_cents, updated_at) values (p_symbol, v_med, v_pc, now())
  on conflict (symbol) do update set price_cents = excluded.price_cents, prev_close_cents = excluded.prev_close_cents, updated_at = now();
end;
$$;

drop function if exists public.stock_list();
create or replace function public.stock_list()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_me uuid := public._og_check(); v_age integer := greatest(public.setting('stock_max_age_min'), 1);
begin
  perform public._feature_guard('stocks');
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'symbol', s.symbol, 'name', s.name,
      'price_cents', q.price_cents, 'prev_close_cents', q.prev_close_cents, 'updated_at', q.updated_at,
      'fresh', coalesce(q.updated_at > now() - make_interval(mins => v_age), false),
      'unit_koins', case when q.price_cents is null then null else greatest(1, round(q.price_cents * public.setting('stock_koin_per_usd') / 100.0))::bigint end,
      'shares', coalesce(h.shares, 0), 'cost', coalesce(h.cost, 0)) order by s.sort)
    from public.stock_symbols s
    left join public.stock_quotes q on q.symbol = s.symbol
    left join public.stock_holdings h on h.symbol = s.symbol and h.user_id = v_me), '[]'::jsonb);
end;
$$;

drop function if exists public.stock_trade(text, text, bigint);
create or replace function public.stock_trade(p_symbol text, p_side text, p_shares bigint)
returns bigint language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := public._og_check();
  q public.stock_quotes; h public.stock_holdings;
  v_unit bigint; v_gross bigint; v_fee bigint; v_bal bigint; v_cost_part bigint;
  v_age integer := greatest(public.setting('stock_max_age_min'), 1);
begin
  perform public._feature_guard('stocks');
  if p_side not in ('buy', 'sell') or p_shares is null or p_shares < 1 or p_shares > 1000000 then raise exception 'Ungültige Menge.' using errcode = '22023'; end if;
  select * into q from public.stock_quotes where symbol = p_symbol;
  if q.symbol is null or q.updated_at < now() - make_interval(mins => v_age) then
    raise exception 'Für diese Aktie gibt es gerade keinen aktuellen Kurs. Handel ist erst wieder möglich, wenn der Kurs bestätigt ist.' using errcode = '55000';
  end if;
  v_unit := greatest(1, round(q.price_cents * public.setting('stock_koin_per_usd') / 100.0))::bigint;
  v_gross := v_unit * p_shares;
  v_fee := ceil(v_gross * public.setting('stock_fee_permille') / 1000.0)::bigint;
  perform pg_advisory_xact_lock(hashtext('stock:' || v_me::text));
  if p_side = 'buy' then
    v_bal := public._grant_koins(v_me, -(v_gross + v_fee), 'stock_buy', p_symbol);
    insert into public.stock_holdings (user_id, symbol, shares, cost) values (v_me, p_symbol, p_shares, v_gross)
    on conflict (user_id, symbol) do update set shares = public.stock_holdings.shares + excluded.shares, cost = public.stock_holdings.cost + excluded.cost;
  else
    select * into h from public.stock_holdings where user_id = v_me and symbol = p_symbol for update;
    if h.user_id is null or h.shares < p_shares then raise exception 'So viele Aktien besitzt du nicht.' using errcode = '23514'; end if;
    v_cost_part := (h.cost * p_shares) / h.shares;
    update public.stock_holdings set shares = shares - p_shares, cost = cost - v_cost_part where user_id = v_me and symbol = p_symbol;
    v_bal := public._grant_koins(v_me, v_gross - v_fee, 'pay_in', 'stock_sell:' || p_symbol);
  end if;
  insert into public.stock_trades (user_id, symbol, side, shares, unit_koins, fee, total) values (v_me, p_symbol, p_side, p_shares, v_unit, v_fee, v_gross);
  return v_bal;
end;
$$;

drop function if exists public.stock_history();
create or replace function public.stock_history()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public._og_check();
  return coalesce((select jsonb_agg(to_jsonb(t)) from (select symbol, side, shares, unit_koins, fee, total, at from public.stock_trades where user_id = auth.uid() order by at desc limit 30) t), '[]'::jsonb);
end;
$$;

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and (p.proname like 'stock\_%' or p.proname like 'admin\_stock\_%' or p.proname in ('_lock_keys'))
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    if left(r.proname, 1) <> '_' then
      execute format('grant execute on function %s to authenticated', r.sig);
    end if;
  end loop;
end;
$$;

-- ===== 0089_stocks_sim.sql =====
-- 0089: Börse vereinfacht. Keine echten Kurse mehr: der Server simuliert die Preise selbst (läuft immer, braucht keinen Schlüssel).
-- Jede Aktie hat einen Grundpreis in Coins; der Kurs schwankt zufällig im Minutentakt um diesen Grundpreis. Wiederholbar.

do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'stock_symbols' and column_name = 'base_cents') then
    alter table public.stock_symbols add column base_cents bigint;
    -- bisherige Dollar-Kurse werden zu Coins (Faktor wie bisher eingestellt)
    update public.stock_symbols s set base_cents = greatest(coalesce((select q.price_cents from public.stock_quotes q where q.symbol = s.symbol), 10000) * greatest(public.setting('stock_koin_per_usd'), 1), 100);
    update public.stock_quotes q set price_cents = greatest(price_cents * greatest(public.setting('stock_koin_per_usd'), 1), 100), prev_close_cents = greatest(prev_close_cents * greatest(public.setting('stock_koin_per_usd'), 1), 100) where true;
  end if;
end $$;
alter table public.stock_symbols alter column base_cents set default 100000;
update public.stock_symbols set base_cents = 100000 where base_cents is null;
alter table public.stock_symbols alter column base_cents set not null;

insert into public.app_settings (key, value, mod_editable) values ('stock_volatility_permille', 15, false)
on conflict (key) do nothing;

drop function if exists public.stock_report(text, numeric, numeric);
drop function if exists public.stock_config();
drop function if exists public.admin_stock_get_key();
drop function if exists public.admin_stock_set_key(text);
drop function if exists public.admin_stock_save(text, text);
drop function if exists public._stock_tick();

-- Kurse bis jetzt weiterrechnen (höchstens 120 Minuten-Schritte am Stück).
create or replace function public._stock_tick()
returns void language plpgsql security definer set search_path = public as $$
declare
  s record; q public.stock_quotes; v_steps integer; v_p numeric; i integer;
  v_vol numeric := greatest(public.setting('stock_volatility_permille'), 0) / 1000.0;
  v_today date := (now() at time zone 'Europe/Berlin')::date;
begin
  perform pg_advisory_xact_lock(hashtext('stock_tick'));
  for s in select symbol, base_cents from public.stock_symbols loop
    select * into q from public.stock_quotes where symbol = s.symbol;
    if q.symbol is null then
      insert into public.stock_quotes (symbol, price_cents, prev_close_cents, updated_at) values (s.symbol, s.base_cents, s.base_cents, now());
      continue;
    end if;
    v_steps := least(120, floor(extract(epoch from now() - q.updated_at) / 60)::integer);
    if v_steps < 1 then continue; end if;
    v_p := q.price_cents;
    for i in 1..v_steps loop
      -- Zufallsschritt (ungefähr glockenförmig) plus leichter Zug zurück zum Grundpreis
      v_p := v_p * (1 + (random() + random() + random() - 1.5) * 2 * v_vol) + (s.base_cents - v_p) * 0.02;
      v_p := least(greatest(v_p, s.base_cents * 0.2, 100), s.base_cents * 5);
    end loop;
    update public.stock_quotes
       set price_cents = round(v_p),
           prev_close_cents = case when (q.updated_at at time zone 'Europe/Berlin')::date < v_today then q.price_cents else q.prev_close_cents end,
           updated_at = case when v_steps >= 120 then now() else q.updated_at + v_steps * interval '1 minute' end
     where symbol = s.symbol;
  end loop;
end;
$$;

create or replace function public.admin_stock_save(p_symbol text, p_name text, p_price integer)
returns void language plpgsql security definer set search_path = public as $$
declare v_s text := upper(btrim(coalesce(p_symbol, '')));
begin
  perform public._require_admin();
  if v_s !~ '^[A-Z0-9.\-]{1,12}$' then raise exception 'Ungültiges Kürzel.' using errcode = '22023'; end if;
  if p_price is null or p_price < 1 or p_price > 100000000 then raise exception 'Der Preis muss zwischen 1 und 100.000.000 Coins liegen.' using errcode = '22023'; end if;
  insert into public.stock_symbols (symbol, name, sort, base_cents)
  values (v_s, left(btrim(coalesce(nullif(p_name, ''), v_s)), 60), (select coalesce(max(sort), 0) + 1 from public.stock_symbols), p_price::bigint * 100)
  on conflict (symbol) do update set name = excluded.name, base_cents = excluded.base_cents;
  insert into public.stock_quotes (symbol, price_cents, prev_close_cents, updated_at) values (v_s, p_price::bigint * 100, p_price::bigint * 100, now())
  on conflict (symbol) do nothing;
end;
$$;

drop function if exists public.stock_list();
create or replace function public.stock_list()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_me uuid := public._og_check();
begin
  perform public._feature_guard('stocks');
  perform public._stock_tick();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'symbol', s.symbol, 'name', s.name,
      'price_cents', q.price_cents, 'prev_close_cents', q.prev_close_cents, 'updated_at', q.updated_at,
      'fresh', true,
      'unit_koins', greatest(1, round(q.price_cents / 100.0))::bigint,
      'base_koins', greatest(1, round(s.base_cents / 100.0))::bigint,
      'shares', coalesce(h.shares, 0), 'cost', coalesce(h.cost, 0)) order by s.sort)
    from public.stock_symbols s
    join public.stock_quotes q on q.symbol = s.symbol
    left join public.stock_holdings h on h.symbol = s.symbol and h.user_id = v_me), '[]'::jsonb);
end;
$$;

drop function if exists public.stock_trade(text, text, bigint);
create or replace function public.stock_trade(p_symbol text, p_side text, p_shares bigint)
returns bigint language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := public._og_check();
  q public.stock_quotes; h public.stock_holdings;
  v_unit bigint; v_gross bigint; v_fee bigint; v_bal bigint; v_cost_part bigint;
begin
  perform public._feature_guard('stocks');
  if p_side not in ('buy', 'sell') or p_shares is null or p_shares < 1 or p_shares > 1000000 then raise exception 'Ungültige Menge.' using errcode = '22023'; end if;
  perform public._stock_tick();
  select * into q from public.stock_quotes where symbol = p_symbol;
  if q.symbol is null then raise exception 'Diese Aktie gibt es nicht.' using errcode = '22023'; end if;
  v_unit := greatest(1, round(q.price_cents / 100.0))::bigint;
  v_gross := v_unit * p_shares;
  v_fee := ceil(v_gross * public.setting('stock_fee_permille') / 1000.0)::bigint;
  perform pg_advisory_xact_lock(hashtext('stock:' || v_me::text));
  if p_side = 'buy' then
    v_bal := public._grant_koins(v_me, -(v_gross + v_fee), 'stock_buy', p_symbol);
    insert into public.stock_holdings (user_id, symbol, shares, cost) values (v_me, p_symbol, p_shares, v_gross)
    on conflict (user_id, symbol) do update set shares = public.stock_holdings.shares + excluded.shares, cost = public.stock_holdings.cost + excluded.cost;
  else
    select * into h from public.stock_holdings where user_id = v_me and symbol = p_symbol for update;
    if h.user_id is null or h.shares < p_shares then raise exception 'So viele Aktien besitzt du nicht.' using errcode = '23514'; end if;
    v_cost_part := (h.cost * p_shares) / h.shares;
    update public.stock_holdings set shares = shares - p_shares, cost = cost - v_cost_part where user_id = v_me and symbol = p_symbol;
    v_bal := public._grant_koins(v_me, v_gross - v_fee, 'pay_in', 'stock_sell:' || p_symbol);
  end if;
  insert into public.stock_trades (user_id, symbol, side, shares, unit_koins, fee, total) values (v_me, p_symbol, p_side, p_shares, v_unit, v_fee, v_gross);
  return v_bal;
end;
$$;

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and (p.proname like 'stock\_%' or p.proname like '\_stock\_%' or p.proname like 'admin\_stock\_%')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    if left(r.proname, 1) <> '_' then
      execute format('grant execute on function %s to authenticated', r.sig);
    end if;
  end loop;
end;
$$;

-- ===== 0090_cars.sql =====
-- 0090: Autohaus. Autos mit Bild gegen Coins kaufen, Garage, Preise in der Verwaltung. Wiederholbar.

create table if not exists public.cars (
  id text primary key check (id ~ '^[a-z0-9_]{2,30}$'),
  name text not null,
  kind text not null,
  color text not null default '#ef4444',
  price bigint not null check (price >= 0),
  sort integer not null default 0,
  active boolean not null default true
);
alter table public.cars enable row level security;
create table if not exists public.car_owned (
  user_id uuid not null references auth.users(id) on delete cascade,
  car_id text not null references public.cars(id) on delete cascade,
  bought_at timestamptz not null default now(),
  paid bigint not null default 0,
  primary key (user_id, car_id)
);
alter table public.car_owned enable row level security;

insert into public.cars (id, name, kind, color, price, sort) values
  ('flitzer',   'Flitzer',        'kleinwagen', '#f59e0b',    500, 1),
  ('stadtfloh', 'Stadtfloh',      'kleinwagen', '#22c55e',    800, 2),
  ('kombi',     'Familienkombi',  'kombi',      '#3b82f6',   2000, 3),
  ('limousine', 'Limousine',      'limousine',  '#1e293b',   5000, 4),
  ('gelaende',  'Geländekönig',   'suv',        '#a16207',   8000, 5),
  ('pickup',    'Packesel',       'pickup',     '#dc2626',  10000, 6),
  ('cabrio',    'Sonnenschein',   'cabrio',     '#ec4899',  20000, 7),
  ('sportler',  'Blitz GT',       'sportwagen', '#ef4444',  50000, 8),
  ('bus',       'Partybus',       'bus',        '#a855f7', 100000, 9)
on conflict (id) do nothing;

create or replace function public._lock_keys()
returns text[]
language sql
immutable
set search_path = public
as $$
  select array['games', 'gambling', 'sprint', 'duels', 'chat', 'shop', 'quests', 'print',
               'parkour', 'learn', 'copy', 'cards', 'cram', 'test', 'practice', 'grammar', 'irregular', 'conjugate', 'gender',
               'books', 'search', 'math', 'memorize', 'homework', 'advent', 'ranking', 'stats', 'presence', 'websites', 'plus',
               'board', 'feedback', 'loot', 'online', 'stocks', 'cars'];
$$;
alter table public.feature_locks drop constraint if exists feature_locks_key_check;
alter table public.feature_locks add constraint feature_locks_key_check check (key = any (public._lock_keys()));

drop function if exists public.car_list();
create or replace function public.car_list()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_me uuid := public._og_check();
begin
  perform public._feature_guard('cars');
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'kind', c.kind, 'color', c.color, 'price', c.price, 'active', c.active, 'owned', o.user_id is not null) order by c.sort)
    from public.cars c left join public.car_owned o on o.car_id = c.id and o.user_id = v_me
    where c.active or o.user_id is not null), '[]'::jsonb);
end;
$$;

drop function if exists public.car_buy(text);
create or replace function public.car_buy(p_id text)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_me uuid := public._og_check(); c public.cars; v_bal bigint;
begin
  perform public._feature_guard('cars');
  select * into c from public.cars where id = p_id and active;
  if c.id is null then raise exception 'Dieses Auto gibt es nicht.' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtext('car:' || v_me::text));
  if exists (select 1 from public.car_owned where user_id = v_me and car_id = c.id) then raise exception 'Das Auto steht schon in deiner Garage.' using errcode = '23505'; end if;
  v_bal := public._grant_koins(v_me, -c.price, 'shop', 'car:' || c.id);
  insert into public.car_owned (user_id, car_id, paid) values (v_me, c.id, c.price);
  return v_bal;
end;
$$;

drop function if exists public.admin_car_set(text, bigint, boolean);
create or replace function public.admin_car_set(p_id text, p_price bigint, p_active boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public._require_admin();
  if p_price is null or p_price < 0 or p_price > 1000000000 then raise exception 'Ungültiger Preis.' using errcode = '22023'; end if;
  update public.cars set price = p_price, active = coalesce(p_active, active) where id = p_id;
end;
$$;

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and (p.proname in ('car_list', 'car_buy', 'admin_car_set', '_lock_keys'))
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    if left(r.proname, 1) <> '_' then
      execute format('grant execute on function %s to authenticated', r.sig);
    end if;
  end loop;
end;
$$;

-- ===== 0091_gambling_overflow_fix.sql =====
-- 0091: Gambling gegen Überlauf („bigint out of range“) abgesichert. Wiederholbar. Nach 0090 ausführen.
-- Ursache: Der Hausschutz (_house_squeeze) rechnete (Einsätze − Gewinne) × 1000 in bigint. Nach sehr hohen Einsätzen in den letzten
-- 3 Tagen lief das über, und dann scheiterte JEDES Spiel. Jetzt rechnet alles mit numeric und wird auf den bigint-Bereich begrenzt.

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

-- Hausschutz: numeric statt bigint; ein einzelner Eintrag zählt höchstens mit 1.000.000.000.000 Coins (ein Ausreißer verzerrt die Quote nicht).
create or replace function public._house_squeeze()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_max integer := least(greatest(public.setting('gambling_guard_max_permille'), 0), 1000);
  v_target integer := public.setting('gambling_guard_target_permille');
  v_w numeric;
  v_p numeric;
  v_margin numeric;
begin
  if v_max = 0 then return false; end if;
  select coalesce(sum(least(bet, 1000000000000)), 0), coalesce(sum(least(payout, 1000000000000)), 0) into v_w, v_p
    from public.gambling_feed where created_at > now() - interval '3 days';
  if v_w <= 0 or v_w < public.setting('gambling_guard_min_wagered') then return false; end if;
  v_margin := ((v_w - v_p) * 1000) / v_w;
  if v_margin >= v_target then return false; end if;
  return random() * 1000 < least(v_max, v_target - v_margin);
end;
$$;

-- Statistik und Feed: Summen werden auf 9 Trillionen (bigint-Grenze) begrenzt, statt zu überlaufen.
create or replace function public._gamble_settle(p_user uuid, p_bet bigint, p_payout bigint, p_jackpot boolean)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance bigint;
begin
  v_balance := public._grant_koins(p_user, -p_bet, 'gambling_bet', null);
  if p_payout > 0 then
    v_balance := public._grant_koins(p_user, p_payout, 'gambling_win', null);
  end if;
  insert into public.gambling_feed (user_id, bet, payout, jackpot) values (p_user, p_bet, p_payout, p_jackpot);
  delete from public.gambling_feed where created_at < now() - interval '3 days';
  insert into public.gambling_stats (user_id, plays, wagered, won, best_win)
  values (p_user, 1, p_bet, p_payout, p_payout)
  on conflict (user_id) do update
    set plays = least(public.gambling_stats.plays::bigint + 1, 2000000000)::integer,
        wagered = least(public.gambling_stats.wagered::numeric + p_bet, 4000000000000000000)::bigint,
        won = least(public.gambling_stats.won::numeric + p_payout, 4000000000000000000)::bigint,
        best_win = greatest(public.gambling_stats.best_win, p_payout);
  return v_balance;
end;
$$;

create or replace function public._bj_finish(p_user uuid, p_bet bigint, p_payout bigint)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance bigint;
begin
  delete from public.blackjack_hands where user_id = p_user;
  if p_payout > 0 then
    v_balance := public._grant_koins(p_user, p_payout, 'gambling_win', null);
  else
    v_balance := coalesce((select balance from public.koin_wallets where user_id = p_user), 0);
  end if;
  insert into public.gambling_feed (user_id, bet, payout, jackpot) values (p_user, p_bet, p_payout, false);
  delete from public.gambling_feed where created_at < now() - interval '3 days';
  insert into public.gambling_stats (user_id, plays, wagered, won, best_win)
  values (p_user, 1, p_bet, p_payout, p_payout)
  on conflict (user_id) do update
    set plays = least(public.gambling_stats.plays::bigint + 1, 2000000000)::integer,
        wagered = least(public.gambling_stats.wagered::numeric + p_bet, 4000000000000000000)::bigint,
        won = least(public.gambling_stats.won::numeric + p_payout, 4000000000000000000)::bigint,
        best_win = greatest(public.gambling_stats.best_win, p_payout);
  return v_balance;
end;
$$;

-- Rangliste: Bilanz (Gewonnen − Gesetzt) in numeric rechnen und begrenzen.
drop function if exists public.get_gambling_board();
create or replace function public.get_gambling_board()
returns table (rank integer, user_id uuid, display_name text, avatar_id text, color_id text, effect_id text, role text,
               tag_id text, theme_id text, plays integer, wagered bigint, won bigint, net bigint, best_win bigint, is_me boolean)
language sql
stable
security definer
set search_path = public
as $$
  select (row_number() over (order by (s.won::numeric - s.wagered) desc, p.display_name))::integer,
         p.id, p.display_name, p.avatar_id, p.color_id, p.effect_id,
         case when p.tags_hidden then 'user' else p.role end,
         case when p.tags_hidden then null else p.tag_id end,
         p.theme_id, s.plays, s.wagered, s.won,
         greatest(least(s.won::numeric - s.wagered, 9000000000000000000), -9000000000000000000)::bigint,
         s.best_win, (p.id = (select auth.uid()))
    from public.gambling_stats s
    join public.profiles p on p.id = s.user_id
   where (select auth.uid()) is not null and not public.is_blocked() and not p.blocked and s.plays > 0
   order by (s.won::numeric - s.wagered) desc, p.display_name
   limit 200;
$$;

-- Zurücksetzen löscht jetzt auch die Feed-Einträge (sonst wirken riesige Einsätze 3 Tage lang im Hausschutz weiter).
create or replace function public.admin_gambling_reset(p_user uuid default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare v_n integer;
begin
  perform public._require_admin();
  delete from public.gambling_stats where p_user is null or user_id = p_user;
  get diagnostics v_n = row_count;
  delete from public.gambling_feed where p_user is null or user_id = p_user;
  return v_n;
end;
$$;

-- Auszahlungs-Vergleiche und Slot-Gewinn ohne Überlauf (auch bei Einsatz = ganzes Höchstguthaben).
select public._patch_fn('gambling_dice', $a$v_pay >= p_bet::bigint * 10$a$, $b$v_pay::numeric >= p_bet::numeric * 10$b$);
select public._patch_fn('gambling_roulette', $a$v_pay >= v_total * 10$a$, $b$v_pay::numeric >= v_total::numeric * 10$b$);
select public._patch_fn('gambling_play', $a$v_payout := p_bet::bigint * v_mult;$a$, $b$v_payout := least(p_bet::numeric * v_mult, 9000000000000000)::bigint;$b$);

-- Rechte setzen.
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('_house_squeeze', '_gamble_settle', '_bj_finish', 'get_gambling_board', 'admin_gambling_reset', '_patch_fn')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    if r.proname in ('get_gambling_board', 'admin_gambling_reset') then
      execute format('grant execute on function %s to authenticated', r.sig);
    end if;
  end loop;
end;
$$;

-- ===== 0092_stocks_trend.sql =====
-- 0092: Börse mit Aufwärtstrend und Kursverlauf. Wiederholbar. Nach 0089 ausführen.
-- Die Kurse steigen im Schnitt um `stock_weekly_growth_percent` (Standard 50 %) pro Woche und schwanken zufällig darum.
-- Zusätzlich wird stündlich ein Kurspunkt gespeichert (für das Liniendiagramm, 120 Tage lang).

create table if not exists public.stock_history (
  symbol text not null references public.stock_symbols(symbol) on delete cascade,
  at timestamptz not null,
  price_cents bigint not null,
  primary key (symbol, at)
);
alter table public.stock_history enable row level security;

insert into public.app_settings (key, value, mod_editable) values ('stock_weekly_growth_percent', 50, false)
on conflict (key) do nothing;
-- Die alte Standard-Schwankung (15 ‰ pro Minute) war für einen Aufwärtstrend viel zu wild.
update public.app_settings set value = 2 where key = 'stock_volatility_permille' and value = 15;

drop function if exists public._stock_tick();
create or replace function public._stock_tick()
returns void language plpgsql security definer set search_path = public as $$
declare
  s record; q public.stock_quotes; v_steps integer; v_n integer; v_k numeric; v_p numeric; i integer;
  v_vol numeric := greatest(public.setting('stock_volatility_permille'), 0) / 1000.0;
  v_g numeric := greatest(public.setting('stock_weekly_growth_percent'), -90);
  v_d numeric;            -- Trend pro Minute (logarithmisch)
  v_t timestamptz; v_prev_h timestamptz; v_h timestamptz;
  v_today date := (now() at time zone 'Europe/Berlin')::date;
begin
  perform pg_advisory_xact_lock(hashtext('stock_tick'));
  v_d := ln(1 + v_g / 100.0) / 10080.0;
  for s in select symbol, base_cents from public.stock_symbols loop
    select * into q from public.stock_quotes where symbol = s.symbol;
    if q.symbol is null then
      insert into public.stock_quotes (symbol, price_cents, prev_close_cents, updated_at) values (s.symbol, s.base_cents, s.base_cents, now());
      insert into public.stock_history (symbol, at, price_cents) values (s.symbol, date_trunc('hour', now()), s.base_cents) on conflict do nothing;
      continue;
    end if;
    v_steps := least(40320, floor(extract(epoch from now() - q.updated_at) / 60)::integer);   -- höchstens 4 Wochen nachrechnen
    if v_steps < 1 then continue; end if;
    v_n := least(v_steps, 120);
    v_k := v_steps::numeric / v_n;                                                           -- Minuten pro Rechenschritt
    v_p := q.price_cents;
    v_prev_h := date_trunc('hour', q.updated_at);
    for i in 1..v_n loop
      v_p := v_p * exp(v_d * v_k + (random() + random() + random() - 1.5) * 2 * v_vol * sqrt(v_k));
      v_p := least(greatest(v_p, s.base_cents * 0.2, 100), 1000000000000);
      v_t := q.updated_at + (i * v_k) * interval '1 minute';
      v_h := date_trunc('hour', v_t);
      if v_h > v_prev_h then
        insert into public.stock_history (symbol, at, price_cents) values (s.symbol, v_h, round(v_p)) on conflict do nothing;
        v_prev_h := v_h;
      end if;
    end loop;
    update public.stock_quotes
       set price_cents = round(v_p),
           prev_close_cents = case when (q.updated_at at time zone 'Europe/Berlin')::date < v_today then q.price_cents else q.prev_close_cents end,
           updated_at = case when v_steps >= 40320 then now() else q.updated_at + v_steps * interval '1 minute' end
     where symbol = s.symbol;
  end loop;
  if random() < 0.02 then delete from public.stock_history where at < now() - interval '120 days'; end if;
end;
$$;

-- Verlauf einer Aktie: Liste aus {t: Sekunden seit 1970, p: Kurs in Coins}; days wird auf 1 bis 100 begrenzt.
drop function if exists public.stock_chart(text, integer);
create or replace function public.stock_chart(p_symbol text, p_days integer)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_days integer := least(greatest(coalesce(p_days, 5), 1), 100); v_out jsonb;
begin
  perform public._og_check();
  perform public._feature_guard('stocks');
  perform public._stock_tick();
  select coalesce(jsonb_agg(jsonb_build_object('t', extract(epoch from x.at)::bigint, 'p', round(x.price_cents / 100.0, 2)) order by x.at), '[]'::jsonb) into v_out
    from (
      select h.at, h.price_cents from public.stock_history h where h.symbol = p_symbol and h.at > now() - make_interval(days => v_days)
      union all
      select q.updated_at, q.price_cents from public.stock_quotes q where q.symbol = p_symbol
    ) x;
  return v_out;
end;
$$;

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('_stock_tick', 'stock_chart')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    if left(r.proname, 1) <> '_' then
      execute format('grant execute on function %s to authenticated', r.sig);
    end if;
  end loop;
end;
$$;

-- ===== 0093_backup.sql =====
-- 0093: Komplett-Backup als Datei (Download) und Wiederherstellen (Upload) für Admins. Wiederholbar. Nach 0092 ausführen.
-- Gesichert werden alle Tabellen im Schema public (Bücher, Vokabeln, Fortschritt, Coins, Shop, Chat, Einstellungen …),
-- neue Tabellen werden automatisch mitgenommen. NICHT enthalten sind die Anmeldedaten (auth.users: E-Mail/Passwort) – die bleiben bei Supabase.

drop function if exists public._backup_check(text);
create or replace function public._backup_check(p_table text)
returns void language plpgsql stable security definer set search_path = public as $$
begin
  perform public._require_admin();
  if not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                  where n.nspname = 'public' and c.relname = p_table and c.relkind = 'r' and not c.relispartition) then
    raise exception 'Unbekannte Tabelle.' using errcode = '22023';
  end if;
end;
$$;

-- Tabellen in einer Reihenfolge, in der Eltern vor Kindern stehen (wegen Fremdschlüsseln).
drop function if exists public.admin_backup_tables();
create or replace function public.admin_backup_tables()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_all text[]; v_done text[] := '{}'; v_left text[]; v_pick text[]; v_out jsonb := '[]'::jsonb; t text; v_n bigint;
begin
  perform public._require_admin();
  select coalesce(array_agg(c.relname::text order by c.relname), '{}') into v_all
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and not c.relispartition;
  v_left := v_all;
  while coalesce(array_length(v_left, 1), 0) > 0 loop
    select coalesce(array_agg(x), '{}') into v_pick from unnest(v_left) x
     where not exists (
       select 1 from pg_constraint k
        where k.contype = 'f' and k.conrelid = format('public.%I', x)::regclass and k.confrelid <> k.conrelid
          and (select n2.nspname from pg_class c2 join pg_namespace n2 on n2.oid = c2.relnamespace where c2.oid = k.confrelid) = 'public'
          and (select c2.relname::text from pg_class c2 where c2.oid = k.confrelid) = any (v_left));
    if coalesce(array_length(v_pick, 1), 0) = 0 then v_pick := v_left; end if;   -- Zyklus: Rest in Namensreihenfolge
    v_done := v_done || v_pick;
    select coalesce(array_agg(x), '{}') into v_left from unnest(v_left) x where not (x = any (v_pick));
  end loop;
  foreach t in array v_done loop
    execute format('select count(*) from public.%I', t) into v_n;
    v_out := v_out || jsonb_build_array(jsonb_build_object('name', t, 'rows', v_n));
  end loop;
  return v_out;
end;
$$;

drop function if exists public.admin_backup_read(text, integer, integer);
create or replace function public.admin_backup_read(p_table text, p_off integer, p_lim integer)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_pk text; v_out jsonb;
begin
  perform public._backup_check(p_table);
  select string_agg(format('%I', a.attname), ', ' order by array_position(i.indkey::int2[], a.attnum)) into v_pk
    from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any (i.indkey)
   where i.indrelid = format('public.%I', p_table)::regclass and i.indisprimary;
  execute format('select coalesce(jsonb_agg(to_jsonb(t)), ''[]''::jsonb) from (select * from public.%I order by %s offset %s limit %s) t',
                 p_table, coalesce(v_pk, 'ctid'), greatest(coalesce(p_off, 0), 0), least(greatest(coalesce(p_lim, 500), 1), 2000)) into v_out;
  return v_out;
end;
$$;

drop function if exists public.admin_backup_clear(text);
create or replace function public.admin_backup_clear(p_table text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public._backup_check(p_table);
  execute format('alter table public.%I disable trigger user', p_table);
  execute format('delete from public.%I where true', p_table);
  execute format('alter table public.%I enable trigger user', p_table);
end;
$$;

-- Zeilen einspielen: vorhandene Zeilen (gleicher Primärschlüssel) werden überschrieben, fehlende ergänzt.
-- Zeilen, deren Fremdschlüssel ins Leere zeigen (z. B. gelöschtes Konto), werden übersprungen und gezählt.
drop function if exists public.admin_backup_write(text, jsonb);
create or replace function public.admin_backup_write(p_table text, p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_reg regclass; v_cols text; v_pk text; v_set text; v_total integer; v_kept integer; r record; v_cond text; v_cs text; v_ps text; v_sql text;
begin
  perform public._backup_check(p_table);
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then raise exception 'Ungültige Daten.' using errcode = '22023'; end if;
  v_reg := format('public.%I', p_table)::regclass;
  select string_agg(format('%I', a.attname), ', ' order by a.attnum) into v_cols
    from pg_attribute a where a.attrelid = v_reg and a.attnum > 0 and not a.attisdropped and a.attgenerated = '' and a.attidentity <> 'a';
  select string_agg(format('%I', a.attname), ', ' order by array_position(i.indkey::int2[], a.attnum)) into v_pk
    from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any (i.indkey) where i.indrelid = v_reg and i.indisprimary;
  select string_agg(format('%I = excluded.%I', a.attname, a.attname), ', ' order by a.attnum) into v_set
    from pg_attribute a where a.attrelid = v_reg and a.attnum > 0 and not a.attisdropped and a.attgenerated = '' and a.attidentity <> 'a'
     and not exists (select 1 from pg_index i where i.indrelid = v_reg and i.indisprimary and a.attnum = any (i.indkey));

  execute 'drop table if exists _bk';
  execute format('create temp table _bk on commit drop as select * from jsonb_populate_recordset(null::public.%I, $1)', p_table) using p_rows;
  get diagnostics v_total = row_count;

  -- Fremdschlüssel prüfen (nur auf Tabellen in public/auth; Selbstbezüge werden nicht gefiltert)
  for r in select k.oid as koid, k.confrelid from pg_constraint k
            where k.contype = 'f' and k.conrelid = v_reg and k.confrelid <> k.conrelid
              and (select n.nspname from pg_class c join pg_namespace n on n.oid = c.relnamespace where c.oid = k.confrelid) in ('public', 'auth')
  loop
    select string_agg(format('b.%I is not null', a.attname), ' and '), string_agg(format('p.%I = b.%I', pa.attname, a.attname), ' and ')
      into v_cs, v_ps
      from pg_constraint k
      cross join lateral unnest(k.conkey, k.confkey) as u(ca, pa_)
      join pg_attribute a on a.attrelid = k.conrelid and a.attnum = u.ca
      join pg_attribute pa on pa.attrelid = k.confrelid and pa.attnum = u.pa_
     where k.oid = r.koid;
    v_cond := format('delete from _bk b where %s and not exists (select 1 from %s p where %s)', v_cs, r.confrelid::regclass, v_ps);
    execute v_cond;
  end loop;
  select count(*) into v_kept from _bk;

  execute format('alter table public.%I disable trigger user', p_table);
  v_sql := format('insert into public.%I (%s) select %s from _bk', p_table, v_cols, v_cols);
  if v_pk is not null then
    v_sql := v_sql || format(' on conflict (%s) do %s', v_pk, case when v_set is null then 'nothing' else 'update set ' || v_set end);
  end if;
  execute v_sql;
  execute format('alter table public.%I enable trigger user', p_table);

  -- Zähler (Serial/Identity) hinter die höchste Zahl setzen
  for r in select a.attname, pg_get_serial_sequence(format('public.%I', p_table), a.attname) as seq
             from pg_attribute a where a.attrelid = v_reg and a.attnum > 0 and not a.attisdropped
  loop
    if r.seq is not null then
      execute format('select setval(%L, greatest((select coalesce(max(%I), 0) from public.%I), 1))', r.seq, r.attname, p_table);
    end if;
  end loop;
  return jsonb_build_object('rows', v_total, 'written', v_kept, 'skipped', v_total - v_kept);
end;
$$;

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('_backup_check', 'admin_backup_tables', 'admin_backup_read', 'admin_backup_clear', 'admin_backup_write')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    if left(r.proname, 1) <> '_' then
      execute format('grant execute on function %s to authenticated', r.sig);
    end if;
  end loop;
end;
$$;

-- ===== 0094_migration_tools.sql =====
-- 0094: Umzug in ein neues Supabase-Projekt. Wiederholbar. Nach 0093 ausführen.
--  * admin_accounts_export(): Konten (auth.users + auth.identities, inkl. Passwort-Hashes) für die Backup-Datei (nur Admin).
--  * migration_bootstrap(): legt die Konten in einem LEEREN Projekt wieder an (nur solange es dort noch kein einziges Konto gibt),
--    damit man sich danach mit den alten Zugangsdaten als Admin anmelden und das Backup einspielen kann.

drop function if exists public.admin_accounts_export();
create or replace function public.admin_accounts_export()
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform public._require_admin();
  return jsonb_build_object(
    'users', coalesce((select jsonb_agg(to_jsonb(u)) from auth.users u), '[]'::jsonb),
    'identities', coalesce((select jsonb_agg(to_jsonb(i)) from auth.identities i), '[]'::jsonb),
    'admins', coalesce((select jsonb_agg(p.id) from public.profiles p where p.role = 'admin'), '[]'::jsonb));
end;
$$;

drop function if exists public.migration_bootstrap(jsonb, jsonb, jsonb);
create or replace function public.migration_bootstrap(p_users jsonb, p_identities jsonb, p_admins jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_cols text; v_sel text; v_n integer; v_i integer := 0;
begin
  if exists (select 1 from auth.users) or exists (select 1 from public.profiles) then
    raise exception 'Dieses Projekt ist nicht leer. Der Umzug der Konten geht nur in einem neuen, leeren Projekt.' using errcode = '55000';
  end if;
  if jsonb_typeof(p_users) <> 'array' or jsonb_array_length(p_users) = 0 then raise exception 'Keine Konten in der Datei.' using errcode = '22023'; end if;

  select string_agg(quote_ident(column_name), ', ' order by ordinal_position) into v_cols
    from information_schema.columns where table_schema = 'auth' and table_name = 'users' and is_generated = 'NEVER' and column_name <> 'instance_id';
  execute format($f$insert into auth.users (instance_id, %s) select '00000000-0000-0000-0000-000000000000'::uuid, %s from jsonb_populate_recordset(null::auth.users, $1) on conflict do nothing$f$, v_cols, v_cols) using p_users;
  get diagnostics v_n = row_count;

  if p_identities is not null and jsonb_typeof(p_identities) = 'array' and jsonb_array_length(p_identities) > 0 then
    select string_agg(quote_ident(column_name), ', ' order by ordinal_position) into v_cols
      from information_schema.columns where table_schema = 'auth' and table_name = 'identities' and is_generated = 'NEVER';
    select string_agg(case when column_name = 'id' then 'coalesce(i.id, gen_random_uuid())' else 'i.' || quote_ident(column_name) end, ', ' order by ordinal_position) into v_sel
      from information_schema.columns where table_schema = 'auth' and table_name = 'identities' and is_generated = 'NEVER';
    execute format($f$insert into auth.identities (%s) select %s from jsonb_populate_recordset(null::auth.identities, $1) i where exists (select 1 from auth.users u where u.id = i.user_id) on conflict do nothing$f$, v_cols, v_sel) using p_identities;
    get diagnostics v_i = row_count;
  end if;

  -- Der Trigger hat Profile angelegt (noch nicht freigeschaltet): jetzt alle freischalten, Admins wieder zu Admins machen.
  update public.profiles set approved = true where true;
  if p_admins is not null and jsonb_typeof(p_admins) = 'array' then
    update public.profiles set role = 'admin' where id::text in (select jsonb_array_elements_text(p_admins));
  end if;
  return jsonb_build_object('users', v_n, 'identities', v_i);
end;
$$;
