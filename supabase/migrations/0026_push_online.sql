-- ============================================================================
-- 0026: Push auch bei geöffneter App, und Push, wenn jemand online kommt
-- - Bisher kam kein Push, wenn die App in den letzten 90 Sekunden aktiv war. Jetzt immer.
-- - „Wenn jemand online kommt“ (Einstellung notify_online: Mods/Admins oder alle) kommt jetzt auch als Push.
-- Wiederholbar. Nach 0025 ausführen.
-- ============================================================================

-- Früher: nur senden, wenn die Person gerade nicht aktiv ist. Jetzt: immer.
create or replace function public._push_idle(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select true;
$$;

create or replace function public._push_on_online()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_title text;
begin
  if new.online_since is null
     or (old.online_since is not null and new.online_since <= old.online_since)
     or coalesce(new.hide_presence, false) or coalesce(new.blocked, false) then
    return new;
  end if;
  v_title := new.display_name || ' ist online';
  for r in
    select distinct s.user_id, us.notify_online
      from public.push_subscriptions s
      join public.user_settings us on us.user_id = s.user_id
     where s.user_id <> new.id and us.notify_online <> 'off'
  loop
    if r.notify_online = 'all' or (new.role in ('mod', 'admin') and not coalesce(new.tags_hidden, false)) then
      -- nicht öfter als alle 10 Minuten pro Person
      if not exists (select 1 from public.push_log l where l.user_id = r.user_id and l.title = left(v_title, 80) and l.created_at > now() - interval '10 minutes') then
        perform public._push_send(r.user_id, v_title, 'Gerade eben dazugekommen.', '/online', 'online');
      end if;
    end if;
  end loop;
  return new;
exception when others then
  return new;
end;
$$;

drop trigger if exists profiles_push_online on public.profiles;
create trigger profiles_push_online
  after update of online_since on public.profiles
  for each row execute function public._push_on_online();

revoke all on function public._push_on_online() from public, anon, authenticated;
revoke all on function public._push_idle(uuid) from public, anon, authenticated;
