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
