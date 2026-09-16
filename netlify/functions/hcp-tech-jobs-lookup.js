// netlify/functions/hcp-tech-jobs-lookup.js
// ONE-OFF, manually-triggered lookup: lists every completed HCP job for one
// employee in a date window, with the customer-facing Job Number (invoice_
// number) for each -- so a specific tech's jobs can be manually cross-checked
// against what's actually landed in tip_entries, without needing direct HCP
// access. Built while investigating tips that show up in HCP's own reports
// but never generated a "You just got paid" email for hcp-tip-sync.js to
// catch (most likely explanation: paid in cash, which doesn't trigger that
// email template at all).
//
// Not scheduled. Visit with query params, e.g.:
//   /.netlify/functions/hcp-tech-jobs-lookup?employee=Tom+Lorenc&start=2026-09-14&end=2026-09-16
// Defaults to Tom Lorenc / Sep 14-16 2026 (the window currently under
// investigation) if no params given. This file can be deleted once it's no
// longer needed.

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

async function hcpGet(path) {
  const res = await fetchWithTimeout(`https://api.housecallpro.com/${path}`, {
    headers: { Authorization: `Token ${process.env.HCP_API_KEY}`, "Content-Type": "application/json" },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return { __error: true, status: res.status, body: text };
  }
  const text = await res.text();
  if (!text) return null;
  return JSON.parse(text);
}

exports.handler = async (event) => {
  if (!process.env.HCP_API_KEY) {
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: "Missing env var: HCP_API_KEY" }) };
  }

  const qp = event.queryStringParameters || {};
  const employeeName = qp.employee || "Tom Lorenc";
  const start = (qp.start || "2026-09-14") + "T00:00:00-06:00";
  const end = (qp.end || "2026-09-16") + "T23:59:59-06:00";

  const matches = [];
  let page = 1;
  const pageSize = 100;

  while (true) {
    const qs = [
      `work_status[]=completed`,
      `scheduled_start_min=${encodeURIComponent(start)}`,
      `scheduled_start_max=${encodeURIComponent(end)}`,
      `page=${page}`,
      `page_size=${pageSize}`,
    ].join("&");

    const data = await hcpGet(`jobs?${qs}`);
    if (!data || data.__error) {
      return { statusCode: 200, body: JSON.stringify({ ok: false, error: data ? `HCP HTTP ${data.status}: ${data.body}` : "empty response", matches }) };
    }
    const jobs = data.jobs || data.results || [];
    if (jobs.length === 0) break;

    for (const job of jobs) {
      const employees = job.assigned_employees || [];
      const hit = employees.find((e) => `${e.first_name} ${e.last_name}`.trim().toLowerCase() === employeeName.trim().toLowerCase());
      if (hit) {
        matches.push({
          jobId: job.id,
          invoice_number: job.invoice_number,
          customer_name: job.customer && [job.customer.first_name, job.customer.last_name].filter(Boolean).join(" "),
          scheduled_start: job.schedule && job.schedule.scheduled_start,
          total_amount: job.total_amount,
          tip_amount: job.tip_amount,
          all_assigned: employees.map((e) => `${e.first_name} ${e.last_name}`),
        });
      }
    }

    if (jobs.length < pageSize) break;
    page++;
  }

  return { statusCode: 200, body: JSON.stringify({ ok: true, employeeName, start, end, count: matches.length, matches }, null, 2) };
};
