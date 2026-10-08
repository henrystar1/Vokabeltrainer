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
