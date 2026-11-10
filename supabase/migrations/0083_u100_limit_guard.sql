-- 0083: Update-100-Limit hart absichern. Wiederholbar.
-- Egal auf welchem Weg ein begrenzter Artikel vergeben wird: ab dem (limited+1). Eintrag gibt es einen Fehler.
create or replace function public._limited_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lim integer;
begin
  select limited into v_lim from public.shop_items where id = new.item_id;
  if v_lim is null then
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtext('u100:' || new.item_id));
  if (select count(*) from public.user_items where item_id = new.item_id) >= v_lim then
    raise exception 'Zu spät – alle % sind schon vergeben.', v_lim using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists user_items_limited_guard on public.user_items;
create trigger user_items_limited_guard
  before insert on public.user_items
  for each row execute function public._limited_guard();

revoke all on function public._limited_guard() from public, anon, authenticated;

-- Die Beanspruchung meldet „gone“ auch dann sauber, wenn der Trigger zuschlägt.
create or replace function public.u100_claim(p_item_id text)
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := (select auth.uid());
begin
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  if p_item_id not in ('tag_u100', 'theme_u100_gold', 'theme_u100') then
    raise exception 'Artikel nicht gefunden.' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.user_items where user_id = v_me and item_id = p_item_id) then
    return 'owned';
  end if;
  begin
    insert into public.user_items (user_id, item_id) values (v_me, p_item_id);
  exception when sqlstate 'P0001' then
    return 'gone';
  end;
  return 'ok';
end;
$$;

revoke all on function public.u100_claim(text) from public, anon, authenticated;
grant execute on function public.u100_claim(text) to authenticated;
