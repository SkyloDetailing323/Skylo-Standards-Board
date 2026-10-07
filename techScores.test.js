// techScores.test.js -- run with `npm test`.

import test from "node:test";
import assert from "node:assert/strict";
import { overallScore, teamsOf, teamSummary, TECH_SCORE_CONFIG } from "./techScores.js";

test("full score = average of the sections that have a score", () => {
  assert.deepEqual(overallScore({ tote: 94.6, audit: 81.1, driver: 90.3 }), { score: (94.6 + 81.1 + 90.3) / 3, pass: true, sectionsScored: 3 });
  // No tote check this week: averaged over the other two, not counted as 0.
  const r = overallScore({ tote: null, audit: 70, driver: 90 });
  assert.equal(r.score, 80); assert.equal(r.pass, false); assert.equal(r.sectionsScored, 2);
  assert.deepEqual(overallScore({ tote: null, audit: null, driver: null }), { score: null, pass: null, sectionsScored: 0 });
});

test("section weights come from config", () => {
  const cfg = { ...TECH_SCORE_CONFIG, sections: TECH_SCORE_CONFIG.sections.map(s => ({ ...s, weight: s.key === "driver" ? 2 : 1 })) };
  assert.equal(overallScore({ tote: 100, audit: 100, driver: 50 }, cfg).score, 75);
});

const techs = [
  { id: "L1", name: "Kyle Reiff", is_lead: true, team_name: "Team 2" },
  { id: "a", name: "A", team_lead_id: "L1" }, { id: "b", name: "B", team_lead_id: "L1" },
  { id: "L2", name: "Brian Wheelus", is_lead: true, team_name: null },
  { id: "c", name: "C", team_lead_id: "L2" },
  { id: "x", name: "Gone", team_lead_id: "L2", is_active: false },
  { id: "o", name: "Owner", title: "owner" },
];
const card = (id, tote, audit, driver) => ({ techId: id, sections: { tote, audit, driver }, overall: overallScore({ tote, audit, driver }) });

test("teams are a lead plus their members; inactive techs and owners left out", () => {
  assert.deepEqual(teamsOf(techs).map(t => [t.name, t.memberIds]), [["Team 2", ["L1", "a", "b"]], ["Brian's team", ["L2", "c"]]]);
});

test("team and company scores average members' full scores (unscored members skipped)", () => {
  const cards = [card("L1", 100, 90, 80), card("a", 90, null, 70), card("b", null, null, null), card("L2", 60, 60, 60), card("c", 100, 100, 100)];
  const { company, teams } = teamSummary(cards, techs);
  assert.equal(teams[0].score, (90 + 80) / 2);   // L1 = 90, a = 80, b unscored
  assert.equal(teams[0].scored, 2); assert.equal(teams[0].members, 3);
  assert.equal(teams[0].tote, 95);
  assert.equal(teams[1].score, 80);
  assert.equal(company.score, (90 + 80 + 60 + 100) / 4);
  assert.equal(company.pass, false);   // 82.5 is under the 85 pass line
});
