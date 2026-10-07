-- Switchover pay moved onto the semi-monthly Payroll tab. Pay depends on the
-- plan plus +$10 when an exterior was added, and the pay period depends on
-- the exact day it was sold (week_key alone can straddle two pay periods).
-- Additive only: old rows keep with_exterior=false and sold_date null (the app
-- falls back to the day the row was logged).
alter table switchovers add column if not exists with_exterior boolean not null default false;
alter table switchovers add column if not exists sold_date date;
