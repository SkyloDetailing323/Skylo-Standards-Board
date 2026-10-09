// techScores.js
// The overall Tech Score: five sections, each 0-100, weighted --
//   Job Audit (Tech Audit form), Callbacks (quality), Quota (production,
//   month to date), Driving (Ford Pro) and Equipment & Truck (Tote Checks +
//   nightly Truck Check grades)
// -- over the last 4 Wed-Tue weeks, plus team scores (company-wide and per
// team lead's team). Pure functions, shared by the Tech Scores pages and
// netlify/functions/tech-team-scores.mjs so both compute the same numbers.
//
// Display only -- nothing here feeds pay or bonuses.

import { formKind, scoreToteCheck, scoreTechAudit, latestPerDay, auditDays, weeklyAuditPct } from "./auditScoring.js";
import { techDriverDays, weeklyDriverScore } from "./driverScoring.js";
import { PART_TIME_TITLE, PART_TIME_QUOTA, mountainDate } from "./opsBonus.js";

export const TECH_SCORE_CONFIG = {
  passLine: 85,
  // The overall score covers this many Wed-Tue weeks, ending with the week
  // picked on the page.
  windowWeeks: 4,
  // How much each section counts. A section with no data in the window (no
  // audits, no jobs, no Ford data...) is left out and the remaining weights
  // re-normalized, so missing data never counts as 0.
  sections: [
    { key: "audit",      label: "Job Audit",         icon: "📋", weight: 30 },
    { key: "quality",    label: "Callbacks",         icon: "📞", weight: 25 },
    { key: "production", label: "Quota",             icon: "💰", weight: 20 },
    { key: "driver",     label: "Driving",           icon: "🚗", weight: 15 },
    { key: "equipment",  label: "Equipment & Truck", icon: "🧰", weight: 10 },
  ],
  // Callbacks: start at 100, minus this per callback by severity level, times
  // the callback's split share (weight). Legacy rows with no level count as L3.
  callbackDeduction: { 1: 25, 2: 50, 3: 100 },
  // Quota: month to date for the month holding the window's last day. Each
  // target is prorated by days elapsed (at least minDaysElapsed, so the 1st
  // of the month isn't all-or-nothing); each metric caps at 100.
  production: {
    minDaysElapsed: 7,
    defaultTargets: { upsells: 400, reviews: 6, switchovers: 1 },
    metrics: [
      { key: "upsells",     label: "Upsells",     money: true },
      { key: "reviews",     label: "Reviews" },
      { key: "switchovers", label: "Switchovers" },
    ],
  },
  // Tote checks rescaled for this score only: $7.00 missing = 85 (the pass
  // line). Payroll and the Tote Checks page keep scoreToteCheck's own score.
  tote: { pointsPerDollar: 15 / 7 },
  // Nightly Truck Check, per night the tech worked (a job with revenue):
  // graded = the grade; submitted but not graded yet = notGradedScore;
  // worked but no Truck Check = missedScore. Apprentices still in training
  // (title detail_apprentice) don't have a truck of their own: no score.
  truck: { notGradedScore: 100, missedScore: 0, exemptTitles: ["detail_apprentice"] },
};

// ─── helpers ────────────────────────────────────────────────────────────────
const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const avg = xs => { const v = xs.filter(x => x != null && Number.isFinite(x)); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
const inRange = (d, from, to) => !!d && d >= from && d <= to;
export function addDays(dateStr, n) {
  const d = new Date(dateStr + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const daysInMonth = monthKey => { const [y, m] = monthKey.split("-").map(Number); return new Date(Date.UTC(y, m, 0)).getUTCDate(); };

// The window for a picked week (its Wednesday): the windowWeeks Wed-Tue weeks
// ending with it.
export function scoreWindow(weekStart, cfg = TECH_SCORE_CONFIG) {
  return { from: addDays(weekStart, -7 * (cfg.windowWeeks - 1)), to: addDays(weekStart, 6) };
}
// Same title rule as the rest of the app: no title = Detail Apprentice.
export const isTruckExempt = (tech, cfg = TECH_SCORE_CONFIG) => !!tech && cfg.truck.exemptTitles.includes(tech.title || "detail_apprentice");
// Days a tech worked: job dates with revenue.
export function workedDates(jobs, techId, from, to) {
  return [...new Set((jobs || []).filter(j => j.tech_id === techId && num(j.revenue) > 0 && inRange(j.job_date, from, to)).map(j => j.job_date))].sort();
}

// ─── weekly section pages (Tote Checks / Audit Scores / Driving) ───────────
// A tech's tote checks and tech audits (their GHL submissions).
export function techWeekScores(subs) {
  const toteAll = subs.filter(s => formKind(s.form_id) === "tote").map(s => scoreToteCheck(s));
  const totes = latestPerDay(toteAll.filter(t => !t.excluded));
  const excluded = toteAll.filter(t => t.excluded);
  const days = auditDays(subs.filter(s => formKind(s.form_id) === "audit").map(s => scoreTechAudit(s)));
  return { totes, excluded, latestTote: totes[0] || null, days, auditPct: weeklyAuditPct(days) };
}
// One week of one tech, for the per-section pages.
export function techWeekCard(subs, driverData, techId) {
  const week = techWeekScores(subs || []);
  let driver = null;
  if (driverData) { const days = techDriverDays(techId, driverData); driver = { days, ...weeklyDriverScore(days) }; }
  return { techId, week, driver, sections: { tote: week.latestTote ? week.latestTote.score : null, audit: week.auditPct, driver: driver?.score ?? null } };
}

// ─── section scores ─────────────────────────────────────────────────────────
export function toteEquipmentScore(missingCents, cfg = TECH_SCORE_CONFIG) {
  return Math.max(0, 100 - (num(missingCents) / 100) * cfg.tote.pointsPerDollar);
}

// The day the missed job was done (older rows only have created_at).
export function callbackDateOf(c) {
  return c.job_date || (c.created_at ? mountainDate(c.created_at) : null);
}
// callbacks: this tech's callbacks in the window. worked: the tech had jobs
// in the window (no jobs and no callbacks = no score).
export function qualityScore(callbacks, worked, cfg = TECH_SCORE_CONFIG) {
  const items = (callbacks || []).map(c => {
    const level = [1, 2, 3].includes(Number(c.severity)) ? Number(c.severity) : 3;
    const share = c.weight == null || !Number.isFinite(Number(c.weight)) ? 1 : Number(c.weight);
    return { id: c.id, date: callbackDateOf(c), level, legacy: c.severity == null, share, deduction: cfg.callbackDeduction[level] * share,
      customer: c.customer_name || null, reason: c.reason || null, missed: c.missed_items || null };
  }).sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
  const totalDeduction = items.reduce((s, i) => s + i.deduction, 0);
  if (!items.length && !worked) return { score: null, items, totalDeduction };
  return { score: Math.max(0, 100 - totalDeduction), items, totalDeduction };
}

// Monthly targets for a tech: the quota setting, or the part-time quota
// (Equipment Coordinator) -- same rule as opsBonus.js.
export function monthlyTargets(tech, quota, cfg = TECH_SCORE_CONFIG) {
  if (tech && tech.title === PART_TIME_TITLE) return { ...PART_TIME_QUOTA };
  const d = cfg.production.defaultTargets;
  return { upsells: quota?.upsells ?? d.upsells, reviews: quota?.reviews ?? d.reviews, switchovers: quota?.switchovers ?? d.switchovers };
}
// Month to date through asOf (YYYY-MM-DD). No jobs with revenue this month =
// no score (not working yet / on leave), never a 0.
export function productionScore({ techId, tech, jobs = [], reviews = [], switchovers = [], quota, asOf }, cfg = TECH_SCORE_CONFIG) {
  const monthKey = asOf.slice(0, 7), start = `${monthKey}-01`;
  const dim = daysInMonth(monthKey), elapsed = Number(asOf.slice(8, 10));
  const factor = Math.min(1, Math.max(elapsed, cfg.production.minDaysElapsed) / dim);
  const targets = monthlyTargets(tech, quota, cfg);
  const myJobs = jobs.filter(j => j.tech_id === techId && inRange(j.job_date, start, asOf));
  const actual = {
    upsells: myJobs.reduce((s, j) => s + num(j.upsell_amount), 0),
    reviews: reviews.filter(r => r.tech_id === techId && r.month_key === monthKey).reduce((s, r) => s + num(r.count), 0),
    switchovers: switchovers.filter(s => s.tech_id === techId && inRange(s.sold_date || (s.created_at ? mountainDate(s.created_at) : null), start, asOf)).length,
  };
  const metrics = cfg.production.metrics.map(m => {
    const target = num(targets[m.key]), prorated = target * factor;
    const pct = prorated > 0 ? Math.min(actual[m.key] / prorated, 1) * 100 : 100;
    return { ...m, actual: actual[m.key], target, prorated, pct };
  });
  const worked = myJobs.some(j => num(j.revenue) > 0);
  return { score: worked ? avg(metrics.map(m => m.pct)) : null, monthKey, asOf, daysElapsed: elapsed, daysInMonth: dim, factor, metrics, worked };
}

// Nightly Truck Check sub-score. truckSubs: this tech's Truck Check
// submissions; grades: truck_check_grades rows (any tech's is fine).
// today: a night that's today with no Truck Check yet is "pending", not 0.
export function truckScore({ techId, tech, jobs = [], truckSubs = [], grades = [], from, to, today }, cfg = TECH_SCORE_CONFIG) {
  const byDay = Object.fromEntries(latestPerDay(truckSubs).map(s => [s.work_date, s]));
  if (isTruckExempt(tech, cfg)) return { score: null, exempt: true, nights: [], extra: [], worked: 0, submitted: 0, missed: 0 };
  const gradeById = Object.fromEntries(grades.map(g => [g.submission_id, g]));
  const worked = workedDates(jobs, techId, from, to).filter(d => !today || d <= today);
  const nights = worked.map(date => {
    const sub = byDay[date] || null, grade = sub ? gradeById[sub.id] || null : null;
    if (!sub) return date === today ? { date, sub, grade, status: "pending", score: null } : { date, sub, grade, status: "missed", score: cfg.truck.missedScore };
    if (grade && grade.score != null) return { date, sub, grade, status: "graded", score: num(grade.score) };
    return { date, sub, grade, status: "not_graded", score: cfg.truck.notGradedScore };
  }).reverse();
  // Truck Checks on nights with no paid job: shown, not scored.
  const extra = Object.values(byDay).filter(s => inRange(s.work_date, from, to) && !worked.includes(s.work_date))
    .map(s => ({ date: s.work_date, sub: s, grade: gradeById[s.id] || null })).sort((a, b) => b.date.localeCompare(a.date));
  const counted = nights.filter(n => n.score != null);
  return { score: avg(counted.map(n => n.score)), exempt: false, nights, extra, worked: counted.length,
    submitted: counted.filter(n => n.sub).length, missed: counted.filter(n => n.status === "missed").length,
    notGraded: counted.filter(n => n.status === "not_graded").length };
}

// Equipment & Truck = average of the tote and truck sub-scores that exist.
export function equipmentScore(toteScores, truck) {
  const tote = avg(toteScores || []);
  return { score: avg([tote, truck ? truck.score : null]), tote, truck: truck ? truck.score : null };
}

// Weighted average of the sections that have a score.
export function overallScore(sections, cfg = TECH_SCORE_CONFIG) {
  let sum = 0, w = 0;
  for (const s of cfg.sections) {
    const v = sections[s.key];
    if (v == null || !Number.isFinite(v)) continue;
    sum += v * s.weight; w += s.weight;
  }
  if (!w) return { score: null, pass: null, sectionsScored: 0 };
  const score = sum / w;
  return { score, pass: score >= cfg.passLine, sectionsScored: cfg.sections.filter(s => sections[s.key] != null && Number.isFinite(sections[s.key])).length };
}

// Everything for one tech over the window [from, to]:
//   subs        their GHL submissions (tote, audit, truck) -- any dates
//   driverData  driver-scores data for the window, or null
//   jobs, callbacks, reviews, switchovers  all rows (filtered here)
//   quota       the quota setting; truckGrades: truck_check_grades rows
//   today       YYYY-MM-DD (Mountain); quota runs month to date through
//               min(to, today)
export function techScoreCard({ techId, tech = null, subs = [], driverData = null, jobs = [], callbacks = [], reviews = [], switchovers = [], quota = null, truckGrades = [], from, to, today }, cfg = TECH_SCORE_CONFIG) {
  const inWin = (subs || []).filter(s => inRange(s.work_date, from, to));
  const week = techWeekScores(inWin);
  const totes = week.totes.map(t => ({ ...t, equipScore: toteEquipmentScore(t.missingCents, cfg) }));
  let driver = null;
  if (driverData) { const days = techDriverDays(techId, driverData).filter(d => inRange(d.date, from, to)); driver = { days, ...weeklyDriverScore(days) }; }
  const worked = workedDates(jobs, techId, from, to).length > 0;
  const quality = qualityScore((callbacks || []).filter(c => c.tech_id === techId && inRange(callbackDateOf(c), from, to)), worked, cfg);
  const asOf = today && today < to ? today : to;
  const production = productionScore({ techId, tech, jobs, reviews, switchovers, quota, asOf }, cfg);
  const truck = truckScore({ techId, tech, jobs, truckSubs: inWin.filter(s => formKind(s.form_id) === "truck"), grades: truckGrades || [], from, to, today }, cfg);
  const equipment = equipmentScore(totes.map(t => t.equipScore), truck);
  const sections = { audit: week.auditPct, quality: quality.score, production: production.score, driver: driver?.score ?? null, equipment: equipment.score };
  return { techId, from, to, week, totes, driver, quality, production, truck, equipment, sections, overall: overallScore(sections, cfg) };
}

// Teams = each team lead plus the techs whose team_lead_id points at them.
export function teamsOf(techs) {
  const active = techs.filter(t => t.is_active !== false && t.title !== "owner");
  return active.filter(t => t.is_lead).map(lead => ({
    id: lead.id,
    name: lead.team_name || `${lead.name.split(" ")[0]}'s team`,
    lead: lead.name,
    memberIds: [lead.id, ...active.filter(t => t.team_lead_id === lead.id && t.id !== lead.id).map(t => t.id)],
  }));
}

// Team score = average of its members' overall scores (members with no score
// are left out); section averages likewise.
function summarize(cards, cfg) {
  const out = { score: avg(cards.map(c => c.overall.score)), scored: cards.filter(c => c.overall.score != null).length, members: cards.length };
  for (const s of cfg.sections) out[s.key] = avg(cards.map(c => c.sections[s.key]));
  out.pass = out.score == null ? null : out.score >= cfg.passLine;
  return out;
}
export function teamSummary(cards, techs, cfg = TECH_SCORE_CONFIG) {
  const byId = Object.fromEntries(cards.map(c => [c.techId, c]));
  const teams = teamsOf(techs).map(t => ({ ...t, ...summarize(t.memberIds.map(id => byId[id]).filter(Boolean), cfg) }));
  return { company: summarize(cards, cfg), teams };
}
