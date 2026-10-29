-- 0058: Tageslimit für Parkour-Nachrichten (Supabase-Realtime-Kontingent) und mehr Sprünge pro Person. Wiederholbar.
--  * parkour_usage: je Tag (Berliner Zeit) die Zahl der Realtime-Nachrichten, die Spielende melden (gesendet + empfangen = so zählt Supabase).
--  * Einstellung parkour_msg_limit_k = Limit in Tausend Nachrichten pro Tag (0 = kein Limit). Änderbar unter Verwaltung → Regeln.
--  * parkour_jumps: Admin gibt einer Person mehr Sprünge (insgesamt 3 bis 10; Standard ist 2 = Doppelsprung).
create table if not exists public.parkour_usage (
  day date primary key,
  msgs bigint not null default 0
);
alter table public.parkour_usage enable row level security;
revoke all on public.parkour_usage from anon, authenticated;

create table if not exists public.parkour_jumps (
  user_id uuid primary key references auth.users (id) on delete cascade,
  jumps integer not null check (jumps between 3 and 10),
  set_by uuid,
  created_at timestamptz not null default now()
);
alter table public.parkour_jumps enable row level security;
revoke all on public.parkour_jumps from anon, authenticated;

-- Standard: 60 000 Nachrichten pro Tag (≈ 1,8 Mio. im Monat, das Free-Kontingent von Supabase sind 2,2 Mio.)
insert into public.app_settings (key, value, mod_editable) values ('parkour_msg_limit_k', 60, false)
on conflict (key) do nothing;

create or replace function public._parkour_usage_state(p_msgs bigint)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'msgs', p_msgs,
    'limit', public.setting('parkour_msg_limit_k')::bigint * 1000,
    'blocked', public.setting('parkour_msg_limit_k') > 0 and p_msgs >= public.setting('parkour_msg_limit_k')::bigint * 1000
  );
$$;

-- Verbrauch melden (Spielende rufen das alle paar Sekunden mit ihren neuen Nachrichten auf) und Stand zurückbekommen.
create or replace function public.parkour_usage_add(p_n integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_msgs bigint;
begin
  if (select auth.uid()) is null then
    raise exception 'Nicht angemeldet.' using errcode = '42501';
  end if;
  insert into public.parkour_usage (day, msgs)
  values ((now() at time zone 'Europe/Berlin')::date, greatest(0, least(coalesce(p_n, 0), 30000)))
  on conflict (day) do update set msgs = public.parkour_usage.msgs + excluded.msgs
  returning msgs into v_msgs;
  return public._parkour_usage_state(v_msgs);
end;
$$;

create or replace function public.parkour_usage_get()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'Nicht angemeldet.' using errcode = '42501';
  end if;
  return public._parkour_usage_state(coalesce((select msgs from public.parkour_usage where day = (now() at time zone 'Europe/Berlin')::date), 0));
end;
$$;

-- Sprünge insgesamt je Person ({user_id: anzahl}); jede angemeldete Person darf fragen.
create or replace function public.parkour_jumps_list(p_ids uuid[])
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_object_agg(j.user_id::text, j.jumps), '{}'::jsonb)
    from public.parkour_jumps j
   where j.user_id = any (coalesce(p_ids, '{}'::uuid[]))
     and (select auth.uid()) is not null;
$$;

create or replace function public.parkour_jumps_set(p_user uuid, p_jumps integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if (select auth.uid()) is null or not public.is_admin() then
    raise exception 'Nur Admins dürfen das.' using errcode = '42501';
  end if;
  if p_jumps is null or p_jumps <= 2 then
    delete from public.parkour_jumps where user_id = p_user;
  else
    insert into public.parkour_jumps (user_id, jumps, set_by) values (p_user, least(p_jumps, 10), (select auth.uid()))
    on conflict (user_id) do update set jumps = excluded.jumps, set_by = excluded.set_by;
  end if;
end;
$$;

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig, p.proname
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('_parkour_usage_state', 'parkour_usage_add', 'parkour_usage_get', 'parkour_jumps_list', 'parkour_jumps_set')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    if r.proname <> '_parkour_usage_state' then
      execute format('grant execute on function %s to authenticated', r.sig);
    end if;
  end loop;
end;
$$;
