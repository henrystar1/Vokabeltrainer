-- 0106: Admin sieht alle Aktien-Depots und kann Aktien vergeben oder abziehen. Wiederholbar. Nach 0105 ausführen.

-- p_user = null: alle Depots, sonst nur das dieser Person
create or replace function public.admin_stock_holdings(p_user uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public._require_admin();
  return coalesce((
    select jsonb_agg(jsonb_build_object('user_id', h.user_id, 'name', p.display_name, 'symbol', h.symbol, 'shares', h.shares, 'cost', h.cost, 'price_cents', q.price_cents)
                     order by h.symbol, h.shares desc, p.display_name)
      from public.stock_holdings h
      join public.profiles p on p.id = h.user_id
      left join public.stock_quotes q on q.symbol = h.symbol
     where h.shares > 0 and (p_user is null or h.user_id = p_user)), '[]'::jsonb);
end;
$$;

-- Aktien vergeben (Plus) oder abziehen (Minus, höchstens bis 0); Einstandswert sinkt anteilig mit
create or replace function public.admin_stock_adjust(p_user uuid, p_symbol text, p_delta bigint)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_sym text := upper(p_symbol); h public.stock_holdings; v_new bigint; v_cost bigint;
begin
  perform public._require_admin();
  if p_delta is null or p_delta = 0 or abs(p_delta) > 1000000000000 then raise exception 'Ungültige Anzahl Aktien.' using errcode = '22023'; end if;
  if not exists (select 1 from public.stock_symbols where symbol = v_sym) then raise exception 'Aktie nicht gefunden.' using errcode = 'P0002'; end if;
  if not exists (select 1 from public.profiles where id = p_user) then raise exception 'Nutzer nicht gefunden.' using errcode = 'P0002'; end if;
  select * into h from public.stock_holdings where user_id = p_user and symbol = v_sym for update;
  if h.user_id is null then
    if p_delta < 0 then raise exception 'Die Person besitzt diese Aktie nicht.' using errcode = '22023'; end if;
    insert into public.stock_holdings (user_id, symbol, shares, cost) values (p_user, v_sym, p_delta, 0);
    return p_delta;
  end if;
  v_new := greatest(h.shares + p_delta, 0);
  v_cost := case when h.shares > 0 then (h.cost::numeric * v_new / h.shares)::bigint else 0 end;
  if p_delta > 0 then v_cost := h.cost; end if;
  update public.stock_holdings set shares = v_new, cost = v_cost where user_id = p_user and symbol = v_sym;
  return v_new;
end;
$$;

do $$
declare r record;
begin
  for r in select p.oid::regprocedure as sig from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('admin_stock_holdings', 'admin_stock_adjust') loop
    execute format('revoke all on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;
end;
$$;
