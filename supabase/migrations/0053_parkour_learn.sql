-- 0053: Lernen im Parkour. Wiederholbar.
--  * Speedups (Rakete, 3er-Sprung) und der Wechsel in das nächste Level verlangen eine bzw. zwei Vokabeln.
--  * Admins können die Lernfragen für sich oder für bestimmte Personen ausschalten (zum Testen): Tabelle parkour_learn_off.
--  * Weniger Coins für den Parkour (nur nach unten, falls ein Admin die Werte schon niedriger gesetzt hat).
create table if not exists public.parkour_learn_off (
  user_id uuid primary key references auth.users (id) on delete cascade,
  set_by uuid,
  created_at timestamptz not null default now()
);
alter table public.parkour_learn_off enable row level security;
revoke all on public.parkour_learn_off from anon, authenticated;

-- Welche der Personen haben die Lernfragen aus? (Nur Zahl und Ja/Nein, jede angemeldete Person darf fragen.)
create or replace function public.parkour_learn_off_list(p_ids uuid[])
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(o.user_id), '{}'::uuid[])
    from public.parkour_learn_off o
   where o.user_id = any (coalesce(p_ids, '{}'::uuid[]))
     and (select auth.uid()) is not null;
$$;

-- Admin: Lernfragen für eine Person aus- oder einschalten.
create or replace function public.parkour_learn_set(p_user uuid, p_off boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if (select auth.uid()) is null or not public.is_admin() then
    raise exception 'Nur Admins dürfen das.' using errcode = '42501';
  end if;
  if coalesce(p_off, false) then
    insert into public.parkour_learn_off (user_id, set_by) values (p_user, (select auth.uid()))
    on conflict (user_id) do nothing;
  else
    delete from public.parkour_learn_off where user_id = p_user;
  end if;
end;
$$;

-- Weniger Coins (alte Standardwerte: 8 je Level, 2 je Checkpoint, 30 Bonus, 5 je Endlos-Level)
update public.app_settings set value = least(value, 5) where key = 'parkour_coins_level';
update public.app_settings set value = least(value, 1) where key = 'parkour_coins_cp';
update public.app_settings set value = least(value, 20) where key = 'parkour_coins_bonus';
update public.app_settings set value = least(value, 3) where key = 'parkour_coins_endless';

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('parkour_learn_off_list', 'parkour_learn_set')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;
end;
$$;
