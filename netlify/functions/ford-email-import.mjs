// netlify/functions/ford-email-import.mjs
// Automatic Ford Pro driver data import. Ford's daily "Ford Pro(TM) Telematics
// Report Delivered" email (from no-reply@na.fcs-ford.com, auto-forwarded to
// team@skylod.com) has no attachments -- it links to CSV files on
// storage.googleapis.com that expire after 7 days. This finds those emails
// from the last 7 days, downloads only the five files fordReports.js reads
// (see FORD_EMAIL_FILES), and saves each day with lib/fordImport.js -- the
// same code the Trucks tab's "Upload Ford reports" button uses. The work
// date is the date in the file name. Days already imported (automatically
// or by hand) are skipped, so the first run backfills every day whose links
// still work and later runs only pick up the new day.
//
// Read-only on Gmail (same gmail.readonly login as hcp-tip-sync.js). The
// download links are never stored or returned. Run state lives in
// ghl_sync_state (key ford_email_import) -- no new table.
//
// POST  run the import. Started daily at 7:30 AM Mountain by
//       ford-email-import-cron.js (internal key), or by an owner/manager's
//       "Import now" button on the Trucks tab (login token). Returns
//       more: true if it ran out of time -- call again to continue.
// GET   status for the Trucks tab (owner/manager): last automatic import
//       and whether yesterday is missing.

import auth from "./lib/authToken.js";
import gmail from "./lib/gmailClient.js";
import fordImport from "./lib/fordImport.js";
import { buildFordImport, fordReportLinks, parseCsv, reportKind } from "../../fordReports.js";

const { sb, importReports } = fordImport;
const STATE_KEY = "ford_email_import";
const QUERY = 'from:no-reply@na.fcs-ford.com subject:"Report Delivered" newer_than:8d';
const MAX_MESSAGES = 30;
const TIME_BUDGET_MS = 18000;          // function timeout is 26s
const FETCH_TIMEOUT_MS = 10000;
const MAX_CSV_BYTES = 5 * 1024 * 1024;
const KEEP_DAYS = 45;                  // per-day notes kept in the state row
const BY = "Ford email (automatic)";

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
const mtDay = (offsetDays = 0) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Denver" }).format(new Date(Date.now() - offsetDays * 864e5));
const mtHourMin = () => new Intl.DateTimeFormat("en-GB", { timeZone: "America/Denver", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date());

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try { return await fetch(url, { ...options, signal: controller.signal }); }
  finally { clearTimeout(timer); }
}

async function gmailGet(token, path) {
  const res = await fetchWithTimeout(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, { headers: { Authorization: `Bearer ${token}` } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Gmail ${path.split("?")[0]} failed (HTTP ${res.status})`);
  return data;
}
const b64url = s => Buffer.from(String(s).replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");

// The email's HTML body (Gmail moves big bodies into an "attachment").
async function messageHtml(token, id) {
  const msg = await gmailGet(token, `messages/${id}?format=full`);
  const parts = [];
  (function walk(p) { if (!p) return; if (p.mimeType === "text/html") parts.push(p); (p.parts || []).forEach(walk); })(msg.payload);
  let html = "";
  for (const p of parts) {
    if (p.body?.data) html += b64url(p.body.data);
    else if (p.body?.attachmentId) html += b64url((await gmailGet(token, `messages/${id}/attachments/${p.body.attachmentId}`)).data || "");
  }
  return { html, internalDate: Number(msg.internalDate || 0) };
}

async function download(url) {
  const res = await fetchWithTimeout(url);
  if (res.status === 400 || res.status === 403) { const e = new Error("link expired"); e.expired = true; throw e; }
  if (!res.ok) throw new Error(`download failed (HTTP ${res.status})`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_CSV_BYTES) throw new Error("file too large");
  return buf.toString("utf8");
}

async function loadState() {
  const r = await sb(`ghl_sync_state?key=eq.${STATE_KEY}&select=value`).catch(() => []);
  const v = r && r[0] ? r[0].value : null;
  return { days: {}, ...(v || {}) };
}
async function saveState(state) {
  const cutoff = mtDay(KEEP_DAYS);
  for (const d of Object.keys(state.days)) if (d < cutoff) delete state.days[d];
  await sb("ghl_sync_state?on_conflict=key", { method: "POST", prefer: "resolution=merge-duplicates,return=minimal",
    body: JSON.stringify({ key: STATE_KEY, value: state, updated_at: new Date().toISOString() }) });
}
// Truck rows already in ford_vehicle_daily per day (by any import).
async function storedTrucks(dates) {
  if (!dates.length) return {};
  const rows = await sb(`ford_vehicle_daily?select=work_date&work_date=in.(${dates.join(",")})`, { range: "0-9999" });
  const n = {};
  (rows || []).forEach(r => { n[r.work_date] = (n[r.work_date] || 0) + 1; });
  return n;
}

async function runImport() {
  const started = Date.now();
  const state = await loadState();
  const token = await gmail.getAccessToken();

  const list = await gmailGet(token, `messages?q=${encodeURIComponent(QUERY)}&maxResults=${MAX_MESSAGES}`);
  const ids = (list.messages || []).map(m => m.id);
  // Newest email first, so a re-sent report wins over an older copy.
  const emails = [];
  for (const id of ids) emails.push(await messageHtml(token, id));
  emails.sort((a, b) => b.internalDate - a.internalDate);
  const byDate = {};                   // work_date -> kind -> link
  for (const e of emails) for (const l of fordReportLinks(e.html)) {
    byDate[l.work_date] = byDate[l.work_date] || {};
    if (!byDate[l.work_date][l.kind] && (!l.expiresAt || l.expiresAt > Date.now() + 60000)) byDate[l.work_date][l.kind] = l;
  }

  const dates = Object.keys(byDate).sort();
  const already = await storedTrucks(dates);
  const vehicles = await sb("vehicles?select=name,vin", { range: "0-999" }) || [];
  const results = [];
  let more = false;
  for (const date of dates) {
    const prev = state.days[date];
    if (prev && prev.status === "imported") continue;
    if (already[date]) {                // uploaded by hand on the Trucks tab
      if (!prev) state.days[date] = { status: "uploaded", trucks: already[date], at: new Date().toISOString() };
      continue;
    }
    if (Date.now() - started > TIME_BUDGET_MS) { more = true; break; }
    const links = Object.values(byDate[date]);
    const files = [], notes = [];
    for (const l of links) {
      try {
        const text = await download(l.url);
        const kind = reportKind(parseCsv(text).headers);
        if (kind !== l.kind) { notes.push(`${l.kind} file had unexpected columns — skipped`); continue; }
        files.push({ name: l.name, kind, text });
      } catch (e) { notes.push(`${l.kind}: ${e.message}`); }
    }
    const hasFleet = files.some(f => f.kind === "fleet_activity");
    if (!files.length) {
      state.days[date] = { status: links.length ? "failed" : "expired", files: [], note: notes.join("; ").slice(0, 300), at: new Date().toISOString() };
      results.push({ work_date: date, ...state.days[date] });
      continue;
    }
    const built = buildFordImport(files, vehicles);
    let saved = { trucks: 0, events: 0 };
    try {
      if (built.daily.length || built.events.length) saved = await importReports({ work_date: date, daily: built.daily, events: built.events }, BY, "email_import");
    } catch (e) {
      state.days[date] = { status: "failed", files: files.map(f => f.kind), note: e.message.slice(0, 300), at: new Date().toISOString() };
      results.push({ work_date: date, ...state.days[date] });
      continue;
    }
    // Without Fleet Activity there are no miles, so the day can't be scored:
    // keep retrying it on later runs (a re-sent email may have it).
    state.days[date] = {
      status: hasFleet ? "imported" : "no_fleet", trucks: saved.trucks, events: saved.events,
      files: files.map(f => f.kind),
      note: [...notes, ...built.warnings.filter(w => /VIN/.test(w))].join("; ").slice(0, 300) || undefined,
      at: new Date().toISOString(),
    };
    if (hasFleet && (!state.last_import || date >= state.last_import.work_date)) state.last_import = { work_date: date, trucks: saved.trucks, events: saved.events, at: state.days[date].at };
    results.push({ work_date: date, ...state.days[date] });
  }
  state.ran_at = new Date().toISOString();
  state.emails_seen = emails.length;
  await saveState(state);
  return { ok: true, emails: emails.length, days_in_emails: dates, results, more, last_import: state.last_import || null };
}

async function status() {
  const state = await loadState();
  const yesterday = mtDay(1);
  const trucks = (await storedTrucks([yesterday]))[yesterday] || 0;
  const y = state.days[yesterday] || null;
  const ok = trucks > 0 || ["imported", "uploaded"].includes(y?.status);
  let alert = null;
  // Before the 7:30 AM run (plus a little slack), yesterday isn't due yet.
  if (!ok && mtHourMin() >= "07:45") {
    alert = y?.status === "no_fleet" ? `Ford's report for ${yesterday} had no Fleet Activity Summary, so that day has no miles and can't be scored.`
      : y?.status === "failed" ? `Ford's report for ${yesterday} couldn't be imported: ${y.note || "download failed"}.`
      : `No Ford report was imported for ${yesterday}.`;
  }
  return { last_import: state.last_import || null, ran_at: state.ran_at || null, yesterday, yesterday_trucks: trucks, yesterday_status: y?.status || null, alert, days: state.days };
}

export default async (req) => {
  const headers = Object.fromEntries(req.headers);
  const key = auth.internalKey();
  const timer = !!key && headers["x-internal-key"] === key;
  const who = timer ? null : auth.verifyToken(auth.tokenFrom({ headers }));
  if (!timer && !who) return json(401, { error: "Log in again" });
  if (!timer && who.role !== "owner" && who.role !== "manager") return json(403, { error: "Owners and managers only" });
  try {
    if (req.method === "GET") return json(200, await status());
    if (req.method !== "POST") return json(405, { error: "POST to import, GET for status" });
    const out = await runImport();
    console.log(`ford-email-import: ${out.emails} emails, days ${out.days_in_emails.join(",") || "none"}; ${out.results.map(r => `${r.work_date}=${r.status}`).join(" ") || "nothing new"}${out.more ? " (more)" : ""}`);
    return json(200, out);
  } catch (e) {
    console.error("ford-email-import failed:", e.message);
    // Leave a trace for the Trucks tab even when the run fails outright.
    await loadState().then(s => saveState({ ...s, ran_at: new Date().toISOString(), last_error: e.message.slice(0, 300) })).catch(() => {});
    return json(500, { error: e.missingTable ? "The driver scorecard tables haven't been created yet (migration not applied)" : e.message });
  }
};
