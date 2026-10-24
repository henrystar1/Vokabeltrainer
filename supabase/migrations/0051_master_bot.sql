-- 0051: Meister-Bot (Können 4) und gemischte Bots. bot_skill: 1–4 = alle Bots gleich, ab 10 = Mischung (siehe botmix.ts). Wiederholbar.
alter table public.team_runs drop constraint if exists team_runs_bots_check;
alter table public.team_runs add constraint team_runs_bots_check check (bots between 0 and 8 and bot_skill between 1 and 7000);

create or replace function public.team_set_bots(p_id uuid, p_bots integer, p_skill integer default 2)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  t public.team_runs;
begin
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  select * into t from public.team_runs where id = p_id for update;
  if not found or t.kind <> 'deathrun' or t.status <> 'lobby' then
    raise exception 'Diese Lobby gibt es nicht mehr.' using errcode = 'P0002';
  end if;
  if not (public.is_staff() or (v_me = t.host_id and not t.is_open)) then
    raise exception 'Bots stellen nur Mods und Admins ein.' using errcode = '42501';
  end if;
  update public.team_runs
     set bots = least(greatest(coalesce(p_bots, 0), 0), 8), bot_skill = least(greatest(coalesce(p_skill, 2), 1), 7000), updated_at = now()
   where id = p_id;
end;
$$;

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig, p.proname
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'team_set_bots'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;
end;
$$;
