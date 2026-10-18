-- 0034: Hausvorteil für Würfeln, Roulette und Glücksrad (Gewinnquote einstellbar) und Würfeln höchstens 75 % Chance.
-- Grund: Mit 97 % Rückzahlung und bis zu 90 % Chance wirkte Würfeln wie ein sicherer Gewinn. Jetzt gilt eine
-- Gewinnquote (Standard 900 ‰ = 90 %), die der Admin unter Regeln > Gambling ändern kann. Wiederholbar. Nach 0033 ausführen.

insert into public.app_settings (key, value, mod_editable) values ('gambling_rtp_permille', 900, false)
on conflict (key) do nothing;

create or replace function public.gambling_dice(p_bet integer, p_over boolean, p_target integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  v_max integer := greatest(public.setting('gambling_max_bet'), 1);
  v_roll integer := 1 + floor(random() * 100)::integer;
  v_chance integer;
  v_rtp integer := least(greatest(public.setting('gambling_rtp_permille'), 500), 950);
  v_win boolean;
  v_pay bigint := 0;
  v_balance bigint;
begin
  perform public._feature_guard('gambling');
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  if p_bet is null or p_bet < 1 or p_bet > v_max then
    raise exception 'Der Einsatz muss zwischen 1 und % Coins liegen.', v_max using errcode = '22023';
  end if;
  if p_target is null or p_over is null then
    raise exception 'Ungültige Wahl.' using errcode = '22023';
  end if;
  v_chance := case when p_over then 100 - p_target else p_target - 1 end;
  if v_chance < 5 or v_chance > 75 then
    raise exception 'Die Gewinnchance muss zwischen 5 %% und 75 %% liegen.' using errcode = '22023';
  end if;
  if coalesce((select balance from public.koin_wallets where user_id = v_me), 0) < p_bet then
    raise exception 'Nicht genug Coins.' using errcode = '23514';
  end if;
  v_win := case when p_over then v_roll > p_target else v_roll < p_target end;
  if v_win then v_pay := (p_bet::bigint * v_rtp) / (10 * v_chance); end if;
  v_balance := public._gamble_settle(v_me, p_bet, v_pay, v_pay >= p_bet::bigint * 10);
  return jsonb_build_object('roll', v_roll, 'chance', v_chance, 'win', v_win, 'bet', p_bet,
                            'payout', v_pay, 'balance', v_balance);
end;
$$;

create or replace function public.gambling_wheel(p_bet integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  v_max integer := greatest(public.setting('gambling_max_bet'), 1);
  v_seg integer[] := array[0,5,0,20,0,10,0,30,0,5,0,40,0,20,0,40,0,5,0,20];
  v_i integer := floor(random() * 20)::integer;
  v_pay bigint;
  v_rtp integer := least(greatest(public.setting('gambling_rtp_permille'), 500), 950);
  v_balance bigint;
begin
  perform public._feature_guard('gambling');
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  if p_bet is null or p_bet < 1 or p_bet > v_max then
    raise exception 'Der Einsatz muss zwischen 1 und % Coins liegen.', v_max using errcode = '22023';
  end if;
  if coalesce((select balance from public.koin_wallets where user_id = v_me), 0) < p_bet then
    raise exception 'Nicht genug Coins.' using errcode = '23514';
  end if;
  v_pay := (p_bet::bigint * v_seg[v_i + 1] * v_rtp) / (10 * 975);
  v_balance := public._gamble_settle(v_me, p_bet, v_pay, v_seg[v_i + 1] >= 40);
  return jsonb_build_object('index', v_i, 'tenths', v_seg[v_i + 1], 'segments', to_jsonb(v_seg), 'bet', p_bet,
                            'payout', v_pay, 'balance', v_balance);
end;
$$;

create or replace function public.gambling_roulette(p_bets jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  v_max integer := greatest(public.setting('gambling_max_bet'), 1);
  v_num integer := floor(random() * 37)::integer;
  v_red integer[] := array[1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36];
  v_color text;
  b jsonb;
  v_t text;
  v_v integer;
  v_a integer;
  v_total integer := 0;
  v_count integer := 0;
  v_pay bigint := 0;
  v_p bigint;
  v_rtp integer := least(greatest(public.setting('gambling_rtp_permille'), 500), 950);
  v_win boolean;
  v_mult integer;
  v_out jsonb := '[]'::jsonb;
  v_balance bigint;
begin
  perform public._feature_guard('gambling');
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  if p_bets is null or jsonb_typeof(p_bets) <> 'array' or jsonb_array_length(p_bets) not between 1 and 10 then
    raise exception 'Setze 1 bis 10 Felder.' using errcode = '22023';
  end if;
  v_color := case when v_num = 0 then 'green' when v_num = any (v_red) then 'red' else 'black' end;
  for b in select * from jsonb_array_elements(p_bets) loop
    v_t := b ->> 't';
    v_v := coalesce((b ->> 'v')::integer, 0);
    v_a := (b ->> 'a')::integer;
    if v_a is null or v_a < 1 or v_a > v_max then
      raise exception 'Jeder Einsatz muss zwischen 1 und % Coins liegen.', v_max using errcode = '22023';
    end if;
    if v_t not in ('straight', 'red', 'black', 'even', 'odd', 'low', 'high', 'dozen', 'column')
       or (v_t = 'straight' and v_v not between 0 and 36)
       or (v_t in ('dozen', 'column') and v_v not between 1 and 3) then
      raise exception 'Ungültige Wette.' using errcode = '22023';
    end if;
    v_total := v_total + v_a;
    v_count := v_count + 1;
  end loop;
  if v_total > v_max * 5 then
    raise exception 'Insgesamt höchstens % Coins pro Runde.', v_max * 5 using errcode = '22023';
  end if;
  if coalesce((select balance from public.koin_wallets where user_id = v_me), 0) < v_total then
    raise exception 'Nicht genug Coins.' using errcode = '23514';
  end if;
  for b in select * from jsonb_array_elements(p_bets) loop
    v_t := b ->> 't';
    v_v := coalesce((b ->> 'v')::integer, 0);
    v_a := (b ->> 'a')::integer;
    v_win := false;
    v_mult := 0;
    if v_t = 'straight' then v_win := v_num = v_v; v_mult := 36;
    elsif v_num > 0 then
      if v_t = 'red' then v_win := v_color = 'red'; v_mult := 2;
      elsif v_t = 'black' then v_win := v_color = 'black'; v_mult := 2;
      elsif v_t = 'even' then v_win := v_num % 2 = 0; v_mult := 2;
      elsif v_t = 'odd' then v_win := v_num % 2 = 1; v_mult := 2;
      elsif v_t = 'low' then v_win := v_num between 1 and 18; v_mult := 2;
      elsif v_t = 'high' then v_win := v_num between 19 and 36; v_mult := 2;
      elsif v_t = 'dozen' then v_win := (v_num - 1) / 12 + 1 = v_v; v_mult := 3;
      elsif v_t = 'column' then v_win := (v_num - 1) % 3 + 1 = v_v; v_mult := 3;
      end if;
    end if;
    v_p := case when v_win then (v_a::bigint * v_mult * v_rtp) / 973 else 0 end;
    v_pay := v_pay + v_p;
    v_out := v_out || jsonb_build_array(jsonb_build_object('t', v_t, 'v', v_v, 'a', v_a, 'win', v_win,
                                                           'pay', v_p));
  end loop;
  v_balance := public._gamble_settle(v_me, v_total, v_pay, v_pay >= v_total::bigint * 10);
  return jsonb_build_object('number', v_num, 'color', v_color, 'bets', v_out, 'bet', v_total,
                            'payout', v_pay, 'balance', v_balance);
end;
$$;

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('gambling_roulette', 'gambling_dice', 'gambling_wheel')
  loop
    execute format('revoke all on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;
end;
$$;
