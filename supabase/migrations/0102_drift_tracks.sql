-- ============================================================================
-- 0102: Neue Strecken „Endlos-Asphalt“ (11, nur Üben) und „Drift-Kreis“ (12) (Update 116). Wiederholbar. Nach 0101 ausführen.
--  * Rangliste/Online dürfen die Schlüssel t11 und t12 verwenden (race_records, race_submit), Online-Streckenwahl bis 12
-- ============================================================================
alter table public.race_records drop constraint if exists race_records_track_check;
alter table public.race_records add constraint race_records_track_check check (track ~ '^(t[0-9]|t1[0-2]|c:[0-9a-f-]{36})$');
do $$
declare v_def text;
begin
  v_def := pg_get_functiondef('public.race_submit(text, text, integer)'::regprocedure);
  v_def := replace(v_def, '^(t[0-9]|t10|c:', '^(t[0-9]|t1[0-2]|c:');
  execute v_def;
  v_def := pg_get_functiondef('public.og_race_set(uuid, integer, integer, uuid)'::regprocedure);
  v_def := replace(v_def, 'coalesce(p_track, 0), 0), 10)', 'coalesce(p_track, 0), 0), 12)');
  execute v_def;
end $$;

do $$
declare r record;
begin
  for r in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('race_submit', 'og_race_set') loop
    execute format('revoke all on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;
end $$;
