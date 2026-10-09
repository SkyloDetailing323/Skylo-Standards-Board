// fordReports.test.js -- run with `npm test`. Uses made-up rows in Ford's
// report layout (no real locations).

import test from "node:test";
import assert from "node:assert/strict";
import { parseCsv, reportKind, fordDateTime, buildFordImport } from "./fordReports.js";
import { DRIVER_CONFIG, scoreDriverDay, techDriverDays } from "./driverScoring.js";

const FLEET = "﻿VIN,Vehicle Name,Distance Driven (mi),Engine Hours (hr),Total Idle Time (hr),Trips,Speeding Over Posted Violations,Speeding Over Threshold Violations,Total Seatbelt Violations,Driver Seatbelt Violations,Passenger Seatbelt Violations,Speeding Over Posted Duration (min),Speeding Over Threshold Duration (min)\n" +
  "3FTTW8J34SRA88072,Mav/3,120.5,3.1,0.75,8,4,0,0,0,0,6.000,0.000\n" +
  "3FTTW8J31SRB14062,Mav/5,0,0,0,0,0,0,0,0,0,0,0\n";
const SPEEDING = "Date,Time,Vehicle,Speed Limit (mph),Event Type,Speed (mph),Duration (Seconds),Speeding Threshold,Speeding Over Limit Buffer,Latitude,Longitude,Location\n" +
  '10/6/26,"6:56:58 AM",Mav/3,25,"Speeding Over Posted Limit",31,<10,85,5,40.1,-111.1,"1 Main St, Town, UT"\n' +
  '10/6/26,"1:05:00 PM",Mav/3,45,"Speeding Over Posted Limit",67,15,85,5,40.1,-111.1,"2 Main St, Town, UT"\n';
const HARSH = "Date,Time,Vehicle,VIN,Event Type,Latitude,Longitude,Address\n" +
  '10/6/26,"7:16:57 AM",Mav/3,3FTTW8J34SRA88072,"Harsh Braking",40.1,-111.1,"I-15, UT"\n';
const BELT = "Date,Time,Vehicle,VIN,Event Type,Duration (Seconds),Latitude,Longitude,Address\n" +
  '10/6/26,7:27:24 PM,Mav/3,3FTTW8J34SRA88072,"Seatbelt Off : Driver",2,40.1,-111.1,"x"\n';
const IDLE = "Date,Time,Vehicle,VIN,Duration (Seconds),Latitude,Longitude,Address\n" +
  '10/6/26,"10:59:36 AM",Mav/3,3FTTW8J34SRA88072,1686,40.1,-111.1,"x"\n';
const vehicles = [{ id: "v3", name: "Mav 3", vin: "3FTTW8J34SRA88072" }, { id: "v5", name: "Mav 5", vin: "3FTTW8J31SRB14062" }];

test("CSV parsing handles BOM, quotes and commas in quotes", () => {
  const { headers, rows } = parseCsv('﻿a,b\n"x, y","say ""hi"""\r\n');
  assert.deepEqual(headers, ["a", "b"]);
  assert.deepEqual(rows, [{ a: "x, y", b: 'say "hi"' }]);
});

test("each Ford report is recognized by its columns", () => {
  assert.equal(reportKind(parseCsv(FLEET).headers), "fleet_activity");
  assert.equal(reportKind(parseCsv(SPEEDING).headers), "speeding");
  assert.equal(reportKind(parseCsv(HARSH).headers), "harsh");
  assert.equal(reportKind(parseCsv(BELT).headers), "seatbelt");
  assert.equal(reportKind(parseCsv(IDLE).headers), "idling");
  assert.equal(reportKind(["Driver Name", "Driver Score"]), null);
});

test("Ford dates/times become Mountain-time work dates", () => {
  assert.deepEqual(fordDateTime("10/6/26", "1:05:00 PM"), { work_date: "2026-10-06", event_time: "2026-10-06T13:05:00-06:00" });
  assert.deepEqual(fordDateTime("10/6/26", "12:10:00 AM"), { work_date: "2026-10-06", event_time: "2026-10-06T00:10:00-06:00" });
});

test("import builds daily rows + events, maps Mav/3 to its VIN, keeps no locations", () => {
  const imp = buildFordImport([
    { name: "Fleet Activity Summary.csv", text: FLEET }, { name: "speeding.csv", text: SPEEDING },
    { name: "harsh.csv", text: HARSH }, { name: "belt.csv", text: BELT }, { name: "idle.csv", text: IDLE },
    { name: "Driver Score.csv", text: "Driver Name,Driver Score\nX,1\n" },
  ], vehicles);
  assert.equal(imp.workDate, "2026-10-06");
  assert.deepEqual(imp.skipped, ["Driver Score.csv"]);
  assert.deepEqual(imp.daily[0], { vin: "3FTTW8J34SRA88072", vehicle: "Mav/3", miles: 120.5, trips: 8, idle_minutes: 45, speeding_minutes: 6 });
  assert.equal(imp.events.length, 5);
  const fast = imp.events.find(e => e.speed_mph === 67);
  assert.equal(fast.mph_over, 22);
  assert.equal(fast.vin, "3FTTW8J34SRA88072");
  assert.ok(imp.events.every(e => !JSON.stringify(e).match(/Latitude|Main St|-111/)));
  assert.deepEqual(imp.warnings, []);
});

test("minutes mode: speeding scored by minutes over the limit per 100 mi", () => {
  const imp = buildFordImport([{ name: "f", text: FLEET }, { name: "s", text: SPEEDING }, { name: "h", text: HARSH }, { name: "b", text: BELT }], vehicles);
  const [d] = techDriverDays("t1", { vehicles, assignments: [{ tech_id: "t1", vehicle_id: "v3", work_date: "2026-10-06" }], daily: imp.daily.map(r => ({ ...r, work_date: imp.workDate })), events: imp.events });
  const pts = Object.fromEntries(d.penalties.map(p => [p.key, Math.round(p.points * 100) / 100]));
  // 6 min over / 1.205 per-100 = 4.98 ; 1 event 22 over = -10 ; 1 brake = 1.66 ; seatbelt -5 ; idle 45 min = 1 block
  assert.deepEqual(pts, { speeding: 4.98, speeding_severe: 10, harsh_braking: 1.66, seatbelt: 5, idling: 1 });
  assert.equal(Math.round(d.score * 10) / 10, 77.4);
  assert.deepEqual(d.unknownTypes, []);
});

test("events mode still matches the spec example (420 mi -> 94.0)", () => {
  const cfg = { ...DRIVER_CONFIG, speeding: { ...DRIVER_CONFIG.speeding, mode: "events" } };
  const evs = (t, n, x = {}) => Array.from({ length: n }, () => ({ event_type: t, ...x }));
  const d = scoreDriverDay({ date: "d", miles: 420, speedingMinutes: 12, events: [...evs("Harsh Braking", 6), ...evs("Harsh Acceleration", 2), ...evs("Speeding Over Posted Limit", 3, { mph_over: 8 })] }, cfg);
  assert.equal(Math.round(d.score * 10) / 10, 94.0);
});

test("a Ford 'N/A' limit is unknown (not 0), so it isn't scored as speeding", () => {
  const csv = "Date,Time,Vehicle,Speed Limit (mph),Event Type,Speed (mph),Duration (Seconds)\n" +
    '10/6/26,"9:00:00 AM",Mav/3,N/A,"Speeding Over Posted Limit",45,12\n';
  const r = buildFordImport([{ name: "fleet.csv", text: FLEET }, { name: "s.csv", text: csv }], vehicles);
  assert.equal(r.events[0].limit_mph, null);
  assert.equal(r.events[0].mph_over, null);
});

test("the same report uploaded twice doesn't double the events", () => {
  const once = buildFordImport([{ name: "fleet.csv", text: FLEET }, { name: "speeding.csv", text: SPEEDING }], vehicles);
  const twice = buildFordImport([{ name: "fleet.csv", text: FLEET }, { name: "speeding.csv", text: SPEEDING }, { name: "speeding (1).csv", text: SPEEDING }, { name: "fleet (1).csv", text: FLEET }], vehicles);
  assert.equal(twice.events.length, once.events.length);
  assert.equal(twice.daily.length, once.daily.length);
});

test("speeding minutes are minutes over the posted limit only", () => {
  const fleet = FLEET.replace("6.000,0.000", "6.000,2.000");
  const r = buildFordImport([{ name: "fleet.csv", text: fleet }], vehicles);
  assert.equal(r.daily.find(d => d.vin === "3FTTW8J34SRA88072").speeding_minutes, 6);
});

test("no dated events: the import doesn't guess a day", () => {
  const r = buildFordImport([{ name: "fleet.csv", text: FLEET }], vehicles);
  assert.equal(r.workDate, null);
  assert.ok(r.warnings.some(w => /pick the day/.test(w)));
});

test("severe speeding events within 60s on one truck count once", () => {
  const ev = (t, over) => ({ vin: "V1", event_type: "Speeding Over Posted Limit", mph_over: over, event_time: `2026-10-06T10:00:${t}-06:00` });
  const day = scoreDriverDay({ date: "2026-10-06", miles: 100, events: [ev("00", 22), ev("20", 25), ev("45", 21)] });
  assert.equal(day.counts.speeding_severe, 1);
  const apart = scoreDriverDay({ date: "2026-10-06", miles: 100, events: [ev("00", 22), { ...ev("00", 22), event_time: "2026-10-06T10:05:00-06:00" }] });
  assert.equal(apart.counts.speeding_severe, 2);
});

test("Fleet Activity's truck column may be called \"Vehicle\" (Ford renamed it) and still maps names to VINs", () => {
  const fleet = "﻿VIN,Vehicle,Distance Driven (mi),Engine Hours (hr),Total Idle Time (hr),Trips,Speeding Over Posted Duration (min)\n3FTTW8J34SRA88072,Mav/3,50,1,0.5,3,2\n";
  const speeding = "Date,Time,Vehicle,Speed Limit (mph),Event Type,Speed (mph),Duration (Seconds)\n" + '10/8/26,"9:00:00 AM",Mav/3,25,"Speeding Over Posted Limit",31,<10\n';
  // No vehicles list passed: the VIN has to come from the Fleet Activity file itself.
  const imp = buildFordImport([{ name: "fleet.csv", text: fleet }, { name: "speeding.csv", text: speeding }], []);
  assert.equal(imp.daily[0].vehicle, "Mav/3");
  assert.equal(imp.events.length, 1);
  assert.equal(imp.events[0].vin, "3FTTW8J34SRA88072");
  assert.ok(!imp.warnings.some(w => /No VIN/.test(w)));
});
