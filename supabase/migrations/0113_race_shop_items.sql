-- ============================================================================
-- 0113: Shop mit Auswahl (Update 140). Wiederholbar. Nach 0112 ausführen.
--  * Richtige Vokabeln im Shop/Fitnessstudio sammeln Punkte (race_perks.shop_correct / gym_correct), sie lösen nichts mehr automatisch aus
--  * race_perk_buy(item): spawn (10 Punkte, 30 Min bis 5 Auto-Spawns), speed (10, 30 Min schneller laufen),
--    jump (10, 30 Min höher springen), armor (15, 30 Min halber Schaden), heal (3, sofort volle Leben),
--    hearts (Fitness, 10 Punkte: +10 Leben, höchstens +100). Admin bekommt alles gratis.
-- ============================================================================
alter table public.race_perks add column if not exists speed_until timestamptz, add column if not exists jump_until timestamptz, add column if not exists armor_until timestamptz;

create or replace function public._perk_json(p public.race_perks)
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'spawn_max', case when p.spawn_until is not null and p.spawn_until > now() then 5 else 2 end,
    'spawn_sec', greatest(0, coalesce(ceil(extract(epoch from p.spawn_until - now())), 0))::integer,
    'speed_sec', greatest(0, coalesce(ceil(extract(epoch from p.speed_until - now())), 0))::integer,
    'jump_sec', greatest(0, coalesce(ceil(extract(epoch from p.jump_until - now())), 0))::integer,
    'armor_sec', greatest(0, coalesce(ceil(extract(epoch from p.armor_until - now())), 0))::integer,
    'hearts', 100 + p.hearts_bonus,
    'shop', p.shop_correct, 'gym', p.gym_correct);
$$;

create or replace function public.race_perk_answer(p_kind text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_me uuid := public._og_check(); p public.race_perks;
begin
  perform public._feature_guard('cars');
  if p_kind not in ('shop', 'gym') then raise exception 'Unbekannt.' using errcode = '22023'; end if;
  insert into public.race_perks (user_id) values (v_me) on conflict do nothing;
  select * into p from public.race_perks where user_id = v_me for update;
  if p.last_at > now() - interval '1500 milliseconds' then return public._perk_json(p); end if;
  if p_kind = 'shop' then p.shop_correct := least(999, p.shop_correct + 1); else p.gym_correct := least(999, p.gym_correct + 1); end if;
  update public.race_perks set shop_correct = p.shop_correct, gym_correct = p.gym_correct, last_at = now() where user_id = v_me;
  return public._perk_json(p);
end;
$$;

drop function if exists public.race_perk_buy(text);
create or replace function public.race_perk_buy(p_item text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := public._og_check(); p public.race_perks; v_adm boolean := public.is_admin();
  v_cost integer; v_gym boolean := p_item = 'hearts';
begin
  perform public._feature_guard('cars');
  v_cost := case p_item when 'spawn' then 10 when 'speed' then 10 when 'jump' then 10 when 'armor' then 15 when 'heal' then 3 when 'hearts' then 10 else null end;
  if v_cost is null then raise exception 'Unbekannter Artikel.' using errcode = '22023'; end if;
  insert into public.race_perks (user_id) values (v_me) on conflict do nothing;
  select * into p from public.race_perks where user_id = v_me for update;
  if not v_adm then
    if (case when v_gym then p.gym_correct else p.shop_correct end) < v_cost then
      raise exception 'Dafür fehlen dir % richtige Vokabeln.', v_cost - (case when v_gym then p.gym_correct else p.shop_correct end) using errcode = '23514';
    end if;
    if v_gym then p.gym_correct := p.gym_correct - v_cost; else p.shop_correct := p.shop_correct - v_cost; end if;
  end if;
  if p_item = 'spawn' then p.spawn_until := greatest(now(), coalesce(p.spawn_until, now())) + interval '30 minutes';
  elsif p_item = 'speed' then p.speed_until := greatest(now(), coalesce(p.speed_until, now())) + interval '30 minutes';
  elsif p_item = 'jump' then p.jump_until := greatest(now(), coalesce(p.jump_until, now())) + interval '30 minutes';
  elsif p_item = 'armor' then p.armor_until := greatest(now(), coalesce(p.armor_until, now())) + interval '30 minutes';
  elsif p_item = 'hearts' then p.hearts_bonus := least(100, p.hearts_bonus + 10);
  end if;
  update public.race_perks set shop_correct = p.shop_correct, gym_correct = p.gym_correct, hearts_bonus = p.hearts_bonus,
    spawn_until = p.spawn_until, speed_until = p.speed_until, jump_until = p.jump_until, armor_until = p.armor_until where user_id = v_me;
  return public._perk_json(p);
end;
$$;

do $$
declare r record;
begin
  for r in select p.oid::regprocedure as sig, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('race_perk_answer', 'race_perk_buy', '_perk_json') loop
    execute format('revoke all on function %s from public, anon', r.sig);
    if left(r.proname, 1) <> '_' then execute format('grant execute on function %s to authenticated', r.sig); end if;
  end loop;
end $$;
