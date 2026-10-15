// netlify/functions/damage-reports.js
// Damage reports (damage a tech caused to a client's vehicle or property).
// The table is closed to the browser; this checks the login token.
//   Full reports (customer, items, cost, reason): owners, the Field
//   Supervisor (manager login) and the tech ids in VIEWER_TECH_IDS (Zak).
//   Everyone else gets only what scoring needs (tech, share, job date,
//   level), so Journey points and Tech Scores still match for every login.
// GET                      -> { rows }
// POST { rows:[...] }      -> add (viewers only)
// DELETE ?group_id= | ?id= -> remove (viewers only)
// Header: Authorization: Bearer <login token>
const { verifyToken, tokenFrom } = require("./lib/authToken");

const VIEWER_TECH_IDS = [
  "7709e828-baec-41be-8e7e-055024b0a863", // Zak Lundblade
];
const SCORE_COLS = "id,tech_id,weight,group_id,job_date,severity,created_at";
const COLS = ["tech_id", "weight", "group_id", "job_date", "customer_name", "job_number", "hcp_job_id", "damaged_items", "severity", "repair_cost", "reason"];
const isUuid = s => /^[0-9a-f-]{36}$/i.test(s || "");

const json = (statusCode, body) => ({ statusCode, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }, body: JSON.stringify(body) });

async function sb(path, options = {}) {
  const res = await fetch(`${process.env.SUPABASE_URL}/rest/v1/${path}`, {
    method: options.method || "GET", body: options.body,
    headers: { "Content-Type": "application/json", apikey: process.env.SUPABASE_KEY, Authorization: `Bearer ${process.env.SUPABASE_KEY}`, Prefer: options.prefer || "return=representation" },
  });
  if (res.status === 204) return null;
  const text = await res.text();
  if (!res.ok) throw new Error(`Supabase ${path.split("?")[0]} (HTTP ${res.status}): ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}

exports.handler = async (event) => {
  const who = verifyToken(tokenFrom(event));
  if (!who) return json(401, { error: "Log in again" });
  const viewer = who.role === "owner" || who.role === "manager" || VIEWER_TECH_IDS.includes(who.techId);
  try {
    if (event.httpMethod === "GET") {
      const rows = await sb(`damage_reports?select=${viewer ? "*" : SCORE_COLS}&order=created_at.desc&limit=5000`);
      return json(200, { rows: rows || [], full: viewer });
    }
    if (!viewer) return json(403, { error: "Only owners, Will and Zak can log damage" });
    if (event.httpMethod === "POST") {
      let body; try { body = JSON.parse(event.body || "{}"); } catch { return json(400, { error: "Bad request" }); }
      const rows = (Array.isArray(body.rows) ? body.rows : []).map(r => Object.fromEntries(COLS.filter(k => k in r).map(k => [k, r[k]])));
      if (!rows.length || rows.length > 20 || rows.some(r => !isUuid(r.tech_id))) return json(400, { error: "Pick the tech" });
      await sb("damage_reports", { method: "POST", prefer: "return=minimal", body: JSON.stringify(rows) });
      return json(200, { ok: true });
    }
    if (event.httpMethod === "DELETE") {
      const q = event.queryStringParameters || {};
      const filter = isUuid(q.group_id) ? `group_id=eq.${q.group_id}` : isUuid(q.id) ? `id=eq.${q.id}` : null;
      if (!filter) return json(400, { error: "Bad request" });
      await sb(`damage_reports?${filter}`, { method: "DELETE", prefer: "return=minimal" });
      return json(200, { ok: true });
    }
    return json(405, { error: "Method not allowed" });
  } catch (e) {
    console.error("damage-reports:", e.message);
    return json(500, { error: e.message });
  }
};
