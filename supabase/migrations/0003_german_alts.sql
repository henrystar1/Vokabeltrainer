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
