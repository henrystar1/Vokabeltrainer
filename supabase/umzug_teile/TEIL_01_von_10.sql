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
