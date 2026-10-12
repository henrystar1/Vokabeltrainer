-- ============================================================================
-- 0021: Vokabeltrainer + (Abo), KI-Grammatikblätter und Test-Sätze (OpenAI über eine Edge Function),
-- Plus-Designs und -Tag, Verdienst-Konto für das Pro-Abo.
-- Wiederholbar. Nach 0020 ausführen.
--
-- Wichtig: Alles, was die KI schreibt (Status, Blätter, Kosten), geht nur über die Edge Function
-- (Rolle service_role). Der Browser kann diese Funktionen nicht aufrufen.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Einstellungen (alle vom Admin änderbar)
-- ----------------------------------------------------------------------------

create table if not exists public.plus_settings (
  key text primary key,
  value numeric not null,
  label text not null,
  unit text not null default '',
  hint text not null default '',
  min_value numeric not null default 0,
  max_value numeric not null default 100000,
  sort integer not null default 100
);
alter table public.plus_settings enable row level security;
revoke all on public.plus_settings from anon, authenticated;

insert into public.plus_settings (key, value, label, unit, hint, min_value, max_value, sort) values
  ('plus_price_eur',     3,    'Preis eines Plus-Pakets',          '€',        'Wird in der Schule bar bezahlt. Nur zur Anzeige und als Vorgabe beim Vergeben.', 0, 1000, 10),
  ('plus_days',          30,   'Laufzeit eines Pakets',            'Tage',     'So lange gilt Plus nach dem Vergeben (du kannst beim Vergeben auch andere Tage eintragen).', 1, 365, 20),
  ('plus_coin_enabled',  1,    '1 Tag Plus für Coins',             '1 = an',   'Jeder kann sich einmalig einen Tag Plus für Coins kaufen.', 0, 1, 30),
  ('plus_coin_price',    1000, 'Preis des Tages in Coins',         'Coins',    'Gilt nur einmalig pro Person.', 1, 1000000, 40),
  ('plus_coin_days',     1,    'Dauer des Coin-Tages',             'Tage',     '', 1, 30, 50),
  ('ai_enabled',         1,    'KI-Funktionen an',                 '1 = an',   'Bei 0 kann niemand Blätter erzeugen (gespeicherte Blätter bleiben nutzbar).', 0, 1, 60),
  ('ai_usd_in',          0.15, 'Modellpreis Eingabe',              '$ / 1 Mio. Tokens', 'Aus der OpenAI-Preisliste (gpt-4o-mini: 0,15). Daraus werden die Kosten berechnet.', 0, 1000, 70),
  ('ai_usd_out',         0.60, 'Modellpreis Ausgabe',              '$ / 1 Mio. Tokens', 'Aus der OpenAI-Preisliste (gpt-4o-mini: 0,60).', 0, 1000, 80),
  ('ai_usd_eur',         0.92, 'Dollar-Kurs',                      '€ pro $',  'Zum Umrechnen der Kosten in Euro.', 0.1, 10, 90),
  ('ai_user_month_eur',  0.50, 'KI-Budget pro Person und Monat',   '€',        'Wenn die Kosten einer Person diesen Betrag erreichen, kann sie diesen Monat nichts mehr erzeugen.', 0, 100, 100),
  ('ai_user_day_gens',   30,   'Erzeugungen pro Person und Tag',   'Stück',    'Schutz gegen Dauer-Klicken.', 1, 1000, 110),
  ('ai_global_month_eur', 10,  'KI-Budget insgesamt pro Monat',    '€',        'Notbremse für alle zusammen. Zusätzlich solltest du im OpenAI-Konto ein Ausgabenlimit setzen.', 0, 10000, 120),
  ('ai_max_items',       15,   'Aufgaben pro Blatt (höchstens)',   'Stück',    '', 5, 30, 130),
  ('ai_test_sentences',  20,   'Sätze pro Test (höchstens)',       'Stück',    '', 1, 60, 140)
on conflict (key) do update
  set label = excluded.label, unit = excluded.unit, hint = excluded.hint,
      min_value = excluded.min_value, max_value = excluded.max_value, sort = excluded.sort;

create or replace function public._pls(p_key text)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select value from public.plus_settings where key = p_key), 0);
$$;

-- ----------------------------------------------------------------------------
-- 2. Plus pro Person
-- ----------------------------------------------------------------------------

alter table public.profiles add column if not exists plus_until timestamptz;
alter table public.profiles add column if not exists plus_trial_used boolean not null default false;
alter table public.shop_items add column if not exists plus_only boolean not null default false;

-- Admins haben Plus immer (zum Ausprobieren).
create or replace function public._plus_active(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select (p.plus_until > now()) or p.role = 'admin' from public.profiles p where p.id = p_user and not p.blocked), false);
$$;

-- Ohne Plus: Plus-Designs ausziehen.
create or replace function public._plus_sync(p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if public._plus_active(p_user) then
    return;
  end if;
  update public.profiles p
     set avatar_id = case when p.avatar_id in (select id from public.shop_items where plus_only) then null else p.avatar_id end,
         color_id  = case when p.color_id  in (select id from public.shop_items where plus_only) then null else p.color_id end,
         effect_id = case when p.effect_id in (select id from public.shop_items where plus_only) then null else p.effect_id end,
         theme_id  = case when p.theme_id  in (select id from public.shop_items where plus_only) then null else p.theme_id end,
         tag_id    = case when p.tag_id    in (select id from public.shop_items where plus_only) then null else p.tag_id end
   where p.id = p_user
     and (p.avatar_id in (select id from public.shop_items where plus_only)
       or p.color_id  in (select id from public.shop_items where plus_only)
       or p.effect_id in (select id from public.shop_items where plus_only)
       or p.theme_id  in (select id from public.shop_items where plus_only)
       or p.tag_id    in (select id from public.shop_items where plus_only));
end;
$$;

-- Mit Plus: das „+“-Tag gibt es gleich dazu, wenn noch keins getragen wird.
create or replace function public._plus_apply_perks(p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if public._plus_active(p_user) and exists (select 1 from public.shop_items where id = 'tag_plus') then
    update public.profiles set tag_id = 'tag_plus' where id = p_user and tag_id is null;
  end if;
end;
$$;

-- Online-Signal räumt abgelaufene Plus-Designs mit auf.
create or replace function public.heartbeat(p_activity text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
begin
  if v_me is null or public.is_blocked() then
    return;
  end if;
  update public.profiles
     set online_since = case when last_seen_at is null or last_seen_at < now() - interval '3 minutes' then now() else online_since end,
         activity_at = case when activity is distinct from nullif(left(regexp_replace(lower(coalesce(p_activity, '')), '[^a-z_]', '', 'g'), 20), '') then now() else activity_at end,
         activity = nullif(left(regexp_replace(lower(coalesce(p_activity, '')), '[^a-z_]', '', 'g'), 20), ''),
         last_seen_at = now()
   where id = v_me;
  perform public._plus_sync(v_me);
end;
$$;

-- Anfragen („Plus anfordern“), Verkäufe/Vergaben, manuelle Verdienst-Buchungen
create table if not exists public.plus_requests (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.plus_requests enable row level security;
revoke all on public.plus_requests from anon, authenticated;

create table if not exists public.plus_sales (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users (id) on delete set null,
  kind text not null check (kind in ('paid', 'gift', 'coins')),
  cents integer not null default 0 check (cents >= 0),
  days integer not null check (days between 1 and 365),
  note text not null default '' check (char_length(note) <= 200),
  created_at timestamptz not null default now()
);
create index if not exists plus_sales_created_idx on public.plus_sales (created_at desc);
alter table public.plus_sales enable row level security;
revoke all on public.plus_sales from anon, authenticated;

create table if not exists public.goal_entries (
  id bigint generated always as identity primary key,
  cents integer not null check (cents between -1000000 and 1000000 and cents <> 0),
  note text not null default '' check (char_length(note) <= 200),
  created_at timestamptz not null default now()
);
alter table public.goal_entries enable row level security;
revoke all on public.goal_entries from anon, authenticated;

-- ----------------------------------------------------------------------------
-- 3. KI: Status, Verbrauch, Blätter, Satz-Zwischenspeicher, Ergebnisse
-- ----------------------------------------------------------------------------

create table if not exists public.ai_status (
  id boolean primary key default true check (id),
  state text not null default 'no_key' check (state in ('no_key', 'ok', 'empty', 'error')),
  message text not null default '',
  updated_at timestamptz not null default now()
);
insert into public.ai_status (id) values (true) on conflict do nothing;
alter table public.ai_status enable row level security;
revoke all on public.ai_status from anon, authenticated;

create table if not exists public.ai_usage (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users (id) on delete set null,
  kind text not null check (kind in ('grammar', 'sentences')),
  tokens_in integer not null default 0,
  tokens_out integer not null default 0,
  cost_micro bigint not null default 0,   -- Millionstel Euro
  ok boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists ai_usage_user_idx on public.ai_usage (user_id, created_at desc);
create index if not exists ai_usage_created_idx on public.ai_usage (created_at desc);
alter table public.ai_usage enable row level security;
revoke all on public.ai_usage from anon, authenticated;

create table if not exists public.ai_grammar_sets (
  id uuid primary key default gen_random_uuid(),
  language text not null check (language in ('en', 'fr')),
  grade integer not null check (grade between 5 and 13),
  topic_key text not null check (topic_key ~ '^[a-z0-9_]{1,60}$'),
  topic text not null check (char_length(topic) between 2 and 80),
  level text not null check (level in ('einfach', 'mittel', 'schwer')),
  title text not null check (char_length(title) between 2 and 120),
  items jsonb not null check (jsonb_typeof(items) = 'array' and jsonb_array_length(items) between 1 and 40),
  created_by uuid references auth.users (id) on delete set null,
  uses integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists ai_grammar_sets_find_idx on public.ai_grammar_sets (language, grade, topic_key, level, created_at desc);
alter table public.ai_grammar_sets enable row level security;
revoke all on public.ai_grammar_sets from anon, authenticated;

create table if not exists public.ai_vocab_sentences (
  key text primary key,
  language text not null,
  level text not null,
  item jsonb not null,
  uses integer not null default 0,
  created_at timestamptz not null default now()
);
alter table public.ai_vocab_sentences enable row level security;
revoke all on public.ai_vocab_sentences from anon, authenticated;

create table if not exists public.ai_results (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('grammar', 'test')),
  title text not null check (char_length(title) between 1 and 160),
  ref uuid,
  language text not null default '',
  level text not null default '',
  score integer not null check (score >= 0),
  total integer not null check (total >= 1),
  payload jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists ai_results_user_idx on public.ai_results (user_id, kind, created_at desc);
alter table public.ai_results enable row level security;
revoke all on public.ai_results from anon, authenticated;

-- ----------------------------------------------------------------------------
-- 4. Verdienst-Ziel: Druck-Umsatz + Plus-Verkäufe + manuelle Buchungen − KI-Kosten
-- ----------------------------------------------------------------------------

create or replace function public._ai_cost_cents()
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select round(coalesce(sum(cost_micro), 0) / 10000.0)::bigint from public.ai_usage;
$$;

create or replace function public._goal_total_cents()
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select public._print_delivered_cents()
       + coalesce((select sum(cents) from public.plus_sales), 0)
       + coalesce((select sum(cents) from public.goal_entries), 0)
       - public._ai_cost_cents();
$$;

create or replace function public.print_get_goal()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_goal integer := round(public._ps('goal_eur') * 100)::integer;
  v_earned bigint;
begin
  if (select auth.uid()) is null then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  if public._ps('goal_visible') < 1 and not public.is_admin() then
    return jsonb_build_object('visible', false);
  end if;
  v_earned := public._goal_total_cents() + round(public._ps('goal_offset_eur') * 100);
  return jsonb_build_object(
    'visible', public._ps('goal_visible') >= 1,
    'goal_cents', v_goal,
    'earned_cents', greatest(v_earned, 0),
    'percent', case when v_goal > 0 then round(greatest(v_earned, 0) * 100.0 / v_goal, 1) else 0 end);
end;
$$;

create or replace function public.admin_print_goal_reset()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._require_admin();
  update public.print_settings set value = -(public._goal_total_cents() / 100.0) where key = 'goal_offset_eur';
end;
$$;

-- Aufschlüsselung für den Admin
create or replace function public.admin_goal_breakdown()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public._require_admin();
  return jsonb_build_object(
    'print_cents', public._print_delivered_cents(),
    'plus_cents', coalesce((select sum(cents) from public.plus_sales), 0),
    'manual_cents', coalesce((select sum(cents) from public.goal_entries), 0),
    'ai_cost_cents', public._ai_cost_cents(),
    'offset_cents', round(public._ps('goal_offset_eur') * 100),
    'total_cents', public._goal_total_cents() + round(public._ps('goal_offset_eur') * 100),
    'goal_cents', round(public._ps('goal_eur') * 100),
    'entries', coalesce((select jsonb_agg(to_jsonb(e) order by e.id desc) from (select id, cents, note, created_at from public.goal_entries order by id desc limit 50) e), '[]'::jsonb));
end;
$$;

create or replace function public.admin_goal_add(p_cents integer, p_note text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._require_admin();
  if p_cents is null or p_cents = 0 or p_cents < -1000000 or p_cents > 1000000 then
    raise exception 'Der Betrag darf nicht 0 sein.' using errcode = '22023';
  end if;
  insert into public.goal_entries (cents, note) values (p_cents, left(btrim(coalesce(p_note, '')), 200));
end;
$$;

create or replace function public.admin_goal_delete(p_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._require_admin();
  delete from public.goal_entries where id = p_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- 5. Plus: Kunden-Funktionen
-- ----------------------------------------------------------------------------

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
    'is_admin', p.role = 'admin',
    'trial_available', public._pls('plus_coin_enabled') >= 1 and not p.plus_trial_used,
    'requested', exists (select 1 from public.plus_requests r where r.user_id = v_me),
    'price_cents', round(public._pls('plus_price_eur') * 100),
    'days', public._pls('plus_days'),
    'coin_price', public._pls('plus_coin_price'),
    'coin_days', public._pls('plus_coin_days'),
    'ai_enabled', public._pls('ai_enabled') >= 1,
    'ai_state', s.state,
    'ai_message', s.message,
    'max_items', public._pls('ai_max_items'),
    'test_sentences', public._pls('ai_test_sentences'));
end;
$$;

create or replace function public.plus_request()
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
  insert into public.plus_requests (user_id) values (v_me) on conflict do nothing;
end;
$$;

create or replace function public.plus_cancel_request()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.plus_requests where user_id = (select auth.uid());
$$;

-- Einmalig: ein Tag Plus für Coins.
create or replace function public.plus_buy_day()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  p public.profiles;
  v_days integer := public._pls('plus_coin_days')::integer;
  v_price bigint := public._pls('plus_coin_price')::bigint;
  v_until timestamptz;
begin
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  if public._pls('plus_coin_enabled') < 1 then
    raise exception 'Das gibt es gerade nicht.' using errcode = '42501';
  end if;
  select * into p from public.profiles where id = v_me for update;
  if p.plus_trial_used then
    raise exception 'Den Tag für Coins hast du schon genutzt.' using errcode = '23505';
  end if;
  perform public._grant_koins(v_me, -v_price, 'plus_day', null);
  v_until := greatest(coalesce(p.plus_until, now()), now()) + make_interval(days => v_days);
  update public.profiles set plus_until = v_until, plus_trial_used = true where id = v_me;
  insert into public.plus_sales (user_id, kind, cents, days, note) values (v_me, 'coins', 0, v_days, format('%s Coins', v_price));
  delete from public.plus_requests where user_id = v_me;
  perform public._plus_apply_perks(v_me);
  return public.plus_status();
end;
$$;

-- ----------------------------------------------------------------------------
-- 6. Plus: Admin
-- ----------------------------------------------------------------------------

create or replace function public.admin_plus_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  s public.ai_status;
  v_month timestamptz := (date_trunc('month', timezone('Europe/Berlin', now())) at time zone 'Europe/Berlin');
begin
  perform public._require_admin();
  select * into s from public.ai_status where id;
  return jsonb_build_object(
    'requests', coalesce((select jsonb_agg(jsonb_build_object('user_id', r.user_id, 'name', p.display_name, 'created_at', r.created_at, 'plus_until', p.plus_until) order by r.created_at)
                            from public.plus_requests r join public.profiles p on p.id = r.user_id), '[]'::jsonb),
    'active', coalesce((select jsonb_agg(jsonb_build_object('user_id', p.id, 'name', p.display_name, 'until', p.plus_until) order by p.plus_until)
                          from public.profiles p where p.plus_until > now()), '[]'::jsonb),
    'sales', coalesce((select jsonb_agg(x order by (x ->> 'id')::bigint desc) from (
                select jsonb_build_object('id', l.id, 'user_id', l.user_id, 'name', coalesce(p.display_name, 'gelöscht'), 'kind', l.kind,
                       'cents', l.cents, 'days', l.days, 'note', l.note, 'created_at', l.created_at) x
                  from public.plus_sales l left join public.profiles p on p.id = l.user_id
                 order by l.id desc limit 50) q), '[]'::jsonb),
    'ai', jsonb_build_object(
      'state', s.state, 'message', s.message, 'updated_at', s.updated_at,
      'month_cost_cents', round(coalesce((select sum(cost_micro) from public.ai_usage where created_at >= v_month), 0) / 10000.0, 2),
      'month_generations', (select count(*) from public.ai_usage where created_at >= v_month and ok),
      'month_tokens', coalesce((select sum(tokens_in + tokens_out) from public.ai_usage where created_at >= v_month), 0),
      'sets', (select count(*) from public.ai_grammar_sets),
      'sentences', (select count(*) from public.ai_vocab_sentences)));
end;
$$;

create or replace function public.admin_plus_counts()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public._require_admin();
  return jsonb_build_object(
    'requests', (select count(*) from public.plus_requests),
    'ai_problem', (select state <> 'ok' from public.ai_status where id));
end;
$$;

create or replace function public.admin_plus_grant(p_user uuid, p_days integer, p_paid_cents integer, p_note text default '')
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_until timestamptz;
  v_paid integer := coalesce(p_paid_cents, 0);
begin
  perform public._require_admin();
  if p_days is null or p_days < 1 or p_days > 365 then
    raise exception 'Die Dauer muss zwischen 1 und 365 Tagen liegen.' using errcode = '22023';
  end if;
  if v_paid < 0 or v_paid > 100000 then
    raise exception 'Der Betrag ist ungültig.' using errcode = '22023';
  end if;
  update public.profiles
     set plus_until = greatest(coalesce(plus_until, now()), now()) + make_interval(days => p_days)
   where id = p_user and not blocked
   returning plus_until into v_until;
  if v_until is null then
    raise exception 'Person nicht gefunden.' using errcode = 'P0002';
  end if;
  insert into public.plus_sales (user_id, kind, cents, days, note)
  values (p_user, case when v_paid > 0 then 'paid' else 'gift' end, v_paid, p_days, left(btrim(coalesce(p_note, '')), 200));
  delete from public.plus_requests where user_id = p_user;
  perform public._plus_apply_perks(p_user);
  insert into public.user_messages (user_id, from_id, body)
  values (p_user, (select auth.uid()), format('Du hast jetzt Vokabeltrainer + bis %s. Viel Spaß!', to_char(v_until at time zone 'Europe/Berlin', 'DD.MM.YYYY')));
  return v_until;
end;
$$;

create or replace function public.admin_plus_reject(p_user uuid, p_note text default '')
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._require_admin();
  delete from public.plus_requests where user_id = p_user;
  insert into public.user_messages (user_id, from_id, body)
  values (p_user, (select auth.uid()), left('Deine Anfrage für Vokabeltrainer + wurde nicht angenommen.' || case when btrim(coalesce(p_note, '')) <> '' then ' ' || btrim(p_note) else '' end, 1000));
end;
$$;

create or replace function public.admin_plus_revoke(p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._require_admin();
  update public.profiles set plus_until = least(plus_until, now()) where id = p_user;
  perform public._plus_sync(p_user);
end;
$$;

-- Verkauf/Vergabe rückgängig (z. B. aus Versehen bestätigt): Verdienst und Laufzeit werden zurückgenommen.
create or replace function public.admin_plus_undo_sale(p_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  l public.plus_sales;
  v_new timestamptz;
begin
  perform public._require_admin();
  select * into l from public.plus_sales where id = p_id for update;
  if not found then
    raise exception 'Eintrag nicht gefunden.' using errcode = 'P0002';
  end if;
  delete from public.plus_sales where id = l.id;
  if l.user_id is not null then
    update public.profiles
       set plus_until = plus_until - make_interval(days => l.days),
           plus_trial_used = case when l.kind = 'coins' then false else plus_trial_used end
     where id = l.user_id and plus_until is not null
     returning plus_until into v_new;
    if l.kind = 'coins' then
      perform public._grant_koins(l.user_id, public._pls('plus_coin_price')::bigint, 'plus_refund', l.id::text);
    end if;
    perform public._plus_sync(l.user_id);
  end if;
end;
$$;

create or replace function public.admin_plus_get_settings()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public._require_admin();
  return coalesce((select jsonb_agg(to_jsonb(s) order by s.sort) from public.plus_settings s), '[]'::jsonb);
end;
$$;

create or replace function public.admin_plus_set_setting(p_key text, p_value numeric)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.plus_settings;
begin
  perform public._require_admin();
  select * into s from public.plus_settings where key = p_key;
  if not found then
    raise exception 'Unbekannte Einstellung.' using errcode = 'P0002';
  end if;
  if p_value is null or p_value < s.min_value or p_value > s.max_value then
    raise exception '% muss zwischen % und % liegen.', s.label, s.min_value, s.max_value using errcode = '22023';
  end if;
  update public.plus_settings set value = p_value where key = p_key;
end;
$$;

-- ----------------------------------------------------------------------------
-- 7. Shop: Plus-Designs (kostenlos mit Plus, sonst gesperrt)
-- ----------------------------------------------------------------------------

drop function if exists public.get_shop();
create function public.get_shop()
returns table (id text, kind text, name text, price integer, sort integer, owned boolean, equipped boolean,
               required_role text, active boolean, custom boolean, style jsonb, svg text, plus_only boolean)
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
         i.required_role, i.active, i.custom, i.style, i.svg, i.plus_only
    from public.shop_items i
    left join public.user_items o on o.item_id = i.id and o.user_id = (select auth.uid())
   where (select auth.uid()) is not null
     and (i.active or o.item_id is not null)
     and (i.required_role is null
          or public._role_rank(i.required_role) <= public._role_rank(
               (select p.role from public.profiles p where p.id = (select auth.uid()))))
   order by i.kind, i.sort, i.name;
$$;

-- (buy_item bleibt unverändert: Plus-Artikel kosten 0 und gelten als „gehört dir schon“; die App zeigt dafür den Plus-Hinweis.)

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
  v_plus boolean;
  v_owned boolean;
begin
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  select kind, price, required_role, active, plus_only into v_kind, v_price, v_req, v_active, v_plus
    from public.shop_items where id = p_item_id;
  v_owned := exists (select 1 from public.user_items where user_id = v_me and item_id = p_item_id);
  if v_kind is null or not (v_active or v_owned) then
    raise exception 'Artikel nicht gefunden.' using errcode = 'P0002';
  end if;
  if v_plus and not public._plus_active(v_me) then
    raise exception 'Das gibt es nur mit Vokabeltrainer +.' using errcode = '42501';
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

insert into public.shop_items (id, kind, name, price, sort, plus_only) values
  ('tag_plus',            'tag',    '+',                  0, 5,  true),
  ('color_plus_nordlicht','color',  'Plus Nordlicht',     0, 900, true),
  ('color_plus_rosegold', 'color',  'Plus Roségold',      0, 910, true),
  ('color_plus_eis',      'color',  'Plus Eis',           0, 920, true),
  ('effect_plus_glanz',   'effect', 'Plus Glanz',         0, 900, true),
  ('theme_plus_mitternacht','theme','Plus Mitternacht',   0, 900, true),
  ('theme_plus_glut',     'theme',  'Plus Glut',          0, 910, true),
  ('avatar_plus_stern',   'avatar', 'Plus-Stern',         0, 900, true),
  ('avatar_plus_kristall','avatar', 'Plus-Kristall',      0, 910, true)
on conflict (id) do update set name = excluded.name, plus_only = true, kind = excluded.kind;

-- ----------------------------------------------------------------------------
-- 8. KI: nur über die Edge Function (service_role)
-- ----------------------------------------------------------------------------

-- Darf diese Person jetzt etwas erzeugen? (prüft Plus, Schalter, Tages- und Monatsgrenzen)
create or replace function public.ai_begin(p_user uuid, p_kind text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_month timestamptz := (date_trunc('month', timezone('Europe/Berlin', now())) at time zone 'Europe/Berlin');
  v_day timestamptz := (date_trunc('day', timezone('Europe/Berlin', now())) at time zone 'Europe/Berlin');
  v_admin boolean := coalesce((select role = 'admin' from public.profiles where id = p_user), false);
begin
  if p_kind not in ('grammar', 'sentences') then
    raise exception 'Ungültige Art.' using errcode = '22023';
  end if;
  if not public._plus_active(p_user) then
    return jsonb_build_object('ok', false, 'code', 'no_plus');
  end if;
  if public._pls('ai_enabled') < 1 then
    return jsonb_build_object('ok', false, 'code', 'disabled');
  end if;
  if (select coalesce(sum(cost_micro), 0) from public.ai_usage where created_at >= v_month) >= public._pls('ai_global_month_eur') * 1000000 then
    return jsonb_build_object('ok', false, 'code', 'global_budget');
  end if;
  if not v_admin then
    if (select count(*) from public.ai_usage where user_id = p_user and ok and created_at >= v_day) >= public._pls('ai_user_day_gens') then
      return jsonb_build_object('ok', false, 'code', 'user_day');
    end if;
    if (select coalesce(sum(cost_micro), 0) from public.ai_usage where user_id = p_user and created_at >= v_month) >= public._pls('ai_user_month_eur') * 1000000 then
      return jsonb_build_object('ok', false, 'code', 'user_budget');
    end if;
  end if;
  return jsonb_build_object('ok', true, 'max_items', public._pls('ai_max_items'), 'max_sentences', public._pls('ai_test_sentences'));
end;
$$;

create or replace function public.ai_set_status(p_state text, p_message text default '')
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_state not in ('no_key', 'ok', 'empty', 'error') then
    raise exception 'Ungültiger Status.' using errcode = '22023';
  end if;
  update public.ai_status set state = p_state, message = left(coalesce(p_message, ''), 300), updated_at = now() where id;
end;
$$;

-- Verbrauch buchen; Kosten in Millionstel Euro aus Tokens und den Modellpreisen
create or replace function public.ai_record_usage(p_user uuid, p_kind text, p_in integer, p_out integer, p_ok boolean)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_in integer := greatest(coalesce(p_in, 0), 0);
  v_out integer := greatest(coalesce(p_out, 0), 0);
  v_micro bigint;
begin
  v_micro := round((v_in * public._pls('ai_usd_in') + v_out * public._pls('ai_usd_out')) * public._pls('ai_usd_eur'))::bigint;
  insert into public.ai_usage (user_id, kind, tokens_in, tokens_out, cost_micro, ok)
  values (p_user, p_kind, v_in, v_out, v_micro, coalesce(p_ok, true));
  return v_micro;
end;
$$;

create or replace function public.ai_save_grammar_set(p_user uuid, p_language text, p_grade integer, p_topic_key text, p_topic text, p_level text, p_title text, p_items jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  insert into public.ai_grammar_sets (language, grade, topic_key, topic, level, title, items, created_by)
  values (p_language, p_grade, p_topic_key, left(p_topic, 80), p_level, left(p_title, 120), p_items, p_user)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.ai_get_vocab_sentences(p_keys text[])
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_object_agg(key, item), '{}'::jsonb) from public.ai_vocab_sentences where key = any (p_keys);
$$;

create or replace function public.ai_save_vocab_sentences(p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  r jsonb;
  n integer := 0;
begin
  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    insert into public.ai_vocab_sentences (key, language, level, item)
    values (left(r ->> 'key', 300), r ->> 'language', r ->> 'level', r -> 'item')
    on conflict (key) do nothing;
    n := n + 1;
  end loop;
  return n;
end;
$$;

create or replace function public.ai_touch_vocab_sentences(p_keys text[])
returns void
language sql
security definer
set search_path = public
as $$
  update public.ai_vocab_sentences set uses = uses + 1 where key = any (p_keys);
$$;

-- ----------------------------------------------------------------------------
-- 9. KI: Blätter ansehen (nur mit Plus) und eigene Ergebnisse
-- ----------------------------------------------------------------------------

create or replace function public.ai_list_sets(p_language text, p_grade integer, p_topic_key text default null, p_level text default null)
returns table (id uuid, title text, topic text, topic_key text, level text, grade integer, items integer, uses integer, created_at timestamptz, mine boolean)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if (select auth.uid()) is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  if not public._plus_active((select auth.uid())) then
    raise exception 'Dafür brauchst du Vokabeltrainer +.' using errcode = '42501';
  end if;
  return query
  select s.id, s.title, s.topic, s.topic_key, s.level, s.grade, jsonb_array_length(s.items), s.uses, s.created_at, s.created_by = (select auth.uid())
    from public.ai_grammar_sets s
   where s.language = p_language and s.grade = p_grade
     and (p_topic_key is null or s.topic_key = p_topic_key)
     and (p_level is null or s.level = p_level)
   order by s.created_at desc
   limit 60;
end;
$$;

create or replace function public.ai_get_set(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.ai_grammar_sets;
begin
  if (select auth.uid()) is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  if not public._plus_active((select auth.uid())) then
    raise exception 'Dafür brauchst du Vokabeltrainer +.' using errcode = '42501';
  end if;
  update public.ai_grammar_sets set uses = uses + 1 where id = p_id returning * into s;
  if not found then
    raise exception 'Blatt nicht gefunden.' using errcode = 'P0002';
  end if;
  return jsonb_build_object('id', s.id, 'title', s.title, 'topic', s.topic, 'topic_key', s.topic_key, 'level', s.level,
                            'grade', s.grade, 'language', s.language, 'items', s.items, 'created_at', s.created_at);
end;
$$;

create or replace function public.ai_save_result(p_kind text, p_title text, p_ref uuid, p_language text, p_level text, p_score integer, p_total integer, p_payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  v_id uuid;
begin
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  if p_kind not in ('grammar', 'test') then
    raise exception 'Ungültige Art.' using errcode = '22023';
  end if;
  if p_kind = 'grammar' and not public._plus_active(v_me) then
    raise exception 'Dafür brauchst du Vokabeltrainer +.' using errcode = '42501';
  end if;
  if p_total is null or p_total < 1 or p_score is null or p_score < 0 or p_score > p_total then
    raise exception 'Ungültiges Ergebnis.' using errcode = '22023';
  end if;
  if p_payload is null or pg_column_size(p_payload) > 200000 then
    raise exception 'Das Ergebnis ist zu groß.' using errcode = '22023';
  end if;
  insert into public.ai_results (user_id, kind, title, ref, language, level, score, total, payload)
  values (v_me, p_kind, left(btrim(coalesce(p_title, '')), 160), p_ref, left(coalesce(p_language, ''), 10), left(coalesce(p_level, ''), 20), p_score, p_total, p_payload)
  returning id into v_id;
  -- höchstens 100 gespeicherte Ergebnisse je Art
  delete from public.ai_results
   where user_id = v_me and kind = p_kind
     and id in (select r.id from public.ai_results r where r.user_id = v_me and r.kind = p_kind order by r.created_at desc offset 100);
  return v_id;
end;
$$;

create or replace function public.ai_my_results(p_kind text)
returns table (id uuid, kind text, title text, language text, level text, score integer, total integer, created_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select r.id, r.kind, r.title, r.language, r.level, r.score, r.total, r.created_at
    from public.ai_results r
   where r.user_id = (select auth.uid()) and r.kind = p_kind
   order by r.created_at desc
   limit 100;
$$;

create or replace function public.ai_get_result(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  r public.ai_results;
begin
  select * into r from public.ai_results where id = p_id and user_id = (select auth.uid());
  if not found then
    raise exception 'Ergebnis nicht gefunden.' using errcode = 'P0002';
  end if;
  return jsonb_build_object('id', r.id, 'kind', r.kind, 'title', r.title, 'ref', r.ref, 'language', r.language, 'level', r.level,
                            'score', r.score, 'total', r.total, 'payload', r.payload, 'created_at', r.created_at);
end;
$$;

create or replace function public.ai_delete_result(p_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.ai_results where id = p_id and user_id = (select auth.uid());
$$;

-- ----------------------------------------------------------------------------
-- 10. Rechte
-- ----------------------------------------------------------------------------

do $$
declare
  r record;
  has_service boolean := exists (select 1 from pg_roles where rolname = 'service_role');
begin
  for r in
    select p.oid::regprocedure as sig, p.proname
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in (
         'plus_status', 'plus_request', 'plus_cancel_request', 'plus_buy_day', 'heartbeat',
         'admin_plus_overview', 'admin_plus_counts', 'admin_plus_grant', 'admin_plus_reject', 'admin_plus_revoke',
         'admin_plus_undo_sale', 'admin_plus_get_settings', 'admin_plus_set_setting',
         'admin_goal_breakdown', 'admin_goal_add', 'admin_goal_delete', 'print_get_goal', 'admin_print_goal_reset',
         'get_shop', 'equip_item',
         'ai_list_sets', 'ai_get_set', 'ai_save_result', 'ai_my_results', 'ai_get_result', 'ai_delete_result')
  loop
    execute format('revoke all on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;

  -- nur die Edge Function
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('ai_begin', 'ai_set_status', 'ai_record_usage', 'ai_save_grammar_set',
                         'ai_get_vocab_sentences', 'ai_save_vocab_sentences', 'ai_touch_vocab_sentences')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    if has_service then
      execute format('grant execute on function %s to service_role', r.sig);
    end if;
  end loop;

  -- interne Helfer: niemand direkt
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('_pls', '_plus_active', '_plus_sync', '_plus_apply_perks', '_ai_cost_cents', '_goal_total_cents')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
  end loop;
end;
$$;
