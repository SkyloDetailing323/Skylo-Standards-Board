// driverScoring.js
// Ford Pro driver scorecard: turns a truck's Ford Pro telematics (miles and
// driving events) into a daily driver score for the tech who picked that truck
// at clock-in. Pure functions with no React or network code, so the Audit
// Scores page and the server functions score exactly the same way.
//
// Display only -- nothing here feeds pay or bonuses.
//
// Every number lives in DRIVER_CONFIG. They're drafts: change them here.

import { AUDIT_CONFIG } from "./auditScoring.js";

export const DRIVER_CONFIG = {
  passLine: 85,                 // weekly (and daily) score at or above this passes
  minMiles: 5,                  // days with fewer miles get no score
  rateMiles: 100,               // "per 100 miles"
  // Commercial vehicles: speeding counts from 5 mph over the posted limit
  // (Ford's own "Speeding Over Posted Limit" buffer is also 5 mph).
  //   mode "minutes": 5-19 mph over is scored by minutes spent over the limit
  //     per 100 miles (Ford logs every few-second stretch as its own event,
  //     so counting events punishes city driving).
  //   mode "events": 5-19 mph over is scored per event per 100 miles.
  // 20+ mph over (and Ford's 85 mph threshold) is always -10 per event.
  speeding: { minMphOver: 5, severeMphOver: 20, mode: "minutes" },
  penalties: {
    harsh_braking:      { label: "Harsh braking",          unit: "harsh brake",  per100: 2 },
    harsh_acceleration: { label: "Harsh acceleration",     unit: "harsh accel",  per100: 2 },
    harsh_cornering:    { label: "Harsh cornering",        unit: "harsh corner", per100: 2 },
    speeding:           { label: "Speeding 5-19 mph over", unit: "speeding event", per100: 3, perMinutePer100: 1 },
    speeding_severe:    { label: "Speeding 20+ mph over",  unit: "speeding event", perEvent: 10 },
    seatbelt:           { label: "Seatbelt unbuckled",     unit: "seatbelt alert", perEvent: 5 },
    idling:             { label: "Idling",                 freeMinutes: 30, perBlockMinutes: 10, perBlock: 1 },
    no_truck_pick:      { label: "Drove without picking a truck", unit: "time", perEvent: 10 },
  },
  // Ford event type (as Ford's reports name it) -> one of the penalty keys
  // above. Ford types not listed here score 0 and are listed on the Audit
  // Scores tab so they can be mapped. Ford reports no harsh cornering.
  fordEventTypes: {
    "Speeding Over Posted Limit": "speeding",
    "Speeding Over Threshold": "speeding_threshold",   // Ford's 85 mph alert
    "Harsh Braking": "harsh_braking",
    "Harsh Acceleration": "harsh_acceleration",
    "Seatbelt Off : Driver": "seatbelt",
    "Seatbelt Off : Passenger": "ignore",
    "Excessive Idling": "idling_event",                 // idle time comes from the daily total instead
  },
  // Same week as the rest of the Audit Scores tab.
  get weekStartsOn() { return AUDIT_CONFIG.weekStartsOn; },
};

const round2 = n => Math.round(n * 100) / 100;

// The penalty key for one stored Ford event, or null if it isn't scored.
export function eventKind(ev, cfg = DRIVER_CONFIG) {
  const t = cfg.fordEventTypes[ev.event_type] || ev.event_type;
  if (t === "ignore" || t === "idling_event") return "ignored";
  if (t === "speeding_threshold") return "speeding_severe";
  if (t === "speeding") {
    const over = Number(ev.mph_over);
    if (ev.mph_over == null || !Number.isFinite(over)) return "speeding_unknown";
    if (over < cfg.speeding.minMphOver) return "speeding_under";
    return over >= cfg.speeding.severeMphOver ? "speeding_severe" : "speeding";
  }
  if (t === "idling") return "idling";
  return cfg.penalties[t] ? t : null;
}

// day: { date, miles, events: [{ event_type, mph_over, duration_sec }],
//        idleMinutes, noTruckPicks, shared, vehicles: ["Mav 3"] }
export function scoreDriverDay(day, cfg = DRIVER_CONFIG) {
  const miles = Number(day.miles) || 0;
  const counts = {}, unknownTypes = new Set(), flags = [];
  let idleFromEvents = 0;
  for (const ev of day.events || []) {
    const k = eventKind(ev, cfg);
    if (k === "idling") { idleFromEvents += (Number(ev.duration_sec) || 0) / 60; continue; }
    if (k === "ignored") continue;
    if (k === null) { unknownTypes.add(ev.event_type); continue; }
    counts[k] = (counts[k] || 0) + 1;
  }
  if (counts.speeding_unknown) flags.push(`${counts.speeding_unknown} speeding event(s) without mph over the limit — not scored`);
  const idleMinutes = day.idleMinutes != null ? Number(day.idleMinutes) : idleFromEvents;
  const speedingMinutes = day.speedingMinutes != null ? Number(day.speedingMinutes) : null;
  const base = { date: day.date, vehicles: day.vehicles || [], miles, idleMinutes, speedingMinutes, counts, unknownTypes: [...unknownTypes], flags };

  if (day.shared) return { ...base, score: null, pass: null, penalties: [], reason: "Shared truck — two techs picked it this day; needs admin review" };
  if (miles < cfg.minMiles) return { ...base, score: null, pass: null, penalties: [], reason: `Under ${cfg.minMiles} miles — no score` };

  const per100 = miles / cfg.rateMiles;
  const penalties = [];
  for (const [key, p] of Object.entries(cfg.penalties)) {
    if (key === "idling" || key === "no_truck_pick") continue;
    const n = counts[key] || 0;
    if (key === "speeding" && cfg.speeding.mode === "minutes" && speedingMinutes != null) {
      if (!speedingMinutes && !n) continue;
      const rate = speedingMinutes / per100;
      penalties.push({ key, label: p.label, count: n, points: rate * p.perMinutePer100,
        detail: `${n} event${n !== 1 ? "s" : ""}, ${round2(speedingMinutes)} min over the limit, ${round2(rate)} min per 100 mi × ${p.perMinutePer100}` });
      continue;
    }
    if (!n) continue;
    if (p.per100 != null) {
      const rate = n / per100;
      penalties.push({ key, label: p.label, count: n, points: rate * p.per100, detail: `${n} ${p.unit}${n !== 1 ? "s" : ""}, ${round2(rate)} per 100 mi × ${p.per100}` });
    } else {
      penalties.push({ key, label: p.label, count: n, points: n * p.perEvent, detail: `${n} ${p.unit}${n !== 1 ? "s" : ""} × ${p.perEvent}` });
    }
  }
  const idle = cfg.penalties.idling;
  const blocks = Math.floor(Math.max(0, idleMinutes - idle.freeMinutes) / idle.perBlockMinutes);
  if (blocks) penalties.push({ key: "idling", label: idle.label, count: Math.round(idleMinutes), points: blocks * idle.perBlock, detail: `${Math.round(idleMinutes)} min idle, ${blocks} × ${idle.perBlockMinutes} min over ${idle.freeMinutes}` });
  const ntp = day.noTruckPicks || 0;
  if (ntp) { const p = cfg.penalties.no_truck_pick; penalties.push({ key: "no_truck_pick", label: p.label, count: ntp, points: ntp * p.perEvent, detail: `${ntp} × ${p.perEvent}` }); }

  const total = penalties.reduce((s, p) => s + p.points, 0);
  const score = Math.max(0, 100 - total);
  return { ...base, score, pass: score >= cfg.passLine, penalties, totalPenalty: total,
    speedingUnder: counts.speeding_under || 0 };
}

// A tech's driving days from the raw rows:
//   assignments: truck_assignments rows (all techs -- needed to spot shared trucks)
//   vehicles:    vehicles rows (id, vin, name)
//   daily:       ford_vehicle_daily rows (vin, work_date, miles, idle_minutes, speeding_minutes)
//   events:      ford_vehicle_events rows (vin, work_date, event_type, mph_over, duration_sec)
//   unassigned:  unassigned_driving rows (vin, work_date, assigned_tech_id, dismissed)
// A tech's day = the truck they picked, plus any unassigned driving an admin
// gave them (which also adds the "drove without picking a truck" penalty).
export function techDriverDays(techId, { assignments = [], vehicles = [], daily = [], events = [], unassigned = [] }, cfg = DRIVER_CONFIG) {
  const vById = Object.fromEntries(vehicles.map(v => [v.id, v]));
  const vByVin = Object.fromEntries(vehicles.map(v => [v.vin, v]));
  const days = {};
  const day = d => (days[d] = days[d] || { date: d, vins: new Set(), noTruckPicks: 0, shared: false });
  for (const a of assignments.filter(a => a.tech_id === techId)) {
    const v = vById[a.vehicle_id];
    if (!v) continue;
    const d = day(a.work_date);
    d.vins.add(v.vin);
    if (assignments.some(o => o.tech_id !== techId && o.vehicle_id === a.vehicle_id && o.work_date === a.work_date)) d.shared = true;
  }
  for (const u of unassigned.filter(u => u.assigned_tech_id === techId && !u.dismissed)) {
    const d = day(u.work_date);
    d.vins.add(u.vin);
    d.noTruckPicks += 1;
  }
  return Object.values(days).map(d => {
    const vins = [...d.vins];
    const rows = daily.filter(r => r.work_date === d.date && vins.includes(r.vin));
    const idle = rows.filter(r => r.idle_minutes != null);
    const spd = rows.filter(r => r.speeding_minutes != null);
    return scoreDriverDay({
      date: d.date, shared: d.shared, noTruckPicks: d.noTruckPicks,
      vehicles: vins.map(vin => vByVin[vin]?.name || vin),
      miles: rows.reduce((s, r) => s + (Number(r.miles) || 0), 0),
      idleMinutes: idle.length ? idle.reduce((s, r) => s + Number(r.idle_minutes), 0) : null,
      speedingMinutes: spd.length ? spd.reduce((s, r) => s + Number(r.speeding_minutes), 0) : null,
      events: events.filter(e => e.work_date === d.date && vins.includes(e.vin)),
    }, cfg);
  }).sort((a, b) => b.date.localeCompare(a.date));
}

// Weekly score = average of the scored days (each day counts the same).
export function weeklyDriverScore(days, cfg = DRIVER_CONFIG) {
  const scored = days.filter(d => d.score != null);
  if (!scored.length) return { score: null, pass: null, scoredDays: 0 };
  const score = scored.reduce((s, d) => s + d.score, 0) / scored.length;
  return { score, pass: score >= cfg.passLine, scoredDays: scored.length };
}

// Days a vehicle drove (miles or trips) with nobody's pick on it.
export function findUnassignedDriving({ assignments = [], vehicles = [], daily = [] }, cfg = DRIVER_CONFIG) {
  const vByVin = Object.fromEntries(vehicles.map(v => [v.vin, v]));
  return daily.filter(r => (Number(r.miles) > 0 || Number(r.trips) > 0) && vByVin[r.vin] &&
    !assignments.some(a => a.vehicle_id === vByVin[r.vin].id && a.work_date === r.work_date))
    .map(r => ({ vin: r.vin, work_date: r.work_date, miles: Number(r.miles) || 0, vehicle: vByVin[r.vin].name }));
}
