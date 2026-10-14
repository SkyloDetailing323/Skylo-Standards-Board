-- Speeds up sales_credit_review_rows (Trevor's bonus "Needs a look" list).
-- Its "is this the customer's first job?" check looked up each job's
-- customer with a full scan of hcp_sales_jobs (~10k rows) per job, twice --
-- about 22 seconds, past the 8-second statement timeout, so the Sales tab
-- showed "canceling statement due to statement timeout". Also used by
-- reports.js when it loads every job for Trevor's customers.
-- Additive only: a new index, no data or table changes.
create index if not exists hcp_sales_jobs_customer_completed_idx
  on public.hcp_sales_jobs (hcp_customer_id, completed_at);
