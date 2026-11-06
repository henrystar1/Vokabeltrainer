-- 0069: 1) Alle Menüpunkte lassen sich in Verwaltung → Sperren abschalten.
--       2) Heilen und Wiederbeleben im Parkour nur für ausgewählte Mods (Recht „heal“ je Mod). Wiederholbar.

-- ---------------------------------------------------------------------------
-- 1. Sperr-Schlüssel: eine Liste für alles
-- ---------------------------------------------------------------------------
create or replace function public._lock_keys()
returns text[]
language sql
immutable
set search_path = public
as $$
  select array['games', 'gambling', 'sprint', 'duels', 'chat', 'shop', 'quests', 'print',
               'parkour', 'learn', 'copy', 'cards', 'cram', 'test', 'practice', 'grammar', 'irregular', 'conjugate', 'gender',
               'books', 'search', 'math', 'memorize', 'homework', 'advent', 'ranking', 'stats', 'presence', 'websites', 'plus',
               'board', 'feedback'];
$$;

alter table public.feature_locks drop constraint if exists feature_locks_key_check;
alter table public.feature_locks add constraint feature_locks_key_check check (key = any (public._lock_keys()));

create or replace function public.get_locked_features()
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(k order by k), '{}'::text[])
    from unnest(public._lock_keys()) k
   where (select auth.uid()) is not null and public._feature_locked(k);
$$;

drop function if exists public.admin_get_feature_locks();
create function public.admin_get_feature_locks()
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
    from unnest(public._lock_keys()) k
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
  if not (p_key = any (public._lock_keys())) then
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

-- ---------------------------------------------------------------------------
-- 2. Recht „heal“ je Mod
-- ---------------------------------------------------------------------------
alter table public.staff_rights add column if not exists heal boolean not null default false;

create or replace function public.can_heal()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.is_admin(), false)
      or coalesce((select s.heal from public.staff_rights s where s.user_id = (select auth.uid())), false);
$$;

create or replace function public.my_run_perks()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object('spectate', public.can_spectate(), 'heal', public.can_heal(), 'look', public._staff_look((select auth.uid())),
                            'allowed', to_jsonb(public._allowed_looks((select auth.uid()))),
                            'entrance', (select pp.entrance from public.parkour_profiles pp where pp.user_id = (select auth.uid())))
   where (select auth.uid()) is not null;
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
    'spectate', coalesce((select spectate from public.staff_rights where user_id = p_user), false),
    'heal', coalesce((select heal from public.staff_rights where user_id = p_user), false),
    'looks', to_jsonb(coalesce((select looks from public.staff_rights where user_id = p_user), '{}'::text[])),
    'book_ids', coalesce((select jsonb_agg(book_id) from public.staff_book_access where user_id = p_user), '[]'::jsonb),
    'setting_keys', coalesce((select jsonb_agg(key) from public.staff_setting_access where user_id = p_user), '[]'::jsonb));
end;
$$;

create or replace function public.admin_set_staff_heal(p_user uuid, p_heal boolean)
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
  insert into public.staff_rights (user_id, heal) values (p_user, coalesce(p_heal, false))
  on conflict (user_id) do update set heal = excluded.heal;
end;
$$;

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig, p.proname
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('_lock_keys', 'get_locked_features', 'admin_get_feature_locks', 'admin_set_feature_lock',
                                                  'can_heal', 'my_run_perks', 'admin_get_staff_rights', 'admin_set_staff_heal')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    if r.proname not like '\_%' then
      execute format('grant execute on function %s to authenticated', r.sig);
    end if;
  end loop;
end;
$$;
