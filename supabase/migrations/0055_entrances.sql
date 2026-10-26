-- 0055: Auftritte im Parkour wählbar (Schwarzes Loch mit Rakete, Hammer und Blitz, Klavier). Wiederholbar.
--  * Admins dürfen alle drei im Parkour-Shop wählen. Mods dürfen nur die wählen, die der Admin ihnen freigibt (staff_rights.looks).
--  * parkour_profiles.entrance = gewählter Auftritt ('blackhole' | 'hammer' | 'piano' | 'none').
--  * `_staff_look` liefert den tatsächlich geltenden Auftritt, `my_run_perks` zusätzlich die erlaubten und den gewählten.

alter table public.staff_rights add column if not exists looks text[];
update public.staff_rights set looks = array['hammer'] where looks is null and look = 'hammer';
alter table public.parkour_profiles add column if not exists entrance text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'parkour_profiles_entrance_check') then
    alter table public.parkour_profiles add constraint parkour_profiles_entrance_check
      check (entrance is null or entrance in ('blackhole', 'hammer', 'piano', 'none'));
  end if;
end;
$$;

-- Welche Auftritte darf diese Person wählen?
create or replace function public._allowed_looks(p_user uuid)
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select case
      when p.blocked then '{}'::text[]
      when p.role = 'admin' then array['blackhole', 'hammer', 'piano']
      when p.role in ('mod', 'alphamod') then coalesce((select array_agg(x order by x) from unnest(coalesce(r.looks, '{}'::text[])) x where x in ('hammer', 'piano')), '{}'::text[])
      else '{}'::text[] end
      from public.profiles p left join public.staff_rights r on r.user_id = p.id
     where p.id = p_user), '{}'::text[]);
$$;

-- Geltender Auftritt: gewählt und erlaubt, sonst Admin = Schwarzes Loch, Mod = erster erlaubter; 'none' = ohne
create or replace function public._staff_look(p_user uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_l text[] := public._allowed_looks(p_user);
  v_e text := (select pp.entrance from public.parkour_profiles pp where pp.user_id = p_user);
begin
  if coalesce(array_length(v_l, 1), 0) = 0 or v_e = 'none' then return null; end if;
  if v_e is not null and v_e = any (v_l) then return v_e; end if;
  if 'blackhole' = any (v_l) then return 'blackhole'; end if;
  return v_l[1];
end;
$$;

create or replace function public.my_run_perks()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object('spectate', public.can_spectate(), 'look', public._staff_look((select auth.uid())),
                            'allowed', to_jsonb(public._allowed_looks((select auth.uid()))),
                            'entrance', (select pp.entrance from public.parkour_profiles pp where pp.user_id = (select auth.uid())))
   where (select auth.uid()) is not null;
$$;

create or replace function public.parkour_set_entrance(p_look text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  v_l text := nullif(p_look, '');
begin
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  if v_l is not null and v_l <> 'none' and not (v_l = any (public._allowed_looks(v_me))) then
    raise exception 'Diesen Auftritt hast du nicht.' using errcode = '22023';
  end if;
  insert into public.parkour_profiles (user_id) values (v_me) on conflict do nothing;
  update public.parkour_profiles set entrance = v_l, updated_at = now() where user_id = v_me;
  return public.my_run_perks();
end;
$$;

-- Freigabe je Mod
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
    'looks', to_jsonb(coalesce((select looks from public.staff_rights where user_id = p_user), '{}'::text[])),
    'book_ids', coalesce((select jsonb_agg(book_id) from public.staff_book_access where user_id = p_user), '[]'::jsonb),
    'setting_keys', coalesce((select jsonb_agg(key) from public.staff_setting_access where user_id = p_user), '[]'::jsonb));
end;
$$;

drop function if exists public.admin_set_staff_rights(uuid, text, text, boolean, integer, boolean, text);
create or replace function public.admin_set_staff_rights(p_user uuid, p_books_mode text, p_set_mode text, p_shop boolean, p_timeout integer, p_spectate boolean default false, p_looks text[] default '{}')
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_looks text[] := coalesce((select array_agg(distinct x order by x) from unnest(coalesce(p_looks, '{}'::text[])) x where x in ('hammer', 'piano')), '{}'::text[]);
begin
  perform public._require_admin();
  if not exists (select 1 from public.profiles where id = p_user and role in ('mod', 'alphamod')) then
    raise exception 'Nur für Mods und Alphamods.' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(coalesce(p_looks, '{}'::text[])) x where x not in ('hammer', 'piano')) then
    raise exception 'Unbekannter Auftritt.' using errcode = '22023';
  end if;
  insert into public.staff_rights (user_id, books_mode, set_mode, shop, timeout_max, spectate, looks)
  values (p_user, p_books_mode, p_set_mode, p_shop, p_timeout, coalesce(p_spectate, false), v_looks)
  on conflict (user_id) do update
    set books_mode = excluded.books_mode, set_mode = excluded.set_mode, shop = excluded.shop, timeout_max = excluded.timeout_max,
        spectate = excluded.spectate, looks = excluded.looks;
end;
$$;

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig, p.proname
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('_allowed_looks', '_staff_look', 'my_run_perks', 'parkour_set_entrance', 'admin_get_staff_rights', 'admin_set_staff_rights')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    if r.proname not like '\_%' then
      execute format('grant execute on function %s to authenticated', r.sig);
    end if;
  end loop;
end;
$$;
