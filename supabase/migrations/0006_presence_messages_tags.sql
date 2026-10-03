-- ============================================================================
-- 0006: Online-Anzeige für Admins, Nachrichten vom Admin, Tags (Mod/Admin/Spender),
--       Staff-Effekte, krasse Profilbilder, schnelleres Aktivieren, Live-Coins.
--
-- Einspielen: Supabase → SQL Editor → komplett einfügen → Run (nach 0001–0005).
-- Die Datei ist wiederholbar.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. Online-Anzeige (nur Admin sieht sie)
-- ----------------------------------------------------------------------------

alter table public.profiles add column if not exists last_seen_at timestamptz;

-- Wird vom Client etwa jede Minute aufgerufen, solange die App offen ist.
create or replace function public.heartbeat()
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
  update public.profiles set last_seen_at = now() where id = v_me;
end;
$$;

drop function if exists public.admin_list_online();

create function public.admin_list_online()
returns table (user_id uuid, display_name text, role text, last_seen_at timestamptz,
               avatar_id text, color_id text, effect_id text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public._require_admin();
  return query
  select p.id, p.display_name, p.role, p.last_seen_at, p.avatar_id, p.color_id, p.effect_id
    from public.profiles p
   where p.last_seen_at > now() - interval '3 minutes' and not p.blocked
   order by p.display_name;
end;
$$;


-- ----------------------------------------------------------------------------
-- 2. Nachrichten vom Admin
-- ----------------------------------------------------------------------------

create table if not exists public.user_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  from_id uuid references auth.users (id) on delete set null,
  body text not null check (char_length(btrim(body)) between 1 and 1000),
  created_at timestamptz not null default now(),
  read_at timestamptz
);

create index if not exists user_messages_user_idx on public.user_messages (user_id, read_at, created_at desc);

-- p_user = null → an alle (nicht gesperrten) Nutzer außer dir. Gibt die Zahl der Empfänger zurück.
create or replace function public.admin_send_message(p_user uuid, p_body text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  v_count integer;
begin
  perform public._require_admin();
  if char_length(btrim(coalesce(p_body, ''))) < 1 or char_length(p_body) > 1000 then
    raise exception 'Die Nachricht braucht 1 bis 1000 Zeichen.' using errcode = '22023';
  end if;
  insert into public.user_messages (user_id, from_id, body)
  select p.id, v_me, btrim(p_body)
    from public.profiles p
   where not p.blocked and p.id <> v_me and (p_user is null or p.id = p_user);
  get diagnostics v_count = row_count;
  if v_count = 0 then
    raise exception 'Kein Empfänger gefunden.' using errcode = 'P0002';
  end if;
  return v_count;
end;
$$;

create or replace function public.get_unread_messages()
returns table (id uuid, body text, created_at timestamptz, from_name text)
language sql
stable
security definer
set search_path = public
as $$
  select m.id, m.body, m.created_at, coalesce(pr.display_name, 'Admin')
    from public.user_messages m
    left join public.profiles pr on pr.id = m.from_id
   where m.user_id = (select auth.uid()) and m.read_at is null and not public.is_blocked()
   order by m.created_at;
$$;

create or replace function public.mark_messages_read(p_ids uuid[])
returns void
language sql
security definer
set search_path = public
as $$
  update public.user_messages set read_at = now()
   where user_id = (select auth.uid()) and id = any (p_ids) and read_at is null;
$$;

drop function if exists public.admin_list_messages();

create function public.admin_list_messages()
returns table (id uuid, to_name text, body text, created_at timestamptz, read_at timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public._require_admin();
  return query
  select m.id, pr.display_name, m.body, m.created_at, m.read_at
    from public.user_messages m
    left join public.profiles pr on pr.id = m.user_id
   order by m.created_at desc
   limit 100;
end;
$$;


-- ----------------------------------------------------------------------------
-- 3. Shop: Tags, Staff-Artikel, krasse Profilbilder
-- ----------------------------------------------------------------------------

alter table public.profiles add column if not exists tag_id text;
alter table public.shop_items add column if not exists required_role text check (required_role in ('mod', 'admin'));

alter table public.shop_items drop constraint if exists shop_items_kind_check;
alter table public.shop_items add constraint shop_items_kind_check check (kind in ('avatar', 'color', 'effect', 'theme', 'tag'));

insert into public.shop_items (id, kind, name, price, sort, required_role) values
  -- animierte Profilbilder (selten und teuer)
  ('avatar_plasma',    'avatar', 'Plasma',           700, 170, null),
  ('avatar_inferno',   'avatar', 'Inferno',         1100, 180, null),
  ('avatar_frost',     'avatar', 'Frostkern',       1100, 190, null),
  ('avatar_storm',     'avatar', 'Sturm',           1400, 200, null),
  ('avatar_galaxy',    'avatar', 'Galaxie',         2000, 210, null),
  ('avatar_portal',    'avatar', 'Portal',          2500, 220, null),
  ('avatar_supernova', 'avatar', 'Supernova',       4000, 230, null),
  ('avatar_blackhole', 'avatar', 'Schwarzes Loch', 10000, 240, null),
  -- Tags für Spender
  ('tag_supporter', 'tag', 'Unterstützer',    1500, 10, null),
  ('tag_big',       'tag', 'Big Spender',     4000, 20, null),
  ('tag_master',    'tag', 'Master Spender', 10000, 30, null),
  ('tag_legend',    'tag', 'Legende',        25000, 40, null),
  ('tag_king',      'tag', 'Coin-König',     50000, 50, null),
  -- Effekte, die es nur für Mods bzw. Admins gibt (kostenlos, nicht kaufbar)
  ('effect_mod_aura',   'effect', 'Mod-Aura',      0, 100, 'mod'),
  ('effect_mod_bolt',   'effect', 'Mod-Blitz',     0, 110, 'mod'),
  ('effect_admin_royal','effect', 'Admin-Königlich', 0, 120, 'admin'),
  ('effect_admin_void', 'effect', 'Admin-Leere',   0, 130, 'admin')
on conflict (id) do nothing;

create or replace function public._role_rank(p_role text)
returns integer
language sql
immutable
as $$
  select case p_role when 'admin' then 2 when 'mod' then 1 else 0 end;
$$;

-- Verliert jemand die Rolle, verschwindet auch der Staff-Effekt.
create or replace function public.clear_staff_items_on_demotion()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role is distinct from old.role and new.effect_id is not null and exists (
       select 1 from public.shop_items i
        where i.id = new.effect_id and i.required_role is not null
          and public._role_rank(i.required_role) > public._role_rank(new.role)) then
    new.effect_id := null;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_clear_staff_items on public.profiles;
create trigger profiles_clear_staff_items
  before update of role on public.profiles
  for each row execute function public.clear_staff_items_on_demotion();

drop function if exists public.get_shop();

create function public.get_shop()
returns table (id text, kind text, name text, price integer, sort integer, owned boolean, equipped boolean, required_role text)
language sql
stable
security definer
set search_path = public
as $$
  select i.id, i.kind, i.name, i.price, i.sort,
         (i.price = 0 or exists (select 1 from public.user_items u where u.item_id = i.id and u.user_id = (select auth.uid()))),
         exists (select 1 from public.profiles p
                  where p.id = (select auth.uid())
                    and i.id in (p.avatar_id, p.color_id, p.effect_id, p.theme_id, p.tag_id)),
         i.required_role
    from public.shop_items i
   where i.active and (select auth.uid()) is not null
     and (i.required_role is null
          or public._role_rank(i.required_role) <= public._role_rank(
               (select p.role from public.profiles p where p.id = (select auth.uid()))))
   order by i.kind, i.sort, i.name;
$$;

create or replace function public.equip_item(p_item_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  v_kind text;
  v_price integer;
  v_req text;
begin
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  select kind, price, required_role into v_kind, v_price, v_req from public.shop_items where id = p_item_id and active;
  if v_kind is null then
    raise exception 'Artikel nicht gefunden.' using errcode = 'P0002';
  end if;
  if v_req is not null
     and public._role_rank(v_req) > public._role_rank((select role from public.profiles where id = v_me)) then
    raise exception 'Diesen Artikel gibt es nur für %.', case v_req when 'admin' then 'Admins' else 'Mods und Admins' end
      using errcode = '42501';
  end if;
  if v_price > 0 and not exists (select 1 from public.user_items where user_id = v_me and item_id = p_item_id) then
    raise exception 'Diesen Artikel musst du erst kaufen.' using errcode = '42501';
  end if;
  update public.profiles
     set avatar_id = case when v_kind = 'avatar' then p_item_id else avatar_id end,
         color_id  = case when v_kind = 'color'  then p_item_id else color_id end,
         effect_id = case when v_kind = 'effect' then p_item_id else effect_id end,
         theme_id  = case when v_kind = 'theme'  then p_item_id else theme_id end,
         tag_id    = case when v_kind = 'tag'    then p_item_id else tag_id end
   where id = v_me;
end;
$$;

create or replace function public.unequip_item(p_kind text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
begin
  if v_me is null then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  if p_kind not in ('avatar', 'color', 'effect', 'theme', 'tag') then
    raise exception 'Ungültige Art.' using errcode = '22023';
  end if;
  update public.profiles
     set avatar_id = case when p_kind = 'avatar' then null else avatar_id end,
         color_id  = case when p_kind = 'color'  then null else color_id end,
         effect_id = case when p_kind = 'effect' then null else effect_id end,
         theme_id  = case when p_kind = 'theme'  then null else theme_id end,
         tag_id    = case when p_kind = 'tag'    then null else tag_id end
   where id = v_me;
end;
$$;

-- Käufe dürfen keine Staff-Artikel betreffen (Preis 0 → ohnehin nicht kaufbar), aber sicherheitshalber:
create or replace function public.buy_item(p_item_id text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  v_price integer;
  v_req text;
  v_balance integer;
begin
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  select price, required_role into v_price, v_req from public.shop_items where id = p_item_id and active;
  if v_price is null then
    raise exception 'Artikel nicht gefunden.' using errcode = 'P0002';
  end if;
  if v_req is not null then
    raise exception 'Dieser Artikel ist nicht kaufbar.' using errcode = '42501';
  end if;
  if exists (select 1 from public.user_items where user_id = v_me and item_id = p_item_id) or v_price = 0 then
    raise exception 'Das gehört dir schon.' using errcode = '23505';
  end if;
  v_balance := public._grant_koins(v_me, -v_price, 'shop', p_item_id);
  insert into public.user_items (user_id, item_id) values (v_me, p_item_id);
  return v_balance;
end;
$$;

-- Rangliste: zusätzlich Rolle, Tag und Design (für den farbigen Rahmen um den Namen).
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
    select
      d.user_id as uid,
      sum(
        least(d.answers_correct, 200) * 2
        + case when d.answers_total > 0 then 25 else 0 end
        + case when d.answers_total >= 20
               then round(20.0 * d.answers_correct / d.answers_total)::int
               else 0 end
      )::bigint as pts
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
-- 4. Vokabeln schneller aktivieren
-- ----------------------------------------------------------------------------

-- Aktiviert alle Vokabeln bis einschließlich Unit/Seite (in Buchreihenfolge). Gibt die Zahl neu aktivierter Vokabeln zurück.
create or replace function public.activate_up_to(p_book_id uuid, p_unit_number integer, p_page_number integer)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  v_count integer;
begin
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  if not public.in_library(p_book_id) then
    raise exception 'Dieses Buch gehört nicht zu deinen Büchern.' using errcode = '42501';
  end if;
  insert into public.user_active_vocab (user_id, vocabulary_id)
  select distinct v_me, vp.vocabulary_id
    from public.vocabulary_placements vp
    join public.pages p on p.id = vp.page_id
    join public.units u on u.id = p.unit_id
   where vp.book_id = p_book_id
     and (u.unit_number, p.page_number) <= (p_unit_number, p_page_number)
  on conflict do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- Schaltet die nächste Seite frei, auf der noch Vokabeln inaktiv sind. Null, wenn alles aktiv ist.
create or replace function public.activate_next_page(p_book_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  v_unit integer;
  v_page integer;
  v_count integer;
begin
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  if not public.in_library(p_book_id) then
    raise exception 'Dieses Buch gehört nicht zu deinen Büchern.' using errcode = '42501';
  end if;
  select u.unit_number, p.page_number into v_unit, v_page
    from public.vocabulary_placements vp
    join public.pages p on p.id = vp.page_id
    join public.units u on u.id = p.unit_id
   where vp.book_id = p_book_id
     and not exists (select 1 from public.user_active_vocab a
                      where a.user_id = v_me and a.vocabulary_id = vp.vocabulary_id)
   order by u.unit_number, p.page_number
   limit 1;
  if v_unit is null then
    return null;
  end if;
  insert into public.user_active_vocab (user_id, vocabulary_id)
  select distinct v_me, vp.vocabulary_id
    from public.vocabulary_placements vp
    join public.pages p on p.id = vp.page_id
    join public.units u on u.id = p.unit_id
   where vp.book_id = p_book_id and u.unit_number = v_unit and p.page_number = v_page
  on conflict do nothing;
  get diagnostics v_count = row_count;
  return jsonb_build_object('unit_number', v_unit, 'page_number', v_page, 'count', v_count);
end;
$$;


-- ----------------------------------------------------------------------------
-- 5. Live-Coins (Realtime) und Rechte
-- ----------------------------------------------------------------------------

-- Auf Supabase: Änderungen am eigenen Guthaben live an den Client schicken (RLS gilt weiterhin).
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'koin_wallets') then
    alter publication supabase_realtime add table public.koin_wallets;
  end if;
end;
$$;

alter table public.user_messages enable row level security;
drop policy if exists messages_own on public.user_messages;
create policy messages_own on public.user_messages for select to authenticated using (user_id = (select auth.uid()));
revoke all on public.user_messages from anon, authenticated;
grant select on public.user_messages to authenticated;

drop policy if exists blocked_guard on public.user_messages;
create policy blocked_guard on public.user_messages as restrictive for all to authenticated
  using (not public.is_blocked()) with check (not public.is_blocked());

do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in (
         'heartbeat', 'admin_list_online', 'admin_send_message', 'get_unread_messages', 'mark_messages_read',
         'admin_list_messages', 'get_shop', 'equip_item', 'unequip_item', 'buy_item', 'get_leaderboard',
         'activate_up_to', 'activate_next_page')
  loop
    execute format('revoke all on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('_role_rank', 'clear_staff_items_on_demotion')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
  end loop;
end;
$$;
