// netlify/functions/driver-scores.js
// Ford Pro driver scorecard data for the Audit Scores tab. The Ford tables
// (ford_vehicle_daily, ford_vehicle_events, unassigned_driving) aren't
// readable from the browser, so this checks the login token and reads them
// with the service key. Owners and the Field Supervisor get every tech; a
// tech gets only their own trucks' days. Scoring happens in the app
// (driverScoring.js). Display only -- not tied to pay.
//
// GET  ?from=YYYY-MM-DD&to=YYYY-MM-DD
// POST ?action=assign  body: { vin, work_date, tech_id }   (owner/manager)
//      ?action=dismiss body: { vin, work_date }            (owner/manager)
//      ?action=import  body: { work_date, daily: [...], events: [...] }  (owner/manager)
//        rows built in the browser from Ford's daily report CSVs by
//        fordReports.js (no locations). Re-importing a day upserts.
//        Saved by lib/fordImport.js, the same code the automatic Ford email
//        import (ford-email-import.mjs) uses.
// Header: Authorization: Bearer <login token>

const { verifyToken, tokenFrom } = require("./lib/authToken");
const { sb, importReports } = require("./lib/fordImport");

const PAGE = 1000;
const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s || "");
const isVin = s => /^[A-HJ-NPR-Z0-9]{17}$/i.test(s || "");
const isUuid = s => /^[0-9a-f-]{36}$/i.test(s || "");

function json(statusCode, body) {
  return { statusCode, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }, body: JSON.stringify(body) };
}

async function sbGetAll(path) {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const page = await sb(path, { range: `${from}-${from + PAGE - 1}` });
    rows.push(...(page || []));
    if (!page || page.length < PAGE) return rows;
  }
}

exports.handler = async (event) => {
  const who = verifyToken(tokenFrom(event));
  if (!who) return json(401, { error: "Log in again" });
  const admin = who.role === "owner" || who.role === "manager";
  const q = event.queryStringParameters || {};

  try {
    if (event.httpMethod === "POST") {
      if (!admin) return json(403, { error: "Owners and managers only" });
      let b; try { b = JSON.parse(event.body || "{}"); } catch { return json(400, { error: "Bad JSON" }); }
      const by = who.name || (who.techId ? `tech:${who.techId}` : who.role);
      if (q.action === "import") return json(200, await importReports(b, by));
      if (!isVin(b.vin) || !isDate(b.work_date)) return json(400, { error: "vin and work_date required" });
      let row;
      if (q.action === "assign") {
        if (b.tech_id !== null && !isUuid(b.tech_id)) return json(400, { error: "tech_id required (or null to unassign)" });
        row = { vin: b.vin.toUpperCase(), work_date: b.work_date, miles: b.miles ?? null, assigned_tech_id: b.tech_id, assigned_by: b.tech_id ? by : null, assigned_at: b.tech_id ? new Date().toISOString() : null, dismissed: false };
      } else if (q.action === "dismiss") {
        row = { vin: b.vin.toUpperCase(), work_date: b.work_date, miles: b.miles ?? null, assigned_tech_id: null, assigned_by: by, assigned_at: new Date().toISOString(), dismissed: true };
      } else return json(400, { error: "Unknown action" });
      await sb("unassigned_driving?on_conflict=vin,work_date", { method: "POST", prefer: "resolution=merge-duplicates,return=minimal", body: JSON.stringify(row) });
      return json(200, { ok: true });
    }

    if (!isDate(q.from) || !isDate(q.to)) return json(400, { error: "from and to must be YYYY-MM-DD" });
    if (!admin && !who.techId) return json(403, { error: "No tech on this login" });
    if (!admin && (Date.parse(q.to) - Date.parse(q.from)) / 864e5 > 62) return json(400, { error: "Pick a range of 62 days or less" });
    const range = `work_date=gte.${q.from}&work_date=lte.${q.to}`;
    const vehicles = await sbGetAll("vehicles?select=id,name,vin,active&order=name");
    let assignments = await sbGetAll(`truck_assignments?select=tech_id,vehicle_id,work_date,shared&${range}`);
    let unassigned = await sbGetAll(`unassigned_driving?select=vin,work_date,miles,assigned_tech_id,assigned_by,dismissed&${range}`);

    // A tech sees their own picks, plus (anonymized) anyone else on the same
    // truck the same day so a shared truck shows as shared.
    let vins = null, myDays = null;
    if (!admin) {
      const mine = assignments.filter(a => a.tech_id === who.techId);
      assignments = assignments.filter(a => a.tech_id === who.techId || mine.some(m => m.vehicle_id === a.vehicle_id && m.work_date === a.work_date))
        .map(a => a.tech_id === who.techId ? a : { ...a, tech_id: "other" });
      unassigned = unassigned.filter(u => u.assigned_tech_id === who.techId);
      const vinById = Object.fromEntries(vehicles.map(v => [v.id, v.vin]));
      vins = [...new Set([...mine.map(a => vinById[a.vehicle_id]), ...unassigned.map(u => u.vin)].filter(Boolean))];
      // Only the days THIS tech had the truck -- not other techs' days on it.
      myDays = new Set([...mine.map(a => `${vinById[a.vehicle_id]}|${a.work_date}`), ...unassigned.map(u => `${u.vin}|${u.work_date}`)]);
    }
    const vinFilter = vins ? `&vin=in.(${vins.map(encodeURIComponent).join(",") || "none"})` : "";
    const mineOnly = rows => myDays ? rows.filter(r => myDays.has(`${r.vin}|${r.work_date}`)) : rows;
    const daily = mineOnly(await sbGetAll(`ford_vehicle_daily?select=vin,work_date,miles,trips,idle_minutes,speeding_minutes&${range}${vinFilter}`));
    const events = mineOnly(await sbGetAll(`ford_vehicle_events?select=vin,work_date,event_time,event_type,mph_over,speed_mph,limit_mph,duration_sec&${range}${vinFilter}&order=event_time`));
    let lastPull = null;
    if (admin) {
      const s = await sb("ghl_sync_state?key=eq.ford_last_run&select=value,updated_at").catch(() => []);
      lastPull = s && s[0] ? { ...s[0].value, updated_at: s[0].updated_at } : null;
    }
    return json(200, { vehicles, assignments, unassigned, daily, events, last_pull: lastPull });
  } catch (e) {
    return json(e.status || 500, { error: e.missingTable ? "The driver scorecard tables haven't been created yet (migration not applied)" : e.message });
  }
};
