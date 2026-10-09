// salesPoints.js
// Trevor's (residential sales) monthly bonus: every new client he closes
// earns points from the ticket price x service frequency table below, and his
// points for the calendar month pick one bonus tier. Tiers reset each month
// and don't stack. Pure functions with no React or network code.
//
// Owner rules (Oct 2026):
// - The table is the source of truth -- no formula.
// - A ticket price rounds DOWN to the nearest row ($329 -> the $325 row).
// - $145 is the minimum ticket, so anything under it uses the $145 row.
// - Over $1,000 keeps climbing in $50 steps by the same amount the table
//   adds from $950 to $1,000 (e.g. weekly +68 per $50).

export const FREQUENCIES = ["weekly","biweekly","monthly","bimonthly","quarterly","one_time"];
export const FREQ_LABEL = { weekly:"Weekly", biweekly:"Bi-weekly", monthly:"Monthly", bimonthly:"Bi-monthly", quarterly:"Quarterly", biannual:"Bi-annual", one_time:"One-time" };

// [price, weekly, biweekly, monthly, bimonthly, quarterly, one-time]
export const POINTS_TABLE = [
  [145,  116,   58,  27,  13,  9,  2],
  [150,  122,   61,  28,  14,  9,  2],
  [175,  156,   78,  36,  18, 12,  3],
  [200,  190,   95,  44,  22, 15,  4],
  [225,  224,  112,  52,  26, 17,  4],
  [250,  258,  129,  59,  30, 20,  5],
  [275,  291,  146,  67,  34, 22,  6],
  [300,  325,  163,  75,  38, 25,  6],
  [325,  359,  180,  83,  41, 28,  7],
  [350,  393,  196,  91,  45, 30,  8],
  [400,  460,  230, 106,  53, 35,  9],
  [450,  528,  264, 122,  61, 41, 10],
  [500,  596,  298, 137,  69, 46, 11],
  [550,  663,  332, 153,  77, 51, 13],
  [600,  731,  365, 169,  84, 56, 14],
  [650,  798,  399, 184,  92, 61, 15],
  [700,  866,  433, 200, 100, 67, 17],
  [750,  934,  467, 215, 108, 72, 18],
  [800, 1001,  501, 231, 116, 77, 19],
  [850, 1069,  534, 247, 123, 82, 21],
  [900, 1136,  568, 262, 131, 87, 22],
  [950, 1204,  602, 278, 139, 93, 23],
  [1000,1272,  636, 293, 147, 98, 24],
];

// Highest tier reached pays; below the first tier pays $0.
export const BONUS_TIERS = [
  { tier:1, points:1400, pay:400 },
  { tier:2, points:1800, pay:800 },
  { tier:3, points:2200, pay:1250 },
  { tier:4, points:2600, pay:1550 },
  { tier:5, points:3200, pay:1850 },
];

// The table row a ticket price lands on: { price, points:[...6 freqs] }.
export function rowFor(price) {
  const p = Math.max(Number(price) || 0, POINTS_TABLE[0][0]);
  const last = POINTS_TABLE[POINTS_TABLE.length - 1], prev = POINTS_TABLE[POINTS_TABLE.length - 2];
  if (p >= last[0]) {
    const steps = Math.floor((p - last[0]) / 50);
    return { price:last[0] + steps * 50, points:last.slice(1).map((v, i) => v + steps * (v - prev[i + 1])) };
  }
  let row = POINTS_TABLE[0];
  for (const r of POINTS_TABLE) if (r[0] <= p) row = r;
  return { price:row[0], points:row.slice(1) };
}

// Points for one closed client. Bi-annual isn't in the owner's table: it's
// half of quarterly (2 visits a year vs 4), which lands about 2x one-time.
// Unknown frequency -> 0.
export function pointsFor(price, freq) {
  if (freq === "biannual") return Math.round(rowFor(price).points[FREQUENCIES.indexOf("quarterly")] / 2);
  const i = FREQUENCIES.indexOf(freq);
  return i < 0 ? 0 : rowFor(price).points[i];
}

// Month total -> { tier, pay, next, toNext }. tier is null below Tier 1;
// next is null at the top tier.
export function tierFor(points) {
  const n = Number(points) || 0;
  let reached = null;
  for (const t of BONUS_TIERS) if (n >= t.points) reached = t;
  const next = BONUS_TIERS.find(t => n < t.points) || null;
  return { tier:reached?.tier ?? null, pay:reached?.pay ?? 0, next, toNext:next ? next.points - n : 0 };
}

// ─── Sales from HCP (owner rules, Oct 9 2026) ────────────────────────────────
// - A sale is a COMPLETED job tagged "sold by <rep>" in HCP. Only the first
//   visit of a booking carries tags; the plan's later visits don't.
// - It counts in the month that first visit was completed.
// - Ticket = that visit's price without tips.
// - Frequency = the plan tag on the job (Weekly, Biweekly, Monthly, Bimonthly,
//   Quarterly, Biannual). If there's none, the visits booked with it over the
//   next 6 months: the typical gap in weeks, nearest of 1/2/4/8/12/26.
//   No future visits -> one-time.
// - Chargeback window: a plan has to complete this many services (the first
//   visit included) before it's safe. If the plan stops first -- no visits
//   left on the schedule -- the points come back off in the month of the first
//   visit that didn't happen.

export const FREQ_WEEKS = { weekly:1, biweekly:2, monthly:4, bimonthly:8, quarterly:12, biannual:26 };
export const CHARGEBACK_SERVICES = { weekly:4, biweekly:4, monthly:3, bimonthly:2, quarterly:2, biannual:2, one_time:0 };
const FREQ_TAGS = { weekly:"weekly", biweekly:"biweekly", "bi-weekly":"biweekly", monthly:"monthly", bimonthly:"bimonthly", "bi-monthly":"bimonthly", quarterly:"quarterly", biannual:"biannual", "bi-annual":"biannual", semiannual:"biannual" };
const DAY = 86400e3;
const mtDay = ts => new Date(new Date(ts).getTime() - 6 * 3600e3).toISOString().slice(0, 10);
const isCanceled = j => /cancel/i.test(j.work_status || "");
const isDone = j => !!j.completed_at && !isCanceled(j);

export function freqFromTags(tags) {
  for (const t of tags || []) { const f = FREQ_TAGS[String(t).trim().toLowerCase()]; if (f) return f; }
  return null;
}

// Typical gap between visit dates (ms timestamps, sorted or not) -> frequency.
export function freqFromVisits(times) {
  const ts = [...times].sort((a, b) => a - b);
  const gaps = ts.slice(1).map((t, i) => (t - ts[i]) / (7 * DAY)).filter(g => g > 0.4);
  if (!gaps.length) return null;
  gaps.sort((a, b) => a - b);
  const mid = gaps[Math.floor(gaps.length / 2)];
  let best = null;
  for (const [f, w] of Object.entries(FREQ_WEEKS)) if (!best || Math.abs(Math.log(mid / w)) < Math.abs(Math.log(mid / FREQ_WEEKS[best]))) best = f;
  return best;
}

// jobs: every HCP job (any status) for the customers who have a rep-tagged
// job -- { hcp_job_id, hcp_customer_id, first_name, last_name, work_status,
// scheduled_start, completed_at, job_created_at, total_cents, tip_cents, tags }.
// revenueByJob: { hcp_job_id: revenue without tips } from the app's jobs table
// (falls back to total - tip). now: ms.
export function buildSales(jobs, { tag, revenueByJob = {}, now = Date.now() }) {
  const want = String(tag).toLowerCase();
  const byCustomer = {};
  for (const j of jobs) (byCustomer[j.hcp_customer_id || j.hcp_job_id] ||= []).push(j);
  const sales = [];
  for (const j of jobs) {
    if (!isDone(j) || !(j.tags || []).some(t => String(t).trim().toLowerCase() === want)) continue;
    const mine = byCustomer[j.hcp_customer_id || j.hcp_job_id];
    const first = new Date(j.scheduled_start || j.completed_at).getTime();
    // Visits booked with this sale (created within a day of it) -- not the
    // visits of a plan the customer already had before Trevor rebooked them.
    const created = new Date(j.job_created_at || j.scheduled_start).getTime();
    const soon = mine.filter(x => !isCanceled(x) && x !== j && x.scheduled_start && new Date(x.scheduled_start).getTime() > first + DAY && new Date(x.scheduled_start).getTime() <= first + 183 * DAY
      && (!x.job_created_at || !j.job_created_at || Math.abs(new Date(x.job_created_at).getTime() - created) <= DAY));
    const tagFreq = freqFromTags(j.tags);
    const visitFreq = soon.length ? freqFromVisits([first, ...soon.map(x => new Date(x.scheduled_start).getTime())]) : null;
    const freq = tagFreq || visitFreq || "one_time";
    const rev = revenueByJob[j.hcp_job_id];
    const price = Math.round((rev != null ? Number(rev) : Math.max(0, (j.total_cents || 0) - (j.tip_cents || 0)) / 100) * 100) / 100;
    const sale = {
      hcp_job_id: j.hcp_job_id, customer_id: j.hcp_customer_id,
      name: `${j.first_name || ""} ${j.last_name || ""}`.trim() || "Unknown client",
      done_on: mtDay(j.completed_at), month: mtDay(j.completed_at).slice(0, 7),
      price, freq, freq_source: tagFreq ? "tag" : visitFreq ? "visits" : "none",
      returning: (j.tags || []).some(t => /^returning$/i.test(String(t).trim())),
      points: pointsFor(price, freq),
      needed: CHARGEBACK_SERVICES[freq] || 0, completed: 1, status: "counted", chargeback_on: null, chargeback_month: null,
    };
    if (sale.needed > 1) {
      const after = mine.filter(x => x.scheduled_start && new Date(x.scheduled_start).getTime() >= first - DAY);
      sale.completed = after.filter(isDone).length;
      const upcoming = mine.some(x => !isCanceled(x) && !x.completed_at && x.scheduled_start && new Date(x.scheduled_start).getTime() > now - DAY);
      if (sale.completed >= sale.needed) sale.status = "cleared";
      else if (upcoming) sale.status = "pending";
      else {
        // Plan stopped inside the window: the first visit that didn't happen.
        const lastDone = Math.max(...after.filter(isDone).map(x => new Date(x.completed_at).getTime()));
        const missed = after.filter(x => isCanceled(x) && new Date(x.scheduled_start).getTime() > lastDone).map(x => new Date(x.scheduled_start).getTime()).sort((a, b) => a - b)[0];
        const when = missed || lastDone + FREQ_WEEKS[freq] * 7 * DAY;
        sale.status = "charged_back";
        sale.chargeback_on = mtDay(Math.min(when, now));
        sale.chargeback_month = sale.chargeback_on.slice(0, 7);
      }
    }
    sales.push(sale);
  }
  return sales.sort((a, b) => a.done_on < b.done_on ? 1 : -1);
}

// One month: points earned from first visits completed that month, minus
// chargebacks that land in it.
export function monthPoints(sales, month) {
  const earned = sales.filter(s => s.month === month);
  const chargebacks = sales.filter(s => s.chargeback_month === month);
  const gross = earned.reduce((a, s) => a + s.points, 0);
  const back = chargebacks.reduce((a, s) => a + s.points, 0);
  return { earned, chargebacks, gross, back, net: gross - back };
}
