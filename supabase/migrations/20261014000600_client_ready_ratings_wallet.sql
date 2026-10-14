alter table public.orders
  drop constraint if exists orders_status_check;
alter table public.orders
  add constraint orders_status_check
  check (status in ('new','accepted','arrived','client_ready','started','completed','cancelled'));

alter table public.drivers
  add column if not exists wallet_balance numeric(12,2) not null default 0;

alter table public.platform_settings
  add column if not exists minimum_wallet_balance numeric(12,2) not null default 500;

alter table public.orders
  add column if not exists platform_commission_amount numeric(12,2),
  add column if not exists driver_net_amount numeric(12,2);

create table if not exists public.wallet_transactions (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null references public.drivers(id) on delete cascade,
  order_id uuid references public.orders(id) on delete set null,
  kind text not null check (kind in ('topup','commission','adjustment')),
  amount numeric(12,2) not null,
  balance_before numeric(12,2) not null,
  balance_after numeric(12,2) not null,
  status text not null default 'confirmed' check (status in ('confirmed','pending','test')),
  note text,
  created_at timestamptz not null default now()
);
create unique index if not exists wallet_transactions_order_commission_unique
  on public.wallet_transactions(order_id, kind) where order_id is not null and kind='commission';
create index if not exists wallet_transactions_driver_created_idx
  on public.wallet_transactions(driver_id, created_at desc);
alter table public.wallet_transactions enable row level security;
drop policy if exists wallet_transactions_service_role_all on public.wallet_transactions;
create policy wallet_transactions_service_role_all on public.wallet_transactions
  for all to service_role using (true) with check (true);

create table if not exists public.driver_ratings (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.orders(id) on delete cascade,
  driver_id uuid not null references public.drivers(id) on delete cascade,
  client_id uuid references public.clients(id) on delete set null,
  stars int not null check (stars between 1 and 5),
  comment text check (char_length(comment) <= 500),
  created_at timestamptz not null default now()
);
create index if not exists driver_ratings_driver_created_idx
  on public.driver_ratings(driver_id, created_at desc);
alter table public.driver_ratings enable row level security;
drop policy if exists driver_ratings_service_role_all on public.driver_ratings;
create policy driver_ratings_service_role_all on public.driver_ratings
  for all to service_role using (true) with check (true);

create or replace function public.complete_taxi_order(
  p_order_id uuid,
  p_driver_id uuid,
  p_commission_percent numeric,
  p_test_mode boolean
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_fare numeric(12,2);
  v_commission numeric(12,2);
  v_net numeric(12,2);
  v_balance_before numeric(12,2);
  v_balance_after numeric(12,2);
begin
  select * into v_order
  from public.orders
  where id=p_order_id and driver_id=p_driver_id
  for update;

  if not found then
    raise exception 'Заказ не найден.';
  end if;

  if v_order.status='completed' then
    select wallet_balance into v_balance_after from public.drivers where id=p_driver_id;
    return jsonb_build_object(
      'ok', true, 'already_completed', true, 'order_id', v_order.id,
      'fare', coalesce(v_order.agreed_price,v_order.driver_price,v_order.client_price,0),
      'commission', coalesce(v_order.platform_commission_amount,0),
      'net', coalesce(v_order.driver_net_amount,0), 'wallet_balance', coalesce(v_balance_after,0)
    );
  end if;

  if v_order.status <> 'started' then
    raise exception 'Сначала нужно начать поездку.';
  end if;

  v_fare := round(greatest(0,coalesce(nullif(v_order.agreed_price,0),nullif(v_order.driver_price,0),nullif(v_order.client_price,0),0)),2);
  v_commission := round(v_fare * greatest(0,least(30,coalesce(p_commission_percent,0))) / 100,2);
  v_net := round(v_fare - v_commission,2);

  update public.orders
  set status='completed',
      completed_at=now(),
      platform_commission_amount=v_commission,
      driver_net_amount=v_net
  where id=p_order_id;

  select wallet_balance into v_balance_before from public.drivers where id=p_driver_id;
  v_balance_after := v_balance_before;

  if not coalesce(p_test_mode,true) then
    v_balance_after := round(v_balance_before-v_commission,2);
    update public.drivers
    set wallet_balance=v_balance_after,
        is_online=case when v_balance_after < 500 then false else is_online end,
        updated_at=now()
    where id=p_driver_id;

    if v_fare > 0 then
      insert into public.platform_commissions
        (order_id,driver_id,fare,commission_percent,commission_amount,status,paid_at,paid_note)
      values
        (p_order_id,p_driver_id,v_fare,coalesce(p_commission_percent,0),v_commission,'paid',now(),'Автоматически списано с лицевого счёта')
      on conflict (order_id) do nothing;

      insert into public.wallet_transactions
        (driver_id,order_id,kind,amount,balance_before,balance_after,status,note)
      values
        (p_driver_id,p_order_id,'commission',-v_commission,v_balance_before,v_balance_after,'confirmed','Комиссия за поездку')
      on conflict (order_id,kind) where order_id is not null and kind='commission' do nothing;
    end if;
  end if;

  select wallet_balance into v_balance_after from public.drivers where id=p_driver_id;
  return jsonb_build_object(
    'ok',true,'already_completed',false,'order_id',p_order_id,
    'fare',v_fare,'commission',v_commission,'net',v_net,
    'wallet_balance',coalesce(v_balance_after,0),'test_mode',coalesce(p_test_mode,true)
  );
end;
$$;

revoke all on function public.complete_taxi_order(uuid,uuid,numeric,boolean) from public, anon, authenticated;
grant execute on function public.complete_taxi_order(uuid,uuid,numeric,boolean) to service_role;
