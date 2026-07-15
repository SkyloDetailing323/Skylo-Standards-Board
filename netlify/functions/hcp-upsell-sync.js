// netlify/functions/hcp-upsell-sync.js
// Scheduled every 5 min. Fetches today's completed HCP jobs and syncs:
//   revenue    = sum(items[].amount) - sum(discounts[].amount)  [upsells count toward revenue]
//   tips       = invoice.tip_amount (separate, NOT included in revenue)
//   upsells    = line items whose name starts with "Additional Upgrade"
// HCP amounts are in cents — divide by 100.

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

function parseInvoice(inv) {
  // Revenue = sum of all line item amounts minus any discounts
  // Negative line items (e.g. manual adjustments) subtract automatically via the sum.
  // Discounts in the separate "discounts" section are subtracted explicitly.
  const lineItemsCents = (inv.items || []).reduce((s, item) => s + (item.amount || 0), 0);
  const discountCents  = (inv.discounts || []).reduce((s, d) => s + Math.abs(d.amount || 0), 0);
  const revenue = Math.max(0, (lineItemsCents - discountCents)) / 100;

  let upsellCents = 0;
  const upsellItems = [];
  for (const item of (inv.items || [])) {
    const name = (item.name || "").trim();
    if (name.toLowerCase().startsWith("additional upgrade")) {
      upsellCents += (item.amount || 0);
      upsellItems.push({ name, amount: (item.amount || 0) / 100 });
    }
  }

  return { revenue, upsellTotal: upsellCents / 100, upsellItems };
}

exports.handler = async () => {
  const { str: todayStr } = getMT();
  const start = `${todayStr}T00:00:00-06:00`;
  const end   = `${todayStr}T23:59:59-06:00`;
  console.log(`Syncing ${todayStr}`);

  // Fetch today's completed jobs
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

  // Build job lookup — only techs in TECH_MAP
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
      tipFallback: job.tip_amount || 0,  // cents, only used if invoice has no tip_amount field
    };
  }

  // Fetch all techs from Supabase
  const allTechs = await sbFetch("techs?select=id,name");
  const techByName = Object.fromEntries((allTechs || []).map(t => [t.name, t]));

  // Fetch each job's invoices using GET /jobs/{job_id}/invoices
  // Fetch today's invoices in bulk — today is newest so they're on page 1-2.
  // Much faster than one API call per job.
  const jobIds = new Set(Object.keys(jobMeta));
  const invoiceData = {};
  for (let p = 1; p <= 3; p++) {
    const data = await hcpGet(`invoices?created_at_min=${encodeURIComponent(todayStr + "T00:00:00Z")}&page=${p}&page_size=100`);
    if (!data) break;
    const invoices = data.invoices || [];
    for (const inv of invoices) {
      const jid = String(inv.job_id || "");
      if (!jobIds.has(jid) || invoiceData[jid]) continue;
      invoiceData[jid] = parseInvoice(inv);
    }
    if (invoices.length < 100 || Object.keys(invoiceData).length >= jobIds.size) break;
  }
  console.log(`Fetched invoices for ${Object.keys(invoiceData).length}/${Object.keys(jobMeta).length} jobs`);

  let synced = 0;
  for (const [jobId, meta] of Object.entries(jobMeta)) {
    const tech = techByName[meta.skyloName];
    if (!tech) { console.log("Tech not in Supabase:", meta.skyloName); continue; }

    const jobDate = meta.schedStart ? meta.schedStart.split("T")[0] : todayStr;
    const weekKey = getWeekKey(jobDate);
    let hours = 0;
    if (meta.schedStart && meta.schedEnd) {
      hours = Math.round(((new Date(meta.schedEnd) - new Date(meta.schedStart)) / 3600000) * 100) / 100;
    }

    const inv = invoiceData[jobId];
    const revenue     = inv ? inv.revenue    : 0;
    const tips        = meta.tipFallback / 100;  // invoice has no tip field; use job.tip_amount
    const upsellTotal = inv ? inv.upsellTotal : 0;

    await sbFetch("jobs?on_conflict=hcp_job_id", {
      method: "POST",
      prefer: "resolution=merge-duplicates,return=minimal",
      body: JSON.stringify({ hcp_job_id: jobId, tech_id: tech.id, job_date: jobDate, revenue, upsell_amount: upsellTotal, hours, tips, week_key: weekKey }),
    });

    if (upsellTotal > 0 && inv) {
      const note = inv.upsellItems.map(i => `${i.name} ($${i.amount.toFixed(2)})`).join(", ");
      await sbFetch("upsells?on_conflict=hcp_job_id", {
        method: "POST",
        prefer: "resolution=merge-duplicates,return=minimal",
        body: JSON.stringify({ tech_id: tech.id, week_key: weekKey, amount: upsellTotal, hcp_job_id: jobId, note }),
      });
      console.log(`UPSELL: ${meta.skyloName} | ${note}`);
    }

    console.log(`Synced: ${meta.skyloName} | rev=$${revenue} tips=$${tips} upsells=$${upsellTotal} hrs=${hours}`);
    synced++;
  }

  console.log(`Done. ${synced} synced.`);
  return { statusCode: 200, body: JSON.stringify({ ok: true, synced }) };
};
