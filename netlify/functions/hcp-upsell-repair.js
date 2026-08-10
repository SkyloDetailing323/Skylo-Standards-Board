// netlify/functions/hcp-upsell-repair.js
// On-demand repair for a date range.
// POST { from: "YYYY-MM-DD", to: "YYYY-MM-DD" }
//
// Split jobs: when a job has multiple assigned employees, revenue/tips/upsells
// are divided by their confirmed percentage (from job_splits table).
// Falls back to equal split if no confirmed split exists, and marks those rows
// split_confirmed=false so the admin Split Jobs tab can flag them for Kyle.

const TECH_MAP = require('./lib/techMap');
const { fetchJobSplits, resolveSplits, fetchUpsellAttributions } = require('./lib/splitHelper');

const FETCH_TIMEOUT_MS = 10000;

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

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
  // PostgREST returns an error object (not an array) on failure — surface it as a
  // thrown error instead of letting callers treat it as data (`rows || []` won't
  // catch a truthy object, which used to crash downstream iteration).
  const isPostgrestError = !res.ok || (data && typeof data === "object" && !Array.isArray(data) && (data.code || data.message));
  if (isPostgrestError) {
    throw new Error(`Supabase error on ${path} (HTTP ${res.status}): ${(data && (data.message || data.code)) || text}`);
  }
  return data;
}

async function hcpGet(path) {
  let res;
  try {
    res = await fetchWithTimeout(`https://api.housecallpro.com/${path}`, {
      headers: { "Authorization": `Token ${process.env.HCP_API_KEY}`, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("HCP fetch failed", path, err.message);
    return null;
  }
  if (!res.ok) { console.error("HCP error", res.status, path); return null; }
  const text = await res.text();
  if (!text) return null;
  return JSON.parse(text);
}

function parseInvoice(inv) {
  const lineItemsCents = (inv.items || []).reduce((s, item) => s + (item.amount || 0), 0);
  const discountCents  = (inv.discounts || []).reduce((s, d) => s + Math.abs(d.amount || 0), 0);
  const serviceCents   = Math.max(0, lineItemsCents - discountCents);
  const revenue        = serviceCents / 100;
  const discount       = discountCents / 100;

  const payments        = inv.payments || [];
  const tipFromPayments = payments.reduce((s, p) => s + (p.tip_amount || 0), 0);
  const paidCents       = payments.reduce((s, p) => s + (p.amount || 0), 0);
  const derivedTip      = Math.max(0, paidCents - serviceCents);
  const tipCents        = tipFromPayments > 0 ? tipFromPayments : derivedTip;
  const tips            = tipCents / 100;

  let upsellCents = 0;
  const upsellItems = [];
  for (const item of (inv.items || [])) {
    const name = (item.name || "").trim();
    if (name.toLowerCase().startsWith("additional upgrade")) {
      upsellCents += (item.amount || 0);
      upsellItems.push({ name, amount: (item.amount || 0) / 100 });
    }
  }

  return { revenue, discount, tips, upsellTotal: upsellCents / 100, upsellItems };
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

  const start = `${from}T00:00:00Z`;
  const end   = `${to}T23:59:59Z`;
  console.log(`Repair: ${from} → ${to}`);

  // Fetch techs — deterministic order, and prefer the active record if a
  // duplicate name ever slips back in (instead of silently keeping whichever
  // row Postgres happens to return last).
  const allTechs = await sbFetch("techs?select=id,name,is_active&order=id");
  const techByName = {};
  for (const t of allTechs || []) {
    const existing = techByName[t.name];
    if (!existing || (t.is_active && !existing.is_active)) techByName[t.name] = t;
  }

  // Fetch all completed jobs in range
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

  // Build job meta — store ALL matched employees to support split jobs
  const jobMeta = {};
  for (const job of allJobs) {
    const matchedEmployees = (job.assigned_employees || []).map(e => {
      const hcpName   = `${e.first_name || ""} ${e.last_name || ""}`.trim();
      const skyloName = TECH_MAP[hcpName];
      return skyloName ? { skyloName } : null;
    }).filter(Boolean);
    if (matchedEmployees.length === 0) continue;
    jobMeta[String(job.id)] = {
      employees:    matchedEmployees,
      schedStart:   job.schedule?.scheduled_start,
      totalAmount:  job.total_amount || 0,
      tipAmount:    job.tip_amount   || 0,
      customerName: [job.customer?.first_name, job.customer?.last_name].filter(Boolean).join(" ") || null,
    };
  }

  // Fetch invoices in bulk
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

  // Per-job fallback for invoices created outside the date range
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

  // Fetch confirmed split percentages and upsell attribution for multi-employee jobs
  const multiIds = Object.entries(jobMeta).filter(([, m]) => m.employees.length > 1).map(([id]) => id);
  const splitMap        = await fetchJobSplits(multiIds, sbFetch);
  const upsellAttribMap = await fetchUpsellAttributions(multiIds, sbFetch);
  if (multiIds.length > 0) {
    console.log(`Split jobs: ${multiIds.length} found, ${Object.keys(splitMap).length} confirmed revenue, ${Object.keys(upsellAttribMap).length} confirmed upsell`);
  }

  // Write all jobs + upsell records
  let upsellsFound = 0;
  const jobBatch  = [];
  const jobReport = [];

  for (const [jobId, meta] of Object.entries(jobMeta)) {
    const jobDate  = meta.schedStart ? meta.schedStart.split("T")[0] : from;
    const weekKey  = getWeekKey(jobDate);
    const inv      = invoiceData[jobId];
    const totalRev = inv ? inv.revenue     : Math.max(0, (meta.totalAmount - meta.tipAmount)) / 100;
    const totalTip = inv ? inv.tips        : meta.tipAmount / 100;
    const totalUps = inv ? inv.upsellTotal : 0;
    const totalDsc = inv ? inv.discount    : 0;

    const splits = resolveSplits(jobId, meta.employees, splitMap, techByName);

    for (const split of splits) {
      const tech = techByName[split.skyloName];
      if (!tech) { console.log("Tech not in Supabase:", split.skyloName); continue; }

      const revenue    = +(totalRev * split.pct).toFixed(2);
      const tips       = +(totalTip * split.pct).toFixed(2);
      const discount   = +(totalDsc * split.pct).toFixed(2);
      // Upsell credit: if manually attributed, 100% to one tech; otherwise split by revenue %
      const attribId   = upsellAttribMap[jobId];
      const upsellPct  = attribId ? (attribId === tech.id ? 1.0 : 0) : split.pct;
      const upsells    = +(totalUps * upsellPct).toFixed(2);
      const pctTag   = splits.length > 1
        ? ` (${Math.round(split.pct * 100)}%${split.confirmed ? "" : " UNCONFIRMED"})`
        : "";

      jobBatch.push({
        hcp_job_id:      jobId,
        tech_id:         tech.id,
        job_date:        jobDate,
        revenue, tips,
        hours:           0,
        upsell_amount:   upsells,
        week_key:        weekKey,
        split_confirmed: split.confirmed,
        customer_name:   meta.customerName || null,
      });

      jobReport.push({
        jobId,
        tech:           split.skyloName,
        date:           jobDate,
        revenue,
        discount,
        tip:            tips,
        upsells,
        invoiceFound:   !!inv,
        splitPct:       Math.round(split.pct * 100),
        splitConfirmed: split.confirmed,
      });

      console.log(`JOB ${jobId} | ${split.skyloName}${pctTag} | ${jobDate} | rev=$${revenue.toFixed(2)} disc=$${discount.toFixed(2)} tip=$${tips.toFixed(2)} ups=$${upsells.toFixed(2)} | ${inv ? "INVOICE" : "NO INVOICE - fallback"}`);

      try {
        if (inv && upsells > 0) {
          const note = inv.upsellItems.map(i => `${i.name} ($${(i.amount * upsellPct).toFixed(2)})`).join(", ");
          await sbFetch("upsells?on_conflict=hcp_job_id,tech_id", {
            method: "POST",
            prefer: "resolution=merge-duplicates,return=minimal",
            body: JSON.stringify({ tech_id: tech.id, week_key: weekKey, amount: upsells, hcp_job_id: jobId, note }),
          });
          upsellsFound++;
        } else if (inv) {
          await sbFetch(`upsells?hcp_job_id=eq.${jobId}&tech_id=eq.${tech.id}`, {
            method: "DELETE", prefer: "return=minimal",
          });
        }
      } catch (err) {
        console.log(`Failed to write upsell for job ${jobId} tech ${tech.id}:`, err.message);
      }
    }
  }

  // Batch write — unique on (hcp_job_id, tech_id) to support one row per tech per split job
  if (jobBatch.length > 0) {
    await sbFetch("jobs?on_conflict=hcp_job_id,tech_id", {
      method: "POST",
      prefer: "resolution=merge-duplicates,return=minimal",
      body: JSON.stringify(jobBatch),
    });
  }

  console.log(`Done. ${upsellsFound} upsells, ${jobBatch.length} rows written.`);
  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ok: true, upsellsFound, jobsScanned: allJobs.length, invoicesMatched, jobsWritten: jobBatch.length, jobs: jobReport }),
  };
};
