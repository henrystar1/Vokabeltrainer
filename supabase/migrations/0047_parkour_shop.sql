-- 0047: Parkour-Shop: zusätzliche Herzen, Körperfarben und Hüte (werden im Spiel angezeigt).
--  * parkour_profiles: pro Person gekaufte Extra-Herzen, besessene Cosmetics, ausgerüstete Farbe/Hut (nur über RPC).
--  * parkour_shop_get / parkour_shop_buy / parkour_equip.
--  * team_get liefert pro Person pk_hearts, pk_color, pk_hat (die Herzen beider Personen werden zum gemeinsamen Vorrat addiert).
-- Einstellungen: parkour_heart_price (je Herz Preis × Anzahl, also 100/200/300 …), parkour_heart_max,
--   parkour_color_price, parkour_hat_price (Premium ×3).
-- Wiederholbar. Nach 0046 ausführen.

insert into public.app_settings (key, value, mod_editable) values
  ('parkour_heart_price', 100, false),
  ('parkour_heart_max', 5, false),
  ('parkour_color_price', 60, false),
  ('parkour_hat_price', 80, false)
on conflict (key) do nothing;

create table if not exists public.parkour_profiles (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  extra_hearts integer not null default 0 check (extra_hearts between 0 and 50),
  owned text[] not null default '{}',
  color text,
  hat text,
  updated_at timestamptz not null default now()
);
alter table public.parkour_profiles enable row level security;
revoke all on public.parkour_profiles from anon, authenticated;

-- Artikelkatalog (IDs wie in src/features/parkour/cosmetics.ts)
create or replace function public._pk_price(p_item text)
returns integer
language sql
stable
set search_path = public
as $$
  select case
    when p_item in ('color:gold', 'color:neon', 'color:regenbogen') then 3 * public.setting('parkour_color_price')
    when p_item in ('hat:krone', 'hat:feuer') then 3 * public.setting('parkour_hat_price')
    when p_item in ('color:rot', 'color:orange', 'color:gelb', 'color:gruen', 'color:tuerkis', 'color:blau', 'color:lila', 'color:pink', 'color:weiss') then public.setting('parkour_color_price')
    when p_item in ('hat:kappe', 'hat:zylinder', 'hat:abschluss', 'hat:strohhut', 'hat:schleife') then public.setting('parkour_hat_price')
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
    'color', pp.color, 'hat', pp.hat,
    'owned', to_jsonb(coalesce(pp.owned, '{}'::text[])),
    'color_price', public.setting('parkour_color_price'), 'hat_price', public.setting('parkour_hat_price'))
  from (select 1) x left join public.parkour_profiles pp on pp.user_id = p_user;
$$;

create or replace function public.parkour_shop_get()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if (select auth.uid()) is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  return public._pk_state((select auth.uid()));
end;
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
           updated_at = now()
     where user_id = v_me;
  end if;
  return public._pk_state(v_me);
end;
$$;

-- Farbe/Hut ausrüsten (leer = Standard). Nur Gekauftes.
create or replace function public.parkour_equip(p_color text, p_hat text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  v_c text := nullif(p_color, '');
  v_h text := nullif(p_hat, '');
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
  update public.parkour_profiles set color = v_c, hat = v_h, updated_at = now() where user_id = v_me;
  return public._pk_state(v_me);
end;
$$;

-- team_get: wie 0045, plus pk_hearts / pk_color / pk_hat je Person
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
               'role', case when pr.tags_hidden then 'user' else pr.role end, 'is_host', pr.id = t.host_id,
               'pk_hearts', coalesce(pp.extra_hearts, 0), 'pk_color', pp.color, 'pk_hat', pp.hat)
             order by (pr.id <> t.host_id))
        from public.profiles pr left join public.parkour_profiles pp on pp.user_id = pr.id
       where pr.id in (t.host_id, t.partner_id)));
end;
$$;


do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('team_get', 'parkour_shop_get', 'parkour_shop_buy', 'parkour_equip')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;
  revoke all on function public._pk_price(text) from public, anon, authenticated;
  revoke all on function public._pk_state(uuid) from public, anon, authenticated;
end;
$$;
