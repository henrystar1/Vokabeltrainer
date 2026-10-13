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
