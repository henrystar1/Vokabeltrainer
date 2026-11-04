-- 0061: Neue Konten müssen von einem Admin freigeschaltet werden. Wiederholbar.
--  * profiles.approved: bestehende Konten bleiben freigeschaltet (Standard true); neue Selbst-Registrierungen starten gesperrt,
--    solange die Einstellung signup_approval = 1 ist (Verwaltung → Regeln, Standard 1). Von Admins angelegte Konten sind sofort frei.
--  * Wer nicht freigeschaltet ist, gilt serverseitig wie gesperrt (is_blocked) und sieht in der App einen Warte-Bildschirm.
--  * Die Bestätigungs-E-Mail schaltest du im Supabase-Dashboard aus (Authentication → Sign In / Providers → Email → „Confirm email“ aus).
alter table public.profiles add column if not exists approved boolean not null default true;

insert into public.app_settings (key, value, mod_editable) values ('signup_approval', 1, false)
on conflict (key) do nothing;

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

  insert into public.profiles (id, display_name, approved) values (new.id, final_name, public.setting('signup_approval') = 0);
  insert into public.user_settings (user_id) values (new.id);
  return new;
end;
$$;

-- Admin-Konten (admin_create_user) sind sofort freigeschaltet.
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

  update public.profiles set approved = true where id = v_id;
  select display_name into v_final from public.profiles where id = v_id;
  return jsonb_build_object('user_id', v_id, 'email', v_email, 'display_name', v_final);
end;
$$;

create or replace function public.is_blocked()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select p.blocked or not p.approved from public.profiles p where p.id = (select auth.uid())), false);
$$;

create or replace function public.protect_profile_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (select auth.uid()) is not null
     and (new.role is distinct from old.role or new.blocked is distinct from old.blocked or new.approved is distinct from old.approved)
     and not public.is_admin() then
    raise exception 'Keine Berechtigung.' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- Freischalten (oder wieder auf „wartet“ setzen).
create or replace function public.admin_set_approved(p_user uuid, p_approved boolean)
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
  if p_user = (select auth.uid()) and not coalesce(p_approved, false) then
    raise exception 'Du kannst dich nicht selbst auf „wartet“ setzen.' using errcode = '42501';
  end if;
  update public.profiles set approved = coalesce(p_approved, false) where id = p_user;
end;
$$;

-- Wie viele warten? (für das Zeichen am Menüpunkt Verwaltung)
create or replace function public.admin_pending_count()
returns integer
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public._require_admin();
  return (select count(*)::integer from public.profiles where not approved and not blocked);
end;
$$;

drop function if exists public.admin_list_users();
create function public.admin_list_users()
returns table (
  user_id uuid, display_name text, email text, role text, blocked boolean,
  created_at timestamptz, last_sign_in_at timestamptz,
  book_count integer, public_book_count integer, vocab_count integer,
  progress_count integer, session_count integer, answer_count integer, approx_bytes bigint,
  koins integer, approved boolean
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
    coalesce((select w.balance from public.koin_wallets w where w.user_id = p.id), 0),
    p.approved
  from public.profiles p
  join auth.users u on u.id = p.id
  order by p.created_at;
end;
$$;

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('admin_set_approved', 'admin_pending_count', 'admin_list_users')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;
end;
$$;
