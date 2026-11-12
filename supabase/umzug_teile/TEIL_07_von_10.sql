
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

-- 0050: Offene Deathrun-Lobby, Bots, Wiedereinstieg, Admin-Zuschauer und mehr Kosmetik (Effekte).
--  * team_runs.is_open: offene Lobby (nur Deathrun). deathrun_open_join() tritt der offenen Lobby bei (oder legt eine an).
--    Start: sobald 5 Personen drin sind, oder durch Mods/Admins; ist keiner von beiden in der Lobby, kann jede beigetretene Person starten.
--  * team_runs.bots / bot_skill: Bots für Deathrun (Mods/Admins immer, der Host einer privaten Lobby auch) – team_set_bots().
--  * team_rejoin(): Wer rausgeflogen ist oder ausgestiegen ist, kommt in einen laufenden Lauf zurück (Host-Wechsel statt Abbruch).
--  * admin_open_runs() / team_spectate(): Admins sehen alle offenen und laufenden Parkour/Deathruns und schauen unsichtbar als Geist zu.
--  * Kosmetik: Effekte (Notenstrahl, Schwarzes Loch …), weitere Farben und Hüte (parkour_equip kennt p_fx).
-- Einstellung: parkour_fx_price (Premium ×3).
-- Wiederholbar. Nach 0049 ausführen.

insert into public.app_settings (key, value, mod_editable) values ('parkour_fx_price', 150, false)
on conflict (key) do nothing;

alter table public.team_runs add column if not exists is_open boolean not null default false;
alter table public.team_runs add column if not exists bots smallint not null default 0;
alter table public.team_runs add column if not exists bot_skill smallint not null default 2;
alter table public.team_runs drop constraint if exists team_runs_bots_check;
alter table public.team_runs add constraint team_runs_bots_check check (bots between 0 and 8 and bot_skill between 1 and 3);

-- Host und "Partner" dürfen bei einer offenen Lobby dieselbe Person sein (der Partnerplatz bleibt leer: partner_state = 'left')
do $$
declare c record;
begin
  for c in select conname from pg_constraint
            where conrelid = 'public.team_runs'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%host_id <> partner_id%'
  loop
    execute format('alter table public.team_runs drop constraint %I', c.conname);
  end loop;
end;
$$;
alter table public.team_runs drop constraint if exists team_runs_host_partner_check;
alter table public.team_runs add constraint team_runs_host_partner_check check (is_open or host_id <> partner_id);

alter table public.parkour_profiles add column if not exists fx text;

-- ===== Kosmetik-Katalog (IDs wie in src/features/parkour/cosmetics.ts) =====
create or replace function public._pk_price(p_item text)
returns integer
language sql
stable
set search_path = public
as $$
  select case
    when p_item in ('color:gold', 'color:neon', 'color:regenbogen', 'color:galaxie', 'color:lava') then 3 * public.setting('parkour_color_price')
    when p_item in ('hat:krone', 'hat:feuer', 'hat:zauberer', 'hat:einhorn', 'hat:heiligenschein') then 3 * public.setting('parkour_hat_price')
    when p_item in ('fx:schwarzesloch', 'fx:blitz', 'fx:feuerspur', 'fx:galaxiewirbel', 'fx:regenbogenstrahl') then 3 * public.setting('parkour_fx_price')
    when p_item in ('color:rot', 'color:orange', 'color:gelb', 'color:gruen', 'color:tuerkis', 'color:blau', 'color:lila', 'color:pink', 'color:weiss', 'color:mint', 'color:schiefer') then public.setting('parkour_color_price')
    when p_item in ('hat:kappe', 'hat:zylinder', 'hat:abschluss', 'hat:strohhut', 'hat:schleife', 'hat:cowboy', 'hat:party', 'hat:alien') then public.setting('parkour_hat_price')
    when p_item in ('fx:noten', 'fx:funken', 'fx:herzen', 'fx:sterne', 'fx:schnee', 'fx:blasen') then public.setting('parkour_fx_price')
    else null
  end;
$$;

create or replace function public._pk_state(p_user uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'hearts', coalesce(pp.extra_hearts, 0),
    'heart_max', public.setting('parkour_heart_max'),
    'heart_price', case when coalesce(pp.extra_hearts, 0) >= public.setting('parkour_heart_max') then null
                        else public.setting('parkour_heart_price') * (coalesce(pp.extra_hearts, 0) + 1) end,
    'color', pp.color, 'hat', pp.hat, 'fx', pp.fx,
    'owned', to_jsonb(coalesce(pp.owned, '{}'::text[])),
    'color_price', public.setting('parkour_color_price'), 'hat_price', public.setting('parkour_hat_price'), 'fx_price', public.setting('parkour_fx_price'))
  from (select 1) x left join public.parkour_profiles pp on pp.user_id = p_user;
$$;

create or replace function public.parkour_shop_buy(p_item text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  v_price integer;
  v_have integer;
begin
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  insert into public.parkour_profiles (user_id) values (v_me) on conflict do nothing;
  perform 1 from public.parkour_profiles where user_id = v_me for update;
  if p_item = 'heart' then
    select extra_hearts into v_have from public.parkour_profiles where user_id = v_me;
    if v_have >= public.setting('parkour_heart_max') then
      raise exception 'Mehr Herzen gibt es nicht.' using errcode = '22023';
    end if;
    v_price := public.setting('parkour_heart_price') * (v_have + 1);
    perform public._grant_koins(v_me, -v_price, 'shop', 'parkour_heart');
    update public.parkour_profiles set extra_hearts = extra_hearts + 1, updated_at = now() where user_id = v_me;
  else
    v_price := public._pk_price(p_item);
    if v_price is null then
      raise exception 'Unbekannter Artikel.' using errcode = '22023';
    end if;
    if exists (select 1 from public.parkour_profiles where user_id = v_me and p_item = any (owned)) then
      raise exception 'Das hast du schon.' using errcode = '22023';
    end if;
    perform public._grant_koins(v_me, -v_price, 'shop', 'parkour_' || p_item);
    update public.parkour_profiles
       set owned = array_append(owned, p_item),
           color = case when p_item like 'color:%' then substr(p_item, 7) else color end,
           hat = case when p_item like 'hat:%' then substr(p_item, 5) else hat end,
           fx = case when p_item like 'fx:%' then substr(p_item, 4) else fx end,
           updated_at = now()
     where user_id = v_me;
  end if;
  return public._pk_state(v_me);
end;
$$;

-- Farbe/Hut/Effekt ausrüsten (leer = Standard, null beim Effekt = unverändert). Nur Gekauftes.
drop function if exists public.parkour_equip(text, text);
create or replace function public.parkour_equip(p_color text, p_hat text, p_fx text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  v_c text := nullif(p_color, '');
  v_h text := nullif(p_hat, '');
  v_f text := nullif(p_fx, '');
begin
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  insert into public.parkour_profiles (user_id) values (v_me) on conflict do nothing;
  if v_c is not null and not exists (select 1 from public.parkour_profiles where user_id = v_me and ('color:' || v_c) = any (owned)) then
    raise exception 'Diese Farbe hast du nicht.' using errcode = '22023';
  end if;
  if v_h is not null and not exists (select 1 from public.parkour_profiles where user_id = v_me and ('hat:' || v_h) = any (owned)) then
    raise exception 'Diesen Hut hast du nicht.' using errcode = '22023';
  end if;
  if v_f is not null and not exists (select 1 from public.parkour_profiles where user_id = v_me and ('fx:' || v_f) = any (owned)) then
    raise exception 'Diesen Effekt hast du nicht.' using errcode = '22023';
  end if;
  update public.parkour_profiles
     set color = v_c, hat = v_h, fx = case when p_fx is null then fx else v_f end, updated_at = now()
   where user_id = v_me;
  return public._pk_state(v_me);
end;
$$;

-- ===== Hilfen =====
-- Beigetretene Menschen (Host, Partner, weitere)
create or replace function public._run_humans(p_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select 1
         + (select count(*)::integer from public.team_runs t where t.id = p_id and t.partner_state = 'joined' and t.partner_id <> t.host_id)
         + (select count(*)::integer from public.team_run_extras x where x.run_id = p_id and x.state = 'joined');
$$;

-- Ist die Person beigetreten (Host zählt immer)?
create or replace function public._run_member(p_id uuid, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.team_runs t where t.id = p_id and (t.host_id = p_user or (t.partner_id = p_user and t.partner_state = 'joined')))
      or exists (select 1 from public.team_run_extras x where x.run_id = p_id and x.user_id = p_user and x.state = 'joined');
$$;

-- Ist ein Mod/Admin beigetreten?
create or replace function public._run_staff_present(p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles pr
     where pr.role in ('mod', 'admin') and not pr.blocked and public._run_member(p_id, pr.id)
       and (pr.id in (select host_id from public.team_runs where id = p_id)
            or pr.id in (select partner_id from public.team_runs where id = p_id)
            or pr.id in (select user_id from public.team_run_extras where run_id = p_id)));
$$;

-- Host-Wechsel: die nächste beigetretene Person wird Host, der alte Host steht danach als "ausgestiegen" in der Liste (kann wieder einsteigen)
create or replace function public._team_promote(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  t public.team_runs;
  v_new uuid;
  v_old uuid;
begin
  select * into t from public.team_runs where id = p_id for update;
  if not found then return false; end if;
  v_old := t.host_id;
  select x.user_id into v_new from public.team_run_extras x where x.run_id = p_id and x.state = 'joined' order by x.created_at limit 1;
  if v_new is not null then
    delete from public.team_run_extras where run_id = p_id and user_id = v_new;
    insert into public.team_run_extras (run_id, user_id, state) values (p_id, v_old, 'left')
    on conflict (run_id, user_id) do update set state = 'left';
    update public.team_runs set host_id = v_new, updated_at = now() where id = p_id;
    return true;
  elsif t.partner_state = 'joined' and t.partner_id <> t.host_id then
    update public.team_runs set host_id = t.partner_id, partner_id = v_old, partner_state = 'left', updated_at = now() where id = p_id;
    return true;
  end if;
  return false;
end;
$$;

-- ===== Offene Lobby =====
create or replace function public.deathrun_open_join()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  v_id uuid;
  t public.team_runs;
begin
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  update public.team_runs set status = 'cancelled', finished_at = now()
   where is_open and status = 'lobby' and created_at < now() - interval '15 minutes';
  -- Schon in einer offenen Lobby oder in einem laufenden offenen Lauf (Wiedereinstieg)? Dann dorthin.
  select r.id into v_id
    from public.team_runs r
   where r.is_open and r.kind = 'deathrun'
     and ((r.status = 'lobby') or (r.status = 'running' and r.updated_at > now() - interval '40 minutes'))
     and (r.host_id = v_me or exists (select 1 from public.team_run_extras x where x.run_id = r.id and x.user_id = v_me and x.state in ('joined', 'left')))
     and not exists (select 1 from public.deathrun_results d where d.run_id = r.id and d.user_id = v_me)
   order by r.created_at desc limit 1;
  if v_id is not null then
    update public.team_run_extras set state = 'joined' where run_id = v_id and user_id = v_me and state = 'left';
    return v_id;
  end if;
  -- Freie offene Lobby suchen
  select r.id into v_id
    from public.team_runs r
   where r.is_open and r.kind = 'deathrun' and r.status = 'lobby' and public._run_humans(r.id) < 5
   order by r.created_at asc
   limit 1
   for update skip locked;
  if v_id is null then
    -- eigene alte Lobbys schließen, dann neue anlegen
    update public.team_runs set status = 'cancelled', finished_at = now() where host_id = v_me and status = 'lobby';
    insert into public.team_runs (host_id, partner_id, partner_state, is_open, obstacles, lives, lives_left, kind)
    values (v_me, v_me, 'left', true, 3, least(greatest(public.setting('team_lives'), 1), 9), least(greatest(public.setting('team_lives'), 1), 9), 'deathrun')
    returning id into v_id;
    return v_id;
  end if;
  insert into public.team_run_extras (run_id, user_id, state) values (v_id, v_me, 'joined')
  on conflict (run_id, user_id) do update set state = 'joined';
  update public.team_runs set updated_at = now() where id = v_id;
  -- Sobald 5 Personen drin sind, startet der Lauf von allein
  if public._run_humans(v_id) >= 5 then
    update public.team_runs set status = 'running', starts_at = now() + interval '5 seconds', updated_at = now(), step = 0 where id = v_id and status = 'lobby';
  end if;
  return v_id;
end;
$$;

-- Bots einstellen (Mods/Admins immer, der Host einer privaten Lobby auch)
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
     set bots = least(greatest(coalesce(p_bots, 0), 0), 8), bot_skill = least(greatest(coalesce(p_skill, 2), 1), 3), updated_at = now()
   where id = p_id;
end;
$$;

-- Wiedereinstieg in einen laufenden Parkour/Deathrun
create or replace function public.team_rejoin(p_id uuid)
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
  if not found or t.status <> 'running' or t.kind not in ('parkour', 'deathrun') or t.updated_at < now() - interval '40 minutes' then
    raise exception 'Dieser Lauf ist schon vorbei.' using errcode = 'P0002';
  end if;
  if v_me = t.host_id then return; end if;
  if t.kind = 'deathrun' and exists (select 1 from public.deathrun_results d where d.run_id = p_id and d.user_id = v_me) then
    raise exception 'Du bist hier schon ausgeschieden.' using errcode = '22023';
  end if;
  if public._run_humans(p_id) >= 5 then
    raise exception 'Der Lauf ist voll.' using errcode = '22023';
  end if;
  if v_me = t.partner_id and t.partner_state = 'left' then
    update public.team_runs set partner_state = 'joined', updated_at = now() where id = p_id;
  elsif exists (select 1 from public.team_run_extras x where x.run_id = p_id and x.user_id = v_me and x.state = 'left') then
    update public.team_run_extras set state = 'joined' where run_id = p_id and user_id = v_me;
    update public.team_runs set updated_at = now() where id = p_id;
  else
    raise exception 'Du warst bei diesem Lauf nicht dabei.' using errcode = '42501';
  end if;
end;
$$;

-- ===== team_start: offene Lobby (Mods/Admins, sonst jede beigetretene Person) =====
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
  v_ok boolean;
begin
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  select * into t from public.team_runs where id = p_id for update;
  if not found or t.status <> 'lobby' then
    raise exception 'Nur der Host kann eine offene Team-Lobby starten.' using errcode = '42501';
  end if;
  if t.is_open then
    v_ok := public.is_staff() or (not public._run_staff_present(p_id) and public._run_member(p_id, v_me));
    if not v_ok then
      raise exception 'Diese Lobby starten Mods oder Admins (oder jede Person, wenn keiner da ist).' using errcode = '42501';
    end if;
    if public._run_humans(p_id) < 2 and t.bots < 1 then
      raise exception 'Zum Starten braucht ihr mindestens zwei Personen oder Bots.' using errcode = '22023';
    end if;
    update public.team_runs set status = 'running', starts_at = now() + interval '5 seconds', updated_at = now(), step = 0 where id = p_id;
    return;
  end if;
  if t.host_id <> v_me then
    raise exception 'Nur der Host kann eine offene Team-Lobby starten.' using errcode = '42501';
  end if;
  if t.partner_state <> 'joined'
     and not (t.kind in ('parkour', 'deathrun') and (exists (select 1 from public.team_run_extras x where x.run_id = p_id and x.state = 'joined') or (t.kind = 'deathrun' and t.bots > 0))) then
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

-- ===== team_leave: bei Host-Wechsel statt Abbruch =====
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
  if v_me <> t.host_id and v_me <> t.partner_id and not exists (select 1 from public.team_run_extras where run_id = p_id and user_id = v_me) then return; end if;
  if t.status = 'lobby' then
    if v_me = t.host_id then
      if not (t.is_open and public._team_promote(p_id)) then
        update public.team_runs set status = 'cancelled', finished_at = now(), updated_at = now() where id = p_id;
      end if;
    elsif v_me = t.partner_id then
      update public.team_runs set partner_state = 'left', updated_at = now() where id = p_id;
    else
      update public.team_run_extras set state = 'left' where run_id = p_id and user_id = v_me;
    end if;
  elsif t.status = 'running' then
    if t.kind = 'deathrun' then
      -- Deathrun: jede Person läuft für sich, der Lauf geht weiter; wer geht, meldet vorher sein Ergebnis
      if v_me = t.partner_id and v_me <> t.host_id then
        update public.team_runs set partner_state = 'left', updated_at = now() where id = p_id;
      elsif v_me <> t.host_id then
        update public.team_run_extras set state = 'left' where run_id = p_id and user_id = v_me;
      end if;
      perform public._deathrun_close(p_id);
      return;
    end if;
    if t.kind = 'parkour' then
      if v_me = t.host_id then
        if not public._team_promote(p_id) then
          update public.team_runs set status = 'cancelled', finished_at = now(), updated_at = now() where id = p_id;
        end if;
        return;
      end if;
      if v_me = t.partner_id then
        update public.team_runs set partner_state = 'left', updated_at = now() where id = p_id;
      else
        update public.team_run_extras set state = 'left' where run_id = p_id and user_id = v_me;
      end if;
      -- Bleibt nur noch der Host übrig, ist der Lauf zu Ende
      if not exists (select 1 from public.team_runs where id = p_id and partner_state = 'joined' and partner_id <> host_id)
         and not exists (select 1 from public.team_run_extras where run_id = p_id and state = 'joined') then
        update public.team_runs set status = 'cancelled', finished_at = now(), updated_at = now() where id = p_id;
      end if;
    else
      update public.team_runs set status = 'cancelled', finished_at = now(), updated_at = now() where id = p_id;
    end if;
  end if;
end;
$$;

-- ===== team_get (mit Zuschauer-Modus für Admins) =====
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
    'is_open', t.is_open, 'bots', t.bots, 'bot_skill', t.bot_skill, 'spectator', p_spec, 'can_rejoin', v_left, 'member', v_member,
    'staff_present', public._run_staff_present(p_id),
    'can_manage', t.status = 'lobby' and t.kind = 'deathrun' and not p_spec and (public.is_staff() or (v_me = t.host_id and not t.is_open)),
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

create or replace function public.team_get(p_id uuid)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select public._team_get(p_id, false);
$$;

create or replace function public.team_spectate(p_id uuid)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select public._team_get(p_id, true);
$$;

-- Alle offenen und laufenden Parkour/Deathruns (nur Admins)
create or replace function public.admin_open_runs()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Nur für Admins.' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', t.id, 'kind', t.kind, 'status', t.status, 'is_open', t.is_open, 'bots', t.bots,
             'created_at', t.created_at, 'starts_at', t.starts_at,
             'players', (select coalesce(jsonb_agg(pr.display_name order by m.ord), '[]'::jsonb)
                           from (
                             select t.host_id as uid, 0 as ord
                             union all select t.partner_id, 1 where t.partner_state = 'joined' and t.partner_id <> t.host_id
                             union all select x.user_id, 2 from public.team_run_extras x where x.run_id = t.id and x.state = 'joined' and x.user_id <> t.host_id
                           ) m join public.profiles pr on pr.id = m.uid))
           order by t.created_at desc)
      from public.team_runs t
     where t.kind in ('parkour', 'deathrun')
       and ((t.status = 'lobby' and t.created_at > now() - interval '30 minutes')
            or (t.status = 'running' and t.updated_at > now() - interval '40 minutes'))), '[]'::jsonb);
end;
$$;

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig, p.proname
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('parkour_shop_buy', 'parkour_equip', '_pk_price', '_pk_state', '_run_humans', '_run_member', '_run_staff_present', '_team_promote',
                                                 'deathrun_open_join', 'team_set_bots', 'team_rejoin', 'team_start', 'team_leave', '_team_get', 'team_get', 'team_spectate', 'admin_open_runs')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    if r.proname not like '\_%' then
      execute format('grant execute on function %s to authenticated', r.sig);
    end if;
  end loop;
end;
$$;
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

-- ===== 0053_parkour_learn.sql =====
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

-- ===== 0054_mod_spectate_irregular.sql =====
-- 0054: Mods mit Zuschauer-Recht und Hammer-Design, nur wirklich aktive Läufe in der Übersicht, Coins für unregelmäßige Verben. Wiederholbar.
--  * staff_rights bekommt `spectate` (darf Läufe unsichtbar ansehen und als Gast einsteigen) und `look` ('none' | 'hammer': Hammer-Auftritt im Parkour).
--  * Admins behalten das Schwarze Loch; `_staff_look` liefert die Darstellung einer Person.
--  * admin_open_runs zeigt nur Läufe, in denen jemand wirklich ist (Herzschlag der Mitspielenden, nicht der Zuschauer).
--  * submit_irregular zahlt Coins für richtige Antworten bei den unregelmäßigen Verben (je N richtige 1 Coin, begrenzt pro Tag).

alter table public.staff_rights add column if not exists spectate boolean;
alter table public.staff_rights add column if not exists look text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'staff_rights_look_check') then
    alter table public.staff_rights add constraint staff_rights_look_check check (look is null or look in ('none', 'hammer'));
  end if;
end;
$$;

-- Darf ich Läufe ansehen und als Gast einsteigen? Admins immer, Mods nur mit Recht.
create or replace function public.can_spectate()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_admin()
      or (public.is_staff() and coalesce((select r.spectate from public.staff_rights r where r.user_id = (select auth.uid())), false));
$$;

-- Darstellung im Parkour: 'blackhole' (Admin), 'hammer' (Mod mit Hammer) oder null
create or replace function public._staff_look(p_user uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p.blocked then null
    when p.role = 'admin' then 'blackhole'
    when p.role in ('mod', 'alphamod') and r.look = 'hammer' then 'hammer'
    else null end
    from public.profiles p left join public.staff_rights r on r.user_id = p.id
   where p.id = p_user;
$$;

create or replace function public.my_run_perks()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object('spectate', public.can_spectate(), 'look', public._staff_look((select auth.uid())))
   where (select auth.uid()) is not null;
$$;

-- Rechte je Mod lesen/setzen (neue Felder)
create or replace function public.admin_get_staff_rights(p_user uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public._require_admin();
  return jsonb_build_object(
    'books_mode', (select books_mode from public.staff_rights where user_id = p_user),
    'set_mode', (select set_mode from public.staff_rights where user_id = p_user),
    'shop', (select shop from public.staff_rights where user_id = p_user),
    'timeout_max', (select timeout_max from public.staff_rights where user_id = p_user),
    'spectate', coalesce((select spectate from public.staff_rights where user_id = p_user), false),
    'look', coalesce((select look from public.staff_rights where user_id = p_user), 'none'),
    'book_ids', coalesce((select jsonb_agg(book_id) from public.staff_book_access where user_id = p_user), '[]'::jsonb),
    'setting_keys', coalesce((select jsonb_agg(key) from public.staff_setting_access where user_id = p_user), '[]'::jsonb));
end;
$$;

drop function if exists public.admin_set_staff_rights(uuid, text, text, boolean, integer);
create or replace function public.admin_set_staff_rights(p_user uuid, p_books_mode text, p_set_mode text, p_shop boolean, p_timeout integer, p_spectate boolean default false, p_look text default 'none')
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._require_admin();
  if not exists (select 1 from public.profiles where id = p_user and role in ('mod', 'alphamod')) then
    raise exception 'Nur für Mods und Alphamods.' using errcode = '22023';
  end if;
  if coalesce(p_look, 'none') not in ('none', 'hammer') then
    raise exception 'Unbekanntes Design.' using errcode = '22023';
  end if;
  insert into public.staff_rights (user_id, books_mode, set_mode, shop, timeout_max, spectate, look)
  values (p_user, p_books_mode, p_set_mode, p_shop, p_timeout, coalesce(p_spectate, false), coalesce(p_look, 'none'))
  on conflict (user_id) do update
    set books_mode = excluded.books_mode, set_mode = excluded.set_mode, shop = excluded.shop, timeout_max = excluded.timeout_max,
        spectate = excluded.spectate, look = excluded.look;
end;
$$;

-- team_get / team_spectate: Zuschauen auch mit Mod-Recht, Herzschlag auch in der Lobby, Darstellung der Personen
do $$
declare
  v_def text;
  v_new text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = '_team_get' limit 1;
  v_new := replace(v_def, 'if p_spec and not public.is_admin() then', 'if p_spec and not public.can_spectate() then');
  v_new := replace(v_new, 'Nur Admins dürfen zuschauen.', 'Du darfst nicht zuschauen.');
  v_new := replace(v_new, E'elsif t.status = ''running'' and t.kind in (''parkour'', ''deathrun'') and t.updated_at < now() - interval ''1 minute'' and public._run_member(p_id, v_me) then',
                          E'elsif t.kind in (''parkour'', ''deathrun'') and t.updated_at < now() - interval ''20 seconds'' and not p_spec and public._run_member(p_id, v_me) then');
  v_new := replace(v_new, '''pk_fx'', pp.fx)', '''pk_fx'', pp.fx, ''pk_look'', public._staff_look(pr.id))');
  if v_new = v_def or position('can_spectate' in v_new) = 0 or position('pk_look' in v_new) = 0 or position('20 seconds' in v_new) = 0 then
    raise exception '0054: _team_get konnte nicht angepasst werden.';
  end if;
  execute v_new;
end;
$$;

-- Übersicht: nur Läufe, in denen gerade jemand ist (Mods mit Zuschauer-Recht dürfen sie sehen)
create or replace function public.admin_open_runs()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.can_spectate() then
    raise exception 'Dafür fehlt dir das Recht.' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(x.j order by x.created_at desc)
      from (
        select t.created_at,
               jsonb_build_object(
                 'id', t.id, 'kind', t.kind, 'status', t.status, 'is_open', t.is_open, 'bots', t.bots,
                 'created_at', t.created_at, 'starts_at', t.starts_at,
                 'players', (select coalesce(jsonb_agg(pr.display_name order by m.ord), '[]'::jsonb)
                               from (
                                 select t.host_id as uid, 0 as ord
                                 union all select t.partner_id, 1 where t.partner_state = 'joined' and t.partner_id <> t.host_id
                                 union all select x2.user_id, 2 from public.team_run_extras x2 where x2.run_id = t.id and x2.state = 'joined' and x2.user_id <> t.host_id
                               ) m join public.profiles pr on pr.id = m.uid)) as j
          from public.team_runs t
         where t.kind in ('parkour', 'deathrun')
           and t.updated_at > now() - interval '3 minutes'
           and t.status in ('lobby', 'running')
      ) x), '[]'::jsonb);
end;
$$;

-- Unregelmäßige Verben verdienen Coins
insert into public.app_settings (key, value, mod_editable) values
  ('irregular_coin_every', 5, false),   -- 1 Coin je so viele richtige Antworten
  ('irregular_coin_cap', 15, false)     -- höchstens so viele Coins pro Tag
on conflict (key) do nothing;

create or replace function public.submit_irregular(p_correct integer, p_total integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  v_today date := (now() at time zone 'Europe/Berlin')::date;
  v_every integer := greatest(public.setting('irregular_coin_every'), 1);
  v_got integer;
  v_earned integer;
begin
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  if p_correct is null or p_total is null or p_correct < 0 or p_correct > p_total or p_total > 60 then
    raise exception 'Ungültiges Ergebnis.' using errcode = '22023';
  end if;
  select coalesce(sum(l.amount), 0) into v_got
    from public.koin_ledger l
   where l.user_id = v_me and l.reason = 'irregular' and (l.created_at at time zone 'Europe/Berlin')::date = v_today;
  v_earned := least(p_correct / v_every, greatest(public.setting('irregular_coin_cap') - v_got, 0));
  if v_earned > 0 then
    perform public._grant_koins(v_me, v_earned, 'irregular');
  end if;
  return jsonb_build_object('earned', v_earned, 'cap_left', greatest(public.setting('irregular_coin_cap') - v_got - v_earned, 0));
end;
$$;

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig, p.proname
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('can_spectate', '_staff_look', 'my_run_perks', 'admin_get_staff_rights', 'admin_set_staff_rights', '_team_get', 'admin_open_runs', 'submit_irregular')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    if r.proname not like '\_%' then
      execute format('grant execute on function %s to authenticated', r.sig);
    end if;
  end loop;
end;
$$;

-- ===== 0055_entrances.sql =====
-- 0055: Auftritte im Parkour wählbar (Schwarzes Loch mit Rakete, Hammer und Blitz, Klavier). Wiederholbar.
--  * Admins dürfen alle drei im Parkour-Shop wählen. Mods dürfen nur die wählen, die der Admin ihnen freigibt (staff_rights.looks).
--  * parkour_profiles.entrance = gewählter Auftritt ('blackhole' | 'hammer' | 'piano' | 'none').
--  * `_staff_look` liefert den tatsächlich geltenden Auftritt, `my_run_perks` zusätzlich die erlaubten und den gewählten.

alter table public.staff_rights add column if not exists looks text[];
update public.staff_rights set looks = array['hammer'] where looks is null and look = 'hammer';
alter table public.parkour_profiles add column if not exists entrance text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'parkour_profiles_entrance_check') then
    alter table public.parkour_profiles add constraint parkour_profiles_entrance_check
      check (entrance is null or entrance in ('blackhole', 'hammer', 'piano', 'none'));
  end if;
end;
$$;

-- Welche Auftritte darf diese Person wählen?
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
      when p.role = 'admin' then array['blackhole', 'hammer', 'piano']
      when p.role in ('mod', 'alphamod') then coalesce((select array_agg(x order by x) from unnest(coalesce(r.looks, '{}'::text[])) x where x in ('hammer', 'piano')), '{}'::text[])
      else '{}'::text[] end
      from public.profiles p left join public.staff_rights r on r.user_id = p.id
     where p.id = p_user), '{}'::text[]);
$$;

-- Geltender Auftritt: gewählt und erlaubt, sonst Admin = Schwarzes Loch, Mod = erster erlaubter; 'none' = ohne
create or replace function public._staff_look(p_user uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_l text[] := public._allowed_looks(p_user);
  v_e text := (select pp.entrance from public.parkour_profiles pp where pp.user_id = p_user);
begin
  if coalesce(array_length(v_l, 1), 0) = 0 or v_e = 'none' then return null; end if;
  if v_e is not null and v_e = any (v_l) then return v_e; end if;
  if 'blackhole' = any (v_l) then return 'blackhole'; end if;
  return v_l[1];
end;
$$;

create or replace function public.my_run_perks()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object('spectate', public.can_spectate(), 'look', public._staff_look((select auth.uid())),
                            'allowed', to_jsonb(public._allowed_looks((select auth.uid()))),
                            'entrance', (select pp.entrance from public.parkour_profiles pp where pp.user_id = (select auth.uid())))
   where (select auth.uid()) is not null;
$$;

create or replace function public.parkour_set_entrance(p_look text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  v_l text := nullif(p_look, '');
begin
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  if v_l is not null and v_l <> 'none' and not (v_l = any (public._allowed_looks(v_me))) then
    raise exception 'Diesen Auftritt hast du nicht.' using errcode = '22023';
  end if;
  insert into public.parkour_profiles (user_id) values (v_me) on conflict do nothing;
  update public.parkour_profiles set entrance = v_l, updated_at = now() where user_id = v_me;
  return public.my_run_perks();
end;
$$;

-- Freigabe je Mod
create or replace function public.admin_get_staff_rights(p_user uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public._require_admin();
  return jsonb_build_object(
    'books_mode', (select books_mode from public.staff_rights where user_id = p_user),
    'set_mode', (select set_mode from public.staff_rights where user_id = p_user),
    'shop', (select shop from public.staff_rights where user_id = p_user),
    'timeout_max', (select timeout_max from public.staff_rights where user_id = p_user),
    'spectate', coalesce((select spectate from public.staff_rights where user_id = p_user), false),
    'looks', to_jsonb(coalesce((select looks from public.staff_rights where user_id = p_user), '{}'::text[])),
    'book_ids', coalesce((select jsonb_agg(book_id) from public.staff_book_access where user_id = p_user), '[]'::jsonb),
    'setting_keys', coalesce((select jsonb_agg(key) from public.staff_setting_access where user_id = p_user), '[]'::jsonb));
end;
$$;

drop function if exists public.admin_set_staff_rights(uuid, text, text, boolean, integer, boolean, text);
create or replace function public.admin_set_staff_rights(p_user uuid, p_books_mode text, p_set_mode text, p_shop boolean, p_timeout integer, p_spectate boolean default false, p_looks text[] default '{}')
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_looks text[] := coalesce((select array_agg(distinct x order by x) from unnest(coalesce(p_looks, '{}'::text[])) x where x in ('hammer', 'piano')), '{}'::text[]);
begin
  perform public._require_admin();
  if not exists (select 1 from public.profiles where id = p_user and role in ('mod', 'alphamod')) then
    raise exception 'Nur für Mods und Alphamods.' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(coalesce(p_looks, '{}'::text[])) x where x not in ('hammer', 'piano')) then
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
     where n.nspname = 'public' and p.proname in ('_allowed_looks', '_staff_look', 'my_run_perks', 'parkour_set_entrance', 'admin_get_staff_rights', 'admin_set_staff_rights')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    if r.proname not like '\_%' then
      execute format('grant execute on function %s to authenticated', r.sig);
    end if;
  end loop;
end;
$$;

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

-- 0058: Tageslimit für Parkour-Nachrichten (Supabase-Realtime-Kontingent) und mehr Sprünge pro Person. Wiederholbar.
--  * parkour_usage: je Tag (Berliner Zeit) die Zahl der Realtime-Nachrichten, die Spielende melden (gesendet + empfangen = so zählt Supabase).
--  * Einstellung parkour_msg_limit_k = Limit in Tausend Nachrichten pro Tag (0 = kein Limit). Änderbar unter Verwaltung → Regeln.
--  * parkour_jumps: Admin gibt einer Person mehr Sprünge (insgesamt 3 bis 10; Standard ist 2 = Doppelsprung).
create table if not exists public.parkour_usage (
  day date primary key,
  msgs bigint not null default 0
);
alter table public.parkour_usage enable row level security;
revoke all on public.parkour_usage from anon, authenticated;

create table if not exists public.parkour_jumps (
  user_id uuid primary key references auth.users (id) on delete cascade,
  jumps integer not null check (jumps between 3 and 10),
  set_by uuid,
  created_at timestamptz not null default now()
);
alter table public.parkour_jumps enable row level security;
revoke all on public.parkour_jumps from anon, authenticated;

-- Standard: 60 000 Nachrichten pro Tag (≈ 1,8 Mio. im Monat, das Free-Kontingent von Supabase sind 2,2 Mio.)
insert into public.app_settings (key, value, mod_editable) values ('parkour_msg_limit_k', 60, false)
on conflict (key) do nothing;

create or replace function public._parkour_usage_state(p_msgs bigint)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'msgs', p_msgs,
    'limit', public.setting('parkour_msg_limit_k')::bigint * 1000,
    'blocked', public.setting('parkour_msg_limit_k') > 0 and p_msgs >= public.setting('parkour_msg_limit_k')::bigint * 1000
  );
$$;

-- Verbrauch melden (Spielende rufen das alle paar Sekunden mit ihren neuen Nachrichten auf) und Stand zurückbekommen.
create or replace function public.parkour_usage_add(p_n integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_msgs bigint;
begin
  if (select auth.uid()) is null then
    raise exception 'Nicht angemeldet.' using errcode = '42501';
  end if;
  insert into public.parkour_usage (day, msgs)
  values ((now() at time zone 'Europe/Berlin')::date, greatest(0, least(coalesce(p_n, 0), 30000)))
  on conflict (day) do update set msgs = public.parkour_usage.msgs + excluded.msgs
  returning msgs into v_msgs;
  return public._parkour_usage_state(v_msgs);
end;
$$;

create or replace function public.parkour_usage_get()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'Nicht angemeldet.' using errcode = '42501';
  end if;
  return public._parkour_usage_state(coalesce((select msgs from public.parkour_usage where day = (now() at time zone 'Europe/Berlin')::date), 0));
end;
$$;

-- Sprünge insgesamt je Person ({user_id: anzahl}); jede angemeldete Person darf fragen.
create or replace function public.parkour_jumps_list(p_ids uuid[])
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_object_agg(j.user_id::text, j.jumps), '{}'::jsonb)
    from public.parkour_jumps j
   where j.user_id = any (coalesce(p_ids, '{}'::uuid[]))
     and (select auth.uid()) is not null;
$$;

create or replace function public.parkour_jumps_set(p_user uuid, p_jumps integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if (select auth.uid()) is null or not public.is_admin() then
    raise exception 'Nur Admins dürfen das.' using errcode = '42501';
  end if;
  if p_jumps is null or p_jumps <= 2 then
    delete from public.parkour_jumps where user_id = p_user;
  else
    insert into public.parkour_jumps (user_id, jumps, set_by) values (p_user, least(p_jumps, 10), (select auth.uid()))
    on conflict (user_id) do update set jumps = excluded.jumps, set_by = excluded.set_by;
  end if;
end;
$$;

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig, p.proname
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('_parkour_usage_state', 'parkour_usage_add', 'parkour_usage_get', 'parkour_jumps_list', 'parkour_jumps_set')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    if r.proname <> '_parkour_usage_state' then
      execute format('grant execute on function %s to authenticated', r.sig);
    end if;
  end loop;
end;
$$;

-- 0059: Parkour-Limit als Monatsbudget mit Tages-Spielraum. Wiederholbar.
--  Das Spiel läuft jetzt über ein zweites Supabase-Projekt (nur Realtime). Gezählt wird weiter hier (parkour_usage).
--  * parkour_msg_month_k = Budget in Tausend Nachrichten pro Kalendermonat (0 = kein Limit), Standard 1800 (Free-Kontingent 2,2 Mio.).
--  * An einem Tag darf bis zum 4-fachen des Tagesschnitts der übrigen Tage verbraucht werden (viel gespielt wird nicht jeden Tag gleich viel).
--  * Gesperrt ist, wenn das Monatsbudget oder der Tagesrahmen erreicht ist.
insert into public.app_settings (key, value, mod_editable) values ('parkour_msg_month_k', 1800, false)
on conflict (key) do nothing;
delete from public.app_settings where key = 'parkour_msg_limit_k';

create or replace function public._parkour_usage_state(p_msgs bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_today date := (now() at time zone 'Europe/Berlin')::date;
  v_first date := date_trunc('month', v_today)::date;
  v_k integer := public.setting('parkour_msg_month_k');
  v_budget bigint := v_k::bigint * 1000;
  v_before bigint;
  v_left integer;
  v_day_cap bigint;
  v_month bigint;
begin
  select coalesce(sum(msgs), 0) into v_before from public.parkour_usage where day >= v_first and day < v_today;
  v_month := v_before + p_msgs;
  v_left := (date_trunc('month', v_today) + interval '1 month')::date - v_today;
  v_day_cap := (greatest(v_budget - v_before, 0) / greatest(v_left, 1)) * 4;
  return jsonb_build_object(
    'msgs', p_msgs,
    'limit', v_day_cap,
    'month', v_month,
    'budget', v_budget,
    'blocked', v_k > 0 and (v_month >= v_budget or p_msgs >= v_day_cap)
  );
end;
$$;

do $$
declare r record;
begin
  for r in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = '_parkour_usage_state'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
  end loop;
end;
$$;

-- 0060: Hausaufgaben (Mods und Admins tragen ein, jede Person hakt für sich ab) und Website-Links (Admins). Wiederholbar.
create table if not exists public.homework (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 120),
  body text not null default '' check (char_length(body) <= 2000),
  subject text not null default '' check (char_length(subject) <= 40),
  due_date date,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.homework enable row level security;
revoke all on public.homework from anon, authenticated;

create table if not exists public.homework_done (
  homework_id uuid not null references public.homework (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  done_at timestamptz not null default now(),
  primary key (homework_id, user_id)
);
alter table public.homework_done enable row level security;
revoke all on public.homework_done from anon, authenticated;
create index if not exists homework_done_user_idx on public.homework_done (user_id);

create table if not exists public.site_links (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 80),
  url text not null check (url ~* '^https?://' and char_length(url) <= 500),
  description text not null default '' check (char_length(description) <= 300),
  image_url text not null default '' check (image_url = '' or (image_url ~* '^https?://' and char_length(image_url) <= 500)),
  sort integer not null default 0,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.site_links enable row level security;
revoke all on public.site_links from anon, authenticated;

-- Hausaufgaben der letzten 30 Tage und alle kommenden, mit „erledigt“ für mich und der Zahl Erledigter.
drop function if exists public.homework_list();
create function public.homework_list()
returns table (id uuid, title text, body text, subject text, due_date date, created_at timestamptz, created_by_name text, done boolean, done_count bigint)
language sql
stable
security definer
set search_path = public
as $$
  select h.id, h.title, h.body, h.subject, h.due_date, h.created_at,
         (select p.display_name from public.profiles p where p.id = h.created_by),
         exists (select 1 from public.homework_done d where d.homework_id = h.id and d.user_id = (select auth.uid())),
         (select count(*) from public.homework_done d where d.homework_id = h.id)
    from public.homework h
   where (select auth.uid()) is not null and not public.is_blocked()
     and coalesce(h.due_date, h.created_at::date) >= current_date - 30
   order by h.due_date nulls last, h.created_at desc
   limit 200;
$$;

create or replace function public.homework_save(p_id uuid, p_title text, p_body text, p_subject text, p_due date)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid;
begin
  if not public.is_staff() then
    raise exception 'Nur für Mods und Admins.' using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(p_title, ''))) not between 1 and 120 then
    raise exception 'Der Titel braucht 1 bis 120 Zeichen.' using errcode = '22023';
  end if;
  if p_id is null then
    insert into public.homework (title, body, subject, due_date, created_by)
    values (btrim(p_title), left(coalesce(p_body, ''), 2000), left(btrim(coalesce(p_subject, '')), 40), p_due, (select auth.uid()))
    returning id into v_id;
  else
    update public.homework
       set title = btrim(p_title), body = left(coalesce(p_body, ''), 2000), subject = left(btrim(coalesce(p_subject, '')), 40),
           due_date = p_due, updated_at = now()
     where id = p_id returning id into v_id;
    if v_id is null then
      raise exception 'Hausaufgabe nicht gefunden.' using errcode = 'P0002';
    end if;
  end if;
  return v_id;
end;
$$;

create or replace function public.homework_delete(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_staff() then
    raise exception 'Nur für Mods und Admins.' using errcode = '42501';
  end if;
  delete from public.homework where id = p_id;
end;
$$;

-- Für mich abhaken oder wieder öffnen.
create or replace function public.homework_set_done(p_id uuid, p_done boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if (select auth.uid()) is null or public.is_blocked() then
    raise exception 'Nicht erlaubt.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.homework where id = p_id) then
    raise exception 'Hausaufgabe nicht gefunden.' using errcode = 'P0002';
  end if;
  if coalesce(p_done, false) then
    insert into public.homework_done (homework_id, user_id) values (p_id, (select auth.uid())) on conflict do nothing;
  else
    delete from public.homework_done where homework_id = p_id and user_id = (select auth.uid());
  end if;
end;
$$;

drop function if exists public.site_links_list();
create function public.site_links_list()
returns table (id uuid, title text, url text, description text, image_url text, sort integer)
language sql
stable
security definer
set search_path = public
as $$
  select s.id, s.title, s.url, s.description, s.image_url, s.sort
    from public.site_links s
   where (select auth.uid()) is not null and not public.is_blocked()
   order by s.sort, s.created_at;
$$;

create or replace function public.site_link_save(p_id uuid, p_title text, p_url text, p_description text, p_image text, p_sort integer)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid;
begin
  if not public.is_admin() then
    raise exception 'Nur für Admins.' using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(p_title, ''))) not between 1 and 80 then
    raise exception 'Der Titel braucht 1 bis 80 Zeichen.' using errcode = '22023';
  end if;
  if btrim(coalesce(p_url, '')) !~* '^https?://[^\s]+$' or char_length(btrim(p_url)) > 500 then
    raise exception 'Die Adresse muss mit https:// beginnen.' using errcode = '22023';
  end if;
  if btrim(coalesce(p_image, '')) <> '' and (btrim(p_image) !~* '^https?://[^\s]+$' or char_length(btrim(p_image)) > 500) then
    raise exception 'Die Bildadresse muss mit https:// beginnen.' using errcode = '22023';
  end if;
  if p_id is null then
    insert into public.site_links (title, url, description, image_url, sort, created_by)
    values (btrim(p_title), btrim(p_url), left(coalesce(p_description, ''), 300), btrim(coalesce(p_image, '')), coalesce(p_sort, 0), (select auth.uid()))
    returning id into v_id;
  else
    update public.site_links
       set title = btrim(p_title), url = btrim(p_url), description = left(coalesce(p_description, ''), 300),
           image_url = btrim(coalesce(p_image, '')), sort = coalesce(p_sort, 0)
     where id = p_id returning id into v_id;
    if v_id is null then
      raise exception 'Link nicht gefunden.' using errcode = 'P0002';
    end if;
  end if;
  return v_id;
end;
$$;

create or replace function public.site_link_delete(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Nur für Admins.' using errcode = '42501';
  end if;
  delete from public.site_links where id = p_id;
end;
$$;

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('homework_list', 'homework_save', 'homework_delete', 'homework_set_done', 'site_links_list', 'site_link_save', 'site_link_delete')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;
end;
$$;

-- 0061: Neue Konten müssen von einem Admin freigeschaltet werden. Wiederholbar.
--  * profiles.approved: bestehende Konten bleiben freigeschaltet (Standard true); neue Selbst-Registrierungen starten gesperrt,
--    solange die Einstellung signup_approval = 1 ist (Verwaltung → Regeln, Standard 1). Von Admins angelegte Konten sind sofort frei.
--  * Wer nicht freigeschaltet ist, gilt serverseitig wie gesperrt (is_blocked) und sieht in der App einen Warte-Bildschirm.
--  * Die Bestätigungs-E-Mail schaltest du im Supabase-Dashboard aus (Authentication → Sign In / Providers → Email → „Confirm email“ aus).
alter table public.profiles add column if not exists approved boolean not null default true;

insert into public.app_settings (key, value, mod_editable) values ('signup_approval', 1, false)
on conflict (key) do nothing;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  wanted text := nullif(btrim(coalesce(new.raw_user_meta_data ->> 'display_name', '')), '');
  final_name text;
begin
  if wanted is null or char_length(wanted) < 2 then
    wanted := 'Lerner';
  end if;
  wanted := left(wanted, 24);
  final_name := wanted;

  if exists (select 1 from public.profiles p where lower(p.display_name) = lower(final_name)) then
    final_name := wanted || '-' || substr(replace(new.id::text, '-', ''), 1, 5);
  end if;

  insert into public.profiles (id, display_name, approved) values (new.id, final_name, public.setting('signup_approval') = 0);
  insert into public.user_settings (user_id) values (new.id);
  return new;
end;
$$;

-- Admin-Konten (admin_create_user) sind sofort freigeschaltet.
create or replace function public._create_user(p_email text, p_password text, p_name text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_id uuid := gen_random_uuid();
  v_final text;
begin
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or char_length(v_email) > 200 then
    raise exception 'Ungültige E-Mail-Adresse.' using errcode = '22023';
  end if;
  if p_password is null or char_length(p_password) < 6 or char_length(p_password) > 72 then
    raise exception 'Das Kennwort braucht 6 bis 72 Zeichen.' using errcode = '22023';
  end if;
  if exists (select 1 from auth.users where lower(email) = v_email) then
    raise exception 'Diese E-Mail gibt es schon.' using errcode = '23505';
  end if;
  if v_name is null then
    v_name := split_part(v_email, '@', 1);
  end if;
  v_name := left(v_name, 24);

  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                          raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                          confirmation_token, email_change, email_change_token_new, recovery_token)
  values ('00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated', v_email,
          extensions.crypt(p_password, extensions.gen_salt('bf')), now(),
          '{"provider":"email","providers":["email"]}'::jsonb, jsonb_build_object('display_name', v_name), now(), now(),
          '', '', '', '');
  insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (gen_random_uuid(), v_id, v_id::text,
          jsonb_build_object('sub', v_id::text, 'email', v_email, 'email_verified', true, 'phone_verified', false),
          'email', now(), now(), now());

  update public.profiles set approved = true where id = v_id;
  select display_name into v_final from public.profiles where id = v_id;
  return jsonb_build_object('user_id', v_id, 'email', v_email, 'display_name', v_final);
end;
$$;

create or replace function public.is_blocked()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select p.blocked or not p.approved from public.profiles p where p.id = (select auth.uid())), false);
$$;

create or replace function public.protect_profile_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (select auth.uid()) is not null
     and (new.role is distinct from old.role or new.blocked is distinct from old.blocked or new.approved is distinct from old.approved)
     and not public.is_admin() then
    raise exception 'Keine Berechtigung.' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- Freischalten (oder wieder auf „wartet“ setzen).
create or replace function public.admin_set_approved(p_user uuid, p_approved boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._require_admin();
  if not exists (select 1 from public.profiles where id = p_user) then
    raise exception 'Nutzer nicht gefunden.' using errcode = 'P0002';
  end if;
  if p_user = (select auth.uid()) and not coalesce(p_approved, false) then
    raise exception 'Du kannst dich nicht selbst auf „wartet“ setzen.' using errcode = '42501';
  end if;
  update public.profiles set approved = coalesce(p_approved, false) where id = p_user;
end;
$$;

-- Wie viele warten? (für das Zeichen am Menüpunkt Verwaltung)
create or replace function public.admin_pending_count()
returns integer
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public._require_admin();
  return (select count(*)::integer from public.profiles where not approved and not blocked);
end;
$$;

drop function if exists public.admin_list_users();
create function public.admin_list_users()
returns table (
  user_id uuid, display_name text, email text, role text, blocked boolean,
  created_at timestamptz, last_sign_in_at timestamptz,
  book_count integer, public_book_count integer, vocab_count integer,
  progress_count integer, session_count integer, answer_count integer, approx_bytes bigint,
  koins bigint, approved boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public._require_admin();
  return query
  select
    p.id, p.display_name, u.email::text, p.role, p.blocked, p.created_at, u.last_sign_in_at,
    (select count(*) from public.books b where b.owner_id = p.id)::integer,
    (select count(*) from public.books b where b.owner_id = p.id and b.is_public)::integer,
    (select count(*) from public.vocabulary v join public.books b on b.id = v.book_id where b.owner_id = p.id)::integer,
    (select count(*) from public.user_vocabulary_progress x where x.user_id = p.id)::integer,
    (select count(*) from public.learning_sessions s where s.user_id = p.id)::integer,
    (select count(*) from public.learning_answers a where a.user_id = p.id)::integer,
    public._user_storage_bytes(p.id),
    coalesce((select w.balance from public.koin_wallets w where w.user_id = p.id), 0),
    p.approved
  from public.profiles p
  join auth.users u on u.id = p.id
  order by p.created_at;
end;
$$;

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('admin_set_approved', 'admin_pending_count', 'admin_list_users')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;
end;
$$;

-- 0062: Ranglisten für Pi (Stellen ohne Tipp) und Flaggen (gemeisterte Länder). Wiederholbar.
create table if not exists public.memo_scores (
  user_id uuid not null references auth.users (id) on delete cascade,
  game text not null check (game in ('pi', 'flags')),
  best integer not null check (best >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, game)
);
alter table public.memo_scores enable row level security;
revoke all on public.memo_scores from anon, authenticated;

-- Bestwert melden (es zählt immer der höchste).
drop function if exists public.memo_score_submit(text, integer); -- Rückgabetyp wurde in 0064 geändert, so geht die Reihenfolge immer
create or replace function public.memo_score_submit(p_game text, p_score integer)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare v_best integer;
begin
  if (select auth.uid()) is null or public.is_blocked() then
    raise exception 'Nicht erlaubt.' using errcode = '42501';
  end if;
  if p_game not in ('pi', 'flags') then
    raise exception 'Unbekanntes Spiel.' using errcode = '22023';
  end if;
  if p_score is null or p_score < 0 then
    raise exception 'Ungültiger Wert.' using errcode = '22023';
  end if;
  if p_game = 'pi' and p_score > 500 then
    raise exception 'Ungültiger Wert.' using errcode = '22023';
  end if;
  if p_game = 'flags' and p_score > 1500 then
    raise exception 'Ungültiger Wert.' using errcode = '22023';
  end if;
  insert into public.memo_scores (user_id, game, best) values ((select auth.uid()), p_game, p_score)
  on conflict (user_id, game) do update
    set best = greatest(public.memo_scores.best, excluded.best),
        updated_at = case when excluded.best > public.memo_scores.best then now() else public.memo_scores.updated_at end
  returning best into v_best;
  return v_best;
end;
$$;

drop function if exists public.memo_leaderboard(text);
create function public.memo_leaderboard(p_game text)
returns table (rank bigint, user_id uuid, display_name text, best integer, is_me boolean)
language sql
stable
security definer
set search_path = public
as $$
  select rank() over (order by s.best desc, s.updated_at) as rank,
         s.user_id, p.display_name, s.best, s.user_id = (select auth.uid())
    from public.memo_scores s
    join public.profiles p on p.id = s.user_id
   where s.game = p_game and s.best > 0 and not p.blocked and p.approved
     and (select auth.uid()) is not null and not public.is_blocked()
   order by s.best desc, s.updated_at
   limit 30;
$$;

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('memo_score_submit', 'memo_leaderboard')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;
end;
$$;

-- 0063: Chat: @everyone markiert alle, !pay @everyone 100 schenkt jedem anderen Konto 100 Coins, !pay @random 100 einer zufälligen Person.
--  Normale Nutzer zahlen die Coins von ihrem Guthaben (Tageslimit und Höchstbetrag pro Person gelten); Admins erzeugen sie neu.
--  Wiederholbar. Gebaut auf post_chat aus 0017 und notify_poll aus 0020.

create or replace function public.post_chat(p_body text)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  v_body text := btrim(coalesce(p_body, ''));
  v_id bigint;
  v_m text[];
  v_to uuid;
  v_to_name text;
  v_me_name text;
  v_amount bigint;
  v_sent bigint;
  v_rest text;
  v_muted timestamptz;
  v_admin boolean := public.is_admin();
  v_all boolean;
  v_targets uuid[];
  v_count integer;
begin
  perform public._feature_guard('chat');
  if v_me is null or public.is_blocked() then
    raise exception 'Kein Zugriff.' using errcode = '42501';
  end if;
  select muted_until into v_muted from public.profiles where id = v_me;
  if v_muted is not null and v_muted > now() then
    raise exception 'Du bist stummgeschaltet – noch % Sekunden.', ceil(extract(epoch from (v_muted - now())))::integer
      using errcode = '42501';
  end if;
  if char_length(v_body) < 1 or char_length(v_body) > 500 then
    raise exception 'Die Nachricht braucht 1 bis 500 Zeichen.' using errcode = '22023';
  end if;
  if exists (select 1 from public.chat_messages where user_id = v_me and created_at > now() - interval '1 second') then
    raise exception 'Nicht so schnell – warte kurz.' using errcode = '22023';
  end if;
  if (select count(*) from public.chat_messages where user_id = v_me and created_at > now() - interval '1 minute')
       >= greatest(public.setting('chat_per_minute'), 1) then
    raise exception 'Zu viele Nachrichten – warte eine Minute.' using errcode = '22023';
  end if;

  -- Befehl: !pay @Anzeigename 100   (Admins auch: 1k, 2,5m, 3mrd, 1b)
  if v_body ~* '^!pay(\s|$)' then
    v_m := regexp_match(v_body, '^!pay\s+@?(.+?)\s+(\S+)$', 'i');
    if v_m is null then
      raise exception 'So geht es: !pay @Anzeigename 100' using errcode = '22023';
    end if;
    v_amount := public._parse_coins(v_m[2], v_admin);
    if v_amount is null then
      raise exception 'So geht es: !pay @Anzeigename 100' using errcode = '22023';
    end if;
    if v_amount < 1 then
      raise exception 'Der Betrag muss mindestens 1 sein.' using errcode = '22023';
    end if;
    if v_admin then
      if v_amount > 1000000000000000 then
        raise exception 'Höchstens 1.000.000.000.000.000 auf einmal.' using errcode = '22023';
      end if;
    elsif v_amount > public.setting('pay_max') then
      raise exception 'Pro Überweisung sind höchstens % Coins erlaubt.', public.setting('pay_max') using errcode = '22023';
    end if;
    select display_name into v_me_name from public.profiles where id = v_me;
    -- @everyone: allen anderen aktiven Konten je den Betrag; @random: einer zufälligen Person
    if lower(btrim(v_m[1])) in ('everyone', 'random') then
      v_all := lower(btrim(v_m[1])) = 'everyone';
      select coalesce(array_agg(x.id), '{}'::uuid[]) into v_targets
        from (
          select p.id from public.profiles p
           where p.id <> v_me and not p.blocked and p.approved
           order by case when v_all then 0 else random() end
           limit case when v_all then 100000 else 1 end) x;
      v_count := coalesce(array_length(v_targets, 1), 0);
      if v_count = 0 then
        raise exception 'Es gibt niemanden, der Coins bekommen kann.' using errcode = 'P0002';
      end if;
      if v_admin then
        null; -- Admins erzeugen die Coins neu
      else
        if v_amount * v_count > 100000000 then
          raise exception 'Das wäre zu viel auf einmal.' using errcode = '22023';
        end if;
        select coalesce(sum(-l.amount), 0) into v_sent
          from public.koin_ledger l
         where l.user_id = v_me and l.reason = 'pay_out'
           and (l.created_at at time zone 'Europe/Berlin')::date = (now() at time zone 'Europe/Berlin')::date;
        if v_sent + v_amount * v_count > public.setting('pay_daily_cap') then
          raise exception 'Tageslimit: Du kannst heute noch % Coins verschicken (das wären % an % Personen).', greatest(public.setting('pay_daily_cap') - v_sent, 0), v_amount * v_count, v_count using errcode = '22023';
        end if;
        if coalesce((select balance from public.koin_wallets where user_id = v_me), 0) < v_amount * v_count then
          raise exception 'Nicht genug Coins: % Personen × % = %.', v_count, v_amount, v_amount * v_count using errcode = '23514';
        end if;
        perform public._grant_koins(v_me, -(v_amount * v_count), 'pay_out', 'everyone');
      end if;
      foreach v_to in array v_targets loop
        perform public._grant_koins(v_to, v_amount, 'pay_in', v_me::text);
        insert into public.user_messages (user_id, from_id, body)
        values (v_to, null, v_me_name || ' hat dir ' || public._fmt_coins(v_amount) || ' Coins geschickt. 💵');
      end loop;
      if v_all then
        insert into public.chat_messages (user_id, body, kind)
        values (v_me, v_me_name || ' hat allen (' || v_count || ' Personen) je ' || public._fmt_coins(v_amount) || ' Coins geschickt 🎁', 'pay')
        returning chat_messages.id into v_id;
      else
        select display_name into v_to_name from public.profiles where id = v_targets[1];
        insert into public.chat_messages (user_id, body, kind)
        values (v_me, v_me_name || ' hat zufällig ' || v_to_name || ' ' || public._fmt_coins(v_amount) || ' Coins geschickt 🎲', 'pay')
        returning chat_messages.id into v_id;
      end if;
      return v_id;
    end if;

    select p.id, p.display_name into v_to, v_to_name
      from public.profiles p where lower(p.display_name) = lower(btrim(v_m[1])) and not p.blocked;
    if v_to is null then
      raise exception 'Spieler „%“ nicht gefunden.', btrim(v_m[1]) using errcode = 'P0002';
    end if;
    if v_to = v_me then
      raise exception 'Du kannst dir nicht selbst Coins schicken.' using errcode = '22023';
    end if;
    select display_name into v_me_name from public.profiles where id = v_me;
    if v_admin then
      perform public._grant_koins(v_to, v_amount, 'pay_in', v_me::text);
    else
      select coalesce(sum(-l.amount), 0) into v_sent
        from public.koin_ledger l
       where l.user_id = v_me and l.reason = 'pay_out'
         and (l.created_at at time zone 'Europe/Berlin')::date = (now() at time zone 'Europe/Berlin')::date;
      if v_sent + v_amount > public.setting('pay_daily_cap') then
        raise exception 'Tageslimit: Du kannst heute noch % Coins verschicken.', greatest(public.setting('pay_daily_cap') - v_sent, 0) using errcode = '22023';
      end if;
      if coalesce((select balance from public.koin_wallets where user_id = v_me), 0) < v_amount then
        raise exception 'Nicht genug Coins.' using errcode = '23514';
      end if;
      perform public._grant_koins(v_me, -v_amount, 'pay_out', v_to::text);
      perform public._grant_koins(v_to, v_amount, 'pay_in', v_me::text);
    end if;
    insert into public.user_messages (user_id, from_id, body)
    values (v_to, null, v_me_name || ' hat dir ' || public._fmt_coins(v_amount) || ' Coins geschickt. 💵');
    insert into public.chat_messages (user_id, body, kind)
    values (v_me, v_me_name || ' hat ' || v_to_name || ' ' || public._fmt_coins(v_amount) || ' Coins geschickt 💵', 'pay')
    returning chat_messages.id into v_id;
    return v_id;
  end if;

  -- Befehl: !whisper @Anzeigename Text  (nur Absender und Empfänger sehen die Nachricht)
  if v_body ~* '^!whisper(\s|$)' then
    v_rest := btrim(regexp_replace(v_body, '^!whisper\s*@?', '', 'i'));
    -- längster passender Anzeigename gewinnt (Namen dürfen Leerzeichen enthalten)
    select p.id, p.display_name into v_to, v_to_name
      from public.profiles p
     where not p.blocked
       and lower(left(v_rest, char_length(p.display_name) + 1)) = lower(p.display_name) || ' '
     order by char_length(p.display_name) desc
     limit 1;
    if v_to is null then
      raise exception 'So geht es: !whisper @Anzeigename Text' using errcode = '22023';
    end if;
    if v_to = v_me then
      raise exception 'Du kannst dir nicht selbst flüstern.' using errcode = '22023';
    end if;
    v_rest := btrim(substr(v_rest, char_length(v_to_name) + 2));
    if char_length(v_rest) < 1 then
      raise exception 'So geht es: !whisper @Anzeigename Text' using errcode = '22023';
    end if;
    insert into public.chat_messages (user_id, body, kind, recipient_id)
    values (v_me, v_rest, 'whisper', v_to) returning chat_messages.id into v_id;
    return v_id;
  end if;

  if exists (select 1 from public.chat_messages where user_id = v_me and body = v_body and created_at > now() - interval '30 seconds') then
    raise exception 'Diese Nachricht hast du gerade schon gesendet.' using errcode = '22023';
  end if;
  insert into public.chat_messages (user_id, body) values (v_me, v_body) returning chat_messages.id into v_id;
  return v_id;
end;
$$;
