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
