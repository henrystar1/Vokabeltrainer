-- 0012: einstellbare Mod-Rechte (Bücher, Zahlen, Shop-Preise, Stummschalt-Dauer), Artikel verschenken,
-- Tags ausblendbar. Wiederholbar. Nach 0011 ausführen.

-- ----------------------------------------------------------------------------
-- 1. Mod-Rechte
-- ----------------------------------------------------------------------------

insert into public.app_settings (key, value, mod_editable) values
  ('mod_books_all', 1, false),       -- 1 = Mods dürfen alle Online-Bücher bearbeiten, 0 = nur ausgewählte
  ('mod_set_all', 0, false),         -- 1 = Mods dürfen alle Zahlen ändern (sonst nur die freigegebenen)
  ('mod_shop_prices', 0, false),     -- 1 = Mods dürfen Shop-Preise ändern
  ('mod_timeout_max', 1, false)      -- längste Stummschalt-Dauer für Mods in Minuten
on conflict (key) do nothing;

create table if not exists public.mod_book_access (
  book_id uuid primary key references public.books (id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.mod_book_access enable row level security;
revoke all on public.mod_book_access from anon, authenticated;

-- Darf der angemeldete Mod/Alphamod/Admin dieses Recht nutzen? 'shop' | 'settings'
create or replace function public._staff_can(p_perm text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when public.is_alphamod() then true
    when not public.is_staff() then false
    when p_perm = 'shop' then public.setting('mod_shop_prices') = 1
    when p_perm = 'settings' then public.setting('mod_set_all') = 1
                                  or exists (select 1 from public.app_settings where mod_editable)
    else false
  end;
$$;

-- Öffentliche Bücher: Mods nur, wenn alle erlaubt sind oder das Buch freigegeben ist. Alphamods/Admins immer.
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
                and (public.is_alphamod()
                     or public.setting('mod_books_all') = 1
                     or exists (select 1 from public.mod_book_access a where a.book_id = b.id))))
  );
$$;

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
  -- Die Mod-Rechte selbst darf nur ein Admin ändern.
  if p_key like 'mod\_%' and not public.is_admin() then
    raise exception 'Mod-Rechte darf nur ein Admin ändern.' using errcode = '42501';
  end if;
  if not public.is_alphamod()
     and not (public.setting('mod_set_all') = 1
              or exists (select 1 from public.app_settings where key = p_key and mod_editable)) then
    raise exception 'Diese Einstellung darfst du nicht ändern.' using errcode = '42501';
  end if;
  update public.app_settings set value = p_value where key = p_key;
  if not found then
    raise exception 'Unbekannte Einstellung.' using errcode = 'P0002';
  end if;
end;
$$;

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
  if p_price < 0 or p_price > 100000 then
    raise exception 'Ungültiger Preis.' using errcode = '22023';
  end if;
  update public.shop_items set price = p_price, active = coalesce(p_active, true) where id = p_item_id;
  if not found then
    raise exception 'Artikel nicht gefunden.' using errcode = 'P0002';
  end if;
end;
$$;

-- Was darf ich? (für die Verwaltungsoberfläche)
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
    'settings_all', public.is_alphamod() or public.setting('mod_set_all') = 1,
    'shop', public._staff_can('shop'),
    'books_all', public.is_alphamod() or public.setting('mod_books_all') = 1,
    'timeout_max', case when public.is_alphamod() then public.setting('timeout_max') else greatest(public.setting('mod_timeout_max'), 1) end);
$$;

create or replace function public.admin_list_public_books()
returns table (id uuid, name text, language text, owner_name text, vocab_count integer, mod_access boolean)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public._require_admin();
  return query
  select b.id, b.name, b.language, coalesce(p.display_name, '?'),
         (select count(*) from public.vocabulary v where v.book_id = b.id)::integer,
         exists (select 1 from public.mod_book_access a where a.book_id = b.id)
    from public.books b
    left join public.profiles p on p.id = b.owner_id
   where b.is_public
   order by b.name;
end;
$$;

create or replace function public.admin_set_mod_book(p_book uuid, p_allowed boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._require_admin();
  if p_allowed then
    insert into public.mod_book_access (book_id) select b.id from public.books b where b.id = p_book and b.is_public
    on conflict do nothing;
  else
    delete from public.mod_book_access where book_id = p_book;
  end if;
end;
$$;

create or replace function public.admin_set_mod_editable(p_key text, p_value boolean)
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
  update public.app_settings set mod_editable = coalesce(p_value, false) where key = p_key;
  if not found then
    raise exception 'Unbekannte Einstellung.' using errcode = 'P0002';
  end if;
end;
$$;

-- Stummschalten: Mods bis zur eingestellten Höchstdauer (Standard 1 Minute).
create or replace function public.staff_timeout_message(p_message_id bigint, p_minutes integer default 1)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target uuid;
  v_role text;
  v_minutes integer;
  v_max integer;
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
  v_max := case when public.is_alphamod() then greatest(public.setting('timeout_max'), 1)
                else greatest(public.setting('mod_timeout_max'), 1) end;
  v_minutes := least(greatest(coalesce(p_minutes, 1), case when public.is_alphamod() then 0 else 1 end), v_max);
  update public.profiles
     set muted_until = case when v_minutes = 0 then null else now() + make_interval(mins => v_minutes) end
   where id = v_target;
end;
$$;

-- ----------------------------------------------------------------------------
-- 2. Artikel verschenken (Admin): ohne Coins, optional gleich anziehen
-- ----------------------------------------------------------------------------

create or replace function public.admin_grant_item(p_user uuid, p_item_id text, p_equip boolean default true)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_kind text;
begin
  perform public._require_admin();
  select kind into v_kind from public.shop_items where id = p_item_id;
  if v_kind is null then
    raise exception 'Artikel nicht gefunden.' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.profiles where id = p_user) then
    raise exception 'Nutzer nicht gefunden.' using errcode = 'P0002';
  end if;
  insert into public.user_items (user_id, item_id) values (p_user, p_item_id) on conflict do nothing;
  if coalesce(p_equip, true) then
    update public.profiles
       set avatar_id = case when v_kind = 'avatar' then p_item_id else avatar_id end,
           color_id  = case when v_kind = 'color'  then p_item_id else color_id end,
           effect_id = case when v_kind = 'effect' then p_item_id else effect_id end,
           theme_id  = case when v_kind = 'theme'  then p_item_id else theme_id end,
           tag_id    = case when v_kind = 'tag'    then p_item_id else tag_id end
     where id = p_user;
  end if;
  insert into public.user_messages (user_id, from_id, body)
  values (p_user, null, 'Du hast einen neuen Artikel geschenkt bekommen: ' || (select name from public.shop_items where id = p_item_id) || ' 🎁');
end;
$$;

-- ----------------------------------------------------------------------------
-- 3. Tags ausblenden (Rollen-Tag und gekaufter Tag)
-- ----------------------------------------------------------------------------

alter table public.profiles add column if not exists tags_hidden boolean not null default false;

create or replace function public.set_tags_hidden(p_hidden boolean)
returns void
language sql
security definer
set search_path = public
as $$
  update public.profiles set tags_hidden = coalesce(p_hidden, false) where id = (select auth.uid());
$$;

-- Alle Funktionen, die Rolle und Tag anderer Nutzer ausgeben, bekommen die Ausblend-Regel.
do $$
declare
  r record;
  v_def text;
begin
  for r in
    select p.oid, p.proname
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('get_leaderboard', 'get_chat', 'get_game_board', 'get_sprint_board', 'get_league', 'search_players', 'list_duels')
  loop
    v_def := pg_get_functiondef(r.oid);
    if v_def like '%tags\_hidden%' then
      continue; -- schon angepasst
    end if;
    v_def := regexp_replace(v_def, '\m(pr|p|o)\.tag_id\M', '(case when \1.tags_hidden then null else \1.tag_id end)', 'g');
    v_def := regexp_replace(v_def, '\m(pr|p|o)\.role\M', '(case when \1.tags_hidden then ''user'' else \1.role end)', 'g');
    execute v_def;
  end loop;
end;
$$;

-- ----------------------------------------------------------------------------
-- 4. Rechte
-- ----------------------------------------------------------------------------

do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in (
       'staff_set_setting', 'admin_set_item', 'get_my_permissions', 'admin_list_public_books', 'admin_set_mod_book',
       'admin_set_mod_editable', 'staff_timeout_message', 'admin_grant_item', 'set_tags_hidden', 'can_edit_book',
       'get_leaderboard', 'get_chat', 'get_game_board', 'get_sprint_board', 'get_league', 'search_players', 'list_duels')
  loop
    execute format('revoke all on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = '_staff_can'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
  end loop;
end;
$$;
