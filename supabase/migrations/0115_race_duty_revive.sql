-- ============================================================================
-- 0115: Dienste und Wiederbelebung in der Stadt (Update 142). Wiederholbar. Nach 0114 ausführen.
--  * race_revive_pay(): sofort wiederbeleben kostet 10 Coins (Admin gratis)
--  * race_duty_pay(kind): Lohn für Polizei-Einsatz (150 Coins, höchstens alle 2 Min) und Sanitäter-Einsatz (80 Coins, alle 45 s)
-- ============================================================================
create table if not exists public.race_duty (
  user_id uuid primary key,
  police_at timestamptz not null default now() - interval '1 day',
  medic_at timestamptz not null default now() - interval '1 day'
);
alter table public.race_duty enable row level security;

create or replace function public.race_revive_pay()
returns bigint language plpgsql security definer set search_path = public as $$
declare v_me uuid := public._og_check(); v_bal bigint;
begin
  perform public._feature_guard('cars');
  if public.is_admin() then
    return coalesce((select balance from public.koin_wallets where user_id = v_me), 0);
  end if;
  v_bal := public._grant_koins(v_me, -10, 'shop', 'revive');
  return v_bal;
end;
$$;

create or replace function public.race_duty_pay(p_kind text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_me uuid := public._og_check(); d public.race_duty; v_amt bigint; v_bal bigint;
begin
  perform public._feature_guard('cars');
  if p_kind not in ('police', 'medic') then raise exception 'Unbekannt.' using errcode = '22023'; end if;
  insert into public.race_duty (user_id) values (v_me) on conflict do nothing;
  select * into d from public.race_duty where user_id = v_me for update;
  if p_kind = 'police' then
    if d.police_at > now() - interval '120 seconds' then return jsonb_build_object('coins', 0, 'koins', null); end if;
    v_amt := 150; update public.race_duty set police_at = now() where user_id = v_me;
  else
    if d.medic_at > now() - interval '45 seconds' then return jsonb_build_object('coins', 0, 'koins', null); end if;
    v_amt := 80; update public.race_duty set medic_at = now() where user_id = v_me;
  end if;
  v_bal := public._grant_koins(v_me, v_amt, 'race_duty', p_kind);
  return jsonb_build_object('coins', v_amt, 'koins', v_bal);
end;
$$;

do $$
declare r record;
begin
  for r in select p.oid::regprocedure as sig, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('race_revive_pay', 'race_duty_pay') loop
    execute format('revoke all on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;
end $$;
