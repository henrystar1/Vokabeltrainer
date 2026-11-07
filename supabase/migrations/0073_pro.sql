-- ============================================================================
-- 0073: Vokabeltrainer Pro (über Plus). Wiederholbar. Nach 0072 ausführen.
-- Pro zählt überall auch als Plus. Alle Zahlen stehen in Verwaltung → Plus.
--  * Preis: 1 Tag 800 Coins, längere Stufen günstiger pro Tag
--  * mehr Coins/Punkte, bessere Gambling-Chance, Foto-Scan, Parkour zuschauen, begrenztes Heilen,
--    +3 Herzen, feste Sprünge (mit gekauftem Dreiersprung einer mehr), keine Vokabeln im Parkour,
--    höheres Parkour-Limit, alle Premium-Skins, bessere Adventskalender-Türchen, mehr Quests
-- ============================================================================

alter table public.profiles add column if not exists pro_until timestamptz;
alter table public.parkour_profiles add column if not exists pro_granted text[] not null default '{}';

insert into public.plus_settings (key, value, label, unit, hint, min_value, max_value, sort) values
  ('pro_price_d1',   800,    'Pro Preis: 1 Tag',      'Coins', '', 0, 1000000000, 311),
  ('pro_price_d7',   5000,   'Pro Preis: 1 Woche',    'Coins', '', 0, 1000000000, 312),
  ('pro_price_d30',  20000,  'Pro Preis: 1 Monat',    'Coins', '', 0, 1000000000, 313),
  ('pro_price_d90',  54000,  'Pro Preis: 3 Monate',   'Coins', '', 0, 1000000000, 314),
  ('pro_price_life', 600000, 'Pro Preis: für immer',  'Coins', '', 0, 1000000000, 315),
  ('pro_coin_mult',  2.5,    'Pro: Coins-Multiplikator', '×', 'Ersetzt den Plus-Wert, wenn er höher ist.', 1, 20, 320),
  ('pro_points_mult', 2.5,   'Pro: Ranglistenpunkte-Multiplikator', '×', 'Für die Wochenliga.', 1, 20, 321),
  ('pro_gamble_boost_percent', 30, 'Pro: Gambling-Gewinnchance besser', '%', 'Relativ zur normalen Chance (ersetzt den Plus-Wert, wenn höher).', 0, 100, 322),
  ('pro_hearts', 3, 'Pro: zusätzliche Herzen im Parkour', 'Herzen', 'Zusätzlich zu den gekauften Herzen.', 0, 20, 330),
  ('pro_jumps', 3, 'Pro: feste Sprünge im Parkour', 'Sprünge', 'Dauerhaft. 2 = normal.', 2, 10, 331),
  ('pro_jump_extra', 1, 'Pro: Extra-Sprung mit gekauftem Dreiersprung', 'Sprünge', 'Wer schon 3 Sprünge gekauft hat, bekommt so viele dazu (3 + 1 = 4).', 0, 5, 332),
  ('pro_no_learn', 1, 'Pro: keine Vokabeln im Parkour', '0/1', '1 = Pro-Spieler müssen im Parkour nicht lernen.', 0, 1, 333),
  ('pro_spectate', 1, 'Pro: im Parkour zuschauen', '0/1', '1 = erlaubt (wenn Parkour nicht gesperrt ist).', 0, 1, 334),
  ('pro_heal_per_run', 2, 'Pro: Heilen/Wiederbeleben pro Runde', 'mal', '0 = nicht erlaubt.', 0, 50, 335),
  ('pro_parkour_limit_mult', 2, 'Pro: Parkour-Tageslimit', '×', 'Vielfaches des normalen Limits.', 1, 20, 336),
  ('pro_advent_mult', 2, 'Pro: Adventskalender-Gewinne', '×', 'Coins, Punkte und Artikelwert.', 1, 10, 340),
  ('pro_advent_plus_days', 3, 'Pro: Adventskalender extra Plus-Tage', 'Tage', 'Zusätzlich bei Plus-Gewinnen.', 0, 30, 341),
  ('pro_quest_base', 25, 'Pro-Quests: Grundbelohnung', 'Coins', 'Wird je Stufe vervielfacht.', 0, 100000, 342),
  ('pro_ocr_plus', 0, 'Foto-Scan auch mit Plus', '0/1', '1 = Foto-Scan schon mit Plus erlaubt, sonst nur Pro.', 0, 1, 343)
on conflict (key) do update
  set label = excluded.label, unit = excluded.unit, hint = excluded.hint,
      min_value = excluded.min_value, max_value = excluded.max_value, sort = excluded.sort;

create or replace function public._pro_active(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select (p.pro_until > now()) or p.role = 'admin' from public.profiles p where p.id = p_user and not p.blocked), false);
$$;

-- Pro zählt auch als Plus.
create or replace function public._plus_active(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select (p.plus_until > now()) or (p.pro_until > now()) or p.role = 'admin' from public.profiles p where p.id = p_user and not p.blocked), false);
$$;

create or replace function public._pro_tiers()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_array(
    jsonb_build_object('id', 'd1',   'label', '1 Tag',     'days', 1,     'price', public._pls('pro_price_d1')::bigint),
    jsonb_build_object('id', 'd7',   'label', '1 Woche',   'days', 7,     'price', public._pls('pro_price_d7')::bigint),
    jsonb_build_object('id', 'd30',  'label', '1 Monat',   'days', 30,    'price', public._pls('pro_price_d30')::bigint),
    jsonb_build_object('id', 'd90',  'label', '3 Monate',  'days', 90,    'price', public._pls('pro_price_d90')::bigint),
    jsonb_build_object('id', 'life', 'label', 'Für immer', 'days', 36500, 'price', public._pls('pro_price_life')::bigint));
$$;

-- Foto-Scan: Pro (oder Plus, wenn eingestellt)
create or replace function public._ocr_allowed(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public._pro_active(p_user) or (public._pls('pro_ocr_plus') >= 1 and public._plus_active(p_user));
$$;

-- Premium-Skins im Parkour für Pro-Mitglieder (beim Ablauf werden nur die von Pro geschenkten wieder entfernt)
create or replace function public._pro_sync(p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_items text[] := array[
    'color:gold', 'color:neon', 'color:regenbogen', 'color:galaxie', 'color:lava',
    'hat:krone', 'hat:feuer', 'hat:zauberer', 'hat:einhorn', 'hat:heiligenschein',
    'fx:schwarzesloch', 'fx:blitz', 'fx:feuerspur', 'fx:galaxiewirbel', 'fx:regenbogenstrahl'];
  v_pp public.parkour_profiles;
  v_new text[];
begin
  insert into public.parkour_profiles (user_id) values (p_user) on conflict do nothing;
  select * into v_pp from public.parkour_profiles where user_id = p_user;
  if public._pro_active(p_user) then
    v_new := array(select i from unnest(v_items) i where not (i = any (v_pp.owned)));
    if cardinality(v_new) > 0 then
      update public.parkour_profiles
         set owned = owned || v_new, pro_granted = array(select distinct x from unnest(pro_granted || v_new) x)
       where user_id = p_user;
    end if;
  elsif cardinality(v_pp.pro_granted) > 0 then
    update public.parkour_profiles
       set owned = array(select o from unnest(owned) o where not (o = any (v_pp.pro_granted))),
           pro_granted = '{}',
           color = case when 'color:' || color = any (v_pp.pro_granted) then null else color end,
           hat = case when 'hat:' || hat = any (v_pp.pro_granted) then null else hat end,
           fx = case when 'fx:' || fx = any (v_pp.pro_granted) then null else fx end
     where user_id = p_user;
  end if;
end;
$$;

create or replace function public._pk_hearts(p_user uuid, p_extra integer)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(p_extra, 0) + case when public._pro_active(p_user) then public._pls('pro_hearts')::integer else 0 end;
$$;

-- Pro kaufen (Coins)
create or replace function public.pro_buy(p_tier text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  p public.profiles;
  t jsonb;
  v_days integer;
  v_price bigint;
begin
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  select e into t from jsonb_array_elements(public._pro_tiers()) e where e ->> 'id' = p_tier;
  if t is null then
    raise exception 'Unbekannte Stufe.' using errcode = '22023';
  end if;
  v_days := (t ->> 'days')::integer;
  v_price := (t ->> 'price')::bigint;
  select * into p from public.profiles where id = v_me for update;
  if p.pro_until >= '2099-01-01'::timestamptz then
    raise exception 'Du hast Pro schon für immer.' using errcode = '23505';
  end if;
  perform public._grant_koins(v_me, -v_price, 'pro_buy', p_tier);
  update public.profiles
     set pro_until = case when v_days >= 36500 then '2100-01-01'::timestamptz
                          else greatest(coalesce(pro_until, now()), now()) + make_interval(days => v_days) end
   where id = v_me;
  insert into public.plus_sales (user_id, kind, cents, days, coins, note)
  values (v_me, 'coins', 0, v_days, v_price, format('Pro · %s · %s Coins', t ->> 'label', v_price));
  perform public._plus_apply_perks(v_me);
  perform public._pro_sync(v_me);
  return public.plus_status();
end;
$$;

-- Admin: Pro schenken (Tage, 36500 = für immer, 0 = entfernen)
create or replace function public.admin_pro_grant(p_user uuid, p_days integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._require_admin();
  if p_days is null or p_days < 0 or p_days > 36500 then
    raise exception 'Ungültige Tage.' using errcode = '22023';
  end if;
  update public.profiles
     set pro_until = case when p_days = 0 then null
                          when p_days >= 36500 then '2100-01-01'::timestamptz
                          else greatest(coalesce(pro_until, now()), now()) + make_interval(days => p_days) end
   where id = p_user;
  perform public._pro_sync(p_user);
end;
$$;

-- Parkour: Sprünge, Lernen aus, Zuschauen, Heilen
create or replace function public.can_spectate()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_admin()
      or (public.is_staff() and coalesce((select r.spectate from public.staff_rights r where r.user_id = (select auth.uid())), false))
      or (public._pro_active((select auth.uid())) and public._pls('pro_spectate') >= 1);
$$;

create or replace function public.my_run_perks()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'spectate', public.can_spectate(),
    'heal', public.can_heal() or (public._pro_active((select auth.uid())) and public._pls('pro_heal_per_run') >= 1),
    'heal_limit', case when public.can_heal() then null
                       when public._pro_active((select auth.uid())) then public._pls('pro_heal_per_run')::integer else 0 end,
    'look', public._staff_look((select auth.uid())),
    'allowed', to_jsonb(public._allowed_looks((select auth.uid()))),
    'entrance', (select pp.entrance from public.parkour_profiles pp where pp.user_id = (select auth.uid())))
   where (select auth.uid()) is not null;
$$;

-- ----------------------------------------------------------------------------
-- Vorhandene Funktionen gezielt anpassen (Text ersetzen); schon angepasste werden übersprungen.
-- ----------------------------------------------------------------------------
create or replace function public._pro_patch(p_from text, p_to text, p_marker text, p_names text[] default null)
returns integer
language plpgsql
as $$
declare
  r record;
  v_def text;
  v_new text;
  n integer := 0;
begin
  for r in
    select p.oid, p.proname, p.prosrc
      from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public' and position(p_from in p.prosrc) > 0 and position(p_marker in p.prosrc) = 0
       and (p_names is null or p.proname = any (p_names))
  loop
    v_def := pg_get_functiondef(r.oid);
    v_new := replace(v_def, p_from, p_to);
    if v_new <> v_def then
      execute v_new;
      n := n + 1;
    end if;
  end loop;
  return n;
end;
$$;

do $$
declare n integer;
begin
  -- Coins und Punkte
  perform public._pro_patch($f$greatest(public._pls('plus_coin_mult'), 1)$f$,
    $t$greatest(public._pls('plus_coin_mult'), case when public._pro_active(p_user) then public._pls('pro_coin_mult') else 1 end, 1)$t$, 'pro_coin_mult');
  perform public._pro_patch($f$greatest(public._pls('plus_points_mult'), 1)$f$,
    $t$greatest(public._pls('plus_points_mult'), case when public._pro_active(p_user) then public._pls('pro_points_mult') else 1 end, 1)$t$, 'pro_points_mult');
  -- Gambling (Plus- und Pro-Bonus; die Plus-Anpassung aus 0024 war durch spätere Fassungen von gambling_play verloren gegangen)
  perform public._pro_patch($f$v_win integer := least(greatest(public.setting('gambling_win_permille'), 0), 1000);$f$,
    $t$v_win integer := least(round(greatest(public.setting('gambling_win_permille'), 0) * (1 + case when public._plus_active((select auth.uid()))
      then greatest(public._pls('plus_gamble_boost_percent'), case when public._pro_active((select auth.uid())) then public._pls('pro_gamble_boost_percent') else 0 end) / 100.0 else 0 end))::integer, 1000);$t$,
    'plus_gamble_boost_percent', array['gambling_play']);
  perform public._pro_patch($f$public._pls('plus_gamble_boost_percent') / 100.0$f$,
    $t$greatest(public._pls('plus_gamble_boost_percent'), case when public._pro_active((select auth.uid())) then public._pls('pro_gamble_boost_percent') else 0 end) / 100.0$t$,
    'pro_gamble_boost_percent', array['gambling_play']);
  -- Parkour-Limit
  perform public._pro_patch($f$v_day_cap := (greatest(v_budget - v_before, 0) / greatest(v_left, 1)) * 4;$f$,
    $t$v_day_cap := (greatest(v_budget - v_before, 0) / greatest(v_left, 1)) * 4;
  if public._pro_active((select auth.uid())) then v_day_cap := (v_day_cap * public._pls('pro_parkour_limit_mult'))::bigint; end if;$t$,
    'pro_parkour_limit_mult', array['_parkour_usage_state']);
  -- Herzen aller Mitspieler
  select public._pro_patch($f$'pk_hearts', coalesce(pp.extra_hearts, 0)$f$,
    $t$'pk_hearts', public._pk_hearts(pr.id, pp.extra_hearts)$t$, '_pk_hearts(') into n;
  -- Quests
  perform public._pro_patch($f$('plus_games', 2, 8, 2, 10, true)),$f$,
    $t$('plus_games', 2, 8, 2, 10, true),
    ('pro_answers', 1, 400, 1, public._pls('pro_quest_base')::integer, true),
    ('pro_answers', 2, 800, 3, public._pls('pro_quest_base')::integer, true),
    ('pro_perfect', 1, 4, 2, public._pls('pro_quest_base')::integer, true),
    ('pro_perfect', 2, 6, 4, public._pls('pro_quest_base')::integer, true),
    ('pro_sprint', 1, 60, 2, public._pls('pro_quest_base')::integer, true),
    ('pro_duel', 1, 12, 3, public._pls('pro_quest_base')::integer, true),
    ('pro_duel', 2, 20, 5, public._pls('pro_quest_base')::integer, true),
    ('pro_games', 1, 15, 2, public._pls('pro_quest_base')::integer, true),
    ('pro_games', 2, 30, 4, public._pls('pro_quest_base')::integer, true)),$t$, 'pro_answers', array['get_quests']);
  perform public._pro_patch($f$when 'plus_answers' then v_answers else v_games end$f$,
    $t$when 'plus_answers' then v_answers when 'pro_answers' then v_answers when 'pro_perfect' then v_perfect
                         when 'pro_sprint' then v_sprint when 'pro_duel' then v_duel else v_games end$t$, 'pro_perfect', array['get_quests']);
  perform public._pro_patch($f$if q.plus_only and not public._plus_active(v_me) then$f$,
    $t$if (q.plus_only and not public._plus_active(v_me)) or (q.family like 'pro\_%' and not public._pro_active(v_me)) then$t$, 'pro\_%', array['claim_quest']);
end;
$$;
drop function public._pro_patch(text, text, text, text[]);

-- plus_status um Pro erweitern
do $$
declare
  r record;
  v_def text;
  v_new text;
begin
  for r in select p.oid, p.prosrc from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace where ns.nspname = 'public' and p.proname = 'plus_status'
  loop
    if position('pro_until' in r.prosrc) > 0 then continue; end if;
    v_def := pg_get_functiondef(r.oid);
    v_new := replace(v_def, 'perform public._plus_sync(v_me);', E'perform public._plus_sync(v_me);\n  perform public._pro_sync(v_me);');
    v_new := replace(v_new, $f$'revive_price', public._pls('plus_revive_price'),$f$, $t$'revive_price', public._pls('plus_revive_price'),
    'pro', coalesce(p.pro_until > now(), false) or p.role = 'admin',
    'pro_until', case when p.role = 'admin' then null else p.pro_until end,
    'pro_lifetime', coalesce(p.pro_until >= '2099-01-01'::timestamptz, false),
    'pro_tiers', public._pro_tiers(),
    'ocr_allowed', public._ocr_allowed(v_me),
    'pro_perks', jsonb_build_object(
      'coin_mult', public._pls('pro_coin_mult'), 'points_mult', public._pls('pro_points_mult'), 'gamble_boost', public._pls('pro_gamble_boost_percent'),
      'hearts', public._pls('pro_hearts'), 'jumps', public._pls('pro_jumps'), 'jump_extra', public._pls('pro_jump_extra'),
      'no_learn', public._pls('pro_no_learn') >= 1, 'spectate', public._pls('pro_spectate') >= 1, 'heal_per_run', public._pls('pro_heal_per_run'),
      'parkour_limit_mult', public._pls('pro_parkour_limit_mult'), 'advent_mult', public._pls('pro_advent_mult')),$t$);
    if v_new = v_def then
      raise exception 'plus_status konnte nicht für Pro angepasst werden.';
    end if;
    execute v_new;
  end loop;
end;
$$;

-- Adventskalender: Pro zieht bessere Türchen
do $$
declare r record;
begin
  -- Grundlogik (wie 0070) unter neuem Namen sichern, falls noch nicht geschehen
  if not exists (select 1 from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace where ns.nspname = 'public' and p.proname = '_advent_plan_base') then
    for r in select p.oid from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace where ns.nspname = 'public' and p.proname = '_advent_plan'
    loop
      execute replace(pg_get_functiondef(r.oid), 'function public._advent_plan(', 'function public._advent_plan_base(');
    end loop;
  end if;
end;
$$;

create or replace function public._advent_plan(p_day integer)
returns jsonb
language plpgsql
volatile
set search_path = public
as $$
declare
  v_plan jsonb := public._advent_plan_base(p_day);
  v_mult numeric := greatest(public._pls('pro_advent_mult'), 1);
  v_out jsonb := '[]'::jsonb;
  e jsonb;
begin
  if not public._pro_active((select auth.uid())) then
    return v_plan;
  end if;
  for e in select * from jsonb_array_elements(v_plan)
  loop
    e := case e ->> 'type'
      when 'coins' then jsonb_set(e, '{amount}', to_jsonb(round((e ->> 'amount')::numeric * v_mult)::bigint))
      when 'points' then jsonb_set(e, '{amount}', to_jsonb(round((e ->> 'amount')::numeric * v_mult)::bigint))
      when 'item' then jsonb_set(e, '{max_price}', to_jsonb(round((e ->> 'max_price')::numeric * v_mult)::bigint))
      when 'plus' then jsonb_set(e, '{days}', to_jsonb((e ->> 'days')::integer + public._pls('pro_advent_plus_days')::integer))
      else e end;
    v_out := v_out || jsonb_build_array(e);
  end loop;
  return v_out;
end;
$$;

-- Rechte
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('pro_buy', 'admin_pro_grant', '_pro_active', '_pro_tiers', '_ocr_allowed', '_pro_sync', '_pk_hearts', '_advent_plan_base')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    if r.proname in ('pro_buy', 'admin_pro_grant') then
      execute format('grant execute on function %s to authenticated', r.sig);
    end if;
  end loop;
end;
$$;

-- Parkour: Pro-Sprünge und "keine Vokabeln" für Pro
create or replace function public.parkour_jumps_list(p_ids uuid[])
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_object_agg(x.uid::text, x.jumps), '{}'::jsonb)
    from (
      select u.uid,
             case when public._pro_active(u.uid)
                  then greatest(public._pls('pro_jumps')::integer,
                                case when coalesce(j.jumps, 2) >= 3 then j.jumps + public._pls('pro_jump_extra')::integer else 0 end)
                  else j.jumps end as jumps
        from unnest(coalesce(p_ids, '{}'::uuid[])) as u(uid)
        left join public.parkour_jumps j on j.user_id = u.uid
    ) x
   where x.jumps is not null and (select auth.uid()) is not null;
$$;

create or replace function public.parkour_learn_off_list(p_ids uuid[])
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(u.uid), '{}'::uuid[])
    from unnest(coalesce(p_ids, '{}'::uuid[])) as u(uid)
   where (exists (select 1 from public.parkour_learn_off o where o.user_id = u.uid)
          or (public._pro_active(u.uid) and public._pls('pro_no_learn') >= 1))
     and (select auth.uid()) is not null;
$$;

-- Pi-Schutz: Standard von 450 auf 200 ms pro Stelle gesenkt (schnelles Tippen auswendig gelernter Stellen wurde fälschlich abgelehnt).
update public.app_settings set value = 200 where key = 'memo_pi_min_ms' and value = 450;
