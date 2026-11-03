-- 0060: Hausaufgaben (Mods und Admins tragen ein, jede Person hakt für sich ab) und Website-Links (Admins). Wiederholbar.
create table if not exists public.homework (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 120),
  body text not null default '' check (char_length(body) <= 2000),
  subject text not null default '' check (char_length(subject) <= 40),
  due_date date,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.homework enable row level security;
revoke all on public.homework from anon, authenticated;

create table if not exists public.homework_done (
  homework_id uuid not null references public.homework (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  done_at timestamptz not null default now(),
  primary key (homework_id, user_id)
);
alter table public.homework_done enable row level security;
revoke all on public.homework_done from anon, authenticated;
create index if not exists homework_done_user_idx on public.homework_done (user_id);

create table if not exists public.site_links (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 80),
  url text not null check (url ~* '^https?://' and char_length(url) <= 500),
  description text not null default '' check (char_length(description) <= 300),
  image_url text not null default '' check (image_url = '' or (image_url ~* '^https?://' and char_length(image_url) <= 500)),
  sort integer not null default 0,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.site_links enable row level security;
revoke all on public.site_links from anon, authenticated;

-- Hausaufgaben der letzten 30 Tage und alle kommenden, mit „erledigt“ für mich und der Zahl Erledigter.
drop function if exists public.homework_list();
create function public.homework_list()
returns table (id uuid, title text, body text, subject text, due_date date, created_at timestamptz, created_by_name text, done boolean, done_count bigint)
language sql
stable
security definer
set search_path = public
as $$
  select h.id, h.title, h.body, h.subject, h.due_date, h.created_at,
         (select p.display_name from public.profiles p where p.id = h.created_by),
         exists (select 1 from public.homework_done d where d.homework_id = h.id and d.user_id = (select auth.uid())),
         (select count(*) from public.homework_done d where d.homework_id = h.id)
    from public.homework h
   where (select auth.uid()) is not null and not public.is_blocked()
     and coalesce(h.due_date, h.created_at::date) >= current_date - 30
   order by h.due_date nulls last, h.created_at desc
   limit 200;
$$;

create or replace function public.homework_save(p_id uuid, p_title text, p_body text, p_subject text, p_due date)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid;
begin
  if not public.is_staff() then
    raise exception 'Nur für Mods und Admins.' using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(p_title, ''))) not between 1 and 120 then
    raise exception 'Der Titel braucht 1 bis 120 Zeichen.' using errcode = '22023';
  end if;
  if p_id is null then
    insert into public.homework (title, body, subject, due_date, created_by)
    values (btrim(p_title), left(coalesce(p_body, ''), 2000), left(btrim(coalesce(p_subject, '')), 40), p_due, (select auth.uid()))
    returning id into v_id;
  else
    update public.homework
       set title = btrim(p_title), body = left(coalesce(p_body, ''), 2000), subject = left(btrim(coalesce(p_subject, '')), 40),
           due_date = p_due, updated_at = now()
     where id = p_id returning id into v_id;
    if v_id is null then
      raise exception 'Hausaufgabe nicht gefunden.' using errcode = 'P0002';
    end if;
  end if;
  return v_id;
end;
$$;

create or replace function public.homework_delete(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_staff() then
    raise exception 'Nur für Mods und Admins.' using errcode = '42501';
  end if;
  delete from public.homework where id = p_id;
end;
$$;

-- Für mich abhaken oder wieder öffnen.
create or replace function public.homework_set_done(p_id uuid, p_done boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if (select auth.uid()) is null or public.is_blocked() then
    raise exception 'Nicht erlaubt.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.homework where id = p_id) then
    raise exception 'Hausaufgabe nicht gefunden.' using errcode = 'P0002';
  end if;
  if coalesce(p_done, false) then
    insert into public.homework_done (homework_id, user_id) values (p_id, (select auth.uid())) on conflict do nothing;
  else
    delete from public.homework_done where homework_id = p_id and user_id = (select auth.uid());
  end if;
end;
$$;

drop function if exists public.site_links_list();
create function public.site_links_list()
returns table (id uuid, title text, url text, description text, image_url text, sort integer)
language sql
stable
security definer
set search_path = public
as $$
  select s.id, s.title, s.url, s.description, s.image_url, s.sort
    from public.site_links s
   where (select auth.uid()) is not null and not public.is_blocked()
   order by s.sort, s.created_at;
$$;

create or replace function public.site_link_save(p_id uuid, p_title text, p_url text, p_description text, p_image text, p_sort integer)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid;
begin
  if not public.is_admin() then
    raise exception 'Nur für Admins.' using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(p_title, ''))) not between 1 and 80 then
    raise exception 'Der Titel braucht 1 bis 80 Zeichen.' using errcode = '22023';
  end if;
  if btrim(coalesce(p_url, '')) !~* '^https?://[^\s]+$' or char_length(btrim(p_url)) > 500 then
    raise exception 'Die Adresse muss mit https:// beginnen.' using errcode = '22023';
  end if;
  if btrim(coalesce(p_image, '')) <> '' and (btrim(p_image) !~* '^https?://[^\s]+$' or char_length(btrim(p_image)) > 500) then
    raise exception 'Die Bildadresse muss mit https:// beginnen.' using errcode = '22023';
  end if;
  if p_id is null then
    insert into public.site_links (title, url, description, image_url, sort, created_by)
    values (btrim(p_title), btrim(p_url), left(coalesce(p_description, ''), 300), btrim(coalesce(p_image, '')), coalesce(p_sort, 0), (select auth.uid()))
    returning id into v_id;
  else
    update public.site_links
       set title = btrim(p_title), url = btrim(p_url), description = left(coalesce(p_description, ''), 300),
           image_url = btrim(coalesce(p_image, '')), sort = coalesce(p_sort, 0)
     where id = p_id returning id into v_id;
    if v_id is null then
      raise exception 'Link nicht gefunden.' using errcode = 'P0002';
    end if;
  end if;
  return v_id;
end;
$$;

create or replace function public.site_link_delete(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Nur für Admins.' using errcode = '42501';
  end if;
  delete from public.site_links where id = p_id;
end;
$$;

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('homework_list', 'homework_save', 'homework_delete', 'homework_set_done', 'site_links_list', 'site_link_save', 'site_link_delete')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;
end;
$$;
