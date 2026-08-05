// Shared split-job helpers — imported by all four sync functions.
// When HCP assigns multiple employees to one job, revenue/tips/upsells are
// divided by their confirmed percentage from the job_splits Supabase table.
// Falls back to equal split when no confirmed percentage exists, and sets
// confirmed=false so the admin UI can surface them for Kyle to review.

// Returns { [hcp_job_id]: [{ tech_id, pct }] }
async function fetchJobSplits(jobIds, sbFetch) {
  if (!jobIds.length) return {};
  const inList = jobIds.map(id => `"${id}"`).join(",");
  let rows;
  try {
    rows = await sbFetch(
      `job_splits?hcp_job_id=in.(${inList})&select=hcp_job_id,tech_id,percentage`
    );
  } catch (err) {
    console.log(`fetchJobSplits failed for jobIds [${jobIds.join(", ")}]:`, err.message);
    return {};
  }
  const map = {};
  for (const row of (rows || [])) {
    if (!map[row.hcp_job_id]) map[row.hcp_job_id] = [];
    map[row.hcp_job_id].push({ tech_id: row.tech_id, pct: row.percentage / 100 });
  }
  return map;
}

// Returns [{ skyloName, pct, confirmed }] for one job.
// Uses confirmed splits when present; otherwise equal split with confirmed=false.
function resolveSplits(jobId, matchedEmployees, splitMap, techByName) {
  if (matchedEmployees.length === 1) {
    return [{ skyloName: matchedEmployees[0].skyloName, pct: 1.0, confirmed: true }];
  }
  const rows = splitMap[jobId] || [];
  if (rows.length > 0) {
    const result = matchedEmployees.map(e => {
      const tech = techByName[e.skyloName];
      const r    = tech ? rows.find(x => x.tech_id === tech.id) : null;
      return r ? { skyloName: e.skyloName, pct: r.pct, confirmed: true } : null;
    }).filter(Boolean);
    if (result.length > 0) return result;
  }
  // Equal-split fallback
  const p = 1 / matchedEmployees.length;
  return matchedEmployees.map(e => ({ skyloName: e.skyloName, pct: p, confirmed: false }));
}

// Returns { [hcp_job_id]: tech_id } — the one tech who gets 100% upsell credit on a split job.
// When absent, falls back to dividing upsells by the revenue split percentage.
async function fetchUpsellAttributions(jobIds, sbFetch) {
  if (!jobIds.length) return {};
  const inList = jobIds.map(id => `"${id}"`).join(",");
  let rows;
  try {
    rows = await sbFetch(
      `job_upsell_attribution?hcp_job_id=in.(${inList})&select=hcp_job_id,tech_id`
    );
  } catch (err) {
    console.log(`fetchUpsellAttributions failed for jobIds [${jobIds.join(", ")}]:`, err.message);
    return {};
  }
  const map = {};
  for (const row of (rows || [])) map[row.hcp_job_id] = row.tech_id;
  return map;
}

module.exports = { fetchJobSplits, resolveSplits, fetchUpsellAttributions };
