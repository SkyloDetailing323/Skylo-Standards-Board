-- Monthly labor cost from QuickBooks (owner, Oct 2026). One row per month,
-- written by the monthly QuickBooks pull; read by the app through
-- netlify/functions/labor-actuals.js (owners only).
--   labor     = Wages - COGS + Payroll Taxes - COGS + Training Pay - tips
--   revenue   = QuickBooks income - tips
-- Tips run through payroll and income in QuickBooks but aren't Skylo's
-- money, so they come out of both sides (tips = app tip_entries that month).
create table if not exists public.labor_actuals (
  month               text primary key,          -- 'YYYY-MM'
  income              numeric not null,          -- QuickBooks total income
  wages_cogs          numeric not null,          -- Wages - COGS
  payroll_taxes_cogs  numeric not null,          -- Payroll Taxes - COGS
  training_pay        numeric not null default 0,-- Training Pay (Payroll expenses)
  tips                numeric,                   -- null = app works it out from tip_entries by pay date
  pulled_at           timestamptz not null default now()
);
alter table public.labor_actuals enable row level security;
