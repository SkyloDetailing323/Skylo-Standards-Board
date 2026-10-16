// Floor-coating replacements for blocks of App.jsx in the Lifetime Coatings demo
// build (whole consts swapped by vite.config.js). Same ids/shape as the originals.
export const BLOCKS = {
  CALLBACK_AREAS: `const CALLBACK_AREAS = [
  { area:"Prep", items:[
    { id:"int_lvp",      label:"Grinding & profile", hint:"smooth spots, swirl marks, missed corners" },
    { id:"int_vacuum",   label:"Crack & spall repair", hint:"cracks telegraphing through, low spots" },
    { id:"int_windows",  label:"Moisture & cleaning", hint:"dust left before base coat, damp slab" },
    { id:"int_mats",     label:"Masking & protection", hint:"tape lines, drywall and door protection" },
    { id:"int_upsells",  label:"Stem walls & steps", hint:"uneven line, missed edges" },
  ]},
  { area:"Finish", items:[
    { id:"ext_wheels",   label:"Flake coverage", hint:"thin spots, uneven broadcast" },
    { id:"ext_wash",     label:"Topcoat", hint:"bubbles, pinholes, roller marks" },
    { id:"ext_windows",  label:"Texture & slip", hint:"too smooth or too rough" },
    { id:"ext_jambs",    label:"Edges & joints", hint:"control joints, garage door seal line" },
    { id:"ext_upsells",  label:"Cleanup & walkthrough", hint:"debris left, cure time not explained" },
  ]},
];`,
  DAMAGE_AREAS: `const DAMAGE_AREAS = [
  { area:"Home", items:[
    { id:"veh_paint",    label:"Walls & drywall", hint:"grinder scuffs, coating splatter" },
    { id:"veh_interior", label:"Garage door & seal", hint:"" },
    { id:"veh_glass",    label:"Driveway & concrete", hint:"stains, tire marks, spills" },
    { id:"veh_trim",     label:"Doors & trim", hint:"" },
    { id:"veh_wheels",   label:"Landscaping", hint:"" },
    { id:"veh_electric", label:"Electrical & outlets", hint:"" },
  ]},
  { area:"Belongings", items:[
    { id:"prop_garage",  label:"Stored items", hint:"moved, scratched or coated" },
    { id:"prop_home",    label:"Vehicles", hint:"overspray, dust, dings" },
    { id:"prop_items",   label:"Tools & equipment", hint:"" },
    { id:"prop_other",   label:"Other", hint:"" },
  ]},
];`,
  PHASE_LABELS: `const PHASE_LABELS = {
  night_before:"Getting Started", pre_job:"Pre-Job", arrival:"Arrival",
  sequencing:"Prep Sequence", cleaning:"Coating Sequence",
  mid_job:"Mid-Job Communication", interior_finish:"Prep",
  exterior:"Coating", closeout:"Client Walkthrough & Close",
  no_show:"Client Not Home Protocol", job_closeout:"Job Close-Out", end_of_day:"End of Day",
  misc_unit:"Truck, Trailer & Equipment", misc_hcp:"Scheduling App", misc_customers:"Clients",
  misc_upsells:"Upsells & Add-Ons", misc_troubleshooting:"Troubleshooting Equipment",
  misc_rv_boats:"Commercial & Metallic",
};`,
  RUBRIC_ITEMS_SEED: `const RUBRIC_ITEMS_SEED = [
  { id:"item_01", sort_order:1, section:"daily", phase:"night_before", description:"Confirmation text sent to tomorrow's client", has_script:false, script_text:"" },
  { id:"item_03", sort_order:2, section:"daily", phase:"pre_job", description:"Trailer loaded: grinders, vacs, flake, base and topcoat", has_script:false, script_text:"" },
  { id:"item_10", sort_order:3, section:"daily", phase:"pre_job", description:"On My Way text sent", has_script:false, script_text:"" },
  { id:"item_21", sort_order:4, section:"daily", phase:"interior_finish", description:"Moisture test and crack repair done", has_script:false, script_text:"" },
  { id:"item_22", sort_order:5, section:"daily", phase:"interior_finish", description:"Full grind and vacuum, no dust left", has_script:false, script_text:"" },
  { id:"item_23", sort_order:6, section:"daily", phase:"exterior", description:"Base coat, full flake broadcast, scrape and topcoat", has_script:false, script_text:"" },
  { id:"item_24", sort_order:7, section:"daily", phase:"closeout", description:"Walkthrough, cure time explained, review asked", has_script:false, script_text:"" },
  { id:"misc_27", sort_order:127, section:"misc", phase:"misc_rv_boats", description:"Commercial floors", has_script:true, script_text:"Bigger crews, night or weekend installs, and a thicker system for forklifts and foot traffic." },
  { id:"misc_28", sort_order:128, section:"misc", phase:"misc_rv_boats", description:"Metallic epoxy", has_script:true, script_text:"Pour and move the pigment while it's wet. Plan the pattern before you start." },
  { id:"misc_29", sort_order:129, section:"misc", phase:"misc_rv_boats", description:"Patios & pool decks", has_script:true, script_text:"UV-stable topcoat only, and check the forecast for rain during cure." },
];`,
};

export const TEXT = [
  ["Skylo Standard Board", "Lifetime Command Center"], ["The Standard Board", "Lifetime Command Center"], ["Skylo Cash", "Lifetime Cash"],
  ["Skylo Detailing", "Lifetime Coatings"], ["with Skylo", "with Lifetime"], ["Skylo rewards program", "Lifetime rewards program"],
  ["searched Skylo by name", "searched Lifetime Coatings by name"], ["Skylo (or Squeegee Boys)", "Lifetime Coatings"],
  ["Trevor", "Ryan"], ["Ethan", "Cole"], ["sold by trevor", "sold by ryan"],
  ["Squeegee Boys", "Lifetime Coatings"], ["Skylo", "Lifetime"], ["skylod.com", "lifetime-coatings.com"],
  ["Senior Detail Pros can be scheduled on RV and boat jobs. Detail Pros are residential vehicles only.", "Senior Install Pros can run commercial and metallic jobs. Install Pros run residential garages."],
  ["Detail Pro", "Install Pro"], ["Detail Apprentice", "Install Apprentice"], ["The Perfect Detail", "The Perfect Floor"], ["Detail Tech", "Install Tech"],
  ["Mobile Car Detailing", "Garage Floor Coatings"], ["car detailing near me", "garage floor coating near me"],
  ["RVs & Boats Guide", "Commercial & Metallic Guide"], ["RV & Boat Cert", "Commercial Cert"], ["RV & Boat Techs", "Commercial Installers"], ["RVs & Boats", "Commercial & Metallic"],
  ["🚤 Boats", "🏢 Commercial"], ["🚐 RVs", "✨ Metallic"],
  ["Pick Interior only or Interior + Exterior", "Pick Floor only or Floor + stem walls"], ["\"Interior + Exterior\"", "\"Floor + stem walls\""], ["\"Interior only\"", "\"Floor only\""],
  ["\"Interior Finish\"", "\"Prep\""], ["\"Exterior Finish\"", "\"Coating\""],
];
