// netlify/functions/hcp-tip-sync.js
// Scheduled every 5 min (see netlify.toml). Reads new HCP payment-notification
// emails from team@skylod.com, extracts the real Tip line (never the subject's
// dollar amount, which is Amount Paid), matches the job to its assigned
// tech(s), and writes tip_entries -- the same table/shape the "Log a Tip"
// admin form writes, per that form's own comment anticipating this exact
// automation.
//
// Design summary (see PR description for the full writeup):
//   - "Already processed" is tracked per Gmail message id in
//     processed_tip_emails, independent of Gmail's read/unread state.
//   - A job is looked up by matching HCP's `invoice_number` field (the
//     customer-facing "Job Number") against jobs in a date window around the
//     email's Service Date -- same query shape hcp-backfill.js already uses,
//     just matched client-side since /jobs has no invoice_number filter.
//   - Single tech assigned -> tip written immediately, keyed by the job's
//     internal `id` as hcp_job_id so re-processing can't double-enter it.
//   - Multiple techs, split already confirmed (job_splits) -> tip divided by
//     those same confirmed percentages, one row per tech.
//   - Multiple techs, no confirmed split yet -> tip held in
//     pending_tip_splits (not guessed, not entered) until someone confirms
//     the split in the existing Split Jobs admin UI; a later run of this same
//     function then finishes writing it.

const TECH_MAP = require('./lib/techMap');
const { fetchJobSplits, resolveSplits } = require('./lib/splitHelper');
const { getAccessToken, listMessageIds, getMessage } = require('./lib/gmailClient');
const { parseTipEmail } = require('./lib/tipEmailParser');

const FETCH_TIMEOUT_MS = 10000;
const HCP_SENDER = "notifications@housecallpro.com";
const PAD_DAYS = 5; // same padding hcp-backfill.js uses around scheduled_start

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
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
  const isPostgrestError = !res.ok || (data && typeof data === "object" && !Array.isArray(data) && (data.code || data.message));
  if (isPostgrestError) {
    throw new Error(`Supabase error on ${path} (HTTP ${res.status}): ${(data && (data.message || data.code)) || text}`);
  }
  return data;
}

async function hcpGet(path) {
  const res = await fetchWithTimeout(`https://api.housecallpro.com/${path}`, {
    headers: { "Authorization": `Token ${process.env.HCP_API_KEY}`, "Content-Type": "application/json" },
  });
  if (!res.ok) { console.error("HCP error", res.status, path); return null; }
  const text = await res.text();
  if (!text) return null;
  return JSON.parse(text);
}

function addDays(dateStr, days) {
  const d = new Date(dateStr + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split("T")[0];
}

// Finds the job whose invoice_number matches, searching a window around the
// service date rather than relying on an (undocumented, untested) API filter.
async function findJobByInvoiceNumber(invoiceNumber, serviceDateISO) {
  const from = addDays(serviceDateISO, -PAD_DAYS) + "T00:00:00-06:00";
  const to   = addDays(serviceDateISO, PAD_DAYS) + "T23:59:59-06:00";
  let page = 1;
  const pageSize = 100;
  while (page <= 20) { // hard stop -- ~2000 jobs is far more than one 10-day window should ever return
    const qs = [
      `scheduled_start_min=${encodeURIComponent(from)}`,
      `scheduled_start_max=${encodeURIComponent(to)}`,
      `page=${page}`,
      `page_size=${pageSize}`,
    ].join("&");
    const data = await hcpGet(`jobs?${qs}`);
    const jobs = data?.jobs || data?.results || [];
    if (jobs.length === 0) break;
    const found = jobs.find(j => String(j.invoice_number || "") === String(invoiceNumber));
    if (found) return found;
    if (jobs.length < pageSize) break;
    page++;
  }
  return null;
}

function matchedEmployeesFor(job) {
  return (job.assigned_employees || []).map(e => {
    const hcpName = `${e.first_name || ""} ${e.last_name || ""}`.trim();
    const skyloName = TECH_MAP[hcpName];
    return skyloName ? { skyloName } : null;
  }).filter(Boolean);
}

async function getTechByName() {
  const allTechs = await sbFetch("techs?select=id,name,is_active&order=id");
  const techByName = {};
  for (const t of (allTechs || [])) {
    const existing = techByName[t.name];
    if (!existing || (t.is_active && !existing.is_active)) techByName[t.name] = t;
  }
  return techByName;
}

async function markProcessed(gmailMessageId, hcpJobId, status, detail) {
  await sbFetch("processed_tip_emails?on_conflict=gmail_message_id", {
    method: "POST",
    prefer: "resolution=merge-duplicates,return=minimal",
    body: JSON.stringify({ gmail_message_id: gmailMessageId, hcp_job_id: hcpJobId || null, status, detail: detail || null }),
  });
}

async function writeSingleTechTip(job, techId, workDate, amount) {
  await sbFetch("tip_entries?on_conflict=hcp_job_id,tech_id", {
    method: "POST",
    prefer: "resolution=merge-duplicates,return=minimal",
    body: JSON.stringify({ hcp_job_id: job.id, tech_id: techId, work_date: workDate, amount }),
  });
}

// Attempts to resolve one job's tip against confirmed job_splits.
// Returns true if it wrote (or the job turned out single-tech), false if
// still unconfirmed (caller decides whether to hold it in pending_tip_splits).
async function resolveAndWriteTip(job, matchedEmployees, techByName, workDate, tipAmount) {
  if (matchedEmployees.length === 1) {
    const tech = techByName[matchedEmployees[0].skyloName];
    if (!tech) return { written: false, reason: "no_tech_match" };
    await writeSingleTechTip(job, tech.id, workDate, tipAmount);
    return { written: true };
  }

  const splitMap = await fetchJobSplits([job.id], sbFetch);
  const splits = resolveSplits(job.id, matchedEmployees, splitMap, techByName);
  const allConfirmed = splits.length > 0 && splits.every(s => s.confirmed);
  if (!allConfirmed) return { written: false, reason: "unconfirmed_split" };

  for (const split of splits) {
    const tech = techByName[split.skyloName];
    if (!tech) continue;
    const amount = +(tipAmount * split.pct).toFixed(2);
    await writeSingleTechTip(job, tech.id, workDate, amount);
  }
  return { written: true };
}

exports.handler = async () => {
  const missingEnv = ["GMAIL_CLIENT_ID", "GMAIL_CLIENT_SECRET", "GMAIL_REFRESH_TOKEN", "SUPABASE_URL", "SUPABASE_KEY", "HCP_API_KEY"]
    .filter(k => !process.env[k]);
  if (missingEnv.length) {
    console.error("hcp-tip-sync missing env vars:", missingEnv.join(", "));
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: `Missing env vars: ${missingEnv.join(", ")}` }) };
  }

  // --- 1. Load or initialize the cursor -----------------------------------
  const stateRows = await sbFetch("automation_state?key=eq.tip_sync_since&select=value");
  const nowEpoch = Math.floor(Date.now() / 1000);
  if (!stateRows || stateRows.length === 0) {
    // First-ever run: set the baseline to now and do nothing else. Per spec,
    // this automation only ever looks forward from when it started running,
    // never backfills the inbox's history.
    await sbFetch("automation_state?on_conflict=key", {
      method: "POST", prefer: "resolution=merge-duplicates,return=minimal",
      body: JSON.stringify({ key: "tip_sync_since", value: String(nowEpoch) }),
    });
    console.log("hcp-tip-sync: initialized cursor, no backfill performed");
    return { statusCode: 200, body: JSON.stringify({ ok: true, initialized: true }) };
  }
  const sinceEpoch = parseInt(stateRows[0].value, 10);

  // --- 2. Fetch new payment emails ----------------------------------------
  const accessToken = await getAccessToken();
  const ids = await listMessageIds(accessToken, sinceEpoch);

  let maxInternalDate = sinceEpoch * 1000;
  const summary = { checked: ids.length, written: 0, written_split: 0, pending_split: 0, zero_tip: 0, skipped: 0, errors: 0 };

  const alreadyDoneRows = ids.length
    ? await sbFetch(`processed_tip_emails?gmail_message_id=in.(${ids.map(id => `"${id}"`).join(",")})&select=gmail_message_id`)
    : [];
  const alreadyDone = new Set((alreadyDoneRows || []).map(r => r.gmail_message_id));

  for (const id of ids) {
    if (alreadyDone.has(id)) continue;
    try {
      const msg = await getMessage(accessToken, id);
      maxInternalDate = Math.max(maxInternalDate, msg.internalDate);

      if (msg.fromEmail !== HCP_SENDER) {
        await markProcessed(id, null, "sender_mismatch", msg.fromEmail);
        summary.skipped++;
        continue;
      }

      // HCP sends many other notification types from this same address
      // (appointment reminders, review requests, etc.) -- only the "You just
      // got paid!" template is an actual payment receipt worth parsing.
      if (!/you\s+just\s+got\s+paid/i.test(msg.bodyText)) {
        await markProcessed(id, null, "not_payment_email");
        summary.skipped++;
        continue;
      }

      const parsed = parseTipEmail(msg.bodyText);
      if (!parsed.jobNumber || !parsed.serviceDateISO) {
        await markProcessed(id, null, "parse_error", JSON.stringify(parsed));
        summary.errors++;
        continue;
      }
      if (!parsed.tipAmount || parsed.tipAmount <= 0) {
        await markProcessed(id, null, "zero_tip");
        summary.zero_tip++;
        continue;
      }

      const job = await findJobByInvoiceNumber(parsed.jobNumber, parsed.serviceDateISO);
      if (!job) {
        await markProcessed(id, null, "job_not_found", `invoice_number=${parsed.jobNumber}`);
        summary.errors++;
        continue;
      }

      const matchedEmployees = matchedEmployeesFor(job);
      if (matchedEmployees.length === 0) {
        await markProcessed(id, job.id, "no_tech_match");
        summary.skipped++;
        continue;
      }

      const techByName = await getTechByName();
      const result = await resolveAndWriteTip(job, matchedEmployees, techByName, parsed.serviceDateISO, parsed.tipAmount);

      if (result.written) {
        await markProcessed(id, job.id, matchedEmployees.length > 1 ? "written_split" : "written");
        summary[matchedEmployees.length > 1 ? "written_split" : "written"]++;
      } else {
        // Hold for the split-confirmation resolver pass below.
        await sbFetch("pending_tip_splits?on_conflict=hcp_job_id", {
          method: "POST",
          prefer: "resolution=merge-duplicates,return=minimal",
          body: JSON.stringify({
            hcp_job_id: job.id,
            job_date: parsed.serviceDateISO,
            tip_amount: parsed.tipAmount,
            employee_names: JSON.stringify(matchedEmployees.map(e => e.skyloName)),
          }),
        });
        await markProcessed(id, job.id, "pending_split");
        summary.pending_split++;
      }
    } catch (err) {
      console.error(`hcp-tip-sync: error processing message ${id}:`, err.message);
      summary.errors++;
      // Deliberately NOT marked processed -- a transient error (HCP/Supabase
      // hiccup) should retry on the next run rather than being silently lost.
    }
  }

  if (ids.length > 0) {
    await sbFetch("automation_state?on_conflict=key", {
      method: "POST", prefer: "resolution=merge-duplicates,return=minimal",
      body: JSON.stringify({ key: "tip_sync_since", value: String(Math.floor(maxInternalDate / 1000) + 1) }),
    });
  }

  // --- 3. Resolver pass: pending split-tips that may now be confirmed -----
  const pending = await sbFetch("pending_tip_splits?select=*") || [];
  let resolved = 0;
  for (const p of pending) {
    try {
      const job = { id: p.hcp_job_id };
      const names = JSON.parse(p.employee_names || "[]");
      const matchedEmployees = names.map(n => ({ skyloName: n }));
      const techByName = await getTechByName();
      const result = await resolveAndWriteTip(job, matchedEmployees, techByName, p.job_date, p.tip_amount);
      if (result.written) {
        await sbFetch(`pending_tip_splits?hcp_job_id=eq.${p.hcp_job_id}`, { method: "DELETE", prefer: "return=minimal" });
        resolved++;
      }
    } catch (err) {
      console.error(`hcp-tip-sync: resolver error for job ${p.hcp_job_id}:`, err.message);
    }
  }

  console.log("hcp-tip-sync summary:", JSON.stringify({ ...summary, resolved_pending: resolved }));
  return { statusCode: 200, body: JSON.stringify({ ok: true, ...summary, resolved_pending: resolved }) };
};
