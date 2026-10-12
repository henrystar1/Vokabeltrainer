-- ===== 0001_schema.sql =====
-- ============================================================================
-- Vokabeltrainer – Datenbankschema (Supabase / PostgreSQL)
--
-- Einspielen: Supabase Dashboard → SQL Editor → New query → komplett einfügen → Run.
-- Die Datei ist für einen frischen Stand gedacht (einmal ausführen).
--
-- Grundprinzipien
--  * Der Lernfortschritt gehört dem Benutzer: user + vocabulary + learning_level.
--  * Eine Unit umfasst mehrere Seiten (pages.unit_id); Vokabeln hängen an Seiten.
--  * Dieselbe Vokabel kann an mehreren Seiten stehen (vocabulary_placements).
--  * Jede Tabelle hat Row Level Security. Fremde Daten sind nie lesbar;
--    Rangliste und Durchschnitte laufen nur über definierte Funktionen.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. Hilfsfunktionen
-- ----------------------------------------------------------------------------

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;


-- ----------------------------------------------------------------------------
-- 2. Sprachen (erweiterbar: neue Zeile einfügen genügt)
-- ----------------------------------------------------------------------------

create table public.languages (
  code text primary key,
  name text not null
);

insert into public.languages (code, name) values
  ('en', 'Englisch'),
  ('fr', 'Französisch');


-- ----------------------------------------------------------------------------
-- 3. Profile und Einstellungen
-- ----------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (char_length(btrim(display_name)) between 2 and 30),
  created_at timestamptz not null default now()
);

-- Anzeigenamen sind öffentlich (Rangliste) und deshalb eindeutig.
create unique index profiles_display_name_key on public.profiles (lower(display_name));

create table public.user_settings (
  user_id uuid primary key references auth.users (id) on delete cascade,
  learn_language text not null default 'en' references public.languages (code),
  direction_to_foreign boolean not null default true,   -- Deutsch → Fremdsprache
  direction_to_german boolean not null default true,    -- Fremdsprache → Deutsch
  words_per_round integer not null default 20 check (words_per_round between 1 and 200),
  case_sensitive boolean not null default false,
  updated_at timestamptz not null default now(),
  check (direction_to_foreign or direction_to_german)
);

create trigger user_settings_touch
  before update on public.user_settings
  for each row execute function public.touch_updated_at();

-- Bei der Registrierung automatisch Profil + Einstellungen anlegen.
-- Der Anzeigename kommt aus den Registrierungs-Metadaten (options.data.display_name);
-- ist er vergeben oder fehlt, wird ein eindeutiger Name erzeugt.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  wanted text := nullif(btrim(coalesce(new.raw_user_meta_data ->> 'display_name', '')), '');
  final_name text;
begin
  if wanted is null or char_length(wanted) < 2 then
    wanted := 'Lerner';
  end if;
  wanted := left(wanted, 24);
  final_name := wanted;

  if exists (select 1 from public.profiles p where lower(p.display_name) = lower(final_name)) then
    final_name := wanted || '-' || substr(replace(new.id::text, '-', ''), 1, 5);
  end if;

  insert into public.profiles (id, display_name) values (new.id, final_name);
  insert into public.user_settings (user_id) values (new.id);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


-- ----------------------------------------------------------------------------
-- 4. Bücher, Units, Seiten
-- ----------------------------------------------------------------------------

create table public.books (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  language text not null references public.languages (code),
  description text check (char_length(description) <= 1000),
  created_at timestamptz not null default now()
);

create index books_owner_idx on public.books (owner_id);

create or replace function public.owns_book(p_book_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.books b
    where b.id = p_book_id and b.owner_id = (select auth.uid())
  );
$$;

create table public.units (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references public.books (id) on delete cascade,
  unit_number integer not null check (unit_number >= 0),
  name text check (char_length(name) <= 120),
  created_at timestamptz not null default now(),
  unique (book_id, unit_number),
  unique (id, book_id)
);

-- Eine Unit kann über mehrere Seiten gehen (z. B. Unit 4 = Seite 87, 88, 89):
-- jede dieser Seiten verweist auf dieselbe Unit. Die Unit selbst hängt an keiner Seite.
create table public.pages (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references public.books (id) on delete cascade,
  unit_id uuid not null,
  page_number integer not null check (page_number > 0),
  created_at timestamptz not null default now(),
  unique (book_id, page_number),
  unique (id, book_id),
  -- Unit und Seite müssen zum selben Buch gehören.
  foreign key (unit_id, book_id) references public.units (id, book_id) on delete cascade
);

create index pages_unit_idx on public.pages (unit_id);


-- ----------------------------------------------------------------------------
-- 5. Vokabeln, Platzierungen, Übersetzungen
-- ----------------------------------------------------------------------------

-- Eine Vokabel = deutsche Grundform innerhalb eines Buches. Doppelte Eingaben
-- ("tun" zweimal) treffen auf denselben Schlüssel und werden per Upsert zu einer
-- Vokabel mit mehreren Übersetzungen zusammengeführt.
create table public.vocabulary (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references public.books (id) on delete cascade,
  german text not null check (char_length(btrim(german)) between 1 and 200),
  german_key text generated always as (regexp_replace(lower(btrim(german)), '\s+', ' ', 'g')) stored,
  created_at timestamptz not null default now(),
  unique (book_id, german_key),
  unique (id, book_id)
);

-- Wo steht die Vokabel? Dieselbe Vokabel darf an mehreren Seiten/Units stehen.
create table public.vocabulary_placements (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references public.books (id) on delete cascade,
  vocabulary_id uuid not null,
  page_id uuid not null,
  position_on_page integer not null default 0 check (position_on_page >= 0),
  created_at timestamptz not null default now(),
  unique (vocabulary_id, page_id),
  foreign key (vocabulary_id, book_id) references public.vocabulary (id, book_id) on delete cascade,
  foreign key (page_id, book_id) references public.pages (id, book_id) on delete cascade
);

create index placements_page_idx on public.vocabulary_placements (page_id, position_on_page);
create index placements_vocab_idx on public.vocabulary_placements (vocabulary_id);

-- Mehrere richtige Übersetzungen je Vokabel ("to do" ODER "to make").
create table public.translations (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references public.books (id) on delete cascade,
  vocabulary_id uuid not null,
  translation text not null check (char_length(btrim(translation)) between 1 and 200),
  translation_key text generated always as (regexp_replace(lower(btrim(translation)), '\s+', ' ', 'g')) stored,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique (vocabulary_id, translation_key),
  foreign key (vocabulary_id, book_id) references public.vocabulary (id, book_id) on delete cascade
);

create index translations_vocab_idx on public.translations (vocabulary_id, sort_order);


-- ----------------------------------------------------------------------------
-- 6. Lernfortschritt und Sitzungen (immer pro Benutzer)
-- ----------------------------------------------------------------------------

-- Lernstand 1–5 in 0,5er-Schritten; die Oberfläche zeigt nur ganze Stufen.
create table public.user_vocabulary_progress (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  vocabulary_id uuid not null references public.vocabulary (id) on delete cascade,
  learning_level numeric(2, 1) not null default 1
    check (learning_level between 1 and 5 and learning_level * 2 = round(learning_level * 2)),
  times_correct integer not null default 0 check (times_correct >= 0),
  times_wrong integer not null default 0 check (times_wrong >= 0),
  last_answered_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (user_id, vocabulary_id)
);

create index progress_vocab_idx on public.user_vocabulary_progress (vocabulary_id);

create trigger progress_touch
  before update on public.user_vocabulary_progress
  for each row execute function public.touch_updated_at();

create table public.learning_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  book_id uuid references public.books (id) on delete set null,
  mode text not null check (mode in ('learn', 'test')),
  affects_level boolean not null default true,   -- Tests verändern den Lernstand standardmäßig nicht
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  vocabulary_count integer not null default 0 check (vocabulary_count >= 0),
  answers_total integer not null default 0 check (answers_total >= 0),
  answers_correct integer not null default 0 check (answers_correct >= 0),
  check (answers_correct <= answers_total)
);

create index sessions_user_idx on public.learning_sessions (user_id, started_at desc);

create table public.learning_answers (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.learning_sessions (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  vocabulary_id uuid references public.vocabulary (id) on delete set null,
  direction text not null check (direction in ('forward', 'backward')),  -- forward = Deutsch → Fremdsprache
  given_answer text not null default '',
  is_correct boolean not null,
  is_repeat boolean not null default false,      -- Wiederholungsrunde: zählt weder für Lernstand noch Statistik
  answered_at timestamptz not null default now()
);

create index answers_session_idx on public.learning_answers (session_id);
create index answers_user_idx on public.learning_answers (user_id, answered_at desc);

-- Tageswerte je Benutzer (Basis für Statistik, Durchschnitte, Rangliste).
-- Wird ausschließlich per Trigger gepflegt, Benutzer können nur lesen.
create table public.daily_stats (
  user_id uuid not null references auth.users (id) on delete cascade,
  day date not null,
  answers_total integer not null default 0,
  answers_correct integer not null default 0,
  primary key (user_id, day)
);

create or replace function public.track_daily_stats()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.is_repeat then
    return new;
  end if;

  insert into public.daily_stats (user_id, day, answers_total, answers_correct)
  values (
    new.user_id,
    (new.answered_at at time zone 'Europe/Berlin')::date,
    1,
    case when new.is_correct then 1 else 0 end
  )
  on conflict (user_id, day) do update
    set answers_total = public.daily_stats.answers_total + 1,
        answers_correct = public.daily_stats.answers_correct + excluded.answers_correct;

  return new;
end;
$$;

create trigger learning_answers_track_stats
  after insert on public.learning_answers
  for each row execute function public.track_daily_stats();


-- ----------------------------------------------------------------------------
-- 7. Ansicht für Suche, Testbereiche und Buchreihenfolge
-- ----------------------------------------------------------------------------

-- security_invoker: Row Level Security der Basistabellen gilt auch hier.
-- book_order liefert die Reihenfolge "von Vokabel bis Vokabel" (Unit → Seite → Position).
create view public.vocabulary_entries
with (security_invoker = true) as
select
  vp.id as placement_id,
  vp.book_id,
  b.name as book_name,
  b.language,
  v.id as vocabulary_id,
  v.german,
  coalesce(
    (select array_agg(t.translation order by t.sort_order, t.created_at)
       from public.translations t
      where t.vocabulary_id = v.id),
    '{}'::text[]
  ) as translations,
  u.id as unit_id,
  u.unit_number,
  p.id as page_id,
  p.page_number,
  vp.position_on_page,
  row_number() over (
    partition by vp.book_id
    order by u.unit_number, p.page_number, vp.position_on_page, vp.created_at
  ) as book_order
from public.vocabulary_placements vp
join public.vocabulary v on v.id = vp.vocabulary_id
join public.books b on b.id = vp.book_id
join public.pages p on p.id = vp.page_id
join public.units u on u.id = p.unit_id;


-- ----------------------------------------------------------------------------
-- 8. Row Level Security
-- ----------------------------------------------------------------------------

alter table public.languages enable row level security;
alter table public.profiles enable row level security;
alter table public.user_settings enable row level security;
alter table public.books enable row level security;
alter table public.units enable row level security;
alter table public.pages enable row level security;
alter table public.vocabulary enable row level security;
alter table public.vocabulary_placements enable row level security;
alter table public.translations enable row level security;
alter table public.user_vocabulary_progress enable row level security;
alter table public.learning_sessions enable row level security;
alter table public.learning_answers enable row level security;
alter table public.daily_stats enable row level security;

-- Sprachen: lesbar für angemeldete Benutzer.
create policy languages_read on public.languages
  for select to authenticated using (true);

-- Profile: nur das eigene lesen/ändern. Andere Anzeigenamen erscheinen nur über get_leaderboard().
create policy profiles_select_own on public.profiles
  for select to authenticated using (id = (select auth.uid()));
create policy profiles_update_own on public.profiles
  for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- Einstellungen: nur eigene.
create policy settings_own on public.user_settings
  for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Bücher und alles darunter: nur der Besitzer.
create policy books_own on public.books
  for all to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));

create policy units_own on public.units
  for all to authenticated
  using (public.owns_book(book_id)) with check (public.owns_book(book_id));

create policy pages_own on public.pages
  for all to authenticated
  using (public.owns_book(book_id)) with check (public.owns_book(book_id));

create policy vocabulary_own on public.vocabulary
  for all to authenticated
  using (public.owns_book(book_id)) with check (public.owns_book(book_id));

create policy placements_own on public.vocabulary_placements
  for all to authenticated
  using (public.owns_book(book_id)) with check (public.owns_book(book_id));

create policy translations_own on public.translations
  for all to authenticated
  using (public.owns_book(book_id)) with check (public.owns_book(book_id));

-- Fortschritt: nur eigene Zeilen, und nur für Vokabeln, die der Benutzer selbst sehen darf
-- (das Subselect unterliegt selbst der Vokabel-Policy).
create policy progress_own on public.user_vocabulary_progress
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.vocabulary v where v.id = vocabulary_id)
  );

-- Sitzungen und Antworten: nur eigene; kein Löschen (nur über Account-Löschung).
create policy sessions_select_own on public.learning_sessions
  for select to authenticated using (user_id = (select auth.uid()));
create policy sessions_insert_own on public.learning_sessions
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy sessions_update_own on public.learning_sessions
  for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy answers_select_own on public.learning_answers
  for select to authenticated using (user_id = (select auth.uid()));
create policy answers_insert_own on public.learning_answers
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.learning_sessions s
      where s.id = session_id and s.user_id = (select auth.uid())
    )
  );

-- Tageswerte: nur lesen (geschrieben wird per Trigger).
create policy daily_stats_select_own on public.daily_stats
  for select to authenticated using (user_id = (select auth.uid()));


-- ----------------------------------------------------------------------------
-- 9. Rechte
-- ----------------------------------------------------------------------------

revoke all on all tables in schema public from anon;
revoke insert, update, delete on public.daily_stats from authenticated;
revoke insert, update, delete on public.languages from authenticated;
grant select on public.vocabulary_entries to authenticated;


-- ----------------------------------------------------------------------------
-- 10. Rangliste und Durchschnitte (nur aggregierte bzw. öffentliche Werte)
-- ----------------------------------------------------------------------------

-- Punkte je Tag (aus daily_stats), danach über den Zeitraum summiert:
--   * 2 Punkte je richtiger Antwort, pro Tag höchstens 200 Antworten gezählt
--     (Dauerübung lohnt sich, bloße Masse dominiert aber nicht)
--   * 25 Punkte Aktivitätsbonus für jeden Tag mit Lernaktivität
--   * bis zu 20 Punkte Genauigkeitsbonus (ab 20 Antworten an dem Tag)
-- Die Punkte hängen nicht von der Buchgröße ab, nur vom tatsächlichen Lernen.
-- Zurückgegeben werden ausschließlich Anzeigename, Punkte und Rang.
create or replace function public.get_leaderboard(p_period text default 'week')
returns table (rank bigint, display_name text, points bigint, is_me boolean)
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
    (s.uid = v_me)
  from scored s
  join public.profiles pr on pr.id = s.uid
  where s.pts > 0
  order by s.pts desc, pr.display_name
  limit 100;
end;
$$;

-- Durchschnitt aller Lernenden. "Gelernt" = Vokabeln ab Lernstand 2.
-- Aus Datenschutzgründen erst ab 3 Lernenden, sonst NULL (keine Rückschlüsse auf Einzelne).
create or replace function public.get_community_averages()
returns table (avg_accuracy_percent numeric, avg_learned_vocabulary numeric, learners bigint)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'Nicht angemeldet' using errcode = '28000';
  end if;

  return query
  with acc as (
    select d.user_id as uid,
           sum(d.answers_correct)::numeric / nullif(sum(d.answers_total), 0) as accuracy
    from public.daily_stats d
    group by d.user_id
    having sum(d.answers_total) > 0
  ),
  lrn as (
    select p.user_id as uid, count(*) filter (where p.learning_level >= 2) as learned
    from public.user_vocabulary_progress p
    group by p.user_id
  ),
  joined as (
    select acc.accuracy, coalesce(lrn.learned, 0) as learned
    from acc left join lrn on lrn.uid = acc.uid
  )
  select
    case when count(*) >= 3 then round(100 * avg(j.accuracy), 1) end,
    case when count(*) >= 3 then round(avg(j.learned), 1) end,
    count(*)::bigint
  from joined j;
end;
$$;

revoke all on function public.get_leaderboard(text) from public, anon;
revoke all on function public.get_community_averages() from public, anon;
grant execute on function public.get_leaderboard(text) to authenticated;
grant execute on function public.get_community_averages() to authenticated;


-- ===== 0002_functions.sql =====
-- ============================================================================
-- Vokabeltrainer – Funktionen für die App (Supabase / PostgreSQL)
--
-- Einspielen: Supabase Dashboard → SQL Editor → New query → komplett einfügen → Run.
-- Voraussetzung: 0001_schema.sql wurde bereits ausgeführt. Diese Datei einmal ausführen
-- (sie ist wiederholbar: alle Funktionen werden per "create or replace" angelegt).
--
-- Alle Funktionen laufen mit den Rechten des angemeldeten Benutzers ("security invoker"),
-- Row Level Security bleibt also überall aktiv. Mehrstufige Änderungen (Vokabel speichern,
-- Import, Lernrunde speichern) laufen atomar: entweder ganz oder gar nicht.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- Hilfsfunktionen
-- ----------------------------------------------------------------------------

-- Gleiche Normalisierung wie die generierten Spalten german_key / translation_key.
create or replace function public.norm_text(p text)
returns text
language sql
immutable
as $$
  select regexp_replace(lower(btrim(p)), '\s+', ' ', 'g');
$$;

-- Übersetzungen zu einer Vokabel hinzufügen (vorhandene bleiben, Duplikate werden übersprungen).
create or replace function public.merge_translations(p_book_id uuid, p_vocab uuid, p_list text[])
returns void
language plpgsql
set search_path = public
as $$
declare
  v_t text;
  v_sort integer;
begin
  select coalesce(max(sort_order), -1) into v_sort from public.translations where vocabulary_id = p_vocab;
  foreach v_t in array coalesce(p_list, '{}') loop
    v_t := btrim(coalesce(v_t, ''));
    continue when v_t = '';
    if not exists (
      select 1 from public.translations
      where vocabulary_id = p_vocab and translation_key = public.norm_text(v_t)
    ) then
      v_sort := v_sort + 1;
      insert into public.translations (book_id, vocabulary_id, translation, sort_order)
      values (p_book_id, p_vocab, v_t, v_sort);
    end if;
  end loop;
end;
$$;

-- Vokabeln ohne Platzierung (nach Löschen von Seiten/Units) aufräumen.
create or replace function public.cleanup_orphan_vocabulary(p_book_id uuid)
returns void
language sql
set search_path = public
as $$
  delete from public.vocabulary v
  where v.book_id = p_book_id
    and not exists (select 1 from public.vocabulary_placements vp where vp.vocabulary_id = v.id);
$$;


-- ----------------------------------------------------------------------------
-- Vokabeleingabe
-- ----------------------------------------------------------------------------

-- Eine Zeile der Eingabetabelle speichern.
--  * p_placement_id NULL  → neue Zeile auf Unit/Seite. Gibt es die deutsche Vokabel im Buch schon
--    (egal auf welcher Seite), wird sie wiederverwendet und um die neuen Übersetzungen ergänzt.
--  * p_placement_id gesetzt → vorhandene Zeile ändern (Wort umbenennen, Übersetzungen ersetzen).
-- Unit und Seite werden bei Bedarf angelegt. Eine Seite gehört immer zu genau einer Unit.
create or replace function public.save_vocab_entry(
  p_book_id uuid,
  p_unit_number integer,
  p_page_number integer,
  p_placement_id uuid,
  p_german text,
  p_translations text[],
  p_position integer default null
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_german text := btrim(coalesce(p_german, ''));
  v_clean text[] := '{}';
  v_keys text[] := '{}';
  v_t text;
  v_key text;
  v_unit_id uuid;
  v_page_id uuid;
  v_page_unit uuid;
  v_vocab_id uuid;
  v_old_vocab uuid;
  v_other_vocab uuid;
  v_placement_id uuid;
  v_placement_book uuid;
  v_merged boolean := false;
  v_existing boolean;
  v_pos integer;
  v_i integer;
begin
  if char_length(v_german) = 0 then
    raise exception 'Die deutsche Vokabel darf nicht leer sein.' using errcode = '22023';
  end if;

  foreach v_t in array coalesce(p_translations, '{}') loop
    v_t := btrim(coalesce(v_t, ''));
    if v_t <> '' then
      v_key := public.norm_text(v_t);
      if not (v_key = any (v_keys)) then
        v_keys := v_keys || v_key;
        v_clean := v_clean || v_t;
      end if;
    end if;
  end loop;

  if coalesce(array_length(v_clean, 1), 0) = 0 then
    raise exception 'Mindestens eine Übersetzung ist nötig.' using errcode = '22023';
  end if;

  if not public.owns_book(p_book_id) then
    raise exception 'Buch nicht gefunden.' using errcode = '42501';
  end if;

  if p_placement_id is null then
    -- ---- neue Zeile -------------------------------------------------------
    if p_unit_number is null or p_page_number is null then
      raise exception 'Unit und Seite müssen angegeben werden.' using errcode = '22023';
    end if;

    insert into public.units (book_id, unit_number)
    values (p_book_id, p_unit_number)
    on conflict (book_id, unit_number) do nothing;
    select id into v_unit_id from public.units where book_id = p_book_id and unit_number = p_unit_number;

    select id, unit_id into v_page_id, v_page_unit
      from public.pages where book_id = p_book_id and page_number = p_page_number;
    if v_page_id is null then
      insert into public.pages (book_id, unit_id, page_number)
      values (p_book_id, v_unit_id, p_page_number)
      returning id into v_page_id;
    elsif v_page_unit <> v_unit_id then
      raise exception 'Seite % gehört bereits zu Unit %.',
        p_page_number, (select unit_number from public.units where id = v_page_unit)
        using errcode = 'P0001', hint = 'page_belongs_to_other_unit';
    end if;

    select id into v_vocab_id
      from public.vocabulary where book_id = p_book_id and german_key = public.norm_text(v_german);
    v_existing := v_vocab_id is not null;
    if not v_existing then
      insert into public.vocabulary (book_id, german) values (p_book_id, v_german) returning id into v_vocab_id;
    end if;
    v_merged := v_existing;

    select id into v_placement_id
      from public.vocabulary_placements where vocabulary_id = v_vocab_id and page_id = v_page_id;
    if v_placement_id is null then
      v_pos := coalesce(
        p_position,
        (select coalesce(max(position_on_page), 0) + 1 from public.vocabulary_placements where page_id = v_page_id)
      );
      insert into public.vocabulary_placements (book_id, vocabulary_id, page_id, position_on_page)
      values (p_book_id, v_vocab_id, v_page_id, v_pos)
      returning id into v_placement_id;
    end if;

    perform public.merge_translations(p_book_id, v_vocab_id, v_clean);

  else
    -- ---- vorhandene Zeile ändern -----------------------------------------
    select vocabulary_id, book_id, page_id
      into v_old_vocab, v_placement_book, v_page_id
      from public.vocabulary_placements where id = p_placement_id;
    if v_old_vocab is null or v_placement_book <> p_book_id then
      raise exception 'Eintrag nicht gefunden.' using errcode = 'P0002';
    end if;
    v_placement_id := p_placement_id;

    select id into v_other_vocab
      from public.vocabulary
      where book_id = p_book_id and german_key = public.norm_text(v_german) and id <> v_old_vocab;

    if v_other_vocab is null then
      -- normale Änderung: Wort ggf. umbenennen, Übersetzungen exakt auf die Liste setzen
      v_vocab_id := v_old_vocab;
      update public.vocabulary set german = v_german where id = v_vocab_id and german <> v_german;

      delete from public.translations
       where vocabulary_id = v_vocab_id and not (translation_key = any (v_keys));

      for v_i in 1 .. array_length(v_clean, 1) loop
        update public.translations
           set translation = v_clean[v_i], sort_order = v_i - 1
         where vocabulary_id = v_vocab_id and translation_key = v_keys[v_i];
        if not found then
          insert into public.translations (book_id, vocabulary_id, translation, sort_order)
          values (p_book_id, v_vocab_id, v_clean[v_i], v_i - 1);
        end if;
      end loop;
    else
      -- Umbenennung trifft eine andere vorhandene Vokabel → zusammenführen
      v_vocab_id := v_other_vocab;
      v_merged := true;

      if exists (select 1 from public.vocabulary_placements where vocabulary_id = v_other_vocab and page_id = v_page_id) then
        delete from public.vocabulary_placements where id = p_placement_id;
        select id into v_placement_id
          from public.vocabulary_placements where vocabulary_id = v_other_vocab and page_id = v_page_id;
      else
        update public.vocabulary_placements set vocabulary_id = v_other_vocab where id = p_placement_id;
      end if;

      perform public.merge_translations(p_book_id, v_other_vocab, v_clean);

      if not exists (select 1 from public.vocabulary_placements where vocabulary_id = v_old_vocab) then
        delete from public.vocabulary where id = v_old_vocab;
      end if;
    end if;

    if p_position is not null then
      update public.vocabulary_placements set position_on_page = p_position where id = v_placement_id;
    end if;
  end if;

  return jsonb_build_object(
    'placement_id', v_placement_id,
    'vocabulary_id', v_vocab_id,
    'german', (select german from public.vocabulary where id = v_vocab_id),
    'merged', v_merged,
    'position', (select position_on_page from public.vocabulary_placements where id = v_placement_id),
    'translations', coalesce(
      (select jsonb_agg(t.translation order by t.sort_order, t.created_at)
         from public.translations t where t.vocabulary_id = v_vocab_id),
      '[]'::jsonb)
  );
end;
$$;

-- Eine Zeile entfernen; die Vokabel selbst verschwindet nur, wenn sie nirgends mehr steht.
create or replace function public.delete_vocab_entry(p_placement_id uuid)
returns void
language plpgsql
set search_path = public
as $$
declare
  v_vocab uuid;
begin
  delete from public.vocabulary_placements where id = p_placement_id returning vocabulary_id into v_vocab;
  if v_vocab is not null and not exists (
    select 1 from public.vocabulary_placements where vocabulary_id = v_vocab
  ) then
    delete from public.vocabulary where id = v_vocab;
  end if;
end;
$$;

-- Eine Seite einer anderen Unit zuordnen (Unit wird bei Bedarf angelegt).
create or replace function public.move_page_to_unit(p_book_id uuid, p_page_number integer, p_unit_number integer)
returns void
language plpgsql
set search_path = public
as $$
declare
  v_unit_id uuid;
begin
  if not public.owns_book(p_book_id) then
    raise exception 'Buch nicht gefunden.' using errcode = '42501';
  end if;
  insert into public.units (book_id, unit_number) values (p_book_id, p_unit_number)
  on conflict (book_id, unit_number) do nothing;
  select id into v_unit_id from public.units where book_id = p_book_id and unit_number = p_unit_number;
  update public.pages set unit_id = v_unit_id where book_id = p_book_id and page_number = p_page_number;
end;
$$;

create or replace function public.delete_page(p_book_id uuid, p_page_number integer)
returns void
language plpgsql
set search_path = public
as $$
begin
  if not public.owns_book(p_book_id) then
    raise exception 'Buch nicht gefunden.' using errcode = '42501';
  end if;
  delete from public.pages where book_id = p_book_id and page_number = p_page_number;
  perform public.cleanup_orphan_vocabulary(p_book_id);
end;
$$;

create or replace function public.delete_unit(p_book_id uuid, p_unit_number integer)
returns void
language plpgsql
set search_path = public
as $$
begin
  if not public.owns_book(p_book_id) then
    raise exception 'Buch nicht gefunden.' using errcode = '42501';
  end if;
  delete from public.units where book_id = p_book_id and unit_number = p_unit_number;
  perform public.cleanup_orphan_vocabulary(p_book_id);
end;
$$;


-- ----------------------------------------------------------------------------
-- Lesen (Ergebnisse als JSON, damit keine 1000-Zeilen-Grenze der API greift)
-- ----------------------------------------------------------------------------

create or replace function public.get_book_summaries()
returns table (
  id uuid, name text, language text, description text, created_at timestamptz,
  unit_count integer, page_count integer, vocab_count integer, mastery_percent numeric
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
    ), 0)
  from public.books b
  order by b.created_at desc;
$$;

-- Units mit ihren Seiten (und Anzahl Vokabeln je Seite).
create or replace function public.get_book_outline(p_book_id uuid)
returns jsonb
language sql
stable
set search_path = public
as $$
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'unit_id', u.id,
      'unit_number', u.unit_number,
      'name', u.name,
      'pages', coalesce((
        select jsonb_agg(
                 jsonb_build_object(
                   'page_id', p.id,
                   'page_number', p.page_number,
                   'vocab_count', (select count(*) from public.vocabulary_placements vp where vp.page_id = p.id)
                 ) order by p.page_number)
          from public.pages p where p.unit_id = u.id
      ), '[]'::jsonb)
    ) order by u.unit_number), '[]'::jsonb)
  from public.units u
  where u.book_id = p_book_id;
$$;

-- Alle Einträge eines Buches in Buchreihenfolge (Unit → Seite → Position).
create or replace function public.get_book_entries(p_book_id uuid)
returns jsonb
language sql
stable
set search_path = public
as $$
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'placement_id', e.placement_id,
      'vocabulary_id', e.vocabulary_id,
      'german', e.german,
      'translations', to_jsonb(e.translations),
      'unit_number', e.unit_number,
      'page_number', e.page_number,
      'position', e.position_on_page,
      'order', e.book_order
    ) order by e.book_order), '[]'::jsonb)
  from public.vocabulary_entries e
  where e.book_id = p_book_id;
$$;

-- Eine Seite mit ihren Zeilen (für die Eingabetabelle).
create or replace function public.get_page_entries(p_book_id uuid, p_page_number integer)
returns jsonb
language plpgsql
stable
set search_path = public
as $$
declare
  v_page_id uuid;
  v_unit_number integer;
begin
  select p.id, u.unit_number into v_page_id, v_unit_number
    from public.pages p join public.units u on u.id = p.unit_id
   where p.book_id = p_book_id and p.page_number = p_page_number;

  return jsonb_build_object(
    'page', case when v_page_id is null then null
                 else jsonb_build_object('page_id', v_page_id, 'unit_number', v_unit_number) end,
    'entries', coalesce((
      select jsonb_agg(
               jsonb_build_object(
                 'placement_id', vp.id,
                 'vocabulary_id', v.id,
                 'german', v.german,
                 'position', vp.position_on_page,
                 'translations', coalesce((
                    select jsonb_agg(t.translation order by t.sort_order, t.created_at)
                      from public.translations t where t.vocabulary_id = v.id), '[]'::jsonb)
               ) order by vp.position_on_page, vp.created_at)
        from public.vocabulary_placements vp
        join public.vocabulary v on v.id = vp.vocabulary_id
       where vp.page_id = v_page_id
    ), '[]'::jsonb)
  );
end;
$$;

-- Vokabeln samt Lernstand des Benutzers (Grundlage für die Lernrunde).
create or replace function public.get_learning_pool(p_language text default null, p_book_id uuid default null)
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
      'level', coalesce(pr.learning_level, 1)::float8
    )), '[]'::jsonb)
  from public.vocabulary v
  join public.books b on b.id = v.book_id
  left join public.user_vocabulary_progress pr
    on pr.vocabulary_id = v.id and pr.user_id = (select auth.uid())
  where (p_book_id is null or v.book_id = p_book_id)
    and (p_language is null or b.language = p_language);
$$;

-- Suche in deutschen und fremdsprachigen Begriffen, optional gefiltert.
create or replace function public.search_vocabulary(
  p_query text,
  p_book_id uuid default null,
  p_language text default null,
  p_unit_number integer default null,
  p_page_number integer default null,
  p_limit integer default 100
)
returns table (
  placement_id uuid, vocabulary_id uuid, german text, translations text[],
  book_id uuid, book_name text, language text, unit_number integer, page_number integer
)
language plpgsql
stable
set search_path = public
as $$
declare
  v_q text := btrim(coalesce(p_query, ''));
  v_pattern text;
begin
  if v_q = '' then
    return;
  end if;
  v_pattern := '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%';

  return query
  select e.placement_id, e.vocabulary_id, e.german, e.translations,
         e.book_id, e.book_name, e.language, e.unit_number, e.page_number
    from public.vocabulary_entries e
   where (e.german ilike v_pattern
          or exists (select 1 from unnest(e.translations) t where t ilike v_pattern))
     and (p_book_id is null or e.book_id = p_book_id)
     and (p_language is null or e.language = p_language)
     and (p_unit_number is null or e.unit_number = p_unit_number)
     and (p_page_number is null or e.page_number = p_page_number)
   order by e.book_name, e.book_order
   limit least(greatest(coalesce(p_limit, 100), 1), 200);
end;
$$;


-- ----------------------------------------------------------------------------
-- Lernrunden speichern
-- ----------------------------------------------------------------------------

-- Speichert eine abgeschlossene Haupt-Runde (Lernen oder Test) atomar:
--  * Sitzung + alle Antworten (daraus pflegt ein Trigger die Tageswerte)
--  * neue Lernstände (nur wenn p_affects_level = true; Tests ändern sie standardmäßig nicht)
-- p_answers:        [{vocabulary_id, direction, given_answer, is_correct}, …]
-- p_level_updates:  [{vocabulary_id, level}, …]   (Stufen 1–5 in 0,5er-Schritten)
create or replace function public.submit_session(
  p_book_id uuid,
  p_mode text,
  p_affects_level boolean,
  p_started_at timestamptz,
  p_answers jsonb,
  p_level_updates jsonb
)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  v_session uuid;
  v_total integer;
  v_correct integer;
  v_vocabs integer;
  u record;
begin
  if v_me is null then
    raise exception 'Nicht angemeldet' using errcode = '28000';
  end if;
  if jsonb_typeof(p_answers) is distinct from 'array' or jsonb_array_length(p_answers) = 0 then
    raise exception 'Keine Antworten übermittelt.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_answers) > 1000 then
    raise exception 'Zu viele Antworten auf einmal.' using errcode = '22023';
  end if;

  select count(*),
         count(*) filter (where (a ->> 'is_correct')::boolean),
         count(distinct a ->> 'vocabulary_id')
    into v_total, v_correct, v_vocabs
    from jsonb_array_elements(p_answers) a;

  insert into public.learning_sessions
    (book_id, mode, affects_level, started_at, finished_at, vocabulary_count, answers_total, answers_correct)
  values
    (p_book_id, p_mode, coalesce(p_affects_level, false), coalesce(p_started_at, now()), now(),
     v_vocabs, v_total, v_correct)
  returning id into v_session;

  insert into public.learning_answers (session_id, vocabulary_id, direction, given_answer, is_correct, is_repeat)
  select v_session, (a ->> 'vocabulary_id')::uuid, a ->> 'direction',
         left(coalesce(a ->> 'given_answer', ''), 500), (a ->> 'is_correct')::boolean, false
    from jsonb_array_elements(p_answers) a;

  if coalesce(p_affects_level, false) and jsonb_typeof(p_level_updates) = 'array' then
    for u in
      select (x ->> 'vocabulary_id')::uuid as vid, (x ->> 'level')::numeric as lvl
        from jsonb_array_elements(p_level_updates) x
    loop
      insert into public.user_vocabulary_progress
        (user_id, vocabulary_id, learning_level, times_correct, times_wrong, last_answered_at)
      values (
        v_me, u.vid, u.lvl,
        (select count(*) from jsonb_array_elements(p_answers) a
          where (a ->> 'vocabulary_id')::uuid = u.vid and (a ->> 'is_correct')::boolean),
        (select count(*) from jsonb_array_elements(p_answers) a
          where (a ->> 'vocabulary_id')::uuid = u.vid and not (a ->> 'is_correct')::boolean),
        now()
      )
      on conflict (user_id, vocabulary_id) do update
        set learning_level = excluded.learning_level,
            times_correct = public.user_vocabulary_progress.times_correct + excluded.times_correct,
            times_wrong = public.user_vocabulary_progress.times_wrong + excluded.times_wrong,
            last_answered_at = now();
    end loop;
  end if;

  return v_session;
end;
$$;

-- Antworten der Wiederholungsrunde ("Fehler wiederholen") nachtragen.
-- Sie ändern weder den Lernstand noch die Tageswerte (is_repeat = true).
create or replace function public.add_repeat_answers(p_session_id uuid, p_answers jsonb)
returns integer
language plpgsql
set search_path = public
as $$
declare
  v_n integer;
begin
  if jsonb_typeof(p_answers) is distinct from 'array' or jsonb_array_length(p_answers) = 0 then
    return 0;
  end if;
  if jsonb_array_length(p_answers) > 1000 then
    raise exception 'Zu viele Antworten auf einmal.' using errcode = '22023';
  end if;

  insert into public.learning_answers (session_id, vocabulary_id, direction, given_answer, is_correct, is_repeat)
  select p_session_id, (a ->> 'vocabulary_id')::uuid, a ->> 'direction',
         left(coalesce(a ->> 'given_answer', ''), 500), (a ->> 'is_correct')::boolean, true
    from jsonb_array_elements(p_answers) a;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;


-- ----------------------------------------------------------------------------
-- Statistik des Benutzers
-- ----------------------------------------------------------------------------

-- "Gelernt" = Vokabeln ab Stufe 2. Fortschritt (mastery_percent) = durchschnittlicher
-- Lernstand, Stufe 1 = 0 %, Stufe 5 = 100 %. Vokabeln ohne Abfrage zählen als Stufe 1.
-- "Zu wiederholen" = Vokabeln auf Stufe 1, die schon einmal falsch beantwortet wurden.
create or replace function public.get_my_stats(p_book_id uuid default null)
returns jsonb
language plpgsql
stable
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  v_today date := timezone('Europe/Berlin', now())::date;
  v_week date := date_trunc('week', timezone('Europe/Berlin', now()))::date;
  v_levels jsonb;
  v_total integer;
  v_learned integer;
  v_mastery numeric;
  v_problem integer;
  v_ans_total bigint;
  v_ans_correct bigint;
  v_today_vocab integer;
  v_week_vocab integer;
  v_today_answers bigint;
  v_week_answers bigint;
  v_history jsonb;
begin
  if v_me is null then
    raise exception 'Nicht angemeldet' using errcode = '28000';
  end if;

  with lv as (
    select coalesce(pr.learning_level, 1) as raw, coalesce(pr.times_wrong, 0) as tw
      from public.vocabulary v
      left join public.user_vocabulary_progress pr
        on pr.vocabulary_id = v.id and pr.user_id = v_me
     where p_book_id is null or v.book_id = p_book_id
  )
  select
    jsonb_build_object(
      '1', count(*) filter (where floor(raw) = 1),
      '2', count(*) filter (where floor(raw) = 2),
      '3', count(*) filter (where floor(raw) = 3),
      '4', count(*) filter (where floor(raw) = 4),
      '5', count(*) filter (where floor(raw) = 5)),
    count(*)::integer,
    (count(*) filter (where raw >= 2))::integer,
    coalesce(round(100 * avg((raw - 1) / 4.0)), 0),
    (count(*) filter (where raw < 2 and tw > 0))::integer
  into v_levels, v_total, v_learned, v_mastery, v_problem
  from lv;

  select coalesce(sum(answers_total), 0), coalesce(sum(answers_correct), 0)
    into v_ans_total, v_ans_correct
    from public.daily_stats where user_id = v_me;

  select coalesce(sum(answers_total) filter (where day = v_today), 0),
         coalesce(sum(answers_total) filter (where day >= v_week), 0)
    into v_today_answers, v_week_answers
    from public.daily_stats where user_id = v_me;

  select count(distinct vocabulary_id) filter (
           where timezone('Europe/Berlin', answered_at)::date = v_today),
         count(distinct vocabulary_id) filter (
           where timezone('Europe/Berlin', answered_at)::date >= v_week)
    into v_today_vocab, v_week_vocab
    from public.learning_answers
   where user_id = v_me and not is_repeat;

  select coalesce(jsonb_agg(
           jsonb_build_object(
             'day', (v_today - (29 - g.n))::text,
             'total', coalesce(ds.answers_total, 0),
             'correct', coalesce(ds.answers_correct, 0)
           ) order by g.n), '[]'::jsonb)
    into v_history
    from generate_series(0, 29) as g(n)
    left join public.daily_stats ds on ds.user_id = v_me and ds.day = v_today - (29 - g.n);

  return jsonb_build_object(
    'level_counts', v_levels,
    'vocab_total', v_total,
    'learned', v_learned,
    'mastery_percent', v_mastery,
    'due_problem', v_problem,
    'answers_total', v_ans_total,
    'answers_correct', v_ans_correct,
    'accuracy_percent', case when v_ans_total > 0 then round(100.0 * v_ans_correct / v_ans_total, 1) end,
    'today_vocab', v_today_vocab,
    'today_answers', v_today_answers,
    'week_vocab', v_week_vocab,
    'week_answers', v_week_answers,
    'history', v_history
  );
end;
$$;


-- ----------------------------------------------------------------------------
-- Export / Import (JSON)
-- ----------------------------------------------------------------------------

-- Exportiert Buch, Units, Seiten, Vokabeln, Übersetzungen. Die Reihenfolge der Vokabeln in
-- "vocabulary" ist ihre Position auf der Seite. Lernfortschritt, Statistik und Kontodaten
-- gehören nicht dazu.
create or replace function public.export_book(p_book_id uuid)
returns jsonb
language plpgsql
stable
set search_path = public
as $$
declare
  v_result jsonb;
begin
  select jsonb_build_object(
    'format', 'vokabeltrainer-book',
    'version', 1,
    'book', jsonb_build_object('name', b.name, 'language', b.language, 'description', b.description),
    'units', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'number', u.unit_number,
          'name', u.name,
          'pages', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'number', p.page_number,
                'vocabulary', coalesce((
                  select jsonb_agg(
                    jsonb_build_object(
                      'german', v.german,
                      'translations', coalesce((
                        select jsonb_agg(t.translation order by t.sort_order, t.created_at)
                          from public.translations t where t.vocabulary_id = v.id), '[]'::jsonb)
                    ) order by vp.position_on_page, vp.created_at)
                  from public.vocabulary_placements vp
                  join public.vocabulary v on v.id = vp.vocabulary_id
                  where vp.page_id = p.id), '[]'::jsonb)
              ) order by p.page_number)
            from public.pages p where p.unit_id = u.id), '[]'::jsonb)
        ) order by u.unit_number)
      from public.units u where u.book_id = b.id), '[]'::jsonb)
  )
  into v_result
  from public.books b
  where b.id = p_book_id;

  if v_result is null then
    raise exception 'Buch nicht gefunden.' using errcode = 'P0002';
  end if;
  return v_result;
end;
$$;

-- Legt aus einer Exportdatei ein NEUES eigenes Buch an (alles oder nichts).
-- Doppelte deutsche Vokabeln werden zusammengeführt, Übersetzungen vereinigt.
create or replace function public.import_book(p_payload jsonb, p_name text default null)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_book uuid;
  v_name text;
  v_lang text;
  v_unit jsonb;
  v_page jsonb;
  v_entry jsonb;
  v_unit_id uuid;
  v_page_id uuid;
  v_unit_number integer;
  v_page_number integer;
  v_german text;
  v_clean text[];
  v_keys text[];
  v_t jsonb;
  v_txt text;
  v_vocab uuid;
  v_pos integer;
  v_count integer := 0;
  v_seen_units integer[] := '{}';
  v_seen_pages integer[] := '{}';
begin
  if jsonb_typeof(p_payload) is distinct from 'object'
     or p_payload ->> 'format' is distinct from 'vokabeltrainer-book' then
    raise exception 'Das ist keine gültige Vokabeltrainer-Datei.' using errcode = '22023';
  end if;
  if p_payload ->> 'version' is distinct from '1' then
    raise exception 'Diese Dateiversion wird nicht unterstützt.' using errcode = '22023';
  end if;
  if jsonb_typeof(p_payload -> 'book') is distinct from 'object' then
    raise exception 'Buchangaben fehlen.' using errcode = '22023';
  end if;

  v_name := left(btrim(coalesce(nullif(btrim(p_name), ''), p_payload #>> '{book,name}', '')), 120);
  if v_name = '' then
    raise exception 'Das Buch braucht einen Namen.' using errcode = '22023';
  end if;
  v_lang := p_payload #>> '{book,language}';
  if v_lang is null or not exists (select 1 from public.languages where code = v_lang) then
    raise exception 'Unbekannte Sprache: %', coalesce(v_lang, '(leer)') using errcode = '22023';
  end if;
  if jsonb_typeof(p_payload -> 'units') is distinct from 'array' then
    raise exception 'Die Datei enthält keine Units.' using errcode = '22023';
  end if;

  insert into public.books (name, language, description)
  values (v_name, v_lang,
          nullif(left(btrim(coalesce(p_payload #>> '{book,description}', '')), 1000), ''))
  returning id into v_book;

  for v_unit in select value from jsonb_array_elements(p_payload -> 'units') loop
    if jsonb_typeof(v_unit) is distinct from 'object'
       or coalesce(v_unit ->> 'number', '') !~ '^[0-9]{1,6}$' then
      raise exception 'Eine Unit hat keine gültige Nummer.' using errcode = '22023';
    end if;
    v_unit_number := (v_unit ->> 'number')::integer;
    if v_unit_number = any (v_seen_units) then
      raise exception 'Unit % kommt mehrfach vor.', v_unit_number using errcode = '22023';
    end if;
    v_seen_units := v_seen_units || v_unit_number;

    insert into public.units (book_id, unit_number, name)
    values (v_book, v_unit_number, nullif(left(btrim(coalesce(v_unit ->> 'name', '')), 120), ''))
    returning id into v_unit_id;

    if jsonb_typeof(coalesce(v_unit -> 'pages', '[]'::jsonb)) is distinct from 'array' then
      raise exception 'Unit %: Seiten haben ein ungültiges Format.', v_unit_number using errcode = '22023';
    end if;

    for v_page in select value from jsonb_array_elements(coalesce(v_unit -> 'pages', '[]'::jsonb)) loop
      if jsonb_typeof(v_page) is distinct from 'object'
         or coalesce(v_page ->> 'number', '') !~ '^[0-9]{1,6}$'
         or (v_page ->> 'number')::integer < 1 then
        raise exception 'Unit %: Eine Seite hat keine gültige Nummer.', v_unit_number using errcode = '22023';
      end if;
      v_page_number := (v_page ->> 'number')::integer;
      if v_page_number = any (v_seen_pages) then
        raise exception 'Seite % kommt mehrfach vor.', v_page_number using errcode = '22023';
      end if;
      v_seen_pages := v_seen_pages || v_page_number;

      insert into public.pages (book_id, unit_id, page_number)
      values (v_book, v_unit_id, v_page_number)
      returning id into v_page_id;

      if jsonb_typeof(coalesce(v_page -> 'vocabulary', '[]'::jsonb)) is distinct from 'array' then
        raise exception 'Seite %: Vokabeln haben ein ungültiges Format.', v_page_number using errcode = '22023';
      end if;

      v_pos := 0;
      for v_entry in select value from jsonb_array_elements(coalesce(v_page -> 'vocabulary', '[]'::jsonb)) loop
        v_count := v_count + 1;
        if v_count > 20000 then
          raise exception 'Die Datei enthält zu viele Vokabeln (Maximum 20000).' using errcode = '22023';
        end if;

        if jsonb_typeof(v_entry) is distinct from 'object'
           or jsonb_typeof(v_entry -> 'german') is distinct from 'string'
           or btrim(v_entry ->> 'german') = ''
           or char_length(btrim(v_entry ->> 'german')) > 200
           or jsonb_typeof(v_entry -> 'translations') is distinct from 'array' then
          raise exception 'Seite %: Ungültige Vokabel (Eintrag %).', v_page_number, v_pos + 1 using errcode = '22023';
        end if;
        v_german := btrim(v_entry ->> 'german');

        v_clean := '{}';
        v_keys := '{}';
        for v_t in select value from jsonb_array_elements(v_entry -> 'translations') loop
          if jsonb_typeof(v_t) is distinct from 'string' then
            raise exception 'Seite %: Übersetzungen von "%" müssen Text sein.', v_page_number, v_german using errcode = '22023';
          end if;
          v_txt := btrim(v_t #>> '{}');
          if v_txt <> '' then
            if char_length(v_txt) > 200 then
              raise exception 'Seite %: Übersetzung von "%" ist zu lang.', v_page_number, v_german using errcode = '22023';
            end if;
            if not (public.norm_text(v_txt) = any (v_keys)) then
              v_keys := v_keys || public.norm_text(v_txt);
              v_clean := v_clean || v_txt;
            end if;
          end if;
        end loop;
        if coalesce(array_length(v_clean, 1), 0) = 0 then
          raise exception 'Seite %: "%" hat keine Übersetzung.', v_page_number, v_german using errcode = '22023';
        end if;

        select id into v_vocab from public.vocabulary
         where book_id = v_book and german_key = public.norm_text(v_german);
        if v_vocab is null then
          insert into public.vocabulary (book_id, german) values (v_book, v_german) returning id into v_vocab;
        end if;

        v_pos := v_pos + 1;
        insert into public.vocabulary_placements (book_id, vocabulary_id, page_id, position_on_page)
        values (v_book, v_vocab, v_page_id, v_pos)
        on conflict (vocabulary_id, page_id) do nothing;

        perform public.merge_translations(v_book, v_vocab, v_clean);
      end loop;
    end loop;
  end loop;

  return v_book;
end;
$$;


-- ----------------------------------------------------------------------------
-- Rechte: nur angemeldete Benutzer dürfen die Funktionen aufrufen
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
         'norm_text', 'merge_translations', 'cleanup_orphan_vocabulary',
         'save_vocab_entry', 'delete_vocab_entry', 'move_page_to_unit', 'delete_page', 'delete_unit',
         'get_book_summaries', 'get_book_outline', 'get_book_entries', 'get_page_entries',
         'get_learning_pool', 'search_vocabulary',
         'submit_session', 'add_repeat_answers', 'get_my_stats',
         'export_book', 'import_book')
  loop
    execute format('revoke all on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;
end;
$$;


-- ===== 0003_german_alts.sql =====
-- ============================================================================
-- Vokabeltrainer – 0003: mehrere deutsche Lösungen je Vokabel
--
-- Einspielen: Supabase Dashboard → SQL Editor → New query → komplett einfügen → Run.
-- Voraussetzung: 0001 und 0002 wurden bereits ausgeführt. Die Datei ist wiederholbar.
--
-- Bisher hatte jede Vokabel EIN deutsches Hauptwort und mehrere Übersetzungen. Jetzt können
-- auch auf der deutschen Seite mehrere gleichwertige Lösungen stehen (Spalte german_alts).
-- ============================================================================

alter table public.vocabulary
  add column if not exists german_alts text[] not null default '{}';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'vocabulary_german_alts_size') then
    alter table public.vocabulary add constraint vocabulary_german_alts_size check (cardinality(german_alts) <= 20);
  end if;
end;
$$;

-- Liste bereinigen: trimmen, leere und doppelte Einträge (nach norm_text) entfernen,
-- Einträge gleich dem Hauptwort (p_exclude) weglassen.
create or replace function public.clean_text_list(p_list text[], p_exclude text default null)
returns text[]
language plpgsql
immutable
set search_path = public
as $$
declare
  v_out text[] := '{}';
  v_keys text[] := '{}';
  v_t text;
  v_k text;
begin
  if p_exclude is not null then
    v_keys := array[public.norm_text(p_exclude)];
  end if;
  foreach v_t in array coalesce(p_list, '{}') loop
    v_t := btrim(coalesce(v_t, ''));
    continue when v_t = '';
    if char_length(v_t) > 200 then
      raise exception 'Ein Eintrag ist zu lang (maximal 200 Zeichen).' using errcode = '22023';
    end if;
    v_k := public.norm_text(v_t);
    if not (v_k = any (v_keys)) then
      v_keys := v_keys || v_k;
      v_out := v_out || v_t;
    end if;
  end loop;
  if cardinality(v_out) > 20 then
    raise exception 'Zu viele Lösungen (maximal 20).' using errcode = '22023';
  end if;
  return v_out;
end;
$$;

-- Zwei Listen vereinigen (Reihenfolge: erst a, dann neue aus b).
create or replace function public.merge_text_lists(p_a text[], p_b text[], p_exclude text default null)
returns text[]
language sql
immutable
set search_path = public
as $$
  select public.clean_text_list(coalesce(p_a, '{}') || coalesce(p_b, '{}'), p_exclude);
$$;

-- Ansicht um die deutschen Zusatzlösungen erweitern (neue Spalte ganz am Ende).
create or replace view public.vocabulary_entries
with (security_invoker = true) as
select
  vp.id as placement_id,
  vp.book_id,
  b.name as book_name,
  b.language,
  v.id as vocabulary_id,
  v.german,
  coalesce(
    (select array_agg(t.translation order by t.sort_order, t.created_at)
       from public.translations t
      where t.vocabulary_id = v.id),
    '{}'::text[]
  ) as translations,
  u.id as unit_id,
  u.unit_number,
  p.id as page_id,
  p.page_number,
  vp.position_on_page,
  row_number() over (
    partition by vp.book_id
    order by u.unit_number, p.page_number, vp.position_on_page, vp.created_at
  ) as book_order,
  v.german_alts
from public.vocabulary_placements vp
join public.vocabulary v on v.id = vp.vocabulary_id
join public.books b on b.id = vp.book_id
join public.pages p on p.id = vp.page_id
join public.units u on u.id = p.unit_id;

grant select on public.vocabulary_entries to authenticated;


-- Alte Signatur (ohne p_german_alts) entfernen, sonst wären Aufrufe mehrdeutig.
drop function if exists public.save_vocab_entry(uuid, integer, integer, uuid, text, text[], integer);

create or replace function public.save_vocab_entry(
  p_book_id uuid,
  p_unit_number integer,
  p_page_number integer,
  p_placement_id uuid,
  p_german text,
  p_translations text[],
  p_position integer default null,
  p_german_alts text[] default '{}'
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_german text := btrim(coalesce(p_german, ''));
  v_clean text[] := '{}';
  v_keys text[] := '{}';
  v_t text;
  v_key text;
  v_unit_id uuid;
  v_page_id uuid;
  v_page_unit uuid;
  v_vocab_id uuid;
  v_old_vocab uuid;
  v_other_vocab uuid;
  v_placement_id uuid;
  v_placement_book uuid;
  v_merged boolean := false;
  v_existing boolean;
  v_pos integer;
  v_i integer;
  v_alts text[];
begin
  if char_length(v_german) = 0 then
    raise exception 'Die deutsche Vokabel darf nicht leer sein.' using errcode = '22023';
  end if;

  foreach v_t in array coalesce(p_translations, '{}') loop
    v_t := btrim(coalesce(v_t, ''));
    if v_t <> '' then
      v_key := public.norm_text(v_t);
      if not (v_key = any (v_keys)) then
        v_keys := v_keys || v_key;
        v_clean := v_clean || v_t;
      end if;
    end if;
  end loop;

  if coalesce(array_length(v_clean, 1), 0) = 0 then
    raise exception 'Mindestens eine Übersetzung ist nötig.' using errcode = '22023';
  end if;

  v_alts := public.clean_text_list(p_german_alts, v_german);

  if not public.owns_book(p_book_id) then
    raise exception 'Buch nicht gefunden.' using errcode = '42501';
  end if;

  if p_placement_id is null then
    -- ---- neue Zeile -------------------------------------------------------
    if p_unit_number is null or p_page_number is null then
      raise exception 'Unit und Seite müssen angegeben werden.' using errcode = '22023';
    end if;

    insert into public.units (book_id, unit_number)
    values (p_book_id, p_unit_number)
    on conflict (book_id, unit_number) do nothing;
    select id into v_unit_id from public.units where book_id = p_book_id and unit_number = p_unit_number;

    select id, unit_id into v_page_id, v_page_unit
      from public.pages where book_id = p_book_id and page_number = p_page_number;
    if v_page_id is null then
      insert into public.pages (book_id, unit_id, page_number)
      values (p_book_id, v_unit_id, p_page_number)
      returning id into v_page_id;
    elsif v_page_unit <> v_unit_id then
      raise exception 'Seite % gehört bereits zu Unit %.',
        p_page_number, (select unit_number from public.units where id = v_page_unit)
        using errcode = 'P0001', hint = 'page_belongs_to_other_unit';
    end if;

    select id into v_vocab_id
      from public.vocabulary where book_id = p_book_id and german_key = public.norm_text(v_german);
    v_existing := v_vocab_id is not null;
    if not v_existing then
      insert into public.vocabulary (book_id, german, german_alts) values (p_book_id, v_german, v_alts) returning id into v_vocab_id;
    else
      update public.vocabulary set german_alts = public.merge_text_lists(german_alts, v_alts, german)
       where id = v_vocab_id;
    end if;
    v_merged := v_existing;

    select id into v_placement_id
      from public.vocabulary_placements where vocabulary_id = v_vocab_id and page_id = v_page_id;
    if v_placement_id is null then
      v_pos := coalesce(
        p_position,
        (select coalesce(max(position_on_page), 0) + 1 from public.vocabulary_placements where page_id = v_page_id)
      );
      insert into public.vocabulary_placements (book_id, vocabulary_id, page_id, position_on_page)
      values (p_book_id, v_vocab_id, v_page_id, v_pos)
      returning id into v_placement_id;
    end if;

    perform public.merge_translations(p_book_id, v_vocab_id, v_clean);

  else
    -- ---- vorhandene Zeile ändern -----------------------------------------
    select vocabulary_id, book_id, page_id
      into v_old_vocab, v_placement_book, v_page_id
      from public.vocabulary_placements where id = p_placement_id;
    if v_old_vocab is null or v_placement_book <> p_book_id then
      raise exception 'Eintrag nicht gefunden.' using errcode = 'P0002';
    end if;
    v_placement_id := p_placement_id;

    select id into v_other_vocab
      from public.vocabulary
      where book_id = p_book_id and german_key = public.norm_text(v_german) and id <> v_old_vocab;

    if v_other_vocab is null then
      -- normale Änderung: Wort ggf. umbenennen, Übersetzungen exakt auf die Liste setzen
      v_vocab_id := v_old_vocab;
      update public.vocabulary set german = v_german, german_alts = v_alts where id = v_vocab_id;

      delete from public.translations
       where vocabulary_id = v_vocab_id and not (translation_key = any (v_keys));

      for v_i in 1 .. array_length(v_clean, 1) loop
        update public.translations
           set translation = v_clean[v_i], sort_order = v_i - 1
         where vocabulary_id = v_vocab_id and translation_key = v_keys[v_i];
        if not found then
          insert into public.translations (book_id, vocabulary_id, translation, sort_order)
          values (p_book_id, v_vocab_id, v_clean[v_i], v_i - 1);
        end if;
      end loop;
    else
      -- Umbenennung trifft eine andere vorhandene Vokabel → zusammenführen
      v_vocab_id := v_other_vocab;
      v_merged := true;

      if exists (select 1 from public.vocabulary_placements where vocabulary_id = v_other_vocab and page_id = v_page_id) then
        delete from public.vocabulary_placements where id = p_placement_id;
        select id into v_placement_id
          from public.vocabulary_placements where vocabulary_id = v_other_vocab and page_id = v_page_id;
      else
        update public.vocabulary_placements set vocabulary_id = v_other_vocab where id = p_placement_id;
      end if;

      perform public.merge_translations(p_book_id, v_other_vocab, v_clean);
      update public.vocabulary set german_alts = public.merge_text_lists(german_alts, v_alts, german)
       where id = v_other_vocab;

      if not exists (select 1 from public.vocabulary_placements where vocabulary_id = v_old_vocab) then
        delete from public.vocabulary where id = v_old_vocab;
      end if;
    end if;

    if p_position is not null then
      update public.vocabulary_placements set position_on_page = p_position where id = v_placement_id;
    end if;
  end if;

  return jsonb_build_object(
    'placement_id', v_placement_id,
    'vocabulary_id', v_vocab_id,
    'german', (select german from public.vocabulary where id = v_vocab_id),
    'german_alts', to_jsonb((select german_alts from public.vocabulary where id = v_vocab_id)),
    'merged', v_merged,
    'position', (select position_on_page from public.vocabulary_placements where id = v_placement_id),
    'translations', coalesce(
      (select jsonb_agg(t.translation order by t.sort_order, t.created_at)
         from public.translations t where t.vocabulary_id = v_vocab_id),
      '[]'::jsonb)
  );
end;
$$;

create or replace function public.get_book_entries(p_book_id uuid)
returns jsonb
language sql
stable
set search_path = public
as $$
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'placement_id', e.placement_id,
      'vocabulary_id', e.vocabulary_id,
      'german', e.german,
      'german_alts', to_jsonb(e.german_alts),
      'translations', to_jsonb(e.translations),
      'unit_number', e.unit_number,
      'page_number', e.page_number,
      'position', e.position_on_page,
      'order', e.book_order
    ) order by e.book_order), '[]'::jsonb)
  from public.vocabulary_entries e
  where e.book_id = p_book_id;
$$;

create or replace function public.get_page_entries(p_book_id uuid, p_page_number integer)
returns jsonb
language plpgsql
stable
set search_path = public
as $$
declare
  v_page_id uuid;
  v_unit_number integer;
begin
  select p.id, u.unit_number into v_page_id, v_unit_number
    from public.pages p join public.units u on u.id = p.unit_id
   where p.book_id = p_book_id and p.page_number = p_page_number;

  return jsonb_build_object(
    'page', case when v_page_id is null then null
                 else jsonb_build_object('page_id', v_page_id, 'unit_number', v_unit_number) end,
    'entries', coalesce((
      select jsonb_agg(
               jsonb_build_object(
                 'placement_id', vp.id,
                 'vocabulary_id', v.id,
                 'german', v.german,
                 'german_alts', to_jsonb(v.german_alts),
                 'position', vp.position_on_page,
                 'translations', coalesce((
                    select jsonb_agg(t.translation order by t.sort_order, t.created_at)
                      from public.translations t where t.vocabulary_id = v.id), '[]'::jsonb)
               ) order by vp.position_on_page, vp.created_at)
        from public.vocabulary_placements vp
        join public.vocabulary v on v.id = vp.vocabulary_id
       where vp.page_id = v_page_id
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.get_learning_pool(p_language text default null, p_book_id uuid default null)
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
      'german_alts', to_jsonb(v.german_alts),
      'translations', coalesce((
         select jsonb_agg(t.translation order by t.sort_order, t.created_at)
           from public.translations t where t.vocabulary_id = v.id), '[]'::jsonb),
      'level', coalesce(pr.learning_level, 1)::float8
    )), '[]'::jsonb)
  from public.vocabulary v
  join public.books b on b.id = v.book_id
  left join public.user_vocabulary_progress pr
    on pr.vocabulary_id = v.id and pr.user_id = (select auth.uid())
  where (p_book_id is null or v.book_id = p_book_id)
    and (p_language is null or b.language = p_language);
$$;


drop function if exists public.search_vocabulary(text, uuid, text, integer, integer, integer);

create or replace function public.search_vocabulary(
  p_query text,
  p_book_id uuid default null,
  p_language text default null,
  p_unit_number integer default null,
  p_page_number integer default null,
  p_limit integer default 100
)
returns table (
  placement_id uuid, vocabulary_id uuid, german text, translations text[],
  book_id uuid, book_name text, language text, unit_number integer, page_number integer,
  german_alts text[]
)
language plpgsql
stable
set search_path = public
as $$
declare
  v_q text := btrim(coalesce(p_query, ''));
  v_pattern text;
begin
  if v_q = '' then
    return;
  end if;
  v_pattern := '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%';

  return query
  select e.placement_id, e.vocabulary_id, e.german, e.translations,
         e.book_id, e.book_name, e.language, e.unit_number, e.page_number, e.german_alts
    from public.vocabulary_entries e
   where (e.german ilike v_pattern
          or exists (select 1 from unnest(e.translations) t where t ilike v_pattern)
          or exists (select 1 from unnest(e.german_alts) a where a ilike v_pattern))
     and (p_book_id is null or e.book_id = p_book_id)
     and (p_language is null or e.language = p_language)
     and (p_unit_number is null or e.unit_number = p_unit_number)
     and (p_page_number is null or e.page_number = p_page_number)
   order by e.book_name, e.book_order
   limit least(greatest(coalesce(p_limit, 100), 1), 200);
end;
$$;

create or replace function public.export_book(p_book_id uuid)
returns jsonb
language plpgsql
stable
set search_path = public
as $$
declare
  v_result jsonb;
begin
  select jsonb_build_object(
    'format', 'vokabeltrainer-book',
    'version', 1,
    'book', jsonb_build_object('name', b.name, 'language', b.language, 'description', b.description),
    'units', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'number', u.unit_number,
          'name', u.name,
          'pages', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'number', p.page_number,
                'vocabulary', coalesce((
                  select jsonb_agg(
                    jsonb_build_object(
                      'german', v.german,
                      'german_alts', to_jsonb(v.german_alts),
                      'translations', coalesce((
                        select jsonb_agg(t.translation order by t.sort_order, t.created_at)
                          from public.translations t where t.vocabulary_id = v.id), '[]'::jsonb)
                    ) order by vp.position_on_page, vp.created_at)
                  from public.vocabulary_placements vp
                  join public.vocabulary v on v.id = vp.vocabulary_id
                  where vp.page_id = p.id), '[]'::jsonb)
              ) order by p.page_number)
            from public.pages p where p.unit_id = u.id), '[]'::jsonb)
        ) order by u.unit_number)
      from public.units u where u.book_id = b.id), '[]'::jsonb)
  )
  into v_result
  from public.books b
  where b.id = p_book_id;

  if v_result is null then
    raise exception 'Buch nicht gefunden.' using errcode = 'P0002';
  end if;
  return v_result;
end;
$$;

create or replace function public.import_book(p_payload jsonb, p_name text default null)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_book uuid;
  v_name text;
  v_lang text;
  v_unit jsonb;
  v_page jsonb;
  v_entry jsonb;
  v_unit_id uuid;
  v_page_id uuid;
  v_unit_number integer;
  v_page_number integer;
  v_german text;
  v_clean text[];
  v_keys text[];
  v_t jsonb;
  v_txt text;
  v_vocab uuid;
  v_pos integer;
  v_count integer := 0;
  v_seen_units integer[] := '{}';
  v_seen_pages integer[] := '{}';
  v_alts text[];
  v_a jsonb;
begin
  if jsonb_typeof(p_payload) is distinct from 'object'
     or p_payload ->> 'format' is distinct from 'vokabeltrainer-book' then
    raise exception 'Das ist keine gültige Vokabeltrainer-Datei.' using errcode = '22023';
  end if;
  if p_payload ->> 'version' is distinct from '1' then
    raise exception 'Diese Dateiversion wird nicht unterstützt.' using errcode = '22023';
  end if;
  if jsonb_typeof(p_payload -> 'book') is distinct from 'object' then
    raise exception 'Buchangaben fehlen.' using errcode = '22023';
  end if;

  v_name := left(btrim(coalesce(nullif(btrim(p_name), ''), p_payload #>> '{book,name}', '')), 120);
  if v_name = '' then
    raise exception 'Das Buch braucht einen Namen.' using errcode = '22023';
  end if;
  v_lang := p_payload #>> '{book,language}';
  if v_lang is null or not exists (select 1 from public.languages where code = v_lang) then
    raise exception 'Unbekannte Sprache: %', coalesce(v_lang, '(leer)') using errcode = '22023';
  end if;
  if jsonb_typeof(p_payload -> 'units') is distinct from 'array' then
    raise exception 'Die Datei enthält keine Units.' using errcode = '22023';
  end if;

  insert into public.books (name, language, description)
  values (v_name, v_lang,
          nullif(left(btrim(coalesce(p_payload #>> '{book,description}', '')), 1000), ''))
  returning id into v_book;

  for v_unit in select value from jsonb_array_elements(p_payload -> 'units') loop
    if jsonb_typeof(v_unit) is distinct from 'object'
       or coalesce(v_unit ->> 'number', '') !~ '^[0-9]{1,6}$' then
      raise exception 'Eine Unit hat keine gültige Nummer.' using errcode = '22023';
    end if;
    v_unit_number := (v_unit ->> 'number')::integer;
    if v_unit_number = any (v_seen_units) then
      raise exception 'Unit % kommt mehrfach vor.', v_unit_number using errcode = '22023';
    end if;
    v_seen_units := v_seen_units || v_unit_number;

    insert into public.units (book_id, unit_number, name)
    values (v_book, v_unit_number, nullif(left(btrim(coalesce(v_unit ->> 'name', '')), 120), ''))
    returning id into v_unit_id;

    if jsonb_typeof(coalesce(v_unit -> 'pages', '[]'::jsonb)) is distinct from 'array' then
      raise exception 'Unit %: Seiten haben ein ungültiges Format.', v_unit_number using errcode = '22023';
    end if;

    for v_page in select value from jsonb_array_elements(coalesce(v_unit -> 'pages', '[]'::jsonb)) loop
      if jsonb_typeof(v_page) is distinct from 'object'
         or coalesce(v_page ->> 'number', '') !~ '^[0-9]{1,6}$'
         or (v_page ->> 'number')::integer < 1 then
        raise exception 'Unit %: Eine Seite hat keine gültige Nummer.', v_unit_number using errcode = '22023';
      end if;
      v_page_number := (v_page ->> 'number')::integer;
      if v_page_number = any (v_seen_pages) then
        raise exception 'Seite % kommt mehrfach vor.', v_page_number using errcode = '22023';
      end if;
      v_seen_pages := v_seen_pages || v_page_number;

      insert into public.pages (book_id, unit_id, page_number)
      values (v_book, v_unit_id, v_page_number)
      returning id into v_page_id;

      if jsonb_typeof(coalesce(v_page -> 'vocabulary', '[]'::jsonb)) is distinct from 'array' then
        raise exception 'Seite %: Vokabeln haben ein ungültiges Format.', v_page_number using errcode = '22023';
      end if;

      v_pos := 0;
      for v_entry in select value from jsonb_array_elements(coalesce(v_page -> 'vocabulary', '[]'::jsonb)) loop
        v_count := v_count + 1;
        if v_count > 20000 then
          raise exception 'Die Datei enthält zu viele Vokabeln (Maximum 20000).' using errcode = '22023';
        end if;

        if jsonb_typeof(v_entry) is distinct from 'object'
           or jsonb_typeof(v_entry -> 'german') is distinct from 'string'
           or btrim(v_entry ->> 'german') = ''
           or char_length(btrim(v_entry ->> 'german')) > 200
           or jsonb_typeof(v_entry -> 'translations') is distinct from 'array' then
          raise exception 'Seite %: Ungültige Vokabel (Eintrag %).', v_page_number, v_pos + 1 using errcode = '22023';
        end if;
        v_german := btrim(v_entry ->> 'german');

        v_clean := '{}';
        v_keys := '{}';
        for v_t in select value from jsonb_array_elements(v_entry -> 'translations') loop
          if jsonb_typeof(v_t) is distinct from 'string' then
            raise exception 'Seite %: Übersetzungen von "%" müssen Text sein.', v_page_number, v_german using errcode = '22023';
          end if;
          v_txt := btrim(v_t #>> '{}');
          if v_txt <> '' then
            if char_length(v_txt) > 200 then
              raise exception 'Seite %: Übersetzung von "%" ist zu lang.', v_page_number, v_german using errcode = '22023';
            end if;
            if not (public.norm_text(v_txt) = any (v_keys)) then
              v_keys := v_keys || public.norm_text(v_txt);
              v_clean := v_clean || v_txt;
            end if;
          end if;
        end loop;
        if coalesce(array_length(v_clean, 1), 0) = 0 then
          raise exception 'Seite %: "%" hat keine Übersetzung.', v_page_number, v_german using errcode = '22023';
        end if;

        v_alts := '{}';
        if v_entry ? 'german_alts' and jsonb_typeof(v_entry -> 'german_alts') is distinct from 'null' then
          if jsonb_typeof(v_entry -> 'german_alts') is distinct from 'array' then
            raise exception 'Seite %: Weitere deutsche Lösungen von "%" müssen eine Liste sein.', v_page_number, v_german using errcode = '22023';
          end if;
          for v_a in select value from jsonb_array_elements(v_entry -> 'german_alts') loop
            if jsonb_typeof(v_a) is distinct from 'string' then
              raise exception 'Seite %: Weitere deutsche Lösungen von "%" müssen Text sein.', v_page_number, v_german using errcode = '22023';
            end if;
            v_alts := v_alts || (v_a #>> '{}');
          end loop;
          v_alts := public.clean_text_list(v_alts, v_german);
        end if;

        select id into v_vocab from public.vocabulary
         where book_id = v_book and german_key = public.norm_text(v_german);
        if v_vocab is null then
          insert into public.vocabulary (book_id, german, german_alts) values (v_book, v_german, v_alts) returning id into v_vocab;
        else
          update public.vocabulary set german_alts = public.merge_text_lists(german_alts, v_alts, german)
           where id = v_vocab;
        end if;

        v_pos := v_pos + 1;
        insert into public.vocabulary_placements (book_id, vocabulary_id, page_id, position_on_page)
        values (v_book, v_vocab, v_page_id, v_pos)
        on conflict (vocabulary_id, page_id) do nothing;

        perform public.merge_translations(v_book, v_vocab, v_clean);
      end loop;
    end loop;
  end loop;

  return v_book;
end;
$$;


-- ----------------------------------------------------------------------------
-- Rechte
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
         'clean_text_list', 'merge_text_lists', 'save_vocab_entry',
         'get_book_entries', 'get_page_entries', 'get_learning_pool', 'search_vocabulary',
         'export_book', 'import_book')
  loop
    execute format('revoke all on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;
end;
$$;


-- ===== 0004_roles_public_books.sql =====
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


-- ===== 0005_koins_shop.sql =====
-- ============================================================================
-- 0005: Coins, Codes, Buchpreise, Shop (Profilbild/Farbe/Effekt/Theme), Feedback,
--       aktive Vokabeln, Belohnungen.
--
-- Einspielen: Supabase → SQL Editor → komplett einfügen → Run (nach 0001–0004).
-- Die Datei ist wiederholbar.
--
-- Coins kommen aus:  Codes (Admin erstellt, einmalig einlösbar), Lernen (nur Vokabeln aus
--                    Online-Büchern, begrenzt pro Tag), bestätigte Fehlermeldungen,
--                    Tagesbonus für Mods/Admins, Geschenke von Admins.
-- Coins gehen für:   Online-Bücher und Shop-Artikel.
-- Alle Zahlen stehen in app_settings und lassen sich von Admins ändern.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. Einstellungen
-- ----------------------------------------------------------------------------

create table if not exists public.app_settings (
  key text primary key,
  value integer not null check (value >= 0)
);

insert into public.app_settings (key, value) values
  ('book_price_default', 200),   -- Preis eines neu veröffentlichten Buchs
  ('learn_reward', 1),           -- Coins, wenn eine Vokabel zum ersten Mal Stufe 2 erreicht
  ('learn_daily_cap', 30),       -- höchstens so viele Lern-Coins pro Tag
  ('review_reward', 10),         -- Coins für eine sinnvolle Fehlermeldung
  ('code_default_amount', 500),  -- Coins pro Code
  ('daily_bonus_mod', 1),
  ('daily_bonus_admin', 10)
on conflict (key) do nothing;

create or replace function public.setting(p_key text)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select value from public.app_settings where key = p_key), 0);
$$;


-- ----------------------------------------------------------------------------
-- 2. Wallet und Ledger
-- ----------------------------------------------------------------------------

create table if not exists public.koin_wallets (
  user_id uuid primary key references auth.users (id) on delete cascade,
  balance integer not null default 0 check (balance >= 0)
);

create table if not exists public.koin_ledger (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  amount integer not null check (amount <> 0),
  reason text not null,
  ref text,
  created_at timestamptz not null default now()
);

create index if not exists koin_ledger_user_idx on public.koin_ledger (user_id, created_at desc);

-- Einzige Stelle, an der Coins bewegt werden. Negative Beträge nur bei ausreichendem Guthaben.
create or replace function public._grant_koins(p_user uuid, p_amount integer, p_reason text, p_ref text default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance integer;
begin
  if p_amount = 0 then
    return coalesce((select balance from public.koin_wallets where user_id = p_user), 0);
  end if;
  insert into public.koin_wallets (user_id) values (p_user) on conflict do nothing;
  update public.koin_wallets
     set balance = balance + p_amount
   where user_id = p_user and balance + p_amount >= 0
   returning balance into v_balance;
  if v_balance is null then
    raise exception 'Nicht genug Coins.' using errcode = '23514';
  end if;
  insert into public.koin_ledger (user_id, amount, reason, ref) values (p_user, p_amount, p_reason, p_ref);
  return v_balance;
end;
$$;

create or replace function public.get_wallet()
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select case when public.is_blocked() then 0
              else coalesce((select balance from public.koin_wallets where user_id = (select auth.uid())), 0) end;
$$;

-- Tagesbonus für Mods/Admins (einmal pro Tag, Berliner Zeit). Gibt den gutgeschriebenen Betrag zurück.
create table if not exists public.koin_daily (
  user_id uuid not null references auth.users (id) on delete cascade,
  day date not null,
  primary key (user_id, day)
);

create or replace function public.claim_daily_bonus()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  v_amount integer;
  v_inserted integer;
begin
  if v_me is null or public.is_blocked() then
    return 0;
  end if;
  v_amount := case when public.is_admin() then public.setting('daily_bonus_admin')
                   when public.is_staff() then public.setting('daily_bonus_mod')
                   else 0 end;
  if v_amount <= 0 then
    return 0;
  end if;
  insert into public.koin_daily (user_id, day) values (v_me, (now() at time zone 'Europe/Berlin')::date)
  on conflict do nothing;
  get diagnostics v_inserted = row_count;
  if v_inserted = 0 then
    return 0;
  end if;
  perform public._grant_koins(v_me, v_amount, 'daily');
  return v_amount;
end;
$$;


-- ----------------------------------------------------------------------------
-- 3. Codes
-- ----------------------------------------------------------------------------

create table if not exists public.koin_codes (
  code text primary key,
  amount integer not null check (amount > 0),
  note text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.koin_code_failures (
  user_id uuid not null references auth.users (id) on delete cascade,
  at timestamptz not null default now()
);

create index if not exists koin_code_failures_idx on public.koin_code_failures (user_id, at desc);

create or replace function public._format_code(p_code text)
returns text
language sql
immutable
as $$
  select substr(p_code, 1, 4) || '-' || substr(p_code, 5, 4) || '-' || substr(p_code, 9, 4);
$$;

create or replace function public.admin_create_codes(p_amount integer default null, p_count integer default 1, p_note text default '')
returns text[]
language plpgsql
security definer
set search_path = public
as $$
declare
  v_amount integer := coalesce(p_amount, public.setting('code_default_amount'));
  v_codes text[] := '{}';
  v_code text;
  i integer;
begin
  perform public._require_admin();
  if v_amount < 1 or v_amount > 100000 then
    raise exception 'Der Betrag muss zwischen 1 und 100000 liegen.' using errcode = '22023';
  end if;
  if p_count < 1 or p_count > 50 then
    raise exception 'Du kannst 1 bis 50 Codes auf einmal erstellen.' using errcode = '22023';
  end if;
  for i in 1..p_count loop
    loop
      v_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12));
      begin
        insert into public.koin_codes (code, amount, note, created_by)
        values (v_code, v_amount, nullif(left(btrim(coalesce(p_note, '')), 100), ''), (select auth.uid()));
        exit;
      exception when unique_violation then
        null;
      end;
    end loop;
    v_codes := v_codes || public._format_code(v_code);
  end loop;
  return v_codes;
end;
$$;

create or replace function public.admin_list_codes()
returns table (code text, amount integer, note text, created_at timestamptz, created_by_name text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public._require_admin();
  return query
  select public._format_code(c.code), c.amount, c.note, c.created_at, pr.display_name
    from public.koin_codes c
    left join public.profiles pr on pr.id = c.created_by
   order by c.created_at desc, c.code;
end;
$$;

create or replace function public.admin_delete_code(p_code text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._require_admin();
  delete from public.koin_codes where code = upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
end;
$$;

-- Einlösen: der Code wird dabei gelöscht. Fehlversuche werden gezählt (5 pro 10 Minuten).
create or replace function public.redeem_code(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  v_norm text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  v_amount integer;
  v_balance integer;
begin
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  if (select count(*) from public.koin_code_failures f where f.user_id = v_me and f.at > now() - interval '10 minutes') >= 5 then
    return jsonb_build_object('ok', false, 'message', 'Zu viele Fehlversuche. Bitte warte ein paar Minuten.');
  end if;

  delete from public.koin_codes where code = v_norm returning amount into v_amount;
  if v_amount is null then
    insert into public.koin_code_failures (user_id) values (v_me);
    return jsonb_build_object('ok', false, 'message', 'Dieser Code ist ungültig oder wurde schon benutzt.');
  end if;

  v_balance := public._grant_koins(v_me, v_amount, 'code');
  return jsonb_build_object('ok', true, 'amount', v_amount, 'balance', v_balance);
end;
$$;


-- ----------------------------------------------------------------------------
-- 4. Aktive Vokabeln
-- ----------------------------------------------------------------------------
-- Nur aktivierte Vokabeln erscheinen in Lernrunden und Statistik. Eigene (private) Bücher
-- aktivieren neue Vokabeln automatisch, bei Online-Büchern entscheidet der Nutzer.

create table if not exists public.user_active_vocab (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  vocabulary_id uuid not null references public.vocabulary (id) on delete cascade,
  activated_at timestamptz not null default now(),
  primary key (user_id, vocabulary_id)
);

create index if not exists active_vocab_vocab_idx on public.user_active_vocab (vocabulary_id);

create or replace function public.is_active_vocab(p_vocabulary_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_active_vocab a
     where a.vocabulary_id = p_vocabulary_id and a.user_id = (select auth.uid())
  );
$$;

create or replace function public.auto_activate_owner_vocab()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.user_active_vocab (user_id, vocabulary_id)
  select b.owner_id, new.id from public.books b
   where b.id = new.book_id and not b.is_public
  on conflict do nothing;
  return new;
end;
$$;

drop trigger if exists vocabulary_auto_activate on public.vocabulary;
create trigger vocabulary_auto_activate
  after insert on public.vocabulary
  for each row execute function public.auto_activate_owner_vocab();

-- Aktivieren/Deaktivieren für das ganze Buch, eine Unit oder eine Seite. Gibt die Zahl der geänderten Vokabeln zurück.
create or replace function public.set_vocab_active(
  p_book_id uuid,
  p_active boolean,
  p_unit_number integer default null,
  p_page_number integer default null
)
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

  if p_active then
    insert into public.user_active_vocab (user_id, vocabulary_id)
    select distinct v_me, vp.vocabulary_id
      from public.vocabulary_placements vp
      join public.pages p on p.id = vp.page_id
      join public.units u on u.id = p.unit_id
     where vp.book_id = p_book_id
       and (p_unit_number is null or u.unit_number = p_unit_number)
       and (p_page_number is null or p.page_number = p_page_number)
    on conflict do nothing;
  else
    delete from public.user_active_vocab a
     where a.user_id = v_me
       and a.vocabulary_id in (
         select vp.vocabulary_id
           from public.vocabulary_placements vp
           join public.pages p on p.id = vp.page_id
           join public.units u on u.id = p.unit_id
          where vp.book_id = p_book_id
            and (p_unit_number is null or u.unit_number = p_unit_number)
            and (p_page_number is null or p.page_number = p_page_number));
  end if;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;


-- ----------------------------------------------------------------------------
-- 5. Buchpreise und Käufe
-- ----------------------------------------------------------------------------

alter table public.books add column if not exists price integer not null default 200 check (price >= 0);

create table if not exists public.book_purchases (
  user_id uuid not null references auth.users (id) on delete cascade,
  book_id uuid not null references public.books (id) on delete cascade,
  price_paid integer not null default 0 check (price_paid >= 0),
  purchased_at timestamptz not null default now(),
  primary key (user_id, book_id)
);

-- Verwenden = kaufen (einmalig; Mods/Admins und Besitzer zahlen nichts, ebenso wer das Buch schon gekauft hat).
create or replace function public.add_to_library(p_book_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  v_price integer;
  v_owner uuid;
begin
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  select b.price, b.owner_id into v_price, v_owner
    from public.books b where b.id = p_book_id and b.is_public;
  if v_price is null then
    raise exception 'Öffentliches Buch nicht gefunden.' using errcode = 'P0002';
  end if;

  if not exists (select 1 from public.book_purchases where user_id = v_me and book_id = p_book_id) then
    if public.is_staff() or v_owner = v_me or v_price = 0 then
      insert into public.book_purchases (user_id, book_id, price_paid) values (v_me, p_book_id, 0);
    else
      perform public._grant_koins(v_me, -v_price, 'book', p_book_id::text);
      insert into public.book_purchases (user_id, book_id, price_paid) values (v_me, p_book_id, v_price);
    end if;
  end if;

  insert into public.book_library (user_id, book_id) values (v_me, p_book_id) on conflict do nothing;
end;
$$;

create or replace function public.admin_set_book_price(p_book_id uuid, p_price integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._require_admin();
  if p_price < 0 or p_price > 100000 then
    raise exception 'Ungültiger Preis.' using errcode = '22023';
  end if;
  update public.books set price = p_price where id = p_book_id;
  if not found then
    raise exception 'Buch nicht gefunden.' using errcode = 'P0002';
  end if;
end;
$$;

-- Neu veröffentlichte Bücher bekommen den Standardpreis.
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
     set is_public = true, published_at = now(), published_by = (select auth.uid()),
         price = public.setting('book_price_default')
   where id = p_book_id and owner_id = (select auth.uid()) and not is_public;
  if not found then
    raise exception 'Buch nicht gefunden oder bereits öffentlich.' using errcode = 'P0002';
  end if;
end;
$$;

-- Meine Bücher: jetzt mit Zahl der aktiven Vokabeln; der Fortschritt zählt nur aktive Vokabeln.
drop function if exists public.get_book_summaries();

create function public.get_book_summaries()
returns table (
  id uuid, name text, language text, description text, created_at timestamptz,
  unit_count integer, page_count integer, vocab_count integer, mastery_percent numeric,
  is_public boolean, is_mine boolean, active_count integer
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
       where v.book_id = b.id and public.is_active_vocab(v.id)
    ), 0),
    b.is_public,
    (b.owner_id = (select auth.uid())),
    (select count(*) from public.vocabulary v where v.book_id = b.id and public.is_active_vocab(v.id))::integer
  from public.books b
  where public.in_library(b.id)
  order by b.created_at desc;
$$;

drop function if exists public.get_public_books();

create function public.get_public_books()
returns table (
  id uuid, name text, language text, description text, created_at timestamptz,
  published_at timestamptz, published_by_name text,
  unit_count integer, page_count integer, vocab_count integer, mastery_percent numeric,
  in_library boolean, is_mine boolean, price integer, purchased boolean
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
       where v.book_id = b.id and public.is_active_vocab(v.id)
    ), 0),
    public.in_library(b.id),
    (b.owner_id = (select auth.uid())),
    b.price,
    exists (select 1 from public.book_purchases bp where bp.book_id = b.id and bp.user_id = (select auth.uid()))
  from public.books b
  where b.is_public
    and (select auth.uid()) is not null
    and not public.is_blocked()
  order by b.published_at desc nulls last, b.name;
$$;

-- Units/Seiten mit Zahl der Vokabeln und der davon aktiven Vokabeln.
create or replace function public.get_book_outline(p_book_id uuid)
returns jsonb
language sql
stable
set search_path = public
as $$
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'unit_id', u.id,
      'unit_number', u.unit_number,
      'name', u.name,
      'pages', coalesce((
        select jsonb_agg(
                 jsonb_build_object(
                   'page_id', p.id,
                   'page_number', p.page_number,
                   'vocab_count', (select count(*) from public.vocabulary_placements vp where vp.page_id = p.id),
                   'active_count', (select count(*) from public.vocabulary_placements vp
                                     where vp.page_id = p.id and public.is_active_vocab(vp.vocabulary_id))
                 ) order by p.page_number)
          from public.pages p where p.unit_id = u.id
      ), '[]'::jsonb)
    ) order by u.unit_number), '[]'::jsonb)
  from public.units u
  where u.book_id = p_book_id;
$$;

-- Lernpool und Statistik nur mit aktiven Vokabeln.
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
  'where ((p_book_id is null and public.in_library(v.book_id)) or v.book_id = p_book_id)',
  'where ((p_book_id is null and public.in_library(v.book_id)) or v.book_id = p_book_id) and public.is_active_vocab(v.id)');

select public._patch_function(
  'public.get_my_stats(uuid)'::regprocedure,
  'where (p_book_id is null and public.in_library(v.book_id)) or v.book_id = p_book_id',
  'where ((p_book_id is null and public.in_library(v.book_id)) or v.book_id = p_book_id) and public.is_active_vocab(v.id)');

drop function public._patch_function(regprocedure, text, text);


-- ----------------------------------------------------------------------------
-- 6. Belohnungen
-- ----------------------------------------------------------------------------

-- Lernen: 1 Coin, wenn eine Vokabel eines Online-Buchs zum ersten Mal Stufe 2 erreicht (täglich begrenzt).
create table if not exists public.koin_learn_awards (
  user_id uuid not null references auth.users (id) on delete cascade,
  vocabulary_id uuid not null references public.vocabulary (id) on delete cascade,
  awarded_at timestamptz not null default now(),
  primary key (user_id, vocabulary_id)
);

create or replace function public.award_learning_koins()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reward integer := public.setting('learn_reward');
  v_cap integer := public.setting('learn_daily_cap');
  v_today integer;
  v_inserted integer;
begin
  if new.learning_level < 2 or v_reward <= 0 then
    return new;
  end if;
  if coalesce((select p.blocked from public.profiles p where p.id = new.user_id), true) then
    return new;
  end if;
  -- nur geprüfte Inhalte: Vokabeln aus Online-Büchern
  if not exists (
    select 1 from public.vocabulary v join public.books b on b.id = v.book_id
     where v.id = new.vocabulary_id and b.is_public) then
    return new;
  end if;
  if exists (select 1 from public.koin_learn_awards where user_id = new.user_id and vocabulary_id = new.vocabulary_id) then
    return new;
  end if;
  select coalesce(sum(l.amount), 0)::integer into v_today
    from public.koin_ledger l
   where l.user_id = new.user_id and l.reason = 'learn'
     and (l.created_at at time zone 'Europe/Berlin')::date = (now() at time zone 'Europe/Berlin')::date;
  if v_today + v_reward > v_cap then
    return new;
  end if;
  insert into public.koin_learn_awards (user_id, vocabulary_id) values (new.user_id, new.vocabulary_id)
  on conflict do nothing;
  get diagnostics v_inserted = row_count;
  if v_inserted > 0 then
    perform public._grant_koins(new.user_id, v_reward, 'learn', new.vocabulary_id::text);
  end if;
  return new;
end;
$$;

drop trigger if exists progress_award_koins on public.user_vocabulary_progress;
create trigger progress_award_koins
  after insert or update on public.user_vocabulary_progress
  for each row execute function public.award_learning_koins();

-- Fehlermeldung: "erledigt" kann belohnt werden (Standard: ja).
drop function if exists public.resolve_review_request(uuid, text, text);

create or replace function public.resolve_review_request(
  p_id uuid, p_status text, p_note text default '', p_reward boolean default true)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_requester uuid;
  v_me uuid := (select auth.uid());
begin
  if not public.is_staff() then
    raise exception 'Keine Berechtigung.' using errcode = '42501';
  end if;
  if p_status not in ('done', 'dismissed') then
    raise exception 'Ungültiger Status.' using errcode = '22023';
  end if;
  update public.review_requests
     set status = p_status,
         resolved_by = v_me,
         resolved_at = now(),
         resolution_note = nullif(left(btrim(coalesce(p_note, '')), 500), '')
   where id = p_id and status = 'open'
   returning requested_by into v_requester;
  if not found then
    raise exception 'Anfrage nicht gefunden oder schon bearbeitet.' using errcode = 'P0002';
  end if;
  if p_status = 'done' and coalesce(p_reward, false) and v_requester is not null and v_requester <> v_me then
    perform public._grant_koins(v_requester, public.setting('review_reward'), 'review', p_id::text);
  end if;
end;
$$;


-- ----------------------------------------------------------------------------
-- 7. Shop
-- ----------------------------------------------------------------------------
-- Das Aussehen der Artikel steht in der App (features/shop/catalog.ts); hier nur ID, Art, Name, Preis.

create table if not exists public.shop_items (
  id text primary key,
  kind text not null check (kind in ('avatar', 'color', 'effect', 'theme')),
  name text not null,
  price integer not null check (price >= 0),
  sort integer not null default 0,
  active boolean not null default true
);

insert into public.shop_items (id, kind, name, price, sort) values
  ('avatar_rocket', 'avatar', 'Rakete', 40, 10),
  ('avatar_cat', 'avatar', 'Katze', 60, 20),
  ('avatar_fox', 'avatar', 'Fuchs', 60, 30),
  ('avatar_panda', 'avatar', 'Panda', 80, 40),
  ('avatar_owl', 'avatar', 'Eule', 80, 50),
  ('avatar_robot', 'avatar', 'Roboter', 100, 60),
  ('avatar_alien', 'avatar', 'Alien', 100, 70),
  ('avatar_octopus', 'avatar', 'Oktopus', 120, 80),
  ('avatar_ghost', 'avatar', 'Geist', 150, 90),
  ('avatar_unicorn', 'avatar', 'Einhorn', 150, 100),
  ('avatar_lion', 'avatar', 'Löwe', 180, 110),
  ('avatar_dragon', 'avatar', 'Drache', 200, 120),
  ('avatar_wizard', 'avatar', 'Zauberer', 200, 130),
  ('avatar_ninja', 'avatar', 'Ninja', 220, 140),
  ('avatar_crown', 'avatar', 'Krone', 300, 150),
  ('avatar_diamond', 'avatar', 'Diamant', 400, 160),

  ('color_cyan', 'color', 'Cyan', 60, 10),
  ('color_pink', 'color', 'Pink', 60, 20),
  ('color_emerald', 'color', 'Smaragd', 80, 30),
  ('color_orange', 'color', 'Orange', 80, 40),
  ('color_violet', 'color', 'Violett', 80, 50),
  ('color_gold', 'color', 'Gold', 100, 60),
  ('color_rose', 'color', 'Rose', 100, 70),
  ('color_lime', 'color', 'Limette', 100, 80),
  ('color_sunset', 'color', 'Sonnenuntergang', 200, 90),
  ('color_ocean', 'color', 'Ozean', 200, 100),
  ('color_candy', 'color', 'Zuckerwatte', 220, 110),
  ('color_aurora', 'color', 'Polarlicht', 300, 120),

  ('effect_glow', 'effect', 'Leuchten', 150, 10),
  ('effect_pulse', 'effect', 'Pulsieren', 150, 20),
  ('effect_float', 'effect', 'Schweben', 200, 30),
  ('effect_sparkle', 'effect', 'Funkeln', 200, 40),
  ('effect_neon', 'effect', 'Neon', 250, 50),
  ('effect_shimmer', 'effect', 'Schimmer', 300, 60),
  ('effect_rainbow', 'effect', 'Regenbogen', 400, 70),
  ('effect_fire', 'effect', 'Feuer', 450, 80),

  ('theme_space', 'theme', 'Weltraum', 0, 10),
  ('theme_mono', 'theme', 'Schlicht', 250, 20),
  ('theme_ocean', 'theme', 'Ozean', 300, 30),
  ('theme_forest', 'theme', 'Wald', 300, 40),
  ('theme_sunset', 'theme', 'Sonnenuntergang', 350, 50),
  ('theme_sakura', 'theme', 'Kirschblüte', 350, 60),
  ('theme_party', 'theme', 'Party', 400, 70),
  ('theme_candy', 'theme', 'Zuckerwatte', 400, 80),
  ('theme_neon', 'theme', 'Neon', 450, 90),
  ('theme_matrix', 'theme', 'Matrix', 450, 100),
  ('theme_aurora', 'theme', 'Polarlicht', 500, 110),
  ('theme_gold', 'theme', 'Gold', 600, 120)
on conflict (id) do nothing;

create table if not exists public.user_items (
  user_id uuid not null references auth.users (id) on delete cascade,
  item_id text not null references public.shop_items (id) on delete cascade,
  acquired_at timestamptz not null default now(),
  primary key (user_id, item_id)
);

-- Ausgewählte Artikel (nur über equip_item/unequip_item änderbar).
alter table public.profiles add column if not exists avatar_id text;
alter table public.profiles add column if not exists color_id text;
alter table public.profiles add column if not exists effect_id text;
alter table public.profiles add column if not exists theme_id text;

create or replace function public.get_shop()
returns table (id text, kind text, name text, price integer, sort integer, owned boolean, equipped boolean)
language sql
stable
security definer
set search_path = public
as $$
  select i.id, i.kind, i.name, i.price, i.sort,
         (i.price = 0 or exists (select 1 from public.user_items u where u.item_id = i.id and u.user_id = (select auth.uid()))),
         exists (select 1 from public.profiles p
                  where p.id = (select auth.uid())
                    and i.id in (p.avatar_id, p.color_id, p.effect_id, p.theme_id))
    from public.shop_items i
   where i.active and (select auth.uid()) is not null
   order by i.kind, i.sort, i.name;
$$;

create or replace function public.buy_item(p_item_id text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  v_price integer;
  v_balance integer;
begin
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  select price into v_price from public.shop_items where id = p_item_id and active;
  if v_price is null then
    raise exception 'Artikel nicht gefunden.' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.user_items where user_id = v_me and item_id = p_item_id) or v_price = 0 then
    raise exception 'Das gehört dir schon.' using errcode = '23505';
  end if;
  v_balance := public._grant_koins(v_me, -v_price, 'shop', p_item_id);
  insert into public.user_items (user_id, item_id) values (v_me, p_item_id);
  return v_balance;
end;
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
begin
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  select kind, price into v_kind, v_price from public.shop_items where id = p_item_id and active;
  if v_kind is null then
    raise exception 'Artikel nicht gefunden.' using errcode = 'P0002';
  end if;
  if v_price > 0 and not exists (select 1 from public.user_items where user_id = v_me and item_id = p_item_id) then
    raise exception 'Diesen Artikel musst du erst kaufen.' using errcode = '42501';
  end if;
  update public.profiles
     set avatar_id = case when v_kind = 'avatar' then p_item_id else avatar_id end,
         color_id  = case when v_kind = 'color'  then p_item_id else color_id end,
         effect_id = case when v_kind = 'effect' then p_item_id else effect_id end,
         theme_id  = case when v_kind = 'theme'  then p_item_id else theme_id end
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
  if p_kind not in ('avatar', 'color', 'effect', 'theme') then
    raise exception 'Ungültige Art.' using errcode = '22023';
  end if;
  update public.profiles
     set avatar_id = case when p_kind = 'avatar' then null else avatar_id end,
         color_id  = case when p_kind = 'color'  then null else color_id end,
         effect_id = case when p_kind = 'effect' then null else effect_id end,
         theme_id  = case when p_kind = 'theme'  then null else theme_id end
   where id = v_me;
end;
$$;

create or replace function public.admin_set_item(p_item_id text, p_price integer, p_active boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._require_admin();
  if p_price < 0 or p_price > 100000 then
    raise exception 'Ungültiger Preis.' using errcode = '22023';
  end if;
  update public.shop_items set price = p_price, active = coalesce(p_active, true) where id = p_item_id;
  if not found then
    raise exception 'Artikel nicht gefunden.' using errcode = 'P0002';
  end if;
end;
$$;

-- Rangliste jetzt mit ausgewählten Artikeln (Profilbild, Farbe, Effekt).
drop function if exists public.get_leaderboard(text);

create function public.get_leaderboard(p_period text default 'week')
returns table (rank bigint, display_name text, points bigint, is_me boolean,
               avatar_id text, color_id text, effect_id text)
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
    pr.avatar_id, pr.color_id, pr.effect_id
  from scored s
  join public.profiles pr on pr.id = s.uid and not pr.blocked
  where s.pts > 0
  order by s.pts desc, pr.display_name
  limit 100;
end;
$$;


-- ----------------------------------------------------------------------------
-- 8. Feedback
-- ----------------------------------------------------------------------------

create table if not exists public.feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid default auth.uid() references auth.users (id) on delete set null,
  kind text not null check (kind in ('idea', 'improvement', 'bug', 'other')),
  message text not null check (char_length(btrim(message)) between 3 and 2000),
  status text not null default 'new' check (status in ('new', 'seen', 'done', 'declined')),
  staff_note text check (char_length(staff_note) <= 500),
  created_at timestamptz not null default now(),
  handled_by uuid references auth.users (id) on delete set null,
  handled_at timestamptz
);

create index if not exists feedback_status_idx on public.feedback (status, created_at desc);

create or replace function public.submit_feedback(p_kind text, p_message text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  v_id uuid;
begin
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  if p_kind not in ('idea', 'improvement', 'bug', 'other') then
    raise exception 'Ungültige Art.' using errcode = '22023';
  end if;
  if char_length(btrim(coalesce(p_message, ''))) < 3 then
    raise exception 'Bitte schreib etwas mehr.' using errcode = '22023';
  end if;
  if (select count(*) from public.feedback f where f.user_id = v_me and f.created_at > now() - interval '24 hours') >= 10 then
    raise exception 'Du hast heute schon viel Feedback gesendet – danke! Morgen geht es weiter.' using errcode = '54000';
  end if;
  insert into public.feedback (user_id, kind, message)
  values (v_me, p_kind, left(btrim(p_message), 2000))
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.list_feedback(p_status text default 'all')
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
  if p_status not in ('new', 'seen', 'done', 'declined', 'all') then
    raise exception 'Ungültiger Status.' using errcode = '22023';
  end if;
  return coalesce((
    select jsonb_agg(x.j order by x.created_at desc)
      from (
        select f.created_at,
               jsonb_build_object(
                 'id', f.id, 'kind', f.kind, 'message', f.message, 'status', f.status,
                 'staff_note', f.staff_note, 'created_at', f.created_at,
                 'user_name', pr.display_name, 'handled_by_name', hp.display_name,
                 'handled_at', f.handled_at) as j
          from public.feedback f
          left join public.profiles pr on pr.id = f.user_id
          left join public.profiles hp on hp.id = f.handled_by
         where p_status = 'all' or f.status = p_status
         order by f.created_at desc
         limit 300
      ) x
  ), '[]'::jsonb);
end;
$$;

create or replace function public.set_feedback_status(p_id uuid, p_status text, p_note text default '', p_reward integer default 0)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid;
  v_me uuid := (select auth.uid());
begin
  if not public.is_staff() then
    raise exception 'Keine Berechtigung.' using errcode = '42501';
  end if;
  if p_status not in ('seen', 'done', 'declined') then
    raise exception 'Ungültiger Status.' using errcode = '22023';
  end if;
  if coalesce(p_reward, 0) < 0 or coalesce(p_reward, 0) > 50 then
    raise exception 'Die Belohnung darf höchstens 50 Coins betragen.' using errcode = '22023';
  end if;
  update public.feedback
     set status = p_status, handled_by = v_me, handled_at = now(),
         staff_note = nullif(left(btrim(coalesce(p_note, '')), 500), '')
   where id = p_id
   returning user_id into v_user;
  if not found then
    raise exception 'Feedback nicht gefunden.' using errcode = 'P0002';
  end if;
  if coalesce(p_reward, 0) > 0 and v_user is not null and v_user <> v_me then
    perform public._grant_koins(v_user, p_reward, 'feedback', p_id::text);
  end if;
end;
$$;


-- ----------------------------------------------------------------------------
-- 9. Admin: Einstellungen, Geschenke, Nutzerliste mit Coins
-- ----------------------------------------------------------------------------

create or replace function public.admin_set_setting(p_key text, p_value integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._require_admin();
  if p_value < 0 or p_value > 1000000 then
    raise exception 'Ungültiger Wert.' using errcode = '22023';
  end if;
  update public.app_settings set value = p_value where key = p_key;
  if not found then
    raise exception 'Unbekannte Einstellung.' using errcode = 'P0002';
  end if;
end;
$$;

-- Coins schenken (positiv) oder abziehen (negativ, höchstens bis 0).
create or replace function public.admin_grant_koins(p_user uuid, p_amount integer, p_note text default '')
returns integer
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._require_admin();
  if p_amount = 0 or abs(p_amount) > 100000 then
    raise exception 'Ungültiger Betrag.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.profiles where id = p_user) then
    raise exception 'Nutzer nicht gefunden.' using errcode = 'P0002';
  end if;
  return public._grant_koins(p_user, p_amount, 'admin', nullif(left(btrim(coalesce(p_note, '')), 100), ''));
end;
$$;

drop function if exists public.admin_list_users();

create function public.admin_list_users()
returns table (
  user_id uuid, display_name text, email text, role text, blocked boolean,
  created_at timestamptz, last_sign_in_at timestamptz,
  book_count integer, public_book_count integer, vocab_count integer,
  progress_count integer, session_count integer, answer_count integer, approx_bytes bigint,
  koins integer
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
    public._user_storage_bytes(p.id),
    coalesce((select w.balance from public.koin_wallets w where w.user_id = p.id), 0)
  from public.profiles p
  join auth.users u on u.id = p.id
  order by p.created_at;
end;
$$;


-- ----------------------------------------------------------------------------
-- 10. Bestehende Daten übernehmen (einmalig)
-- ----------------------------------------------------------------------------
-- Wer schon Bücher verwendet, behält sie kostenlos und mit allen bisherigen Vokabeln aktiv.

do $$
begin
  if not exists (select 1 from public.app_settings where key = 'migrated_0005') then
    insert into public.user_active_vocab (user_id, vocabulary_id)
    select b.owner_id, v.id from public.vocabulary v join public.books b on b.id = v.book_id
    on conflict do nothing;

    insert into public.user_active_vocab (user_id, vocabulary_id)
    select l.user_id, v.id from public.book_library l join public.vocabulary v on v.book_id = l.book_id
    on conflict do nothing;

    insert into public.book_purchases (user_id, book_id, price_paid)
    select l.user_id, l.book_id, 0 from public.book_library l
    on conflict do nothing;

    insert into public.app_settings (key, value) values ('migrated_0005', 1);
  end if;
end;
$$;


-- ----------------------------------------------------------------------------
-- 11. Row Level Security und Rechte
-- ----------------------------------------------------------------------------

alter table public.app_settings enable row level security;
alter table public.koin_wallets enable row level security;
alter table public.koin_ledger enable row level security;
alter table public.koin_daily enable row level security;
alter table public.koin_codes enable row level security;
alter table public.koin_code_failures enable row level security;
alter table public.koin_learn_awards enable row level security;
alter table public.user_active_vocab enable row level security;
alter table public.book_purchases enable row level security;
alter table public.shop_items enable row level security;
alter table public.user_items enable row level security;
alter table public.feedback enable row level security;

drop policy if exists settings_read on public.app_settings;
create policy settings_read on public.app_settings for select to authenticated using (true);
drop policy if exists wallet_own on public.koin_wallets;
create policy wallet_own on public.koin_wallets for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists ledger_own on public.koin_ledger;
create policy ledger_own on public.koin_ledger for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists active_own on public.user_active_vocab;
create policy active_own on public.user_active_vocab for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists purchases_own on public.book_purchases;
create policy purchases_own on public.book_purchases for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists items_read on public.shop_items;
create policy items_read on public.shop_items for select to authenticated using (true);
drop policy if exists user_items_own on public.user_items;
create policy user_items_own on public.user_items for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists feedback_select on public.feedback;
create policy feedback_select on public.feedback for select to authenticated
  using (user_id = (select auth.uid()) or public.is_staff());

-- Tabellen werden nur über Funktionen geändert; lesen darf man nur Eigenes bzw. Öffentliches.
revoke all on public.app_settings, public.koin_wallets, public.koin_ledger, public.koin_daily,
  public.koin_codes, public.koin_code_failures, public.koin_learn_awards, public.user_active_vocab,
  public.book_purchases, public.shop_items, public.user_items, public.feedback
  from anon, authenticated;
grant select on public.app_settings, public.koin_wallets, public.koin_ledger, public.user_active_vocab,
  public.book_purchases, public.shop_items, public.user_items, public.feedback to authenticated;

-- Gesperrte Nutzer verlieren auch hier jeden Zugriff.
do $$
declare
  t text;
begin
  foreach t in array array['koin_wallets', 'koin_ledger', 'user_active_vocab', 'book_purchases', 'user_items', 'feedback']
  loop
    execute format('drop policy if exists blocked_guard on public.%I', t);
    execute format(
      'create policy blocked_guard on public.%I as restrictive for all to authenticated using (not public.is_blocked()) with check (not public.is_blocked())',
      t);
  end loop;
end;
$$;

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
         'setting', 'get_wallet', 'claim_daily_bonus', 'admin_create_codes', 'admin_list_codes', 'admin_delete_code',
         'redeem_code', 'is_active_vocab', 'set_vocab_active', 'add_to_library', 'admin_set_book_price',
         'publish_book', 'get_book_summaries', 'get_public_books', 'get_book_outline',
         'get_learning_pool', 'get_my_stats', 'resolve_review_request',
         'get_shop', 'buy_item', 'equip_item', 'unequip_item', 'admin_set_item', 'get_leaderboard',
         'submit_feedback', 'list_feedback', 'set_feedback_status',
         'admin_set_setting', 'admin_grant_koins', 'admin_list_users')
  loop
    execute format('revoke all on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;
  -- Interne Helfer und Trigger: kein direkter Aufruf über die API.
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('_grant_koins', '_format_code', 'award_learning_koins', 'auto_activate_owner_vocab')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
  end loop;
end;
$$;


-- ===== 0006_presence_messages_tags.sql =====
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


-- ===== 0007_league_quests_sprint_duels.sql =====
-- ============================================================================
-- 0007: Wochenliga, Tagesquests + Serie, Sprint-Modus, Fehler-Training, Duelle (zusammen lernen).
--
-- Einspielen: Supabase → SQL Editor → komplett einfügen → Run (nach 0001–0006).
-- Die Datei ist wiederholbar.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. Einstellungen (alle im Admin-Tab „Coins & Shop“ änderbar)
-- ----------------------------------------------------------------------------

insert into public.app_settings (key, value) values
  ('quest_reward_answers', 3),   -- 20 richtige Antworten an einem Tag
  ('quest_reward_perfect', 5),   -- eine Runde ohne Fehler (mind. 10 Antworten)
  ('quest_reward_sprint', 5),    -- Sprint mit mind. 15 richtigen Antworten
  ('quest_reward_duel', 3),      -- ein Duell abgeschlossen
  ('league_reward_1', 30),       -- Wochenliga: Belohnung Platz 1–3
  ('league_reward_2', 20),
  ('league_reward_3', 10),
  ('league_min_points', 50),     -- so viele Wochenpunkte braucht es für die Belohnung
  ('duel_reward', 5),            -- Sieger eines Duells (höchstens 5 belohnte Siege pro Tag)
  ('duel_daily_cap', 5)
on conflict (key) do nothing;

-- Nachrichten des Systems (ohne Absender) heißen "Vokabeltrainer".
create or replace function public.get_unread_messages()
returns table (id uuid, body text, created_at timestamptz, from_name text)
language sql
stable
security definer
set search_path = public
as $$
  select m.id, m.body, m.created_at, coalesce(pr.display_name, 'Vokabeltrainer')
    from public.user_messages m
    left join public.profiles pr on pr.id = m.from_id
   where m.user_id = (select auth.uid()) and m.read_at is null and not public.is_blocked()
   order by m.created_at;
$$;


-- ----------------------------------------------------------------------------
-- 2. Fehler-Training
-- ----------------------------------------------------------------------------

-- Wie get_learning_pool (nur aktive Vokabeln mit Lernstand), aber nur Vokabeln, die in den
-- letzten 30 Tagen falsch beantwortet wurden und noch nicht auf Stufe 5 sind – die häufigsten Fehler zuerst.
create or replace function public.get_mistake_pool(p_book_id uuid default null)
returns jsonb
language sql
stable
set search_path = public
as $$
  select coalesce(jsonb_agg(e.elem order by e.wrong desc), '[]'::jsonb)
  from (
    select pool.elem, w.wrong
      from jsonb_array_elements(public.get_learning_pool(null, p_book_id)) as pool(elem)
      join (
        select a.vocabulary_id, count(*) as wrong
          from public.learning_answers a
         where a.user_id = (select auth.uid()) and not a.is_correct and not a.is_repeat
           and a.answered_at > now() - interval '30 days' and a.vocabulary_id is not null
         group by a.vocabulary_id
      ) w on w.vocabulary_id = (pool.elem ->> 'vocabulary_id')::uuid
     where (pool.elem ->> 'level')::float8 < 5
     order by w.wrong desc
     limit 60
  ) e;
$$;


-- ----------------------------------------------------------------------------
-- 3. Sprint-Modus
-- ----------------------------------------------------------------------------

create table if not exists public.sprint_scores (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  score integer not null check (score between 0 and 150),
  total integer not null check (total between 0 and 150),
  created_at timestamptz not null default now(),
  check (score <= total)
);

create index if not exists sprint_scores_user_idx on public.sprint_scores (user_id, created_at desc);

-- Speichert das Ergebnis eines 60-Sekunden-Sprints. Gibt die beste Punktzahl dieser Woche zurück.
create or replace function public.submit_sprint(p_score integer, p_total integer)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  v_week date := date_trunc('week', timezone('Europe/Berlin', now()))::date;
begin
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  if p_score is null or p_total is null or p_score < 0 or p_score > p_total or p_total > 150 then
    raise exception 'Ungültiges Ergebnis.' using errcode = '22023';
  end if;
  if (select count(*) from public.sprint_scores s where s.user_id = v_me and s.created_at > now() - interval '24 hours') >= 30 then
    raise exception 'Heute gab es schon viele Sprints – morgen geht es weiter.' using errcode = '54000';
  end if;
  insert into public.sprint_scores (user_id, score, total) values (v_me, p_score, p_total);
  return (select max(s.score) from public.sprint_scores s
           where s.user_id = v_me and (s.created_at at time zone 'Europe/Berlin')::date >= v_week);
end;
$$;

drop function if exists public.get_sprint_board();

create function public.get_sprint_board()
returns table (rank bigint, display_name text, score integer, is_me boolean,
               avatar_id text, color_id text, effect_id text, role text, tag_id text, theme_id text)
language sql
stable
security definer
set search_path = public
as $$
  with best as (
    select s.user_id, max(s.score) as score
      from public.sprint_scores s
     where (s.created_at at time zone 'Europe/Berlin')::date >= date_trunc('week', timezone('Europe/Berlin', now()))::date
     group by s.user_id
  )
  select (rank() over (order by b.score desc))::bigint, pr.display_name, b.score,
         (b.user_id = (select auth.uid())),
         pr.avatar_id, pr.color_id, pr.effect_id, pr.role, pr.tag_id, pr.theme_id
    from best b
    join public.profiles pr on pr.id = b.user_id and not pr.blocked
   where b.score > 0 and (select auth.uid()) is not null
   order by b.score desc, pr.display_name
   limit 20;
$$;


-- ----------------------------------------------------------------------------
-- 4. Serie und Tagesquests
-- ----------------------------------------------------------------------------

create or replace function public.get_streak()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with me as (select (select auth.uid()) as uid, (now() at time zone 'Europe/Berlin')::date as today),
  days as (
    select d.day from public.daily_stats d, me where d.user_id = me.uid and d.answers_total > 0
  ),
  grp as (select day, day - (row_number() over (order by day))::integer as g from days),
  islands as (select min(day) as s, max(day) as e, count(*)::integer as n from grp group by g)
  select jsonb_build_object(
    'current', coalesce((select i.n from islands i, me where i.e >= me.today - 1 order by i.e desc limit 1), 0),
    'best', coalesce((select max(n) from islands), 0),
    'today_done', exists (select 1 from days, me where days.day = me.today)
  );
$$;

create table if not exists public.quest_claims (
  user_id uuid not null references auth.users (id) on delete cascade,
  day date not null,
  quest_id text not null,
  claimed_at timestamptz not null default now(),
  primary key (user_id, day, quest_id)
);

-- Fortschritt der heutigen Quests. Quests: answers (20 richtig), perfect (fehlerfreie Runde),
-- sprint (15 richtig im Sprint), duel (ein Duell abgeschlossen).
create or replace function public.get_quests()
returns table (id text, progress integer, goal integer, reward integer, claimed boolean)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  v_today date := (now() at time zone 'Europe/Berlin')::date;
begin
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  return query
  select q.id, least(q.progress, q.goal)::integer, q.goal, q.reward,
         exists (select 1 from public.quest_claims c where c.user_id = v_me and c.day = v_today and c.quest_id = q.id)
  from (values
    ('answers', coalesce((select d.answers_correct from public.daily_stats d where d.user_id = v_me and d.day = v_today), 0), 20,
       public.setting('quest_reward_answers')),
    ('perfect', (select count(*)::integer from public.learning_sessions s
                  where s.user_id = v_me and (s.started_at at time zone 'Europe/Berlin')::date = v_today
                    and s.answers_total >= 10 and s.answers_correct = s.answers_total), 1,
       public.setting('quest_reward_perfect')),
    ('sprint', coalesce((select max(p.score) from public.sprint_scores p
                          where p.user_id = v_me and (p.created_at at time zone 'Europe/Berlin')::date = v_today), 0), 15,
       public.setting('quest_reward_sprint')),
    ('duel', (select count(*)::integer from public.duel_results r
               where r.user_id = v_me and (r.submitted_at at time zone 'Europe/Berlin')::date = v_today), 1,
       public.setting('quest_reward_duel'))
  ) as q(id, progress, goal, reward);
end;
$$;

-- Belohnung einer erledigten Quest abholen (einmal pro Tag und Quest). Gibt das neue Guthaben zurück.
create or replace function public.claim_quest(p_id text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  v_today date := (now() at time zone 'Europe/Berlin')::date;
  q record;
begin
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  select * into q from public.get_quests() g where g.id = p_id;
  if not found then
    raise exception 'Quest nicht gefunden.' using errcode = 'P0002';
  end if;
  if q.progress < q.goal then
    raise exception 'Diese Quest ist noch nicht geschafft.' using errcode = '22023';
  end if;
  if q.claimed then
    raise exception 'Diese Belohnung hast du heute schon abgeholt.' using errcode = '23505';
  end if;
  insert into public.quest_claims (user_id, day, quest_id) values (v_me, v_today, p_id);
  if q.reward > 0 then
    return public._grant_koins(v_me, q.reward, 'quest', p_id);
  end if;
  return public.get_wallet();
end;
$$;


-- ----------------------------------------------------------------------------
-- 5. Wochenliga
-- ----------------------------------------------------------------------------

create table if not exists public.league_members (
  user_id uuid primary key references auth.users (id) on delete cascade,
  tier integer not null default 1 check (tier between 1 and 5)
);

create table if not exists public.league_meta (
  id boolean primary key default true check (id),
  last_week date not null
);

create table if not exists public.league_history (
  user_id uuid not null references auth.users (id) on delete cascade,
  week_start date not null,
  tier integer not null,
  rank integer,
  points bigint not null,
  result text not null check (result in ('promoted', 'relegated', 'stayed')),
  reward integer not null default 0,
  primary key (user_id, week_start)
);

-- Wochenpunkte wie in der Rangliste (Montag bis Sonntag).
create or replace function public._week_points(p_user uuid, p_from date)
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(
           least(d.answers_correct, 200) * 2
           + case when d.answers_total > 0 then 25 else 0 end
           + case when d.answers_total >= 20 then round(20.0 * d.answers_correct / d.answers_total)::int else 0 end
         ), 0)::bigint
    from public.daily_stats d
   where d.user_id = p_user and d.day between p_from and p_from + 6;
$$;

-- Wertet beendete Wochen aus: Top 3 steigen auf, inaktive und (ab 8 Aktiven) die letzten 3 steigen ab,
-- Platz 1–3 bekommen Coins. Wird beim Öffnen der Liga ausgeführt und ist idempotent.
create or replace function public._league_rollover()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now_week date := date_trunc('week', timezone('Europe/Berlin', now()))::date;
  v_last date;
  v_min integer := public.setting('league_min_points');
  v_names text[] := array['Bronze', 'Silber', 'Gold', 'Saphir', 'Diamant'];
  r record;
  v_new integer;
  v_result text;
  v_reward integer;
  v_text text;
begin
  perform pg_advisory_xact_lock(70071);
  select m.last_week into v_last from public.league_meta m where m.id;
  if not found then
    insert into public.league_meta (id, last_week) values (true, v_now_week);
    return;
  end if;
  if v_last < v_now_week - 56 then
    v_last := v_now_week - 56;
  end if;

  while v_last < v_now_week loop
    insert into public.league_members (user_id)
    select distinct d.user_id
      from public.daily_stats d join public.profiles p on p.id = d.user_id and not p.blocked
     where d.day between v_last and v_last + 6
    on conflict do nothing;

    for r in
      with pts as (
        select m.user_id, m.tier, public._week_points(m.user_id, v_last) as pts
          from public.league_members m
          join public.profiles p on p.id = m.user_id and not p.blocked
      )
      select x.*,
             case when x.pts > 0 then rank() over (partition by x.tier order by x.pts desc) end as rnk,
             count(*) filter (where x.pts > 0) over (partition by x.tier) as parts
        from pts x
    loop
      v_new := r.tier;
      v_result := 'stayed';
      v_reward := 0;
      if r.pts > 0 and r.rnk <= 3 and r.tier < 5 then
        v_new := r.tier + 1;
        v_result := 'promoted';
      elsif r.tier > 1 and (r.pts = 0 or (r.parts >= 8 and r.rnk > r.parts - 3)) then
        v_new := r.tier - 1;
        v_result := 'relegated';
      end if;
      if r.pts >= v_min and r.rnk <= 3 then
        v_reward := public.setting('league_reward_' || r.rnk);
      end if;

      if v_new <> r.tier then
        update public.league_members set tier = v_new where user_id = r.user_id;
      end if;
      if r.pts > 0 or v_result <> 'stayed' then
        insert into public.league_history (user_id, week_start, tier, rank, points, result, reward)
        values (r.user_id, v_last, r.tier, r.rnk, r.pts, v_result, v_reward)
        on conflict do nothing;
        v_text := 'Wochenliga ' || to_char(v_last, 'DD.MM.') || ' (' || v_names[r.tier] || '): '
          || case when r.rnk is not null then 'Platz ' || r.rnk || ' mit ' || r.pts || ' Punkten. ' else 'keine Punkte. ' end
          || case v_result when 'promoted' then 'Aufstieg in ' || v_names[v_new] || '!'
                           when 'relegated' then 'Abstieg in ' || v_names[v_new] || '.'
                           else 'Du bleibst in ' || v_names[r.tier] || '.' end
          || case when v_reward > 0 then ' +' || v_reward || ' Coins.' else '' end;
        insert into public.user_messages (user_id, from_id, body) values (r.user_id, null, v_text);
        if v_reward > 0 then
          perform public._grant_koins(r.user_id, v_reward, 'league', v_last::text);
        end if;
      end if;
    end loop;

    v_last := v_last + 7;
    update public.league_meta set last_week = v_last where id;
  end loop;
end;
$$;

create or replace function public.get_league()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  v_week date := date_trunc('week', timezone('Europe/Berlin', now()))::date;
  v_tier integer;
  v_parts integer;
begin
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  perform public._league_rollover();
  insert into public.league_members (user_id) values (v_me) on conflict do nothing;
  select m.tier into v_tier from public.league_members m where m.user_id = v_me;

  select count(*) into v_parts
    from public.league_members m join public.profiles p on p.id = m.user_id and not p.blocked
   where m.tier = v_tier and public._week_points(m.user_id, v_week) > 0;

  return jsonb_build_object(
    'tier', v_tier,
    'week_start', v_week,
    'ends_at', ((v_week + 7)::timestamp at time zone 'Europe/Berlin'),
    'participants', v_parts,
    'relegation_active', v_parts >= 8,
    'min_points', public.setting('league_min_points'),
    'rewards', jsonb_build_array(public.setting('league_reward_1'), public.setting('league_reward_2'), public.setting('league_reward_3')),
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
               'rank', s.rnk, 'display_name', pr.display_name, 'points', s.pts, 'is_me', s.user_id = v_me,
               'avatar_id', pr.avatar_id, 'color_id', pr.color_id, 'effect_id', pr.effect_id,
               'role', pr.role, 'tag_id', pr.tag_id, 'theme_id', pr.theme_id) order by s.pts desc, pr.display_name)
        from (
          select x.user_id, x.pts, rank() over (order by x.pts desc) as rnk
            from (
              select m.user_id, public._week_points(m.user_id, v_week) as pts
                from public.league_members m join public.profiles p on p.id = m.user_id and not p.blocked
               where m.tier = v_tier
            ) x
           where x.pts > 0 or x.user_id = v_me
        ) s
        join public.profiles pr on pr.id = s.user_id), '[]'::jsonb),
    'last', (select to_jsonb(h) - 'user_id' from public.league_history h where h.user_id = v_me order by h.week_start desc limit 1)
  );
end;
$$;


-- ----------------------------------------------------------------------------
-- 6. Duelle: zusammen lernen
-- ----------------------------------------------------------------------------

create table if not exists public.duels (
  id uuid primary key default gen_random_uuid(),
  challenger_id uuid not null references auth.users (id) on delete cascade,
  opponent_id uuid not null references auth.users (id) on delete cascade,
  questions jsonb not null,
  status text not null default 'open' check (status in ('open', 'finished', 'cancelled')),
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  winner_id uuid references auth.users (id) on delete set null,
  check (challenger_id <> opponent_id)
);

create index if not exists duels_challenger_idx on public.duels (challenger_id, created_at desc);
create index if not exists duels_opponent_idx on public.duels (opponent_id, created_at desc);

create table if not exists public.duel_results (
  duel_id uuid not null references public.duels (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  correct integer not null check (correct >= 0),
  total integer not null check (total > 0),
  millis integer not null check (millis >= 0),
  submitted_at timestamptz not null default now(),
  primary key (duel_id, user_id),
  check (correct <= total)
);

-- Mitspieler suchen (nur Anzeigename und Aussehen).
drop function if exists public.search_players(text);

create function public.search_players(p_query text)
returns table (user_id uuid, display_name text, avatar_id text, color_id text, effect_id text, role text, tag_id text, theme_id text)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.display_name, p.avatar_id, p.color_id, p.effect_id, p.role, p.tag_id, p.theme_id
    from public.profiles p
   where (select auth.uid()) is not null and not public.is_blocked()
     and char_length(btrim(coalesce(p_query, ''))) >= 2
     and p.display_name ilike '%' || replace(replace(btrim(p_query), '%', ''), '_', '') || '%'
     and p.id <> (select auth.uid()) and not p.blocked
   order by p.display_name
   limit 10;
$$;

-- Duell starten: 10 zufällige Vokabeln, die ihr beide aktiviert habt (also aus einem gemeinsamen Online-Buch).
create or replace function public.create_duel(p_opponent uuid, p_count integer default 10)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  v_count integer := least(greatest(coalesce(p_count, 10), 5), 20);
  v_questions jsonb;
  v_id uuid;
  v_name text;
begin
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  if p_opponent is null or p_opponent = v_me
     or not exists (select 1 from public.profiles where id = p_opponent and not blocked) then
    raise exception 'Bitte wähle einen Mitspieler.' using errcode = '22023';
  end if;
  if (select count(*) from public.duels where status = 'open' and challenger_id = v_me) >= 5 then
    raise exception 'Du hast schon 5 offene Duelle.' using errcode = '54000';
  end if;
  if exists (select 1 from public.duels d
              where d.status = 'open' and d.created_at > now() - interval '7 days'
                and ((d.challenger_id = v_me and d.opponent_id = p_opponent)
                  or (d.challenger_id = p_opponent and d.opponent_id = v_me))) then
    raise exception 'Ihr habt schon ein offenes Duell. Spielt das zuerst.' using errcode = '23505';
  end if;

  select jsonb_agg(jsonb_build_object('vocabulary_id', x.vid,
                                      'direction', case when random() < 0.5 then 'forward' else 'backward' end))
    into v_questions
    from (
      select a1.vocabulary_id as vid
        from public.user_active_vocab a1
        join public.user_active_vocab a2 on a2.vocabulary_id = a1.vocabulary_id and a2.user_id = p_opponent
       where a1.user_id = v_me
         and exists (select 1 from public.translations t where t.vocabulary_id = a1.vocabulary_id)
       order by random()
       limit v_count
    ) x;
  if coalesce(jsonb_array_length(v_questions), 0) < 5 then
    raise exception 'Ihr habt zu wenige gemeinsame aktive Vokabeln (mindestens 5). Aktiviert beide Vokabeln aus demselben Online-Buch.'
      using errcode = '22023';
  end if;

  insert into public.duels (challenger_id, opponent_id, questions)
  values (v_me, p_opponent, v_questions) returning id into v_id;

  select display_name into v_name from public.profiles where id = v_me;
  insert into public.user_messages (user_id, from_id, body)
  values (p_opponent, v_me, '⚔️ ' || v_name || ' fordert dich zu einem Vokabel-Duell heraus! Du findest es unter „Duell“.');
  return v_id;
end;
$$;

create or replace function public.list_duels()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
begin
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  return coalesce((
    select jsonb_agg(x.j order by x.created_at desc)
      from (
        select d.created_at,
               jsonb_build_object(
                 'id', d.id, 'status', d.status, 'created_at', d.created_at,
                 'i_am_challenger', d.challenger_id = v_me,
                 'opponent_name', o.display_name,
                 'opponent', jsonb_build_object('avatar_id', o.avatar_id, 'color_id', o.color_id, 'effect_id', o.effect_id,
                                                'role', o.role, 'tag_id', o.tag_id, 'theme_id', o.theme_id),
                 'question_count', jsonb_array_length(d.questions),
                 'my_done', mr.user_id is not null,
                 'opp_done', orr.user_id is not null,
                 'my_correct', mr.correct, 'my_total', mr.total,
                 'opp_correct', case when d.status = 'finished' then orr.correct end,
                 'winner', case when d.status <> 'finished' then null
                                when d.winner_id is null then 'tie'
                                when d.winner_id = v_me then 'me' else 'opp' end
               ) as j
          from public.duels d
          join public.profiles o on o.id = case when d.challenger_id = v_me then d.opponent_id else d.challenger_id end
          left join public.duel_results mr on mr.duel_id = d.id and mr.user_id = v_me
          left join public.duel_results orr on orr.duel_id = d.id and orr.user_id <> v_me
         where (d.challenger_id = v_me or d.opponent_id = v_me)
           and d.created_at > now() - interval '30 days'
           and (d.status <> 'open' or d.created_at > now() - interval '7 days')
         order by d.created_at desc
         limit 50
      ) x
  ), '[]'::jsonb);
end;
$$;

create or replace function public.get_duel(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  d public.duels;
begin
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  select * into d from public.duels where id = p_id and (challenger_id = v_me or opponent_id = v_me);
  if not found then
    raise exception 'Duell nicht gefunden.' using errcode = 'P0002';
  end if;
  return jsonb_build_object(
    'id', d.id, 'status', d.status,
    'opponent_name', (select o.display_name from public.profiles o where o.id = case when d.challenger_id = v_me then d.opponent_id else d.challenger_id end),
    'my_done', exists (select 1 from public.duel_results r where r.duel_id = d.id and r.user_id = v_me),
    'my_correct', (select r.correct from public.duel_results r where r.duel_id = d.id and r.user_id = v_me),
    'my_total', (select r.total from public.duel_results r where r.duel_id = d.id and r.user_id = v_me),
    'opp_correct', (select r.correct from public.duel_results r where r.duel_id = d.id and r.user_id <> v_me and d.status = 'finished'),
    'winner', case when d.status <> 'finished' then null when d.winner_id is null then 'tie'
                   when d.winner_id = v_me then 'me' else 'opp' end,
    'questions', coalesce((
      select jsonb_agg(jsonb_build_object(
               'vocabulary_id', v.id, 'direction', e.q ->> 'direction', 'german', v.german,
               'german_alts', to_jsonb(v.german_alts),
               'translations', coalesce((select jsonb_agg(t.translation order by t.sort_order, t.created_at)
                                           from public.translations t where t.vocabulary_id = v.id), '[]'::jsonb)
             ) order by e.ord)
        from jsonb_array_elements(d.questions) with ordinality as e(q, ord)
        join public.vocabulary v on v.id = (e.q ->> 'vocabulary_id')::uuid), '[]'::jsonb)
  );
end;
$$;

-- Ergebnis abgeben. Sind beide fertig, wird das Duell entschieden (mehr richtige, bei Gleichstand schneller).
create or replace function public.submit_duel(p_id uuid, p_correct integer, p_total integer, p_millis integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  d public.duels;
  v_other public.duel_results;
  v_mine public.duel_results;
  v_winner uuid;
  v_name text;
  v_today date := (now() at time zone 'Europe/Berlin')::date;
  v_verdict text;
begin
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  select * into d from public.duels
   where id = p_id and (challenger_id = v_me or opponent_id = v_me) for update;
  if not found then
    raise exception 'Duell nicht gefunden.' using errcode = 'P0002';
  end if;
  if d.status <> 'open' or d.created_at < now() - interval '7 days' then
    raise exception 'Dieses Duell ist nicht mehr offen.' using errcode = '22023';
  end if;
  if p_total is null or p_total < 1 or p_total > jsonb_array_length(d.questions)
     or p_correct is null or p_correct < 0 or p_correct > p_total or coalesce(p_millis, -1) < 0 then
    raise exception 'Ungültiges Ergebnis.' using errcode = '22023';
  end if;
  if exists (select 1 from public.duel_results where duel_id = p_id and user_id = v_me) then
    raise exception 'Du hast dieses Duell schon gespielt.' using errcode = '23505';
  end if;

  insert into public.duel_results (duel_id, user_id, correct, total, millis)
  values (p_id, v_me, p_correct, p_total, least(p_millis, 3600000))
  returning * into v_mine;

  select * into v_other from public.duel_results where duel_id = p_id and user_id <> v_me;
  if not found then
    return jsonb_build_object('status', 'open', 'winner', null);
  end if;

  -- Beide fertig → entscheiden.
  if v_mine.correct > v_other.correct then v_winner := v_me;
  elsif v_mine.correct < v_other.correct then v_winner := v_other.user_id;
  elsif v_mine.millis < v_other.millis then v_winner := v_me;
  elsif v_mine.millis > v_other.millis then v_winner := v_other.user_id;
  else v_winner := null;
  end if;
  update public.duels set status = 'finished', finished_at = now(), winner_id = v_winner where id = p_id;

  if v_winner is not null
     and (select count(*) from public.koin_ledger l
           where l.user_id = v_winner and l.reason = 'duel'
             and (l.created_at at time zone 'Europe/Berlin')::date = v_today) < public.setting('duel_daily_cap')
     and public.setting('duel_reward') > 0 then
    perform public._grant_koins(v_winner, public.setting('duel_reward'), 'duel', p_id::text);
  end if;

  -- Der Gegner (der zuerst gespielt hat) bekommt eine Nachricht mit dem Ergebnis.
  select display_name into v_name from public.profiles where id = v_me;
  v_verdict := case when v_winner is null then 'unentschieden'
                    when v_winner = v_other.user_id then 'gewonnen' else 'verloren' end;
  insert into public.user_messages (user_id, from_id, body)
  values (v_other.user_id, v_me,
          '⚔️ Duell gegen ' || v_name || ' entschieden: Du hast ' || v_verdict || ' (' || v_other.correct || ' : ' || v_mine.correct || ').');

  return jsonb_build_object(
    'status', 'finished',
    'winner', case when v_winner is null then 'tie' when v_winner = v_me then 'me' else 'opp' end,
    'opp_correct', v_other.correct);
end;
$$;

-- Duell absagen/abbrechen (beide Seiten, solange es offen ist und man noch nicht gespielt hat).
create or replace function public.cancel_duel(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
begin
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  update public.duels d set status = 'cancelled', finished_at = now()
   where d.id = p_id and d.status = 'open' and (d.challenger_id = v_me or d.opponent_id = v_me)
     and not exists (select 1 from public.duel_results r where r.duel_id = d.id and r.user_id = v_me);
  if not found then
    raise exception 'Das Duell lässt sich nicht mehr absagen.' using errcode = '22023';
  end if;
end;
$$;


-- ----------------------------------------------------------------------------
-- 7. Rechte
-- ----------------------------------------------------------------------------

alter table public.sprint_scores enable row level security;
alter table public.quest_claims enable row level security;
alter table public.league_members enable row level security;
alter table public.league_meta enable row level security;
alter table public.league_history enable row level security;
alter table public.duels enable row level security;
alter table public.duel_results enable row level security;

-- Zugriff nur über die Funktionen oben.
revoke all on public.sprint_scores, public.quest_claims, public.league_members, public.league_meta,
  public.league_history, public.duels, public.duel_results from anon, authenticated;

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
         'get_unread_messages', 'get_mistake_pool', 'submit_sprint', 'get_sprint_board', 'get_streak', 'get_quests',
         'claim_quest', 'get_league', 'search_players', 'create_duel', 'list_duels', 'get_duel', 'submit_duel', 'cancel_duel')
  loop
    execute format('revoke all on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('_week_points', '_league_rollover')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
  end loop;
end;
$$;


-- ===== 0008_chat.sql =====
-- 0008: Gemeinsamer Chat für alle angemeldeten Lernenden.
-- Zugriff nur über Funktionen; wiederholbar.

create table if not exists public.chat_messages (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  body text not null check (char_length(body) between 1 and 500),
  created_at timestamptz not null default now()
);
create index if not exists chat_messages_created_idx on public.chat_messages (id desc);

alter table public.chat_messages enable row level security;
revoke all on public.chat_messages from anon, authenticated;

drop function if exists public.get_chat(integer);
create function public.get_chat(p_limit integer default 100)
returns table (id bigint, body text, created_at timestamptz, is_me boolean, display_name text,
               avatar_id text, color_id text, effect_id text, role text, tag_id text, theme_id text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if (select auth.uid()) is null or public.is_blocked() then
    raise exception 'Kein Zugriff.' using errcode = '42501';
  end if;
  return query
    select m.id, m.body, m.created_at, (m.user_id = (select auth.uid())), pr.display_name,
           pr.avatar_id, pr.color_id, pr.effect_id, pr.role, pr.tag_id, pr.theme_id
      from (select * from public.chat_messages order by chat_messages.id desc limit least(greatest(coalesce(p_limit, 100), 1), 200)) m
      join public.profiles pr on pr.id = m.user_id
     order by m.id asc;
end;
$$;

drop function if exists public.post_chat(text);
create function public.post_chat(p_body text)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  v_body text := btrim(coalesce(p_body, ''));
  v_id bigint;
begin
  if v_me is null or public.is_blocked() then
    raise exception 'Kein Zugriff.' using errcode = '42501';
  end if;
  if char_length(v_body) < 1 or char_length(v_body) > 500 then
    raise exception 'Die Nachricht braucht 1 bis 500 Zeichen.' using errcode = '22023';
  end if;
  if exists (select 1 from public.chat_messages where user_id = v_me and created_at > now() - interval '1 second') then
    raise exception 'Nicht so schnell – warte kurz.' using errcode = '22023';
  end if;
  if (select count(*) from public.chat_messages where user_id = v_me and created_at > now() - interval '1 minute') >= 20 then
    raise exception 'Zu viele Nachrichten – warte eine Minute.' using errcode = '22023';
  end if;
  if exists (select 1 from public.chat_messages where user_id = v_me and body = v_body and created_at > now() - interval '30 seconds') then
    raise exception 'Diese Nachricht hast du gerade schon gesendet.' using errcode = '22023';
  end if;
  insert into public.chat_messages (user_id, body) values (v_me, v_body) returning chat_messages.id into v_id;
  return v_id;
end;
$$;

drop function if exists public.delete_chat_message(bigint);
create function public.delete_chat_message(p_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_staff() then
    raise exception 'Nur Mods und Admins dürfen Nachrichten löschen.' using errcode = '42501';
  end if;
  delete from public.chat_messages where id = p_id;
end;
$$;

do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('get_chat', 'post_chat', 'delete_chat_message')
  loop
    execute format('revoke all on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;
end;
$$;


-- ===== 0009_coins_pay_rules.sql =====
-- 0009: Coins verschicken (!pay im Chat), einstellbare Punkteregeln, neue Shop-Artikel (Schwarzes-Loch-Set u. a.).
-- Wiederholbar. Nach 0008 ausführen.

-- ----------------------------------------------------------------------------
-- 1. Einstellungen: neue Zahlen, und welche davon Mods ändern dürfen
-- ----------------------------------------------------------------------------

alter table public.app_settings add column if not exists mod_editable boolean not null default false;

insert into public.app_settings (key, value, mod_editable) values
  ('points_per_answer', 2, true),        -- Rangliste: Punkte je richtiger Antwort
  ('points_daily_cap', 200, true),       -- Rangliste: höchstens so viele richtige Antworten pro Tag zählen
  ('points_active_day', 25, true),       -- Rangliste: Bonus für jeden aktiven Tag
  ('points_accuracy_bonus', 20, true),   -- Rangliste: maximaler Bonus für hohe Trefferquote
  ('points_accuracy_min', 20, true),     -- Rangliste: ab so vielen Antworten am Tag gibt es den Trefferquoten-Bonus
  ('chat_per_minute', 20, true),         -- Chat: höchstens so viele Nachrichten pro Minute und Person
  ('pay_max', 5000, false),              -- !pay: höchstens so viele Coins pro Überweisung
  ('pay_daily_cap', 10000, false)        -- !pay: höchstens so viele Coins pro Tag verschicken
on conflict (key) do nothing;

update public.app_settings set mod_editable = true where key in ('points_per_answer', 'points_daily_cap', 'points_active_day', 'points_accuracy_bonus', 'points_accuracy_min', 'chat_per_minute');

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
  if not public.is_admin() and not exists (select 1 from public.app_settings where key = p_key and mod_editable) then
    raise exception 'Diese Einstellung darf nur ein Admin ändern.' using errcode = '42501';
  end if;
  update public.app_settings set value = p_value where key = p_key;
  if not found then
    raise exception 'Unbekannte Einstellung.' using errcode = 'P0002';
  end if;
end;
$$;

-- ----------------------------------------------------------------------------
-- 2. Rangliste und Liga rechnen mit den einstellbaren Werten
-- ----------------------------------------------------------------------------

create or replace function public._day_points(p_correct integer, p_total integer)
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select (
    least(p_correct, public.setting('points_daily_cap')) * public.setting('points_per_answer')
    + case when p_total > 0 then public.setting('points_active_day') else 0 end
    + case when p_total >= greatest(public.setting('points_accuracy_min'), 1)
           then round(public.setting('points_accuracy_bonus')::numeric * p_correct / p_total)::int
           else 0 end
  )::bigint;
$$;

create or replace function public._week_points(p_user uuid, p_from date)
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(public._day_points(d.answers_correct, d.answers_total)), 0)::bigint
    from public.daily_stats d
   where d.user_id = p_user and d.day between p_from and p_from + 6;
$$;

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
    select d.user_id as uid,
           sum(public._day_points(d.answers_correct, d.answers_total))::bigint as pts
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
-- 3. Chat: Nachrichtenart und !pay
-- ----------------------------------------------------------------------------

alter table public.chat_messages add column if not exists kind text not null default 'text';
alter table public.chat_messages drop constraint if exists chat_messages_kind_check;
alter table public.chat_messages add constraint chat_messages_kind_check check (kind in ('text', 'pay'));

drop function if exists public.get_chat(integer);
create function public.get_chat(p_limit integer default 100)
returns table (id bigint, body text, created_at timestamptz, is_me boolean, display_name text,
               avatar_id text, color_id text, effect_id text, role text, tag_id text, theme_id text, kind text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if (select auth.uid()) is null or public.is_blocked() then
    raise exception 'Kein Zugriff.' using errcode = '42501';
  end if;
  return query
    select m.id, m.body, m.created_at, (m.user_id = (select auth.uid())), pr.display_name,
           pr.avatar_id, pr.color_id, pr.effect_id, pr.role, pr.tag_id, pr.theme_id, m.kind
      from (select * from public.chat_messages order by chat_messages.id desc limit least(greatest(coalesce(p_limit, 100), 1), 200)) m
      join public.profiles pr on pr.id = m.user_id
     order by m.id asc;
end;
$$;

drop function if exists public.post_chat(text);
create function public.post_chat(p_body text)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  v_body text := btrim(coalesce(p_body, ''));
  v_id bigint;
  v_m text[];
  v_to uuid;
  v_to_name text;
  v_me_name text;
  v_amount integer;
  v_sent integer;
begin
  if v_me is null or public.is_blocked() then
    raise exception 'Kein Zugriff.' using errcode = '42501';
  end if;
  if char_length(v_body) < 1 or char_length(v_body) > 500 then
    raise exception 'Die Nachricht braucht 1 bis 500 Zeichen.' using errcode = '22023';
  end if;
  if exists (select 1 from public.chat_messages where user_id = v_me and created_at > now() - interval '1 second') then
    raise exception 'Nicht so schnell – warte kurz.' using errcode = '22023';
  end if;
  if (select count(*) from public.chat_messages where user_id = v_me and created_at > now() - interval '1 minute')
       >= greatest(public.setting('chat_per_minute'), 1) then
    raise exception 'Zu viele Nachrichten – warte eine Minute.' using errcode = '22023';
  end if;

  -- Befehl: !pay @Anzeigename 100
  if v_body ~* '^!pay(\s|$)' then
    v_m := regexp_match(v_body, '^!pay\s+@?(.+?)\s+(\d{1,9})$', 'i');
    if v_m is null then
      raise exception 'So geht es: !pay @Anzeigename 100' using errcode = '22023';
    end if;
    v_amount := v_m[2]::integer;
    if v_amount < 1 then
      raise exception 'Der Betrag muss mindestens 1 sein.' using errcode = '22023';
    end if;
    if v_amount > public.setting('pay_max') then
      raise exception 'Pro Überweisung sind höchstens % Coins erlaubt.', public.setting('pay_max') using errcode = '22023';
    end if;
    select p.id, p.display_name into v_to, v_to_name
      from public.profiles p where lower(p.display_name) = lower(btrim(v_m[1])) and not p.blocked;
    if v_to is null then
      raise exception 'Spieler „%“ nicht gefunden.', btrim(v_m[1]) using errcode = 'P0002';
    end if;
    if v_to = v_me then
      raise exception 'Du kannst dir nicht selbst Coins schicken.' using errcode = '22023';
    end if;
    select coalesce(sum(-l.amount), 0) into v_sent
      from public.koin_ledger l
     where l.user_id = v_me and l.reason = 'pay_out'
       and (l.created_at at time zone 'Europe/Berlin')::date = (now() at time zone 'Europe/Berlin')::date;
    if v_sent + v_amount > public.setting('pay_daily_cap') then
      raise exception 'Tageslimit: Du kannst heute noch % Coins verschicken.', greatest(public.setting('pay_daily_cap') - v_sent, 0) using errcode = '22023';
    end if;
    if coalesce((select balance from public.koin_wallets where user_id = v_me), 0) < v_amount then
      raise exception 'Nicht genug Coins.' using errcode = '23514';
    end if;
    select display_name into v_me_name from public.profiles where id = v_me;
    perform public._grant_koins(v_me, -v_amount, 'pay_out', v_to::text);
    perform public._grant_koins(v_to, v_amount, 'pay_in', v_me::text);
    insert into public.user_messages (user_id, from_id, body)
    values (v_to, null, v_me_name || ' hat dir ' || v_amount || ' Coins geschickt. 💵');
    insert into public.chat_messages (user_id, body, kind)
    values (v_me, v_me_name || ' hat ' || v_to_name || ' ' || v_amount || ' Coins geschickt 💵', 'pay')
    returning chat_messages.id into v_id;
    return v_id;
  end if;

  if exists (select 1 from public.chat_messages where user_id = v_me and body = v_body and created_at > now() - interval '30 seconds') then
    raise exception 'Diese Nachricht hast du gerade schon gesendet.' using errcode = '22023';
  end if;
  insert into public.chat_messages (user_id, body) values (v_me, v_body) returning chat_messages.id into v_id;
  return v_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- 4. Wortlaut: Koins → Coins, neue Shop-Artikel
-- ----------------------------------------------------------------------------

update public.shop_items set name = replace(name, 'Koin', 'Coin') where name like '%Koin%';
update public.user_messages set body = replace(body, 'Koins', 'Coins') where body like '%Koins%';

insert into public.shop_items (id, kind, name, price, sort, required_role) values
  ('avatar_lava',    'avatar', 'Lavalampe',        1300, 250, null),
  ('avatar_matrix',  'avatar', 'Matrix',           1600, 260, null),
  ('avatar_aurora',  'avatar', 'Aurora',           1900, 270, null),
  ('avatar_eclipse', 'avatar', 'Sonnenfinsternis', 3500, 280, null),
  ('color_void',     'color',  'Ereignishorizont', 1500, 130, null),
  ('effect_vortex',  'effect', 'Wirbel',           3000, 140, null)
on conflict (id) do nothing;

-- ----------------------------------------------------------------------------
-- 5. Rechte
-- ----------------------------------------------------------------------------

do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('get_leaderboard', 'get_chat', 'post_chat', 'staff_set_setting')
  loop
    execute format('revoke all on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('_day_points', '_week_points')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
  end loop;
end;
$$;


-- ===== 0010_sprint_coins_games_piano.sql =====
-- 0010: Coins im Sprint, Bot-Spiele (Snake, Tetris, Block Blast) gegen Eintritt, Klavier-Artikel.
-- Wiederholbar. Nach 0009 ausführen.

-- ----------------------------------------------------------------------------
-- 1. Einstellungen
-- ----------------------------------------------------------------------------

insert into public.app_settings (key, value, mod_editable) values
  ('sprint_coin_every', 5, false),     -- Sprint: 1 Coin je so viele richtige Antworten
  ('sprint_coin_cap', 20, false),      -- Sprint: höchstens so viele Coins pro Tag
  ('game_fee', 10, false),             -- Bot-Spiele: Eintritt in Coins
  ('game_reward', 20, false),          -- Bot-Spiele: Gewinn bei Sieg über den Bot (Coins)
  ('game_daily_cap', 200, false),      -- Bot-Spiele: höchstens so viele Gewinn-Coins pro Tag
  ('bot_snake', 15, true),             -- Stärke des Bots: höchstes Ziel (Äpfel)
  ('bot_tetris', 1200, true),          -- Stärke des Bots: höchstes Ziel (Punkte)
  ('bot_blast', 500, true)             -- Stärke des Bots: höchstes Ziel (Punkte)
on conflict (key) do nothing;

-- ----------------------------------------------------------------------------
-- 2. Sprint verdient Coins
-- ----------------------------------------------------------------------------

drop function if exists public.submit_sprint(integer, integer);
create function public.submit_sprint(p_score integer, p_total integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  v_week date := date_trunc('week', timezone('Europe/Berlin', now()))::date;
  v_today date := (now() at time zone 'Europe/Berlin')::date;
  v_every integer := greatest(public.setting('sprint_coin_every'), 1);
  v_earned integer;
  v_got integer;
  v_best integer;
begin
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  if p_score is null or p_total is null or p_score < 0 or p_score > p_total or p_total > 150 then
    raise exception 'Ungültiges Ergebnis.' using errcode = '22023';
  end if;
  if (select count(*) from public.sprint_scores s where s.user_id = v_me and s.created_at > now() - interval '24 hours') >= 30 then
    raise exception 'Heute gab es schon viele Sprints – morgen geht es weiter.' using errcode = '54000';
  end if;
  insert into public.sprint_scores (user_id, score, total) values (v_me, p_score, p_total);

  select coalesce(sum(l.amount), 0) into v_got
    from public.koin_ledger l
   where l.user_id = v_me and l.reason = 'sprint' and (l.created_at at time zone 'Europe/Berlin')::date = v_today;
  v_earned := least(p_score / v_every, greatest(public.setting('sprint_coin_cap') - v_got, 0));
  if v_earned > 0 then
    perform public._grant_koins(v_me, v_earned, 'sprint');
  end if;

  select max(s.score) into v_best from public.sprint_scores s
   where s.user_id = v_me and (s.created_at at time zone 'Europe/Berlin')::date >= v_week;
  return jsonb_build_object('best', v_best, 'earned', v_earned);
end;
$$;

-- ----------------------------------------------------------------------------
-- 3. Bot-Spiele
-- ----------------------------------------------------------------------------

create table if not exists public.game_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  game text not null check (game in ('snake', 'tetris', 'blast')),
  bot_score integer not null,
  fee integer not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  score integer,
  won boolean,
  reward integer not null default 0
);
create index if not exists game_runs_user_idx on public.game_runs (user_id, started_at desc);

alter table public.game_runs enable row level security;
revoke all on public.game_runs from anon, authenticated;

-- Bezahlt den Eintritt und würfelt das Ziel des Bots (25 % bis 100 % seiner Maximalstärke).
drop function if exists public.start_game(text);
create function public.start_game(p_game text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  v_fee integer := public.setting('game_fee');
  v_max integer;
  v_bot integer;
  v_id uuid;
  v_balance integer;
begin
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  if p_game not in ('snake', 'tetris', 'blast') then
    raise exception 'Unbekanntes Spiel.' using errcode = '22023';
  end if;
  v_max := greatest(public.setting('bot_' || p_game), 1);
  v_bot := greatest(1, round(v_max * (0.25 + 0.75 * random()))::integer);
  if coalesce((select balance from public.koin_wallets where user_id = v_me), 0) < v_fee then
    raise exception 'Nicht genug Coins – der Eintritt kostet % Coins.', v_fee using errcode = '23514';
  end if;
  insert into public.game_runs (user_id, game, bot_score, fee) values (v_me, p_game, v_bot, v_fee) returning id into v_id;
  v_balance := public._grant_koins(v_me, -v_fee, 'game_fee', v_id::text);
  return jsonb_build_object('id', v_id, 'bot_score', v_bot, 'fee', v_fee, 'balance', v_balance);
end;
$$;

-- Wertet das Spiel. Die Punkte werden auf das begrenzt, was in der vergangenen Zeit möglich war.
drop function if exists public.finish_game(uuid, integer);
create function public.finish_game(p_id uuid, p_score integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  r public.game_runs;
  v_elapsed numeric;
  v_rate numeric;
  v_score integer;
  v_won boolean;
  v_reward integer := 0;
  v_today date := (now() at time zone 'Europe/Berlin')::date;
  v_paid integer;
  v_balance integer;
begin
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  select * into r from public.game_runs where id = p_id and user_id = v_me for update;
  if not found then
    raise exception 'Spiel nicht gefunden.' using errcode = 'P0002';
  end if;
  if r.finished_at is not null then
    raise exception 'Dieses Spiel ist schon gewertet.' using errcode = '22023';
  end if;
  if p_score is null or p_score < 0 then
    raise exception 'Ungültiges Ergebnis.' using errcode = '22023';
  end if;
  v_elapsed := extract(epoch from (now() - r.started_at));
  v_rate := case r.game when 'snake' then 2 when 'tetris' then 50 else 60 end;
  v_score := least(p_score, floor(v_elapsed * v_rate)::integer);
  v_won := v_score > r.bot_score;
  if v_won and v_elapsed <= 7200 then
    select coalesce(sum(l.amount), 0) into v_paid
      from public.koin_ledger l
     where l.user_id = v_me and l.reason = 'game_win' and (l.created_at at time zone 'Europe/Berlin')::date = v_today;
    v_reward := least(public.setting('game_reward'), greatest(public.setting('game_daily_cap') - v_paid, 0));
  end if;
  update public.game_runs set finished_at = now(), score = v_score, won = v_won, reward = v_reward where id = r.id;
  if v_reward > 0 then
    v_balance := public._grant_koins(v_me, v_reward, 'game_win', r.id::text);
  else
    v_balance := coalesce((select balance from public.koin_wallets where user_id = v_me), 0);
  end if;
  return jsonb_build_object('won', v_won, 'score', v_score, 'bot_score', r.bot_score, 'reward', v_reward, 'balance', v_balance);
end;
$$;

-- ----------------------------------------------------------------------------
-- 4. Shop: Klavier
-- ----------------------------------------------------------------------------

insert into public.shop_items (id, kind, name, price, sort, required_role) values
  ('avatar_piano', 'avatar', 'Klavier',    2800, 290, null),
  ('effect_piano', 'effect', 'Klaviertasten', 3500, 150, null)
on conflict (id) do nothing;

-- ----------------------------------------------------------------------------
-- 5. Rechte
-- ----------------------------------------------------------------------------

do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('submit_sprint', 'start_game', 'finish_game')
  loop
    execute format('revoke all on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;
end;
$$;


-- ===== 0011_alphamod_gambling_highscores.sql =====
-- 0011: Alphamod, Ranglistenpunkte ± (Admin), Flüstern/ungelesen/Stummschalten im Chat,
-- Gambling, Highscores statt Bot (+Crossy Road, Flappy Bird), einstellbare Quest-Ziele und
-- Lern-Wartezeiten, Multiple-Choice-Übung, gekaufte Artikel bleiben nutzbar, Nachrichten löschen.
-- Wiederholbar. Nach 0010 ausführen.

-- ----------------------------------------------------------------------------
-- 1. Rollen: Alphamod
-- ----------------------------------------------------------------------------

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles
  add constraint profiles_role_check check (role in ('user', 'mod', 'alphamod', 'admin'));

create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select p.role in ('mod', 'alphamod', 'admin') and not p.blocked
      from public.profiles p where p.id = (select auth.uid())
  ), false);
$$;

-- Darf Werte (Regeln) ändern: nur Alphamods und Admins. Normale Mods verwalten nur Bücher usw.
create or replace function public.is_alphamod()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select p.role in ('alphamod', 'admin') and not p.blocked
      from public.profiles p where p.id = (select auth.uid())
  ), false);
$$;

create or replace function public._role_rank(p_role text)
returns integer
language sql
immutable
as $$
  select case p_role when 'admin' then 3 when 'alphamod' then 2 when 'mod' then 1 else 0 end;
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
  if p_role not in ('user', 'mod', 'alphamod') then
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

-- ----------------------------------------------------------------------------
-- 2. Einstellungen
-- ----------------------------------------------------------------------------

-- Normale Mods dürfen keine Werte ändern.
update public.app_settings set mod_editable = false where mod_editable;

insert into public.app_settings (key, value, mod_editable) values
  ('quest_goal_answers', 20, false),     -- Quest: so viele richtige Antworten heute
  ('quest_goal_perfect', 10, false),     -- Quest: fehlerfreie Runde mit mindestens so vielen Fragen
  ('quest_goal_sprint', 10, false),      -- Quest: so viele richtige im Sprint
  ('quest_goal_duel', 1, false),         -- Quest: so viele Duelle abschließen
  ('learn_gap_l1', 0, false),            -- Wartezeit (Minuten) bis eine Vokabel auf Stufe 1 wieder drankommt
  ('learn_gap_l2', 10, false),           -- … Stufe 2
  ('learn_gap_l3', 60, false),           -- … Stufe 3
  ('learn_gap_l4', 720, false),          -- … Stufe 4
  ('mc_points_per_answer', 1, false),    -- Multiple Choice: Ranglistenpunkte je richtiger Antwort
  ('mc_daily_cap', 100, false),          -- Multiple Choice: höchstens so viele richtige pro Tag zählen
  ('mc_coin_every', 10, false),          -- Multiple Choice: 1 Coin je so viele richtige Antworten
  ('mc_coin_cap', 10, false),            -- Multiple Choice: höchstens so viele Coins pro Tag
  ('gambling_win_permille', 330, false),  -- Gambling: Gewinnchance in ‰ (ohne Jackpot)
  ('gambling_jackpot_permille', 20, false), -- Gambling: Jackpot-Chance in ‰
  ('gambling_mult_win', 2, false),        -- Gambling: Gewinn = Einsatz × diese Zahl
  ('gambling_mult_jackpot', 10, false),   -- Gambling: Jackpot = Einsatz × diese Zahl
  ('gambling_max_bet', 200, false),       -- Gambling: höchster Einsatz
  ('game_record_reward', 10, false),     -- Spiele: Coins für einen neuen Highscore-Rekord
  ('timeout_max', 60, false)             -- Stummschalten: längste Dauer in Minuten (Alphamod/Admin)
on conflict (key) do nothing;

-- Bot-Werte gibt es nicht mehr.
delete from public.app_settings where key in ('bot_snake', 'bot_tetris', 'bot_blast', 'game_reward', 'game_daily_cap');

drop function if exists public.staff_set_setting(text, integer);
create function public.staff_set_setting(p_key text, p_value integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_alphamod() then
    raise exception 'Nur Alphamods und Admins dürfen Werte ändern.' using errcode = '42501';
  end if;
  if p_value is null or p_value < 0 or p_value > 1000000 then
    raise exception 'Ungültiger Wert.' using errcode = '22023';
  end if;
  update public.app_settings set value = p_value where key = p_key;
  if not found then
    raise exception 'Unbekannte Einstellung.' using errcode = 'P0002';
  end if;
end;
$$;

-- ----------------------------------------------------------------------------
-- 3. Ranglistenpunkte: Anpassungen durch Admins, Multiple-Choice-Punkte
-- ----------------------------------------------------------------------------

alter table public.daily_stats add column if not exists choice_correct integer not null default 0;

create table if not exists public.points_adjustments (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  points integer not null check (points <> 0),
  reason text not null default '',
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists points_adjustments_user_idx on public.points_adjustments (user_id, created_at);
alter table public.points_adjustments enable row level security;
revoke all on public.points_adjustments from anon, authenticated;

create or replace function public._choice_points(p_choice integer)
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select (least(p_choice, public.setting('mc_daily_cap')) * public.setting('mc_points_per_answer'))::bigint;
$$;

create or replace function public._week_points(p_user uuid, p_from date)
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select sum(public._day_points(d.answers_correct, d.answers_total) + public._choice_points(d.choice_correct))
                     from public.daily_stats d
                    where d.user_id = p_user and d.day between p_from and p_from + 6), 0)::bigint
       + coalesce((select sum(a.points) from public.points_adjustments a
                    where a.user_id = p_user
                      and (a.created_at at time zone 'Europe/Berlin')::date between p_from and p_from + 6), 0)::bigint;
$$;

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
  with parts as (
    select d.user_id as uid,
           public._day_points(d.answers_correct, d.answers_total) + public._choice_points(d.choice_correct) as pts
      from public.daily_stats d
     where v_from is null or d.day >= v_from
    union all
    select a.user_id, a.points::bigint
      from public.points_adjustments a
     where v_from is null or (a.created_at at time zone 'Europe/Berlin')::date >= v_from
  ), scored as (
    select uid, sum(pts)::bigint as pts from parts group by uid
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

create or replace function public.admin_adjust_points(p_user uuid, p_points integer, p_reason text default '')
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._require_admin();
  if p_points is null or p_points = 0 or abs(p_points) > 100000 then
    raise exception 'Die Punkte müssen zwischen -100000 und 100000 liegen (nicht 0).' using errcode = '22023';
  end if;
  if not exists (select 1 from public.profiles where id = p_user) then
    raise exception 'Nutzer nicht gefunden.' using errcode = 'P0002';
  end if;
  insert into public.points_adjustments (user_id, points, reason, created_by)
  values (p_user, p_points, left(btrim(coalesce(p_reason, '')), 200), (select auth.uid()));
end;
$$;

create or replace function public.admin_list_point_adjustments()
returns table (id bigint, display_name text, points integer, reason text, created_at timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public._require_admin();
  return query
  select a.id, pr.display_name, a.points, a.reason, a.created_at
    from public.points_adjustments a
    left join public.profiles pr on pr.id = a.user_id
   order by a.created_at desc
   limit 50;
end;
$$;

-- Multiple-Choice-Übung (auch Genus- und Konjugations-Quiz): weniger Punkte und Coins, keine Stufenänderung.
create or replace function public.submit_choice(p_correct integer, p_total integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  v_today date := (now() at time zone 'Europe/Berlin')::date;
  v_before integer;
  v_counted integer;
  v_after integer;
  v_every integer := greatest(public.setting('mc_coin_every'), 1);
  v_paid integer;
  v_coins integer;
begin
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  if p_correct is null or p_total is null or p_correct < 0 or p_total < 1 or p_total > 100 or p_correct > p_total then
    raise exception 'Ungültiges Ergebnis.' using errcode = '22023';
  end if;
  select coalesce(choice_correct, 0) into v_before from public.daily_stats where user_id = v_me and day = v_today;
  v_before := coalesce(v_before, 0);
  v_counted := greatest(least(p_correct, public.setting('mc_daily_cap') - v_before), 0);
  insert into public.daily_stats (user_id, day, answers_total, answers_correct, choice_correct)
  values (v_me, v_today, 0, 0, v_counted)
  on conflict (user_id, day) do update set choice_correct = public.daily_stats.choice_correct + v_counted;
  v_after := v_before + v_counted;
  select coalesce(sum(l.amount), 0) into v_paid
    from public.koin_ledger l
   where l.user_id = v_me and l.reason = 'choice'
     and (l.created_at at time zone 'Europe/Berlin')::date = v_today;
  v_coins := least(v_after / v_every - v_before / v_every, greatest(public.setting('mc_coin_cap') - v_paid, 0));
  if v_coins > 0 then
    perform public._grant_koins(v_me, v_coins, 'choice', null);
  end if;
  return jsonb_build_object('points', v_counted * public.setting('mc_points_per_answer'), 'coins', greatest(v_coins, 0));
end;
$$;

-- ----------------------------------------------------------------------------
-- 4. Quests mit einstellbaren Zielen
-- ----------------------------------------------------------------------------

create or replace function public.get_quests()
returns table (id text, progress integer, goal integer, reward integer, claimed boolean)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  v_today date := (now() at time zone 'Europe/Berlin')::date;
  v_perfect_min integer := greatest(public.setting('quest_goal_perfect'), 1);
begin
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  return query
  select q.id, least(q.progress, q.goal)::integer, q.goal, q.reward,
         exists (select 1 from public.quest_claims c where c.user_id = v_me and c.day = v_today and c.quest_id = q.id)
  from (values
    ('answers', coalesce((select d.answers_correct from public.daily_stats d where d.user_id = v_me and d.day = v_today), 0),
       greatest(public.setting('quest_goal_answers'), 1), public.setting('quest_reward_answers')),
    ('perfect', (select count(*)::integer from public.learning_sessions s
                  where s.user_id = v_me and (s.started_at at time zone 'Europe/Berlin')::date = v_today
                    and s.answers_total >= v_perfect_min and s.answers_correct = s.answers_total), 1,
       public.setting('quest_reward_perfect')),
    ('sprint', coalesce((select max(p.score) from public.sprint_scores p
                          where p.user_id = v_me and (p.created_at at time zone 'Europe/Berlin')::date = v_today), 0),
       greatest(public.setting('quest_goal_sprint'), 1), public.setting('quest_reward_sprint')),
    ('duel', (select count(*)::integer from public.duel_results r
               where r.user_id = v_me and (r.submitted_at at time zone 'Europe/Berlin')::date = v_today),
       greatest(public.setting('quest_goal_duel'), 1), public.setting('quest_reward_duel'))
  ) as q(id, progress, goal, reward);
end;
$$;

-- ----------------------------------------------------------------------------
-- 5. Lernpool mit Zeitpunkt der letzten Antwort (für die Wartezeiten)
-- ----------------------------------------------------------------------------

create or replace function public.get_learning_pool(p_language text default null, p_book_id uuid default null)
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
      'german_alts', to_jsonb(v.german_alts),
      'translations', coalesce((
         select jsonb_agg(t.translation order by t.sort_order, t.created_at)
           from public.translations t where t.vocabulary_id = v.id), '[]'::jsonb),
      'level', coalesce(pr.learning_level, 1)::float8,
      'last_at', pr.last_answered_at
    )), '[]'::jsonb)
  from public.vocabulary v
  join public.books b on b.id = v.book_id
  left join public.user_vocabulary_progress pr
    on pr.vocabulary_id = v.id and pr.user_id = (select auth.uid())
  where (p_book_id is null or v.book_id = p_book_id)
    and (p_language is null or b.language = p_language);
$$;

-- ----------------------------------------------------------------------------
-- 6. Shop: gekaufte Artikel bleiben nutzbar
-- ----------------------------------------------------------------------------

drop function if exists public.get_shop();
create function public.get_shop()
returns table (id text, kind text, name text, price integer, sort integer, owned boolean, equipped boolean,
               required_role text, active boolean)
language sql
stable
security definer
set search_path = public
as $$
  select i.id, i.kind, i.name, i.price, i.sort,
         (i.price = 0 or o.item_id is not null),
         exists (select 1 from public.profiles p
                  where p.id = (select auth.uid())
                    and i.id in (p.avatar_id, p.color_id, p.effect_id, p.theme_id, p.tag_id)),
         i.required_role, i.active
    from public.shop_items i
    left join public.user_items o on o.item_id = i.id and o.user_id = (select auth.uid())
   where (select auth.uid()) is not null
     and (i.active or o.item_id is not null)
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
  v_active boolean;
  v_owned boolean;
begin
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  select kind, price, required_role, active into v_kind, v_price, v_req, v_active
    from public.shop_items where id = p_item_id;
  v_owned := exists (select 1 from public.user_items where user_id = v_me and item_id = p_item_id);
  if v_kind is null or not (v_active or v_owned) then
    raise exception 'Artikel nicht gefunden.' using errcode = 'P0002';
  end if;
  if v_req is not null
     and public._role_rank(v_req) > public._role_rank((select role from public.profiles where id = v_me)) then
    raise exception 'Diesen Artikel gibt es nur für %.',
      case v_req when 'admin' then 'Admins' else 'Mods und Admins' end using errcode = '42501';
  end if;
  if v_price > 0 and not v_owned then
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

-- ----------------------------------------------------------------------------
-- 7. Chat: Flüstern, ungelesen, Löschen, Stummschalten
-- ----------------------------------------------------------------------------

alter table public.profiles add column if not exists muted_until timestamptz;

alter table public.chat_messages add column if not exists recipient_id uuid references auth.users (id) on delete cascade;
alter table public.chat_messages drop constraint if exists chat_messages_kind_check;
alter table public.chat_messages add constraint chat_messages_kind_check check (kind in ('text', 'pay', 'whisper'));

create table if not exists public.chat_reads (
  user_id uuid primary key references auth.users (id) on delete cascade,
  last_id bigint not null default 0
);
alter table public.chat_reads enable row level security;
revoke all on public.chat_reads from anon, authenticated;

drop function if exists public.get_chat(integer);
create function public.get_chat(p_limit integer default 100)
returns table (id bigint, body text, created_at timestamptz, is_me boolean, display_name text,
               avatar_id text, color_id text, effect_id text, role text, tag_id text, theme_id text, kind text,
               recipient_name text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
begin
  if v_me is null or public.is_blocked() then
    raise exception 'Kein Zugriff.' using errcode = '42501';
  end if;
  return query
    select m.id, m.body, m.created_at, (m.user_id = v_me), pr.display_name,
           pr.avatar_id, pr.color_id, pr.effect_id, pr.role, pr.tag_id, pr.theme_id, m.kind,
           rp.display_name
      from (select c.* from public.chat_messages c
             where c.kind <> 'whisper' or c.user_id = v_me or c.recipient_id = v_me
             order by c.id desc
             limit least(greatest(coalesce(p_limit, 100), 1), 200)) m
      join public.profiles pr on pr.id = m.user_id
      left join public.profiles rp on rp.id = m.recipient_id
     order by m.id asc;
end;
$$;

create or replace function public.chat_unread_count()
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::integer
    from public.chat_messages c
   where (select auth.uid()) is not null and not public.is_blocked()
     and c.id > coalesce((select r.last_id from public.chat_reads r where r.user_id = (select auth.uid())), 0)
     and c.user_id <> (select auth.uid())
     and (c.kind <> 'whisper' or c.recipient_id = (select auth.uid()));
$$;

create or replace function public.chat_mark_read(p_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
begin
  if v_me is null then
    return;
  end if;
  insert into public.chat_reads (user_id, last_id) values (v_me, greatest(coalesce(p_id, 0), 0))
  on conflict (user_id) do update set last_id = greatest(public.chat_reads.last_id, excluded.last_id);
end;
$$;

drop function if exists public.post_chat(text);
create function public.post_chat(p_body text)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  v_body text := btrim(coalesce(p_body, ''));
  v_id bigint;
  v_m text[];
  v_to uuid;
  v_to_name text;
  v_me_name text;
  v_amount integer;
  v_sent integer;
  v_rest text;
  v_muted timestamptz;
begin
  if v_me is null or public.is_blocked() then
    raise exception 'Kein Zugriff.' using errcode = '42501';
  end if;
  select muted_until into v_muted from public.profiles where id = v_me;
  if v_muted is not null and v_muted > now() then
    raise exception 'Du bist stummgeschaltet – noch % Sekunden.', ceil(extract(epoch from (v_muted - now())))::integer
      using errcode = '42501';
  end if;
  if char_length(v_body) < 1 or char_length(v_body) > 500 then
    raise exception 'Die Nachricht braucht 1 bis 500 Zeichen.' using errcode = '22023';
  end if;
  if exists (select 1 from public.chat_messages where user_id = v_me and created_at > now() - interval '1 second') then
    raise exception 'Nicht so schnell – warte kurz.' using errcode = '22023';
  end if;
  if (select count(*) from public.chat_messages where user_id = v_me and created_at > now() - interval '1 minute')
       >= greatest(public.setting('chat_per_minute'), 1) then
    raise exception 'Zu viele Nachrichten – warte eine Minute.' using errcode = '22023';
  end if;

  -- Befehl: !pay @Anzeigename 100
  if v_body ~* '^!pay(\s|$)' then
    v_m := regexp_match(v_body, '^!pay\s+@?(.+?)\s+(\d{1,9})$', 'i');
    if v_m is null then
      raise exception 'So geht es: !pay @Anzeigename 100' using errcode = '22023';
    end if;
    v_amount := v_m[2]::integer;
    if v_amount < 1 then
      raise exception 'Der Betrag muss mindestens 1 sein.' using errcode = '22023';
    end if;
    if v_amount > public.setting('pay_max') then
      raise exception 'Pro Überweisung sind höchstens % Coins erlaubt.', public.setting('pay_max') using errcode = '22023';
    end if;
    select p.id, p.display_name into v_to, v_to_name
      from public.profiles p where lower(p.display_name) = lower(btrim(v_m[1])) and not p.blocked;
    if v_to is null then
      raise exception 'Spieler „%“ nicht gefunden.', btrim(v_m[1]) using errcode = 'P0002';
    end if;
    if v_to = v_me then
      raise exception 'Du kannst dir nicht selbst Coins schicken.' using errcode = '22023';
    end if;
    select coalesce(sum(-l.amount), 0) into v_sent
      from public.koin_ledger l
     where l.user_id = v_me and l.reason = 'pay_out'
       and (l.created_at at time zone 'Europe/Berlin')::date = (now() at time zone 'Europe/Berlin')::date;
    if v_sent + v_amount > public.setting('pay_daily_cap') then
      raise exception 'Tageslimit: Du kannst heute noch % Coins verschicken.', greatest(public.setting('pay_daily_cap') - v_sent, 0) using errcode = '22023';
    end if;
    if coalesce((select balance from public.koin_wallets where user_id = v_me), 0) < v_amount then
      raise exception 'Nicht genug Coins.' using errcode = '23514';
    end if;
    select display_name into v_me_name from public.profiles where id = v_me;
    perform public._grant_koins(v_me, -v_amount, 'pay_out', v_to::text);
    perform public._grant_koins(v_to, v_amount, 'pay_in', v_me::text);
    insert into public.user_messages (user_id, from_id, body)
    values (v_to, null, v_me_name || ' hat dir ' || v_amount || ' Coins geschickt. 💵');
    insert into public.chat_messages (user_id, body, kind)
    values (v_me, v_me_name || ' hat ' || v_to_name || ' ' || v_amount || ' Coins geschickt 💵', 'pay')
    returning chat_messages.id into v_id;
    return v_id;
  end if;

  -- Befehl: !whisper @Anzeigename Text  (nur Absender und Empfänger sehen die Nachricht)
  if v_body ~* '^!whisper(\s|$)' then
    v_rest := btrim(regexp_replace(v_body, '^!whisper\s*@?', '', 'i'));
    -- längster passender Anzeigename gewinnt (Namen dürfen Leerzeichen enthalten)
    select p.id, p.display_name into v_to, v_to_name
      from public.profiles p
     where not p.blocked
       and lower(left(v_rest, char_length(p.display_name) + 1)) = lower(p.display_name) || ' '
     order by char_length(p.display_name) desc
     limit 1;
    if v_to is null then
      raise exception 'So geht es: !whisper @Anzeigename Text' using errcode = '22023';
    end if;
    if v_to = v_me then
      raise exception 'Du kannst dir nicht selbst flüstern.' using errcode = '22023';
    end if;
    v_rest := btrim(substr(v_rest, char_length(v_to_name) + 2));
    if char_length(v_rest) < 1 then
      raise exception 'So geht es: !whisper @Anzeigename Text' using errcode = '22023';
    end if;
    insert into public.chat_messages (user_id, body, kind, recipient_id)
    values (v_me, v_rest, 'whisper', v_to) returning chat_messages.id into v_id;
    return v_id;
  end if;

  if exists (select 1 from public.chat_messages where user_id = v_me and body = v_body and created_at > now() - interval '30 seconds') then
    raise exception 'Diese Nachricht hast du gerade schon gesendet.' using errcode = '22023';
  end if;
  insert into public.chat_messages (user_id, body) values (v_me, v_body) returning chat_messages.id into v_id;
  return v_id;
end;
$$;

-- Löschen: Mods und höher alles; sonst nur eigene Nachrichten oder Flüstern an einen selbst. Endgültig.
drop function if exists public.delete_chat_message(bigint);
create function public.delete_chat_message(p_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
begin
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  if public.is_staff() then
    delete from public.chat_messages where id = p_id;
  else
    delete from public.chat_messages where id = p_id and (user_id = v_me or (kind = 'whisper' and recipient_id = v_me));
    if not found then
      raise exception 'Das darfst du nicht löschen.' using errcode = '42501';
    end if;
  end if;
end;
$$;

-- Stummschalten über eine Chat-Nachricht. Mods: genau 1 Minute. Alphamods/Admins: 1 bis timeout_max, 0 hebt auf.
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
  if public.is_alphamod() then
    v_minutes := least(greatest(coalesce(p_minutes, 1), 0), greatest(public.setting('timeout_max'), 1));
  else
    v_minutes := 1;
  end if;
  update public.profiles
     set muted_until = case when v_minutes = 0 then null else now() + make_interval(mins => v_minutes) end
   where id = v_target;
end;
$$;

-- Eigene Nachrichten vom Admin/System endgültig löschen.
create or replace function public.delete_my_messages(p_ids uuid[])
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.user_messages where user_id = (select auth.uid()) and id = any (p_ids);
$$;

-- ----------------------------------------------------------------------------
-- 8. Gambling
-- ----------------------------------------------------------------------------

-- Ergebnis wird auf dem Server gewürfelt. Gewinnchance, Jackpot, Faktoren und Höchsteinsatz sind einstellbar.
-- Symbole 0–5 = normale Gewinne (drei gleiche), 6 = Jackpot (drei Sieben).
create or replace function public.gambling_play(p_bet integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  v_roll integer := floor(random() * 1000)::integer;
  v_jack integer := least(greatest(public.setting('gambling_jackpot_permille'), 0), 1000);
  v_win integer := least(greatest(public.setting('gambling_win_permille'), 0), 1000);
  v_mult integer := 0;
  v_reels integer[];
  v_s integer;
  v_payout integer;
  v_balance integer;
begin
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  if p_bet is null or p_bet < 1 or p_bet > greatest(public.setting('gambling_max_bet'), 1) then
    raise exception 'Der Einsatz muss zwischen 1 und % Coins liegen.', greatest(public.setting('gambling_max_bet'), 1)
      using errcode = '22023';
  end if;
  if coalesce((select balance from public.koin_wallets where user_id = v_me), 0) < p_bet then
    raise exception 'Nicht genug Coins.' using errcode = '23514';
  end if;
  if v_roll < v_jack then
    v_mult := public.setting('gambling_mult_jackpot');
    v_reels := array[6, 6, 6];
  elsif v_roll < v_jack + v_win then
    v_mult := public.setting('gambling_mult_win');
    v_s := floor(random() * 6)::integer;
    v_reels := array[v_s, v_s, v_s];
  else
    loop
      v_reels := array[floor(random() * 7)::integer, floor(random() * 7)::integer, floor(random() * 7)::integer];
      exit when not (v_reels[1] = v_reels[2] and v_reels[2] = v_reels[3]);
    end loop;
  end if;
  v_balance := public._grant_koins(v_me, -p_bet, 'gambling_bet', null);
  v_payout := p_bet * v_mult;
  if v_payout > 0 then
    v_balance := public._grant_koins(v_me, v_payout, 'gambling_win', null);
  end if;
  return jsonb_build_object('reels', to_jsonb(v_reels), 'mult', v_mult, 'payout', v_payout,
                            'bet', p_bet, 'balance', v_balance);
end;
$$;

-- ----------------------------------------------------------------------------
-- 9. Spiele: Highscores aller Nutzer statt Bot
-- ----------------------------------------------------------------------------

alter table public.game_runs drop constraint if exists game_runs_game_check;
alter table public.game_runs add constraint game_runs_game_check
  check (game in ('snake', 'tetris', 'blast', 'crossy', 'flappy'));
alter table public.game_runs alter column bot_score drop not null;
alter table public.game_runs alter column bot_score set default 0;
create index if not exists game_runs_board_idx on public.game_runs (game, score desc) where finished_at is not null;

drop function if exists public.start_game(text);
create function public.start_game(p_game text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  v_fee integer := public.setting('game_fee');
  v_id uuid;
  v_balance integer;
  v_record integer;
begin
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  if p_game not in ('snake', 'tetris', 'blast', 'crossy', 'flappy') then
    raise exception 'Unbekanntes Spiel.' using errcode = '22023';
  end if;
  if coalesce((select balance from public.koin_wallets where user_id = v_me), 0) < v_fee then
    raise exception 'Nicht genug Coins – der Eintritt kostet % Coins.', v_fee using errcode = '23514';
  end if;
  insert into public.game_runs (user_id, game, bot_score, fee) values (v_me, p_game, 0, v_fee) returning id into v_id;
  v_balance := public._grant_koins(v_me, -v_fee, 'game_fee', v_id::text);
  select coalesce(max(score), 0) into v_record from public.game_runs where game = p_game and finished_at is not null;
  return jsonb_build_object('id', v_id, 'record', v_record, 'fee', v_fee, 'balance', v_balance);
end;
$$;

drop function if exists public.finish_game(uuid, integer);
create function public.finish_game(p_id uuid, p_score integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  r public.game_runs;
  v_elapsed numeric;
  v_rate numeric;
  v_score integer;
  v_prev integer;
  v_record boolean := false;
  v_reward integer := 0;
  v_balance integer;
begin
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  select * into r from public.game_runs where id = p_id and user_id = v_me for update;
  if not found then
    raise exception 'Spiel nicht gefunden.' using errcode = 'P0002';
  end if;
  if r.finished_at is not null then
    raise exception 'Dieses Spiel ist schon gewertet.' using errcode = '22023';
  end if;
  if p_score is null or p_score < 0 then
    raise exception 'Ungültiges Ergebnis.' using errcode = '22023';
  end if;
  v_elapsed := extract(epoch from (now() - r.started_at));
  v_rate := case r.game when 'snake' then 2 when 'tetris' then 50 when 'blast' then 60 when 'crossy' then 4 else 1.5 end;
  v_score := least(p_score, floor(v_elapsed * v_rate)::integer);
  select max(score) into v_prev from public.game_runs where game = r.game and finished_at is not null;
  if v_score > coalesce(v_prev, 0) and v_elapsed <= 7200 then
    v_record := true;
    v_reward := public.setting('game_record_reward');
  end if;
  update public.game_runs set finished_at = now(), score = v_score, won = v_record, reward = v_reward where id = r.id;
  if v_reward > 0 then
    v_balance := public._grant_koins(v_me, v_reward, 'game_win', r.id::text);
  else
    v_balance := coalesce((select balance from public.koin_wallets where user_id = v_me), 0);
  end if;
  return jsonb_build_object('score', v_score, 'record', v_record, 'prev_record', coalesce(v_prev, 0),
                            'reward', v_reward, 'balance', v_balance);
end;
$$;

-- Bestenliste eines Spiels: bester Wert je Nutzer, Top 10 + eigener Platz.
create or replace function public.get_game_board(p_game text)
returns table (rank bigint, display_name text, score integer, is_me boolean,
               avatar_id text, color_id text, effect_id text, role text, tag_id text, theme_id text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
begin
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  if p_game not in ('snake', 'tetris', 'blast', 'crossy', 'flappy') then
    raise exception 'Unbekanntes Spiel.' using errcode = '22023';
  end if;
  return query
  with best as (
    select g.user_id as uid, max(g.score) as sc
      from public.game_runs g
     where g.game = p_game and g.finished_at is not null and g.score > 0
     group by g.user_id
  ), ranked as (
    select (rank() over (order by b.sc desc))::bigint as rk, b.uid, b.sc from best b
  )
  select rk.rk, pr.display_name, rk.sc, (rk.uid = v_me),
         pr.avatar_id, pr.color_id, pr.effect_id, pr.role, pr.tag_id, pr.theme_id
    from ranked rk
    join public.profiles pr on pr.id = rk.uid and not pr.blocked
   where rk.rk <= 10 or rk.uid = v_me
   order by rk.rk, pr.display_name;
end;
$$;

-- ----------------------------------------------------------------------------
-- 10. Shop: Fahrrad und Frosch
-- ----------------------------------------------------------------------------

insert into public.shop_items (id, kind, name, price, sort, required_role) values
  ('avatar_bike',  'avatar', 'Radfahrer',          2400, 300, null),
  ('avatar_frog',  'avatar', 'Frosch',             1900, 310, null),
  ('effect_bike',  'effect', 'Fahrradtour',        3200, 160, null),
  ('effect_frog',  'effect', 'Hüpfender Frosch',   2600, 170, null)
on conflict (id) do nothing;

-- ----------------------------------------------------------------------------
-- 11. Rechte
-- ----------------------------------------------------------------------------

do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in (
       'is_alphamod', 'admin_set_role', 'staff_set_setting', 'admin_adjust_points', 'admin_list_point_adjustments',
       'submit_choice', 'get_quests', 'get_learning_pool', 'get_shop', 'equip_item', 'get_chat', 'chat_unread_count',
       'chat_mark_read', 'post_chat', 'delete_chat_message', 'staff_timeout_message', 'delete_my_messages',
       'gambling_play', 'start_game', 'finish_game', 'get_game_board', 'get_leaderboard')
  loop
    execute format('revoke all on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('_day_points', '_week_points', '_choice_points', '_role_rank')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
  end loop;
end;
$$;


-- ===== 0012_mod_rights_tags_gifts.sql =====
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


-- ===== 0013_per_staff_rights.sql =====
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


-- ===== 0014_shop_editor_board_presence.sql =====
-- 0014: Shop-Editor (eigene Artikel), Artikel entziehen, Schwarzes Brett, Wer-ist-da, Coin-Rangliste,
-- Gambling-Gewinnliste, neue Designs und Tags. Wiederholbar. Nach 0013 ausführen.

-- ----------------------------------------------------------------------------
-- 1. Eigene Shop-Artikel (vom Admin angelegt)
-- ----------------------------------------------------------------------------

alter table public.shop_items add column if not exists custom boolean not null default false;
alter table public.shop_items add column if not exists style jsonb;
alter table public.shop_items add column if not exists svg text;

drop function if exists public.get_shop();
create function public.get_shop()
returns table (id text, kind text, name text, price integer, sort integer, owned boolean, equipped boolean,
               required_role text, active boolean, custom boolean, style jsonb, svg text)
language sql
stable
security definer
set search_path = public
as $$
  select i.id, i.kind, i.name, i.price, i.sort,
         (i.price = 0 or o.item_id is not null),
         exists (select 1 from public.profiles p
                  where p.id = (select auth.uid())
                    and i.id in (p.avatar_id, p.color_id, p.effect_id, p.theme_id, p.tag_id)),
         i.required_role, i.active, i.custom, i.style, i.svg
    from public.shop_items i
    left join public.user_items o on o.item_id = i.id and o.user_id = (select auth.uid())
   where (select auth.uid()) is not null
     and (i.active or o.item_id is not null)
     and (i.required_role is null
          or public._role_rank(i.required_role) <= public._role_rank(
               (select p.role from public.profiles p where p.id = (select auth.uid()))))
   order by i.kind, i.sort, i.name;
$$;

-- Alle eigenen Artikel (zum Darstellen bei allen Nutzern: Profilbild, Farbe, Effekt, Tag, Design)
create or replace function public.get_custom_items()
returns table (id text, kind text, name text, style jsonb, svg text)
language sql
stable
security definer
set search_path = public
as $$
  select i.id, i.kind, i.name, i.style, i.svg
    from public.shop_items i
   where i.custom and (select auth.uid()) is not null;
$$;

-- Ist die SVG harmlos? Keine Skripte, Ereignisse, fremden Adressen oder eingebetteten Seiten.
create or replace function public._svg_is_safe(p_svg text)
returns boolean
language sql
immutable
as $$
  select p_svg is not null
     and char_length(p_svg) between 20 and 30000
     and p_svg ~* '^\s*(<\?xml[^>]*>\s*)?<svg[\s>]'
     and c.t !~* '<\s*(script|iframe|object|embed|foreignobject|image|use|a)[\s>/]'
     and c.t !~* '\mon[a-z]+\s*='
     and c.t !~* 'javascript:|data:|@import|https?:|//[a-z0-9.-]+\.[a-z]{2,}|<!entity|<!doctype'
     and c.t !~* 'href\s*='
  from (select regexp_replace(p_svg, 'xmlns(:[a-z]+)?\s*=\s*("[^"]*"|''[^'']*'')', '', 'gi') as t) c;
$$;

create or replace function public.admin_save_item(
  p_id text, p_kind text, p_name text, p_price integer, p_required_role text,
  p_style jsonb, p_svg text, p_active boolean default true)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id text := nullif(btrim(coalesce(p_id, '')), '');
begin
  perform public._require_admin();
  if p_kind not in ('avatar', 'color', 'effect', 'theme', 'tag') then
    raise exception 'Unbekannte Art.' using errcode = '22023';
  end if;
  if char_length(btrim(coalesce(p_name, ''))) not between 1 and 40 then
    raise exception 'Der Name braucht 1 bis 40 Zeichen.' using errcode = '22023';
  end if;
  if p_price is null or p_price < 0 or p_price > 10000000 then
    raise exception 'Ungültiger Preis.' using errcode = '22023';
  end if;
  if p_required_role is not null and p_required_role not in ('mod', 'admin') then
    raise exception 'Ungültige Rolle.' using errcode = '22023';
  end if;
  if p_style is not null and (jsonb_typeof(p_style) <> 'object' or char_length(p_style::text) > 4000) then
    raise exception 'Ungültige Stil-Angaben.' using errcode = '22023';
  end if;
  if p_kind = 'avatar' and p_svg is not null and not public._svg_is_safe(p_svg) then
    raise exception 'Die SVG ist nicht erlaubt (keine Skripte, Links oder fremden Bilder, höchstens 30 000 Zeichen).' using errcode = '22023';
  end if;
  if p_kind = 'avatar' and p_svg is null then
    raise exception 'Für ein Profilbild braucht es eine SVG.' using errcode = '22023';
  end if;
  if p_kind <> 'avatar' and p_style is null then
    raise exception 'Es fehlen die Stil-Angaben.' using errcode = '22023';
  end if;

  if v_id is null then
    v_id := 'c_' || substr(md5(random()::text || clock_timestamp()::text), 1, 10);
    insert into public.shop_items (id, kind, name, price, sort, required_role, active, custom, style, svg)
    values (v_id, p_kind, btrim(p_name), p_price, 500, p_required_role, coalesce(p_active, true), true, p_style,
            case when p_kind = 'avatar' then p_svg end);
  else
    update public.shop_items
       set name = btrim(p_name), price = p_price, required_role = p_required_role, active = coalesce(p_active, true),
           style = p_style, svg = case when p_kind = 'avatar' then p_svg end
     where id = v_id and custom and kind = p_kind;
    if not found then
      raise exception 'Eigener Artikel nicht gefunden.' using errcode = 'P0002';
    end if;
  end if;
  return v_id;
end;
$$;

create or replace function public.admin_delete_item(p_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._require_admin();
  if not exists (select 1 from public.shop_items where id = p_id and custom) then
    raise exception 'Nur eigene Artikel lassen sich löschen.' using errcode = '22023';
  end if;
  update public.profiles set avatar_id = null where avatar_id = p_id;
  update public.profiles set color_id = null where color_id = p_id;
  update public.profiles set effect_id = null where effect_id = p_id;
  update public.profiles set theme_id = null where theme_id = p_id;
  update public.profiles set tag_id = null where tag_id = p_id;
  delete from public.shop_items where id = p_id; -- user_items folgt per Kaskade
end;
$$;

-- ----------------------------------------------------------------------------
-- 2. Artikel eines Nutzers ansehen und entziehen
-- ----------------------------------------------------------------------------

create or replace function public.admin_list_user_items(p_user uuid)
returns table (item_id text, kind text, name text, equipped boolean)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public._require_admin();
  return query
  select i.id, i.kind, i.name,
         exists (select 1 from public.profiles p where p.id = p_user and i.id in (p.avatar_id, p.color_id, p.effect_id, p.theme_id, p.tag_id))
    from public.user_items o
    join public.shop_items i on i.id = o.item_id
   where o.user_id = p_user
   order by i.kind, i.name;
end;
$$;

create or replace function public.admin_revoke_item(p_user uuid, p_item_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._require_admin();
  delete from public.user_items where user_id = p_user and item_id = p_item_id;
  update public.profiles
     set avatar_id = case when avatar_id = p_item_id then null else avatar_id end,
         color_id  = case when color_id  = p_item_id then null else color_id end,
         effect_id = case when effect_id = p_item_id then null else effect_id end,
         theme_id  = case when theme_id  = p_item_id then null else theme_id end,
         tag_id    = case when tag_id    = p_item_id then null else tag_id end
   where id = p_user;
end;
$$;

-- ----------------------------------------------------------------------------
-- 3. Gambling: Gewinnliste
-- ----------------------------------------------------------------------------

create table if not exists public.gambling_feed (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  bet integer not null,
  payout integer not null,
  jackpot boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists gambling_feed_time_idx on public.gambling_feed (created_at desc);
alter table public.gambling_feed enable row level security;
revoke all on public.gambling_feed from anon, authenticated;

create or replace function public.gambling_play(p_bet integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  v_roll integer := floor(random() * 1000)::integer;
  v_jack integer := least(greatest(public.setting('gambling_jackpot_permille'), 0), 1000);
  v_win integer := least(greatest(public.setting('gambling_win_permille'), 0), 1000);
  v_mult integer := 0;
  v_is_jackpot boolean := false;
  v_reels integer[];
  v_s integer;
  v_payout integer;
  v_balance integer;
begin
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  if p_bet is null or p_bet < 1 or p_bet > greatest(public.setting('gambling_max_bet'), 1) then
    raise exception 'Der Einsatz muss zwischen 1 und % Coins liegen.', greatest(public.setting('gambling_max_bet'), 1)
      using errcode = '22023';
  end if;
  if coalesce((select balance from public.koin_wallets where user_id = v_me), 0) < p_bet then
    raise exception 'Nicht genug Coins.' using errcode = '23514';
  end if;
  if v_roll < v_jack then
    v_mult := public.setting('gambling_mult_jackpot');
    v_is_jackpot := true;
    v_reels := array[6, 6, 6];
  elsif v_roll < v_jack + v_win then
    v_mult := public.setting('gambling_mult_win');
    v_s := floor(random() * 6)::integer;
    v_reels := array[v_s, v_s, v_s];
  else
    loop
      v_reels := array[floor(random() * 7)::integer, floor(random() * 7)::integer, floor(random() * 7)::integer];
      exit when not (v_reels[1] = v_reels[2] and v_reels[2] = v_reels[3]);
    end loop;
  end if;
  v_balance := public._grant_koins(v_me, -p_bet, 'gambling_bet', null);
  v_payout := p_bet * v_mult;
  if v_payout > 0 then
    v_balance := public._grant_koins(v_me, v_payout, 'gambling_win', null);
    insert into public.gambling_feed (user_id, bet, payout, jackpot) values (v_me, p_bet, v_payout, v_is_jackpot);
    delete from public.gambling_feed where created_at < now() - interval '7 days';
  end if;
  return jsonb_build_object('reels', to_jsonb(v_reels), 'mult', v_mult, 'payout', v_payout,
                            'bet', p_bet, 'balance', v_balance);
end;
$$;

create or replace function public.get_gambling_feed()
returns table (id bigint, display_name text, bet integer, payout integer, jackpot boolean, created_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select f.id, p.display_name, f.bet, f.payout, f.jackpot, f.created_at
    from public.gambling_feed f
    join public.profiles p on p.id = f.user_id
   where (select auth.uid()) is not null
   order by f.id desc
   limit 20;
$$;

-- ----------------------------------------------------------------------------
-- 4. Schwarzes Brett (Features des nächsten Updates)
-- ----------------------------------------------------------------------------

create table if not exists public.board_posts (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(btrim(title)) between 1 and 120),
  body text not null default '' check (char_length(body) <= 2000),
  status text not null default 'planned' check (status in ('planned', 'doing', 'done')),
  sort integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.board_posts enable row level security;
revoke all on public.board_posts from anon, authenticated;

create or replace function public.get_board()
returns table (id uuid, title text, body text, status text, sort integer, updated_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select b.id, b.title, b.body, b.status, b.sort, b.updated_at
    from public.board_posts b
   where (select auth.uid()) is not null
   order by case b.status when 'doing' then 0 when 'planned' then 1 else 2 end, b.sort, b.created_at desc;
$$;

create or replace function public.admin_save_board_post(p_id uuid, p_title text, p_body text, p_status text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  perform public._require_admin();
  if char_length(btrim(coalesce(p_title, ''))) not between 1 and 120 then
    raise exception 'Der Titel braucht 1 bis 120 Zeichen.' using errcode = '22023';
  end if;
  if p_status not in ('planned', 'doing', 'done') then
    raise exception 'Ungültiger Status.' using errcode = '22023';
  end if;
  if p_id is null then
    insert into public.board_posts (title, body, status) values (btrim(p_title), left(coalesce(p_body, ''), 2000), p_status)
    returning id into v_id;
  else
    update public.board_posts
       set title = btrim(p_title), body = left(coalesce(p_body, ''), 2000), status = p_status, updated_at = now()
     where id = p_id returning id into v_id;
    if v_id is null then
      raise exception 'Eintrag nicht gefunden.' using errcode = 'P0002';
    end if;
  end if;
  return v_id;
end;
$$;

create or replace function public.admin_delete_board_post(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._require_admin();
  delete from public.board_posts where id = p_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- 5. Wer ist da? (online und zuletzt gesehen, für alle)
-- ----------------------------------------------------------------------------

alter table public.profiles add column if not exists hide_presence boolean not null default false;

create or replace function public.set_hide_presence(p_hidden boolean)
returns void
language sql
security definer
set search_path = public
as $$
  update public.profiles set hide_presence = coalesce(p_hidden, false) where id = (select auth.uid());
$$;

create or replace function public.get_presence()
returns table (user_id uuid, display_name text, avatar_id text, color_id text, effect_id text, role text, tag_id text,
               theme_id text, last_seen_at timestamptz, online boolean)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.display_name, p.avatar_id, p.color_id, p.effect_id,
         case when p.tags_hidden then 'user' else p.role end,
         case when p.tags_hidden then null else p.tag_id end,
         p.theme_id, p.last_seen_at, (p.last_seen_at > now() - interval '3 minutes')
    from public.profiles p
   where (select auth.uid()) is not null and not public.is_blocked()
     and not p.blocked and p.last_seen_at is not null
     and (not p.hide_presence or p.id = (select auth.uid()))
   order by (p.last_seen_at > now() - interval '3 minutes') desc, p.last_seen_at desc
   limit 200;
$$;

-- ----------------------------------------------------------------------------
-- 6. Coin-Rangliste
-- ----------------------------------------------------------------------------

create or replace function public.get_coin_leaderboard()
returns table (rank integer, user_id uuid, display_name text, avatar_id text, color_id text, effect_id text, role text,
               tag_id text, theme_id text, koins integer)
language sql
stable
security definer
set search_path = public
as $$
  select (row_number() over (order by w.balance desc, p.display_name))::integer,
         p.id, p.display_name, p.avatar_id, p.color_id, p.effect_id,
         case when p.tags_hidden then 'user' else p.role end,
         case when p.tags_hidden then null else p.tag_id end,
         p.theme_id, w.balance
    from public.koin_wallets w
    join public.profiles p on p.id = w.user_id
   where (select auth.uid()) is not null and not public.is_blocked() and not p.blocked and w.balance > 0
   order by w.balance desc, p.display_name
   limit 50;
$$;

create or replace function public.get_my_coin_rank()
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select (select count(*) + 1
            from public.koin_wallets w join public.profiles p on p.id = w.user_id
           where not p.blocked and w.balance > coalesce((select balance from public.koin_wallets where user_id = (select auth.uid())), 0))::integer;
$$;

-- ----------------------------------------------------------------------------
-- 7. Neue Designs und kurze Tags
-- ----------------------------------------------------------------------------

insert into public.shop_items (id, kind, name, price, sort, required_role) values
  ('theme_lava',    'theme', 'Lava',        700,   120, null),
  ('theme_ice',     'theme', 'Eis',         650,   130, null),
  ('theme_cyber',   'theme', 'Cyber',       800,   140, null),
  ('theme_royal',   'theme', 'Königlich',   900,   150, null),
  ('theme_mint',    'theme', 'Minze',       550,   160, null),
  ('theme_vapor',   'theme', 'Vaporwave',   850,   170, null),
  ('theme_shine',   'theme', 'Glanz',       100000, 200, null),
  ('theme_rainbow', 'theme', 'Regenbogen',  100000, 210, null),
  ('tag_gg',    'tag', 'GG',    200,   100, null),
  ('tag_hot',   'tag', 'HOT',   400,   110, null),
  ('tag_vip',   'tag', 'VIP',   300,   120, null),
  ('tag_og',    'tag', 'OG',    500,   130, null),
  ('tag_star',  'tag', '★',     600,   140, null),
  ('tag_pro',   'tag', 'PRO',   800,   150, null),
  ('tag_mvp',   'tag', 'MVP',   1200,  160, null),
  ('tag_elite', 'tag', 'ELITE', 2500,  170, null)
on conflict (id) do nothing;

-- ----------------------------------------------------------------------------
-- 8. Rechte
-- ----------------------------------------------------------------------------

do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig, p.proname
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in (
       'get_shop', 'get_custom_items', '_svg_is_safe', 'admin_save_item', 'admin_delete_item', 'admin_list_user_items',
       'admin_revoke_item', 'gambling_play', 'get_gambling_feed', 'get_board', 'admin_save_board_post',
       'admin_delete_board_post', 'set_hide_presence', 'get_presence', 'get_coin_leaderboard', 'get_my_coin_rank')
  loop
    if r.proname = '_svg_is_safe' then
      execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    else
      execute format('revoke all on function %s from public, anon', r.sig);
      execute format('grant execute on function %s to authenticated', r.sig);
    end if;
  end loop;
end;
$$;


-- ===== 0015_locks_gambling_stats_limits.sql =====
-- ============================================================================
-- 0015: Sperren mit Zeitplan, Gambling-Bilanz (auch Verluste), höhere Limits
-- Wiederholbar. Nach 0014 ausführen.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Funktionen / Menüpunkte sperren (Admin) – dauerhaft kurz oder nach Zeitplan
-- ----------------------------------------------------------------------------

create table if not exists public.feature_locks (
  key text primary key check (key in ('games', 'gambling', 'sprint', 'duels', 'chat', 'shop', 'quests')),
  off_until timestamptz,
  rules jsonb not null default '[]'::jsonb,
  note text not null default '' check (char_length(note) <= 200),
  updated_at timestamptz not null default now()
);
alter table public.feature_locks enable row level security;
revoke all on public.feature_locks from anon, authenticated;

-- Regeln: [{"days":[1..7], "from":"HH:MM", "to":"HH:MM"}], Berliner Zeit, 1 = Montag.
-- from = to bedeutet „ganzer Tag“, from > to geht über Mitternacht.
create or replace function public._valid_lock_rules(p_rules jsonb)
returns boolean
language plpgsql
immutable
set search_path = public
as $$
declare
  r jsonb;
  d jsonb;
begin
  if p_rules is null or jsonb_typeof(p_rules) <> 'array' or jsonb_array_length(p_rules) > 14 then
    return false;
  end if;
  for r in select * from jsonb_array_elements(p_rules) loop
    if jsonb_typeof(r) <> 'object' or jsonb_typeof(r->'days') <> 'array'
       or jsonb_array_length(r->'days') < 1 or jsonb_array_length(r->'days') > 7 then
      return false;
    end if;
    for d in select * from jsonb_array_elements(r->'days') loop
      if jsonb_typeof(d) <> 'number' or (d #>> '{}') !~ '^[1-7]$' then
        return false;
      end if;
    end loop;
    if coalesce(r->>'from', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
       or coalesce(r->>'to', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
      return false;
    end if;
  end loop;
  return true;
end;
$$;

create or replace function public._feature_locked_raw(p_key text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  r public.feature_locks;
  v_now timestamp := timezone('Europe/Berlin', now());
  v_dow integer := extract(isodow from v_now)::integer;
  v_prev integer;
  v_t time := v_now::time;
  rule jsonb;
  v_from time;
  v_to time;
begin
  select * into r from public.feature_locks where key = p_key;
  if not found then
    return false;
  end if;
  if r.off_until is not null and r.off_until > now() then
    return true;
  end if;
  v_prev := case when v_dow = 1 then 7 else v_dow - 1 end;
  for rule in select * from jsonb_array_elements(r.rules) loop
    v_from := (rule->>'from')::time;
    v_to := (rule->>'to')::time;
    if v_from = v_to then
      if (rule->'days') @> to_jsonb(v_dow) then return true; end if;
    elsif v_from < v_to then
      if (rule->'days') @> to_jsonb(v_dow) and v_t >= v_from and v_t < v_to then return true; end if;
    else
      if ((rule->'days') @> to_jsonb(v_dow) and v_t >= v_from)
         or ((rule->'days') @> to_jsonb(v_prev) and v_t < v_to) then
        return true;
      end if;
    end if;
  end loop;
  return false;
end;
$$;

-- Admins sind nie ausgesperrt (so kann man alles testen).
create or replace function public._feature_locked(p_key text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select not public.is_admin() and public._feature_locked_raw(p_key);
$$;

create or replace function public._feature_guard(p_key text)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if public._feature_locked(p_key) then
    raise exception 'Das ist gerade vom Admin deaktiviert.' using errcode = '55000';
  end if;
end;
$$;

-- Für alle: Liste der gerade gesperrten Schlüssel (leer für Admins).
create or replace function public.get_locked_features()
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(k order by k), '{}'::text[])
    from unnest(array['games', 'gambling', 'sprint', 'duels', 'chat', 'shop', 'quests']) k
   where (select auth.uid()) is not null and public._feature_locked(k);
$$;

create or replace function public.admin_get_feature_locks()
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
    from unnest(array['games', 'gambling', 'sprint', 'duels', 'chat', 'shop', 'quests']) k
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
  if p_key not in ('games', 'gambling', 'sprint', 'duels', 'chat', 'shop', 'quests') then
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

-- ----------------------------------------------------------------------------
-- 2. Gambling: alle Spiele loggen (auch Verluste) + Bilanz je Spieler
-- ----------------------------------------------------------------------------

create table if not exists public.gambling_stats (
  user_id uuid primary key references auth.users (id) on delete cascade,
  plays integer not null default 0,
  wagered bigint not null default 0,
  won bigint not null default 0,
  best_win integer not null default 0
);
alter table public.gambling_stats enable row level security;
revoke all on public.gambling_stats from anon, authenticated;

-- Bisherige Spiele aus dem Ledger übernehmen (nur beim ersten Mal, danach greift on conflict).
insert into public.gambling_stats (user_id, plays, wagered, won, best_win)
select l.user_id,
       count(*) filter (where l.reason = 'gambling_bet')::integer,
       coalesce(-sum(l.amount) filter (where l.reason = 'gambling_bet'), 0),
       coalesce(sum(l.amount) filter (where l.reason = 'gambling_win'), 0),
       coalesce(max(l.amount) filter (where l.reason = 'gambling_win'), 0)::integer
  from public.koin_ledger l
 where l.reason in ('gambling_bet', 'gambling_win')
 group by l.user_id
on conflict (user_id) do nothing;

create or replace function public.gambling_play(p_bet integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  v_roll integer := floor(random() * 1000)::integer;
  v_jack integer := least(greatest(public.setting('gambling_jackpot_permille'), 0), 1000);
  v_win integer := least(greatest(public.setting('gambling_win_permille'), 0), 1000);
  v_mult integer := 0;
  v_is_jackpot boolean := false;
  v_reels integer[];
  v_s integer;
  v_payout integer;
  v_balance integer;
begin
  perform public._feature_guard('gambling');
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  if p_bet is null or p_bet < 1 or p_bet > greatest(public.setting('gambling_max_bet'), 1) then
    raise exception 'Der Einsatz muss zwischen 1 und % Coins liegen.', greatest(public.setting('gambling_max_bet'), 1)
      using errcode = '22023';
  end if;
  if coalesce((select balance from public.koin_wallets where user_id = v_me), 0) < p_bet then
    raise exception 'Nicht genug Coins.' using errcode = '23514';
  end if;
  if v_roll < v_jack then
    v_mult := public.setting('gambling_mult_jackpot');
    v_is_jackpot := true;
    v_reels := array[6, 6, 6];
  elsif v_roll < v_jack + v_win then
    v_mult := public.setting('gambling_mult_win');
    v_s := floor(random() * 6)::integer;
    v_reels := array[v_s, v_s, v_s];
  else
    loop
      v_reels := array[floor(random() * 7)::integer, floor(random() * 7)::integer, floor(random() * 7)::integer];
      exit when not (v_reels[1] = v_reels[2] and v_reels[2] = v_reels[3]);
    end loop;
  end if;
  v_balance := public._grant_koins(v_me, -p_bet, 'gambling_bet', null);
  v_payout := p_bet * v_mult;
  if v_payout > 0 then
    v_balance := public._grant_koins(v_me, v_payout, 'gambling_win', null);
  end if;
  insert into public.gambling_feed (user_id, bet, payout, jackpot) values (v_me, p_bet, v_payout, v_is_jackpot);
  delete from public.gambling_feed where created_at < now() - interval '3 days';
  insert into public.gambling_stats (user_id, plays, wagered, won, best_win)
  values (v_me, 1, p_bet, v_payout, v_payout)
  on conflict (user_id) do update
    set plays = public.gambling_stats.plays + 1,
        wagered = public.gambling_stats.wagered + p_bet,
        won = public.gambling_stats.won + v_payout,
        best_win = greatest(public.gambling_stats.best_win, v_payout);
  return jsonb_build_object('reels', to_jsonb(v_reels), 'mult', v_mult, 'payout', v_payout,
                            'bet', p_bet, 'balance', v_balance);
end;
$$;

-- Bilanz-Rangliste: Gewinn minus Einsatz (negativ = Verlust).
create or replace function public.get_gambling_board()
returns table (rank integer, user_id uuid, display_name text, avatar_id text, color_id text, effect_id text, role text,
               tag_id text, theme_id text, plays integer, wagered bigint, won bigint, net bigint, best_win integer, is_me boolean)
language sql
stable
security definer
set search_path = public
as $$
  select (row_number() over (order by (s.won - s.wagered) desc, p.display_name))::integer,
         p.id, p.display_name, p.avatar_id, p.color_id, p.effect_id,
         case when p.tags_hidden then 'user' else p.role end,
         case when p.tags_hidden then null else p.tag_id end,
         p.theme_id, s.plays, s.wagered, s.won, s.won - s.wagered, s.best_win, (p.id = (select auth.uid()))
    from public.gambling_stats s
    join public.profiles p on p.id = s.user_id
   where (select auth.uid()) is not null and not public.is_blocked() and not p.blocked and s.plays > 0
   order by (s.won - s.wagered) desc, p.display_name
   limit 200;
$$;

-- ----------------------------------------------------------------------------
-- 3. Höhere Limits: Preise bis 1 Mrd., Coins schenken/abziehen in einem Schlag
-- ----------------------------------------------------------------------------

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
  if p_price is null or p_price < 0 or p_price > 1000000000 then
    raise exception 'Ungültiger Preis.' using errcode = '22023';
  end if;
  update public.shop_items set price = p_price, active = coalesce(p_active, true) where id = p_item_id;
  if not found then
    raise exception 'Artikel nicht gefunden.' using errcode = 'P0002';
  end if;
end;
$$;

create or replace function public.admin_grant_koins(p_user uuid, p_amount integer, p_note text default '')
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bal integer;
begin
  perform public._require_admin();
  if p_amount is null or p_amount = 0 or abs(p_amount) > 1000000000 then
    raise exception 'Ungültiger Betrag (höchstens 1.000.000.000).' using errcode = '22023';
  end if;
  if not exists (select 1 from public.profiles where id = p_user) then
    raise exception 'Nutzer nicht gefunden.' using errcode = 'P0002';
  end if;
  v_bal := coalesce((select balance from public.koin_wallets where user_id = p_user), 0);
  if p_amount > 0 and v_bal::bigint + p_amount > 2000000000 then
    raise exception 'Das Guthaben darf 2.000.000.000 Coins nicht übersteigen.' using errcode = '22023';
  end if;
  return public._grant_koins(p_user, p_amount, 'admin', nullif(left(btrim(coalesce(p_note, '')), 100), ''));
end;
$$;

-- Preislimit in admin_save_item anheben (Funktion wird umgeschrieben).
do $$
declare
  v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'admin_save_item';
  if v_def is not null and v_def ~ '\m10000000\M' then
    execute regexp_replace(v_def, '\m10000000\M', '1000000000', 'g');
  end if;
end;
$$;

-- ----------------------------------------------------------------------------
-- 4. Sperren in bestehende Funktionen einhängen (nur wenn noch nicht geschehen)
-- ----------------------------------------------------------------------------

do $$
declare
  r record;
  v_def text;
begin
  for r in select * from (values
      ('start_game', 'games'), ('create_duel', 'duels'), ('submit_sprint', 'sprint'),
      ('post_chat', 'chat'), ('buy_item', 'shop'), ('claim_quest', 'quests')) as t(fn, k)
  loop
    select pg_get_functiondef(p.oid) into v_def
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = r.fn
     limit 1;
    if v_def is not null and position('_feature_guard' in v_def) = 0 then
      v_def := regexp_replace(v_def, E'\nbegin\n', E'\nbegin\n  perform public._feature_guard(''' || r.k || E''');\n');
      execute v_def;
    end if;
  end loop;
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
     where n.nspname = 'public'
       and p.proname in ('_valid_lock_rules', '_feature_locked_raw', '_feature_locked', '_feature_guard', 'get_locked_features',
                         'admin_get_feature_locks', 'admin_set_feature_lock', 'gambling_play', 'get_gambling_board',
                         'admin_set_item', 'admin_grant_koins', 'admin_save_item', 'start_game', 'create_duel',
                         'submit_sprint', 'post_chat', 'buy_item', 'claim_quest')
  loop
    if r.proname in ('_valid_lock_rules', '_feature_locked_raw', '_feature_locked', '_feature_guard') then
      execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    else
      execute format('revoke all on function %s from public, anon', r.sig);
      execute format('grant execute on function %s to authenticated', r.sig);
    end if;
  end loop;
end;
$$;


-- ===== 0016_accounts_copy_items.sql =====
-- ============================================================================
-- 0016: Konten ohne Bestätigungs-Mail anlegen, Kennwort setzen, Abschreiben-Belohnung,
--       neue Artikel (Reicher Zocker, Farbwechsel-Design). Wiederholbar. Nach 0015 ausführen.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Konten vom Admin anlegen (ohne Bestätigungs-Mail)
-- ----------------------------------------------------------------------------

create or replace function public._create_user(p_email text, p_password text, p_name text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_id uuid := gen_random_uuid();
  v_final text;
begin
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or char_length(v_email) > 200 then
    raise exception 'Ungültige E-Mail-Adresse.' using errcode = '22023';
  end if;
  if p_password is null or char_length(p_password) < 6 or char_length(p_password) > 72 then
    raise exception 'Das Kennwort braucht 6 bis 72 Zeichen.' using errcode = '22023';
  end if;
  if exists (select 1 from auth.users where lower(email) = v_email) then
    raise exception 'Diese E-Mail gibt es schon.' using errcode = '23505';
  end if;
  if v_name is null then
    v_name := split_part(v_email, '@', 1);
  end if;
  v_name := left(v_name, 24);

  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                          raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                          confirmation_token, email_change, email_change_token_new, recovery_token)
  values ('00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated', v_email,
          extensions.crypt(p_password, extensions.gen_salt('bf')), now(),
          '{"provider":"email","providers":["email"]}'::jsonb, jsonb_build_object('display_name', v_name), now(), now(),
          '', '', '', '');
  insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (gen_random_uuid(), v_id, v_id::text,
          jsonb_build_object('sub', v_id::text, 'email', v_email, 'email_verified', true, 'phone_verified', false),
          'email', now(), now(), now());

  select display_name into v_final from public.profiles where id = v_id;
  return jsonb_build_object('user_id', v_id, 'email', v_email, 'display_name', v_final);
end;
$$;

create or replace function public.admin_create_user(p_email text, p_password text, p_name text default '')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._require_admin();
  return public._create_user(p_email, p_password, p_name);
end;
$$;

-- Mehrere Konten: p_rows = [{"email":"…","password":"…","name":"…"}, …] (höchstens 60).
create or replace function public.admin_create_users(p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r jsonb;
  v_out jsonb := '[]'::jsonb;
  v_res jsonb;
begin
  perform public._require_admin();
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) not between 1 and 60 then
    raise exception 'Bitte 1 bis 60 Zeilen angeben.' using errcode = '22023';
  end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    begin
      v_res := public._create_user(r->>'email', r->>'password', r->>'name');
      v_out := v_out || jsonb_build_array(jsonb_build_object('email', v_res->>'email', 'ok', true, 'display_name', v_res->>'display_name'));
    exception when others then
      v_out := v_out || jsonb_build_array(jsonb_build_object('email', coalesce(r->>'email', ''), 'ok', false, 'error', sqlerrm));
    end;
  end loop;
  return v_out;
end;
$$;

create or replace function public.admin_set_password(p_user uuid, p_password text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._require_admin();
  if p_password is null or char_length(p_password) < 6 or char_length(p_password) > 72 then
    raise exception 'Das Kennwort braucht 6 bis 72 Zeichen.' using errcode = '22023';
  end if;
  update auth.users set encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf')), updated_at = now()
   where id = p_user;
  if not found then
    raise exception 'Nutzer nicht gefunden.' using errcode = 'P0002';
  end if;
end;
$$;

-- ----------------------------------------------------------------------------
-- 2. Abschreiben: kleine Belohnung (je Buch/Unit und Tag einmal, am Tag begrenzt)
-- ----------------------------------------------------------------------------

insert into public.app_settings (key, value) values
  ('copy_reward', 5),        -- Coins für eine abgeschriebene Lektion
  ('copy_daily_max', 5)      -- so viele Belohnungen pro Tag
on conflict (key) do nothing;

create table if not exists public.copy_rewards (
  user_id uuid not null references auth.users (id) on delete cascade,
  book_id uuid not null,
  unit integer not null,
  day date not null,
  primary key (user_id, book_id, unit, day)
);
alter table public.copy_rewards enable row level security;
revoke all on public.copy_rewards from anon, authenticated;

create or replace function public.claim_copy_reward(p_book_id uuid, p_unit integer, p_count integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  v_day date := (timezone('Europe/Berlin', now()))::date;
  v_reward integer := greatest(public.setting('copy_reward'), 0);
  v_balance integer;
begin
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  if p_count is null or p_count < 5 or not public.can_read_book(p_book_id) then
    return jsonb_build_object('reward', 0, 'reason', 'zu_kurz');
  end if;
  if (select count(*) from public.copy_rewards where user_id = v_me and day = v_day) >= public.setting('copy_daily_max') then
    return jsonb_build_object('reward', 0, 'reason', 'tageslimit');
  end if;
  insert into public.copy_rewards (user_id, book_id, unit, day) values (v_me, p_book_id, coalesce(p_unit, 0), v_day)
  on conflict do nothing;
  if not found then
    return jsonb_build_object('reward', 0, 'reason', 'schon_heute');
  end if;
  if v_reward > 0 then
    v_balance := public._grant_koins(v_me, v_reward, 'copy', null);
  end if;
  return jsonb_build_object('reward', v_reward, 'reason', 'ok', 'balance', v_balance);
end;
$$;

-- ----------------------------------------------------------------------------
-- 3. Neue Artikel
-- ----------------------------------------------------------------------------

insert into public.shop_items (id, kind, name, price, sort, required_role) values
  ('effect_zocker', 'effect', 'Reicher Zocker', 25000, 400, null),
  ('theme_chroma',  'theme',  'Farbwechsel',    100000, 220, null)
on conflict (id) do nothing;

-- ----------------------------------------------------------------------------
-- 4. Rechte
-- ----------------------------------------------------------------------------

do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig, p.proname
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('_create_user', 'admin_create_user', 'admin_create_users', 'admin_set_password', 'claim_copy_reward')
  loop
    if r.proname = '_create_user' then
      execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    else
      execute format('revoke all on function %s from public, anon', r.sig);
      execute format('grant execute on function %s to authenticated', r.sig);
    end if;
  end loop;
end;
$$;


-- ===== 0017_big_coins_wave.sql =====
-- ============================================================================
-- 0017: Riesige Guthaben (bigint, bis 9 Billiarden), Admin-!pay mit k/m/mrd/b, Spiel „Wave“.
-- Wiederholbar. Nach 0016 ausführen.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Guthaben und Verlauf als bigint
-- ----------------------------------------------------------------------------

alter table public.koin_wallets alter column balance type bigint;
alter table public.koin_ledger alter column amount type bigint;

drop function if exists public._grant_koins(uuid, integer, text, text);
create or replace function public._grant_koins(p_user uuid, p_amount bigint, p_reason text, p_ref text default null)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance bigint;
begin
  if p_amount = 0 then
    return coalesce((select balance from public.koin_wallets where user_id = p_user), 0);
  end if;
  insert into public.koin_wallets (user_id) values (p_user) on conflict do nothing;
  update public.koin_wallets
     set balance = balance + p_amount
   where user_id = p_user and balance + p_amount >= 0 and balance + p_amount <= 9000000000000000
   returning balance into v_balance;
  if v_balance is null then
    if p_amount > 0 then
      raise exception 'Das Guthaben darf 9.000.000.000.000.000 Coins nicht übersteigen.' using errcode = '22023';
    end if;
    raise exception 'Nicht genug Coins.' using errcode = '23514';
  end if;
  insert into public.koin_ledger (user_id, amount, reason, ref) values (p_user, p_amount, p_reason, p_ref);
  return v_balance;
end;
$$;

-- Anzeige mit Punkten: 1000000 -> 1.000.000
create or replace function public._fmt_coins(p_n bigint)
returns text
language sql
immutable
set search_path = public
as $$
  select replace(to_char(p_n, 'FM999,999,999,999,999,999'), ',', '.');
$$;

-- Zahl lesen: "1000", bei Admins auch "1k", "2,5m", "3mrd", "1b" (b/bio = Billion = 10^12).
create or replace function public._parse_coins(p_text text, p_admin boolean)
returns bigint
language plpgsql
immutable
set search_path = public
as $$
declare
  t text := lower(regexp_replace(coalesce(p_text, ''), '[\s_]', '', 'g'));
  m text[];
  base numeric;
  mult numeric;
begin
  if t ~ '^[0-9]{1,16}$' then
    return t::bigint;
  end if;
  if not p_admin then
    return null;
  end if;
  m := regexp_match(t, '^([0-9]{1,6}(?:[.,][0-9]{1,6})?)(k|m|mio|mrd|b|bio)$');
  if m is null then
    return null;
  end if;
  base := replace(m[1], ',', '.')::numeric;
  mult := case m[2] when 'k' then 1e3 when 'm' then 1e6 when 'mio' then 1e6 when 'mrd' then 1e9 else 1e12 end;
  return round(base * mult)::bigint;
end;
$$;

-- ----------------------------------------------------------------------------
-- 2. Coins schenken/abziehen: bis 1 Billiarde auf einmal
-- ----------------------------------------------------------------------------

drop function if exists public.admin_grant_koins(uuid, integer, text);
create or replace function public.admin_grant_koins(p_user uuid, p_amount bigint, p_note text default '')
returns bigint
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._require_admin();
  if p_amount is null or p_amount = 0 or abs(p_amount) > 1000000000000000 then
    raise exception 'Ungültiger Betrag (höchstens 1.000.000.000.000.000).' using errcode = '22023';
  end if;
  if not exists (select 1 from public.profiles where id = p_user) then
    raise exception 'Nutzer nicht gefunden.' using errcode = 'P0002';
  end if;
  return public._grant_koins(p_user, p_amount, 'admin', nullif(left(btrim(coalesce(p_note, '')), 100), ''));
end;
$$;

-- ----------------------------------------------------------------------------
-- 3. Funktionen mit Guthaben-Rückgabe auf bigint umstellen
-- ----------------------------------------------------------------------------

do $$
declare
  r record;
  v_def text;
  v_new text;
  v_args text;
begin
  for r in select * from (values
      ('get_wallet',           array[array['RETURNS integer', 'RETURNS bigint']]),
      ('buy_item',             array[array['RETURNS integer', 'RETURNS bigint'], array['v_balance integer', 'v_balance bigint']]),
      ('claim_quest',          array[array['RETURNS integer', 'RETURNS bigint']]),
      ('redeem_code',          array[array['v_balance integer', 'v_balance bigint']]),
      ('gambling_play',        array[array['v_balance integer', 'v_balance bigint']]),
      ('start_game',           array[array['v_balance integer', 'v_balance bigint'], array['''crossy'', ''flappy''', '''crossy'', ''flappy'', ''wave''']]),
      ('finish_game',          array[array['v_balance integer', 'v_balance bigint'], array['when ''crossy'' then 4 else', 'when ''crossy'' then 4 when ''wave'' then 2 else']]),
      ('get_game_board',       array[array['''crossy'', ''flappy''', '''crossy'', ''flappy'', ''wave''']]),
      ('get_coin_leaderboard', array[array['koins integer', 'koins bigint']]),
      ('admin_list_users',     array[array['koins integer', 'koins bigint']])
    ) as t(fn, reps)
  loop
    select pg_get_functiondef(p.oid), pg_get_function_identity_arguments(p.oid) into v_def, v_args
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = r.fn
     limit 1;
    continue when v_def is null;
    v_new := v_def;
    for i in 1 .. array_length(r.reps, 1) loop
      v_new := replace(v_new, r.reps[i][1], r.reps[i][2]);
    end loop;
    continue when v_new = v_def;
    execute format('drop function public.%I(%s)', r.fn, v_args);
    execute v_new;
  end loop;
end;
$$;

-- ----------------------------------------------------------------------------
-- 4. Spiel „Wave“ erlauben
-- ----------------------------------------------------------------------------

alter table public.game_runs drop constraint if exists game_runs_game_check;
alter table public.game_runs add constraint game_runs_game_check
  check (game in ('snake', 'tetris', 'blast', 'crossy', 'flappy', 'wave'));

-- ----------------------------------------------------------------------------
-- 5. Chat-Befehl !pay: Admins dürfen 1k / 1m / 1mrd / 1b schreiben und sind nicht begrenzt
--    (die Coins eines Admins werden dabei neu erzeugt, nicht von seinem Konto abgezogen)
-- ----------------------------------------------------------------------------

create or replace function public.post_chat(p_body text)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  v_body text := btrim(coalesce(p_body, ''));
  v_id bigint;
  v_m text[];
  v_to uuid;
  v_to_name text;
  v_me_name text;
  v_amount bigint;
  v_sent bigint;
  v_rest text;
  v_muted timestamptz;
  v_admin boolean := public.is_admin();
begin
  perform public._feature_guard('chat');
  if v_me is null or public.is_blocked() then
    raise exception 'Kein Zugriff.' using errcode = '42501';
  end if;
  select muted_until into v_muted from public.profiles where id = v_me;
  if v_muted is not null and v_muted > now() then
    raise exception 'Du bist stummgeschaltet – noch % Sekunden.', ceil(extract(epoch from (v_muted - now())))::integer
      using errcode = '42501';
  end if;
  if char_length(v_body) < 1 or char_length(v_body) > 500 then
    raise exception 'Die Nachricht braucht 1 bis 500 Zeichen.' using errcode = '22023';
  end if;
  if exists (select 1 from public.chat_messages where user_id = v_me and created_at > now() - interval '1 second') then
    raise exception 'Nicht so schnell – warte kurz.' using errcode = '22023';
  end if;
  if (select count(*) from public.chat_messages where user_id = v_me and created_at > now() - interval '1 minute')
       >= greatest(public.setting('chat_per_minute'), 1) then
    raise exception 'Zu viele Nachrichten – warte eine Minute.' using errcode = '22023';
  end if;

  -- Befehl: !pay @Anzeigename 100   (Admins auch: 1k, 2,5m, 3mrd, 1b)
  if v_body ~* '^!pay(\s|$)' then
    v_m := regexp_match(v_body, '^!pay\s+@?(.+?)\s+(\S+)$', 'i');
    if v_m is null then
      raise exception 'So geht es: !pay @Anzeigename 100' using errcode = '22023';
    end if;
    v_amount := public._parse_coins(v_m[2], v_admin);
    if v_amount is null then
      raise exception 'So geht es: !pay @Anzeigename 100' using errcode = '22023';
    end if;
    if v_amount < 1 then
      raise exception 'Der Betrag muss mindestens 1 sein.' using errcode = '22023';
    end if;
    if v_admin then
      if v_amount > 1000000000000000 then
        raise exception 'Höchstens 1.000.000.000.000.000 auf einmal.' using errcode = '22023';
      end if;
    elsif v_amount > public.setting('pay_max') then
      raise exception 'Pro Überweisung sind höchstens % Coins erlaubt.', public.setting('pay_max') using errcode = '22023';
    end if;
    select p.id, p.display_name into v_to, v_to_name
      from public.profiles p where lower(p.display_name) = lower(btrim(v_m[1])) and not p.blocked;
    if v_to is null then
      raise exception 'Spieler „%“ nicht gefunden.', btrim(v_m[1]) using errcode = 'P0002';
    end if;
    if v_to = v_me then
      raise exception 'Du kannst dir nicht selbst Coins schicken.' using errcode = '22023';
    end if;
    select display_name into v_me_name from public.profiles where id = v_me;
    if v_admin then
      perform public._grant_koins(v_to, v_amount, 'pay_in', v_me::text);
    else
      select coalesce(sum(-l.amount), 0) into v_sent
        from public.koin_ledger l
       where l.user_id = v_me and l.reason = 'pay_out'
         and (l.created_at at time zone 'Europe/Berlin')::date = (now() at time zone 'Europe/Berlin')::date;
      if v_sent + v_amount > public.setting('pay_daily_cap') then
        raise exception 'Tageslimit: Du kannst heute noch % Coins verschicken.', greatest(public.setting('pay_daily_cap') - v_sent, 0) using errcode = '22023';
      end if;
      if coalesce((select balance from public.koin_wallets where user_id = v_me), 0) < v_amount then
        raise exception 'Nicht genug Coins.' using errcode = '23514';
      end if;
      perform public._grant_koins(v_me, -v_amount, 'pay_out', v_to::text);
      perform public._grant_koins(v_to, v_amount, 'pay_in', v_me::text);
    end if;
    insert into public.user_messages (user_id, from_id, body)
    values (v_to, null, v_me_name || ' hat dir ' || public._fmt_coins(v_amount) || ' Coins geschickt. 💵');
    insert into public.chat_messages (user_id, body, kind)
    values (v_me, v_me_name || ' hat ' || v_to_name || ' ' || public._fmt_coins(v_amount) || ' Coins geschickt 💵', 'pay')
    returning chat_messages.id into v_id;
    return v_id;
  end if;

  -- Befehl: !whisper @Anzeigename Text  (nur Absender und Empfänger sehen die Nachricht)
  if v_body ~* '^!whisper(\s|$)' then
    v_rest := btrim(regexp_replace(v_body, '^!whisper\s*@?', '', 'i'));
    -- längster passender Anzeigename gewinnt (Namen dürfen Leerzeichen enthalten)
    select p.id, p.display_name into v_to, v_to_name
      from public.profiles p
     where not p.blocked
       and lower(left(v_rest, char_length(p.display_name) + 1)) = lower(p.display_name) || ' '
     order by char_length(p.display_name) desc
     limit 1;
    if v_to is null then
      raise exception 'So geht es: !whisper @Anzeigename Text' using errcode = '22023';
    end if;
    if v_to = v_me then
      raise exception 'Du kannst dir nicht selbst flüstern.' using errcode = '22023';
    end if;
    v_rest := btrim(substr(v_rest, char_length(v_to_name) + 2));
    if char_length(v_rest) < 1 then
      raise exception 'So geht es: !whisper @Anzeigename Text' using errcode = '22023';
    end if;
    insert into public.chat_messages (user_id, body, kind, recipient_id)
    values (v_me, v_rest, 'whisper', v_to) returning chat_messages.id into v_id;
    return v_id;
  end if;

  if exists (select 1 from public.chat_messages where user_id = v_me and body = v_body and created_at > now() - interval '30 seconds') then
    raise exception 'Diese Nachricht hast du gerade schon gesendet.' using errcode = '22023';
  end if;
  insert into public.chat_messages (user_id, body) values (v_me, v_body) returning chat_messages.id into v_id;
  return v_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- 6. Rechte
-- ----------------------------------------------------------------------------

do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig, p.proname
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('_grant_koins', '_fmt_coins', '_parse_coins', 'admin_grant_koins', 'get_wallet', 'buy_item', 'claim_quest',
                         'redeem_code', 'gambling_play', 'start_game', 'finish_game', 'get_game_board', 'get_coin_leaderboard',
                         'admin_list_users', 'post_chat')
  loop
    if r.proname in ('_grant_koins', '_fmt_coins', '_parse_coins') then
      execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    else
      execute format('revoke all on function %s from public, anon', r.sig);
      execute format('grant execute on function %s to authenticated', r.sig);
    end if;
  end loop;
end;
$$;


-- ===== 0018_print_shop.sql =====
-- ============================================================================
-- 0018: 3D-Druck-Shop – Katalog, Farben, Preisrechner, Bestellungen, eigene Anfragen,
-- Fortschritt, Rabatt per Coins, Sperren für Spam, Dateiablage.
-- Wiederholbar. Nach 0017 ausführen. Alle Tabellen nur per Funktion erreichbar (kein RLS-Zugriff).
-- Geld wird in Cent gespeichert; bezahlt wird bei der Übergabe (kein Bezahlsystem).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Einstellungen (alle Werte stellt der Admin selbst ein)
-- ----------------------------------------------------------------------------

create table if not exists public.print_settings (
  key text primary key,
  value numeric not null,
  label text not null,
  unit text not null default '',
  hint text not null default '',
  min_value numeric not null default 0,
  max_value numeric not null default 100000,
  sort integer not null default 100
);
alter table public.print_settings enable row level security;
revoke all on public.print_settings from anon, authenticated;

-- Beschriftungen und Grenzen werden bei jedem Lauf aktualisiert, die Werte des Admins bleiben erhalten.
insert into public.print_settings (key, value, label, unit, hint, min_value, max_value, sort) values
  ('orders_open',        1,     'Bestellungen offen',                 '1 = ja, 0 = nein', 'Bei 0 kann niemand etwas Neues bestellen (z. B. Urlaub, Drucker kaputt).', 0, 1, 10),
  ('filament_eur_per_kg', 22,   'Filamentpreis',                      '€ pro kg',  'Was dich 1 kg Filament kostet.', 0, 500, 20),
  ('filament_density',   1.24,  'Dichte des Filaments',               'g/cm³',     'PLA ≈ 1,24, PETG ≈ 1,27, ABS ≈ 1,04.', 0.5, 3, 30),
  ('material_share',     35,    'Materialanteil (Wände + Füllung)',   '%',         'Welcher Teil des Modellvolumens wirklich Filament ist. Typisch 20–40.', 5, 100, 40),
  ('extrude_cm3_per_h',  20,    'Druckgeschwindigkeit',               'cm³ Material/h', 'Wie viel Filament dein Drucker pro Stunde verarbeitet. Daraus entsteht die geschätzte Druckzeit.', 1, 500, 50),
  ('setup_minutes',      5,     'Rüstzeit pro Auftrag',               'Minuten',   'Aufheizen, Ablösen, Nacharbeit.', 0, 600, 60),
  ('power_watts',        120,   'Stromverbrauch des Druckers',        'Watt',      'Durchschnitt während des Drucks.', 1, 3000, 70),
  ('eur_per_kwh',        0.35,  'Strompreis',                         '€ pro kWh', '', 0, 5, 80),
  ('machine_eur_per_h',  0.30,  'Maschinenkosten (Verschleiß)',       '€ pro Stunde', 'Düse, Riemen, Druckbett usw.', 0, 100, 90),
  ('base_fee_eur',       1.00,  'Aufwand pro Auftrag',                '€',         'Feste Pauschale für Vorbereitung und Übergabe.', 0, 100, 100),
  ('margin_percent',     25,    'Aufschlag',                          '%',         'Auf Material, Strom und Maschine.', 0, 500, 110),
  ('min_price_eur',      1.50,  'Mindestpreis',                       '€',         'Darunter wird nichts verkauft.', 0, 100, 120),
  ('rush_fee_eur',       2.00,  'Aufpreis „Beschleunigt“',            '€',         'Beschleunigte Aufträge kommen in der Warteschlange nach vorn.', 0, 100, 130),
  ('discount_coins',     1000,  'Rabatt: Preis in Coins',             'Coins',     'So viele Coins kostet der Rabatt (einmal je Bestellung).', 1, 1000000000, 140),
  ('discount_percent',   10,    'Rabatt: Höhe',                       '%',         'Gilt für den Artikelpreis, nicht für „Beschleunigt“. Nicht stapelbar.', 0, 50, 150),
  ('max_open_requests',  3,     'Offene Anfragen pro Person',         'Stück',     'Anti-Spam: so viele unbeantwortete Anfragen gleichzeitig.', 1, 50, 160),
  ('max_orders_per_day', 8,     'Bestellungen pro Person und Tag',    'Stück',     'Anti-Spam.', 1, 100, 170),
  ('max_qty',            10,    'Höchste Stückzahl',                  'Stück',     'Pro Bestellung.', 1, 100, 180),
  ('max_volume_cm3',     2000,  'Größtes Teil (Volumen)',             'cm³',       'Größere STL-Dateien werden abgelehnt.', 1, 20000, 190),
  ('goal_visible',       1,     'Verdienst-Anzeige zeigen',           '1 = ja, 0 = nein', 'Balken „So viel vom Ziel ist schon verdient“ oben im 3D-Druck-Shop.', 0, 1, 200),
  ('goal_eur',           20,    'Ziel (z. B. Claude Pro)',            '€',         'Betrag, den der Balken als 100 % nimmt.', 1, 100000, 210),
  ('goal_offset_eur',    0,     'Verdienst-Korrektur',                '€',         'Wird zum Umsatz der übergebenen Bestellungen addiert (auch negativ, z. B. für Bargeld ohne Bestellung).', -100000, 100000, 220)
on conflict (key) do update
  set label = excluded.label, unit = excluded.unit, hint = excluded.hint,
      min_value = excluded.min_value, max_value = excluded.max_value, sort = excluded.sort;

create or replace function public._ps(p_key text)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select value from public.print_settings where key = p_key), 0);
$$;

-- ----------------------------------------------------------------------------
-- 2. Farben, Katalog, Sperren, Bestellungen
-- ----------------------------------------------------------------------------

create table if not exists public.print_colors (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 30),
  hex text not null check (hex ~ '^#[0-9a-fA-F]{6}$'),
  extra_cents integer not null default 0 check (extra_cents between 0 and 10000),
  active boolean not null default true,
  sort integer not null default 100,
  created_at timestamptz not null default now()
);
alter table public.print_colors enable row level security;
revoke all on public.print_colors from anon, authenticated;

insert into public.print_colors (name, hex, sort)
select v.name, v.hex, v.sort
  from (values ('Schwarz', '#1f2430', 10), ('Weiß', '#f1f5f9', 20), ('Grau', '#8b93a1', 30), ('Rot', '#e11d48', 40),
               ('Orange', '#f97316', 50), ('Gelb', '#facc15', 60), ('Grün', '#22c55e', 70), ('Blau', '#2563eb', 80)) as v(name, hex, sort)
 where not exists (select 1 from public.print_colors);

create table if not exists public.print_products (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 60),
  description text not null default '' check (char_length(description) <= 600),
  price_cents integer not null check (price_cents between 0 and 100000),
  print_minutes integer not null default 60 check (print_minutes between 1 and 6000),
  text_prompt text check (text_prompt is null or char_length(btrim(text_prompt)) between 1 and 40),
  color_ids uuid[],
  image_path text check (image_path is null or image_path ~ '^shop/[A-Za-z0-9._-]+$'),
  model_path text check (model_path is null or model_path ~ '^shop/[A-Za-z0-9._-]+$'),
  active boolean not null default true,
  sort integer not null default 100,
  created_at timestamptz not null default now()
);
alter table public.print_products enable row level security;
revoke all on public.print_products from anon, authenticated;

create table if not exists public.print_bans (
  user_id uuid primary key references auth.users (id) on delete cascade,
  reason text not null default '' check (char_length(reason) <= 200),
  until timestamptz,
  created_at timestamptz not null default now()
);
alter table public.print_bans enable row level security;
revoke all on public.print_bans from anon, authenticated;

create table if not exists public.print_orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('shop', 'custom')),
  product_id uuid references public.print_products (id) on delete set null,
  title text not null check (char_length(btrim(title)) between 1 and 80),
  description text not null default '' check (char_length(description) <= 1000),
  color_id uuid references public.print_colors (id) on delete set null,
  color_name text,
  color_hex text,
  qty integer not null default 1 check (qty between 1 and 100),
  custom_text text check (custom_text is null or char_length(custom_text) <= 40),
  upload_path text,
  photo_paths text[] not null default '{}',
  volume_cm3 numeric check (volume_cm3 is null or volume_cm3 > 0),
  dims_mm jsonb,
  estimate_cents integer,
  offer_cents integer check (offer_cents is null or offer_cents between 0 and 100000),
  price_cents integer check (price_cents is null or price_cents between 0 and 1000000),
  rush_cents integer not null default 0 check (rush_cents >= 0),
  discount_percent integer not null default 0 check (discount_percent between 0 and 100),
  coins_spent integer not null default 0 check (coins_spent >= 0),
  status text not null default 'angefragt'
    check (status in ('angefragt', 'preis_vorgeschlagen', 'in_bearbeitung', 'druckt', 'lieferbereit', 'geliefert', 'abgelehnt', 'storniert')),
  admin_note text not null default '' check (char_length(admin_note) <= 500),
  print_minutes integer check (print_minutes is null or print_minutes between 1 and 100000),
  print_started_at timestamptz,
  progress_override smallint check (progress_override is null or progress_override between 0 and 100),
  breakdown jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  delivered_at timestamptz
);
create index if not exists print_orders_user_idx on public.print_orders (user_id, created_at desc);
create index if not exists print_orders_status_idx on public.print_orders (status, created_at);
alter table public.print_orders enable row level security;
revoke all on public.print_orders from anon, authenticated;

drop trigger if exists print_orders_touch on public.print_orders;
create trigger print_orders_touch before update on public.print_orders
  for each row execute function public.touch_updated_at();

-- ----------------------------------------------------------------------------
-- 3. Hilfsfunktionen
-- ----------------------------------------------------------------------------

create or replace function public._print_banned(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.print_bans b where b.user_id = p_user and (b.until is null or b.until > now()));
$$;

-- Endpreis in Cent: Artikelpreis abzüglich Rabatt plus Aufpreis „Beschleunigt“.
create or replace function public._print_final(p_price integer, p_discount integer, p_rush integer)
returns integer
language sql
immutable
as $$
  select case when p_price is null then null
              else round(p_price * (100 - coalesce(p_discount, 0)) / 100.0)::integer + coalesce(p_rush, 0) end;
$$;

-- Preis eines frei gedruckten Teils aus dem Volumen. Ergebnis: Rechnungszeilen, Gramm, Minuten, Summe in Cent.
create or replace function public._print_calc(p_volume numeric, p_qty integer, p_extra_cents integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_share numeric := public._ps('material_share') / 100.0;
  v_cm3 numeric := p_volume * p_qty * v_share;
  v_grams numeric := v_cm3 * public._ps('filament_density');
  v_speed numeric := greatest(public._ps('extrude_cm3_per_h'), 0.001);
  v_minutes integer := ceil(v_cm3 / v_speed * 60 + public._ps('setup_minutes') * 1)::integer;
  v_material numeric := v_grams / 1000.0 * public._ps('filament_eur_per_kg');
  v_power numeric := v_minutes / 60.0 * public._ps('power_watts') / 1000.0 * public._ps('eur_per_kwh');
  v_machine numeric := v_minutes / 60.0 * public._ps('machine_eur_per_h');
  v_effort numeric := public._ps('base_fee_eur') + (v_material + v_power + v_machine) * public._ps('margin_percent') / 100.0;
  v_color numeric := p_extra_cents * p_qty / 100.0;
  v_sum numeric := v_material + v_power + v_machine + v_effort + v_color;
  v_total integer := (ceil(greatest(v_sum, public._ps('min_price_eur')) * 10) * 10)::integer; -- auf 10 Cent aufrunden
  v_lines jsonb := '[]'::jsonb;
  v_items integer;
begin
  v_lines := v_lines || jsonb_build_array(jsonb_build_object('label', format('Material (%s g)', round(v_grams, 1)), 'cents', round(v_material * 100)::integer));
  v_lines := v_lines || jsonb_build_array(jsonb_build_object('label', format('Strom und Drucker (%s min)', v_minutes), 'cents', round((v_power + v_machine) * 100)::integer));
  v_lines := v_lines || jsonb_build_array(jsonb_build_object('label', 'Aufwand', 'cents', round(v_effort * 100)::integer));
  if p_extra_cents > 0 then
    v_lines := v_lines || jsonb_build_array(jsonb_build_object('label', 'Sonderfarbe', 'cents', round(v_color * 100)::integer));
  end if;
  select coalesce(sum((l->>'cents')::integer), 0) into v_items from jsonb_array_elements(v_lines) l;
  if v_total <> v_items then
    v_lines := v_lines || jsonb_build_array(jsonb_build_object('label', 'Rundung / Mindestpreis', 'cents', v_total - v_items));
  end if;
  return jsonb_build_object('lines', v_lines, 'item_cents', v_total, 'grams', round(v_grams, 1), 'minutes', v_minutes);
end;
$$;

-- Gemeinsame Preisberechnung für Vorschau und Bestellung (damit beides immer übereinstimmt).
create or replace function public._print_quote(
  p_kind text, p_product uuid, p_volume numeric, p_color uuid, p_qty integer, p_rush boolean, p_discount boolean)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_qty integer := coalesce(p_qty, 1);
  v_extra integer := 0;
  v_color public.print_colors;
  v_prod public.print_products;
  v_calc jsonb;
  v_item integer;
  v_lines jsonb;
  v_minutes integer;
  v_grams numeric := 0;
  v_rush integer := case when coalesce(p_rush, false) then round(public._ps('rush_fee_eur') * 100)::integer else 0 end;
  v_pct integer := case when coalesce(p_discount, false) then round(public._ps('discount_percent'))::integer else 0 end;
begin
  if p_kind not in ('shop', 'custom') then
    raise exception 'Unbekannte Art.' using errcode = '22023';
  end if;
  if v_qty < 1 or v_qty > public._ps('max_qty') then
    raise exception 'Die Stückzahl muss zwischen 1 und % liegen.', round(public._ps('max_qty')) using errcode = '22023';
  end if;
  if p_discount and v_pct <= 0 then
    raise exception 'Der Rabatt ist gerade nicht verfügbar.' using errcode = '22023';
  end if;

  if p_color is not null then
    select * into v_color from public.print_colors where id = p_color and active;
    if not found then
      raise exception 'Diese Farbe gibt es nicht (mehr).' using errcode = '22023';
    end if;
    v_extra := v_color.extra_cents;
  end if;

  if p_kind = 'shop' then
    select * into v_prod from public.print_products where id = p_product and active;
    if not found then
      raise exception 'Dieses Produkt gibt es nicht (mehr).' using errcode = 'P0002';
    end if;
    if v_prod.color_ids is not null and (p_color is null or not (p_color = any (v_prod.color_ids))) then
      raise exception 'Bitte eine der angebotenen Farben wählen.' using errcode = '22023';
    end if;
    if p_color is null and exists (select 1 from public.print_colors c where c.active and (v_prod.color_ids is null or c.id = any (v_prod.color_ids))) then
      raise exception 'Bitte eine Farbe wählen.' using errcode = '22023';
    end if;
    v_item := v_prod.price_cents * v_qty + v_extra * v_qty;
    v_lines := jsonb_build_array(jsonb_build_object('label', format('%s × %s', v_qty, v_prod.name), 'cents', v_prod.price_cents * v_qty));
    if v_extra > 0 then
      v_lines := v_lines || jsonb_build_array(jsonb_build_object('label', 'Sonderfarbe', 'cents', v_extra * v_qty));
    end if;
    v_minutes := v_prod.print_minutes * v_qty;
  else
    if p_volume is null then
      v_item := null; v_lines := '[]'::jsonb; v_minutes := null;
    else
      if p_volume <= 0 or p_volume > public._ps('max_volume_cm3') then
        raise exception 'Das Teil ist zu groß oder zu klein (höchstens % cm³).', round(public._ps('max_volume_cm3')) using errcode = '22023';
      end if;
      v_calc := public._print_calc(p_volume, v_qty, v_extra);
      v_item := (v_calc->>'item_cents')::integer;
      v_lines := v_calc->'lines';
      v_minutes := (v_calc->>'minutes')::integer;
      v_grams := (v_calc->>'grams')::numeric;
    end if;
  end if;

  return jsonb_build_object(
    'lines', v_lines,
    'item_cents', v_item,
    'minutes', v_minutes,
    'grams', v_grams,
    'rush_cents', v_rush,
    'discount_percent', v_pct,
    'discount_cents', case when v_item is null then null else v_item - round(v_item * (100 - v_pct) / 100.0)::integer end,
    'final_cents', public._print_final(v_item, v_pct, v_rush));
end;
$$;

create or replace function public._print_notify(p_user uuid, p_body text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.user_messages (user_id, from_id, body)
  values (p_user, (select auth.uid()), left(p_body, 1000));
end;
$$;

-- Bestellung als JSON inklusive Endpreis und Serverzeit (für den Fortschrittsbalken).
create or replace function public._print_order_json(o public.print_orders)
returns jsonb
language sql
stable
as $$
  select to_jsonb(o) || jsonb_build_object(
    'final_cents', public._print_final(coalesce(o.price_cents, o.estimate_cents), o.discount_percent, o.rush_cents),
    'server_now', now());
$$;

-- Coins einer Bestellung zurückgeben (bei Ablehnung/Abbruch), nur einmal.
create or replace function public._print_refund(p_order uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  o public.print_orders;
begin
  select * into o from public.print_orders where id = p_order for update;
  if found and o.coins_spent > 0 then
    perform public._grant_koins(o.user_id, o.coins_spent, 'print_refund', o.id::text);
    update public.print_orders set coins_spent = 0 where id = o.id;
  end if;
end;
$$;

-- ----------------------------------------------------------------------------
-- 4. Kunden: Katalog, Info, Vorschau, Bestellen
-- ----------------------------------------------------------------------------

create or replace function public.print_get_products()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', p.id, 'name', p.name, 'description', p.description, 'price_cents', p.price_cents,
           'text_prompt', p.text_prompt, 'image_path', p.image_path, 'model_path', p.model_path,
           'colors', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'hex', c.hex, 'extra_cents', c.extra_cents)
                                                order by c.sort, c.name), '[]'::jsonb)
                        from public.print_colors c
                       where c.active and (p.color_ids is null or c.id = any (p.color_ids)))
         ) order by p.sort, p.name), '[]'::jsonb)
    from public.print_products p
   where p.active and (select auth.uid()) is not null;
$$;

create or replace function public.print_get_info()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  v_ban public.print_bans;
begin
  if v_me is null then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  select * into v_ban from public.print_bans b where b.user_id = v_me and (b.until is null or b.until > now());
  return jsonb_build_object(
    'open', public._ps('orders_open') >= 1,
    'rush_cents', round(public._ps('rush_fee_eur') * 100)::integer,
    'discount_coins', round(public._ps('discount_coins'))::integer,
    'discount_percent', round(public._ps('discount_percent'))::integer,
    'max_qty', round(public._ps('max_qty'))::integer,
    'max_volume_cm3', public._ps('max_volume_cm3'),
    'max_open_requests', round(public._ps('max_open_requests'))::integer,
    'open_requests', (select count(*) from public.print_orders o where o.user_id = v_me and o.status in ('angefragt', 'preis_vorgeschlagen')),
    'banned', v_ban.user_id is not null,
    'ban_reason', v_ban.reason,
    'ban_until', v_ban.until,
    'colors', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'hex', c.hex, 'extra_cents', c.extra_cents)
                                         order by c.sort, c.name), '[]'::jsonb)
                 from public.print_colors c where c.active));
end;
$$;

create or replace function public.print_quote(
  p_kind text, p_product uuid, p_volume numeric, p_color uuid, p_qty integer, p_rush boolean, p_discount boolean)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  return public._print_quote(p_kind, p_product, p_volume, p_color, p_qty, p_rush, p_discount);
end;
$$;

create or replace function public.print_create_order(
  p_kind text, p_product uuid, p_color uuid, p_qty integer, p_custom_text text, p_title text, p_description text,
  p_upload_path text, p_photo_paths text[], p_volume numeric, p_dims jsonb, p_offer_cents integer,
  p_rush boolean, p_discount boolean)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  v_id uuid := gen_random_uuid();
  v_quote jsonb;
  v_prod public.print_products;
  v_color public.print_colors;
  v_title text;
  v_desc text := btrim(coalesce(p_description, ''));
  v_text text := nullif(btrim(coalesce(p_custom_text, '')), '');
  v_photos text[] := coalesce(p_photo_paths, '{}');
  v_ph text;
  v_item integer;
  v_cost integer := 0;
  v_pct integer;
begin
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  if public._print_banned(v_me) then
    raise exception 'Du kannst im Moment nichts bestellen.' using errcode = '42501';
  end if;
  if public._ps('orders_open') < 1 then
    raise exception 'Bestellungen sind gerade geschlossen.' using errcode = '55000';
  end if;
  if (select count(*) from public.print_orders o where o.user_id = v_me and o.status in ('angefragt', 'preis_vorgeschlagen')) >= public._ps('max_open_requests') then
    raise exception 'Du hast schon genug offene Anfragen. Warte bitte auf eine Antwort.' using errcode = '53400';
  end if;
  if (select count(*) from public.print_orders o where o.user_id = v_me and o.created_at > now() - interval '1 day') >= public._ps('max_orders_per_day') then
    raise exception 'Das waren heute genug Bestellungen. Versuch es morgen wieder.' using errcode = '53400';
  end if;
  if char_length(v_desc) > 1000 then
    raise exception 'Die Beschreibung ist zu lang (höchstens 1000 Zeichen).' using errcode = '22023';
  end if;
  if v_text is not null and char_length(v_text) > 40 then
    raise exception 'Der Text ist zu lang (höchstens 40 Zeichen).' using errcode = '22023';
  end if;
  if p_offer_cents is not null and (p_offer_cents < 0 or p_offer_cents > 100000) then
    raise exception 'Ungültiger Preisvorschlag.' using errcode = '22023';
  end if;
  if cardinality(v_photos) > 5 then
    raise exception 'Höchstens 5 Fotos.' using errcode = '22023';
  end if;
  foreach v_ph in array v_photos loop
    if v_ph !~* ('^' || v_me::text || '/[A-Za-z0-9._-]+\.(jpe?g|png|webp)$') then
      raise exception 'Ungültiges Foto.' using errcode = '22023';
    end if;
  end loop;
  if p_upload_path is not null and p_upload_path !~* ('^' || v_me::text || '/[A-Za-z0-9._-]+\.stl$') then
    raise exception 'Ungültige STL-Datei.' using errcode = '22023';
  end if;
  if p_dims is not null and (jsonb_typeof(p_dims) <> 'object' or char_length(p_dims::text) > 200) then
    raise exception 'Ungültige Maße.' using errcode = '22023';
  end if;

  if p_kind = 'shop' then
    select * into v_prod from public.print_products where id = p_product and active;
    if not found then
      raise exception 'Dieses Produkt gibt es nicht (mehr).' using errcode = 'P0002';
    end if;
    if v_prod.text_prompt is not null and v_text is null then
      raise exception 'Bitte ausfüllen: %', v_prod.text_prompt using errcode = '22023';
    end if;
    if v_prod.text_prompt is null then v_text := null; end if;
    v_title := v_prod.name;
    p_upload_path := null; v_photos := '{}'; p_volume := null; p_dims := null;
  else
    v_title := btrim(coalesce(p_title, ''));
    if char_length(v_title) not between 3 and 80 then
      raise exception 'Der Titel braucht 3 bis 80 Zeichen.' using errcode = '22023';
    end if;
    if char_length(v_desc) < 10 then
      raise exception 'Bitte beschreibe kurz, was du brauchst (mindestens 10 Zeichen).' using errcode = '22023';
    end if;
    if p_upload_path is null then p_volume := null; p_dims := null; end if;
    v_text := null;
  end if;

  v_quote := public._print_quote(p_kind, p_product, p_volume, p_color, p_qty, p_rush, p_discount);
  if p_color is not null then
    select * into v_color from public.print_colors where id = p_color;
  end if;
  v_item := (v_quote->>'item_cents')::integer;
  v_pct := (v_quote->>'discount_percent')::integer;

  if coalesce(p_discount, false) then
    v_cost := round(public._ps('discount_coins'))::integer;
    perform public._grant_koins(v_me, -v_cost, 'print_discount', v_id::text);
  end if;

  insert into public.print_orders (
    id, user_id, kind, product_id, title, description, color_id, color_name, color_hex, qty, custom_text,
    upload_path, photo_paths, volume_cm3, dims_mm, estimate_cents, offer_cents, price_cents, rush_cents,
    discount_percent, coins_spent, status, print_minutes, breakdown)
  values (
    v_id, v_me, p_kind, case when p_kind = 'shop' then p_product end, v_title, left(v_desc, 1000), p_color,
    v_color.name, v_color.hex, coalesce(p_qty, 1), v_text,
    p_upload_path, v_photos, p_volume, p_dims,
    case when p_kind = 'custom' then v_item end,
    p_offer_cents,
    case when p_kind = 'shop' then v_item end,
    (v_quote->>'rush_cents')::integer, v_pct, v_cost, 'angefragt',
    (v_quote->>'minutes')::integer, v_quote->'lines');
  return v_id;
end;
$$;

create or replace function public.print_my_orders()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(public._print_order_json(o) order by o.created_at desc), '[]'::jsonb)
    from public.print_orders o
   where o.user_id = (select auth.uid());
$$;

-- Antwort auf ein Gegenangebot: annehmen, selbst etwas anderes vorschlagen oder ablehnen.
create or replace function public.print_respond(p_id uuid, p_action text, p_offer_cents integer default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  o public.print_orders;
begin
  select * into o from public.print_orders where id = p_id and user_id = (select auth.uid()) for update;
  if not found then
    raise exception 'Bestellung nicht gefunden.' using errcode = 'P0002';
  end if;
  if o.status <> 'preis_vorgeschlagen' then
    raise exception 'Hier gibt es gerade nichts zu beantworten.' using errcode = '55000';
  end if;
  if p_action = 'accept' then
    update public.print_orders set status = 'in_bearbeitung' where id = o.id;
  elsif p_action = 'counter' then
    if public._print_banned(o.user_id) then
      raise exception 'Du kannst im Moment nichts bestellen.' using errcode = '42501';
    end if;
    if p_offer_cents is null or p_offer_cents < 0 or p_offer_cents > 100000 then
      raise exception 'Ungültiger Preisvorschlag.' using errcode = '22023';
    end if;
    update public.print_orders set offer_cents = p_offer_cents, status = 'angefragt' where id = o.id;
  elsif p_action = 'decline' then
    perform public._print_refund(o.id);
    update public.print_orders set status = 'storniert' where id = o.id;
  else
    raise exception 'Unbekannte Aktion.' using errcode = '22023';
  end if;
end;
$$;

create or replace function public.print_cancel(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  o public.print_orders;
begin
  select * into o from public.print_orders where id = p_id and user_id = (select auth.uid()) for update;
  if not found then
    raise exception 'Bestellung nicht gefunden.' using errcode = 'P0002';
  end if;
  if o.status not in ('angefragt', 'preis_vorgeschlagen', 'in_bearbeitung') then
    raise exception 'Diese Bestellung lässt sich nicht mehr abbrechen.' using errcode = '55000';
  end if;
  perform public._print_refund(o.id);
  update public.print_orders set status = 'storniert' where id = o.id;
end;
$$;

-- ----------------------------------------------------------------------------
-- 5. Admin: Warteschlange und Bearbeitung
-- ----------------------------------------------------------------------------

create or replace function public.admin_print_orders(p_scope text default 'open')
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public._require_admin();
  return coalesce((
    select jsonb_agg(public._print_order_json(x.o) || jsonb_build_object(
             'user_name', x.name, 'user_banned', public._print_banned((x.o).user_id))
           order by x.rank, x.rush desc, (case when p_scope = 'done' then x.upd end) desc nulls last, x.created)
      from (
        select o, p.display_name as name,
               case o.status when 'angefragt' then 1 when 'preis_vorgeschlagen' then 4 when 'druckt' then 2
                             when 'in_bearbeitung' then 3 when 'lieferbereit' then 5 else 9 end as rank,
               o.rush_cents > 0 as rush, o.created_at as created, o.updated_at as upd
          from public.print_orders o
          join public.profiles p on p.id = o.user_id
         where case when p_scope = 'done' then o.status in ('geliefert', 'abgelehnt', 'storniert')
                    else o.status not in ('geliefert', 'abgelehnt', 'storniert') end
         order by case when p_scope = 'done' then o.updated_at end desc nulls last, o.created_at
         limit 300
      ) x
  ), '[]'::jsonb);
end;
$$;

create or replace function public.admin_print_counts()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public._require_admin();
  return jsonb_build_object(
    'angefragt', (select count(*) from public.print_orders where status = 'angefragt'),
    'preis_vorgeschlagen', (select count(*) from public.print_orders where status = 'preis_vorgeschlagen'),
    'in_bearbeitung', (select count(*) from public.print_orders where status = 'in_bearbeitung'),
    'druckt', (select count(*) from public.print_orders where status = 'druckt'),
    'lieferbereit', (select count(*) from public.print_orders where status = 'lieferbereit'),
    'todo', (select count(*) from public.print_orders where status in ('angefragt', 'in_bearbeitung', 'druckt')));
end;
$$;

-- Eine Aktion auf eine Bestellung:
--  accept   Anfrage annehmen (Preis = Wunschpreis/Richtpreis → sofort in Bearbeitung, sonst Gegenangebot)
--  counter  Gegenangebot machen (immer)
--  reject   ablehnen (Coins zurück)
--  start    Druck starten (Zeit in Minuten)
--  progress Fortschritt von Hand setzen (null = automatisch nach Zeit)
--  ready    fertig gedruckt, abholbereit
--  delivered übergeben
--  back     zurück in „In Bearbeitung“
--  note     nur Notiz
create or replace function public.admin_print_action(
  p_id uuid, p_action text, p_price_cents integer default null, p_minutes integer default null,
  p_note text default null, p_progress integer default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  o public.print_orders;
  v_note text;
  v_price integer;
  v_status text;
begin
  perform public._require_admin();
  select * into o from public.print_orders where id = p_id for update;
  if not found then
    raise exception 'Bestellung nicht gefunden.' using errcode = 'P0002';
  end if;
  v_note := case when p_note is null then o.admin_note else left(btrim(p_note), 500) end;
  if p_minutes is not null and (p_minutes < 1 or p_minutes > 100000) then
    raise exception 'Ungültige Druckzeit.' using errcode = '22023';
  end if;

  if p_action in ('accept', 'counter') then
    if o.status not in ('angefragt', 'preis_vorgeschlagen') then
      raise exception 'Diese Anfrage ist schon bearbeitet.' using errcode = '55000';
    end if;
    v_price := coalesce(p_price_cents, o.price_cents, o.estimate_cents);
    if v_price is null or v_price < 0 or v_price > 1000000 then
      raise exception 'Bitte einen Preis angeben.' using errcode = '22023';
    end if;
    -- Der Kunde hat diesen Preis schon gesehen oder selbst vorgeschlagen → keine Rückfrage nötig.
    if p_action = 'accept' and o.status = 'angefragt'
       and (o.kind = 'shop' or v_price = o.estimate_cents or v_price = o.offer_cents) then
      v_status := 'in_bearbeitung';
    else
      v_status := 'preis_vorgeschlagen';
    end if;
    update public.print_orders
       set price_cents = v_price, status = v_status, admin_note = v_note,
           print_minutes = coalesce(p_minutes, print_minutes, 60)
     where id = o.id;
    if v_status = 'in_bearbeitung' then
      perform public._print_notify(o.user_id, format('Dein Druckauftrag „%s“ wurde angenommen.', o.title));
    else
      perform public._print_notify(o.user_id, format('Zu deinem Druckauftrag „%s“ gibt es einen Preisvorschlag. Schau im 3D-Druck-Shop unter „Meine Bestellungen“ nach.', o.title));
    end if;

  elsif p_action = 'reject' then
    if o.status in ('geliefert', 'abgelehnt', 'storniert') then
      raise exception 'Diese Bestellung ist schon abgeschlossen.' using errcode = '55000';
    end if;
    perform public._print_refund(o.id);
    update public.print_orders set status = 'abgelehnt', admin_note = v_note, print_started_at = null where id = o.id;
    perform public._print_notify(o.user_id, format('Dein Druckauftrag „%s“ wurde abgelehnt.%s', o.title,
      case when v_note <> '' then ' Grund: ' || v_note else '' end));

  elsif p_action = 'start' then
    if o.status <> 'in_bearbeitung' then
      raise exception 'Nur Aufträge „In Bearbeitung“ lassen sich starten.' using errcode = '55000';
    end if;
    update public.print_orders
       set status = 'druckt', print_started_at = now(), progress_override = null, admin_note = v_note,
           print_minutes = coalesce(p_minutes, print_minutes, 60)
     where id = o.id;
    perform public._print_notify(o.user_id, format('Dein Druckauftrag „%s“ wird jetzt gedruckt. Den Fortschritt siehst du im 3D-Druck-Shop.', o.title));

  elsif p_action = 'progress' then
    if o.status <> 'druckt' then
      raise exception 'Der Fortschritt lässt sich nur beim Drucken setzen.' using errcode = '55000';
    end if;
    if p_progress is not null and (p_progress < 0 or p_progress > 100) then
      raise exception 'Der Fortschritt liegt zwischen 0 und 100.' using errcode = '22023';
    end if;
    update public.print_orders set progress_override = p_progress where id = o.id;

  elsif p_action = 'ready' then
    if o.status not in ('druckt', 'in_bearbeitung') then
      raise exception 'Dieser Auftrag kann nicht fertig gemeldet werden.' using errcode = '55000';
    end if;
    update public.print_orders set status = 'lieferbereit', admin_note = v_note where id = o.id;
    perform public._print_notify(o.user_id, format('Dein Druckauftrag „%s“ ist fertig und liegt zur Übergabe bereit.', o.title));

  elsif p_action = 'delivered' then
    if o.status <> 'lieferbereit' then
      raise exception 'Nur fertige Aufträge lassen sich als übergeben markieren.' using errcode = '55000';
    end if;
    update public.print_orders set status = 'geliefert', delivered_at = now(), admin_note = v_note where id = o.id;

  elsif p_action = 'back' then
    if o.status not in ('druckt', 'lieferbereit') then
      raise exception 'Nur laufende oder fertige Aufträge gehen zurück.' using errcode = '55000';
    end if;
    update public.print_orders set status = 'in_bearbeitung', print_started_at = null, progress_override = null where id = o.id;

  elsif p_action = 'note' then
    update public.print_orders set admin_note = v_note where id = o.id;

  else
    raise exception 'Unbekannte Aktion.' using errcode = '22023';
  end if;

  return public._print_order_json((select x from public.print_orders x where x.id = o.id));
end;
$$;

-- Abgeschlossene Bestellung löschen; gibt die Dateipfade zurück, damit die App sie aus dem Speicher entfernt.
create or replace function public.admin_print_delete_order(p_id uuid)
returns text[]
language plpgsql
security definer
set search_path = public
as $$
declare
  o public.print_orders;
begin
  perform public._require_admin();
  select * into o from public.print_orders where id = p_id for update;
  if not found then
    raise exception 'Bestellung nicht gefunden.' using errcode = 'P0002';
  end if;
  if o.status not in ('geliefert', 'abgelehnt', 'storniert') then
    raise exception 'Nur abgeschlossene Bestellungen lassen sich löschen.' using errcode = '55000';
  end if;
  -- Übergebene Bestellungen zählen weiter zum Verdienst, auch wenn sie gelöscht werden.
  if o.status = 'geliefert' then
    update public.print_settings
       set value = value + coalesce(public._print_final(coalesce(o.price_cents, o.estimate_cents), o.discount_percent, o.rush_cents), 0) / 100.0
     where key = 'goal_offset_eur';
  end if;
  delete from public.print_orders where id = o.id;
  return array_remove(array[o.upload_path] || o.photo_paths, null);
end;
$$;

-- ----------------------------------------------------------------------------
-- 6. Admin: Katalog, Farben, Einstellungen, Sperren
-- ----------------------------------------------------------------------------

create or replace function public.admin_print_list_products()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public._require_admin();
  return coalesce((select jsonb_agg(to_jsonb(p) order by p.sort, p.name) from public.print_products p), '[]'::jsonb);
end;
$$;

create or replace function public.admin_print_save_product(
  p_id uuid, p_name text, p_description text, p_price_cents integer, p_print_minutes integer,
  p_text_prompt text, p_color_ids uuid[], p_image_path text, p_model_path text, p_active boolean, p_sort integer)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid := coalesce(p_id, gen_random_uuid());
  v_prompt text := nullif(btrim(coalesce(p_text_prompt, '')), '');
begin
  perform public._require_admin();
  if char_length(btrim(coalesce(p_name, ''))) not between 1 and 60 then
    raise exception 'Der Name braucht 1 bis 60 Zeichen.' using errcode = '22023';
  end if;
  if p_price_cents is null or p_price_cents < 0 or p_price_cents > 100000 then
    raise exception 'Ungültiger Preis.' using errcode = '22023';
  end if;
  if p_print_minutes is null or p_print_minutes < 1 or p_print_minutes > 6000 then
    raise exception 'Die Druckzeit muss zwischen 1 und 6000 Minuten liegen.' using errcode = '22023';
  end if;
  if p_color_ids is not null and cardinality(p_color_ids) = 0 then
    p_color_ids := null;
  end if;
  if p_id is null then
    insert into public.print_products (id, name, description, price_cents, print_minutes, text_prompt, color_ids, image_path, model_path, active, sort)
    values (v_id, btrim(p_name), left(btrim(coalesce(p_description, '')), 600), p_price_cents, p_print_minutes, v_prompt,
            p_color_ids, p_image_path, p_model_path, coalesce(p_active, true), coalesce(p_sort, 100));
  else
    update public.print_products
       set name = btrim(p_name), description = left(btrim(coalesce(p_description, '')), 600), price_cents = p_price_cents,
           print_minutes = p_print_minutes, text_prompt = v_prompt, color_ids = p_color_ids,
           image_path = p_image_path, model_path = p_model_path, active = coalesce(p_active, true), sort = coalesce(p_sort, 100)
     where id = p_id;
    if not found then
      raise exception 'Produkt nicht gefunden.' using errcode = 'P0002';
    end if;
  end if;
  return v_id;
end;
$$;

create or replace function public.admin_print_delete_product(p_id uuid)
returns text[]
language plpgsql
security definer
set search_path = public
as $$
declare
  p public.print_products;
begin
  perform public._require_admin();
  select * into p from public.print_products where id = p_id;
  if not found then
    raise exception 'Produkt nicht gefunden.' using errcode = 'P0002';
  end if;
  delete from public.print_products where id = p.id;
  return array_remove(array[p.image_path, p.model_path], null);
end;
$$;

create or replace function public.admin_print_list_colors()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public._require_admin();
  return coalesce((select jsonb_agg(to_jsonb(c) order by c.sort, c.name) from public.print_colors c), '[]'::jsonb);
end;
$$;

create or replace function public.admin_print_save_color(
  p_id uuid, p_name text, p_hex text, p_extra_cents integer, p_active boolean, p_sort integer)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid := coalesce(p_id, gen_random_uuid());
begin
  perform public._require_admin();
  if char_length(btrim(coalesce(p_name, ''))) not between 1 and 30 then
    raise exception 'Der Name braucht 1 bis 30 Zeichen.' using errcode = '22023';
  end if;
  if p_hex is null or p_hex !~ '^#[0-9a-fA-F]{6}$' then
    raise exception 'Die Farbe muss wie #22d3ee aussehen.' using errcode = '22023';
  end if;
  if p_extra_cents is null or p_extra_cents < 0 or p_extra_cents > 10000 then
    raise exception 'Ungültiger Aufpreis.' using errcode = '22023';
  end if;
  if p_id is null then
    insert into public.print_colors (id, name, hex, extra_cents, active, sort)
    values (v_id, btrim(p_name), lower(p_hex), p_extra_cents, coalesce(p_active, true), coalesce(p_sort, 100));
  else
    update public.print_colors
       set name = btrim(p_name), hex = lower(p_hex), extra_cents = p_extra_cents,
           active = coalesce(p_active, true), sort = coalesce(p_sort, 100)
     where id = p_id;
    if not found then
      raise exception 'Farbe nicht gefunden.' using errcode = 'P0002';
    end if;
  end if;
  return v_id;
end;
$$;

create or replace function public.admin_print_delete_color(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._require_admin();
  update public.print_products set color_ids = array_remove(color_ids, p_id) where p_id = any (color_ids);
  update public.print_products set color_ids = null where color_ids is not null and cardinality(color_ids) = 0;
  delete from public.print_colors where id = p_id;
end;
$$;

create or replace function public.admin_print_get_settings()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public._require_admin();
  return coalesce((select jsonb_agg(to_jsonb(s) order by s.sort) from public.print_settings s), '[]'::jsonb);
end;
$$;

create or replace function public.admin_print_set_setting(p_key text, p_value numeric)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.print_settings;
begin
  perform public._require_admin();
  select * into s from public.print_settings where key = p_key;
  if not found then
    raise exception 'Unbekannte Einstellung.' using errcode = 'P0002';
  end if;
  if p_value is null or p_value < s.min_value or p_value > s.max_value then
    raise exception '% muss zwischen % und % liegen.', s.label, s.min_value, s.max_value using errcode = '22023';
  end if;
  update public.print_settings set value = p_value where key = p_key;
end;
$$;

-- Spammer sperren; offene Anfragen werden dabei abgelehnt (Coins zurück).
create or replace function public.admin_print_ban(p_user uuid, p_reason text default '', p_days integer default null, p_reject_open boolean default true)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
begin
  perform public._require_admin();
  if p_user = (select auth.uid()) or exists (select 1 from public.profiles where id = p_user and role = 'admin') then
    raise exception 'Admins lassen sich nicht sperren.' using errcode = '22023';
  end if;
  if p_days is not null and (p_days < 1 or p_days > 3650) then
    raise exception 'Ungültige Dauer.' using errcode = '22023';
  end if;
  insert into public.print_bans (user_id, reason, until)
  values (p_user, left(btrim(coalesce(p_reason, '')), 200), case when p_days is null then null else now() + make_interval(days => p_days) end)
  on conflict (user_id) do update set reason = excluded.reason, until = excluded.until, created_at = now();
  if coalesce(p_reject_open, true) then
    for r in select id from public.print_orders where user_id = p_user and status in ('angefragt', 'preis_vorgeschlagen') loop
      perform public._print_refund(r.id);
      update public.print_orders set status = 'abgelehnt', admin_note = 'Gesperrt' where id = r.id;
    end loop;
  end if;
end;
$$;

create or replace function public.admin_print_unban(p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._require_admin();
  delete from public.print_bans where user_id = p_user;
end;
$$;

create or replace function public.admin_print_list_bans()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public._require_admin();
  return coalesce((
    select jsonb_agg(jsonb_build_object('user_id', b.user_id, 'user_name', p.display_name, 'reason', b.reason,
                                        'until', b.until, 'active', (b.until is null or b.until > now()), 'created_at', b.created_at)
                     order by b.created_at desc)
      from public.print_bans b join public.profiles p on p.id = b.user_id), '[]'::jsonb);
end;
$$;

-- ----------------------------------------------------------------------------
-- 6b. Verdienst-Anzeige (Umsatz der übergebenen Bestellungen im Verhältnis zum Ziel)
-- ----------------------------------------------------------------------------

create or replace function public._print_delivered_cents()
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(public._print_final(coalesce(o.price_cents, o.estimate_cents), o.discount_percent, o.rush_cents)), 0)::bigint
    from public.print_orders o where o.status = 'geliefert';
$$;

create or replace function public.print_get_goal()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_goal integer := round(public._ps('goal_eur') * 100)::integer;
  v_earned bigint;
begin
  if (select auth.uid()) is null then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  if public._ps('goal_visible') < 1 and not public.is_admin() then
    return jsonb_build_object('visible', false);
  end if;
  v_earned := public._print_delivered_cents() + round(public._ps('goal_offset_eur') * 100);
  return jsonb_build_object(
    'visible', public._ps('goal_visible') >= 1,
    'goal_cents', v_goal,
    'earned_cents', greatest(v_earned, 0),
    'percent', case when v_goal > 0 then round(greatest(v_earned, 0) * 100.0 / v_goal, 1) else 0 end);
end;
$$;

-- Neues Ziel beginnen: der bisherige Verdienst wird auf 0 gesetzt.
create or replace function public.admin_print_goal_reset()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._require_admin();
  update public.print_settings set value = -(public._print_delivered_cents() / 100.0) where key = 'goal_offset_eur';
end;
$$;

-- ----------------------------------------------------------------------------
-- 7. Dateiablage (Supabase Storage): Bucket „print-files“, privat
--    Kunden:  <eigene-id>/<datei>.stl|jpg|png|webp   Shop (Admin): shop/<datei>
-- ----------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit)
values ('print-files', 'print-files', false, 26214400)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;

-- Zählt die Dateien einer Person (als Funktion, weil eine Regel sich nicht selbst abfragen darf).
create or replace function public._print_files_count(p_user uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::integer from storage.objects o
   where o.bucket_id = 'print-files' and o.name like p_user::text || '/%';
$$;

-- Hängt die Datei an einer Bestellung? Dann darf der Besitzer sie nicht löschen.
create or replace function public._print_file_in_use(p_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.print_orders o where o.upload_path = p_name or p_name = any (o.photo_paths));
$$;

drop policy if exists print_files_select on storage.objects;
create policy print_files_select on storage.objects for select to authenticated
  using (bucket_id = 'print-files'
         and ((storage.foldername(name))[1] = (select auth.uid())::text
              or (storage.foldername(name))[1] = 'shop'
              or public.is_admin()));

drop policy if exists print_files_insert_own on storage.objects;
create policy print_files_insert_own on storage.objects for insert to authenticated
  with check (bucket_id = 'print-files'
              and (storage.foldername(name))[1] = (select auth.uid())::text
              and name ~* '\.(stl|jpe?g|png|webp)$'
              and not public._print_banned((select auth.uid()))
              and public._print_files_count((select auth.uid())) < 40);

drop policy if exists print_files_insert_shop on storage.objects;
create policy print_files_insert_shop on storage.objects for insert to authenticated
  with check (bucket_id = 'print-files'
              and (storage.foldername(name))[1] = 'shop'
              and name ~* '\.(stl|jpe?g|png|webp)$'
              and public.is_admin());

drop policy if exists print_files_delete on storage.objects;
create policy print_files_delete on storage.objects for delete to authenticated
  using (bucket_id = 'print-files'
         and (public.is_admin()
              or ((storage.foldername(name))[1] = (select auth.uid())::text
                  and not public._print_file_in_use(name))));

-- ----------------------------------------------------------------------------
-- 8. Rechte
-- ----------------------------------------------------------------------------

do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig, p.proname
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and (p.proname like 'print\_%' or p.proname like 'admin\_print\_%' or p.proname like '\_print\_%' or p.proname = '_ps')
  loop
    if r.proname like '\_%' and r.proname not in ('_print_banned', '_print_files_count', '_print_file_in_use') then
      execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    else
      execute format('revoke all on function %s from public, anon', r.sig);
      execute format('grant execute on function %s to authenticated', r.sig);
    end if;
  end loop;
end;
$$;


-- ===== 0019_board_mods_repeat_learn_coins.sql =====
-- ============================================================================
-- 0019: Schwarzes Brett auch für Mods, Option „falsche Vokabeln so lange wiederholen,
-- bis sie stimmen“, Coins auch fürs Wiederholen bekannter Vokabeln.
-- Wiederholbar. Nach 0018 ausführen.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Schwarzes Brett: alle Mods (Mod, Alphamod, Admin) dürfen schreiben und löschen
-- ----------------------------------------------------------------------------

create or replace function public.admin_save_board_post(p_id uuid, p_title text, p_body text, p_status text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not public.is_staff() then
    raise exception 'Nur für Mods und Admins.' using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(p_title, ''))) not between 1 and 120 then
    raise exception 'Der Titel braucht 1 bis 120 Zeichen.' using errcode = '22023';
  end if;
  if p_status not in ('planned', 'doing', 'done') then
    raise exception 'Ungültiger Status.' using errcode = '22023';
  end if;
  if p_id is null then
    insert into public.board_posts (title, body, status) values (btrim(p_title), left(coalesce(p_body, ''), 2000), p_status)
    returning id into v_id;
  else
    update public.board_posts
       set title = btrim(p_title), body = left(coalesce(p_body, ''), 2000), status = p_status, updated_at = now()
     where id = p_id returning id into v_id;
    if v_id is null then
      raise exception 'Eintrag nicht gefunden.' using errcode = 'P0002';
    end if;
  end if;
  return v_id;
end;
$$;

create or replace function public.admin_delete_board_post(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_staff() then
    raise exception 'Nur für Mods und Admins.' using errcode = '42501';
  end if;
  delete from public.board_posts where id = p_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- 2. Einstellung: falsche Vokabeln am Ende so oft wiederholen, bis alle richtig sind
-- ----------------------------------------------------------------------------

alter table public.user_settings add column if not exists repeat_until_correct boolean not null default false;

-- ----------------------------------------------------------------------------
-- 3. Coins fürs Lernen: je so viele richtige Antworten 1 Coin (Lernen, nicht Test),
--    zusätzlich zu den Coins für neu gelernte Vokabeln. Nur Online-Bücher, mit Tageslimit.
-- ----------------------------------------------------------------------------

insert into public.app_settings (key, value, mod_editable) values
  ('learn_coin_every', 5, false),   -- Lernen: 1 Coin je so viele richtige Antworten (Hauptrunde)
  ('learn_coin_cap', 20, false)     -- Lernen: höchstens so viele solcher Coins pro Tag
on conflict (key) do nothing;

create table if not exists public.learn_coin_days (
  user_id uuid not null references auth.users (id) on delete cascade,
  day date not null,
  correct integer not null default 0,
  paid integer not null default 0,
  primary key (user_id, day)
);
alter table public.learn_coin_days enable row level security;
revoke all on public.learn_coin_days from anon, authenticated;

create or replace function public.award_answer_koins()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_every integer := greatest(public.setting('learn_coin_every'), 1);
  v_cap integer := public.setting('learn_coin_cap');
  v_user uuid;
  v_mode text;
  v_today date := (now() at time zone 'Europe/Berlin')::date;
  v_correct integer;
  v_paid integer;
  v_due integer;
begin
  if new.is_repeat or not new.is_correct or v_cap <= 0 then
    return new;
  end if;
  select s.user_id, s.mode into v_user, v_mode from public.learning_sessions s where s.id = new.session_id;
  if v_user is null or v_mode <> 'learn' then
    return new;
  end if;
  if coalesce((select p.blocked from public.profiles p where p.id = v_user), true) then
    return new;
  end if;
  -- nur geprüfte Inhalte (Online-Bücher), damit man sich nicht mit eigenen Vokabeln Coins ertippt
  if not exists (
    select 1 from public.vocabulary v join public.books b on b.id = v.book_id
     where v.id = new.vocabulary_id and b.is_public) then
    return new;
  end if;
  insert into public.learn_coin_days (user_id, day, correct) values (v_user, v_today, 1)
  on conflict (user_id, day) do update set correct = public.learn_coin_days.correct + 1
  returning correct, paid into v_correct, v_paid;
  v_due := least(v_correct / v_every, v_cap);
  if v_due > v_paid then
    perform public._grant_koins(v_user, v_due - v_paid, 'learn_answers', null);
    update public.learn_coin_days set paid = v_due where user_id = v_user and day = v_today;
  end if;
  return new;
end;
$$;

drop trigger if exists learning_answers_award_koins on public.learning_answers;
create trigger learning_answers_award_koins
  after insert on public.learning_answers
  for each row execute function public.award_answer_koins();

-- ----------------------------------------------------------------------------
-- 4. Rechte
-- ----------------------------------------------------------------------------

do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig, p.proname
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('admin_save_board_post', 'admin_delete_board_post', 'award_answer_koins')
  loop
    if r.proname = 'award_answer_koins' then
      execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    else
      execute format('revoke all on function %s from public, anon', r.sig);
      execute format('grant execute on function %s to authenticated', r.sig);
    end if;
  end loop;
end;
$$;


-- ===== 0020_notifications.sql =====
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

-- ===== 0021_plus_ai.sql =====
-- ============================================================================
-- 0021: Vokabeltrainer + (Abo), KI-Grammatikblätter und Test-Sätze (OpenAI über eine Edge Function),
-- Plus-Designs und -Tag, Verdienst-Konto für das Pro-Abo.
-- Wiederholbar. Nach 0020 ausführen.
--
-- Wichtig: Alles, was die KI schreibt (Status, Blätter, Kosten), geht nur über die Edge Function
-- (Rolle service_role). Der Browser kann diese Funktionen nicht aufrufen.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Einstellungen (alle vom Admin änderbar)
-- ----------------------------------------------------------------------------

create table if not exists public.plus_settings (
  key text primary key,
  value numeric not null,
  label text not null,
  unit text not null default '',
  hint text not null default '',
  min_value numeric not null default 0,
  max_value numeric not null default 100000,
  sort integer not null default 100
);
alter table public.plus_settings enable row level security;
revoke all on public.plus_settings from anon, authenticated;

insert into public.plus_settings (key, value, label, unit, hint, min_value, max_value, sort) values
  ('plus_price_eur',     3,    'Preis eines Plus-Pakets',          '€',        'Wird in der Schule bar bezahlt. Nur zur Anzeige und als Vorgabe beim Vergeben.', 0, 1000, 10),
  ('plus_days',          30,   'Laufzeit eines Pakets',            'Tage',     'So lange gilt Plus nach dem Vergeben (du kannst beim Vergeben auch andere Tage eintragen).', 1, 365, 20),
  ('plus_coin_enabled',  1,    '1 Tag Plus für Coins',             '1 = an',   'Jeder kann sich einmalig einen Tag Plus für Coins kaufen.', 0, 1, 30),
  ('plus_coin_price',    1000, 'Preis des Tages in Coins',         'Coins',    'Gilt nur einmalig pro Person.', 1, 1000000, 40),
  ('plus_coin_days',     1,    'Dauer des Coin-Tages',             'Tage',     '', 1, 30, 50),
  ('ai_enabled',         1,    'KI-Funktionen an',                 '1 = an',   'Bei 0 kann niemand Blätter erzeugen (gespeicherte Blätter bleiben nutzbar).', 0, 1, 60),
  ('ai_usd_in',          0.15, 'Modellpreis Eingabe',              '$ / 1 Mio. Tokens', 'Aus der OpenAI-Preisliste (gpt-4o-mini: 0,15). Daraus werden die Kosten berechnet.', 0, 1000, 70),
  ('ai_usd_out',         0.60, 'Modellpreis Ausgabe',              '$ / 1 Mio. Tokens', 'Aus der OpenAI-Preisliste (gpt-4o-mini: 0,60).', 0, 1000, 80),
  ('ai_usd_eur',         0.92, 'Dollar-Kurs',                      '€ pro $',  'Zum Umrechnen der Kosten in Euro.', 0.1, 10, 90),
  ('ai_user_month_eur',  0.50, 'KI-Budget pro Person und Monat',   '€',        'Wenn die Kosten einer Person diesen Betrag erreichen, kann sie diesen Monat nichts mehr erzeugen.', 0, 100, 100),
  ('ai_user_day_gens',   30,   'Erzeugungen pro Person und Tag',   'Stück',    'Schutz gegen Dauer-Klicken.', 1, 1000, 110),
  ('ai_global_month_eur', 10,  'KI-Budget insgesamt pro Monat',    '€',        'Notbremse für alle zusammen. Zusätzlich solltest du im OpenAI-Konto ein Ausgabenlimit setzen.', 0, 10000, 120),
  ('ai_max_items',       15,   'Aufgaben pro Blatt (höchstens)',   'Stück',    '', 5, 30, 130),
  ('ai_test_sentences',  20,   'Sätze pro Test (höchstens)',       'Stück',    '', 1, 60, 140)
on conflict (key) do update
  set label = excluded.label, unit = excluded.unit, hint = excluded.hint,
      min_value = excluded.min_value, max_value = excluded.max_value, sort = excluded.sort;

create or replace function public._pls(p_key text)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select value from public.plus_settings where key = p_key), 0);
$$;

-- ----------------------------------------------------------------------------
-- 2. Plus pro Person
-- ----------------------------------------------------------------------------

alter table public.profiles add column if not exists plus_until timestamptz;
alter table public.profiles add column if not exists plus_trial_used boolean not null default false;
alter table public.shop_items add column if not exists plus_only boolean not null default false;

-- Admins haben Plus immer (zum Ausprobieren).
create or replace function public._plus_active(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select (p.plus_until > now()) or p.role = 'admin' from public.profiles p where p.id = p_user and not p.blocked), false);
$$;

-- Ohne Plus: Plus-Designs ausziehen.
create or replace function public._plus_sync(p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if public._plus_active(p_user) then
    return;
  end if;
  update public.profiles p
     set avatar_id = case when p.avatar_id in (select id from public.shop_items where plus_only) then null else p.avatar_id end,
         color_id  = case when p.color_id  in (select id from public.shop_items where plus_only) then null else p.color_id end,
         effect_id = case when p.effect_id in (select id from public.shop_items where plus_only) then null else p.effect_id end,
         theme_id  = case when p.theme_id  in (select id from public.shop_items where plus_only) then null else p.theme_id end,
         tag_id    = case when p.tag_id    in (select id from public.shop_items where plus_only) then null else p.tag_id end
   where p.id = p_user
     and (p.avatar_id in (select id from public.shop_items where plus_only)
       or p.color_id  in (select id from public.shop_items where plus_only)
       or p.effect_id in (select id from public.shop_items where plus_only)
       or p.theme_id  in (select id from public.shop_items where plus_only)
       or p.tag_id    in (select id from public.shop_items where plus_only));
end;
$$;

-- Mit Plus: das „+“-Tag gibt es gleich dazu, wenn noch keins getragen wird.
create or replace function public._plus_apply_perks(p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if public._plus_active(p_user) and exists (select 1 from public.shop_items where id = 'tag_plus') then
    update public.profiles set tag_id = 'tag_plus' where id = p_user and tag_id is null;
  end if;
end;
$$;

-- Online-Signal räumt abgelaufene Plus-Designs mit auf.
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
  perform public._plus_sync(v_me);
end;
$$;

-- Anfragen („Plus anfordern“), Verkäufe/Vergaben, manuelle Verdienst-Buchungen
create table if not exists public.plus_requests (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.plus_requests enable row level security;
revoke all on public.plus_requests from anon, authenticated;

create table if not exists public.plus_sales (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users (id) on delete set null,
  kind text not null check (kind in ('paid', 'gift', 'coins')),
  cents integer not null default 0 check (cents >= 0),
  days integer not null check (days between 1 and 365),
  note text not null default '' check (char_length(note) <= 200),
  created_at timestamptz not null default now()
);
create index if not exists plus_sales_created_idx on public.plus_sales (created_at desc);
alter table public.plus_sales enable row level security;
revoke all on public.plus_sales from anon, authenticated;

create table if not exists public.goal_entries (
  id bigint generated always as identity primary key,
  cents integer not null check (cents between -1000000 and 1000000 and cents <> 0),
  note text not null default '' check (char_length(note) <= 200),
  created_at timestamptz not null default now()
);
alter table public.goal_entries enable row level security;
revoke all on public.goal_entries from anon, authenticated;

-- ----------------------------------------------------------------------------
-- 3. KI: Status, Verbrauch, Blätter, Satz-Zwischenspeicher, Ergebnisse
-- ----------------------------------------------------------------------------

create table if not exists public.ai_status (
  id boolean primary key default true check (id),
  state text not null default 'no_key' check (state in ('no_key', 'ok', 'empty', 'error')),
  message text not null default '',
  updated_at timestamptz not null default now()
);
insert into public.ai_status (id) values (true) on conflict do nothing;
alter table public.ai_status enable row level security;
revoke all on public.ai_status from anon, authenticated;

create table if not exists public.ai_usage (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users (id) on delete set null,
  kind text not null check (kind in ('grammar', 'sentences')),
  tokens_in integer not null default 0,
  tokens_out integer not null default 0,
  cost_micro bigint not null default 0,   -- Millionstel Euro
  ok boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists ai_usage_user_idx on public.ai_usage (user_id, created_at desc);
create index if not exists ai_usage_created_idx on public.ai_usage (created_at desc);
alter table public.ai_usage enable row level security;
revoke all on public.ai_usage from anon, authenticated;

create table if not exists public.ai_grammar_sets (
  id uuid primary key default gen_random_uuid(),
  language text not null check (language in ('en', 'fr')),
  grade integer not null check (grade between 5 and 13),
  topic_key text not null check (topic_key ~ '^[a-z0-9_]{1,60}$'),
  topic text not null check (char_length(topic) between 2 and 80),
  level text not null check (level in ('einfach', 'mittel', 'schwer')),
  title text not null check (char_length(title) between 2 and 120),
  items jsonb not null check (jsonb_typeof(items) = 'array' and jsonb_array_length(items) between 1 and 40),
  created_by uuid references auth.users (id) on delete set null,
  uses integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists ai_grammar_sets_find_idx on public.ai_grammar_sets (language, grade, topic_key, level, created_at desc);
alter table public.ai_grammar_sets enable row level security;
revoke all on public.ai_grammar_sets from anon, authenticated;

create table if not exists public.ai_vocab_sentences (
  key text primary key,
  language text not null,
  level text not null,
  item jsonb not null,
  uses integer not null default 0,
  created_at timestamptz not null default now()
);
alter table public.ai_vocab_sentences enable row level security;
revoke all on public.ai_vocab_sentences from anon, authenticated;

create table if not exists public.ai_results (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('grammar', 'test')),
  title text not null check (char_length(title) between 1 and 160),
  ref uuid,
  language text not null default '',
  level text not null default '',
  score integer not null check (score >= 0),
  total integer not null check (total >= 1),
  payload jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists ai_results_user_idx on public.ai_results (user_id, kind, created_at desc);
alter table public.ai_results enable row level security;
revoke all on public.ai_results from anon, authenticated;

-- ----------------------------------------------------------------------------
-- 4. Verdienst-Ziel: Druck-Umsatz + Plus-Verkäufe + manuelle Buchungen − KI-Kosten
-- ----------------------------------------------------------------------------

create or replace function public._ai_cost_cents()
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select round(coalesce(sum(cost_micro), 0) / 10000.0)::bigint from public.ai_usage;
$$;

create or replace function public._goal_total_cents()
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select public._print_delivered_cents()
       + coalesce((select sum(cents) from public.plus_sales), 0)
       + coalesce((select sum(cents) from public.goal_entries), 0)
       - public._ai_cost_cents();
$$;

create or replace function public.print_get_goal()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_goal integer := round(public._ps('goal_eur') * 100)::integer;
  v_earned bigint;
begin
  if (select auth.uid()) is null then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  if public._ps('goal_visible') < 1 and not public.is_admin() then
    return jsonb_build_object('visible', false);
  end if;
  v_earned := public._goal_total_cents() + round(public._ps('goal_offset_eur') * 100);
  return jsonb_build_object(
    'visible', public._ps('goal_visible') >= 1,
    'goal_cents', v_goal,
    'earned_cents', greatest(v_earned, 0),
    'percent', case when v_goal > 0 then round(greatest(v_earned, 0) * 100.0 / v_goal, 1) else 0 end);
end;
$$;

create or replace function public.admin_print_goal_reset()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._require_admin();
  update public.print_settings set value = -(public._goal_total_cents() / 100.0) where key = 'goal_offset_eur';
end;
$$;

-- Aufschlüsselung für den Admin
create or replace function public.admin_goal_breakdown()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public._require_admin();
  return jsonb_build_object(
    'print_cents', public._print_delivered_cents(),
    'plus_cents', coalesce((select sum(cents) from public.plus_sales), 0),
    'manual_cents', coalesce((select sum(cents) from public.goal_entries), 0),
    'ai_cost_cents', public._ai_cost_cents(),
    'offset_cents', round(public._ps('goal_offset_eur') * 100),
    'total_cents', public._goal_total_cents() + round(public._ps('goal_offset_eur') * 100),
    'goal_cents', round(public._ps('goal_eur') * 100),
    'entries', coalesce((select jsonb_agg(to_jsonb(e) order by e.id desc) from (select id, cents, note, created_at from public.goal_entries order by id desc limit 50) e), '[]'::jsonb));
end;
$$;

create or replace function public.admin_goal_add(p_cents integer, p_note text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._require_admin();
  if p_cents is null or p_cents = 0 or p_cents < -1000000 or p_cents > 1000000 then
    raise exception 'Der Betrag darf nicht 0 sein.' using errcode = '22023';
  end if;
  insert into public.goal_entries (cents, note) values (p_cents, left(btrim(coalesce(p_note, '')), 200));
end;
$$;

create or replace function public.admin_goal_delete(p_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._require_admin();
  delete from public.goal_entries where id = p_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- 5. Plus: Kunden-Funktionen
-- ----------------------------------------------------------------------------

create or replace function public.plus_status()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  p public.profiles;
  s public.ai_status;
begin
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  select * into p from public.profiles where id = v_me;
  select * into s from public.ai_status where id;
  perform public._plus_sync(v_me);
  return jsonb_build_object(
    'active', public._plus_active(v_me),
    'until', case when p.role = 'admin' then null else p.plus_until end,
    'is_admin', p.role = 'admin',
    'trial_available', public._pls('plus_coin_enabled') >= 1 and not p.plus_trial_used,
    'requested', exists (select 1 from public.plus_requests r where r.user_id = v_me),
    'price_cents', round(public._pls('plus_price_eur') * 100),
    'days', public._pls('plus_days'),
    'coin_price', public._pls('plus_coin_price'),
    'coin_days', public._pls('plus_coin_days'),
    'ai_enabled', public._pls('ai_enabled') >= 1,
    'ai_state', s.state,
    'ai_message', s.message,
    'max_items', public._pls('ai_max_items'),
    'test_sentences', public._pls('ai_test_sentences'));
end;
$$;

create or replace function public.plus_request()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
begin
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  insert into public.plus_requests (user_id) values (v_me) on conflict do nothing;
end;
$$;

create or replace function public.plus_cancel_request()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.plus_requests where user_id = (select auth.uid());
$$;

-- Einmalig: ein Tag Plus für Coins.
create or replace function public.plus_buy_day()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  p public.profiles;
  v_days integer := public._pls('plus_coin_days')::integer;
  v_price bigint := public._pls('plus_coin_price')::bigint;
  v_until timestamptz;
begin
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  if public._pls('plus_coin_enabled') < 1 then
    raise exception 'Das gibt es gerade nicht.' using errcode = '42501';
  end if;
  select * into p from public.profiles where id = v_me for update;
  if p.plus_trial_used then
    raise exception 'Den Tag für Coins hast du schon genutzt.' using errcode = '23505';
  end if;
  perform public._grant_koins(v_me, -v_price, 'plus_day', null);
  v_until := greatest(coalesce(p.plus_until, now()), now()) + make_interval(days => v_days);
  update public.profiles set plus_until = v_until, plus_trial_used = true where id = v_me;
  insert into public.plus_sales (user_id, kind, cents, days, note) values (v_me, 'coins', 0, v_days, format('%s Coins', v_price));
  delete from public.plus_requests where user_id = v_me;
  perform public._plus_apply_perks(v_me);
  return public.plus_status();
end;
$$;

-- ----------------------------------------------------------------------------
-- 6. Plus: Admin
-- ----------------------------------------------------------------------------

create or replace function public.admin_plus_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  s public.ai_status;
  v_month timestamptz := (date_trunc('month', timezone('Europe/Berlin', now())) at time zone 'Europe/Berlin');
begin
  perform public._require_admin();
  select * into s from public.ai_status where id;
  return jsonb_build_object(
    'requests', coalesce((select jsonb_agg(jsonb_build_object('user_id', r.user_id, 'name', p.display_name, 'created_at', r.created_at, 'plus_until', p.plus_until) order by r.created_at)
                            from public.plus_requests r join public.profiles p on p.id = r.user_id), '[]'::jsonb),
    'active', coalesce((select jsonb_agg(jsonb_build_object('user_id', p.id, 'name', p.display_name, 'until', p.plus_until) order by p.plus_until)
                          from public.profiles p where p.plus_until > now()), '[]'::jsonb),
    'sales', coalesce((select jsonb_agg(x order by (x ->> 'id')::bigint desc) from (
                select jsonb_build_object('id', l.id, 'user_id', l.user_id, 'name', coalesce(p.display_name, 'gelöscht'), 'kind', l.kind,
                       'cents', l.cents, 'days', l.days, 'note', l.note, 'created_at', l.created_at) x
                  from public.plus_sales l left join public.profiles p on p.id = l.user_id
                 order by l.id desc limit 50) q), '[]'::jsonb),
    'ai', jsonb_build_object(
      'state', s.state, 'message', s.message, 'updated_at', s.updated_at,
      'month_cost_cents', round(coalesce((select sum(cost_micro) from public.ai_usage where created_at >= v_month), 0) / 10000.0, 2),
      'month_generations', (select count(*) from public.ai_usage where created_at >= v_month and ok),
      'month_tokens', coalesce((select sum(tokens_in + tokens_out) from public.ai_usage where created_at >= v_month), 0),
      'sets', (select count(*) from public.ai_grammar_sets),
      'sentences', (select count(*) from public.ai_vocab_sentences)));
end;
$$;

create or replace function public.admin_plus_counts()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public._require_admin();
  return jsonb_build_object(
    'requests', (select count(*) from public.plus_requests),
    'ai_problem', (select state <> 'ok' from public.ai_status where id));
end;
$$;

create or replace function public.admin_plus_grant(p_user uuid, p_days integer, p_paid_cents integer, p_note text default '')
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_until timestamptz;
  v_paid integer := coalesce(p_paid_cents, 0);
begin
  perform public._require_admin();
  if p_days is null or p_days < 1 or p_days > 365 then
    raise exception 'Die Dauer muss zwischen 1 und 365 Tagen liegen.' using errcode = '22023';
  end if;
  if v_paid < 0 or v_paid > 100000 then
    raise exception 'Der Betrag ist ungültig.' using errcode = '22023';
  end if;
  update public.profiles
     set plus_until = greatest(coalesce(plus_until, now()), now()) + make_interval(days => p_days)
   where id = p_user and not blocked
   returning plus_until into v_until;
  if v_until is null then
    raise exception 'Person nicht gefunden.' using errcode = 'P0002';
  end if;
  insert into public.plus_sales (user_id, kind, cents, days, note)
  values (p_user, case when v_paid > 0 then 'paid' else 'gift' end, v_paid, p_days, left(btrim(coalesce(p_note, '')), 200));
  delete from public.plus_requests where user_id = p_user;
  perform public._plus_apply_perks(p_user);
  insert into public.user_messages (user_id, from_id, body)
  values (p_user, (select auth.uid()), format('Du hast jetzt Vokabeltrainer + bis %s. Viel Spaß!', to_char(v_until at time zone 'Europe/Berlin', 'DD.MM.YYYY')));
  return v_until;
end;
$$;

create or replace function public.admin_plus_reject(p_user uuid, p_note text default '')
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._require_admin();
  delete from public.plus_requests where user_id = p_user;
  insert into public.user_messages (user_id, from_id, body)
  values (p_user, (select auth.uid()), left('Deine Anfrage für Vokabeltrainer + wurde nicht angenommen.' || case when btrim(coalesce(p_note, '')) <> '' then ' ' || btrim(p_note) else '' end, 1000));
end;
$$;

create or replace function public.admin_plus_revoke(p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._require_admin();
  update public.profiles set plus_until = least(plus_until, now()) where id = p_user;
  perform public._plus_sync(p_user);
end;
$$;

-- Verkauf/Vergabe rückgängig (z. B. aus Versehen bestätigt): Verdienst und Laufzeit werden zurückgenommen.
create or replace function public.admin_plus_undo_sale(p_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  l public.plus_sales;
  v_new timestamptz;
begin
  perform public._require_admin();
  select * into l from public.plus_sales where id = p_id for update;
  if not found then
    raise exception 'Eintrag nicht gefunden.' using errcode = 'P0002';
  end if;
  delete from public.plus_sales where id = l.id;
  if l.user_id is not null then
    update public.profiles
       set plus_until = plus_until - make_interval(days => l.days),
           plus_trial_used = case when l.kind = 'coins' then false else plus_trial_used end
     where id = l.user_id and plus_until is not null
     returning plus_until into v_new;
    if l.kind = 'coins' then
      perform public._grant_koins(l.user_id, public._pls('plus_coin_price')::bigint, 'plus_refund', l.id::text);
    end if;
    perform public._plus_sync(l.user_id);
  end if;
end;
$$;

create or replace function public.admin_plus_get_settings()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public._require_admin();
  return coalesce((select jsonb_agg(to_jsonb(s) order by s.sort) from public.plus_settings s), '[]'::jsonb);
end;
$$;

create or replace function public.admin_plus_set_setting(p_key text, p_value numeric)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.plus_settings;
begin
  perform public._require_admin();
  select * into s from public.plus_settings where key = p_key;
  if not found then
    raise exception 'Unbekannte Einstellung.' using errcode = 'P0002';
  end if;
  if p_value is null or p_value < s.min_value or p_value > s.max_value then
    raise exception '% muss zwischen % und % liegen.', s.label, s.min_value, s.max_value using errcode = '22023';
  end if;
  update public.plus_settings set value = p_value where key = p_key;
end;
$$;

-- ----------------------------------------------------------------------------
-- 7. Shop: Plus-Designs (kostenlos mit Plus, sonst gesperrt)
-- ----------------------------------------------------------------------------

drop function if exists public.get_shop();
create function public.get_shop()
returns table (id text, kind text, name text, price integer, sort integer, owned boolean, equipped boolean,
               required_role text, active boolean, custom boolean, style jsonb, svg text, plus_only boolean)
language sql
stable
security definer
set search_path = public
as $$
  select i.id, i.kind, i.name, i.price, i.sort,
         ((i.price = 0 and (not i.plus_only or public._plus_active((select auth.uid())))) or o.item_id is not null),
         exists (select 1 from public.profiles p
                  where p.id = (select auth.uid())
                    and i.id in (p.avatar_id, p.color_id, p.effect_id, p.theme_id, p.tag_id)),
         i.required_role, i.active, i.custom, i.style, i.svg, i.plus_only
    from public.shop_items i
    left join public.user_items o on o.item_id = i.id and o.user_id = (select auth.uid())
   where (select auth.uid()) is not null
     and (i.active or o.item_id is not null)
     and (i.required_role is null
          or public._role_rank(i.required_role) <= public._role_rank(
               (select p.role from public.profiles p where p.id = (select auth.uid()))))
   order by i.kind, i.sort, i.name;
$$;

-- (buy_item bleibt unverändert: Plus-Artikel kosten 0 und gelten als „gehört dir schon“; die App zeigt dafür den Plus-Hinweis.)

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
  v_active boolean;
  v_plus boolean;
  v_owned boolean;
begin
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  select kind, price, required_role, active, plus_only into v_kind, v_price, v_req, v_active, v_plus
    from public.shop_items where id = p_item_id;
  v_owned := exists (select 1 from public.user_items where user_id = v_me and item_id = p_item_id);
  if v_kind is null or not (v_active or v_owned) then
    raise exception 'Artikel nicht gefunden.' using errcode = 'P0002';
  end if;
  if v_plus and not public._plus_active(v_me) then
    raise exception 'Das gibt es nur mit Vokabeltrainer +.' using errcode = '42501';
  end if;
  if v_req is not null
     and public._role_rank(v_req) > public._role_rank((select role from public.profiles where id = v_me)) then
    raise exception 'Diesen Artikel gibt es nur für %.',
      case v_req when 'admin' then 'Admins' else 'Mods und Admins' end using errcode = '42501';
  end if;
  if v_price > 0 and not v_owned then
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

insert into public.shop_items (id, kind, name, price, sort, plus_only) values
  ('tag_plus',            'tag',    '+',                  0, 5,  true),
  ('color_plus_nordlicht','color',  'Plus Nordlicht',     0, 900, true),
  ('color_plus_rosegold', 'color',  'Plus Roségold',      0, 910, true),
  ('color_plus_eis',      'color',  'Plus Eis',           0, 920, true),
  ('effect_plus_glanz',   'effect', 'Plus Glanz',         0, 900, true),
  ('theme_plus_mitternacht','theme','Plus Mitternacht',   0, 900, true),
  ('theme_plus_glut',     'theme',  'Plus Glut',          0, 910, true),
  ('avatar_plus_stern',   'avatar', 'Plus-Stern',         0, 900, true),
  ('avatar_plus_kristall','avatar', 'Plus-Kristall',      0, 910, true)
on conflict (id) do update set name = excluded.name, plus_only = true, kind = excluded.kind;

-- ----------------------------------------------------------------------------
-- 8. KI: nur über die Edge Function (service_role)
-- ----------------------------------------------------------------------------

-- Darf diese Person jetzt etwas erzeugen? (prüft Plus, Schalter, Tages- und Monatsgrenzen)
create or replace function public.ai_begin(p_user uuid, p_kind text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_month timestamptz := (date_trunc('month', timezone('Europe/Berlin', now())) at time zone 'Europe/Berlin');
  v_day timestamptz := (date_trunc('day', timezone('Europe/Berlin', now())) at time zone 'Europe/Berlin');
  v_admin boolean := coalesce((select role = 'admin' from public.profiles where id = p_user), false);
begin
  if p_kind not in ('grammar', 'sentences') then
    raise exception 'Ungültige Art.' using errcode = '22023';
  end if;
  if not public._plus_active(p_user) then
    return jsonb_build_object('ok', false, 'code', 'no_plus');
  end if;
  if public._pls('ai_enabled') < 1 then
    return jsonb_build_object('ok', false, 'code', 'disabled');
  end if;
  if (select coalesce(sum(cost_micro), 0) from public.ai_usage where created_at >= v_month) >= public._pls('ai_global_month_eur') * 1000000 then
    return jsonb_build_object('ok', false, 'code', 'global_budget');
  end if;
  if not v_admin then
    if (select count(*) from public.ai_usage where user_id = p_user and ok and created_at >= v_day) >= public._pls('ai_user_day_gens') then
      return jsonb_build_object('ok', false, 'code', 'user_day');
    end if;
    if (select coalesce(sum(cost_micro), 0) from public.ai_usage where user_id = p_user and created_at >= v_month) >= public._pls('ai_user_month_eur') * 1000000 then
      return jsonb_build_object('ok', false, 'code', 'user_budget');
    end if;
  end if;
  return jsonb_build_object('ok', true, 'max_items', public._pls('ai_max_items'), 'max_sentences', public._pls('ai_test_sentences'));
end;
$$;

create or replace function public.ai_set_status(p_state text, p_message text default '')
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_state not in ('no_key', 'ok', 'empty', 'error') then
    raise exception 'Ungültiger Status.' using errcode = '22023';
  end if;
  update public.ai_status set state = p_state, message = left(coalesce(p_message, ''), 300), updated_at = now() where id;
end;
$$;

-- Verbrauch buchen; Kosten in Millionstel Euro aus Tokens und den Modellpreisen
create or replace function public.ai_record_usage(p_user uuid, p_kind text, p_in integer, p_out integer, p_ok boolean)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_in integer := greatest(coalesce(p_in, 0), 0);
  v_out integer := greatest(coalesce(p_out, 0), 0);
  v_micro bigint;
begin
  v_micro := round((v_in * public._pls('ai_usd_in') + v_out * public._pls('ai_usd_out')) * public._pls('ai_usd_eur'))::bigint;
  insert into public.ai_usage (user_id, kind, tokens_in, tokens_out, cost_micro, ok)
  values (p_user, p_kind, v_in, v_out, v_micro, coalesce(p_ok, true));
  return v_micro;
end;
$$;

create or replace function public.ai_save_grammar_set(p_user uuid, p_language text, p_grade integer, p_topic_key text, p_topic text, p_level text, p_title text, p_items jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  insert into public.ai_grammar_sets (language, grade, topic_key, topic, level, title, items, created_by)
  values (p_language, p_grade, p_topic_key, left(p_topic, 80), p_level, left(p_title, 120), p_items, p_user)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.ai_get_vocab_sentences(p_keys text[])
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_object_agg(key, item), '{}'::jsonb) from public.ai_vocab_sentences where key = any (p_keys);
$$;

create or replace function public.ai_save_vocab_sentences(p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  r jsonb;
  n integer := 0;
begin
  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    insert into public.ai_vocab_sentences (key, language, level, item)
    values (left(r ->> 'key', 300), r ->> 'language', r ->> 'level', r -> 'item')
    on conflict (key) do nothing;
    n := n + 1;
  end loop;
  return n;
end;
$$;

create or replace function public.ai_touch_vocab_sentences(p_keys text[])
returns void
language sql
security definer
set search_path = public
as $$
  update public.ai_vocab_sentences set uses = uses + 1 where key = any (p_keys);
$$;

-- ----------------------------------------------------------------------------
-- 9. KI: Blätter ansehen (nur mit Plus) und eigene Ergebnisse
-- ----------------------------------------------------------------------------

create or replace function public.ai_list_sets(p_language text, p_grade integer, p_topic_key text default null, p_level text default null)
returns table (id uuid, title text, topic text, topic_key text, level text, grade integer, items integer, uses integer, created_at timestamptz, mine boolean)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if (select auth.uid()) is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  if not public._plus_active((select auth.uid())) then
    raise exception 'Dafür brauchst du Vokabeltrainer +.' using errcode = '42501';
  end if;
  return query
  select s.id, s.title, s.topic, s.topic_key, s.level, s.grade, jsonb_array_length(s.items), s.uses, s.created_at, s.created_by = (select auth.uid())
    from public.ai_grammar_sets s
   where s.language = p_language and s.grade = p_grade
     and (p_topic_key is null or s.topic_key = p_topic_key)
     and (p_level is null or s.level = p_level)
   order by s.created_at desc
   limit 60;
end;
$$;

create or replace function public.ai_get_set(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.ai_grammar_sets;
begin
  if (select auth.uid()) is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  if not public._plus_active((select auth.uid())) then
    raise exception 'Dafür brauchst du Vokabeltrainer +.' using errcode = '42501';
  end if;
  update public.ai_grammar_sets set uses = uses + 1 where id = p_id returning * into s;
  if not found then
    raise exception 'Blatt nicht gefunden.' using errcode = 'P0002';
  end if;
  return jsonb_build_object('id', s.id, 'title', s.title, 'topic', s.topic, 'topic_key', s.topic_key, 'level', s.level,
                            'grade', s.grade, 'language', s.language, 'items', s.items, 'created_at', s.created_at);
end;
$$;

create or replace function public.ai_save_result(p_kind text, p_title text, p_ref uuid, p_language text, p_level text, p_score integer, p_total integer, p_payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  v_id uuid;
begin
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  if p_kind not in ('grammar', 'test') then
    raise exception 'Ungültige Art.' using errcode = '22023';
  end if;
  if p_kind = 'grammar' and not public._plus_active(v_me) then
    raise exception 'Dafür brauchst du Vokabeltrainer +.' using errcode = '42501';
  end if;
  if p_total is null or p_total < 1 or p_score is null or p_score < 0 or p_score > p_total then
    raise exception 'Ungültiges Ergebnis.' using errcode = '22023';
  end if;
  if p_payload is null or pg_column_size(p_payload) > 200000 then
    raise exception 'Das Ergebnis ist zu groß.' using errcode = '22023';
  end if;
  insert into public.ai_results (user_id, kind, title, ref, language, level, score, total, payload)
  values (v_me, p_kind, left(btrim(coalesce(p_title, '')), 160), p_ref, left(coalesce(p_language, ''), 10), left(coalesce(p_level, ''), 20), p_score, p_total, p_payload)
  returning id into v_id;
  -- höchstens 100 gespeicherte Ergebnisse je Art
  delete from public.ai_results
   where user_id = v_me and kind = p_kind
     and id in (select r.id from public.ai_results r where r.user_id = v_me and r.kind = p_kind order by r.created_at desc offset 100);
  return v_id;
end;
$$;

create or replace function public.ai_my_results(p_kind text)
returns table (id uuid, kind text, title text, language text, level text, score integer, total integer, created_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select r.id, r.kind, r.title, r.language, r.level, r.score, r.total, r.created_at
    from public.ai_results r
   where r.user_id = (select auth.uid()) and r.kind = p_kind
   order by r.created_at desc
   limit 100;
$$;

create or replace function public.ai_get_result(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  r public.ai_results;
begin
  select * into r from public.ai_results where id = p_id and user_id = (select auth.uid());
  if not found then
    raise exception 'Ergebnis nicht gefunden.' using errcode = 'P0002';
  end if;
  return jsonb_build_object('id', r.id, 'kind', r.kind, 'title', r.title, 'ref', r.ref, 'language', r.language, 'level', r.level,
                            'score', r.score, 'total', r.total, 'payload', r.payload, 'created_at', r.created_at);
end;
$$;

create or replace function public.ai_delete_result(p_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.ai_results where id = p_id and user_id = (select auth.uid());
$$;

-- ----------------------------------------------------------------------------
-- 10. Rechte
-- ----------------------------------------------------------------------------

do $$
declare
  r record;
  has_service boolean := exists (select 1 from pg_roles where rolname = 'service_role');
begin
  for r in
    select p.oid::regprocedure as sig, p.proname
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in (
         'plus_status', 'plus_request', 'plus_cancel_request', 'plus_buy_day', 'heartbeat',
         'admin_plus_overview', 'admin_plus_counts', 'admin_plus_grant', 'admin_plus_reject', 'admin_plus_revoke',
         'admin_plus_undo_sale', 'admin_plus_get_settings', 'admin_plus_set_setting',
         'admin_goal_breakdown', 'admin_goal_add', 'admin_goal_delete', 'print_get_goal', 'admin_print_goal_reset',
         'get_shop', 'equip_item',
         'ai_list_sets', 'ai_get_set', 'ai_save_result', 'ai_my_results', 'ai_get_result', 'ai_delete_result')
  loop
    execute format('revoke all on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;

  -- nur die Edge Function
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('ai_begin', 'ai_set_status', 'ai_record_usage', 'ai_save_grammar_set',
                         'ai_get_vocab_sentences', 'ai_save_vocab_sentences', 'ai_touch_vocab_sentences')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    if has_service then
      execute format('grant execute on function %s to service_role', r.sig);
    end if;
  end loop;

  -- interne Helfer: niemand direkt
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('_pls', '_plus_active', '_plus_sync', '_plus_apply_perks', '_ai_cost_cents', '_goal_total_cents')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
  end loop;
end;
$$;
