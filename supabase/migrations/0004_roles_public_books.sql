-- ============================================================================
-- 0004: Rollen (Nutzer / Mod / Admin), Sperren, öffentliche Bücher, Bibliothek,
--       Prüfanfragen und Admin-Funktionen.
--
-- Einspielen: Supabase → SQL Editor → komplett einfügen → Run (nach 0001–0003).
-- Die Datei ist wiederholbar.
--
-- Ersten Admin festlegen (einmalig, im SQL Editor – nur so wird man Admin):
--   update public.profiles set role = 'admin'
--    where id = (select id from auth.users where email = 'deine@mail.de');
--
-- Rechte
--   Nutzer : eigene (private) Bücher bearbeiten, öffentliche Bücher lesen/lernen,
--            Prüfung zu einzelnen Vokabeln anfordern.
--   Mod    : zusätzlich Bücher veröffentlichen, öffentliche Bücher bearbeiten,
--            Prüfanfragen bearbeiten.
--   Admin  : zusätzlich Nutzer sperren/zurücksetzen/löschen, Speicher einsehen,
--            Mods ernennen, öffentliche Bücher zurücknehmen/löschen.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. Profile: Rolle und Sperre
-- ----------------------------------------------------------------------------

alter table public.profiles add column if not exists role text not null default 'user';
alter table public.profiles add column if not exists blocked boolean not null default false;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_role_check') then
    alter table public.profiles
      add constraint profiles_role_check check (role in ('user', 'mod', 'admin'));
  end if;
end;
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select p.role = 'admin' and not p.blocked
      from public.profiles p where p.id = (select auth.uid())
  ), false);
$$;

create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select p.role in ('mod', 'admin') and not p.blocked
      from public.profiles p where p.id = (select auth.uid())
  ), false);
$$;

create or replace function public.is_blocked()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select p.blocked from public.profiles p where p.id = (select auth.uid())), false);
$$;

-- Rolle und Sperre kann nur ein Admin ändern (der SQL Editor hat keine Anmeldung und darf es ebenfalls).
create or replace function public.protect_profile_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (select auth.uid()) is not null
     and (new.role is distinct from old.role or new.blocked is distinct from old.blocked)
     and not public.is_admin() then
    raise exception 'Keine Berechtigung.' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_protect on public.profiles;
create trigger profiles_protect
  before update on public.profiles
  for each row execute function public.protect_profile_columns();

-- Zusätzlich auf Spaltenebene: Nutzer dürfen an ihrem Profil nur den Anzeigenamen ändern.
revoke update on public.profiles from authenticated;
grant update (display_name) on public.profiles to authenticated;


-- ----------------------------------------------------------------------------
-- 2. Bücher: öffentlich / privat
-- ----------------------------------------------------------------------------

alter table public.books add column if not exists is_public boolean not null default false;
alter table public.books add column if not exists published_at timestamptz;
alter table public.books add column if not exists published_by uuid references auth.users (id) on delete set null;

create index if not exists books_public_idx on public.books (is_public) where is_public;

-- Lesen: eigene Bücher und öffentliche Bücher.
create or replace function public.can_read_book(p_book_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.books b
     where b.id = p_book_id and (b.owner_id = (select auth.uid()) or b.is_public)
  );
$$;

-- Ändern: eigene private Bücher; öffentliche Bücher nur Mods und Admins.
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
            or (b.is_public and public.is_staff()))
  );
$$;

-- Die vorhandenen Funktionen (save_vocab_entry, delete_page, …) prüfen owns_book():
-- ab jetzt bedeutet das "darf dieses Buch ändern".
create or replace function public.owns_book(p_book_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.can_edit_book(p_book_id);
$$;

-- "Verwenden": öffentliche Bücher, die ein Nutzer seiner Bibliothek hinzugefügt hat.
create table if not exists public.book_library (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  book_id uuid not null references public.books (id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (user_id, book_id)
);

create index if not exists book_library_book_idx on public.book_library (book_id);

-- Gehört das Buch zur Bibliothek des Nutzers (eigenes Buch oder hinzugefügtes öffentliches Buch)?
create or replace function public.in_library(p_book_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.books b
     where b.id = p_book_id
       and (b.owner_id = (select auth.uid())
            or (b.is_public and exists (
                  select 1 from public.book_library l
                   where l.book_id = b.id and l.user_id = (select auth.uid()))))
  );
$$;


-- ----------------------------------------------------------------------------
-- 3. Prüfanfragen
-- ----------------------------------------------------------------------------

create table if not exists public.review_requests (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references public.books (id) on delete cascade,
  -- set null: ändert ein Mod die Vokabel so, dass sie neu angelegt wird, bleibt die Anfrage mit Momentaufnahme erhalten.
  vocabulary_id uuid references public.vocabulary (id) on delete set null,
  requested_by uuid default auth.uid() references auth.users (id) on delete set null,
  message text not null default '' check (char_length(message) <= 500),
  snapshot jsonb not null,
  status text not null default 'open' check (status in ('open', 'done', 'dismissed')),
  created_at timestamptz not null default now(),
  resolved_by uuid references auth.users (id) on delete set null,
  resolved_at timestamptz,
  resolution_note text check (char_length(resolution_note) <= 500)
);

create unique index if not exists review_open_once
  on public.review_requests (vocabulary_id, requested_by) where status = 'open';
create index if not exists review_status_idx on public.review_requests (status, created_at desc);


-- ----------------------------------------------------------------------------
-- 4. Row Level Security
-- ----------------------------------------------------------------------------

alter table public.book_library enable row level security;
alter table public.review_requests enable row level security;

-- Bücher
drop policy if exists books_own on public.books;
drop policy if exists books_select on public.books;
drop policy if exists books_insert on public.books;
drop policy if exists books_update on public.books;
drop policy if exists books_delete on public.books;

create policy books_select on public.books
  for select to authenticated
  using (owner_id = (select auth.uid()) or is_public);
create policy books_insert on public.books
  for insert to authenticated
  with check (owner_id = (select auth.uid()) and not is_public);
create policy books_update on public.books
  for update to authenticated
  using (public.can_edit_book(id)) with check (public.can_edit_book(id));
create policy books_delete on public.books
  for delete to authenticated
  using (owner_id = (select auth.uid()) and not is_public);

-- is_public / owner_id lassen sich nur über publish_book() usw. ändern.
revoke insert, update on public.books from authenticated;
grant insert (name, language, description) on public.books to authenticated;
grant update (name, language, description) on public.books to authenticated;

-- Units, Seiten, Vokabeln, Platzierungen, Übersetzungen: lesen wer das Buch lesen darf, ändern wer es bearbeiten darf.
do $$
declare
  t text;
begin
  foreach t in array array['units', 'pages', 'vocabulary', 'vocabulary_placements', 'translations']
  loop
    execute format('drop policy if exists %I on public.%I', replace(t, 'vocabulary_placements', 'placements') || '_own', t);
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('drop policy if exists %I on public.%I', t || '_edit', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (public.can_read_book(book_id))',
      t || '_read', t);
    execute format(
      'create policy %I on public.%I for all to authenticated using (public.can_edit_book(book_id)) with check (public.can_edit_book(book_id))',
      t || '_edit', t);
  end loop;
end;
$$;

-- Bibliothek: eigene Einträge; hinzufügen nur für öffentliche Bücher.
drop policy if exists library_select_own on public.book_library;
drop policy if exists library_insert_own on public.book_library;
drop policy if exists library_delete_own on public.book_library;
create policy library_select_own on public.book_library
  for select to authenticated using (user_id = (select auth.uid()));
create policy library_insert_own on public.book_library
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.books b where b.id = book_id and b.is_public)
  );
create policy library_delete_own on public.book_library
  for delete to authenticated using (user_id = (select auth.uid()));
revoke update on public.book_library from authenticated;

-- Prüfanfragen: lesen eigene bzw. (Mods/Admins) alle; geschrieben wird nur über Funktionen.
drop policy if exists review_select on public.review_requests;
create policy review_select on public.review_requests
  for select to authenticated
  using (requested_by = (select auth.uid()) or public.is_staff());
revoke insert, update, delete on public.review_requests from authenticated;

-- Gesperrte Nutzer verlieren sofort jeden Zugriff (restriktive Policy gilt zusätzlich zu allen anderen).
do $$
declare
  t text;
begin
  foreach t in array array[
    'books', 'units', 'pages', 'vocabulary', 'vocabulary_placements', 'translations',
    'user_vocabulary_progress', 'learning_sessions', 'learning_answers', 'user_settings',
    'daily_stats', 'book_library', 'review_requests']
  loop
    execute format('drop policy if exists blocked_guard on public.%I', t);
    execute format(
      'create policy blocked_guard on public.%I as restrictive for all to authenticated using (not public.is_blocked()) with check (not public.is_blocked())',
      t);
  end loop;
end;
$$;


-- ----------------------------------------------------------------------------
-- 5. Bestehende Funktionen anpassen (Bibliothek statt "alles Lesbare")
-- ----------------------------------------------------------------------------

-- Ersetzt einen Textabschnitt in einer vorhandenen Funktion (Definition aus dem Katalog).
-- Schlägt laut fehl, wenn weder die alte noch die neue Fassung gefunden wird.
create or replace function public._patch_function(p_sig regprocedure, p_old text, p_new text)
returns void
language plpgsql
as $$
declare
  v_def text := pg_get_functiondef(p_sig);
begin
  if position(p_new in v_def) > 0 then
    return;
  end if;
  if position(p_old in v_def) = 0 then
    raise exception 'Funktion % passt nicht zur Erwartung (%).', p_sig, p_old;
  end if;
  execute replace(v_def, p_old, p_new);
end;
$$;

select public._patch_function(
  'public.get_learning_pool(text, uuid)'::regprocedure,
  'where (p_book_id is null or v.book_id = p_book_id)',
  'where ((p_book_id is null and public.in_library(v.book_id)) or v.book_id = p_book_id)');

select public._patch_function(
  'public.search_vocabulary(text, uuid, text, integer, integer, integer)'::regprocedure,
  'and (p_book_id is null or e.book_id = p_book_id)',
  'and ((p_book_id is null and public.in_library(e.book_id)) or e.book_id = p_book_id)');

select public._patch_function(
  'public.get_my_stats(uuid)'::regprocedure,
  'where p_book_id is null or v.book_id = p_book_id',
  'where (p_book_id is null and public.in_library(v.book_id)) or v.book_id = p_book_id');

-- Gesperrte Nutzer erscheinen nicht in der Rangliste.
select public._patch_function(
  'public.get_leaderboard(text)'::regprocedure,
  'join public.profiles pr on pr.id = s.uid',
  'join public.profiles pr on pr.id = s.uid and not pr.blocked');

drop function public._patch_function(regprocedure, text, text);

-- Meine Bücher: eigene Bücher + hinzugefügte öffentliche Bücher.
drop function if exists public.get_book_summaries();

create function public.get_book_summaries()
returns table (
  id uuid, name text, language text, description text, created_at timestamptz,
  unit_count integer, page_count integer, vocab_count integer, mastery_percent numeric,
  is_public boolean, is_mine boolean
)
language sql
stable
set search_path = public
as $$
  select
    b.id, b.name, b.language, b.description, b.created_at,
    (select count(*) from public.units u where u.book_id = b.id)::integer,
    (select count(*) from public.pages p where p.book_id = b.id)::integer,
    (select count(*) from public.vocabulary v where v.book_id = b.id)::integer,
    coalesce((
      select round(100 * avg((coalesce(pr.learning_level, 1) - 1) / 4.0))
        from public.vocabulary v
        left join public.user_vocabulary_progress pr
          on pr.vocabulary_id = v.id and pr.user_id = (select auth.uid())
       where v.book_id = b.id
    ), 0),
    b.is_public,
    (b.owner_id = (select auth.uid()))
  from public.books b
  where public.in_library(b.id)
  order by b.created_at desc;
$$;

-- Online-Bücher (öffentlich), mit Hinweis, ob sie schon in der eigenen Bibliothek sind.
create or replace function public.get_public_books()
returns table (
  id uuid, name text, language text, description text, created_at timestamptz,
  published_at timestamptz, published_by_name text,
  unit_count integer, page_count integer, vocab_count integer, mastery_percent numeric,
  in_library boolean, is_mine boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select
    b.id, b.name, b.language, b.description, b.created_at, b.published_at,
    (select pr.display_name from public.profiles pr where pr.id = coalesce(b.published_by, b.owner_id)),
    (select count(*) from public.units u where u.book_id = b.id)::integer,
    (select count(*) from public.pages p where p.book_id = b.id)::integer,
    (select count(*) from public.vocabulary v where v.book_id = b.id)::integer,
    coalesce((
      select round(100 * avg((coalesce(pr.learning_level, 1) - 1) / 4.0))
        from public.vocabulary v
        left join public.user_vocabulary_progress pr
          on pr.vocabulary_id = v.id and pr.user_id = (select auth.uid())
       where v.book_id = b.id
    ), 0),
    public.in_library(b.id),
    (b.owner_id = (select auth.uid()))
  from public.books b
  where b.is_public
    and (select auth.uid()) is not null
    and not public.is_blocked()
  order by b.published_at desc nulls last, b.name;
$$;


-- ----------------------------------------------------------------------------
-- 6. Veröffentlichen, Bibliothek
-- ----------------------------------------------------------------------------

create or replace function public.publish_book(p_book_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_staff() then
    raise exception 'Nur Admins und Mods dürfen Bücher veröffentlichen.' using errcode = '42501';
  end if;
  update public.books
     set is_public = true, published_at = now(), published_by = (select auth.uid())
   where id = p_book_id and owner_id = (select auth.uid()) and not is_public;
  if not found then
    raise exception 'Buch nicht gefunden oder bereits öffentlich.' using errcode = 'P0002';
  end if;
end;
$$;

-- Zurücknehmen: der Besitzer (Mod/Admin) oder ein Admin. Das Buch wird wieder privat.
create or replace function public.unpublish_book(p_book_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.books
     set is_public = false, published_at = null, published_by = null
   where id = p_book_id and is_public
     and (public.is_admin() or (owner_id = (select auth.uid()) and public.is_staff()));
  if not found then
    raise exception 'Keine Berechtigung oder Buch nicht öffentlich.' using errcode = '42501';
  end if;
end;
$$;

create or replace function public.add_to_library(p_book_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if (select auth.uid()) is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  if not exists (select 1 from public.books b where b.id = p_book_id and b.is_public) then
    raise exception 'Öffentliches Buch nicht gefunden.' using errcode = 'P0002';
  end if;
  insert into public.book_library (user_id, book_id) values ((select auth.uid()), p_book_id)
  on conflict do nothing;
end;
$$;

create or replace function public.remove_from_library(p_book_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.book_library where book_id = p_book_id and user_id = (select auth.uid());
end;
$$;


-- ----------------------------------------------------------------------------
-- 7. Prüfanfragen: stellen, ansehen, bearbeiten
-- ----------------------------------------------------------------------------

create or replace function public.request_review(p_vocabulary_id uuid, p_message text default '')
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  v_book uuid;
  v_snapshot jsonb;
  v_id uuid;
begin
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;

  select v.book_id,
         jsonb_build_object(
           'german', v.german,
           'german_alts', to_jsonb(v.german_alts),
           'translations', coalesce((
              select jsonb_agg(t.translation order by t.sort_order, t.created_at)
                from public.translations t where t.vocabulary_id = v.id), '[]'::jsonb))
    into v_book, v_snapshot
    from public.vocabulary v
    join public.books b on b.id = v.book_id
   where v.id = p_vocabulary_id and b.is_public;

  if v_book is null then
    raise exception 'Vokabel nicht gefunden.' using errcode = 'P0002';
  end if;

  if (select count(*) from public.review_requests r where r.requested_by = v_me and r.status = 'open') >= 50 then
    raise exception 'Du hast schon 50 offene Anfragen. Bitte warte, bis sie bearbeitet wurden.' using errcode = '54000';
  end if;

  insert into public.review_requests (book_id, vocabulary_id, requested_by, message, snapshot)
  values (v_book, p_vocabulary_id, v_me, left(btrim(coalesce(p_message, '')), 500), v_snapshot)
  on conflict (vocabulary_id, requested_by) where status = 'open'
  do update set message = excluded.message, snapshot = excluded.snapshot, created_at = now()
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.list_review_requests(p_status text default 'open')
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_staff() then
    raise exception 'Keine Berechtigung.' using errcode = '42501';
  end if;
  if p_status not in ('open', 'done', 'dismissed', 'all') then
    raise exception 'Ungültiger Status.' using errcode = '22023';
  end if;

  return coalesce((
    select jsonb_agg(x.j order by x.created_at desc)
      from (
        select r.created_at,
          jsonb_build_object(
            'id', r.id,
            'status', r.status,
            'message', r.message,
            'created_at', r.created_at,
            'book_id', r.book_id,
            'book_name', b.name,
            'language', b.language,
            'vocabulary_id', r.vocabulary_id,
            'requested_by_name', pr.display_name,
            'snapshot', r.snapshot,
            'current', case when v.id is null then null else jsonb_build_object(
                'german', v.german,
                'german_alts', to_jsonb(v.german_alts),
                'translations', coalesce((
                   select jsonb_agg(t.translation order by t.sort_order, t.created_at)
                     from public.translations t where t.vocabulary_id = v.id), '[]'::jsonb)) end,
            'unit_number', loc.unit_number,
            'page_number', loc.page_number,
            'resolved_by_name', rp.display_name,
            'resolved_at', r.resolved_at,
            'resolution_note', r.resolution_note
          ) as j
        from public.review_requests r
        join public.books b on b.id = r.book_id
        left join public.vocabulary v on v.id = r.vocabulary_id
        left join public.profiles pr on pr.id = r.requested_by
        left join public.profiles rp on rp.id = r.resolved_by
        left join lateral (
          select u.unit_number, p.page_number
            from public.vocabulary_placements vp
            join public.pages p on p.id = vp.page_id
            join public.units u on u.id = p.unit_id
           where vp.vocabulary_id = r.vocabulary_id
           order by u.unit_number, p.page_number
           limit 1
        ) loc on true
        where p_status = 'all' or r.status = p_status
        order by r.created_at desc
        limit 300
      ) x
  ), '[]'::jsonb);
end;
$$;

create or replace function public.resolve_review_request(p_id uuid, p_status text, p_note text default '')
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_staff() then
    raise exception 'Keine Berechtigung.' using errcode = '42501';
  end if;
  if p_status not in ('done', 'dismissed') then
    raise exception 'Ungültiger Status.' using errcode = '22023';
  end if;
  update public.review_requests
     set status = p_status,
         resolved_by = (select auth.uid()),
         resolved_at = now(),
         resolution_note = nullif(left(btrim(coalesce(p_note, '')), 500), '')
   where id = p_id and status = 'open';
  if not found then
    raise exception 'Anfrage nicht gefunden oder schon bearbeitet.' using errcode = 'P0002';
  end if;
end;
$$;

create or replace function public.count_open_reviews()
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select case when public.is_staff()
              then (select count(*)::integer from public.review_requests where status = 'open')
              else 0 end;
$$;


-- ----------------------------------------------------------------------------
-- 8. Admin: Nutzer, Speicher, Sperren, Zurücksetzen
-- ----------------------------------------------------------------------------

create or replace function public._require_admin()
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Nur für Admins.' using errcode = '42501';
  end if;
end;
$$;

-- Grobe Schätzung des Speicherverbrauchs eines Nutzers in Byte (Texte + Zeilenaufwand).
create or replace function public._user_storage_bytes(p_user uuid)
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select (
      coalesce((select sum(octet_length(v.german) + octet_length(array_to_string(v.german_alts, '')) + 96)
                  from public.vocabulary v join public.books b on b.id = v.book_id
                 where b.owner_id = p_user), 0)
    + coalesce((select sum(octet_length(t.translation) + 96)
                  from public.translations t join public.books b on b.id = t.book_id
                 where b.owner_id = p_user), 0)
    + coalesce((select count(*) from public.vocabulary_placements vp join public.books b on b.id = vp.book_id
                 where b.owner_id = p_user), 0) * 64
    + coalesce((select count(*) from public.user_vocabulary_progress x where x.user_id = p_user), 0) * 80
    + coalesce((select sum(octet_length(a.given_answer) + 90) from public.learning_answers a where a.user_id = p_user), 0)
    + coalesce((select count(*) from public.learning_sessions s where s.user_id = p_user), 0) * 100
    + coalesce((select count(*) from public.daily_stats d where d.user_id = p_user), 0) * 40
  )::bigint;
$$;

create or replace function public.admin_list_users()
returns table (
  user_id uuid, display_name text, email text, role text, blocked boolean,
  created_at timestamptz, last_sign_in_at timestamptz,
  book_count integer, public_book_count integer, vocab_count integer,
  progress_count integer, session_count integer, answer_count integer, approx_bytes bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public._require_admin();
  return query
  select
    p.id, p.display_name, u.email::text, p.role, p.blocked, p.created_at, u.last_sign_in_at,
    (select count(*) from public.books b where b.owner_id = p.id)::integer,
    (select count(*) from public.books b where b.owner_id = p.id and b.is_public)::integer,
    (select count(*) from public.vocabulary v join public.books b on b.id = v.book_id where b.owner_id = p.id)::integer,
    (select count(*) from public.user_vocabulary_progress x where x.user_id = p.id)::integer,
    (select count(*) from public.learning_sessions s where s.user_id = p.id)::integer,
    (select count(*) from public.learning_answers a where a.user_id = p.id)::integer,
    public._user_storage_bytes(p.id)
  from public.profiles p
  join auth.users u on u.id = p.id
  order by p.created_at;
end;
$$;

create or replace function public.admin_list_user_books(p_user uuid)
returns table (
  id uuid, name text, language text, is_public boolean, created_at timestamptz,
  page_count integer, vocab_count integer, approx_bytes bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public._require_admin();
  return query
  select
    b.id, b.name, b.language, b.is_public, b.created_at,
    (select count(*) from public.pages pg where pg.book_id = b.id)::integer,
    (select count(*) from public.vocabulary v where v.book_id = b.id)::integer,
    (coalesce((select sum(octet_length(v.german) + octet_length(array_to_string(v.german_alts, '')) + 96)
                 from public.vocabulary v where v.book_id = b.id), 0)
     + coalesce((select sum(octet_length(t.translation) + 96) from public.translations t where t.book_id = b.id), 0)
     + coalesce((select count(*) from public.vocabulary_placements vp where vp.book_id = b.id), 0) * 64)::bigint
  from public.books b
  where b.owner_id = p_user
  order by b.created_at desc;
end;
$$;

create or replace function public.admin_set_role(p_user uuid, p_role text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current text;
begin
  perform public._require_admin();
  if p_role not in ('user', 'mod') then
    raise exception 'Ungültige Rolle. Admins werden nur per SQL festgelegt.' using errcode = '22023';
  end if;
  select role into v_current from public.profiles where id = p_user;
  if v_current is null then
    raise exception 'Nutzer nicht gefunden.' using errcode = 'P0002';
  end if;
  if p_user = (select auth.uid()) or v_current = 'admin' then
    raise exception 'Die Rolle eines Admins kann hier nicht geändert werden.' using errcode = '42501';
  end if;
  update public.profiles set role = p_role where id = p_user;
end;
$$;

create or replace function public.admin_set_blocked(p_user uuid, p_blocked boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current text;
begin
  perform public._require_admin();
  select role into v_current from public.profiles where id = p_user;
  if v_current is null then
    raise exception 'Nutzer nicht gefunden.' using errcode = 'P0002';
  end if;
  if p_user = (select auth.uid()) or v_current = 'admin' then
    raise exception 'Admins können nicht gesperrt werden.' using errcode = '42501';
  end if;
  update public.profiles set blocked = coalesce(p_blocked, false) where id = p_user;
  -- Zusätzlich die Anmeldung sperren (verhindert neue Sitzungen und das Erneuern von Token).
  update auth.users
     set banned_until = case when coalesce(p_blocked, false) then now() + interval '100 years' else null end
   where id = p_user;
end;
$$;

-- Zurücksetzen: Lernfortschritt, Sitzungen, Antworten und Tageswerte (Bücher bleiben bestehen).
create or replace function public.admin_reset_progress(p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._require_admin();
  if not exists (select 1 from public.profiles where id = p_user) then
    raise exception 'Nutzer nicht gefunden.' using errcode = 'P0002';
  end if;
  delete from public.user_vocabulary_progress where user_id = p_user;
  delete from public.learning_sessions where user_id = p_user;   -- Antworten folgen per Cascade
  delete from public.daily_stats where user_id = p_user;
  delete from public.learning_answers where user_id = p_user;
end;
$$;

-- Ein Buch endgültig löschen (auch öffentliche und fremde Bücher).
create or replace function public.admin_delete_book(p_book_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._require_admin();
  delete from public.books where id = p_book_id;
  if not found then
    raise exception 'Buch nicht gefunden.' using errcode = 'P0002';
  end if;
end;
$$;

-- Konto endgültig löschen. Öffentliche Bücher des Nutzers gehen an den ausführenden Admin über.
create or replace function public.admin_delete_user(p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current text;
begin
  perform public._require_admin();
  select role into v_current from public.profiles where id = p_user;
  if v_current is null then
    raise exception 'Nutzer nicht gefunden.' using errcode = 'P0002';
  end if;
  if p_user = (select auth.uid()) or v_current = 'admin' then
    raise exception 'Admin-Konten können hier nicht gelöscht werden.' using errcode = '42501';
  end if;
  update public.books set owner_id = (select auth.uid()) where owner_id = p_user and is_public;
  delete from auth.users where id = p_user;
end;
$$;


-- ----------------------------------------------------------------------------
-- 9. Rechte
-- ----------------------------------------------------------------------------

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
         'is_admin', 'is_staff', 'is_blocked', 'can_read_book', 'can_edit_book', 'owns_book', 'in_library',
         'get_book_summaries', 'get_public_books', 'publish_book', 'unpublish_book',
         'add_to_library', 'remove_from_library',
         'request_review', 'list_review_requests', 'resolve_review_request', 'count_open_reviews',
         'admin_list_users', 'admin_list_user_books', 'admin_set_role', 'admin_set_blocked',
         'admin_reset_progress', 'admin_delete_book', 'admin_delete_user',
         'get_learning_pool', 'search_vocabulary', 'get_my_stats', 'get_leaderboard')
  loop
    execute format('revoke all on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;
  -- Interne Helfer: nur für andere Funktionen (kein direkter Aufruf über die API).
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('_require_admin', '_user_storage_bytes', 'protect_profile_columns')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
  end loop;
end;
$$;

grant select, insert, delete on public.book_library to authenticated;
grant select on public.review_requests to authenticated;
