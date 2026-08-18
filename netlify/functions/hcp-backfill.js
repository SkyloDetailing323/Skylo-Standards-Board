// netlify/functions/hcp-backfill.js
// On-demand backfill: pulls last N days of completed HCP jobs.
// Uses job.tip_amount (not invoice) to split tips from service revenue.
// HCP returns monetary values in CENTS — divide by 100 for dollars.

const TECH_MAP = {
  "Myles Madarieta":   "Myles Madarieta",
  "Kade Andrew":       "Kade Andrew",
  "Kyle Reiff":        "Kyle Rieff",        // HCP → Supabase spelling
  "Zak Lundblade":     "Zak Lundblade",
  "Josh Halafuka":     "Josh Halufuka",     // HCP → Supabase spelling
  "Matthew Durkovich": "Matthew Durkovich",
  "Milos Lewit":       "Milos Lewit",
  "Mason Dixon":       "Mason Dixon",
  "Tom Lorenc":        "Tom Lorenc",
  "Ethan Hamilton":    "Ethan Hamilton",
  "Caleb McDaniel":    "Caleb McDaniel",
  "Riley Lyon":        "Riley Lyon",
  "Britton Dookhran":  "Britton Dookhran",
  "Atticus Andersen":  "Atticus Anderson",  // HCP → Supabase spelling
  "Landon White":      "Landon White",
  "Jackson Vaughn":    "Jackson Vaughn",
  "Brian Wheelus":     "Brian Wheelus",
  // Archived techs — no longer active but include for historical revenue accuracy
  "Ethan Hansen":      "Ethan Hansen",
  "Riley Wooden":      "Riley Wooden",
  "Will Faulkner":     "Will Faulkner",
  "Cole Burtenshaw":   "Cole Burtenshaw",
  "Max Hancock":       "Max Hancock",
  "Trevor Prince":     "Trevor Prince",
};

function getWeekKey(dateStr) {
  const d = new Date(dateStr + "T12:00:00Z");
  const day = d.getUTCDay();
  const daysBack = day === 0 ? 6 : day - 1;
  const monday = new Date(d);
  monday.setUTCDate(d.getUTCDate() - daysBack);
  const y = monday.getUTCFullYear();
  const m = String(monday.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(monday.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

async function sbFetch(path, options = {}) {
  const res = await fetch(`${process.env.SUPABASE_URL}/rest/v1/${path}`, {
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
  // PostgREST returns an error object (not an array) on failure — surface it as a
  // thrown error instead of letting callers treat it as data (`rows || []` won't
  // catch a truthy object, which used to crash downstream iteration).
  const isPostgrestError = !res.ok || (data && typeof data === "object" && !Array.isArray(data) && (data.code || data.message));
  if (isPostgrestError) {
    throw new Error(`Supabase error on ${path} (HTTP ${res.status}): ${(data && (data.message || data.code)) || text}`);
  }
  return data;
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ error: "POST only" }) };
  }

  let days = 30;
  try { days = Math.min(parseInt(JSON.parse(event.body || "{}").days) || 30, 90); } catch {}

  const now = new Date();
  const startDate = new Date(now);
  startDate.setDate(now.getDate() - days);

  const fmt = d => d.toISOString().split("T")[0];
  const rangeFrom = fmt(startDate);
  const rangeTo   = fmt(now);

  // HCP's /jobs endpoint has no completed_at_min/max filter — the only
  // server-side date filter it supports is scheduled_start. Since actual
  // completion can lag the scheduled date by several days, we fetch a
  // padded window by scheduled_start and then bucket + filter by each job's
  // real completion date ourselves — same fix already proven in
  // hcp-revenue-repair.js.
  const PAD_DAYS = 5;
  function addDays(dateStr, days) {
    const d = new Date(dateStr + "T12:00:00Z");
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().split("T")[0];
  }
  const fetchFrom = addDays(rangeFrom, -PAD_DAYS);
  const fetchTo   = addDays(rangeTo, PAD_DAYS);
  const start = fetchFrom + "T00:00:00-06:00";
  const end   = fetchTo   + "T23:59:59-06:00";

  // Mountain Time calendar date for a UTC timestamp — same fixed -6h
  // convention used everywhere else in this codebase.
  function toMTDateStr(isoTimestamp) {
    return new Date(new Date(isoTimestamp).getTime() - 6 * 60 * 60 * 1000).toISOString().split("T")[0];
  }

  console.log(`Backfill: last ${days} days | ${rangeFrom} → ${rangeTo}`);

  // Fetch all techs once — deterministic order, and prefer the active record
  // if a duplicate name ever slips back in (instead of silently keeping
  // whichever row Postgres happens to return last).
  const allTechs = await sbFetch("techs?select=id,name,is_active&order=id");
  if (!allTechs) return { statusCode: 500, body: JSON.stringify({ ok: false, error: "Could not load techs from Supabase" }) };
  const techByName = {};
  for (const t of allTechs) {
    const existing = techByName[t.name];
    if (!existing || (t.is_active && !existing.is_active)) techByName[t.name] = t;
  }

  let synced = 0, skipped = 0, page = 1;
  const pageSize = 100;

  while (true) {
    const qs = [
      `work_status[]=completed`,
      `scheduled_start_min=${encodeURIComponent(start)}`,
      `scheduled_start_max=${encodeURIComponent(end)}`,
      `page=${page}`,
      `page_size=${pageSize}`,
    ].join("&");

    const res = await fetch(`https://api.housecallpro.com/jobs?${qs}`, {
      headers: { "Authorization": `Token ${process.env.HCP_API_KEY}`, "Content-Type": "application/json" },
    });

    if (!res.ok) {
      console.error("HCP error:", res.status);
      break;
    }

    const text = await res.text();
    if (!text) break;
    const data = JSON.parse(text);
    const jobs = data.jobs || data.results || [];
    if (jobs.length === 0) break;

    const batch = [];
    for (const job of jobs) {
      const jobId = String(job.id || "");
      if (!jobId) { skipped++; continue; }

      const employee = (job.assigned_employees || [])[0];
      if (!employee) { skipped++; continue; }

      const hcpName = `${employee.first_name || ""} ${employee.last_name || ""}`.trim();
      const skyloName = TECH_MAP[hcpName];
      if (!skyloName) { skipped++; continue; }

      const tech = techByName[skyloName];
      if (!tech) { skipped++; continue; }

      // revenue = total collected minus tip (handles subscription discounts automatically)
      const tipAmount = job.tip_amount || 0;
      const tips    = tipAmount / 100;
      const revenue = Math.max(0, ((job.total_amount || 0) - tipAmount)) / 100;

      const schedStart = job.schedule?.scheduled_start;
      const schedEnd   = job.schedule?.scheduled_end;
      let hours = 0;
      if (schedStart && schedEnd) {
        hours = Math.round(((new Date(schedEnd) - new Date(schedStart)) / 3600000) * 100) / 100;
      }

      // Bucket by actual completion date, not scheduled date — same fix
      // already proven in hcp-revenue-repair.js. Drop anything that lands
      // outside the originally-requested range; it was only fetched because
      // of the padding above.
      const completedAt = job.work_timestamps?.completed_at;
      const jobDate = completedAt ? toMTDateStr(completedAt) : (schedStart ? schedStart.split("T")[0] : rangeTo);
      if (jobDate < rangeFrom || jobDate > rangeTo) { skipped++; continue; }
      batch.push({
        hcp_job_id: jobId,
        tech_id:    tech.id,
        job_date:   jobDate,
        revenue,
        hours,
        tips,
        week_key:   getWeekKey(jobDate),
        // upsell_amount intentionally omitted — don't overwrite existing upsell data
      });
    }

    if (batch.length > 0) {
      await sbFetch("jobs?on_conflict=hcp_job_id,tech_id", {
        method: "POST",
        prefer: "resolution=merge-duplicates,return=minimal",
        body: JSON.stringify(batch),
      });
      synced += batch.length;
    }

    console.log(`Page ${page}: ${jobs.length} jobs, synced so far: ${synced}`);

    const totalItems = data.total_items || 0;
    if (jobs.length < pageSize || synced + skipped >= totalItems) break;
    page++;
  }

  console.log(`Backfill complete. Synced: ${synced}, Skipped: ${skipped}`);
  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ok: true, synced, skipped, days }),
  };
};
