create table if not exists public.owner_withdrawals (
  id uuid primary key default gen_random_uuid(),
  amount numeric(12,2) not null check (amount > 0),
  method text not null default 'kaspi' check (method = 'kaspi'),
  note text,
  created_at timestamptz not null default now()
);

create index if not exists owner_withdrawals_created_at_idx
  on public.owner_withdrawals(created_at desc);

alter table public.owner_withdrawals enable row level security;
drop policy if exists owner_withdrawals_service_role_all on public.owner_withdrawals;
create policy owner_withdrawals_service_role_all on public.owner_withdrawals
  for all to service_role using (true) with check (true);
grant all privileges on table public.owner_withdrawals to service_role;

create or replace function public.record_owner_withdrawal(
  p_amount numeric,
  p_note text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_collected numeric(12,2);
  v_withdrawn numeric(12,2);
  v_available numeric(12,2);
  v_after numeric(12,2);
  v_id uuid;
  v_note text;
begin
  if p_amount is null or p_amount <= 0 or p_amount > 1000000000 then
    raise exception 'Сумма перевода должна быть больше 0 ₸.';
  end if;

  perform 1 from public.platform_settings where id is true for update;
  if not found then
    raise exception 'Настройки владельца не найдены.';
  end if;

  select coalesce(sum(commission_amount), 0)
    into v_collected
    from public.platform_commissions
    where status = 'paid';

  select coalesce(sum(amount), 0)
    into v_withdrawn
    from public.owner_withdrawals;

  v_available := round(v_collected - v_withdrawn, 2);
  if v_available < 0 then
    raise exception 'Баланс владельца отрицательный. Проверь историю переводов.';
  end if;
  if round(p_amount, 2) > v_available then
    raise exception 'Недостаточно средств в учёте владельца. Доступно: % ₸.', to_char(v_available, 'FM9999999990.00');
  end if;

  v_note := left(coalesce(nullif(trim(p_note), ''), 'Ручной перевод на Kaspi владельцем'), 300);
  v_after := round(v_available - p_amount, 2);

  insert into public.owner_withdrawals(amount, method, note)
  values (round(p_amount, 2), 'kaspi', v_note)
  returning id into v_id;

  return jsonb_build_object(
    'ok', true,
    'withdrawal_id', v_id,
    'amount', round(p_amount, 2),
    'balance_before', v_available,
    'balance_after', v_after,
    'method', 'kaspi',
    'note', v_note,
    'automatic_bank_transfer', false
  );
end;
$$;

revoke all on function public.record_owner_withdrawal(numeric, text) from public, anon, authenticated;
grant execute on function public.record_owner_withdrawal(numeric, text) to service_role;
