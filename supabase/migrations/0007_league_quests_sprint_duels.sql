-- ============================================================================
-- 0007: Wochenliga, Tagesquests + Serie, Sprint-Modus, Fehler-Training, Duelle (zusammen lernen).
--
-- Einspielen: Supabase → SQL Editor → komplett einfügen → Run (nach 0001–0006).
-- Die Datei ist wiederholbar.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. Einstellungen (alle im Admin-Tab „Coins & Shop“ änderbar)
-- ----------------------------------------------------------------------------

insert into public.app_settings (key, value) values
  ('quest_reward_answers', 3),   -- 20 richtige Antworten an einem Tag
  ('quest_reward_perfect', 5),   -- eine Runde ohne Fehler (mind. 10 Antworten)
  ('quest_reward_sprint', 5),    -- Sprint mit mind. 15 richtigen Antworten
  ('quest_reward_duel', 3),      -- ein Duell abgeschlossen
  ('league_reward_1', 30),       -- Wochenliga: Belohnung Platz 1–3
  ('league_reward_2', 20),
  ('league_reward_3', 10),
  ('league_min_points', 50),     -- so viele Wochenpunkte braucht es für die Belohnung
  ('duel_reward', 5),            -- Sieger eines Duells (höchstens 5 belohnte Siege pro Tag)
  ('duel_daily_cap', 5)
on conflict (key) do nothing;

-- Nachrichten des Systems (ohne Absender) heißen "Vokabeltrainer".
create or replace function public.get_unread_messages()
returns table (id uuid, body text, created_at timestamptz, from_name text)
language sql
stable
security definer
set search_path = public
as $$
  select m.id, m.body, m.created_at, coalesce(pr.display_name, 'Vokabeltrainer')
    from public.user_messages m
    left join public.profiles pr on pr.id = m.from_id
   where m.user_id = (select auth.uid()) and m.read_at is null and not public.is_blocked()
   order by m.created_at;
$$;


-- ----------------------------------------------------------------------------
-- 2. Fehler-Training
-- ----------------------------------------------------------------------------

-- Wie get_learning_pool (nur aktive Vokabeln mit Lernstand), aber nur Vokabeln, die in den
-- letzten 30 Tagen falsch beantwortet wurden und noch nicht auf Stufe 5 sind – die häufigsten Fehler zuerst.
create or replace function public.get_mistake_pool(p_book_id uuid default null)
returns jsonb
language sql
stable
set search_path = public
as $$
  select coalesce(jsonb_agg(e.elem order by e.wrong desc), '[]'::jsonb)
  from (
    select pool.elem, w.wrong
      from jsonb_array_elements(public.get_learning_pool(null, p_book_id)) as pool(elem)
      join (
        select a.vocabulary_id, count(*) as wrong
          from public.learning_answers a
         where a.user_id = (select auth.uid()) and not a.is_correct and not a.is_repeat
           and a.answered_at > now() - interval '30 days' and a.vocabulary_id is not null
         group by a.vocabulary_id
      ) w on w.vocabulary_id = (pool.elem ->> 'vocabulary_id')::uuid
     where (pool.elem ->> 'level')::float8 < 5
     order by w.wrong desc
     limit 60
  ) e;
$$;


-- ----------------------------------------------------------------------------
-- 3. Sprint-Modus
-- ----------------------------------------------------------------------------

create table if not exists public.sprint_scores (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  score integer not null check (score between 0 and 150),
  total integer not null check (total between 0 and 150),
  created_at timestamptz not null default now(),
  check (score <= total)
);

create index if not exists sprint_scores_user_idx on public.sprint_scores (user_id, created_at desc);

-- Speichert das Ergebnis eines 60-Sekunden-Sprints. Gibt die beste Punktzahl dieser Woche zurück.
create or replace function public.submit_sprint(p_score integer, p_total integer)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  v_week date := date_trunc('week', timezone('Europe/Berlin', now()))::date;
begin
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  if p_score is null or p_total is null or p_score < 0 or p_score > p_total or p_total > 150 then
    raise exception 'Ungültiges Ergebnis.' using errcode = '22023';
  end if;
  if (select count(*) from public.sprint_scores s where s.user_id = v_me and s.created_at > now() - interval '24 hours') >= 30 then
    raise exception 'Heute gab es schon viele Sprints – morgen geht es weiter.' using errcode = '54000';
  end if;
  insert into public.sprint_scores (user_id, score, total) values (v_me, p_score, p_total);
  return (select max(s.score) from public.sprint_scores s
           where s.user_id = v_me and (s.created_at at time zone 'Europe/Berlin')::date >= v_week);
end;
$$;

drop function if exists public.get_sprint_board();

create function public.get_sprint_board()
returns table (rank bigint, display_name text, score integer, is_me boolean,
               avatar_id text, color_id text, effect_id text, role text, tag_id text, theme_id text)
language sql
stable
security definer
set search_path = public
as $$
  with best as (
    select s.user_id, max(s.score) as score
      from public.sprint_scores s
     where (s.created_at at time zone 'Europe/Berlin')::date >= date_trunc('week', timezone('Europe/Berlin', now()))::date
     group by s.user_id
  )
  select (rank() over (order by b.score desc))::bigint, pr.display_name, b.score,
         (b.user_id = (select auth.uid())),
         pr.avatar_id, pr.color_id, pr.effect_id, pr.role, pr.tag_id, pr.theme_id
    from best b
    join public.profiles pr on pr.id = b.user_id and not pr.blocked
   where b.score > 0 and (select auth.uid()) is not null
   order by b.score desc, pr.display_name
   limit 20;
$$;


-- ----------------------------------------------------------------------------
-- 4. Serie und Tagesquests
-- ----------------------------------------------------------------------------

create or replace function public.get_streak()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with me as (select (select auth.uid()) as uid, (now() at time zone 'Europe/Berlin')::date as today),
  days as (
    select d.day from public.daily_stats d, me where d.user_id = me.uid and d.answers_total > 0
  ),
  grp as (select day, day - (row_number() over (order by day))::integer as g from days),
  islands as (select min(day) as s, max(day) as e, count(*)::integer as n from grp group by g)
  select jsonb_build_object(
    'current', coalesce((select i.n from islands i, me where i.e >= me.today - 1 order by i.e desc limit 1), 0),
    'best', coalesce((select max(n) from islands), 0),
    'today_done', exists (select 1 from days, me where days.day = me.today)
  );
$$;

create table if not exists public.quest_claims (
  user_id uuid not null references auth.users (id) on delete cascade,
  day date not null,
  quest_id text not null,
  claimed_at timestamptz not null default now(),
  primary key (user_id, day, quest_id)
);

-- Fortschritt der heutigen Quests. Quests: answers (20 richtig), perfect (fehlerfreie Runde),
-- sprint (15 richtig im Sprint), duel (ein Duell abgeschlossen).
create or replace function public.get_quests()
returns table (id text, progress integer, goal integer, reward integer, claimed boolean)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  v_today date := (now() at time zone 'Europe/Berlin')::date;
begin
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  return query
  select q.id, least(q.progress, q.goal)::integer, q.goal, q.reward,
         exists (select 1 from public.quest_claims c where c.user_id = v_me and c.day = v_today and c.quest_id = q.id)
  from (values
    ('answers', coalesce((select d.answers_correct from public.daily_stats d where d.user_id = v_me and d.day = v_today), 0), 20,
       public.setting('quest_reward_answers')),
    ('perfect', (select count(*)::integer from public.learning_sessions s
                  where s.user_id = v_me and (s.started_at at time zone 'Europe/Berlin')::date = v_today
                    and s.answers_total >= 10 and s.answers_correct = s.answers_total), 1,
       public.setting('quest_reward_perfect')),
    ('sprint', coalesce((select max(p.score) from public.sprint_scores p
                          where p.user_id = v_me and (p.created_at at time zone 'Europe/Berlin')::date = v_today), 0), 15,
       public.setting('quest_reward_sprint')),
    ('duel', (select count(*)::integer from public.duel_results r
               where r.user_id = v_me and (r.submitted_at at time zone 'Europe/Berlin')::date = v_today), 1,
       public.setting('quest_reward_duel'))
  ) as q(id, progress, goal, reward);
end;
$$;

-- Belohnung einer erledigten Quest abholen (einmal pro Tag und Quest). Gibt das neue Guthaben zurück.
create or replace function public.claim_quest(p_id text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  v_today date := (now() at time zone 'Europe/Berlin')::date;
  q record;
begin
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  select * into q from public.get_quests() g where g.id = p_id;
  if not found then
    raise exception 'Quest nicht gefunden.' using errcode = 'P0002';
  end if;
  if q.progress < q.goal then
    raise exception 'Diese Quest ist noch nicht geschafft.' using errcode = '22023';
  end if;
  if q.claimed then
    raise exception 'Diese Belohnung hast du heute schon abgeholt.' using errcode = '23505';
  end if;
  insert into public.quest_claims (user_id, day, quest_id) values (v_me, v_today, p_id);
  if q.reward > 0 then
    return public._grant_koins(v_me, q.reward, 'quest', p_id);
  end if;
  return public.get_wallet();
end;
$$;


-- ----------------------------------------------------------------------------
-- 5. Wochenliga
-- ----------------------------------------------------------------------------

create table if not exists public.league_members (
  user_id uuid primary key references auth.users (id) on delete cascade,
  tier integer not null default 1 check (tier between 1 and 5)
);

create table if not exists public.league_meta (
  id boolean primary key default true check (id),
  last_week date not null
);

create table if not exists public.league_history (
  user_id uuid not null references auth.users (id) on delete cascade,
  week_start date not null,
  tier integer not null,
  rank integer,
  points bigint not null,
  result text not null check (result in ('promoted', 'relegated', 'stayed')),
  reward integer not null default 0,
  primary key (user_id, week_start)
);

-- Wochenpunkte wie in der Rangliste (Montag bis Sonntag).
create or replace function public._week_points(p_user uuid, p_from date)
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(
           least(d.answers_correct, 200) * 2
           + case when d.answers_total > 0 then 25 else 0 end
           + case when d.answers_total >= 20 then round(20.0 * d.answers_correct / d.answers_total)::int else 0 end
         ), 0)::bigint
    from public.daily_stats d
   where d.user_id = p_user and d.day between p_from and p_from + 6;
$$;

-- Wertet beendete Wochen aus: Top 3 steigen auf, inaktive und (ab 8 Aktiven) die letzten 3 steigen ab,
-- Platz 1–3 bekommen Coins. Wird beim Öffnen der Liga ausgeführt und ist idempotent.
create or replace function public._league_rollover()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now_week date := date_trunc('week', timezone('Europe/Berlin', now()))::date;
  v_last date;
  v_min integer := public.setting('league_min_points');
  v_names text[] := array['Bronze', 'Silber', 'Gold', 'Saphir', 'Diamant'];
  r record;
  v_new integer;
  v_result text;
  v_reward integer;
  v_text text;
begin
  perform pg_advisory_xact_lock(70071);
  select m.last_week into v_last from public.league_meta m where m.id;
  if not found then
    insert into public.league_meta (id, last_week) values (true, v_now_week);
    return;
  end if;
  if v_last < v_now_week - 56 then
    v_last := v_now_week - 56;
  end if;

  while v_last < v_now_week loop
    insert into public.league_members (user_id)
    select distinct d.user_id
      from public.daily_stats d join public.profiles p on p.id = d.user_id and not p.blocked
     where d.day between v_last and v_last + 6
    on conflict do nothing;

    for r in
      with pts as (
        select m.user_id, m.tier, public._week_points(m.user_id, v_last) as pts
          from public.league_members m
          join public.profiles p on p.id = m.user_id and not p.blocked
      )
      select x.*,
             case when x.pts > 0 then rank() over (partition by x.tier order by x.pts desc) end as rnk,
             count(*) filter (where x.pts > 0) over (partition by x.tier) as parts
        from pts x
    loop
      v_new := r.tier;
      v_result := 'stayed';
      v_reward := 0;
      if r.pts > 0 and r.rnk <= 3 and r.tier < 5 then
        v_new := r.tier + 1;
        v_result := 'promoted';
      elsif r.tier > 1 and (r.pts = 0 or (r.parts >= 8 and r.rnk > r.parts - 3)) then
        v_new := r.tier - 1;
        v_result := 'relegated';
      end if;
      if r.pts >= v_min and r.rnk <= 3 then
        v_reward := public.setting('league_reward_' || r.rnk);
      end if;

      if v_new <> r.tier then
        update public.league_members set tier = v_new where user_id = r.user_id;
      end if;
      if r.pts > 0 or v_result <> 'stayed' then
        insert into public.league_history (user_id, week_start, tier, rank, points, result, reward)
        values (r.user_id, v_last, r.tier, r.rnk, r.pts, v_result, v_reward)
        on conflict do nothing;
        v_text := 'Wochenliga ' || to_char(v_last, 'DD.MM.') || ' (' || v_names[r.tier] || '): '
          || case when r.rnk is not null then 'Platz ' || r.rnk || ' mit ' || r.pts || ' Punkten. ' else 'keine Punkte. ' end
          || case v_result when 'promoted' then 'Aufstieg in ' || v_names[v_new] || '!'
                           when 'relegated' then 'Abstieg in ' || v_names[v_new] || '.'
                           else 'Du bleibst in ' || v_names[r.tier] || '.' end
          || case when v_reward > 0 then ' +' || v_reward || ' Coins.' else '' end;
        insert into public.user_messages (user_id, from_id, body) values (r.user_id, null, v_text);
        if v_reward > 0 then
          perform public._grant_koins(r.user_id, v_reward, 'league', v_last::text);
        end if;
      end if;
    end loop;

    v_last := v_last + 7;
    update public.league_meta set last_week = v_last where id;
  end loop;
end;
$$;

create or replace function public.get_league()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  v_week date := date_trunc('week', timezone('Europe/Berlin', now()))::date;
  v_tier integer;
  v_parts integer;
begin
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  perform public._league_rollover();
  insert into public.league_members (user_id) values (v_me) on conflict do nothing;
  select m.tier into v_tier from public.league_members m where m.user_id = v_me;

  select count(*) into v_parts
    from public.league_members m join public.profiles p on p.id = m.user_id and not p.blocked
   where m.tier = v_tier and public._week_points(m.user_id, v_week) > 0;

  return jsonb_build_object(
    'tier', v_tier,
    'week_start', v_week,
    'ends_at', ((v_week + 7)::timestamp at time zone 'Europe/Berlin'),
    'participants', v_parts,
    'relegation_active', v_parts >= 8,
    'min_points', public.setting('league_min_points'),
    'rewards', jsonb_build_array(public.setting('league_reward_1'), public.setting('league_reward_2'), public.setting('league_reward_3')),
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
               'rank', s.rnk, 'display_name', pr.display_name, 'points', s.pts, 'is_me', s.user_id = v_me,
               'avatar_id', pr.avatar_id, 'color_id', pr.color_id, 'effect_id', pr.effect_id,
               'role', pr.role, 'tag_id', pr.tag_id, 'theme_id', pr.theme_id) order by s.pts desc, pr.display_name)
        from (
          select x.user_id, x.pts, rank() over (order by x.pts desc) as rnk
            from (
              select m.user_id, public._week_points(m.user_id, v_week) as pts
                from public.league_members m join public.profiles p on p.id = m.user_id and not p.blocked
               where m.tier = v_tier
            ) x
           where x.pts > 0 or x.user_id = v_me
        ) s
        join public.profiles pr on pr.id = s.user_id), '[]'::jsonb),
    'last', (select to_jsonb(h) - 'user_id' from public.league_history h where h.user_id = v_me order by h.week_start desc limit 1)
  );
end;
$$;


-- ----------------------------------------------------------------------------
-- 6. Duelle: zusammen lernen
-- ----------------------------------------------------------------------------

create table if not exists public.duels (
  id uuid primary key default gen_random_uuid(),
  challenger_id uuid not null references auth.users (id) on delete cascade,
  opponent_id uuid not null references auth.users (id) on delete cascade,
  questions jsonb not null,
  status text not null default 'open' check (status in ('open', 'finished', 'cancelled')),
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  winner_id uuid references auth.users (id) on delete set null,
  check (challenger_id <> opponent_id)
);

create index if not exists duels_challenger_idx on public.duels (challenger_id, created_at desc);
create index if not exists duels_opponent_idx on public.duels (opponent_id, created_at desc);

create table if not exists public.duel_results (
  duel_id uuid not null references public.duels (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  correct integer not null check (correct >= 0),
  total integer not null check (total > 0),
  millis integer not null check (millis >= 0),
  submitted_at timestamptz not null default now(),
  primary key (duel_id, user_id),
  check (correct <= total)
);

-- Mitspieler suchen (nur Anzeigename und Aussehen).
drop function if exists public.search_players(text);

create function public.search_players(p_query text)
returns table (user_id uuid, display_name text, avatar_id text, color_id text, effect_id text, role text, tag_id text, theme_id text)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.display_name, p.avatar_id, p.color_id, p.effect_id, p.role, p.tag_id, p.theme_id
    from public.profiles p
   where (select auth.uid()) is not null and not public.is_blocked()
     and char_length(btrim(coalesce(p_query, ''))) >= 2
     and p.display_name ilike '%' || replace(replace(btrim(p_query), '%', ''), '_', '') || '%'
     and p.id <> (select auth.uid()) and not p.blocked
   order by p.display_name
   limit 10;
$$;

-- Duell starten: 10 zufällige Vokabeln, die ihr beide aktiviert habt (also aus einem gemeinsamen Online-Buch).
create or replace function public.create_duel(p_opponent uuid, p_count integer default 10)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  v_count integer := least(greatest(coalesce(p_count, 10), 5), 20);
  v_questions jsonb;
  v_id uuid;
  v_name text;
begin
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  if p_opponent is null or p_opponent = v_me
     or not exists (select 1 from public.profiles where id = p_opponent and not blocked) then
    raise exception 'Bitte wähle einen Mitspieler.' using errcode = '22023';
  end if;
  if (select count(*) from public.duels where status = 'open' and challenger_id = v_me) >= 5 then
    raise exception 'Du hast schon 5 offene Duelle.' using errcode = '54000';
  end if;
  if exists (select 1 from public.duels d
              where d.status = 'open' and d.created_at > now() - interval '7 days'
                and ((d.challenger_id = v_me and d.opponent_id = p_opponent)
                  or (d.challenger_id = p_opponent and d.opponent_id = v_me))) then
    raise exception 'Ihr habt schon ein offenes Duell. Spielt das zuerst.' using errcode = '23505';
  end if;

  select jsonb_agg(jsonb_build_object('vocabulary_id', x.vid,
                                      'direction', case when random() < 0.5 then 'forward' else 'backward' end))
    into v_questions
    from (
      select a1.vocabulary_id as vid
        from public.user_active_vocab a1
        join public.user_active_vocab a2 on a2.vocabulary_id = a1.vocabulary_id and a2.user_id = p_opponent
       where a1.user_id = v_me
         and exists (select 1 from public.translations t where t.vocabulary_id = a1.vocabulary_id)
       order by random()
       limit v_count
    ) x;
  if coalesce(jsonb_array_length(v_questions), 0) < 5 then
    raise exception 'Ihr habt zu wenige gemeinsame aktive Vokabeln (mindestens 5). Aktiviert beide Vokabeln aus demselben Online-Buch.'
      using errcode = '22023';
  end if;

  insert into public.duels (challenger_id, opponent_id, questions)
  values (v_me, p_opponent, v_questions) returning id into v_id;

  select display_name into v_name from public.profiles where id = v_me;
  insert into public.user_messages (user_id, from_id, body)
  values (p_opponent, v_me, '⚔️ ' || v_name || ' fordert dich zu einem Vokabel-Duell heraus! Du findest es unter „Duell“.');
  return v_id;
end;
$$;

create or replace function public.list_duels()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
begin
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  return coalesce((
    select jsonb_agg(x.j order by x.created_at desc)
      from (
        select d.created_at,
               jsonb_build_object(
                 'id', d.id, 'status', d.status, 'created_at', d.created_at,
                 'i_am_challenger', d.challenger_id = v_me,
                 'opponent_name', o.display_name,
                 'opponent', jsonb_build_object('avatar_id', o.avatar_id, 'color_id', o.color_id, 'effect_id', o.effect_id,
                                                'role', o.role, 'tag_id', o.tag_id, 'theme_id', o.theme_id),
                 'question_count', jsonb_array_length(d.questions),
                 'my_done', mr.user_id is not null,
                 'opp_done', orr.user_id is not null,
                 'my_correct', mr.correct, 'my_total', mr.total,
                 'opp_correct', case when d.status = 'finished' then orr.correct end,
                 'winner', case when d.status <> 'finished' then null
                                when d.winner_id is null then 'tie'
                                when d.winner_id = v_me then 'me' else 'opp' end
               ) as j
          from public.duels d
          join public.profiles o on o.id = case when d.challenger_id = v_me then d.opponent_id else d.challenger_id end
          left join public.duel_results mr on mr.duel_id = d.id and mr.user_id = v_me
          left join public.duel_results orr on orr.duel_id = d.id and orr.user_id <> v_me
         where (d.challenger_id = v_me or d.opponent_id = v_me)
           and d.created_at > now() - interval '30 days'
           and (d.status <> 'open' or d.created_at > now() - interval '7 days')
         order by d.created_at desc
         limit 50
      ) x
  ), '[]'::jsonb);
end;
$$;

create or replace function public.get_duel(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  d public.duels;
begin
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  select * into d from public.duels where id = p_id and (challenger_id = v_me or opponent_id = v_me);
  if not found then
    raise exception 'Duell nicht gefunden.' using errcode = 'P0002';
  end if;
  return jsonb_build_object(
    'id', d.id, 'status', d.status,
    'opponent_name', (select o.display_name from public.profiles o where o.id = case when d.challenger_id = v_me then d.opponent_id else d.challenger_id end),
    'my_done', exists (select 1 from public.duel_results r where r.duel_id = d.id and r.user_id = v_me),
    'my_correct', (select r.correct from public.duel_results r where r.duel_id = d.id and r.user_id = v_me),
    'my_total', (select r.total from public.duel_results r where r.duel_id = d.id and r.user_id = v_me),
    'opp_correct', (select r.correct from public.duel_results r where r.duel_id = d.id and r.user_id <> v_me and d.status = 'finished'),
    'winner', case when d.status <> 'finished' then null when d.winner_id is null then 'tie'
                   when d.winner_id = v_me then 'me' else 'opp' end,
    'questions', coalesce((
      select jsonb_agg(jsonb_build_object(
               'vocabulary_id', v.id, 'direction', e.q ->> 'direction', 'german', v.german,
               'german_alts', to_jsonb(v.german_alts),
               'translations', coalesce((select jsonb_agg(t.translation order by t.sort_order, t.created_at)
                                           from public.translations t where t.vocabulary_id = v.id), '[]'::jsonb)
             ) order by e.ord)
        from jsonb_array_elements(d.questions) with ordinality as e(q, ord)
        join public.vocabulary v on v.id = (e.q ->> 'vocabulary_id')::uuid), '[]'::jsonb)
  );
end;
$$;

-- Ergebnis abgeben. Sind beide fertig, wird das Duell entschieden (mehr richtige, bei Gleichstand schneller).
create or replace function public.submit_duel(p_id uuid, p_correct integer, p_total integer, p_millis integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  d public.duels;
  v_other public.duel_results;
  v_mine public.duel_results;
  v_winner uuid;
  v_name text;
  v_today date := (now() at time zone 'Europe/Berlin')::date;
  v_verdict text;
begin
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  select * into d from public.duels
   where id = p_id and (challenger_id = v_me or opponent_id = v_me) for update;
  if not found then
    raise exception 'Duell nicht gefunden.' using errcode = 'P0002';
  end if;
  if d.status <> 'open' or d.created_at < now() - interval '7 days' then
    raise exception 'Dieses Duell ist nicht mehr offen.' using errcode = '22023';
  end if;
  if p_total is null or p_total < 1 or p_total > jsonb_array_length(d.questions)
     or p_correct is null or p_correct < 0 or p_correct > p_total or coalesce(p_millis, -1) < 0 then
    raise exception 'Ungültiges Ergebnis.' using errcode = '22023';
  end if;
  if exists (select 1 from public.duel_results where duel_id = p_id and user_id = v_me) then
    raise exception 'Du hast dieses Duell schon gespielt.' using errcode = '23505';
  end if;

  insert into public.duel_results (duel_id, user_id, correct, total, millis)
  values (p_id, v_me, p_correct, p_total, least(p_millis, 3600000))
  returning * into v_mine;

  select * into v_other from public.duel_results where duel_id = p_id and user_id <> v_me;
  if not found then
    return jsonb_build_object('status', 'open', 'winner', null);
  end if;

  -- Beide fertig → entscheiden.
  if v_mine.correct > v_other.correct then v_winner := v_me;
  elsif v_mine.correct < v_other.correct then v_winner := v_other.user_id;
  elsif v_mine.millis < v_other.millis then v_winner := v_me;
  elsif v_mine.millis > v_other.millis then v_winner := v_other.user_id;
  else v_winner := null;
  end if;
  update public.duels set status = 'finished', finished_at = now(), winner_id = v_winner where id = p_id;

  if v_winner is not null
     and (select count(*) from public.koin_ledger l
           where l.user_id = v_winner and l.reason = 'duel'
             and (l.created_at at time zone 'Europe/Berlin')::date = v_today) < public.setting('duel_daily_cap')
     and public.setting('duel_reward') > 0 then
    perform public._grant_koins(v_winner, public.setting('duel_reward'), 'duel', p_id::text);
  end if;

  -- Der Gegner (der zuerst gespielt hat) bekommt eine Nachricht mit dem Ergebnis.
  select display_name into v_name from public.profiles where id = v_me;
  v_verdict := case when v_winner is null then 'unentschieden'
                    when v_winner = v_other.user_id then 'gewonnen' else 'verloren' end;
  insert into public.user_messages (user_id, from_id, body)
  values (v_other.user_id, v_me,
          '⚔️ Duell gegen ' || v_name || ' entschieden: Du hast ' || v_verdict || ' (' || v_other.correct || ' : ' || v_mine.correct || ').');

  return jsonb_build_object(
    'status', 'finished',
    'winner', case when v_winner is null then 'tie' when v_winner = v_me then 'me' else 'opp' end,
    'opp_correct', v_other.correct);
end;
$$;

-- Duell absagen/abbrechen (beide Seiten, solange es offen ist und man noch nicht gespielt hat).
create or replace function public.cancel_duel(p_id uuid)
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
  update public.duels d set status = 'cancelled', finished_at = now()
   where d.id = p_id and d.status = 'open' and (d.challenger_id = v_me or d.opponent_id = v_me)
     and not exists (select 1 from public.duel_results r where r.duel_id = d.id and r.user_id = v_me);
  if not found then
    raise exception 'Das Duell lässt sich nicht mehr absagen.' using errcode = '22023';
  end if;
end;
$$;


-- ----------------------------------------------------------------------------
-- 7. Rechte
-- ----------------------------------------------------------------------------

alter table public.sprint_scores enable row level security;
alter table public.quest_claims enable row level security;
alter table public.league_members enable row level security;
alter table public.league_meta enable row level security;
alter table public.league_history enable row level security;
alter table public.duels enable row level security;
alter table public.duel_results enable row level security;

-- Zugriff nur über die Funktionen oben.
revoke all on public.sprint_scores, public.quest_claims, public.league_members, public.league_meta,
  public.league_history, public.duels, public.duel_results from anon, authenticated;

do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in (
         'get_unread_messages', 'get_mistake_pool', 'submit_sprint', 'get_sprint_board', 'get_streak', 'get_quests',
         'claim_quest', 'get_league', 'search_players', 'create_duel', 'list_duels', 'get_duel', 'submit_duel', 'cancel_duel')
  loop
    execute format('revoke all on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('_week_points', '_league_rollover')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
  end loop;
end;
$$;
