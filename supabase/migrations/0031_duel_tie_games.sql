-- 0031: Duelle können unentschieden enden (beide bekommen die Hälfte der Coins) und drei neue Spiele:
-- Coreball (id coreball), Klicker (id clicker) und CPS-Test (id cps). Wiederholbar. Nach 0030 ausführen.

-- ----------------------------------------------------------------------------
-- A. Duelle: gleich viele richtige Antworten = Unentschieden (Zeit entscheidet nicht mehr)
-- ----------------------------------------------------------------------------
do $$
declare
  v_def text;
  v_new text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'submit_duel'
   limit 1;
  if v_def is null then return; end if;
  v_new := v_def;
  -- Zeit als Tie-Break entfernen
  v_new := replace(v_new, E'  elsif v_mine.millis < v_other.millis then v_winner := v_me;\n  elsif v_mine.millis > v_other.millis then v_winner := v_other.user_id;\n', '');
  -- Bei Unentschieden bekommen beide die Hälfte (Tageslimit gilt je Person)
  if position('duel_tie' in v_new) = 0 then
    v_new := replace(v_new,
      E'  select display_name into v_name from public.profiles where id = v_me;',
      E'  if v_winner is null and public.setting(''duel_reward'') > 1 then\n'
      || E'    -- duel_tie: jeder bekommt die Hälfte des Sieg-Preises\n'
      || E'    if (select count(*) from public.koin_ledger l\n'
      || E'         where l.user_id = v_me and l.reason = ''duel''\n'
      || E'           and (l.created_at at time zone ''Europe/Berlin'')::date = v_today) < public.setting(''duel_daily_cap'') then\n'
      || E'      perform public._grant_koins(v_me, public.setting(''duel_reward'') / 2, ''duel'', p_id::text);\n'
      || E'    end if;\n'
      || E'    if (select count(*) from public.koin_ledger l\n'
      || E'         where l.user_id = v_other.user_id and l.reason = ''duel''\n'
      || E'           and (l.created_at at time zone ''Europe/Berlin'')::date = v_today) < public.setting(''duel_daily_cap'') then\n'
      || E'      perform public._grant_koins(v_other.user_id, public.setting(''duel_reward'') / 2, ''duel'', p_id::text);\n'
      || E'    end if;\n'
      || E'  end if;\n\n'
      || E'  select display_name into v_name from public.profiles where id = v_me;');
  end if;
  if v_new <> v_def then
    execute v_new;
  end if;
end;
$$;

-- ----------------------------------------------------------------------------
-- B. Neue Spiele
-- ----------------------------------------------------------------------------
alter table public.game_runs drop constraint if exists game_runs_game_check;
alter table public.game_runs add constraint game_runs_game_check
  check (game in ('snake', 'tetris', 'blast', 'crossy', 'flappy', 'wave', 'g2048', 'memory', 'bricks', 'mole', 'jump',
                  'coreball', 'clicker', 'cps'));

do $$
declare
  r record;
  v_def text;
  v_new text;
begin
  for r in select * from (values
      ('start_game',     array[array['''jump'')', '''jump'', ''coreball'', ''clicker'', ''cps'')']]),
      ('get_game_board', array[array['''jump'')', '''jump'', ''coreball'', ''clicker'', ''cps'')']]),
      -- Punkte pro Sekunde höchstens: Coreball 6, Klicker 2 (20 Klicks/s), CPS-Test 3 (Bestwert pro Sekunde)
      ('finish_game',    array[array['when ''jump'' then 14 else', 'when ''jump'' then 14 when ''coreball'' then 6 when ''clicker'' then 2 when ''cps'' then 3 else']])
    ) as t(fn, reps)
  loop
    select pg_get_functiondef(p.oid) into v_def
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = r.fn
     limit 1;
    continue when v_def is null;
    v_new := v_def;
    for i in 1 .. array_length(r.reps, 1) loop
      v_new := replace(v_new, r.reps[i][1], r.reps[i][2]);
    end loop;
    continue when v_new = v_def;
    execute v_new;
  end loop;
end;
$$;

do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('submit_duel', 'start_game', 'finish_game', 'get_game_board')
  loop
    execute format('revoke all on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;
end;
$$;

-- ----------------------------------------------------------------------------
-- C. Neues Design „Schwarzes Loch“ (Aussehen steht in der App: features/shop/catalog.ts)
-- ----------------------------------------------------------------------------
insert into public.shop_items (id, kind, name, price, sort, required_role) values
  ('theme_blackhole', 'theme', 'Schwarzes Loch', 250000, 230, null)
on conflict (id) do nothing;
