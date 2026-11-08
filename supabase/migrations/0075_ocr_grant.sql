-- 0075: Foto-Scan einzelnen Personen freischalten (ohne Pro). Admins haben ihn ohnehin. Wiederholbar.
alter table public.profiles add column if not exists ocr_granted boolean not null default false;

create or replace function public._ocr_allowed(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public._pro_active(p_user)
      or (public._pls('pro_ocr_plus') >= 1 and public._plus_active(p_user))
      or coalesce((select p.ocr_granted and not p.blocked from public.profiles p where p.id = p_user), false);
$$;

create or replace function public.admin_set_ocr(p_user uuid, p_on boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._require_admin();
  update public.profiles set ocr_granted = coalesce(p_on, false) where id = p_user;
end;
$$;

create or replace function public.admin_get_ocr(p_user uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public._require_admin();
  return coalesce((select ocr_granted from public.profiles where id = p_user), false);
end;
$$;

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('_ocr_allowed', 'admin_set_ocr', 'admin_get_ocr')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    if r.proname like 'admin\_%' then
      execute format('grant execute on function %s to authenticated', r.sig);
    end if;
  end loop;
end;
$$;
