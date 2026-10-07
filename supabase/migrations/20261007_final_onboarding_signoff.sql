-- Final Onboarding Cert sign-off (Development tab).
-- Three checkboxes + a typed signature; signing promotes a Detail Apprentice
-- to Detail Pro and starts their check-in clock on onboarding_complete_date.
-- NOTE: already applied to the live database on 2026-10-03. Safe to re-run.
alter table techs
  add column if not exists perfect_day_rubric_complete boolean default false,
  add column if not exists misc_rubric_complete boolean default false,
  add column if not exists onboarding_complete boolean default false,
  add column if not exists onboarding_signed_by text,
  add column if not exists onboarding_complete_date date;

grant select, insert, update (perfect_day_rubric_complete, misc_rubric_complete,
  onboarding_complete, onboarding_signed_by, onboarding_complete_date)
  on techs to anon, authenticated;

notify pgrst, 'reload schema';
