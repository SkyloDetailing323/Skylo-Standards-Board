// netlify/functions/hcp-sales-sync-background.js
// Mirrors every HCP job -- booked, scheduled, completed and canceled -- with
// its customer's name, phone numbers and email into hcp_sales_jobs, so the
// Sales and Marketing dashboards can follow a GHL lead to the jobs it turned
// into (revenue sold, revenue serviced, ROAS).
//
// Hourly (via hcp-sales-sync-cron): jobs scheduled from 60 days ago to a year
// out, plus anything still waiting to be scheduled.
// ?mode=full : every job HCP has (one-time backfill).

const PAGE_SIZE = 100;
const TIME_BUDGET_MS = 13.5 * 60 * 1000;

const digits10 = s => { const d = String(s || "").replace(/\D/g, ""); return d.length >= 10 ? d.slice(-10) : null; };
const normName = (f, l) => (`${f || ""} ${l || ""}`).trim().toLowerCase().replace(/[^a-z ]/g, "").replace(/\s+/g, " ") || null;

async function sb(path, options = {}) {
  const res = await fetch(`${process.env.SUPABASE_URL}/rest/v1/${path}`, {
    method: options.method || "GET",
    body: options.body,
    headers: { "Content-Type": "application/json", apikey: process.env.SUPABASE_KEY, Authorization: `Bearer ${process.env.SUPABASE_KEY}`, Prefer: options.prefer || "return=minimal" },
  });
  if (!res.ok) throw new Error(`Supabase ${path.split("?")[0]} failed (HTTP ${res.status}): ${(await res.text()).slice(0, 300)}`);
}

async function hcp(path, attempt = 1) {
  const res = await fetch(`https://api.housecallpro.com/${path}`, { headers: { Authorization: `Token ${process.env.HCP_API_KEY}`, Accept: "application/json" } });
  if ((res.status === 429 || res.status >= 500) && attempt < 5) {
    await new Promise(r => setTimeout(r, 1000 * attempt * attempt));
    return hcp(path, attempt + 1);
  }
  if (!res.ok) throw new Error(`HCP ${path.split("?")[0]} HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

function toRow(job) {
  const c = job.customer || {};
  const phones = [c.mobile_number, c.home_number, c.work_number].map(digits10).filter(Boolean);
  return {
    hcp_job_id: String(job.id),
    hcp_customer_id: c.id ? String(c.id) : null,
    first_name: c.first_name || null, last_name: c.last_name || null,
    name_norm: normName(c.first_name, c.last_name),
    phone_norms: [...new Set(phones)],
    email_norm: c.email ? String(c.email).trim().toLowerCase() : null,
    work_status: job.work_status || null,
    total_cents: Math.round(Number(job.total_amount) || 0),
    tip_cents: Math.round(Number(job.tip_amount) || 0),
    scheduled_start: job.schedule?.scheduled_start || null,
    completed_at: job.work_timestamps?.completed_at || null,
    job_created_at: job.created_at || null,
    lead_source: job.lead_source || null,
    invoice_number: job.invoice_number ? String(job.invoice_number) : null,
    raw: { tags: job.tags || [], description: job.description || null, recurring: !!job.recurrence_rule || !!job.schedule?.recurrence },
    synced_at: new Date().toISOString(),
  };
}

async function pull(filters, deadline, stats) {
  for (let page = 1; Date.now() < deadline; page++) {
    const data = await hcp(`jobs?${[...filters, `page=${page}`, `page_size=${PAGE_SIZE}`].join("&")}`);
    const jobs = data.jobs || [];
    stats.api_calls++;
    if (jobs.length) {
      const rows = jobs.map(toRow);
      await sb("hcp_sales_jobs?on_conflict=hcp_job_id", { method: "POST", prefer: "resolution=merge-duplicates,return=minimal", body: JSON.stringify(rows) });
      stats.jobs += rows.length;
    }
    if (jobs.length < PAGE_SIZE || (data.total_pages && page >= data.total_pages)) return true;
  }
  return false;
}

async function saveState(value) {
  await sb("ghl_sync_state?on_conflict=key", { method: "POST", prefer: "resolution=merge-duplicates,return=minimal", body: JSON.stringify({ key: "hcp_sales_last_run", value, updated_at: new Date().toISOString() }) }).catch(() => {});
}

exports.handler = async (event) => {
  const started = Date.now(), deadline = started + TIME_BUDGET_MS;
  const full = (event?.queryStringParameters?.mode || "") === "full";
  const stats = { mode: full ? "full" : "incremental", jobs: 0, api_calls: 0, complete: true, started_at: new Date(started).toISOString() };
  try {
    if (!process.env.HCP_API_KEY) throw new Error("HCP_API_KEY not set");
    if (full) {
      stats.complete = await pull([], deadline, stats);
    } else {
      const day = n => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
      const scheduled = await pull([`scheduled_start_min=${encodeURIComponent(day(-60) + "T00:00:00-07:00")}`, `scheduled_start_max=${encodeURIComponent(day(365) + "T23:59:59-07:00")}`], deadline, stats);
      const unscheduled = await pull([`work_status[]=${encodeURIComponent("needs scheduling")}`], deadline, stats);
      stats.complete = scheduled && unscheduled;
    }
    // Re-match GHL leads to HCP jobs so the dashboards read precomputed matches.
    const res = await fetch(`${process.env.SUPABASE_URL}/rest/v1/rpc/refresh_lead_job_matches`, {
      method: "POST", headers: { "Content-Type": "application/json", apikey: process.env.SUPABASE_KEY, Authorization: `Bearer ${process.env.SUPABASE_KEY}` }, body: "{}",
    });
    stats.matches = res.ok ? await res.json() : `failed (HTTP ${res.status})`;
    // Jobs canceled in HCP after they were synced as completed come out of the
    // revenue numbers, so the app keeps matching HCP's reports.
    const cres = await fetch(`${process.env.SUPABASE_URL}/rest/v1/rpc/remove_canceled_hcp_jobs`, {
      method: "POST", headers: { "Content-Type": "application/json", apikey: process.env.SUPABASE_KEY, Authorization: `Bearer ${process.env.SUPABASE_KEY}` }, body: "{}",
    });
    stats.canceled_removed = cres.ok ? await cres.json() : `failed (HTTP ${cres.status})`;
    stats.seconds = Math.round((Date.now() - started) / 1000);
    await saveState({ ok: true, ...stats });
    console.log("hcp-sales-sync:", JSON.stringify(stats));
  } catch (e) {
    console.error("hcp-sales-sync:", e.message);
    await saveState({ ok: false, error: e.message, ...stats });
  }
  return { statusCode: 202 };
};
