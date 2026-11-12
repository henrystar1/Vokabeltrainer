
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
