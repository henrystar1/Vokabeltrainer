-- ============================================================================
-- 0118 Feuerwehr-Einsatz: race_duty_pay('fire') zahlt 120 Coins (höchstens alle 60 s), wie Polizei und Sanitäter über _grant_koins
-- ============================================================================
alter table public.race_duty add column if not exists fire_at timestamptz not null default now() - interval '1 day';

create or replace function public.race_duty_pay(p_kind text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_me uuid := public._og_check(); d public.race_duty; v_amt bigint; v_bal bigint;
begin
  perform public._feature_guard('cars');
  if p_kind not in ('police', 'medic', 'fire') then raise exception 'Unbekannt.' using errcode = '22023'; end if;
  insert into public.race_duty (user_id) values (v_me) on conflict do nothing;
  select * into d from public.race_duty where user_id = v_me for update;
  if p_kind = 'police' then
    if d.police_at > now() - interval '120 seconds' then return jsonb_build_object('coins', 0, 'koins', null); end if;
    v_amt := 150; update public.race_duty set police_at = now() where user_id = v_me;
  elsif p_kind = 'fire' then
    if d.fire_at > now() - interval '60 seconds' then return jsonb_build_object('coins', 0, 'koins', null); end if;
    v_amt := 120; update public.race_duty set fire_at = now() where user_id = v_me;
  else
    if d.medic_at > now() - interval '45 seconds' then return jsonb_build_object('coins', 0, 'koins', null); end if;
    v_amt := 80; update public.race_duty set medic_at = now() where user_id = v_me;
  end if;
  v_bal := public._grant_koins(v_me, v_amt, 'race_duty', p_kind);
  return jsonb_build_object('coins', v_amt, 'koins', v_bal);
end;
$$;

revoke all on function public.race_duty_pay(text) from public, anon;
grant execute on function public.race_duty_pay(text) to authenticated;
