-- ============================================================================
-- 0022: Automatische Belohnungen (Liga, Quests, Lernen, Duelle, Sprint …) dürfen nie scheitern,
-- wenn jemand schon fast das Höchstguthaben (9 Billiarden) hat. Vorher brach z. B. die Liga-Auswertung
-- mit „Das Guthaben darf 9.000.000.000.000.000 Coins nicht übersteigen.“ ab, und die ganze Liga lud nicht mehr.
-- Jetzt wird die Belohnung gekürzt (oder entfällt), statt einen Fehler auszulösen.
-- Bewusst weiter mit Fehler: Admin-Buchungen, Überweisungen (pay_in) und Rückerstattungen.
-- Wiederholbar. Nach 0021 ausführen.
-- ============================================================================

create or replace function public._grant_koins(p_user uuid, p_amount bigint, p_reason text, p_ref text default null)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  c_max constant bigint := 9000000000000000;
  v_balance bigint;
  v_amount bigint := p_amount;
  v_strict boolean := p_reason in ('admin', 'pay_in', 'print_refund', 'plus_refund');
begin
  if p_amount = 0 then
    return coalesce((select balance from public.koin_wallets where user_id = p_user), 0);
  end if;
  insert into public.koin_wallets (user_id) values (p_user) on conflict do nothing;

  -- Automatische Belohnungen: nur so viel gutschreiben, wie noch unter das Höchstguthaben passt.
  if v_amount > 0 and not v_strict then
    select least(v_amount, greatest(c_max - w.balance, 0)) into v_amount from public.koin_wallets w where w.user_id = p_user;
    if v_amount <= 0 then
      return (select balance from public.koin_wallets where user_id = p_user);
    end if;
  end if;

  update public.koin_wallets
     set balance = balance + v_amount
   where user_id = p_user and balance + v_amount >= 0 and balance + v_amount <= c_max
   returning balance into v_balance;
  if v_balance is null then
    if v_amount > 0 then
      raise exception 'Das Guthaben darf 9.000.000.000.000.000 Coins nicht übersteigen.' using errcode = '22023';
    end if;
    raise exception 'Nicht genug Coins.' using errcode = '23514';
  end if;
  insert into public.koin_ledger (user_id, amount, reason, ref) values (p_user, v_amount, p_reason, p_ref);
  return v_balance;
end;
$$;

revoke all on function public._grant_koins(uuid, bigint, text, text) from public, anon, authenticated;
