-- Grades for the nightly Truck Check (GHL form, photos). One row per graded
-- submission (ghl_form_submissions.id). graded_by is 'claude' for an
-- automatic grade or the name of the owner/manager who set or overrode it.
-- Feeds the Truck part of the Equipment & Truck section of the Tech Score
-- (techScores.js). Display only -- not tied to pay.
--
-- Read and written only by netlify/functions/audit-scores.js with the
-- service key, like the ghl_* tables and tote_waivers: RLS on, no policies.
create table if not exists truck_check_grades (
  submission_id text primary key,
  score numeric not null check (score >= 0 and score <= 100),
  notes text,
  graded_by text,
  graded_at timestamptz not null default now(),
  checklist jsonb
);
alter table truck_check_grades enable row level security;
