-- 0039: Black Jack mit Coins. Karten und Mischen liegen komplett auf dem Server (Tabelle ohne Zugriff für Clients),
-- die verdeckte Karte des Gebers wird erst beim Aufdecken gesendet. Regeln: 1 Deck pro Runde, Geber zieht bis 17 und
-- bleibt bei weichem 17 NICHT stehen (zieht weiter), Black Jack zahlt 6:5, Verdoppeln bei den ersten zwei Karten, kein Teilen.
-- Der Einsatz wird beim Start abgebucht. Wer eine offene Runde verlässt und neu startet, verliert sie. Wiederholbar. Nach 0038 ausführen.

create table if not exists public.blackjack_hands (
  user_id uuid primary key references auth.users (id) on delete cascade,
  bet integer not null check (bet > 0),
  deck integer[] not null,
  player integer[] not null,
  dealer integer[] not null,
  doubled boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.blackjack_hands enable row level security;
revoke all on public.blackjack_hands from anon, authenticated;

-- Wert einer Hand (Kartennummer 0..51, Rang = c % 13, 0 = Ass, 9..12 = Zehn/Bube/Dame/König)
create or replace function public._bj_total(p_cards integer[])
returns integer
language sql
immutable
set search_path = public
as $$
  select case when aces > 0 and s + 10 <= 21 then s + 10 else s end
    from (select coalesce(sum(case when c % 13 = 0 then 1 when c % 13 >= 9 then 10 else c % 13 + 1 end), 0)::integer as s,
                 count(*) filter (where c % 13 = 0) as aces
            from unnest(p_cards) as c) t;
$$;

create or replace function public._bj_soft(p_cards integer[])
returns boolean
language sql
immutable
set search_path = public
as $$
  select aces > 0 and s + 10 <= 21
    from (select coalesce(sum(case when c % 13 = 0 then 1 when c % 13 >= 9 then 10 else c % 13 + 1 end), 0)::integer as s,
                 count(*) filter (where c % 13 = 0) as aces
            from unnest(p_cards) as c) t;
$$;

-- Zustand für den Client. Bei offener Runde ist nur die erste Geberkarte sichtbar.
create or replace function public._bj_state(p_h public.blackjack_hands, p_done boolean, p_result text, p_payout bigint, p_balance bigint)
returns jsonb
language plpgsql
immutable
set search_path = public
as $$
begin
  return jsonb_build_object(
    'done', p_done, 'result', p_result, 'bet', p_h.bet, 'payout', p_payout, 'balance', p_balance,
    'player', to_jsonb(p_h.player), 'player_total', public._bj_total(p_h.player),
    'dealer', to_jsonb(case when p_done then p_h.dealer else p_h.dealer[1:1] end),
    'dealer_total', case when p_done then public._bj_total(p_h.dealer) else public._bj_total(p_h.dealer[1:1]) end,
    'can_double', (not p_done) and array_length(p_h.player, 1) = 2 and not p_h.doubled);
end;
$$;

-- Runde abschließen: Auszahlung (inkl. Einsatz) gutschreiben, Statistik und Feed füllen, Hand löschen.
create or replace function public._bj_finish(p_user uuid, p_bet integer, p_payout bigint)
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
  insert into public.gambling_feed (user_id, bet, payout, jackpot) values (p_user, p_bet, least(p_payout, 2000000000)::integer, false);
  delete from public.gambling_feed where created_at < now() - interval '3 days';
  insert into public.gambling_stats (user_id, plays, wagered, won, best_win)
  values (p_user, 1, p_bet, p_payout, least(p_payout, 2000000000)::integer)
  on conflict (user_id) do update
    set plays = public.gambling_stats.plays + 1,
        wagered = public.gambling_stats.wagered + p_bet,
        won = public.gambling_stats.won + p_payout,
        best_win = greatest(public.gambling_stats.best_win, least(p_payout, 2000000000)::integer);
  return v_balance;
end;
$$;

-- Geber spielt aus und die Runde wird gewertet.
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
begin
  if v_pt > 21 then
    v_res := 'bust';
  else
    loop
      v_dt := public._bj_total(h.dealer);
      exit when v_dt > 17 or (v_dt = 17 and not public._bj_soft(h.dealer));
      h.dealer := h.dealer || h.deck[1];
      h.deck := h.deck[2:array_length(h.deck, 1)];
    end loop;
    v_dt := public._bj_total(h.dealer);
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
begin
  perform public._feature_guard('gambling');
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  perform pg_advisory_xact_lock(hashtext('bj' || v_me::text));
  if p_bet is null or p_bet < 1 or p_bet > v_max then
    raise exception 'Der Einsatz muss zwischen 1 und % Coins liegen.', v_max using errcode = '22023';
  end if;
  -- offene Runde verfällt als Verlust (Einsatz war schon abgebucht)
  select * into v_old from public.blackjack_hands where user_id = v_me;
  if found then
    perform public._bj_finish(v_me, v_old.bet, 0);
  end if;
  if coalesce((select balance from public.koin_wallets where user_id = v_me), 0) < p_bet then
    raise exception 'Nicht genug Coins.' using errcode = '23514';
  end if;
  v_balance := public._grant_koins(v_me, -p_bet::bigint, 'gambling_bet', null);
  h.user_id := v_me;
  h.bet := p_bet;
  h.doubled := false;
  select array_agg(c order by random()) into h.deck from generate_series(0, 51) as c;
  h.player := array[h.deck[1], h.deck[3]];
  h.dealer := array[h.deck[2], h.deck[4]];
  h.deck := h.deck[5:52];
  v_pn := public._bj_total(h.player) = 21;
  v_dn := public._bj_total(h.dealer) = 21;
  if v_pn or v_dn then
    if v_pn and v_dn then v_res := 'push'; v_pay := h.bet;
    elsif v_pn then v_res := 'blackjack'; v_pay := (h.bet::bigint * 11) / 5; -- 6:5 plus Einsatz
    else v_res := 'lose';
    end if;
    insert into public.blackjack_hands (user_id, bet, deck, player, dealer, doubled) values (h.user_id, h.bet, h.deck, h.player, h.dealer, false);
    v_balance := public._bj_finish(v_me, h.bet, v_pay);
    return public._bj_state(h, true, v_res, v_pay, v_balance);
  end if;
  insert into public.blackjack_hands (user_id, bet, deck, player, dealer, doubled) values (h.user_id, h.bet, h.deck, h.player, h.dealer, false);
  return public._bj_state(h, false, null, 0, v_balance);
end;
$$;

-- Offene Runde nach Neuladen wieder anzeigen (oder null).
create or replace function public.blackjack_current()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  h public.blackjack_hands;
begin
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  select * into h from public.blackjack_hands where user_id = v_me;
  if not found then return null; end if;
  return public._bj_state(h, false, null, 0,
    coalesce((select balance from public.koin_wallets where user_id = v_me), 0));
end;
$$;

create or replace function public.blackjack_action(p_action text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  h public.blackjack_hands;
  v_balance bigint;
begin
  perform public._feature_guard('gambling');
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  perform pg_advisory_xact_lock(hashtext('bj' || v_me::text));
  select * into h from public.blackjack_hands where user_id = v_me;
  if not found then
    raise exception 'Keine offene Runde.' using errcode = '22023';
  end if;
  if p_action = 'hit' then
    h.player := h.player || h.deck[1];
    h.deck := h.deck[2:array_length(h.deck, 1)];
    if public._bj_total(h.player) >= 21 then
      return public._bj_resolve(h);
    end if;
  elsif p_action = 'stand' then
    return public._bj_resolve(h);
  elsif p_action = 'double' then
    if array_length(h.player, 1) <> 2 or h.doubled then
      raise exception 'Verdoppeln geht nur mit den ersten zwei Karten.' using errcode = '22023';
    end if;
    if coalesce((select balance from public.koin_wallets where user_id = v_me), 0) < h.bet then
      raise exception 'Nicht genug Coins zum Verdoppeln.' using errcode = '23514';
    end if;
    perform public._grant_koins(v_me, -h.bet::bigint, 'gambling_bet', null);
    h.bet := h.bet * 2;
    h.doubled := true;
    h.player := h.player || h.deck[1];
    h.deck := h.deck[2:array_length(h.deck, 1)];
    return public._bj_resolve(h);
  else
    raise exception 'Ungültige Aktion.' using errcode = '22023';
  end if;
  update public.blackjack_hands set player = h.player, deck = h.deck, bet = h.bet, doubled = h.doubled where user_id = v_me;
  v_balance := coalesce((select balance from public.koin_wallets where user_id = v_me), 0);
  return public._bj_state(h, false, null, 0, v_balance);
end;
$$;

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig, p.proname
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('blackjack_start', 'blackjack_action', 'blackjack_current', '_bj_finish', '_bj_resolve', '_bj_state', '_bj_total', '_bj_soft')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    if r.proname in ('blackjack_start', 'blackjack_action', 'blackjack_current') then
      execute format('grant execute on function %s to authenticated', r.sig);
    end if;
  end loop;
end;
$$;
