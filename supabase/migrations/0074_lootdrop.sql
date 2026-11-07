-- 0074: Loot Drop (neuer Menüpunkt). Jeden Tag ein Paket für alle (nur die schnellste Person bekommt es, etwas besser)
-- und ein persönliches Paket für jede Person. Inhalt: Coins, Punkte oder Verkleidungen/Designs.
-- Dazu: Adventskalender zurücksetzen (Admin) und Coins an zufällige Personen verschenken (Admin). Wiederholbar.

-- Sperr-Schlüssel um 'loot' erweitern
create or replace function public._lock_keys()
returns text[]
language sql
immutable
set search_path = public
as $$
  select array['games', 'gambling', 'sprint', 'duels', 'chat', 'shop', 'quests', 'print',
               'parkour', 'learn', 'copy', 'cards', 'cram', 'test', 'practice', 'grammar', 'irregular', 'conjugate', 'gender',
               'books', 'search', 'math', 'memorize', 'homework', 'advent', 'ranking', 'stats', 'presence', 'websites', 'plus',
               'board', 'feedback', 'loot'];
$$;
alter table public.feature_locks drop constraint if exists feature_locks_key_check;
alter table public.feature_locks add constraint feature_locks_key_check check (key = any (public._lock_keys()));

-- Einstellungen (Verwaltung → Zahlen → Loot Drop)
insert into public.app_settings (key, value, mod_editable) values
  ('loot_p_w_coins', 55, false), ('loot_p_w_points', 30, false), ('loot_p_w_item', 15, false),
  ('loot_p_coins_min', 20, false), ('loot_p_coins_spread', 60, false),
  ('loot_p_points_min', 5, false), ('loot_p_points_spread', 10, false), ('loot_p_item_price', 300, false),
  ('loot_g_w_coins', 40, false), ('loot_g_w_points', 30, false), ('loot_g_w_item', 30, false),
  ('loot_g_coins_min', 150, false), ('loot_g_coins_spread', 250, false),
  ('loot_g_points_min', 20, false), ('loot_g_points_spread', 30, false), ('loot_g_item_price', 1500, false)
on conflict (key) do nothing;

create table if not exists public.loot_global (
  day date primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  rewards jsonb not null default '[]'::jsonb,
  opened_at timestamptz not null default now()
);
create table if not exists public.loot_personal (
  user_id uuid not null references auth.users (id) on delete cascade,
  day date not null,
  rewards jsonb not null default '[]'::jsonb,
  opened_at timestamptz not null default now(),
  primary key (user_id, day)
);
create table if not exists public.loot_gifts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  amount bigint not null,
  seen boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.loot_global enable row level security;
alter table public.loot_personal enable row level security;
alter table public.loot_gifts enable row level security;
revoke all on public.loot_global, public.loot_personal, public.loot_gifts from anon, authenticated;

create or replace function public._loot_today()
returns date
language sql
stable
set search_path = public
as $$ select (now() at time zone 'Europe/Berlin')::date; $$;

-- Würfelt den Inhalt eines Pakets und schreibt ihn gut. p_kind: 'p' (persönlich) oder 'g' (für alle). Pro: Beträge/Artikelwert × pro_advent_mult.
create or replace function public._loot_roll(p_user uuid, p_kind text, p_ref text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_wc integer := public.setting('loot_' || p_kind || '_w_coins');
  v_wp integer := public.setting('loot_' || p_kind || '_w_points');
  v_wi integer := public.setting('loot_' || p_kind || '_w_item');
  v_mult numeric := case when public._pro_active(p_user) then greatest(public._pls('pro_advent_mult'), 1) else 1 end;
  v_roll numeric;
  v_amount bigint;
  v_item record;
  v_out jsonb;
begin
  if v_wc + v_wp + v_wi <= 0 then
    return '[]'::jsonb;
  end if;
  v_roll := random() * (v_wc + v_wp + v_wi);
  if v_roll < v_wc then
    v_amount := round((public.setting('loot_' || p_kind || '_coins_min')
      + floor(random() * (public.setting('loot_' || p_kind || '_coins_spread') + 1))) * v_mult)::bigint;
    perform public._grant_koins(p_user, v_amount, 'loot', p_ref);
    return jsonb_build_array(jsonb_build_object('type', 'coins', 'amount', v_amount));
  elsif v_roll < v_wc + v_wp then
    v_amount := round((public.setting('loot_' || p_kind || '_points_min')
      + floor(random() * (public.setting('loot_' || p_kind || '_points_spread') + 1))) * v_mult)::bigint;
    insert into public.points_adjustments (user_id, points, reason, created_by)
    values (p_user, v_amount::integer, 'Loot Drop', null);
    return jsonb_build_array(jsonb_build_object('type', 'points', 'amount', v_amount));
  end if;
  select i.id, i.kind, i.name, i.price into v_item
    from public.shop_items i
   where i.kind in ('avatar', 'color', 'effect', 'theme')
     and i.price > 0 and i.price <= public.setting('loot_' || p_kind || '_item_price') * v_mult
     and not exists (select 1 from public.user_items u where u.user_id = p_user and u.item_id = i.id)
   order by random() limit 1;
  if not found then
    v_amount := round((public.setting('loot_' || p_kind || '_coins_min') + public.setting('loot_' || p_kind || '_coins_spread') / 2) * v_mult)::bigint;
    perform public._grant_koins(p_user, v_amount, 'loot', p_ref);
    return jsonb_build_array(jsonb_build_object('type', 'coins', 'amount', v_amount));
  end if;
  insert into public.user_items (user_id, item_id) values (p_user, v_item.id);
  v_out := jsonb_build_array(jsonb_build_object('type', 'item', 'id', v_item.id, 'kind', v_item.kind, 'name', v_item.name, 'price', v_item.price));
  return v_out;
end;
$$;

create or replace function public.loot_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  v_day date := public._loot_today();
  v_g public.loot_global;
  v_p public.loot_personal;
begin
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht erlaubt.' using errcode = '42501';
  end if;
  select * into v_g from public.loot_global where day = v_day;
  select * into v_p from public.loot_personal where user_id = v_me and day = v_day;
  return jsonb_build_object(
    'day', v_day,
    'personal', jsonb_build_object('opened', v_p.user_id is not null, 'rewards', coalesce(v_p.rewards, '[]'::jsonb)),
    'global', jsonb_build_object(
      'opened', v_g.user_id is not null,
      'mine', v_g.user_id = v_me,
      'by', (select p.display_name from public.profiles p where p.id = v_g.user_id),
      'rewards', case when v_g.user_id = v_me then v_g.rewards else '[]'::jsonb end),
    'gifts', coalesce((select jsonb_agg(jsonb_build_object('id', g.id, 'amount', g.amount) order by g.created_at)
                         from public.loot_gifts g where g.user_id = v_me and not g.seen), '[]'::jsonb));
end;
$$;

create or replace function public.loot_open(p_kind text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  v_day date := public._loot_today();
  v_rows integer;
  v_by text;
  v_out jsonb;
begin
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht erlaubt.' using errcode = '42501';
  end if;
  if p_kind = 'global' then
    insert into public.loot_global (day, user_id) values (v_day, v_me) on conflict (day) do nothing;
    get diagnostics v_rows = row_count;
    if v_rows = 0 then
      select p.display_name into v_by from public.loot_global g join public.profiles p on p.id = g.user_id where g.day = v_day;
      raise exception 'Zu langsam! % hat das Paket heute schon geöffnet.', coalesce(v_by, 'Jemand') using errcode = '23505';
    end if;
    v_out := public._loot_roll(v_me, 'g', 'global');
    update public.loot_global set rewards = v_out where day = v_day;
  elsif p_kind = 'personal' then
    insert into public.loot_personal (user_id, day) values (v_me, v_day) on conflict do nothing;
    get diagnostics v_rows = row_count;
    if v_rows = 0 then
      raise exception 'Dein Paket für heute hast du schon geöffnet.' using errcode = '23505';
    end if;
    v_out := public._loot_roll(v_me, 'p', 'personal');
    update public.loot_personal set rewards = v_out where user_id = v_me and day = v_day;
  else
    raise exception 'Unbekanntes Paket.' using errcode = '22023';
  end if;
  return jsonb_build_object('kind', p_kind, 'rewards', v_out);
end;
$$;

create or replace function public.loot_gifts_seen()
returns void
language sql
security definer
set search_path = public
as $$
  update public.loot_gifts set seen = true where user_id = (select auth.uid()) and not seen;
$$;

-- Admin: Coins an zufällige Personen verschenken (ohne dich selbst, ohne gesperrte Konten)
create or replace function public.admin_loot_gift(p_count integer, p_amount bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  r record;
  v_names jsonb := '[]'::jsonb;
begin
  perform public._require_admin();
  if p_count is null or p_count < 1 or p_count > 100 then
    raise exception 'Anzahl: 1 bis 100.' using errcode = '22023';
  end if;
  if p_amount is null or p_amount < 1 or p_amount > 1000000 then
    raise exception 'Betrag: 1 bis 1.000.000 Coins.' using errcode = '22023';
  end if;
  for r in
    select p.id, p.display_name from public.profiles p
     where p.id <> v_me and not p.blocked
     order by random() limit p_count
  loop
    perform public._grant_koins(r.id, p_amount, 'admin', 'loot_gift');
    insert into public.loot_gifts (user_id, amount) values (r.id, p_amount);
    v_names := v_names || to_jsonb(r.display_name);
  end loop;
  return v_names;
end;
$$;

-- Admin: Adventskalender zurücksetzen (alle Türchen dieses Jahres wieder zu). Schon erhaltene Belohnungen bleiben.
create or replace function public.admin_advent_reset(p_all boolean)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n integer;
begin
  perform public._require_admin();
  delete from public.advent_opened where year = public._advent_year() and (p_all or user_id = (select auth.uid()));
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- Admin: Loot Drop von heute zurücksetzen (zum Testen)
create or replace function public.admin_loot_reset(p_all boolean)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n integer;
  v_m integer;
begin
  perform public._require_admin();
  delete from public.loot_personal where day = public._loot_today() and (p_all or user_id = (select auth.uid()));
  get diagnostics v_n = row_count;
  delete from public.loot_global where day = public._loot_today();
  get diagnostics v_m = row_count;
  return v_n + v_m;
end;
$$;

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('_lock_keys', '_loot_today', '_loot_roll', 'loot_status', 'loot_open', 'loot_gifts_seen',
                                                  'admin_loot_gift', 'admin_advent_reset', 'admin_loot_reset')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    if r.proname in ('loot_status', 'loot_open', 'loot_gifts_seen', 'admin_loot_gift', 'admin_advent_reset', 'admin_loot_reset') then
      execute format('grant execute on function %s to authenticated', r.sig);
    end if;
  end loop;
end;
$$;
