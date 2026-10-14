alter table public.order_offers
  drop constraint if exists order_offers_status_check;

alter table public.order_offers
  add constraint order_offers_status_check
  check (status in ('pending','accepted','declined','withdrawn','skipped'));

comment on column public.order_offers.status is 'Offer lifecycle: pending, accepted, declined by passenger, withdrawn, or skipped by a driver.';
