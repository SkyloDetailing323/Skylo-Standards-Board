// netlify/functions/audit-scores.js
// Tote Check and Tech Audit submissions for the Audit Scores tab. The
// ghl_form_submissions table isn't readable from the browser (same as the
// other GHL tables), so this checks the login token and reads it with the
// service key: owners and the Field Supervisor get every tech, a tech gets
// only their own submissions. Scoring happens in the app (auditScoring.js).
//
// GET ?from=YYYY-MM-DD&to=YYYY-MM-DD[&kind=tote|truck]
//   Admins also get tote_waivers (items waived from the Payroll deduction).
//   Everyone gets truck_grades: the Truck Check grades for the returned
//   submissions (so a tech only ever gets their own).
// POST { submission_id, item, waived } -- owners only: waive (or un-waive) a
//   Tote Check item so Payroll doesn't deduct it.
// POST { action:"truck_grade", submission_id, score, notes } -- owners and the
//   Field Supervisor: set or override a Truck Check grade (0-100).
// Header: Authorization: Bearer <login token>

const { verifyToken, tokenFrom } = require("./lib/authToken");

const PAGE = 1000;
const TOTE_FORM_ID = "xU7BPLPkUCLiefCvawVx";
const TRUCK_FORM_ID = "70rs6amtoR9LiP9BDY7E";   // AUDIT_CONFIG.truck.formId
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

// Owners and the Field Supervisor set (or override) a Truck Check grade.
async function setTruckGrade(who, body) {
  if (who.role !== "owner" && who.role !== "manager") return json(403, { error: "Only owners and the Field Supervisor can grade truck checks" });
  const { submission_id, notes } = body || {};
  const score = Number(body && body.score);
  if (!submission_id || typeof submission_id !== "string") return json(400, { error: "submission_id is required" });
  if (body.score === null || body.score === "" || !Number.isFinite(score) || score < 0 || score > 100) return json(400, { error: "Score must be a number from 0 to 100" });
  if (notes != null && typeof notes !== "string") return json(400, { error: "notes must be text" });
  const sub = await sbGetAll(`ghl_form_submissions?select=id,form_id&id=eq.${encodeURIComponent(submission_id)}`);
  if (!sub.length || sub[0].form_id !== TRUCK_FORM_ID) return json(404, { error: "That Truck Check wasn't found" });
  const res = await fetch(`${process.env.SUPABASE_URL}/rest/v1/truck_check_grades?on_conflict=submission_id`, {
    method: "POST",
    headers: { apikey: process.env.SUPABASE_KEY, Authorization: `Bearer ${process.env.SUPABASE_KEY}`, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify({ submission_id, score: Math.round(score * 10) / 10, notes: (notes || "").trim().slice(0, 2000) || null, graded_by: who.name || who.role, graded_at: new Date().toISOString() }),
  });
  if (!res.ok) return json(500, { error: `Couldn't save (HTTP ${res.status}): ${(await res.text()).slice(0, 200)}` });
  const rows = await res.json().catch(() => []);
  return json(200, { ok: true, grade: rows[0] || null });
}

// Grades for these submission ids. The table may not exist until its
// migration is applied: no grades then.
async function truckGradesFor(ids) {
  const out = [];
  for (let i = 0; i < ids.length; i += 100) {
    const list = ids.slice(i, i + 100).map(id => `"${String(id).replace(/"/g, "")}"`).join(",");
    try { out.push(...await sbGetAll(`truck_check_grades?select=submission_id,score,notes,graded_by,graded_at,checklist&submission_id=in.(${encodeURIComponent(list)})`)); }
    catch (e) { if (/42P01|PGRST205|does not exist|Could not find the table/.test(e.message)) return out; throw e; }
  }
  return out;
}

// GET ?photo=<GHL documentId>: a Truck Check photo. GHL's download links need
// the GHL login, so the photo is fetched here and passed through. Owners and
// the Field Supervisor see any; a tech only photos on their own submissions.
async function photo(who, docId) {
  if (!/^[A-Za-z0-9_-]{6,64}$/.test(docId || "")) return json(400, { error: "Bad photo id" });
  const admin = who.role === "owner" || who.role === "manager";
  const own = admin ? "" : `&tech_id=eq.${encodeURIComponent(who.techId || "none")}`;
  const rows = await sbGetAll(`ghl_form_submissions?select=id&form_id=eq.${TRUCK_FORM_ID}&raw->>others=like.*${docId}*${own}&limit=1`);
  if (!rows.length) return json(404, { error: "Photo not found" });
  const res = await fetch(`https://services.leadconnectorhq.com/documents/download/${docId}`, {
    headers: { Authorization: `Bearer ${process.env.GHL_TOKEN}`, Version: "2021-07-28" },
  });
  if (!res.ok) return json(502, { error: `GHL photo HTTP ${res.status}` });
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > 5.5 * 1024 * 1024) return json(413, { error: "Photo too large to show here" });
  return { statusCode: 200, isBase64Encoded: true, body: buf.toString("base64"),
    headers: { "Content-Type": res.headers.get("content-type") || "image/jpeg", "Cache-Control": "private, max-age=86400" } };
}

exports.handler = async (event) => {
  const who = verifyToken(tokenFrom(event));
  if (!who) return json(401, { error: "Log in again" });
  if (event.httpMethod === "GET" && (event.queryStringParameters || {}).photo) {
    try { return await photo(who, event.queryStringParameters.photo); } catch (e) { return json(500, { error: e.message }); }
  }
  if (event.httpMethod === "POST") {
    let body; try { body = JSON.parse(event.body || "{}"); } catch { return json(400, { error: "Bad JSON" }); }
    // Tote waivers predate the action field: no action = a waiver.
    if (body && body.action === "truck_grade") {
      try { return await setTruckGrade(who, body); } catch (e) { return json(500, { error: e.message }); }
    }
    return setWaiver(who, body);
  }
  const q = event.queryStringParameters || {};
  if (!isDate(q.from) || !isDate(q.to)) return json(400, { error: "from and to must be YYYY-MM-DD" });

  const admin = who.role === "owner" || who.role === "manager";
  if (!admin && !who.techId) return json(403, { error: "No tech on this login" });
  const techFilter = admin ? "" : `&tech_id=eq.${encodeURIComponent(who.techId)}`;
  const kindFilter = q.kind === "tote" ? `&form_id=eq.${TOTE_FORM_ID}` : q.kind === "truck" ? `&form_id=eq.${TRUCK_FORM_ID}` : "";
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
    const truckGrades = await truckGradesFor(submissions.filter(s => s.form_id === TRUCK_FORM_ID).map(s => s.id));
    return json(200, { submissions, last_run: lastRun, tote_waivers: toteWaivers, truck_grades: truckGrades });
  } catch (e) {
    return json(500, { error: /ghl_form_submissions/.test(e.message) && /42P01|does not exist/.test(e.message) ? "The ghl_form_submissions table hasn't been created yet (migration not applied)" : e.message });
  }
};
