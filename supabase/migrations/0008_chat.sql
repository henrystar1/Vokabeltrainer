-- 0008: Gemeinsamer Chat für alle angemeldeten Lernenden.
-- Zugriff nur über Funktionen; wiederholbar.

create table if not exists public.chat_messages (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  body text not null check (char_length(body) between 1 and 500),
  created_at timestamptz not null default now()
);
create index if not exists chat_messages_created_idx on public.chat_messages (id desc);

alter table public.chat_messages enable row level security;
revoke all on public.chat_messages from anon, authenticated;

drop function if exists public.get_chat(integer);
create function public.get_chat(p_limit integer default 100)
returns table (id bigint, body text, created_at timestamptz, is_me boolean, display_name text,
               avatar_id text, color_id text, effect_id text, role text, tag_id text, theme_id text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if (select auth.uid()) is null or public.is_blocked() then
    raise exception 'Kein Zugriff.' using errcode = '42501';
  end if;
  return query
    select m.id, m.body, m.created_at, (m.user_id = (select auth.uid())), pr.display_name,
           pr.avatar_id, pr.color_id, pr.effect_id, pr.role, pr.tag_id, pr.theme_id
      from (select * from public.chat_messages order by chat_messages.id desc limit least(greatest(coalesce(p_limit, 100), 1), 200)) m
      join public.profiles pr on pr.id = m.user_id
     order by m.id asc;
end;
$$;

drop function if exists public.post_chat(text);
create function public.post_chat(p_body text)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  v_body text := btrim(coalesce(p_body, ''));
  v_id bigint;
begin
  if v_me is null or public.is_blocked() then
    raise exception 'Kein Zugriff.' using errcode = '42501';
  end if;
  if char_length(v_body) < 1 or char_length(v_body) > 500 then
    raise exception 'Die Nachricht braucht 1 bis 500 Zeichen.' using errcode = '22023';
  end if;
  if exists (select 1 from public.chat_messages where user_id = v_me and created_at > now() - interval '1 second') then
    raise exception 'Nicht so schnell – warte kurz.' using errcode = '22023';
  end if;
  if (select count(*) from public.chat_messages where user_id = v_me and created_at > now() - interval '1 minute') >= 20 then
    raise exception 'Zu viele Nachrichten – warte eine Minute.' using errcode = '22023';
  end if;
  if exists (select 1 from public.chat_messages where user_id = v_me and body = v_body and created_at > now() - interval '30 seconds') then
    raise exception 'Diese Nachricht hast du gerade schon gesendet.' using errcode = '22023';
  end if;
  insert into public.chat_messages (user_id, body) values (v_me, v_body) returning chat_messages.id into v_id;
  return v_id;
end;
$$;

drop function if exists public.delete_chat_message(bigint);
create function public.delete_chat_message(p_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_staff() then
    raise exception 'Nur Mods und Admins dürfen Nachrichten löschen.' using errcode = '42501';
  end if;
  delete from public.chat_messages where id = p_id;
end;
$$;

do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('get_chat', 'post_chat', 'delete_chat_message')
  loop
    execute format('revoke all on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;
end;
$$;
