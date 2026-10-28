-- 0057: Neuer Auftritt im Parkour: Gitarre. Wiederholbar.
--  * Admins dürfen 'guitar' wählen, Mods nur, wenn der Admin ihn freigibt (staff_rights.looks).
--  * Die Prüfung von parkour_profiles.entrance und die Freigabe-Funktion kennen jetzt 'guitar'.

alter table public.parkour_profiles drop constraint if exists parkour_profiles_entrance_check;
alter table public.parkour_profiles add constraint parkour_profiles_entrance_check
  check (entrance is null or entrance in ('blackhole', 'hammer', 'piano', 'guitar', 'none'));

create or replace function public._allowed_looks(p_user uuid)
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select case
      when p.blocked then '{}'::text[]
      when p.role = 'admin' then array['blackhole', 'hammer', 'piano', 'guitar']
      when p.role in ('mod', 'alphamod') then coalesce((select array_agg(x order by x) from unnest(coalesce(r.looks, '{}'::text[])) x where x in ('hammer', 'piano', 'guitar')), '{}'::text[])
      else '{}'::text[] end
      from public.profiles p left join public.staff_rights r on r.user_id = p.id
     where p.id = p_user), '{}'::text[]);
$$;

drop function if exists public.admin_set_staff_rights(uuid, text, text, boolean, integer, boolean, text[]);
create or replace function public.admin_set_staff_rights(p_user uuid, p_books_mode text, p_set_mode text, p_shop boolean, p_timeout integer, p_spectate boolean default false, p_looks text[] default '{}')
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_looks text[] := coalesce((select array_agg(distinct x order by x) from unnest(coalesce(p_looks, '{}'::text[])) x where x in ('hammer', 'piano', 'guitar')), '{}'::text[]);
begin
  perform public._require_admin();
  if not exists (select 1 from public.profiles where id = p_user and role in ('mod', 'alphamod')) then
    raise exception 'Nur für Mods und Alphamods.' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(coalesce(p_looks, '{}'::text[])) x where x not in ('hammer', 'piano', 'guitar')) then
    raise exception 'Unbekannter Auftritt.' using errcode = '22023';
  end if;
  insert into public.staff_rights (user_id, books_mode, set_mode, shop, timeout_max, spectate, looks)
  values (p_user, p_books_mode, p_set_mode, p_shop, p_timeout, coalesce(p_spectate, false), v_looks)
  on conflict (user_id) do update
    set books_mode = excluded.books_mode, set_mode = excluded.set_mode, shop = excluded.shop, timeout_max = excluded.timeout_max,
        spectate = excluded.spectate, looks = excluded.looks;
end;
$$;

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig, p.proname
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('_allowed_looks', 'admin_set_staff_rights')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    if r.proname not like '\_%' then
      execute format('grant execute on function %s to authenticated', r.sig);
    end if;
  end loop;
end;
$$;
