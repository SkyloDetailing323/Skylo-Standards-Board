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
// Tier 2-5 payouts raised by the owner, Oct 14 2026 (were $800 / $1,250 /
// $1,550 / $1,850); point levels unchanged.
export const BONUS_TIERS = [
  { tier:1, points:1400, pay:400 },
  { tier:2, points:1800, pay:900 },
  { tier:3, points:2200, pay:1450 },
  { tier:4, points:2600, pay:1850 },
  { tier:5, points:3200, pay:2400 },
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

// A rep's tiers at a fraction of Trevor's -- both the point goals and the pay
// (Ethan sells residential one day a week: scale 1/5, owner Oct 2026).
export function scaledTiers(scale) {
  return BONUS_TIERS.map(t => ({ tier:t.tier, points:Math.round(t.points * scale), pay:Math.round(t.pay * scale) }));
}

// Month total -> { tier, pay, next, toNext }. tier is null below Tier 1;
// next is null at the top tier.
export function tierFor(points, tiers = BONUS_TIERS) {
  const n = Number(points) || 0;
  let reached = null;
  for (const t of tiers) if (n >= t.points) reached = t;
  const next = tiers.find(t => n < t.points) || null;
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
// - Grace period (owner, Oct 14 2026): a visit that gets moved or rebooked
//   isn't a cancellation. A plan with nothing left on the schedule is only
//   "at risk" for CHARGEBACK_GRACE_DAYS after the visit that didn't happen;
//   if a visit gets booked in that time it's back to pending. After that the
//   points come off in the month the grace period ends, so a month that's
//   already been paid never changes.

export const FREQ_WEEKS = { weekly:1, biweekly:2, monthly:4, bimonthly:8, quarterly:12, biannual:26 };
export const CHARGEBACK_GRACE_DAYS = 14;
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

// ─── Bigger first visit, downsizes, bookings (owner rules, Oct 15 2026) ─────
// - A first visit that's more than $50 over the plan's visits (e.g. 2 cars
//   the first time, 1 car after: $400 then $200, $200...) is a one-time for
//   the difference plus the plan at the lower price: one-time $200 + $200
//   monthly. $50 or less is a weather swap (int/ext only), not a change.
// - Downsize: if a visit inside the chargeback window is completed more than
//   $50 under the plan price the sale was scored at, the sale is re-scored at
//   that lower price and the difference comes off in the month that visit
//   was completed. The plan price is saved (sales_plan_snapshots) when the
//   first visit is serviced, so editing a later visit's price can't quietly
//   re-score a month that's already been paid.
// - Booked = the day the job was created in HCP. Points still only come in
//   when the first visit is serviced; the board shows what's waiting.
export const PRICE_CHANGE_OVER = 50;
export const PLAN_MINIMUMS = { weekly:8, biweekly:7, monthly:6, bimonthly:5, quarterly:4, biannual:2 };
const round2 = n => Math.round(n * 100) / 100;
const money = x => round2(Math.max(0, (x.total_cents || 0) - (x.tip_cents || 0)) / 100);

// Points for a sale: first-visit price, the plan's per-visit price, frequency.
export function salePoints(price, planPrice, freq) {
  if (freq === "one_time" || planPrice == null || price - planPrice <= PRICE_CHANGE_OVER)
    return { points:pointsFor(price, freq), plan_price:freq === "one_time" ? null : price, extra:0 };
  const extra = round2(price - planPrice);
  return { points:pointsFor(planPrice, freq) + pointsFor(extra, "one_time"), plan_price:planPrice, extra };
}

// Every credited first visit of a booking (any status but canceled), with the
// customer's other jobs, the visits booked with it, frequency and price.
function saleStarts(jobs, { tag, revenueByJob = {}, overrides = {}, repKey = null }) {
  const want = String(tag).toLowerCase();
  const credited = j => overrides[j.hcp_job_id] ? overrides[j.hcp_job_id] === repKey
    : (j.tags || []).some(t => String(t).trim().toLowerCase() === want);
  const byCustomer = {};
  for (const j of jobs) (byCustomer[j.hcp_customer_id || j.hcp_job_id] ||= []).push(j);
  const out = [];
  for (const j of jobs) {
    if (isCanceled(j) || !credited(j) || !(j.scheduled_start || j.completed_at)) continue;
    const mine = byCustomer[j.hcp_customer_id || j.hcp_job_id];
    const first = new Date(j.scheduled_start || j.completed_at).getTime();
    // Only the first visit of a booking is the sale. Sometimes the plan's
    // later visits carry the tag too (copied when the series was made).
    const madeAt = new Date(j.job_created_at || 0).getTime();
    if (j.job_created_at && mine.some(x => x !== j && x.job_created_at && !isCanceled(x) && x.scheduled_start
        && Math.abs(new Date(x.job_created_at).getTime() - madeAt) <= DAY && new Date(x.scheduled_start).getTime() < first - DAY)) continue;
    // Visits booked with this sale (created within a day of it) -- not the
    // visits of a plan the customer already had before Trevor rebooked them.
    const created = new Date(j.job_created_at || j.scheduled_start).getTime();
    const soon = mine.filter(x => !isCanceled(x) && x !== j && x.scheduled_start && new Date(x.scheduled_start).getTime() > first + DAY && new Date(x.scheduled_start).getTime() <= first + 183 * DAY
      && (!x.job_created_at || !j.job_created_at || Math.abs(new Date(x.job_created_at).getTime() - created) <= DAY))
      .sort((a, b) => new Date(a.scheduled_start) - new Date(b.scheduled_start));
    const tagFreq = freqFromTags(j.tags);
    const visitFreq = soon.length ? freqFromVisits([first, ...soon.map(x => new Date(x.scheduled_start).getTime())]) : null;
    const freq = tagFreq || visitFreq || "one_time";
    const rev = revenueByJob[j.hcp_job_id];
    const price = rev != null ? round2(Number(rev)) : money(j);
    out.push({ j, mine, first, soon, freq, freq_source:tagFreq ? "tag" : visitFreq ? "visits" : "none", price,
      name:`${j.first_name || ""} ${j.last_name || ""}`.trim() || "Unknown client" });
  }
  return out;
}

// jobs: every HCP job (any status) for the customers who have a rep-tagged
// job -- { hcp_job_id, hcp_customer_id, first_name, last_name, work_status,
// scheduled_start, completed_at, job_created_at, total_cents, tip_cents, tags }.
// revenueByJob: { hcp_job_id: revenue without tips } from the app's jobs table
// (falls back to total - tip). now: ms.
// overrides: { hcp_job_id: "trevor"|"ethan"|"none" } -- an owner's call, which
// wins over the tag; repKey is this rep's key ("trevor").
// snapshots: { hcp_job_id: plan price saved when the first visit was serviced
// (null = no later visit was booked) } -- missing means use today's schedule.
export function buildSales(jobs, { tag, revenueByJob = {}, now = Date.now(), overrides = {}, repKey = null, snapshots = {} }) {
  const sales = [];
  for (const st of saleStarts(jobs, { tag, revenueByJob, overrides, repKey })) {
    const { j, mine, first, soon, freq, price } = st;
    if (!isDone(j)) continue;
    const planPrice = freq === "one_time" ? null
      : Object.prototype.hasOwnProperty.call(snapshots, j.hcp_job_id) ? (snapshots[j.hcp_job_id] == null ? null : Number(snapshots[j.hcp_job_id]))
      : soon.length ? money(soon[0]) : null;
    const scored = salePoints(price, planPrice, freq);
    const sale = {
      hcp_job_id: j.hcp_job_id, customer_id: j.hcp_customer_id, name: st.name,
      done_on: mtDay(j.completed_at), month: mtDay(j.completed_at).slice(0, 7),
      price, freq, freq_source: st.freq_source, plan_price: scored.plan_price, extra: scored.extra,
      returning: (j.tags || []).some(t => /^returning$/i.test(String(t).trim())),
      points: scored.points,
      needed: CHARGEBACK_SERVICES[freq] || 0, completed: 1, status: "counted", chargeback_on: null, chargeback_month: null, missed_on: null,
      chargeback_points: 0, downsize_on: null, downsize_month: null, downsize_price: null, downsize_points: 0,
    };
    if (sale.needed > 1) {
      const after = mine.filter(x => x.scheduled_start && new Date(x.scheduled_start).getTime() >= first - DAY);
      sale.completed = after.filter(isDone).length;
      // Downsize: a completed visit inside the window, more than $50 under
      // the plan price the sale was scored at.
      const windowDone = after.filter(x => x !== j && isDone(x)).sort((a, b) => new Date(a.scheduled_start) - new Date(b.scheduled_start)).slice(0, sale.needed - 1);
      const low = windowDone.filter(x => money(x) < scored.plan_price - PRICE_CHANGE_OVER);
      if (low.length) {
        const lowest = Math.min(...low.map(money));
        const firstLow = low.map(x => new Date(x.completed_at).getTime()).sort((a, b) => a - b)[0];
        const rescored = salePoints(price, lowest, freq);
        sale.downsize_points = Math.max(0, scored.points - rescored.points);
        if (sale.downsize_points) {
          sale.downsize_price = lowest;
          sale.downsize_on = mtDay(firstLow);
          sale.downsize_month = sale.downsize_on.slice(0, 7);
        }
      }
      const upcoming = mine.some(x => !isCanceled(x) && !x.completed_at && x.scheduled_start && new Date(x.scheduled_start).getTime() > now - DAY);
      if (sale.completed >= sale.needed) sale.status = "cleared";
      else if (upcoming) sale.status = "pending";
      else {
        // Plan stopped inside the window: the first visit that didn't happen.
        const lastDone = Math.max(...after.filter(isDone).map(x => new Date(x.completed_at).getTime()));
        const missed = after.filter(x => isCanceled(x) && new Date(x.scheduled_start).getTime() > lastDone).map(x => new Date(x.scheduled_start).getTime()).sort((a, b) => a - b)[0];
        const when = missed || lastDone + FREQ_WEEKS[freq] * 7 * DAY;
        const final = when + CHARGEBACK_GRACE_DAYS * DAY;
        sale.missed_on = mtDay(Math.min(when, now));
        if (now < final) sale.status = "at_risk";
        else {
          sale.status = "charged_back";
          sale.chargeback_on = mtDay(final);
          sale.chargeback_month = sale.chargeback_on.slice(0, 7);
          // Whatever a downsize didn't already take back.
          sale.chargeback_points = sale.points - sale.downsize_points;
        }
      }
    }
    sales.push(sale);
  }
  return sales.sort((a, b) => a.done_on < b.done_on ? 1 : -1);
}

// One month: points earned from first visits completed that month, minus
// chargebacks and downsizes that land in it.
export function monthPoints(sales, month) {
  const earned = sales.filter(s => s.month === month);
  const chargebacks = sales.filter(s => s.chargeback_month === month);
  const downsizes = sales.filter(s => s.downsize_month === month);
  const gross = earned.reduce((a, s) => a + s.points, 0);
  const back = chargebacks.reduce((a, s) => a + s.chargeback_points, 0) + downsizes.reduce((a, s) => a + s.downsize_points, 0);
  return { earned, chargebacks, downsizes, gross, back, net: gross - back };
}

// Bookings: every credited first visit by the day it was created in HCP --
// first-visit price, the plan's booked visits up to its minimum (their HCP
// prices; any not booked yet count at the plan price), committed total, and
// the points it'll earn once serviced. minimums: visits per plan, first
// visit included (report_settings attribution; PLAN_MINIMUMS by default).
export function buildBookings(jobs, { tag, revenueByJob = {}, overrides = {}, repKey = null, minimums = {} }) {
  const mins = { ...PLAN_MINIMUMS, ...minimums };
  return saleStarts(jobs, { tag, revenueByJob, overrides, repKey }).map(st => {
    const { j, soon, freq, price } = st;
    const planPrice = freq === "one_time" ? null : soon.length ? money(soon[0]) : price;
    const scored = salePoints(price, planPrice, freq);
    const more = freq === "one_time" ? 0 : Math.max(0, (mins[freq] || 1) - 1);
    const booked = soon.slice(0, more);
    const backend = round2(booked.reduce((a, x) => a + money(x), 0) + (more - booked.length) * (scored.plan_price || 0));
    return {
      hcp_job_id: j.hcp_job_id, name: st.name,
      booked_on: mtDay(j.job_created_at || j.scheduled_start), scheduled_on: j.scheduled_start ? mtDay(j.scheduled_start) : null,
      price, freq, freq_source: st.freq_source, plan_price: scored.plan_price, extra: scored.extra,
      visits: more + 1, visits_booked: booked.length + 1, backend, committed: round2(price + backend),
      points: scored.points, serviced: isDone(j),
    };
  }).sort((a, b) => a.booked_on < b.booked_on ? 1 : -1);
}

// Sales to double-check (HCP can't say who created a job, so credit rests on
// the "sold by" tag). evidence: rows from sales_credit_review_rows -- completed
// first visits with a "sold by" tag or a new customer's untagged first job,
// the last GHL team member on a call or text with the customer before booking,
// and is_lead (came through Residential Leads/Estimates).
// Jobs an owner already decided (overrides) drop off.
//   mismatch: tagged to this rep, but GHL shows someone else working it
//   missed:   no "sold by" tag, but GHL shows this rep working it
//   untagged: a new customer's first job with no "sold by" tag that came in as
//             a lead or that a team member talked to -- not the plan visits
//             GHL's Pipeline Automation creates for existing plan clients
export function reviewList(evidence, overrides, repKey) {
  const out = { mismatch: [], missed: [], untagged: [] };
  const first = n => String(n || "").trim().split(/\s+/)[0].toLowerCase();
  for (const e of evidence || []) {
    if (overrides[e.hcp_job_id]) continue;
    const ghl = e.ghl_rep ? first(e.ghl_rep) : null;
    const row = { ...e, done_on: mtDay(e.completed_at), month: mtDay(e.completed_at).slice(0, 7) };
    if (e.sold_by === repKey) { if (ghl && ghl !== repKey) out.mismatch.push(row); }
    else if (!e.sold_by && ghl === repKey) out.missed.push(row);
    else if (!e.sold_by && e.is_new && (e.is_lead || ghl)) out.untagged.push(row);
  }
  for (const k of Object.keys(out)) out[k].sort((a, b) => a.done_on < b.done_on ? 1 : -1);
  return out;
}
