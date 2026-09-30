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
