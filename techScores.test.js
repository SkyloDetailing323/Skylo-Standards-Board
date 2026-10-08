// techScores.test.js -- run with `npm test`.

import test from "node:test";
import assert from "node:assert/strict";
import { overallScore, teamsOf, teamSummary, TECH_SCORE_CONFIG, scoreWindow, toteEquipmentScore, qualityScore,
  productionScore, monthlyTargets, truckScore, equipmentScore, techScoreCard } from "./techScores.js";
import { AUDIT_CONFIG } from "./auditScoring.js";

const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, msg || `${a} != ${b}`);

test("weights: 30 / 25 / 20 / 15 / 10, pass at 85", () => {
  assert.deepEqual(TECH_SCORE_CONFIG.sections.map(s => [s.key, s.weight]), [["audit", 30], ["quality", 25], ["production", 20], ["driver", 15], ["equipment", 10]]);
  assert.equal(TECH_SCORE_CONFIG.sections.reduce((s, x) => s + x.weight, 0), 100);
  const r = overallScore({ audit: 100, quality: 80, production: 60, driver: 90, equipment: 50 });
  close(r.score, (100 * 30 + 80 * 25 + 60 * 20 + 90 * 15 + 50 * 10) / 100);
  assert.equal(r.score, 80.5); assert.equal(r.pass, false); assert.equal(r.sectionsScored, 5);
});

test("missing sections are left out and the rest re-normalized", () => {
  // No driving data: (100*30 + 80*25 + 60*20 + 50*10) / 85
  const r = overallScore({ audit: 100, quality: 80, production: 60, driver: null, equipment: 50 });
  close(r.score, 6700 / 85); assert.equal(r.sectionsScored, 4);
  assert.equal(overallScore({ audit: 70, quality: null, production: null, driver: null, equipment: null }).score, 70);
  assert.deepEqual(overallScore({ audit: null, quality: null, production: null, driver: null, equipment: null }), { score: null, pass: null, sectionsScored: 0 });
});

test("window = 4 Wed-Tue weeks ending with the picked week", () => {
  assert.deepEqual(scoreWindow("2026-10-07"), { from: "2026-09-16", to: "2026-10-13" });
});

test("tote rescale: $7.00 missing = 85, $100 = 0, nothing missing = 100", () => {
  close(toteEquipmentScore(700), 85);
  assert.equal(toteEquipmentScore(0), 100);
  assert.equal(toteEquipmentScore(10000), 0);
  assert.equal(toteEquipmentScore(27800), 0);
  close(toteEquipmentScore(350), 92.5);
});

test("callbacks: deduction by level times split share, floored at 0", () => {
  assert.equal(qualityScore([], true).score, 100);           // worked, no callbacks
  assert.equal(qualityScore([], false).score, null);         // no jobs, no callbacks
  assert.equal(qualityScore([{ severity: 1, weight: 1 }], true).score, 75);
  assert.equal(qualityScore([{ severity: 2, weight: 0.5 }], true).score, 75);    // split L2
  assert.equal(qualityScore([{ severity: 1 }, { severity: 2 }], true).score, 25);
  const legacy = qualityScore([{ severity: null, weight: 0.5 }], true);
  assert.equal(legacy.score, 50); assert.equal(legacy.items[0].level, 3); assert.equal(legacy.items[0].legacy, true);
  assert.equal(qualityScore([{ severity: 3 }, { severity: 1 }], true).score, 0);   // floor
  assert.equal(qualityScore([{ severity: 3, weight: 1 }], false).score, 0);        // callbacks count even with no jobs loaded
});

const job = (date, upsell = 0, revenue = 200, tech = "t1") => ({ tech_id: tech, job_date: date, upsell_amount: upsell, revenue });

test("production: prorated by days elapsed (min 7), each metric capped at 100", () => {
  // Oct 14 of a 31-day month: targets x 14/31.
  const jobs = [job("2026-10-02", 100), job("2026-10-10", 50), job("2026-09-30", 500), job("2026-10-15", 500)];
  const reviews = [{ tech_id: "t1", month_key: "2026-10", count: 5 }, { tech_id: "t1", month_key: "2026-09", count: 9 }];
  const switchovers = [{ tech_id: "t1", sold_date: "2026-10-03" }, { tech_id: "t1", created_at: "2026-10-01T03:00:00Z" }];  // 2nd = Sep 30 in MT
  const p = productionScore({ techId: "t1", tech: { title: "detail_pro" }, jobs, reviews, switchovers, quota: { upsells: 400, reviews: 6, switchovers: 1 }, asOf: "2026-10-14" });
  close(p.factor, 14 / 31);
  const [up, rev, sw] = p.metrics;
  close(up.actual, 150); close(up.prorated, 400 * 14 / 31); close(up.pct, 150 / (400 * 14 / 31) * 100);
  assert.equal(rev.actual, 5); assert.equal(rev.pct, 100);       // 5 vs 2.7 -> capped
  assert.equal(sw.actual, 1); assert.equal(sw.pct, 100);         // 1 vs 0.45 -> capped
  close(p.score, (up.pct + 100 + 100) / 3);
});

test("production: early month uses 7 days; no jobs this month = no score; part-time targets", () => {
  const p = productionScore({ techId: "t1", jobs: [job("2026-10-02", 0)], quota: { upsells: 400, reviews: 6, switchovers: 1 }, asOf: "2026-10-02" });
  close(p.factor, 7 / 31); assert.equal(p.score, 0);
  assert.equal(productionScore({ techId: "t1", jobs: [], asOf: "2026-10-02" }).score, null);
  assert.equal(productionScore({ techId: "t1", jobs: [job("2026-10-02", 50, 0)], asOf: "2026-10-02" }).score, null);   // $0 revenue only
  assert.deepEqual(monthlyTargets({ title: "equipment_coordinator" }, { upsells: 400, reviews: 6, switchovers: 1 }), { upsells: 300, reviews: 4, switchovers: 1 });
  assert.deepEqual(monthlyTargets({ title: "detail_pro" }, null), { upsells: 400, reviews: 6, switchovers: 1 });
});

const truckSub = (id, date, at = `${date}T03:00:00Z`) => ({ id, form_id: AUDIT_CONFIG.truck.formId, work_date: date, submitted_at: at, tech_id: "t1" });

test("truck: graded / not graded yet (100) / missed (0) over nights worked", () => {
  const jobs = [job("2026-10-01"), job("2026-10-01"), job("2026-10-02"), job("2026-10-03"), job("2026-10-05", 0, 0), job("2026-10-06")];
  const subs = [truckSub("a", "2026-10-01"), truckSub("a2", "2026-10-01", "2026-10-01T05:00:00Z"), truckSub("b", "2026-10-02"), truckSub("x", "2026-10-04")];
  const grades = [{ submission_id: "a2", score: 70 }, { submission_id: "a", score: 10 }];
  const r = truckScore({ techId: "t1", tech: { title: "detail_pro" }, jobs, truckSubs: subs, grades, from: "2026-09-30", to: "2026-10-06", today: "2026-10-06" });
  // Oct 1 graded 70 (latest submission), Oct 2 not graded = 100, Oct 3 missed = 0, Oct 6 = today, pending.
  assert.deepEqual(r.nights.map(n => [n.date, n.status, n.score]), [["2026-10-06", "pending", null], ["2026-10-03", "missed", 0], ["2026-10-02", "not_graded", 100], ["2026-10-01", "graded", 70]]);
  close(r.score, 170 / 3);
  assert.equal(r.worked, 3); assert.equal(r.submitted, 2); assert.equal(r.missed, 1);
  assert.deepEqual(r.extra.map(e => e.date), ["2026-10-04"]);   // submitted, no paid job
  assert.equal(truckScore({ techId: "t1", tech: { title: "detail_pro" }, jobs: [], truckSubs: subs, from: "2026-09-30", to: "2026-10-06" }).score, null);
  const appr = truckScore({ techId: "t1", tech: { title: "detail_apprentice" }, jobs, truckSubs: subs, from: "2026-09-30", to: "2026-10-06" });
  assert.equal(appr.score, null); assert.equal(appr.exempt, true);
});

test("equipment = average of the tote and truck sub-scores that exist", () => {
  assert.deepEqual(equipmentScore([85, 95], { score: 60 }), { score: 75, tote: 90, truck: 60 });
  assert.equal(equipmentScore([], { score: 60 }).score, 60);
  assert.equal(equipmentScore([85], null).score, 85);
  assert.equal(equipmentScore([], { score: null }).score, null);
});

test("full card: empty tables don't break anything", () => {
  const c = techScoreCard({ techId: "t1", from: "2026-09-16", to: "2026-10-13", today: "2026-10-08" });
  assert.deepEqual(c.sections, { audit: null, quality: null, production: null, driver: null, equipment: null });
  assert.equal(c.overall.score, null);
  const w = techScoreCard({ techId: "t1", tech: { title: "detail_pro" }, jobs: [job("2026-10-01", 0)], callbacks: [{ tech_id: "t1", job_date: "2026-10-01", severity: 2, weight: 1 }, { tech_id: "t1", job_date: "2026-08-01", severity: 3 }],
    from: "2026-09-16", to: "2026-10-13", today: "2026-10-08" });
  assert.equal(w.sections.quality, 50);              // the August callback is outside the window
  assert.equal(w.production.asOf, "2026-10-08");     // month to date runs through today
  assert.equal(w.sections.equipment, 0);             // worked Oct 1, no Truck Check
});

const techs = [
  { id: "L1", name: "Kyle Reiff", is_lead: true, team_name: "Team 2" },
  { id: "a", name: "A", team_lead_id: "L1" }, { id: "b", name: "B", team_lead_id: "L1" },
  { id: "L2", name: "Brian Wheelus", is_lead: true, team_name: null },
  { id: "c", name: "C", team_lead_id: "L2" },
  { id: "x", name: "Gone", team_lead_id: "L2", is_active: false },
  { id: "o", name: "Owner", title: "owner" },
];
const card = (id, audit, quality) => { const sections = { audit, quality, production: null, driver: null, equipment: null }; return { techId: id, sections, overall: overallScore(sections) }; };

test("teams are a lead plus their members; inactive techs and owners left out", () => {
  assert.deepEqual(teamsOf(techs).map(t => [t.name, t.memberIds]), [["Team 2", ["L1", "a", "b"]], ["Brian's team", ["L2", "c"]]]);
});

test("team and company scores average members' overall scores (unscored members skipped)", () => {
  const cards = [card("L1", 100, 80), card("a", 80, null), card("b", null, null), card("L2", 60, 60), card("c", 100, 100)];
  const { company, teams } = teamSummary(cards, techs);
  const l1 = (100 * 30 + 80 * 25) / 55;
  close(teams[0].score, (l1 + 80) / 2);
  assert.equal(teams[0].scored, 2); assert.equal(teams[0].members, 3);
  assert.equal(teams[0].audit, 90);
  assert.equal(teams[1].score, 80);
  close(company.score, (l1 + 80 + 60 + 100) / 4);
  assert.equal(company.pass, false);
});
