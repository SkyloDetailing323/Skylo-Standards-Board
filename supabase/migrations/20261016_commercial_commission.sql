-- Ethan's commercial commission (owner, Oct 2026). He's paid a % of each
-- commercial visit once the client pays, so the app needs to know when a job
-- was paid -- HCP job rows (hcp_sales_jobs) don't say.
--
--   hcp_job_payments: one row per HCP job checked for payment, written by
--     netlify/functions/hcp-commission-payments-background.js (hourly) from
--     the job's HCP invoice. paid_at null = not paid yet.
--   commercial_accounts: an owner's call on a commercial customer -- lead
--     source (outbound / inbound, or 'none' = not Ethan's) and plan frequency
--     -- that wins over the HCP tags. Written by reports.js (owners only).
--
-- Both are read/written only with the service key from those Netlify
-- functions: RLS on, no policies.

create table if not exists public.hcp_job_payments (
  hcp_job_id       text primary key,
  hcp_customer_id  text,
  status           text,           -- invoice status from HCP, e.g. 'paid', 'open'
  amount_cents     integer,        -- invoice total
  due_cents        integer,        -- still owed
  paid_at          timestamptz,    -- when it was paid (HCP's date, or the first sync that saw it paid)
  raw              jsonb,          -- the invoice fields the sync read, for checking
  checked_at       timestamptz not null default now()
);
alter table public.hcp_job_payments enable row level security;
create index if not exists hcp_job_payments_customer on public.hcp_job_payments (hcp_customer_id);

create table if not exists public.commercial_accounts (
  hcp_customer_id  text primary key,
  source           text,           -- 'outbound' | 'inbound' | 'none'
  freq             text,           -- 'weekly'|'biweekly'|'monthly'|'bimonthly'|'quarterly'|'one_time' or null (use tags)
  set_by           text,
  set_at           timestamptz not null default now()
);
alter table public.commercial_accounts enable row level security;
