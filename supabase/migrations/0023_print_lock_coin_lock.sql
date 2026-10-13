-- ============================================================================
-- 0023: 1) 3D-Druck-Shop ausschaltbar (wie die anderen Funktionen unter Verwaltung → Sperren, Schlüssel 'print').
--       2) Coin-Sperre pro Person: Wer gesperrt ist, kann keine Coins mehr ausgeben oder verschenken
--          (Shop, Bücher, Überweisungen, 3D-Druck-Rabatt, Plus). Erlaubt bleiben Gambling und Spiele (Einsatz/Gebühr).
--          Gutschriften (Gewinne, Belohnungen, Geschenke) funktionieren weiter.
-- Wiederholbar. Nach 0022 ausführen.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Sperr-Schlüssel 'print'
-- ----------------------------------------------------------------------------

alter table public.feature_locks drop constraint if exists feature_locks_key_check;
alter table public.feature_locks add constraint feature_locks_key_check
  check (key in ('games', 'gambling', 'sprint', 'duels', 'chat', 'shop', 'quests', 'print'));

do $$
declare
  v_fn text;
  v_def text;
begin
  -- Schlüsselliste in den drei Sperr-Funktionen erweitern
  foreach v_fn in array array['get_locked_features', 'admin_get_feature_locks', 'admin_set_feature_lock'] loop
    select pg_get_functiondef(p.oid) into v_def
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = v_fn limit 1;
    if v_def is not null and position('''print''' in v_def) = 0 then
      v_def := replace(v_def, '''quests'']', '''quests'', ''print'']');
      v_def := replace(v_def, '''quests'')', '''quests'', ''print'')');
      execute v_def;
    end if;
  end loop;

  -- Sperre in die Kunden-Funktionen des Druck-Shops einhängen
  foreach v_fn in array array['print_get_info', 'print_quote', 'print_create_order'] loop
    select pg_get_functiondef(p.oid) into v_def
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = v_fn limit 1;
    if v_def is not null and position('_feature_guard' in v_def) = 0 and v_def ~ E'\nbegin\n' then
      v_def := regexp_replace(v_def, E'\nbegin\n', E'\nbegin\n  perform public._feature_guard(''print'');\n');
      execute v_def;
    end if;
  end loop;
end;
$$;

-- ----------------------------------------------------------------------------
-- 2. Coin-Sperre pro Person
-- ----------------------------------------------------------------------------

alter table public.profiles add column if not exists coins_locked_at timestamptz;
alter table public.profiles add column if not exists coins_lock_note text not null default '';

create or replace function public._grant_koins(p_user uuid, p_amount bigint, p_reason text, p_ref text default null)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  c_max constant bigint := 9000000000000000;
  v_balance bigint;
  v_amount bigint := p_amount;
  v_strict boolean := p_reason in ('admin', 'pay_in', 'print_refund', 'plus_refund');
begin
  if p_amount = 0 then
    return coalesce((select balance from public.koin_wallets where user_id = p_user), 0);
  end if;
  -- Gesperrte Personen dürfen nur noch für Gambling und Spiele zahlen.
  if p_amount < 0 and p_reason not in ('gambling_bet', 'game_fee', 'admin')
     and exists (select 1 from public.profiles where id = p_user and coins_locked_at is not null) then
    raise exception 'Dein Guthaben ist vom Admin gesperrt. Du kannst nur noch spielen und gamblen.' using errcode = '55000';
  end if;
  insert into public.koin_wallets (user_id) values (p_user) on conflict do nothing;

  if v_amount > 0 and not v_strict then
    select least(v_amount, greatest(c_max - w.balance, 0)) into v_amount from public.koin_wallets w where w.user_id = p_user;
    if v_amount <= 0 then
      return (select balance from public.koin_wallets where user_id = p_user);
    end if;
  end if;

  update public.koin_wallets
     set balance = balance + v_amount
   where user_id = p_user and balance + v_amount >= 0 and balance + v_amount <= c_max
   returning balance into v_balance;
  if v_balance is null then
    if v_amount > 0 then
      raise exception 'Das Guthaben darf 9.000.000.000.000.000 Coins nicht übersteigen.' using errcode = '22023';
    end if;
    raise exception 'Nicht genug Coins.' using errcode = '23514';
  end if;
  insert into public.koin_ledger (user_id, amount, reason, ref) values (p_user, v_amount, p_reason, p_ref);
  return v_balance;
end;
$$;

-- Eigener Status (für Hinweis im Shop/Profil)
create or replace function public.coin_lock_status()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object('locked', coins_locked_at is not null, 'note', coins_lock_note)
    from public.profiles where id = (select auth.uid());
$$;

-- Nur Admins: sperren/entsperren
create or replace function public.admin_set_coin_lock(p_user uuid, p_locked boolean, p_note text default '')
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._require_admin();
  if p_locked and exists (select 1 from public.profiles where id = p_user and role = 'admin') then
    raise exception 'Admins kannst du nicht sperren.' using errcode = '22023';
  end if;
  update public.profiles
     set coins_locked_at = case when p_locked then coalesce(coins_locked_at, now()) else null end,
         coins_lock_note = case when p_locked then left(btrim(coalesce(p_note, '')), 200) else '' end
   where id = p_user;
  if not found then
    raise exception 'Person nicht gefunden.' using errcode = 'P0002';
  end if;
  if p_locked then
    insert into public.user_messages (user_id, from_id, body)
    values (p_user, (select auth.uid()), left('Dein Coin-Guthaben wurde gesperrt: Du kannst nur noch spielen und gamblen.' || case when btrim(coalesce(p_note, '')) <> '' then ' Grund: ' || btrim(p_note) else '' end, 1000));
  end if;
end;
$$;

-- Nur Admins: Liste der gesperrten Personen
create or replace function public.admin_coin_locks()
returns table (user_id uuid, locked_at timestamptz, note text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public._require_admin();
  return query select p.id, p.coins_locked_at, p.coins_lock_note from public.profiles p where p.coins_locked_at is not null;
end;
$$;

-- ----------------------------------------------------------------------------
-- 3. Rechte
-- ----------------------------------------------------------------------------

do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig, p.proname
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('_grant_koins', 'coin_lock_status', 'admin_set_coin_lock', 'admin_coin_locks',
                         'get_locked_features', 'admin_get_feature_locks', 'admin_set_feature_lock',
                         'print_get_info', 'print_quote', 'print_create_order')
  loop
    if r.proname = '_grant_koins' then
      execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    else
      execute format('revoke all on function %s from public, anon', r.sig);
      execute format('grant execute on function %s to authenticated', r.sig);
    end if;
  end loop;
end;
$$;
