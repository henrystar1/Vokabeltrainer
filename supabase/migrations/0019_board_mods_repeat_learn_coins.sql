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
