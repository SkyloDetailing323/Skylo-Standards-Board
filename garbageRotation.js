// garbageRotation.js
// Nightly garbage rotation -- who takes the bins out each work night. Pure
// functions used by netlify/functions/garbage-duty.mjs (which saves the
// garbage_duty rows) and the app (week preview). Ops only: nothing here
// touches hours, pay, bonuses or scores.
//
// Eligible: active detail techs (TRUCK_DRIVER_TITLES + detail_apprentice),
//   not on leave. Owners, sales and the Field Supervisor never get it.
// Works that day: the Work Schedule (tech_schedule by weekday) adjusted by
//   schedule_exceptions -- time off removes the day, an extra day adds it.
//   Company holidays have no regular schedule (an extra day still counts).
// A night needs garbage if at least one eligible tech works that day.
// Rotation: the working tech whose last DONE garbage night is the oldest
//   (never = first). Ties -> first name.
// Lock (10:00 AM Mountain): if that tech hasn't clocked in yet, it moves to
//   the next tech in rotation who has; the reason is logged.

import { TRUCK_DRIVER_TITLES } from "./staffRules.js";

export const GARBAGE_TITLES = [...TRUCK_DRIVER_TITLES, "detail_apprentice"];
export const GARBAGE_LOCK_HOUR = 10;          // 10:00 AM America/Denver
export const GARBAGE_STATUSES = ["assigned", "done", "excused", "missed"];

// 1 = Monday ... 6 = Saturday, 7 = Sunday (tech_schedule.weekday).
export function isoWeekday(dateStr) {
  const d = new Date(dateStr + "T12:00:00Z").getUTCDay();
  return d === 0 ? 7 : d;
}
export function addDays(dateStr, n) {
  const d = new Date(dateStr + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export const isGarbageEligible = t => !!t && t.is_active !== false && !t.on_leave && GARBAGE_TITLES.includes(t.title || "detail_apprentice");

// Scheduled to work `date`, same reading as the Work Schedule tab: any
// vehicle in that weekday's box (not "Off"), minus time off, plus extra days.
export function worksOn(techId, date, schedule = [], exceptions = [], holidays = []) {
  const ex = exceptions.find(e => e.tech_id === techId && e.date === date);
  if (ex?.kind === "off") return false;
  if (ex?.kind === "extra") return true;
  if (holidays.includes(date)) return false;
  const wd = isoWeekday(date);
  return schedule.some(s => s.tech_id === techId && s.weekday === wd && s.vehicle);
}

export function workingEligible(date, { techs = [], schedule = [], exceptions = [], holidays = [] }) {
  return techs.filter(t => isGarbageEligible(t) && worksOn(t.id, date, schedule, exceptions, holidays));
}

// tech_id -> the latest work_date (before `beforeDate`) they finished garbage.
export function lastDoneByTech(duties = [], beforeDate = "9999-12-31") {
  const last = {};
  for (const d of duties) {
    if (d.status !== "done" || !d.tech_id || d.work_date >= beforeDate) continue;
    if (!last[d.tech_id] || d.work_date > last[d.tech_id]) last[d.tech_id] = d.work_date;
  }
  return last;
}

const firstName = t => String(t?.name || "").trim().split(/\s+/)[0].toLowerCase();
// Oldest last-done first (never done = ""), then first name, then full name.
export function rotationOrder(cands, lastDone = {}) {
  return [...cands].sort((a, b) =>
    (lastDone[a.id] || "").localeCompare(lastDone[b.id] || "") ||
    firstName(a).localeCompare(firstName(b)) ||
    String(a.name || "").localeCompare(String(b.name || "")) ||
    String(a.id).localeCompare(String(b.id)));
}

// The rotation's pick for `date` (no clock-in check) -- what the preview shows.
export function rotationPick(date, ctx, lastDone) {
  return rotationOrder(workingEligible(date, ctx), lastDone)[0] || null;
}

// The 10:00 AM lock for `date`. clockedIn: Set of tech ids with a time entry
// that day (read only). Returns { tech_id, reassigned_from, reason } or null
// when nobody eligible works that day.
export function lockDay(date, ctx, clockedIn = new Set()) {
  const { techs = [], duties = [] } = ctx;
  const lastDone = lastDoneByTech(duties, date);
  const working = workingEligible(date, ctx);
  if (!working.length) return null;
  const order = rotationOrder(working, lastDone);
  const notes = [];
  // Whose turn it was by the regular schedule but who has time off today.
  const turnIgnoringOff = rotationOrder(techs.filter(t => isGarbageEligible(t) &&
    worksOn(t.id, date, ctx.schedule, (ctx.exceptions || []).filter(e => !(e.tech_id === t.id && e.date === date && e.kind === "off")), ctx.holidays)), lastDone)[0];
  if (turnIgnoringOff && !working.some(t => t.id === turnIgnoringOff.id)) notes.push(`${turnIgnoringOff.name} has time off`);

  const pick = order[0];
  if (clockedIn.has(pick.id)) {
    return { tech_id: pick.id, reassigned_from: notes.length ? turnIgnoringOff.id : null, reason: notes.length ? `Backup: ${notes.join("; ")}` : null };
  }
  // Backup: next in rotation who IS clocked in -- scheduled techs first, then
  // any other eligible tech who clocked in that day.
  const others = rotationOrder(techs.filter(t => isGarbageEligible(t) && clockedIn.has(t.id) && !working.some(w => w.id === t.id)), lastDone);
  const backup = [...order.slice(1), ...others].find(t => clockedIn.has(t.id));
  if (!backup) {
    notes.push(`nobody on the schedule had clocked in by 10:00 AM, so it stays with ${pick.name}`);
    return { tech_id: pick.id, reassigned_from: null, reason: notes.join("; ") };
  }
  notes.push(`${pick.name} hadn't clocked in by 10:00 AM`);
  return { tech_id: backup.id, reassigned_from: pick.id, reason: `Backup: ${notes.join("; ")}` };
}

// Next `days` nights from `start`: saved rows as they are, the rest from the
// rotation, assuming each previewed tech does their night.
// -> [{ work_date, tech_id, status, locked, row }]  (tech_id null = no one works)
export function planWeek(start, ctx, days = 7) {
  const duties = ctx.duties || [];
  const lastDone = lastDoneByTech(duties, start);
  const out = [];
  for (let i = 0; i < days; i++) {
    const date = addDays(start, i);
    const row = duties.find(d => d.work_date === date);
    if (row) {
      out.push({ work_date: date, tech_id: row.tech_id, status: row.status, locked: true, row });
      if (row.status === "done" || row.status === "assigned") lastDone[row.tech_id] = date;
      continue;
    }
    const pick = rotationPick(date, ctx, lastDone);
    out.push({ work_date: date, tech_id: pick?.id || null, status: pick ? "preview" : "none", locked: false, row: null });
    if (pick) lastDone[pick.id] = date;
  }
  return out;
}

// Last-N-days fairness table: tech_id -> { done, missed, excused, assigned }.
export function dutyCounts(duties = [], from, to) {
  const out = {};
  for (const d of duties) {
    if (d.work_date < from || d.work_date > to || !d.tech_id) continue;
    const c = out[d.tech_id] = out[d.tech_id] || { done: 0, missed: 0, excused: 0, assigned: 0 };
    if (c[d.status] != null) c[d.status]++;
  }
  return out;
}
