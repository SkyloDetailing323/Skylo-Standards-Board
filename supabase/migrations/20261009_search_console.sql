-- Google Search Console (organic search on skylod.com), mirrored daily by
-- netlify/functions/gsc-sync.js and shown on the Marketing tab's "Google
-- Search" page. Display only -- not tied to pay.
--
-- New tables only; nothing existing is changed. Row level security is on
-- with no policies (like the ga4_* tables), so the browser can't read them:
-- the app reads them through netlify/functions/reports.js, owners only.

-- Site totals per day (includes searches Google keeps private, so these are
-- higher than the sum of gsc_queries_daily).
create table if not exists public.gsc_daily (
  day          date primary key,
  clicks       integer not null default 0,
  impressions  integer not null default 0,
  position     numeric,                    -- average position (1 = top)
  synced_at    timestamptz not null default now()
);

-- What people searched, per day.
create table if not exists public.gsc_queries_daily (
  day          date not null,
  query        text not null,
  clicks       integer not null default 0,
  impressions  integer not null default 0,
  position     numeric,
  synced_at    timestamptz not null default now(),
  primary key (day, query)
);

-- Which pages showed up, per day.
create table if not exists public.gsc_pages_daily (
  day          date not null,
  page         text not null,
  clicks       integer not null default 0,
  impressions  integer not null default 0,
  position     numeric,
  synced_at    timestamptz not null default now(),
  primary key (day, page)
);

-- Latest Google indexing check for the site's top pages (URL Inspection).
create table if not exists public.gsc_page_status (
  page             text primary key,
  verdict          text,                   -- PASS / NEUTRAL / FAIL
  coverage         text,                   -- e.g. "Submitted and indexed"
  last_crawl_at    timestamptz,
  checked_at       timestamptz not null default now()
);

create index if not exists gsc_queries_daily_day_idx on public.gsc_queries_daily (day);
create index if not exists gsc_pages_daily_day_idx on public.gsc_pages_daily (day);

alter table public.gsc_daily enable row level security;
alter table public.gsc_queries_daily enable row level security;
alter table public.gsc_pages_daily enable row level security;
alter table public.gsc_page_status enable row level security;
revoke all on public.gsc_daily, public.gsc_queries_daily, public.gsc_pages_daily, public.gsc_page_status from anon, authenticated;
