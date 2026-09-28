// opsBonus.js
// Will's (Field Supervisor) operations bonus: staffing, callback rate, quota
// and quarterly retention. Pure functions with no React or network code, so
// the Operations Progress page and the month-end snapshot function
// (netlify/functions/ops-month-close.mjs) compute exactly the same numbers.
//
// All dates are "YYYY-MM-DD" strings in Mountain Time, the same way jobs are
// bucketed everywhere else in the app.

// Titles that never count toward the ops bonus: owners, Will himself, and
// staff who don't detail cars on the residential routes.
export const OPS_EXCLUDED_TITLES = ["owner","field_supervisor","commercial_sales","sales_booking","commercial_detail"];
// Retention covers everyone Will manages, including commercial detailers.
export const RETENTION_EXCLUDED_TITLES = ["owner","field_supervisor","commercial_sales","sales_booking"];
// Zak details two days a week, so he has his own fixed quota.
export const PART_TIME_TITLE = "equipment_coordinator";
export const PART_TIME_QUOTA = { upsells:300, reviews:4, switchovers:1 };
// Vehicles on the schedule that don't count toward daily staffing.
export const NON_ROUTE_VEHICLES = ["BB","AUX"];

export const STAFFING_PAY = 270;
// Callback rate (%) -> pay. One tier pays; the best one reached wins.
export const CALLBACK_TIERS = [
  { max:1.25, pay:600, label:"1.25% or lower" },
  { max:1.50, pay:400, label:"1.26% – 1.50%" },
  { max:1.75, pay:250, label:"1.51% – 1.75%" },
  { max:1.99, pay:125, label:"1.76% – 1.99%" },
];
// Share of counted techs hitting all quota targets (%) -> pay.
export const QUOTA_TIERS = [
  { min:100, pay:500, label:"100%" },
  { min:85,  pay:400, label:"85% – 99.99%" },
  { min:70,  pay:300, label:"70% – 84.99%" },
  { min:60,  pay:200, label:"60% – 69.99%" },
];
// Quarterly 90+ day retention (%) -> pay per month; paid x3 for the quarter.
export const RETENTION_TIERS = [
  { min:100, pay:500, label:"100%" },
  { min:85,  pay:400, label:"85% – 99.99%" },
  { min:75,  pay:300, label:"75% – 84.99%" },
  { min:65,  pay:200, label:"65% – 74.99%" },
  { min:55,  pay:100, label:"55% – 64.99%" },
];
export const RETENTION_MONTHS = 3;
// New-hire (first 90 days) retention: tracked, not paid.
export const NEW_HIRE_RATINGS = [
  { min:90, label:"Excellent" },
  { min:80, label:"Great" },
  { min:70, label:"Average" },
  { min:0,  label:"Underperforming" },
];
// Quota for a tech who leaves mid-month, by full weeks worked that month.
export const PRORATED_QUOTA = {
  1: { upsells:100, reviews:1, switchovers:0 },
  2: { upsells:200, reviews:2, switchovers:0 },
  3: { upsells:300, reviews:4, switchovers:0 },
};
export const MIN_WORKDAYS_TO_COUNT = 4;

// ─── date helpers ───────────────────────────────────────────────────────────
const pad = n => String(n).padStart(2,"0");
export function monthRange(monthKey) {
  const [y,m] = monthKey.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { start:`${y}-${pad(m)}-01`, end:`${y}-${pad(m)}-${pad(last)}` };
}
export function addDays(dateStr, n) {
  const d = new Date(dateStr+"T12:00:00Z"); d.setUTCDate(d.getUTCDate()+n);
  return d.toISOString().slice(0,10);
}
function daysBetween(a, b) { // b - a, in days
  return Math.round((Date.parse(b+"T12:00:00Z") - Date.parse(a+"T12:00:00Z")) / 86400000);
}
// 1 = Monday ... 6 = Saturday, 7 = Sunday
export function isoWeekday(dateStr) {
  const d = new Date(dateStr+"T12:00:00Z").getUTCDay();
  return d === 0 ? 7 : d;
}
export function workdaysBetween(start, end, holidays=[]) {
  const out = [], hol = new Set(holidays);
  for (let d = start; d <= end; d = addDays(d,1)) if (isoWeekday(d) <= 6 && !hol.has(d)) out.push(d);
  return out;
}
export function mountainDate(ts) {
  return new Date(ts).toLocaleDateString("en-CA", { timeZone:"America/Denver" });
}
export function quarterOf(monthKey) {
  const [y,m] = monthKey.split("-").map(Number);
  const q = Math.floor((m-1)/3);
  const startM = q*3+1, endM = q*3+3;
  return {
    label:`Q${q+1} ${y}`,
    start:`${y}-${pad(startM)}-01`,
    end: monthRange(`${y}-${pad(endM)}`).end,
    endMonthKey:`${y}-${pad(endM)}`,
  };
}
const round2 = n => Math.round(n*100)/100;

// First job with revenue, per tech -- the "done with training" signal.
export function firstPaidJobs(jobs) {
  const first = {};
  for (const j of jobs||[]) {
    if (!j.job_date || !((j.revenue||0) > 0)) continue;
    if (!first[j.tech_id] || j.job_date < first[j.tech_id]) first[j.tech_id] = j.job_date;
  }
  return first;
}

// ─── staffing ───────────────────────────────────────────────────────────────
// Every Mon–Sat workday that isn't a holiday needs `truckCount` techs
// scheduled on a route vehicle. One short day misses the whole month.
export function computeStaffing({ monthKey, today, techs, schedule, exceptions, truckCount, holidays }) {
  const { start, end } = monthRange(monthKey);
  const techById = Object.fromEntries((techs||[]).map(t=>[t.id,t]));
  const days = workdaysBetween(start, end, holidays).map(date => {
    const wd = isoWeekday(date);
    const offIds = new Set((exceptions||[]).filter(e=>e.date===date && e.kind==="off").map(e=>e.tech_id));
    const onDuty = new Set();
    for (const s of schedule||[]) {
      if (s.weekday !== wd || NON_ROUTE_VEHICLES.includes(s.vehicle)) continue;
      const t = techById[s.tech_id];
      if (!t || offIds.has(t.id) || !isWorking(t, date)) continue;
      onDuty.add(t.id);
    }
    for (const e of exceptions||[]) {
      const t = techById[e.tech_id];
      if (e.date===date && e.kind==="extra" && t && isWorking(t, date)) onDuty.add(t.id);
    }
    const scheduled = onDuty.size;
    return { date, scheduled, needed:truckCount, short: scheduled < truckCount, past: date < today };
  });
  const missedDays = days.filter(d=>d.past && d.short);
  const upcomingShort = days.filter(d=>!d.past && d.short);
  const monthOver = end < today;
  const hit = missedDays.length === 0 && (monthOver || upcomingShort.length === 0);
  return {
    days, missedDays, upcomingShort, monthOver,
    status: missedDays.length ? "missed" : monthOver ? "earned" : upcomingShort.length ? "at_risk" : "on_track",
    pay: missedDays.length ? 0 : STAFFING_PAY,
    hit,
    rosterTarget: Math.ceil(truckCount/2*3),
  };
}
function isWorking(t, date) {
  if (t.on_leave) return false;
  if (t.is_active === false) return !!t.left_date && t.left_date >= date;
  return true;
}

// ─── callback rate ──────────────────────────────────────────────────────────
// Callbacks logged in the month ÷ jobs completed in the month. A split-job
// callback is logged as ½ per tech (weight 0.5), so it still adds up to 1.
export function computeCallbacks({ monthKey, jobs, callbacks }) {
  const { start, end } = monthRange(monthKey);
  const jobIds = new Set();
  for (const j of jobs||[]) if (j.job_date>=start && j.job_date<=end && (j.revenue||0)>0) jobIds.add(j.hcp_job_id);
  const monthCallbacks = (callbacks||[]).filter(c => { const d = c.created_at && mountainDate(c.created_at); return d && d>=start && d<=end; });
  const count = monthCallbacks.reduce((s,c)=>s+(c.weight==null?1:Number(c.weight)),0);
  const jobCount = jobIds.size;
  const rate = jobCount > 0 ? round2(count/jobCount*100) : 0;
  const tier = jobCount > 0 ? CALLBACK_TIERS.find(t => rate <= t.max) || null : null;
  // Most callbacks allowed at the current job count for each tier.
  const allowance = CALLBACK_TIERS.map(t => ({ ...t, maxCallbacks: Math.floor(t.max/100*jobCount*2)/2 }));
  return { count, jobCount, rate, tier, pay: tier ? tier.pay : 0, allowance, callbacks: monthCallbacks };
}

// ─── quota ──────────────────────────────────────────────────────────────────
// Counted techs: eligible title, first paid job on or before the 2nd of the
// month, not on leave. Techs who leave mid-month get prorated targets, and
// don't count at all with fewer than 4 workdays.
export function computeQuota({ monthKey, today, techs, jobs, reviews, switchovers, quota, holidays }) {
  const { start, end } = monthRange(monthKey);
  const cutoff = addDays(start, 1);
  const first = firstPaidJobs(jobs);
  const std = { upsells:quota?.upsells ?? 400, reviews:quota?.reviews ?? 6, switchovers:quota?.switchovers ?? 1 };
  const rows = [], ramping = [], leftEarly = [];
  for (const t of techs||[]) {
    if (OPS_EXCLUDED_TITLES.includes(t.title)) continue;
    const leftThisMonthOrLater = t.is_active===false && t.left_date && t.left_date >= start;
    if (t.is_active===false && !leftThisMonthOrLater) continue;
    if (t.on_leave) { ramping.push({ ...pick(t), reason:"On leave" }); continue; }
    if (!first[t.id] || first[t.id] > cutoff) {
      ramping.push({ ...pick(t), reason: first[t.id] ? `First paid job ${first[t.id]}` : "No paid jobs yet" });
      continue;
    }
    const leftInMonth = t.is_active===false && t.left_date <= end;
    const lastDay = leftInMonth ? t.left_date : end;
    let targets = t.title===PART_TIME_TITLE ? { ...PART_TIME_QUOTA } : { ...std };
    let prorated = null;
    if (leftInMonth) {
      const worked = workdaysBetween(start, lastDay, holidays).length;
      if (worked < MIN_WORKDAYS_TO_COUNT) { leftEarly.push({ ...pick(t), left_date:t.left_date, workdays:worked }); continue; }
      const weeks = Math.min(4, Math.max(1, Math.floor((daysBetween(start, lastDay)+1)/7)));
      if (weeks < 4 && t.title!==PART_TIME_TITLE) { targets = { ...PRORATED_QUOTA[weeks] }; prorated = weeks; }
    }
    const ups = (jobs||[]).filter(j=>j.tech_id===t.id && j.job_date>=start && j.job_date<=lastDay).reduce((s,j)=>s+(Number(j.upsell_amount)||0),0);
    const revs = (reviews||[]).filter(r=>r.tech_id===t.id && r.month_key===monthKey).reduce((s,r)=>s+(r.count||0),0);
    const sws = (switchovers||[]).filter(s=>s.tech_id===t.id && s.week_key?.startsWith(monthKey)).length;
    const upHit = ups >= targets.upsells, revHit = revs >= targets.reviews, swHit = sws >= targets.switchovers;
    rows.push({ ...pick(t), targets, prorated, left_date: leftInMonth ? t.left_date : null,
      upsells:round2(ups), reviews:revs, switchovers:sws, upHit, revHit, swHit,
      allHit: upHit && revHit && swHit, hitsCount:[upHit,revHit,swHit].filter(Boolean).length });
  }
  rows.sort((a,b)=> b.hitsCount-a.hitsCount || b.upsells-a.upsells);
  const counted = rows.length, hitting = rows.filter(r=>r.allHit).length;
  const pct = counted > 0 ? round2(hitting/counted*100) : 0;
  const tier = counted > 0 ? QUOTA_TIERS.find(t => pct >= t.min) || null : null;
  const nextTier = [...QUOTA_TIERS].reverse().find(t => pct < t.min) || null;
  const neededForNext = nextTier ? Math.ceil(nextTier.min/100*counted - 1e-9) - hitting : 0;
  return { rows, ramping, leftEarly, counted, hitting, pct, tier, pay: tier ? tier.pay : 0,
    nextTier, neededForNext, monthOver: end < today };
}
const pick = t => ({ id:t.id, name:t.name, title:t.title });

// ─── retention (quarterly) ──────────────────────────────────────────────────
// Of the techs past 90 days on day 1 of the quarter, how many are still here
// at the end. An owner-approved firing is left out entirely (non-regrettable);
// quits, walk-offs and unapproved firings count as losses (regrettable).
export function computeRetention({ monthKey, today, techs }) {
  const q = quarterOf(monthKey);
  const pop = (techs||[]).filter(t => !RETENTION_EXCLUDED_TITLES.includes(t.title) && t.start_date);
  const presentOn = (t, date) => t.start_date <= date && (t.is_active!==false ? true : (t.left_date && t.left_date >= date));
  const base = pop.filter(t => addDays(t.start_date, 90) <= q.start && presentOn(t, q.start));
  const asOf = today < q.end ? today : q.end;
  const leavers = base.filter(t => t.is_active===false && t.left_date && t.left_date >= q.start && t.left_date <= q.end);
  const approvedFires = leavers.filter(t => t.leave_reason==="fired" && t.fire_approval==="approved");
  const regrettable = leavers.filter(t => !approvedFires.includes(t));
  const denom = base.length - approvedFires.length;
  const pct = denom > 0 ? round2((denom - regrettable.length)/denom*100) : 100;
  const tier = denom > 0 ? RETENTION_TIERS.find(t => pct >= t.min) || null : null;

  // New hires: everyone whose 90th day falls in the quarter, plus anyone who
  // left during the quarter before reaching it.
  const cohort = pop.filter(t => {
    const d90 = addDays(t.start_date, 90);
    const leftEarly = t.is_active===false && t.left_date && t.left_date < d90 && t.left_date >= q.start && t.left_date <= q.end;
    return (d90 >= q.start && d90 <= q.end) || leftEarly;
  }).map(t => {
    const d90 = addDays(t.start_date, 90);
    const left = t.is_active===false && t.left_date && t.left_date < d90;
    return { ...pick(t), start_date:t.start_date, day90:d90, left_date:t.left_date||null, leave_reason:t.leave_reason||null,
      status: left ? "left" : d90 <= asOf ? "made_it" : "in_progress" };
  });
  const decided = cohort.filter(c => c.status!=="in_progress");
  const nhPct = decided.length ? round2(decided.filter(c=>c.status==="made_it").length/decided.length*100) : null;
  const rating = nhPct==null ? null : NEW_HIRE_RATINGS.find(r => nhPct >= r.min).label;

  const describe = t => ({ ...pick(t), left_date:t.left_date, leave_reason:t.leave_reason, fire_category:t.fire_category, fire_approval:t.fire_approval });
  return {
    quarter:q, quarterOver: q.end < today,
    baseCount: base.length, base: base.map(pick),
    losses: regrettable.length, pct, tier,
    monthlyPay: tier ? tier.pay : 0, pay: (tier ? tier.pay : 0) * RETENTION_MONTHS,
    regrettable: regrettable.map(describe), approvedFires: approvedFires.map(describe),
    pendingFires: leavers.filter(t => t.leave_reason==="fired" && t.fire_approval!=="approved" && t.fire_approval!=="denied").map(describe),
    newHires: { cohort, pct: nhPct, rating },
  };
}

// ─── everything for one month ───────────────────────────────────────────────
export function computeOpsMonth(input) {
  const staffing  = computeStaffing(input);
  const callbacks = computeCallbacks(input);
  const quota     = computeQuota(input);
  const retention = computeRetention(input);
  // Missing staffing voids that month's callback and quota bonuses.
  const gateOpen = staffing.missedDays.length === 0;
  const monthlyPay = gateOpen ? staffing.pay + callbacks.pay + quota.pay : 0;
  const isQuarterEnd = retention.quarter.endMonthKey === input.monthKey;
  return {
    monthKey: input.monthKey, computedAt: new Date().toISOString(),
    staffing, callbacks, quota, retention, gateOpen,
    monthlyPay, retentionPay: isQuarterEnd ? retention.pay : 0, isQuarterEnd,
    totalPay: monthlyPay + (isQuarterEnd ? retention.pay : 0),
  };
}
