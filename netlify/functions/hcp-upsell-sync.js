// netlify/functions/hcp-upsell-sync.js
// Scheduled every 5 min. Fetches today's completed HCP jobs and syncs revenue, tips, upsells.
// Split jobs: revenue/tips/upsells divided by confirmed split % (job_splits table),
// falling back to equal split with split_confirmed=false.

const TECH_MAP = require('./lib/techMap');
const { fetchJobSplits, resolveSplits, fetchUpsellAttributions } = require('./lib/splitHelper');

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

  return { revenue, tips, upsellTotal: upsellCents / 100, upsellItems };
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

  // Build job meta — store ALL matched employees
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
      tipFallback:  job.tip_amount   || 0,
      totalAmount:  job.total_amount || 0,
      customerName: [job.customer?.first_name, job.customer?.last_name].filter(Boolean).join(" ") || null,
    };
  }

  // Fetch techs
  const allTechs = await sbFetch("techs?select=id,name");
  const techByName = Object.fromEntries((allTechs || []).map(t => [t.name, t]));

  // Fetch today's invoices in bulk
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
  console.log(`Fetched invoices for ${Object.keys(invoiceData).length}/${Object.keys(jobMeta).length} jobs (bulk)`);

  // Per-job fallback
  const unmatched = [...jobIds].filter(jid => !invoiceData[jid]);
  if (unmatched.length > 0) {
    const BATCH = 5;
    for (let i = 0; i < unmatched.length; i += BATCH) {
      await Promise.all(unmatched.slice(i, i + BATCH).map(async (jobId) => {
        const invData = await hcpGet(`jobs/${jobId}/invoices`);
        const invoices = invData?.invoices || [];
        if (invoices.length > 0) invoiceData[jobId] = parseInvoice(invoices[0]);
      }));
    }
    console.log(`After fallback: ${Object.keys(invoiceData).length}/${Object.keys(jobMeta).length} matched`);
  }

  // Fetch confirmed splits and upsell attribution for multi-employee jobs
  const multiIds = Object.entries(jobMeta).filter(([, m]) => m.employees.length > 1).map(([id]) => id);
  const splitMap        = await fetchJobSplits(multiIds, sbFetch);
  const upsellAttribMap = await fetchUpsellAttributions(multiIds, sbFetch);

  let synced = 0;
  for (const [jobId, meta] of Object.entries(jobMeta)) {
    const jobDate  = meta.schedStart ? meta.schedStart.split("T")[0] : todayStr;
    const weekKey  = getWeekKey(jobDate);
    const inv      = invoiceData[jobId];

    const totalRev    = inv ? inv.revenue : 0;
    const totalUps    = inv ? inv.upsellTotal : 0;
    const invTipCents = inv ? Math.round((inv.tips || 0) * 100) : 0;
    const jobTipCents = meta.tipFallback || 0;
    const totalTip    = (jobTipCents > 0 ? jobTipCents : invTipCents) / 100;

    const splits = resolveSplits(jobId, meta.employees, splitMap, techByName);

    for (const split of splits) {
      const tech = techByName[split.skyloName];
      if (!tech) { console.log("Tech not in Supabase:", split.skyloName); continue; }

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
          customer_name:   meta.customerName || null,
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
          console.log(`UPSELL: ${split.skyloName} | ${note}`);
        }
      } catch (err) {
        console.log(`Failed to write upsell for job ${jobId} tech ${tech.id}:`, err.message);
      }

      const pctTag = splits.length > 1 ? ` (${Math.round(split.pct * 100)}%${split.confirmed ? "" : " unconfirmed"})` : "";
      console.log(`Synced: ${split.skyloName}${pctTag} | rev=$${revenue} tips=$${tips} ups=$${upsells} hrs=0`);
      synced++;
    }
  }

  console.log(`Done. ${synced} synced.`);
  return { statusCode: 200, body: JSON.stringify({ ok: true, synced }) };
};
