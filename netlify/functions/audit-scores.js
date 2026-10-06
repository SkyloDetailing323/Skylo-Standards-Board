// netlify/functions/audit-scores.js
// Tote Check and Tech Audit submissions for the Audit Scores tab. The
// ghl_form_submissions table isn't readable from the browser (same as the
// other GHL tables), so this checks the login token and reads it with the
// service key: owners and the Field Supervisor get every tech, a tech gets
// only their own submissions. Scoring happens in the app (auditScoring.js).
//
// GET ?from=YYYY-MM-DD&to=YYYY-MM-DD
// Header: Authorization: Bearer <login token>

const { verifyToken, tokenFrom } = require("./lib/authToken");

const PAGE = 1000;
const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s || "");

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

exports.handler = async (event) => {
  const who = verifyToken(tokenFrom(event));
  if (!who) return json(401, { error: "Log in again" });
  const q = event.queryStringParameters || {};
  if (!isDate(q.from) || !isDate(q.to)) return json(400, { error: "from and to must be YYYY-MM-DD" });

  const admin = who.role === "owner" || who.role === "manager";
  if (!admin && !who.techId) return json(403, { error: "No tech on this login" });
  const techFilter = admin ? "" : `&tech_id=eq.${encodeURIComponent(who.techId)}`;
  try {
    const submissions = await sbGetAll(`ghl_form_submissions?select=id,form_id,submitted_at,work_date,tech_name,tech_id,answers&work_date=gte.${q.from}&work_date=lte.${q.to}${techFilter}&order=work_date.desc,submitted_at.desc`);
    let lastRun = null;
    if (admin) {
      const s = await sbGetAll("ghl_sync_state?key=eq.forms_last_run&select=value,updated_at").catch(() => []);
      lastRun = s[0] ? { ...s[0].value, updated_at: s[0].updated_at } : null;
    }
    return json(200, { submissions, last_run: lastRun });
  } catch (e) {
    return json(500, { error: /ghl_form_submissions/.test(e.message) && /42P01|does not exist/.test(e.message) ? "The ghl_form_submissions table hasn't been created yet (migration not applied)" : e.message });
  }
};
