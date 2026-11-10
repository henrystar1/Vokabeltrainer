-- 0082: Update 100 – Jubiläums-Artikel (begrenzt + für alle). Wiederholbar.
alter table public.shop_items add column if not exists limited integer;

insert into public.shop_items (id, kind, name, price, sort, active, limited) values
  ('tag_u100', 'tag', 'Update 100 · Gold', 0, 9000, true, 10),
  ('theme_u100_gold', 'theme', 'Update 100 · Goldenes Feuerwerk', 0, 9001, true, 10),
  ('theme_u100', 'theme', 'Update 100 · Luftballons', 0, 9002, true, null)
on conflict (id) do update set name = excluded.name, limited = excluded.limited;

-- Stand: wie viele der begrenzten Artikel sind vergeben, was habe ich schon.
create or replace function public.u100_status()
returns table (item_id text, limited integer, taken bigint, mine boolean)
language sql stable security definer set search_path = public as $$
  select i.id, i.limited,
         (select count(*) from public.user_items u where u.item_id = i.id),
         exists (select 1 from public.user_items u where u.item_id = i.id and u.user_id = (select auth.uid()))
    from public.shop_items i
   where i.id in ('tag_u100', 'theme_u100_gold', 'theme_u100') and i.active;
$$;

-- Holen: begrenzte Artikel nur solange noch Plätze frei sind (die Schnellsten gewinnen).
create or replace function public.u100_claim(p_item_id text)
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := (select auth.uid());
  v_lim integer;
  v_n bigint;
begin
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  if p_item_id not in ('tag_u100', 'theme_u100_gold', 'theme_u100') then
    raise exception 'Artikel nicht gefunden.' using errcode = 'P0002';
  end if;
  select limited into v_lim from public.shop_items where id = p_item_id and active;
  if not found then
    raise exception 'Artikel nicht gefunden.' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.user_items where user_id = v_me and item_id = p_item_id) then
    return 'owned';
  end if;
  perform pg_advisory_xact_lock(hashtext('u100:' || p_item_id));
  if v_lim is not null then
    select count(*) into v_n from public.user_items where item_id = p_item_id;
    if v_n >= v_lim then
      return 'gone';
    end if;
  end if;
  insert into public.user_items (user_id, item_id) values (v_me, p_item_id) on conflict do nothing;
  return 'ok';
end;
$$;

do $$
declare f text;
begin
  for f in select unnest(array['u100_status()', 'u100_claim(text)']) loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- ----------------------------------------------------------------------------
-- Mods dürfen (wenn der Admin es freigibt) sehen, wer online ist und was die Leute gerade tun – auch Versteckte.
-- Standard: app_settings 'mod_see_online' (0/1). Pro Person überschreibbar (null = Standard).
-- ----------------------------------------------------------------------------
insert into public.app_settings (key, value, mod_editable) values ('mod_see_online', 0, false) on conflict (key) do nothing;

create table if not exists public.staff_extra (
  user_id uuid primary key references auth.users (id) on delete cascade,
  see_online boolean
);
alter table public.staff_extra enable row level security;
revoke all on public.staff_extra from anon, authenticated;

create or replace function public._can_see_online()
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when public.is_admin() then true
    when not public.is_staff() then false
    else coalesce((select e.see_online from public.staff_extra e where e.user_id = (select auth.uid())),
                  public.setting('mod_see_online') = 1)
  end;
$$;

create or replace function public.staff_can_see_online()
returns boolean language sql stable security definer set search_path = public as $$
  select public._can_see_online();
$$;

create or replace function public.admin_get_staff_extra(p_user uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public._require_admin();
  return jsonb_build_object('see_online', (select see_online from public.staff_extra where user_id = p_user));
end;
$$;

create or replace function public.admin_set_staff_extra(p_user uuid, p_see_online boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public._require_admin();
  if not exists (select 1 from public.profiles where id = p_user and role in ('mod', 'alphamod')) then
    raise exception 'Nur für Mods und Alphamods.' using errcode = '22023';
  end if;
  insert into public.staff_extra (user_id, see_online) values (p_user, p_see_online)
  on conflict (user_id) do update set see_online = excluded.see_online;
end;
$$;

create or replace function public.admin_list_online()
returns table (user_id uuid, display_name text, role text, last_seen_at timestamptz,
               avatar_id text, color_id text, effect_id text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public._can_see_online() then
    raise exception 'Dafür fehlt dir das Recht.' using errcode = '42501';
  end if;
  return query
  select p.id, p.display_name, p.role, p.last_seen_at, p.avatar_id, p.color_id, p.effect_id
    from public.profiles p
   where p.last_seen_at > now() - interval '3 minutes' and not p.blocked
   order by p.display_name;
end;
$$;

create or replace function public.admin_user_status()
returns table (user_id uuid, last_seen_at timestamptz, online boolean, activity text, activity_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public._can_see_online() then
    raise exception 'Dafür fehlt dir das Recht.' using errcode = '42501';
  end if;
  return query
  select p.id, p.last_seen_at, (p.last_seen_at > now() - interval '3 minutes'),
         case when p.last_seen_at > now() - interval '3 minutes' then p.activity end,
         case when p.last_seen_at > now() - interval '3 minutes' then p.activity_at end
    from public.profiles p
   where p.last_seen_at is not null;
end;
$$;

drop function if exists public.get_presence();
create function public.get_presence()
returns table (user_id uuid, display_name text, avatar_id text, color_id text, effect_id text, role text, tag_id text,
               theme_id text, last_seen_at timestamptz, online boolean, hidden boolean)
language sql stable security definer set search_path = public as $$
  select p.id, p.display_name, p.avatar_id, p.color_id, p.effect_id,
         case when p.tags_hidden then 'user' else p.role end,
         case when p.tags_hidden then null else p.tag_id end,
         p.theme_id, p.last_seen_at, (p.last_seen_at > now() - interval '3 minutes'), p.hide_presence
    from public.profiles p
   where (select auth.uid()) is not null and not public.is_blocked()
     and not p.blocked and p.last_seen_at is not null
     and (not p.hide_presence or p.id = (select auth.uid()) or public._can_see_online())
   order by (p.last_seen_at > now() - interval '3 minutes') desc, p.last_seen_at desc
   limit 200;
$$;

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig, p.proname
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('_can_see_online', 'staff_can_see_online', 'admin_get_staff_extra',
       'admin_set_staff_extra', 'admin_list_online', 'admin_user_status', 'get_presence')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    if r.proname not like '\_%' then execute format('grant execute on function %s to authenticated', r.sig); end if;
  end loop;
end $$;

-- ----------------------------------------------------------------------------
-- Karteikasten: alle aktiven Karten mit Fach (= Lernstufe) und richtig/falsch-Zähler.
-- Liest nur; der bisherige Lernstand bleibt unverändert.
-- ----------------------------------------------------------------------------
create or replace function public.get_card_box(p_language text default null, p_book_id uuid default null)
returns jsonb
language sql
stable
set search_path = public
as $$
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'vocabulary_id', v.id,
      'book_id', v.book_id,
      'german', v.german,
      'translations', coalesce((
         select jsonb_agg(t.translation order by t.sort_order, t.created_at)
           from public.translations t where t.vocabulary_id = v.id), '[]'::jsonb),
      'level', coalesce(pr.learning_level, 1)::float8,
      'right', coalesce(pr.times_correct, 0),
      'wrong', coalesce(pr.times_wrong, 0),
      'last_at', pr.last_answered_at
    ) order by v.german), '[]'::jsonb)
  from public.vocabulary v
  join public.books b on b.id = v.book_id
  left join public.user_vocabulary_progress pr
    on pr.vocabulary_id = v.id and pr.user_id = (select auth.uid())
  where (select auth.uid()) is not null
    and ((p_book_id is null and public.in_library(v.book_id)) or v.book_id = p_book_id)
    and public.is_active_vocab(v.id)
    and (p_language is null or b.language = p_language);
$$;

revoke all on function public.get_card_box(text, uuid) from public, anon, authenticated;
grant execute on function public.get_card_box(text, uuid) to authenticated;

-- Kasten pro Buch: wie viele aktive Karten liegen in welchem Fach (nur lesend).
create or replace function public.get_book_boxes()
returns jsonb
language sql
stable
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object('book_id', x.book_id, 'fach', x.fach)), '[]'::jsonb)
  from (
    select v.book_id,
           jsonb_build_array(
             count(*) filter (where floor(coalesce(pr.learning_level, 1)) <= 1),
             count(*) filter (where floor(coalesce(pr.learning_level, 1)) = 2),
             count(*) filter (where floor(coalesce(pr.learning_level, 1)) = 3),
             count(*) filter (where floor(coalesce(pr.learning_level, 1)) = 4),
             count(*) filter (where floor(coalesce(pr.learning_level, 1)) >= 5)) as fach
      from public.vocabulary v
      left join public.user_vocabulary_progress pr
        on pr.vocabulary_id = v.id and pr.user_id = (select auth.uid())
     where (select auth.uid()) is not null
       and public.in_library(v.book_id)
       and public.is_active_vocab(v.id)
     group by v.book_id
  ) x;
$$;

revoke all on function public.get_book_boxes() from public, anon, authenticated;
grant execute on function public.get_book_boxes() to authenticated;
