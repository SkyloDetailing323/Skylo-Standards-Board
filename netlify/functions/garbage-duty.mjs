// netlify/functions/garbage-duty.mjs
// Nightly garbage rotation (rules in garbageRotation.js). garbage_duty and
// the private 'garbage-photos' bucket are closed to the browser; this checks
// the login token and uses the service key.
//
// HOURS ARE NEVER TOUCHED: the only thing read from time_entries is which
// techs clocked in today (for the 10 AM backup). Nothing here creates, edits,
// deletes or re-times a time entry. Ops only -- no pay, bonus or score.
//
// GET                         -> tonight, the 7-day preview, and for owners /
//                                the Field Supervisor: 30-day history, counts,
//                                photo links.
// POST {action:"done", photo} -> the assigned tech, tonight, with the bins photo
//                                (JPEG data URL). Owner/manager: photo optional.
// POST {action:"excuse", reason}            owner/manager
// POST {action:"reassign", tech_id, reason} owner/manager
// POST {action:"run"}  -> the hourly timer (x-internal-key): marks past nights
//                         with no photo 'missed', locks today at 10:00 AM.
// Every GET/POST also does that same upkeep first, so it never depends on the
// timer having run.

import auth from "./lib/authToken.js";
import { lockDay, planWeek, dutyCounts, addDays, GARBAGE_LOCK_HOUR, isGarbageEligible } from "../../garbageRotation.js";
import { DEFAULT_HOLIDAYS } from "../../staffRules.js";

const BUCKET = "garbage-photos";
const MAX_PHOTO_BYTES = 4 * 1024 * 1024;
const PAGE = 1000;
const isUuid = s => /^[0-9a-f-]{36}$/i.test(s || "");
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
// Real Mountain time (DST-aware) for the date and the 10 AM lock.
const mtParts = () => {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "America/Denver", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" })
    .formatToParts(new Date()).map(x => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) };
};

async function sb(path, options = {}) {
  const res = await fetch(`${process.env.SUPABASE_URL}/rest/v1/${path}`, {
    method: options.method || "GET", body: options.body,
    headers: { "Content-Type": "application/json", apikey: process.env.SUPABASE_KEY, Authorization: `Bearer ${process.env.SUPABASE_KEY}`, Prefer: options.prefer || "return=representation", ...(options.range ? { Range: options.range } : {}) },
  });
  if (res.status === 204) return null;
  const text = await res.text();
  if (!res.ok) { const e = new Error(`Supabase ${path.split("?")[0]} (HTTP ${res.status}): ${text.slice(0, 200)}`); e.missingTable = /42P01|PGRST205|does not exist|Could not find the table/.test(text); throw e; }
  return text ? JSON.parse(text) : null;
}
async function sbGetAll(path) {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const page = await sb(path, { range: `${from}-${from + PAGE - 1}` });
    rows.push(...(page || []));
    if (!page || page.length < PAGE) return rows;
  }
}
const storage = (path, options = {}) => fetch(`${process.env.SUPABASE_URL}/storage/v1/${path}`, {
  method: options.method || "POST", body: options.body,
  headers: { apikey: process.env.SUPABASE_KEY, Authorization: `Bearer ${process.env.SUPABASE_KEY}`, ...(options.headers || {}) },
});

async function loadCtx(today) {
  const [techs, schedule, exceptions, settings, duties] = await Promise.all([
    sbGetAll("techs?select=id,name,title,is_active,on_leave"),
    sbGetAll("tech_schedule?select=tech_id,weekday,vehicle"),
    sbGetAll(`schedule_exceptions?select=tech_id,date,kind&date=gte.${addDays(today, -1)}&date=lte.${addDays(today, 8)}`),
    sb("settings?key=eq.holidays&select=value").catch(() => []),
    sbGetAll(`garbage_duty?select=*&work_date=gte.${addDays(today, -120)}&order=work_date.desc`),
  ]);
  let holidays = DEFAULT_HOLIDAYS;
  try { const v = JSON.parse(settings?.[0]?.value); if (Array.isArray(v)) holidays = v; } catch {}
  return { techs, schedule, exceptions, holidays, duties };
}

const patch = (id, body) => sb(`garbage_duty?id=eq.${id}`, { method: "PATCH", body: JSON.stringify({ ...body, updated_at: new Date().toISOString() }) }).then(r => r?.[0]);

// Past nights still 'assigned' -> 'missed' (status only). Today at/after
// 10:00 AM with no row -> lock it.
async function upkeep(ctx, now, force = false) {
  const stale = ctx.duties.filter(d => d.status === "assigned" && d.work_date < now.date);
  for (const d of stale) Object.assign(d, await patch(d.id, { status: "missed", updated_by: "midnight job", reason: d.reason ? `${d.reason}; no photo by midnight` : "No photo by midnight" }));
  if (ctx.duties.some(d => d.work_date === now.date) || (!force && now.hour < GARBAGE_LOCK_HOUR)) return;
  // Read only: who has clocked in today.
  // An admin locking early (before 10 AM) gets the plain rotation pick -- the
  // "hasn't clocked in" backup only applies at the 10 AM lock.
  const entries = force && now.hour < GARBAGE_LOCK_HOUR ? null : await sbGetAll(`time_entries?select=tech_id&work_date=eq.${now.date}`);
  const pick = lockDay(now.date, ctx, entries ? new Set(entries.map(e => e.tech_id)) : new Set(ctx.techs.map(t => t.id)));
  if (!pick) return;
  const rows = await sb("garbage_duty?on_conflict=work_date", { method: "POST", prefer: "resolution=ignore-duplicates,return=representation",
    body: JSON.stringify({ work_date: now.date, tech_id: pick.tech_id, status: "assigned", reassigned_from: pick.reassigned_from, reason: pick.reason, updated_by: force ? "locked early (admin)" : "10 AM lock" }) });
  const row = rows?.[0] || (await sb(`garbage_duty?work_date=eq.${now.date}&select=*`))?.[0];
  if (row) ctx.duties.unshift(row);
}

async function signedUrl(path) {
  const res = await storage(`object/sign/${BUCKET}/${path}`, { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expiresIn: 3600 }) });
  const j = await res.json().catch(() => ({}));
  return res.ok && j.signedURL ? `${process.env.SUPABASE_URL}/storage/v1${j.signedURL}` : null;
}

async function savePhoto(dataUrl, row) {
  const m = String(dataUrl || "").match(/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/);
  if (!m) { const e = new Error("Take a photo of the bins first"); e.status = 400; throw e; }
  const buf = Buffer.from(m[2], "base64");
  if (!buf.length || buf.length > MAX_PHOTO_BYTES) { const e = new Error("That photo is too big — try again"); e.status = 400; throw e; }
  const path = `${row.work_date}/${row.tech_id}-${Date.now()}.${m[1] === "jpeg" ? "jpg" : m[1]}`;
  const res = await storage(`object/${BUCKET}/${path}`, { headers: { "Content-Type": `image/${m[1]}`, "x-upsert": "true" }, body: buf });
  if (!res.ok) throw new Error(`Photo upload failed (HTTP ${res.status}): ${(await res.text()).slice(0, 200)}`);
  return path;
}

export default async (req) => {
  const headers = Object.fromEntries(req.headers);
  const key = auth.internalKey();
  const timer = !!key && headers["x-internal-key"] === key;
  const who = timer ? null : auth.verifyToken(auth.tokenFrom({ headers }));
  if (!timer && !who) return json(401, { error: "Log in again" });
  const admin = !!who && (who.role === "owner" || who.role === "manager");
  const by = who ? (who.name || (who.techId ? `tech:${who.techId}` : who.role)) : "timer";

  try {
    const now = mtParts();
    const ctx = await loadCtx(now.date);
    let body = {};
    if (req.method === "POST") { try { body = await req.json(); } catch { return json(400, { error: "Bad request" }); } }
    // Admin actions on today before 10 AM lock the day first.
    const adminAct = admin && ["done", "excuse", "reassign"].includes(body.action);
    await upkeep(ctx, now, adminAct);

    if (req.method === "POST") {
      if (body.action === "run") {
        if (!timer && !admin) return json(403, { error: "Not allowed" });
        return json(200, { ok: true, today: now.date, tonight: ctx.duties.find(d => d.work_date === now.date) || null });
      }
      const row = ctx.duties.find(d => d.work_date === now.date);
      if (!row) return json(400, { error: "No garbage night today (nobody eligible is on the schedule)" });
      let saved;
      if (body.action === "done") {
        if (!admin && row.tech_id !== who.techId) return json(403, { error: "Garbage tonight isn't yours" });
        if (!admin && row.status !== "assigned") return json(400, { error: `Tonight is already marked ${row.status}` });
        const photo_path = body.photo ? await savePhoto(body.photo, row) : (admin ? row.photo_path : null);
        if (!photo_path && !admin) return json(400, { error: "Take a photo of the bins first" });
        saved = await patch(row.id, { status: "done", photo_path, done_at: new Date().toISOString(), updated_by: by, ...(admin && !body.photo ? { reason: [row.reason, `Marked done by ${by}`].filter(Boolean).join("; ") } : {}) });
      } else if (body.action === "excuse") {
        if (!admin) return json(403, { error: "Owners and the Field Supervisor only" });
        saved = await patch(row.id, { status: "excused", updated_by: by, reason: [row.reason, `Excused by ${by}${body.reason ? `: ${String(body.reason).slice(0, 200)}` : ""}`].filter(Boolean).join("; ") });
      } else if (body.action === "reassign") {
        if (!admin) return json(403, { error: "Owners and the Field Supervisor only" });
        const to = ctx.techs.find(t => t.id === body.tech_id);
        if (!isUuid(body.tech_id) || !isGarbageEligible(to)) return json(400, { error: "Pick an active detail tech" });
        if (to.id === row.tech_id) return json(400, { error: "They already have it" });
        saved = await patch(row.id, { tech_id: to.id, status: "assigned", photo_path: null, done_at: null, reassigned_from: row.tech_id, updated_by: by,
          reason: [row.reason, `Reassigned by ${by}${body.reason ? `: ${String(body.reason).slice(0, 200)}` : ""}`].filter(Boolean).join("; ") });
      } else return json(400, { error: "Unknown action" });
      Object.assign(row, saved || {});
    }

    const tonight = ctx.duties.find(d => d.work_date === now.date) || null;
    const week = planWeek(now.date, ctx, 7).map(({ row, ...d }) => d);
    const out = { today: now.date, lock_hour: GARBAGE_LOCK_HOUR, locked: !!tonight,
      tonight: tonight ? { work_date: tonight.work_date, tech_id: tonight.tech_id, status: tonight.status, done_at: tonight.done_at } : null, week };
    if (admin) {
      const from = addDays(now.date, -29);
      const history = ctx.duties.filter(d => d.work_date >= from && d.work_date <= now.date);
      const withPhotos = await Promise.all(history.map(async d => ({ ...d, photo_url: d.photo_path ? await signedUrl(d.photo_path) : null })));
      out.tonight = withPhotos.find(d => d.work_date === now.date) || null;
      out.history = withPhotos;
      out.counts = dutyCounts(ctx.duties, from, now.date);
    }
    return json(200, out);
  } catch (e) {
    if (!e.missingTable) console.error("garbage-duty:", e.message);
    return json(e.status || 500, { error: e.missingTable ? "The garbage rotation table hasn't been created yet (migration not applied)" : e.message, missing_table: !!e.missingTable });
  }
};
