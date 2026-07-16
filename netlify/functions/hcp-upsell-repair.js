// netlify/functions/hcp-upsell-repair.js
// On-demand repair for a date range.
// POST { from: "YYYY-MM-DD", to: "YYYY-MM-DD" }
//
// Fetches all invoices for the date range in bulk (2-3 API calls max) then
// matches to jobs by invoice.job_id. This avoids one-call-per-job which
// causes Netlify timeout when a week has 100+ jobs.
//
// Revenue = sum(items[].amount) - sum(discounts[].amount)  [cents → dollars]
// Tips    = job.tip_amount  (invoices have no tip field)
// Upsells = items whose name starts with "Additional Upgrade"

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
  "Jackson Payne":     "Jackson Payne",
  "Jamuar Hill":       "Jamuar Hill",
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

function parseInvoice(inv) {
  const lineItemsCents = (inv.items || []).reduce((s, item) => s + (item.amount || 0), 0);
  const discountCents  = (inv.discounts || []).reduce((s, d) => s + Math.abs(d.amount || 0), 0);
  const revenue = Math.max(0, (lineItemsCents - discountCents)) / 100;

  // tip_amount is a dedicated field on the invoice (cents). The payment history shows tip+base
  // bundled into one charge, so tips are NOT derivable from payments[].
  const tips = (inv.tip_amount || 0) / 100;

  let upsellCents = 0;
  const upsellItems = [];
  for (const item of (inv.items || [])) {
    const name = (item.name || "").trim();
    if (name.toLowerCase().startsWith("additional upgrade")) {
      upsellCents += (item.amount || 0);
      upsellItems.push({ name, amount: (item.amount || 0) / 100 });
    }
  }

  return { revenue, tips, upsellTotal: upsellCents / 100, upsellItems };
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ error: "POST only" }) };
  }

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

  // Use UTC timestamps for HCP date filters
  const start = `${from}T00:00:00Z`;
  const end   = `${to}T23:59:59Z`;
  console.log(`Repair: ${from} → ${to}`);

  // Fetch techs
  const allTechs = await sbFetch("techs?select=id,name");
  const techByName = Object.fromEntries((allTechs || []).map(t => [t.name, t]));

  // Fetch all completed jobs in range (job scheduled time, Mountain Time)
  const allJobs = [];
  let page = 1;
  while (true) {
    const qs = [
      `work_status[]=completed`,
      `scheduled_start_min=${encodeURIComponent(`${from}T00:00:00-06:00`)}`,
      `scheduled_start_max=${encodeURIComponent(`${to}T23:59:59-06:00`)}`,
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

  // Build job meta — only techs in TECH_MAP, keep job-level amounts as fallback
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

  // Fetch all invoices for this date range in bulk (2-3 API calls instead of one per job).
  // Invoices are filtered by created_at so we only get invoices from this period.
  const jobIds = new Set(Object.keys(jobMeta));
  const invoiceData = {};
  let invoicesMatched = 0;

  for (let p = 1; p <= 10; p++) {
    if (Date.now() > DEADLINE) { console.log("Deadline during invoice fetch at page", p); break; }
    const qs = [
      `created_at_min=${encodeURIComponent(start)}`,
      `created_at_max=${encodeURIComponent(end)}`,
      `page=${p}`,
      `page_size=100`,
    ].join("&");
    const data = await hcpGet(`invoices?${qs}`);
    if (!data) { console.log("Invoice page", p, "returned null"); break; }
    const invoices = data.invoices || [];
    console.log(`Invoice page ${p}: ${invoices.length} invoices (total_items=${data.total_items})`);
    for (const inv of invoices) {
      const jid = String(inv.job_id || "");
      if (!jobIds.has(jid) || invoiceData[jid]) continue;
      invoiceData[jid] = parseInvoice(inv);
      invoicesMatched++;
    }
    if (invoices.length < 100) break;
    if (invoicesMatched >= jobIds.size) break;
  }
  console.log(`Matched ${invoicesMatched}/${Object.keys(jobMeta).length} jobs to invoices (bulk)`);

  // For jobs the bulk fetch missed (invoice created_at outside the date range — common when jobs
  // are booked weeks in advance), fetch per-job invoices in parallel batches of 5.
  const unmatched = [...jobIds].filter(jid => !invoiceData[jid]);
  if (unmatched.length > 0) {
    console.log(`Per-job fallback for ${unmatched.length} unmatched jobs`);
    const BATCH = 5;
    for (let i = 0; i < unmatched.length; i += BATCH) {
      if (Date.now() > DEADLINE) { console.log("Deadline during per-job fallback at index", i); break; }
      await Promise.all(unmatched.slice(i, i + BATCH).map(async (jobId) => {
        const invData = await hcpGet(`jobs/${jobId}/invoices`);
        const invoices = invData?.invoices || [];
        if (invoices.length > 0) {
          invoiceData[jobId] = parseInvoice(invoices[0]);
          invoicesMatched++;
        }
      }));
    }
    console.log(`After fallback: ${invoicesMatched}/${Object.keys(jobMeta).length} matched`);
  }

  // Write all jobs to DB + upsell records
  let upsellsFound = 0;
  const jobBatch = [];

  for (const [jobId, meta] of Object.entries(jobMeta)) {
    const tech = techByName[meta.skyloName];
    if (!tech) { console.log("Tech not in Supabase:", meta.skyloName); continue; }

    const jobDate = meta.schedStart ? meta.schedStart.split("T")[0] : from;
    const weekKey = getWeekKey(jobDate);
    let hours = 0;
    if (meta.schedStart && meta.schedEnd) {
      hours = Math.round(((new Date(meta.schedEnd) - new Date(meta.schedStart)) / 3600000) * 100) / 100;
    }

    const inv = invoiceData[jobId];
    const revenue     = inv ? inv.revenue    : Math.max(0, (meta.totalAmount - meta.tipAmount)) / 100;
    // Tips come from invoice payments (payment_method "tip"); fall back to job.tip_amount
    const tips        = inv ? inv.tips       : meta.tipAmount / 100;
    const upsellTotal = inv ? inv.upsellTotal : 0;

    jobBatch.push({ hcp_job_id: jobId, tech_id: tech.id, job_date: jobDate, revenue, tips, hours, upsell_amount: upsellTotal, week_key: weekKey });

    if (inv && inv.upsellTotal > 0) {
      const note = inv.upsellItems.map(i => `${i.name} ($${i.amount.toFixed(2)})`).join(", ");
      await sbFetch("upsells?on_conflict=hcp_job_id", {
        method: "POST",
        prefer: "resolution=merge-duplicates,return=minimal",
        body: JSON.stringify({ tech_id: tech.id, week_key: weekKey, amount: inv.upsellTotal, hcp_job_id: jobId, note }),
      });
      console.log(`Upsell: ${meta.skyloName} | ${note} | $${inv.upsellTotal}`);
      upsellsFound++;
    } else if (inv) {
      // Invoice found, no upsells — delete any stale inflated record
      await sbFetch(`upsells?hcp_job_id=eq.${jobId}`, {
        method: "DELETE",
        prefer: "return=minimal",
      });
    }
  }

  // Batch write all jobs
  if (jobBatch.length > 0) {
    await sbFetch("jobs?on_conflict=hcp_job_id", {
      method: "POST",
      prefer: "resolution=merge-duplicates,return=minimal",
      body: JSON.stringify(jobBatch),
    });
  }

  console.log(`Done. ${upsellsFound} upsells, ${jobBatch.length} jobs written.`);
  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ok: true, upsellsFound, jobsScanned: allJobs.length, invoicesMatched }),
  };
};
