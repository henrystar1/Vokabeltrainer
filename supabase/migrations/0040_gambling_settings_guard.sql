-- 0040: Mehr Einstellungen fürs Gambling + Hausschutz + höhere Einsätze.
--  * Höchsteinsatz Standard 10.000 Coins (nur wenn noch der alte Wert 200 gilt).
--  * Jede Wahrscheinlichkeit einzeln einstellbar: Würfeln (Gewinnquote, höchste Chance), Roulette (Gewinnquote),
--    Glücksrad (Gewicht je Feld-Faktor), Black Jack (Auszahlung für Black Jack, Geber zieht bei weichem 17).
--  * Hausschutz: Liegt der Hausgewinn der letzten 3 Tage unter dem Ziel, wird ein Gewinn mit einer gewissen
--    Wahrscheinlichkeit nicht ausgespielt (ohne Hinweis für die Spieler), siehe _house_squeeze().
-- Wiederholbar. Nach 0039 ausführen.

insert into public.app_settings (key, value, mod_editable) values
  ('gambling_rtp_dice', 850, false),
  ('gambling_rtp_roulette', 850, false),
  ('gambling_dice_max_chance', 50, false),
  ('gambling_wheel_w0', 500, false),
  ('gambling_wheel_w05', 150, false),
  ('gambling_wheel_w1', 50, false),
  ('gambling_wheel_w2', 200, false),
  ('gambling_wheel_w3', 50, false),
  ('gambling_wheel_w4', 50, false),
  ('gambling_bj_blackjack_x10', 12, false),
  ('gambling_bj_dealer_hits_soft17', 1, false),
  ('gambling_guard_target_permille', 50, false),
  ('gambling_guard_max_permille', 600, false),
  ('gambling_guard_min_wagered', 5000, false)
on conflict (key) do nothing;

-- bestehende Gewinnquote als Startwert für Würfeln/Roulette übernehmen (nur beim ersten Lauf, wenn noch Standard)
update public.app_settings set value = (select value from public.app_settings where key = 'gambling_rtp_permille')
 where key in ('gambling_rtp_dice', 'gambling_rtp_roulette') and value = 850
   and exists (select 1 from public.app_settings where key = 'gambling_rtp_permille' and value <> 850);

update public.app_settings set value = 10000 where key = 'gambling_max_bet' and value = 200;

alter table public.blackjack_hands add column if not exists squeeze boolean not null default false;
create index if not exists gambling_feed_created_idx on public.gambling_feed (created_at);

-- Soll diese Runde einen Gewinn verlieren? Nur wenn der Hausgewinn der letzten 3 Tage unter dem Ziel liegt.
create or replace function public._house_squeeze()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_max integer := least(greatest(public.setting('gambling_guard_max_permille'), 0), 1000);
  v_target integer := public.setting('gambling_guard_target_permille');
  v_w bigint;
  v_p bigint;
  v_margin bigint;
begin
  if v_max = 0 then return false; end if;
  select coalesce(sum(bet), 0), coalesce(sum(payout), 0) into v_w, v_p
    from public.gambling_feed where created_at > now() - interval '3 days';
  if v_w <= 0 or v_w < public.setting('gambling_guard_min_wagered') then return false; end if;
  v_margin := ((v_w - v_p) * 1000) / v_w;
  if v_margin >= v_target then return false; end if;
  return random() * 1000 < least(v_max, v_target - v_margin);
end;
$$;
revoke all on function public._house_squeeze() from public, anon, authenticated;

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
  v_maxchance integer := least(greatest(public.setting('gambling_dice_max_chance'), 5), 95);
  v_rtp integer := least(greatest(public.setting('gambling_rtp_dice'), 300), 990);
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
  if v_chance < 5 or v_chance > v_maxchance then
    raise exception 'Die Gewinnchance muss zwischen 5 %% und % %% liegen.', v_maxchance using errcode = '22023';
  end if;
  if coalesce((select balance from public.koin_wallets where user_id = v_me), 0) < p_bet then
    raise exception 'Nicht genug Coins.' using errcode = '23514';
  end if;
  v_win := case when p_over then v_roll > p_target else v_roll < p_target end;
  if v_win and public._house_squeeze() then
    v_roll := case when p_over then 1 + floor(random() * p_target)::integer
                   else p_target + floor(random() * (101 - p_target))::integer end;
    v_win := false;
  end if;
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
  v_seg integer[] := array[0,5,0,20,0,10,0,30,0,5,0,40,0,20,0,20,0,5,0,20];
  v_fac integer[] := array[0,5,10,20,30,40];
  v_w integer[] := array[public.setting('gambling_wheel_w0'), public.setting('gambling_wheel_w05'), public.setting('gambling_wheel_w1'),
                         public.setting('gambling_wheel_w2'), public.setting('gambling_wheel_w3'), public.setting('gambling_wheel_w4')];
  v_sum integer := 0;
  v_r numeric;
  v_f integer := 0;
  v_k integer;
  v_cand integer[];
  v_i integer;
  v_pay bigint;
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
  for v_k in 1..6 loop v_sum := v_sum + greatest(v_w[v_k], 0); end loop;
  if v_sum > 0 then
    v_r := random() * v_sum;
    for v_k in 1..6 loop
      v_r := v_r - greatest(v_w[v_k], 0);
      if v_r < 0 then v_f := v_fac[v_k]; exit; end if;
    end loop;
  end if;
  -- Hausschutz: ein Gewinn (ab ×1) wird zu einem Verlustfeld
  if v_f >= 10 and public._house_squeeze() then
    v_f := case when greatest(v_w[2], 0) > 0 and random() * (greatest(v_w[1], 0) + greatest(v_w[2], 0)) >= greatest(v_w[1], 0) then 5 else 0 end;
  end if;
  select array_agg(i - 1) into v_cand from generate_subscripts(v_seg, 1) as i where v_seg[i] = v_f;
  v_i := v_cand[1 + floor(random() * array_length(v_cand, 1))::integer];
  v_pay := (p_bet::bigint * v_f) / 10;
  v_balance := public._gamble_settle(v_me, p_bet, v_pay, v_f >= 40);
  return jsonb_build_object('index', v_i, 'tenths', v_f, 'segments', to_jsonb(v_seg), 'bet', p_bet,
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
  v_num integer;
  v_red integer[] := array[1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36];
  v_color text;
  b jsonb;
  v_t text;
  v_v integer;
  v_a integer;
  v_total integer := 0;
  v_pay bigint := 0;
  v_p bigint;
  v_rtp integer := least(greatest(public.setting('gambling_rtp_roulette'), 300), 990);
  v_win boolean;
  v_mult integer;
  v_out jsonb;
  v_sq boolean;
  v_try integer := 0;
  v_balance bigint;
begin
  perform public._feature_guard('gambling');
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  if p_bets is null or jsonb_typeof(p_bets) <> 'array' or jsonb_array_length(p_bets) not between 1 and 10 then
    raise exception 'Setze 1 bis 10 Felder.' using errcode = '22023';
  end if;
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
  end loop;
  if v_total > v_max * 5 then
    raise exception 'Insgesamt höchstens % Coins pro Runde.', v_max * 5 using errcode = '22023';
  end if;
  if coalesce((select balance from public.koin_wallets where user_id = v_me), 0) < v_total then
    raise exception 'Nicht genug Coins.' using errcode = '23514';
  end if;
  v_sq := public._house_squeeze();
  loop
    v_try := v_try + 1;
    v_num := floor(random() * 37)::integer;
    v_color := case when v_num = 0 then 'green' when v_num = any (v_red) then 'red' else 'black' end;
    v_pay := 0;
    v_out := '[]'::jsonb;
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
      v_out := v_out || jsonb_build_array(jsonb_build_object('t', v_t, 'v', v_v, 'a', v_a, 'win', v_win, 'pay', v_p));
    end loop;
    -- Hausschutz: bei einem Gewinn neu drehen (bis zu 40 Mal), bis es kein Gewinn mehr ist
    exit when not v_sq or v_pay <= v_total or v_try >= 40;
  end loop;
  v_balance := public._gamble_settle(v_me, v_total, v_pay, v_pay >= v_total::bigint * 10);
  return jsonb_build_object('number', v_num, 'color', v_color, 'bets', v_out, 'bet', v_total,
                            'payout', v_pay, 'balance', v_balance);
end;
$$;

create or replace function public.gambling_play(p_bet integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  v_roll integer := floor(random() * 1000)::integer;
  v_jack integer := least(greatest(public.setting('gambling_jackpot_permille'), 0), 1000);
  v_win integer := least(greatest(public.setting('gambling_win_permille'), 0), 1000);
  v_max integer := greatest(public.setting('gambling_max_bet'), 1);
  v_mult integer := 0;
  v_is_jackpot boolean := false;
  v_reels integer[];
  v_s integer;
  v_payout bigint;
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
  if v_roll < v_jack then
    v_mult := public.setting('gambling_mult_jackpot');
    v_is_jackpot := true;
    v_reels := array[6, 6, 6];
  elsif v_roll < v_jack + v_win then
    v_mult := public.setting('gambling_mult_win');
    v_s := floor(random() * 6)::integer;
    v_reels := array[v_s, v_s, v_s];
  end if;
  -- Hausschutz: Gewinn wird zu einer Niete
  if v_mult > 0 and public._house_squeeze() then
    v_mult := 0;
    v_is_jackpot := false;
    v_reels := null;
  end if;
  if v_reels is null then
    loop
      v_reels := array[floor(random() * 7)::integer, floor(random() * 7)::integer, floor(random() * 7)::integer];
      exit when not (v_reels[1] = v_reels[2] and v_reels[2] = v_reels[3]);
    end loop;
  end if;
  v_payout := p_bet::bigint * v_mult;
  v_balance := public._gamble_settle(v_me, p_bet, v_payout, v_is_jackpot);
  return jsonb_build_object('reels', to_jsonb(v_reels), 'mult', v_mult, 'payout', v_payout,
                            'bet', p_bet, 'balance', v_balance);
end;
$$;

create or replace function public._bj_resolve(p_h public.blackjack_hands)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  h public.blackjack_hands := p_h;
  v_pt integer := public._bj_total(h.player);
  v_dt integer;
  v_pay bigint := 0;
  v_res text;
  v_balance bigint;
  v_hit17 boolean := public.setting('gambling_bj_dealer_hits_soft17') <> 0;
  v_dealer integer[];
  v_deck integer[];
  v_try integer := 0;
begin
  if v_pt > 21 then
    v_res := 'bust';
  else
    loop
      v_try := v_try + 1;
      v_dealer := h.dealer;
      v_deck := h.deck;
      loop
        v_dt := public._bj_total(v_dealer);
        exit when v_dt > 17 or (v_dt = 17 and not (public._bj_soft(v_dealer) and v_hit17));
        v_dealer := v_dealer || v_deck[1];
        v_deck := v_deck[2:array_length(v_deck, 1)];
      end loop;
      v_dt := public._bj_total(v_dealer);
      -- Hausschutz: bei einem Gewinn des Spielers den Rest des Decks neu mischen und den Geber noch einmal spielen
      exit when not (h.squeeze and (v_dt > 21 or v_pt > v_dt)) or v_try >= 25;
      select array_agg(c order by random()) into h.deck from unnest(h.deck) as c;
    end loop;
    h.dealer := v_dealer;
    h.deck := v_deck;
    if v_dt > 21 or v_pt > v_dt then v_res := 'win'; v_pay := h.bet::bigint * 2;
    elsif v_pt = v_dt then v_res := 'push'; v_pay := h.bet;
    else v_res := 'lose';
    end if;
  end if;
  v_balance := public._bj_finish(h.user_id, h.bet, v_pay);
  return public._bj_state(h, true, v_res, v_pay, v_balance);
end;
$$;

create or replace function public.blackjack_start(p_bet integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  v_max integer := greatest(public.setting('gambling_max_bet'), 1);
  v_old public.blackjack_hands;
  h public.blackjack_hands;
  v_balance bigint;
  v_pay bigint := 0;
  v_res text;
  v_pn boolean;
  v_dn boolean;
  v_x integer := least(greatest(public.setting('gambling_bj_blackjack_x10'), 0), 100);
  v_sq boolean;
  v_try integer := 0;
begin
  perform public._feature_guard('gambling');
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  perform pg_advisory_xact_lock(hashtext('bj' || v_me::text));
  if p_bet is null or p_bet < 1 or p_bet > v_max then
    raise exception 'Der Einsatz muss zwischen 1 und % Coins liegen.', v_max using errcode = '22023';
  end if;
  select * into v_old from public.blackjack_hands where user_id = v_me;
  if found then
    perform public._bj_finish(v_me, v_old.bet, 0);
  end if;
  if coalesce((select balance from public.koin_wallets where user_id = v_me), 0) < p_bet then
    raise exception 'Nicht genug Coins.' using errcode = '23514';
  end if;
  v_balance := public._grant_koins(v_me, -p_bet::bigint, 'gambling_bet', null);
  v_sq := public._house_squeeze();
  h.user_id := v_me;
  h.bet := p_bet;
  h.doubled := false;
  h.squeeze := v_sq;
  loop
    v_try := v_try + 1;
    select array_agg(c order by random()) into h.deck from generate_series(0, 51) as c;
    h.player := array[h.deck[1], h.deck[3]];
    h.dealer := array[h.deck[2], h.deck[4]];
    h.deck := h.deck[5:52];
    exit when not (v_sq and public._bj_total(h.player) = 21) or v_try >= 10;
  end loop;
  v_pn := public._bj_total(h.player) = 21;
  v_dn := public._bj_total(h.dealer) = 21;
  insert into public.blackjack_hands (user_id, bet, deck, player, dealer, doubled, squeeze)
  values (h.user_id, h.bet, h.deck, h.player, h.dealer, false, v_sq);
  if v_pn or v_dn then
    if v_pn and v_dn then v_res := 'push'; v_pay := h.bet;
    elsif v_pn then v_res := 'blackjack'; v_pay := (h.bet::bigint * (10 + v_x)) / 10;
    else v_res := 'lose';
    end if;
    v_balance := public._bj_finish(v_me, h.bet, v_pay);
    return public._bj_state(h, true, v_res, v_pay, v_balance);
  end if;
  return public._bj_state(h, false, null, 0, v_balance);
end;
$$;

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig, p.proname
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('gambling_dice', 'gambling_wheel', 'gambling_roulette', 'gambling_play',
                                                  'blackjack_start', '_bj_resolve')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    if r.proname <> '_bj_resolve' then
      execute format('grant execute on function %s to authenticated', r.sig);
    end if;
  end loop;
end;
$$;
