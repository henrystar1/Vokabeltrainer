-- 0032: Fairness bei Spielen (Wiederbelebte Runden zählen nicht für Rekorde), neue Gambling-Spiele
-- (Roulette, Würfeln, Glücksrad), Schwarzes Brett mit Autor/Bearbeiter, „Wer ist da?“ für Admins komplett,
-- neues Design „Berge“. Wiederholbar. Nach 0031 ausführen.

-- ----------------------------------------------------------------------------
-- A. Spiele: Wiederbeleben (Plus) soll nichts am Rekord ändern
-- ----------------------------------------------------------------------------
do $$
declare
  v_def text;
  v_new text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'finish_game'
   limit 1;
  if v_def is null then return; end if;
  v_new := v_def;
  if position('r.revives = 0' in v_new) = 0 then
    v_new := replace(v_new, 'and v_elapsed <= 7200 then', 'and v_elapsed <= 7200 and r.revives = 0 then');
  end if;
  if v_new <> v_def then
    execute v_new;
  end if;
end;
$$;

-- ----------------------------------------------------------------------------
-- B. Gambling: gemeinsame Abrechnung + Roulette, Würfeln, Glücksrad
-- ----------------------------------------------------------------------------
create or replace function public._gamble_settle(p_user uuid, p_bet integer, p_payout bigint, p_jackpot boolean)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance bigint;
begin
  v_balance := public._grant_koins(p_user, -p_bet::bigint, 'gambling_bet', null);
  if p_payout > 0 then
    v_balance := public._grant_koins(p_user, p_payout, 'gambling_win', null);
  end if;
  insert into public.gambling_feed (user_id, bet, payout, jackpot) values (p_user, p_bet, least(p_payout, 2000000000)::integer, p_jackpot);
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
revoke all on function public._gamble_settle(uuid, integer, bigint, boolean) from public, anon, authenticated;

-- Roulette (europäisch, 37 Felder). p_bets: [{"t":"straight|red|black|even|odd|low|high|dozen|column","v":0..36,"a":Einsatz}]
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
    if v_win then v_pay := v_pay + v_a::bigint * v_mult; end if;
    v_out := v_out || jsonb_build_array(jsonb_build_object('t', v_t, 'v', v_v, 'a', v_a, 'win', v_win,
                                                           'pay', case when v_win then v_a * v_mult else 0 end));
  end loop;
  v_balance := public._gamble_settle(v_me, v_total, v_pay, v_pay >= v_total::bigint * 10);
  return jsonb_build_object('number', v_num, 'color', v_color, 'bets', v_out, 'bet', v_total,
                            'payout', v_pay, 'balance', v_balance);
end;
$$;

-- Würfeln: Zahl 1–100. p_over = „über p_target“, sonst „unter p_target“. Auszahlung = Einsatz × 97 / Chance.
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
  if v_chance < 5 or v_chance > 90 then
    raise exception 'Die Gewinnchance muss zwischen 5 %% und 90 %% liegen.' using errcode = '22023';
  end if;
  if coalesce((select balance from public.koin_wallets where user_id = v_me), 0) < p_bet then
    raise exception 'Nicht genug Coins.' using errcode = '23514';
  end if;
  v_win := case when p_over then v_roll > p_target else v_roll < p_target end;
  if v_win then v_pay := (p_bet::bigint * 97) / v_chance; end if;
  v_balance := public._gamble_settle(v_me, p_bet, v_pay, v_pay >= p_bet::bigint * 10);
  return jsonb_build_object('roll', v_roll, 'chance', v_chance, 'win', v_win, 'bet', p_bet,
                            'payout', v_pay, 'balance', v_balance);
end;
$$;

-- Glücksrad: 20 Felder, Faktoren in Zehnteln (Rückzahlung im Schnitt 97,5 %).
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
  v_pay := (p_bet::bigint * v_seg[v_i + 1]) / 10;
  v_balance := public._gamble_settle(v_me, p_bet, v_pay, v_seg[v_i + 1] >= 40);
  return jsonb_build_object('index', v_i, 'tenths', v_seg[v_i + 1], 'segments', to_jsonb(v_seg), 'bet', p_bet,
                            'payout', v_pay, 'balance', v_balance);
end;
$$;

-- ----------------------------------------------------------------------------
-- C. Schwarzes Brett: wer hat geschrieben, wer hat geändert
-- ----------------------------------------------------------------------------
alter table public.board_posts add column if not exists created_by uuid references auth.users (id) on delete set null;
alter table public.board_posts add column if not exists updated_by uuid references auth.users (id) on delete set null;

drop function if exists public.get_board();
create function public.get_board()
returns table (id uuid, title text, body text, status text, sort integer, updated_at timestamptz,
               created_at timestamptz, created_by_name text, updated_by_name text)
language sql
stable
security definer
set search_path = public
as $$
  select b.id, b.title, b.body, b.status, b.sort, b.updated_at, b.created_at,
         (select p.display_name from public.profiles p where p.id = b.created_by),
         (select p.display_name from public.profiles p where p.id = b.updated_by)
    from public.board_posts b
   where (select auth.uid()) is not null
   order by case b.status when 'doing' then 0 when 'planned' then 1 else 2 end, b.sort, b.created_at desc;
$$;

create or replace function public.admin_save_board_post(p_id uuid, p_title text, p_body text, p_status text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_me uuid := (select auth.uid());
begin
  if not public.is_staff() then
    raise exception 'Nur für Mods und Admins.' using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(p_title, ''))) not between 1 and 120 then
    raise exception 'Der Titel braucht 1 bis 120 Zeichen.' using errcode = '22023';
  end if;
  if p_status not in ('planned', 'doing', 'done') then
    raise exception 'Ungültiger Status.' using errcode = '22023';
  end if;
  if p_id is null then
    insert into public.board_posts (title, body, status, created_by)
    values (btrim(p_title), left(coalesce(p_body, ''), 2000), p_status, v_me)
    returning id into v_id;
  else
    update public.board_posts
       set title = btrim(p_title), body = left(coalesce(p_body, ''), 2000), status = p_status,
           updated_at = now(), updated_by = v_me
     where id = p_id returning id into v_id;
    if v_id is null then
      raise exception 'Eintrag nicht gefunden.' using errcode = 'P0002';
    end if;
  end if;
  return v_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- D. „Wer ist da?“: Admins sehen auch Nutzer, die sich versteckt haben (mit Markierung)
-- ----------------------------------------------------------------------------
drop function if exists public.get_presence();
create function public.get_presence()
returns table (user_id uuid, display_name text, avatar_id text, color_id text, effect_id text, role text, tag_id text,
               theme_id text, last_seen_at timestamptz, online boolean, hidden boolean)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.display_name, p.avatar_id, p.color_id, p.effect_id,
         case when p.tags_hidden then 'user' else p.role end,
         case when p.tags_hidden then null else p.tag_id end,
         p.theme_id, p.last_seen_at, (p.last_seen_at > now() - interval '3 minutes'), p.hide_presence
    from public.profiles p
   where (select auth.uid()) is not null and not public.is_blocked()
     and not p.blocked and p.last_seen_at is not null
     and (not p.hide_presence or p.id = (select auth.uid()) or public.is_admin())
   order by (p.last_seen_at > now() - interval '3 minutes') desc, p.last_seen_at desc
   limit 200;
$$;

-- ----------------------------------------------------------------------------
-- E. Design „Berge“ (Aussehen steht in der App: features/shop/catalog.ts)
-- ----------------------------------------------------------------------------
insert into public.shop_items (id, kind, name, price, sort, required_role) values
  ('theme_mountain', 'theme', 'Berge', 250000, 240, null)
on conflict (id) do nothing;

do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('finish_game', 'gambling_roulette', 'gambling_dice', 'gambling_wheel', 'get_board',
                         'admin_save_board_post', 'get_presence')
  loop
    execute format('revoke all on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;
end;
$$;
