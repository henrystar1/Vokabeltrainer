-- 0045: Team-Parkour: 8 Level, gemeinsame Herzen, Coins nach Fortschritt, Duo-Bestenliste.
--  * Coins: parkour_coins_level je geschafftem Level, parkour_coins_cp je erreichtem Checkpoint, parkour_coins_bonus für alle 8 Level.
--  * team_parkour_finish(p_id, p_millis, p_deaths, p_levels, p_cps): beendet den Lauf (alle 8 Level = gewonnen, sonst verloren), zahlt nach Fortschritt.
--  * team_parkour_board(): beste Läufe je Duo.
-- Wiederholbar. Nach 0044 ausführen.

alter table public.team_runs add column if not exists levels integer;
alter table public.team_runs add column if not exists cps integer;

insert into public.app_settings (key, value, mod_editable) values
  ('parkour_coins_level', 8, false),
  ('parkour_coins_cp', 2, false),
  ('parkour_coins_bonus', 30, false)
on conflict (key) do nothing;

drop function if exists public.team_parkour_finish(uuid, integer, integer);
create or replace function public.team_parkour_finish(p_id uuid, p_millis integer, p_deaths integer, p_levels integer, p_cps integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  t public.team_runs;
  v_lv integer := least(greatest(coalesce(p_levels, 0), 0), 8);
  v_cp integer := least(greatest(coalesce(p_cps, 0), 0), 60);
  v_coins integer;
begin
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  select * into t from public.team_runs where id = p_id for update;
  if not found or t.kind <> 'parkour' or t.status <> 'running' or v_me not in (t.host_id, t.partner_id) then return; end if;
  -- Ein Level dauert mindestens 12 Sekunden; schneller kann die Meldung nicht stimmen.
  if t.starts_at + make_interval(secs => 12 * v_lv) > now() then return; end if;
  v_coins := v_lv * public.setting('parkour_coins_level') + v_cp * public.setting('parkour_coins_cp')
             + case when v_lv >= 8 then public.setting('parkour_coins_bonus') else 0 end;
  update public.team_runs
     set status = case when v_lv >= 8 then 'won' else 'lost' end, finished_at = now(), updated_at = now(),
         millis = least(greatest(coalesce(p_millis, 0), 0), 7200000), deaths = least(greatest(coalesce(p_deaths, 0), 0), 9999),
         levels = v_lv, cps = v_cp, step = v_lv,
         paid_host = public._team_pay(t.host_id, v_coins, p_id::text),
         paid_partner = public._team_pay(t.partner_id, v_coins, p_id::text)
   where id = p_id;
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
  if not found or v_me not in (t.host_id, t.partner_id)
     or (v_me = t.partner_id and t.partner_state in ('declined') and t.status = 'lobby') then
    raise exception 'Team-Parcours nicht gefunden.' using errcode = 'P0002';
  end if;
  if (t.status = 'running' and t.updated_at < now() - case when t.kind = 'parkour' then interval '40 minutes' else interval '10 minutes' end) or (t.status = 'lobby' and t.created_at < now() - interval '30 minutes') then
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
    'reward', case when t.kind = 'parkour' then public.setting('team_parkour_reward') else public.setting('team_reward') end, 'paid', case when v_host then t.paid_host else t.paid_partner end,
    'my_question', v_my,
    'people', (
      select jsonb_agg(jsonb_build_object(
               'user_id', pr.id, 'name', pr.display_name, 'avatar_id', pr.avatar_id, 'color_id', pr.color_id, 'effect_id', pr.effect_id,
               'tag_id', case when pr.tags_hidden then null else pr.tag_id end, 'theme_id', pr.theme_id,
               'role', case when pr.tags_hidden then 'user' else pr.role end, 'is_host', pr.id = t.host_id)
             order by (pr.id <> t.host_id))
        from public.profiles pr where pr.id in (t.host_id, t.partner_id)));
end;
$$;

create or replace function public.team_parkour_board()
returns table (host_name text, host_avatar_id text, host_color_id text, partner_name text, partner_avatar_id text, partner_color_id text,
               levels integer, cps integer, millis integer, deaths integer, finished_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select h.display_name, h.avatar_id, h.color_id, p.display_name, p.avatar_id, p.color_id, x.levels, x.cps, x.millis, x.deaths, x.finished_at
    from (
      select distinct on (least(t.host_id, t.partner_id), greatest(t.host_id, t.partner_id)) t.*
        from public.team_runs t
       where t.kind = 'parkour' and t.status in ('won', 'lost') and t.levels is not null
       order by least(t.host_id, t.partner_id), greatest(t.host_id, t.partner_id), t.levels desc, t.cps desc, t.millis asc
    ) x
    join public.profiles h on h.id = x.host_id
    join public.profiles p on p.id = x.partner_id
   where (select auth.uid()) is not null and not public.is_blocked()
   order by x.levels desc, x.cps desc, x.millis asc
   limit 20;
$$;

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('team_parkour_finish', 'team_get', 'team_parkour_board')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;
end;
$$;
