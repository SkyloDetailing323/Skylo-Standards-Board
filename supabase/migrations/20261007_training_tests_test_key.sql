-- Written tests are split into two: Perfect Day and Miscellaneous.
-- test_key records which one a row is ('perfect_day' or 'misc').
-- Existing rows stay null = the old combined test, which counts for both.
-- NOT applied yet: must be applied before this PR is merged, or starting a
-- test will fail.
alter table training_tests add column if not exists test_key text;

notify pgrst, 'reload schema';
