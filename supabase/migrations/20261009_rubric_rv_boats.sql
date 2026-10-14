-- Miscellaneous rubric: new "RVs & Boats" group (misc_27 to misc_31), after
-- Equipment Troubleshooting. Each item has a "How to" procedure. Reference
-- only: they don't count toward finishing training (MISC_OPTIONAL_PHASES in
-- App.jsx). Matches RUBRIC_ITEMS_SEED in App.jsx. Adds rows only; nothing
-- existing changes. Safe to re-run.
insert into rubric_items (id, sort_order, section, phase, description, has_script, script_text) values
  ('misc_27', 127, 'misc', 'misc_rv_boats', 'RV pre-job checklist & bucket', true, 'RVs and boats use different chemicals and a different bucket. When prepping for an RV, grab the RV/boat bucket, and grab the ladder at the unit to reach the tall areas of the RV.

Bring:
• Ladder
• RV/boat bucket: Bead Up spray sealant, hard water remover, magic eraser, exterior soap, wash wand
• Your regular everyday count of towels, equipment, and tote'),
  ('misc_28', 128, 'misc', 'misc_rv_boats', 'RV exterior cleaning', true, 'Cleaning an RV is very similar to cleaning a car. The only difference is that we do not do interior cleanings on RVs.

1. Clean the tires with tire cleaner, a tire brush, and a wheel barrel brush, then rinse.
2. Rinse down the RV from top to bottom.
3. Foam cannon and bucket wash the RV from top to bottom. Rinse throughout the bucket wash if the sun is drying the exterior soap too quickly.
4. Rinse off completely from top to bottom.
5. Dry from top to bottom with an exterior rag.
6. Apply the Bead Up sealant: spray it onto one side of your rag (your "wet side") and remove it with the dry side. Work in small sections or panels so you can keep track of what you''ve done. It''s safe on decals.
7. Go through the exterior checklist. Make sure there are no streaks on the windows or the paint after the sealant was applied.'),
  ('misc_29', 129, 'misc', 'misc_rv_boats', 'Boat pre-job checklist & bucket', true, 'Bring your regular everyday count of towels, equipment, and tote, plus the boat bucket:
• Hard water remover (light blue)
• Boat milk (white)
• Deck cleaner (dark blue)
• Magic eraser
• Exterior soap
• Wash wand'),
  ('misc_30', 130, 'misc', 'misc_rv_boats', 'Boat exterior cleaning', true, 'Cleaning a boat is pretty different from cleaning a car or an RV. These jobs are nice because they''re high revenue, you''re in one spot all day, and boat owners usually tip well!

1. Make sure all personal items are removed.
2. Start with a regular exterior detail: rinse with water, foam cannon and bucket wash, then rinse again. This gets the surface clean and ready for hard water spot removal.
3. Remove all hard water spots. This is the most important and longest step. Use the hard water spot remover and a magic eraser in small sections, in a cross-hatch pattern, and go over every part of the boat. Rinse the hard water remover off frequently, or the sun will bake it into the paint.
4. Do another foam cannon and bucket wash.
5. Hand wax the exterior. Split the boat into 4 sections. Apply and remove the wax on one section, then move to the next, until the whole boat is waxed.
6. Walk around the boat and complete the checklist. Make sure there are no hard water spots, wax streaks, or missed areas.'),
  ('misc_31', 131, 'misc', 'misc_rv_boats', 'Boat interior cleaning', true, '1. If the client hasn''t already, remove all items from the interior. Don''t miss any cubbies. Remove all cushions and put them somewhere safe where they won''t get damaged.
2. Bring everything you''ll need onto the boat at once: your tote and supplies, boat milk (white), deck cleaner (dark blue), vacuum, all purpose, etc. This saves a lot of trips back and forth to the truck.
3. Air compress the boat if needed and if you prefer. Not every tech does, but it helps break up dirt and crumbs in cubbies, cracks, and crevices.
4. Clean any towers or props higher up first, so crumbs, bugs, dirt, and chemicals don''t fall into the boat after you''ve vacuumed and wiped down.
5. Vacuum the entire boat, starting at one end and finishing at the other. Always work in a set order (top to bottom, front to back) so you don''t miss any sections. LVP or all purpose can help break up debris and tough stains before vacuuming.
6. LVP wipe-down of every hard surface: cubbies, cockpit, side walls, seats and cushions, leather, vinyl, plastic, etc. If the LVP leaves streaks, clear them with glass cleaner.
7. Extract the floor padding. Fill the extractor and heat the water, pre-wet the pad, apply deck cleaner, scrub and foam it up with the flat-head drill brush, then extract with the vacuum head while pulling the steam trigger.
8. Clean the windows. No streaks or hard water marks left on the glass.
9. Finish with any touch-ups: vacuum, LVP, extraction, etc.
10. Go through the interior boat checklist and check every cubby and area so the customer is 100% satisfied.')
on conflict (id) do nothing;
