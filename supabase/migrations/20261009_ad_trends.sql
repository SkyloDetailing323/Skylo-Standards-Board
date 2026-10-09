-- Meta ad health on the Marketing tab (owner, Oct 2026).
--   meta_ads: each ad's start date (created_time), status and how many times
--     the average person saw it in the last 28 days (frequency_28d) -- written
--     by netlify/functions/meta-ads-sync.js. RLS on, no policies.
--   ad_trends(p_since): every Meta ad week by week (Monday weeks): spend,
--     views, link clicks, Meta-counted leads, plus the leads that reached GHL
--     (by utmAdId), how many booked, and their upfront / committed revenue
--     (credited_jobs, same rules as the Marketing report). Security invoker:
--     only the service key (reports.js ?type=ad_trends) gets rows back.
-- adTrends.js grades and trends it in the browser.

create table if not exists public.meta_ads (
  ad_id          text primary key,
  ad_name        text,
  campaign_id    text,
  created_time   timestamptz,
  status         text,
  reach_28d      bigint,
  frequency_28d  numeric,
  synced_at      timestamptz not null default now()
);
alter table public.meta_ads enable row level security;

-- ad_trends(p_since date): see the live definition (applied via the
-- Supabase MCP on Oct 9 2026); it mirrors marketing_report_core's lead and
-- revenue rules, grouped by utmAdId and Monday week.
