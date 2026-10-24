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
