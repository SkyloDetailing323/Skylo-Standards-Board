-- Check-in schedule changes from weeks 1, 2, 4, 6, 12 to weeks 1, 2, 4, 8, 12.
-- New techs get week_8 from the app code. This moves every week_6 check-in
-- that hasn't been completed to week_8, two weeks later (base date + 56 days
-- instead of + 42). Completed week_6 check-ins are kept as history.
-- As of 2026-10-07 this affects 16 scheduled rows; none were completed.
update checkins
   set milestone = 'week_8',
       scheduled_date = scheduled_date + 14
 where milestone = 'week_6'
   and status is distinct from 'completed';
