-- Ford Pro driver scorecard: company vehicles, which truck each tech picked
-- at clock-in, and the Ford telematics data the nightly pull will store.
-- Display only -- nothing here feeds pay or bonuses.
--
-- New tables only; nothing existing is changed.
--   vehicles, truck_assignments, truck_assignment_log
--     Read/written by the app like time_entries (row level security on, with
--     the same open policy), so the Time Sheet can save a pick at clock-in.
--   ford_vehicle_daily, ford_vehicle_events, unassigned_driving
--     Telematics data (trips can include locations). RLS on with no policies,
--     like the ghl_* tables: only server functions (service key) read them;
--     the app goes through netlify/functions/driver-scores.js, which checks
--     the login (owners/manager see everyone, a tech sees only their own).

-- ─── vehicles ────────────────────────────────────────────────────────────────
create table if not exists public.vehicles (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,          -- "Mav 1", "Bertha"
  model       text,
  plate       text,
  vin         text not null unique,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);
alter table public.vehicles enable row level security;
drop policy if exists "allow anon full access" on public.vehicles;
create policy "allow anon full access" on public.vehicles for all using (true) with check (true);
grant select, insert, update on public.vehicles to anon, authenticated;

-- Company trucks (owner vehicles -- Casey's Tacoma, Truxton's Raptor -- are
-- deliberately left out).
insert into public.vehicles (name, model, plate, vin, active) values
  ('Bertha', 'Ford F-550 XLT',           'Temp Tag',  '1FDFF5HT7SDA14974', true),
  ('Van 2',  'Ford Transit Connect XLT', 'OBHF5',     'NM0LS7F79G1255493', true),
  ('Van 3',  'Ford Transit Connect XLT', '5AJ895',    'NM0LS7E7XH1326378', true),
  ('Van 4',  'Ford Transit Connect XLT', '2EBZ7',     'NM0LS7E26M1489561', false),
  ('Van 5',  'Ford Transit Connect XLT', '9EFX8',     'NM0LS7E7XJ1365512', true),
  ('Mav 1',  'Ford Maverick XLT',        '3GEP3',     '3FTTW8A36SRA19318', true),
  ('Mav 2',  'Ford Maverick XLT',        '3GEP2',     '3FTTW8B39SRA65188', true),
  ('Mav 3',  'Ford Maverick XLT',        '4BB046',    '3FTTW8J34SRA88072', true),
  ('Mav 4',  'Ford Maverick XLT',        '(pending)', '3FTTW8J31SRA87932', true),
  ('Mav 5',  'Ford Maverick XLT',        '0AZ450',    '3FTTW8J31SRB14062', true),
  ('Mav 6',  'Ford Maverick XLT',        '8BB429',    '3FTTW8J31SRA87428', true),
  ('Mav 7',  'Ford Maverick XLT',        'Temp Tag',  '3FTTW8B31TRA02250', true),
  ('Mav 8',  'Ford Maverick XLT',        'Temp Tag',  '3FTTW8B35TRA02381', true),
  ('Mav 9',  'Ford Maverick XLT',        'Temp Tag',  '3FTTW8B35TRA02249', true)
on conflict (vin) do nothing;

-- ─── truck picks ─────────────────────────────────────────────────────────────
-- One row per tech per day: the truck they picked at clock-in. A same-day
-- correction overwrites it (the last pick wins). One tech per truck per day:
-- a truck someone already picked that day can't be picked again (unique
-- index below); an admin removes or reassigns a pick on the Trucks tab.
-- `shared` is no longer set by the app (kept so scoring tolerates old rows).
create table if not exists public.truck_assignments (
  id          uuid primary key default gen_random_uuid(),
  tech_id     uuid not null,
  vehicle_id  uuid not null references public.vehicles(id),
  work_date   date not null,                 -- Mountain-time day
  shared      boolean not null default false, -- legacy: two techs on one truck (no longer created)
  picked_at   timestamptz not null default now(),
  unique (tech_id, work_date)
);
create index if not exists truck_assignments_day_idx on public.truck_assignments (work_date, vehicle_id);
-- One tech per truck per day. The app shows "Someone just took that truck"
-- when two techs pick the same truck at the same moment and this rejects one.
create unique index if not exists truck_assignments_one_tech_per_truck on public.truck_assignments (vehicle_id, work_date);
alter table public.truck_assignments enable row level security;
drop policy if exists "allow anon full access" on public.truck_assignments;
create policy "allow anon full access" on public.truck_assignments for all using (true) with check (true);
grant select, insert, update, delete on public.truck_assignments to anon, authenticated;

-- Every pick and correction, kept for disputes ("I picked Mav 3, not Mav 5").
create table if not exists public.truck_assignment_log (
  id          uuid primary key default gen_random_uuid(),
  tech_id     uuid not null,
  vehicle_id  uuid references public.vehicles(id),
  work_date   date not null,
  action      text not null,                 -- 'pick' | 'change' | 'admin_assign' | 'admin_remove' ('shared' on legacy rows)
  note        text,
  at          timestamptz not null default now()
);
create index if not exists truck_assignment_log_day_idx on public.truck_assignment_log (work_date);
alter table public.truck_assignment_log enable row level security;
drop policy if exists "allow anon insert and read" on public.truck_assignment_log;
create policy "allow anon insert and read" on public.truck_assignment_log for all using (true) with check (true);
grant select, insert on public.truck_assignment_log to anon, authenticated;

-- ─── Ford telematics (server only) ───────────────────────────────────────────
-- Miles, idle time and speeding minutes per vehicle per Mountain-time day
-- (from Ford's daily Fleet Activity Summary). No locations are stored.
create table if not exists public.ford_vehicle_daily (
  vin           text not null,
  work_date     date not null,
  miles         numeric not null default 0,
  trips         integer,
  idle_minutes  numeric,
  speeding_minutes numeric,                -- minutes over the posted limit (+5 mph buffer) that day
  source        text,                      -- 'report_upload' | 'api'
  raw           jsonb,
  synced_at     timestamptz not null default now(),
  primary key (vin, work_date)
);
alter table public.ford_vehicle_daily enable row level security;
revoke all on public.ford_vehicle_daily from anon, authenticated;

-- One row per Ford driving event (harsh brake, speeding, ...). id is built
-- from vin + time + type, so importing the same day again upserts instead of
-- duplicating. Ford's latitude/longitude/address columns are not stored.
create table if not exists public.ford_vehicle_events (
  id            text primary key,
  vin           text not null,
  event_time    timestamptz not null,
  work_date     date not null,               -- Mountain-time day of event_time
  event_type    text not null,               -- Ford's type, mapped in driverScoring.js
  mph_over      numeric,                     -- speeding: mph over the posted limit
  speed_mph     numeric,
  limit_mph     numeric,
  duration_sec  numeric,                     -- idling / speeding duration
  odometer      numeric,
  raw           jsonb,
  synced_at     timestamptz not null default now()
);
create index if not exists ford_vehicle_events_day_idx on public.ford_vehicle_events (vin, work_date);
alter table public.ford_vehicle_events enable row level security;
revoke all on public.ford_vehicle_events from anon, authenticated;

-- A vehicle drove on a day nobody picked it. Never counts against anyone
-- until an owner/manager assigns it to a tech.
create table if not exists public.unassigned_driving (
  id               uuid primary key default gen_random_uuid(),
  vin              text not null,
  work_date        date not null,
  miles            numeric,
  assigned_tech_id uuid,
  assigned_by      text,
  assigned_at      timestamptz,
  dismissed        boolean not null default false,  -- e.g. a mechanic test drive
  created_at       timestamptz not null default now(),
  unique (vin, work_date)
);
alter table public.unassigned_driving enable row level security;
revoke all on public.unassigned_driving from anon, authenticated;
