-- 0013: Rechte für jeden Mod/Alphamod einzeln einstellen. Wiederholbar. Nach 0012 ausführen.
-- Ohne eigene Einstellung gilt der Standard aus 0012 (Tab „Mod-Rechte“). Ein Alphamod hat nur noch den Tag
-- und sonst genau die Rechte, die ihm der Admin gibt. Admins dürfen immer alles.

create table if not exists public.staff_rights (
  user_id uuid primary key references auth.users (id) on delete cascade,
  books_mode text check (books_mode in ('none', 'selected', 'all')),   -- null = Standard
  set_mode text check (set_mode in ('none', 'selected', 'all')),
  shop boolean,
  timeout_max integer check (timeout_max between 1 and 100000)
);
create table if not exists public.staff_book_access (
  user_id uuid not null references auth.users (id) on delete cascade,
  book_id uuid not null references public.books (id) on delete cascade,
  primary key (user_id, book_id)
);
create table if not exists public.staff_setting_access (
  user_id uuid not null references auth.users (id) on delete cascade,
  key text not null references public.app_settings (key) on delete cascade,
  primary key (user_id, key)
);
alter table public.staff_rights enable row level security;
alter table public.staff_book_access enable row level security;
alter table public.staff_setting_access enable row level security;
revoke all on public.staff_rights, public.staff_book_access, public.staff_setting_access from anon, authenticated;

-- Rechte-Hilfen (intern)
-- Darf ich diese Zahl ändern? Mit null: darf ich überhaupt irgendeine ändern?
create or replace function public._staff_can_setting(p_key text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  with me as (select (select auth.uid()) as id),
       r as (select s.set_mode from public.staff_rights s, me where s.user_id = me.id)
  select case
    when public.is_admin() then true
    when not public.is_staff() then false
    when coalesce((select set_mode from r), '') = 'all' then true
    when coalesce((select set_mode from r), '') = 'none' then false
    when coalesce((select set_mode from r), '') = 'selected' then
      exists (select 1 from public.staff_setting_access a, me where a.user_id = me.id and (p_key is null or a.key = p_key))
    -- kein eigener Eintrag: Standard für alle Mods
    else public.setting('mod_set_all') = 1
         or exists (select 1 from public.app_settings x where x.mod_editable and (p_key is null or x.key = p_key))
  end;
$$;

create or replace function public._staff_can(p_perm text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when public.is_admin() then true
    when not public.is_staff() then false
    when p_perm = 'shop' then coalesce((select r.shop from public.staff_rights r where r.user_id = (select auth.uid())),
                                       public.setting('mod_shop_prices') = 1)
    when p_perm = 'settings' then public._staff_can_setting(null)
    else false
  end;
$$;

create or replace function public._staff_books_mode()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select s.books_mode from public.staff_rights s where s.user_id = (select auth.uid())), 'default');
$$;

create or replace function public.can_edit_book(p_book_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.books b
     where b.id = p_book_id
       and ((not b.is_public and b.owner_id = (select auth.uid()))
            or (b.is_public and public.is_staff()
                and (public.is_admin()
                     or case public._staff_books_mode()
                          when 'all' then true
                          when 'none' then false
                          when 'selected' then exists (select 1 from public.staff_book_access a where a.book_id = b.id and a.user_id = (select auth.uid()))
                          else public.setting('mod_books_all') = 1
                               or exists (select 1 from public.mod_book_access a where a.book_id = b.id)
                        end)))
  );
$$;

create or replace function public.staff_set_setting(p_key text, p_value integer)
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
  if p_key like 'mod\_%' and not public.is_admin() then
    raise exception 'Mod-Rechte darf nur ein Admin ändern.' using errcode = '42501';
  end if;
  if not public._staff_can_setting(p_key) then
    raise exception 'Diese Einstellung darfst du nicht ändern.' using errcode = '42501';
  end if;
  update public.app_settings set value = p_value where key = p_key;
  if not found then
    raise exception 'Unbekannte Einstellung.' using errcode = 'P0002';
  end if;
end;
$$;

create or replace function public.staff_timeout_message(p_message_id bigint, p_minutes integer default 1)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target uuid;
  v_role text;
  v_max integer;
  v_minutes integer;
begin
  if not public.is_staff() then
    raise exception 'Nur Mods und Admins dürfen stummschalten.' using errcode = '42501';
  end if;
  select user_id into v_target from public.chat_messages where id = p_message_id;
  if v_target is null then
    raise exception 'Nachricht nicht gefunden.' using errcode = 'P0002';
  end if;
  select role into v_role from public.profiles where id = v_target;
  if v_role <> 'user' then
    raise exception 'Mods und Admins können nicht stummgeschaltet werden.' using errcode = '42501';
  end if;
  v_max := case when public.is_admin() then greatest(public.setting('timeout_max'), 1)
                else greatest(coalesce((select r.timeout_max from public.staff_rights r where r.user_id = (select auth.uid())),
                                       public.setting('mod_timeout_max')), 1) end;
  v_minutes := least(greatest(coalesce(p_minutes, 1), 0), v_max); -- 0 = Stummschaltung aufheben (alle Mods)
  update public.profiles
     set muted_until = case when v_minutes = 0 then null else now() + make_interval(mins => v_minutes) end
   where id = v_target;
end;
$$;

create or replace function public.get_my_permissions()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'staff', public.is_staff(),
    'alphamod', public.is_alphamod(),
    'admin', public.is_admin(),
    'settings', public._staff_can('settings'),
    'settings_all', public.is_admin() or (select coalesce(set_mode, '') from public.staff_rights where user_id = (select auth.uid())) = 'all'
                    or (not exists (select 1 from public.staff_rights where user_id = (select auth.uid()) and set_mode is not null)
                        and public.setting('mod_set_all') = 1),
    'setting_keys', coalesce((select jsonb_agg(x.key) from public.app_settings x where public._staff_can_setting(x.key)), '[]'::jsonb),
    'shop', public._staff_can('shop'),
    'books_all', public.is_admin() or public._staff_books_mode() = 'all'
                 or (public._staff_books_mode() = 'default' and public.setting('mod_books_all') = 1),
    'timeout_max', case when public.is_admin() then greatest(public.setting('timeout_max'), 1)
                        else greatest(coalesce((select r.timeout_max from public.staff_rights r where r.user_id = (select auth.uid())),
                                               public.setting('mod_timeout_max')), 1) end);
$$;

-- ----------------------------------------------------------------------------
-- Admin: Rechte einzelner Mods/Alphamods
-- ----------------------------------------------------------------------------

create or replace function public.admin_list_staff()
returns table (user_id uuid, display_name text, role text, books_mode text, set_mode text, shop boolean, timeout_max integer,
               book_count integer, setting_count integer)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public._require_admin();
  return query
  select p.id, p.display_name, p.role, r.books_mode, r.set_mode, r.shop, r.timeout_max,
         (select count(*) from public.staff_book_access a where a.user_id = p.id)::integer,
         (select count(*) from public.staff_setting_access a where a.user_id = p.id)::integer
    from public.profiles p
    left join public.staff_rights r on r.user_id = p.id
   where p.role in ('mod', 'alphamod')
   order by p.role desc, p.display_name;
end;
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
    'book_ids', coalesce((select jsonb_agg(book_id) from public.staff_book_access where user_id = p_user), '[]'::jsonb),
    'setting_keys', coalesce((select jsonb_agg(key) from public.staff_setting_access where user_id = p_user), '[]'::jsonb));
end;
$$;

-- Null bedeutet „Standard übernehmen“.
create or replace function public.admin_set_staff_rights(p_user uuid, p_books_mode text, p_set_mode text, p_shop boolean, p_timeout integer)
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
  insert into public.staff_rights (user_id, books_mode, set_mode, shop, timeout_max)
  values (p_user, p_books_mode, p_set_mode, p_shop, p_timeout)
  on conflict (user_id) do update
    set books_mode = excluded.books_mode, set_mode = excluded.set_mode, shop = excluded.shop, timeout_max = excluded.timeout_max;
end;
$$;

create or replace function public.admin_set_staff_book(p_user uuid, p_book uuid, p_allowed boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._require_admin();
  if p_allowed then
    insert into public.staff_book_access (user_id, book_id)
    select p_user, b.id from public.books b where b.id = p_book and b.is_public
    on conflict do nothing;
  else
    delete from public.staff_book_access where user_id = p_user and book_id = p_book;
  end if;
end;
$$;

create or replace function public.admin_set_staff_setting(p_user uuid, p_key text, p_allowed boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._require_admin();
  if p_key like 'mod\_%' then
    raise exception 'Mod-Rechte selbst sind nicht freigebbar.' using errcode = '22023';
  end if;
  if p_allowed then
    insert into public.staff_setting_access (user_id, key) select p_user, s.key from public.app_settings s where s.key = p_key
    on conflict do nothing;
  else
    delete from public.staff_setting_access where user_id = p_user and key = p_key;
  end if;
end;
$$;

create or replace function public.admin_reset_staff_rights(p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._require_admin();
  delete from public.staff_rights where user_id = p_user;
  delete from public.staff_book_access where user_id = p_user;
  delete from public.staff_setting_access where user_id = p_user;
end;
$$;

do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig, p.proname
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in (
       '_staff_can', '_staff_can_setting', '_staff_books_mode', 'can_edit_book', 'staff_set_setting', 'staff_timeout_message',
       'get_my_permissions', 'admin_list_staff', 'admin_get_staff_rights', 'admin_set_staff_rights', 'admin_set_staff_book',
       'admin_set_staff_setting', 'admin_reset_staff_rights')
  loop
    if r.proname like '\_%' then
      execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    else
      execute format('revoke all on function %s from public, anon', r.sig);
      execute format('grant execute on function %s to authenticated', r.sig);
    end if;
  end loop;
end;
$$;
