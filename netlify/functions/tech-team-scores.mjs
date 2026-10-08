// netlify/functions/tech-team-scores.mjs
// Team scores for a tech's Audits tab: the company-wide average and each
// team's average of the members' full weekly scores (Tote Check, Tech Audit
// and Driving, combined by techScores.js -- the same file the app uses).
// Any logged-in user can read it. Only averages and team names come back --
// never another tech's checks, misses, trucks or driving events.
// Display only -- not tied to pay.
//
// GET ?from=YYYY-MM-DD&to=YYYY-MM-DD
// Header: Authorization: Bearer <login token>

import auth from "./lib/authToken.js";
import { techScoreCard, teamSummary } from "../../techScores.js";

const PAGE = 1000;
const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s || "");
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

async function sbGetAll(path, { optional = false } = {}) {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const res = await fetch(`${process.env.SUPABASE_URL}/rest/v1/${path}`, {
      headers: { apikey: process.env.SUPABASE_KEY, Authorization: `Bearer ${process.env.SUPABASE_KEY}`, Range: `${from}-${from + PAGE - 1}` },
    });
    if (!res.ok) {
      const text = await res.text();
      // The driver scorecard tables may not exist yet: score without them.
      if (optional && /42P01|does not exist/.test(text)) return null;
      throw new Error(`Supabase ${path.split("?")[0]} (HTTP ${res.status}): ${text.slice(0, 200)}`);
    }
    const page = await res.json();
    rows.push(...page);
    if (page.length < PAGE) return rows;
  }
}

export default async (req) => {
  const headers = Object.fromEntries(req.headers);
  const who = auth.verifyToken(auth.tokenFrom({ headers }));
  if (!who) return json(401, { error: "Log in again" });
  const url = new URL(req.url);
  const from = url.searchParams.get("from"), to = url.searchParams.get("to");
  if (!isDate(from) || !isDate(to)) return json(400, { error: "from and to must be YYYY-MM-DD" });
  if ((Date.parse(to) - Date.parse(from)) / 864e5 > 62) return json(400, { error: "Pick a range of 62 days or less" });
  const range = `work_date=gte.${from}&work_date=lte.${to}`;
  try {
    const [techs, subs, vehicles, assignments, daily, events, unassigned] = await Promise.all([
      sbGetAll("techs?select=id,name,is_lead,team_lead_id,team_name,is_active,title"),
      sbGetAll(`ghl_form_submissions?select=id,form_id,submitted_at,work_date,tech_name,tech_id,answers,fields:raw->others&${range}`),
      sbGetAll("vehicles?select=id,name,vin", { optional: true }),
      sbGetAll(`truck_assignments?select=tech_id,vehicle_id,work_date,shared&${range}`, { optional: true }),
      sbGetAll(`ford_vehicle_daily?select=vin,work_date,miles,trips,idle_minutes,speeding_minutes&${range}`, { optional: true }),
      sbGetAll(`ford_vehicle_events?select=vin,work_date,event_type,mph_over,duration_sec&${range}`, { optional: true }),
      sbGetAll(`unassigned_driving?select=vin,work_date,assigned_tech_id,dismissed&${range}`, { optional: true }),
    ]);
    const driverData = vehicles ? { vehicles, assignments: assignments || [], daily: daily || [], events: events || [], unassigned: unassigned || [] } : null;
    const active = techs.filter(t => t.is_active !== false && t.title !== "owner");
    const cards = active.map(t => techScoreCard(subs.filter(s => s.tech_id === t.id), driverData, t.id));
    const { company, teams } = teamSummary(cards, techs);
    const strip = t => ({ name: t.name, lead: t.lead, score: t.score, pass: t.pass, scored: t.scored, members: t.members, tote: t.tote, audit: t.audit, driver: t.driver });
    const mine = who.techId ? teams.find(t => t.memberIds.includes(who.techId)) : null;
    return json(200, { company, teams: teams.map(strip), my_team: mine ? mine.name : null });
  } catch (e) {
    return json(500, { error: e.message });
  }
};
