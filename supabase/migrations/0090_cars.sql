-- 0090: Autohaus. Autos mit Bild gegen Coins kaufen, Garage, Preise in der Verwaltung. Wiederholbar.

create table if not exists public.cars (
  id text primary key check (id ~ '^[a-z0-9_]{2,30}$'),
  name text not null,
  kind text not null,
  color text not null default '#ef4444',
  price bigint not null check (price >= 0),
  sort integer not null default 0,
  active boolean not null default true
);
alter table public.cars enable row level security;
create table if not exists public.car_owned (
  user_id uuid not null references auth.users(id) on delete cascade,
  car_id text not null references public.cars(id) on delete cascade,
  bought_at timestamptz not null default now(),
  paid bigint not null default 0,
  primary key (user_id, car_id)
);
alter table public.car_owned enable row level security;

insert into public.cars (id, name, kind, color, price, sort) values
  ('flitzer',   'Flitzer',        'kleinwagen', '#f59e0b',    500, 1),
  ('stadtfloh', 'Stadtfloh',      'kleinwagen', '#22c55e',    800, 2),
  ('kombi',     'Familienkombi',  'kombi',      '#3b82f6',   2000, 3),
  ('limousine', 'Limousine',      'limousine',  '#1e293b',   5000, 4),
  ('gelaende',  'Geländekönig',   'suv',        '#a16207',   8000, 5),
  ('pickup',    'Packesel',       'pickup',     '#dc2626',  10000, 6),
  ('cabrio',    'Sonnenschein',   'cabrio',     '#ec4899',  20000, 7),
  ('sportler',  'Blitz GT',       'sportwagen', '#ef4444',  50000, 8),
  ('bus',       'Partybus',       'bus',        '#a855f7', 100000, 9)
on conflict (id) do nothing;

create or replace function public._lock_keys()
returns text[]
language sql
immutable
set search_path = public
as $$
  select array['games', 'gambling', 'sprint', 'duels', 'chat', 'shop', 'quests', 'print',
               'parkour', 'learn', 'copy', 'cards', 'cram', 'test', 'practice', 'grammar', 'irregular', 'conjugate', 'gender',
               'books', 'search', 'math', 'memorize', 'homework', 'advent', 'ranking', 'stats', 'presence', 'websites', 'plus',
               'board', 'feedback', 'loot', 'online', 'stocks', 'cars'];
$$;
alter table public.feature_locks drop constraint if exists feature_locks_key_check;
alter table public.feature_locks add constraint feature_locks_key_check check (key = any (public._lock_keys()));

drop function if exists public.car_list();
create or replace function public.car_list()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_me uuid := public._og_check();
begin
  perform public._feature_guard('cars');
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'kind', c.kind, 'color', c.color, 'price', c.price, 'active', c.active, 'owned', o.user_id is not null) order by c.sort)
    from public.cars c left join public.car_owned o on o.car_id = c.id and o.user_id = v_me
    where c.active or o.user_id is not null), '[]'::jsonb);
end;
$$;

drop function if exists public.car_buy(text);
create or replace function public.car_buy(p_id text)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_me uuid := public._og_check(); c public.cars; v_bal bigint;
begin
  perform public._feature_guard('cars');
  select * into c from public.cars where id = p_id and active;
  if c.id is null then raise exception 'Dieses Auto gibt es nicht.' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtext('car:' || v_me::text));
  if exists (select 1 from public.car_owned where user_id = v_me and car_id = c.id) then raise exception 'Das Auto steht schon in deiner Garage.' using errcode = '23505'; end if;
  v_bal := public._grant_koins(v_me, -c.price, 'shop', 'car:' || c.id);
  insert into public.car_owned (user_id, car_id, paid) values (v_me, c.id, c.price);
  return v_bal;
end;
$$;

drop function if exists public.admin_car_set(text, bigint, boolean);
create or replace function public.admin_car_set(p_id text, p_price bigint, p_active boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public._require_admin();
  if p_price is null or p_price < 0 or p_price > 1000000000 then raise exception 'Ungültiger Preis.' using errcode = '22023'; end if;
  update public.cars set price = p_price, active = coalesce(p_active, active) where id = p_id;
end;
$$;

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and (p.proname in ('car_list', 'car_buy', 'admin_car_set', '_lock_keys'))
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    if left(r.proname, 1) <> '_' then
      execute format('grant execute on function %s to authenticated', r.sig);
    end if;
  end loop;
end;
$$;
