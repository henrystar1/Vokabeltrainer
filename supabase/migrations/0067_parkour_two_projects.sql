-- 0067: Parkour läuft über zwei Spiel-Datenbanken (zwei fremde Supabase-Projekte, nur Realtime).
-- Ist das Monatsbudget der ersten voll, wechseln alle zur zweiten. Sind beide voll, ist Parkour bis Monatsende gesperrt.
-- parkour_msg_month_k = Budget je Datenbank (in Tausend), parkour_projects = Anzahl der Spiel-Datenbanken (1 oder 2). Wiederholbar.
insert into public.app_settings (key, value, mod_editable) values ('parkour_projects', 2, false)
on conflict (key) do nothing;

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
  v_n integer := greatest(1, least(public.setting('parkour_projects'), 2));
  v_each bigint := v_k::bigint * 1000;
  v_budget bigint := v_each * v_n;
  v_before bigint;
  v_left integer;
  v_day_cap bigint;
  v_month bigint;
  v_slot integer := 0;
begin
  select coalesce(sum(msgs), 0) into v_before from public.parkour_usage where day >= v_first and day < v_today;
  v_month := v_before + p_msgs;
  v_left := (date_trunc('month', v_today) + interval '1 month')::date - v_today;
  v_day_cap := (greatest(v_budget - v_before, 0) / greatest(v_left, 1)) * 4;
  if v_each > 0 then
    v_slot := least((v_month / v_each)::integer, v_n - 1);
  end if;
  return jsonb_build_object(
    'msgs', p_msgs,
    'limit', v_day_cap,
    'month', v_month,
    'budget', v_budget,
    'slot', v_slot,
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
