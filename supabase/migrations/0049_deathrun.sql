-- 0049: Deathrun (Parkour, jeder für sich): alle laufen so weit wie möglich, jede Person hat eigene Herzen und kommt
-- allein ins nächste Level, sobald sie im Ziel ist. Tore und Brücken brauchen weiterhin Teamarbeit (Platten halten).
--  * team_runs.kind kennt jetzt 'deathrun' (Lobby, Einladung bis 5 Personen wie beim Parkour).
--  * deathrun_results: Ergebnis je Person (Level, Checkpoints, Zeit, Stürze, Coins).
--  * team_deathrun_finish: meldet das Ergebnis einer Person (Coins wie beim Parkour). Der Lauf endet, wenn alle ein Ergebnis haben.
--  * deathrun_board(): Bestenliste der einzelnen Personen (für die Seite Rangliste).
-- Wiederholbar. Nach 0048 ausführen.

alter table public.team_runs drop constraint if exists team_runs_kind_check;
alter table public.team_runs add constraint team_runs_kind_check check (kind in ('quiz', 'parkour', 'deathrun'));

create table if not exists public.deathrun_results (
  run_id uuid not null references public.team_runs (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  levels integer not null default 0,
  cps integer not null default 0,
  millis integer not null default 0,
  deaths integer not null default 0,
  paid integer not null default 0,
  created_at timestamptz not null default now(),
  primary key (run_id, user_id)
);
create index if not exists deathrun_results_rank_idx on public.deathrun_results (levels desc, millis asc);
alter table public.deathrun_results enable row level security;
revoke all on public.deathrun_results from anon, authenticated;

drop function if exists public.team_create(uuid, integer, text, uuid[]);
create or replace function public.team_create(p_partner uuid, p_obstacles integer default 10, p_kind text default 'quiz', p_extra uuid[] default '{}')
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  v_id uuid;
  v_name text;
  v_extra uuid[];
  v_x uuid;
  v_kind text := case when p_kind in ('parkour', 'deathrun') then p_kind else 'quiz' end;
  v_label text := case when p_kind = 'deathrun' then 'zum Deathrun (Parkour, jeder für sich, aber mit Teamarbeit an den Toren)' when p_kind = 'parkour' then 'zum Team-Parkour (Joystick-Spiel mit bis zu 5 Personen)' else 'zum Team-Parcours' end;
begin
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  if p_partner is null or p_partner = v_me or not exists (select 1 from public.profiles where id = p_partner and not blocked) then
    raise exception 'Diese Person gibt es nicht.' using errcode = '22023';
  end if;
  select coalesce(array_agg(distinct e), '{}') into v_extra from unnest(coalesce(p_extra, '{}')) e where e <> v_me and e <> p_partner;
  if v_kind = 'quiz' and array_length(v_extra, 1) is not null then
    raise exception 'Nur Parkour und Deathrun gehen mit mehr als zwei Personen.' using errcode = '22023';
  end if;
  if coalesce(array_length(v_extra, 1), 0) > 3 then
    raise exception 'Höchstens 5 Personen pro Lauf.' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(v_extra) e where not exists (select 1 from public.profiles where id = e and not blocked)) then
    raise exception 'Diese Person gibt es nicht.' using errcode = '22023';
  end if;
  update public.team_runs set status = 'cancelled', finished_at = now()
   where host_id = v_me and status in ('lobby', 'running') and updated_at < now() - interval '1 minute';
  if exists (select 1 from public.team_runs where host_id = v_me and status = 'lobby') then
    raise exception 'Du hast schon eine offene Team-Lobby.' using errcode = '23505';
  end if;
  insert into public.team_runs (host_id, partner_id, obstacles, lives, lives_left, kind)
  values (v_me, p_partner, case when v_kind <> 'quiz' then 3 else least(greatest(coalesce(p_obstacles, 10), 6), 16) end, least(greatest(public.setting('team_lives'), 1), 9), least(greatest(public.setting('team_lives'), 1), 9), v_kind)
  returning id into v_id;
  select display_name into v_name from public.profiles where id = v_me;
  insert into public.user_messages (user_id, from_id, body)
  values (p_partner, v_me, '🏃 ' || v_name || ' lädt dich ' || v_label || ' ein! Öffne „Parkour“ oder „Duell“ und tritt der Lobby bei.');
  foreach v_x in array v_extra loop
    insert into public.team_run_extras (run_id, user_id) values (v_id, v_x);
    insert into public.user_messages (user_id, from_id, body)
    values (v_x, v_me, '🏃 ' || v_name || ' lädt dich ' || v_label || ' ein! Öffne „Parkour“ oder „Duell“ und tritt der Lobby bei.');
  end loop;
  return v_id;
end;
$$;

-- Hilfsfunktion: Deathrun beenden, sobald jede beigetretene Person ein Ergebnis gemeldet hat
create or replace function public._deathrun_close(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  t public.team_runs;
begin
  select * into t from public.team_runs where id = p_id for update;
  if not found or t.kind <> 'deathrun' or t.status <> 'running' then return; end if;
  if exists (
    select 1 from (
      select t.host_id as uid
      union all select t.partner_id where t.partner_state = 'joined'
      union all select x.user_id from public.team_run_extras x where x.run_id = p_id and x.state = 'joined'
    ) m
    where not exists (select 1 from public.deathrun_results r where r.run_id = p_id and r.user_id = m.uid)
  ) then return; end if;
  update public.team_runs
     set status = 'lost', finished_at = now(), updated_at = now(),
         levels = (select max(levels) from public.deathrun_results where run_id = p_id),
         cps = (select max(cps) from public.deathrun_results where run_id = p_id),
         millis = (select max(millis) from public.deathrun_results where run_id = p_id),
         deaths = (select sum(deaths)::integer from public.deathrun_results where run_id = p_id)
   where id = p_id;
end;
$$;

create or replace function public.team_deathrun_finish(p_id uuid, p_millis integer, p_deaths integer, p_levels integer, p_cps integer)
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
  v_coins integer;
begin
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  select * into t from public.team_runs where id = p_id for update;
  if not found or t.kind <> 'deathrun' or t.status <> 'running' then return; end if;
  if v_me <> t.host_id and not (v_me = t.partner_id and t.partner_state in ('joined', 'left'))
     and not exists (select 1 from public.team_run_extras x where x.run_id = p_id and x.user_id = v_me and x.state in ('joined', 'left')) then return; end if;
  if exists (select 1 from public.deathrun_results where run_id = p_id and user_id = v_me) then return; end if;
  if t.starts_at + make_interval(secs => 12 * v_lv) > now() then return; end if;
  v_coins := least(v_lv, 8) * public.setting('parkour_coins_level')
             + greatest(v_lv - 8, 0) * (public.setting('parkour_coins_level') + public.setting('parkour_coins_endless'))
             + v_cp * public.setting('parkour_coins_cp')
             + case when v_lv >= 8 then public.setting('parkour_coins_bonus') else 0 end;
  insert into public.deathrun_results (run_id, user_id, levels, cps, millis, deaths, paid)
  values (p_id, v_me, v_lv, v_cp, least(greatest(coalesce(p_millis, 0), 0), 7200000), least(greatest(coalesce(p_deaths, 0), 0), 9999),
          public._team_pay(v_me, v_coins, p_id::text));
  perform public._deathrun_close(p_id);
end;
$$;

create or replace function public.deathrun_board()
returns table (name text, avatar_id text, color_id text, levels integer, cps integer, millis integer, deaths integer, group_size integer, finished_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select x.display_name, x.avatar_id, x.color_id, x.levels, x.cps, x.millis, x.deaths, x.group_size, x.created_at
    from (
      select distinct on (r.user_id) pr.display_name, pr.avatar_id, pr.color_id, r.levels, r.cps, r.millis, r.deaths, r.created_at,
             (select count(*)::integer from public.deathrun_results r2 where r2.run_id = r.run_id) as group_size
        from public.deathrun_results r
        join public.profiles pr on pr.id = r.user_id
       order by r.user_id, r.levels desc, r.cps desc, r.millis asc
    ) x
   where (select auth.uid()) is not null and not public.is_blocked()
   order by x.levels desc, x.cps desc, x.millis asc
   limit 20;
$$;

create or replace function public.team_start(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  t public.team_runs;
  v_ids uuid[];
  v_n integer;
  v_pool integer;
  v_h jsonb;
  v_p jsonb;
begin
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  select * into t from public.team_runs where id = p_id for update;
  if not found or t.host_id <> v_me or t.status <> 'lobby' then
    raise exception 'Nur der Host kann eine offene Team-Lobby starten.' using errcode = '42501';
  end if;
  if t.partner_state <> 'joined'
     and not (t.kind in ('parkour', 'deathrun') and exists (select 1 from public.team_run_extras x where x.run_id = p_id and x.state = 'joined')) then
    raise exception 'Es ist noch niemand beigetreten.' using errcode = '22023';
  end if;
  if t.kind in ('parkour', 'deathrun') then
    update public.team_runs set status = 'running', starts_at = now() + interval '5 seconds', updated_at = now(), step = 0 where id = p_id;
    return;
  end if;
  select array_agg(x.vid order by random()) into v_ids
    from (
      select a.vocabulary_id as vid
        from public.user_active_vocab a
       where a.user_id in (t.host_id, t.partner_id)
         and exists (select 1 from public.translations tr where tr.vocabulary_id = a.vocabulary_id)
       group by a.vocabulary_id
      having count(distinct a.user_id) = 2
    ) x;
  v_n := coalesce(array_length(v_ids, 1), 0);
  if v_n < 6 then
    raise exception 'Ihr habt zu wenige gemeinsame aktive Vokabeln (mindestens 6).' using errcode = '22023';
  end if;
  v_pool := t.obstacles + t.lives;
  select jsonb_agg(jsonb_build_object('vocabulary_id', v_ids[1 + ((2 * (i - 1)) % v_n)], 'direction', case when random() < 0.5 then 'forward' else 'backward' end) order by i)
    into v_h from generate_series(1, v_pool) i;
  select jsonb_agg(jsonb_build_object('vocabulary_id', v_ids[1 + ((2 * (i - 1) + 1) % v_n)], 'direction', case when random() < 0.5 then 'forward' else 'backward' end) order by i)
    into v_p from generate_series(1, v_pool) i;
  update public.team_runs
     set status = 'running', host_questions = v_h, partner_questions = v_p, starts_at = now() + interval '4 seconds', updated_at = now(),
         step = 0, lives_left = lives, host_ok = false, partner_ok = false, host_idx = 0, partner_idx = 0
   where id = p_id;
end;
$$;

create or replace function public.team_leave(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  t public.team_runs;
begin
  if v_me is null then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  select * into t from public.team_runs where id = p_id for update;
  if not found then return; end if;
  if v_me not in (t.host_id, t.partner_id) and not exists (select 1 from public.team_run_extras where run_id = p_id and user_id = v_me) then return; end if;
  if t.status = 'lobby' then
    if v_me = t.host_id then
      update public.team_runs set status = 'cancelled', finished_at = now(), updated_at = now() where id = p_id;
    elsif v_me = t.partner_id then
      update public.team_runs set partner_state = 'left', updated_at = now() where id = p_id;
    else
      update public.team_run_extras set state = 'left' where run_id = p_id and user_id = v_me;
    end if;
  elsif t.status = 'running' then
    if t.kind = 'deathrun' then
      -- Deathrun: jede Person läuft für sich, der Lauf geht weiter; wer geht, meldet vorher sein Ergebnis
      if v_me = t.partner_id then
        update public.team_runs set partner_state = 'left', updated_at = now() where id = p_id;
      elsif v_me <> t.host_id then
        update public.team_run_extras set state = 'left' where run_id = p_id and user_id = v_me;
      end if;
      perform public._deathrun_close(p_id);
      return;
    end if;
    if t.kind = 'parkour' and v_me <> t.host_id and exists (select 1 from public.team_run_extras where run_id = p_id and state = 'joined' and user_id <> v_me) then
      -- Gruppe läuft weiter, nur diese Person steigt aus
      if v_me = t.partner_id then
        update public.team_runs set partner_state = 'left', updated_at = now() where id = p_id;
      else
        update public.team_run_extras set state = 'left' where run_id = p_id and user_id = v_me;
      end if;
    elsif t.kind = 'parkour' and v_me = t.partner_id and exists (select 1 from public.team_run_extras where run_id = p_id and state = 'joined') then
      update public.team_runs set partner_state = 'left', updated_at = now() where id = p_id;
    elsif t.kind = 'parkour' and v_me <> t.host_id and v_me <> t.partner_id then
      update public.team_run_extras set state = 'left' where run_id = p_id and user_id = v_me;
    else
      update public.team_runs set status = 'cancelled', finished_at = now(), updated_at = now() where id = p_id;
    end if;
  end if;
end;
$$;

create or replace function public.team_get(p_id uuid)
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
begin
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  select * into t from public.team_runs where id = p_id;
  if not found
     or (v_me not in (t.host_id, t.partner_id) and not exists (select 1 from public.team_run_extras x where x.run_id = p_id and x.user_id = v_me and (x.state <> 'declined' or t.status <> 'lobby')))
     or (v_me = t.partner_id and t.partner_state in ('declined') and t.status = 'lobby') then
    raise exception 'Team-Parcours nicht gefunden.' using errcode = 'P0002';
  end if;
  if (t.status = 'running' and t.updated_at < now() - case when t.kind in ('parkour', 'deathrun') then interval '40 minutes' else interval '10 minutes' end) or (t.status = 'lobby' and t.created_at < now() - interval '30 minutes') then
    update public.team_runs set status = 'cancelled', finished_at = now() where id = p_id;
    t.status := 'cancelled';
  end if;
  v_host := v_me = t.host_id;
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
               'pk_hearts', coalesce(pp.extra_hearts, 0), 'pk_color', pp.color, 'pk_hat', pp.hat)
             order by m.ord, m.ts)
        from (
          select t.host_id as uid, 'host'::text as st, 0 as ord, t.created_at as ts
          union all select t.partner_id, t.partner_state, 1, t.created_at
          union all select x.user_id, x.state, 2, x.created_at from public.team_run_extras x where x.run_id = t.id
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
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('team_create', 'team_start', 'team_leave', 'team_get', 'team_deathrun_finish', 'deathrun_board', '_deathrun_close')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    if r.sig::text not like '_deathrun_close%' then
      execute format('grant execute on function %s to authenticated', r.sig);
    end if;
  end loop;
end;
$$;
