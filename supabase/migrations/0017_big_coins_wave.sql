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
