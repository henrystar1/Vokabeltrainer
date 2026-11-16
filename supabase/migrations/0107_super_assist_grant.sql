-- 0107: Fahrassistent kann der Admin auch anderen mit Supercar-Zugang geben. Wiederholbar. Nach 0106 ausführen.
alter table public.race_super_access add column if not exists assist boolean not null default false;

create or replace function public._race_assist(p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select (p.role = 'admin' or (p.role in ('mod', 'alphamod') and exists (select 1 from public.race_super_access a where a.user_id = p.id and a.assist))) and not p.blocked
                     from public.profiles p where p.id = p_user), false)
$$;

create or replace function public.admin_super_assist(p_user uuid, p_on boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public._require_admin();
  if not exists (select 1 from public.race_super_access where user_id = p_user) then raise exception 'Erst das Supercar freigeben.' using errcode = '22023'; end if;
  update public.race_super_access set assist = coalesce(p_on, false) where user_id = p_user;
end;
$$;

drop function if exists public.admin_super_list();
create or replace function public.admin_super_list()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public._require_admin();
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', p.id, 'name', coalesce(p.display_name, '?'), 'role', p.role, 'granted', p.role = 'admin' or a.user_id is not null,
                                        'kmh', public._race_super_kmh(p.id), 'custom', a.kmh is not null,
                                        'assist', p.role = 'admin' or coalesce(a.assist, false)) order by p.role, p.display_name)
    from public.profiles p left join public.race_super_access a on a.user_id = p.id
    where p.role in ('mod', 'alphamod', 'admin') and not p.blocked), '[]'::jsonb);
end;
$$;

do $$
declare r record;
begin
  for r in select p.oid::regprocedure as sig, p.proname from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('_race_assist', 'admin_super_assist', 'admin_super_list') loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    if left(r.proname, 1) <> '_' then execute format('grant execute on function %s to authenticated', r.sig); end if;
  end loop;
end;
$$;
