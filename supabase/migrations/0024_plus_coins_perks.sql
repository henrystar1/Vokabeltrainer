-- ============================================================================
-- 0024: Vokabeltrainer + nur noch mit Coins (Stufen), Plus-Vorteile, Quest-Ketten.
--  * Stufen: 1 Tag 100, 1 Woche 600, 1 Monat 3000, 3 Monate 8000, für immer 100000 Coins (im Admin änderbar)
--  * Coins ×1,5 und Ranglistenpunkte ×1,5 mit Plus (Gambling-Gewinne ausgenommen)
--  * Gambling: höhere Gewinnchance mit Plus
--  * „Vokabeln sofort wieder fällig machen“ (nur Plus)
--  * Wiederbeleben im Spiel für 1000 Coins (nur Plus, höchstens 3× pro Runde)
--  * Quests: Ketten (20 → 50 → 100 → 200 Antworten, 1 → 4 → 8 Duelle …) und Plus-Quests
--  * Weitere Plus-Artikel (animierte Profilbilder, Effekte, Farben, Designs)
-- Wiederholbar. Nach 0023 ausführen.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Einstellungen und Verkäufe
-- ----------------------------------------------------------------------------

insert into public.plus_settings (key, value, label, unit, hint, min_value, max_value, sort) values
  ('plus_price_d1',   100,    'Preis: 1 Tag',        'Coins', '', 0, 1000000000, 11),
  ('plus_price_d7',   600,    'Preis: 1 Woche',      'Coins', '', 0, 1000000000, 12),
  ('plus_price_d30',  3000,   'Preis: 1 Monat',      'Coins', '', 0, 1000000000, 13),
  ('plus_price_d90',  8000,   'Preis: 3 Monate',     'Coins', '', 0, 1000000000, 14),
  ('plus_price_life', 100000, 'Preis: für immer',    'Coins', '', 0, 1000000000, 15),
  ('plus_coin_mult',  1.5,    'Coins-Multiplikator mit Plus',  '×', 'Gilt für Lernen, Quests, Spiele, Sprint usw. (nicht für Gambling-Gewinne).', 1, 10, 200),
  ('plus_points_mult', 1.5,   'Ranglistenpunkte-Multiplikator mit Plus', '×', 'Für die Wochenliga.', 1, 10, 210),
  ('plus_gamble_boost_percent', 15, 'Gambling: bessere Gewinnchance mit Plus', '%', 'Relativ zur normalen Gewinnchance (15 % = aus 20 % werden 23 %).', 0, 100, 220),
  ('plus_revive_price', 1000, 'Wiederbeleben im Spiel', 'Coins', 'Nur mit Plus.', 0, 1000000, 230),
  ('plus_revive_max',   3,    'Wiederbeleben pro Runde (höchstens)', 'mal', '', 1, 20, 240)
on conflict (key) do update
  set label = excluded.label, unit = excluded.unit, hint = excluded.hint,
      min_value = excluded.min_value, max_value = excluded.max_value, sort = excluded.sort;

alter table public.plus_sales add column if not exists coins bigint not null default 0;
alter table public.plus_sales drop constraint if exists plus_sales_days_check;
alter table public.plus_sales add constraint plus_sales_days_check check (days between 1 and 36500);
alter table public.game_runs add column if not exists revives smallint not null default 0;

-- ----------------------------------------------------------------------------
-- 2. Plus kaufen (Coins)
-- ----------------------------------------------------------------------------

create or replace function public._plus_tiers()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_array(
    jsonb_build_object('id', 'd1',   'label', '1 Tag',     'days', 1,     'price', public._pls('plus_price_d1')::bigint),
    jsonb_build_object('id', 'd7',   'label', '1 Woche',   'days', 7,     'price', public._pls('plus_price_d7')::bigint),
    jsonb_build_object('id', 'd30',  'label', '1 Monat',   'days', 30,    'price', public._pls('plus_price_d30')::bigint),
    jsonb_build_object('id', 'd90',  'label', '3 Monate',  'days', 90,    'price', public._pls('plus_price_d90')::bigint),
    jsonb_build_object('id', 'life', 'label', 'Für immer', 'days', 36500, 'price', public._pls('plus_price_life')::bigint));
$$;

create or replace function public.plus_status()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  p public.profiles;
  s public.ai_status;
begin
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  select * into p from public.profiles where id = v_me;
  select * into s from public.ai_status where id;
  perform public._plus_sync(v_me);
  return jsonb_build_object(
    'active', public._plus_active(v_me),
    'until', case when p.role = 'admin' then null else p.plus_until end,
    'lifetime', coalesce(p.plus_until >= '2099-01-01'::timestamptz, false),
    'is_admin', p.role = 'admin',
    'trial_available', false,
    'requested', exists (select 1 from public.plus_requests r where r.user_id = v_me),
    'price_cents', round(public._pls('plus_price_eur') * 100),
    'days', public._pls('plus_days'),
    'coin_price', public._pls('plus_price_d1'),
    'coin_days', 1,
    'tiers', public._plus_tiers(),
    'coin_mult', public._pls('plus_coin_mult'),
    'points_mult', public._pls('plus_points_mult'),
    'gamble_boost', public._pls('plus_gamble_boost_percent'),
    'revive_price', public._pls('plus_revive_price'),
    'ai_enabled', public._pls('ai_enabled') >= 1,
    'ai_state', s.state,
    'ai_message', s.message,
    'max_items', public._pls('ai_max_items'),
    'test_sentences', public._pls('ai_test_sentences'));
end;
$$;

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
