// fordReports.js
// Reads the CSV files from Ford Pro's daily scheduled report email (the
// "Driver score" schedule sent to Equipment@skylod.com) into the rows the
// driver scorecard stores: miles / idle / speeding minutes per truck per day
// (ford_vehicle_daily) and individual driving events (ford_vehicle_events).
// Pure functions -- used by the Trucks tab's "Upload Ford reports" button.
//
// Only these reports are used (others in the email are skipped):
//   Fleet Activity Summary            -> miles, trips, idle, speeding minutes per VIN
//   Vehicle Speeding Events Enhanced  -> each speeding event (speed + posted limit)
//   Vehicle Harsh Events Enhanced     -> harsh braking / acceleration
//   Vehicle Seat Belt Violations Enhanced
//   Vehicle Excessive Idling Enhanced
// Ford's latitude / longitude / address columns are never kept.

// RFC-4180-ish CSV parser (quoted fields, commas and newlines in quotes).
export function parseCsv(text) {
  const t = String(text || "").replace(/^﻿/, "");
  const rows = []; let row = [], cur = "", q = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (q) {
      if (ch === '"' && t[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") { row.push(cur); cur = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && t[i + 1] === "\n") i++;
      row.push(cur); rows.push(row); row = []; cur = "";
    } else cur += ch;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  const nonEmpty = rows.filter(r => r.some(c => c.trim() !== ""));
  if (!nonEmpty.length) return { headers: [], rows: [] };
  const headers = nonEmpty[0].map(h => h.trim());
  return { headers, rows: nonEmpty.slice(1).map(r => Object.fromEntries(headers.map((h, i) => [h, (r[i] ?? "").trim()]))) };
}

const has = (headers, ...names) => names.every(n => headers.includes(n));
export function reportKind(headers) {
  if (has(headers, "VIN", "Distance Driven (mi)", "Total Idle Time (hr)")) return "fleet_activity";
  if (has(headers, "Speed Limit (mph)", "Speed (mph)", "Event Type")) return "speeding";
  if (has(headers, "VIN", "Event Type", "Duration (Seconds)")) return "seatbelt";
  if (has(headers, "VIN", "Event Type")) return "harsh";
  if (has(headers, "VIN", "Duration (Seconds)")) return "idling";
  return null;
}

const num = v => { const n = Number(String(v ?? "").replace(/[^0-9.\-]/g, "")); return Number.isFinite(n) && String(v ?? "").trim() !== "" && v !== "-" ? n : null; };
// Ford shows short durations as "<10" seconds.
const seconds = v => String(v || "").trim().startsWith("<") ? Math.max(0, (num(v) ?? 10) / 2) : num(v);
// "Mav/1" (Ford) -> "mav1"; "Mav 1" (ours) -> "mav1".
export const vehicleKey = s => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");

// Ford's "10/6/26" + "6:56:58 AM" (Mountain time) -> { work_date, event_time }.
// Fixed -6h, the same Mountain-time convention as the rest of the app.
export function fordDateTime(date, time) {
  const m = String(date || "").match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m) return null;
  const year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  const work_date = `${year}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  const t = String(time || "").match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AP]M)$/i);
  if (!t) return { work_date, event_time: `${work_date}T12:00:00-06:00` };
  let h = Number(t[1]) % 12; if (/pm/i.test(t[4])) h += 12;
  return { work_date, event_time: `${work_date}T${String(h).padStart(2, "0")}:${t[2]}:${t[3] || "00"}-06:00` };
}

// files: [{ name, text }]; vehicles: our vehicles rows (name, vin).
// Returns everything the import needs plus a preview of what was found.
export function buildFordImport(files, vehicles = []) {
  const warnings = [], used = [], skipped = [];
  const parsed = files.map(f => ({ name: f.name, ...parseCsv(f.text) })).map(f => ({ ...f, kind: reportKind(f.headers) }));
  // Ford names trucks "Mav/1"; map names to VINs from Fleet Activity first,
  // then from our own vehicles list.
  const vinByName = {};
  vehicles.forEach(v => { vinByName[vehicleKey(v.name)] = v.vin; });
  parsed.filter(f => f.kind === "fleet_activity").forEach(f => f.rows.forEach(r => { if (r.VIN) vinByName[vehicleKey(r["Vehicle Name"])] = r.VIN.toUpperCase(); }));
  const knownVins = new Set(vehicles.map(v => v.vin));

  const daily = [], events = [], dates = {};
  const seen = {};
  const addEvent = (vin, date, time, type, extra) => {
    const dt = fordDateTime(date, time);
    if (!vin || !dt) return;
    dates[dt.work_date] = (dates[dt.work_date] || 0) + 1;
    const base = `${vin}|${dt.event_time}|${type}`;
    seen[base] = (seen[base] || 0) + 1;
    events.push({ id: seen[base] > 1 ? `${base}|${seen[base]}` : base, vin, work_date: dt.work_date, event_time: dt.event_time, event_type: type, ...extra });
  };
  const vinOf = (r) => (r.VIN ? r.VIN.toUpperCase() : vinByName[vehicleKey(r.Vehicle)]) || null;

  for (const f of parsed) {
    if (!f.kind) { skipped.push(f.name); continue; }
    used.push(`${f.name} (${f.kind.replace("_", " ")}, ${f.rows.length} rows)`);
    for (const r of f.rows) {
      if (f.kind === "fleet_activity") {
        const vin = (r.VIN || "").toUpperCase();
        if (!vin) continue;
        const posted = num(r["Speeding Over Posted Duration (min)"]) ?? 0;
        const over85 = num(r["Speeding Over Threshold Duration (min)"]) ?? 0;
        daily.push({ vin, vehicle: r["Vehicle Name"], miles: num(r["Distance Driven (mi)"]) ?? 0, trips: num(r.Trips),
          idle_minutes: num(r["Total Idle Time (hr)"]) != null ? Math.round(num(r["Total Idle Time (hr)"]) * 60 * 10) / 10 : null,
          speeding_minutes: Math.round((posted + over85) * 100) / 100 });
        continue;
      }
      const vin = vinOf(r);
      if (!vin) { warnings.push(`No VIN for truck "${r.Vehicle}" in ${f.name}`); continue; }
      if (f.kind === "speeding") {
        const speed = num(r["Speed (mph)"]), limit = num(r["Speed Limit (mph)"]);
        addEvent(vin, r.Date, r.Time, r["Event Type"], { speed_mph: speed, limit_mph: limit,
          mph_over: speed != null && limit != null ? speed - limit : null, duration_sec: seconds(r["Duration (Seconds)"]) });
      } else if (f.kind === "harsh") {
        addEvent(vin, r.Date, r.Time, r["Event Type"], {});
      } else if (f.kind === "seatbelt") {
        addEvent(vin, r.Date, r.Time, r["Event Type"], { duration_sec: seconds(r["Duration (Seconds)"]) });
      } else if (f.kind === "idling") {
        addEvent(vin, r.Date, r.Time, "Excessive Idling", { duration_sec: seconds(r["Duration (Seconds)"]) });
      }
    }
  }
  if (!parsed.some(f => f.kind === "fleet_activity")) warnings.push("No Fleet Activity Summary file — miles come from that report, so no day can be scored without it.");
  const unknownVins = [...new Set([...daily.map(d => d.vin), ...events.map(e => e.vin)])].filter(v => !knownVins.has(v));
  if (unknownVins.length) warnings.push(`VIN(s) not in the vehicles list (add them on the Trucks tab or they won't match anyone's pick): ${unknownVins.join(", ")}`);
  // The day the report covers: the date most events carry. Fleet Activity
  // has no date column, so its rows go on that day.
  const workDate = Object.entries(dates).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
  if (Object.keys(dates).length > 1) warnings.push(`Events span more than one day (${Object.keys(dates).sort().join(", ")}); each event keeps its own date.`);
  return { workDate, daily, events, used, skipped, warnings };
}
