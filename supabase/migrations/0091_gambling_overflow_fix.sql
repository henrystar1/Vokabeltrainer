-- 0091: Gambling gegen Überlauf („bigint out of range“) abgesichert. Wiederholbar. Nach 0090 ausführen.
-- Ursache: Der Hausschutz (_house_squeeze) rechnete (Einsätze − Gewinne) × 1000 in bigint. Nach sehr hohen Einsätzen in den letzten
-- 3 Tagen lief das über, und dann scheiterte JEDES Spiel. Jetzt rechnet alles mit numeric und wird auf den bigint-Bereich begrenzt.

create or replace function public._patch_fn(p_name text, p_from text, p_to text)
returns void
language plpgsql
as $$
declare
  v_oid oid;
  v_def text;
  v_new text;
begin
  select p.oid into v_oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = p_name limit 1;
  if v_oid is null then
    raise exception 'Funktion % nicht gefunden', p_name;
  end if;
  -- Windows-Zeilenenden (CRLF) entfernen, damit mehrzeilige Muster passen
  v_def := replace(pg_get_functiondef(v_oid), chr(13), '');
  if position(p_to in v_def) > 0 then
    return;  -- schon angewendet
  end if;
  v_new := replace(v_def, p_from, p_to);
  if v_new = v_def then
    raise exception 'Patch für % nicht anwendbar: %', p_name, p_from;
  end if;
  execute v_new;
end;
$$;

-- Hausschutz: numeric statt bigint; ein einzelner Eintrag zählt höchstens mit 1.000.000.000.000 Coins (ein Ausreißer verzerrt die Quote nicht).
create or replace function public._house_squeeze()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_max integer := least(greatest(public.setting('gambling_guard_max_permille'), 0), 1000);
  v_target integer := public.setting('gambling_guard_target_permille');
  v_w numeric;
  v_p numeric;
  v_margin numeric;
begin
  if v_max = 0 then return false; end if;
  select coalesce(sum(least(bet, 1000000000000)), 0), coalesce(sum(least(payout, 1000000000000)), 0) into v_w, v_p
    from public.gambling_feed where created_at > now() - interval '3 days';
  if v_w <= 0 or v_w < public.setting('gambling_guard_min_wagered') then return false; end if;
  v_margin := ((v_w - v_p) * 1000) / v_w;
  if v_margin >= v_target then return false; end if;
  return random() * 1000 < least(v_max, v_target - v_margin);
end;
$$;

-- Statistik und Feed: Summen werden auf 9 Trillionen (bigint-Grenze) begrenzt, statt zu überlaufen.
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
    set plays = least(public.gambling_stats.plays::bigint + 1, 2000000000)::integer,
        wagered = least(public.gambling_stats.wagered::numeric + p_bet, 4000000000000000000)::bigint,
        won = least(public.gambling_stats.won::numeric + p_payout, 4000000000000000000)::bigint,
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
    set plays = least(public.gambling_stats.plays::bigint + 1, 2000000000)::integer,
        wagered = least(public.gambling_stats.wagered::numeric + p_bet, 4000000000000000000)::bigint,
        won = least(public.gambling_stats.won::numeric + p_payout, 4000000000000000000)::bigint,
        best_win = greatest(public.gambling_stats.best_win, p_payout);
  return v_balance;
end;
$$;

-- Rangliste: Bilanz (Gewonnen − Gesetzt) in numeric rechnen und begrenzen.
drop function if exists public.get_gambling_board();
create or replace function public.get_gambling_board()
returns table (rank integer, user_id uuid, display_name text, avatar_id text, color_id text, effect_id text, role text,
               tag_id text, theme_id text, plays integer, wagered bigint, won bigint, net bigint, best_win bigint, is_me boolean)
language sql
stable
security definer
set search_path = public
as $$
  select (row_number() over (order by (s.won::numeric - s.wagered) desc, p.display_name))::integer,
         p.id, p.display_name, p.avatar_id, p.color_id, p.effect_id,
         case when p.tags_hidden then 'user' else p.role end,
         case when p.tags_hidden then null else p.tag_id end,
         p.theme_id, s.plays, s.wagered, s.won,
         greatest(least(s.won::numeric - s.wagered, 9000000000000000000), -9000000000000000000)::bigint,
         s.best_win, (p.id = (select auth.uid()))
    from public.gambling_stats s
    join public.profiles p on p.id = s.user_id
   where (select auth.uid()) is not null and not public.is_blocked() and not p.blocked and s.plays > 0
   order by (s.won::numeric - s.wagered) desc, p.display_name
   limit 200;
$$;

-- Zurücksetzen löscht jetzt auch die Feed-Einträge (sonst wirken riesige Einsätze 3 Tage lang im Hausschutz weiter).
create or replace function public.admin_gambling_reset(p_user uuid default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare v_n integer;
begin
  perform public._require_admin();
  delete from public.gambling_stats where p_user is null or user_id = p_user;
  get diagnostics v_n = row_count;
  delete from public.gambling_feed where p_user is null or user_id = p_user;
  return v_n;
end;
$$;

-- Auszahlungs-Vergleiche und Slot-Gewinn ohne Überlauf (auch bei Einsatz = ganzes Höchstguthaben).
select public._patch_fn('gambling_dice', $a$v_pay >= p_bet::bigint * 10$a$, $b$v_pay::numeric >= p_bet::numeric * 10$b$);
select public._patch_fn('gambling_roulette', $a$v_pay >= v_total * 10$a$, $b$v_pay::numeric >= v_total::numeric * 10$b$);
select public._patch_fn('gambling_play', $a$v_payout := p_bet::bigint * v_mult;$a$, $b$v_payout := least(p_bet::numeric * v_mult, 9000000000000000)::bigint;$b$);

-- Rechte setzen.
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('_house_squeeze', '_gamble_settle', '_bj_finish', 'get_gambling_board', 'admin_gambling_reset', '_patch_fn')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    if r.proname in ('get_gambling_board', 'admin_gambling_reset') then
      execute format('grant execute on function %s to authenticated', r.sig);
    end if;
  end loop;
end;
$$;
