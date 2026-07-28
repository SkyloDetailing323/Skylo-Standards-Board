// netlify/functions/hcp-webhook.js
// Receives real-time job updates pushed from HCP whenever a job is saved/completed.
// Set this URL in HCP Settings → Integrations → Webhooks:
//   https://skylotechleaderboard.netlify.app/.netlify/functions/hcp-webhook

const TECH_MAP = require('./lib/techMap');

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
  const serviceCents   = Math.max(0, lineItemsCents - discountCents);
  const revenue        = serviceCents / 100;

  const payments       = inv.payments || [];
  const tipFromPayments = payments.reduce((s, p) => s + (p.tip_amount || 0), 0);
  const paidCents      = payments.reduce((s, p) => s + (p.amount || 0), 0);
  const derivedTip     = Math.max(0, paidCents - serviceCents);
  const tips           = (tipFromPayments > 0 ? tipFromPayments : derivedTip) / 100;

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

  const employee = (job.assigned_employees || [])[0];
  if (!employee) return { statusCode: 200, body: "ok" };

  const hcpName   = `${employee.first_name || ""} ${employee.last_name || ""}`.trim();
  const skyloName = TECH_MAP[hcpName];
  if (!skyloName) {
    console.log(`No TECH_MAP entry for "${hcpName}"`);
    return { statusCode: 200, body: "ok" };
  }

  const allTechs = await sbFetch("techs?select=id,name");
  const tech = (allTechs || []).find(t => t.name === skyloName);
  if (!tech) {
    console.log(`Tech "${skyloName}" not in Supabase`);
    return { statusCode: 200, body: "ok" };
  }

  const schedStart = job.schedule?.scheduled_start || job.schedule?.start;
  const jobDate    = schedStart ? schedStart.split("T")[0] : new Date().toISOString().split("T")[0];
  const weekKey    = getWeekKey(jobDate);

  // Fetch invoice for accurate revenue, tips, and upsells
  const invData  = await hcpGet(`jobs/${jobId}/invoices`);
  const invoices = invData?.invoices || [];
  const inv      = invoices.length > 0 ? parseInvoice(invoices[0]) : null;

  // Fall back to job-level amounts if no invoice found yet
  const tipFallbackCents = job.tip_amount || 0;
  const revenue     = inv ? inv.revenue     : Math.max(0, ((job.total_amount || 0) - tipFallbackCents)) / 100;
  const tips        = inv ? inv.tips        : tipFallbackCents / 100;
  const upsellTotal = inv ? inv.upsellTotal : 0;

  await sbFetch("jobs?on_conflict=hcp_job_id", {
    method: "POST",
    prefer: "resolution=merge-duplicates,return=minimal",
    body: JSON.stringify({ hcp_job_id: jobId, tech_id: tech.id, job_date: jobDate, revenue, upsell_amount: upsellTotal, hours: 0, tips, week_key: weekKey }),
  });

  if (upsellTotal > 0 && inv) {
    const note = inv.upsellItems.map(i => `${i.name} ($${i.amount.toFixed(2)})`).join(", ");
    await sbFetch("upsells?on_conflict=hcp_job_id", {
      method: "POST",
      prefer: "resolution=merge-duplicates,return=minimal",
      body: JSON.stringify({ tech_id: tech.id, week_key: weekKey, amount: upsellTotal, hcp_job_id: jobId, note }),
    });
    console.log(`Upsell recorded: ${skyloName} | ${note} | $${upsellTotal}`);
  } else if (inv) {
    await sbFetch(`upsells?hcp_job_id=eq.${jobId}`, { method: "DELETE", prefer: "return=minimal" });
  }

  console.log(`Webhook processed: ${skyloName} | $${revenue} rev | $${tips} tips | $${upsellTotal} upsells`);
  return { statusCode: 200, body: "ok" };
};
