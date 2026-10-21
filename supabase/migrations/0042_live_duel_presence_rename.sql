-- 0042: Live-Duell (bis 4 Spieler), „Wer ist da?“ ohne 3-Minuten-Verzögerung, Admin kann Namen ändern.
--  * Online zählt, wer in den letzten 75 Sekunden aktiv war (die App meldet sich alle 30 Sekunden).
--  * Live-Duell: Lobby mit Einladungen, gemeinsamer Start, Fortschritt aller Spieler live, Rangliste am Ende.
--  * admin_rename_user: Admins können Anzeigenamen ändern (Name muss eindeutig sein, 2 bis 30 Zeichen).
-- Wiederholbar. Nach 0041 ausführen.

-- ----------------------------------------------------------------------------
-- 1. Online-Fenster 3 Minuten -> 75 Sekunden (in allen Funktionen, die last_seen_at auswerten)
-- ----------------------------------------------------------------------------
do $$
declare
  r record;
  v_def text;
begin
  for r in
    select p.oid, p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prokind = 'f'
       and pg_get_functiondef(p.oid) like '%last_seen_at%'
       and pg_get_functiondef(p.oid) like '%interval ''3 minutes''%'
  loop
    v_def := replace(pg_get_functiondef(r.oid), 'interval ''3 minutes''', 'interval ''75 seconds''');
    execute v_def;
  end loop;
end;
$$;

-- ----------------------------------------------------------------------------
-- 2. Namen ändern (nur Admin)
-- ----------------------------------------------------------------------------
create or replace function public.admin_rename_user(p_user uuid, p_name text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
begin
  perform public._require_admin();
  if char_length(v_name) < 2 or char_length(v_name) > 30 then
    raise exception 'Der Name muss 2 bis 30 Zeichen lang sein.' using errcode = '22023';
  end if;
  if exists (select 1 from public.profiles where lower(display_name) = lower(v_name) and id <> p_user) then
    raise exception 'Diesen Namen gibt es schon.' using errcode = '23505';
  end if;
  update public.profiles set display_name = v_name where id = p_user;
  if not found then
    raise exception 'Person nicht gefunden.' using errcode = 'P0002';
  end if;
  return v_name;
end;
$$;

-- ----------------------------------------------------------------------------
-- 3. Live-Duell
-- ----------------------------------------------------------------------------
create table if not exists public.live_duels (
  id uuid primary key default gen_random_uuid(),
  host_id uuid not null references auth.users (id) on delete cascade,
  status text not null default 'lobby' check (status in ('lobby', 'running', 'finished', 'cancelled')),
  q_count integer not null default 10,
  questions jsonb,
  created_at timestamptz not null default now(),
  starts_at timestamptz,
  finished_at timestamptz
);
create index if not exists live_duels_created_idx on public.live_duels (created_at desc);
alter table public.live_duels enable row level security;
revoke all on public.live_duels from anon, authenticated;

create table if not exists public.live_duel_players (
  duel_id uuid not null references public.live_duels (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  state text not null default 'invited' check (state in ('invited', 'joined', 'declined', 'left')),
  answered integer not null default 0,
  correct integer not null default 0,
  millis integer,
  finished_at timestamptz,
  place integer,
  primary key (duel_id, user_id)
);
create index if not exists live_duel_players_user_idx on public.live_duel_players (user_id, duel_id);
alter table public.live_duel_players enable row level security;
revoke all on public.live_duel_players from anon, authenticated;

insert into public.app_settings (key, value, mod_editable) values ('live_duel_reward', 10, false)
on conflict (key) do nothing;

-- Auswertung: Rangfolge festlegen, Sieger belohnen.
create or replace function public._live_finalize(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  d public.live_duels;
  v_winner uuid;
  v_today date := (now() at time zone 'Europe/Berlin')::date;
begin
  select * into d from public.live_duels where id = p_id for update;
  if not found or d.status <> 'running' then return; end if;
  update public.live_duel_players p
     set place = r.rn
    from (select user_id, row_number() over (order by (finished_at is null), correct desc, coalesce(millis, 2147483647), answered desc) as rn
            from public.live_duel_players where duel_id = p_id and state = 'joined') r
   where p.duel_id = p_id and p.user_id = r.user_id;
  update public.live_duels set status = 'finished', finished_at = now() where id = p_id;
  select user_id into v_winner from public.live_duel_players where duel_id = p_id and place = 1;
  if v_winner is not null
     and public.setting('live_duel_reward') > 0
     and (select count(*) from public.koin_ledger l
           where l.user_id = v_winner and l.reason = 'duel'
             and (l.created_at at time zone 'Europe/Berlin')::date = v_today) < public.setting('duel_daily_cap') then
    perform public._grant_koins(v_winner, public.setting('live_duel_reward'), 'duel', p_id::text);
  end if;
end;
$$;

create or replace function public.live_create(p_invitees uuid[], p_count integer default 10)
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
  u uuid;
begin
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  select coalesce(array_agg(distinct x), '{}') into v_inv from unnest(coalesce(p_invitees, '{}')) as x where x <> v_me;
  if coalesce(array_length(v_inv, 1), 0) < 1 or array_length(v_inv, 1) > 3 then
    raise exception 'Lade 1 bis 3 Mitspieler ein (zusammen höchstens 4).' using errcode = '22023';
  end if;
  if (select count(*) from public.profiles where id = any (v_inv) and not blocked) <> array_length(v_inv, 1) then
    raise exception 'Eine eingeladene Person gibt es nicht.' using errcode = '22023';
  end if;
  -- eigene alte Lobbys schließen
  update public.live_duels set status = 'cancelled', finished_at = now()
   where host_id = v_me and status in ('lobby', 'running') and created_at < now() - interval '1 minute';
  if exists (select 1 from public.live_duels where host_id = v_me and status = 'lobby') then
    raise exception 'Du hast schon eine offene Lobby.' using errcode = '23505';
  end if;
  insert into public.live_duels (host_id, q_count) values (v_me, least(greatest(coalesce(p_count, 10), 5), 20)) returning id into v_id;
  insert into public.live_duel_players (duel_id, user_id, state) values (v_id, v_me, 'joined');
  select display_name into v_name from public.profiles where id = v_me;
  foreach u in array v_inv loop
    insert into public.live_duel_players (duel_id, user_id, state) values (v_id, u, 'invited');
    insert into public.user_messages (user_id, from_id, body)
    values (u, v_me, '⚡ ' || v_name || ' lädt dich zu einem Live-Duell ein! Öffne „Duell“ und tritt der Lobby bei.');
  end loop;
  return v_id;
end;
$$;

-- Meine offenen Einladungen (Lobby, nicht älter als 15 Minuten)
create or replace function public.live_my_invites()
returns table (duel_id uuid, host_name text, host_avatar_id text, host_color_id text, players integer, created_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select d.id, h.display_name, h.avatar_id, h.color_id,
         (select count(*)::integer from public.live_duel_players q where q.duel_id = d.id and q.state in ('joined', 'invited')),
         d.created_at
    from public.live_duel_players p
    join public.live_duels d on d.id = p.duel_id
    join public.profiles h on h.id = d.host_id
   where p.user_id = (select auth.uid()) and p.state = 'invited' and d.status = 'lobby'
     and d.created_at > now() - interval '15 minutes' and not public.is_blocked()
   order by d.created_at desc
   limit 5;
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
  update public.live_duel_players set state = case when p_accept then 'joined' else 'declined' end
   where duel_id = p_id and user_id = v_me and state in ('invited', 'declined', 'joined');
  if not found then
    raise exception 'Du bist nicht eingeladen.' using errcode = '42501';
  end if;
end;
$$;

create or replace function public.live_leave(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  d public.live_duels;
begin
  if v_me is null then return; end if;
  select * into d from public.live_duels where id = p_id;
  if not found then return; end if;
  if d.host_id = v_me and d.status = 'lobby' then
    update public.live_duels set status = 'cancelled', finished_at = now() where id = p_id;
    return;
  end if;
  update public.live_duel_players set state = 'left' where duel_id = p_id and user_id = v_me and state in ('joined', 'invited');
  if d.status = 'running' and not exists (select 1 from public.live_duel_players where duel_id = p_id and state = 'joined' and finished_at is null) then
    perform public._live_finalize(p_id);
  end if;
end;
$$;

-- Host startet: Fragen aus Vokabeln, die ALLE Mitspieler aktiv haben. Start nach 4 Sekunden Countdown.
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
  if coalesce(jsonb_array_length(v_q), 0) < 5 then
    raise exception 'Ihr habt zu wenige gemeinsame aktive Vokabeln (mindestens 5).' using errcode = '22023';
  end if;
  update public.live_duel_players set state = 'declined' where duel_id = p_id and state = 'invited';
  update public.live_duels
     set status = 'running', questions = v_q, q_count = jsonb_array_length(v_q), starts_at = now() + interval '4 seconds'
   where id = p_id;
end;
$$;

-- Zustand für alle Beteiligten (wird jede Sekunde abgefragt)
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
    'id', d.id, 'status', d.status, 'is_host', d.host_id = v_me, 'host_id', d.host_id, 'me', v_me,
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

create or replace function public.live_progress(p_id uuid, p_answered integer, p_correct integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  d public.live_duels;
begin
  if v_me is null then return; end if;
  select * into d from public.live_duels where id = p_id;
  if not found or d.status <> 'running' or d.starts_at > now() + interval '2 seconds' then return; end if;
  update public.live_duel_players
     set answered = least(greatest(p_answered, answered), d.q_count),
         correct = least(greatest(p_correct, correct), least(greatest(p_answered, answered), d.q_count))
   where duel_id = p_id and user_id = v_me and state = 'joined' and finished_at is null;
end;
$$;

create or replace function public.live_finish(p_id uuid, p_correct integer, p_millis integer)
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
  select * into d from public.live_duels where id = p_id for update;
  if not found or d.status <> 'running' then return; end if;
  update public.live_duel_players
     set answered = d.q_count, correct = least(greatest(coalesce(p_correct, 0), 0), d.q_count),
         millis = least(greatest(coalesce(p_millis, 0), 0), 3600000), finished_at = now()
   where duel_id = p_id and user_id = v_me and state = 'joined' and finished_at is null;
  if not exists (select 1 from public.live_duel_players where duel_id = p_id and state = 'joined' and finished_at is null) then
    perform public._live_finalize(p_id);
  end if;
end;
$$;

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig, p.proname
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('admin_rename_user', '_live_finalize', 'live_create', 'live_my_invites', 'live_respond',
                                                  'live_leave', 'live_start', 'live_get', 'live_progress', 'live_finish')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    if r.proname <> '_live_finalize' then
      execute format('grant execute on function %s to authenticated', r.sig);
    end if;
  end loop;
end;
$$;
