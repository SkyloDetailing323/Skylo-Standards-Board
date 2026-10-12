-- Technician Bookings: jobs a tech booked themselves, tracked separately from
-- who serviced them. Approved by Truxton (Oct 2026).
--
-- The hourly scan (tech-bookings-scan) adds a row here when an HCP job has a
-- "Technician Booking - ..." line item. An admin then picks which tech booked
-- it (booker_id, status 'confirmed') -- same idea as confirming split jobs.
-- An admin can also add one by HCP job number. Nothing pays until confirmed.
-- Pay is computed in the app from the jobs table once the job is serviced:
--   booker serviced it   -> +10% of their own revenue on that job
--   someone else did     -> booker gets 10% of the job's total revenue
-- 20 points per confirmed booking.
--   status: pending | confirmed | rejected (not a tech booking)
create table if not exists tech_bookings (
  id uuid primary key default gen_random_uuid(),
  hcp_job_id text not null unique,
  invoice_number text,
  customer_name text,
  scheduled_start timestamptz,
  booking_items text,
  booker_id uuid references techs(id),
  status text not null default 'pending',
  confirmed_by text,
  confirmed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists tech_bookings_booker_idx on tech_bookings (booker_id);
alter table tech_bookings enable row level security;
create policy "public access" on tech_bookings for all using (true) with check (true);
grant select, insert, update, delete on tech_bookings to anon, authenticated;

-- Which HCP jobs the scan has already checked for a "Technician Booking - "
-- line item: once when new ("<job id>:new") and once when completed
-- ("<job id>:done"). Server-only (service key), no policies.
create table if not exists tech_booking_item_checks (
  check_key text primary key,
  has_item boolean not null,
  items text,
  checked_at timestamptz not null default now()
);
alter table tech_booking_item_checks enable row level security;

notify pgrst, 'reload schema';
