// netlify/functions/hcp-commission-payments-background.js
// Ethan's commercial commission is paid only after the client pays, so this
// checks the HCP invoice of every completed visit of his commercial accounts
// and records when it was paid in hcp_job_payments (commercialCommission.js
// does the math; reports.js?type=commission serves it).
//
// Accounts: customers with a job tagged both "sold by ethan" and "Commercial",
// plus any an owner credited to him in the app (commercial_accounts).
// A job already recorded as paid isn't checked again.
//
// Hourly via hcp-commission-payments-cron. Read-only on HCP.

const TIME_BUDGET_MS = 13 * 60 * 1000;
const BATCH = 5;

const H = () => ({ "Content-Type": "application/json", apikey: process.env.SUPABASE_KEY, Authorization: `Bearer ${process.env.SUPABASE_KEY}` });

async function rest(path) {
  const out = [];
  for (let offset = 0; ; offset += 1000) {
    const res = await fetch(`${process.env.SUPABASE_URL}/rest/v1/${path}&limit=1000&offset=${offset}`, { headers: H() });
    if (!res.ok) throw new Error(`${path.split("?")[0]} failed (HTTP ${res.status}): ${(await res.text()).slice(0, 300)}`);
    const rows = await res.json();
    out.push(...rows);
    if (rows.length < 1000) return out;
  }
}

const inList = ids => `in.(${ids.map(x => `"${String(x).replace(/"/g, "")}"`).join(",")})`;
async function restIn(path, col, ids) {
  const out = [];
  for (let i = 0; i < ids.length; i += 150) out.push(...await rest(`${path}&${col}=${inList(ids.slice(i, i + 150))}`));
  return out;
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

const num = v => (v == null || v === "" || isNaN(Number(v))) ? null : Number(v);
const isVoid = inv => /cancel|void/i.test(inv.status || "");
// Paid = HCP says "paid", or nothing is left due on a non-zero invoice.
const isPaid = inv => /^paid$/i.test(String(inv.status || "").trim()) || (num(inv.due_amount) === 0 && (num(inv.amount) || 0) > 0);
function paidDate(inv) {
  const dates = [inv.paid_at, ...(inv.payments || []).map(p => p.paid_at || p.created_at)].filter(Boolean).map(d => new Date(d).getTime()).filter(t => !isNaN(t));
  return dates.length ? Math.max(...dates) : null;
}

function toRow(job, invoices) {
  const invs = (invoices || []).filter(i => !isVoid(i));
  const paid = invs.length > 0 && invs.every(isPaid);
  const when = paid ? Math.max(...invs.map(i => paidDate(i) || 0)) : 0;
  return {
    hcp_job_id: job.hcp_job_id,
    hcp_customer_id: job.hcp_customer_id,
    status: invs.length ? [...new Set(invs.map(i => String(i.status || "unknown").toLowerCase()))].join(",") : "no_invoice",
    amount_cents: invs.length ? Math.round(invs.reduce((a, i) => a + (num(i.amount) || 0), 0)) : null,
    due_cents: invs.length ? Math.round(invs.reduce((a, i) => a + (num(i.due_amount) || 0), 0)) : null,
    paid_at: paid ? new Date(when || Date.now()).toISOString() : null,
    raw: { invoices: invs.map(i => ({ id: i.id, status: i.status, amount: i.amount, due_amount: i.due_amount, paid_at: i.paid_at, payments: (i.payments || []).length, keys: Object.keys(i) })) },
    checked_at: new Date().toISOString(),
  };
}

exports.handler = async () => {
  const deadline = Date.now() + TIME_BUDGET_MS;
  const stats = { accounts: 0, to_check: 0, checked: 0, paid: 0, errors: 0 };
  try {
    const credited = await rest("commercial_accounts?select=hcp_customer_id,source&source=in.(outbound,inbound)");
    const taggedCommercial = await rest("hcp_sales_jobs?select=hcp_customer_id&raw->>tags=ilike.*sold%20by%20ethan*&raw->>tags=ilike.*commercial*");
    const customers = [...new Set([...taggedCommercial.map(j => j.hcp_customer_id), ...credited.map(a => a.hcp_customer_id)].filter(Boolean))];
    stats.accounts = customers.length;
    if (!customers.length) { console.log("hcp-commission-payments: no commercial accounts yet", stats); return { statusCode: 200 }; }

    const since = new Date(Date.now() - 400 * 864e5).toISOString();
    const jobs = (await restIn(`hcp_sales_jobs?select=hcp_job_id,hcp_customer_id,work_status,completed_at&completed_at=gte.${since}`, "hcp_customer_id", customers))
      .filter(j => !/cancel/i.test(j.work_status || ""));
    const done = new Set((jobs.length ? await restIn("hcp_job_payments?select=hcp_job_id&paid_at=not.is.null", "hcp_job_id", jobs.map(j => j.hcp_job_id)) : []).map(r => r.hcp_job_id));
    const todo = jobs.filter(j => !done.has(j.hcp_job_id));
    stats.to_check = todo.length;

    for (let i = 0; i < todo.length && Date.now() < deadline; i += BATCH) {
      const rows = (await Promise.all(todo.slice(i, i + BATCH).map(async j => {
        try { return toRow(j, (await hcp(`jobs/${j.hcp_job_id}/invoices`))?.invoices); }
        catch (e) { stats.errors++; console.error(`${j.hcp_job_id}: ${e.message}`); return null; }
      }))).filter(Boolean);
      if (!rows.length) continue;
      const res = await fetch(`${process.env.SUPABASE_URL}/rest/v1/hcp_job_payments?on_conflict=hcp_job_id`, {
        method: "POST", headers: { ...H(), Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(rows),
      });
      if (!res.ok) throw new Error(`hcp_job_payments upsert failed (HTTP ${res.status}): ${(await res.text()).slice(0, 300)}`);
      stats.checked += rows.length;
      stats.paid += rows.filter(r => r.paid_at).length;
    }
    console.log("hcp-commission-payments:", JSON.stringify(stats));
    return { statusCode: 200 };
  } catch (e) {
    console.error("hcp-commission-payments failed:", e.message, JSON.stringify(stats));
    return { statusCode: 500 };
  }
};
