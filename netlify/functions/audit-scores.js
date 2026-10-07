// netlify/functions/audit-scores.js
// Tote Check and Tech Audit submissions for the Audit Scores tab. The
// ghl_form_submissions table isn't readable from the browser (same as the
// other GHL tables), so this checks the login token and reads it with the
// service key: owners and the Field Supervisor get every tech, a tech gets
// only their own submissions. Scoring happens in the app (auditScoring.js).
//
// GET ?from=YYYY-MM-DD&to=YYYY-MM-DD[&kind=tote]
//   Admins also get tote_waivers (items waived from the Payroll deduction).
// POST { submission_id, item, waived } -- owners only: waive (or un-waive) a
//   Tote Check item so Payroll doesn't deduct it.
// Header: Authorization: Bearer <login token>

const { verifyToken, tokenFrom } = require("./lib/authToken");

const PAGE = 1000;
const TOTE_FORM_ID = "xU7BPLPkUCLiefCvawVx";
const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s || "");
// GHL bookkeeping in a submission's raw answers -- never sent to the browser.
const PRIVATE_KEYS = ["signatureHash", "ip", "sessionId", "submissionId", "location_id", "eventData", "Timezone", "formId"];

function json(statusCode, body) {
  return { statusCode, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }, body: JSON.stringify(body) };
}

async function sbGetAll(path) {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const res = await fetch(`${process.env.SUPABASE_URL}/rest/v1/${path}`, {
      headers: { apikey: process.env.SUPABASE_KEY, Authorization: `Bearer ${process.env.SUPABASE_KEY}`, Range: `${from}-${from + PAGE - 1}` },
    });
    if (!res.ok) throw new Error(`Supabase ${path.split("?")[0]} (HTTP ${res.status}): ${(await res.text()).slice(0, 300)}`);
    const page = await res.json();
    rows.push(...page);
    if (page.length < PAGE) return rows;
  }
}

async function setWaiver(who, body) {
  if (who.role !== "owner") return json(403, { error: "Only owners can waive tote deductions" });
  const { submission_id, item, waived } = body || {};
  if (!submission_id || !item || typeof submission_id !== "string" || typeof item !== "string") return json(400, { error: "submission_id and item are required" });
  const base = `${process.env.SUPABASE_URL}/rest/v1/tote_waivers`;
  const headers = { apikey: process.env.SUPABASE_KEY, Authorization: `Bearer ${process.env.SUPABASE_KEY}`, "Content-Type": "application/json" };
  const res = waived
    ? await fetch(base, { method: "POST", headers: { ...headers, Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify({ submission_id, item, waived_by: who.name || "owner" }) })
    : await fetch(`${base}?submission_id=eq.${encodeURIComponent(submission_id)}&item=eq.${encodeURIComponent(item)}`, { method: "DELETE", headers: { ...headers, Prefer: "return=minimal" } });
  if (!res.ok) return json(500, { error: `Couldn't save (HTTP ${res.status}): ${(await res.text()).slice(0, 200)}` });
  return json(200, { ok: true });
}

exports.handler = async (event) => {
  const who = verifyToken(tokenFrom(event));
  if (!who) return json(401, { error: "Log in again" });
  if (event.httpMethod === "POST") {
    let body; try { body = JSON.parse(event.body || "{}"); } catch { return json(400, { error: "Bad JSON" }); }
    return setWaiver(who, body);
  }
  const q = event.queryStringParameters || {};
  if (!isDate(q.from) || !isDate(q.to)) return json(400, { error: "from and to must be YYYY-MM-DD" });

  const admin = who.role === "owner" || who.role === "manager";
  if (!admin && !who.techId) return json(403, { error: "No tech on this login" });
  const techFilter = admin ? "" : `&tech_id=eq.${encodeURIComponent(who.techId)}`;
  const kindFilter = q.kind === "tote" ? `&form_id=eq.${TOTE_FORM_ID}` : "";
  try {
    const rows = await sbGetAll(`ghl_form_submissions?select=id,form_id,submitted_at,work_date,tech_name,tech_id,answers,fields:raw->others&work_date=gte.${q.from}&work_date=lte.${q.to}${techFilter}${kindFilter}&order=work_date.desc,submitted_at.desc`);
    // Tech Audits are scored by GHL field id, so they get the raw answers.
    const submissions = rows.map(r => {
      const fields = { ...(r.fields || {}) };
      PRIVATE_KEYS.forEach(k => delete fields[k]);
      return { ...r, fields };
    });
    let lastRun = null, toteWaivers = [];
    if (admin) toteWaivers = await sbGetAll("tote_waivers?select=submission_id,item,waived_by,created_at");
    if (admin) {
      const s = await sbGetAll("ghl_sync_state?key=eq.forms_last_run&select=value,updated_at").catch(() => []);
      lastRun = s[0] ? { ...s[0].value, updated_at: s[0].updated_at } : null;
    }
    return json(200, { submissions, last_run: lastRun, tote_waivers: toteWaivers });
  } catch (e) {
    return json(500, { error: /ghl_form_submissions/.test(e.message) && /42P01|does not exist/.test(e.message) ? "The ghl_form_submissions table hasn't been created yet (migration not applied)" : e.message });
  }
};
