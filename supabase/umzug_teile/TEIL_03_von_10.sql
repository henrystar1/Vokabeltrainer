
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


-- ===== 0012_mod_rights_tags_gifts.sql =====
-- 0012: einstellbare Mod-Rechte (Bücher, Zahlen, Shop-Preise, Stummschalt-Dauer), Artikel verschenken,
-- Tags ausblendbar. Wiederholbar. Nach 0011 ausführen.

-- ----------------------------------------------------------------------------
-- 1. Mod-Rechte
-- ----------------------------------------------------------------------------

insert into public.app_settings (key, value, mod_editable) values
  ('mod_books_all', 1, false),       -- 1 = Mods dürfen alle Online-Bücher bearbeiten, 0 = nur ausgewählte
  ('mod_set_all', 0, false),         -- 1 = Mods dürfen alle Zahlen ändern (sonst nur die freigegebenen)
  ('mod_shop_prices', 0, false),     -- 1 = Mods dürfen Shop-Preise ändern
  ('mod_timeout_max', 1, false)      -- längste Stummschalt-Dauer für Mods in Minuten
on conflict (key) do nothing;

create table if not exists public.mod_book_access (
  book_id uuid primary key references public.books (id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.mod_book_access enable row level security;
revoke all on public.mod_book_access from anon, authenticated;

-- Darf der angemeldete Mod/Alphamod/Admin dieses Recht nutzen? 'shop' | 'settings'
create or replace function public._staff_can(p_perm text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when public.is_alphamod() then true
    when not public.is_staff() then false
    when p_perm = 'shop' then public.setting('mod_shop_prices') = 1
    when p_perm = 'settings' then public.setting('mod_set_all') = 1
                                  or exists (select 1 from public.app_settings where mod_editable)
    else false
  end;
$$;

-- Öffentliche Bücher: Mods nur, wenn alle erlaubt sind oder das Buch freigegeben ist. Alphamods/Admins immer.
create or replace function public.can_edit_book(p_book_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.books b
     where b.id = p_book_id
       and ((not b.is_public and b.owner_id = (select auth.uid()))
            or (b.is_public and public.is_staff()
                and (public.is_alphamod()
                     or public.setting('mod_books_all') = 1
                     or exists (select 1 from public.mod_book_access a where a.book_id = b.id))))
  );
$$;

drop function if exists public.staff_set_setting(text, integer);
create function public.staff_set_setting(p_key text, p_value integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_staff() then
    raise exception 'Nur Mods und Admins dürfen Regeln ändern.' using errcode = '42501';
  end if;
  if p_value is null or p_value < 0 or p_value > 1000000 then
    raise exception 'Ungültiger Wert.' using errcode = '22023';
  end if;
  -- Die Mod-Rechte selbst darf nur ein Admin ändern.
  if p_key like 'mod\_%' and not public.is_admin() then
    raise exception 'Mod-Rechte darf nur ein Admin ändern.' using errcode = '42501';
  end if;
  if not public.is_alphamod()
     and not (public.setting('mod_set_all') = 1
              or exists (select 1 from public.app_settings where key = p_key and mod_editable)) then
    raise exception 'Diese Einstellung darfst du nicht ändern.' using errcode = '42501';
  end if;
  update public.app_settings set value = p_value where key = p_key;
  if not found then
    raise exception 'Unbekannte Einstellung.' using errcode = 'P0002';
  end if;
end;
$$;

create or replace function public.admin_set_item(p_item_id text, p_price integer, p_active boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public._staff_can('shop') then
    raise exception 'Shop-Preise darfst du nicht ändern.' using errcode = '42501';
  end if;
  if p_price < 0 or p_price > 100000 then
    raise exception 'Ungültiger Preis.' using errcode = '22023';
  end if;
  update public.shop_items set price = p_price, active = coalesce(p_active, true) where id = p_item_id;
  if not found then
    raise exception 'Artikel nicht gefunden.' using errcode = 'P0002';
  end if;
end;
$$;

-- Was darf ich? (für die Verwaltungsoberfläche)
create or replace function public.get_my_permissions()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'staff', public.is_staff(),
    'alphamod', public.is_alphamod(),
    'admin', public.is_admin(),
    'settings', public._staff_can('settings'),
    'settings_all', public.is_alphamod() or public.setting('mod_set_all') = 1,
    'shop', public._staff_can('shop'),
    'books_all', public.is_alphamod() or public.setting('mod_books_all') = 1,
    'timeout_max', case when public.is_alphamod() then public.setting('timeout_max') else greatest(public.setting('mod_timeout_max'), 1) end);
$$;

create or replace function public.admin_list_public_books()
returns table (id uuid, name text, language text, owner_name text, vocab_count integer, mod_access boolean)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public._require_admin();
  return query
  select b.id, b.name, b.language, coalesce(p.display_name, '?'),
         (select count(*) from public.vocabulary v where v.book_id = b.id)::integer,
         exists (select 1 from public.mod_book_access a where a.book_id = b.id)
    from public.books b
    left join public.profiles p on p.id = b.owner_id
   where b.is_public
   order by b.name;
end;
$$;

create or replace function public.admin_set_mod_book(p_book uuid, p_allowed boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._require_admin();
  if p_allowed then
    insert into public.mod_book_access (book_id) select b.id from public.books b where b.id = p_book and b.is_public
    on conflict do nothing;
  else
    delete from public.mod_book_access where book_id = p_book;
  end if;
end;
$$;

create or replace function public.admin_set_mod_editable(p_key text, p_value boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._require_admin();
  if p_key like 'mod\_%' then
    raise exception 'Mod-Rechte selbst sind nicht freigebbar.' using errcode = '22023';
  end if;
  update public.app_settings set mod_editable = coalesce(p_value, false) where key = p_key;
  if not found then
    raise exception 'Unbekannte Einstellung.' using errcode = 'P0002';
  end if;
end;
$$;

-- Stummschalten: Mods bis zur eingestellten Höchstdauer (Standard 1 Minute).
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
  v_max integer;
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
  v_max := case when public.is_alphamod() then greatest(public.setting('timeout_max'), 1)
                else greatest(public.setting('mod_timeout_max'), 1) end;
  v_minutes := least(greatest(coalesce(p_minutes, 1), case when public.is_alphamod() then 0 else 1 end), v_max);
  update public.profiles
     set muted_until = case when v_minutes = 0 then null else now() + make_interval(mins => v_minutes) end
   where id = v_target;
end;
$$;

-- ----------------------------------------------------------------------------
-- 2. Artikel verschenken (Admin): ohne Coins, optional gleich anziehen
-- ----------------------------------------------------------------------------

create or replace function public.admin_grant_item(p_user uuid, p_item_id text, p_equip boolean default true)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_kind text;
begin
  perform public._require_admin();
  select kind into v_kind from public.shop_items where id = p_item_id;
  if v_kind is null then
    raise exception 'Artikel nicht gefunden.' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.profiles where id = p_user) then
    raise exception 'Nutzer nicht gefunden.' using errcode = 'P0002';
  end if;
  insert into public.user_items (user_id, item_id) values (p_user, p_item_id) on conflict do nothing;
  if coalesce(p_equip, true) then
    update public.profiles
       set avatar_id = case when v_kind = 'avatar' then p_item_id else avatar_id end,
           color_id  = case when v_kind = 'color'  then p_item_id else color_id end,
           effect_id = case when v_kind = 'effect' then p_item_id else effect_id end,
           theme_id  = case when v_kind = 'theme'  then p_item_id else theme_id end,
           tag_id    = case when v_kind = 'tag'    then p_item_id else tag_id end
     where id = p_user;
  end if;
  insert into public.user_messages (user_id, from_id, body)
  values (p_user, null, 'Du hast einen neuen Artikel geschenkt bekommen: ' || (select name from public.shop_items where id = p_item_id) || ' 🎁');
end;
$$;

-- ----------------------------------------------------------------------------
-- 3. Tags ausblenden (Rollen-Tag und gekaufter Tag)
-- ----------------------------------------------------------------------------

alter table public.profiles add column if not exists tags_hidden boolean not null default false;

create or replace function public.set_tags_hidden(p_hidden boolean)
returns void
language sql
security definer
set search_path = public
as $$
  update public.profiles set tags_hidden = coalesce(p_hidden, false) where id = (select auth.uid());
$$;

-- Alle Funktionen, die Rolle und Tag anderer Nutzer ausgeben, bekommen die Ausblend-Regel.
do $$
declare
  r record;
  v_def text;
begin
  for r in
    select p.oid, p.proname
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('get_leaderboard', 'get_chat', 'get_game_board', 'get_sprint_board', 'get_league', 'search_players', 'list_duels')
  loop
    v_def := pg_get_functiondef(r.oid);
    if v_def like '%tags\_hidden%' then
      continue; -- schon angepasst
    end if;
    v_def := regexp_replace(v_def, '\m(pr|p|o)\.tag_id\M', '(case when \1.tags_hidden then null else \1.tag_id end)', 'g');
    v_def := regexp_replace(v_def, '\m(pr|p|o)\.role\M', '(case when \1.tags_hidden then ''user'' else \1.role end)', 'g');
    execute v_def;
  end loop;
end;
$$;

-- ----------------------------------------------------------------------------
-- 4. Rechte
-- ----------------------------------------------------------------------------

do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in (
       'staff_set_setting', 'admin_set_item', 'get_my_permissions', 'admin_list_public_books', 'admin_set_mod_book',
       'admin_set_mod_editable', 'staff_timeout_message', 'admin_grant_item', 'set_tags_hidden', 'can_edit_book',
       'get_leaderboard', 'get_chat', 'get_game_board', 'get_sprint_board', 'get_league', 'search_players', 'list_duels')
  loop
    execute format('revoke all on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = '_staff_can'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
  end loop;
end;
$$;


-- ===== 0013_per_staff_rights.sql =====
-- 0013: Rechte für jeden Mod/Alphamod einzeln einstellen. Wiederholbar. Nach 0012 ausführen.
-- Ohne eigene Einstellung gilt der Standard aus 0012 (Tab „Mod-Rechte“). Ein Alphamod hat nur noch den Tag
-- und sonst genau die Rechte, die ihm der Admin gibt. Admins dürfen immer alles.

create table if not exists public.staff_rights (
  user_id uuid primary key references auth.users (id) on delete cascade,
  books_mode text check (books_mode in ('none', 'selected', 'all')),   -- null = Standard
  set_mode text check (set_mode in ('none', 'selected', 'all')),
  shop boolean,
  timeout_max integer check (timeout_max between 1 and 100000)
);
create table if not exists public.staff_book_access (
  user_id uuid not null references auth.users (id) on delete cascade,
  book_id uuid not null references public.books (id) on delete cascade,
  primary key (user_id, book_id)
);
create table if not exists public.staff_setting_access (
  user_id uuid not null references auth.users (id) on delete cascade,
  key text not null references public.app_settings (key) on delete cascade,
  primary key (user_id, key)
);
alter table public.staff_rights enable row level security;
alter table public.staff_book_access enable row level security;
alter table public.staff_setting_access enable row level security;
revoke all on public.staff_rights, public.staff_book_access, public.staff_setting_access from anon, authenticated;

-- Rechte-Hilfen (intern)
-- Darf ich diese Zahl ändern? Mit null: darf ich überhaupt irgendeine ändern?
create or replace function public._staff_can_setting(p_key text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  with me as (select (select auth.uid()) as id),
       r as (select s.set_mode from public.staff_rights s, me where s.user_id = me.id)
  select case
    when public.is_admin() then true
    when not public.is_staff() then false
    when coalesce((select set_mode from r), '') = 'all' then true
    when coalesce((select set_mode from r), '') = 'none' then false
    when coalesce((select set_mode from r), '') = 'selected' then
      exists (select 1 from public.staff_setting_access a, me where a.user_id = me.id and (p_key is null or a.key = p_key))
    -- kein eigener Eintrag: Standard für alle Mods
    else public.setting('mod_set_all') = 1
         or exists (select 1 from public.app_settings x where x.mod_editable and (p_key is null or x.key = p_key))
  end;
$$;

create or replace function public._staff_can(p_perm text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when public.is_admin() then true
    when not public.is_staff() then false
    when p_perm = 'shop' then coalesce((select r.shop from public.staff_rights r where r.user_id = (select auth.uid())),
                                       public.setting('mod_shop_prices') = 1)
    when p_perm = 'settings' then public._staff_can_setting(null)
    else false
  end;
$$;

create or replace function public._staff_books_mode()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select s.books_mode from public.staff_rights s where s.user_id = (select auth.uid())), 'default');
$$;

create or replace function public.can_edit_book(p_book_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.books b
     where b.id = p_book_id
       and ((not b.is_public and b.owner_id = (select auth.uid()))
            or (b.is_public and public.is_staff()
                and (public.is_admin()
                     or case public._staff_books_mode()
                          when 'all' then true
                          when 'none' then false
                          when 'selected' then exists (select 1 from public.staff_book_access a where a.book_id = b.id and a.user_id = (select auth.uid()))
                          else public.setting('mod_books_all') = 1
                               or exists (select 1 from public.mod_book_access a where a.book_id = b.id)
                        end)))
  );
$$;

create or replace function public.staff_set_setting(p_key text, p_value integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_staff() then
    raise exception 'Nur Mods und Admins dürfen Regeln ändern.' using errcode = '42501';
  end if;
  if p_value is null or p_value < 0 or p_value > 1000000 then
    raise exception 'Ungültiger Wert.' using errcode = '22023';
  end if;
  if p_key like 'mod\_%' and not public.is_admin() then
    raise exception 'Mod-Rechte darf nur ein Admin ändern.' using errcode = '42501';
  end if;
  if not public._staff_can_setting(p_key) then
    raise exception 'Diese Einstellung darfst du nicht ändern.' using errcode = '42501';
  end if;
  update public.app_settings set value = p_value where key = p_key;
  if not found then
    raise exception 'Unbekannte Einstellung.' using errcode = 'P0002';
  end if;
end;
$$;

create or replace function public.staff_timeout_message(p_message_id bigint, p_minutes integer default 1)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target uuid;
  v_role text;
  v_max integer;
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
  v_max := case when public.is_admin() then greatest(public.setting('timeout_max'), 1)
                else greatest(coalesce((select r.timeout_max from public.staff_rights r where r.user_id = (select auth.uid())),
                                       public.setting('mod_timeout_max')), 1) end;
  v_minutes := least(greatest(coalesce(p_minutes, 1), 0), v_max); -- 0 = Stummschaltung aufheben (alle Mods)
  update public.profiles
     set muted_until = case when v_minutes = 0 then null else now() + make_interval(mins => v_minutes) end
   where id = v_target;
end;
$$;

create or replace function public.get_my_permissions()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'staff', public.is_staff(),
    'alphamod', public.is_alphamod(),
    'admin', public.is_admin(),
    'settings', public._staff_can('settings'),
    'settings_all', public.is_admin() or (select coalesce(set_mode, '') from public.staff_rights where user_id = (select auth.uid())) = 'all'
                    or (not exists (select 1 from public.staff_rights where user_id = (select auth.uid()) and set_mode is not null)
                        and public.setting('mod_set_all') = 1),
    'setting_keys', coalesce((select jsonb_agg(x.key) from public.app_settings x where public._staff_can_setting(x.key)), '[]'::jsonb),
    'shop', public._staff_can('shop'),
    'books_all', public.is_admin() or public._staff_books_mode() = 'all'
                 or (public._staff_books_mode() = 'default' and public.setting('mod_books_all') = 1),
    'timeout_max', case when public.is_admin() then greatest(public.setting('timeout_max'), 1)
                        else greatest(coalesce((select r.timeout_max from public.staff_rights r where r.user_id = (select auth.uid())),
                                               public.setting('mod_timeout_max')), 1) end);
$$;

-- ----------------------------------------------------------------------------
-- Admin: Rechte einzelner Mods/Alphamods
-- ----------------------------------------------------------------------------

create or replace function public.admin_list_staff()
returns table (user_id uuid, display_name text, role text, books_mode text, set_mode text, shop boolean, timeout_max integer,
               book_count integer, setting_count integer)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public._require_admin();
  return query
  select p.id, p.display_name, p.role, r.books_mode, r.set_mode, r.shop, r.timeout_max,
         (select count(*) from public.staff_book_access a where a.user_id = p.id)::integer,
         (select count(*) from public.staff_setting_access a where a.user_id = p.id)::integer
    from public.profiles p
    left join public.staff_rights r on r.user_id = p.id
   where p.role in ('mod', 'alphamod')
   order by p.role desc, p.display_name;
end;
$$;

create or replace function public.admin_get_staff_rights(p_user uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public._require_admin();
  return jsonb_build_object(
    'books_mode', (select books_mode from public.staff_rights where user_id = p_user),
    'set_mode', (select set_mode from public.staff_rights where user_id = p_user),
    'shop', (select shop from public.staff_rights where user_id = p_user),
    'timeout_max', (select timeout_max from public.staff_rights where user_id = p_user),
    'book_ids', coalesce((select jsonb_agg(book_id) from public.staff_book_access where user_id = p_user), '[]'::jsonb),
    'setting_keys', coalesce((select jsonb_agg(key) from public.staff_setting_access where user_id = p_user), '[]'::jsonb));
end;
$$;

-- Null bedeutet „Standard übernehmen“.
create or replace function public.admin_set_staff_rights(p_user uuid, p_books_mode text, p_set_mode text, p_shop boolean, p_timeout integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._require_admin();
  if not exists (select 1 from public.profiles where id = p_user and role in ('mod', 'alphamod')) then
    raise exception 'Nur für Mods und Alphamods.' using errcode = '22023';
  end if;
  insert into public.staff_rights (user_id, books_mode, set_mode, shop, timeout_max)
  values (p_user, p_books_mode, p_set_mode, p_shop, p_timeout)
  on conflict (user_id) do update
    set books_mode = excluded.books_mode, set_mode = excluded.set_mode, shop = excluded.shop, timeout_max = excluded.timeout_max;
end;
$$;

create or replace function public.admin_set_staff_book(p_user uuid, p_book uuid, p_allowed boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._require_admin();
  if p_allowed then
    insert into public.staff_book_access (user_id, book_id)
    select p_user, b.id from public.books b where b.id = p_book and b.is_public
    on conflict do nothing;
  else
    delete from public.staff_book_access where user_id = p_user and book_id = p_book;
  end if;
end;
$$;

create or replace function public.admin_set_staff_setting(p_user uuid, p_key text, p_allowed boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._require_admin();
  if p_key like 'mod\_%' then
    raise exception 'Mod-Rechte selbst sind nicht freigebbar.' using errcode = '22023';
  end if;
  if p_allowed then
    insert into public.staff_setting_access (user_id, key) select p_user, s.key from public.app_settings s where s.key = p_key
    on conflict do nothing;
  else
    delete from public.staff_setting_access where user_id = p_user and key = p_key;
  end if;
end;
$$;

create or replace function public.admin_reset_staff_rights(p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._require_admin();
  delete from public.staff_rights where user_id = p_user;
  delete from public.staff_book_access where user_id = p_user;
  delete from public.staff_setting_access where user_id = p_user;
end;
$$;

do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig, p.proname
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in (
       '_staff_can', '_staff_can_setting', '_staff_books_mode', 'can_edit_book', 'staff_set_setting', 'staff_timeout_message',
       'get_my_permissions', 'admin_list_staff', 'admin_get_staff_rights', 'admin_set_staff_rights', 'admin_set_staff_book',
       'admin_set_staff_setting', 'admin_reset_staff_rights')
  loop
    if r.proname like '\_%' then
      execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    else
      execute format('revoke all on function %s from public, anon', r.sig);
      execute format('grant execute on function %s to authenticated', r.sig);
    end if;
  end loop;
end;
$$;


-- ===== 0014_shop_editor_board_presence.sql =====
-- 0014: Shop-Editor (eigene Artikel), Artikel entziehen, Schwarzes Brett, Wer-ist-da, Coin-Rangliste,
-- Gambling-Gewinnliste, neue Designs und Tags. Wiederholbar. Nach 0013 ausführen.

-- ----------------------------------------------------------------------------
-- 1. Eigene Shop-Artikel (vom Admin angelegt)
-- ----------------------------------------------------------------------------

alter table public.shop_items add column if not exists custom boolean not null default false;
alter table public.shop_items add column if not exists style jsonb;
alter table public.shop_items add column if not exists svg text;

drop function if exists public.get_shop();
create function public.get_shop()
returns table (id text, kind text, name text, price integer, sort integer, owned boolean, equipped boolean,
               required_role text, active boolean, custom boolean, style jsonb, svg text)
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
         i.required_role, i.active, i.custom, i.style, i.svg
    from public.shop_items i
    left join public.user_items o on o.item_id = i.id and o.user_id = (select auth.uid())
   where (select auth.uid()) is not null
     and (i.active or o.item_id is not null)
     and (i.required_role is null
          or public._role_rank(i.required_role) <= public._role_rank(
               (select p.role from public.profiles p where p.id = (select auth.uid()))))
   order by i.kind, i.sort, i.name;
$$;

-- Alle eigenen Artikel (zum Darstellen bei allen Nutzern: Profilbild, Farbe, Effekt, Tag, Design)
create or replace function public.get_custom_items()
returns table (id text, kind text, name text, style jsonb, svg text)
language sql
stable
security definer
set search_path = public
as $$
  select i.id, i.kind, i.name, i.style, i.svg
    from public.shop_items i
   where i.custom and (select auth.uid()) is not null;
$$;

-- Ist die SVG harmlos? Keine Skripte, Ereignisse, fremden Adressen oder eingebetteten Seiten.
create or replace function public._svg_is_safe(p_svg text)
returns boolean
language sql
immutable
as $$
  select p_svg is not null
     and char_length(p_svg) between 20 and 30000
     and p_svg ~* '^\s*(<\?xml[^>]*>\s*)?<svg[\s>]'
     and c.t !~* '<\s*(script|iframe|object|embed|foreignobject|image|use|a)[\s>/]'
     and c.t !~* '\mon[a-z]+\s*='
     and c.t !~* 'javascript:|data:|@import|https?:|//[a-z0-9.-]+\.[a-z]{2,}|<!entity|<!doctype'
     and c.t !~* 'href\s*='
  from (select regexp_replace(p_svg, 'xmlns(:[a-z]+)?\s*=\s*("[^"]*"|''[^'']*'')', '', 'gi') as t) c;
$$;

create or replace function public.admin_save_item(
  p_id text, p_kind text, p_name text, p_price integer, p_required_role text,
  p_style jsonb, p_svg text, p_active boolean default true)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id text := nullif(btrim(coalesce(p_id, '')), '');
begin
  perform public._require_admin();
  if p_kind not in ('avatar', 'color', 'effect', 'theme', 'tag') then
    raise exception 'Unbekannte Art.' using errcode = '22023';
  end if;
  if char_length(btrim(coalesce(p_name, ''))) not between 1 and 40 then
    raise exception 'Der Name braucht 1 bis 40 Zeichen.' using errcode = '22023';
  end if;
  if p_price is null or p_price < 0 or p_price > 10000000 then
    raise exception 'Ungültiger Preis.' using errcode = '22023';
  end if;
  if p_required_role is not null and p_required_role not in ('mod', 'admin') then
    raise exception 'Ungültige Rolle.' using errcode = '22023';
  end if;
  if p_style is not null and (jsonb_typeof(p_style) <> 'object' or char_length(p_style::text) > 4000) then
    raise exception 'Ungültige Stil-Angaben.' using errcode = '22023';
  end if;
  if p_kind = 'avatar' and p_svg is not null and not public._svg_is_safe(p_svg) then
    raise exception 'Die SVG ist nicht erlaubt (keine Skripte, Links oder fremden Bilder, höchstens 30 000 Zeichen).' using errcode = '22023';
  end if;
  if p_kind = 'avatar' and p_svg is null then
    raise exception 'Für ein Profilbild braucht es eine SVG.' using errcode = '22023';
  end if;
  if p_kind <> 'avatar' and p_style is null then
    raise exception 'Es fehlen die Stil-Angaben.' using errcode = '22023';
  end if;

  if v_id is null then
    v_id := 'c_' || substr(md5(random()::text || clock_timestamp()::text), 1, 10);
    insert into public.shop_items (id, kind, name, price, sort, required_role, active, custom, style, svg)
    values (v_id, p_kind, btrim(p_name), p_price, 500, p_required_role, coalesce(p_active, true), true, p_style,
            case when p_kind = 'avatar' then p_svg end);
  else
    update public.shop_items
       set name = btrim(p_name), price = p_price, required_role = p_required_role, active = coalesce(p_active, true),
           style = p_style, svg = case when p_kind = 'avatar' then p_svg end
     where id = v_id and custom and kind = p_kind;
    if not found then
      raise exception 'Eigener Artikel nicht gefunden.' using errcode = 'P0002';
    end if;
  end if;
  return v_id;
end;
$$;

create or replace function public.admin_delete_item(p_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._require_admin();
  if not exists (select 1 from public.shop_items where id = p_id and custom) then
    raise exception 'Nur eigene Artikel lassen sich löschen.' using errcode = '22023';
  end if;
  update public.profiles set avatar_id = null where avatar_id = p_id;
  update public.profiles set color_id = null where color_id = p_id;
  update public.profiles set effect_id = null where effect_id = p_id;
  update public.profiles set theme_id = null where theme_id = p_id;
  update public.profiles set tag_id = null where tag_id = p_id;
  delete from public.shop_items where id = p_id; -- user_items folgt per Kaskade
end;
$$;

-- ----------------------------------------------------------------------------
-- 2. Artikel eines Nutzers ansehen und entziehen
-- ----------------------------------------------------------------------------

create or replace function public.admin_list_user_items(p_user uuid)
returns table (item_id text, kind text, name text, equipped boolean)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public._require_admin();
  return query
  select i.id, i.kind, i.name,
         exists (select 1 from public.profiles p where p.id = p_user and i.id in (p.avatar_id, p.color_id, p.effect_id, p.theme_id, p.tag_id))
    from public.user_items o
    join public.shop_items i on i.id = o.item_id
   where o.user_id = p_user
   order by i.kind, i.name;
end;
$$;

create or replace function public.admin_revoke_item(p_user uuid, p_item_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._require_admin();
  delete from public.user_items where user_id = p_user and item_id = p_item_id;
  update public.profiles
     set avatar_id = case when avatar_id = p_item_id then null else avatar_id end,
         color_id  = case when color_id  = p_item_id then null else color_id end,
         effect_id = case when effect_id = p_item_id then null else effect_id end,
         theme_id  = case when theme_id  = p_item_id then null else theme_id end,
         tag_id    = case when tag_id    = p_item_id then null else tag_id end
   where id = p_user;
end;
$$;

-- ----------------------------------------------------------------------------
-- 3. Gambling: Gewinnliste
-- ----------------------------------------------------------------------------

create table if not exists public.gambling_feed (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  bet integer not null,
  payout integer not null,
  jackpot boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists gambling_feed_time_idx on public.gambling_feed (created_at desc);
alter table public.gambling_feed enable row level security;
revoke all on public.gambling_feed from anon, authenticated;

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
  v_is_jackpot boolean := false;
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
    v_is_jackpot := true;
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
    insert into public.gambling_feed (user_id, bet, payout, jackpot) values (v_me, p_bet, v_payout, v_is_jackpot);
    delete from public.gambling_feed where created_at < now() - interval '7 days';
  end if;
  return jsonb_build_object('reels', to_jsonb(v_reels), 'mult', v_mult, 'payout', v_payout,
                            'bet', p_bet, 'balance', v_balance);
end;
$$;

create or replace function public.get_gambling_feed()
returns table (id bigint, display_name text, bet integer, payout integer, jackpot boolean, created_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select f.id, p.display_name, f.bet, f.payout, f.jackpot, f.created_at
    from public.gambling_feed f
    join public.profiles p on p.id = f.user_id
   where (select auth.uid()) is not null
   order by f.id desc
   limit 20;
$$;

-- ----------------------------------------------------------------------------
-- 4. Schwarzes Brett (Features des nächsten Updates)
-- ----------------------------------------------------------------------------

create table if not exists public.board_posts (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(btrim(title)) between 1 and 120),
  body text not null default '' check (char_length(body) <= 2000),
  status text not null default 'planned' check (status in ('planned', 'doing', 'done')),
  sort integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.board_posts enable row level security;
revoke all on public.board_posts from anon, authenticated;

create or replace function public.get_board()
returns table (id uuid, title text, body text, status text, sort integer, updated_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select b.id, b.title, b.body, b.status, b.sort, b.updated_at
    from public.board_posts b
   where (select auth.uid()) is not null
   order by case b.status when 'doing' then 0 when 'planned' then 1 else 2 end, b.sort, b.created_at desc;
$$;

create or replace function public.admin_save_board_post(p_id uuid, p_title text, p_body text, p_status text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  perform public._require_admin();
  if char_length(btrim(coalesce(p_title, ''))) not between 1 and 120 then
    raise exception 'Der Titel braucht 1 bis 120 Zeichen.' using errcode = '22023';
  end if;
  if p_status not in ('planned', 'doing', 'done') then
    raise exception 'Ungültiger Status.' using errcode = '22023';
  end if;
  if p_id is null then
    insert into public.board_posts (title, body, status) values (btrim(p_title), left(coalesce(p_body, ''), 2000), p_status)
    returning id into v_id;
  else
    update public.board_posts
       set title = btrim(p_title), body = left(coalesce(p_body, ''), 2000), status = p_status, updated_at = now()
     where id = p_id returning id into v_id;
    if v_id is null then
      raise exception 'Eintrag nicht gefunden.' using errcode = 'P0002';
    end if;
  end if;
  return v_id;
end;
$$;

create or replace function public.admin_delete_board_post(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._require_admin();
  delete from public.board_posts where id = p_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- 5. Wer ist da? (online und zuletzt gesehen, für alle)
-- ----------------------------------------------------------------------------

alter table public.profiles add column if not exists hide_presence boolean not null default false;

create or replace function public.set_hide_presence(p_hidden boolean)
returns void
language sql
security definer
set search_path = public
as $$
  update public.profiles set hide_presence = coalesce(p_hidden, false) where id = (select auth.uid());
$$;

create or replace function public.get_presence()
returns table (user_id uuid, display_name text, avatar_id text, color_id text, effect_id text, role text, tag_id text,
               theme_id text, last_seen_at timestamptz, online boolean)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.display_name, p.avatar_id, p.color_id, p.effect_id,
         case when p.tags_hidden then 'user' else p.role end,
         case when p.tags_hidden then null else p.tag_id end,
         p.theme_id, p.last_seen_at, (p.last_seen_at > now() - interval '3 minutes')
    from public.profiles p
   where (select auth.uid()) is not null and not public.is_blocked()
     and not p.blocked and p.last_seen_at is not null
     and (not p.hide_presence or p.id = (select auth.uid()))
   order by (p.last_seen_at > now() - interval '3 minutes') desc, p.last_seen_at desc
   limit 200;
$$;

-- ----------------------------------------------------------------------------
-- 6. Coin-Rangliste
-- ----------------------------------------------------------------------------

create or replace function public.get_coin_leaderboard()
returns table (rank integer, user_id uuid, display_name text, avatar_id text, color_id text, effect_id text, role text,
               tag_id text, theme_id text, koins integer)
language sql
stable
security definer
set search_path = public
as $$
  select (row_number() over (order by w.balance desc, p.display_name))::integer,
         p.id, p.display_name, p.avatar_id, p.color_id, p.effect_id,
         case when p.tags_hidden then 'user' else p.role end,
         case when p.tags_hidden then null else p.tag_id end,
         p.theme_id, w.balance
    from public.koin_wallets w
    join public.profiles p on p.id = w.user_id
   where (select auth.uid()) is not null and not public.is_blocked() and not p.blocked and w.balance > 0
   order by w.balance desc, p.display_name
   limit 50;
$$;

create or replace function public.get_my_coin_rank()
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select (select count(*) + 1
            from public.koin_wallets w join public.profiles p on p.id = w.user_id
           where not p.blocked and w.balance > coalesce((select balance from public.koin_wallets where user_id = (select auth.uid())), 0))::integer;
$$;

-- ----------------------------------------------------------------------------
-- 7. Neue Designs und kurze Tags
-- ----------------------------------------------------------------------------

insert into public.shop_items (id, kind, name, price, sort, required_role) values
  ('theme_lava',    'theme', 'Lava',        700,   120, null),
  ('theme_ice',     'theme', 'Eis',         650,   130, null),
  ('theme_cyber',   'theme', 'Cyber',       800,   140, null),
  ('theme_royal',   'theme', 'Königlich',   900,   150, null),
  ('theme_mint',    'theme', 'Minze',       550,   160, null),
  ('theme_vapor',   'theme', 'Vaporwave',   850,   170, null),
  ('theme_shine',   'theme', 'Glanz',       100000, 200, null),
  ('theme_rainbow', 'theme', 'Regenbogen',  100000, 210, null),
  ('tag_gg',    'tag', 'GG',    200,   100, null),
  ('tag_hot',   'tag', 'HOT',   400,   110, null),
  ('tag_vip',   'tag', 'VIP',   300,   120, null),
  ('tag_og',    'tag', 'OG',    500,   130, null),
  ('tag_star',  'tag', '★',     600,   140, null),
  ('tag_pro',   'tag', 'PRO',   800,   150, null),
  ('tag_mvp',   'tag', 'MVP',   1200,  160, null),
  ('tag_elite', 'tag', 'ELITE', 2500,  170, null)
on conflict (id) do nothing;

-- ----------------------------------------------------------------------------
-- 8. Rechte
-- ----------------------------------------------------------------------------

do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig, p.proname
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in (
       'get_shop', 'get_custom_items', '_svg_is_safe', 'admin_save_item', 'admin_delete_item', 'admin_list_user_items',
       'admin_revoke_item', 'gambling_play', 'get_gambling_feed', 'get_board', 'admin_save_board_post',
       'admin_delete_board_post', 'set_hide_presence', 'get_presence', 'get_coin_leaderboard', 'get_my_coin_rank')
  loop
    if r.proname = '_svg_is_safe' then
      execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    else
      execute format('revoke all on function %s from public, anon', r.sig);
      execute format('grant execute on function %s to authenticated', r.sig);
    end if;
  end loop;
end;
$$;


-- ===== 0015_locks_gambling_stats_limits.sql =====
-- ============================================================================
-- 0015: Sperren mit Zeitplan, Gambling-Bilanz (auch Verluste), höhere Limits
-- Wiederholbar. Nach 0014 ausführen.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Funktionen / Menüpunkte sperren (Admin) – dauerhaft kurz oder nach Zeitplan
-- ----------------------------------------------------------------------------

create table if not exists public.feature_locks (
  key text primary key check (key in ('games', 'gambling', 'sprint', 'duels', 'chat', 'shop', 'quests')),
  off_until timestamptz,
  rules jsonb not null default '[]'::jsonb,
  note text not null default '' check (char_length(note) <= 200),
  updated_at timestamptz not null default now()
);
alter table public.feature_locks enable row level security;
revoke all on public.feature_locks from anon, authenticated;

-- Regeln: [{"days":[1..7], "from":"HH:MM", "to":"HH:MM"}], Berliner Zeit, 1 = Montag.
-- from = to bedeutet „ganzer Tag“, from > to geht über Mitternacht.
create or replace function public._valid_lock_rules(p_rules jsonb)
returns boolean
language plpgsql
immutable
set search_path = public
as $$
declare
  r jsonb;
  d jsonb;
begin
  if p_rules is null or jsonb_typeof(p_rules) <> 'array' or jsonb_array_length(p_rules) > 14 then
    return false;
  end if;
  for r in select * from jsonb_array_elements(p_rules) loop
    if jsonb_typeof(r) <> 'object' or jsonb_typeof(r->'days') <> 'array'
       or jsonb_array_length(r->'days') < 1 or jsonb_array_length(r->'days') > 7 then
      return false;
    end if;
    for d in select * from jsonb_array_elements(r->'days') loop
      if jsonb_typeof(d) <> 'number' or (d #>> '{}') !~ '^[1-7]$' then
        return false;
      end if;
    end loop;
    if coalesce(r->>'from', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
       or coalesce(r->>'to', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
      return false;
    end if;
  end loop;
  return true;
end;
$$;

create or replace function public._feature_locked_raw(p_key text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  r public.feature_locks;
  v_now timestamp := timezone('Europe/Berlin', now());
  v_dow integer := extract(isodow from v_now)::integer;
  v_prev integer;
  v_t time := v_now::time;
  rule jsonb;
  v_from time;
  v_to time;
begin
  select * into r from public.feature_locks where key = p_key;
  if not found then
    return false;
  end if;
  if r.off_until is not null and r.off_until > now() then
    return true;
  end if;
  v_prev := case when v_dow = 1 then 7 else v_dow - 1 end;
  for rule in select * from jsonb_array_elements(r.rules) loop
    v_from := (rule->>'from')::time;
    v_to := (rule->>'to')::time;
    if v_from = v_to then
      if (rule->'days') @> to_jsonb(v_dow) then return true; end if;
    elsif v_from < v_to then
      if (rule->'days') @> to_jsonb(v_dow) and v_t >= v_from and v_t < v_to then return true; end if;
    else
      if ((rule->'days') @> to_jsonb(v_dow) and v_t >= v_from)
         or ((rule->'days') @> to_jsonb(v_prev) and v_t < v_to) then
        return true;
      end if;
    end if;
  end loop;
  return false;
end;
$$;

-- Admins sind nie ausgesperrt (so kann man alles testen).
create or replace function public._feature_locked(p_key text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select not public.is_admin() and public._feature_locked_raw(p_key);
$$;

create or replace function public._feature_guard(p_key text)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if public._feature_locked(p_key) then
    raise exception 'Das ist gerade vom Admin deaktiviert.' using errcode = '55000';
  end if;
end;
$$;

-- Für alle: Liste der gerade gesperrten Schlüssel (leer für Admins).
create or replace function public.get_locked_features()
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(k order by k), '{}'::text[])
    from unnest(array['games', 'gambling', 'sprint', 'duels', 'chat', 'shop', 'quests']) k
   where (select auth.uid()) is not null and public._feature_locked(k);
$$;

create or replace function public.admin_get_feature_locks()
returns table (key text, off_until timestamptz, rules jsonb, note text, locked_now boolean)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public._require_admin();
  return query
  select k, l.off_until, coalesce(l.rules, '[]'::jsonb), coalesce(l.note, ''), public._feature_locked_raw(k)
    from unnest(array['games', 'gambling', 'sprint', 'duels', 'chat', 'shop', 'quests']) k
    left join public.feature_locks l on l.key = k;
end;
$$;

create or replace function public.admin_set_feature_lock(p_key text, p_off_until timestamptz, p_rules jsonb, p_note text default '')
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._require_admin();
  if p_key not in ('games', 'gambling', 'sprint', 'duels', 'chat', 'shop', 'quests') then
    raise exception 'Unbekannte Funktion.' using errcode = '22023';
  end if;
  if not public._valid_lock_rules(coalesce(p_rules, '[]'::jsonb)) then
    raise exception 'Ungültiger Zeitplan.' using errcode = '22023';
  end if;
  if p_off_until is null and coalesce(p_rules, '[]'::jsonb) = '[]'::jsonb and btrim(coalesce(p_note, '')) = '' then
    delete from public.feature_locks where key = p_key;
    return;
  end if;
  insert into public.feature_locks (key, off_until, rules, note, updated_at)
  values (p_key, p_off_until, coalesce(p_rules, '[]'::jsonb), left(btrim(coalesce(p_note, '')), 200), now())
  on conflict (key) do update
    set off_until = excluded.off_until, rules = excluded.rules, note = excluded.note, updated_at = now();
end;
$$;

-- ----------------------------------------------------------------------------
-- 2. Gambling: alle Spiele loggen (auch Verluste) + Bilanz je Spieler
-- ----------------------------------------------------------------------------

create table if not exists public.gambling_stats (
  user_id uuid primary key references auth.users (id) on delete cascade,
  plays integer not null default 0,
  wagered bigint not null default 0,
  won bigint not null default 0,
  best_win integer not null default 0
);
alter table public.gambling_stats enable row level security;
revoke all on public.gambling_stats from anon, authenticated;

-- Bisherige Spiele aus dem Ledger übernehmen (nur beim ersten Mal, danach greift on conflict).
insert into public.gambling_stats (user_id, plays, wagered, won, best_win)
select l.user_id,
       count(*) filter (where l.reason = 'gambling_bet')::integer,
       coalesce(-sum(l.amount) filter (where l.reason = 'gambling_bet'), 0),
       coalesce(sum(l.amount) filter (where l.reason = 'gambling_win'), 0),
       coalesce(max(l.amount) filter (where l.reason = 'gambling_win'), 0)::integer
  from public.koin_ledger l
 where l.reason in ('gambling_bet', 'gambling_win')
 group by l.user_id
on conflict (user_id) do nothing;

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
  v_is_jackpot boolean := false;
  v_reels integer[];
  v_s integer;
  v_payout integer;
  v_balance integer;
begin
  perform public._feature_guard('gambling');
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
    v_is_jackpot := true;
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
  insert into public.gambling_feed (user_id, bet, payout, jackpot) values (v_me, p_bet, v_payout, v_is_jackpot);
  delete from public.gambling_feed where created_at < now() - interval '3 days';
  insert into public.gambling_stats (user_id, plays, wagered, won, best_win)
  values (v_me, 1, p_bet, v_payout, v_payout)
  on conflict (user_id) do update
    set plays = public.gambling_stats.plays + 1,
        wagered = public.gambling_stats.wagered + p_bet,
        won = public.gambling_stats.won + v_payout,
        best_win = greatest(public.gambling_stats.best_win, v_payout);
  return jsonb_build_object('reels', to_jsonb(v_reels), 'mult', v_mult, 'payout', v_payout,
                            'bet', p_bet, 'balance', v_balance);
end;
$$;

-- Bilanz-Rangliste: Gewinn minus Einsatz (negativ = Verlust).
create or replace function public.get_gambling_board()
returns table (rank integer, user_id uuid, display_name text, avatar_id text, color_id text, effect_id text, role text,
               tag_id text, theme_id text, plays integer, wagered bigint, won bigint, net bigint, best_win integer, is_me boolean)
language sql
stable
security definer
set search_path = public
as $$
  select (row_number() over (order by (s.won - s.wagered) desc, p.display_name))::integer,
         p.id, p.display_name, p.avatar_id, p.color_id, p.effect_id,
         case when p.tags_hidden then 'user' else p.role end,
         case when p.tags_hidden then null else p.tag_id end,
         p.theme_id, s.plays, s.wagered, s.won, s.won - s.wagered, s.best_win, (p.id = (select auth.uid()))
    from public.gambling_stats s
    join public.profiles p on p.id = s.user_id
   where (select auth.uid()) is not null and not public.is_blocked() and not p.blocked and s.plays > 0
   order by (s.won - s.wagered) desc, p.display_name
   limit 200;
$$;

-- ----------------------------------------------------------------------------
-- 3. Höhere Limits: Preise bis 1 Mrd., Coins schenken/abziehen in einem Schlag
-- ----------------------------------------------------------------------------

create or replace function public.admin_set_item(p_item_id text, p_price integer, p_active boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public._staff_can('shop') then
    raise exception 'Shop-Preise darfst du nicht ändern.' using errcode = '42501';
  end if;
  if p_price is null or p_price < 0 or p_price > 1000000000 then
    raise exception 'Ungültiger Preis.' using errcode = '22023';
  end if;
  update public.shop_items set price = p_price, active = coalesce(p_active, true) where id = p_item_id;
  if not found then
    raise exception 'Artikel nicht gefunden.' using errcode = 'P0002';
  end if;
end;
$$;

create or replace function public.admin_grant_koins(p_user uuid, p_amount integer, p_note text default '')
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bal integer;
begin
  perform public._require_admin();
  if p_amount is null or p_amount = 0 or abs(p_amount) > 1000000000 then
    raise exception 'Ungültiger Betrag (höchstens 1.000.000.000).' using errcode = '22023';
  end if;
  if not exists (select 1 from public.profiles where id = p_user) then
    raise exception 'Nutzer nicht gefunden.' using errcode = 'P0002';
  end if;
  v_bal := coalesce((select balance from public.koin_wallets where user_id = p_user), 0);
  if p_amount > 0 and v_bal::bigint + p_amount > 2000000000 then
    raise exception 'Das Guthaben darf 2.000.000.000 Coins nicht übersteigen.' using errcode = '22023';
  end if;
  return public._grant_koins(p_user, p_amount, 'admin', nullif(left(btrim(coalesce(p_note, '')), 100), ''));
end;
$$;

-- Preislimit in admin_save_item anheben (Funktion wird umgeschrieben).
do $$
declare
  v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'admin_save_item';
  if v_def is not null and v_def ~ '\m10000000\M' then
    execute regexp_replace(v_def, '\m10000000\M', '1000000000', 'g');
  end if;
end;
$$;

-- ----------------------------------------------------------------------------
-- 4. Sperren in bestehende Funktionen einhängen (nur wenn noch nicht geschehen)
-- ----------------------------------------------------------------------------

do $$
declare
  r record;
  v_def text;
begin
  for r in select * from (values
      ('start_game', 'games'), ('create_duel', 'duels'), ('submit_sprint', 'sprint'),
      ('post_chat', 'chat'), ('buy_item', 'shop'), ('claim_quest', 'quests')) as t(fn, k)
  loop
    select pg_get_functiondef(p.oid) into v_def
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = r.fn
     limit 1;
    if v_def is not null and position('_feature_guard' in v_def) = 0 then
      v_def := regexp_replace(v_def, E'\nbegin\n', E'\nbegin\n  perform public._feature_guard(''' || r.k || E''');\n');
      execute v_def;
    end if;
  end loop;
end;
$$;

-- ----------------------------------------------------------------------------
-- 5. Rechte
-- ----------------------------------------------------------------------------

do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig, p.proname
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('_valid_lock_rules', '_feature_locked_raw', '_feature_locked', '_feature_guard', 'get_locked_features',
                         'admin_get_feature_locks', 'admin_set_feature_lock', 'gambling_play', 'get_gambling_board',
                         'admin_set_item', 'admin_grant_koins', 'admin_save_item', 'start_game', 'create_duel',
                         'submit_sprint', 'post_chat', 'buy_item', 'claim_quest')
  loop
    if r.proname in ('_valid_lock_rules', '_feature_locked_raw', '_feature_locked', '_feature_guard') then
      execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    else
      execute format('revoke all on function %s from public, anon', r.sig);
      execute format('grant execute on function %s to authenticated', r.sig);
    end if;
  end loop;
end;
$$;


-- ===== 0016_accounts_copy_items.sql =====
-- ============================================================================
-- 0016: Konten ohne Bestätigungs-Mail anlegen, Kennwort setzen, Abschreiben-Belohnung,
--       neue Artikel (Reicher Zocker, Farbwechsel-Design). Wiederholbar. Nach 0015 ausführen.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Konten vom Admin anlegen (ohne Bestätigungs-Mail)
-- ----------------------------------------------------------------------------

create or replace function public._create_user(p_email text, p_password text, p_name text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_id uuid := gen_random_uuid();
  v_final text;
begin
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or char_length(v_email) > 200 then
    raise exception 'Ungültige E-Mail-Adresse.' using errcode = '22023';
  end if;
  if p_password is null or char_length(p_password) < 6 or char_length(p_password) > 72 then
    raise exception 'Das Kennwort braucht 6 bis 72 Zeichen.' using errcode = '22023';
  end if;
  if exists (select 1 from auth.users where lower(email) = v_email) then
    raise exception 'Diese E-Mail gibt es schon.' using errcode = '23505';
  end if;
  if v_name is null then
    v_name := split_part(v_email, '@', 1);
  end if;
  v_name := left(v_name, 24);

  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                          raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                          confirmation_token, email_change, email_change_token_new, recovery_token)
  values ('00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated', v_email,
          extensions.crypt(p_password, extensions.gen_salt('bf')), now(),
          '{"provider":"email","providers":["email"]}'::jsonb, jsonb_build_object('display_name', v_name), now(), now(),
          '', '', '', '');
  insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (gen_random_uuid(), v_id, v_id::text,
          jsonb_build_object('sub', v_id::text, 'email', v_email, 'email_verified', true, 'phone_verified', false),
          'email', now(), now(), now());

  select display_name into v_final from public.profiles where id = v_id;
  return jsonb_build_object('user_id', v_id, 'email', v_email, 'display_name', v_final);
end;
$$;

create or replace function public.admin_create_user(p_email text, p_password text, p_name text default '')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._require_admin();
  return public._create_user(p_email, p_password, p_name);
end;
$$;

-- Mehrere Konten: p_rows = [{"email":"…","password":"…","name":"…"}, …] (höchstens 60).
create or replace function public.admin_create_users(p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r jsonb;
  v_out jsonb := '[]'::jsonb;
  v_res jsonb;
begin
  perform public._require_admin();
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) not between 1 and 60 then
    raise exception 'Bitte 1 bis 60 Zeilen angeben.' using errcode = '22023';
  end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    begin
      v_res := public._create_user(r->>'email', r->>'password', r->>'name');
      v_out := v_out || jsonb_build_array(jsonb_build_object('email', v_res->>'email', 'ok', true, 'display_name', v_res->>'display_name'));
    exception when others then
      v_out := v_out || jsonb_build_array(jsonb_build_object('email', coalesce(r->>'email', ''), 'ok', false, 'error', sqlerrm));
    end;
  end loop;
  return v_out;
end;
$$;

create or replace function public.admin_set_password(p_user uuid, p_password text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._require_admin();
  if p_password is null or char_length(p_password) < 6 or char_length(p_password) > 72 then
    raise exception 'Das Kennwort braucht 6 bis 72 Zeichen.' using errcode = '22023';
  end if;
  update auth.users set encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf')), updated_at = now()
   where id = p_user;
  if not found then
    raise exception 'Nutzer nicht gefunden.' using errcode = 'P0002';
  end if;
end;
$$;

-- ----------------------------------------------------------------------------
-- 2. Abschreiben: kleine Belohnung (je Buch/Unit und Tag einmal, am Tag begrenzt)
-- ----------------------------------------------------------------------------

insert into public.app_settings (key, value) values
  ('copy_reward', 5),        -- Coins für eine abgeschriebene Lektion
  ('copy_daily_max', 5)      -- so viele Belohnungen pro Tag
on conflict (key) do nothing;

create table if not exists public.copy_rewards (
  user_id uuid not null references auth.users (id) on delete cascade,
  book_id uuid not null,
  unit integer not null,
  day date not null,
  primary key (user_id, book_id, unit, day)
);
alter table public.copy_rewards enable row level security;
revoke all on public.copy_rewards from anon, authenticated;

create or replace function public.claim_copy_reward(p_book_id uuid, p_unit integer, p_count integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  v_day date := (timezone('Europe/Berlin', now()))::date;
  v_reward integer := greatest(public.setting('copy_reward'), 0);
  v_balance integer;
begin
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  if p_count is null or p_count < 5 or not public.can_read_book(p_book_id) then
    return jsonb_build_object('reward', 0, 'reason', 'zu_kurz');
  end if;
  if (select count(*) from public.copy_rewards where user_id = v_me and day = v_day) >= public.setting('copy_daily_max') then
    return jsonb_build_object('reward', 0, 'reason', 'tageslimit');
  end if;
  insert into public.copy_rewards (user_id, book_id, unit, day) values (v_me, p_book_id, coalesce(p_unit, 0), v_day)
  on conflict do nothing;
  if not found then
    return jsonb_build_object('reward', 0, 'reason', 'schon_heute');
  end if;
  if v_reward > 0 then
    v_balance := public._grant_koins(v_me, v_reward, 'copy', null);
  end if;
  return jsonb_build_object('reward', v_reward, 'reason', 'ok', 'balance', v_balance);
end;
$$;

-- ----------------------------------------------------------------------------
-- 3. Neue Artikel
-- ----------------------------------------------------------------------------

insert into public.shop_items (id, kind, name, price, sort, required_role) values
  ('effect_zocker', 'effect', 'Reicher Zocker', 25000, 400, null),
  ('theme_chroma',  'theme',  'Farbwechsel',    100000, 220, null)
on conflict (id) do nothing;

-- ----------------------------------------------------------------------------
-- 4. Rechte
-- ----------------------------------------------------------------------------

do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig, p.proname
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('_create_user', 'admin_create_user', 'admin_create_users', 'admin_set_password', 'claim_copy_reward')
  loop
    if r.proname = '_create_user' then
      execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    else
      execute format('revoke all on function %s from public, anon', r.sig);
      execute format('grant execute on function %s to authenticated', r.sig);
    end if;
  end loop;
end;
$$;


-- ===== 0017_big_coins_wave.sql =====
-- ============================================================================
-- 0017: Riesige Guthaben (bigint, bis 9 Billiarden), Admin-!pay mit k/m/mrd/b, Spiel „Wave“.
-- Wiederholbar. Nach 0016 ausführen.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Guthaben und Verlauf als bigint
-- ----------------------------------------------------------------------------

alter table public.koin_wallets alter column balance type bigint;
alter table public.koin_ledger alter column amount type bigint;

drop function if exists public._grant_koins(uuid, integer, text, text);
create or replace function public._grant_koins(p_user uuid, p_amount bigint, p_reason text, p_ref text default null)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance bigint;
begin
  if p_amount = 0 then
    return coalesce((select balance from public.koin_wallets where user_id = p_user), 0);
  end if;
  insert into public.koin_wallets (user_id) values (p_user) on conflict do nothing;
  update public.koin_wallets
     set balance = balance + p_amount
   where user_id = p_user and balance + p_amount >= 0 and balance + p_amount <= 9000000000000000
   returning balance into v_balance;
  if v_balance is null then
    if p_amount > 0 then
      raise exception 'Das Guthaben darf 9.000.000.000.000.000 Coins nicht übersteigen.' using errcode = '22023';
    end if;
    raise exception 'Nicht genug Coins.' using errcode = '23514';
  end if;
  insert into public.koin_ledger (user_id, amount, reason, ref) values (p_user, p_amount, p_reason, p_ref);
  return v_balance;
end;
$$;

-- Anzeige mit Punkten: 1000000 -> 1.000.000
create or replace function public._fmt_coins(p_n bigint)
returns text
language sql
immutable
set search_path = public
as $$
  select replace(to_char(p_n, 'FM999,999,999,999,999,999'), ',', '.');
$$;

-- Zahl lesen: "1000", bei Admins auch "1k", "2,5m", "3mrd", "1b" (b/bio = Billion = 10^12).
create or replace function public._parse_coins(p_text text, p_admin boolean)
returns bigint
language plpgsql
immutable
set search_path = public
as $$
declare
  t text := lower(regexp_replace(coalesce(p_text, ''), '[\s_]', '', 'g'));
  m text[];
  base numeric;
  mult numeric;
begin
  if t ~ '^[0-9]{1,16}$' then
    return t::bigint;
  end if;
  if not p_admin then
    return null;
  end if;
  m := regexp_match(t, '^([0-9]{1,6}(?:[.,][0-9]{1,6})?)(k|m|mio|mrd|b|bio)$');
  if m is null then
    return null;
  end if;
  base := replace(m[1], ',', '.')::numeric;
  mult := case m[2] when 'k' then 1e3 when 'm' then 1e6 when 'mio' then 1e6 when 'mrd' then 1e9 else 1e12 end;
  return round(base * mult)::bigint;
end;
$$;

-- ----------------------------------------------------------------------------
-- 2. Coins schenken/abziehen: bis 1 Billiarde auf einmal
-- ----------------------------------------------------------------------------

drop function if exists public.admin_grant_koins(uuid, integer, text);
create or replace function public.admin_grant_koins(p_user uuid, p_amount bigint, p_note text default '')
returns bigint
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._require_admin();
  if p_amount is null or p_amount = 0 or abs(p_amount) > 1000000000000000 then
    raise exception 'Ungültiger Betrag (höchstens 1.000.000.000.000.000).' using errcode = '22023';
  end if;
  if not exists (select 1 from public.profiles where id = p_user) then
    raise exception 'Nutzer nicht gefunden.' using errcode = 'P0002';
  end if;
  return public._grant_koins(p_user, p_amount, 'admin', nullif(left(btrim(coalesce(p_note, '')), 100), ''));
end;
$$;

-- ----------------------------------------------------------------------------
-- 3. Funktionen mit Guthaben-Rückgabe auf bigint umstellen
-- ----------------------------------------------------------------------------

do $$
declare
  r record;
  v_def text;
  v_new text;
  v_args text;
begin
  for r in select * from (values
      ('get_wallet',           array[array['RETURNS integer', 'RETURNS bigint']]),
      ('buy_item',             array[array['RETURNS integer', 'RETURNS bigint'], array['v_balance integer', 'v_balance bigint']]),
      ('claim_quest',          array[array['RETURNS integer', 'RETURNS bigint']]),
      ('redeem_code',          array[array['v_balance integer', 'v_balance bigint']]),
      ('gambling_play',        array[array['v_balance integer', 'v_balance bigint']]),
      ('start_game',           array[array['v_balance integer', 'v_balance bigint'], array['''crossy'', ''flappy''', '''crossy'', ''flappy'', ''wave''']]),
      ('finish_game',          array[array['v_balance integer', 'v_balance bigint'], array['when ''crossy'' then 4 else', 'when ''crossy'' then 4 when ''wave'' then 2 else']]),
      ('get_game_board',       array[array['''crossy'', ''flappy''', '''crossy'', ''flappy'', ''wave''']]),
      ('get_coin_leaderboard', array[array['koins integer', 'koins bigint']]),
      ('admin_list_users',     array[array['koins integer', 'koins bigint']])
    ) as t(fn, reps)
  loop
    select pg_get_functiondef(p.oid), pg_get_function_identity_arguments(p.oid) into v_def, v_args
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = r.fn
     limit 1;
    continue when v_def is null;
    v_new := v_def;
    for i in 1 .. array_length(r.reps, 1) loop
      v_new := replace(v_new, r.reps[i][1], r.reps[i][2]);
    end loop;
    continue when v_new = v_def;
    execute format('drop function public.%I(%s)', r.fn, v_args);
    execute v_new;
  end loop;
end;
$$;

-- ----------------------------------------------------------------------------
-- 4. Spiel „Wave“ erlauben
-- ----------------------------------------------------------------------------

alter table public.game_runs drop constraint if exists game_runs_game_check;
alter table public.game_runs add constraint game_runs_game_check
  check (game in ('snake', 'tetris', 'blast', 'crossy', 'flappy', 'wave'));

-- ----------------------------------------------------------------------------
-- 5. Chat-Befehl !pay: Admins dürfen 1k / 1m / 1mrd / 1b schreiben und sind nicht begrenzt
--    (die Coins eines Admins werden dabei neu erzeugt, nicht von seinem Konto abgezogen)
-- ----------------------------------------------------------------------------

create or replace function public.post_chat(p_body text)
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
  v_amount bigint;
  v_sent bigint;
  v_rest text;
  v_muted timestamptz;
  v_admin boolean := public.is_admin();
begin
  perform public._feature_guard('chat');
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

  -- Befehl: !pay @Anzeigename 100   (Admins auch: 1k, 2,5m, 3mrd, 1b)
  if v_body ~* '^!pay(\s|$)' then
    v_m := regexp_match(v_body, '^!pay\s+@?(.+?)\s+(\S+)$', 'i');
    if v_m is null then
      raise exception 'So geht es: !pay @Anzeigename 100' using errcode = '22023';
    end if;
    v_amount := public._parse_coins(v_m[2], v_admin);
    if v_amount is null then
      raise exception 'So geht es: !pay @Anzeigename 100' using errcode = '22023';
    end if;
    if v_amount < 1 then
      raise exception 'Der Betrag muss mindestens 1 sein.' using errcode = '22023';
    end if;
    if v_admin then
      if v_amount > 1000000000000000 then
        raise exception 'Höchstens 1.000.000.000.000.000 auf einmal.' using errcode = '22023';
      end if;
    elsif v_amount > public.setting('pay_max') then
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
    select display_name into v_me_name from public.profiles where id = v_me;
    if v_admin then
      perform public._grant_koins(v_to, v_amount, 'pay_in', v_me::text);
    else
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
      perform public._grant_koins(v_me, -v_amount, 'pay_out', v_to::text);
      perform public._grant_koins(v_to, v_amount, 'pay_in', v_me::text);
    end if;
    insert into public.user_messages (user_id, from_id, body)
    values (v_to, null, v_me_name || ' hat dir ' || public._fmt_coins(v_amount) || ' Coins geschickt. 💵');
    insert into public.chat_messages (user_id, body, kind)
    values (v_me, v_me_name || ' hat ' || v_to_name || ' ' || public._fmt_coins(v_amount) || ' Coins geschickt 💵', 'pay')
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

-- ----------------------------------------------------------------------------
-- 6. Rechte
-- ----------------------------------------------------------------------------

do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig, p.proname
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('_grant_koins', '_fmt_coins', '_parse_coins', 'admin_grant_koins', 'get_wallet', 'buy_item', 'claim_quest',
                         'redeem_code', 'gambling_play', 'start_game', 'finish_game', 'get_game_board', 'get_coin_leaderboard',
                         'admin_list_users', 'post_chat')
  loop
    if r.proname in ('_grant_koins', '_fmt_coins', '_parse_coins') then
      execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    else
      execute format('revoke all on function %s from public, anon', r.sig);
      execute format('grant execute on function %s to authenticated', r.sig);
    end if;
  end loop;
end;
$$;


-- ===== 0018_print_shop.sql =====
-- ============================================================================
-- 0018: 3D-Druck-Shop – Katalog, Farben, Preisrechner, Bestellungen, eigene Anfragen,
-- Fortschritt, Rabatt per Coins, Sperren für Spam, Dateiablage.
-- Wiederholbar. Nach 0017 ausführen. Alle Tabellen nur per Funktion erreichbar (kein RLS-Zugriff).
-- Geld wird in Cent gespeichert; bezahlt wird bei der Übergabe (kein Bezahlsystem).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Einstellungen (alle Werte stellt der Admin selbst ein)
-- ----------------------------------------------------------------------------

create table if not exists public.print_settings (
  key text primary key,
  value numeric not null,
  label text not null,
  unit text not null default '',
  hint text not null default '',
  min_value numeric not null default 0,
  max_value numeric not null default 100000,
  sort integer not null default 100
);
alter table public.print_settings enable row level security;
revoke all on public.print_settings from anon, authenticated;

-- Beschriftungen und Grenzen werden bei jedem Lauf aktualisiert, die Werte des Admins bleiben erhalten.
insert into public.print_settings (key, value, label, unit, hint, min_value, max_value, sort) values
  ('orders_open',        1,     'Bestellungen offen',                 '1 = ja, 0 = nein', 'Bei 0 kann niemand etwas Neues bestellen (z. B. Urlaub, Drucker kaputt).', 0, 1, 10),
  ('filament_eur_per_kg', 22,   'Filamentpreis',                      '€ pro kg',  'Was dich 1 kg Filament kostet.', 0, 500, 20),
  ('filament_density',   1.24,  'Dichte des Filaments',               'g/cm³',     'PLA ≈ 1,24, PETG ≈ 1,27, ABS ≈ 1,04.', 0.5, 3, 30),
  ('material_share',     35,    'Materialanteil (Wände + Füllung)',   '%',         'Welcher Teil des Modellvolumens wirklich Filament ist. Typisch 20–40.', 5, 100, 40),
  ('extrude_cm3_per_h',  20,    'Druckgeschwindigkeit',               'cm³ Material/h', 'Wie viel Filament dein Drucker pro Stunde verarbeitet. Daraus entsteht die geschätzte Druckzeit.', 1, 500, 50),
  ('setup_minutes',      5,     'Rüstzeit pro Auftrag',               'Minuten',   'Aufheizen, Ablösen, Nacharbeit.', 0, 600, 60),
  ('power_watts',        120,   'Stromverbrauch des Druckers',        'Watt',      'Durchschnitt während des Drucks.', 1, 3000, 70),
  ('eur_per_kwh',        0.35,  'Strompreis',                         '€ pro kWh', '', 0, 5, 80),
  ('machine_eur_per_h',  0.30,  'Maschinenkosten (Verschleiß)',       '€ pro Stunde', 'Düse, Riemen, Druckbett usw.', 0, 100, 90),
  ('base_fee_eur',       1.00,  'Aufwand pro Auftrag',                '€',         'Feste Pauschale für Vorbereitung und Übergabe.', 0, 100, 100),
  ('margin_percent',     25,    'Aufschlag',                          '%',         'Auf Material, Strom und Maschine.', 0, 500, 110),
  ('min_price_eur',      1.50,  'Mindestpreis',                       '€',         'Darunter wird nichts verkauft.', 0, 100, 120),
  ('rush_fee_eur',       2.00,  'Aufpreis „Beschleunigt“',            '€',         'Beschleunigte Aufträge kommen in der Warteschlange nach vorn.', 0, 100, 130),
  ('discount_coins',     1000,  'Rabatt: Preis in Coins',             'Coins',     'So viele Coins kostet der Rabatt (einmal je Bestellung).', 1, 1000000000, 140),
  ('discount_percent',   10,    'Rabatt: Höhe',                       '%',         'Gilt für den Artikelpreis, nicht für „Beschleunigt“. Nicht stapelbar.', 0, 50, 150),
  ('max_open_requests',  3,     'Offene Anfragen pro Person',         'Stück',     'Anti-Spam: so viele unbeantwortete Anfragen gleichzeitig.', 1, 50, 160),
  ('max_orders_per_day', 8,     'Bestellungen pro Person und Tag',    'Stück',     'Anti-Spam.', 1, 100, 170),
  ('max_qty',            10,    'Höchste Stückzahl',                  'Stück',     'Pro Bestellung.', 1, 100, 180),
  ('max_volume_cm3',     2000,  'Größtes Teil (Volumen)',             'cm³',       'Größere STL-Dateien werden abgelehnt.', 1, 20000, 190),
  ('goal_visible',       1,     'Verdienst-Anzeige zeigen',           '1 = ja, 0 = nein', 'Balken „So viel vom Ziel ist schon verdient“ oben im 3D-Druck-Shop.', 0, 1, 200),
  ('goal_eur',           20,    'Ziel (z. B. Claude Pro)',            '€',         'Betrag, den der Balken als 100 % nimmt.', 1, 100000, 210),
  ('goal_offset_eur',    0,     'Verdienst-Korrektur',                '€',         'Wird zum Umsatz der übergebenen Bestellungen addiert (auch negativ, z. B. für Bargeld ohne Bestellung).', -100000, 100000, 220)
on conflict (key) do update
  set label = excluded.label, unit = excluded.unit, hint = excluded.hint,
      min_value = excluded.min_value, max_value = excluded.max_value, sort = excluded.sort;
