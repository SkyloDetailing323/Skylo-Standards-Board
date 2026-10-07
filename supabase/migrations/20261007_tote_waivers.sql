-- Tote Check items an owner waived from the Payroll deduction (e.g. the tech
-- never received it). Read and written only by netlify/functions/audit-scores.js
-- with the service key, so RLS is on with no policies.
create table if not exists tote_waivers (
  submission_id text not null,
  item text not null,
  waived_by text,
  created_at timestamptz not null default now(),
  primary key (submission_id, item)
);
alter table tote_waivers enable row level security;
