-- 0011: Alphamod, Ranglistenpunkte ± (Admin), Flüstern/ungelesen/Stummschalten im Chat,
-- Gambling, Highscores statt Bot (+Crossy Road, Flappy Bird), einstellbare Quest-Ziele und
-- Lern-Wartezeiten, Multiple-Choice-Übung, gekaufte Artikel bleiben nutzbar, Nachrichten löschen.
-- Wiederholbar. Nach 0010 ausführen.

-- ----------------------------------------------------------------------------
-- 1. Rollen: Alphamod
-- ----------------------------------------------------------------------------

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles
  add constraint profiles_role_check check (role in ('user', 'mod', 'alphamod', 'admin'));

create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select p.role in ('mod', 'alphamod', 'admin') and not p.blocked
      from public.profiles p where p.id = (select auth.uid())
  ), false);
$$;

-- Darf Werte (Regeln) ändern: nur Alphamods und Admins. Normale Mods verwalten nur Bücher usw.
create or replace function public.is_alphamod()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select p.role in ('alphamod', 'admin') and not p.blocked
      from public.profiles p where p.id = (select auth.uid())
  ), false);
$$;

create or replace function public._role_rank(p_role text)
returns integer
language sql
immutable
as $$
  select case p_role when 'admin' then 3 when 'alphamod' then 2 when 'mod' then 1 else 0 end;
$$;

create or replace function public.admin_set_role(p_user uuid, p_role text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current text;
begin
  perform public._require_admin();
  if p_role not in ('user', 'mod', 'alphamod') then
    raise exception 'Ungültige Rolle. Admins werden nur per SQL festgelegt.' using errcode = '22023';
  end if;
  select role into v_current from public.profiles where id = p_user;
  if v_current is null then
    raise exception 'Nutzer nicht gefunden.' using errcode = 'P0002';
  end if;
  if p_user = (select auth.uid()) or v_current = 'admin' then
    raise exception 'Die Rolle eines Admins kann hier nicht geändert werden.' using errcode = '42501';
  end if;
  update public.profiles set role = p_role where id = p_user;
end;
$$;

-- ----------------------------------------------------------------------------
-- 2. Einstellungen
-- ----------------------------------------------------------------------------

-- Normale Mods dürfen keine Werte ändern.
update public.app_settings set mod_editable = false where mod_editable;

insert into public.app_settings (key, value, mod_editable) values
  ('quest_goal_answers', 20, false),     -- Quest: so viele richtige Antworten heute
  ('quest_goal_perfect', 10, false),     -- Quest: fehlerfreie Runde mit mindestens so vielen Fragen
  ('quest_goal_sprint', 10, false),      -- Quest: so viele richtige im Sprint
  ('quest_goal_duel', 1, false),         -- Quest: so viele Duelle abschließen
  ('learn_gap_l1', 0, false),            -- Wartezeit (Minuten) bis eine Vokabel auf Stufe 1 wieder drankommt
  ('learn_gap_l2', 10, false),           -- … Stufe 2
  ('learn_gap_l3', 60, false),           -- … Stufe 3
  ('learn_gap_l4', 720, false),          -- … Stufe 4
  ('mc_points_per_answer', 1, false),    -- Multiple Choice: Ranglistenpunkte je richtiger Antwort
  ('mc_daily_cap', 100, false),          -- Multiple Choice: höchstens so viele richtige pro Tag zählen
  ('mc_coin_every', 10, false),          -- Multiple Choice: 1 Coin je so viele richtige Antworten
  ('mc_coin_cap', 10, false),            -- Multiple Choice: höchstens so viele Coins pro Tag
  ('gambling_win_permille', 330, false),  -- Gambling: Gewinnchance in ‰ (ohne Jackpot)
  ('gambling_jackpot_permille', 20, false), -- Gambling: Jackpot-Chance in ‰
  ('gambling_mult_win', 2, false),        -- Gambling: Gewinn = Einsatz × diese Zahl
  ('gambling_mult_jackpot', 10, false),   -- Gambling: Jackpot = Einsatz × diese Zahl
  ('gambling_max_bet', 200, false),       -- Gambling: höchster Einsatz
  ('game_record_reward', 10, false),     -- Spiele: Coins für einen neuen Highscore-Rekord
  ('timeout_max', 60, false)             -- Stummschalten: längste Dauer in Minuten (Alphamod/Admin)
on conflict (key) do nothing;

-- Bot-Werte gibt es nicht mehr.
delete from public.app_settings where key in ('bot_snake', 'bot_tetris', 'bot_blast', 'game_reward', 'game_daily_cap');

drop function if exists public.staff_set_setting(text, integer);
create function public.staff_set_setting(p_key text, p_value integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_alphamod() then
    raise exception 'Nur Alphamods und Admins dürfen Werte ändern.' using errcode = '42501';
  end if;
  if p_value is null or p_value < 0 or p_value > 1000000 then
    raise exception 'Ungültiger Wert.' using errcode = '22023';
  end if;
  update public.app_settings set value = p_value where key = p_key;
  if not found then
    raise exception 'Unbekannte Einstellung.' using errcode = 'P0002';
  end if;
end;
$$;

-- ----------------------------------------------------------------------------
-- 3. Ranglistenpunkte: Anpassungen durch Admins, Multiple-Choice-Punkte
-- ----------------------------------------------------------------------------

alter table public.daily_stats add column if not exists choice_correct integer not null default 0;

create table if not exists public.points_adjustments (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  points integer not null check (points <> 0),
  reason text not null default '',
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists points_adjustments_user_idx on public.points_adjustments (user_id, created_at);
alter table public.points_adjustments enable row level security;
revoke all on public.points_adjustments from anon, authenticated;

create or replace function public._choice_points(p_choice integer)
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select (least(p_choice, public.setting('mc_daily_cap')) * public.setting('mc_points_per_answer'))::bigint;
$$;

create or replace function public._week_points(p_user uuid, p_from date)
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select sum(public._day_points(d.answers_correct, d.answers_total) + public._choice_points(d.choice_correct))
                     from public.daily_stats d
                    where d.user_id = p_user and d.day between p_from and p_from + 6), 0)::bigint
       + coalesce((select sum(a.points) from public.points_adjustments a
                    where a.user_id = p_user
                      and (a.created_at at time zone 'Europe/Berlin')::date between p_from and p_from + 6), 0)::bigint;
$$;

drop function if exists public.get_leaderboard(text);
create function public.get_leaderboard(p_period text default 'week')
returns table (rank bigint, display_name text, points bigint, is_me boolean,
               avatar_id text, color_id text, effect_id text, role text, tag_id text, theme_id text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_from date;
  v_me uuid := (select auth.uid());
begin
  if v_me is null then
    raise exception 'Nicht angemeldet' using errcode = '28000';
  end if;

  if p_period = 'week' then
    v_from := date_trunc('week', timezone('Europe/Berlin', now()))::date;
  elsif p_period = 'month' then
    v_from := date_trunc('month', timezone('Europe/Berlin', now()))::date;
  elsif p_period = 'all' then
    v_from := null;
  else
    raise exception 'Ungültiger Zeitraum: %', p_period using errcode = '22023';
  end if;

  return query
  with parts as (
    select d.user_id as uid,
           public._day_points(d.answers_correct, d.answers_total) + public._choice_points(d.choice_correct) as pts
      from public.daily_stats d
     where v_from is null or d.day >= v_from
    union all
    select a.user_id, a.points::bigint
      from public.points_adjustments a
     where v_from is null or (a.created_at at time zone 'Europe/Berlin')::date >= v_from
  ), scored as (
    select uid, sum(pts)::bigint as pts from parts group by uid
  )
  select
    (rank() over (order by s.pts desc))::bigint,
    pr.display_name,
    s.pts,
    (s.uid = v_me),
    pr.avatar_id, pr.color_id, pr.effect_id, pr.role, pr.tag_id, pr.theme_id
  from scored s
  join public.profiles pr on pr.id = s.uid and not pr.blocked
  where s.pts > 0
  order by s.pts desc, pr.display_name
  limit 100;
end;
$$;

create or replace function public.admin_adjust_points(p_user uuid, p_points integer, p_reason text default '')
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._require_admin();
  if p_points is null or p_points = 0 or abs(p_points) > 100000 then
    raise exception 'Die Punkte müssen zwischen -100000 und 100000 liegen (nicht 0).' using errcode = '22023';
  end if;
  if not exists (select 1 from public.profiles where id = p_user) then
    raise exception 'Nutzer nicht gefunden.' using errcode = 'P0002';
  end if;
  insert into public.points_adjustments (user_id, points, reason, created_by)
  values (p_user, p_points, left(btrim(coalesce(p_reason, '')), 200), (select auth.uid()));
end;
$$;

create or replace function public.admin_list_point_adjustments()
returns table (id bigint, display_name text, points integer, reason text, created_at timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public._require_admin();
  return query
  select a.id, pr.display_name, a.points, a.reason, a.created_at
    from public.points_adjustments a
    left join public.profiles pr on pr.id = a.user_id
   order by a.created_at desc
   limit 50;
end;
$$;

-- Multiple-Choice-Übung (auch Genus- und Konjugations-Quiz): weniger Punkte und Coins, keine Stufenänderung.
create or replace function public.submit_choice(p_correct integer, p_total integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  v_today date := (now() at time zone 'Europe/Berlin')::date;
  v_before integer;
  v_counted integer;
  v_after integer;
  v_every integer := greatest(public.setting('mc_coin_every'), 1);
  v_paid integer;
  v_coins integer;
begin
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  if p_correct is null or p_total is null or p_correct < 0 or p_total < 1 or p_total > 100 or p_correct > p_total then
    raise exception 'Ungültiges Ergebnis.' using errcode = '22023';
  end if;
  select coalesce(choice_correct, 0) into v_before from public.daily_stats where user_id = v_me and day = v_today;
  v_before := coalesce(v_before, 0);
  v_counted := greatest(least(p_correct, public.setting('mc_daily_cap') - v_before), 0);
  insert into public.daily_stats (user_id, day, answers_total, answers_correct, choice_correct)
  values (v_me, v_today, 0, 0, v_counted)
  on conflict (user_id, day) do update set choice_correct = public.daily_stats.choice_correct + v_counted;
  v_after := v_before + v_counted;
  select coalesce(sum(l.amount), 0) into v_paid
    from public.koin_ledger l
   where l.user_id = v_me and l.reason = 'choice'
     and (l.created_at at time zone 'Europe/Berlin')::date = v_today;
  v_coins := least(v_after / v_every - v_before / v_every, greatest(public.setting('mc_coin_cap') - v_paid, 0));
  if v_coins > 0 then
    perform public._grant_koins(v_me, v_coins, 'choice', null);
  end if;
  return jsonb_build_object('points', v_counted * public.setting('mc_points_per_answer'), 'coins', greatest(v_coins, 0));
end;
$$;

-- ----------------------------------------------------------------------------
-- 4. Quests mit einstellbaren Zielen
-- ----------------------------------------------------------------------------

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
  v_perfect_min integer := greatest(public.setting('quest_goal_perfect'), 1);
begin
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  return query
  select q.id, least(q.progress, q.goal)::integer, q.goal, q.reward,
         exists (select 1 from public.quest_claims c where c.user_id = v_me and c.day = v_today and c.quest_id = q.id)
  from (values
    ('answers', coalesce((select d.answers_correct from public.daily_stats d where d.user_id = v_me and d.day = v_today), 0),
       greatest(public.setting('quest_goal_answers'), 1), public.setting('quest_reward_answers')),
    ('perfect', (select count(*)::integer from public.learning_sessions s
                  where s.user_id = v_me and (s.started_at at time zone 'Europe/Berlin')::date = v_today
                    and s.answers_total >= v_perfect_min and s.answers_correct = s.answers_total), 1,
       public.setting('quest_reward_perfect')),
    ('sprint', coalesce((select max(p.score) from public.sprint_scores p
                          where p.user_id = v_me and (p.created_at at time zone 'Europe/Berlin')::date = v_today), 0),
       greatest(public.setting('quest_goal_sprint'), 1), public.setting('quest_reward_sprint')),
    ('duel', (select count(*)::integer from public.duel_results r
               where r.user_id = v_me and (r.submitted_at at time zone 'Europe/Berlin')::date = v_today),
       greatest(public.setting('quest_goal_duel'), 1), public.setting('quest_reward_duel'))
  ) as q(id, progress, goal, reward);
end;
$$;

-- ----------------------------------------------------------------------------
-- 5. Lernpool mit Zeitpunkt der letzten Antwort (für die Wartezeiten)
-- ----------------------------------------------------------------------------

create or replace function public.get_learning_pool(p_language text default null, p_book_id uuid default null)
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
      'german_alts', to_jsonb(v.german_alts),
      'translations', coalesce((
         select jsonb_agg(t.translation order by t.sort_order, t.created_at)
           from public.translations t where t.vocabulary_id = v.id), '[]'::jsonb),
      'level', coalesce(pr.learning_level, 1)::float8,
      'last_at', pr.last_answered_at
    )), '[]'::jsonb)
  from public.vocabulary v
  join public.books b on b.id = v.book_id
  left join public.user_vocabulary_progress pr
    on pr.vocabulary_id = v.id and pr.user_id = (select auth.uid())
  where (p_book_id is null or v.book_id = p_book_id)
    and (p_language is null or b.language = p_language);
$$;

-- ----------------------------------------------------------------------------
-- 6. Shop: gekaufte Artikel bleiben nutzbar
-- ----------------------------------------------------------------------------

drop function if exists public.get_shop();
create function public.get_shop()
returns table (id text, kind text, name text, price integer, sort integer, owned boolean, equipped boolean,
               required_role text, active boolean)
language sql
stable
security definer
set search_path = public
as $$
  select i.id, i.kind, i.name, i.price, i.sort,
         (i.price = 0 or o.item_id is not null),
         exists (select 1 from public.profiles p
                  where p.id = (select auth.uid())
                    and i.id in (p.avatar_id, p.color_id, p.effect_id, p.theme_id, p.tag_id)),
         i.required_role, i.active
    from public.shop_items i
    left join public.user_items o on o.item_id = i.id and o.user_id = (select auth.uid())
   where (select auth.uid()) is not null
     and (i.active or o.item_id is not null)
     and (i.required_role is null
          or public._role_rank(i.required_role) <= public._role_rank(
               (select p.role from public.profiles p where p.id = (select auth.uid()))))
   order by i.kind, i.sort, i.name;
$$;

create or replace function public.equip_item(p_item_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  v_kind text;
  v_price integer;
  v_req text;
  v_active boolean;
  v_owned boolean;
begin
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  select kind, price, required_role, active into v_kind, v_price, v_req, v_active
    from public.shop_items where id = p_item_id;
  v_owned := exists (select 1 from public.user_items where user_id = v_me and item_id = p_item_id);
  if v_kind is null or not (v_active or v_owned) then
    raise exception 'Artikel nicht gefunden.' using errcode = 'P0002';
  end if;
  if v_req is not null
     and public._role_rank(v_req) > public._role_rank((select role from public.profiles where id = v_me)) then
    raise exception 'Diesen Artikel gibt es nur für %.',
      case v_req when 'admin' then 'Admins' else 'Mods und Admins' end using errcode = '42501';
  end if;
  if v_price > 0 and not v_owned then
    raise exception 'Diesen Artikel musst du erst kaufen.' using errcode = '42501';
  end if;
  update public.profiles
     set avatar_id = case when v_kind = 'avatar' then p_item_id else avatar_id end,
         color_id  = case when v_kind = 'color'  then p_item_id else color_id end,
         effect_id = case when v_kind = 'effect' then p_item_id else effect_id end,
         theme_id  = case when v_kind = 'theme'  then p_item_id else theme_id end,
         tag_id    = case when v_kind = 'tag'    then p_item_id else tag_id end
   where id = v_me;
end;
$$;

-- ----------------------------------------------------------------------------
-- 7. Chat: Flüstern, ungelesen, Löschen, Stummschalten
-- ----------------------------------------------------------------------------

alter table public.profiles add column if not exists muted_until timestamptz;

alter table public.chat_messages add column if not exists recipient_id uuid references auth.users (id) on delete cascade;
alter table public.chat_messages drop constraint if exists chat_messages_kind_check;
alter table public.chat_messages add constraint chat_messages_kind_check check (kind in ('text', 'pay', 'whisper'));

create table if not exists public.chat_reads (
  user_id uuid primary key references auth.users (id) on delete cascade,
  last_id bigint not null default 0
);
alter table public.chat_reads enable row level security;
revoke all on public.chat_reads from anon, authenticated;

drop function if exists public.get_chat(integer);
create function public.get_chat(p_limit integer default 100)
returns table (id bigint, body text, created_at timestamptz, is_me boolean, display_name text,
               avatar_id text, color_id text, effect_id text, role text, tag_id text, theme_id text, kind text,
               recipient_name text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
begin
  if v_me is null or public.is_blocked() then
    raise exception 'Kein Zugriff.' using errcode = '42501';
  end if;
  return query
    select m.id, m.body, m.created_at, (m.user_id = v_me), pr.display_name,
           pr.avatar_id, pr.color_id, pr.effect_id, pr.role, pr.tag_id, pr.theme_id, m.kind,
           rp.display_name
      from (select c.* from public.chat_messages c
             where c.kind <> 'whisper' or c.user_id = v_me or c.recipient_id = v_me
             order by c.id desc
             limit least(greatest(coalesce(p_limit, 100), 1), 200)) m
      join public.profiles pr on pr.id = m.user_id
      left join public.profiles rp on rp.id = m.recipient_id
     order by m.id asc;
end;
$$;

create or replace function public.chat_unread_count()
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::integer
    from public.chat_messages c
   where (select auth.uid()) is not null and not public.is_blocked()
     and c.id > coalesce((select r.last_id from public.chat_reads r where r.user_id = (select auth.uid())), 0)
     and c.user_id <> (select auth.uid())
     and (c.kind <> 'whisper' or c.recipient_id = (select auth.uid()));
$$;

create or replace function public.chat_mark_read(p_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
begin
  if v_me is null then
    return;
  end if;
  insert into public.chat_reads (user_id, last_id) values (v_me, greatest(coalesce(p_id, 0), 0))
  on conflict (user_id) do update set last_id = greatest(public.chat_reads.last_id, excluded.last_id);
end;
$$;

drop function if exists public.post_chat(text);
create function public.post_chat(p_body text)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  v_body text := btrim(coalesce(p_body, ''));
  v_id bigint;
  v_m text[];
  v_to uuid;
  v_to_name text;
  v_me_name text;
  v_amount integer;
  v_sent integer;
  v_rest text;
  v_muted timestamptz;
begin
  if v_me is null or public.is_blocked() then
    raise exception 'Kein Zugriff.' using errcode = '42501';
  end if;
  select muted_until into v_muted from public.profiles where id = v_me;
  if v_muted is not null and v_muted > now() then
    raise exception 'Du bist stummgeschaltet – noch % Sekunden.', ceil(extract(epoch from (v_muted - now())))::integer
      using errcode = '42501';
  end if;
  if char_length(v_body) < 1 or char_length(v_body) > 500 then
    raise exception 'Die Nachricht braucht 1 bis 500 Zeichen.' using errcode = '22023';
  end if;
  if exists (select 1 from public.chat_messages where user_id = v_me and created_at > now() - interval '1 second') then
    raise exception 'Nicht so schnell – warte kurz.' using errcode = '22023';
  end if;
  if (select count(*) from public.chat_messages where user_id = v_me and created_at > now() - interval '1 minute')
       >= greatest(public.setting('chat_per_minute'), 1) then
    raise exception 'Zu viele Nachrichten – warte eine Minute.' using errcode = '22023';
  end if;

  -- Befehl: !pay @Anzeigename 100
  if v_body ~* '^!pay(\s|$)' then
    v_m := regexp_match(v_body, '^!pay\s+@?(.+?)\s+(\d{1,9})$', 'i');
    if v_m is null then
      raise exception 'So geht es: !pay @Anzeigename 100' using errcode = '22023';
    end if;
    v_amount := v_m[2]::integer;
    if v_amount < 1 then
      raise exception 'Der Betrag muss mindestens 1 sein.' using errcode = '22023';
    end if;
    if v_amount > public.setting('pay_max') then
      raise exception 'Pro Überweisung sind höchstens % Coins erlaubt.', public.setting('pay_max') using errcode = '22023';
    end if;
    select p.id, p.display_name into v_to, v_to_name
      from public.profiles p where lower(p.display_name) = lower(btrim(v_m[1])) and not p.blocked;
    if v_to is null then
      raise exception 'Spieler „%“ nicht gefunden.', btrim(v_m[1]) using errcode = 'P0002';
    end if;
    if v_to = v_me then
      raise exception 'Du kannst dir nicht selbst Coins schicken.' using errcode = '22023';
    end if;
    select coalesce(sum(-l.amount), 0) into v_sent
      from public.koin_ledger l
     where l.user_id = v_me and l.reason = 'pay_out'
       and (l.created_at at time zone 'Europe/Berlin')::date = (now() at time zone 'Europe/Berlin')::date;
    if v_sent + v_amount > public.setting('pay_daily_cap') then
      raise exception 'Tageslimit: Du kannst heute noch % Coins verschicken.', greatest(public.setting('pay_daily_cap') - v_sent, 0) using errcode = '22023';
    end if;
    if coalesce((select balance from public.koin_wallets where user_id = v_me), 0) < v_amount then
      raise exception 'Nicht genug Coins.' using errcode = '23514';
    end if;
    select display_name into v_me_name from public.profiles where id = v_me;
    perform public._grant_koins(v_me, -v_amount, 'pay_out', v_to::text);
    perform public._grant_koins(v_to, v_amount, 'pay_in', v_me::text);
    insert into public.user_messages (user_id, from_id, body)
    values (v_to, null, v_me_name || ' hat dir ' || v_amount || ' Coins geschickt. 💵');
    insert into public.chat_messages (user_id, body, kind)
    values (v_me, v_me_name || ' hat ' || v_to_name || ' ' || v_amount || ' Coins geschickt 💵', 'pay')
    returning chat_messages.id into v_id;
    return v_id;
  end if;

  -- Befehl: !whisper @Anzeigename Text  (nur Absender und Empfänger sehen die Nachricht)
  if v_body ~* '^!whisper(\s|$)' then
    v_rest := btrim(regexp_replace(v_body, '^!whisper\s*@?', '', 'i'));
    -- längster passender Anzeigename gewinnt (Namen dürfen Leerzeichen enthalten)
    select p.id, p.display_name into v_to, v_to_name
      from public.profiles p
     where not p.blocked
       and lower(left(v_rest, char_length(p.display_name) + 1)) = lower(p.display_name) || ' '
     order by char_length(p.display_name) desc
     limit 1;
    if v_to is null then
      raise exception 'So geht es: !whisper @Anzeigename Text' using errcode = '22023';
    end if;
    if v_to = v_me then
      raise exception 'Du kannst dir nicht selbst flüstern.' using errcode = '22023';
    end if;
    v_rest := btrim(substr(v_rest, char_length(v_to_name) + 2));
    if char_length(v_rest) < 1 then
      raise exception 'So geht es: !whisper @Anzeigename Text' using errcode = '22023';
    end if;
    insert into public.chat_messages (user_id, body, kind, recipient_id)
    values (v_me, v_rest, 'whisper', v_to) returning chat_messages.id into v_id;
    return v_id;
  end if;

  if exists (select 1 from public.chat_messages where user_id = v_me and body = v_body and created_at > now() - interval '30 seconds') then
    raise exception 'Diese Nachricht hast du gerade schon gesendet.' using errcode = '22023';
  end if;
  insert into public.chat_messages (user_id, body) values (v_me, v_body) returning chat_messages.id into v_id;
  return v_id;
end;
$$;

-- Löschen: Mods und höher alles; sonst nur eigene Nachrichten oder Flüstern an einen selbst. Endgültig.
drop function if exists public.delete_chat_message(bigint);
create function public.delete_chat_message(p_id bigint)
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
  if public.is_staff() then
    delete from public.chat_messages where id = p_id;
  else
    delete from public.chat_messages where id = p_id and (user_id = v_me or (kind = 'whisper' and recipient_id = v_me));
    if not found then
      raise exception 'Das darfst du nicht löschen.' using errcode = '42501';
    end if;
  end if;
end;
$$;

-- Stummschalten über eine Chat-Nachricht. Mods: genau 1 Minute. Alphamods/Admins: 1 bis timeout_max, 0 hebt auf.
create or replace function public.staff_timeout_message(p_message_id bigint, p_minutes integer default 1)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target uuid;
  v_role text;
  v_minutes integer;
begin
  if not public.is_staff() then
    raise exception 'Nur Mods und Admins dürfen stummschalten.' using errcode = '42501';
  end if;
  select user_id into v_target from public.chat_messages where id = p_message_id;
  if v_target is null then
    raise exception 'Nachricht nicht gefunden.' using errcode = 'P0002';
  end if;
  select role into v_role from public.profiles where id = v_target;
  if v_role <> 'user' then
    raise exception 'Mods und Admins können nicht stummgeschaltet werden.' using errcode = '42501';
  end if;
  if public.is_alphamod() then
    v_minutes := least(greatest(coalesce(p_minutes, 1), 0), greatest(public.setting('timeout_max'), 1));
  else
    v_minutes := 1;
  end if;
  update public.profiles
     set muted_until = case when v_minutes = 0 then null else now() + make_interval(mins => v_minutes) end
   where id = v_target;
end;
$$;

-- Eigene Nachrichten vom Admin/System endgültig löschen.
create or replace function public.delete_my_messages(p_ids uuid[])
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.user_messages where user_id = (select auth.uid()) and id = any (p_ids);
$$;

-- ----------------------------------------------------------------------------
-- 8. Gambling
-- ----------------------------------------------------------------------------

-- Ergebnis wird auf dem Server gewürfelt. Gewinnchance, Jackpot, Faktoren und Höchsteinsatz sind einstellbar.
-- Symbole 0–5 = normale Gewinne (drei gleiche), 6 = Jackpot (drei Sieben).
create or replace function public.gambling_play(p_bet integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  v_roll integer := floor(random() * 1000)::integer;
  v_jack integer := least(greatest(public.setting('gambling_jackpot_permille'), 0), 1000);
  v_win integer := least(greatest(public.setting('gambling_win_permille'), 0), 1000);
  v_mult integer := 0;
  v_reels integer[];
  v_s integer;
  v_payout integer;
  v_balance integer;
begin
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  if p_bet is null or p_bet < 1 or p_bet > greatest(public.setting('gambling_max_bet'), 1) then
    raise exception 'Der Einsatz muss zwischen 1 und % Coins liegen.', greatest(public.setting('gambling_max_bet'), 1)
      using errcode = '22023';
  end if;
  if coalesce((select balance from public.koin_wallets where user_id = v_me), 0) < p_bet then
    raise exception 'Nicht genug Coins.' using errcode = '23514';
  end if;
  if v_roll < v_jack then
    v_mult := public.setting('gambling_mult_jackpot');
    v_reels := array[6, 6, 6];
  elsif v_roll < v_jack + v_win then
    v_mult := public.setting('gambling_mult_win');
    v_s := floor(random() * 6)::integer;
    v_reels := array[v_s, v_s, v_s];
  else
    loop
      v_reels := array[floor(random() * 7)::integer, floor(random() * 7)::integer, floor(random() * 7)::integer];
      exit when not (v_reels[1] = v_reels[2] and v_reels[2] = v_reels[3]);
    end loop;
  end if;
  v_balance := public._grant_koins(v_me, -p_bet, 'gambling_bet', null);
  v_payout := p_bet * v_mult;
  if v_payout > 0 then
    v_balance := public._grant_koins(v_me, v_payout, 'gambling_win', null);
  end if;
  return jsonb_build_object('reels', to_jsonb(v_reels), 'mult', v_mult, 'payout', v_payout,
                            'bet', p_bet, 'balance', v_balance);
end;
$$;

-- ----------------------------------------------------------------------------
-- 9. Spiele: Highscores aller Nutzer statt Bot
-- ----------------------------------------------------------------------------

alter table public.game_runs drop constraint if exists game_runs_game_check;
alter table public.game_runs add constraint game_runs_game_check
  check (game in ('snake', 'tetris', 'blast', 'crossy', 'flappy'));
alter table public.game_runs alter column bot_score drop not null;
alter table public.game_runs alter column bot_score set default 0;
create index if not exists game_runs_board_idx on public.game_runs (game, score desc) where finished_at is not null;

drop function if exists public.start_game(text);
create function public.start_game(p_game text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  v_fee integer := public.setting('game_fee');
  v_id uuid;
  v_balance integer;
  v_record integer;
begin
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  if p_game not in ('snake', 'tetris', 'blast', 'crossy', 'flappy') then
    raise exception 'Unbekanntes Spiel.' using errcode = '22023';
  end if;
  if coalesce((select balance from public.koin_wallets where user_id = v_me), 0) < v_fee then
    raise exception 'Nicht genug Coins – der Eintritt kostet % Coins.', v_fee using errcode = '23514';
  end if;
  insert into public.game_runs (user_id, game, bot_score, fee) values (v_me, p_game, 0, v_fee) returning id into v_id;
  v_balance := public._grant_koins(v_me, -v_fee, 'game_fee', v_id::text);
  select coalesce(max(score), 0) into v_record from public.game_runs where game = p_game and finished_at is not null;
  return jsonb_build_object('id', v_id, 'record', v_record, 'fee', v_fee, 'balance', v_balance);
end;
$$;

drop function if exists public.finish_game(uuid, integer);
create function public.finish_game(p_id uuid, p_score integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  r public.game_runs;
  v_elapsed numeric;
  v_rate numeric;
  v_score integer;
  v_prev integer;
  v_record boolean := false;
  v_reward integer := 0;
  v_balance integer;
begin
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  select * into r from public.game_runs where id = p_id and user_id = v_me for update;
  if not found then
    raise exception 'Spiel nicht gefunden.' using errcode = 'P0002';
  end if;
  if r.finished_at is not null then
    raise exception 'Dieses Spiel ist schon gewertet.' using errcode = '22023';
  end if;
  if p_score is null or p_score < 0 then
    raise exception 'Ungültiges Ergebnis.' using errcode = '22023';
  end if;
  v_elapsed := extract(epoch from (now() - r.started_at));
  v_rate := case r.game when 'snake' then 2 when 'tetris' then 50 when 'blast' then 60 when 'crossy' then 4 else 1.5 end;
  v_score := least(p_score, floor(v_elapsed * v_rate)::integer);
  select max(score) into v_prev from public.game_runs where game = r.game and finished_at is not null;
  if v_score > coalesce(v_prev, 0) and v_elapsed <= 7200 then
    v_record := true;
    v_reward := public.setting('game_record_reward');
  end if;
  update public.game_runs set finished_at = now(), score = v_score, won = v_record, reward = v_reward where id = r.id;
  if v_reward > 0 then
    v_balance := public._grant_koins(v_me, v_reward, 'game_win', r.id::text);
  else
    v_balance := coalesce((select balance from public.koin_wallets where user_id = v_me), 0);
  end if;
  return jsonb_build_object('score', v_score, 'record', v_record, 'prev_record', coalesce(v_prev, 0),
                            'reward', v_reward, 'balance', v_balance);
end;
$$;

-- Bestenliste eines Spiels: bester Wert je Nutzer, Top 10 + eigener Platz.
create or replace function public.get_game_board(p_game text)
returns table (rank bigint, display_name text, score integer, is_me boolean,
               avatar_id text, color_id text, effect_id text, role text, tag_id text, theme_id text)
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
  if p_game not in ('snake', 'tetris', 'blast', 'crossy', 'flappy') then
    raise exception 'Unbekanntes Spiel.' using errcode = '22023';
  end if;
  return query
  with best as (
    select g.user_id as uid, max(g.score) as sc
      from public.game_runs g
     where g.game = p_game and g.finished_at is not null and g.score > 0
     group by g.user_id
  ), ranked as (
    select (rank() over (order by b.sc desc))::bigint as rk, b.uid, b.sc from best b
  )
  select rk.rk, pr.display_name, rk.sc, (rk.uid = v_me),
         pr.avatar_id, pr.color_id, pr.effect_id, pr.role, pr.tag_id, pr.theme_id
    from ranked rk
    join public.profiles pr on pr.id = rk.uid and not pr.blocked
   where rk.rk <= 10 or rk.uid = v_me
   order by rk.rk, pr.display_name;
end;
$$;

-- ----------------------------------------------------------------------------
-- 10. Shop: Fahrrad und Frosch
-- ----------------------------------------------------------------------------

insert into public.shop_items (id, kind, name, price, sort, required_role) values
  ('avatar_bike',  'avatar', 'Radfahrer',          2400, 300, null),
  ('avatar_frog',  'avatar', 'Frosch',             1900, 310, null),
  ('effect_bike',  'effect', 'Fahrradtour',        3200, 160, null),
  ('effect_frog',  'effect', 'Hüpfender Frosch',   2600, 170, null)
on conflict (id) do nothing;

-- ----------------------------------------------------------------------------
-- 11. Rechte
-- ----------------------------------------------------------------------------

do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in (
       'is_alphamod', 'admin_set_role', 'staff_set_setting', 'admin_adjust_points', 'admin_list_point_adjustments',
       'submit_choice', 'get_quests', 'get_learning_pool', 'get_shop', 'equip_item', 'get_chat', 'chat_unread_count',
       'chat_mark_read', 'post_chat', 'delete_chat_message', 'staff_timeout_message', 'delete_my_messages',
       'gambling_play', 'start_game', 'finish_game', 'get_game_board', 'get_leaderboard')
  loop
    execute format('revoke all on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('_day_points', '_week_points', '_choice_points', '_role_rank')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
  end loop;
end;
$$;
