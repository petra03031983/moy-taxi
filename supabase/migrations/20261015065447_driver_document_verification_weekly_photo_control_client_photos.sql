-- Reconstructed from the live Мой Такси schema for reproducible setup.
-- Adds driver document review and periodic photo control fields.

alter table public.drivers
  add column if not exists documents_verified boolean not null default false,
  add column if not exists verification_status text not null default 'pending',
  add column if not exists verification_note text,
  add column if not exists legal_consent_at timestamptz,
  add column if not exists legal_consent_version text,
  add column if not exists last_photo_control_at timestamptz,
  add column if not exists next_photo_control_at timestamptz,
  add column if not exists photo_control_status text not null default 'pending',
  add column if not exists photo_control_submitted_at timestamptz;

alter table public.drivers drop constraint if exists drivers_verification_status_check;
alter table public.drivers add constraint drivers_verification_status_check
  check (verification_status in ('pending', 'approved', 'rejected'));

alter table public.drivers drop constraint if exists drivers_photo_control_status_check;
alter table public.drivers add constraint drivers_photo_control_status_check
  check (photo_control_status in ('pending', 'approved', 'rejected'));

create index if not exists drivers_verification_status_idx
  on public.drivers(verification_status, created_at desc);
create index if not exists drivers_photo_control_due_idx
  on public.drivers(next_photo_control_at, photo_control_status);

create table if not exists public.driver_verification_files (
  driver_id uuid primary key references public.drivers(id) on delete cascade,
  document_photos jsonb not null default '{}'::jsonb,
  car_photos jsonb not null default '{}'::jsonb,
  weekly_selfie_photo text,
  agreement_version text not null default '2026-10-v1',
  submitted_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  reviewed_at timestamptz
);

alter table public.driver_verification_files enable row level security;
drop policy if exists driver_verification_files_service_role_all on public.driver_verification_files;
create policy driver_verification_files_service_role_all
  on public.driver_verification_files for all to service_role
  using (true) with check (true);
grant all privileges on table public.driver_verification_files to service_role;
