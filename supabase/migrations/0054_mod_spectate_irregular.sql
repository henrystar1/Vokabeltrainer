-- 0054: Mods mit Zuschauer-Recht und Hammer-Design, nur wirklich aktive Läufe in der Übersicht, Coins für unregelmäßige Verben. Wiederholbar.
--  * staff_rights bekommt `spectate` (darf Läufe unsichtbar ansehen und als Gast einsteigen) und `look` ('none' | 'hammer': Hammer-Auftritt im Parkour).
--  * Admins behalten das Schwarze Loch; `_staff_look` liefert die Darstellung einer Person.
--  * admin_open_runs zeigt nur Läufe, in denen jemand wirklich ist (Herzschlag der Mitspielenden, nicht der Zuschauer).
--  * submit_irregular zahlt Coins für richtige Antworten bei den unregelmäßigen Verben (je N richtige 1 Coin, begrenzt pro Tag).

alter table public.staff_rights add column if not exists spectate boolean;
alter table public.staff_rights add column if not exists look text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'staff_rights_look_check') then
    alter table public.staff_rights add constraint staff_rights_look_check check (look is null or look in ('none', 'hammer'));
  end if;
end;
$$;

-- Darf ich Läufe ansehen und als Gast einsteigen? Admins immer, Mods nur mit Recht.
create or replace function public.can_spectate()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_admin()
      or (public.is_staff() and coalesce((select r.spectate from public.staff_rights r where r.user_id = (select auth.uid())), false));
$$;

-- Darstellung im Parkour: 'blackhole' (Admin), 'hammer' (Mod mit Hammer) oder null
create or replace function public._staff_look(p_user uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p.blocked then null
    when p.role = 'admin' then 'blackhole'
    when p.role in ('mod', 'alphamod') and r.look = 'hammer' then 'hammer'
    else null end
    from public.profiles p left join public.staff_rights r on r.user_id = p.id
   where p.id = p_user;
$$;

create or replace function public.my_run_perks()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object('spectate', public.can_spectate(), 'look', public._staff_look((select auth.uid())))
   where (select auth.uid()) is not null;
$$;

-- Rechte je Mod lesen/setzen (neue Felder)
create or replace function public.admin_get_staff_rights(p_user uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public._require_admin();
  return jsonb_build_object(
    'books_mode', (select books_mode from public.staff_rights where user_id = p_user),
    'set_mode', (select set_mode from public.staff_rights where user_id = p_user),
    'shop', (select shop from public.staff_rights where user_id = p_user),
    'timeout_max', (select timeout_max from public.staff_rights where user_id = p_user),
    'spectate', coalesce((select spectate from public.staff_rights where user_id = p_user), false),
    'look', coalesce((select look from public.staff_rights where user_id = p_user), 'none'),
    'book_ids', coalesce((select jsonb_agg(book_id) from public.staff_book_access where user_id = p_user), '[]'::jsonb),
    'setting_keys', coalesce((select jsonb_agg(key) from public.staff_setting_access where user_id = p_user), '[]'::jsonb));
end;
$$;

drop function if exists public.admin_set_staff_rights(uuid, text, text, boolean, integer);
create or replace function public.admin_set_staff_rights(p_user uuid, p_books_mode text, p_set_mode text, p_shop boolean, p_timeout integer, p_spectate boolean default false, p_look text default 'none')
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._require_admin();
  if not exists (select 1 from public.profiles where id = p_user and role in ('mod', 'alphamod')) then
    raise exception 'Nur für Mods und Alphamods.' using errcode = '22023';
  end if;
  if coalesce(p_look, 'none') not in ('none', 'hammer') then
    raise exception 'Unbekanntes Design.' using errcode = '22023';
  end if;
  insert into public.staff_rights (user_id, books_mode, set_mode, shop, timeout_max, spectate, look)
  values (p_user, p_books_mode, p_set_mode, p_shop, p_timeout, coalesce(p_spectate, false), coalesce(p_look, 'none'))
  on conflict (user_id) do update
    set books_mode = excluded.books_mode, set_mode = excluded.set_mode, shop = excluded.shop, timeout_max = excluded.timeout_max,
        spectate = excluded.spectate, look = excluded.look;
end;
$$;

-- team_get / team_spectate: Zuschauen auch mit Mod-Recht, Herzschlag auch in der Lobby, Darstellung der Personen
do $$
declare
  v_def text;
  v_new text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = '_team_get' limit 1;
  v_new := replace(v_def, 'if p_spec and not public.is_admin() then', 'if p_spec and not public.can_spectate() then');
  v_new := replace(v_new, 'Nur Admins dürfen zuschauen.', 'Du darfst nicht zuschauen.');
  v_new := replace(v_new, E'elsif t.status = ''running'' and t.kind in (''parkour'', ''deathrun'') and t.updated_at < now() - interval ''1 minute'' and public._run_member(p_id, v_me) then',
                          E'elsif t.kind in (''parkour'', ''deathrun'') and t.updated_at < now() - interval ''20 seconds'' and not p_spec and public._run_member(p_id, v_me) then');
  v_new := replace(v_new, '''pk_fx'', pp.fx)', '''pk_fx'', pp.fx, ''pk_look'', public._staff_look(pr.id))');
  if v_new = v_def or position('can_spectate' in v_new) = 0 or position('pk_look' in v_new) = 0 or position('20 seconds' in v_new) = 0 then
    raise exception '0054: _team_get konnte nicht angepasst werden.';
  end if;
  execute v_new;
end;
$$;

-- Übersicht: nur Läufe, in denen gerade jemand ist (Mods mit Zuschauer-Recht dürfen sie sehen)
create or replace function public.admin_open_runs()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.can_spectate() then
    raise exception 'Dafür fehlt dir das Recht.' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(x.j order by x.created_at desc)
      from (
        select t.created_at,
               jsonb_build_object(
                 'id', t.id, 'kind', t.kind, 'status', t.status, 'is_open', t.is_open, 'bots', t.bots,
                 'created_at', t.created_at, 'starts_at', t.starts_at,
                 'players', (select coalesce(jsonb_agg(pr.display_name order by m.ord), '[]'::jsonb)
                               from (
                                 select t.host_id as uid, 0 as ord
                                 union all select t.partner_id, 1 where t.partner_state = 'joined' and t.partner_id <> t.host_id
                                 union all select x2.user_id, 2 from public.team_run_extras x2 where x2.run_id = t.id and x2.state = 'joined' and x2.user_id <> t.host_id
                               ) m join public.profiles pr on pr.id = m.uid)) as j
          from public.team_runs t
         where t.kind in ('parkour', 'deathrun')
           and t.updated_at > now() - interval '3 minutes'
           and t.status in ('lobby', 'running')
      ) x), '[]'::jsonb);
end;
$$;

-- Unregelmäßige Verben verdienen Coins
insert into public.app_settings (key, value, mod_editable) values
  ('irregular_coin_every', 5, false),   -- 1 Coin je so viele richtige Antworten
  ('irregular_coin_cap', 15, false)     -- höchstens so viele Coins pro Tag
on conflict (key) do nothing;

create or replace function public.submit_irregular(p_correct integer, p_total integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  v_today date := (now() at time zone 'Europe/Berlin')::date;
  v_every integer := greatest(public.setting('irregular_coin_every'), 1);
  v_got integer;
  v_earned integer;
begin
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  if p_correct is null or p_total is null or p_correct < 0 or p_correct > p_total or p_total > 60 then
    raise exception 'Ungültiges Ergebnis.' using errcode = '22023';
  end if;
  select coalesce(sum(l.amount), 0) into v_got
    from public.koin_ledger l
   where l.user_id = v_me and l.reason = 'irregular' and (l.created_at at time zone 'Europe/Berlin')::date = v_today;
  v_earned := least(p_correct / v_every, greatest(public.setting('irregular_coin_cap') - v_got, 0));
  if v_earned > 0 then
    perform public._grant_koins(v_me, v_earned, 'irregular');
  end if;
  return jsonb_build_object('earned', v_earned, 'cap_left', greatest(public.setting('irregular_coin_cap') - v_got - v_earned, 0));
end;
$$;

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig, p.proname
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('can_spectate', '_staff_look', 'my_run_perks', 'admin_get_staff_rights', 'admin_set_staff_rights', '_team_get', 'admin_open_runs', 'submit_irregular')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    if r.proname not like '\_%' then
      execute format('grant execute on function %s to authenticated', r.sig);
    end if;
  end loop;
end;
$$;
