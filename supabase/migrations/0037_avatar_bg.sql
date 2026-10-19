-- 0037: Hintergrundfarbe für Emoji-Profilbilder, jeder wählt selbst. Wiederholbar. Nach 0036 ausführen.
-- Anzeigenamen sind eindeutig (ohne Groß-/Kleinschreibung), daher liefert get_avatar_bgs() eine Liste Name → Farbe,
-- die der Client einmal lädt; die vielen Chat-/Ranglisten-Funktionen bleiben unverändert.

alter table public.profiles add column if not exists avatar_bg text;
alter table public.profiles drop constraint if exists profiles_avatar_bg_check;
alter table public.profiles add constraint profiles_avatar_bg_check check (avatar_bg is null or avatar_bg ~ '^#[0-9a-fA-F]{6}$');

create or replace function public.set_avatar_bg(p_color text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  v_c text := nullif(btrim(coalesce(p_color, '')), '');
begin
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  if v_c is not null and v_c !~ '^#[0-9a-fA-F]{6}$' then
    raise exception 'Ungültige Farbe.' using errcode = '22023';
  end if;
  update public.profiles set avatar_bg = lower(v_c) where id = v_me;
end;
$$;

create or replace function public.get_avatar_bgs()
returns table (display_name text, avatar_bg text)
language sql
stable
security definer
set search_path = public
as $$
  select p.display_name, p.avatar_bg
    from public.profiles p
   where (select auth.uid()) is not null and p.avatar_bg is not null;
$$;

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('set_avatar_bg', 'get_avatar_bgs')
  loop
    execute format('revoke all on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;
end;
$$;
