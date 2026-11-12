-- 0093: Komplett-Backup als Datei (Download) und Wiederherstellen (Upload) für Admins. Wiederholbar. Nach 0092 ausführen.
-- Gesichert werden alle Tabellen im Schema public (Bücher, Vokabeln, Fortschritt, Coins, Shop, Chat, Einstellungen …),
-- neue Tabellen werden automatisch mitgenommen. NICHT enthalten sind die Anmeldedaten (auth.users: E-Mail/Passwort) – die bleiben bei Supabase.

drop function if exists public._backup_check(text);
create or replace function public._backup_check(p_table text)
returns void language plpgsql stable security definer set search_path = public as $$
begin
  perform public._require_admin();
  if not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                  where n.nspname = 'public' and c.relname = p_table and c.relkind = 'r' and not c.relispartition) then
    raise exception 'Unbekannte Tabelle.' using errcode = '22023';
  end if;
end;
$$;

-- Tabellen in einer Reihenfolge, in der Eltern vor Kindern stehen (wegen Fremdschlüsseln).
drop function if exists public.admin_backup_tables();
create or replace function public.admin_backup_tables()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_all text[]; v_done text[] := '{}'; v_left text[]; v_pick text[]; v_out jsonb := '[]'::jsonb; t text; v_n bigint;
begin
  perform public._require_admin();
  select coalesce(array_agg(c.relname::text order by c.relname), '{}') into v_all
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and not c.relispartition;
  v_left := v_all;
  while coalesce(array_length(v_left, 1), 0) > 0 loop
    select coalesce(array_agg(x), '{}') into v_pick from unnest(v_left) x
     where not exists (
       select 1 from pg_constraint k
        where k.contype = 'f' and k.conrelid = format('public.%I', x)::regclass and k.confrelid <> k.conrelid
          and (select n2.nspname from pg_class c2 join pg_namespace n2 on n2.oid = c2.relnamespace where c2.oid = k.confrelid) = 'public'
          and (select c2.relname::text from pg_class c2 where c2.oid = k.confrelid) = any (v_left));
    if coalesce(array_length(v_pick, 1), 0) = 0 then v_pick := v_left; end if;   -- Zyklus: Rest in Namensreihenfolge
    v_done := v_done || v_pick;
    select coalesce(array_agg(x), '{}') into v_left from unnest(v_left) x where not (x = any (v_pick));
  end loop;
  foreach t in array v_done loop
    execute format('select count(*) from public.%I', t) into v_n;
    v_out := v_out || jsonb_build_array(jsonb_build_object('name', t, 'rows', v_n));
  end loop;
  return v_out;
end;
$$;

drop function if exists public.admin_backup_read(text, integer, integer);
create or replace function public.admin_backup_read(p_table text, p_off integer, p_lim integer)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_pk text; v_out jsonb;
begin
  perform public._backup_check(p_table);
  select string_agg(format('%I', a.attname), ', ' order by array_position(i.indkey::int2[], a.attnum)) into v_pk
    from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any (i.indkey)
   where i.indrelid = format('public.%I', p_table)::regclass and i.indisprimary;
  execute format('select coalesce(jsonb_agg(to_jsonb(t)), ''[]''::jsonb) from (select * from public.%I order by %s offset %s limit %s) t',
                 p_table, coalesce(v_pk, 'ctid'), greatest(coalesce(p_off, 0), 0), least(greatest(coalesce(p_lim, 500), 1), 2000)) into v_out;
  return v_out;
end;
$$;

drop function if exists public.admin_backup_clear(text);
create or replace function public.admin_backup_clear(p_table text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public._backup_check(p_table);
  execute format('alter table public.%I disable trigger user', p_table);
  execute format('delete from public.%I', p_table);
  execute format('alter table public.%I enable trigger user', p_table);
end;
$$;

-- Zeilen einspielen: vorhandene Zeilen (gleicher Primärschlüssel) werden überschrieben, fehlende ergänzt.
-- Zeilen, deren Fremdschlüssel ins Leere zeigen (z. B. gelöschtes Konto), werden übersprungen und gezählt.
drop function if exists public.admin_backup_write(text, jsonb);
create or replace function public.admin_backup_write(p_table text, p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_reg regclass; v_cols text; v_pk text; v_set text; v_total integer; v_kept integer; r record; v_cond text; v_cs text; v_ps text; v_sql text;
begin
  perform public._backup_check(p_table);
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then raise exception 'Ungültige Daten.' using errcode = '22023'; end if;
  v_reg := format('public.%I', p_table)::regclass;
  select string_agg(format('%I', a.attname), ', ' order by a.attnum) into v_cols
    from pg_attribute a where a.attrelid = v_reg and a.attnum > 0 and not a.attisdropped and a.attgenerated = '' and a.attidentity <> 'a';
  select string_agg(format('%I', a.attname), ', ' order by array_position(i.indkey::int2[], a.attnum)) into v_pk
    from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any (i.indkey) where i.indrelid = v_reg and i.indisprimary;
  select string_agg(format('%I = excluded.%I', a.attname, a.attname), ', ' order by a.attnum) into v_set
    from pg_attribute a where a.attrelid = v_reg and a.attnum > 0 and not a.attisdropped and a.attgenerated = '' and a.attidentity <> 'a'
     and not exists (select 1 from pg_index i where i.indrelid = v_reg and i.indisprimary and a.attnum = any (i.indkey));

  execute 'drop table if exists _bk';
  execute format('create temp table _bk on commit drop as select * from jsonb_populate_recordset(null::public.%I, $1)', p_table) using p_rows;
  get diagnostics v_total = row_count;

  -- Fremdschlüssel prüfen (nur auf Tabellen in public/auth; Selbstbezüge werden nicht gefiltert)
  for r in select k.oid as koid, k.confrelid from pg_constraint k
            where k.contype = 'f' and k.conrelid = v_reg and k.confrelid <> k.conrelid
              and (select n.nspname from pg_class c join pg_namespace n on n.oid = c.relnamespace where c.oid = k.confrelid) in ('public', 'auth')
  loop
    select string_agg(format('b.%I is not null', a.attname), ' and '), string_agg(format('p.%I = b.%I', pa.attname, a.attname), ' and ')
      into v_cs, v_ps
      from pg_constraint k
      cross join lateral unnest(k.conkey, k.confkey) as u(ca, pa_)
      join pg_attribute a on a.attrelid = k.conrelid and a.attnum = u.ca
      join pg_attribute pa on pa.attrelid = k.confrelid and pa.attnum = u.pa_
     where k.oid = r.koid;
    v_cond := format('delete from _bk b where %s and not exists (select 1 from %s p where %s)', v_cs, r.confrelid::regclass, v_ps);
    execute v_cond;
  end loop;
  select count(*) into v_kept from _bk;

  execute format('alter table public.%I disable trigger user', p_table);
  v_sql := format('insert into public.%I (%s) select %s from _bk', p_table, v_cols, v_cols);
  if v_pk is not null then
    v_sql := v_sql || format(' on conflict (%s) do %s', v_pk, case when v_set is null then 'nothing' else 'update set ' || v_set end);
  end if;
  execute v_sql;
  execute format('alter table public.%I enable trigger user', p_table);

  -- Zähler (Serial/Identity) hinter die höchste Zahl setzen
  for r in select a.attname, pg_get_serial_sequence(format('public.%I', p_table), a.attname) as seq
             from pg_attribute a where a.attrelid = v_reg and a.attnum > 0 and not a.attisdropped
  loop
    if r.seq is not null then
      execute format('select setval(%L, greatest((select coalesce(max(%I), 0) from public.%I), 1))', r.seq, r.attname, p_table);
    end if;
  end loop;
  return jsonb_build_object('rows', v_total, 'written', v_kept, 'skipped', v_total - v_kept);
end;
$$;

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('_backup_check', 'admin_backup_tables', 'admin_backup_read', 'admin_backup_clear', 'admin_backup_write')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    if left(r.proname, 1) <> '_' then
      execute format('grant execute on function %s to authenticated', r.sig);
    end if;
  end loop;
end;
$$;
