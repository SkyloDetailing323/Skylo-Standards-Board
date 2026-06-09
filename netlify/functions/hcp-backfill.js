// netlify/functions/hcp-backfill.js
// One-time / on-demand backfill: pulls last N days of completed HCP jobs
// and upserts them into the jobs + upsells tables.
// Call via: POST /.netlify/functions/hcp-backfill  { "days": 30 }

const UPSELL_SERVICES = [
  "Seat Steam and Shampoo",
  "Engine Bay Cleaning",
  "Carpet Steam and Shampoo",
  "Heavy Pet Hair Removal Service",
  "Full Interior Detail",
  "Full Exterior Detail",
];

const TECH_MAP = {
  "Myles Madarieta":   "Myles Madarieta",
  "Kade Andrew":       "Kade Andrew",
  "Trevor Prince":     "Trevor Prince",
  "Kyle Reiff":        "Kyle Reiff",
  "Zak Lundblade":     "Zak Lundblade",
  "Josh Halafuka":     "Josh Halafuka",
  "Matthew Durkovich": "Matthew Durkovich",
  "Max Hancock":       "Max Hancock",
  "Milos Lewit":       "Milos Lewit",
  "Mason Dixon":       "Mason Dixon",
  "Tom Lorenc":        "Tom Lorenc",
  "Ethan Hansen":      "Ethan Hansen",
  "Caleb McDaniel":    "Caleb McDaniel",
  "Riley Lyon":        "Riley Lyon",
  "Britton Dookhran":  "Britton Dookhran",
  "Atticus Andersen":  "Atticus Andersen",
  "Landon White":      "Landon White",
  "Jackson Vaughn":    "Jackson Vaughn",
};

function getWeekKey(dateStr) {
  const d = new Date(dateStr + "T12:00:00");
  const day = d.getDay();
  const daysBack = day === 0 ? 6 : day - 1;
  const monday = new Date(d);
  monday.setDate(d.getDate() - daysBack);
  const y = monday.getFullYear();
  const m = String(monday.getMonth() + 1).padStart(2, "0");
  const dd = String(monday.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

async function sbFetch(path, options = {}) {
  const { prefer, method, body } = options;
  const res = await fetch(`${process.env.SUPABASE_URL}/rest/v1/${path}`, {
    method: method || "GET",
    body,
    headers: {
      "Content-Type": "application/json",
      "apikey": process.env.SUPABASE_KEY,
      "Authorization": `Bearer ${process.env.SUPABASE_KEY}`,
      "Prefer": prefer || "return=representation",
    },
  });
  if (res.status === 204) return null;
  return res.json();
}

async function fetchJobsForRange(start, end) {
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
    const res = await fetch(`https://api.housecallpro.com/jobs?${qs}`, {
      headers: { "Authorization": `Token ${process.env.HCP_API_KEY}`, "Content-Type": "application/json" },
    });
    if (!res.ok) break;
    const data = await res.json();
    const batch = data.jobs || data.results || [];
    allJobs.push(...batch);
    if (batch.length < 100 || allJobs.length >= (data.total_items || 0)) break;
    page++;
  }
  return allJobs;
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ error: "POST only" }) };
  }

  let days = 30;
  try { days = parseInt(JSON.parse(event.body || "{}").days) || 30; } catch {}
  days = Math.min(days, 90); // cap at 90 days

  const now = new Date();
  const startDate = new Date(now);
  startDate.setDate(now.getDate() - days);

  const start = startDate.toISOString().split("T")[0] + "T00:00:00-06:00";
  const end   = now.toISOString().split("T")[0]       + "T23:59:59-06:00";

  console.log(`Backfill: ${days} days from ${start} to ${end}`);

  const jobs = await fetchJobsForRange(start, end);
  console.log(`Fetched ${jobs.length} completed jobs`);

  const allTechs = await sbFetch("techs?select=id,name");
  const techByName = Object.fromEntries((allTechs || []).map(t => [t.name, t]));

  let synced = 0, skipped = 0;

  for (const job of jobs) {
    const jobId = String(job.id || "");
    if (!jobId) continue;

    const employee = (job.assigned_employees || [])[0] || job.employee || null;
    if (!employee) { skipped++; continue; }

    const hcpName = `${employee.first_name || ""} ${employee.last_name || ""}`.trim();
    const skyloName = TECH_MAP[hcpName];
    if (!skyloName) { skipped++; continue; }

    const tech = techByName[skyloName];
    if (!tech) { skipped++; continue; }

    const jobRes = await fetch(`https://api.housecallpro.com/jobs/${jobId}`, {
      headers: { "Authorization": `Token ${process.env.HCP_API_KEY}`, "Content-Type": "application/json" },
    });
    if (!jobRes.ok) { skipped++; continue; }
    const fullJob = await jobRes.json();

    const revenue = parseFloat(fullJob.total_amount || fullJob.invoice?.total || fullJob.invoices?.[0]?.total || 0);
    const tips    = parseFloat(fullJob.tip_amount || fullJob.tips || fullJob.invoice?.tip_amount || fullJob.invoices?.[0]?.tip_amount || 0);

    let hours = 0;
    if (fullJob.schedule?.start && fullJob.schedule?.end) {
      hours = Math.round(((new Date(fullJob.schedule.end) - new Date(fullJob.schedule.start)) / 3600000) * 100) / 100;
    }

    const jobDate = fullJob.schedule?.start
      ? fullJob.schedule.start.split("T")[0]
      : now.toISOString().split("T")[0];

    const weekKey = getWeekKey(jobDate);

    const lineItems = fullJob.line_items || fullJob.invoice?.line_items || fullJob.invoices?.[0]?.line_items || [];
    let upsellTotal = 0;
    const upsellItems = [];
    for (const item of lineItems) {
      const name = (item.name || item.description || "").trim();
      if (UPSELL_SERVICES.some(s => s.toLowerCase() === name.toLowerCase())) {
        const total = (item.quantity || 1) * parseFloat(item.unit_price || item.price || 0);
        upsellTotal += total;
        upsellItems.push({ name, amount: total });
      }
    }

    await sbFetch("jobs?on_conflict=hcp_job_id", {
      method: "POST",
      prefer: "resolution=merge-duplicates,return=minimal",
      body: JSON.stringify({ hcp_job_id: jobId, tech_id: tech.id, job_date: jobDate, revenue, upsell_amount: upsellTotal, hours, tips, week_key: weekKey }),
    });

    if (upsellTotal > 0) {
      const note = upsellItems.map(i => `${i.name} ($${i.amount})`).join(", ");
      await sbFetch("upsells?on_conflict=hcp_job_id", {
        method: "POST",
        prefer: "resolution=merge-duplicates,return=minimal",
        body: JSON.stringify({ tech_id: tech.id, week_key: weekKey, amount: upsellTotal, hcp_job_id: jobId, note }),
      });
    }

    synced++;
  }

  console.log(`Backfill done. Synced: ${synced}, Skipped: ${skipped}`);
  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ok: true, synced, skipped, days, total: jobs.length }),
  };
};
