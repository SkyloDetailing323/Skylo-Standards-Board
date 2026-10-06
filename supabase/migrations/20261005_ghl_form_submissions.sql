-- GoHighLevel form submissions (Tote Checks + Tech Audits), mirrored by
-- netlify/functions/ghl-forms-sync.mjs and scored in the app's Audit Scores
-- tab (auditScoring.js). Display only -- not tied to pay.
--
-- New table only; nothing existing is changed. Like the other ghl_* tables,
-- row level security is on with no policies, so the browser can't read it:
-- the app reads it through netlify/functions/audit-scores.js, which checks
-- the login token (owners/manager see everyone, a tech sees only their own).

create table if not exists public.ghl_form_submissions (
  id            text primary key,          -- GHL submission id
  form_id       text not null,
  contact_id    text,
  submitted_at  timestamptz,
  work_date     date,                      -- Mountain-time day the check/audit is for
  tech_name     text,                      -- the form's "Tech" / "Detail Tech" answer
  tech_id       uuid,                      -- techs.id when tech_name matches exactly, else null
  answers       jsonb not null default '{}'::jsonb,  -- question label -> answer
  raw           jsonb,                     -- the submission exactly as GHL returned it
  synced_at     timestamptz not null default now()
);

create index if not exists ghl_form_submissions_form_date_idx on public.ghl_form_submissions (form_id, work_date);
create index if not exists ghl_form_submissions_tech_idx on public.ghl_form_submissions (tech_id, work_date);

alter table public.ghl_form_submissions enable row level security;
revoke all on public.ghl_form_submissions from anon, authenticated;
