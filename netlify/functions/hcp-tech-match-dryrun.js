// netlify/functions/hcp-tech-match-dryrun.js
// ONE-OFF, manually-triggered, READ-ONLY dry run of the new exact-name
// matching (lib/matchTech.js) against real HCP + Supabase data. Writes
// nothing anywhere -- no Supabase writes at all -- so it's safe to hit
// before trusting the live matching logic that hcp-*-sync.js now use.
//
// Visit with an optional ?days= query param (default 45, how far back to
// scan) e.g.:
//   /.netlify/functions/hcp-tech-match-dryrun?days=60
//
// Returns three lists:
//   matched   -- HCP employee names that DO exactly match a techs.name row
//                (these are the people the new logic connects automatically)
//   unmatched -- HCP employee names with NO match (these are who'd show up
//                in the admin panel's new "Tech Matching" banner)
//   techsWithNoRecentJobs -- techs.name rows that had zero jobs in the
//                window (not necessarily a problem -- could just mean no
//                jobs scheduled for them recently)
//
// This file can be deleted once the matching change has been verified.

const FETCH_TIMEOUT_MS = 10000;

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function sbFetch(path) {
  const res = await fetchWithTimeout(`${process.env.SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      "apikey": process.env.SUPABASE_KEY,
      "Authorization": `Bearer ${process.env.SUPABASE_KEY}`,
    },
  });
  if (!res.ok) throw new Error(`Supabase error on ${path} (HTTP ${res.status}): ${await res.text()}`);
  return res.json();
}

async function hcpGet(path) {
  const res = await fetchWithTimeout(`https://api.housecallpro.com/${path}`, {
    headers: { "Authorization": `Token ${process.env.HCP_API_KEY}`, "Content-Type": "application/json" },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return { __error: true, status: res.status, body: text };
  }
  const text = await res.text();
  if (!text) return null;
  return JSON.parse(text);
}

function addDays(dateStr, days) {
  const d = new Date(dateStr + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split("T")[0];
}
function getMTDateStr() {
  return new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString().split("T")[0];
}

exports.handler = async (event) => {
  const missingEnv = ["SUPABASE_URL", "SUPABASE_KEY", "HCP_API_KEY"].filter((k) => !process.env[k]);
  if (missingEnv.length) {
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: `Missing env vars: ${missingEnv.join(", ")}` }) };
  }

  const qp = event.queryStringParameters || {};
  const pastDays = parseInt(qp.days, 10) || 45;
  const futureDays = 7;

  const today = getMTDateStr();
  const from = addDays(today, -pastDays);
  const to = addDays(today, futureDays);
  const start = `${from}T00:00:00-06:00`;
  const end = `${to}T23:59:59-06:00`;

  const allTechs = await sbFetch("techs?select=name,is_active&order=name");
  // .trim() so a stray leading/trailing space on a stored tech name doesn't
  // read as a mismatch here.
  const techNames = new Set(allTechs.map((t) => (t.name || "").trim()));

  const seen = {};
  let page = 1;
  const pageSize = 100;
  while (page <= 50) {
    const qs = [
      `scheduled_start_min=${encodeURIComponent(start)}`,
      `scheduled_start_max=${encodeURIComponent(end)}`,
      `page=${page}`,
      `page_size=${pageSize}`,
    ].join("&");
    const data = await hcpGet(`jobs?${qs}`);
    if (!data || data.__error) {
      return { statusCode: 200, body: JSON.stringify({ ok: false, error: data ? `HCP HTTP ${data.status}: ${data.body}` : "empty response" }) };
    }
    const jobs = data.jobs || data.results || [];
    if (jobs.length === 0) break;
    for (const job of jobs) {
      const jobDate = (job.schedule && job.schedule.scheduled_start ? job.schedule.scheduled_start.split("T")[0] : null) || today;
      for (const e of job.assigned_employees || []) {
        const hcpName = `${e.first_name || ""} ${e.last_name || ""}`.trim();
        if (!hcpName) continue;
        if (!seen[hcpName]) seen[hcpName] = { job_count: 0, first_seen: jobDate, last_seen: jobDate };
        const rec = seen[hcpName];
        rec.job_count++;
        if (jobDate < rec.first_seen) rec.first_seen = jobDate;
        if (jobDate > rec.last_seen) rec.last_seen = jobDate;
      }
    }
    if (jobs.length < pageSize) break;
    page++;
  }

  const names = Object.keys(seen);
  const matched = names.filter((n) => techNames.has(n)).sort().map((n) => ({ name: n, ...seen[n] }));
  const unmatched = names.filter((n) => !techNames.has(n)).sort().map((n) => ({ name: n, ...seen[n] }));
  const techsWithNoRecentJobs = [...techNames].filter((n) => !seen[n]).sort();

  return {
    statusCode: 200,
    body: JSON.stringify({
      ok: true,
      window: { from, to, days_back: pastDays, days_forward: futureDays },
      tech_count_in_supabase: techNames.size,
      distinct_hcp_names_seen: names.length,
      matched_count: matched.length,
      unmatched_count: unmatched.length,
      matched,
      unmatched,
      techsWithNoRecentJobs,
    }, null, 2),
  };
};
