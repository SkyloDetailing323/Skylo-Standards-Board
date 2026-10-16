// Cleaning-company replacements for blocks of App.jsx in the MVP demo build
// (whole consts swapped by vite.config.js). Same ids/shape as the originals.
export const BLOCKS = {
  CALLBACK_AREAS: `const CALLBACK_AREAS = [
  { area:"Kitchen", items:[
    { id:"int_lvp",      label:"Counters & backsplash", hint:"crumbs, streaks, sticky spots" },
    { id:"int_vacuum",   label:"Appliance fronts", hint:"fingerprints on fridge, dishwasher, microwave" },
    { id:"int_windows",  label:"Sink & faucet", hint:"water spots, food left in drain" },
    { id:"int_mats",     label:"Floors", hint:"missed edges, under the table, streaks" },
    { id:"int_upsells",  label:"Kitchen add-ons", hint:"inside oven, inside fridge, cabinets" },
  ]},
  { area:"Bathrooms & Living", items:[
    { id:"ext_wheels",   label:"Toilets & tubs", hint:"rings, hair, soap scum" },
    { id:"ext_wash",     label:"Dusting", hint:"ceiling fans, blinds, shelves, frames" },
    { id:"ext_windows",  label:"Mirrors & glass", hint:"streaks, spots, shower glass" },
    { id:"ext_jambs",    label:"Baseboards & corners", hint:"" },
    { id:"ext_upsells",  label:"Other add-ons", hint:"inside windows, laundry, organizing" },
  ]},
];`,
  DAMAGE_AREAS: `const DAMAGE_AREAS = [
  { area:"Home", items:[
    { id:"veh_paint",    label:"Walls & paint", hint:"scuffs, chemical marks" },
    { id:"veh_interior", label:"Floors & carpet", hint:"bleach spots, scratches, water damage" },
    { id:"veh_glass",    label:"Glass, mirrors & fixtures", hint:"" },
    { id:"veh_trim",     label:"Counters & stone", hint:"etching from the wrong cleaner" },
    { id:"veh_wheels",   label:"Furniture", hint:"" },
    { id:"veh_electric", label:"Electronics & appliances", hint:"water in electronics, broken controls" },
  ]},
  { area:"Belongings", items:[
    { id:"prop_garage",  label:"Decor & breakables", hint:"knocked over, chipped, broken" },
    { id:"prop_home",    label:"Clothing & fabrics", hint:"bleach, stains" },
    { id:"prop_items",   label:"Personal items", hint:"moved, lost or thrown out" },
    { id:"prop_other",   label:"Other", hint:"" },
  ]},
];`,
  PHASE_LABELS: `const PHASE_LABELS = {
  night_before:"Getting Started", pre_job:"Pre-Job", arrival:"Arrival",
  sequencing:"Room Sequencing", cleaning:"Cleaning Sequence",
  mid_job:"Mid-Job Communication", interior_finish:"Kitchen & Baths",
  exterior:"Living Areas", closeout:"Client Walkthrough & Close",
  no_show:"Client Not Home Protocol", job_closeout:"Job Close-Out", end_of_day:"End of Day",
  misc_unit:"Car, Supplies & Cloths", misc_hcp:"Scheduling App", misc_customers:"Clients",
  misc_upsells:"Upsells & Add-Ons", misc_troubleshooting:"Troubleshooting Equipment",
  misc_rv_boats:"Deep & Move-Out Cleans",
};`,
  RUBRIC_ITEMS_SEED: `const RUBRIC_ITEMS_SEED = [
  { id:"item_01", sort_order:1, section:"daily", phase:"night_before", description:"Reminder text sent to tomorrow's clients", has_script:false, script_text:"" },
  { id:"item_03", sort_order:2, section:"daily", phase:"pre_job", description:"Supply caddy stocked: cloths, sprays, vacuum bags", has_script:false, script_text:"" },
  { id:"item_10", sort_order:3, section:"daily", phase:"pre_job", description:"On My Way text sent", has_script:false, script_text:"" },
  { id:"item_21", sort_order:4, section:"daily", phase:"interior_finish", description:"Kitchen: counters, sink, appliance fronts", has_script:false, script_text:"" },
  { id:"item_22", sort_order:5, section:"daily", phase:"interior_finish", description:"Bathrooms: toilet, tub, glass, mirrors", has_script:false, script_text:"" },
  { id:"item_23", sort_order:6, section:"daily", phase:"exterior", description:"Dust top to bottom, then floors", has_script:false, script_text:"" },
  { id:"item_24", sort_order:7, section:"daily", phase:"closeout", description:"Walkthrough with the client, before & after photos", has_script:false, script_text:"" },
  { id:"misc_27", sort_order:127, section:"misc", phase:"misc_rv_boats", description:"Deep clean checklist", has_script:true, script_text:"Deep cleans add baseboards, door frames, light switches, blinds and inside the microwave. Plan 1.5x the standard time." },
  { id:"misc_28", sort_order:128, section:"misc", phase:"misc_rv_boats", description:"Move-out: inside cabinets & drawers", has_script:true, script_text:"Empty homes show everything. Wipe inside every cabinet and drawer, top shelf first." },
  { id:"misc_29", sort_order:129, section:"misc", phase:"misc_rv_boats", description:"Move-out: inside oven & fridge", has_script:true, script_text:"Pull the racks, degrease, and leave the fridge door cracked open." },
  { id:"misc_30", sort_order:130, section:"misc", phase:"misc_rv_boats", description:"Move-out: walls & scuff marks", has_script:true, script_text:"Spot-clean scuffs with a magic eraser. Test a hidden spot first on flat paint." },
];`,
};

// Exact phrases swapped everywhere (longest first where they overlap).
export const TEXT = [
  ["Skylo Standard Board", "MVP Command Center"], ["The Standard Board", "MVP Command Center"], ["Skylo Cash", "MVP Cash"],
  ["Skylo Detailing", "MVP Cleaning"], ["with Skylo", "with MVP"], ["Skylo rewards program", "MVP rewards program"],
  ["searched Skylo by name", "searched MVP by name"], ["Skylo (or Squeegee Boys)", "MVP Cleaning"],
  ["Trevor", "Ryan"], ["Ethan", "Cole"], ["sold by trevor", "sold by ryan"],
  ["Squeegee Boys", "MVP Cleaning"], ["Skylo", "MVP"], ["skylod.com", "mvpcleaning.co"],
  ["Senior Detail Pros can be scheduled on RV and boat jobs. Detail Pros are residential vehicles only.", "Senior Cleaning Pros can be scheduled on deep cleans and move-outs. Cleaning Pros run standard and recurring cleans."],
  ["Detail Pro", "Cleaning Pro"], ["Detail Apprentice", "Cleaning Apprentice"], ["The Perfect Detail", "The Perfect Clean"],
  ["Mobile Car Detailing", "House Cleaning"], ["car detailing near me", "house cleaning near me"],
  ["Car Parts Fund", "Home Upgrade Fund"], ["$600 toward wheels, tires, suspension, or your build", "$600 toward furniture, decor, or anything for your place"],
  ["Performance Car Build", "Shopping Spree"], ["$1,200 no-questions-asked contribution to your car build", "$1,200 shopping spree, your pick of stores"],
  ["RVs & Boats Guide", "Deep & Move-Out Guide"], ["RV & Boat Cert", "Deep Clean Cert"], ["RV & Boat Techs", "Deep Clean Pros"], ["RVs & Boats", "Deep & Move-Out Cleans"],
  ["🚤 Boats", "📦 Move-Outs"], ["🚐 RVs", "🧽 Deep Cleans"],
  ["Pick Interior only or Interior + Exterior", "Pick Standard or Standard + add-ons"], ["\"Interior + Exterior\"", "\"Standard + add-ons\""], ["\"Interior only\"", "\"Standard\""],
  ["\"Interior Finish\"", "\"Kitchen & Baths\""], ["\"Exterior Finish\"", "\"Living Areas\""], ["Detail Tech", "Cleaning Tech"],
];
