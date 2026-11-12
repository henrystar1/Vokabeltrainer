-- 0094: Umzug in ein neues Supabase-Projekt. Wiederholbar. Nach 0093 ausführen.
--  * admin_accounts_export(): Konten (auth.users + auth.identities, inkl. Passwort-Hashes) für die Backup-Datei (nur Admin).
--  * migration_bootstrap(): legt die Konten in einem LEEREN Projekt wieder an (nur solange es dort noch kein einziges Konto gibt),
--    damit man sich danach mit den alten Zugangsdaten als Admin anmelden und das Backup einspielen kann.

drop function if exists public.admin_accounts_export();
create or replace function public.admin_accounts_export()
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform public._require_admin();
  return jsonb_build_object(
    'users', coalesce((select jsonb_agg(to_jsonb(u)) from auth.users u), '[]'::jsonb),
    'identities', coalesce((select jsonb_agg(to_jsonb(i)) from auth.identities i), '[]'::jsonb),
    'admins', coalesce((select jsonb_agg(p.id) from public.profiles p where p.role = 'admin'), '[]'::jsonb));
end;
$$;

drop function if exists public.migration_bootstrap(jsonb, jsonb, jsonb);
create or replace function public.migration_bootstrap(p_users jsonb, p_identities jsonb, p_admins jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_cols text; v_sel text; v_n integer; v_i integer := 0;
begin
  if exists (select 1 from auth.users) or exists (select 1 from public.profiles) then
    raise exception 'Dieses Projekt ist nicht leer. Der Umzug der Konten geht nur in einem neuen, leeren Projekt.' using errcode = '55000';
  end if;
  if jsonb_typeof(p_users) <> 'array' or jsonb_array_length(p_users) = 0 then raise exception 'Keine Konten in der Datei.' using errcode = '22023'; end if;

  select string_agg(quote_ident(column_name), ', ' order by ordinal_position) into v_cols
    from information_schema.columns where table_schema = 'auth' and table_name = 'users' and is_generated = 'NEVER' and column_name <> 'instance_id';
  execute format($f$insert into auth.users (instance_id, %s) select '00000000-0000-0000-0000-000000000000'::uuid, %s from jsonb_populate_recordset(null::auth.users, $1) on conflict do nothing$f$, v_cols, v_cols) using p_users;
  get diagnostics v_n = row_count;

  if p_identities is not null and jsonb_typeof(p_identities) = 'array' and jsonb_array_length(p_identities) > 0 then
    select string_agg(quote_ident(column_name), ', ' order by ordinal_position) into v_cols
      from information_schema.columns where table_schema = 'auth' and table_name = 'identities' and is_generated = 'NEVER';
    select string_agg(case when column_name = 'id' then 'coalesce(i.id, gen_random_uuid())' else 'i.' || quote_ident(column_name) end, ', ' order by ordinal_position) into v_sel
      from information_schema.columns where table_schema = 'auth' and table_name = 'identities' and is_generated = 'NEVER';
    execute format($f$insert into auth.identities (%s) select %s from jsonb_populate_recordset(null::auth.identities, $1) i where exists (select 1 from auth.users u where u.id = i.user_id) on conflict do nothing$f$, v_cols, v_sel) using p_identities;
    get diagnostics v_i = row_count;
  end if;

  -- Der Trigger hat Profile angelegt (noch nicht freigeschaltet): jetzt alle freischalten, Admins wieder zu Admins machen.
  update public.profiles set approved = true;
  if p_admins is not null and jsonb_typeof(p_admins) = 'array' then
    update public.profiles set role = 'admin' where id::text in (select jsonb_array_elements_text(p_admins));
  end if;
  return jsonb_build_object('users', v_n, 'identities', v_i);
end;
$$;

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('admin_accounts_export', 'migration_bootstrap')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    if r.proname = 'admin_accounts_export' then
      execute format('grant execute on function %s to authenticated', r.sig);
    else
      execute format('grant execute on function %s to anon, authenticated', r.sig);
    end if;
  end loop;
end;
$$;
