-- 0070: Alle Werte des Adventskalenders einstellbar (Verwaltung → Zahlen → Adventskalender). Wiederholbar.
insert into public.app_settings (key, value, mod_editable) values
  ('advent_w_coins', 38, false), ('advent_w_points', 20, false), ('advent_w_plus', 15, false), ('advent_w_item', 27, false),
  ('advent_coins_min', 30, false), ('advent_coins_spread', 40, false), ('advent_coins_per_day', 15, false),
  ('advent_points_min', 10, false), ('advent_points_spread', 10, false), ('advent_points_per_day', 3, false),
  ('advent_plus_days_min', 2, false), ('advent_plus_days_per_6', 1, false),
  ('advent_item_price_base', 100, false), ('advent_item_price_per_day', 60, false),
  ('advent_final_coins', 800, false), ('advent_final_coins_spread', 400, false), ('advent_final_plus_days', 7, false), ('advent_final_item_price', 2500, false)
on conflict (key) do nothing;

create or replace function public._advent_plan(p_day integer)
returns jsonb
language plpgsql
volatile
set search_path = public
as $$
declare
  v_wc integer := public.setting('advent_w_coins');
  v_wp integer := public.setting('advent_w_points');
  v_wl integer := public.setting('advent_w_plus');
  v_wi integer := case when p_day >= 2 then public.setting('advent_w_item') else 0 end;
  v_total integer;
  v_roll numeric;
begin
  if p_day = 24 then
    return jsonb_build_array(
      jsonb_build_object('type', 'item', 'max_price', public.setting('advent_final_item_price')),
      jsonb_build_object('type', 'plus', 'days', public.setting('advent_final_plus_days')),
      jsonb_build_object('type', 'coins', 'amount', public.setting('advent_final_coins') + floor(random() * (public.setting('advent_final_coins_spread') + 1))::integer));
  end if;
  v_total := v_wc + v_wp + v_wl + v_wi;
  if v_total <= 0 then
    return '[]'::jsonb;
  end if;
  v_roll := random() * v_total;
  if v_roll < v_wc then
    return jsonb_build_array(jsonb_build_object('type', 'coins',
      'amount', (public.setting('advent_coins_min') + floor(random() * (public.setting('advent_coins_spread') + p_day * public.setting('advent_coins_per_day') + 1))::integer) / 10 * 10));
  elsif v_roll < v_wc + v_wp then
    return jsonb_build_array(jsonb_build_object('type', 'points',
      'amount', public.setting('advent_points_min') + floor(random() * (public.setting('advent_points_spread') + p_day * public.setting('advent_points_per_day') + 1))::integer));
  elsif v_roll < v_wc + v_wp + v_wl then
    return jsonb_build_array(jsonb_build_object('type', 'plus',
      'days', public.setting('advent_plus_days_min') + floor(random() * (1 + p_day * public.setting('advent_plus_days_per_6') / 6.0))::integer));
  end if;
  return jsonb_build_array(jsonb_build_object('type', 'item', 'max_price', public.setting('advent_item_price_base') + p_day * public.setting('advent_item_price_per_day')));
end;
$$;

do $$
declare r record;
begin
  for r in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = '_advent_plan'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
  end loop;
end;
$$;
