-- Damage reports: damage a tech caused to a client's vehicle or property.
-- Logged like callbacks (Trevor / admins, Callbacks page -> Damage tab) and
-- scored exactly like a callback of the same level:
--   Tech Score   Callbacks & Damage section: -25 / -50 / -100 by level,
--                over the same 4-week window (techScores.js)
--   Journey pts  -100 / -200 / -300 by level (calcTotals in App.jsx)
-- Split jobs: one row per tech with weight = their share, same group_id.
-- Same columns and access pattern as callbacks; missed_items -> damaged_items.
create table if not exists damage_reports (
  id uuid primary key default gen_random_uuid(),
  tech_id uuid references techs(id),
  weight numeric default 1,
  group_id uuid,
  job_date date,
  customer_name text,
  job_number text,
  hcp_job_id text,
  damaged_items text[] default '{}'::text[],
  severity smallint,
  repair_cost numeric,
  reason text default '',
  created_at timestamptz not null default now()
);
create index if not exists damage_reports_tech_idx on damage_reports (tech_id);
alter table damage_reports enable row level security;
create policy "public access" on damage_reports for all using (true) with check (true);
grant select, insert, update, delete on damage_reports to anon, authenticated;

notify pgrst, 'reload schema';
