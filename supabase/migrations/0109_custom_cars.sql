-- 0109: Eigene Autos vom Admin (Bauplan als JSON, von einer KI erzeugt). Wiederholbar.
alter table public.cars add column if not exists spec jsonb check (spec is null or (jsonb_typeof(spec) = 'object' and pg_column_size(spec) < 60000));

drop function if exists public.car_list();
create or replace function public.car_list()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_me uuid := public._og_check();
begin
  perform public._feature_guard('cars');
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'kind', c.kind, 'color', c.color, 'price', c.price, 'active', c.active, 'owned', o.user_id is not null, 'top_kmh', c.top_kmh, 'spec', c.spec) order by c.price, c.sort)
    from public.cars c left join public.car_owned o on o.car_id = c.id and o.user_id = v_me
    where c.active or o.user_id is not null), '[]'::jsonb);
end;
$$;

-- Admin: eigenes Auto anlegen oder überschreiben (kind = 'c_' + id; Werte und Bauplan stehen im JSON)
drop function if exists public.admin_car_custom_save(text, text, bigint, integer, text, jsonb);
create or replace function public.admin_car_custom_save(p_id text, p_name text, p_price bigint, p_top integer, p_color text, p_spec jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public._require_admin();
  if p_id is null or p_id !~ '^[a-z0-9_]{2,26}$' then raise exception 'Ungültige ID (a–z, 0–9, _).' using errcode = '22023'; end if;
  if p_name is null or length(btrim(p_name)) not between 1 and 40 then raise exception 'Ungültiger Name.' using errcode = '22023'; end if;
  if p_price is null or p_price < 0 or p_price > 1000000000 then raise exception 'Ungültiger Preis.' using errcode = '22023'; end if;
  if p_top is null or p_top < 50 or p_top > 400 then raise exception 'Tempo: 50 bis 400 km/h.' using errcode = '22023'; end if;
  if p_spec is null or jsonb_typeof(p_spec) <> 'object' or jsonb_typeof(p_spec -> 'parts') <> 'array' or jsonb_array_length(p_spec -> 'parts') not between 1 and 160 then raise exception 'Ungültiger Bauplan.' using errcode = '22023'; end if;
  if pg_column_size(p_spec) >= 60000 then raise exception 'Bauplan zu groß.' using errcode = '22023'; end if;
  if coalesce(p_color, '') !~ '^#[0-9a-fA-F]{6}$' then p_color := '#ef4444'; end if;
  insert into public.cars (id, name, kind, color, price, top_kmh, spec, sort, active)
  values (p_id, btrim(p_name), 'c_' || p_id, p_color, p_price, p_top, p_spec, 100, true)
  on conflict (id) do update set name = excluded.name, price = excluded.price, top_kmh = excluded.top_kmh, color = excluded.color, spec = excluded.spec, active = true
  where public.cars.kind = 'c_' || p_id;
  if not found then raise exception 'Diese ID gehört zu einem festen Auto.' using errcode = '23505'; end if;
end;
$$;

do $$
declare r record;
begin
  for r in select p.oid::regprocedure as sig, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('car_list', 'admin_car_custom_save') loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;
end $$;
