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
