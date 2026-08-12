// netlify/functions/hcp-webhook.js
// Receives real-time job updates pushed from HCP whenever a job is saved/completed.
// Split jobs: for multi-employee jobs, writes one row per tech with split revenue/tips/upsells.
// Split %s come from the job_splits Supabase table; equal split fallback with split_confirmed=false.

const TECH_MAP = require('./lib/techMap');
const { fetchJobSplits, resolveSplits, fetchUpsellAttributions } = require('./lib/splitHelper');

function getWeekKey(dateStr) {
  const d = new Date(dateStr + "T12:00:00Z");
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
  const serviceCents   = Math.max(0, lineItemsCents - discountCents);
  const revenue        = serviceCents / 100;

  // Only count payments that actually succeeded — a failed attempt followed
  // by a successful retry both appear in inv.payments, and summing both
  // double-counts that amount, which the derived-tip fallback below then
  // misreads as a tip.
  const payments        = (inv.payments || []).filter(p => p.status === "succeeded");
  const tipFromPayments = payments.reduce((s, p) => s + (p.tip_amount || 0), 0);
  const paidCents       = payments.reduce((s, p) => s + (p.amount || 0), 0);
  const derivedTip      = Math.max(0, paidCents - serviceCents);
  const tips            = (tipFromPayments > 0 ? tipFromPayments : derivedTip) / 100;

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
  console.log("HCP webhook received:", event.httpMethod, JSON.stringify(event.body).slice(0, 500));

  if (event.httpMethod !== "POST") {
    return { statusCode: 200, body: "ok" };
  }

  let payload;
  try { payload = JSON.parse(event.body || "{}"); } catch {
    return { statusCode: 200, body: "ok" };
  }

  const job = payload.job || payload.data?.job || payload;
  if (!job || !job.id) {
    console.log("No job in payload, keys:", Object.keys(payload));
    return { statusCode: 200, body: "ok" };
  }

  const jobId  = String(job.id);
  const status = job.work_status || "";

  if (!status.includes("complete")) {
    console.log(`Job ${jobId} status "${status}" — skipping`);
    return { statusCode: 200, body: "ok" };
  }

  // Find all matched employees
  const matchedEmployees = (job.assigned_employees || []).map(e => {
    const hcpName   = `${e.first_name || ""} ${e.last_name || ""}`.trim();
    const skyloName = TECH_MAP[hcpName];
    return skyloName ? { skyloName } : null;
  }).filter(Boolean);

  if (matchedEmployees.length === 0) {
    console.log("No TECH_MAP match for any employee on job", jobId);
    return { statusCode: 200, body: "ok" };
  }

  // Deterministic order, and prefer the active record if a duplicate name
  // ever slips back in (instead of silently keeping whichever row Postgres
  // happens to return last).
  const allTechs = await sbFetch("techs?select=id,name,is_active&order=id");
  const techByName = {};
  for (const t of allTechs || []) {
    const existing = techByName[t.name];
    if (!existing || (t.is_active && !existing.is_active)) techByName[t.name] = t;
  }

  const schedStart = job.schedule?.scheduled_start || job.schedule?.start;
  const jobDate    = schedStart ? schedStart.split("T")[0] : new Date().toISOString().split("T")[0];
  const customerName = [job.customer?.first_name, job.customer?.last_name].filter(Boolean).join(" ") || null;
  const weekKey    = getWeekKey(jobDate);

  // Fetch invoice for accurate revenue, tips, upsells
  const invData  = await hcpGet(`jobs/${jobId}/invoices`);
  const invoices = invData?.invoices || [];
  const inv      = invoices.length > 0 ? parseInvoice(invoices[0]) : null;

  const tipFallbackCents = job.tip_amount || 0;
  const totalRev = inv ? inv.revenue     : Math.max(0, ((job.total_amount || 0) - tipFallbackCents)) / 100;
  const totalTip = inv ? inv.tips        : tipFallbackCents / 100;
  const totalUps = inv ? inv.upsellTotal : 0;

  // Fetch confirmed splits and upsell attribution for this job if multi-employee
  const splitMap        = matchedEmployees.length > 1 ? await fetchJobSplits([jobId], sbFetch)         : {};
  const upsellAttribMap = matchedEmployees.length > 1 ? await fetchUpsellAttributions([jobId], sbFetch) : {};
  const splits = resolveSplits(jobId, matchedEmployees, splitMap, techByName);

  for (const split of splits) {
    const tech = techByName[split.skyloName];
    if (!tech) {
      console.log(`Tech "${split.skyloName}" not in Supabase`);
      continue;
    }

    const revenue   = +(totalRev * split.pct).toFixed(2);
    const tips      = +(totalTip * split.pct).toFixed(2);
    // Upsell credit: if manually attributed, 100% to one tech; otherwise split by revenue %
    const attribId  = upsellAttribMap[jobId];
    const upsellPct = attribId ? (attribId === tech.id ? 1.0 : 0) : split.pct;
    const upsells   = +(totalUps * upsellPct).toFixed(2);

    await sbFetch("jobs?on_conflict=hcp_job_id,tech_id", {
      method: "POST",
      prefer: "resolution=merge-duplicates,return=minimal",
      body: JSON.stringify({
        hcp_job_id:      jobId,
        tech_id:         tech.id,
        job_date:        jobDate,
        revenue, tips,
        upsell_amount:   upsells,
        hours:           0,
        week_key:        weekKey,
        split_confirmed: split.confirmed,
        customer_name:   customerName,
      }),
    });

    try {
      if (upsells > 0 && inv) {
        const note = inv.upsellItems.map(i => `${i.name} ($${(i.amount * upsellPct).toFixed(2)})`).join(", ");
        await sbFetch("upsells?on_conflict=hcp_job_id,tech_id", {
          method: "POST",
          prefer: "resolution=merge-duplicates,return=minimal",
          body: JSON.stringify({ tech_id: tech.id, week_key: weekKey, amount: upsells, hcp_job_id: jobId, note }),
        });
        console.log(`Upsell recorded: ${split.skyloName} | ${note} | $${upsells}`);
      } else if (inv) {
        await sbFetch(`upsells?hcp_job_id=eq.${jobId}&tech_id=eq.${tech.id}`, {
          method: "DELETE", prefer: "return=minimal",
        });
      }
    } catch (err) {
      console.log(`Failed to write upsell for job ${jobId} tech ${tech.id}:`, err.message);
    }

    const pctTag = splits.length > 1 ? ` (${Math.round(split.pct * 100)}%${split.confirmed ? "" : " unconfirmed"})` : "";
    console.log(`Webhook processed: ${split.skyloName}${pctTag} | $${revenue} rev | $${tips} tips | $${upsells} ups`);
  }

  return { statusCode: 200, body: "ok" };
};
