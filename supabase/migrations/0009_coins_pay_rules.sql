-- 0009: Coins verschicken (!pay im Chat), einstellbare Punkteregeln, neue Shop-Artikel (Schwarzes-Loch-Set u. a.).
-- Wiederholbar. Nach 0008 ausführen.

-- ----------------------------------------------------------------------------
-- 1. Einstellungen: neue Zahlen, und welche davon Mods ändern dürfen
-- ----------------------------------------------------------------------------

alter table public.app_settings add column if not exists mod_editable boolean not null default false;

insert into public.app_settings (key, value, mod_editable) values
  ('points_per_answer', 2, true),        -- Rangliste: Punkte je richtiger Antwort
  ('points_daily_cap', 200, true),       -- Rangliste: höchstens so viele richtige Antworten pro Tag zählen
  ('points_active_day', 25, true),       -- Rangliste: Bonus für jeden aktiven Tag
  ('points_accuracy_bonus', 20, true),   -- Rangliste: maximaler Bonus für hohe Trefferquote
  ('points_accuracy_min', 20, true),     -- Rangliste: ab so vielen Antworten am Tag gibt es den Trefferquoten-Bonus
  ('chat_per_minute', 20, true),         -- Chat: höchstens so viele Nachrichten pro Minute und Person
  ('pay_max', 5000, false),              -- !pay: höchstens so viele Coins pro Überweisung
  ('pay_daily_cap', 10000, false)        -- !pay: höchstens so viele Coins pro Tag verschicken
on conflict (key) do nothing;

update public.app_settings set mod_editable = true where key in ('points_per_answer', 'points_daily_cap', 'points_active_day', 'points_accuracy_bonus', 'points_accuracy_min', 'chat_per_minute');

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
  if not public.is_admin() and not exists (select 1 from public.app_settings where key = p_key and mod_editable) then
    raise exception 'Diese Einstellung darf nur ein Admin ändern.' using errcode = '42501';
  end if;
  update public.app_settings set value = p_value where key = p_key;
  if not found then
    raise exception 'Unbekannte Einstellung.' using errcode = 'P0002';
  end if;
end;
$$;

-- ----------------------------------------------------------------------------
-- 2. Rangliste und Liga rechnen mit den einstellbaren Werten
-- ----------------------------------------------------------------------------

create or replace function public._day_points(p_correct integer, p_total integer)
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select (
    least(p_correct, public.setting('points_daily_cap')) * public.setting('points_per_answer')
    + case when p_total > 0 then public.setting('points_active_day') else 0 end
    + case when p_total >= greatest(public.setting('points_accuracy_min'), 1)
           then round(public.setting('points_accuracy_bonus')::numeric * p_correct / p_total)::int
           else 0 end
  )::bigint;
$$;

create or replace function public._week_points(p_user uuid, p_from date)
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(public._day_points(d.answers_correct, d.answers_total)), 0)::bigint
    from public.daily_stats d
   where d.user_id = p_user and d.day between p_from and p_from + 6;
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
  with scored as (
    select d.user_id as uid,
           sum(public._day_points(d.answers_correct, d.answers_total))::bigint as pts
      from public.daily_stats d
     where v_from is null or d.day >= v_from
     group by d.user_id
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
-- 3. Chat: Nachrichtenart und !pay
-- ----------------------------------------------------------------------------

alter table public.chat_messages add column if not exists kind text not null default 'text';
alter table public.chat_messages drop constraint if exists chat_messages_kind_check;
alter table public.chat_messages add constraint chat_messages_kind_check check (kind in ('text', 'pay'));

drop function if exists public.get_chat(integer);
create function public.get_chat(p_limit integer default 100)
returns table (id bigint, body text, created_at timestamptz, is_me boolean, display_name text,
               avatar_id text, color_id text, effect_id text, role text, tag_id text, theme_id text, kind text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if (select auth.uid()) is null or public.is_blocked() then
    raise exception 'Kein Zugriff.' using errcode = '42501';
  end if;
  return query
    select m.id, m.body, m.created_at, (m.user_id = (select auth.uid())), pr.display_name,
           pr.avatar_id, pr.color_id, pr.effect_id, pr.role, pr.tag_id, pr.theme_id, m.kind
      from (select * from public.chat_messages order by chat_messages.id desc limit least(greatest(coalesce(p_limit, 100), 1), 200)) m
      join public.profiles pr on pr.id = m.user_id
     order by m.id asc;
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
begin
  if v_me is null or public.is_blocked() then
    raise exception 'Kein Zugriff.' using errcode = '42501';
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

  if exists (select 1 from public.chat_messages where user_id = v_me and body = v_body and created_at > now() - interval '30 seconds') then
    raise exception 'Diese Nachricht hast du gerade schon gesendet.' using errcode = '22023';
  end if;
  insert into public.chat_messages (user_id, body) values (v_me, v_body) returning chat_messages.id into v_id;
  return v_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- 4. Wortlaut: Koins → Coins, neue Shop-Artikel
-- ----------------------------------------------------------------------------

update public.shop_items set name = replace(name, 'Koin', 'Coin') where name like '%Koin%';
update public.user_messages set body = replace(body, 'Koins', 'Coins') where body like '%Koins%';

insert into public.shop_items (id, kind, name, price, sort, required_role) values
  ('avatar_lava',    'avatar', 'Lavalampe',        1300, 250, null),
  ('avatar_matrix',  'avatar', 'Matrix',           1600, 260, null),
  ('avatar_aurora',  'avatar', 'Aurora',           1900, 270, null),
  ('avatar_eclipse', 'avatar', 'Sonnenfinsternis', 3500, 280, null),
  ('color_void',     'color',  'Ereignishorizont', 1500, 130, null),
  ('effect_vortex',  'effect', 'Wirbel',           3000, 140, null)
on conflict (id) do nothing;

-- ----------------------------------------------------------------------------
-- 5. Rechte
-- ----------------------------------------------------------------------------

do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('get_leaderboard', 'get_chat', 'post_chat', 'staff_set_setting')
  loop
    execute format('revoke all on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('_day_points', '_week_points')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
  end loop;
end;
$$;
