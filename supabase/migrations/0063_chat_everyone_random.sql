-- 0063: Chat: @everyone markiert alle, !pay @everyone 100 schenkt jedem anderen Konto 100 Coins, !pay @random 100 einer zufälligen Person.
--  Normale Nutzer zahlen die Coins von ihrem Guthaben (Tageslimit und Höchstbetrag pro Person gelten); Admins erzeugen sie neu.
--  Wiederholbar. Gebaut auf post_chat aus 0017 und notify_poll aus 0020.

create or replace function public.post_chat(p_body text)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  v_body text := btrim(coalesce(p_body, ''));
  v_id bigint;
  v_m text[];
  v_to uuid;
  v_to_name text;
  v_me_name text;
  v_amount bigint;
  v_sent bigint;
  v_rest text;
  v_muted timestamptz;
  v_admin boolean := public.is_admin();
  v_all boolean;
  v_targets uuid[];
  v_count integer;
begin
  perform public._feature_guard('chat');
  if v_me is null or public.is_blocked() then
    raise exception 'Kein Zugriff.' using errcode = '42501';
  end if;
  select muted_until into v_muted from public.profiles where id = v_me;
  if v_muted is not null and v_muted > now() then
    raise exception 'Du bist stummgeschaltet – noch % Sekunden.', ceil(extract(epoch from (v_muted - now())))::integer
      using errcode = '42501';
  end if;
  if char_length(v_body) < 1 or char_length(v_body) > 500 then
    raise exception 'Die Nachricht braucht 1 bis 500 Zeichen.' using errcode = '22023';
  end if;
  if exists (select 1 from public.chat_messages where user_id = v_me and created_at > now() - interval '1 second') then
    raise exception 'Nicht so schnell – warte kurz.' using errcode = '22023';
  end if;
  if (select count(*) from public.chat_messages where user_id = v_me and created_at > now() - interval '1 minute')
       >= greatest(public.setting('chat_per_minute'), 1) then
    raise exception 'Zu viele Nachrichten – warte eine Minute.' using errcode = '22023';
  end if;

  -- Befehl: !pay @Anzeigename 100   (Admins auch: 1k, 2,5m, 3mrd, 1b)
  if v_body ~* '^!pay(\s|$)' then
    v_m := regexp_match(v_body, '^!pay\s+@?(.+?)\s+(\S+)$', 'i');
    if v_m is null then
      raise exception 'So geht es: !pay @Anzeigename 100' using errcode = '22023';
    end if;
    v_amount := public._parse_coins(v_m[2], v_admin);
    if v_amount is null then
      raise exception 'So geht es: !pay @Anzeigename 100' using errcode = '22023';
    end if;
    if v_amount < 1 then
      raise exception 'Der Betrag muss mindestens 1 sein.' using errcode = '22023';
    end if;
    if v_admin then
      if v_amount > 1000000000000000 then
        raise exception 'Höchstens 1.000.000.000.000.000 auf einmal.' using errcode = '22023';
      end if;
    elsif v_amount > public.setting('pay_max') then
      raise exception 'Pro Überweisung sind höchstens % Coins erlaubt.', public.setting('pay_max') using errcode = '22023';
    end if;
    select display_name into v_me_name from public.profiles where id = v_me;
    -- @everyone: allen anderen aktiven Konten je den Betrag; @random: einer zufälligen Person
    if lower(btrim(v_m[1])) in ('everyone', 'random') then
      v_all := lower(btrim(v_m[1])) = 'everyone';
      select coalesce(array_agg(x.id), '{}'::uuid[]) into v_targets
        from (
          select p.id from public.profiles p
           where p.id <> v_me and not p.blocked and p.approved
           order by case when v_all then 0 else random() end
           limit case when v_all then 100000 else 1 end) x;
      v_count := coalesce(array_length(v_targets, 1), 0);
      if v_count = 0 then
        raise exception 'Es gibt niemanden, der Coins bekommen kann.' using errcode = 'P0002';
      end if;
      if v_admin then
        null; -- Admins erzeugen die Coins neu
      else
        if v_amount * v_count > 100000000 then
          raise exception 'Das wäre zu viel auf einmal.' using errcode = '22023';
        end if;
        select coalesce(sum(-l.amount), 0) into v_sent
          from public.koin_ledger l
         where l.user_id = v_me and l.reason = 'pay_out'
           and (l.created_at at time zone 'Europe/Berlin')::date = (now() at time zone 'Europe/Berlin')::date;
        if v_sent + v_amount * v_count > public.setting('pay_daily_cap') then
          raise exception 'Tageslimit: Du kannst heute noch % Coins verschicken (das wären % an % Personen).', greatest(public.setting('pay_daily_cap') - v_sent, 0), v_amount * v_count, v_count using errcode = '22023';
        end if;
        if coalesce((select balance from public.koin_wallets where user_id = v_me), 0) < v_amount * v_count then
          raise exception 'Nicht genug Coins: % Personen × % = %.', v_count, v_amount, v_amount * v_count using errcode = '23514';
        end if;
        perform public._grant_koins(v_me, -(v_amount * v_count), 'pay_out', 'everyone');
      end if;
      foreach v_to in array v_targets loop
        perform public._grant_koins(v_to, v_amount, 'pay_in', v_me::text);
        insert into public.user_messages (user_id, from_id, body)
        values (v_to, null, v_me_name || ' hat dir ' || public._fmt_coins(v_amount) || ' Coins geschickt. 💵');
      end loop;
      if v_all then
        insert into public.chat_messages (user_id, body, kind)
        values (v_me, v_me_name || ' hat allen (' || v_count || ' Personen) je ' || public._fmt_coins(v_amount) || ' Coins geschickt 🎁', 'pay')
        returning chat_messages.id into v_id;
      else
        select display_name into v_to_name from public.profiles where id = v_targets[1];
        insert into public.chat_messages (user_id, body, kind)
        values (v_me, v_me_name || ' hat zufällig ' || v_to_name || ' ' || public._fmt_coins(v_amount) || ' Coins geschickt 🎲', 'pay')
        returning chat_messages.id into v_id;
      end if;
      return v_id;
    end if;

    select p.id, p.display_name into v_to, v_to_name
      from public.profiles p where lower(p.display_name) = lower(btrim(v_m[1])) and not p.blocked;
    if v_to is null then
      raise exception 'Spieler „%“ nicht gefunden.', btrim(v_m[1]) using errcode = 'P0002';
    end if;
    if v_to = v_me then
      raise exception 'Du kannst dir nicht selbst Coins schicken.' using errcode = '22023';
    end if;
    select display_name into v_me_name from public.profiles where id = v_me;
    if v_admin then
      perform public._grant_koins(v_to, v_amount, 'pay_in', v_me::text);
    else
      select coalesce(sum(-l.amount), 0) into v_sent
        from public.koin_ledger l
       where l.user_id = v_me and l.reason = 'pay_out'
         and (l.created_at at time zone 'Europe/Berlin')::date = (now() at time zone 'Europe/Berlin')::date;
      if v_sent + v_amount > public.setting('pay_daily_cap') then
        raise exception 'Tageslimit: Du kannst heute noch % Coins verschicken.', greatest(public.setting('pay_daily_cap') - v_sent, 0) using errcode = '22023';
      end if;
      if coalesce((select balance from public.koin_wallets where user_id = v_me), 0) < v_amount then
        raise exception 'Nicht genug Coins.' using errcode = '23514';
      end if;
      perform public._grant_koins(v_me, -v_amount, 'pay_out', v_to::text);
      perform public._grant_koins(v_to, v_amount, 'pay_in', v_me::text);
    end if;
    insert into public.user_messages (user_id, from_id, body)
    values (v_to, null, v_me_name || ' hat dir ' || public._fmt_coins(v_amount) || ' Coins geschickt. 💵');
    insert into public.chat_messages (user_id, body, kind)
    values (v_me, v_me_name || ' hat ' || v_to_name || ' ' || public._fmt_coins(v_amount) || ' Coins geschickt 💵', 'pay')
    returning chat_messages.id into v_id;
    return v_id;
  end if;

  -- Befehl: !whisper @Anzeigename Text  (nur Absender und Empfänger sehen die Nachricht)
  if v_body ~* '^!whisper(\s|$)' then
    v_rest := btrim(regexp_replace(v_body, '^!whisper\s*@?', '', 'i'));
    -- längster passender Anzeigename gewinnt (Namen dürfen Leerzeichen enthalten)
    select p.id, p.display_name into v_to, v_to_name
      from public.profiles p
     where not p.blocked
       and lower(left(v_rest, char_length(p.display_name) + 1)) = lower(p.display_name) || ' '
     order by char_length(p.display_name) desc
     limit 1;
    if v_to is null then
      raise exception 'So geht es: !whisper @Anzeigename Text' using errcode = '22023';
    end if;
    if v_to = v_me then
      raise exception 'Du kannst dir nicht selbst flüstern.' using errcode = '22023';
    end if;
    v_rest := btrim(substr(v_rest, char_length(v_to_name) + 2));
    if char_length(v_rest) < 1 then
      raise exception 'So geht es: !whisper @Anzeigename Text' using errcode = '22023';
    end if;
    insert into public.chat_messages (user_id, body, kind, recipient_id)
    values (v_me, v_rest, 'whisper', v_to) returning chat_messages.id into v_id;
    return v_id;
  end if;

  if exists (select 1 from public.chat_messages where user_id = v_me and body = v_body and created_at > now() - interval '30 seconds') then
    raise exception 'Diese Nachricht hast du gerade schon gesendet.' using errcode = '22023';
  end if;
  insert into public.chat_messages (user_id, body) values (v_me, v_body) returning chat_messages.id into v_id;
  return v_id;
end;
$$;

create or replace function public.notify_poll(p_chat_after bigint, p_since timestamptz)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  v_name text;
  v_set public.user_settings%rowtype;
  v_pattern text;
  v_since timestamptz := coalesce(p_since, now());
  v_max bigint;
  v_chat jsonb := '[]'::jsonb;
  v_ready jsonb := '[]'::jsonb;
  v_online jsonb := '[]'::jsonb;
begin
  if v_me is null or public.is_blocked() then
    raise exception 'Kein Zugriff.' using errcode = '42501';
  end if;
  select * into v_set from public.user_settings where user_id = v_me;
  select display_name into v_name from public.profiles where id = v_me;

  select coalesce(max(c.id), 0) into v_max
    from public.chat_messages c
   where c.kind <> 'whisper' or c.user_id = v_me or c.recipient_id = v_me;

  if p_chat_after is not null and (coalesce(v_set.notify_mentions, true) or coalesce(v_set.notify_chat, false)) then
    v_pattern := '(^|[^[:alnum:]_])@' || regexp_replace(coalesce(v_name, ''), '([.^$*+?()\[\]{}|\\])', '\\\1', 'g') || '($|[^[:alnum:]_])';
    select coalesce(jsonb_agg(x order by (x ->> 'id')::bigint), '[]'::jsonb) into v_chat
      from (
        select jsonb_build_object(
                 'id', c.id,
                 'from', pr.display_name,
                 'body', left(c.body, 140),
                 'whisper', c.kind = 'whisper',
                 'mention', (c.kind = 'whisper' or c.body ~* v_pattern or c.body ~* '(^|[^[:alnum:]_])@everyone($|[^[:alnum:]_])')) as x
          from public.chat_messages c
          join public.profiles pr on pr.id = c.user_id
         where c.id > p_chat_after
           and c.user_id <> v_me
           and c.kind <> 'pay'
           and (c.kind <> 'whisper' or c.recipient_id = v_me)
           and (coalesce(v_set.notify_chat, false)
                or (coalesce(v_set.notify_mentions, true) and (c.kind = 'whisper' or c.body ~* v_pattern or c.body ~* '(^|[^[:alnum:]_])@everyone($|[^[:alnum:]_])')))
         order by c.id desc
         limit 10) t;
  end if;

  if coalesce(v_set.notify_print, true) then
    select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'title', o.title) order by o.ready_at), '[]'::jsonb) into v_ready
      from public.print_orders o
     where o.user_id = v_me and o.status = 'lieferbereit' and o.ready_at > v_since;
  end if;

  if coalesce(v_set.notify_online, 'off') <> 'off' then
    select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.display_name) order by p.online_since), '[]'::jsonb) into v_online
      from (
        select p.* from public.profiles p
         where p.id <> v_me
           and not p.blocked
           and not p.hide_presence
           and p.online_since > v_since
           and p.last_seen_at > now() - interval '3 minutes'
           and (v_set.notify_online = 'all' or (p.role in ('mod', 'admin') and not p.tags_hidden))
         order by p.online_since
         limit 5) p;
  end if;

  return jsonb_build_object('now', now(), 'chat_max', v_max, 'chat', v_chat, 'ready', v_ready, 'online', v_online);
end;
$$;
