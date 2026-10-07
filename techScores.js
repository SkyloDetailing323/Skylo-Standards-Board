// techScores.js
// One full weekly score per tech from the Audits sections -- Tote Check, Tech
// Audit and Driver -- plus team scores (company-wide and per team lead's
// team). Pure functions, shared by the Audits tab and
// netlify/functions/tech-team-scores.mjs so both compute the same numbers.
//
// Display only -- nothing here feeds pay or bonuses.

import { formKind, scoreToteCheck, scoreTechAudit, latestPerDay, auditDays, weeklyAuditPct } from "./auditScoring.js";
import { techDriverDays, weeklyDriverScore } from "./driverScoring.js";

export const TECH_SCORE_CONFIG = {
  passLine: 85,
  // How much each section counts toward the full score. A section with no
  // score that week (no tote check, no audits, no scored driving) is left
  // out and the rest are averaged, so a missing check never counts as 0.
  sections: [
    { key: "tote",   label: "Tote Check", icon: "🧰", weight: 1 },
    { key: "audit",  label: "Tech Audit", icon: "📋", weight: 1 },
    { key: "driver", label: "Driving",    icon: "🚗", weight: 1 },
  ],
};

// A tech's tote checks and tech audits for the week (their GHL submissions).
export function techWeekScores(subs) {
  const toteAll = subs.filter(s => formKind(s.form_id) === "tote").map(s => scoreToteCheck(s));
  const totes = latestPerDay(toteAll.filter(t => !t.excluded));
  const excluded = toteAll.filter(t => t.excluded);
  const days = auditDays(subs.filter(s => formKind(s.form_id) === "audit").map(s => scoreTechAudit(s)));
  return { totes, excluded, latestTote: totes[0] || null, days, auditPct: weeklyAuditPct(days) };
}

// Section scores (0-100 or null) for one tech.
export function sectionScores(week, driver) {
  return {
    tote: week?.latestTote ? week.latestTote.score : null,
    audit: week?.auditPct ?? null,
    driver: driver?.score ?? null,
  };
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
  return { score, pass: score >= cfg.passLine, sectionsScored: cfg.sections.filter(s => sections[s.key] != null).length };
}

// Everything for one tech: section scores + full score.
export function techScoreCard(subs, driverData, techId, cfg = TECH_SCORE_CONFIG) {
  const week = techWeekScores(subs || []);
  let driver = null;
  if (driverData) { const days = techDriverDays(techId, driverData); driver = { days, ...weeklyDriverScore(days) }; }
  const sections = sectionScores(week, driver);
  return { techId, week, driver, sections, overall: overallScore(sections, cfg) };
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

const avg = xs => { const v = xs.filter(x => x != null && Number.isFinite(x)); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
// Team score = average of its members' full scores (members with no score
// that week are left out); section averages likewise.
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
