-- 0056: Bots für alle im offenen Deathrun (wenn kein Mod/Admin da ist) und Bots einzeln in Teams einteilen. Wiederholbar.
--  * Offener Deathrun: Bots einstellen dürfen Mods/Admins, sonst jede Person in der Lobby, solange kein Mod/Admin drin ist
--  * Team-Parkour (Team gegen Team): Bots stehen in team_map unter dem Schlüssel b0..b7 (rot 0, blau 1), Menschen und Bots dürfen gemischt sein
--  * team_set_bots(p_id, p_bots, p_skill, p_map): Bots und (optional) die Teams in einem Schritt setzen

create or replace function public._can_set_bots(p_id uuid, p_uid uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  t public.team_runs;
begin
  select * into t from public.team_runs where id = p_id;
  if not found then return false; end if;
  if exists (select 1 from public.profiles pr where pr.id = p_uid and pr.role in ('mod', 'admin', 'alphamod') and not pr.blocked) then return true; end if;
  if p_uid = t.host_id and not t.is_open then return true; end if;
  return t.kind = 'deathrun' and t.is_open and not public._run_staff_present(p_id) and public._run_member(p_id, p_uid);
end;
$$;

-- Teamkarte prüfen: Personen (Mitglieder des Laufs) und Bots b0..b(n-1)
create or replace function public._clean_team_map(p_id uuid, p_map jsonb, p_bots integer)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_object_agg(e.key, case when e.value::text = '1' then 1 else 0 end), '{}'::jsonb)
    from jsonb_each(coalesce(p_map, '{}'::jsonb)) e
   where (e.key ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' and public._run_member(p_id, e.key::uuid))
      or (e.key ~ '^b[0-7]$' and substr(e.key, 2)::integer < p_bots);
$$;

drop function if exists public.team_set_bots(uuid, integer, integer);
create or replace function public.team_set_bots(p_id uuid, p_bots integer, p_skill integer default 2, p_map jsonb default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  t public.team_runs;
  v_bots integer := least(greatest(coalesce(p_bots, 0), 0), 8);
  v_map jsonb;
begin
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  select * into t from public.team_runs where id = p_id for update;
  if not found or t.kind not in ('deathrun', 'parkour') or t.status <> 'lobby' then
    raise exception 'Diese Lobby gibt es nicht mehr.' using errcode = 'P0002';
  end if;
  if not public._can_set_bots(p_id, v_me) then
    raise exception 'Bots stellen Mods und Admins ein (im offenen Deathrun jede Person, solange kein Mod oder Admin da ist).' using errcode = '42501';
  end if;
  v_map := public._clean_team_map(p_id, coalesce(p_map, t.team_map), v_bots);
  update public.team_runs
     set bots = v_bots, bot_skill = least(greatest(coalesce(p_skill, 2), 1), 7000), updated_at = now(),
         versus = case when t.kind <> 'parkour' then t.versus when t.versus = 2 then 2 when v_bots > 0 then 1 when t.versus = 1 then 0 else t.versus end,
         team_map = case when t.kind = 'parkour' and (t.versus = 2) then v_map when t.kind = 'parkour' and v_bots > 0 then '{}'::jsonb else t.team_map end
   where id = p_id;
end;
$$;

create or replace function public.team_set_versus(p_id uuid, p_mode integer, p_map jsonb default '{}'::jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  t public.team_runs;
  v_mode integer := least(greatest(coalesce(p_mode, 0), 0), 2);
begin
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  select * into t from public.team_runs where id = p_id for update;
  if not found or t.kind <> 'parkour' or t.status <> 'lobby' or v_me <> t.host_id then
    raise exception 'Das stellt nur der Host der Lobby ein.' using errcode = '42501';
  end if;
  update public.team_runs
     set versus = v_mode,
         team_map = case when v_mode = 2 then public._clean_team_map(p_id, p_map, t.bots) else '{}'::jsonb end,
         bots = case when v_mode = 0 then 0 when v_mode = 1 then greatest(t.bots, 1) else t.bots end,
         updated_at = now()
   where id = p_id;
end;
$$;

-- _team_get: Bots darf einstellen, wer _can_set_bots erfüllt (Text der bestehenden Funktion wird angepasst)
do $$
declare
  v_def text;
begin
  select pg_get_functiondef('public._team_get(uuid, boolean)'::regprocedure) into v_def;
  v_def := replace(v_def,
    $a$'can_manage', t.status = 'lobby' and t.kind in ('deathrun', 'parkour') and not p_spec and (public.is_staff() or (v_me = t.host_id and not t.is_open)),$a$,
    $b$'can_manage', t.status = 'lobby' and t.kind in ('deathrun', 'parkour') and not p_spec and (public.is_staff() or (v_me = t.host_id and not t.is_open) or public._can_set_bots(p_id, v_me)),$b$);
  execute v_def;
end;
$$;

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig, p.proname
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('_can_set_bots', '_clean_team_map', 'team_set_bots', 'team_set_versus', '_team_get')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    if r.proname not like '\_%' then
      execute format('grant execute on function %s to authenticated', r.sig);
    end if;
  end loop;
end;
$$;
