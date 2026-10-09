-- Who gets sales credit (owner, Oct 2026). HCP doesn't record who created a
-- job anywhere we can read (confirmed with HCP support), so credit comes from
-- the "sold by <name>" job tag, checked against evidence:
--   sales_credit_review_rows(p_from): completed, non-commercial first visits
--   since p_from that either carry a "sold by" tag or are a new customer's
--   first job with no "sold by" tag, the last GHL team member on a call or text
--   with the customer before booking, and whether it came in as a lead.
--   sales_credit_overrides: an owner's call on a job ("trevor", "ethan" or
--   "none") that wins over the tag. Read/written only through
--   netlify/functions/reports.js (owners).

create table if not exists public.sales_credit_overrides (
  hcp_job_id  text primary key,
  rep         text not null,          -- 'trevor' | 'ethan' | 'none'
  set_by      text,
  set_at      timestamptz not null default now()
);
alter table public.sales_credit_overrides enable row level security;

create or replace function public.sales_credit_review_rows(p_from timestamptz)
returns table(hcp_job_id text, hcp_customer_id text, customer text, completed_at timestamptz, job_created_at timestamptz,
              price numeric, tags jsonb, sold_by text, is_new boolean, ghl_rep text, is_lead boolean)
-- security invoker: the tables it reads have RLS with no policies, so only
-- the service key (reports.js) gets rows back.
language sql stable security invoker set search_path = public as $$
  with j as (
    select h.*, (select lower(substring(t from '(?i)^\s*sold by\s+(.+?)\s*$')) from jsonb_array_elements_text(coalesce(h.raw->'tags','[]')) t
                 where t ~* '^\s*sold by\s+' limit 1) sold_by
    from hcp_sales_jobs h
    where h.completed_at >= p_from and coalesce(h.work_status,'') !~* 'cancel'
      and coalesce(h.raw->>'tags','') !~* 'commercial')
  select j.hcp_job_id, j.hcp_customer_id, trim(coalesce(j.first_name,'')||' '||coalesce(j.last_name,'')),
         j.completed_at, j.job_created_at,
         coalesce((select sum(x.revenue) from jobs x where x.hcp_job_id = j.hcp_job_id), greatest(j.total_cents - j.tip_cents, 0) / 100.0),
         coalesce(j.raw->'tags','[]'::jsonb), j.sold_by,
         not exists (select 1 from hcp_sales_jobs p where p.hcp_customer_id = j.hcp_customer_id and p.completed_at < j.completed_at - interval '12 hours' and coalesce(p.work_status,'') !~* 'cancel'),
         (select u.name from lead_job_matches l join ghl_messages m on m.contact_id = l.contact_id join ghl_users u on u.id = m.user_id
           where l.hcp_job_id = j.hcp_job_id and coalesce(m.message_type,'') !~* 'activity' and m.date_added <= j.job_created_at + interval '10 minutes'
           order by m.date_added desc limit 1),
         -- came in as a lead, not a plan visit made by GHL's Pipeline Automation
         exists (select 1 from lead_job_matches l join ghl_opportunities o on o.contact_id = l.contact_id join ghl_pipelines pp on pp.id = o.pipeline_id
                  where l.hcp_job_id = j.hcp_job_id and pp.name in ('Residential Leads','Residential Estimates'))
  from j
  where j.sold_by is not null
     or not exists (select 1 from hcp_sales_jobs p where p.hcp_customer_id = j.hcp_customer_id and p.completed_at < j.completed_at - interval '12 hours' and coalesce(p.work_status,'') !~* 'cancel');
$$;
