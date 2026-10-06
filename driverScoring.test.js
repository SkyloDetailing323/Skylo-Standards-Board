// driverScoring.test.js -- run with `npm test`.

import test from "node:test";
import assert from "node:assert/strict";
import { DRIVER_CONFIG, scoreDriverDay, techDriverDays, weeklyDriverScore, findUnassignedDriving } from "./driverScoring.js";

const round1 = n => Math.round(n * 10) / 10;
const evs = (type, n, extra = {}) => Array.from({ length: n }, () => ({ event_type: type, ...extra }));

test("spec example: 420 mi, 6 brakes, 2 accels, 3 speeding 5-19 over -> 94.0", () => {
  const d = scoreDriverDay({ date: "2026-10-05", miles: 420, events: [
    ...evs("harsh_braking", 6), ...evs("harsh_acceleration", 2), ...evs("speeding", 3, { mph_over: 8 }),
  ] });
  const pts = Object.fromEntries(d.penalties.map(p => [p.key, Math.round(p.points * 100) / 100]));
  assert.deepEqual(pts, { harsh_braking: 2.86, harsh_acceleration: 0.95, speeding: 2.14 });
  assert.equal(Math.round(d.totalPenalty * 100) / 100, 5.95);
  assert.equal(round1(d.score), 94.0);
  assert.equal(d.pass, true);
  assert.match(d.penalties[0].detail, /^6 harsh brakes, 1\.43 per 100 mi × 2$/);
});

test("speeding: under 5 over is free, 20+ is -10 flat, missing mph is flagged not scored", () => {
  const d = scoreDriverDay({ date: "d", miles: 100, events: [
    { event_type: "speeding", mph_over: 4 }, { event_type: "speeding", mph_over: 5 },
    { event_type: "speeding", mph_over: 19 }, { event_type: "speeding", mph_over: 20 },
    { event_type: "speeding" },
  ] });
  assert.equal(d.speedingUnder, 1);
  assert.equal(d.counts.speeding, 2);
  assert.equal(d.counts.speeding_severe, 1);
  assert.equal(d.score, 100 - 2 * 3 - 10);
  assert.ok(d.flags.some(f => /without mph/.test(f)));
});

test("seatbelt -5 per event, idling -1 per 10 min over 30, cornering per 100 mi", () => {
  const d = scoreDriverDay({ date: "d", miles: 200, idleMinutes: 65, events: [...evs("seatbelt", 2), ...evs("harsh_cornering", 4)] });
  const pts = Object.fromEntries(d.penalties.map(p => [p.key, p.points]));
  assert.equal(pts.seatbelt, 10);
  assert.equal(pts.idling, 3);              // 35 min over -> 3 full 10-min blocks
  assert.equal(pts.harsh_cornering, 4);     // 4 / 2.0 per-100 × 2
  assert.equal(d.score, 83);
  assert.equal(d.pass, false);              // pass line 85
});

test("under 5 miles = no score; score never below 0", () => {
  assert.equal(scoreDriverDay({ date: "d", miles: 4.9, events: evs("seatbelt", 3) }).score, null);
  assert.equal(scoreDriverDay({ date: "d", miles: 50, events: evs("speeding", 20, { mph_over: 25 }) }).score, 0);
});

test("unmapped Ford event types score 0 and are listed", () => {
  const d = scoreDriverDay({ date: "d", miles: 100, events: [{ event_type: "PHONE_USE" }, { event_type: "harsh_braking" }] });
  assert.deepEqual(d.unknownTypes, ["PHONE_USE"]);
  assert.equal(d.score, 98);
  const cfg = { ...DRIVER_CONFIG, fordEventTypes: { HARD_BRAKE: "harsh_braking" } };
  assert.equal(scoreDriverDay({ date: "d", miles: 100, events: [{ event_type: "HARD_BRAKE" }] }, cfg).counts.harsh_braking, 1);
});

const vehicles = [{ id: "v3", vin: "VIN3", name: "Mav 3" }, { id: "v5", vin: "VIN5", name: "Mav 5" }];

test("tech day = picked truck; unassigned driving an admin assigned adds -10 plus its events", () => {
  const data = {
    vehicles,
    assignments: [{ tech_id: "t1", vehicle_id: "v3", work_date: "2026-10-05" }],
    daily: [{ vin: "VIN3", work_date: "2026-10-05", miles: 100 }, { vin: "VIN5", work_date: "2026-10-05", miles: 100 }],
    events: [{ vin: "VIN3", work_date: "2026-10-05", event_type: "harsh_braking" }, { vin: "VIN5", work_date: "2026-10-05", event_type: "harsh_braking" }],
    unassigned: [{ vin: "VIN5", work_date: "2026-10-05", assigned_tech_id: "t1" }],
  };
  const [d] = techDriverDays("t1", data);
  assert.deepEqual(d.vehicles, ["Mav 3", "Mav 5"]);
  assert.equal(d.miles, 200);
  assert.equal(d.counts.harsh_braking, 2);
  assert.equal(d.score, 100 - 2 * 1 - 10);   // 2 brakes over 200 mi = 1/100 mi × 2, then -10
  // Not assigned yet: it never counts against anyone.
  const [only] = techDriverDays("t1", { ...data, unassigned: [{ vin: "VIN5", work_date: "2026-10-05", assigned_tech_id: null }] });
  assert.equal(only.score, 98);
  assert.equal(techDriverDays("t2", data).length, 0);
});

test("two techs on the same truck the same day -> no score until an admin sorts it out", () => {
  const [d] = techDriverDays("t1", { vehicles,
    assignments: [{ tech_id: "t1", vehicle_id: "v3", work_date: "2026-10-05" }, { tech_id: "t2", vehicle_id: "v3", work_date: "2026-10-05" }],
    daily: [{ vin: "VIN3", work_date: "2026-10-05", miles: 80 }], events: [] });
  assert.equal(d.score, null);
  assert.match(d.reason, /Shared truck/);
});

test("weekly = average of scored days; unassigned driving is found per vehicle-day", () => {
  const w = weeklyDriverScore([{ score: 94 }, { score: 80 }, { score: null }]);
  assert.equal(w.score, 87); assert.equal(w.pass, true); assert.equal(w.scoredDays, 2);
  const u = findUnassignedDriving({ vehicles,
    assignments: [{ tech_id: "t1", vehicle_id: "v3", work_date: "2026-10-05" }],
    daily: [{ vin: "VIN3", work_date: "2026-10-05", miles: 40 }, { vin: "VIN5", work_date: "2026-10-05", miles: 12 }, { vin: "VIN5", work_date: "2026-10-06", miles: 0 }] });
  assert.deepEqual(u, [{ vin: "VIN5", work_date: "2026-10-05", miles: 12, vehicle: "Mav 5" }]);
});
