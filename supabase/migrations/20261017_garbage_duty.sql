-- Nightly garbage rotation (garbageRotation.js, netlify/functions/garbage-duty.mjs).
-- Ops only: no pay, bonus or score reads this, and nothing about it changes
-- time_entries. Additive only -- one new table and one new private bucket.

create table if not exists garbage_duty (
  id              uuid primary key default gen_random_uuid(),
  work_date       date not null unique,          -- one garbage night per day
  tech_id         uuid not null,                 -- techs.id (no FK, so Delete Tech keeps working)
  status          text not null default 'assigned'
                  check (status in ('assigned','done','excused','missed')),
  photo_path      text,                          -- object in the 'garbage-photos' bucket
  done_at         timestamptz,
  reassigned_from uuid,                          -- techs.id whose turn it was (backup / reassign)
  reason          text,                          -- why it moved / was excused / missed
  updated_by      text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists garbage_duty_tech_idx on garbage_duty (tech_id, work_date);

-- Closed to the browser (RLS on, no policies): reads and writes go through
-- garbage-duty.mjs with the service key, which checks the login token.
alter table garbage_duty enable row level security;

-- Private bucket for the bins photos (no public URL; no storage policies, so
-- only the service key can read or write; the app gets 1-hour signed links).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('garbage-photos', 'garbage-photos', false, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;

notify pgrst, 'reload schema';
