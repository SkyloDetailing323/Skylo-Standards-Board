// netlify/functions/tech-team-scores.mjs
// Team scores for a tech's My Audits tab: the company-wide average and each
// team's average of the members' overall Tech Scores (Job Audit, Callbacks,
// Quota, Driving, Equipment & Truck -- combined by techScores.js, the same
// file the app uses) over the window the app asks for (the last 4 Wed-Tue
// weeks). Any logged-in user can read it. Only averages and team names come
// back -- never another tech's checks, callbacks, quota, trucks or driving.
// A team is only returned when at least MIN_TEAM_SCORED of its members have a
// score, so a small team's average can't give away one person's score.
// Display only -- not tied to pay.
//
// GET ?from=YYYY-MM-DD&to=YYYY-MM-DD
// Header: Authorization: Bearer <login token>

import auth from "./lib/authToken.js";
import { techScoreCard, teamSummary, TECH_SCORE_CONFIG } from "../../techScores.js";
import { AUDIT_CONFIG } from "../../auditScoring.js";
import { mountainDate } from "../../opsBonus.js";

const PAGE = 1000;
const MIN_TEAM_SCORED = 3;
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
      // Tables whose migration may not be applied yet: score without them.
      if (optional && /42P01|PGRST205|does not exist|Could not find the table/.test(text)) return null;
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
  const today = mountainDate(Date.now());
  // Quota is month to date for the month holding the window's last day.
  const asOf = today < to ? today : to;
  const monthKey = asOf.slice(0, 7), monthStart = `${monthKey}-01`;
  const jobsFrom = monthStart < from ? monthStart : from;
  try {
    const [techs, subs, vehicles, assignments, daily, events, unassigned, jobs, callbacks, reviews, switchovers, settings] = await Promise.all([
      sbGetAll("techs?select=id,name,is_lead,team_lead_id,team_name,is_active,title"),
      sbGetAll(`ghl_form_submissions?select=id,form_id,submitted_at,work_date,tech_name,tech_id,answers,fields:raw->others&${range}`),
      sbGetAll("vehicles?select=id,name,vin", { optional: true }),
      sbGetAll(`truck_assignments?select=tech_id,vehicle_id,work_date,shared&${range}`, { optional: true }),
      sbGetAll(`ford_vehicle_daily?select=vin,work_date,miles,trips,idle_minutes,speeding_minutes&${range}`, { optional: true }),
      sbGetAll(`ford_vehicle_events?select=vin,work_date,event_time,event_type,mph_over,duration_sec&${range}`, { optional: true }),
      sbGetAll(`unassigned_driving?select=vin,work_date,assigned_tech_id,dismissed&${range}`, { optional: true }),
      sbGetAll(`jobs?select=tech_id,job_date,revenue,upsell_amount&job_date=gte.${jobsFrom}&job_date=lte.${to}`),
      sbGetAll("callbacks?select=tech_id,weight,severity,job_date,created_at", { optional: true }),
      sbGetAll(`reviews?select=tech_id,month_key,count&month_key=eq.${monthKey}`, { optional: true }),
      sbGetAll("switchovers?select=tech_id,sold_date,created_at", { optional: true }),
      sbGetAll("settings?key=eq.quota&select=value", { optional: true }),
    ]);
    let quota = null;
    try { quota = settings && settings[0] ? (typeof settings[0].value === "string" ? JSON.parse(settings[0].value) : settings[0].value) : null; } catch { quota = null; }
    const truckIds = subs.filter(s => s.form_id === AUDIT_CONFIG.truck.formId).map(s => s.id);
    const truckGrades = [];
    for (let i = 0; i < truckIds.length; i += 100) {
      const list = truckIds.slice(i, i + 100).map(id => `"${String(id).replace(/"/g, "")}"`).join(",");
      const rows = await sbGetAll(`truck_check_grades?select=submission_id,score&submission_id=in.(${encodeURIComponent(list)})`, { optional: true });
      if (!rows) break;
      truckGrades.push(...rows);
    }
    const driverData = vehicles ? { vehicles, assignments: assignments || [], daily: daily || [], events: events || [], unassigned: unassigned || [] } : null;
    const active = techs.filter(t => t.is_active !== false && t.title !== "owner");
    const cards = active.map(t => techScoreCard({
      techId: t.id, tech: t, subs: subs.filter(s => s.tech_id === t.id), driverData,
      jobs, callbacks: callbacks || [], reviews: reviews || [], switchovers: switchovers || [], quota, truckGrades, from, to, today,
    }));
    const { company, teams } = teamSummary(cards, techs);
    const strip = t => {
      const out = { name: t.name, lead: t.lead, score: t.score, pass: t.pass, scored: t.scored, members: t.members };
      for (const s of TECH_SCORE_CONFIG.sections) out[s.key] = t[s.key];
      return out;
    };
    const shown = teams.filter(t => t.scored >= MIN_TEAM_SCORED);
    const mine = who.techId ? shown.find(t => t.memberIds.includes(who.techId)) : null;
    return json(200, { from, to, company: strip({ ...company, name: "Whole company", lead: null }), teams: shown.map(strip), my_team: mine ? mine.name : null,
      hidden_teams: teams.length - shown.length, min_team_scored: MIN_TEAM_SCORED });
  } catch (e) {
    return json(500, { error: e.message });
  }
};
