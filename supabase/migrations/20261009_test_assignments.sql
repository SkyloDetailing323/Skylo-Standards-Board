-- Assigned tests (first use: the RVs & Boats test for Detail Pro -> Senior
-- Detail Pro). An owner/manager or the Field Supervisor sends the test to a
-- tech; the tech gets one try from their own login (100% to pass, no
-- retakes); the reviewer advances them to Senior Detail Pro or resends.
--   status: assigned | submitted (passed) | failed | approved | cancelled
-- Resending adds a new row, so every attempt stays on record.
-- test_id points at the training_tests row with their answers. A failed
-- one-try test is stored there as status 'abandoned' (the table's check
-- constraint only allows in_progress/passed/abandoned); this table records
-- that it was a fail.
-- Same access pattern as training_tests / checkins (read and written from the
-- app with the anon key).
create table if not exists test_assignments (
  id uuid primary key default gen_random_uuid(),
  tech_id uuid not null references techs(id),
  test_key text not null,
  status text not null default 'assigned',
  assigned_by text,
  assigned_at timestamptz not null default now(),
  test_id uuid references training_tests(id),
  score integer,
  total integer,
  submitted_at timestamptz,
  reviewed_by text,
  reviewed_at timestamptz,
  signature text
);
create index if not exists test_assignments_tech_idx on test_assignments (tech_id);
alter table test_assignments enable row level security;
create policy "public access" on test_assignments for all using (true) with check (true);
grant select, insert, update on test_assignments to anon, authenticated;

notify pgrst, 'reload schema';
