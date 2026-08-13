// netlify/functions/hcp-revenue-repair.js
// On-demand revenue+tips repair for a date range (Reports tab "Repair Revenue"
// button). No schedule — Netlify blocks direct HTTP invocation of any function
// that has a `schedule` configured, so this on-demand path has to live in its
// own file, separate from the scheduled hcp-revenue-sync.js (same split as
// hcp-upsell-repair.js vs hcp-upsell-sync.js).
// POST { from: "YYYY-MM-DD", to: "YYYY-MM-DD" }

const TECH_MAP = require('./lib/techMap');
const { fetchJobSplits, resolveSplits } = require('./lib/splitHelper');

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
  const back = day === 0 ? 6 : day - 1;
  d.setUTCDate(d.getUTCDate() - back);
  return d.toISOString().split("T")[0];
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

  // Deterministic order, and prefer the active record if a duplicate name
  // ever slips back in (instead of silently keeping whichever row Postgres
  // happens to return last).
  const allTechs = await sbFetch("techs?select=id,name,is_active&order=id");
  if (!allTechs) return { statusCode: 500, body: JSON.stringify({ ok: false, error: "Could not load techs" }) };
  const techByName = {};
  for (const t of allTechs) {
    const existing = techByName[t.name];
    if (!existing || (t.is_active && !existing.is_active)) techByName[t.name] = t;
  }

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

  // Build job meta — store ALL matched employees
  const jobMeta = {};
  for (const job of allJobs) {
    const matchedEmployees = (job.assigned_employees || []).map(e => {
      const hcpName   = `${e.first_name || ""} ${e.last_name || ""}`.trim();
      const skyloName = TECH_MAP[hcpName];
      return skyloName ? { skyloName } : null;
    }).filter(Boolean);
    if (matchedEmployees.length === 0) continue;
    const schedStart = job.schedule?.scheduled_start;
    jobMeta[String(job.id)] = {
      employees:    matchedEmployees,
      jobDate:      schedStart ? schedStart.split("T")[0] : from,
      totalAmount:  job.total_amount || 0,
      tipAmount:    job.tip_amount   || 0,
      customerName: [job.customer?.first_name, job.customer?.last_name].filter(Boolean).join(" ") || null,
    };
  }

  // TEMP DIAGNOSTIC: does HCP's /jobs endpoint actually support filtering by
  // completed_at, or does it silently ignore an unrecognized param?
  console.log("SCHEDULED_FILTER_COUNT", allJobs.length, JSON.stringify(allJobs.map(j => j.id)));
  const completedTestQs = [
    `work_status[]=completed`,
    `completed_at_min=${encodeURIComponent(start)}`,
    `completed_at_max=${encodeURIComponent(end)}`,
    `page=1`,
    `page_size=100`,
  ].join("&");
  const completedTestData = await hcpGet(`jobs?${completedTestQs}`);
  console.log("COMPLETED_FILTER_RESULT", JSON.stringify({
    total_items: completedTestData?.total_items,
    returned: (completedTestData?.jobs || []).length,
    ids: (completedTestData?.jobs || []).map(j => j.id),
  }));

  // Fetch confirmed splits for multi-employee jobs
  const multiIds = Object.entries(jobMeta).filter(([, m]) => m.employees.length > 1).map(([id]) => id);
  const splitMap = await fetchJobSplits(multiIds, sbFetch);

  // Per-job invoice fetch, then write one row per tech per job
  const batch = [];
  const jobReport = [];
  let invoicesMatched = 0;
  for (const [jobId, meta] of Object.entries(jobMeta)) {
    const invData     = await hcpGet(`jobs/${jobId}/invoices`);
    const invoices    = invData?.invoices || [];
    const invoiceFound = invoices.length > 0;
    if (invoiceFound) invoicesMatched++;

    let totalRev, totalTip;
    if (invoiceFound) {
      const inv            = invoices[0];
      const lineItemsCents = (inv.items || []).reduce((s, item) => s + (item.amount || 0), 0);
      const discountCents  = (inv.discounts || []).reduce((s, d) => s + Math.abs(d.amount || 0), 0);
      const serviceCents   = Math.max(0, lineItemsCents - discountCents);
      totalRev             = serviceCents / 100;
      // Only count payments that actually succeeded — a failed attempt followed
      // by a successful retry both appear in inv.payments, and summing both
      // double-counts that amount, which the derived-tip fallback below then
      // misreads as a tip equal to the job's full revenue.
      const payments       = (inv.payments || []).filter(p => p.status === "succeeded");
      const tipFromPay     = payments.reduce((s, p) => s + (p.tip_amount || 0), 0);
      const paidCents      = payments.reduce((s, p) => s + (p.amount || 0), 0);
      totalTip = (tipFromPay > 0 ? tipFromPay : Math.max(0, paidCents - serviceCents)) / 100;
    } else {
      totalRev = Math.max(0, (meta.totalAmount - meta.tipAmount)) / 100;
      totalTip = meta.tipAmount / 100;
    }

    const splits = resolveSplits(jobId, meta.employees, splitMap, techByName);
    for (const split of splits) {
      const tech = techByName[split.skyloName];
      if (!tech) continue;
      const revenue = +(totalRev * split.pct).toFixed(2);
      const tips    = +(totalTip * split.pct).toFixed(2);
      batch.push({
        hcp_job_id:      jobId,
        tech_id:         tech.id,
        job_date:        meta.jobDate,
        week_key:        getWeekKey(meta.jobDate),
        hours:           0,
        revenue, tips,
        split_confirmed: split.confirmed,
        customer_name:   meta.customerName || null,
      });
      jobReport.push({ jobId, tech: split.skyloName, date: meta.jobDate, revenue, tips, invoiceFound });
    }
  }

  if (batch.length > 0) {
    await sbFetch("jobs?on_conflict=hcp_job_id,tech_id", {
      method: "POST",
      prefer: "resolution=merge-duplicates,return=minimal",
      body: JSON.stringify(batch),
    });
  }

  console.log(`Revenue repair: ${batch.length} rows written for ${from} → ${to}`);
  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ok: true,
      jobsSynced: batch.length,
      jobsScanned: allJobs.length,
      invoicesMatched,
      jobsWritten: batch.length,
      jobs: jobReport,
    }),
  };
};
