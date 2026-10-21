-- 0044: Siegprämien einstellbar, offene Klassen-Battles zum Anklicken, Team-Parcours (2 Personen gemeinsam).
--  * Einstellungen: live_duel_reward (bestand), live_class_reward_1/2/3, team_reward, team_lives, team_daily_cap.
--  * Klassen-Battle: Plätze 1–3 bekommen Coins; live_open_classes zeigt offene Räume, live_join_open tritt ohne Code bei.
--  * Team-Parcours (2 Personen): team_runs + team_create/_my_invites/_respond/_start/_get/_report/_leave.
--    Art 'parkour' = Joystick-Jump'n'Run (Positionen laufen über Realtime), team_parkour_finish; Art 'quiz' = Vokabel-Parcours.
-- Wiederholbar. Nach 0043 ausführen.

insert into public.app_settings (key, value, mod_editable) values
  ('live_class_reward_1', 20, false),
  ('live_class_reward_2', 10, false),
  ('live_class_reward_3', 5, false),
  ('team_reward', 15, false),
  ('team_parkour_reward', 25, false),
  ('team_lives', 3, false),
  ('team_daily_cap', 10, false)
on conflict (key) do nothing;

-- Coins für einen Platz, mit Tageslimit (duel_daily_cap)
create or replace function public._live_pay(p_user uuid, p_amount integer, p_ref text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_user is not null and p_amount > 0
     and (select count(*) from public.koin_ledger l
           where l.user_id = p_user and l.reason = 'duel'
             and (l.created_at at time zone 'Europe/Berlin')::date = (now() at time zone 'Europe/Berlin')::date) < public.setting('duel_daily_cap') then
    perform public._grant_koins(p_user, p_amount, 'duel', p_ref);
  end if;
end;
$$;

create or replace function public._live_finalize(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  d public.live_duels;
  r record;
begin
  select * into d from public.live_duels where id = p_id for update;
  if not found or d.status <> 'running' then return; end if;
  update public.live_duel_players p
     set place = x.rn
    from (select user_id, row_number() over (order by (finished_at is null), correct desc, coalesce(millis, 2147483647), answered desc) as rn
            from public.live_duel_players where duel_id = p_id and state = 'joined') x
   where p.duel_id = p_id and p.user_id = x.user_id;
  update public.live_duels set status = 'finished', finished_at = now() where id = p_id;
  for r in select user_id, place from public.live_duel_players where duel_id = p_id and state = 'joined' and place <= (case when d.book_id is not null then 3 else 1 end) loop
    perform public._live_pay(r.user_id,
      case when d.book_id is null then public.setting('live_duel_reward')
           when r.place = 1 then public.setting('live_class_reward_1')
           when r.place = 2 then public.setting('live_class_reward_2')
           else public.setting('live_class_reward_3') end,
      p_id::text);
  end loop;
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
    'rewards', case when d.book_id is not null then jsonb_build_array(public.setting('live_class_reward_1'), public.setting('live_class_reward_2'), public.setting('live_class_reward_3'))
                    else jsonb_build_array(public.setting('live_duel_reward')) end,
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


-- Offene Klassen-Battles (jeder kann beitreten, ohne Code)
create or replace function public.live_open_classes()
returns table (duel_id uuid, host_name text, host_avatar_id text, host_color_id text, book_name text, players integer, max_players integer, created_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select d.id, h.display_name, h.avatar_id, h.color_id, b.name,
         (select count(*)::integer from public.live_duel_players q where q.duel_id = d.id and q.state = 'joined'),
         d.max_players, d.created_at
    from public.live_duels d
    join public.profiles h on h.id = d.host_id
    left join public.books b on b.id = d.book_id
   where d.status = 'lobby' and d.book_id is not null and d.created_at > now() - interval '30 minutes'
     and not public.is_blocked() and (select auth.uid()) is not null
     and (select count(*) from public.live_duel_players q where q.duel_id = d.id and q.state = 'joined') < d.max_players
   order by d.created_at desc
   limit 20;
$$;

create or replace function public.live_join_open(p_id uuid)
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
  select * into d from public.live_duels where id = p_id and book_id is not null and status = 'lobby' and created_at > now() - interval '30 minutes';
  if not found then
    raise exception 'Dieser Raum ist nicht mehr offen.' using errcode = 'P0002';
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

-- ---------- Team-Parcours ----------
create table if not exists public.team_runs (
  id uuid primary key default gen_random_uuid(),
  host_id uuid not null references public.profiles (id) on delete cascade,
  partner_id uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'lobby' check (status in ('lobby', 'running', 'won', 'lost', 'cancelled')),
  kind text not null default 'quiz' check (kind in ('quiz', 'parkour')),
  millis integer,
  deaths integer,
  partner_state text not null default 'invited' check (partner_state in ('invited', 'joined', 'declined', 'left')),
  obstacles integer not null default 10,
  lives integer not null default 3,
  lives_left integer not null default 3,
  step integer not null default 0,
  host_ok boolean not null default false,
  partner_ok boolean not null default false,
  host_idx integer not null default 0,
  partner_idx integer not null default 0,
  host_right integer not null default 0,
  host_wrong integer not null default 0,
  partner_right integer not null default 0,
  partner_wrong integer not null default 0,
  host_questions jsonb,
  partner_questions jsonb,
  starts_at timestamptz,
  finished_at timestamptz,
  paid_host integer not null default 0,
  paid_partner integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (host_id <> partner_id)
);
alter table public.team_runs add column if not exists kind text not null default 'quiz' check (kind in ('quiz', 'parkour'));
alter table public.team_runs add column if not exists millis integer;
alter table public.team_runs add column if not exists deaths integer;
create index if not exists team_runs_partner_idx on public.team_runs (partner_id, status);
create index if not exists team_runs_host_idx on public.team_runs (host_id, status);
alter table public.team_runs enable row level security;
revoke all on public.team_runs from anon, authenticated;

create or replace function public._team_pay(p_user uuid, p_amount integer, p_ref text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_amount > 0
     and (select count(*) from public.koin_ledger l
           where l.user_id = p_user and l.reason = 'team'
             and (l.created_at at time zone 'Europe/Berlin')::date = (now() at time zone 'Europe/Berlin')::date) < public.setting('team_daily_cap') then
    perform public._grant_koins(p_user, p_amount, 'team', p_ref);
    return p_amount;
  end if;
  return 0;
end;
$$;

drop function if exists public.team_create(uuid, integer);
create or replace function public.team_create(p_partner uuid, p_obstacles integer default 10, p_kind text default 'quiz')
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  v_id uuid;
  v_name text;
begin
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  if p_partner is null or p_partner = v_me or not exists (select 1 from public.profiles where id = p_partner and not blocked) then
    raise exception 'Diese Person gibt es nicht.' using errcode = '22023';
  end if;
  update public.team_runs set status = 'cancelled', finished_at = now()
   where host_id = v_me and status in ('lobby', 'running') and updated_at < now() - interval '1 minute';
  if exists (select 1 from public.team_runs where host_id = v_me and status = 'lobby') then
    raise exception 'Du hast schon eine offene Team-Lobby.' using errcode = '23505';
  end if;
  insert into public.team_runs (host_id, partner_id, obstacles, lives, lives_left, kind)
  values (v_me, p_partner, case when p_kind = 'parkour' then 3 else least(greatest(coalesce(p_obstacles, 10), 6), 16) end, least(greatest(public.setting('team_lives'), 1), 9), least(greatest(public.setting('team_lives'), 1), 9), case when p_kind = 'parkour' then 'parkour' else 'quiz' end)
  returning id into v_id;
  select display_name into v_name from public.profiles where id = v_me;
  insert into public.user_messages (user_id, from_id, body)
  values (p_partner, v_me, case when p_kind = 'parkour' then '🏃 ' || v_name || ' lädt dich zum Team-Parkour ein (Joystick-Spiel zu zweit)! Öffne „Duell“ und tritt der Lobby bei.' else '🏃 ' || v_name || ' lädt dich zum Team-Parcours ein! Öffne „Duell“ und tritt der Lobby bei.' end);
  return v_id;
end;
$$;

drop function if exists public.team_my_invites();
create or replace function public.team_my_invites()
returns table (run_id uuid, host_name text, host_avatar_id text, host_color_id text, created_at timestamptz, kind text)
language sql
stable
security definer
set search_path = public
as $$
  select t.id, h.display_name, h.avatar_id, h.color_id, t.created_at, t.kind
    from public.team_runs t
    join public.profiles h on h.id = t.host_id
   where t.partner_id = (select auth.uid()) and t.partner_state = 'invited' and t.status = 'lobby'
     and t.created_at > now() - interval '15 minutes' and not public.is_blocked()
   order by t.created_at desc
   limit 3;
$$;

create or replace function public.team_respond(p_id uuid, p_accept boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
begin
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  update public.team_runs
     set partner_state = case when p_accept then 'joined' else 'declined' end, updated_at = now()
   where id = p_id and partner_id = v_me and status = 'lobby' and partner_state in ('invited', 'declined', 'joined');
  if not found then
    raise exception 'Diese Team-Lobby gibt es nicht mehr.' using errcode = 'P0002';
  end if;
end;
$$;

create or replace function public.team_leave(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  t public.team_runs;
begin
  if v_me is null then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  select * into t from public.team_runs where id = p_id for update;
  if not found or v_me not in (t.host_id, t.partner_id) then return; end if;
  if t.status = 'lobby' then
    if v_me = t.host_id then
      update public.team_runs set status = 'cancelled', finished_at = now(), updated_at = now() where id = p_id;
    else
      update public.team_runs set partner_state = 'left', updated_at = now() where id = p_id;
    end if;
  elsif t.status = 'running' then
    update public.team_runs set status = 'cancelled', finished_at = now(), updated_at = now() where id = p_id;
  end if;
end;
$$;

create or replace function public.team_start(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  t public.team_runs;
  v_ids uuid[];
  v_n integer;
  v_pool integer;
  v_h jsonb;
  v_p jsonb;
begin
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  select * into t from public.team_runs where id = p_id for update;
  if not found or t.host_id <> v_me or t.status <> 'lobby' then
    raise exception 'Nur der Host kann eine offene Team-Lobby starten.' using errcode = '42501';
  end if;
  if t.partner_state <> 'joined' then
    raise exception 'Dein Partner ist noch nicht beigetreten.' using errcode = '22023';
  end if;
  if t.kind = 'parkour' then
    update public.team_runs set status = 'running', starts_at = now() + interval '5 seconds', updated_at = now(), step = 0 where id = p_id;
    return;
  end if;
  select array_agg(x.vid order by random()) into v_ids
    from (
      select a.vocabulary_id as vid
        from public.user_active_vocab a
       where a.user_id in (t.host_id, t.partner_id)
         and exists (select 1 from public.translations tr where tr.vocabulary_id = a.vocabulary_id)
       group by a.vocabulary_id
      having count(distinct a.user_id) = 2
    ) x;
  v_n := coalesce(array_length(v_ids, 1), 0);
  if v_n < 6 then
    raise exception 'Ihr habt zu wenige gemeinsame aktive Vokabeln (mindestens 6).' using errcode = '22023';
  end if;
  v_pool := t.obstacles + t.lives;
  select jsonb_agg(jsonb_build_object('vocabulary_id', v_ids[1 + ((2 * (i - 1)) % v_n)], 'direction', case when random() < 0.5 then 'forward' else 'backward' end) order by i)
    into v_h from generate_series(1, v_pool) i;
  select jsonb_agg(jsonb_build_object('vocabulary_id', v_ids[1 + ((2 * (i - 1) + 1) % v_n)], 'direction', case when random() < 0.5 then 'forward' else 'backward' end) order by i)
    into v_p from generate_series(1, v_pool) i;
  update public.team_runs
     set status = 'running', host_questions = v_h, partner_questions = v_p, starts_at = now() + interval '4 seconds', updated_at = now(),
         step = 0, lives_left = lives, host_ok = false, partner_ok = false, host_idx = 0, partner_idx = 0
   where id = p_id;
end;
$$;

create or replace function public.team_report(p_id uuid, p_step integer, p_correct boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  t public.team_runs;
  v_host boolean;
  v_reward integer := public.setting('team_reward');
begin
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  select * into t from public.team_runs where id = p_id for update;
  if not found or t.status <> 'running' or t.kind <> 'quiz' or v_me not in (t.host_id, t.partner_id) then return; end if;
  if t.starts_at > now() or p_step is distinct from t.step then return; end if;
  v_host := v_me = t.host_id;
  if (v_host and t.host_ok) or (not v_host and t.partner_ok) then return; end if;
  if p_correct then
    if v_host then t.host_ok := true; t.host_right := t.host_right + 1;
    else t.partner_ok := true; t.partner_right := t.partner_right + 1; end if;
    if t.host_ok and t.partner_ok then
      t.step := t.step + 1;
      t.host_ok := false; t.partner_ok := false;
      t.host_idx := t.host_idx + 1; t.partner_idx := t.partner_idx + 1;
      if t.step >= t.obstacles then
        t.status := 'won';
        t.finished_at := now();
        t.paid_host := public._team_pay(t.host_id, v_reward, p_id::text);
        t.paid_partner := public._team_pay(t.partner_id, v_reward, p_id::text);
      end if;
    end if;
  else
    t.lives_left := t.lives_left - 1;
    if v_host then t.host_idx := t.host_idx + 1; t.host_wrong := t.host_wrong + 1;
    else t.partner_idx := t.partner_idx + 1; t.partner_wrong := t.partner_wrong + 1; end if;
    if t.lives_left <= 0 then
      t.status := 'lost';
      t.finished_at := now();
    end if;
  end if;
  update public.team_runs
     set status = t.status, step = t.step, lives_left = t.lives_left, host_ok = t.host_ok, partner_ok = t.partner_ok,
         host_idx = t.host_idx, partner_idx = t.partner_idx, host_right = t.host_right, host_wrong = t.host_wrong,
         partner_right = t.partner_right, partner_wrong = t.partner_wrong, finished_at = t.finished_at,
         paid_host = t.paid_host, paid_partner = t.paid_partner, updated_at = now()
   where id = p_id;
end;
$$;

create or replace function public.team_get(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  t public.team_runs;
  v_host boolean;
  v_arr jsonb;
  v_idx integer;
  v_q jsonb;
  v_my jsonb := null;
begin
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  select * into t from public.team_runs where id = p_id;
  if not found or v_me not in (t.host_id, t.partner_id)
     or (v_me = t.partner_id and t.partner_state in ('declined') and t.status = 'lobby') then
    raise exception 'Team-Parcours nicht gefunden.' using errcode = 'P0002';
  end if;
  if (t.status = 'running' and t.updated_at < now() - case when t.kind = 'parkour' then interval '40 minutes' else interval '10 minutes' end) or (t.status = 'lobby' and t.created_at < now() - interval '30 minutes') then
    update public.team_runs set status = 'cancelled', finished_at = now() where id = p_id;
    t.status := 'cancelled';
  end if;
  v_host := v_me = t.host_id;
  if t.status = 'running' and t.kind = 'quiz' then
    v_arr := case when v_host then t.host_questions else t.partner_questions end;
    v_idx := case when v_host then t.host_idx else t.partner_idx end;
    v_q := v_arr -> (v_idx % jsonb_array_length(v_arr));
    select jsonb_build_object(
             'idx', v_idx, 'direction', v_q ->> 'direction', 'vocabulary_id', v.id, 'german', v.german, 'german_alts', to_jsonb(v.german_alts),
             'translations', coalesce((select jsonb_agg(tr.translation order by tr.sort_order, tr.created_at) from public.translations tr where tr.vocabulary_id = v.id), '[]'::jsonb))
      into v_my from public.vocabulary v where v.id = (v_q ->> 'vocabulary_id')::uuid;
  end if;
  return jsonb_build_object(
    'id', t.id, 'kind', t.kind, 'millis', t.millis, 'deaths', t.deaths, 'status', t.status, 'is_host', v_host, 'me', v_me, 'now', now(), 'starts_at', t.starts_at,
    'obstacles', t.obstacles, 'lives', t.lives, 'lives_left', t.lives_left, 'step', t.step,
    'host_ok', t.host_ok, 'partner_ok', t.partner_ok, 'partner_state', t.partner_state,
    'host_right', t.host_right, 'host_wrong', t.host_wrong, 'partner_right', t.partner_right, 'partner_wrong', t.partner_wrong,
    'reward', case when t.kind = 'parkour' then public.setting('team_parkour_reward') else public.setting('team_reward') end, 'paid', case when v_host then t.paid_host else t.paid_partner end,
    'my_question', v_my,
    'people', (
      select jsonb_agg(jsonb_build_object(
               'user_id', pr.id, 'name', pr.display_name, 'avatar_id', pr.avatar_id, 'color_id', pr.color_id, 'effect_id', pr.effect_id,
               'tag_id', case when pr.tags_hidden then null else pr.tag_id end, 'theme_id', pr.theme_id,
               'role', case when pr.tags_hidden then 'user' else pr.role end, 'is_host', pr.id = t.host_id)
             order by (pr.id <> t.host_id))
        from public.profiles pr where pr.id in (t.host_id, t.partner_id)));
end;
$$;


create or replace function public.team_parkour_finish(p_id uuid, p_millis integer, p_deaths integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  t public.team_runs;
  v_reward integer := public.setting('team_parkour_reward');
begin
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  select * into t from public.team_runs where id = p_id for update;
  if not found or t.kind <> 'parkour' or t.status <> 'running' or v_me not in (t.host_id, t.partner_id) then return; end if;
  -- Die drei Level brauchen mindestens eine Minute, früher kann es nicht stimmen.
  if t.starts_at + interval '60 seconds' > now() then return; end if;
  update public.team_runs
     set status = 'won', finished_at = now(), updated_at = now(),
         millis = least(greatest(coalesce(p_millis, 0), 0), 7200000), deaths = least(greatest(coalesce(p_deaths, 0), 0), 9999), step = obstacles,
         paid_host = public._team_pay(t.host_id, v_reward, p_id::text),
         paid_partner = public._team_pay(t.partner_id, v_reward, p_id::text)
   where id = p_id;
end;
$$;

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig, p.proname
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('_live_pay', '_live_finalize', 'live_get', 'live_open_classes', 'live_join_open', '_team_pay',
                                                  'team_create', 'team_parkour_finish', 'team_my_invites', 'team_respond', 'team_leave', 'team_start', 'team_report', 'team_get')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    if r.proname not in ('_live_pay', '_live_finalize', '_team_pay') then
      execute format('grant execute on function %s to authenticated', r.sig);
    end if;
  end loop;
end;
$$;
