// netlify/functions/hcp-tech-match-check.js
// Scheduled once daily. Safety net for the exact-name matching every hcp-*
// sync function now does live against the techs table (see lib/matchTech.js,
// which replaced the old hand-maintained lib/techMap.js whitelist).
//
// A whitelist had to be remembered and edited for every new hire; the live
// match fixes that, but a live match against an exact name still silently
// skips anyone whose name in HCP doesn't *exactly* match their name in the
// techs table (a typo, a nickname, a new hire added to HCP before being
// added here). This function scans recent + near-future HCP jobs, finds any
// assigned-employee name with zero match in techs (and not on the
// ignored_hcp_names allowlist), and writes the current list to
// unmatched_hcp_employees so the admin panel can show a banner.
//
// unmatched_hcp_employees is fully replaced each run (upsert the current
// set, delete anything no longer in it) rather than just appended to -- so a
// name that gets fixed (techs table corrected, or added to
// ignored_hcp_names for a legitimate non-tech HCP account) clears itself out
// automatically, no manual cleanup needed.

const FETCH_TIMEOUT_MS = 10000;
const WINDOW_PAST_DAYS = 10;   // catches anyone whose jobs only just started landing
const WINDOW_FUTURE_DAYS = 3;  // catches a new hire scheduled ahead before their first completed job

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function sbFetch(path, options = {}) {
  const res = await fetchWithTimeout(`${process.env.SUPABASE_URL}/rest/v1/${path}`, {
    method: options.method || "GET",
    body: options.body,
    headers: {
      "Content-Type": "application/json",
      "apikey": process.env.SUPABASE_KEY,
      "Authorization": `Bearer ${process.env.SUPABASE_KEY}`,
      "Prefer": options.prefer || "return=representation",
    },
  });
  if (res.status === 204) return null;
  const text = await res.text();
  if (!text) return null;
  const data = JSON.parse(text);
  const isPostgrestError = !res.ok || (data && typeof data === "object" && !Array.isArray(data) && (data.code || data.message));
  if (isPostgrestError) {
    throw new Error(`Supabase error on ${path} (HTTP ${res.status}): ${(data && (data.message || data.code)) || text}`);
  }
  return data;
}

async function hcpGet(path) {
  const res = await fetchWithTimeout(`https://api.housecallpro.com/${path}`, {
    headers: { "Authorization": `Token ${process.env.HCP_API_KEY}`, "Content-Type": "application/json" },
  });
  if (!res.ok) { console.error("HCP error", res.status, path); return null; }
  const text = await res.text();
  if (!text) return null;
  return JSON.parse(text);
}

function addDays(dateStr, days) {
  const d = new Date(dateStr + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split("T")[0];
}

// Mountain Time calendar date -- same fixed -6h convention used everywhere
// else in this codebase.
function getMTDateStr() {
  return new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString().split("T")[0];
}

exports.handler = async () => {
  const missingEnv = ["SUPABASE_URL", "SUPABASE_KEY", "HCP_API_KEY"].filter(k => !process.env[k]);
  if (missingEnv.length) {
    console.error("hcp-tech-match-check missing env vars:", missingEnv.join(", "));
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: `Missing env vars: ${missingEnv.join(", ")}` }) };
  }

  const today = getMTDateStr();
  const from = addDays(today, -WINDOW_PAST_DAYS);
  const to = addDays(today, WINDOW_FUTURE_DAYS);
  const start = `${from}T00:00:00-06:00`;
  const end = `${to}T23:59:59-06:00`;

  const [allTechs, ignoredRows] = await Promise.all([
    sbFetch("techs?select=name"),
    sbFetch("ignored_hcp_names?select=hcp_name"),
  ]);
  // .trim() so a stray leading/trailing space on a stored tech name doesn't
  // make this check flag someone who's actually fine (found: "Trey Sanchez "
  // had a trailing space in Supabase -- same guard applied in matchTech.js
  // callers).
  const techNames = new Set((allTechs || []).map((t) => (t.name || "").trim()));
  const ignoredNames = new Set((ignoredRows || []).map((r) => r.hcp_name));

  // Scan every non-canceled job in the window -- a scheduled or in-progress
  // job still has assigned_employees, so this catches a name mismatch before
  // the tech's first completed job (and first missed payout).
  const seen = {}; // hcpName -> { job_count, first_seen, last_seen, sample_job_id }
  let page = 1;
  const pageSize = 100;
  // Hard stop -- a 13-day window should never come close to 5000 jobs; this
  // just guards against an unbounded loop if HCP's pagination misbehaves.
  while (page <= 50) {
    const qs = [
      `scheduled_start_min=${encodeURIComponent(start)}`,
      `scheduled_start_max=${encodeURIComponent(end)}`,
      `page=${page}`,
      `page_size=${pageSize}`,
    ].join("&");
    const data = await hcpGet(`jobs?${qs}`);
    if (!data) {
      return { statusCode: 200, body: JSON.stringify({ ok: false, error: "HCP request failed" }) };
    }
    const jobs = data.jobs || data.results || [];
    if (jobs.length === 0) break;

    for (const job of jobs) {
      // Canceled jobs ("user canceled" / "pro canceled") never produce
      // revenue or tips, but can still carry former employees' names --
      // counting them raised false alarms for archived staff.
      if (/cancel/i.test(job.work_status || "")) continue;
      const jobDate = (job.schedule && job.schedule.scheduled_start ? job.schedule.scheduled_start.split("T")[0] : null) || today;
      for (const e of job.assigned_employees || []) {
        const hcpName = `${e.first_name || ""} ${e.last_name || ""}`.trim();
        if (!hcpName) continue;
        if (!seen[hcpName]) {
          seen[hcpName] = { job_count: 0, first_seen: jobDate, last_seen: jobDate, sample_job_id: String(job.id) };
        }
        const rec = seen[hcpName];
        rec.job_count++;
        if (jobDate < rec.first_seen) rec.first_seen = jobDate;
        if (jobDate > rec.last_seen) rec.last_seen = jobDate;
      }
    }

    if (jobs.length < pageSize) break;
    page++;
  }

  const nowIso = new Date().toISOString();
  const unmatched = Object.entries(seen)
    .filter(([hcpName]) => !techNames.has(hcpName) && !ignoredNames.has(hcpName))
    .map(([hcpName, rec]) => ({ hcp_name: hcpName, ...rec, updated_at: nowIso }));

  if (unmatched.length > 0) {
    await sbFetch("unmatched_hcp_employees?on_conflict=hcp_name", {
      method: "POST",
      prefer: "resolution=merge-duplicates,return=minimal",
      body: JSON.stringify(unmatched),
    });
  }

  // Self-clear anything that's no longer unmatched (techs table fixed, or
  // the name got added to ignored_hcp_names) so this table always reflects
  // the current state instead of accumulating stale rows forever.
  const currentNames = unmatched.map((u) => u.hcp_name);
  if (currentNames.length > 0) {
    const list = currentNames.map((n) => `"${n.replace(/"/g, '\\"')}"`).join(",");
    await sbFetch(`unmatched_hcp_employees?hcp_name=not.in.(${list})`, { method: "DELETE", prefer: "return=minimal" });
  } else {
    await sbFetch("unmatched_hcp_employees?hcp_name=not.is.null", { method: "DELETE", prefer: "return=minimal" });
  }

  const summary = { ok: true, window: { from, to }, scanned_names: Object.keys(seen).length, unmatched: unmatched.map((u) => u.hcp_name) };
  console.log("hcp-tech-match-check:", JSON.stringify(summary));
  return { statusCode: 200, body: JSON.stringify(summary) };
};
