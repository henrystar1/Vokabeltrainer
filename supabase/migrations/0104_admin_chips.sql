-- 0104: Admin kann Chips ohne Tageslimit vergeben (admin_grant_chips) und selbst unbegrenzt Chips kaufen. Wiederholbar. Nach 0103 ausführen.

create or replace function public.admin_grant_chips(p_user uuid, p_chips bigint, p_note text default '')
returns bigint language plpgsql security definer set search_path = public as $$
begin
  perform public._require_admin();
  if p_chips is null or p_chips = 0 or abs(p_chips) > 9000000000000000 then
    raise exception 'Ungültige Anzahl Chips (höchstens 9.000.000.000.000.000).' using errcode = '22023';
  end if;
  if not exists (select 1 from public.profiles where id = p_user) then
    raise exception 'Nutzer nicht gefunden.' using errcode = 'P0002';
  end if;
  return public._chip_grant(p_user, p_chips, 'admin');
end;
$$;

-- Größtes Kaufpaket: Admin 10^12, sonst 10^6
create or replace function public._chip_buy_max() returns bigint language sql stable security definer set search_path = public as $$
  select case when public.is_admin() then 1000000000000::bigint else 1000000::bigint end
$$;

-- Admin: kein Tageslimit und größere Käufe in chip_buy
do $$
declare v_oid oid; v_def text; v_new text;
begin
  select p.oid into v_oid from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'chip_buy' limit 1;
  if v_oid is null then raise exception 'Funktion chip_buy fehlt (0097 zuerst ausführen).'; end if;
  v_def := replace(pg_get_functiondef(v_oid), chr(13), '');
  if position('_chip_buy_max' in v_def) > 0 then return; end if;
  v_new := replace(v_def, 'p_chips > 1000000 then', 'p_chips > public._chip_buy_max() then');
  v_new := replace(v_new, 'if v_bought + p_chips > v_limit then', 'if v_bought + p_chips > v_limit and not public.is_admin() then');
  if v_new = v_def then raise exception 'Patch für chip_buy nicht anwendbar.'; end if;
  execute v_new;
end $$;

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('admin_grant_chips', 'chip_buy', '_chip_buy_max')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    if left(r.proname, 1) <> '_' then execute format('grant execute on function %s to authenticated', r.sig); end if;
  end loop;
end $$;
