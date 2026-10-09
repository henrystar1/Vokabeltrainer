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
