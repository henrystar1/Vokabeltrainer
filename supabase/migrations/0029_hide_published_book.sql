-- 0029: Ein veröffentlichtes Buch kann aus den eigenen Büchern entfernt werden und bleibt dann nur online.
-- Besitzer (Admin/Mod) sehen es dann nur noch im Reiter „Online“, bis sie es wieder verwenden. Wiederholbar.

create table if not exists public.book_library_hidden (
  user_id uuid not null references auth.users (id) on delete cascade,
  book_id uuid not null references public.books (id) on delete cascade,
  primary key (user_id, book_id)
);
alter table public.book_library_hidden enable row level security;
revoke all on public.book_library_hidden from anon, authenticated;

create or replace function public.in_library(p_book_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.books b
     where b.id = p_book_id
       and ((b.owner_id = (select auth.uid())
             and not (b.is_public and exists (
                   select 1 from public.book_library_hidden h
                    where h.book_id = b.id and h.user_id = (select auth.uid()))))
            or (b.is_public and exists (
                  select 1 from public.book_library l
                   where l.book_id = b.id and l.user_id = (select auth.uid()))))
  );
$$;

create or replace function public.remove_from_library(p_book_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  v_owner uuid;
  v_public boolean;
begin
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  select b.owner_id, b.is_public into v_owner, v_public from public.books b where b.id = p_book_id;
  if not found then
    raise exception 'Buch nicht gefunden.' using errcode = 'P0002';
  end if;
  if v_owner = v_me and not v_public then
    raise exception 'Nur veröffentlichte Bücher kannst du aus deinen Büchern entfernen. Zum Löschen öffne das Buch.' using errcode = '22023';
  end if;
  delete from public.book_library where book_id = p_book_id and user_id = v_me;
  if v_owner = v_me then
    insert into public.book_library_hidden (user_id, book_id) values (v_me, p_book_id) on conflict do nothing;
  end if;
end;
$$;

-- Wieder verwenden: Versteck-Eintrag des Besitzers löschen (sonst wie in 0005).
create or replace function public.add_to_library(p_book_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  v_price integer;
  v_owner uuid;
begin
  if v_me is null or public.is_blocked() then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  select b.price, b.owner_id into v_price, v_owner
    from public.books b where b.id = p_book_id and b.is_public;
  if v_price is null then
    raise exception 'Öffentliches Buch nicht gefunden.' using errcode = 'P0002';
  end if;

  if not exists (select 1 from public.book_purchases where user_id = v_me and book_id = p_book_id) then
    if public.is_staff() or v_owner = v_me or v_price = 0 then
      insert into public.book_purchases (user_id, book_id, price_paid) values (v_me, p_book_id, 0);
    else
      perform public._grant_koins(v_me, -v_price, 'book', p_book_id::text);
      insert into public.book_purchases (user_id, book_id, price_paid) values (v_me, p_book_id, v_price);
    end if;
  end if;

  delete from public.book_library_hidden where user_id = v_me and book_id = p_book_id;
  insert into public.book_library (user_id, book_id) values (v_me, p_book_id) on conflict do nothing;
end;
$$;

-- Neu veröffentlichen: Versteck-Einträge zurücksetzen.
create or replace function public._clear_hidden_on_unpublish()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.is_public and not new.is_public then
    delete from public.book_library_hidden where book_id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists books_clear_hidden on public.books;
create trigger books_clear_hidden
  after update of is_public on public.books
  for each row execute function public._clear_hidden_on_unpublish();

do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig, p.proname
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('in_library', 'remove_from_library', 'add_to_library', '_clear_hidden_on_unpublish')
  loop
    if left(r.proname, 1) = '_' then
      execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    else
      execute format('revoke all on function %s from public, anon', r.sig);
      execute format('grant execute on function %s to authenticated', r.sig);
    end if;
  end loop;
end;
$$;
