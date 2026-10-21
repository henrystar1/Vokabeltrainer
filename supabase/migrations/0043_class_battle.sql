-- 0043: Klassen-Battle (bis 20 Spieler). Wie das Live-Duell, aber mit Raum-Code zum Beitreten und Fragen aus einem Buch des Hosts.
--  * live_create bekommt p_book (Klassen-Battle: bis 20 Spieler, Code, Fragen aus diesem Buch, egal ob aktiv).
--  * live_join_code: Beitreten mit dem 4-stelligen Code.
-- Wiederholbar. Nach 0042 ausführen.

alter table public.live_duels add column if not exists book_id uuid references public.books (id) on delete set null;
alter table public.live_duels add column if not exists max_players integer not null default 4;
alter table public.live_duels add column if not exists code text;
create index if not exists live_duels_code_idx on public.live_duels (code) where code is not null;

drop function if exists public.live_create(uuid[], integer);

create or replace function public.live_create(p_invitees uuid[], p_count integer default 10, p_book uuid default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  v_inv uuid[];
  v_id uuid;
  v_name text;
  v_class boolean := p_book is not null;
  v_max integer := case when p_book is not null then 20 else 4 end;
  v_code text := null;
  u uuid;
begin
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  if v_class and not public.in_library(p_book) then
    raise exception 'Dieses Buch ist nicht in deiner Bibliothek.' using errcode = '42501';
  end if;
  select coalesce(array_agg(distinct x), '{}') into v_inv from unnest(coalesce(p_invitees, '{}')) as x where x <> v_me;
  if v_class then
    if coalesce(array_length(v_inv, 1), 0) > 19 then
      raise exception 'Du kannst höchstens 19 Personen einladen (mit dir 20).' using errcode = '22023';
    end if;
  elsif coalesce(array_length(v_inv, 1), 0) < 1 or array_length(v_inv, 1) > 3 then
    raise exception 'Lade 1 bis 3 Mitspieler ein (zusammen höchstens 4).' using errcode = '22023';
  end if;
  if (select count(*) from public.profiles where id = any (v_inv) and not blocked) <> coalesce(array_length(v_inv, 1), 0) then
    raise exception 'Eine eingeladene Person gibt es nicht.' using errcode = '22023';
  end if;
  update public.live_duels set status = 'cancelled', finished_at = now()
   where host_id = v_me and status in ('lobby', 'running') and created_at < now() - interval '1 minute';
  if exists (select 1 from public.live_duels where host_id = v_me and status = 'lobby') then
    raise exception 'Du hast schon eine offene Lobby.' using errcode = '23505';
  end if;
  if v_class then
    for i in 1..20 loop
      v_code := (select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 1 + floor(random() * 32)::integer, 1), '') from generate_series(1, 4));
      exit when not exists (select 1 from public.live_duels where code = v_code and status = 'lobby' and created_at > now() - interval '30 minutes');
    end loop;
  end if;
  insert into public.live_duels (host_id, q_count, book_id, max_players, code)
  values (v_me, least(greatest(coalesce(p_count, 10), 5), 30), p_book, v_max, v_code) returning id into v_id;
  insert into public.live_duel_players (duel_id, user_id, state) values (v_id, v_me, 'joined');
  select display_name into v_name from public.profiles where id = v_me;
  foreach u in array v_inv loop
    insert into public.live_duel_players (duel_id, user_id, state) values (v_id, u, 'invited');
    insert into public.user_messages (user_id, from_id, body)
    values (u, v_me, case when v_class then '🏫 ' || v_name || ' lädt dich zu einem Klassen-Battle ein! Öffne „Duell“ und tritt der Lobby bei.'
                          else '⚡ ' || v_name || ' lädt dich zu einem Live-Duell ein! Öffne „Duell“ und tritt der Lobby bei.' end);
  end loop;
  return v_id;
end;
$$;

create or replace function public.live_join_code(p_code text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  d public.live_duels;
begin
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  select * into d from public.live_duels
   where code = upper(btrim(coalesce(p_code, ''))) and status = 'lobby' and created_at > now() - interval '30 minutes'
   order by created_at desc limit 1;
  if not found then
    raise exception 'Mit diesem Code gibt es keine offene Lobby.' using errcode = 'P0002';
  end if;
  if (select count(*) from public.live_duel_players where duel_id = d.id and state = 'joined') >= d.max_players
     and not exists (select 1 from public.live_duel_players where duel_id = d.id and user_id = v_me and state = 'joined') then
    raise exception 'Die Lobby ist voll.' using errcode = '54000';
  end if;
  insert into public.live_duel_players (duel_id, user_id, state) values (d.id, v_me, 'joined')
  on conflict (duel_id, user_id) do update set state = 'joined';
  return d.id;
end;
$$;

create or replace function public.live_respond(p_id uuid, p_accept boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  d public.live_duels;
begin
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  select * into d from public.live_duels where id = p_id;
  if not found or d.status <> 'lobby' then
    raise exception 'Diese Lobby gibt es nicht mehr.' using errcode = 'P0002';
  end if;
  if p_accept and (select count(*) from public.live_duel_players where duel_id = p_id and state = 'joined') >= d.max_players
     and not exists (select 1 from public.live_duel_players where duel_id = p_id and user_id = v_me and state = 'joined') then
    raise exception 'Die Lobby ist voll.' using errcode = '54000';
  end if;
  update public.live_duel_players set state = case when p_accept then 'joined' else 'declined' end
   where duel_id = p_id and user_id = v_me and state in ('invited', 'declined', 'joined');
  if not found then
    raise exception 'Du bist nicht eingeladen.' using errcode = '42501';
  end if;
end;
$$;
create or replace function public.live_start(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  d public.live_duels;
  v_joined uuid[];
  v_q jsonb;
begin
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  select * into d from public.live_duels where id = p_id for update;
  if not found or d.host_id <> v_me or d.status <> 'lobby' then
    raise exception 'Nur der Host kann eine offene Lobby starten.' using errcode = '42501';
  end if;
  select array_agg(user_id) into v_joined from public.live_duel_players where duel_id = p_id and state = 'joined';
  if coalesce(array_length(v_joined, 1), 0) < 2 then
    raise exception 'Es muss mindestens eine Person beigetreten sein.' using errcode = '22023';
  end if;
  if d.book_id is not null then
    -- Klassen-Battle: alle Vokabeln des gewählten Buchs, egal ob aktiv
    select jsonb_agg(jsonb_build_object('vocabulary_id', x.vid, 'direction', case when random() < 0.5 then 'forward' else 'backward' end))
      into v_q
      from (
        select v.id as vid from public.vocabulary v
         where v.book_id = d.book_id and exists (select 1 from public.translations t where t.vocabulary_id = v.id)
         order by random()
         limit d.q_count
      ) x;
  else
    select jsonb_agg(jsonb_build_object('vocabulary_id', x.vid, 'direction', case when random() < 0.5 then 'forward' else 'backward' end))
      into v_q
      from (
        select a.vocabulary_id as vid
          from public.user_active_vocab a
         where a.user_id = any (v_joined)
           and exists (select 1 from public.translations t where t.vocabulary_id = a.vocabulary_id)
         group by a.vocabulary_id
        having count(distinct a.user_id) = array_length(v_joined, 1)
         order by random()
         limit d.q_count
      ) x;
  end if;
  if coalesce(jsonb_array_length(v_q), 0) < 5 then
    raise exception 'Es gibt zu wenige passende Vokabeln (mindestens 5).' using errcode = '22023';
  end if;
  update public.live_duel_players set state = 'declined' where duel_id = p_id and state = 'invited';
  update public.live_duels
     set status = 'running', questions = v_q, q_count = jsonb_array_length(v_q), starts_at = now() + interval '4 seconds'
   where id = p_id;
end;
$$;
create or replace function public.live_get(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  d public.live_duels;
  v_in boolean;
begin
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  select * into d from public.live_duels where id = p_id;
  select exists (select 1 from public.live_duel_players where duel_id = p_id and user_id = v_me and state in ('joined', 'invited')) into v_in;
  if d.id is null or not v_in then
    raise exception 'Live-Duell nicht gefunden.' using errcode = 'P0002';
  end if;
  -- Hängengebliebene Runden abschließen
  if d.status = 'running' and d.starts_at + make_interval(secs => d.q_count * 60 + 120) < now() then
    perform public._live_finalize(p_id);
    select * into d from public.live_duels where id = p_id;
  end if;
  -- Lobbys, die lange offen sind, verfallen
  if d.status = 'lobby' and d.created_at < now() - interval '30 minutes' then
    update public.live_duels set status = 'cancelled', finished_at = now() where id = p_id;
    select * into d from public.live_duels where id = p_id;
  end if;
  return jsonb_build_object(
    'id', d.id, 'status', d.status, 'max_players', d.max_players, 'code', d.code, 'is_class', d.book_id is not null,
    'book_name', (select b.name from public.books b where b.id = d.book_id), 'is_host', d.host_id = v_me, 'host_id', d.host_id, 'me', v_me,
    'q_count', d.q_count, 'now', now(), 'starts_at', d.starts_at,
    'players', coalesce((
      select jsonb_agg(jsonb_build_object(
               'user_id', p.user_id, 'name', pr.display_name, 'state', p.state, 'answered', p.answered, 'correct', p.correct,
               'finished', p.finished_at is not null, 'millis', p.millis, 'place', p.place,
               'avatar_id', pr.avatar_id, 'color_id', pr.color_id, 'effect_id', pr.effect_id, 'tag_id', case when pr.tags_hidden then null else pr.tag_id end,
               'theme_id', pr.theme_id, 'role', case when pr.tags_hidden then 'user' else pr.role end)
             order by (p.user_id <> d.host_id), pr.display_name)
        from public.live_duel_players p join public.profiles pr on pr.id = p.user_id
       where p.duel_id = p_id and p.state in ('joined', 'invited', 'left')), '[]'::jsonb),
    'questions', case when d.status in ('running', 'finished') then coalesce((
      select jsonb_agg(jsonb_build_object(
               'vocabulary_id', v.id, 'direction', e.q ->> 'direction', 'german', v.german,
               'german_alts', to_jsonb(v.german_alts),
               'translations', coalesce((select jsonb_agg(t.translation order by t.sort_order, t.created_at)
                                           from public.translations t where t.vocabulary_id = v.id), '[]'::jsonb)
             ) order by e.ord)
        from jsonb_array_elements(d.questions) with ordinality as e(q, ord)
        join public.vocabulary v on v.id = (e.q ->> 'vocabulary_id')::uuid), '[]'::jsonb) else null end);
end;
$$;
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('live_create', 'live_join_code', 'live_respond', 'live_start', 'live_get')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;
end;
$$;
