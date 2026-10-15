-- Trevor's bonus: the plan price a sale was scored at (owner, Oct 15 2026).
-- When a sale's first visit is serviced, save the price of the next visit
-- booked with it. A later visit that comes in more than $50 under that is a
-- downsize, clawed back in the month it happened (salesPoints.js). Without
-- this, editing the next visit's price before it happens would quietly
-- re-score a month that's already been paid.
--   capture_sales_plan_snapshots(): saves any completed first visit with a
--   "sold by" tag (or an owner's credit) that isn't saved yet. Called by
--   hcp-sales-sync-background after every sync. Returns how many it saved.
-- Additive only: a new table and function.

create table if not exists public.sales_plan_snapshots (
  hcp_job_id   text primary key,
  plan_price   numeric,              -- next booked visit's price (no tips); null = nothing booked after it
  first_price  numeric not null,     -- the first visit's price (no tips)
  captured_at  timestamptz not null default now()
);
alter table public.sales_plan_snapshots enable row level security;

create or replace function public.capture_sales_plan_snapshots()
returns integer
-- security invoker: the tables have RLS with no policies, so only the
-- service key (netlify functions) can read or write them.
language sql volatile security invoker set search_path = public as $$
  with s as (
    select h.* from hcp_sales_jobs h
    where h.completed_at > now() - interval '200 days' and coalesce(h.work_status,'') !~* 'cancel'
      and (coalesce(h.raw->>'tags','') ~* 'sold by' or exists (select 1 from sales_credit_overrides o where o.hcp_job_id = h.hcp_job_id))
      and not exists (select 1 from sales_plan_snapshots p where p.hcp_job_id = h.hcp_job_id)),
  ins as (
    insert into sales_plan_snapshots (hcp_job_id, plan_price, first_price)
    select s.hcp_job_id,
      -- Same "visits booked with this sale" rule as salesPoints.js.
      (select greatest(n.total_cents - n.tip_cents, 0) / 100.0 from hcp_sales_jobs n
        where n.hcp_customer_id = s.hcp_customer_id and n.hcp_job_id <> s.hcp_job_id and coalesce(n.work_status,'') !~* 'cancel'
          and n.scheduled_start > coalesce(s.scheduled_start, s.completed_at) + interval '1 day'
          and n.scheduled_start <= coalesce(s.scheduled_start, s.completed_at) + interval '183 days'
          and (n.job_created_at is null or s.job_created_at is null or abs(extract(epoch from n.job_created_at - s.job_created_at)) <= 86400)
        order by n.scheduled_start limit 1),
      greatest(s.total_cents - s.tip_cents, 0) / 100.0
    from s
    on conflict (hcp_job_id) do nothing
    returning 1)
  select count(*)::int from ins;
$$;

-- Save the sales that are already done (their schedules as they are today).
select public.capture_sales_plan_snapshots();
