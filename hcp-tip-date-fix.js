// netlify/functions/hcp-tip-date-fix.js
// ONE-OFF, manually-triggered correction: the earlier retroactive fix that set
// tip_entries.work_date using processed_tip_emails.created_at as a stand-in for
// "day the payment cleared" was wrong for every job caught up in a processing
// backlog -- created_at reflects when our system finally got around to reading
// the email, not when HCP actually sent it. This re-fetches each email's own
// Gmail timestamp (the true payment date) and corrects work_date to match.
//
// Not scheduled. Visit this function's URL once to run it, then this file can
// be deleted.

const { getAccessToken, getMessage } = require("./lib/gmailClient");

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

async function sbFetch(path, options = {}) {
  const res = await fetchWithTimeout(`${process.env.SUPABASE_URL}/rest/v1/${path}`, {
    method: options.method || "GET",
    body: options.body,
    headers: {
      "Content-Type": "application/json",
      apikey: process.env.SUPABASE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_KEY}`,
      Prefer: options.prefer || "return=representation",
    },
  });
  if (res.status === 204) return null;
  const text = await res.text();
  if (!text) return null;
  const data = JSON.parse(text);
  const isPostgrestError =
    !res.ok ||
    (data && typeof data === "object" && !Array.isArray(data) && (data.code || data.message));
  if (isPostgrestError) {
    throw new Error(`Supabase error on ${path} (HTTP ${res.status}): ${(data && (data.message || data.code)) || text}`);
  }
  return data;
}

// Mountain-time day boundary, matching the fixed UTC-6 offset used elsewhere
// in this app (e.g. AdminTipEntry's date default, formatMTTime) and matching
// the same helper added to hcp-tip-sync.js.
function toPaidDateISO(internalDateMs) {
  const d = new Date(internalDateMs - 6 * 60 * 60 * 1000);
  return d.toISOString().split("T")[0];
}

exports.handler = async () => {
  const missingEnv = ["GMAIL_CLIENT_ID", "GMAIL_CLIENT_SECRET", "GMAIL_REFRESH_TOKEN", "SUPABASE_URL", "SUPABASE_KEY"].filter(
    (k) => !process.env[k]
  );
  if (missingEnv.length) {
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: `Missing env vars: ${missingEnv.join(", ")}` }) };
  }

  // Only rows that came from the automation (manual "Log a Tip" entries have
  // no gmail_message_id / hcp_job_id and are untouched by this).
  const rows = await sbFetch("processed_tip_emails?hcp_job_id=not.is.null&select=gmail_message_id,hcp_job_id");
  const accessToken = await getAccessToken();

  let fixed = 0;
  let errors = 0;
  const results = [];

  for (const row of rows || []) {
    try {
      const msg = await getMessage(accessToken, row.gmail_message_id);
      const trueDate = toPaidDateISO(msg.internalDate);
      await sbFetch(`tip_entries?hcp_job_id=eq.${row.hcp_job_id}`, {
        method: "PATCH",
        prefer: "return=minimal",
        body: JSON.stringify({ work_date: trueDate }),
      });
      results.push({ hcp_job_id: row.hcp_job_id, gmail_message_id: row.gmail_message_id, trueDate });
      fixed++;
    } catch (err) {
      console.error(`hcp-tip-date-fix: error on ${row.gmail_message_id}:`, err.message);
      errors++;
      results.push({ hcp_job_id: row.hcp_job_id, gmail_message_id: row.gmail_message_id, error: err.message });
    }
  }

  return { statusCode: 200, body: JSON.stringify({ ok: true, totalRows: (rows || []).length, fixed, errors, results }) };
};
