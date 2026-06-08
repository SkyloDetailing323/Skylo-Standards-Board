// netlify/functions/hcp-upsell-sync.js
// Scheduled every 30 min: fetches today's completed HCP jobs, writes revenue+hours
// to the jobs table and upsell amounts to the upsells table.

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

// Mountain Time approximation (UTC-6, matches week-key logic across app)
function getMT() {
  const mt = new Date(Date.now() - 6 * 60 * 60 * 1000);
  const y = mt.getUTCFullYear();
  const m = String(mt.getUTCMonth() + 1).padStart(2, "0");
  const d = String(mt.getUTCDate()).padStart(2, "0");
  return { y, m, d, str: `${y}-${m}-${d}` };
}

function getTodayRange() {
  const { y, m, d } = getMT();
  return {
    start: `${y}-${m}-${d}T00:00:00-06:00`,
    end:   `${y}-${m}-${d}T23:59:59-06:00`,
  };
}

function getWeekKey() {
  const mt = new Date(Date.now() - 6 * 60 * 60 * 1000);
  const day = mt.getDay();
  const daysBack = day === 0 ? 6 : day - 1;
  const monday = new Date(mt);
  monday.setDate(mt.getDate() - daysBack);
  const y = monday.getFullYear();
  const m = String(monday.getMonth() + 1).padStart(2, "0");
  const d = String(monday.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
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

async function fetchAllCompletedJobs(start, end) {
  const allJobs = [];
  let page = 1;
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
      headers: {
        "Authorization": `Token ${process.env.HCP_API_KEY}`,
        "Content-Type": "application/json",
      },
    });

    if (!res.ok) {
      console.error("HCP list error:", res.status, await res.text());
      break;
    }

    const data = await res.json();
    const batch = data.jobs || data.results || [];
    allJobs.push(...batch);

    const total = data.total_items || 0;
    if (batch.length < pageSize || allJobs.length >= total) break;
    page++;
  }

  return allJobs;
}

exports.handler = async () => {
  const { start, end } = getTodayRange();
  const { str: todayStr } = getMT();
  console.log(`Syncing completed jobs from ${start} to ${end}`);

  const jobs = await fetchAllCompletedJobs(start, end);
  console.log(`Fetched ${jobs.length} completed jobs`);

  // Fetch all techs once — avoids N Supabase queries
  const allTechs = await sbFetch("techs?select=id,name");
  const techByName = Object.fromEntries((allTechs || []).map(t => [t.name, t]));

  const weekKey = getWeekKey();
  let synced = 0;

  for (const job of jobs) {
    const jobId = String(job.id || "");
    if (!jobId) continue;

    const employee = (job.assigned_employees || [])[0] || job.employee || null;
    if (!employee) continue;

    const hcpName = `${employee.first_name || ""} ${employee.last_name || ""}`.trim();
    const skyloName = TECH_MAP[hcpName];
    if (!skyloName) continue;

    const tech = techByName[skyloName];
    if (!tech) {
      console.log("Tech not found in Supabase:", skyloName);
      continue;
    }

    // Fetch full job for line items, revenue, and schedule
    const jobRes = await fetch(`https://api.housecallpro.com/jobs/${jobId}`, {
      headers: {
        "Authorization": `Token ${process.env.HCP_API_KEY}`,
        "Content-Type": "application/json",
      },
    });
    if (!jobRes.ok) {
      console.error("HCP job fetch error:", jobId, jobRes.status);
      continue;
    }
    const fullJob = await jobRes.json();

    // Revenue — try multiple paths the HCP API uses
    const revenue = parseFloat(
      fullJob.total_amount ||
      fullJob.invoice?.total ||
      fullJob.invoices?.[0]?.total ||
      0
    );

    // Hours from scheduled start/end
    let hours = 0;
    if (fullJob.schedule?.start && fullJob.schedule?.end) {
      const diff = new Date(fullJob.schedule.end) - new Date(fullJob.schedule.start);
      hours = Math.round((diff / 3600000) * 100) / 100;
    }

    // Job date (prefer schedule start date, fall back to today)
    const jobDate = fullJob.schedule?.start
      ? fullJob.schedule.start.split("T")[0]
      : todayStr;

    // Scan line items for upsell services
    const lineItems =
      fullJob.line_items ||
      fullJob.invoice?.line_items ||
      fullJob.invoices?.[0]?.line_items ||
      [];

    let upsellTotal = 0;
    const upsellItems = [];
    for (const item of lineItems) {
      const name = (item.name || item.description || "").trim();
      if (UPSELL_SERVICES.some(s => s.toLowerCase() === name.toLowerCase())) {
        const qty = item.quantity || 1;
        const price = parseFloat(item.unit_price || item.price || 0);
        const total = qty * price;
        upsellTotal += total;
        upsellItems.push({ name, amount: total });
      }
    }

    // Always upsert job record (revenue + hours + upsell snapshot)
    await sbFetch("jobs?on_conflict=hcp_job_id", {
      method: "POST",
      prefer: "resolution=merge-duplicates,return=minimal",
      body: JSON.stringify({
        hcp_job_id:    jobId,
        tech_id:       tech.id,
        job_date:      jobDate,
        revenue,
        upsell_amount: upsellTotal,
        hours,
        week_key:      weekKey,
      }),
    });

    // Upsert upsell record only when there are matching line items
    if (upsellTotal > 0) {
      const note = upsellItems.map(i => `${i.name} ($${i.amount})`).join(", ");
      await sbFetch("upsells?on_conflict=hcp_job_id", {
        method: "POST",
        prefer: "resolution=merge-duplicates,return=minimal",
        body: JSON.stringify({
          tech_id:    tech.id,
          week_key:   weekKey,
          amount:     upsellTotal,
          hcp_job_id: jobId,
          note,
        }),
      });
    }

    console.log(`Synced: ${skyloName} | job ${jobId} | $${revenue} rev | ${hours}h | $${upsellTotal} upsells`);
    synced++;
  }

  console.log(`Done. Synced ${synced} job(s).`);
  return {
    statusCode: 200,
    body: JSON.stringify({ ok: true, synced }),
  };
};
