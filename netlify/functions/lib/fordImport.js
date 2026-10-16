// netlify/functions/lib/fordImport.js
// Saves one day of Ford Pro report rows (built by fordReports.js) into
// ford_vehicle_daily / ford_vehicle_events. Shared by the Trucks tab's
// "Upload Ford reports" button (driver-scores.js ?action=import) and the
// automatic Ford email import (ford-email-import.mjs), so both store exactly
// the same thing. Only the known columns are kept -- never locations.
// Re-importing a day upserts.

const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s || "");
const isVin = s => /^[A-HJ-NPR-Z0-9]{17}$/i.test(s || "");

async function sb(path, options = {}) {
  const res = await fetch(`${process.env.SUPABASE_URL}/rest/v1/${path}`, {
    method: options.method || "GET", body: options.body,
    headers: { "Content-Type": "application/json", apikey: process.env.SUPABASE_KEY, Authorization: `Bearer ${process.env.SUPABASE_KEY}`, Prefer: options.prefer || "return=representation", ...(options.range ? { Range: options.range } : {}) },
  });
  if (res.status === 204) return null;
  const text = await res.text();
  if (!res.ok) { const e = new Error(`Supabase ${path.split("?")[0]} (HTTP ${res.status}): ${text.slice(0, 300)}`); e.missingTable = /42P01|does not exist/.test(text); throw e; }
  return text ? JSON.parse(text) : null;
}

// b: { work_date, daily: [...], events: [...] }. source: what ends up in
// ford_vehicle_daily.source and the ford_last_run note.
async function importReports(b, by, source = "report_upload") {
  if (!isDate(b.work_date)) { const e = new Error("work_date required"); e.status = 400; throw e; }
  const daily = (Array.isArray(b.daily) ? b.daily : []).filter(r => isVin(r.vin)).map(r => ({
    vin: r.vin.toUpperCase(), work_date: b.work_date, miles: Number(r.miles) || 0,
    trips: Number.isFinite(Number(r.trips)) ? Math.round(Number(r.trips)) : null,
    idle_minutes: r.idle_minutes == null ? null : Number(r.idle_minutes),
    speeding_minutes: r.speeding_minutes == null ? null : Number(r.speeding_minutes),
    source, raw: { vehicle: String(r.vehicle || "").slice(0, 40) }, synced_at: new Date().toISOString(),
  }));
  const nums = v => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
  const events = (Array.isArray(b.events) ? b.events : []).filter(e => isVin(e.vin) && isDate(e.work_date) && e.event_time && e.event_type).map(e => ({
    id: String(e.id || `${e.vin}|${e.event_time}|${e.event_type}`).slice(0, 200), vin: e.vin.toUpperCase(),
    event_time: e.event_time, work_date: e.work_date, event_type: String(e.event_type).slice(0, 80),
    mph_over: nums(e.mph_over), speed_mph: nums(e.speed_mph), limit_mph: nums(e.limit_mph), duration_sec: nums(e.duration_sec),
    raw: null, synced_at: new Date().toISOString(),
  }));
  if (!daily.length && !events.length) { const e = new Error("Nothing to import — add the Fleet Activity Summary and event reports"); e.status = 400; throw e; }
  for (let i = 0; i < daily.length; i += 500) await sb("ford_vehicle_daily?on_conflict=vin,work_date", { method: "POST", prefer: "resolution=merge-duplicates,return=minimal", body: JSON.stringify(daily.slice(i, i + 500)) });
  for (let i = 0; i < events.length; i += 500) await sb("ford_vehicle_events?on_conflict=id", { method: "POST", prefer: "resolution=merge-duplicates,return=minimal", body: JSON.stringify(events.slice(i, i + 500)) });
  const run = { source, work_date: b.work_date, trucks: daily.length, events: events.length, by, finished_at: new Date().toISOString() };
  await sb("ghl_sync_state?on_conflict=key", { method: "POST", prefer: "resolution=merge-duplicates,return=minimal", body: JSON.stringify({ key: "ford_last_run", value: run, updated_at: run.finished_at }) }).catch(() => {});
  return { ok: true, ...run };
}

module.exports = { sb, importReports, isDate, isVin };
