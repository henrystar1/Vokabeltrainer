-- 0103: Eigene Rennstrecken. Limit je Tarif (ohne Plus/Pro 1, Plus 2, Pro 3), ausgefüllte Übungsflächen, strengere Prüfung
-- (keine Selbstüberschneidung, keine zu engen Kurven); bisher gespeicherte ungültige Strecken werden gelöscht. Wiederholbar. Nach 0102 ausführen.

alter table public.race_tracks add column if not exists fill boolean not null default false;

-- Prüft eine Strecke: Punktzahl/Größe/Länge (wie bisher), keine Selbstüberschneidung, bei normalen Strecken keine zu enge Kurve (Radius mindestens 1,2 × halbe Breite).
create or replace function public._race_track_valid(p_pts jsonb, p_width integer, p_fill boolean)
returns void language plpgsql immutable set search_path = public as $$
declare
  v_n integer; i integer; j integer;
  px numeric[]; pz numeric[];
  ax numeric; az numeric; bx numeric; bz numeric; cx numeric; cz numeric; dx numeric; dz numeric;
  d1 numeric; d2 numeric; d3 numeric; d4 numeric; ab numeric; bc numeric; ca numeric; cr numeric; r numeric;
begin
  perform public._race_pts_check(p_pts);
  v_n := jsonb_array_length(p_pts);
  for i in 0 .. v_n - 1 loop
    px[i + 1] := (p_pts -> i ->> 0)::numeric;
    pz[i + 1] := (p_pts -> i ->> 1)::numeric;
  end loop;
  -- Selbstüberschneidung (echte Kreuzung zweier nicht benachbarter Strecken)
  for i in 1 .. v_n loop
    for j in i + 2 .. v_n loop
      if i = 1 and j = v_n then continue; end if;
      ax := px[i]; az := pz[i]; bx := px[i % v_n + 1]; bz := pz[i % v_n + 1];
      cx := px[j]; cz := pz[j]; dx := px[j % v_n + 1]; dz := pz[j % v_n + 1];
      d1 := (cz - az) * (bx - ax) - (bz - az) * (cx - ax);
      d2 := (dz - az) * (bx - ax) - (bz - az) * (dx - ax);
      d3 := (az - cz) * (dx - cx) - (dz - cz) * (ax - cx);
      d4 := (bz - cz) * (dx - cx) - (dz - cz) * (bx - cx);
      if d1 * d2 < 0 and d3 * d4 < 0 then
        raise exception 'Die Strecke kreuzt sich selbst.' using errcode = '22023';
      end if;
    end loop;
  end loop;
  if coalesce(p_fill, false) then return; end if;
  -- zu enge Kurven: Umkreisradius dreier aufeinanderfolgender Punkte
  for i in 1 .. v_n loop
    ax := px[i]; az := pz[i];
    bx := px[i % v_n + 1]; bz := pz[i % v_n + 1];
    cx := px[(i + 1) % v_n + 1]; cz := pz[(i + 1) % v_n + 1];
    ab := sqrt((bx - ax) ^ 2 + (bz - az) ^ 2); bc := sqrt((cx - bx) ^ 2 + (cz - bz) ^ 2); ca := sqrt((ax - cx) ^ 2 + (az - cz) ^ 2);
    cr := abs((bx - ax) * (cz - az) - (bz - az) * (cx - ax));
    if cr > 0.000001 then
      r := ab * bc * ca / (2 * cr);
      if r < 1.2 * coalesce(p_width, 16) / 2.0 then raise exception 'Eine Kurve der Strecke ist zu eng.' using errcode = '22023'; end if;
    end if;
  end loop;
end;
$$;

-- Bisher gespeicherte ungültige Strecken löschen (samt Bestzeiten)
do $$
declare r record; v_bad uuid[] := '{}';
begin
  for r in select id, pts, width, fill from public.race_tracks loop
    begin
      perform public._race_track_valid(r.pts, r.width, r.fill);
    exception when others then
      v_bad := v_bad || r.id;
    end;
  end loop;
  if array_length(v_bad, 1) > 0 then
    delete from public.race_records where track in (select 'c:' || x::text from unnest(v_bad) x);
    delete from public.race_tracks where id = any(v_bad);
  end if;
end $$;

drop function if exists public.race_track_save(text, jsonb, integer, boolean);
drop function if exists public.race_track_save(text, jsonb, integer, boolean, boolean);
create or replace function public.race_track_save(p_name text, p_pts jsonb, p_width integer, p_public boolean, p_fill boolean default false)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_me uuid := public._og_check(); v_id uuid; v_max integer; v_has integer;
begin
  perform public._feature_guard('cars');
  perform public._race_track_valid(p_pts, least(greatest(coalesce(p_width, 16), 10), 30), coalesce(p_fill, false));
  if p_name is null or char_length(btrim(p_name)) < 2 or char_length(btrim(p_name)) > 40 then raise exception 'Gib der Strecke einen Namen (2 bis 40 Zeichen).' using errcode = '22023'; end if;
  v_max := case when public._pro_active(v_me) then 3 when public._plus_active(v_me) then 2 else 1 end;
  select count(*) into v_has from public.race_tracks where owner = v_me;
  if v_has >= v_max then
    raise exception 'Du hast schon % eigene Strecke(n). Ohne Plus oder Pro ist 1 erlaubt, mit Plus 2, mit Pro 3. Lösche eine, um Platz zu schaffen.', v_has using errcode = '22023';
  end if;
  insert into public.race_tracks (owner, name, pts, width, is_public, fill)
  values (v_me, btrim(p_name), p_pts, least(greatest(coalesce(p_width, 16), 10), 30), coalesce(p_public, true), coalesce(p_fill, false)) returning id into v_id;
  return v_id;
end;
$$;

drop function if exists public.race_track_list();
create or replace function public.race_track_list()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_me uuid := public._og_check();
begin
  perform public._feature_guard('cars');
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'pts', t.pts, 'width', t.width, 'public', t.is_public, 'mine', t.owner = v_me, 'owner', coalesce(p.display_name, '?'), 'fill', t.fill) order by (t.owner = v_me) desc, t.created_at desc)
    from (select * from public.race_tracks where owner = v_me or is_public order by (owner = v_me) desc, created_at desc limit 80) t
    left join public.profiles p on p.id = t.owner), '[]'::jsonb);
end;
$$;

-- Online: ausgefüllte Flächen sind nur zum Üben (allein)
do $$
declare v_oid oid; v_def text; v_new text;
begin
  select p.oid into v_oid from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'og_race_set' limit 1;
  if v_oid is null then raise exception 'Funktion og_race_set fehlt.'; end if;
  v_def := replace(pg_get_functiondef(v_oid), chr(13), '');
  if position('Flächen' in v_def) > 0 then return; end if;
  v_new := replace(v_def, 'if t.id is null then raise exception ''Strecke nicht gefunden.'' using errcode = ''P0002''; end if;',
                          'if t.id is null then raise exception ''Strecke nicht gefunden.'' using errcode = ''P0002''; end if;' || chr(10) || '    if t.fill then raise exception ''Flächen sind nur allein zum Üben fahrbar.'' using errcode = ''22023''; end if;');
  if v_new = v_def then raise exception 'Patch für og_race_set nicht anwendbar.'; end if;
  execute v_new;
end $$;

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('race_track_save', 'race_track_list', 'og_race_set', '_race_track_valid')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    if left(r.proname, 1) <> '_' then
      execute format('grant execute on function %s to authenticated', r.sig);
    end if;
  end loop;
end $$;
