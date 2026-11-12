-- Reconstructed from the live Мой Такси schema for reproducible setup.
-- Creates a unique 10-digit-ish account number for each driver.
-- A later hardening migration revokes direct execution of the trigger function
-- from PUBLIC/anon/authenticated while retaining the server role.

create sequence if not exists public.driver_account_number_seq;

alter table public.drivers
  add column if not exists account_number text;

-- Backfill accounts if this migration is applied to an existing database.
with pending as (
  select id, nextval('public.driver_account_number_seq') as n
  from public.drivers
  where account_number is null
)
update public.drivers d
set account_number = case
  when p.n <= 999 then lpad(p.n::text, 3, '0') || lpad(p.n::text, 7, '0')
  when p.n <= 9999999999 then lpad(p.n::text, 10, '0')
  else null
end
from pending p
where d.id = p.id;

create unique index if not exists drivers_account_number_unique
  on public.drivers(account_number);

alter table public.drivers
  alter column account_number set not null;

create or replace function public.assign_driver_account_number()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  next_number bigint;
begin
  next_number := nextval('public.driver_account_number_seq');

  if next_number <= 999 then
    new.account_number := lpad(next_number::text, 3, '0') || lpad(next_number::text, 7, '0');
  elsif next_number <= 9999999999 then
    new.account_number := lpad(next_number::text, 10, '0');
  else
    raise exception 'No more 10-digit driver account numbers available';
  end if;

  return new;
end;
$$;

drop trigger if exists set_driver_account_number_before_insert on public.drivers;
create trigger set_driver_account_number_before_insert
  before insert on public.drivers
  for each row execute function public.assign_driver_account_number();
