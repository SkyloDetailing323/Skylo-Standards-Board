// netlify/functions/lib/matchTech.js
// Matches an HCP employee's exact "First Last" name against Supabase's techs
// table, using the techByName map every sync function already builds
// (id, name, is_active from `techs`, keyed by name).
//
// Replaces lib/techMap.js: a hand-maintained whitelist that had to be edited
// for every new hire, and silently dropped anyone missing from it (7 active
// techs went unpaid-and-unnoticed this way -- see hcp-tech-match-check.js,
// which now flags that case daily instead of it just going quiet).
//
// A tech only matches if `techs.name` is an exact, case-sensitive match for
// the HCP employee's "First Last" name -- same exactness TECH_MAP required,
// just sourced live from the techs table instead of a file someone had to
// remember to keep in sync.
function matchTechName(hcpName, techByName) {
  return techByName && techByName[hcpName] ? hcpName : null;
}

module.exports = { matchTechName };
