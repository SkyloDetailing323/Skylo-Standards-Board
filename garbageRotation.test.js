// garbageRotation.test.js -- run with `npm test`. Made-up techs.
import test from "node:test";
import assert from "node:assert/strict";
import { isGarbageEligible, worksOn, rotationOrder, lastDoneByTech, lockDay, planWeek, dutyCounts, isoWeekday } from "./garbageRotation.js";

const T = (id, name, title = "detail_pro", extra = {}) => ({ id, name, title, is_active: true, ...extra });
const ann = T("a", "Ann Zed"), bob = T("b", "Bob Young"), cal = T("c", "Cal Xu", "detail_apprentice");
const techs = [ann, bob, cal,
  T("o", "Owner Person", "owner"), T("s", "Sales Person", "sales_booking"), T("f", "Field Sup", "field_supervisor"),
  T("l", "Leave Person", "detail_pro", { on_leave: true }), T("x", "Gone Person", "detail_pro", { is_active: false })];
// Mon-Sat for a/b/c and everyone else too (they must still be excluded).
const schedule = techs.flatMap(t => [1, 2, 3, 4, 5, 6].map(weekday => ({ tech_id: t.id, weekday, vehicle: "Mav 1" })));
const MON = "2026-10-19";

test("eligible: detail techs + apprentices only, active, not on leave", () => {
  assert.deepEqual(techs.filter(isGarbageEligible).map(t => t.id), ["a", "b", "c"]);
  assert.equal(isGarbageEligible({ id: "n", name: "No Title", is_active: true }), true); // untitled = apprentice
});

test("works that day: schedule by weekday, time off removes, extra day adds, holidays off", () => {
  assert.equal(isoWeekday(MON), 1);
  assert.equal(worksOn("a", MON, schedule, []), true);
  assert.equal(worksOn("a", MON, schedule, [{ tech_id: "a", date: MON, kind: "off" }]), false);
  assert.equal(worksOn("a", "2026-10-18", schedule, []), false);                                   // Sunday
  assert.equal(worksOn("a", "2026-10-18", schedule, [{ tech_id: "a", date: "2026-10-18", kind: "extra" }]), true);
  assert.equal(worksOn("a", MON, schedule, [], [MON]), false);
  assert.equal(worksOn("a", MON, [{ tech_id: "a", weekday: 1, vehicle: "" }], []), false);       // "Off" box
});

test("rotation: oldest last-done first, never-done first, ties by first name", () => {
  const last = lastDoneByTech([
    { work_date: "2026-10-10", tech_id: "a", status: "done" },
    { work_date: "2026-10-12", tech_id: "b", status: "done" },
    { work_date: "2026-10-14", tech_id: "a", status: "missed" },  // missed doesn't count as done
  ], MON);
  assert.deepEqual(rotationOrder([ann, bob, cal], last).map(t => t.id), ["c", "a", "b"]);
  assert.deepEqual(rotationOrder([bob, ann], {}).map(t => t.id), ["a", "b"]);
});

test("lock: the rotation pick when clocked in; backup to next clocked-in tech otherwise", () => {
  const ctx = { techs, schedule, exceptions: [], holidays: [], duties: [] };
  assert.deepEqual(lockDay(MON, ctx, new Set(["a", "b", "c"])), { tech_id: "a", reassigned_from: null, reason: null });
  const r = lockDay(MON, ctx, new Set(["c"]));
  assert.equal(r.tech_id, "c"); assert.equal(r.reassigned_from, "a");
  assert.match(r.reason, /Ann Zed hadn't clocked in by 10:00 AM/);
  // Nobody clocked in: stays with the pick, logged.
  const n = lockDay(MON, ctx, new Set());
  assert.equal(n.tech_id, "a"); assert.match(n.reason, /nobody/);
  // Time off: skipped, logged.
  const off = lockDay(MON, { ...ctx, exceptions: [{ tech_id: "a", date: MON, kind: "off" }] }, new Set(["b", "c"]));
  assert.equal(off.tech_id, "b"); assert.match(off.reason, /Ann Zed has time off/);
  // Nobody eligible works (Sunday) -> no garbage night.
  assert.equal(lockDay("2026-10-18", ctx, new Set(["a"])), null);
});

test("week preview rotates through everyone and keeps saved rows", () => {
  const ctx = { techs, schedule, exceptions: [], holidays: [], duties: [{ work_date: MON, tech_id: "b", status: "done" }] };
  const w = planWeek(MON, ctx, 7);
  assert.deepEqual(w.map(d => d.tech_id), ["b", "a", "c", "b", "a", "c", null]); // Sun = nobody
  assert.equal(w[0].locked, true); assert.equal(w[1].status, "preview"); assert.equal(w[6].status, "none");
});

test("30-day counts", () => {
  const c = dutyCounts([
    { work_date: "2026-10-01", tech_id: "a", status: "done" }, { work_date: "2026-10-02", tech_id: "a", status: "missed" },
    { work_date: "2026-08-01", tech_id: "a", status: "done" }], "2026-09-20", "2026-10-19");
  assert.deepEqual(c, { a: { done: 1, missed: 1, excused: 0, assigned: 0 } });
});
