// netlify/functions/hcp-revenue-sync.js
// Syncs revenue/tips/hours for completed jobs in a date range.
// Faster than the full repair — no invoice scanning, just jobs.
// POST { from: "YYYY-MM-DD", to: "YYYY-MM-DD" }

const TECH_MAP = {
  "Myles Madarieta":   "Myles Madarieta",
  "Kade Andrew":       "Kade Andrew",
  "Kyle Reiff":        "Kyle Rieff",
  "Zak Lundblade":     "Zak Lundblade",
  "Josh Halafuka":     "Josh Halufuka",
  "Matthew Durkovich": "Matthew Durkovich",
  "Milos Lewit":       "Milos Lewit",
  "Mason Dixon":       "Mason Dixon",
  "Tom Lorenc":        "Tom Lorenc",
  "Ethan Hamilton":    "Ethan Hamilton",
  "Caleb McDaniel":    "Caleb McDaniel",
  "Riley Lyon":        "Riley Lyon",
  "Britton Dookhran":  "Britton Dookhran",
  "Atticus Andersen":  "Atticus Anderson",
  "Landon White":      "Landon White",
  "Jackson Vaughn":    "Jackson Vaughn",
  "Brian Wheelus":     "Brian Wheelus",
  "Cole Burtenshaw":   "Cole Burtenshaw",
  "Ethan Hansen":      "Ethan Hansen",
  "Max Hancock":       "Max Hancock",
  "Riley Wooden":      "Riley Wooden",
  "Trevor Prince":     "Trevor Prince",
  "Will Faulkner":     "Will Faulkner",
};

function getWeekKey(dateStr) {
  const d = new Date(dateStr + "T12:00:00Z");
  const day = d.getUTCDay();
  const back = day === 0 ? 6 : day - 1;
  d.setUTCDate(d.getUTCDate() - back);
  return d.toISOString().split("T")[0];
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

async function hcpGet(path) {
  const res = await fetch(`https://api.housecallpro.com/${path}`, {
    headers: { "Authorization": `Token ${process.env.HCP_API_KEY}`, "Content-Type": "application/json" },
  });
  if (!res.ok) { console.error("HCP error", res.status, path); return null; }
  const text = await res.text();
  if (!text) return null;
  return JSON.parse(text);
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ error: "POST only" }) };
  }

  let from, to;
  try { ({ from, to } = JSON.parse(event.body || "{}")); } catch {}
  if (!from || !to) {
    return { statusCode: 400, body: JSON.stringify({ error: "from and to required" }) };
  }

  const start = `${from}T00:00:00-06:00`;
  const end   = `${to}T23:59:59-06:00`;

  const allTechs = await sbFetch("techs?select=id,name");
  if (!allTechs) return { statusCode: 500, body: JSON.stringify({ ok: false, error: "Could not load techs" }) };
  const techByName = Object.fromEntries(allTechs.map(t => [t.name, t]));

  // Fetch all completed jobs in range
  const allJobs = [];
  let page = 1;
  while (true) {
    const qs = [
      `work_status[]=completed`,
      `scheduled_start_min=${encodeURIComponent(start)}`,
      `scheduled_start_max=${encodeURIComponent(end)}`,
      `page=${page}`,
      `page_size=100`,
    ].join("&");
    const data = await hcpGet(`jobs?${qs}`);
    if (!data) break;
    const jobs = data.jobs || [];
    allJobs.push(...jobs);
    if (jobs.length < 100) break;
    page++;
  }

  // Build upsert batch
  const batch = [];
  for (const job of allJobs) {
    const emp = (job.assigned_employees || [])[0];
    if (!emp) continue;
    const hcpName = `${emp.first_name || ""} ${emp.last_name || ""}`.trim();
    const skyloName = TECH_MAP[hcpName];
    if (!skyloName) continue;
    const tech = techByName[skyloName];
    if (!tech) continue;

    const tipAmount = job.tip_amount || 0;
    const tips    = tipAmount / 100;
    const revenue = Math.max(0, ((job.total_amount || 0) - tipAmount)) / 100;
    const schedStart = job.schedule?.scheduled_start;
    const schedEnd   = job.schedule?.scheduled_end;
    let hours = 0;
    if (schedStart && schedEnd) {
      hours = Math.round(((new Date(schedEnd) - new Date(schedStart)) / 3600000) * 100) / 100;
    }
    const jobDate = schedStart ? schedStart.split("T")[0] : from;
    batch.push({
      hcp_job_id: String(job.id),
      tech_id:    tech.id,
      job_date:   jobDate,
      revenue,
      tips,
      hours,
      week_key:   getWeekKey(jobDate),
    });
  }

  if (batch.length > 0) {
    await sbFetch("jobs?on_conflict=hcp_job_id", {
      method: "POST",
      prefer: "resolution=merge-duplicates,return=minimal",
      body: JSON.stringify(batch),
    });
  }

  console.log(`Revenue sync: ${batch.length} jobs updated for ${from} → ${to}`);
  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ok: true, jobsSynced: batch.length }),
  };
};
