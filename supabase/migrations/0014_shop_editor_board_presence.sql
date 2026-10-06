-- 0014: Shop-Editor (eigene Artikel), Artikel entziehen, Schwarzes Brett, Wer-ist-da, Coin-Rangliste,
-- Gambling-Gewinnliste, neue Designs und Tags. Wiederholbar. Nach 0013 ausführen.

-- ----------------------------------------------------------------------------
-- 1. Eigene Shop-Artikel (vom Admin angelegt)
-- ----------------------------------------------------------------------------

alter table public.shop_items add column if not exists custom boolean not null default false;
alter table public.shop_items add column if not exists style jsonb;
alter table public.shop_items add column if not exists svg text;

drop function if exists public.get_shop();
create function public.get_shop()
returns table (id text, kind text, name text, price integer, sort integer, owned boolean, equipped boolean,
               required_role text, active boolean, custom boolean, style jsonb, svg text)
language sql
stable
security definer
set search_path = public
as $$
  select i.id, i.kind, i.name, i.price, i.sort,
         (i.price = 0 or o.item_id is not null),
         exists (select 1 from public.profiles p
                  where p.id = (select auth.uid())
                    and i.id in (p.avatar_id, p.color_id, p.effect_id, p.theme_id, p.tag_id)),
         i.required_role, i.active, i.custom, i.style, i.svg
    from public.shop_items i
    left join public.user_items o on o.item_id = i.id and o.user_id = (select auth.uid())
   where (select auth.uid()) is not null
     and (i.active or o.item_id is not null)
     and (i.required_role is null
          or public._role_rank(i.required_role) <= public._role_rank(
               (select p.role from public.profiles p where p.id = (select auth.uid()))))
   order by i.kind, i.sort, i.name;
$$;

-- Alle eigenen Artikel (zum Darstellen bei allen Nutzern: Profilbild, Farbe, Effekt, Tag, Design)
create or replace function public.get_custom_items()
returns table (id text, kind text, name text, style jsonb, svg text)
language sql
stable
security definer
set search_path = public
as $$
  select i.id, i.kind, i.name, i.style, i.svg
    from public.shop_items i
   where i.custom and (select auth.uid()) is not null;
$$;

-- Ist die SVG harmlos? Keine Skripte, Ereignisse, fremden Adressen oder eingebetteten Seiten.
create or replace function public._svg_is_safe(p_svg text)
returns boolean
language sql
immutable
as $$
  select p_svg is not null
     and char_length(p_svg) between 20 and 30000
     and p_svg ~* '^\s*(<\?xml[^>]*>\s*)?<svg[\s>]'
     and c.t !~* '<\s*(script|iframe|object|embed|foreignobject|image|use|a)[\s>/]'
     and c.t !~* '\mon[a-z]+\s*='
     and c.t !~* 'javascript:|data:|@import|https?:|//[a-z0-9.-]+\.[a-z]{2,}|<!entity|<!doctype'
     and c.t !~* 'href\s*='
  from (select regexp_replace(p_svg, 'xmlns(:[a-z]+)?\s*=\s*("[^"]*"|''[^'']*'')', '', 'gi') as t) c;
$$;

create or replace function public.admin_save_item(
  p_id text, p_kind text, p_name text, p_price integer, p_required_role text,
  p_style jsonb, p_svg text, p_active boolean default true)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id text := nullif(btrim(coalesce(p_id, '')), '');
begin
  perform public._require_admin();
  if p_kind not in ('avatar', 'color', 'effect', 'theme', 'tag') then
    raise exception 'Unbekannte Art.' using errcode = '22023';
  end if;
  if char_length(btrim(coalesce(p_name, ''))) not between 1 and 40 then
    raise exception 'Der Name braucht 1 bis 40 Zeichen.' using errcode = '22023';
  end if;
  if p_price is null or p_price < 0 or p_price > 10000000 then
    raise exception 'Ungültiger Preis.' using errcode = '22023';
  end if;
  if p_required_role is not null and p_required_role not in ('mod', 'admin') then
    raise exception 'Ungültige Rolle.' using errcode = '22023';
  end if;
  if p_style is not null and (jsonb_typeof(p_style) <> 'object' or char_length(p_style::text) > 4000) then
    raise exception 'Ungültige Stil-Angaben.' using errcode = '22023';
  end if;
  if p_kind = 'avatar' and p_svg is not null and not public._svg_is_safe(p_svg) then
    raise exception 'Die SVG ist nicht erlaubt (keine Skripte, Links oder fremden Bilder, höchstens 30 000 Zeichen).' using errcode = '22023';
  end if;
  if p_kind = 'avatar' and p_svg is null then
    raise exception 'Für ein Profilbild braucht es eine SVG.' using errcode = '22023';
  end if;
  if p_kind <> 'avatar' and p_style is null then
    raise exception 'Es fehlen die Stil-Angaben.' using errcode = '22023';
  end if;

  if v_id is null then
    v_id := 'c_' || substr(md5(random()::text || clock_timestamp()::text), 1, 10);
    insert into public.shop_items (id, kind, name, price, sort, required_role, active, custom, style, svg)
    values (v_id, p_kind, btrim(p_name), p_price, 500, p_required_role, coalesce(p_active, true), true, p_style,
            case when p_kind = 'avatar' then p_svg end);
  else
    update public.shop_items
       set name = btrim(p_name), price = p_price, required_role = p_required_role, active = coalesce(p_active, true),
           style = p_style, svg = case when p_kind = 'avatar' then p_svg end
     where id = v_id and custom and kind = p_kind;
    if not found then
      raise exception 'Eigener Artikel nicht gefunden.' using errcode = 'P0002';
    end if;
  end if;
  return v_id;
end;
$$;

create or replace function public.admin_delete_item(p_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._require_admin();
  if not exists (select 1 from public.shop_items where id = p_id and custom) then
    raise exception 'Nur eigene Artikel lassen sich löschen.' using errcode = '22023';
  end if;
  update public.profiles set avatar_id = null where avatar_id = p_id;
  update public.profiles set color_id = null where color_id = p_id;
  update public.profiles set effect_id = null where effect_id = p_id;
  update public.profiles set theme_id = null where theme_id = p_id;
  update public.profiles set tag_id = null where tag_id = p_id;
  delete from public.shop_items where id = p_id; -- user_items folgt per Kaskade
end;
$$;

-- ----------------------------------------------------------------------------
-- 2. Artikel eines Nutzers ansehen und entziehen
-- ----------------------------------------------------------------------------

create or replace function public.admin_list_user_items(p_user uuid)
returns table (item_id text, kind text, name text, equipped boolean)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public._require_admin();
  return query
  select i.id, i.kind, i.name,
         exists (select 1 from public.profiles p where p.id = p_user and i.id in (p.avatar_id, p.color_id, p.effect_id, p.theme_id, p.tag_id))
    from public.user_items o
    join public.shop_items i on i.id = o.item_id
   where o.user_id = p_user
   order by i.kind, i.name;
end;
$$;

create or replace function public.admin_revoke_item(p_user uuid, p_item_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._require_admin();
  delete from public.user_items where user_id = p_user and item_id = p_item_id;
  update public.profiles
     set avatar_id = case when avatar_id = p_item_id then null else avatar_id end,
         color_id  = case when color_id  = p_item_id then null else color_id end,
         effect_id = case when effect_id = p_item_id then null else effect_id end,
         theme_id  = case when theme_id  = p_item_id then null else theme_id end,
         tag_id    = case when tag_id    = p_item_id then null else tag_id end
   where id = p_user;
end;
$$;

-- ----------------------------------------------------------------------------
-- 3. Gambling: Gewinnliste
-- ----------------------------------------------------------------------------

create table if not exists public.gambling_feed (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  bet integer not null,
  payout integer not null,
  jackpot boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists gambling_feed_time_idx on public.gambling_feed (created_at desc);
alter table public.gambling_feed enable row level security;
revoke all on public.gambling_feed from anon, authenticated;

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
  v_mult integer := 0;
  v_is_jackpot boolean := false;
  v_reels integer[];
  v_s integer;
  v_payout integer;
  v_balance integer;
begin
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  if p_bet is null or p_bet < 1 or p_bet > greatest(public.setting('gambling_max_bet'), 1) then
    raise exception 'Der Einsatz muss zwischen 1 und % Coins liegen.', greatest(public.setting('gambling_max_bet'), 1)
      using errcode = '22023';
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
  else
    loop
      v_reels := array[floor(random() * 7)::integer, floor(random() * 7)::integer, floor(random() * 7)::integer];
      exit when not (v_reels[1] = v_reels[2] and v_reels[2] = v_reels[3]);
    end loop;
  end if;
  v_balance := public._grant_koins(v_me, -p_bet, 'gambling_bet', null);
  v_payout := p_bet * v_mult;
  if v_payout > 0 then
    v_balance := public._grant_koins(v_me, v_payout, 'gambling_win', null);
    insert into public.gambling_feed (user_id, bet, payout, jackpot) values (v_me, p_bet, v_payout, v_is_jackpot);
    delete from public.gambling_feed where created_at < now() - interval '7 days';
  end if;
  return jsonb_build_object('reels', to_jsonb(v_reels), 'mult', v_mult, 'payout', v_payout,
                            'bet', p_bet, 'balance', v_balance);
end;
$$;

create or replace function public.get_gambling_feed()
returns table (id bigint, display_name text, bet integer, payout integer, jackpot boolean, created_at timestamptz)
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

-- ----------------------------------------------------------------------------
-- 4. Schwarzes Brett (Features des nächsten Updates)
-- ----------------------------------------------------------------------------

create table if not exists public.board_posts (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(btrim(title)) between 1 and 120),
  body text not null default '' check (char_length(body) <= 2000),
  status text not null default 'planned' check (status in ('planned', 'doing', 'done')),
  sort integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.board_posts enable row level security;
revoke all on public.board_posts from anon, authenticated;

create or replace function public.get_board()
returns table (id uuid, title text, body text, status text, sort integer, updated_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select b.id, b.title, b.body, b.status, b.sort, b.updated_at
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
begin
  perform public._require_admin();
  if char_length(btrim(coalesce(p_title, ''))) not between 1 and 120 then
    raise exception 'Der Titel braucht 1 bis 120 Zeichen.' using errcode = '22023';
  end if;
  if p_status not in ('planned', 'doing', 'done') then
    raise exception 'Ungültiger Status.' using errcode = '22023';
  end if;
  if p_id is null then
    insert into public.board_posts (title, body, status) values (btrim(p_title), left(coalesce(p_body, ''), 2000), p_status)
    returning id into v_id;
  else
    update public.board_posts
       set title = btrim(p_title), body = left(coalesce(p_body, ''), 2000), status = p_status, updated_at = now()
     where id = p_id returning id into v_id;
    if v_id is null then
      raise exception 'Eintrag nicht gefunden.' using errcode = 'P0002';
    end if;
  end if;
  return v_id;
end;
$$;

create or replace function public.admin_delete_board_post(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._require_admin();
  delete from public.board_posts where id = p_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- 5. Wer ist da? (online und zuletzt gesehen, für alle)
-- ----------------------------------------------------------------------------

alter table public.profiles add column if not exists hide_presence boolean not null default false;

create or replace function public.set_hide_presence(p_hidden boolean)
returns void
language sql
security definer
set search_path = public
as $$
  update public.profiles set hide_presence = coalesce(p_hidden, false) where id = (select auth.uid());
$$;

create or replace function public.get_presence()
returns table (user_id uuid, display_name text, avatar_id text, color_id text, effect_id text, role text, tag_id text,
               theme_id text, last_seen_at timestamptz, online boolean)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.display_name, p.avatar_id, p.color_id, p.effect_id,
         case when p.tags_hidden then 'user' else p.role end,
         case when p.tags_hidden then null else p.tag_id end,
         p.theme_id, p.last_seen_at, (p.last_seen_at > now() - interval '3 minutes')
    from public.profiles p
   where (select auth.uid()) is not null and not public.is_blocked()
     and not p.blocked and p.last_seen_at is not null
     and (not p.hide_presence or p.id = (select auth.uid()))
   order by (p.last_seen_at > now() - interval '3 minutes') desc, p.last_seen_at desc
   limit 200;
$$;

-- ----------------------------------------------------------------------------
-- 6. Coin-Rangliste
-- ----------------------------------------------------------------------------

create or replace function public.get_coin_leaderboard()
returns table (rank integer, user_id uuid, display_name text, avatar_id text, color_id text, effect_id text, role text,
               tag_id text, theme_id text, koins integer)
language sql
stable
security definer
set search_path = public
as $$
  select (row_number() over (order by w.balance desc, p.display_name))::integer,
         p.id, p.display_name, p.avatar_id, p.color_id, p.effect_id,
         case when p.tags_hidden then 'user' else p.role end,
         case when p.tags_hidden then null else p.tag_id end,
         p.theme_id, w.balance
    from public.koin_wallets w
    join public.profiles p on p.id = w.user_id
   where (select auth.uid()) is not null and not public.is_blocked() and not p.blocked and w.balance > 0
   order by w.balance desc, p.display_name
   limit 50;
$$;

create or replace function public.get_my_coin_rank()
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select (select count(*) + 1
            from public.koin_wallets w join public.profiles p on p.id = w.user_id
           where not p.blocked and w.balance > coalesce((select balance from public.koin_wallets where user_id = (select auth.uid())), 0))::integer;
$$;

-- ----------------------------------------------------------------------------
-- 7. Neue Designs und kurze Tags
-- ----------------------------------------------------------------------------

insert into public.shop_items (id, kind, name, price, sort, required_role) values
  ('theme_lava',    'theme', 'Lava',        700,   120, null),
  ('theme_ice',     'theme', 'Eis',         650,   130, null),
  ('theme_cyber',   'theme', 'Cyber',       800,   140, null),
  ('theme_royal',   'theme', 'Königlich',   900,   150, null),
  ('theme_mint',    'theme', 'Minze',       550,   160, null),
  ('theme_vapor',   'theme', 'Vaporwave',   850,   170, null),
  ('theme_shine',   'theme', 'Glanz',       100000, 200, null),
  ('theme_rainbow', 'theme', 'Regenbogen',  100000, 210, null),
  ('tag_gg',    'tag', 'GG',    200,   100, null),
  ('tag_hot',   'tag', 'HOT',   400,   110, null),
  ('tag_vip',   'tag', 'VIP',   300,   120, null),
  ('tag_og',    'tag', 'OG',    500,   130, null),
  ('tag_star',  'tag', '★',     600,   140, null),
  ('tag_pro',   'tag', 'PRO',   800,   150, null),
  ('tag_mvp',   'tag', 'MVP',   1200,  160, null),
  ('tag_elite', 'tag', 'ELITE', 2500,  170, null)
on conflict (id) do nothing;

-- ----------------------------------------------------------------------------
-- 8. Rechte
-- ----------------------------------------------------------------------------

do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig, p.proname
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in (
       'get_shop', 'get_custom_items', '_svg_is_safe', 'admin_save_item', 'admin_delete_item', 'admin_list_user_items',
       'admin_revoke_item', 'gambling_play', 'get_gambling_feed', 'get_board', 'admin_save_board_post',
       'admin_delete_board_post', 'set_hide_presence', 'get_presence', 'get_coin_leaderboard', 'get_my_coin_rank')
  loop
    if r.proname = '_svg_is_safe' then
      execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    else
      execute format('revoke all on function %s from public, anon', r.sig);
      execute format('grant execute on function %s to authenticated', r.sig);
    end if;
  end loop;
end;
$$;
