create or replace function public.admin_topup_driver_wallet(
  p_driver_id uuid,
  p_amount numeric,
  p_note text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before numeric(12,2);
  v_after numeric(12,2);
  v_note text;
begin
  if p_amount is null or p_amount <= 0 or p_amount > 1000000 then
    raise exception 'Сумма пополнения должна быть от 1 до 1 000 000 ₸.';
  end if;
  select wallet_balance into v_before
  from public.drivers
  where id=p_driver_id
  for update;
  if not found then raise exception 'Водитель не найден.'; end if;
  v_after := round(v_before+p_amount,2);
  update public.drivers
  set wallet_balance=v_after, updated_at=now()
  where id=p_driver_id;
  v_note := left(coalesce(nullif(trim(p_note),''),'Ручное пополнение после проверки перевода'),300);
  insert into public.wallet_transactions
    (driver_id,kind,amount,balance_before,balance_after,status,note)
  values
    (p_driver_id,'topup',round(p_amount,2),v_before,v_after,'confirmed',v_note);
  return jsonb_build_object('ok',true,'driver_id',p_driver_id,'amount',round(p_amount,2),'balance_before',v_before,'balance_after',v_after);
end;
$$;
revoke all on function public.admin_topup_driver_wallet(uuid,numeric,text) from public, anon, authenticated;
grant execute on function public.admin_topup_driver_wallet(uuid,numeric,text) to service_role;
