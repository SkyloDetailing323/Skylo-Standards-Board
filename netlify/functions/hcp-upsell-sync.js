// netlify/functions/hcp-upsell-sync.js
// Scheduled every 5 min. Fetches today's completed HCP jobs via the INVOICES
// endpoint (which exposes line items the jobs endpoint never returns).
// HCP amounts are in cents — divide by 100.

// Any line item whose name starts with "Additional Upgrade" counts as an upsell.
// This matches the HCP pricebook category prefix so new services are picked up automatically.

const TECH_MAP = {
  "Myles Madarieta":   "Myles Madarieta",
  "Kade Andrew":       "Kade Andrew",
  "Trevor Prince":     "Trevor Prince",
  "Kyle Reiff":        "Kyle Rieff",
  "Zak Lundblade":     "Zak Lundblade",
  "Josh Halafuka":     "Josh Halufuka",
  "Matthew Durkovich": "Matthew Durkovich",
  "Max Hancock":       "Max Hancock",
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
};

function getMT() {
  const mt = new Date(Date.now() - 6 * 60 * 60 * 1000);
  const y = mt.getUTCFullYear();
  const m = String(mt.getUTCMonth() + 1).padStart(2, "0");
  const d = String(mt.getUTCDate()).padStart(2, "0");
  return { y, m, d, str: `${y}-${m}-${d}` };
}

function getWeekKey(dateStr) {
  const d = new Date((dateStr || getMT().str) + "T12:00:00Z");
  const day = d.getUTCDay();
  const daysBack = day === 0 ? 6 : day - 1;
  const monday = new Date(d);
  monday.setUTCDate(d.getUTCDate() - daysBack);
  return monday.toISOString().split("T")[0];
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

exports.handler = async () => {
  const { str: todayStr } = getMT();
  const start = `${todayStr}T00:00:00-06:00`;
  const end   = `${todayStr}T23:59:59-06:00`;
  console.log(`Syncing ${todayStr}`);

  // Fetch today's completed jobs (for tech assignment + hours)
  const allJobs = [];
  let page = 1;
  while (true) {
    const qs = `work_status[]=completed&scheduled_start_min=${encodeURIComponent(start)}&scheduled_start_max=${encodeURIComponent(end)}&page=${page}&page_size=100`;
    const data = await hcpGet(`jobs?${qs}`);
    if (!data) break;
    const batch = data.jobs || [];
    allJobs.push(...batch);
    if (batch.length < 100 || allJobs.length >= (data.total_items || 0)) break;
    page++;
  }
  console.log(`${allJobs.length} completed jobs`);

  // Build job lookup: jobId → { tech skyloName, schedStart, schedEnd }
  const jobMeta = {};
  for (const job of allJobs) {
    const emp = (job.assigned_employees || [])[0];
    if (!emp) continue;
    const hcpName = `${emp.first_name || ""} ${emp.last_name || ""}`.trim();
    const skyloName = TECH_MAP[hcpName];
    if (!skyloName) continue;
    jobMeta[job.id] = {
      skyloName,
      schedStart: job.schedule?.scheduled_start,
      schedEnd:   job.schedule?.scheduled_end,
      totalAmount: job.total_amount || 0,
    };
  }

  // Fetch all techs once
  const allTechs = await sbFetch("techs?select=id,name");
  const techByName = Object.fromEntries((allTechs || []).map(t => [t.name, t]));

  // Fetch recent invoices — date filters don't work reliably on HCP's invoice endpoint.
  // Instead, grab the last 3 pages (300 invoices) and match by job_id to today's jobs.
  const jobIds = new Set(Object.keys(jobMeta));
  const allInvoices = [];
  for (let p = 1; p <= 3; p++) {
    const data = await hcpGet(`invoices?page=${p}&page_size=100`);
    if (!data) break;
    const batch = (data.invoices || []).filter(inv => jobIds.has(inv.job_id));
    allInvoices.push(...batch);
    if ((data.invoices || []).length < 100) break; // no more pages
  }
  console.log(`${allInvoices.length} invoices matched today's jobs`);

  let synced = 0;

  for (const invoice of allInvoices) {
    const jobId = invoice.job_id;
    if (!jobId) continue;

    const meta = jobMeta[jobId];
    if (!meta) continue; // job not in today's completed list

    const tech = techByName[meta.skyloName];
    if (!tech) { console.log("Tech not in Supabase:", meta.skyloName); continue; }

    const jobDate = meta.schedStart ? meta.schedStart.split("T")[0] : todayStr;
    const weekKey = getWeekKey(jobDate);
    const revenue = meta.totalAmount / 100;

    let hours = 0;
    if (meta.schedStart && meta.schedEnd) {
      hours = Math.round(((new Date(meta.schedEnd) - new Date(meta.schedStart)) / 3600000) * 100) / 100;
    }

    // Scan invoice items for upsell services
    const items = invoice.items || [];
    let upsellTotal = 0;
    const upsellItems = [];
    for (const item of items) {
      const name = (item.name || "").trim();
      if (name.toLowerCase().startsWith("additional upgrade")) {
        // qty_in_hundredths: 100 = 1 unit. amount is already qty×price in cents.
        const amount = (item.amount || 0) / 100;
        upsellTotal += amount;
        upsellItems.push({ name, amount });
      }
    }

    // Tips from invoice
    const tips = (invoice.tip_amount || 0) / 100;

    // Upsert job record
    await sbFetch("jobs?on_conflict=hcp_job_id", {
      method: "POST",
      prefer: "resolution=merge-duplicates,return=minimal",
      body: JSON.stringify({ hcp_job_id: jobId, tech_id: tech.id, job_date: jobDate, revenue, upsell_amount: upsellTotal, hours, tips, week_key: weekKey }),
    });

    // Upsert upsell record if items found
    if (upsellTotal > 0) {
      const note = upsellItems.map(i => `${i.name} ($${i.amount.toFixed(2)})`).join(", ");
      await sbFetch("upsells?on_conflict=hcp_job_id", {
        method: "POST",
        prefer: "resolution=merge-duplicates,return=minimal",
        body: JSON.stringify({ tech_id: tech.id, week_key: weekKey, amount: upsellTotal, hcp_job_id: jobId, note }),
      });
      console.log(`UPSELL: ${meta.skyloName} | ${note}`);
    }

    console.log(`Synced: ${meta.skyloName} | $${revenue} | $${upsellTotal} upsells | ${hours}h`);
    synced++;
  }

  console.log(`Done. ${synced} synced.`);
  return { statusCode: 200, body: JSON.stringify({ ok: true, synced }) };
};
