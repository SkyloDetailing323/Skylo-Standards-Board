// netlify/functions/hcp-upsell-repair.js
// On-demand upsell scan for a custom date range.
// POST { from: "YYYY-MM-DD", to: "YYYY-MM-DD" }
// Scans invoices for "Additional Upgrade" line items and writes to upsells table + jobs.upsell_amount.

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

  // Hard deadline — return clean JSON before Netlify's 26s limit kills the function
  const DEADLINE = Date.now() + 22000;

  let from, to;
  try {
    const body = JSON.parse(event.body || "{}");
    from = body.from;
    to   = body.to;
  } catch {}

  if (!from || !to) {
    return { statusCode: 400, body: JSON.stringify({ error: "from and to dates required (YYYY-MM-DD)" }) };
  }

  const start = `${from}T00:00:00-06:00`;
  const end   = `${to}T23:59:59-06:00`;
  console.log(`Upsell repair: ${from} → ${to}`);

  // Fetch techs
  const allTechs = await sbFetch("techs?select=id,name");
  const techByName = Object.fromEntries((allTechs || []).map(t => [t.name, t]));

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
  console.log(`Found ${allJobs.length} completed jobs in range`);

  // Build job meta (only techs in TECH_MAP)
  const jobMeta = {};
  for (const job of allJobs) {
    const emp = (job.assigned_employees || [])[0];
    if (!emp) continue;
    const hcpName = `${emp.first_name || ""} ${emp.last_name || ""}`.trim();
    const skyloName = TECH_MAP[hcpName];
    if (!skyloName) continue;
    jobMeta[String(job.id)] = {
      skyloName,
      schedStart:  job.schedule?.scheduled_start,
      schedEnd:    job.schedule?.scheduled_end,
      totalAmount: job.total_amount || 0,
      tipAmount:   job.tip_amount   || 0,
    };
  }

  // Upsert fresh revenue/tips/hours for every job in range (no upsell_amount — don't overwrite manual data)
  const revBatch = [];
  for (const [jobId, meta] of Object.entries(jobMeta)) {
    const tech = techByName[meta.skyloName];
    if (!tech) continue;
    // revenue = total collected minus tip (handles subscription discounts automatically)
    const tips    = meta.tipAmount / 100;
    const revenue = Math.max(0, (meta.totalAmount - meta.tipAmount)) / 100;
    let hours = 0;
    if (meta.schedStart && meta.schedEnd) {
      hours = Math.round(((new Date(meta.schedEnd) - new Date(meta.schedStart)) / 3600000) * 100) / 100;
    }
    const jobDate = meta.schedStart ? meta.schedStart.split("T")[0] : from;
    const weekKey = getWeekKey(jobDate);
    revBatch.push({ hcp_job_id: jobId, tech_id: tech.id, job_date: jobDate, revenue, tips, hours, week_key: weekKey });
  }
  if (revBatch.length > 0) {
    await sbFetch("jobs?on_conflict=hcp_job_id", {
      method: "POST",
      prefer: "resolution=merge-duplicates,return=minimal",
      body: JSON.stringify(revBatch),
    });
    console.log(`Refreshed revenue for ${revBatch.length} jobs`);
  }

  // Scan invoice pages (newest-first) until all target jobs are matched or pages run out
  const jobIds = new Set(Object.keys(jobMeta));
  const allInvoices = [];
  const foundJobIds = new Set();
  for (let p = 1; p <= 8; p++) {
    if (Date.now() > DEADLINE) { console.log("Deadline reached during invoice scan"); break; }
    const data = await hcpGet(`invoices?page=${p}&page_size=100`);
    if (!data) break;
    const invoices = data.invoices || [];
    for (const inv of invoices) {
      const jid = String(inv.job_id || "");
      if (jobIds.has(jid)) {
        allInvoices.push(inv);
        foundJobIds.add(jid);
      }
    }
    if (invoices.length < 100) break;
    if (foundJobIds.size >= jobIds.size) break; // found all target jobs — stop early
  }
  console.log(`Matched ${allInvoices.length} invoices (scanned up to 8 pages)`);

  // Scan invoice items for "Additional Upgrade" upsells only
  // (revenue/tips are already correct from the job-level batch above)
  let upsellsFound = 0;
  for (const invoice of allInvoices) {
    if (Date.now() > DEADLINE) { console.log("Deadline reached during upsell scan"); break; }
    const jobId = String(invoice.job_id);
    const meta = jobMeta[jobId];
    if (!meta) continue;

    const tech = techByName[meta.skyloName];
    if (!tech) continue;

    const items = invoice.items || [];
    let upsellTotal = 0;
    const upsellItems = [];
    for (const item of items) {
      const name = (item.name || "").trim();
      if (name.toLowerCase().startsWith("additional upgrade")) {
        const amount = (item.amount || 0) / 100;
        upsellTotal += amount;
        upsellItems.push({ name, amount });
      }
    }

    if (upsellTotal <= 0) continue;

    const jobDate = meta.schedStart ? meta.schedStart.split("T")[0] : from;
    const weekKey = getWeekKey(jobDate);
    const note = upsellItems.map(i => `${i.name} ($${i.amount.toFixed(2)})`).join(", ");

    await sbFetch("upsells?on_conflict=hcp_job_id", {
      method: "POST",
      prefer: "resolution=merge-duplicates,return=minimal",
      body: JSON.stringify({ tech_id: tech.id, week_key: weekKey, amount: upsellTotal, hcp_job_id: jobId, note }),
    });
    await sbFetch(`jobs?hcp_job_id=eq.${jobId}`, {
      method: "PATCH",
      prefer: "return=minimal",
      body: JSON.stringify({ upsell_amount: upsellTotal }),
    });
    console.log(`Upsell: ${meta.skyloName} | ${note} | $${upsellTotal}`);
    upsellsFound++;
  }

  console.log(`Done. ${upsellsFound} upsells written.`);
  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ok: true, upsellsFound, jobsScanned: allJobs.length, invoicesMatched: allInvoices.length }),
  };
};
