-- Perfect Day rubric: new Pre-Job item #7, right after "Truck stocked with
-- proper towel count". Every daily item from the old #7 on moves down one
-- number (old #7 becomes #8, ... old #58 becomes #59). Item ids don't change,
-- so past certs, ride-alongs, and test coverage still line up.
-- Matches RUBRIC_ITEMS_SEED in App.jsx. Safe to run once; re-running would
-- shift numbers again, so it checks for item_59 first.
do $$
begin
  if not exists (select 1 from rubric_items where id = 'item_59') then
    update rubric_items
       set sort_order = sort_order + 1
     where coalesce(section, 'daily') = 'daily'
       and sort_order >= 7;
    insert into rubric_items (id, sort_order, section, phase, description, has_script, script_text)
    values ('item_59', 7, 'daily', 'pre_job',
            'Truck stocked with 3 door hangers per job, as well as a customer satisfaction card per job',
            false, '');
  end if;
end $$;
