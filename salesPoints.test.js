import { test } from "node:test";
import assert from "node:assert/strict";
import { rowFor, pointsFor, tierFor, POINTS_TABLE, freqFromTags, freqFromVisits, buildSales, monthPoints, reviewList, salePoints, buildBookings } from "./salesPoints.js";

test("exact table rows", () => {
  assert.equal(pointsFor(145, "weekly"), 116);
  assert.equal(pointsFor(300, "biweekly"), 163);
  assert.equal(pointsFor(1000, "one_time"), 24);
  assert.equal(pointsFor(650, "quarterly"), 61);
});

test("price rounds down to the nearest row", () => {
  assert.equal(rowFor(329).price, 325);
  assert.equal(rowFor(399.99).price, 350);
  assert.equal(pointsFor(265, "monthly"), 59);   // $250 row
  assert.equal(pointsFor(174, "bimonthly"), 14); // $150 row
});

test("under the $145 minimum uses the $145 row", () => {
  assert.equal(rowFor(50).price, 145);
  assert.equal(pointsFor(0, "weekly"), 116);
});

test("over $1,000 climbs in $50 steps by the $950->$1,000 increment", () => {
  assert.deepEqual(rowFor(1049).points, POINTS_TABLE.at(-1).slice(1));
  assert.equal(rowFor(1150).price, 1150);
  assert.equal(pointsFor(1150, "weekly"), 1272 + 3 * 68);
  assert.equal(pointsFor(1150, "one_time"), 24 + 3);
  assert.equal(pointsFor(1100, "quarterly"), 98 + 2 * 5);
});

test("unknown frequency earns nothing; bi-annual is half of quarterly", () => {
  assert.equal(pointsFor(300, "every_blue_moon"), 0);
  assert.equal(pointsFor(300, "biannual"), 13);   // quarterly 25 / 2, rounded
  assert.equal(pointsFor(1000, "biannual"), 49);  // quarterly 98 / 2
});

test("tiers: highest reached pays, no stacking", () => {
  assert.deepEqual(tierFor(0), { tier:null, pay:0, next:{ tier:1, points:1400, pay:400 }, toNext:1400 });
  assert.equal(tierFor(1399).pay, 0);
  assert.equal(tierFor(1400).pay, 400);
  assert.equal(tierFor(2199).tier, 2);
  assert.equal(tierFor(2200).pay, 1450);
  assert.equal(tierFor(2650).toNext, 550);
  const top = tierFor(5000);
  assert.equal(top.pay, 2400);
  assert.equal(top.next, null);
});

const D = s => new Date(s + "T18:00:00Z").toISOString();
const job = (id, cust, sched, opts = {}) => ({ hcp_job_id: id, hcp_customer_id: cust, first_name: "A", last_name: cust, scheduled_start: D(sched),
  completed_at: opts.done ? D(opts.done === true ? sched : opts.done) : null, job_created_at: opts.created ? D(opts.created) : null, work_status: opts.status || (opts.done ? "complete unrated" : "scheduled"),
  total_cents: opts.cents ?? 25000, tip_cents: opts.tip ?? 0, tags: opts.tags || [] });
const NOW = new Date("2026-10-09T20:00:00Z").getTime();

test("frequency: plan tag first, else gap to nearest 1/2/4/8/12/26 weeks", () => {
  assert.equal(freqFromTags(["sold by trevor", "NEW", "Monthly"]), "monthly");
  assert.equal(freqFromTags(["Bi-Weekly"]), "biweekly");
  assert.equal(freqFromTags(["NEW"]), null);
  const w = d => new Date(d).getTime();
  assert.equal(freqFromVisits([w("2026-10-02"), w("2026-10-30"), w("2026-11-27")]), "monthly");
  assert.equal(freqFromVisits([w("2026-10-01"), w("2026-12-24")]), "quarterly");
  assert.equal(freqFromVisits([w("2026-10-01"), w("2027-04-01")]), "biannual");
  assert.equal(freqFromVisits([w("2026-10-01"), w("2026-10-15"), w("2026-10-29")]), "biweekly");
});

test("a sale is a completed 'sold by' job, in the month it was completed, price without tips", () => {
  const jobs = [
    job("a1", "amy", "2026-09-29", { done: "2026-10-01", tags: ["sold by trevor", "NEW"], cents: 30000, tip: 5000 }),
    job("b1", "bob", "2026-10-03", { tags: ["sold by trevor"] }),                        // not completed yet
    job("c1", "cat", "2026-10-04", { done: true, tags: ["sold by hunter"] }),            // someone else's
  ];
  const sales = buildSales(jobs, { tag: "sold by trevor", now: NOW });
  assert.equal(sales.length, 1);
  assert.equal(sales[0].month, "2026-10");
  assert.equal(sales[0].price, 250);
  assert.equal(sales[0].freq, "one_time");
  assert.equal(sales[0].status, "counted");
  assert.equal(buildSales(jobs, { tag: "sold by trevor", now: NOW, revenueByJob: { a1: 240 } })[0].price, 240);
});

test("no plan tag: frequency from the next 6 months of scheduled visits", () => {
  const jobs = [
    job("d1", "dan", "2026-10-02", { done: true, tags: ["sold by trevor", "NEW"] }),
    job("d2", "dan", "2026-10-30"), job("d3", "dan", "2026-11-27"), job("d4", "dan", "2026-12-25"),
  ];
  const [s] = buildSales(jobs, { tag: "sold by trevor", now: NOW });
  assert.equal(s.freq, "monthly");
  assert.equal(s.freq_source, "visits");
  assert.equal(s.status, "pending");
  assert.equal(s.needed, 3);
});

test("chargeback: plan stops before the window clears -> points off when the 14-day grace after the missed visit ends", () => {
  const jobs = [
    job("e1", "eve", "2026-08-03", { done: true, tags: ["sold by trevor", "Monthly"] }),
    job("e2", "eve", "2026-08-31", { done: true }),
    job("e3", "eve", "2026-09-20", { status: "pro canceled" }),
    job("e4", "eve", "2026-10-26", { status: "pro canceled" }),
  ];
  const [s] = buildSales(jobs, { tag: "sold by trevor", now: NOW });
  assert.equal(s.status, "charged_back");
  assert.equal(s.missed_on, "2026-09-20");
  assert.equal(s.chargeback_on, "2026-10-04");
  const oct = monthPoints([s], "2026-10"), aug = monthPoints([s], "2026-08");
  assert.equal(aug.net, s.points);
  assert.equal(oct.net, -s.points);
});

test("grace period: a recently missed visit is only at risk; a rebooked visit puts it back to pending", () => {
  const base = [
    job("h1", "hal", "2026-08-25", { done: true, tags: ["sold by trevor", "Monthly"] }),
    job("h2", "hal", "2026-09-25", { done: true }),
    job("h3", "hal", "2026-10-02", { status: "pro canceled" }),   // moved -- cancelled 7 days ago
  ];
  const [risk] = buildSales(base, { tag: "sold by trevor", now: NOW });
  assert.equal(risk.status, "at_risk");
  assert.equal(risk.chargeback_month, null);
  assert.equal(monthPoints([risk], "2026-10").back, 0);
  const [rebooked] = buildSales([...base, job("h4", "hal", "2026-10-16")], { tag: "sold by trevor", now: NOW });
  assert.equal(rebooked.status, "pending");
});

test("window cleared after enough completed services; a plan switch with visits still booked isn't a chargeback", () => {
  const cleared = buildSales([
    job("f1", "fay", "2026-07-01", { done: true, tags: ["sold by trevor", "Quarterly"] }),
    job("f2", "fay", "2026-09-23", { done: true }),
  ], { tag: "sold by trevor", now: NOW })[0];
  assert.equal(cleared.status, "cleared");
  const switched = buildSales([
    job("g1", "gus", "2026-09-01", { done: true, tags: ["sold by trevor", "Bimonthly"] }),
    job("g2", "gus", "2026-10-27", { status: "pro canceled" }),
    job("g3", "gus", "2026-11-06"),                                   // new monthly plan's visit
  ], { tag: "sold by trevor", now: NOW })[0];
  assert.equal(switched.status, "pending");
});

test("an existing plan's visits don't make a rebooked one-off a new plan sale", () => {
  const jobs = [
    job("h0", "hal", "2026-06-01", { done: true, created: "2026-05-20" }),
    job("h1", "hal", "2026-10-05", { done: true, created: "2026-10-01", tags: ["sold by trevor", "RETURNING"] }),
    job("h2", "hal", "2026-10-19", { created: "2026-05-20" }), job("h3", "hal", "2026-11-02", { created: "2026-05-20" }),
  ];
  assert.equal(buildSales(jobs, { tag: "sold by trevor", now: NOW })[0].freq, "one_time");
});

test("an owner's call wins over the tag", () => {
  const jobs = [
    job("i1", "ivy", "2026-10-02", { done: true, tags: ["sold by trevor"] }),
    job("j1", "jon", "2026-10-03", { done: true, tags: ["NEW"] }),
  ];
  const ids = o => buildSales(jobs, { tag: "sold by trevor", now: NOW, repKey: "trevor", overrides: o }).map(s => s.hcp_job_id).sort();
  assert.deepEqual(ids({}), ["i1"]);
  assert.deepEqual(ids({ i1: "ethan" }), []);
  assert.deepEqual(ids({ j1: "trevor" }), ["i1", "j1"]);
  assert.deepEqual(ids({ i1: "none", j1: "trevor" }), ["j1"]);
});

test("review list: tag vs GHL mismatch, missed tag, untagged new customer; decided jobs drop off", () => {
  const ev = [
    { hcp_job_id: "a", completed_at: D("2026-10-02"), sold_by: "trevor", is_new: true, ghl_rep: "Ethan Hamilton" },
    { hcp_job_id: "b", completed_at: D("2026-10-03"), sold_by: "trevor", is_new: true, ghl_rep: "Trevor Prince" },
    { hcp_job_id: "c", completed_at: D("2026-10-04"), sold_by: null, is_new: false, ghl_rep: "Trevor Prince" },
    { hcp_job_id: "d", completed_at: D("2026-10-05"), sold_by: null, is_new: true, ghl_rep: null, is_lead: true },
    { hcp_job_id: "g", completed_at: D("2026-10-05"), sold_by: null, is_new: true, ghl_rep: null, is_lead: false },   // plan-automation visit
    { hcp_job_id: "e", completed_at: D("2026-10-06"), sold_by: null, is_new: true, ghl_rep: null },
    { hcp_job_id: "f", completed_at: D("2026-10-06"), sold_by: null, is_new: false, ghl_rep: null },
  ];
  const r = reviewList(ev, { e: "none" }, "trevor");
  assert.deepEqual(r.mismatch.map(x => x.hcp_job_id), ["a"]);
  assert.deepEqual(r.missed.map(x => x.hcp_job_id), ["c"]);
  assert.deepEqual(r.untagged.map(x => x.hcp_job_id), ["d"]);
});

test("a plan's later visit that kept the tag isn't a second sale", () => {
  const jobs = [
    job("k1", "kim", "2026-04-10", { done: true, created: "2026-04-01", tags: ["sold by trevor", "NEW", "Biannual"] }),
    job("k2", "kim", "2026-10-09", { done: true, created: "2026-04-01", tags: ["sold by trevor", "Biannual"] }),
    job("k3", "kim", "2026-10-20", { done: true, created: "2026-10-15", tags: ["sold by trevor", "RETURNING"] }),  // a new booking later: a sale
  ];
  assert.deepEqual(buildSales(jobs, { tag: "sold by trevor", now: NOW }).map(s => s.hcp_job_id).sort(), ["k1", "k3"]);
});

test("a first visit more than $50 over the plan = one-time for the difference + the plan at the lower price", () => {
  assert.deepEqual(salePoints(400, 200, "monthly"), { points: pointsFor(200, "monthly") + pointsFor(200, "one_time"), plan_price: 200, extra: 200 });
  assert.equal(salePoints(250, 200, "monthly").points, pointsFor(250, "monthly"));   // $50 off = weather swap
  assert.equal(salePoints(300, null, "monthly").points, pointsFor(300, "monthly"));
  const [s] = buildSales([
    job("k1", "kim", "2026-10-02", { done: true, tags: ["sold by trevor", "Monthly"], cents: 40000 }),
    job("k2", "kim", "2026-10-30", { cents: 20000 }), job("k3", "kim", "2026-11-27", { cents: 20000 }),
  ], { tag: "sold by trevor", now: NOW });
  assert.equal(s.plan_price, 200);
  assert.equal(s.extra, 200);
  assert.equal(s.points, pointsFor(200, "monthly") + pointsFor(200, "one_time"));
});

test("downsize: a window visit done more than $50 under the plan comes off in the month it was done", () => {
  const jobs = [
    job("m1", "max", "2026-08-05", { done: true, tags: ["sold by trevor", "Monthly"], cents: 40000 }),
    job("m2", "max", "2026-09-02", { done: true, cents: 20000 }),
    job("m3", "max", "2026-09-30", { done: true, cents: 20000 }),
  ];
  const snap = { m1: 400 };   // sold as a 2-car $400 monthly
  const [s] = buildSales(jobs, { tag: "sold by trevor", now: NOW, snapshots: snap });
  assert.equal(s.points, pointsFor(400, "monthly"));
  assert.equal(s.downsize_month, "2026-09");
  assert.equal(s.downsize_price, 200);
  assert.equal(s.downsize_points, pointsFor(400, "monthly") - (pointsFor(200, "monthly") + pointsFor(200, "one_time")));
  assert.equal(monthPoints([s], "2026-08").net, s.points);
  assert.equal(monthPoints([s], "2026-09").net, -s.downsize_points);
  // $50 or less under (int/ext only because of rain) isn't a downsize.
  const [ok] = buildSales([jobs[0], { ...jobs[1], total_cents: 35000 }, { ...jobs[2], total_cents: 40000 }], { tag: "sold by trevor", now: NOW, snapshots: snap });
  assert.equal(ok.downsize_points, 0);
});

test("a plan that downsizes and then stops only loses what's left", () => {
  const [s] = buildSales([
    job("n1", "ned", "2026-07-06", { done: true, tags: ["sold by trevor", "Monthly"], cents: 40000 }),
    job("n2", "ned", "2026-08-03", { done: true, cents: 20000 }),
    job("n3", "ned", "2026-08-31", { status: "pro canceled", cents: 20000 }),
  ], { tag: "sold by trevor", now: NOW, snapshots: { n1: 400 } });
  assert.equal(s.status, "charged_back");
  assert.equal(s.downsize_points + s.chargeback_points, s.points);
});

test("bookings: by the day created, first visit + the plan's booked visits up to the minimum", () => {
  const b = buildBookings([
    job("p1", "pam", "2026-10-20", { created: "2026-10-14", tags: ["sold by trevor", "Monthly"], cents: 40000 }),
    job("p2", "pam", "2026-11-17", { created: "2026-10-14", cents: 20000 }),
    job("p3", "pam", "2026-12-15", { created: "2026-10-14", cents: 20000 }),
    job("q1", "quinn", "2026-10-16", { created: "2026-10-15", tags: ["sold by trevor"], cents: 25000 }),
  ], { tag: "sold by trevor" });
  const pam = b.find(x => x.hcp_job_id === "p1"), quinn = b.find(x => x.hcp_job_id === "q1");
  assert.equal(pam.booked_on, "2026-10-14");
  assert.equal(pam.visits, 6);
  assert.equal(pam.visits_booked, 3);
  assert.equal(pam.backend, 200 * 5);            // 2 booked at $200 + 3 not booked yet at the plan price
  assert.equal(pam.committed, 1400);
  assert.equal(pam.points, pointsFor(200, "monthly") + pointsFor(200, "one_time"));
  assert.equal(pam.serviced, false);
  assert.equal(quinn.freq, "one_time");
  assert.equal(quinn.committed, 250);
});
