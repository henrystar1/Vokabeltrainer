-- ============================================================================
-- 0020: Benachrichtigungen (kleine Hinweise am Rand): @-Erwähnungen im Chat, neue Chat-Nachrichten,
-- fertiger 3D-Druck, jemand kommt online, Nachrichten vom Team. Alles pro Nutzer einstellbar.
-- Dazu für Admins: was eine Person gerade macht (Lernen, Spielen, Chat …) und Nachrichten pro Person.
-- Wiederholbar. Nach 0019 ausführen.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Einstellungen
-- ----------------------------------------------------------------------------

alter table public.user_settings add column if not exists notify_mentions boolean not null default true;
alter table public.user_settings add column if not exists notify_chat boolean not null default false;
alter table public.user_settings add column if not exists notify_print boolean not null default true;
alter table public.user_settings add column if not exists notify_online text not null default 'off';
-- Nachrichten vom Team: als Fenster (wie bisher, erst nach Lernen/Spielen) oder als Hinweis am Rand, sofort.
alter table public.user_settings add column if not exists notify_dm text not null default 'window';
alter table public.user_settings drop constraint if exists user_settings_notify_dm_check;
alter table public.user_settings add constraint user_settings_notify_dm_check check (notify_dm in ('window', 'edge'));
alter table public.user_settings drop constraint if exists user_settings_notify_online_check;
alter table public.user_settings add constraint user_settings_notify_online_check check (notify_online in ('off', 'staff', 'all'));

-- ----------------------------------------------------------------------------
-- 2. „Kommt online“: Zeitpunkt, seit dem jemand durchgehend online ist
-- ----------------------------------------------------------------------------

alter table public.profiles add column if not exists online_since timestamptz;
alter table public.profiles add column if not exists activity text;
alter table public.profiles add column if not exists activity_at timestamptz;

-- Neue Fassung mit „was mache ich gerade“ (z. B. 'learn', 'games'); alte Aufrufe ohne Wert gehen weiter.
drop function if exists public.heartbeat();
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
end;
$$;

-- Nur Admins: wer ist online und was macht die Person gerade.
create or replace function public.admin_user_status()
returns table (user_id uuid, last_seen_at timestamptz, online boolean, activity text, activity_at timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public._require_admin();
  return query
  select p.id, p.last_seen_at, (p.last_seen_at > now() - interval '3 minutes'),
         case when p.last_seen_at > now() - interval '3 minutes' then p.activity end,
         case when p.last_seen_at > now() - interval '3 minutes' then p.activity_at end
    from public.profiles p
   where p.last_seen_at is not null;
end;
$$;

-- Nur Admins: bisher gesendete Nachrichten an eine Person.
create or replace function public.admin_list_messages_to(p_user uuid)
returns table (id uuid, body text, created_at timestamptz, read_at timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public._require_admin();
  return query
  select m.id, m.body, m.created_at, m.read_at
    from public.user_messages m
   where m.user_id = p_user and m.from_id is not null
   order by m.created_at desc
   limit 20;
end;
$$;

-- ----------------------------------------------------------------------------
-- 3. Druck fertig: Zeitpunkt merken; das große Hinweisfenster entfällt, wenn der kleine Hinweis aktiv ist
-- ----------------------------------------------------------------------------

alter table public.print_orders add column if not exists ready_at timestamptz;

create or replace function public._print_stamp_ready()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'lieferbereit' and old.status is distinct from 'lieferbereit' then
    new.ready_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists print_orders_stamp_ready on public.print_orders;
create trigger print_orders_stamp_ready
  before update on public.print_orders
  for each row execute function public._print_stamp_ready();

create or replace function public._print_notify(p_user uuid, p_body text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- „Fertig“-Meldung: wer den kleinen Hinweis eingeschaltet hat, bekommt kein zweites Fenster.
  if p_body like '%ist fertig und liegt zur Übergabe bereit.'
     and coalesce((select s.notify_print from public.user_settings s where s.user_id = p_user), true) then
    return;
  end if;
  insert into public.user_messages (user_id, from_id, body)
  values (p_user, (select auth.uid()), left(p_body, 1000));
end;
$$;

-- ----------------------------------------------------------------------------
-- 4. Abfrage neuer Ereignisse (wird alle paar Sekunden aufgerufen)
--    p_chat_after = null  → nur Startwerte (kein Nachrichten-Schwall beim Öffnen der App)
-- ----------------------------------------------------------------------------

create or replace function public.notify_poll(p_chat_after bigint, p_since timestamptz)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  v_name text;
  v_set public.user_settings%rowtype;
  v_pattern text;
  v_since timestamptz := coalesce(p_since, now());
  v_max bigint;
  v_chat jsonb := '[]'::jsonb;
  v_ready jsonb := '[]'::jsonb;
  v_online jsonb := '[]'::jsonb;
begin
  if v_me is null or public.is_blocked() then
    raise exception 'Kein Zugriff.' using errcode = '42501';
  end if;
  select * into v_set from public.user_settings where user_id = v_me;
  select display_name into v_name from public.profiles where id = v_me;

  select coalesce(max(c.id), 0) into v_max
    from public.chat_messages c
   where c.kind <> 'whisper' or c.user_id = v_me or c.recipient_id = v_me;

  if p_chat_after is not null and (coalesce(v_set.notify_mentions, true) or coalesce(v_set.notify_chat, false)) then
    v_pattern := '(^|[^[:alnum:]_])@' || regexp_replace(coalesce(v_name, ''), '([.^$*+?()\[\]{}|\\])', '\\\1', 'g') || '($|[^[:alnum:]_])';
    select coalesce(jsonb_agg(x order by (x ->> 'id')::bigint), '[]'::jsonb) into v_chat
      from (
        select jsonb_build_object(
                 'id', c.id,
                 'from', pr.display_name,
                 'body', left(c.body, 140),
                 'whisper', c.kind = 'whisper',
                 'mention', (c.kind = 'whisper' or c.body ~* v_pattern)) as x
          from public.chat_messages c
          join public.profiles pr on pr.id = c.user_id
         where c.id > p_chat_after
           and c.user_id <> v_me
           and c.kind <> 'pay'
           and (c.kind <> 'whisper' or c.recipient_id = v_me)
           and (coalesce(v_set.notify_chat, false)
                or (coalesce(v_set.notify_mentions, true) and (c.kind = 'whisper' or c.body ~* v_pattern)))
         order by c.id desc
         limit 10) t;
  end if;

  if coalesce(v_set.notify_print, true) then
    select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'title', o.title) order by o.ready_at), '[]'::jsonb) into v_ready
      from public.print_orders o
     where o.user_id = v_me and o.status = 'lieferbereit' and o.ready_at > v_since;
  end if;

  if coalesce(v_set.notify_online, 'off') <> 'off' then
    select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.display_name) order by p.online_since), '[]'::jsonb) into v_online
      from (
        select p.* from public.profiles p
         where p.id <> v_me
           and not p.blocked
           and not p.hide_presence
           and p.online_since > v_since
           and p.last_seen_at > now() - interval '3 minutes'
           and (v_set.notify_online = 'all' or (p.role in ('mod', 'admin') and not p.tags_hidden))
         order by p.online_since
         limit 5) p;
  end if;

  return jsonb_build_object('now', now(), 'chat_max', v_max, 'chat', v_chat, 'ready', v_ready, 'online', v_online);
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
     where n.nspname = 'public' and p.proname in ('notify_poll', 'heartbeat', 'admin_user_status', 'admin_list_messages_to', '_print_notify', '_print_stamp_ready')
  loop
    if r.proname in ('_print_notify', '_print_stamp_ready') then
      execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    else
      execute format('revoke all on function %s from public, anon', r.sig);
      execute format('grant execute on function %s to authenticated', r.sig);
    end if;
  end loop;
end;
$$;
