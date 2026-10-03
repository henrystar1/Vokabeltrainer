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
