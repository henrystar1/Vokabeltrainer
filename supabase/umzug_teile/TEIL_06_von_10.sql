
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


-- 0041: Beliebig hohe Einsätze (bis zum ganzen Guthaben) und Gewinne – Rechnen mit bigint.
-- Das Höchstguthaben bleibt 9.000.000.000.000.000 (9 Billiarden); mehr kann der Browser nicht mehr exakt darstellen.
--  * Neue Regel gambling_all_in (1 = jeder darf bis zu seinem ganzen Guthaben setzen, 0 = nur bis zum Höchsteinsatz).
--  * Einsätze, Auszahlungen, Feed und Bilanz-Rangliste rechnen mit bigint statt integer (vorher bei ~2,1 Mrd. Schluss).
--  * Zwischenrechnungen mit numeric, damit auch riesige Einsätze nicht überlaufen.
-- Wiederholbar. Nach 0040 ausführen.

insert into public.app_settings (key, value, mod_editable) values ('gambling_all_in', 1, false) on conflict (key) do nothing;

alter table public.gambling_feed alter column bet type bigint, alter column payout type bigint;
alter table public.gambling_stats alter column best_win type bigint;
alter table public.blackjack_hands alter column bet type bigint;

-- alte integer-Varianten entfernen, damit es keine doppelten Funktionen gibt
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('_gamble_settle', '_bj_finish', 'gambling_dice', 'gambling_wheel', 'gambling_play',
                                                  'blackjack_start', 'get_gambling_feed', 'get_gambling_board')
  loop
    execute format('drop function %s', r.sig);
  end loop;
end;
$$;

create or replace function public._gamble_settle(p_user uuid, p_bet bigint, p_payout bigint, p_jackpot boolean)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance bigint;
begin
  v_balance := public._grant_koins(p_user, -p_bet, 'gambling_bet', null);
  if p_payout > 0 then
    v_balance := public._grant_koins(p_user, p_payout, 'gambling_win', null);
  end if;
  insert into public.gambling_feed (user_id, bet, payout, jackpot) values (p_user, p_bet, p_payout, p_jackpot);
  delete from public.gambling_feed where created_at < now() - interval '3 days';
  insert into public.gambling_stats (user_id, plays, wagered, won, best_win)
  values (p_user, 1, p_bet, p_payout, p_payout)
  on conflict (user_id) do update
    set plays = public.gambling_stats.plays + 1,
        wagered = public.gambling_stats.wagered + p_bet,
        won = public.gambling_stats.won + p_payout,
        best_win = greatest(public.gambling_stats.best_win, p_payout);
  return v_balance;
end;
$$;

create or replace function public._bj_finish(p_user uuid, p_bet bigint, p_payout bigint)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance bigint;
begin
  delete from public.blackjack_hands where user_id = p_user;
  if p_payout > 0 then
    v_balance := public._grant_koins(p_user, p_payout, 'gambling_win', null);
  else
    v_balance := coalesce((select balance from public.koin_wallets where user_id = p_user), 0);
  end if;
  insert into public.gambling_feed (user_id, bet, payout, jackpot) values (p_user, p_bet, p_payout, false);
  delete from public.gambling_feed where created_at < now() - interval '3 days';
  insert into public.gambling_stats (user_id, plays, wagered, won, best_win)
  values (p_user, 1, p_bet, p_payout, p_payout)
  on conflict (user_id) do update
    set plays = public.gambling_stats.plays + 1,
        wagered = public.gambling_stats.wagered + p_bet,
        won = public.gambling_stats.won + p_payout,
        best_win = greatest(public.gambling_stats.best_win, p_payout);
  return v_balance;
end;
$$;
create or replace function public.gambling_dice(p_bet bigint, p_over boolean, p_target integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  v_max bigint;
  v_bal bigint := coalesce((select balance from public.koin_wallets where user_id = (select auth.uid())), 0);
  v_roll integer := 1 + floor(random() * 100)::integer;
  v_chance integer;
  v_maxchance integer := least(greatest(public.setting('gambling_dice_max_chance'), 5), 95);
  v_rtp integer := least(greatest(public.setting('gambling_rtp_dice'), 300), 990);
  v_win boolean;
  v_pay bigint := 0;
  v_balance bigint;
begin
  perform public._feature_guard('gambling');
  v_max := greatest(public.setting('gambling_max_bet'), 1, case when public.setting('gambling_all_in') <> 0 then v_bal else 0 end);
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
  if v_win then v_pay := floor(p_bet::numeric * v_rtp / (10 * v_chance))::bigint; end if;
  v_balance := public._gamble_settle(v_me, p_bet, v_pay, v_pay >= p_bet::bigint * 10);
  return jsonb_build_object('roll', v_roll, 'chance', v_chance, 'win', v_win, 'bet', p_bet,
                            'payout', v_pay, 'balance', v_balance);
end;
$$;
create or replace function public.gambling_wheel(p_bet bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  v_max bigint;
  v_bal bigint := coalesce((select balance from public.koin_wallets where user_id = (select auth.uid())), 0);
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
  v_max := greatest(public.setting('gambling_max_bet'), 1, case when public.setting('gambling_all_in') <> 0 then v_bal else 0 end);
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
  v_pay := floor(p_bet::numeric * v_f / 10)::bigint;
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
  v_max bigint;
  v_bal bigint := coalesce((select balance from public.koin_wallets where user_id = (select auth.uid())), 0);
  v_num integer;
  v_red integer[] := array[1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36];
  v_color text;
  b jsonb;
  v_t text;
  v_v integer;
  v_a bigint;
  v_total bigint := 0;
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
  v_max := greatest(public.setting('gambling_max_bet'), 1, case when public.setting('gambling_all_in') <> 0 then v_bal else 0 end);
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  if p_bets is null or jsonb_typeof(p_bets) <> 'array' or jsonb_array_length(p_bets) not between 1 and 10 then
    raise exception 'Setze 1 bis 10 Felder.' using errcode = '22023';
  end if;
  for b in select * from jsonb_array_elements(p_bets) loop
    v_t := b ->> 't';
    v_v := coalesce((b ->> 'v')::integer, 0);
    v_a := (b ->> 'a')::bigint;
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
      v_a := (b ->> 'a')::bigint;
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
      v_p := case when v_win then floor(v_a::numeric * v_mult * v_rtp / 973)::bigint else 0 end;
      v_pay := v_pay + v_p;
      v_out := v_out || jsonb_build_array(jsonb_build_object('t', v_t, 'v', v_v, 'a', v_a, 'win', v_win, 'pay', v_p));
    end loop;
    -- Hausschutz: bei einem Gewinn neu drehen (bis zu 40 Mal), bis es kein Gewinn mehr ist
    exit when not v_sq or v_pay <= v_total or v_try >= 40;
  end loop;
  v_balance := public._gamble_settle(v_me, v_total, v_pay, v_pay >= v_total * 10);
  return jsonb_build_object('number', v_num, 'color', v_color, 'bets', v_out, 'bet', v_total,
                            'payout', v_pay, 'balance', v_balance);
end;
$$;
create or replace function public.gambling_play(p_bet bigint)
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
  v_max bigint;
  v_bal bigint := coalesce((select balance from public.koin_wallets where user_id = (select auth.uid())), 0);
  v_mult integer := 0;
  v_is_jackpot boolean := false;
  v_reels integer[];
  v_s integer;
  v_payout bigint;
  v_balance bigint;
begin
  perform public._feature_guard('gambling');
  v_max := greatest(public.setting('gambling_max_bet'), 1, case when public.setting('gambling_all_in') <> 0 then v_bal else 0 end);
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
create or replace function public.blackjack_start(p_bet bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  v_max bigint;
  v_bal bigint := coalesce((select balance from public.koin_wallets where user_id = (select auth.uid())), 0);
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
  v_max := greatest(public.setting('gambling_max_bet'), 1, case when public.setting('gambling_all_in') <> 0 then v_bal else 0 end);
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
    elsif v_pn then v_res := 'blackjack'; v_pay := floor(h.bet::numeric * (10 + v_x) / 10)::bigint;
    else v_res := 'lose';
    end if;
    v_balance := public._bj_finish(v_me, h.bet, v_pay);
    return public._bj_state(h, true, v_res, v_pay, v_balance);
  end if;
  return public._bj_state(h, false, null, 0, v_balance);
end;
$$;
create or replace function public.get_gambling_feed()
returns table (id bigint, display_name text, bet bigint, payout bigint, jackpot boolean, created_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select f.id, p.display_name, f.bet, f.payout, f.jackpot, f.created_at
    from public.gambling_feed f
    join public.profiles p on p.id = f.user_id
   where (select auth.uid()) is not null
   order by f.id desc
   limit 20;
$$;

create or replace function public.get_gambling_board()
returns table (rank integer, user_id uuid, display_name text, avatar_id text, color_id text, effect_id text, role text,
               tag_id text, theme_id text, plays integer, wagered bigint, won bigint, net bigint, best_win bigint, is_me boolean)
language sql
stable
security definer
set search_path = public
as $$
  select (row_number() over (order by (s.won - s.wagered) desc, p.display_name))::integer,
         p.id, p.display_name, p.avatar_id, p.color_id, p.effect_id,
         case when p.tags_hidden then 'user' else p.role end,
         case when p.tags_hidden then null else p.tag_id end,
         p.theme_id, s.plays, s.wagered, s.won, s.won - s.wagered, s.best_win, (p.id = (select auth.uid()))
    from public.gambling_stats s
    join public.profiles p on p.id = s.user_id
   where (select auth.uid()) is not null and not public.is_blocked() and not p.blocked and s.plays > 0
   order by (s.won - s.wagered) desc, p.display_name
   limit 200;
$$;

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig, p.proname
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('_gamble_settle', '_bj_finish', 'gambling_dice', 'gambling_wheel', 'gambling_roulette',
                                                  'gambling_play', 'blackjack_start', 'get_gambling_feed', 'get_gambling_board')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    if r.proname not in ('_gamble_settle', '_bj_finish') then
      execute format('grant execute on function %s to authenticated', r.sig);
    end if;
  end loop;
end;
$$;


-- 0042: Live-Duell (bis 4 Spieler), „Wer ist da?“ ohne 3-Minuten-Verzögerung, Admin kann Namen ändern.
--  * Online zählt, wer in den letzten 75 Sekunden aktiv war (die App meldet sich alle 30 Sekunden).
--  * Live-Duell: Lobby mit Einladungen, gemeinsamer Start, Fortschritt aller Spieler live, Rangliste am Ende.
--  * admin_rename_user: Admins können Anzeigenamen ändern (Name muss eindeutig sein, 2 bis 30 Zeichen).
-- Wiederholbar. Nach 0041 ausführen.

-- ----------------------------------------------------------------------------
-- 1. Online-Fenster 3 Minuten -> 75 Sekunden (in allen Funktionen, die last_seen_at auswerten)
-- ----------------------------------------------------------------------------
do $$
declare
  r record;
  v_def text;
begin
  for r in
    select p.oid, p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prokind = 'f'
       and pg_get_functiondef(p.oid) like '%last_seen_at%'
       and pg_get_functiondef(p.oid) like '%interval ''3 minutes''%'
  loop
    v_def := replace(pg_get_functiondef(r.oid), 'interval ''3 minutes''', 'interval ''75 seconds''');
    execute v_def;
  end loop;
end;
$$;

-- ----------------------------------------------------------------------------
-- 2. Namen ändern (nur Admin)
-- ----------------------------------------------------------------------------
create or replace function public.admin_rename_user(p_user uuid, p_name text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
begin
  perform public._require_admin();
  if char_length(v_name) < 2 or char_length(v_name) > 30 then
    raise exception 'Der Name muss 2 bis 30 Zeichen lang sein.' using errcode = '22023';
  end if;
  if exists (select 1 from public.profiles where lower(display_name) = lower(v_name) and id <> p_user) then
    raise exception 'Diesen Namen gibt es schon.' using errcode = '23505';
  end if;
  update public.profiles set display_name = v_name where id = p_user;
  if not found then
    raise exception 'Person nicht gefunden.' using errcode = 'P0002';
  end if;
  return v_name;
end;
$$;

-- ----------------------------------------------------------------------------
-- 3. Live-Duell
-- ----------------------------------------------------------------------------
create table if not exists public.live_duels (
  id uuid primary key default gen_random_uuid(),
  host_id uuid not null references auth.users (id) on delete cascade,
  status text not null default 'lobby' check (status in ('lobby', 'running', 'finished', 'cancelled')),
  q_count integer not null default 10,
  questions jsonb,
  created_at timestamptz not null default now(),
  starts_at timestamptz,
  finished_at timestamptz
);
create index if not exists live_duels_created_idx on public.live_duels (created_at desc);
alter table public.live_duels enable row level security;
revoke all on public.live_duels from anon, authenticated;

create table if not exists public.live_duel_players (
  duel_id uuid not null references public.live_duels (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  state text not null default 'invited' check (state in ('invited', 'joined', 'declined', 'left')),
  answered integer not null default 0,
  correct integer not null default 0,
  millis integer,
  finished_at timestamptz,
  place integer,
  primary key (duel_id, user_id)
);
create index if not exists live_duel_players_user_idx on public.live_duel_players (user_id, duel_id);
alter table public.live_duel_players enable row level security;
revoke all on public.live_duel_players from anon, authenticated;

insert into public.app_settings (key, value, mod_editable) values ('live_duel_reward', 10, false)
on conflict (key) do nothing;

-- Auswertung: Rangfolge festlegen, Sieger belohnen.
create or replace function public._live_finalize(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  d public.live_duels;
  v_winner uuid;
  v_today date := (now() at time zone 'Europe/Berlin')::date;
begin
  select * into d from public.live_duels where id = p_id for update;
  if not found or d.status <> 'running' then return; end if;
  update public.live_duel_players p
     set place = r.rn
    from (select user_id, row_number() over (order by (finished_at is null), correct desc, coalesce(millis, 2147483647), answered desc) as rn
            from public.live_duel_players where duel_id = p_id and state = 'joined') r
   where p.duel_id = p_id and p.user_id = r.user_id;
  update public.live_duels set status = 'finished', finished_at = now() where id = p_id;
  select user_id into v_winner from public.live_duel_players where duel_id = p_id and place = 1;
  if v_winner is not null
     and public.setting('live_duel_reward') > 0
     and (select count(*) from public.koin_ledger l
           where l.user_id = v_winner and l.reason = 'duel'
             and (l.created_at at time zone 'Europe/Berlin')::date = v_today) < public.setting('duel_daily_cap') then
    perform public._grant_koins(v_winner, public.setting('live_duel_reward'), 'duel', p_id::text);
  end if;
end;
$$;

create or replace function public.live_create(p_invitees uuid[], p_count integer default 10)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  v_inv uuid[];
  v_id uuid;
  v_name text;
  u uuid;
begin
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  select coalesce(array_agg(distinct x), '{}') into v_inv from unnest(coalesce(p_invitees, '{}')) as x where x <> v_me;
  if coalesce(array_length(v_inv, 1), 0) < 1 or array_length(v_inv, 1) > 3 then
    raise exception 'Lade 1 bis 3 Mitspieler ein (zusammen höchstens 4).' using errcode = '22023';
  end if;
  if (select count(*) from public.profiles where id = any (v_inv) and not blocked) <> array_length(v_inv, 1) then
    raise exception 'Eine eingeladene Person gibt es nicht.' using errcode = '22023';
  end if;
  -- eigene alte Lobbys schließen
  update public.live_duels set status = 'cancelled', finished_at = now()
   where host_id = v_me and status in ('lobby', 'running') and created_at < now() - interval '1 minute';
  if exists (select 1 from public.live_duels where host_id = v_me and status = 'lobby') then
    raise exception 'Du hast schon eine offene Lobby.' using errcode = '23505';
  end if;
  insert into public.live_duels (host_id, q_count) values (v_me, least(greatest(coalesce(p_count, 10), 5), 20)) returning id into v_id;
  insert into public.live_duel_players (duel_id, user_id, state) values (v_id, v_me, 'joined');
  select display_name into v_name from public.profiles where id = v_me;
  foreach u in array v_inv loop
    insert into public.live_duel_players (duel_id, user_id, state) values (v_id, u, 'invited');
    insert into public.user_messages (user_id, from_id, body)
    values (u, v_me, '⚡ ' || v_name || ' lädt dich zu einem Live-Duell ein! Öffne „Duell“ und tritt der Lobby bei.');
  end loop;
  return v_id;
end;
$$;

-- Meine offenen Einladungen (Lobby, nicht älter als 15 Minuten)
create or replace function public.live_my_invites()
returns table (duel_id uuid, host_name text, host_avatar_id text, host_color_id text, players integer, created_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select d.id, h.display_name, h.avatar_id, h.color_id,
         (select count(*)::integer from public.live_duel_players q where q.duel_id = d.id and q.state in ('joined', 'invited')),
         d.created_at
    from public.live_duel_players p
    join public.live_duels d on d.id = p.duel_id
    join public.profiles h on h.id = d.host_id
   where p.user_id = (select auth.uid()) and p.state = 'invited' and d.status = 'lobby'
     and d.created_at > now() - interval '15 minutes' and not public.is_blocked()
   order by d.created_at desc
   limit 5;
$$;

create or replace function public.live_respond(p_id uuid, p_accept boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  d public.live_duels;
begin
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  select * into d from public.live_duels where id = p_id;
  if not found or d.status <> 'lobby' then
    raise exception 'Diese Lobby gibt es nicht mehr.' using errcode = 'P0002';
  end if;
  update public.live_duel_players set state = case when p_accept then 'joined' else 'declined' end
   where duel_id = p_id and user_id = v_me and state in ('invited', 'declined', 'joined');
  if not found then
    raise exception 'Du bist nicht eingeladen.' using errcode = '42501';
  end if;
end;
$$;

create or replace function public.live_leave(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  d public.live_duels;
begin
  if v_me is null then return; end if;
  select * into d from public.live_duels where id = p_id;
  if not found then return; end if;
  if d.host_id = v_me and d.status = 'lobby' then
    update public.live_duels set status = 'cancelled', finished_at = now() where id = p_id;
    return;
  end if;
  update public.live_duel_players set state = 'left' where duel_id = p_id and user_id = v_me and state in ('joined', 'invited');
  if d.status = 'running' and not exists (select 1 from public.live_duel_players where duel_id = p_id and state = 'joined' and finished_at is null) then
    perform public._live_finalize(p_id);
  end if;
end;
$$;

-- Host startet: Fragen aus Vokabeln, die ALLE Mitspieler aktiv haben. Start nach 4 Sekunden Countdown.
create or replace function public.live_start(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  d public.live_duels;
  v_joined uuid[];
  v_q jsonb;
begin
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  select * into d from public.live_duels where id = p_id for update;
  if not found or d.host_id <> v_me or d.status <> 'lobby' then
    raise exception 'Nur der Host kann eine offene Lobby starten.' using errcode = '42501';
  end if;
  select array_agg(user_id) into v_joined from public.live_duel_players where duel_id = p_id and state = 'joined';
  if coalesce(array_length(v_joined, 1), 0) < 2 then
    raise exception 'Es muss mindestens eine Person beigetreten sein.' using errcode = '22023';
  end if;
  select jsonb_agg(jsonb_build_object('vocabulary_id', x.vid, 'direction', case when random() < 0.5 then 'forward' else 'backward' end))
    into v_q
    from (
      select a.vocabulary_id as vid
        from public.user_active_vocab a
       where a.user_id = any (v_joined)
         and exists (select 1 from public.translations t where t.vocabulary_id = a.vocabulary_id)
       group by a.vocabulary_id
      having count(distinct a.user_id) = array_length(v_joined, 1)
       order by random()
       limit d.q_count
    ) x;
  if coalesce(jsonb_array_length(v_q), 0) < 5 then
    raise exception 'Ihr habt zu wenige gemeinsame aktive Vokabeln (mindestens 5).' using errcode = '22023';
  end if;
  update public.live_duel_players set state = 'declined' where duel_id = p_id and state = 'invited';
  update public.live_duels
     set status = 'running', questions = v_q, q_count = jsonb_array_length(v_q), starts_at = now() + interval '4 seconds'
   where id = p_id;
end;
$$;

-- Zustand für alle Beteiligten (wird jede Sekunde abgefragt)
create or replace function public.live_get(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  d public.live_duels;
  v_in boolean;
begin
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  select * into d from public.live_duels where id = p_id;
  select exists (select 1 from public.live_duel_players where duel_id = p_id and user_id = v_me and state in ('joined', 'invited')) into v_in;
  if d.id is null or not v_in then
    raise exception 'Live-Duell nicht gefunden.' using errcode = 'P0002';
  end if;
  -- Hängengebliebene Runden abschließen
  if d.status = 'running' and d.starts_at + make_interval(secs => d.q_count * 60 + 120) < now() then
    perform public._live_finalize(p_id);
    select * into d from public.live_duels where id = p_id;
  end if;
  -- Lobbys, die lange offen sind, verfallen
  if d.status = 'lobby' and d.created_at < now() - interval '30 minutes' then
    update public.live_duels set status = 'cancelled', finished_at = now() where id = p_id;
    select * into d from public.live_duels where id = p_id;
  end if;
  return jsonb_build_object(
    'id', d.id, 'status', d.status, 'is_host', d.host_id = v_me, 'host_id', d.host_id, 'me', v_me,
    'q_count', d.q_count, 'now', now(), 'starts_at', d.starts_at,
    'players', coalesce((
      select jsonb_agg(jsonb_build_object(
               'user_id', p.user_id, 'name', pr.display_name, 'state', p.state, 'answered', p.answered, 'correct', p.correct,
               'finished', p.finished_at is not null, 'millis', p.millis, 'place', p.place,
               'avatar_id', pr.avatar_id, 'color_id', pr.color_id, 'effect_id', pr.effect_id, 'tag_id', case when pr.tags_hidden then null else pr.tag_id end,
               'theme_id', pr.theme_id, 'role', case when pr.tags_hidden then 'user' else pr.role end)
             order by (p.user_id <> d.host_id), pr.display_name)
        from public.live_duel_players p join public.profiles pr on pr.id = p.user_id
       where p.duel_id = p_id and p.state in ('joined', 'invited', 'left')), '[]'::jsonb),
    'questions', case when d.status in ('running', 'finished') then coalesce((
      select jsonb_agg(jsonb_build_object(
               'vocabulary_id', v.id, 'direction', e.q ->> 'direction', 'german', v.german,
               'german_alts', to_jsonb(v.german_alts),
               'translations', coalesce((select jsonb_agg(t.translation order by t.sort_order, t.created_at)
                                           from public.translations t where t.vocabulary_id = v.id), '[]'::jsonb)
             ) order by e.ord)
        from jsonb_array_elements(d.questions) with ordinality as e(q, ord)
        join public.vocabulary v on v.id = (e.q ->> 'vocabulary_id')::uuid), '[]'::jsonb) else null end);
end;
$$;

create or replace function public.live_progress(p_id uuid, p_answered integer, p_correct integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  d public.live_duels;
begin
  if v_me is null then return; end if;
  select * into d from public.live_duels where id = p_id;
  if not found or d.status <> 'running' or d.starts_at > now() + interval '2 seconds' then return; end if;
  update public.live_duel_players
     set answered = least(greatest(p_answered, answered), d.q_count),
         correct = least(greatest(p_correct, correct), least(greatest(p_answered, answered), d.q_count))
   where duel_id = p_id and user_id = v_me and state = 'joined' and finished_at is null;
end;
$$;

create or replace function public.live_finish(p_id uuid, p_correct integer, p_millis integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  d public.live_duels;
begin
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  select * into d from public.live_duels where id = p_id for update;
  if not found or d.status <> 'running' then return; end if;
  update public.live_duel_players
     set answered = d.q_count, correct = least(greatest(coalesce(p_correct, 0), 0), d.q_count),
         millis = least(greatest(coalesce(p_millis, 0), 0), 3600000), finished_at = now()
   where duel_id = p_id and user_id = v_me and state = 'joined' and finished_at is null;
  if not exists (select 1 from public.live_duel_players where duel_id = p_id and state = 'joined' and finished_at is null) then
    perform public._live_finalize(p_id);
  end if;
end;
$$;

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig, p.proname
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('admin_rename_user', '_live_finalize', 'live_create', 'live_my_invites', 'live_respond',
                                                  'live_leave', 'live_start', 'live_get', 'live_progress', 'live_finish')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    if r.proname <> '_live_finalize' then
      execute format('grant execute on function %s to authenticated', r.sig);
    end if;
  end loop;
end;
$$;


-- 0043: Klassen-Battle (bis 20 Spieler). Wie das Live-Duell, aber mit Raum-Code zum Beitreten und Fragen aus einem Buch des Hosts.
--  * live_create bekommt p_book (Klassen-Battle: bis 20 Spieler, Code, Fragen aus diesem Buch, egal ob aktiv).
--  * live_join_code: Beitreten mit dem 4-stelligen Code.
-- Wiederholbar. Nach 0042 ausführen.

alter table public.live_duels add column if not exists book_id uuid references public.books (id) on delete set null;
alter table public.live_duels add column if not exists max_players integer not null default 4;
alter table public.live_duels add column if not exists code text;
create index if not exists live_duels_code_idx on public.live_duels (code) where code is not null;

drop function if exists public.live_create(uuid[], integer);

create or replace function public.live_create(p_invitees uuid[], p_count integer default 10, p_book uuid default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  v_inv uuid[];
  v_id uuid;
  v_name text;
  v_class boolean := p_book is not null;
  v_max integer := case when p_book is not null then 20 else 4 end;
  v_code text := null;
  u uuid;
begin
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  if v_class and not public.in_library(p_book) then
    raise exception 'Dieses Buch ist nicht in deiner Bibliothek.' using errcode = '42501';
  end if;
  select coalesce(array_agg(distinct x), '{}') into v_inv from unnest(coalesce(p_invitees, '{}')) as x where x <> v_me;
  if v_class then
    if coalesce(array_length(v_inv, 1), 0) > 19 then
      raise exception 'Du kannst höchstens 19 Personen einladen (mit dir 20).' using errcode = '22023';
    end if;
  elsif coalesce(array_length(v_inv, 1), 0) < 1 or array_length(v_inv, 1) > 3 then
    raise exception 'Lade 1 bis 3 Mitspieler ein (zusammen höchstens 4).' using errcode = '22023';
  end if;
  if (select count(*) from public.profiles where id = any (v_inv) and not blocked) <> coalesce(array_length(v_inv, 1), 0) then
    raise exception 'Eine eingeladene Person gibt es nicht.' using errcode = '22023';
  end if;
  update public.live_duels set status = 'cancelled', finished_at = now()
   where host_id = v_me and status in ('lobby', 'running') and created_at < now() - interval '1 minute';
  if exists (select 1 from public.live_duels where host_id = v_me and status = 'lobby') then
    raise exception 'Du hast schon eine offene Lobby.' using errcode = '23505';
  end if;
  if v_class then
    for i in 1..20 loop
      v_code := (select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 1 + floor(random() * 32)::integer, 1), '') from generate_series(1, 4));
      exit when not exists (select 1 from public.live_duels where code = v_code and status = 'lobby' and created_at > now() - interval '30 minutes');
    end loop;
  end if;
  insert into public.live_duels (host_id, q_count, book_id, max_players, code)
  values (v_me, least(greatest(coalesce(p_count, 10), 5), 30), p_book, v_max, v_code) returning id into v_id;
  insert into public.live_duel_players (duel_id, user_id, state) values (v_id, v_me, 'joined');
  select display_name into v_name from public.profiles where id = v_me;
  foreach u in array v_inv loop
    insert into public.live_duel_players (duel_id, user_id, state) values (v_id, u, 'invited');
    insert into public.user_messages (user_id, from_id, body)
    values (u, v_me, case when v_class then '🏫 ' || v_name || ' lädt dich zu einem Klassen-Battle ein! Öffne „Duell“ und tritt der Lobby bei.'
                          else '⚡ ' || v_name || ' lädt dich zu einem Live-Duell ein! Öffne „Duell“ und tritt der Lobby bei.' end);
  end loop;
  return v_id;
end;
$$;

create or replace function public.live_join_code(p_code text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  d public.live_duels;
begin
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  select * into d from public.live_duels
   where code = upper(btrim(coalesce(p_code, ''))) and status = 'lobby' and created_at > now() - interval '30 minutes'
   order by created_at desc limit 1;
  if not found then
    raise exception 'Mit diesem Code gibt es keine offene Lobby.' using errcode = 'P0002';
  end if;
  if (select count(*) from public.live_duel_players where duel_id = d.id and state = 'joined') >= d.max_players
     and not exists (select 1 from public.live_duel_players where duel_id = d.id and user_id = v_me and state = 'joined') then
    raise exception 'Die Lobby ist voll.' using errcode = '54000';
  end if;
  insert into public.live_duel_players (duel_id, user_id, state) values (d.id, v_me, 'joined')
  on conflict (duel_id, user_id) do update set state = 'joined';
  return d.id;
end;
$$;

create or replace function public.live_respond(p_id uuid, p_accept boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  d public.live_duels;
begin
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  select * into d from public.live_duels where id = p_id;
  if not found or d.status <> 'lobby' then
    raise exception 'Diese Lobby gibt es nicht mehr.' using errcode = 'P0002';
  end if;
  if p_accept and (select count(*) from public.live_duel_players where duel_id = p_id and state = 'joined') >= d.max_players
     and not exists (select 1 from public.live_duel_players where duel_id = p_id and user_id = v_me and state = 'joined') then
    raise exception 'Die Lobby ist voll.' using errcode = '54000';
  end if;
  update public.live_duel_players set state = case when p_accept then 'joined' else 'declined' end
   where duel_id = p_id and user_id = v_me and state in ('invited', 'declined', 'joined');
  if not found then
    raise exception 'Du bist nicht eingeladen.' using errcode = '42501';
  end if;
end;
$$;
create or replace function public.live_start(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  d public.live_duels;
  v_joined uuid[];
  v_q jsonb;
begin
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  select * into d from public.live_duels where id = p_id for update;
  if not found or d.host_id <> v_me or d.status <> 'lobby' then
    raise exception 'Nur der Host kann eine offene Lobby starten.' using errcode = '42501';
  end if;
  select array_agg(user_id) into v_joined from public.live_duel_players where duel_id = p_id and state = 'joined';
  if coalesce(array_length(v_joined, 1), 0) < 2 then
    raise exception 'Es muss mindestens eine Person beigetreten sein.' using errcode = '22023';
  end if;
  if d.book_id is not null then
    -- Klassen-Battle: alle Vokabeln des gewählten Buchs, egal ob aktiv
    select jsonb_agg(jsonb_build_object('vocabulary_id', x.vid, 'direction', case when random() < 0.5 then 'forward' else 'backward' end))
      into v_q
      from (
        select v.id as vid from public.vocabulary v
         where v.book_id = d.book_id and exists (select 1 from public.translations t where t.vocabulary_id = v.id)
         order by random()
         limit d.q_count
      ) x;
  else
    select jsonb_agg(jsonb_build_object('vocabulary_id', x.vid, 'direction', case when random() < 0.5 then 'forward' else 'backward' end))
      into v_q
      from (
        select a.vocabulary_id as vid
          from public.user_active_vocab a
         where a.user_id = any (v_joined)
           and exists (select 1 from public.translations t where t.vocabulary_id = a.vocabulary_id)
         group by a.vocabulary_id
        having count(distinct a.user_id) = array_length(v_joined, 1)
         order by random()
         limit d.q_count
      ) x;
  end if;
  if coalesce(jsonb_array_length(v_q), 0) < 5 then
    raise exception 'Es gibt zu wenige passende Vokabeln (mindestens 5).' using errcode = '22023';
  end if;
  update public.live_duel_players set state = 'declined' where duel_id = p_id and state = 'invited';
  update public.live_duels
     set status = 'running', questions = v_q, q_count = jsonb_array_length(v_q), starts_at = now() + interval '4 seconds'
   where id = p_id;
end;
$$;
create or replace function public.live_get(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  d public.live_duels;
  v_in boolean;
begin
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  select * into d from public.live_duels where id = p_id;
  select exists (select 1 from public.live_duel_players where duel_id = p_id and user_id = v_me and state in ('joined', 'invited')) into v_in;
  if d.id is null or not v_in then
    raise exception 'Live-Duell nicht gefunden.' using errcode = 'P0002';
  end if;
  -- Hängengebliebene Runden abschließen
  if d.status = 'running' and d.starts_at + make_interval(secs => d.q_count * 60 + 120) < now() then
    perform public._live_finalize(p_id);
    select * into d from public.live_duels where id = p_id;
  end if;
  -- Lobbys, die lange offen sind, verfallen
  if d.status = 'lobby' and d.created_at < now() - interval '30 minutes' then
    update public.live_duels set status = 'cancelled', finished_at = now() where id = p_id;
    select * into d from public.live_duels where id = p_id;
  end if;
  return jsonb_build_object(
    'id', d.id, 'status', d.status, 'max_players', d.max_players, 'code', d.code, 'is_class', d.book_id is not null,
    'book_name', (select b.name from public.books b where b.id = d.book_id), 'is_host', d.host_id = v_me, 'host_id', d.host_id, 'me', v_me,
    'q_count', d.q_count, 'now', now(), 'starts_at', d.starts_at,
    'players', coalesce((
      select jsonb_agg(jsonb_build_object(
               'user_id', p.user_id, 'name', pr.display_name, 'state', p.state, 'answered', p.answered, 'correct', p.correct,
               'finished', p.finished_at is not null, 'millis', p.millis, 'place', p.place,
               'avatar_id', pr.avatar_id, 'color_id', pr.color_id, 'effect_id', pr.effect_id, 'tag_id', case when pr.tags_hidden then null else pr.tag_id end,
               'theme_id', pr.theme_id, 'role', case when pr.tags_hidden then 'user' else pr.role end)
             order by (p.user_id <> d.host_id), pr.display_name)
        from public.live_duel_players p join public.profiles pr on pr.id = p.user_id
       where p.duel_id = p_id and p.state in ('joined', 'invited', 'left')), '[]'::jsonb),
    'questions', case when d.status in ('running', 'finished') then coalesce((
      select jsonb_agg(jsonb_build_object(
               'vocabulary_id', v.id, 'direction', e.q ->> 'direction', 'german', v.german,
               'german_alts', to_jsonb(v.german_alts),
               'translations', coalesce((select jsonb_agg(t.translation order by t.sort_order, t.created_at)
                                           from public.translations t where t.vocabulary_id = v.id), '[]'::jsonb)
             ) order by e.ord)
        from jsonb_array_elements(d.questions) with ordinality as e(q, ord)
        join public.vocabulary v on v.id = (e.q ->> 'vocabulary_id')::uuid), '[]'::jsonb) else null end);
end;
$$;
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('live_create', 'live_join_code', 'live_respond', 'live_start', 'live_get')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;
end;
$$;

-- 0044: Siegprämien einstellbar, offene Klassen-Battles zum Anklicken, Team-Parcours (2 Personen gemeinsam).
--  * Einstellungen: live_duel_reward (bestand), live_class_reward_1/2/3, team_reward, team_lives, team_daily_cap.
--  * Klassen-Battle: Plätze 1–3 bekommen Coins; live_open_classes zeigt offene Räume, live_join_open tritt ohne Code bei.
--  * Team-Parcours (2 Personen): team_runs + team_create/_my_invites/_respond/_start/_get/_report/_leave.
--    Art 'parkour' = Joystick-Jump'n'Run (Positionen laufen über Realtime), team_parkour_finish; Art 'quiz' = Vokabel-Parcours.
-- Wiederholbar. Nach 0043 ausführen.

insert into public.app_settings (key, value, mod_editable) values
  ('live_class_reward_1', 20, false),
  ('live_class_reward_2', 10, false),
  ('live_class_reward_3', 5, false),
  ('team_reward', 15, false),
  ('team_parkour_reward', 25, false),
  ('team_lives', 3, false),
  ('team_daily_cap', 10, false)
on conflict (key) do nothing;

-- Coins für einen Platz, mit Tageslimit (duel_daily_cap)
create or replace function public._live_pay(p_user uuid, p_amount integer, p_ref text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_user is not null and p_amount > 0
     and (select count(*) from public.koin_ledger l
           where l.user_id = p_user and l.reason = 'duel'
             and (l.created_at at time zone 'Europe/Berlin')::date = (now() at time zone 'Europe/Berlin')::date) < public.setting('duel_daily_cap') then
    perform public._grant_koins(p_user, p_amount, 'duel', p_ref);
  end if;
end;
$$;

create or replace function public._live_finalize(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  d public.live_duels;
  r record;
begin
  select * into d from public.live_duels where id = p_id for update;
  if not found or d.status <> 'running' then return; end if;
  update public.live_duel_players p
     set place = x.rn
    from (select user_id, row_number() over (order by (finished_at is null), correct desc, coalesce(millis, 2147483647), answered desc) as rn
            from public.live_duel_players where duel_id = p_id and state = 'joined') x
   where p.duel_id = p_id and p.user_id = x.user_id;
  update public.live_duels set status = 'finished', finished_at = now() where id = p_id;
  for r in select user_id, place from public.live_duel_players where duel_id = p_id and state = 'joined' and place <= (case when d.book_id is not null then 3 else 1 end) loop
    perform public._live_pay(r.user_id,
      case when d.book_id is null then public.setting('live_duel_reward')
           when r.place = 1 then public.setting('live_class_reward_1')
           when r.place = 2 then public.setting('live_class_reward_2')
           else public.setting('live_class_reward_3') end,
      p_id::text);
  end loop;
end;
$$;

create or replace function public.live_get(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  d public.live_duels;
  v_in boolean;
begin
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  select * into d from public.live_duels where id = p_id;
  select exists (select 1 from public.live_duel_players where duel_id = p_id and user_id = v_me and state in ('joined', 'invited')) into v_in;
  if d.id is null or not v_in then
    raise exception 'Live-Duell nicht gefunden.' using errcode = 'P0002';
  end if;
  -- Hängengebliebene Runden abschließen
  if d.status = 'running' and d.starts_at + make_interval(secs => d.q_count * 60 + 120) < now() then
    perform public._live_finalize(p_id);
    select * into d from public.live_duels where id = p_id;
  end if;
  -- Lobbys, die lange offen sind, verfallen
  if d.status = 'lobby' and d.created_at < now() - interval '30 minutes' then
    update public.live_duels set status = 'cancelled', finished_at = now() where id = p_id;
    select * into d from public.live_duels where id = p_id;
  end if;
  return jsonb_build_object(
    'id', d.id, 'status', d.status, 'max_players', d.max_players, 'code', d.code, 'is_class', d.book_id is not null,
    'rewards', case when d.book_id is not null then jsonb_build_array(public.setting('live_class_reward_1'), public.setting('live_class_reward_2'), public.setting('live_class_reward_3'))
                    else jsonb_build_array(public.setting('live_duel_reward')) end,
    'book_name', (select b.name from public.books b where b.id = d.book_id), 'is_host', d.host_id = v_me, 'host_id', d.host_id, 'me', v_me,
    'q_count', d.q_count, 'now', now(), 'starts_at', d.starts_at,
    'players', coalesce((
      select jsonb_agg(jsonb_build_object(
               'user_id', p.user_id, 'name', pr.display_name, 'state', p.state, 'answered', p.answered, 'correct', p.correct,
               'finished', p.finished_at is not null, 'millis', p.millis, 'place', p.place,
               'avatar_id', pr.avatar_id, 'color_id', pr.color_id, 'effect_id', pr.effect_id, 'tag_id', case when pr.tags_hidden then null else pr.tag_id end,
               'theme_id', pr.theme_id, 'role', case when pr.tags_hidden then 'user' else pr.role end)
             order by (p.user_id <> d.host_id), pr.display_name)
        from public.live_duel_players p join public.profiles pr on pr.id = p.user_id
       where p.duel_id = p_id and p.state in ('joined', 'invited', 'left')), '[]'::jsonb),
    'questions', case when d.status in ('running', 'finished') then coalesce((
      select jsonb_agg(jsonb_build_object(
               'vocabulary_id', v.id, 'direction', e.q ->> 'direction', 'german', v.german,
               'german_alts', to_jsonb(v.german_alts),
               'translations', coalesce((select jsonb_agg(t.translation order by t.sort_order, t.created_at)
                                           from public.translations t where t.vocabulary_id = v.id), '[]'::jsonb)
             ) order by e.ord)
        from jsonb_array_elements(d.questions) with ordinality as e(q, ord)
        join public.vocabulary v on v.id = (e.q ->> 'vocabulary_id')::uuid), '[]'::jsonb) else null end);
end;
$$;


-- Offene Klassen-Battles (jeder kann beitreten, ohne Code)
create or replace function public.live_open_classes()
returns table (duel_id uuid, host_name text, host_avatar_id text, host_color_id text, book_name text, players integer, max_players integer, created_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select d.id, h.display_name, h.avatar_id, h.color_id, b.name,
         (select count(*)::integer from public.live_duel_players q where q.duel_id = d.id and q.state = 'joined'),
         d.max_players, d.created_at
    from public.live_duels d
    join public.profiles h on h.id = d.host_id
    left join public.books b on b.id = d.book_id
   where d.status = 'lobby' and d.book_id is not null and d.created_at > now() - interval '30 minutes'
     and not public.is_blocked() and (select auth.uid()) is not null
     and (select count(*) from public.live_duel_players q where q.duel_id = d.id and q.state = 'joined') < d.max_players
   order by d.created_at desc
   limit 20;
$$;

create or replace function public.live_join_open(p_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  d public.live_duels;
begin
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  select * into d from public.live_duels where id = p_id and book_id is not null and status = 'lobby' and created_at > now() - interval '30 minutes';
  if not found then
    raise exception 'Dieser Raum ist nicht mehr offen.' using errcode = 'P0002';
  end if;
  if (select count(*) from public.live_duel_players where duel_id = d.id and state = 'joined') >= d.max_players
     and not exists (select 1 from public.live_duel_players where duel_id = d.id and user_id = v_me and state = 'joined') then
    raise exception 'Die Lobby ist voll.' using errcode = '54000';
  end if;
  insert into public.live_duel_players (duel_id, user_id, state) values (d.id, v_me, 'joined')
  on conflict (duel_id, user_id) do update set state = 'joined';
  return d.id;
end;
$$;

-- ---------- Team-Parcours ----------
create table if not exists public.team_runs (
  id uuid primary key default gen_random_uuid(),
  host_id uuid not null references public.profiles (id) on delete cascade,
  partner_id uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'lobby' check (status in ('lobby', 'running', 'won', 'lost', 'cancelled')),
  kind text not null default 'quiz' check (kind in ('quiz', 'parkour')),
  millis integer,
  deaths integer,
  partner_state text not null default 'invited' check (partner_state in ('invited', 'joined', 'declined', 'left')),
  obstacles integer not null default 10,
  lives integer not null default 3,
  lives_left integer not null default 3,
  step integer not null default 0,
  host_ok boolean not null default false,
  partner_ok boolean not null default false,
  host_idx integer not null default 0,
  partner_idx integer not null default 0,
  host_right integer not null default 0,
  host_wrong integer not null default 0,
  partner_right integer not null default 0,
  partner_wrong integer not null default 0,
  host_questions jsonb,
  partner_questions jsonb,
  starts_at timestamptz,
  finished_at timestamptz,
  paid_host integer not null default 0,
  paid_partner integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (host_id <> partner_id)
);
alter table public.team_runs add column if not exists kind text not null default 'quiz' check (kind in ('quiz', 'parkour'));
alter table public.team_runs add column if not exists millis integer;
alter table public.team_runs add column if not exists deaths integer;
create index if not exists team_runs_partner_idx on public.team_runs (partner_id, status);
create index if not exists team_runs_host_idx on public.team_runs (host_id, status);
alter table public.team_runs enable row level security;
revoke all on public.team_runs from anon, authenticated;

create or replace function public._team_pay(p_user uuid, p_amount integer, p_ref text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_amount > 0
     and (select count(*) from public.koin_ledger l
           where l.user_id = p_user and l.reason = 'team'
             and (l.created_at at time zone 'Europe/Berlin')::date = (now() at time zone 'Europe/Berlin')::date) < public.setting('team_daily_cap') then
    perform public._grant_koins(p_user, p_amount, 'team', p_ref);
    return p_amount;
  end if;
  return 0;
end;
$$;

drop function if exists public.team_create(uuid, integer);
create or replace function public.team_create(p_partner uuid, p_obstacles integer default 10, p_kind text default 'quiz')
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  v_id uuid;
  v_name text;
begin
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  if p_partner is null or p_partner = v_me or not exists (select 1 from public.profiles where id = p_partner and not blocked) then
    raise exception 'Diese Person gibt es nicht.' using errcode = '22023';
  end if;
  update public.team_runs set status = 'cancelled', finished_at = now()
   where host_id = v_me and status in ('lobby', 'running') and updated_at < now() - interval '1 minute';
  if exists (select 1 from public.team_runs where host_id = v_me and status = 'lobby') then
    raise exception 'Du hast schon eine offene Team-Lobby.' using errcode = '23505';
  end if;
  insert into public.team_runs (host_id, partner_id, obstacles, lives, lives_left, kind)
  values (v_me, p_partner, case when p_kind = 'parkour' then 3 else least(greatest(coalesce(p_obstacles, 10), 6), 16) end, least(greatest(public.setting('team_lives'), 1), 9), least(greatest(public.setting('team_lives'), 1), 9), case when p_kind = 'parkour' then 'parkour' else 'quiz' end)
  returning id into v_id;
  select display_name into v_name from public.profiles where id = v_me;
  insert into public.user_messages (user_id, from_id, body)
  values (p_partner, v_me, case when p_kind = 'parkour' then '🏃 ' || v_name || ' lädt dich zum Team-Parkour ein (Joystick-Spiel zu zweit)! Öffne „Duell“ und tritt der Lobby bei.' else '🏃 ' || v_name || ' lädt dich zum Team-Parcours ein! Öffne „Duell“ und tritt der Lobby bei.' end);
  return v_id;
end;
$$;

drop function if exists public.team_my_invites();
create or replace function public.team_my_invites()
returns table (run_id uuid, host_name text, host_avatar_id text, host_color_id text, created_at timestamptz, kind text)
language sql
stable
security definer
set search_path = public
as $$
  select t.id, h.display_name, h.avatar_id, h.color_id, t.created_at, t.kind
    from public.team_runs t
    join public.profiles h on h.id = t.host_id
   where t.partner_id = (select auth.uid()) and t.partner_state = 'invited' and t.status = 'lobby'
     and t.created_at > now() - interval '15 minutes' and not public.is_blocked()
   order by t.created_at desc
   limit 3;
$$;

create or replace function public.team_respond(p_id uuid, p_accept boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
begin
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  update public.team_runs
     set partner_state = case when p_accept then 'joined' else 'declined' end, updated_at = now()
   where id = p_id and partner_id = v_me and status = 'lobby' and partner_state in ('invited', 'declined', 'joined');
  if not found then
    raise exception 'Diese Team-Lobby gibt es nicht mehr.' using errcode = 'P0002';
  end if;
end;
$$;

create or replace function public.team_leave(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  t public.team_runs;
begin
  if v_me is null then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  select * into t from public.team_runs where id = p_id for update;
  if not found or v_me not in (t.host_id, t.partner_id) then return; end if;
  if t.status = 'lobby' then
    if v_me = t.host_id then
      update public.team_runs set status = 'cancelled', finished_at = now(), updated_at = now() where id = p_id;
    else
      update public.team_runs set partner_state = 'left', updated_at = now() where id = p_id;
    end if;
  elsif t.status = 'running' then
    update public.team_runs set status = 'cancelled', finished_at = now(), updated_at = now() where id = p_id;
  end if;
end;
$$;

create or replace function public.team_start(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  t public.team_runs;
  v_ids uuid[];
  v_n integer;
  v_pool integer;
  v_h jsonb;
  v_p jsonb;
begin
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  select * into t from public.team_runs where id = p_id for update;
  if not found or t.host_id <> v_me or t.status <> 'lobby' then
    raise exception 'Nur der Host kann eine offene Team-Lobby starten.' using errcode = '42501';
  end if;
  if t.partner_state <> 'joined' then
    raise exception 'Dein Partner ist noch nicht beigetreten.' using errcode = '22023';
  end if;
  if t.kind = 'parkour' then
    update public.team_runs set status = 'running', starts_at = now() + interval '5 seconds', updated_at = now(), step = 0 where id = p_id;
    return;
  end if;
  select array_agg(x.vid order by random()) into v_ids
    from (
      select a.vocabulary_id as vid
        from public.user_active_vocab a
       where a.user_id in (t.host_id, t.partner_id)
         and exists (select 1 from public.translations tr where tr.vocabulary_id = a.vocabulary_id)
       group by a.vocabulary_id
      having count(distinct a.user_id) = 2
    ) x;
  v_n := coalesce(array_length(v_ids, 1), 0);
  if v_n < 6 then
    raise exception 'Ihr habt zu wenige gemeinsame aktive Vokabeln (mindestens 6).' using errcode = '22023';
  end if;
  v_pool := t.obstacles + t.lives;
  select jsonb_agg(jsonb_build_object('vocabulary_id', v_ids[1 + ((2 * (i - 1)) % v_n)], 'direction', case when random() < 0.5 then 'forward' else 'backward' end) order by i)
    into v_h from generate_series(1, v_pool) i;
  select jsonb_agg(jsonb_build_object('vocabulary_id', v_ids[1 + ((2 * (i - 1) + 1) % v_n)], 'direction', case when random() < 0.5 then 'forward' else 'backward' end) order by i)
    into v_p from generate_series(1, v_pool) i;
  update public.team_runs
     set status = 'running', host_questions = v_h, partner_questions = v_p, starts_at = now() + interval '4 seconds', updated_at = now(),
         step = 0, lives_left = lives, host_ok = false, partner_ok = false, host_idx = 0, partner_idx = 0
   where id = p_id;
end;
$$;

create or replace function public.team_report(p_id uuid, p_step integer, p_correct boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  t public.team_runs;
  v_host boolean;
  v_reward integer := public.setting('team_reward');
begin
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  select * into t from public.team_runs where id = p_id for update;
  if not found or t.status <> 'running' or t.kind <> 'quiz' or v_me not in (t.host_id, t.partner_id) then return; end if;
  if t.starts_at > now() or p_step is distinct from t.step then return; end if;
  v_host := v_me = t.host_id;
  if (v_host and t.host_ok) or (not v_host and t.partner_ok) then return; end if;
  if p_correct then
    if v_host then t.host_ok := true; t.host_right := t.host_right + 1;
    else t.partner_ok := true; t.partner_right := t.partner_right + 1; end if;
    if t.host_ok and t.partner_ok then
      t.step := t.step + 1;
      t.host_ok := false; t.partner_ok := false;
      t.host_idx := t.host_idx + 1; t.partner_idx := t.partner_idx + 1;
      if t.step >= t.obstacles then
        t.status := 'won';
        t.finished_at := now();
        t.paid_host := public._team_pay(t.host_id, v_reward, p_id::text);
        t.paid_partner := public._team_pay(t.partner_id, v_reward, p_id::text);
      end if;
    end if;
  else
    t.lives_left := t.lives_left - 1;
    if v_host then t.host_idx := t.host_idx + 1; t.host_wrong := t.host_wrong + 1;
    else t.partner_idx := t.partner_idx + 1; t.partner_wrong := t.partner_wrong + 1; end if;
    if t.lives_left <= 0 then
      t.status := 'lost';
      t.finished_at := now();
    end if;
  end if;
  update public.team_runs
     set status = t.status, step = t.step, lives_left = t.lives_left, host_ok = t.host_ok, partner_ok = t.partner_ok,
         host_idx = t.host_idx, partner_idx = t.partner_idx, host_right = t.host_right, host_wrong = t.host_wrong,
         partner_right = t.partner_right, partner_wrong = t.partner_wrong, finished_at = t.finished_at,
         paid_host = t.paid_host, paid_partner = t.paid_partner, updated_at = now()
   where id = p_id;
end;
$$;

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
    'id', t.id, 'kind', t.kind, 'millis', t.millis, 'deaths', t.deaths, 'status', t.status, 'is_host', v_host, 'me', v_me, 'now', now(), 'starts_at', t.starts_at,
    'obstacles', t.obstacles, 'lives', t.lives, 'lives_left', t.lives_left, 'step', t.step,
    'host_ok', t.host_ok, 'partner_ok', t.partner_ok, 'partner_state', t.partner_state,
    'host_right', t.host_right, 'host_wrong', t.host_wrong, 'partner_right', t.partner_right, 'partner_wrong', t.partner_wrong,
    'reward', case when t.kind = 'parkour' then public.setting('team_parkour_reward') else public.setting('team_reward') end, 'paid', case when v_host then t.paid_host else t.paid_partner end,
    'my_question', v_my,
    'people', (
      select jsonb_agg(jsonb_build_object(
               'user_id', pr.id, 'name', pr.display_name, 'avatar_id', pr.avatar_id, 'color_id', pr.color_id, 'effect_id', pr.effect_id,
               'tag_id', case when pr.tags_hidden then null else pr.tag_id end, 'theme_id', pr.theme_id,
               'role', case when pr.tags_hidden then 'user' else pr.role end, 'is_host', pr.id = t.host_id)
             order by (pr.id <> t.host_id))
        from public.profiles pr where pr.id in (t.host_id, t.partner_id)));
end;
$$;


create or replace function public.team_parkour_finish(p_id uuid, p_millis integer, p_deaths integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  t public.team_runs;
  v_reward integer := public.setting('team_parkour_reward');
begin
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  select * into t from public.team_runs where id = p_id for update;
  if not found or t.kind <> 'parkour' or t.status <> 'running' or v_me not in (t.host_id, t.partner_id) then return; end if;
  -- Die drei Level brauchen mindestens eine Minute, früher kann es nicht stimmen.
  if t.starts_at + interval '60 seconds' > now() then return; end if;
  update public.team_runs
     set status = 'won', finished_at = now(), updated_at = now(),
         millis = least(greatest(coalesce(p_millis, 0), 0), 7200000), deaths = least(greatest(coalesce(p_deaths, 0), 0), 9999), step = obstacles,
         paid_host = public._team_pay(t.host_id, v_reward, p_id::text),
         paid_partner = public._team_pay(t.partner_id, v_reward, p_id::text)
   where id = p_id;
end;
$$;

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig, p.proname
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('_live_pay', '_live_finalize', 'live_get', 'live_open_classes', 'live_join_open', '_team_pay',
                                                  'team_create', 'team_parkour_finish', 'team_my_invites', 'team_respond', 'team_leave', 'team_start', 'team_report', 'team_get')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    if r.proname not in ('_live_pay', '_live_finalize', '_team_pay') then
      execute format('grant execute on function %s to authenticated', r.sig);
    end if;
  end loop;
end;
$$;

-- 0045: Team-Parkour: 8 Level, gemeinsame Herzen, Coins nach Fortschritt, Duo-Bestenliste.
--  * Coins: parkour_coins_level je geschafftem Level, parkour_coins_cp je erreichtem Checkpoint, parkour_coins_bonus für alle 8 Level.
--  * team_parkour_finish(p_id, p_millis, p_deaths, p_levels, p_cps): beendet den Lauf (alle 8 Level = gewonnen, sonst verloren), zahlt nach Fortschritt.
--  * team_parkour_board(): beste Läufe je Duo.
-- Wiederholbar. Nach 0044 ausführen.

alter table public.team_runs add column if not exists levels integer;
alter table public.team_runs add column if not exists cps integer;

insert into public.app_settings (key, value, mod_editable) values
  ('parkour_coins_level', 8, false),
  ('parkour_coins_cp', 2, false),
  ('parkour_coins_bonus', 30, false)
on conflict (key) do nothing;

drop function if exists public.team_parkour_finish(uuid, integer, integer);
create or replace function public.team_parkour_finish(p_id uuid, p_millis integer, p_deaths integer, p_levels integer, p_cps integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  t public.team_runs;
  v_lv integer := least(greatest(coalesce(p_levels, 0), 0), 8);
  v_cp integer := least(greatest(coalesce(p_cps, 0), 0), 60);
  v_coins integer;
begin
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  select * into t from public.team_runs where id = p_id for update;
  if not found or t.kind <> 'parkour' or t.status <> 'running' or v_me not in (t.host_id, t.partner_id) then return; end if;
  -- Ein Level dauert mindestens 12 Sekunden; schneller kann die Meldung nicht stimmen.
  if t.starts_at + make_interval(secs => 12 * v_lv) > now() then return; end if;
  v_coins := v_lv * public.setting('parkour_coins_level') + v_cp * public.setting('parkour_coins_cp')
             + case when v_lv >= 8 then public.setting('parkour_coins_bonus') else 0 end;
  update public.team_runs
     set status = case when v_lv >= 8 then 'won' else 'lost' end, finished_at = now(), updated_at = now(),
         millis = least(greatest(coalesce(p_millis, 0), 0), 7200000), deaths = least(greatest(coalesce(p_deaths, 0), 0), 9999),
         levels = v_lv, cps = v_cp, step = v_lv,
         paid_host = public._team_pay(t.host_id, v_coins, p_id::text),
         paid_partner = public._team_pay(t.partner_id, v_coins, p_id::text)
   where id = p_id;
end;
$$;

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
               'role', case when pr.tags_hidden then 'user' else pr.role end, 'is_host', pr.id = t.host_id)
             order by (pr.id <> t.host_id))
        from public.profiles pr where pr.id in (t.host_id, t.partner_id)));
end;
$$;

create or replace function public.team_parkour_board()
returns table (host_name text, host_avatar_id text, host_color_id text, partner_name text, partner_avatar_id text, partner_color_id text,
               levels integer, cps integer, millis integer, deaths integer, finished_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select h.display_name, h.avatar_id, h.color_id, p.display_name, p.avatar_id, p.color_id, x.levels, x.cps, x.millis, x.deaths, x.finished_at
    from (
      select distinct on (least(t.host_id, t.partner_id), greatest(t.host_id, t.partner_id)) t.*
        from public.team_runs t
       where t.kind = 'parkour' and t.status in ('won', 'lost') and t.levels is not null
       order by least(t.host_id, t.partner_id), greatest(t.host_id, t.partner_id), t.levels desc, t.cps desc, t.millis asc
    ) x
    join public.profiles h on h.id = x.host_id
    join public.profiles p on p.id = x.partner_id
   where (select auth.uid()) is not null and not public.is_blocked()
   order by x.levels desc, x.cps desc, x.millis asc
   limit 20;
$$;

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('team_parkour_finish', 'team_get', 'team_parkour_board')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;
end;
$$;

-- 0046: Team-Parkour endlos: nach den 8 handgebauten Leveln kommen zufällige, immer schwerere.
--  * team_parkour_finish: bis zu 500 Level, Zusatz-Coins ab Level 9 (parkour_coins_endless je Level).
-- Wiederholbar. Nach 0045 ausführen.

insert into public.app_settings (key, value, mod_editable) values ('parkour_coins_endless', 5, false)
on conflict (key) do nothing;

create or replace function public.team_parkour_finish(p_id uuid, p_millis integer, p_deaths integer, p_levels integer, p_cps integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  t public.team_runs;
  v_lv integer := least(greatest(coalesce(p_levels, 0), 0), 500);
  v_cp integer := least(greatest(coalesce(p_cps, 0), 0), 2000);
  v_coins integer;
begin
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  select * into t from public.team_runs where id = p_id for update;
  if not found or t.kind <> 'parkour' or t.status <> 'running' or v_me not in (t.host_id, t.partner_id) then return; end if;
  -- Ein Level dauert mindestens 12 Sekunden; schneller kann die Meldung nicht stimmen.
  if t.starts_at + make_interval(secs => 12 * v_lv) > now() then return; end if;
  v_coins := least(v_lv, 8) * public.setting('parkour_coins_level')
             + greatest(v_lv - 8, 0) * (public.setting('parkour_coins_level') + public.setting('parkour_coins_endless'))
             + v_cp * public.setting('parkour_coins_cp')
             + case when v_lv >= 8 then public.setting('parkour_coins_bonus') else 0 end;
  update public.team_runs
     set status = case when v_lv >= 8 then 'won' else 'lost' end, finished_at = now(), updated_at = now(),
         millis = least(greatest(coalesce(p_millis, 0), 0), 7200000), deaths = least(greatest(coalesce(p_deaths, 0), 0), 9999),
         levels = v_lv, cps = v_cp, step = least(v_lv, 2000),
         paid_host = public._team_pay(t.host_id, v_coins, p_id::text),
         paid_partner = public._team_pay(t.partner_id, v_coins, p_id::text)
   where id = p_id;
end;
$$;

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'team_parkour_finish'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;
end;
$$;

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

-- 0048: Team-Parkour mit bis zu 5 Personen (Host + Partner + bis zu 3 weitere).
--  * team_run_extras: weitere Mitspieler (Zustand eingeladen / beigetreten / abgelehnt / verlassen, ausgezahlte Coins).
--  * team_create(p_partner, p_obstacles, p_kind, p_extra uuid[]): lädt zusätzlich bis zu 3 Personen ein (nur Parkour).
--  * team_my_invites / team_respond / team_leave / team_start / team_get / team_parkour_finish kennen die weiteren Mitspieler.
--  * team_parkour_board liefert group_size (Anzahl Mitspielende).
-- Wiederholbar. Nach 0047 ausführen.

create table if not exists public.team_run_extras (
  run_id uuid not null references public.team_runs (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  state text not null default 'invited' check (state in ('invited', 'joined', 'declined', 'left')),
  paid integer not null default 0,
  created_at timestamptz not null default now(),
  primary key (run_id, user_id)
);
create index if not exists team_run_extras_user_idx on public.team_run_extras (user_id, state);
alter table public.team_run_extras enable row level security;
revoke all on public.team_run_extras from anon, authenticated;

drop function if exists public.team_create(uuid, integer, text);
create or replace function public.team_create(p_partner uuid, p_obstacles integer default 10, p_kind text default 'quiz', p_extra uuid[] default '{}')
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  v_id uuid;
  v_name text;
  v_extra uuid[];
  v_x uuid;
begin
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  if p_partner is null or p_partner = v_me or not exists (select 1 from public.profiles where id = p_partner and not blocked) then
    raise exception 'Diese Person gibt es nicht.' using errcode = '22023';
  end if;
  -- weitere Mitspieler (nur Parkour): ohne Doppelte, ohne dich und den Partner, höchstens 3
  select coalesce(array_agg(distinct e), '{}') into v_extra from unnest(coalesce(p_extra, '{}')) e where e <> v_me and e <> p_partner;
  if p_kind <> 'parkour' and array_length(v_extra, 1) is not null then
    raise exception 'Nur der Parkour geht mit mehr als zwei Personen.' using errcode = '22023';
  end if;
  if coalesce(array_length(v_extra, 1), 0) > 3 then
    raise exception 'Höchstens 5 Personen pro Parkour.' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(v_extra) e where not exists (select 1 from public.profiles where id = e and not blocked)) then
    raise exception 'Diese Person gibt es nicht.' using errcode = '22023';
  end if;
  update public.team_runs set status = 'cancelled', finished_at = now()
   where host_id = v_me and status in ('lobby', 'running') and updated_at < now() - interval '1 minute';
  if exists (select 1 from public.team_runs where host_id = v_me and status = 'lobby') then
    raise exception 'Du hast schon eine offene Team-Lobby.' using errcode = '23505';
  end if;
  insert into public.team_runs (host_id, partner_id, obstacles, lives, lives_left, kind)
  values (v_me, p_partner, case when p_kind = 'parkour' then 3 else least(greatest(coalesce(p_obstacles, 10), 6), 16) end, least(greatest(public.setting('team_lives'), 1), 9), least(greatest(public.setting('team_lives'), 1), 9), case when p_kind = 'parkour' then 'parkour' else 'quiz' end)
  returning id into v_id;
  select display_name into v_name from public.profiles where id = v_me;
  insert into public.user_messages (user_id, from_id, body)
  values (p_partner, v_me, case when p_kind = 'parkour' then '🏃 ' || v_name || ' lädt dich zum Team-Parkour ein (Joystick-Spiel mit bis zu 5 Personen)! Öffne „Parkour“ oder „Duell“ und tritt der Lobby bei.' else '🏃 ' || v_name || ' lädt dich zum Team-Parcours ein! Öffne „Duell“ und tritt der Lobby bei.' end);
  foreach v_x in array v_extra loop
    insert into public.team_run_extras (run_id, user_id) values (v_id, v_x);
    insert into public.user_messages (user_id, from_id, body)
    values (v_x, v_me, '🏃 ' || v_name || ' lädt dich zum Team-Parkour ein (Joystick-Spiel mit bis zu 5 Personen)! Öffne „Parkour“ oder „Duell“ und tritt der Lobby bei.');
  end loop;
  return v_id;
end;
$$;

drop function if exists public.team_my_invites();
create or replace function public.team_my_invites()
returns table (run_id uuid, host_name text, host_avatar_id text, host_color_id text, created_at timestamptz, kind text)
language sql
stable
security definer
set search_path = public
as $$
  select t.id, h.display_name, h.avatar_id, h.color_id, t.created_at, t.kind
    from public.team_runs t
    join public.profiles h on h.id = t.host_id
   where t.status = 'lobby' and t.created_at > now() - interval '15 minutes' and not public.is_blocked()
     and ((t.partner_id = (select auth.uid()) and t.partner_state = 'invited')
          or exists (select 1 from public.team_run_extras x where x.run_id = t.id and x.user_id = (select auth.uid()) and x.state = 'invited'))
   order by t.created_at desc
   limit 3;
$$;

create or replace function public.team_respond(p_id uuid, p_accept boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
begin
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  update public.team_runs
     set partner_state = case when p_accept then 'joined' else 'declined' end, updated_at = now()
   where id = p_id and partner_id = v_me and status = 'lobby' and partner_state in ('invited', 'declined', 'joined');
  if found then return; end if;
  update public.team_run_extras x
     set state = case when p_accept then 'joined' else 'declined' end
   where x.run_id = p_id and x.user_id = v_me and x.state in ('invited', 'declined', 'joined')
     and exists (select 1 from public.team_runs t where t.id = p_id and t.status = 'lobby');
  if not found then
    raise exception 'Diese Team-Lobby gibt es nicht mehr.' using errcode = 'P0002';
  end if;
  update public.team_runs set updated_at = now() where id = p_id;
end;
$$;

create or replace function public.team_leave(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  t public.team_runs;
begin
  if v_me is null then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  select * into t from public.team_runs where id = p_id for update;
  if not found then return; end if;
  if v_me not in (t.host_id, t.partner_id) and not exists (select 1 from public.team_run_extras where run_id = p_id and user_id = v_me) then return; end if;
  if t.status = 'lobby' then
    if v_me = t.host_id then
      update public.team_runs set status = 'cancelled', finished_at = now(), updated_at = now() where id = p_id;
    elsif v_me = t.partner_id then
      update public.team_runs set partner_state = 'left', updated_at = now() where id = p_id;
    else
      update public.team_run_extras set state = 'left' where run_id = p_id and user_id = v_me;
    end if;
  elsif t.status = 'running' then
    if t.kind = 'parkour' and v_me <> t.host_id and exists (select 1 from public.team_run_extras where run_id = p_id and state = 'joined' and user_id <> v_me) then
      -- Gruppe läuft weiter, nur diese Person steigt aus
      if v_me = t.partner_id then
        update public.team_runs set partner_state = 'left', updated_at = now() where id = p_id;
      else
        update public.team_run_extras set state = 'left' where run_id = p_id and user_id = v_me;
      end if;
    elsif t.kind = 'parkour' and v_me = t.partner_id and exists (select 1 from public.team_run_extras where run_id = p_id and state = 'joined') then
      update public.team_runs set partner_state = 'left', updated_at = now() where id = p_id;
    elsif t.kind = 'parkour' and v_me <> t.host_id and v_me <> t.partner_id then
      update public.team_run_extras set state = 'left' where run_id = p_id and user_id = v_me;
    else
      update public.team_runs set status = 'cancelled', finished_at = now(), updated_at = now() where id = p_id;
    end if;
  end if;
end;
$$;

create or replace function public.team_start(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  t public.team_runs;
  v_ids uuid[];
  v_n integer;
  v_pool integer;
  v_h jsonb;
  v_p jsonb;
begin
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  select * into t from public.team_runs where id = p_id for update;
  if not found or t.host_id <> v_me or t.status <> 'lobby' then
    raise exception 'Nur der Host kann eine offene Team-Lobby starten.' using errcode = '42501';
  end if;
  if t.partner_state <> 'joined'
     and not (t.kind = 'parkour' and exists (select 1 from public.team_run_extras x where x.run_id = p_id and x.state = 'joined')) then
    raise exception 'Es ist noch niemand beigetreten.' using errcode = '22023';
  end if;
  if t.kind = 'parkour' then
    update public.team_runs set status = 'running', starts_at = now() + interval '5 seconds', updated_at = now(), step = 0 where id = p_id;
    return;
  end if;
  select array_agg(x.vid order by random()) into v_ids
    from (
      select a.vocabulary_id as vid
        from public.user_active_vocab a
       where a.user_id in (t.host_id, t.partner_id)
         and exists (select 1 from public.translations tr where tr.vocabulary_id = a.vocabulary_id)
       group by a.vocabulary_id
      having count(distinct a.user_id) = 2
    ) x;
  v_n := coalesce(array_length(v_ids, 1), 0);
  if v_n < 6 then
    raise exception 'Ihr habt zu wenige gemeinsame aktive Vokabeln (mindestens 6).' using errcode = '22023';
  end if;
  v_pool := t.obstacles + t.lives;
  select jsonb_agg(jsonb_build_object('vocabulary_id', v_ids[1 + ((2 * (i - 1)) % v_n)], 'direction', case when random() < 0.5 then 'forward' else 'backward' end) order by i)
    into v_h from generate_series(1, v_pool) i;
  select jsonb_agg(jsonb_build_object('vocabulary_id', v_ids[1 + ((2 * (i - 1) + 1) % v_n)], 'direction', case when random() < 0.5 then 'forward' else 'backward' end) order by i)
    into v_p from generate_series(1, v_pool) i;
  update public.team_runs
     set status = 'running', host_questions = v_h, partner_questions = v_p, starts_at = now() + interval '4 seconds', updated_at = now(),
         step = 0, lives_left = lives, host_ok = false, partner_ok = false, host_idx = 0, partner_idx = 0
   where id = p_id;
end;
$$;

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
  if not found
     or (v_me not in (t.host_id, t.partner_id) and not exists (select 1 from public.team_run_extras x where x.run_id = p_id and x.user_id = v_me and (x.state <> 'declined' or t.status <> 'lobby')))
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
    'reward', case when t.kind = 'parkour' then public.setting('team_parkour_reward') else public.setting('team_reward') end, 'paid', case when v_host then t.paid_host when v_me = t.partner_id then t.paid_partner else coalesce((select x.paid from public.team_run_extras x where x.run_id = t.id and x.user_id = v_me), 0) end,
    'my_question', v_my,
    'people', (
      select jsonb_agg(jsonb_build_object(
               'user_id', pr.id, 'name', pr.display_name, 'avatar_id', pr.avatar_id, 'color_id', pr.color_id, 'effect_id', pr.effect_id,
               'tag_id', case when pr.tags_hidden then null else pr.tag_id end, 'theme_id', pr.theme_id,
               'role', case when pr.tags_hidden then 'user' else pr.role end, 'is_host', pr.id = t.host_id, 'state', m.st,
               'pk_hearts', coalesce(pp.extra_hearts, 0), 'pk_color', pp.color, 'pk_hat', pp.hat)
             order by m.ord, m.ts)
        from (
          select t.host_id as uid, 'host'::text as st, 0 as ord, t.created_at as ts
          union all select t.partner_id, t.partner_state, 1, t.created_at
          union all select x.user_id, x.state, 2, x.created_at from public.team_run_extras x where x.run_id = t.id
        ) m
        join public.profiles pr on pr.id = m.uid
        left join public.parkour_profiles pp on pp.user_id = pr.id
       where m.st not in ('declined', 'left')));
end;
$$;

create or replace function public.team_parkour_finish(p_id uuid, p_millis integer, p_deaths integer, p_levels integer, p_cps integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  t public.team_runs;
  v_lv integer := least(greatest(coalesce(p_levels, 0), 0), 500);
  v_cp integer := least(greatest(coalesce(p_cps, 0), 0), 2000);
  v_coins integer;
begin
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  select * into t from public.team_runs where id = p_id for update;
  if not found or t.kind <> 'parkour' or t.status <> 'running'
     or (v_me <> t.host_id and not (v_me = t.partner_id and t.partner_state = 'joined')
         and not exists (select 1 from public.team_run_extras x where x.run_id = p_id and x.user_id = v_me and x.state = 'joined')) then return; end if;
  -- Ein Level dauert mindestens 12 Sekunden; schneller kann die Meldung nicht stimmen.
  if t.starts_at + make_interval(secs => 12 * v_lv) > now() then return; end if;
  v_coins := least(v_lv, 8) * public.setting('parkour_coins_level')
             + greatest(v_lv - 8, 0) * (public.setting('parkour_coins_level') + public.setting('parkour_coins_endless'))
             + v_cp * public.setting('parkour_coins_cp')
             + case when v_lv >= 8 then public.setting('parkour_coins_bonus') else 0 end;
  update public.team_runs
     set status = case when v_lv >= 8 then 'won' else 'lost' end, finished_at = now(), updated_at = now(),
         millis = least(greatest(coalesce(p_millis, 0), 0), 7200000), deaths = least(greatest(coalesce(p_deaths, 0), 0), 9999),
         levels = v_lv, cps = v_cp, step = least(v_lv, 2000),
         paid_host = public._team_pay(t.host_id, v_coins, p_id::text),
         paid_partner = case when t.partner_state = 'joined' then public._team_pay(t.partner_id, v_coins, p_id::text) else 0 end
   where id = p_id;
  update public.team_run_extras x set paid = public._team_pay(x.user_id, v_coins, p_id::text) where x.run_id = p_id and x.state = 'joined';
end;
$$;

drop function if exists public.team_parkour_board();
create or replace function public.team_parkour_board()
returns table (host_name text, host_avatar_id text, host_color_id text, partner_name text, partner_avatar_id text, partner_color_id text,
               levels integer, cps integer, millis integer, deaths integer, finished_at timestamptz, group_size integer)
language sql
stable
security definer
set search_path = public
as $$
  select h.display_name, h.avatar_id, h.color_id, p.display_name, p.avatar_id, p.color_id, x.levels, x.cps, x.millis, x.deaths, x.finished_at,
           1 + case when x.partner_state = 'joined' then 1 else 0 end + (select count(*)::integer from public.team_run_extras e where e.run_id = x.id and e.state = 'joined')
    from (
      select distinct on (least(t.host_id, t.partner_id), greatest(t.host_id, t.partner_id)) t.*
        from public.team_runs t
       where t.kind = 'parkour' and t.status in ('won', 'lost') and t.levels is not null
       order by least(t.host_id, t.partner_id), greatest(t.host_id, t.partner_id), t.levels desc, t.cps desc, t.millis asc
    ) x
    join public.profiles h on h.id = x.host_id
    join public.profiles p on p.id = x.partner_id
   where (select auth.uid()) is not null and not public.is_blocked()
   order by x.levels desc, x.cps desc, x.millis asc
   limit 20;
$$;
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('team_create', 'team_my_invites', 'team_respond', 'team_leave', 'team_start', 'team_get', 'team_parkour_finish', 'team_parkour_board')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;
end;
$$;

-- 0049: Deathrun (Parkour, jeder für sich): alle laufen so weit wie möglich, jede Person hat eigene Herzen und kommt
-- allein ins nächste Level, sobald sie im Ziel ist. Tore und Brücken brauchen weiterhin Teamarbeit (Platten halten).
--  * team_runs.kind kennt jetzt 'deathrun' (Lobby, Einladung bis 5 Personen wie beim Parkour).
--  * deathrun_results: Ergebnis je Person (Level, Checkpoints, Zeit, Stürze, Coins).
--  * team_deathrun_finish: meldet das Ergebnis einer Person (Coins wie beim Parkour). Der Lauf endet, wenn alle ein Ergebnis haben.
--  * deathrun_board(): Bestenliste der einzelnen Personen (für die Seite Rangliste).
-- Wiederholbar. Nach 0048 ausführen.

alter table public.team_runs drop constraint if exists team_runs_kind_check;
alter table public.team_runs add constraint team_runs_kind_check check (kind in ('quiz', 'parkour', 'deathrun'));

create table if not exists public.deathrun_results (
  run_id uuid not null references public.team_runs (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  levels integer not null default 0,
  cps integer not null default 0,
  millis integer not null default 0,
  deaths integer not null default 0,
  paid integer not null default 0,
  created_at timestamptz not null default now(),
  primary key (run_id, user_id)
);
create index if not exists deathrun_results_rank_idx on public.deathrun_results (levels desc, millis asc);
alter table public.deathrun_results enable row level security;
revoke all on public.deathrun_results from anon, authenticated;

drop function if exists public.team_create(uuid, integer, text, uuid[]);
create or replace function public.team_create(p_partner uuid, p_obstacles integer default 10, p_kind text default 'quiz', p_extra uuid[] default '{}')
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  v_id uuid;
  v_name text;
  v_extra uuid[];
  v_x uuid;
  v_kind text := case when p_kind in ('parkour', 'deathrun') then p_kind else 'quiz' end;
  v_label text := case when p_kind = 'deathrun' then 'zum Deathrun (Parkour, jeder für sich, aber mit Teamarbeit an den Toren)' when p_kind = 'parkour' then 'zum Team-Parkour (Joystick-Spiel mit bis zu 5 Personen)' else 'zum Team-Parcours' end;
begin
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  if p_partner is null or p_partner = v_me or not exists (select 1 from public.profiles where id = p_partner and not blocked) then
    raise exception 'Diese Person gibt es nicht.' using errcode = '22023';
  end if;
  select coalesce(array_agg(distinct e), '{}') into v_extra from unnest(coalesce(p_extra, '{}')) e where e <> v_me and e <> p_partner;
  if v_kind = 'quiz' and array_length(v_extra, 1) is not null then
    raise exception 'Nur Parkour und Deathrun gehen mit mehr als zwei Personen.' using errcode = '22023';
  end if;
  if coalesce(array_length(v_extra, 1), 0) > 3 then
    raise exception 'Höchstens 5 Personen pro Lauf.' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(v_extra) e where not exists (select 1 from public.profiles where id = e and not blocked)) then
    raise exception 'Diese Person gibt es nicht.' using errcode = '22023';
  end if;
  update public.team_runs set status = 'cancelled', finished_at = now()
   where host_id = v_me and status in ('lobby', 'running') and updated_at < now() - interval '1 minute';
  if exists (select 1 from public.team_runs where host_id = v_me and status = 'lobby') then
    raise exception 'Du hast schon eine offene Team-Lobby.' using errcode = '23505';
  end if;
  insert into public.team_runs (host_id, partner_id, obstacles, lives, lives_left, kind)
  values (v_me, p_partner, case when v_kind <> 'quiz' then 3 else least(greatest(coalesce(p_obstacles, 10), 6), 16) end, least(greatest(public.setting('team_lives'), 1), 9), least(greatest(public.setting('team_lives'), 1), 9), v_kind)
  returning id into v_id;
  select display_name into v_name from public.profiles where id = v_me;
  insert into public.user_messages (user_id, from_id, body)
  values (p_partner, v_me, '🏃 ' || v_name || ' lädt dich ' || v_label || ' ein! Öffne „Parkour“ oder „Duell“ und tritt der Lobby bei.');
  foreach v_x in array v_extra loop
    insert into public.team_run_extras (run_id, user_id) values (v_id, v_x);
    insert into public.user_messages (user_id, from_id, body)
    values (v_x, v_me, '🏃 ' || v_name || ' lädt dich ' || v_label || ' ein! Öffne „Parkour“ oder „Duell“ und tritt der Lobby bei.');
  end loop;
  return v_id;
end;
$$;

-- Hilfsfunktion: Deathrun beenden, sobald jede beigetretene Person ein Ergebnis gemeldet hat
create or replace function public._deathrun_close(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  t public.team_runs;
begin
  select * into t from public.team_runs where id = p_id for update;
  if not found or t.kind <> 'deathrun' or t.status <> 'running' then return; end if;
  if exists (
    select 1 from (
      select t.host_id as uid
      union all select t.partner_id where t.partner_state = 'joined'
      union all select x.user_id from public.team_run_extras x where x.run_id = p_id and x.state = 'joined'
    ) m
    where not exists (select 1 from public.deathrun_results r where r.run_id = p_id and r.user_id = m.uid)
  ) then return; end if;
  update public.team_runs
     set status = 'lost', finished_at = now(), updated_at = now(),
         levels = (select max(levels) from public.deathrun_results where run_id = p_id),
         cps = (select max(cps) from public.deathrun_results where run_id = p_id),
         millis = (select max(millis) from public.deathrun_results where run_id = p_id),
         deaths = (select sum(deaths)::integer from public.deathrun_results where run_id = p_id)
   where id = p_id;
end;
$$;

create or replace function public.team_deathrun_finish(p_id uuid, p_millis integer, p_deaths integer, p_levels integer, p_cps integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  t public.team_runs;
  v_lv integer := least(greatest(coalesce(p_levels, 0), 0), 500);
  v_cp integer := least(greatest(coalesce(p_cps, 0), 0), 2000);
  v_coins integer;
begin
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  select * into t from public.team_runs where id = p_id for update;
  if not found or t.kind <> 'deathrun' or t.status <> 'running' then return; end if;
  if v_me <> t.host_id and not (v_me = t.partner_id and t.partner_state in ('joined', 'left'))
     and not exists (select 1 from public.team_run_extras x where x.run_id = p_id and x.user_id = v_me and x.state in ('joined', 'left')) then return; end if;
  if exists (select 1 from public.deathrun_results where run_id = p_id and user_id = v_me) then return; end if;
  if t.starts_at + make_interval(secs => 12 * v_lv) > now() then return; end if;
  v_coins := least(v_lv, 8) * public.setting('parkour_coins_level')
             + greatest(v_lv - 8, 0) * (public.setting('parkour_coins_level') + public.setting('parkour_coins_endless'))
             + v_cp * public.setting('parkour_coins_cp')
             + case when v_lv >= 8 then public.setting('parkour_coins_bonus') else 0 end;
  insert into public.deathrun_results (run_id, user_id, levels, cps, millis, deaths, paid)
  values (p_id, v_me, v_lv, v_cp, least(greatest(coalesce(p_millis, 0), 0), 7200000), least(greatest(coalesce(p_deaths, 0), 0), 9999),
          public._team_pay(v_me, v_coins, p_id::text));
  perform public._deathrun_close(p_id);
end;
$$;
