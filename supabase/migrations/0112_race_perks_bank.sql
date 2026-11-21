-- ============================================================================
-- 0112: Stadt-Shops, Fitnessstudio und Bank (Update 139). Wiederholbar. Nach 0111 ausführen.
--  * race_perks: Fortschritt beim Vokabel-Lernen im Shop (10 richtige = 30 Min lang bis zu 5 statt 2 Auto-Spawns)
--    und im Fitnessstudio (10 richtige = +10 Leben, höchstens +100)
--  * race_perk_info() / race_perk_answer(kind): Antwort zählen (mindestens 1,5 s Abstand)
--  * race_bank: ein gemeinsamer Zustand für alle: Raub starten (race_bank_claim), mitmachen (30 s lang),
--    Beute auszahlen (race_bank_pay: 1000 Coins, geteilt, erst nach 350 s Jagd), danach 10 Min Ruhe
-- ============================================================================
create table if not exists public.race_perks (
  user_id uuid primary key,
  shop_correct integer not null default 0,
  gym_correct integer not null default 0,
  hearts_bonus integer not null default 0,
  spawn_until timestamptz,
  last_at timestamptz not null default now() - interval '1 minute'
);
alter table public.race_perks enable row level security;

create or replace function public._perk_json(p public.race_perks)
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'spawn_max', case when p.spawn_until is not null and p.spawn_until > now() then 5 else 2 end,
    'spawn_sec', greatest(0, coalesce(ceil(extract(epoch from p.spawn_until - now())), 0))::integer,
    'hearts', 100 + p.hearts_bonus,
    'shop', p.shop_correct, 'gym', p.gym_correct);
$$;

create or replace function public.race_perk_info()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_me uuid := public._og_check(); p public.race_perks;
begin
  insert into public.race_perks (user_id) values (v_me) on conflict do nothing;
  select * into p from public.race_perks where user_id = v_me;
  return public._perk_json(p);
end;
$$;

drop function if exists public.race_perk_answer(text);
create or replace function public.race_perk_answer(p_kind text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_me uuid := public._og_check(); p public.race_perks;
begin
  perform public._feature_guard('cars');
  if p_kind not in ('shop', 'gym') then raise exception 'Unbekannt.' using errcode = '22023'; end if;
  insert into public.race_perks (user_id) values (v_me) on conflict do nothing;
  select * into p from public.race_perks where user_id = v_me for update;
  if p.last_at > now() - interval '1500 milliseconds' then return public._perk_json(p); end if;
  p.last_at := now();
  if p_kind = 'shop' then
    p.shop_correct := p.shop_correct + 1;
    if p.shop_correct >= 10 then p.shop_correct := 0; p.spawn_until := greatest(now(), coalesce(p.spawn_until, now())) + interval '30 minutes'; end if;
  else
    p.gym_correct := p.gym_correct + 1;
    if p.gym_correct >= 10 then p.gym_correct := 0; p.hearts_bonus := least(100, p.hearts_bonus + 10); end if;
  end if;
  update public.race_perks set shop_correct = p.shop_correct, gym_correct = p.gym_correct, hearts_bonus = p.hearts_bonus, spawn_until = p.spawn_until, last_at = p.last_at where user_id = v_me;
  return public._perk_json(p);
end;
$$;

create table if not exists public.race_bank (
  id integer primary key default 1 check (id = 1),
  heist_at timestamptz,
  next_at timestamptz not null default now(),
  robbers uuid[] not null default '{}',
  paid uuid[] not null default '{}'
);
alter table public.race_bank enable row level security;
insert into public.race_bank (id) values (1) on conflict do nothing;

create or replace function public.race_bank_status()
returns integer language plpgsql stable security definer set search_path = public as $$
declare b public.race_bank;
begin
  perform public._og_check();
  select * into b from public.race_bank where id = 1;
  return greatest(0, ceil(extract(epoch from b.next_at - now())))::integer;
end;
$$;

create or replace function public.race_bank_claim()
returns integer language plpgsql security definer set search_path = public as $$
declare v_me uuid := public._og_check(); b public.race_bank;
begin
  perform public._feature_guard('cars');
  select * into b from public.race_bank where id = 1 for update;
  if b.next_at > now() then
    if b.heist_at is not null and b.heist_at > now() - interval '40 seconds' and cardinality(b.robbers) < 4 then
      if not (v_me = any(b.robbers)) then update public.race_bank set robbers = robbers || v_me where id = 1; end if;
      return cardinality(b.robbers) + case when v_me = any(b.robbers) then 0 else 1 end;
    end if;
    raise exception 'Die Bank ruht noch % Min.', ceil(extract(epoch from b.next_at - now()) / 60)::integer using errcode = '55000';
  end if;
  update public.race_bank set heist_at = now(), next_at = now() + interval '16 minutes', robbers = array[v_me], paid = '{}' where id = 1;
  return 1;
end;
$$;

create or replace function public.race_bank_pay()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_me uuid := public._og_check(); b public.race_bank; v_amt bigint; v_bal bigint;
begin
  perform public._feature_guard('cars');
  select * into b from public.race_bank where id = 1 for update;
  if b.heist_at is null or not (v_me = any(b.robbers)) or v_me = any(b.paid) or now() - b.heist_at < interval '350 seconds' or now() - b.heist_at > interval '20 minutes' then
    return jsonb_build_object('coins', 0, 'koins', null);
  end if;
  v_amt := 1000 / greatest(1, cardinality(b.robbers));
  v_bal := public._grant_koins(v_me, v_amt, 'bank_heist', null);
  update public.race_bank set paid = paid || v_me where id = 1;
  return jsonb_build_object('coins', v_amt, 'koins', v_bal);
end;
$$;

do $$
declare r record;
begin
  for r in select p.oid::regprocedure as sig, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('race_perk_info', 'race_perk_answer', 'race_bank_status', 'race_bank_claim', 'race_bank_pay', '_perk_json') loop
    execute format('revoke all on function %s from public, anon', r.sig);
    if left(r.proname, 1) <> '_' then execute format('grant execute on function %s to authenticated', r.sig); end if;
  end loop;
end $$;
