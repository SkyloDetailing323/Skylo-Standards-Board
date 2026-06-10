// netlify/functions/hcp-backfill.js
// On-demand backfill: pulls last N days of completed HCP jobs using the LIST
// endpoint only (no per-job fetches) to stay well within function timeout.
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
  return JSON.parse(text);
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
  const start = fmt(startDate) + "T00:00:00-06:00";
  const end   = fmt(now)       + "T23:59:59-06:00";

  console.log(`Backfill: last ${days} days | ${start} → ${end}`);

  // Fetch all techs once
  const allTechs = await sbFetch("techs?select=id,name");
  if (!allTechs) return { statusCode: 500, body: JSON.stringify({ ok: false, error: "Could not load techs from Supabase" }) };
  const techByName = Object.fromEntries(allTechs.map(t => [t.name, t]));

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

    // Build batch for this page — one Supabase call per page instead of per job
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

      const revenue = (job.total_amount || 0) / 100;

      const schedStart = job.schedule?.scheduled_start;
      const schedEnd   = job.schedule?.scheduled_end;
      let hours = 0;
      if (schedStart && schedEnd) {
        hours = Math.round(((new Date(schedEnd) - new Date(schedStart)) / 3600000) * 100) / 100;
      }

      const jobDate = schedStart ? schedStart.split("T")[0] : fmt(now);
      batch.push({
        hcp_job_id:    jobId,
        tech_id:       tech.id,
        job_date:      jobDate,
        revenue,
        upsell_amount: 0,
        hours,
        tips:          0,
        week_key:      getWeekKey(jobDate),
      });
    }

    if (batch.length > 0) {
      await sbFetch("jobs?on_conflict=hcp_job_id", {
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
