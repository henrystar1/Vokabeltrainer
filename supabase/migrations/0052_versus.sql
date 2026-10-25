-- 0052: Team-Parkour mit Bots als Gegner und Team gegen Team (Wettlauf auf denselben Leveln). Wiederholbar.
--  * team_runs.versus: 0 = normal, 1 = Team gegen Bots, 2 = Team gegen Team (rot gegen blau)
--  * team_runs.team_map: Person -> Team (0 rot, 1 blau), nur bei versus = 2
--  * team_runs.team_results: Ergebnis je Team (bei versus = 2), der Lauf endet, wenn alle Teams gemeldet haben
--  * team_set_bots: auch im Team-Parkour (Bots sind dann das Gegner-Team), team_set_versus: Gegner und Teams einstellen
alter table public.team_runs add column if not exists versus smallint not null default 0;
alter table public.team_runs add column if not exists team_map jsonb not null default '{}'::jsonb;
alter table public.team_runs add column if not exists team_results jsonb not null default '{}'::jsonb;
alter table public.team_runs drop constraint if exists team_runs_versus_check;
alter table public.team_runs add constraint team_runs_versus_check check (versus between 0 and 2);

-- Bots einstellen (Deathrun: Mods/Admins, bei privaten Lobbys auch der Host; Team-Parkour: der Host). Im Team-Parkour sind Bots das Gegner-Team.
create or replace function public.team_set_bots(p_id uuid, p_bots integer, p_skill integer default 2)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  t public.team_runs;
  v_bots integer := least(greatest(coalesce(p_bots, 0), 0), 8);
begin
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  select * into t from public.team_runs where id = p_id for update;
  if not found or t.kind not in ('deathrun', 'parkour') or t.status <> 'lobby' then
    raise exception 'Diese Lobby gibt es nicht mehr.' using errcode = 'P0002';
  end if;
  if not (public.is_staff() or (v_me = t.host_id and not t.is_open)) then
    raise exception 'Bots stellen nur Mods und Admins ein.' using errcode = '42501';
  end if;
  update public.team_runs
     set bots = v_bots, bot_skill = least(greatest(coalesce(p_skill, 2), 1), 7000), updated_at = now(),
         versus = case when t.kind <> 'parkour' then t.versus when v_bots > 0 then 1 when t.versus = 1 then 0 else t.versus end,
         team_map = case when t.kind = 'parkour' and v_bots > 0 then '{}'::jsonb else t.team_map end
   where id = p_id;
end;
$$;

-- Team-Parkour: Gegner wählen (0 keiner, 1 Bots, 2 anderes Team) und bei 2 die Personen auf rot (0) und blau (1) verteilen
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
  v_map jsonb;
begin
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  select * into t from public.team_runs where id = p_id for update;
  if not found or t.kind <> 'parkour' or t.status <> 'lobby' or v_me <> t.host_id then
    raise exception 'Das stellt nur der Host der Lobby ein.' using errcode = '42501';
  end if;
  select coalesce(jsonb_object_agg(e.key, case when e.value::text = '1' then 1 else 0 end), '{}'::jsonb)
    into v_map
    from jsonb_each(coalesce(p_map, '{}'::jsonb)) e
   where e.key ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' and public._run_member(p_id, e.key::uuid);
  update public.team_runs
     set versus = v_mode,
         team_map = case when v_mode = 2 then v_map else '{}'::jsonb end,
         bots = case when v_mode = 1 then greatest(t.bots, 1) else 0 end,
         updated_at = now()
   where id = p_id;
end;
$$;

-- Team-Parkour beenden. Normal und gegen Bots meldet eine Person für alle; bei Team gegen Team meldet jedes Team für sich.
create or replace function public.team_parkour_finish(p_id uuid, p_millis integer, p_deaths integer, p_levels integer, p_cps integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  t public.team_runs;
  v_lv integer := least(greatest(coalesce(p_levels, 0), 0), 500);
  v_cp integer := least(greatest(coalesce(p_cps, 0), 0), 2000);
  v_ms integer := least(greatest(coalesce(p_millis, 0), 0), 7200000);
  v_de integer := least(greatest(coalesce(p_deaths, 0), 0), 9999);
  v_coins integer;
  v_team integer;
  v_th integer;
  v_tp integer;
  v_teams integer;
  v_done integer;
  v_best integer;
begin
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  select * into t from public.team_runs where id = p_id for update;
  if not found or t.kind <> 'parkour' or t.status <> 'running'
     or (v_me <> t.host_id and not (v_me = t.partner_id and t.partner_state = 'joined')
         and not exists (select 1 from public.team_run_extras x where x.run_id = p_id and x.user_id = v_me and x.state = 'joined')) then return; end if;
  -- Ein Level dauert mindestens 12 Sekunden; schneller kann die Meldung nicht stimmen.
  if t.starts_at + make_interval(secs => 12 * v_lv) > now() then return; end if;
  v_coins := least(v_lv, 8) * public.setting('parkour_coins_level')
             + greatest(v_lv - 8, 0) * (public.setting('parkour_coins_level') + public.setting('parkour_coins_endless'))
             + v_cp * public.setting('parkour_coins_cp')
             + case when v_lv >= 8 then public.setting('parkour_coins_bonus') else 0 end;
  if t.versus = 2 then
    v_team := coalesce((t.team_map ->> v_me::text)::integer, 0);
    if t.team_results ? v_team::text then return; end if;
    v_th := coalesce((t.team_map ->> t.host_id::text)::integer, 0);
    v_tp := coalesce((t.team_map ->> t.partner_id::text)::integer, 0);
    update public.team_runs
       set team_results = t.team_results || jsonb_build_object(v_team::text, jsonb_build_object('levels', v_lv, 'cps', v_cp, 'millis', v_ms, 'deaths', v_de)),
           paid_host = case when v_th = v_team then public._team_pay(t.host_id, v_coins, p_id::text) else t.paid_host end,
           paid_partner = case when t.partner_state = 'joined' and t.partner_id <> t.host_id and v_tp = v_team then public._team_pay(t.partner_id, v_coins, p_id::text) else t.paid_partner end,
           updated_at = now()
     where id = p_id;
    update public.team_run_extras x set paid = public._team_pay(x.user_id, v_coins, p_id::text)
     where x.run_id = p_id and x.state = 'joined' and coalesce((t.team_map ->> x.user_id::text)::integer, 0) = v_team;
    -- Beide Teams (die es gibt) gemeldet? Dann ist der Lauf zu Ende.
    select count(distinct tm) into v_teams from (
      select v_th as tm
      union all select v_tp where t.partner_state = 'joined' and t.partner_id <> t.host_id
      union all select coalesce((t.team_map ->> x.user_id::text)::integer, 0) from public.team_run_extras x where x.run_id = p_id and x.state = 'joined'
    ) q;
    select count(*)::integer into v_done from jsonb_object_keys((select team_results from public.team_runs where id = p_id));
    if v_done >= v_teams then
      select max((e.value ->> 'levels')::integer) into v_best from jsonb_each((select team_results from public.team_runs where id = p_id)) e;
      update public.team_runs
         set status = case when coalesce(v_best, 0) >= 8 then 'won' else 'lost' end, finished_at = now(), updated_at = now(),
             levels = v_best, cps = v_cp, millis = v_ms, deaths = v_de, step = least(coalesce(v_best, 0), 2000)
       where id = p_id;
    end if;
    return;
  end if;
  update public.team_runs
     set status = case when v_lv >= 8 then 'won' else 'lost' end, finished_at = now(), updated_at = now(),
         millis = v_ms, deaths = v_de,
         levels = v_lv, cps = v_cp, step = least(v_lv, 2000),
         paid_host = public._team_pay(t.host_id, v_coins, p_id::text),
         paid_partner = case when t.partner_state = 'joined' then public._team_pay(t.partner_id, v_coins, p_id::text) else 0 end
   where id = p_id;
  update public.team_run_extras x set paid = public._team_pay(x.user_id, v_coins, p_id::text) where x.run_id = p_id and x.state = 'joined';
end;
$$;

drop function if exists public.team_parkour_board();
create or replace function public.team_parkour_board()
returns table (host_name text, host_avatar_id text, host_color_id text, partner_name text, partner_avatar_id text, partner_color_id text,
               levels integer, cps integer, millis integer, deaths integer, finished_at timestamptz, group_size integer)
language sql
stable
security definer
set search_path = public
as $$
  select h.display_name, h.avatar_id, h.color_id, p.display_name, p.avatar_id, p.color_id, x.levels, x.cps, x.millis, x.deaths, x.finished_at,
           1 + case when x.partner_state = 'joined' then 1 else 0 end + (select count(*)::integer from public.team_run_extras e where e.run_id = x.id and e.state = 'joined')
    from (
      select distinct on (least(t.host_id, t.partner_id), greatest(t.host_id, t.partner_id)) t.*
        from public.team_runs t
       where t.kind = 'parkour' and t.status in ('won', 'lost') and t.levels is not null and t.versus = 0
       order by least(t.host_id, t.partner_id), greatest(t.host_id, t.partner_id), t.levels desc, t.cps desc, t.millis asc
    ) x
    join public.profiles h on h.id = x.host_id
    join public.profiles p on p.id = x.partner_id
   where (select auth.uid()) is not null and not public.is_blocked()
   order by x.levels desc, x.cps desc, x.millis asc
   limit 20;
$$;
create or replace function public._team_get(p_id uuid, p_spec boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  t public.team_runs;
  v_host boolean;
  v_arr jsonb;
  v_idx integer;
  v_q jsonb;
  v_my jsonb := null;
  v_member boolean;
  v_left boolean;
begin
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  select * into t from public.team_runs where id = p_id;
  if not found
     or (not p_spec and (
          (v_me <> t.host_id and v_me <> t.partner_id and not exists (select 1 from public.team_run_extras x where x.run_id = p_id and x.user_id = v_me and (x.state <> 'declined' or t.status <> 'lobby')))
          or (v_me = t.partner_id and v_me <> t.host_id and t.partner_state in ('declined') and t.status = 'lobby'))) then
    raise exception 'Team-Parcours nicht gefunden.' using errcode = 'P0002';
  end if;
  if p_spec and not public.is_admin() then
    raise exception 'Nur Admins dürfen zuschauen.' using errcode = '42501';
  end if;
  if t.status in ('running', 'lobby') then
    if (t.status = 'running' and t.updated_at < now() - case when t.kind in ('parkour', 'deathrun') then interval '40 minutes' else interval '10 minutes' end)
       or (t.status = 'lobby' and t.created_at < now() - interval '30 minutes') then
      update public.team_runs set status = 'cancelled', finished_at = now() where id = p_id;
      t.status := 'cancelled';
    elsif t.status = 'running' and t.kind in ('parkour', 'deathrun') and t.updated_at < now() - interval '1 minute' and public._run_member(p_id, v_me) then
      -- Solange jemand im Lauf ist, läuft er weiter (kein Abbruch nach 40 Minuten ohne Ereignis)
      update public.team_runs set updated_at = now() where id = p_id;
    end if;
  end if;
  v_host := v_me = t.host_id and not p_spec;
  v_member := public._run_member(p_id, v_me) and not p_spec;
  v_left := not p_spec and not v_member and t.status = 'running' and t.kind in ('parkour', 'deathrun')
            and ((v_me = t.partner_id and t.partner_state = 'left') or exists (select 1 from public.team_run_extras x where x.run_id = p_id and x.user_id = v_me and x.state = 'left'))
            and not (t.kind = 'deathrun' and exists (select 1 from public.deathrun_results d where d.run_id = p_id and d.user_id = v_me));
  if t.status = 'running' and t.kind = 'quiz' then
    v_arr := case when v_host then t.host_questions else t.partner_questions end;
    v_idx := case when v_host then t.host_idx else t.partner_idx end;
    v_q := v_arr -> (v_idx % jsonb_array_length(v_arr));
    select jsonb_build_object(
             'idx', v_idx, 'direction', v_q ->> 'direction', 'vocabulary_id', v.id, 'german', v.german, 'german_alts', to_jsonb(v.german_alts),
             'translations', coalesce((select jsonb_agg(tr.translation order by tr.sort_order, tr.created_at) from public.translations tr where tr.vocabulary_id = v.id), '[]'::jsonb))
      into v_my from public.vocabulary v where v.id = (v_q ->> 'vocabulary_id')::uuid;
  end if;
  return jsonb_build_object(
    'id', t.id, 'kind', t.kind, 'levels', t.levels, 'cps', t.cps,
    'coins', jsonb_build_array(public.setting('parkour_coins_level'), public.setting('parkour_coins_cp'), public.setting('parkour_coins_bonus')), 'millis', t.millis, 'deaths', t.deaths, 'status', t.status, 'is_host', v_host, 'me', v_me, 'now', now(), 'starts_at', t.starts_at,
    'obstacles', t.obstacles, 'lives', t.lives, 'lives_left', t.lives_left, 'step', t.step,
    'host_ok', t.host_ok, 'partner_ok', t.partner_ok, 'partner_state', t.partner_state,
    'host_right', t.host_right, 'host_wrong', t.host_wrong, 'partner_right', t.partner_right, 'partner_wrong', t.partner_wrong,
    'is_open', t.is_open, 'versus', t.versus, 'team_map', t.team_map, 'team_results', t.team_results, 'bots', t.bots, 'bot_skill', t.bot_skill, 'spectator', p_spec, 'can_rejoin', v_left, 'member', v_member,
    'staff_present', public._run_staff_present(p_id),
    'can_manage', t.status = 'lobby' and t.kind in ('deathrun', 'parkour') and not p_spec and (public.is_staff() or (v_me = t.host_id and not t.is_open)),
    'can_start', t.status = 'lobby' and not p_spec and (case when t.is_open then (public.is_staff() or (not public._run_staff_present(p_id) and public._run_member(p_id, v_me))) else v_me = t.host_id end),
    'reward', case when t.kind = 'parkour' then public.setting('team_parkour_reward') else public.setting('team_reward') end, 'paid', case when t.kind = 'deathrun' then coalesce((select r.paid from public.deathrun_results r where r.run_id = t.id and r.user_id = v_me), 0)
                 when v_host then t.paid_host when v_me = t.partner_id then t.paid_partner else coalesce((select x.paid from public.team_run_extras x where x.run_id = t.id and x.user_id = v_me), 0) end,
    'results', case when t.kind = 'deathrun' then coalesce((select jsonb_agg(jsonb_build_object('user_id', r.user_id, 'name', rp.display_name, 'levels', r.levels, 'cps', r.cps, 'millis', r.millis, 'deaths', r.deaths, 'paid', r.paid) order by r.levels desc, r.millis asc)
                                                             from public.deathrun_results r join public.profiles rp on rp.id = r.user_id where r.run_id = t.id), '[]'::jsonb) else null end,
    'my_question', v_my,
    'people', (
      select jsonb_agg(jsonb_build_object(
               'user_id', pr.id, 'name', pr.display_name, 'avatar_id', pr.avatar_id, 'color_id', pr.color_id, 'effect_id', pr.effect_id,
               'tag_id', case when pr.tags_hidden then null else pr.tag_id end, 'theme_id', pr.theme_id,
               'role', case when pr.tags_hidden then 'user' else pr.role end, 'is_host', pr.id = t.host_id, 'state', m.st,
               'pk_hearts', coalesce(pp.extra_hearts, 0), 'pk_color', pp.color, 'pk_hat', pp.hat, 'pk_fx', pp.fx)
             order by m.ord, m.ts)
        from (
          select t.host_id as uid, 'host'::text as st, 0 as ord, t.created_at as ts
          union all select t.partner_id, t.partner_state, 1, t.created_at where t.partner_id <> t.host_id
          union all select x.user_id, x.state, 2, x.created_at from public.team_run_extras x where x.run_id = t.id and x.user_id <> t.host_id
        ) m
        join public.profiles pr on pr.id = m.uid
        left join public.parkour_profiles pp on pp.user_id = pr.id
       where m.st not in ('declined', 'left')));
end;
$$;

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig, p.proname
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('team_set_bots', 'team_set_versus', 'team_parkour_finish', 'team_parkour_board', '_team_get')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    if r.proname not like '\_%' then
      execute format('grant execute on function %s to authenticated', r.sig);
    end if;
  end loop;
end;
$$;
