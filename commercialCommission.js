// commercialCommission.js
// Ethan's commercial commission (owner rules, Oct 2026). Pure functions with
// no React or network code; reports.js?type=commission supplies the data.
//
// - A commercial sale is a customer whose job is tagged both "sold by ethan h"
//   and "Commercial" in HCP. "outbound" / "inbound" on that job is the lead
//   source (outbound = he found it, inbound = a lead the company paid for).
//   An owner can set the source or plan for any account in the app, or mark
//   it "not Ethan's"; that wins over the tags.
// - He's paid per service, only after the client pays: rate x that visit's
//   price (no tips), in the month the payment came in. No upfront money, so
//   there's nothing to claw back.
// - Recurring plans pay on the committed cleanings only (weekly 8, biweekly 7,
//   monthly 6, bi-monthly 5, quarterly 4); a one-time job pays once.
// - A visit HCP still shows unpaid earns nothing until it's paid.

import { freqFromTags, freqFromVisits, FREQ_LABEL } from "./salesPoints.js";

export const RATES = {
  outbound: { recurring:0.25, one_time:0.20 },
  inbound:  { recurring:0.12, one_time:0.10 },
};
export const BASE_SALARY = 1200;
export const COMMITTED = { weekly:8, biweekly:7, monthly:6, bimonthly:5, quarterly:4, biannual:2 };
export const SOURCE_LABEL = { outbound:"Outbound", inbound:"Inbound" };
export { FREQ_LABEL };

const DAY = 86400e3;
const mtDay = ts => new Date(new Date(ts).getTime() - 6 * 3600e3).toISOString().slice(0, 10);
const isCanceled = j => /cancel/i.test(j.work_status || "");
const tagSet = j => new Set((j.tags || []).map(t => String(t).trim().toLowerCase()));
const startOf = j => new Date(j.scheduled_start || j.completed_at || j.job_created_at || 0).getTime();
const round2 = n => Math.round(n * 100) / 100;

export const isCommercial = j => tagSet(j).has("commercial");
export const isEthanCommercial = j => { const t = tagSet(j); return t.has("commercial") && t.has("sold by ethan h"); };

export function sourceFromTags(tags) {
  const t = new Set((tags || []).map(x => String(x).trim().toLowerCase()));
  if (t.has("outbound") || t.has("cold")) return "outbound";
  if (t.has("inbound") || t.has("warm")) return "inbound";
  return null;
}

export const rateFor = (source, freq) => RATES[source]?.[freq === "one_time" ? "one_time" : "recurring"] ?? 0;

// Residential points leave out commercial customers: any customer with a
// job tagged "Commercial" is commercial.
export function withoutCommercial(jobs) {
  const commercial = new Set(jobs.filter(isCommercial).map(j => j.hcp_customer_id || j.hcp_job_id));
  return jobs.filter(j => !commercial.has(j.hcp_customer_id || j.hcp_job_id));
}

// jobs: every HCP job of the customers involved -- { hcp_job_id,
//   hcp_customer_id, first_name, last_name, work_status, scheduled_start,
//   completed_at, job_created_at, total_cents, tip_cents, tags }.
// revenueByJob: { hcp_job_id: price without tips } (app jobs table).
// payments: { hcp_job_id: { paid_at } } -- paid_at null/missing = not paid.
// accounts: { hcp_customer_id: { source, freq } } -- owner's settings;
//   source "none" = not Ethan's.
export function buildCommission(jobs, { revenueByJob = {}, payments = {}, accounts = {} } = {}) {
  const byCustomer = {};
  for (const j of jobs) (byCustomer[j.hcp_customer_id || j.hcp_job_id] ||= []).push(j);
  const out = [];
  for (const [cid, all] of Object.entries(byCustomer)) {
    const acct = accounts[cid] || {};
    if (acct.source === "none") continue;
    const live = all.filter(j => !isCanceled(j)).sort((a, b) => startOf(a) - startOf(b));
    const tagged = live.filter(isEthanCommercial);
    const sale = tagged[0] || (acct.source ? live[0] : null);
    if (!sale) continue;
    const saleAt = startOf(sale);
    const after = live.filter(j => startOf(j) >= saleAt - DAY);
    const soon = after.filter(j => j !== sale && startOf(j) <= saleAt + 183 * DAY).map(startOf);
    const tagFreq = freqFromTags(sale.tags);
    const visitFreq = soon.length ? freqFromVisits([saleAt, ...soon]) : null;
    const freq = (acct.freq && (acct.freq === "one_time" || COMMITTED[acct.freq])) ? acct.freq : (tagFreq || visitFreq || "one_time");
    const source = SOURCE_LABEL[acct.source] ? acct.source : sourceFromTags(sale.tags);
    const rate = rateFor(source, freq);
    const committed = freq === "one_time" ? 1 : COMMITTED[freq];
    const price = j => {
      const r = revenueByJob[j.hcp_job_id];
      return round2(r != null ? Number(r) : Math.max(0, (j.total_cents || 0) - (j.tip_cents || 0)) / 100);
    };
    const visits = (freq === "one_time" ? [sale] : after.slice(0, committed)).map((j, i) => {
      const paidAt = payments[j.hcp_job_id]?.paid_at || null;
      const amount = price(j);
      const status = paidAt ? "paid" : j.completed_at ? "awaiting_payment" : "scheduled";
      const paidOn = paidAt ? mtDay(paidAt) : null;
      return {
        hcp_job_id: j.hcp_job_id, n: i + 1, amount, status,
        date: mtDay(j.completed_at || j.scheduled_start || j.job_created_at),
        paid_on: paidOn, month: paidOn ? paidOn.slice(0, 7) : null,
        commission: paidAt && source ? round2(amount * rate) : 0,
        expected: round2(amount * rate),
      };
    });
    // Committed cleanings not on the schedule yet count at the plan price.
    const planPrice = visits.length ? visits[visits.length - 1].amount : price(sale);
    const unbooked = Math.max(0, committed - visits.length);
    const earned = round2(visits.reduce((a, v) => a + v.commission, 0));
    const total = round2(visits.reduce((a, v) => a + v.expected, 0) + unbooked * planPrice * rate);
    out.push({
      customer_id: cid, hcp_job_id: sale.hcp_job_id,
      name: `${sale.first_name || ""} ${sale.last_name || ""}`.trim() || "Unknown client",
      source, freq, rate, committed, visits, unbooked, plan_price: planPrice,
      paid: visits.filter(v => v.status === "paid").length,
      earned, total, to_come: source ? round2(total - earned) : 0,
      sold_on: mtDay(sale.completed_at || sale.scheduled_start || sale.job_created_at),
      set_by_owner: !!(acct.source || acct.freq), needs_source: !source,
    });
  }
  return out.sort((a, b) => a.sold_on < b.sold_on ? 1 : -1);
}

// One month: each payment that came in that month and what it paid Ethan,
// split by source and recurring / one-time.
export function monthCommission(accounts, month) {
  const rows = [];
  for (const a of accounts) for (const v of a.visits) {
    if (v.month !== month || !v.commission) continue;
    rows.push({ ...v, name: a.name, source: a.source, freq: a.freq, rate: a.rate, of: a.committed });
  }
  const sum = f => round2(rows.filter(f).reduce((s, r) => s + r.commission, 0));
  const kind = r => r.freq === "one_time" ? "one_time" : "recurring";
  return {
    rows: rows.sort((a, b) => a.paid_on < b.paid_on ? 1 : -1),
    total: sum(() => true),
    collected: round2(rows.reduce((s, r) => s + r.amount, 0)),
    by: {
      outbound_recurring: sum(r => r.source === "outbound" && kind(r) === "recurring"),
      outbound_one_time:  sum(r => r.source === "outbound" && kind(r) === "one_time"),
      inbound_recurring:  sum(r => r.source === "inbound" && kind(r) === "recurring"),
      inbound_one_time:   sum(r => r.source === "inbound" && kind(r) === "one_time"),
    },
  };
}
