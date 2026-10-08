// netlify/functions/hcp-nightly-recheck-background.js
// Nightly safety net for payroll: re-reads every job in the open pay
// period(s) from HCP so edits made in HCP after the job first synced (an
// upsell removed, a price changed, a job reassigned) show up before payday.
// It runs the same two repairs an owner can run by hand -- Repair Revenue
// (hcp-revenue-repair) and the upsell repair (hcp-upsell-repair) -- over a
// few days at a time so neither hits its 26s limit.
//
// Open periods: the current pay period, plus the previous one until its pay
// date has passed (10th/25th schedule, same as Payroll in App.jsx).
// Started by hcp-nightly-recheck-cron.js (internal key) or an owner (?t=token).

const { canRunSync } = require("./lib/authToken");

const SITE = "https://main--skylotechleaderboard.netlify.app";
const CHUNK_DAYS = 4;
// Never re-check periods already paid before this ran (Sep 20-30 was paid
// Oct 7): changing them now would make the app disagree with what was paid.
const FLOOR = "2026-10-01";

const mtToday = () => new Date(Date.now() - 6 * 3600e3).toISOString().slice(0, 10);
const ymd = (y, m, d) => new Date(Date.UTC(y, m, d, 12)).toISOString().slice(0, 10);
const addDays = (s, n) => { const d = new Date(s + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

// Semi-monthly periods: 1st-15th paid the 25th, 16th-end paid the 10th.
function periodFor(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return d <= 15
    ? { start: ymd(y, m - 1, 1), end: ymd(y, m - 1, 15), payout: ymd(y, m - 1, 25) }
    : { start: ymd(y, m - 1, 16), end: ymd(y, m, 0), payout: ymd(y, m, 10) };
}

function rangesToCheck(today) {
  const yesterday = addDays(today, -1);
  const cur = periodFor(yesterday);
  const prev = periodFor(addDays(cur.start, -1));
  let from = prev.payout >= today ? prev.start : cur.start;
  if (from < FLOOR) from = FLOOR;
  const out = [];
  for (let s = from; s <= yesterday; s = addDays(s, CHUNK_DAYS)) {
    const e = addDays(s, CHUNK_DAYS - 1);
    out.push({ from: s, to: e < yesterday ? e : yesterday });
  }
  return out;
}

async function post(fn, body) {
  const res = await fetch(`${SITE}/.netlify/functions/${fn}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const text = await res.text();
  if (!res.ok) throw new Error(`${fn} ${body.from}..${body.to}: HTTP ${res.status} ${text.slice(0, 200)}`);
  return text;
}

async function saveState(value) {
  await fetch(`${process.env.SUPABASE_URL}/rest/v1/ghl_sync_state?on_conflict=key`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: process.env.SUPABASE_KEY, Authorization: `Bearer ${process.env.SUPABASE_KEY}`, Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({ key: "hcp_nightly_recheck_last_run", value, updated_at: new Date().toISOString() }),
  }).catch(() => {});
}

exports.handler = async (event) => {
  if (!canRunSync(event)) return { statusCode: 403, body: "Owners only" };
  const started = new Date().toISOString();
  const ranges = rangesToCheck(mtToday());
  const errors = [];
  for (const r of ranges) {
    // Revenue first, then upsells (the upsell repair also clears upsells
    // that were removed from the invoice in HCP).
    for (const fn of ["hcp-revenue-repair", "hcp-upsell-repair"]) {
      try { await post(fn, r); } catch (e) { errors.push(e.message); console.error("nightly recheck:", e.message); }
    }
  }
  const result = { started_at: started, finished_at: new Date().toISOString(), ranges, errors };
  console.log("hcp-nightly-recheck:", JSON.stringify(result));
  await saveState(result);
  return { statusCode: 200, body: JSON.stringify(result) };
};

exports._test = { periodFor, rangesToCheck };
