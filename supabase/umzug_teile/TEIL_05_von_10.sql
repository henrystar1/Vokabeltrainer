
create or replace function public.plus_buy(p_tier text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  p public.profiles;
  t jsonb;
  v_days integer;
  v_price bigint;
  v_until timestamptz;
begin
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  select e into t from jsonb_array_elements(public._plus_tiers()) e where e ->> 'id' = p_tier;
  if t is null then
    raise exception 'Unbekannte Stufe.' using errcode = '22023';
  end if;
  v_days := (t ->> 'days')::integer;
  v_price := (t ->> 'price')::bigint;
  select * into p from public.profiles where id = v_me for update;
  if p.plus_until >= '2099-01-01'::timestamptz then
    raise exception 'Du hast Plus schon für immer.' using errcode = '23505';
  end if;
  perform public._grant_koins(v_me, -v_price, 'plus_buy', p_tier);
  v_until := case when v_days >= 36500 then '2100-01-01'::timestamptz
                  else greatest(coalesce(p.plus_until, now()), now()) + make_interval(days => v_days) end;
  update public.profiles set plus_until = v_until where id = v_me;
  insert into public.plus_sales (user_id, kind, cents, days, coins, note)
  values (v_me, 'coins', 0, v_days, v_price, format('%s · %s Coins', t ->> 'label', v_price));
  delete from public.plus_requests where user_id = v_me;
  perform public._plus_apply_perks(v_me);
  return public.plus_status();
end;
$$;

-- Rückgängig: Tage zurücknehmen, bei Coin-Käufen die Coins erstatten.
create or replace function public.admin_plus_undo_sale(p_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  l public.plus_sales;
begin
  perform public._require_admin();
  select * into l from public.plus_sales where id = p_id for update;
  if not found then
    raise exception 'Eintrag nicht gefunden.' using errcode = 'P0002';
  end if;
  delete from public.plus_sales where id = l.id;
  if l.user_id is not null then
    if l.days >= 36500 then
      update public.profiles set plus_until = least(plus_until, now()) where id = l.user_id;
    else
      update public.profiles
         set plus_until = plus_until - make_interval(days => l.days),
             plus_trial_used = case when l.kind = 'coins' and l.coins = 0 then false else plus_trial_used end
       where id = l.user_id and plus_until is not null;
    end if;
    if l.kind = 'coins' then
      perform public._grant_koins(l.user_id, case when l.coins > 0 then l.coins else public._pls('plus_coin_price')::bigint end, 'plus_refund', l.id::text);
    end if;
    perform public._plus_sync(l.user_id);
  end if;
end;
$$;

-- ----------------------------------------------------------------------------
-- 3. Coins ×1,5 mit Plus (nicht bei Gambling-Gewinnen, Überweisungen, Rückerstattungen, Admin)
-- ----------------------------------------------------------------------------

create or replace function public._grant_koins(p_user uuid, p_amount bigint, p_reason text, p_ref text default null)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  c_max constant bigint := 9000000000000000;
  v_balance bigint;
  v_amount bigint := p_amount;
  v_strict boolean := p_reason in ('admin', 'pay_in', 'print_refund', 'plus_refund');
begin
  if p_amount = 0 then
    return coalesce((select balance from public.koin_wallets where user_id = p_user), 0);
  end if;
  -- Gesperrte Personen dürfen nur noch für Gambling und Spiele zahlen.
  if p_amount < 0 and p_reason not in ('gambling_bet', 'game_fee', 'admin')
     and exists (select 1 from public.profiles where id = p_user and coins_locked_at is not null) then
    raise exception 'Dein Guthaben ist vom Admin gesperrt. Du kannst nur noch spielen und gamblen.' using errcode = '55000';
  end if;
  insert into public.koin_wallets (user_id) values (p_user) on conflict do nothing;

  if v_amount > 0 and not v_strict then
    -- Plus-Bonus
    if p_reason <> 'gambling_win' and public._plus_active(p_user) then
      v_amount := round(v_amount * greatest(public._pls('plus_coin_mult'), 1))::bigint;
    end if;
    select least(v_amount, greatest(c_max - w.balance, 0)) into v_amount from public.koin_wallets w where w.user_id = p_user;
    if v_amount <= 0 then
      return (select balance from public.koin_wallets where user_id = p_user);
    end if;
  end if;

  update public.koin_wallets
     set balance = balance + v_amount
   where user_id = p_user and balance + v_amount >= 0 and balance + v_amount <= c_max
   returning balance into v_balance;
  if v_balance is null then
    if v_amount > 0 then
      raise exception 'Das Guthaben darf 9.000.000.000.000.000 Coins nicht übersteigen.' using errcode = '22023';
    end if;
    raise exception 'Nicht genug Coins.' using errcode = '23514';
  end if;
  insert into public.koin_ledger (user_id, amount, reason, ref) values (p_user, v_amount, p_reason, p_ref);
  return v_balance;
end;
$$;

-- Ranglistenpunkte ×1,5 mit Plus (Wochenliga)
create or replace function public._week_points(p_user uuid, p_from date)
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select round(coalesce(sum(
           least(d.answers_correct, 200) * 2
           + case when d.answers_total > 0 then 25 else 0 end
           + case when d.answers_total >= 20 then round(20.0 * d.answers_correct / d.answers_total)::int else 0 end
         ), 0) * case when public._plus_active(p_user) then greatest(public._pls('plus_points_mult'), 1) else 1 end)::bigint
    from public.daily_stats d
   where d.user_id = p_user and d.day between p_from and p_from + 6;
$$;

-- ----------------------------------------------------------------------------
-- 4. Gambling: bessere Gewinnchance mit Plus
-- ----------------------------------------------------------------------------

do $$
declare
  v_def text;
  v_new text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'gambling_play' limit 1;
  if v_def is not null and position('plus_gamble_boost_percent' in v_def) = 0 then
    v_new := regexp_replace(v_def,
      E'v_win (integer|bigint) := least\\(greatest\\(public\\.setting\\(''gambling_win_permille''\\), 0\\), 1000\\);',
      E'v_win integer := least(round(greatest(public.setting(''gambling_win_permille''), 0) * (1 + case when public._plus_active((select auth.uid())) then public._pls(''plus_gamble_boost_percent'') / 100.0 else 0 end))::integer, 1000);');
    if v_new = v_def then
      raise exception 'gambling_play konnte nicht angepasst werden.';
    end if;
    execute v_new;
  end if;
end;
$$;

-- ----------------------------------------------------------------------------
-- 5. Vokabeln sofort wieder fällig (Plus): Stufe 5 → Stufe 4
-- ----------------------------------------------------------------------------

create or replace function public.plus_make_due(p_book uuid default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  v_n integer;
begin
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  if not public._plus_active(v_me) then
    raise exception 'Dafür brauchst du Vokabeltrainer +.' using errcode = '42501';
  end if;
  update public.user_vocabulary_progress up
     set learning_level = 4
   where up.user_id = v_me and up.learning_level >= 5
     and (p_book is null or exists (
            select 1 from public.vocabulary_placements vp
              join public.pages pg on pg.id = vp.page_id
              join public.units un on un.id = pg.unit_id
             where vp.vocabulary_id = up.vocabulary_id and un.book_id = p_book));
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- ----------------------------------------------------------------------------
-- 6. Wiederbeleben im Spiel (Plus)
-- ----------------------------------------------------------------------------

create or replace function public.plus_revive(p_run uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  r public.game_runs;
  v_price bigint := public._pls('plus_revive_price')::bigint;
  v_balance bigint;
begin
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  if not public._plus_active(v_me) then
    raise exception 'Wiederbeleben gibt es mit Vokabeltrainer +.' using errcode = '42501';
  end if;
  select * into r from public.game_runs where id = p_run and user_id = v_me for update;
  if not found then
    raise exception 'Spiel nicht gefunden.' using errcode = 'P0002';
  end if;
  if r.finished_at is not null then
    raise exception 'Dieses Spiel ist schon gewertet.' using errcode = '22023';
  end if;
  if r.revives >= public._pls('plus_revive_max') then
    raise exception 'Du hast dich in dieser Runde schon oft genug wiederbelebt.' using errcode = '22023';
  end if;
  v_balance := public._grant_koins(v_me, -v_price, 'game_fee', p_run::text);
  update public.game_runs set revives = revives + 1 where id = p_run;
  return jsonb_build_object('balance', v_balance, 'revives', r.revives + 1, 'price', v_price);
end;
$$;

-- ----------------------------------------------------------------------------
-- 7. Quests: Ketten und Plus-Quests
--    Pro Familie wird die erste noch nicht abgeholte Stufe angezeigt; nach dem Abholen erscheint die nächste.
-- ----------------------------------------------------------------------------

drop function if exists public.get_quests();
create function public.get_quests()
returns table (id text, family text, stage integer, stages integer, progress integer, goal integer, reward integer, claimed boolean, plus_only boolean)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  v_today date := (now() at time zone 'Europe/Berlin')::date;
  v_answers integer;
  v_perfect integer;
  v_sprint integer;
  v_duel integer;
  v_games integer;
begin
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  v_answers := coalesce((select d.answers_correct from public.daily_stats d where d.user_id = v_me and d.day = v_today), 0);
  v_perfect := (select count(*)::integer from public.learning_sessions s
                 where s.user_id = v_me and (s.started_at at time zone 'Europe/Berlin')::date = v_today
                   and s.answers_total >= 10 and s.answers_correct = s.answers_total);
  v_sprint := coalesce((select max(p.score) from public.sprint_scores p
                         where p.user_id = v_me and (p.created_at at time zone 'Europe/Berlin')::date = v_today), 0);
  v_duel := (select count(*)::integer from public.duel_results r
              where r.user_id = v_me and (r.submitted_at at time zone 'Europe/Berlin')::date = v_today);
  v_games := (select count(*)::integer from public.game_runs g
               where g.user_id = v_me and g.finished_at is not null and (g.started_at at time zone 'Europe/Berlin')::date = v_today);
  return query
  with defs(family, stage, goal, mult, base, plus_only) as (values
    ('answers', 1, 20, 1, public.setting('quest_reward_answers'), false),
    ('answers', 2, 50, 2, public.setting('quest_reward_answers'), false),
    ('answers', 3, 100, 3, public.setting('quest_reward_answers'), false),
    ('answers', 4, 200, 5, public.setting('quest_reward_answers'), false),
    ('perfect', 1, 1, 1, public.setting('quest_reward_perfect'), false),
    ('perfect', 2, 2, 2, public.setting('quest_reward_perfect'), false),
    ('perfect', 3, 3, 3, public.setting('quest_reward_perfect'), false),
    ('sprint', 1, 15, 1, public.setting('quest_reward_sprint'), false),
    ('sprint', 2, 25, 2, public.setting('quest_reward_sprint'), false),
    ('sprint', 3, 40, 4, public.setting('quest_reward_sprint'), false),
    ('duel', 1, 1, 1, public.setting('quest_reward_duel'), false),
    ('duel', 2, 4, 3, public.setting('quest_reward_duel'), false),
    ('duel', 3, 8, 5, public.setting('quest_reward_duel'), false),
    ('plus_answers', 1, 300, 1, 15, true),
    ('plus_answers', 2, 500, 2, 15, true),
    ('plus_games', 1, 3, 1, 10, true),
    ('plus_games', 2, 8, 2, 10, true)),
  allq as (
    select d.family, d.stage, d.goal, (d.base * d.mult)::integer as reward, d.plus_only,
           count(*) over (partition by d.family) as stages,
           case d.family when 'answers' then v_answers when 'perfect' then v_perfect when 'sprint' then v_sprint
                         when 'duel' then v_duel when 'plus_answers' then v_answers else v_games end as progress,
           exists (select 1 from public.quest_claims c where c.user_id = v_me and c.day = v_today and c.quest_id = d.family || '_' || d.stage) as claimed
      from defs d)
  select distinct on (f.family) f.family || '_' || f.stage, f.family, f.stage, f.stages::integer,
         least(f.progress, f.goal)::integer, f.goal, f.reward, f.claimed, f.plus_only
    from allq f
   order by f.family, f.claimed, case when f.claimed then -f.stage else f.stage end;
end;
$$;

create or replace function public.claim_quest(p_id text)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  v_today date := (now() at time zone 'Europe/Berlin')::date;
  q record;
begin
  perform public._feature_guard('quests');
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  select * into q from public.get_quests() g where g.id = p_id;
  if not found then
    raise exception 'Quest nicht gefunden.' using errcode = 'P0002';
  end if;
  if q.plus_only and not public._plus_active(v_me) then
    raise exception 'Diese Quest gibt es mit Vokabeltrainer +.' using errcode = '42501';
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
-- 8. Weitere Plus-Artikel
-- ----------------------------------------------------------------------------

insert into public.shop_items (id, kind, name, price, sort, plus_only) values
  ('avatar_plus_supernova', 'avatar', 'Supernova',          0, 920, true),
  ('avatar_plus_portal',    'avatar', 'Portal',             0, 930, true),
  ('avatar_plus_aurora',    'avatar', 'Aurora-Kugel',       0, 940, true),
  ('avatar_plus_galaxie',   'avatar', 'Spiralgalaxie',      0, 950, true),
  ('effect_plus_blitz',     'effect', 'Plus Blitzschlag',   0, 910, true),
  ('effect_plus_hologramm', 'effect', 'Plus Hologramm',     0, 920, true),
  ('color_plus_lava',       'color',  'Plus Lava',          0, 930, true),
  ('color_plus_galaxie',    'color',  'Plus Galaxie',       0, 940, true),
  ('color_plus_hologramm',  'color',  'Plus Hologramm',     0, 950, true),
  ('theme_plus_nebel',      'theme',  'Plus Nebel',         0, 920, true),
  ('theme_plus_cyber',      'theme',  'Plus Cyber',         0, 930, true)
on conflict (id) do update set name = excluded.name, plus_only = true, kind = excluded.kind;

-- ----------------------------------------------------------------------------
-- 9. Rechte
-- ----------------------------------------------------------------------------

do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig, p.proname
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('_plus_tiers', '_grant_koins', '_week_points', 'plus_status', 'plus_buy', 'admin_plus_undo_sale',
                         'gambling_play', 'plus_make_due', 'plus_revive', 'get_quests', 'claim_quest')
  loop
    if r.proname in ('_plus_tiers', '_grant_koins', '_week_points') then
      execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    else
      execute format('revoke all on function %s from public, anon', r.sig);
      execute format('grant execute on function %s to authenticated', r.sig);
    end if;
  end loop;
end;
$$;

-- ===== 0025_web_push =====
-- ============================================================================
-- 0025: Push-Nachrichten fürs iPad (auch wenn die App zu ist) – Web Push
-- Speichert die Geräte (Abos), schickt bei @-Erwähnung / Flüstern / Team-Nachricht / fertigem Druck
-- eine Anfrage an die Edge Function „push“ (über pg_net). Fehler dabei stören nie das Speichern der Nachricht.
-- Wiederholbar. Nach 0024 ausführen. Einrichtung: supabase/functions/push/README.md
-- ============================================================================

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text not null default '',
  created_at timestamptz not null default now(),
  last_ok_at timestamptz
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);
alter table public.push_subscriptions enable row level security;
revoke all on public.push_subscriptions from anon, authenticated;

-- Einstellungen der Einrichtung: 'url' (Adresse der Edge Function), 'public_key' (VAPID, öffentlich), 'secret' (geheim).
create table if not exists public.push_config (
  key text primary key,
  value text not null
);
alter table public.push_config enable row level security;
revoke all on public.push_config from anon, authenticated;

-- Protokoll der letzten Sendungen (zum Fehlersuchen für Admins)
create table if not exists public.push_log (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  title text not null,
  body text not null,
  url text not null default '',
  status text not null default 'queued',
  created_at timestamptz not null default now()
);
alter table public.push_log enable row level security;
revoke all on public.push_log from anon, authenticated;

-- ----------------------------------------------------------------------------
-- Senden (intern)
-- ----------------------------------------------------------------------------

create or replace function public._push_cfg(p_key text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select nullif(btrim(value), '') from public.push_config where key = p_key;
$$;

-- Legt die Sendung ins Protokoll und stößt über pg_net die Edge Function an. Gibt true zurück, wenn gesendet wurde.
create or replace function public._push_send(p_user uuid, p_title text, p_body text, p_url text default '/', p_tag text default null)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_url text := public._push_cfg('url');
  v_secret text := public._push_cfg('secret');
  v_log bigint;
begin
  if p_user is null or v_url is null or v_secret is null then
    return false;
  end if;
  if not exists (select 1 from public.push_subscriptions where user_id = p_user) then
    return false;
  end if;
  insert into public.push_log (user_id, title, body, url, status)
  values (p_user, left(p_title, 80), left(p_body, 200), left(coalesce(p_url, '/'), 200), 'queued')
  returning id into v_log;
  delete from public.push_log where created_at < now() - interval '7 days' and id % 20 = v_log % 20;
  if to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is null then
    update public.push_log set status = 'kein pg_net' where id = v_log;
    return false;
  end if;
  begin
    execute 'select net.http_post(url := $1, body := $2, headers := $3, timeout_milliseconds := 8000)'
      using v_url,
            jsonb_build_object('user_id', p_user, 'title', left(p_title, 80), 'body', left(p_body, 200),
                               'url', coalesce(p_url, '/'), 'tag', p_tag),
            jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', v_secret);
    update public.push_log set status = 'gesendet' where id = v_log;
    return true;
  exception when others then
    update public.push_log set status = left('Fehler: ' || sqlerrm, 120) where id = v_log;
    return false;
  end;
end;
$$;

-- Schickt nicht, wenn die Person die App gerade offen hat (dann sieht sie den Hinweis am Rand).
create or replace function public._push_idle(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select p.last_seen_at is null or p.last_seen_at < now() - interval '90 seconds'
                     from public.profiles p where p.id = p_user), false);
$$;

-- ----------------------------------------------------------------------------
-- Auslöser
-- ----------------------------------------------------------------------------

create or replace function public._push_on_chat()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_from text;
  r record;
  v_pattern text;
begin
  if new.kind = 'pay' then
    return new;
  end if;
  select display_name into v_from from public.profiles where id = new.user_id;
  if new.kind = 'whisper' then
    if new.recipient_id is not null and public._push_idle(new.recipient_id)
       and coalesce((select s.notify_mentions from public.user_settings s where s.user_id = new.recipient_id), true) then
      perform public._push_send(new.recipient_id, coalesce(v_from, 'Jemand') || ' flüstert dir zu', left(new.body, 140), '/chat', 'chat');
    end if;
    return new;
  end if;
  for r in
    select distinct s.user_id, p.display_name,
           coalesce(us.notify_mentions, true) as n_mention, coalesce(us.notify_chat, false) as n_chat
      from public.push_subscriptions s
      join public.profiles p on p.id = s.user_id
      left join public.user_settings us on us.user_id = s.user_id
     where s.user_id <> new.user_id
  loop
    if not public._push_idle(r.user_id) then
      continue;
    end if;
    v_pattern := '(^|[^[:alnum:]_])@' || regexp_replace(coalesce(r.display_name, ''), '([.^$*+?()\[\]{}|\\])', '\\\1', 'g') || '($|[^[:alnum:]_])';
    if r.n_mention and new.body ~* v_pattern then
      perform public._push_send(r.user_id, coalesce(v_from, 'Jemand') || ' hat dich erwähnt', left(new.body, 140), '/chat', 'chat');
    elsif r.n_chat then
      perform public._push_send(r.user_id, coalesce(v_from, 'Chat'), left(new.body, 140), '/chat', 'chat');
    end if;
  end loop;
  return new;
exception when others then
  return new;
end;
$$;

drop trigger if exists chat_messages_push on public.chat_messages;
create trigger chat_messages_push
  after insert on public.chat_messages
  for each row execute function public._push_on_chat();

create or replace function public._push_on_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._push_send(
    new.user_id,
    case when new.from_id is null then 'Nachricht vom Team' else 'Nachricht von ' || coalesce((select display_name from public.profiles where id = new.from_id), 'dem Team') end,
    replace(left(new.body, 160), 'Koins', 'Coins'), '/', 'dm');
  return new;
exception when others then
  return new;
end;
$$;

drop trigger if exists user_messages_push on public.user_messages;
create trigger user_messages_push
  after insert on public.user_messages
  for each row execute function public._push_on_message();

create or replace function public._push_on_print_ready()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'lieferbereit' and old.status is distinct from 'lieferbereit'
     and coalesce((select s.notify_print from public.user_settings s where s.user_id = new.user_id), true) then
    perform public._push_send(new.user_id, 'Dein Druck ist fertig', '„' || coalesce(new.title, 'Druck') || '“ liegt zur Übergabe bereit.', '/druckshop?t=bestellungen', 'print');
  end if;
  return new;
exception when others then
  return new;
end;
$$;

drop trigger if exists print_orders_push on public.print_orders;
create trigger print_orders_push
  after update on public.print_orders
  for each row execute function public._push_on_print_ready();

-- ----------------------------------------------------------------------------
-- Funktionen für die App
-- ----------------------------------------------------------------------------

create or replace function public.push_status()
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
    raise exception 'Kein Zugriff.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'configured', public._push_cfg('public_key') is not null and public._push_cfg('url') is not null and public._push_cfg('secret') is not null,
    'public_key', public._push_cfg('public_key'),
    'devices', (select count(*) from public.push_subscriptions where user_id = v_me));
end;
$$;

create or replace function public.push_subscribe(p_endpoint text, p_p256dh text, p_auth text, p_ua text default '')
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
begin
  if v_me is null or public.is_blocked() then
    raise exception 'Kein Zugriff.' using errcode = '42501';
  end if;
  if p_endpoint !~ '^https://' or char_length(p_endpoint) > 1000 or coalesce(p_p256dh, '') = '' or coalesce(p_auth, '') = '' then
    raise exception 'Ungültiges Gerät.' using errcode = '22023';
  end if;
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
  values (v_me, p_endpoint, left(p_p256dh, 200), left(p_auth, 100), left(coalesce(p_ua, ''), 200))
  on conflict (endpoint) do update
    set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, user_agent = excluded.user_agent;
  -- höchstens 5 Geräte pro Person
  delete from public.push_subscriptions d
   where d.user_id = v_me
     and d.id in (select id from public.push_subscriptions where user_id = v_me order by created_at desc offset 5);
end;
$$;

create or replace function public.push_unsubscribe(p_endpoint text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
begin
  if v_me is null then
    raise exception 'Kein Zugriff.' using errcode = '42501';
  end if;
  delete from public.push_subscriptions
   where user_id = v_me and (p_endpoint is null or endpoint = p_endpoint);
end;
$$;

-- Test-Nachricht an sich selbst. Gibt zurück, ob die Anfrage rausging.
create or replace function public.push_test()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
begin
  if v_me is null or public.is_blocked() then
    raise exception 'Kein Zugriff.' using errcode = '42501';
  end if;
  return public._push_send(v_me, 'Test-Nachricht', 'Wenn du das siehst, funktionieren Push-Nachrichten.', '/einstellungen', 'test');
end;
$$;

-- Nur Admins: Zustand und letzte Sendungen
create or replace function public.admin_push_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public._require_admin();
  return jsonb_build_object(
    'url', public._push_cfg('url') is not null,
    'public_key', public._push_cfg('public_key') is not null,
    'secret', public._push_cfg('secret') is not null,
    'pg_net', to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is not null,
    'devices', (select count(*) from public.push_subscriptions),
    'users', (select count(distinct user_id) from public.push_subscriptions),
    'log', coalesce((select jsonb_agg(jsonb_build_object('title', l.title, 'status', l.status, 'created_at', l.created_at, 'name', (select display_name from public.profiles where id = l.user_id)) order by l.id desc)
                       from (select * from public.push_log order by id desc limit 15) l), '[]'::jsonb));
end;
$$;

-- Die Edge Function darf Geräte lesen und tote Geräte löschen (über den Service-Key, nicht über diese Funktionen).
grant select, delete, update on public.push_subscriptions to service_role;

do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig, p.proname
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('_push_cfg', '_push_send', '_push_idle', '_push_on_chat', '_push_on_message', '_push_on_print_ready',
                         'push_status', 'push_subscribe', 'push_unsubscribe', 'push_test', 'admin_push_overview')
  loop
    if left(r.proname, 1) = '_' then
      execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    else
      execute format('revoke all on function %s from public, anon', r.sig);
      execute format('grant execute on function %s to authenticated', r.sig);
    end if;
  end loop;
end;
$$;

-- ===== 0026_push_online =====
-- ============================================================================
-- 0026: Push auch bei geöffneter App, und Push, wenn jemand online kommt
-- - Bisher kam kein Push, wenn die App in den letzten 90 Sekunden aktiv war. Jetzt immer.
-- - „Wenn jemand online kommt“ (Einstellung notify_online: Mods/Admins oder alle) kommt jetzt auch als Push.
-- Wiederholbar. Nach 0025 ausführen.
-- ============================================================================

-- Früher: nur senden, wenn die Person gerade nicht aktiv ist. Jetzt: immer.
create or replace function public._push_idle(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select true;
$$;

create or replace function public._push_on_online()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_title text;
begin
  if new.online_since is null
     or (old.online_since is not null and new.online_since <= old.online_since)
     or coalesce(new.hide_presence, false) or coalesce(new.blocked, false) then
    return new;
  end if;
  v_title := new.display_name || ' ist online';
  for r in
    select distinct s.user_id, us.notify_online
      from public.push_subscriptions s
      join public.user_settings us on us.user_id = s.user_id
     where s.user_id <> new.id and us.notify_online <> 'off'
  loop
    if r.notify_online = 'all' or (new.role in ('mod', 'admin') and not coalesce(new.tags_hidden, false)) then
      -- nicht öfter als alle 10 Minuten pro Person
      if not exists (select 1 from public.push_log l where l.user_id = r.user_id and l.title = left(v_title, 80) and l.created_at > now() - interval '10 minutes') then
        perform public._push_send(r.user_id, v_title, 'Gerade eben dazugekommen.', '/online', 'online');
      end if;
    end if;
  end loop;
  return new;
exception when others then
  return new;
end;
$$;

drop trigger if exists profiles_push_online on public.profiles;
create trigger profiles_push_online
  after update of online_since on public.profiles
  for each row execute function public._push_on_online();

revoke all on function public._push_on_online() from public, anon, authenticated;
revoke all on function public._push_idle(uuid) from public, anon, authenticated;

-- ===== 0027_math_league_admin =====
-- ============================================================================
-- 0027: Mathe gibt Coins und Ranglistenpunkte, Admin sieht jede Liga, Korrektur der Wochenpunkte
-- - Behebt einen Fehler aus 0024: Die Wochenpunkte der Liga rechneten fest (2 Punkte je Antwort) und ließen
--   Einstellungen, Multiple-Choice-Punkte und Admin-Anpassungen weg. Jetzt wieder wie in der Rangliste, plus Plus ×1,5.
-- - Die Rangliste (Woche/Monat/Gesamt) zählt Plus ×1,5 ebenfalls.
-- Wiederholbar. Nach 0026 ausführen.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Mathe: Einstellungen und Zähler
-- ----------------------------------------------------------------------------

insert into public.app_settings (key, value, mod_editable) values
  ('math_points_per_answer', 1, false),   -- Mathe: Ranglistenpunkte je richtiger Antwort
  ('math_daily_cap', 100, false),         -- Mathe: höchstens so viele richtige pro Tag zählen
  ('math_coin_every', 10, false),         -- Mathe: 1 Coin je so viele richtige Antworten
  ('math_coin_cap', 10, false),           -- Mathe: höchstens so viele Coins pro Tag
  ('math_min_seconds', 1, false)          -- Mathe: Mindestzeit je Aufgabe (Sekunden), gegen Schummeln
on conflict (key) do nothing;

alter table public.daily_stats add column if not exists math_correct integer not null default 0;

create or replace function public._math_points(p_math integer)
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select (least(p_math, public.setting('math_daily_cap')) * public.setting('math_points_per_answer'))::bigint;
$$;

create or replace function public.submit_math(p_correct integer, p_total integer, p_seconds integer default null)
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
  v_every integer := greatest(public.setting('math_coin_every'), 1);
  v_paid integer;
  v_coins integer;
begin
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  if p_correct is null or p_total is null or p_correct < 0 or p_total < 1 or p_total > 100 or p_correct > p_total then
    raise exception 'Ungültiges Ergebnis.' using errcode = '22023';
  end if;
  if p_seconds is null or p_seconds < p_total * public.setting('math_min_seconds') then
    raise exception 'Das ging zu schnell, um echt zu sein. Das Ergebnis zählt nicht.' using errcode = '22023';
  end if;
  select coalesce(math_correct, 0) into v_before from public.daily_stats where user_id = v_me and day = v_today;
  v_before := coalesce(v_before, 0);
  v_counted := greatest(least(p_correct, public.setting('math_daily_cap') - v_before), 0);
  insert into public.daily_stats (user_id, day, answers_total, answers_correct, math_correct)
  values (v_me, v_today, 0, 0, v_counted)
  on conflict (user_id, day) do update set math_correct = public.daily_stats.math_correct + v_counted;
  v_after := v_before + v_counted;
  select coalesce(sum(l.amount), 0) into v_paid
    from public.koin_ledger l
   where l.user_id = v_me and l.reason = 'math'
     and (l.created_at at time zone 'Europe/Berlin')::date = v_today;
  v_coins := least(v_after / v_every - v_before / v_every, greatest(public.setting('math_coin_cap') - v_paid, 0));
  if v_coins > 0 then
    perform public._grant_koins(v_me, v_coins, 'math', null);
  end if;
  return jsonb_build_object('points', v_counted * public.setting('math_points_per_answer'), 'coins', greatest(v_coins, 0));
end;
$$;

-- ----------------------------------------------------------------------------
-- 2. Wochenpunkte und Rangliste: Einstellungen + Multiple Choice + Mathe + Admin-Anpassungen, Plus ×1,5
-- ----------------------------------------------------------------------------

create or replace function public._plus_points_factor(p_user uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select case when public._plus_active(p_user) then greatest(public._pls('plus_points_mult'), 1) else 1 end;
$$;

create or replace function public._week_points(p_user uuid, p_from date)
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select round(coalesce((select sum(public._day_points(d.answers_correct, d.answers_total)
                                    + public._choice_points(d.choice_correct)
                                    + public._math_points(d.math_correct))
                           from public.daily_stats d
                          where d.user_id = p_user and d.day between p_from and p_from + 6), 0)
               * public._plus_points_factor(p_user))::bigint
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
  with days as (
    select d.user_id as uid,
           sum(public._day_points(d.answers_correct, d.answers_total)
               + public._choice_points(d.choice_correct)
               + public._math_points(d.math_correct)) as pts
      from public.daily_stats d
     where v_from is null or d.day >= v_from
     group by d.user_id
  ), parts as (
    select x.uid, round(x.pts * public._plus_points_factor(x.uid))::bigint as pts from days x
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

-- ----------------------------------------------------------------------------
-- 3. Admin: jede Liga ansehen
-- ----------------------------------------------------------------------------

create or replace function public.admin_get_league(p_tier integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_week date := date_trunc('week', timezone('Europe/Berlin', now()))::date;
begin
  perform public._require_admin();
  if p_tier is null or p_tier < 1 or p_tier > 5 then
    raise exception 'Unbekannte Liga.' using errcode = '22023';
  end if;
  perform public._league_rollover();
  return jsonb_build_object(
    'tier', p_tier,
    'week_start', v_week,
    'ends_at', ((v_week + 7)::timestamp at time zone 'Europe/Berlin'),
    'counts', (select coalesce(jsonb_agg(jsonb_build_object('tier', t.tier, 'members', t.members, 'active', t.active) order by t.tier), '[]'::jsonb)
                 from (select g.tier,
                              count(m.user_id) filter (where p.id is not null) as members,
                              count(m.user_id) filter (where p.id is not null and public._week_points(m.user_id, v_week) > 0) as active
                         from generate_series(1, 5) as g(tier)
                         left join public.league_members m on m.tier = g.tier
                         left join public.profiles p on p.id = m.user_id and not p.blocked
                        group by g.tier) t),
    'min_points', public.setting('league_min_points'),
    'rewards', jsonb_build_array(public.setting('league_reward_1'), public.setting('league_reward_2'), public.setting('league_reward_3')),
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
               'rank', s.rnk, 'display_name', pr.display_name, 'points', s.pts, 'is_me', s.user_id = (select auth.uid()),
               'avatar_id', pr.avatar_id, 'color_id', pr.color_id, 'effect_id', pr.effect_id,
               'role', pr.role, 'tag_id', pr.tag_id, 'theme_id', pr.theme_id) order by s.pts desc, pr.display_name)
        from (
          select x.user_id, x.pts, rank() over (order by x.pts desc) as rnk
            from (
              select m.user_id, public._week_points(m.user_id, v_week) as pts
                from public.league_members m join public.profiles p on p.id = m.user_id and not p.blocked
               where m.tier = p_tier
            ) x
        ) s
        join public.profiles pr on pr.id = s.user_id), '[]'::jsonb));
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
    select p.oid::regprocedure as sig, p.proname
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('_math_points', '_plus_points_factor', '_week_points', 'submit_math', 'get_leaderboard', 'admin_get_league')
  loop
    if left(r.proname, 1) = '_' then
      execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    else
      execute format('revoke all on function %s from public, anon', r.sig);
      execute format('grant execute on function %s to authenticated', r.sig);
    end if;
  end loop;
end;
$$;
-- 0028: Latein und Spanisch als Sprachen (Bücher, Grammatik). Wiederholbar.

insert into public.languages (code, name) values
  ('la', 'Latein'),
  ('es', 'Spanisch')
on conflict (code) do update set name = excluded.name;

-- Grammatik-Aufgabensätze: weitere Sprachen erlauben.
do $$
begin
  alter table public.ai_grammar_sets drop constraint if exists ai_grammar_sets_language_check;
  alter table public.ai_grammar_sets
    add constraint ai_grammar_sets_language_check check (language in ('en', 'fr', 'la', 'es'));
end;
$$;

-- ============================================================================
-- Teil 2 (gleiche Datei, Update 28): Sprint-Zeit kaufen, Liga für alle, vier neue Spiele
-- ============================================================================

-- ----------------------------------------------------------------------------
-- A. Sprint: zusätzliche Sekunden für Coins (Standard 100 Coins je Sekunde)
-- ----------------------------------------------------------------------------

insert into public.app_settings (key, value, mod_editable) values
  ('sprint_extra_cost', 100, false),   -- Coins je zusätzlicher Sprint-Sekunde
  ('sprint_extra_max', 30, false)      -- höchstens so viele Sekunden pro Sprint kaufbar
on conflict (key) do nothing;

create or replace function public.buy_sprint_time(p_seconds integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  v_cost bigint;
  v_balance bigint;
begin
  perform public._feature_guard('sprint');
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  if p_seconds is null or p_seconds < 1 or p_seconds > public.setting('sprint_extra_max') then
    raise exception 'Du kannst 1 bis % Sekunden dazukaufen.', public.setting('sprint_extra_max') using errcode = '22023';
  end if;
  v_cost := p_seconds::bigint * public.setting('sprint_extra_cost')::bigint;
  if coalesce((select balance from public.koin_wallets where user_id = v_me), 0) < v_cost then
    raise exception 'Nicht genug Coins – % Sekunden kosten % Coins.', p_seconds, v_cost using errcode = '23514';
  end if;
  v_balance := public._grant_koins(v_me, -v_cost, 'game_fee', 'sprint_time');
  return jsonb_build_object('balance', v_balance, 'seconds', p_seconds, 'cost', v_cost);
end;
$$;

-- ----------------------------------------------------------------------------
-- B. Liga: alle Nutzer sind Mitglied (bisher nur, wer die Liga geöffnet oder Punkte hatte),
--    und die eigene Liga zeigt alle Mitglieder – auch mit 0 Punkten.
-- ----------------------------------------------------------------------------

insert into public.league_members (user_id)
select p.id from public.profiles p where not p.blocked
on conflict do nothing;

create or replace function public._league_member_on_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.league_members (user_id) values (new.id) on conflict do nothing;
  return new;
end;
$$;

drop trigger if exists profiles_league_member on public.profiles;
create trigger profiles_league_member
  after insert on public.profiles
  for each row execute function public._league_member_on_profile();

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
        ) s
        join public.profiles pr on pr.id = s.user_id), '[]'::jsonb),
    'last', (select to_jsonb(h) - 'user_id' from public.league_history h where h.user_id = v_me order by h.week_start desc limit 1)
  );
end;
$$;

-- ----------------------------------------------------------------------------
-- C. Vier neue Spiele: 2048, Memory, Bricks, Maulwurf
-- ----------------------------------------------------------------------------

alter table public.game_runs drop constraint if exists game_runs_game_check;
alter table public.game_runs add constraint game_runs_game_check
  check (game in ('snake', 'tetris', 'blast', 'crossy', 'flappy', 'wave', 'g2048', 'memory', 'bricks', 'mole'));

do $$
declare
  r record;
  v_def text;
  v_new text;
  v_args text;
begin
  for r in select * from (values
      ('start_game',     array[array['''crossy'', ''flappy'', ''wave''', '''crossy'', ''flappy'', ''wave'', ''g2048'', ''memory'', ''bricks'', ''mole''']]),
      ('get_game_board', array[array['''crossy'', ''flappy'', ''wave''', '''crossy'', ''flappy'', ''wave'', ''g2048'', ''memory'', ''bricks'', ''mole''']]),
      ('finish_game',    array[array['when ''wave'' then 2 else', 'when ''wave'' then 2 when ''g2048'' then 40 when ''memory'' then 2 when ''bricks'' then 4 when ''mole'' then 4 else']])
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
    execute v_new;
  end loop;
end;
$$;

-- ----------------------------------------------------------------------------
-- D. Rechte
-- ----------------------------------------------------------------------------

do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig, p.proname
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('buy_sprint_time', 'get_league', '_league_member_on_profile', 'start_game', 'finish_game', 'get_game_board')
  loop
    if left(r.proname, 1) = '_' then
      execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    else
      execute format('revoke all on function %s from public, anon', r.sig);
      execute format('grant execute on function %s to authenticated', r.sig);
    end if;
  end loop;
end;
$$;
-- 0029: Ein veröffentlichtes Buch kann aus den eigenen Büchern entfernt werden und bleibt dann nur online.
-- Besitzer (Admin/Mod) sehen es dann nur noch im Reiter „Online“, bis sie es wieder verwenden. Wiederholbar.

create table if not exists public.book_library_hidden (
  user_id uuid not null references auth.users (id) on delete cascade,
  book_id uuid not null references public.books (id) on delete cascade,
  primary key (user_id, book_id)
);
alter table public.book_library_hidden enable row level security;
revoke all on public.book_library_hidden from anon, authenticated;

create or replace function public.in_library(p_book_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.books b
     where b.id = p_book_id
       and ((b.owner_id = (select auth.uid())
             and not (b.is_public and exists (
                   select 1 from public.book_library_hidden h
                    where h.book_id = b.id and h.user_id = (select auth.uid()))))
            or (b.is_public and exists (
                  select 1 from public.book_library l
                   where l.book_id = b.id and l.user_id = (select auth.uid()))))
  );
$$;

create or replace function public.remove_from_library(p_book_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  v_owner uuid;
  v_public boolean;
begin
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  select b.owner_id, b.is_public into v_owner, v_public from public.books b where b.id = p_book_id;
  if not found then
    raise exception 'Buch nicht gefunden.' using errcode = 'P0002';
  end if;
  if v_owner = v_me and not v_public then
    raise exception 'Nur veröffentlichte Bücher kannst du aus deinen Büchern entfernen. Zum Löschen öffne das Buch.' using errcode = '22023';
  end if;
  delete from public.book_library where book_id = p_book_id and user_id = v_me;
  if v_owner = v_me then
    insert into public.book_library_hidden (user_id, book_id) values (v_me, p_book_id) on conflict do nothing;
  end if;
end;
$$;

-- Wieder verwenden: Versteck-Eintrag des Besitzers löschen (sonst wie in 0005).
create or replace function public.add_to_library(p_book_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  v_price integer;
  v_owner uuid;
begin
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  select b.price, b.owner_id into v_price, v_owner
    from public.books b where b.id = p_book_id and b.is_public;
  if v_price is null then
    raise exception 'Öffentliches Buch nicht gefunden.' using errcode = 'P0002';
  end if;

  if not exists (select 1 from public.book_purchases where user_id = v_me and book_id = p_book_id) then
    if public.is_staff() or v_owner = v_me or v_price = 0 then
      insert into public.book_purchases (user_id, book_id, price_paid) values (v_me, p_book_id, 0);
    else
      perform public._grant_koins(v_me, -v_price, 'book', p_book_id::text);
      insert into public.book_purchases (user_id, book_id, price_paid) values (v_me, p_book_id, v_price);
    end if;
  end if;

  delete from public.book_library_hidden where user_id = v_me and book_id = p_book_id;
  insert into public.book_library (user_id, book_id) values (v_me, p_book_id) on conflict do nothing;
end;
$$;

-- Neu veröffentlichen: Versteck-Einträge zurücksetzen.
create or replace function public._clear_hidden_on_unpublish()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.is_public and not new.is_public then
    delete from public.book_library_hidden where book_id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists books_clear_hidden on public.books;
create trigger books_clear_hidden
  after update of is_public on public.books
  for each row execute function public._clear_hidden_on_unpublish();

do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig, p.proname
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('in_library', 'remove_from_library', 'add_to_library', '_clear_hidden_on_unpublish')
  loop
    if left(r.proname, 1) = '_' then
      execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    else
      execute format('revoke all on function %s from public, anon', r.sig);
      execute format('grant execute on function %s to authenticated', r.sig);
    end if;
  end loop;
end;
$$;
-- 0030: Sprint-Zeit wird dauerhaft gekauft (einmal bezahlen, für immer behalten) und das Spiel „Hüpfer“ (Plattformer).
-- Wiederholbar. Nach 0029 ausführen.

-- ----------------------------------------------------------------------------
-- A. Dauerhafte Sprint-Zusatzzeit
-- ----------------------------------------------------------------------------

create table if not exists public.sprint_upgrades (
  user_id uuid primary key references auth.users (id) on delete cascade,
  seconds integer not null default 0 check (seconds >= 0)
);
alter table public.sprint_upgrades enable row level security;
revoke all on public.sprint_upgrades from anon, authenticated;

create or replace function public.get_sprint_bonus()
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select u.seconds from public.sprint_upgrades u where u.user_id = (select auth.uid())), 0);
$$;

drop function if exists public.buy_sprint_time(integer);
create function public.buy_sprint_time(p_seconds integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  v_have integer;
  v_max integer := public.setting('sprint_extra_max');
  v_cost bigint;
  v_balance bigint;
begin
  perform public._feature_guard('sprint');
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  v_have := public.get_sprint_bonus();
  if p_seconds is null or p_seconds < 1 or v_have + p_seconds > v_max then
    raise exception 'Du hast +% Sekunden, höchstens +% sind möglich.', v_have, v_max using errcode = '22023';
  end if;
  v_cost := p_seconds::bigint * public.setting('sprint_extra_cost')::bigint;
  if coalesce((select balance from public.koin_wallets where user_id = v_me), 0) < v_cost then
    raise exception 'Nicht genug Coins – % Sekunden kosten % Coins.', p_seconds, v_cost using errcode = '23514';
  end if;
  v_balance := public._grant_koins(v_me, -v_cost, 'game_fee', 'sprint_time');
  insert into public.sprint_upgrades (user_id, seconds) values (v_me, p_seconds)
  on conflict (user_id) do update set seconds = public.sprint_upgrades.seconds + excluded.seconds;
  return jsonb_build_object('balance', v_balance, 'bonus', v_have + p_seconds, 'cost', v_cost);
end;
$$;

-- ----------------------------------------------------------------------------
-- B. Spiel „Hüpfer“ (id jump)
-- ----------------------------------------------------------------------------

alter table public.game_runs drop constraint if exists game_runs_game_check;
alter table public.game_runs add constraint game_runs_game_check
  check (game in ('snake', 'tetris', 'blast', 'crossy', 'flappy', 'wave', 'g2048', 'memory', 'bricks', 'mole', 'jump'));

do $$
declare
  r record;
  v_def text;
  v_new text;
begin
  for r in select * from (values
      ('start_game',     array[array['''mole'')', '''mole'', ''jump'')']]),
      ('get_game_board', array[array['''mole'')', '''mole'', ''jump'')']]),
      ('finish_game',    array[array['when ''mole'' then 4 else', 'when ''mole'' then 4 when ''jump'' then 14 else']])
    ) as t(fn, reps)
  loop
    select pg_get_functiondef(p.oid) into v_def
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = r.fn
     limit 1;
    continue when v_def is null;
    v_new := v_def;
    for i in 1 .. array_length(r.reps, 1) loop
      v_new := replace(v_new, r.reps[i][1], r.reps[i][2]);
    end loop;
    continue when v_new = v_def;
    execute v_new;
  end loop;
end;
$$;

do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('get_sprint_bonus', 'buy_sprint_time', 'start_game', 'finish_game', 'get_game_board')
  loop
    execute format('revoke all on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;
end;
$$;

-- 0031: Duelle können unentschieden enden (beide bekommen die Hälfte der Coins) und drei neue Spiele:
-- Coreball (id coreball), Klicker (id clicker) und CPS-Test (id cps). Wiederholbar. Nach 0030 ausführen.

-- ----------------------------------------------------------------------------
-- A. Duelle: gleich viele richtige Antworten = Unentschieden (Zeit entscheidet nicht mehr)
-- ----------------------------------------------------------------------------
do $$
declare
  v_def text;
  v_new text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'submit_duel'
   limit 1;
  if v_def is null then return; end if;
  v_new := v_def;
  -- Zeit als Tie-Break entfernen
  v_new := replace(v_new, E'  elsif v_mine.millis < v_other.millis then v_winner := v_me;\n  elsif v_mine.millis > v_other.millis then v_winner := v_other.user_id;\n', '');
  -- Bei Unentschieden bekommen beide die Hälfte (Tageslimit gilt je Person)
  if position('duel_tie' in v_new) = 0 then
    v_new := replace(v_new,
      E'  select display_name into v_name from public.profiles where id = v_me;',
      E'  if v_winner is null and public.setting(''duel_reward'') > 1 then\n'
      || E'    -- duel_tie: jeder bekommt die Hälfte des Sieg-Preises\n'
      || E'    if (select count(*) from public.koin_ledger l\n'
      || E'         where l.user_id = v_me and l.reason = ''duel''\n'
      || E'           and (l.created_at at time zone ''Europe/Berlin'')::date = v_today) < public.setting(''duel_daily_cap'') then\n'
      || E'      perform public._grant_koins(v_me, public.setting(''duel_reward'') / 2, ''duel'', p_id::text);\n'
      || E'    end if;\n'
      || E'    if (select count(*) from public.koin_ledger l\n'
      || E'         where l.user_id = v_other.user_id and l.reason = ''duel''\n'
      || E'           and (l.created_at at time zone ''Europe/Berlin'')::date = v_today) < public.setting(''duel_daily_cap'') then\n'
      || E'      perform public._grant_koins(v_other.user_id, public.setting(''duel_reward'') / 2, ''duel'', p_id::text);\n'
      || E'    end if;\n'
      || E'  end if;\n\n'
      || E'  select display_name into v_name from public.profiles where id = v_me;');
  end if;
  if v_new <> v_def then
    execute v_new;
  end if;
end;
$$;

-- ----------------------------------------------------------------------------
-- B. Neue Spiele
-- ----------------------------------------------------------------------------
alter table public.game_runs drop constraint if exists game_runs_game_check;
alter table public.game_runs add constraint game_runs_game_check
  check (game in ('snake', 'tetris', 'blast', 'crossy', 'flappy', 'wave', 'g2048', 'memory', 'bricks', 'mole', 'jump',
                  'coreball', 'clicker', 'cps'));

do $$
declare
  r record;
  v_def text;
  v_new text;
begin
  for r in select * from (values
      ('start_game',     array[array['''jump'')', '''jump'', ''coreball'', ''clicker'', ''cps'')']]),
      ('get_game_board', array[array['''jump'')', '''jump'', ''coreball'', ''clicker'', ''cps'')']]),
      -- Punkte pro Sekunde höchstens: Coreball 6, Klicker 2 (20 Klicks/s), CPS-Test 3 (Bestwert pro Sekunde)
      ('finish_game',    array[array['when ''jump'' then 14 else', 'when ''jump'' then 14 when ''coreball'' then 6 when ''clicker'' then 2 when ''cps'' then 3 else']])
    ) as t(fn, reps)
  loop
    select pg_get_functiondef(p.oid) into v_def
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = r.fn
     limit 1;
    continue when v_def is null;
    v_new := v_def;
    for i in 1 .. array_length(r.reps, 1) loop
      v_new := replace(v_new, r.reps[i][1], r.reps[i][2]);
    end loop;
    continue when v_new = v_def;
    execute v_new;
  end loop;
end;
$$;

do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('submit_duel', 'start_game', 'finish_game', 'get_game_board')
  loop
    execute format('revoke all on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;
end;
$$;

-- ----------------------------------------------------------------------------
-- C. Neues Design „Schwarzes Loch“ (Aussehen steht in der App: features/shop/catalog.ts)
-- ----------------------------------------------------------------------------
insert into public.shop_items (id, kind, name, price, sort, required_role) values
  ('theme_blackhole', 'theme', 'Schwarzes Loch', 250000, 230, null)
on conflict (id) do nothing;

-- 0032: Fairness bei Spielen (Wiederbelebte Runden zählen nicht für Rekorde), neue Gambling-Spiele
-- (Roulette, Würfeln, Glücksrad), Schwarzes Brett mit Autor/Bearbeiter, „Wer ist da?“ für Admins komplett,
-- neues Design „Berge“. Wiederholbar. Nach 0031 ausführen.

-- ----------------------------------------------------------------------------
-- A. Spiele: Wiederbeleben (Plus) soll nichts am Rekord ändern
-- ----------------------------------------------------------------------------
do $$
declare
  v_def text;
  v_new text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'finish_game'
   limit 1;
  if v_def is null then return; end if;
  v_new := v_def;
  if position('r.revives = 0' in v_new) = 0 then
    v_new := replace(v_new, 'and v_elapsed <= 7200 then', 'and v_elapsed <= 7200 and r.revives = 0 then');
  end if;
  if v_new <> v_def then
    execute v_new;
  end if;
end;
$$;

-- ----------------------------------------------------------------------------
-- B. Gambling: gemeinsame Abrechnung + Roulette, Würfeln, Glücksrad
-- ----------------------------------------------------------------------------
create or replace function public._gamble_settle(p_user uuid, p_bet integer, p_payout bigint, p_jackpot boolean)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance bigint;
begin
  v_balance := public._grant_koins(p_user, -p_bet::bigint, 'gambling_bet', null);
  if p_payout > 0 then
    v_balance := public._grant_koins(p_user, p_payout, 'gambling_win', null);
  end if;
  insert into public.gambling_feed (user_id, bet, payout, jackpot) values (p_user, p_bet, least(p_payout, 2000000000)::integer, p_jackpot);
  delete from public.gambling_feed where created_at < now() - interval '3 days';
  insert into public.gambling_stats (user_id, plays, wagered, won, best_win)
  values (p_user, 1, p_bet, p_payout, least(p_payout, 2000000000)::integer)
  on conflict (user_id) do update
    set plays = public.gambling_stats.plays + 1,
        wagered = public.gambling_stats.wagered + p_bet,
        won = public.gambling_stats.won + p_payout,
        best_win = greatest(public.gambling_stats.best_win, least(p_payout, 2000000000)::integer);
  return v_balance;
end;
$$;
revoke all on function public._gamble_settle(uuid, integer, bigint, boolean) from public, anon, authenticated;

-- Roulette (europäisch, 37 Felder). p_bets: [{"t":"straight|red|black|even|odd|low|high|dozen|column","v":0..36,"a":Einsatz}]
create or replace function public.gambling_roulette(p_bets jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  v_max integer := greatest(public.setting('gambling_max_bet'), 1);
  v_num integer := floor(random() * 37)::integer;
  v_red integer[] := array[1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36];
  v_color text;
  b jsonb;
  v_t text;
  v_v integer;
  v_a integer;
  v_total integer := 0;
  v_count integer := 0;
  v_pay bigint := 0;
  v_win boolean;
  v_mult integer;
  v_out jsonb := '[]'::jsonb;
  v_balance bigint;
begin
  perform public._feature_guard('gambling');
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  if p_bets is null or jsonb_typeof(p_bets) <> 'array' or jsonb_array_length(p_bets) not between 1 and 10 then
    raise exception 'Setze 1 bis 10 Felder.' using errcode = '22023';
  end if;
  v_color := case when v_num = 0 then 'green' when v_num = any (v_red) then 'red' else 'black' end;
  for b in select * from jsonb_array_elements(p_bets) loop
    v_t := b ->> 't';
    v_v := coalesce((b ->> 'v')::integer, 0);
    v_a := (b ->> 'a')::integer;
    if v_a is null or v_a < 1 or v_a > v_max then
      raise exception 'Jeder Einsatz muss zwischen 1 und % Coins liegen.', v_max using errcode = '22023';
    end if;
    if v_t not in ('straight', 'red', 'black', 'even', 'odd', 'low', 'high', 'dozen', 'column')
       or (v_t = 'straight' and v_v not between 0 and 36)
       or (v_t in ('dozen', 'column') and v_v not between 1 and 3) then
      raise exception 'Ungültige Wette.' using errcode = '22023';
    end if;
    v_total := v_total + v_a;
    v_count := v_count + 1;
  end loop;
  if v_total > v_max * 5 then
    raise exception 'Insgesamt höchstens % Coins pro Runde.', v_max * 5 using errcode = '22023';
  end if;
  if coalesce((select balance from public.koin_wallets where user_id = v_me), 0) < v_total then
    raise exception 'Nicht genug Coins.' using errcode = '23514';
  end if;
  for b in select * from jsonb_array_elements(p_bets) loop
    v_t := b ->> 't';
    v_v := coalesce((b ->> 'v')::integer, 0);
    v_a := (b ->> 'a')::integer;
    v_win := false;
    v_mult := 0;
    if v_t = 'straight' then v_win := v_num = v_v; v_mult := 36;
    elsif v_num > 0 then
      if v_t = 'red' then v_win := v_color = 'red'; v_mult := 2;
      elsif v_t = 'black' then v_win := v_color = 'black'; v_mult := 2;
      elsif v_t = 'even' then v_win := v_num % 2 = 0; v_mult := 2;
      elsif v_t = 'odd' then v_win := v_num % 2 = 1; v_mult := 2;
      elsif v_t = 'low' then v_win := v_num between 1 and 18; v_mult := 2;
      elsif v_t = 'high' then v_win := v_num between 19 and 36; v_mult := 2;
      elsif v_t = 'dozen' then v_win := (v_num - 1) / 12 + 1 = v_v; v_mult := 3;
      elsif v_t = 'column' then v_win := (v_num - 1) % 3 + 1 = v_v; v_mult := 3;
      end if;
    end if;
    if v_win then v_pay := v_pay + v_a::bigint * v_mult; end if;
    v_out := v_out || jsonb_build_array(jsonb_build_object('t', v_t, 'v', v_v, 'a', v_a, 'win', v_win,
                                                           'pay', case when v_win then v_a * v_mult else 0 end));
  end loop;
  v_balance := public._gamble_settle(v_me, v_total, v_pay, v_pay >= v_total::bigint * 10);
  return jsonb_build_object('number', v_num, 'color', v_color, 'bets', v_out, 'bet', v_total,
                            'payout', v_pay, 'balance', v_balance);
end;
$$;

-- Würfeln: Zahl 1–100. p_over = „über p_target“, sonst „unter p_target“. Auszahlung = Einsatz × 97 / Chance.
create or replace function public.gambling_dice(p_bet integer, p_over boolean, p_target integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  v_max integer := greatest(public.setting('gambling_max_bet'), 1);
  v_roll integer := 1 + floor(random() * 100)::integer;
  v_chance integer;
  v_win boolean;
  v_pay bigint := 0;
  v_balance bigint;
begin
  perform public._feature_guard('gambling');
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  if p_bet is null or p_bet < 1 or p_bet > v_max then
    raise exception 'Der Einsatz muss zwischen 1 und % Coins liegen.', v_max using errcode = '22023';
  end if;
  if p_target is null or p_over is null then
    raise exception 'Ungültige Wahl.' using errcode = '22023';
  end if;
  v_chance := case when p_over then 100 - p_target else p_target - 1 end;
  if v_chance < 5 or v_chance > 90 then
    raise exception 'Die Gewinnchance muss zwischen 5 %% und 90 %% liegen.' using errcode = '22023';
  end if;
  if coalesce((select balance from public.koin_wallets where user_id = v_me), 0) < p_bet then
    raise exception 'Nicht genug Coins.' using errcode = '23514';
  end if;
  v_win := case when p_over then v_roll > p_target else v_roll < p_target end;
  if v_win then v_pay := (p_bet::bigint * 97) / v_chance; end if;
  v_balance := public._gamble_settle(v_me, p_bet, v_pay, v_pay >= p_bet::bigint * 10);
  return jsonb_build_object('roll', v_roll, 'chance', v_chance, 'win', v_win, 'bet', p_bet,
                            'payout', v_pay, 'balance', v_balance);
end;
$$;

-- Glücksrad: 20 Felder, Faktoren in Zehnteln (Rückzahlung im Schnitt 97,5 %).
create or replace function public.gambling_wheel(p_bet integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  v_max integer := greatest(public.setting('gambling_max_bet'), 1);
  v_seg integer[] := array[0,5,0,20,0,10,0,30,0,5,0,40,0,20,0,40,0,5,0,20];
  v_i integer := floor(random() * 20)::integer;
  v_pay bigint;
  v_balance bigint;
begin
  perform public._feature_guard('gambling');
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  if p_bet is null or p_bet < 1 or p_bet > v_max then
    raise exception 'Der Einsatz muss zwischen 1 und % Coins liegen.', v_max using errcode = '22023';
  end if;
  if coalesce((select balance from public.koin_wallets where user_id = v_me), 0) < p_bet then
    raise exception 'Nicht genug Coins.' using errcode = '23514';
  end if;
  v_pay := (p_bet::bigint * v_seg[v_i + 1]) / 10;
  v_balance := public._gamble_settle(v_me, p_bet, v_pay, v_seg[v_i + 1] >= 40);
  return jsonb_build_object('index', v_i, 'tenths', v_seg[v_i + 1], 'segments', to_jsonb(v_seg), 'bet', p_bet,
                            'payout', v_pay, 'balance', v_balance);
end;
$$;

-- ----------------------------------------------------------------------------
-- C. Schwarzes Brett: wer hat geschrieben, wer hat geändert
-- ----------------------------------------------------------------------------
alter table public.board_posts add column if not exists created_by uuid references auth.users (id) on delete set null;
alter table public.board_posts add column if not exists updated_by uuid references auth.users (id) on delete set null;

drop function if exists public.get_board();
create function public.get_board()
returns table (id uuid, title text, body text, status text, sort integer, updated_at timestamptz,
               created_at timestamptz, created_by_name text, updated_by_name text)
language sql
stable
security definer
set search_path = public
as $$
  select b.id, b.title, b.body, b.status, b.sort, b.updated_at, b.created_at,
         (select p.display_name from public.profiles p where p.id = b.created_by),
         (select p.display_name from public.profiles p where p.id = b.updated_by)
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
  v_me uuid := (select auth.uid());
begin
  if not public.is_staff() then
    raise exception 'Nur für Mods und Admins.' using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(p_title, ''))) not between 1 and 120 then
    raise exception 'Der Titel braucht 1 bis 120 Zeichen.' using errcode = '22023';
  end if;
  if p_status not in ('planned', 'doing', 'done') then
    raise exception 'Ungültiger Status.' using errcode = '22023';
  end if;
  if p_id is null then
    insert into public.board_posts (title, body, status, created_by)
    values (btrim(p_title), left(coalesce(p_body, ''), 2000), p_status, v_me)
    returning id into v_id;
  else
    update public.board_posts
       set title = btrim(p_title), body = left(coalesce(p_body, ''), 2000), status = p_status,
           updated_at = now(), updated_by = v_me
     where id = p_id returning id into v_id;
    if v_id is null then
      raise exception 'Eintrag nicht gefunden.' using errcode = 'P0002';
    end if;
  end if;
  return v_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- D. „Wer ist da?“: Admins sehen auch Nutzer, die sich versteckt haben (mit Markierung)
-- ----------------------------------------------------------------------------
drop function if exists public.get_presence();
create function public.get_presence()
returns table (user_id uuid, display_name text, avatar_id text, color_id text, effect_id text, role text, tag_id text,
               theme_id text, last_seen_at timestamptz, online boolean, hidden boolean)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.display_name, p.avatar_id, p.color_id, p.effect_id,
         case when p.tags_hidden then 'user' else p.role end,
         case when p.tags_hidden then null else p.tag_id end,
         p.theme_id, p.last_seen_at, (p.last_seen_at > now() - interval '3 minutes'), p.hide_presence
    from public.profiles p
   where (select auth.uid()) is not null and not public.is_blocked()
     and not p.blocked and p.last_seen_at is not null
     and (not p.hide_presence or p.id = (select auth.uid()) or public.is_admin())
   order by (p.last_seen_at > now() - interval '3 minutes') desc, p.last_seen_at desc
   limit 200;
$$;

-- ----------------------------------------------------------------------------
-- E. Design „Berge“ (Aussehen steht in der App: features/shop/catalog.ts)
-- ----------------------------------------------------------------------------
insert into public.shop_items (id, kind, name, price, sort, required_role) values
  ('theme_mountain', 'theme', 'Berge', 250000, 240, null)
on conflict (id) do nothing;

do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('finish_game', 'gambling_roulette', 'gambling_dice', 'gambling_wheel', 'get_board',
                         'admin_save_board_post', 'get_presence')
  loop
    execute format('revoke all on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;
end;
$$;

-- 0033: Design „Fußball“ im Shop (Aussehen steckt in catalog.ts). Wiederholbar. Nach 0032 ausführen.
insert into public.shop_items (id, kind, name, price, sort, required_role) values
  ('theme_football', 'theme', 'Fußball', 250000, 250, null)
on conflict (id) do nothing;

-- 0034: Hausvorteil für Würfeln, Roulette und Glücksrad (Gewinnquote einstellbar) und Würfeln höchstens 75 % Chance.
-- Grund: Mit 97 % Rückzahlung und bis zu 90 % Chance wirkte Würfeln wie ein sicherer Gewinn. Jetzt gilt eine
-- Gewinnquote (Standard 900 ‰ = 90 %), die der Admin unter Regeln > Gambling ändern kann. Wiederholbar. Nach 0033 ausführen.

insert into public.app_settings (key, value, mod_editable) values ('gambling_rtp_permille', 900, false)
on conflict (key) do nothing;

create or replace function public.gambling_dice(p_bet integer, p_over boolean, p_target integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  v_max integer := greatest(public.setting('gambling_max_bet'), 1);
  v_roll integer := 1 + floor(random() * 100)::integer;
  v_chance integer;
  v_rtp integer := least(greatest(public.setting('gambling_rtp_permille'), 500), 950);
  v_win boolean;
  v_pay bigint := 0;
  v_balance bigint;
begin
  perform public._feature_guard('gambling');
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  if p_bet is null or p_bet < 1 or p_bet > v_max then
    raise exception 'Der Einsatz muss zwischen 1 und % Coins liegen.', v_max using errcode = '22023';
  end if;
  if p_target is null or p_over is null then
    raise exception 'Ungültige Wahl.' using errcode = '22023';
  end if;
  v_chance := case when p_over then 100 - p_target else p_target - 1 end;
  if v_chance < 5 or v_chance > 75 then
    raise exception 'Die Gewinnchance muss zwischen 5 %% und 75 %% liegen.' using errcode = '22023';
  end if;
  if coalesce((select balance from public.koin_wallets where user_id = v_me), 0) < p_bet then
    raise exception 'Nicht genug Coins.' using errcode = '23514';
  end if;
  v_win := case when p_over then v_roll > p_target else v_roll < p_target end;
  if v_win then v_pay := (p_bet::bigint * v_rtp) / (10 * v_chance); end if;
  v_balance := public._gamble_settle(v_me, p_bet, v_pay, v_pay >= p_bet::bigint * 10);
  return jsonb_build_object('roll', v_roll, 'chance', v_chance, 'win', v_win, 'bet', p_bet,
                            'payout', v_pay, 'balance', v_balance);
end;
$$;

create or replace function public.gambling_wheel(p_bet integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  v_max integer := greatest(public.setting('gambling_max_bet'), 1);
  v_seg integer[] := array[0,5,0,20,0,10,0,30,0,5,0,40,0,20,0,40,0,5,0,20];
  v_i integer := floor(random() * 20)::integer;
  v_pay bigint;
  v_rtp integer := least(greatest(public.setting('gambling_rtp_permille'), 500), 950);
  v_balance bigint;
begin
  perform public._feature_guard('gambling');
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  if p_bet is null or p_bet < 1 or p_bet > v_max then
    raise exception 'Der Einsatz muss zwischen 1 und % Coins liegen.', v_max using errcode = '22023';
  end if;
  if coalesce((select balance from public.koin_wallets where user_id = v_me), 0) < p_bet then
    raise exception 'Nicht genug Coins.' using errcode = '23514';
  end if;
  v_pay := (p_bet::bigint * v_seg[v_i + 1] * v_rtp) / (10 * 975);
  v_balance := public._gamble_settle(v_me, p_bet, v_pay, v_seg[v_i + 1] >= 40);
  return jsonb_build_object('index', v_i, 'tenths', v_seg[v_i + 1], 'segments', to_jsonb(v_seg), 'bet', p_bet,
                            'payout', v_pay, 'balance', v_balance);
end;
$$;

create or replace function public.gambling_roulette(p_bets jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  v_max integer := greatest(public.setting('gambling_max_bet'), 1);
  v_num integer := floor(random() * 37)::integer;
  v_red integer[] := array[1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36];
  v_color text;
  b jsonb;
  v_t text;
  v_v integer;
  v_a integer;
  v_total integer := 0;
  v_count integer := 0;
  v_pay bigint := 0;
  v_p bigint;
  v_rtp integer := least(greatest(public.setting('gambling_rtp_permille'), 500), 950);
  v_win boolean;
  v_mult integer;
  v_out jsonb := '[]'::jsonb;
  v_balance bigint;
begin
  perform public._feature_guard('gambling');
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  if p_bets is null or jsonb_typeof(p_bets) <> 'array' or jsonb_array_length(p_bets) not between 1 and 10 then
    raise exception 'Setze 1 bis 10 Felder.' using errcode = '22023';
  end if;
  v_color := case when v_num = 0 then 'green' when v_num = any (v_red) then 'red' else 'black' end;
  for b in select * from jsonb_array_elements(p_bets) loop
    v_t := b ->> 't';
    v_v := coalesce((b ->> 'v')::integer, 0);
    v_a := (b ->> 'a')::integer;
    if v_a is null or v_a < 1 or v_a > v_max then
      raise exception 'Jeder Einsatz muss zwischen 1 und % Coins liegen.', v_max using errcode = '22023';
    end if;
    if v_t not in ('straight', 'red', 'black', 'even', 'odd', 'low', 'high', 'dozen', 'column')
       or (v_t = 'straight' and v_v not between 0 and 36)
       or (v_t in ('dozen', 'column') and v_v not between 1 and 3) then
      raise exception 'Ungültige Wette.' using errcode = '22023';
    end if;
    v_total := v_total + v_a;
    v_count := v_count + 1;
  end loop;
  if v_total > v_max * 5 then
    raise exception 'Insgesamt höchstens % Coins pro Runde.', v_max * 5 using errcode = '22023';
  end if;
  if coalesce((select balance from public.koin_wallets where user_id = v_me), 0) < v_total then
    raise exception 'Nicht genug Coins.' using errcode = '23514';
  end if;
  for b in select * from jsonb_array_elements(p_bets) loop
    v_t := b ->> 't';
    v_v := coalesce((b ->> 'v')::integer, 0);
    v_a := (b ->> 'a')::integer;
    v_win := false;
    v_mult := 0;
    if v_t = 'straight' then v_win := v_num = v_v; v_mult := 36;
    elsif v_num > 0 then
      if v_t = 'red' then v_win := v_color = 'red'; v_mult := 2;
      elsif v_t = 'black' then v_win := v_color = 'black'; v_mult := 2;
      elsif v_t = 'even' then v_win := v_num % 2 = 0; v_mult := 2;
      elsif v_t = 'odd' then v_win := v_num % 2 = 1; v_mult := 2;
      elsif v_t = 'low' then v_win := v_num between 1 and 18; v_mult := 2;
      elsif v_t = 'high' then v_win := v_num between 19 and 36; v_mult := 2;
      elsif v_t = 'dozen' then v_win := (v_num - 1) / 12 + 1 = v_v; v_mult := 3;
      elsif v_t = 'column' then v_win := (v_num - 1) % 3 + 1 = v_v; v_mult := 3;
      end if;
    end if;
    v_p := case when v_win then (v_a::bigint * v_mult * v_rtp) / 973 else 0 end;
    v_pay := v_pay + v_p;
    v_out := v_out || jsonb_build_array(jsonb_build_object('t', v_t, 'v', v_v, 'a', v_a, 'win', v_win,
                                                           'pay', v_p));
  end loop;
  v_balance := public._gamble_settle(v_me, v_total, v_pay, v_pay >= v_total::bigint * 10);
  return jsonb_build_object('number', v_num, 'color', v_color, 'bets', v_out, 'bet', v_total,
                            'payout', v_pay, 'balance', v_balance);
end;
$$;

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('gambling_roulette', 'gambling_dice', 'gambling_wheel')
  loop
    execute format('revoke all on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;
end;
$$;

-- 0035: Lernpool nur aus Büchern der eigenen Bibliothek und nur aktive Vokabeln (Multiple Choice, Lernen, Test,
-- Sprint, Fehler-Training). Seit 0011 fehlten diese beiden Filter, dadurch kamen auch Vokabeln aus öffentlichen
-- Büchern, die man gar nicht verwendet. Wiederholbar. Nach 0034 ausführen.

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
  where ((p_book_id is null and public.in_library(v.book_id)) or v.book_id = p_book_id)
    and public.is_active_vocab(v.id)
    and (p_language is null or b.language = p_language);
$$;

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'get_learning_pool'
  loop
    execute format('revoke all on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;
end;
$$;

-- 0036: Design „Gasthaus“ (Schnitzel, Pommes, Spätzle) im Shop (Aussehen steckt in catalog.ts). Wiederholbar. Nach 0035 ausführen.
insert into public.shop_items (id, kind, name, price, sort, required_role) values
  ('theme_food', 'theme', 'Gasthaus', 250000, 260, null)
on conflict (id) do nothing;

-- 0037: Hintergrundfarbe für Emoji-Profilbilder, jeder wählt selbst. Wiederholbar. Nach 0036 ausführen.
-- Anzeigenamen sind eindeutig (ohne Groß-/Kleinschreibung), daher liefert get_avatar_bgs() eine Liste Name → Farbe,
-- die der Client einmal lädt; die vielen Chat-/Ranglisten-Funktionen bleiben unverändert.

alter table public.profiles add column if not exists avatar_bg text;
alter table public.profiles drop constraint if exists profiles_avatar_bg_check;
alter table public.profiles add constraint profiles_avatar_bg_check check (avatar_bg is null or avatar_bg ~ '^#[0-9a-fA-F]{6}$');

create or replace function public.set_avatar_bg(p_color text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  v_c text := nullif(btrim(coalesce(p_color, '')), '');
begin
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  if v_c is not null and v_c !~ '^#[0-9a-fA-F]{6}$' then
    raise exception 'Ungültige Farbe.' using errcode = '22023';
  end if;
  update public.profiles set avatar_bg = lower(v_c) where id = v_me;
end;
$$;

create or replace function public.get_avatar_bgs()
returns table (display_name text, avatar_bg text)
language sql
stable
security definer
set search_path = public
as $$
  select p.display_name, p.avatar_bg
    from public.profiles p
   where (select auth.uid()) is not null and p.avatar_bg is not null;
$$;

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('set_avatar_bg', 'get_avatar_bgs')
  loop
    execute format('revoke all on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;
end;
$$;


-- 0038: Würfeln höchstens 50 % Gewinnchance, Gewinnquote 85 % (statt 90 %); Glücksrad zahlt genau den Faktor, der auf dem Feld steht.
-- Grund: Würfeln machte zu leicht Gewinn; beim Rad stimmte der angezeigte Faktor nicht mit der Auszahlung überein.
-- Rad: 10x ×0, 3x ×0,5, 1x ×1, 4x ×2, 1x ×3, 1x ×4 => im Schnitt 87,5 % zurück. Wiederholbar. Nach 0037 ausführen.

update public.app_settings set value = 850 where key = 'gambling_rtp_permille' and value = 900;

create or replace function public.gambling_dice(p_bet integer, p_over boolean, p_target integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  v_max integer := greatest(public.setting('gambling_max_bet'), 1);
  v_roll integer := 1 + floor(random() * 100)::integer;
  v_chance integer;
  v_rtp integer := least(greatest(public.setting('gambling_rtp_permille'), 500), 950);
  v_win boolean;
  v_pay bigint := 0;
  v_balance bigint;
begin
  perform public._feature_guard('gambling');
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  if p_bet is null or p_bet < 1 or p_bet > v_max then
    raise exception 'Der Einsatz muss zwischen 1 und % Coins liegen.', v_max using errcode = '22023';
  end if;
  if p_target is null or p_over is null then
    raise exception 'Ungültige Wahl.' using errcode = '22023';
  end if;
  v_chance := case when p_over then 100 - p_target else p_target - 1 end;
  if v_chance < 5 or v_chance > 50 then
    raise exception 'Die Gewinnchance muss zwischen 5 %% und 50 %% liegen.' using errcode = '22023';
  end if;
  if coalesce((select balance from public.koin_wallets where user_id = v_me), 0) < p_bet then
    raise exception 'Nicht genug Coins.' using errcode = '23514';
  end if;
  v_win := case when p_over then v_roll > p_target else v_roll < p_target end;
  if v_win then v_pay := (p_bet::bigint * v_rtp) / (10 * v_chance); end if;
  v_balance := public._gamble_settle(v_me, p_bet, v_pay, v_pay >= p_bet::bigint * 10);
  return jsonb_build_object('roll', v_roll, 'chance', v_chance, 'win', v_win, 'bet', p_bet,
                            'payout', v_pay, 'balance', v_balance);
end;
$$;

create or replace function public.gambling_wheel(p_bet integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  v_max integer := greatest(public.setting('gambling_max_bet'), 1);
  v_seg integer[] := array[0,5,0,20,0,10,0,30,0,5,0,40,0,20,0,20,0,5,0,20];
  v_i integer := floor(random() * 20)::integer;
  v_pay bigint;
  v_balance bigint;
begin
  perform public._feature_guard('gambling');
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  if p_bet is null or p_bet < 1 or p_bet > v_max then
    raise exception 'Der Einsatz muss zwischen 1 und % Coins liegen.', v_max using errcode = '22023';
  end if;
  if coalesce((select balance from public.koin_wallets where user_id = v_me), 0) < p_bet then
    raise exception 'Nicht genug Coins.' using errcode = '23514';
  end if;
  v_pay := (p_bet::bigint * v_seg[v_i + 1]) / 10;
  v_balance := public._gamble_settle(v_me, p_bet, v_pay, v_seg[v_i + 1] >= 40);
  return jsonb_build_object('index', v_i, 'tenths', v_seg[v_i + 1], 'segments', to_jsonb(v_seg), 'bet', p_bet,
                            'payout', v_pay, 'balance', v_balance);
end;
$$;

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('gambling_dice', 'gambling_wheel')
  loop
    execute format('revoke all on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;
end;
$$;


-- 0039: Black Jack mit Coins. Karten und Mischen liegen komplett auf dem Server (Tabelle ohne Zugriff für Clients),
-- die verdeckte Karte des Gebers wird erst beim Aufdecken gesendet. Regeln: 1 Deck pro Runde, Geber zieht bis 17 und
-- bleibt bei weichem 17 NICHT stehen (zieht weiter), Black Jack zahlt 6:5, Verdoppeln bei den ersten zwei Karten, kein Teilen.
-- Der Einsatz wird beim Start abgebucht. Wer eine offene Runde verlässt und neu startet, verliert sie. Wiederholbar. Nach 0038 ausführen.

create table if not exists public.blackjack_hands (
  user_id uuid primary key references auth.users (id) on delete cascade,
  bet integer not null check (bet > 0),
  deck integer[] not null,
  player integer[] not null,
  dealer integer[] not null,
  doubled boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.blackjack_hands enable row level security;
revoke all on public.blackjack_hands from anon, authenticated;

-- Wert einer Hand (Kartennummer 0..51, Rang = c % 13, 0 = Ass, 9..12 = Zehn/Bube/Dame/König)
create or replace function public._bj_total(p_cards integer[])
returns integer
language sql
immutable
set search_path = public
as $$
  select case when aces > 0 and s + 10 <= 21 then s + 10 else s end
    from (select coalesce(sum(case when c % 13 = 0 then 1 when c % 13 >= 9 then 10 else c % 13 + 1 end), 0)::integer as s,
                 count(*) filter (where c % 13 = 0) as aces
            from unnest(p_cards) as c) t;
$$;

create or replace function public._bj_soft(p_cards integer[])
returns boolean
language sql
immutable
set search_path = public
as $$
  select aces > 0 and s + 10 <= 21
    from (select coalesce(sum(case when c % 13 = 0 then 1 when c % 13 >= 9 then 10 else c % 13 + 1 end), 0)::integer as s,
                 count(*) filter (where c % 13 = 0) as aces
            from unnest(p_cards) as c) t;
$$;

-- Zustand für den Client. Bei offener Runde ist nur die erste Geberkarte sichtbar.
create or replace function public._bj_state(p_h public.blackjack_hands, p_done boolean, p_result text, p_payout bigint, p_balance bigint)
returns jsonb
language plpgsql
immutable
set search_path = public
as $$
begin
  return jsonb_build_object(
    'done', p_done, 'result', p_result, 'bet', p_h.bet, 'payout', p_payout, 'balance', p_balance,
    'player', to_jsonb(p_h.player), 'player_total', public._bj_total(p_h.player),
    'dealer', to_jsonb(case when p_done then p_h.dealer else p_h.dealer[1:1] end),
    'dealer_total', case when p_done then public._bj_total(p_h.dealer) else public._bj_total(p_h.dealer[1:1]) end,
    'can_double', (not p_done) and array_length(p_h.player, 1) = 2 and not p_h.doubled);
end;
$$;

-- Runde abschließen: Auszahlung (inkl. Einsatz) gutschreiben, Statistik und Feed füllen, Hand löschen.
create or replace function public._bj_finish(p_user uuid, p_bet integer, p_payout bigint)
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
  insert into public.gambling_feed (user_id, bet, payout, jackpot) values (p_user, p_bet, least(p_payout, 2000000000)::integer, false);
  delete from public.gambling_feed where created_at < now() - interval '3 days';
  insert into public.gambling_stats (user_id, plays, wagered, won, best_win)
  values (p_user, 1, p_bet, p_payout, least(p_payout, 2000000000)::integer)
  on conflict (user_id) do update
    set plays = public.gambling_stats.plays + 1,
        wagered = public.gambling_stats.wagered + p_bet,
        won = public.gambling_stats.won + p_payout,
        best_win = greatest(public.gambling_stats.best_win, least(p_payout, 2000000000)::integer);
  return v_balance;
end;
$$;

-- Geber spielt aus und die Runde wird gewertet.
create or replace function public._bj_resolve(p_h public.blackjack_hands)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  h public.blackjack_hands := p_h;
  v_pt integer := public._bj_total(h.player);
  v_dt integer;
  v_pay bigint := 0;
  v_res text;
  v_balance bigint;
begin
  if v_pt > 21 then
    v_res := 'bust';
  else
    loop
      v_dt := public._bj_total(h.dealer);
      exit when v_dt > 17 or (v_dt = 17 and not public._bj_soft(h.dealer));
      h.dealer := h.dealer || h.deck[1];
      h.deck := h.deck[2:array_length(h.deck, 1)];
    end loop;
    v_dt := public._bj_total(h.dealer);
    if v_dt > 21 or v_pt > v_dt then v_res := 'win'; v_pay := h.bet::bigint * 2;
    elsif v_pt = v_dt then v_res := 'push'; v_pay := h.bet;
    else v_res := 'lose';
    end if;
  end if;
  v_balance := public._bj_finish(h.user_id, h.bet, v_pay);
  return public._bj_state(h, true, v_res, v_pay, v_balance);
end;
$$;

create or replace function public.blackjack_start(p_bet integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  v_max integer := greatest(public.setting('gambling_max_bet'), 1);
  v_old public.blackjack_hands;
  h public.blackjack_hands;
  v_balance bigint;
  v_pay bigint := 0;
  v_res text;
  v_pn boolean;
  v_dn boolean;
begin
  perform public._feature_guard('gambling');
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  perform pg_advisory_xact_lock(hashtext('bj' || v_me::text));
  if p_bet is null or p_bet < 1 or p_bet > v_max then
    raise exception 'Der Einsatz muss zwischen 1 und % Coins liegen.', v_max using errcode = '22023';
  end if;
  -- offene Runde verfällt als Verlust (Einsatz war schon abgebucht)
  select * into v_old from public.blackjack_hands where user_id = v_me;
  if found then
    perform public._bj_finish(v_me, v_old.bet, 0);
  end if;
  if coalesce((select balance from public.koin_wallets where user_id = v_me), 0) < p_bet then
    raise exception 'Nicht genug Coins.' using errcode = '23514';
  end if;
  v_balance := public._grant_koins(v_me, -p_bet::bigint, 'gambling_bet', null);
  h.user_id := v_me;
  h.bet := p_bet;
  h.doubled := false;
  select array_agg(c order by random()) into h.deck from generate_series(0, 51) as c;
  h.player := array[h.deck[1], h.deck[3]];
  h.dealer := array[h.deck[2], h.deck[4]];
  h.deck := h.deck[5:52];
  v_pn := public._bj_total(h.player) = 21;
  v_dn := public._bj_total(h.dealer) = 21;
  if v_pn or v_dn then
    if v_pn and v_dn then v_res := 'push'; v_pay := h.bet;
    elsif v_pn then v_res := 'blackjack'; v_pay := (h.bet::bigint * 11) / 5; -- 6:5 plus Einsatz
    else v_res := 'lose';
    end if;
    insert into public.blackjack_hands (user_id, bet, deck, player, dealer, doubled) values (h.user_id, h.bet, h.deck, h.player, h.dealer, false);
    v_balance := public._bj_finish(v_me, h.bet, v_pay);
    return public._bj_state(h, true, v_res, v_pay, v_balance);
  end if;
  insert into public.blackjack_hands (user_id, bet, deck, player, dealer, doubled) values (h.user_id, h.bet, h.deck, h.player, h.dealer, false);
  return public._bj_state(h, false, null, 0, v_balance);
end;
$$;

-- Offene Runde nach Neuladen wieder anzeigen (oder null).
create or replace function public.blackjack_current()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  h public.blackjack_hands;
begin
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  select * into h from public.blackjack_hands where user_id = v_me;
  if not found then return null; end if;
  return public._bj_state(h, false, null, 0,
    coalesce((select balance from public.koin_wallets where user_id = v_me), 0));
end;
$$;

create or replace function public.blackjack_action(p_action text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  h public.blackjack_hands;
  v_balance bigint;
begin
  perform public._feature_guard('gambling');
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  perform pg_advisory_xact_lock(hashtext('bj' || v_me::text));
  select * into h from public.blackjack_hands where user_id = v_me;
  if not found then
    raise exception 'Keine offene Runde.' using errcode = '22023';
  end if;
  if p_action = 'hit' then
    h.player := h.player || h.deck[1];
    h.deck := h.deck[2:array_length(h.deck, 1)];
    if public._bj_total(h.player) >= 21 then
      return public._bj_resolve(h);
    end if;
  elsif p_action = 'stand' then
    return public._bj_resolve(h);
  elsif p_action = 'double' then
    if array_length(h.player, 1) <> 2 or h.doubled then
      raise exception 'Verdoppeln geht nur mit den ersten zwei Karten.' using errcode = '22023';
    end if;
    if coalesce((select balance from public.koin_wallets where user_id = v_me), 0) < h.bet then
      raise exception 'Nicht genug Coins zum Verdoppeln.' using errcode = '23514';
    end if;
    perform public._grant_koins(v_me, -h.bet::bigint, 'gambling_bet', null);
    h.bet := h.bet * 2;
    h.doubled := true;
    h.player := h.player || h.deck[1];
    h.deck := h.deck[2:array_length(h.deck, 1)];
    return public._bj_resolve(h);
  else
    raise exception 'Ungültige Aktion.' using errcode = '22023';
  end if;
  update public.blackjack_hands set player = h.player, deck = h.deck, bet = h.bet, doubled = h.doubled where user_id = v_me;
  v_balance := coalesce((select balance from public.koin_wallets where user_id = v_me), 0);
  return public._bj_state(h, false, null, 0, v_balance);
end;
$$;

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig, p.proname
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('blackjack_start', 'blackjack_action', 'blackjack_current', '_bj_finish', '_bj_resolve', '_bj_state', '_bj_total', '_bj_soft')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    if r.proname in ('blackjack_start', 'blackjack_action', 'blackjack_current') then
      execute format('grant execute on function %s to authenticated', r.sig);
    end if;
  end loop;
end;
$$;


-- 0040: Mehr Einstellungen fürs Gambling + Hausschutz + höhere Einsätze.
--  * Höchsteinsatz Standard 10.000 Coins (nur wenn noch der alte Wert 200 gilt).
--  * Jede Wahrscheinlichkeit einzeln einstellbar: Würfeln (Gewinnquote, höchste Chance), Roulette (Gewinnquote),
--    Glücksrad (Gewicht je Feld-Faktor), Black Jack (Auszahlung für Black Jack, Geber zieht bei weichem 17).
--  * Hausschutz: Liegt der Hausgewinn der letzten 3 Tage unter dem Ziel, wird ein Gewinn mit einer gewissen
--    Wahrscheinlichkeit nicht ausgespielt (ohne Hinweis für die Spieler), siehe _house_squeeze().
-- Wiederholbar. Nach 0039 ausführen.

insert into public.app_settings (key, value, mod_editable) values
  ('gambling_rtp_dice', 850, false),
  ('gambling_rtp_roulette', 850, false),
  ('gambling_dice_max_chance', 50, false),
  ('gambling_wheel_w0', 500, false),
  ('gambling_wheel_w05', 150, false),
  ('gambling_wheel_w1', 50, false),
  ('gambling_wheel_w2', 200, false),
  ('gambling_wheel_w3', 50, false),
  ('gambling_wheel_w4', 50, false),
  ('gambling_bj_blackjack_x10', 12, false),
  ('gambling_bj_dealer_hits_soft17', 1, false),
  ('gambling_guard_target_permille', 50, false),
  ('gambling_guard_max_permille', 600, false),
  ('gambling_guard_min_wagered', 5000, false)
on conflict (key) do nothing;

-- bestehende Gewinnquote als Startwert für Würfeln/Roulette übernehmen (nur beim ersten Lauf, wenn noch Standard)
update public.app_settings set value = (select value from public.app_settings where key = 'gambling_rtp_permille')
 where key in ('gambling_rtp_dice', 'gambling_rtp_roulette') and value = 850
   and exists (select 1 from public.app_settings where key = 'gambling_rtp_permille' and value <> 850);

update public.app_settings set value = 10000 where key = 'gambling_max_bet' and value = 200;

alter table public.blackjack_hands add column if not exists squeeze boolean not null default false;
create index if not exists gambling_feed_created_idx on public.gambling_feed (created_at);

-- Soll diese Runde einen Gewinn verlieren? Nur wenn der Hausgewinn der letzten 3 Tage unter dem Ziel liegt.
create or replace function public._house_squeeze()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_max integer := least(greatest(public.setting('gambling_guard_max_permille'), 0), 1000);
  v_target integer := public.setting('gambling_guard_target_permille');
  v_w bigint;
  v_p bigint;
  v_margin bigint;
begin
  if v_max = 0 then return false; end if;
  select coalesce(sum(bet), 0), coalesce(sum(payout), 0) into v_w, v_p
    from public.gambling_feed where created_at > now() - interval '3 days';
  if v_w <= 0 or v_w < public.setting('gambling_guard_min_wagered') then return false; end if;
  v_margin := ((v_w - v_p) * 1000) / v_w;
  if v_margin >= v_target then return false; end if;
  return random() * 1000 < least(v_max, v_target - v_margin);
end;
$$;
revoke all on function public._house_squeeze() from public, anon, authenticated;

create or replace function public.gambling_dice(p_bet integer, p_over boolean, p_target integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  v_max integer := greatest(public.setting('gambling_max_bet'), 1);
  v_roll integer := 1 + floor(random() * 100)::integer;
  v_chance integer;
  v_maxchance integer := least(greatest(public.setting('gambling_dice_max_chance'), 5), 95);
  v_rtp integer := least(greatest(public.setting('gambling_rtp_dice'), 300), 990);
  v_win boolean;
  v_pay bigint := 0;
  v_balance bigint;
begin
  perform public._feature_guard('gambling');
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  if p_bet is null or p_bet < 1 or p_bet > v_max then
    raise exception 'Der Einsatz muss zwischen 1 und % Coins liegen.', v_max using errcode = '22023';
  end if;
  if p_target is null or p_over is null then
    raise exception 'Ungültige Wahl.' using errcode = '22023';
  end if;
  v_chance := case when p_over then 100 - p_target else p_target - 1 end;
  if v_chance < 5 or v_chance > v_maxchance then
    raise exception 'Die Gewinnchance muss zwischen 5 %% und % %% liegen.', v_maxchance using errcode = '22023';
  end if;
  if coalesce((select balance from public.koin_wallets where user_id = v_me), 0) < p_bet then
    raise exception 'Nicht genug Coins.' using errcode = '23514';
  end if;
  v_win := case when p_over then v_roll > p_target else v_roll < p_target end;
  if v_win and public._house_squeeze() then
    v_roll := case when p_over then 1 + floor(random() * p_target)::integer
                   else p_target + floor(random() * (101 - p_target))::integer end;
    v_win := false;
  end if;
  if v_win then v_pay := (p_bet::bigint * v_rtp) / (10 * v_chance); end if;
  v_balance := public._gamble_settle(v_me, p_bet, v_pay, v_pay >= p_bet::bigint * 10);
  return jsonb_build_object('roll', v_roll, 'chance', v_chance, 'win', v_win, 'bet', p_bet,
                            'payout', v_pay, 'balance', v_balance);
end;
$$;

create or replace function public.gambling_wheel(p_bet integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  v_max integer := greatest(public.setting('gambling_max_bet'), 1);
  v_seg integer[] := array[0,5,0,20,0,10,0,30,0,5,0,40,0,20,0,20,0,5,0,20];
  v_fac integer[] := array[0,5,10,20,30,40];
  v_w integer[] := array[public.setting('gambling_wheel_w0'), public.setting('gambling_wheel_w05'), public.setting('gambling_wheel_w1'),
                         public.setting('gambling_wheel_w2'), public.setting('gambling_wheel_w3'), public.setting('gambling_wheel_w4')];
  v_sum integer := 0;
  v_r numeric;
  v_f integer := 0;
  v_k integer;
  v_cand integer[];
  v_i integer;
  v_pay bigint;
  v_balance bigint;
begin
  perform public._feature_guard('gambling');
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  if p_bet is null or p_bet < 1 or p_bet > v_max then
    raise exception 'Der Einsatz muss zwischen 1 und % Coins liegen.', v_max using errcode = '22023';
  end if;
  if coalesce((select balance from public.koin_wallets where user_id = v_me), 0) < p_bet then
    raise exception 'Nicht genug Coins.' using errcode = '23514';
  end if;
  for v_k in 1..6 loop v_sum := v_sum + greatest(v_w[v_k], 0); end loop;
  if v_sum > 0 then
    v_r := random() * v_sum;
    for v_k in 1..6 loop
      v_r := v_r - greatest(v_w[v_k], 0);
      if v_r < 0 then v_f := v_fac[v_k]; exit; end if;
    end loop;
  end if;
  -- Hausschutz: ein Gewinn (ab ×1) wird zu einem Verlustfeld
  if v_f >= 10 and public._house_squeeze() then
    v_f := case when greatest(v_w[2], 0) > 0 and random() * (greatest(v_w[1], 0) + greatest(v_w[2], 0)) >= greatest(v_w[1], 0) then 5 else 0 end;
  end if;
  select array_agg(i - 1) into v_cand from generate_subscripts(v_seg, 1) as i where v_seg[i] = v_f;
  v_i := v_cand[1 + floor(random() * array_length(v_cand, 1))::integer];
  v_pay := (p_bet::bigint * v_f) / 10;
  v_balance := public._gamble_settle(v_me, p_bet, v_pay, v_f >= 40);
  return jsonb_build_object('index', v_i, 'tenths', v_f, 'segments', to_jsonb(v_seg), 'bet', p_bet,
                            'payout', v_pay, 'balance', v_balance);
end;
$$;

create or replace function public.gambling_roulette(p_bets jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  v_max integer := greatest(public.setting('gambling_max_bet'), 1);
  v_num integer;
  v_red integer[] := array[1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36];
  v_color text;
  b jsonb;
  v_t text;
  v_v integer;
  v_a integer;
  v_total integer := 0;
  v_pay bigint := 0;
  v_p bigint;
  v_rtp integer := least(greatest(public.setting('gambling_rtp_roulette'), 300), 990);
  v_win boolean;
  v_mult integer;
  v_out jsonb;
  v_sq boolean;
  v_try integer := 0;
  v_balance bigint;
begin
  perform public._feature_guard('gambling');
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  if p_bets is null or jsonb_typeof(p_bets) <> 'array' or jsonb_array_length(p_bets) not between 1 and 10 then
    raise exception 'Setze 1 bis 10 Felder.' using errcode = '22023';
  end if;
  for b in select * from jsonb_array_elements(p_bets) loop
    v_t := b ->> 't';
    v_v := coalesce((b ->> 'v')::integer, 0);
    v_a := (b ->> 'a')::integer;
    if v_a is null or v_a < 1 or v_a > v_max then
      raise exception 'Jeder Einsatz muss zwischen 1 und % Coins liegen.', v_max using errcode = '22023';
    end if;
    if v_t not in ('straight', 'red', 'black', 'even', 'odd', 'low', 'high', 'dozen', 'column')
       or (v_t = 'straight' and v_v not between 0 and 36)
       or (v_t in ('dozen', 'column') and v_v not between 1 and 3) then
      raise exception 'Ungültige Wette.' using errcode = '22023';
    end if;
    v_total := v_total + v_a;
  end loop;
  if v_total > v_max * 5 then
    raise exception 'Insgesamt höchstens % Coins pro Runde.', v_max * 5 using errcode = '22023';
  end if;
  if coalesce((select balance from public.koin_wallets where user_id = v_me), 0) < v_total then
    raise exception 'Nicht genug Coins.' using errcode = '23514';
  end if;
  v_sq := public._house_squeeze();
  loop
    v_try := v_try + 1;
    v_num := floor(random() * 37)::integer;
    v_color := case when v_num = 0 then 'green' when v_num = any (v_red) then 'red' else 'black' end;
    v_pay := 0;
    v_out := '[]'::jsonb;
    for b in select * from jsonb_array_elements(p_bets) loop
      v_t := b ->> 't';
      v_v := coalesce((b ->> 'v')::integer, 0);
      v_a := (b ->> 'a')::integer;
      v_win := false;
      v_mult := 0;
      if v_t = 'straight' then v_win := v_num = v_v; v_mult := 36;
      elsif v_num > 0 then
        if v_t = 'red' then v_win := v_color = 'red'; v_mult := 2;
        elsif v_t = 'black' then v_win := v_color = 'black'; v_mult := 2;
        elsif v_t = 'even' then v_win := v_num % 2 = 0; v_mult := 2;
        elsif v_t = 'odd' then v_win := v_num % 2 = 1; v_mult := 2;
        elsif v_t = 'low' then v_win := v_num between 1 and 18; v_mult := 2;
        elsif v_t = 'high' then v_win := v_num between 19 and 36; v_mult := 2;
        elsif v_t = 'dozen' then v_win := (v_num - 1) / 12 + 1 = v_v; v_mult := 3;
        elsif v_t = 'column' then v_win := (v_num - 1) % 3 + 1 = v_v; v_mult := 3;
        end if;
      end if;
      v_p := case when v_win then (v_a::bigint * v_mult * v_rtp) / 973 else 0 end;
      v_pay := v_pay + v_p;
      v_out := v_out || jsonb_build_array(jsonb_build_object('t', v_t, 'v', v_v, 'a', v_a, 'win', v_win, 'pay', v_p));
    end loop;
    -- Hausschutz: bei einem Gewinn neu drehen (bis zu 40 Mal), bis es kein Gewinn mehr ist
    exit when not v_sq or v_pay <= v_total or v_try >= 40;
  end loop;
  v_balance := public._gamble_settle(v_me, v_total, v_pay, v_pay >= v_total::bigint * 10);
  return jsonb_build_object('number', v_num, 'color', v_color, 'bets', v_out, 'bet', v_total,
                            'payout', v_pay, 'balance', v_balance);
end;
$$;

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
  v_max integer := greatest(public.setting('gambling_max_bet'), 1);
  v_mult integer := 0;
  v_is_jackpot boolean := false;
  v_reels integer[];
  v_s integer;
  v_payout bigint;
  v_balance bigint;
begin
  perform public._feature_guard('gambling');
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  if p_bet is null or p_bet < 1 or p_bet > v_max then
    raise exception 'Der Einsatz muss zwischen 1 und % Coins liegen.', v_max using errcode = '22023';
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
  end if;
  -- Hausschutz: Gewinn wird zu einer Niete
  if v_mult > 0 and public._house_squeeze() then
    v_mult := 0;
    v_is_jackpot := false;
    v_reels := null;
  end if;
  if v_reels is null then
    loop
      v_reels := array[floor(random() * 7)::integer, floor(random() * 7)::integer, floor(random() * 7)::integer];
      exit when not (v_reels[1] = v_reels[2] and v_reels[2] = v_reels[3]);
    end loop;
  end if;
  v_payout := p_bet::bigint * v_mult;
  v_balance := public._gamble_settle(v_me, p_bet, v_payout, v_is_jackpot);
  return jsonb_build_object('reels', to_jsonb(v_reels), 'mult', v_mult, 'payout', v_payout,
                            'bet', p_bet, 'balance', v_balance);
end;
$$;

create or replace function public._bj_resolve(p_h public.blackjack_hands)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  h public.blackjack_hands := p_h;
  v_pt integer := public._bj_total(h.player);
  v_dt integer;
  v_pay bigint := 0;
  v_res text;
  v_balance bigint;
  v_hit17 boolean := public.setting('gambling_bj_dealer_hits_soft17') <> 0;
  v_dealer integer[];
  v_deck integer[];
  v_try integer := 0;
begin
  if v_pt > 21 then
    v_res := 'bust';
  else
    loop
      v_try := v_try + 1;
      v_dealer := h.dealer;
      v_deck := h.deck;
      loop
        v_dt := public._bj_total(v_dealer);
        exit when v_dt > 17 or (v_dt = 17 and not (public._bj_soft(v_dealer) and v_hit17));
        v_dealer := v_dealer || v_deck[1];
        v_deck := v_deck[2:array_length(v_deck, 1)];
      end loop;
      v_dt := public._bj_total(v_dealer);
      -- Hausschutz: bei einem Gewinn des Spielers den Rest des Decks neu mischen und den Geber noch einmal spielen
      exit when not (h.squeeze and (v_dt > 21 or v_pt > v_dt)) or v_try >= 25;
      select array_agg(c order by random()) into h.deck from unnest(h.deck) as c;
    end loop;
    h.dealer := v_dealer;
    h.deck := v_deck;
    if v_dt > 21 or v_pt > v_dt then v_res := 'win'; v_pay := h.bet::bigint * 2;
    elsif v_pt = v_dt then v_res := 'push'; v_pay := h.bet;
    else v_res := 'lose';
    end if;
  end if;
  v_balance := public._bj_finish(h.user_id, h.bet, v_pay);
  return public._bj_state(h, true, v_res, v_pay, v_balance);
end;
$$;

create or replace function public.blackjack_start(p_bet integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  v_max integer := greatest(public.setting('gambling_max_bet'), 1);
  v_old public.blackjack_hands;
  h public.blackjack_hands;
  v_balance bigint;
  v_pay bigint := 0;
  v_res text;
  v_pn boolean;
  v_dn boolean;
  v_x integer := least(greatest(public.setting('gambling_bj_blackjack_x10'), 0), 100);
  v_sq boolean;
  v_try integer := 0;
begin
  perform public._feature_guard('gambling');
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  perform pg_advisory_xact_lock(hashtext('bj' || v_me::text));
  if p_bet is null or p_bet < 1 or p_bet > v_max then
    raise exception 'Der Einsatz muss zwischen 1 und % Coins liegen.', v_max using errcode = '22023';
  end if;
  select * into v_old from public.blackjack_hands where user_id = v_me;
  if found then
    perform public._bj_finish(v_me, v_old.bet, 0);
  end if;
  if coalesce((select balance from public.koin_wallets where user_id = v_me), 0) < p_bet then
    raise exception 'Nicht genug Coins.' using errcode = '23514';
  end if;
  v_balance := public._grant_koins(v_me, -p_bet::bigint, 'gambling_bet', null);
  v_sq := public._house_squeeze();
  h.user_id := v_me;
  h.bet := p_bet;
  h.doubled := false;
  h.squeeze := v_sq;
  loop
    v_try := v_try + 1;
    select array_agg(c order by random()) into h.deck from generate_series(0, 51) as c;
    h.player := array[h.deck[1], h.deck[3]];
    h.dealer := array[h.deck[2], h.deck[4]];
    h.deck := h.deck[5:52];
    exit when not (v_sq and public._bj_total(h.player) = 21) or v_try >= 10;
  end loop;
  v_pn := public._bj_total(h.player) = 21;
  v_dn := public._bj_total(h.dealer) = 21;
  insert into public.blackjack_hands (user_id, bet, deck, player, dealer, doubled, squeeze)
  values (h.user_id, h.bet, h.deck, h.player, h.dealer, false, v_sq);
  if v_pn or v_dn then
    if v_pn and v_dn then v_res := 'push'; v_pay := h.bet;
    elsif v_pn then v_res := 'blackjack'; v_pay := (h.bet::bigint * (10 + v_x)) / 10;
    else v_res := 'lose';
    end if;
    v_balance := public._bj_finish(v_me, h.bet, v_pay);
    return public._bj_state(h, true, v_res, v_pay, v_balance);
  end if;
  return public._bj_state(h, false, null, 0, v_balance);
end;
$$;
