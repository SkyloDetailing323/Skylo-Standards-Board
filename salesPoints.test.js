import { test } from "node:test";
import assert from "node:assert/strict";
import { rowFor, pointsFor, tierFor, POINTS_TABLE, freqFromTags, freqFromVisits, buildSales, monthPoints, reviewList } from "./salesPoints.js";

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
  assert.equal(tierFor(2200).pay, 1250);
  assert.equal(tierFor(2650).toNext, 550);
  const top = tierFor(5000);
  assert.equal(top.pay, 1850);
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

test("chargeback: plan stops before the window clears -> points off in the month of the first missed visit", () => {
  const jobs = [
    job("e1", "eve", "2026-08-03", { done: true, tags: ["sold by trevor", "Monthly"] }),
    job("e2", "eve", "2026-08-31", { done: true }),
    job("e3", "eve", "2026-09-28", { status: "pro canceled" }),
    job("e4", "eve", "2026-10-26", { status: "pro canceled" }),
  ];
  const [s] = buildSales(jobs, { tag: "sold by trevor", now: NOW });
  assert.equal(s.status, "charged_back");
  assert.equal(s.chargeback_on, "2026-09-28");
  const sep = monthPoints([s], "2026-09"), aug = monthPoints([s], "2026-08");
  assert.equal(aug.net, s.points);
  assert.equal(sep.net, -s.points);
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
    { hcp_job_id: "d", completed_at: D("2026-10-05"), sold_by: null, is_new: true, ghl_rep: null },
    { hcp_job_id: "e", completed_at: D("2026-10-06"), sold_by: null, is_new: true, ghl_rep: null },
    { hcp_job_id: "f", completed_at: D("2026-10-06"), sold_by: null, is_new: false, ghl_rep: null },
  ];
  const r = reviewList(ev, { e: "none" }, "trevor");
  assert.deepEqual(r.mismatch.map(x => x.hcp_job_id), ["a"]);
  assert.deepEqual(r.missed.map(x => x.hcp_job_id), ["c"]);
  assert.deepEqual(r.untagged.map(x => x.hcp_job_id), ["d"]);
});
