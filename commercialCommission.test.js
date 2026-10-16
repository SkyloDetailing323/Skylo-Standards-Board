import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCommission, monthCommission, withoutCommercial, sourceFromTags, rateFor, COMMITTED } from "./commercialCommission.js";
import { scaledTiers, tierFor } from "./salesPoints.js";

const day = (d, h = 18) => `${d}T${String(h).padStart(2, "0")}:00:00Z`;
const job = (id, cust, d, extra = {}) => ({
  hcp_job_id: id, hcp_customer_id: cust, first_name: "Acme", last_name: "Co", work_status: "complete",
  scheduled_start: day(d, 15), completed_at: day(d), job_created_at: day("2026-09-01"),
  total_cents: 140000, tip_cents: 0, tags: [], ...extra,
});

test("rates", () => {
  assert.equal(rateFor("outbound", "monthly"), 0.25);
  assert.equal(rateFor("outbound", "one_time"), 0.20);
  assert.equal(rateFor("inbound", "weekly"), 0.12);
  assert.equal(rateFor("inbound", "one_time"), 0.10);
  assert.equal(rateFor(null, "monthly"), 0);
  assert.deepEqual(COMMITTED, { weekly:8, biweekly:7, monthly:6, bimonthly:5, quarterly:4, biannual:2 });
});

test("lead source from tags", () => {
  assert.equal(sourceFromTags(["Commercial", "Outbound"]), "outbound");
  assert.equal(sourceFromTags(["inbound"]), "inbound");
  assert.equal(sourceFromTags(["Commercial"]), null);
});

test("monthly outbound plan pays 25% of each paid visit, only the first 6", () => {
  const dates = ["2026-10-01", "2026-11-01", "2026-12-01", "2027-01-01", "2027-02-01", "2027-03-01", "2027-04-01"];
  const jobs = dates.map((d, i) => job(`job_${i}`, "c1", d, i === 0 ? { tags: ["Commercial", "sold by ethan h", "Outbound", "Monthly"] } : {}));
  const payments = { job_0: { paid_at: day("2026-10-03") }, job_1: { paid_at: day("2026-11-20") }, job_6: { paid_at: day("2027-04-02") } };
  const [a] = buildCommission(jobs, { payments, revenueByJob: { job_0: 1400 } });
  assert.equal(a.freq, "monthly");
  assert.equal(a.source, "outbound");
  assert.equal(a.visits.length, 6);          // the 7th visit isn't committed
  assert.equal(a.visits[0].commission, 350);
  assert.equal(a.visits[2].commission, 0);   // done, not paid yet
  assert.equal(a.visits[2].status, "awaiting_payment");
  assert.equal(a.earned, 700);
  assert.equal(a.total, 2100);
  const oct = monthCommission([a], "2026-10");
  assert.equal(oct.total, 350);
  assert.equal(oct.by.outbound_recurring, 350);
  assert.equal(monthCommission([a], "2026-11").total, 350);
});

test("big recurring account: each monthly payment at the recurring rate", () => {
  const jobs = ["2026-10-15", "2026-11-15"].map((d, i) => job(`big_${i}`, "c2", d, { total_cents: 600000, tags: i ? [] : ["Commercial", "sold by ethan h", "Outbound", "Monthly"] }));
  const [a] = buildCommission(jobs, { payments: { big_0: { paid_at: day("2026-10-20") }, big_1: { paid_at: day("2026-11-20") } } });
  assert.deepEqual(a.visits.map(v => v.commission), [1500, 1500]);
  assert.equal(a.unbooked, 4);
  assert.equal(a.total, 9000);
});

test("one-time inbound pays 10% once, after payment", () => {
  const jobs = [job("ot", "c3", "2026-10-10", { total_cents: 140200, tags: ["Commercial", "sold by ethan h", "inbound"] })];
  let [a] = buildCommission(jobs);
  assert.equal(a.freq, "one_time");
  assert.equal(a.earned, 0);
  assert.equal(a.total, 140.2);
  [a] = buildCommission(jobs, { payments: { ot: { paid_at: day("2026-10-12") } } });
  assert.equal(a.earned, 140.2);
});

test("no source tag: shows the account but pays nothing until an owner sets it", () => {
  const jobs = [job("x", "c4", "2026-10-10", { tags: ["Commercial", "sold by ethan h"] })];
  const pay = { x: { paid_at: day("2026-10-11") } };
  let [a] = buildCommission(jobs, { payments: pay });
  assert.equal(a.needs_source, true);
  assert.equal(a.earned, 0);
  [a] = buildCommission(jobs, { payments: pay, accounts: { c4: { source: "outbound" } } });
  assert.equal(a.earned, 280);
});

test("owner overrides: credit an untagged account, or mark a tagged one not Ethan's", () => {
  const untagged = [job("u", "c5", "2026-10-10", { tags: ["Commercial"] })];
  assert.equal(buildCommission(untagged).length, 0);
  assert.equal(buildCommission(untagged, { accounts: { c5: { source: "inbound", freq: "one_time" } } }).length, 1);
  const tagged = [job("t", "c6", "2026-10-10", { tags: ["Commercial", "sold by ethan h", "outbound"] })];
  assert.equal(buildCommission(tagged, { accounts: { c6: { source: "none" } } }).length, 0);
});

test("canceled visits are skipped and residential customers aren't commercial", () => {
  const jobs = [
    job("a", "c7", "2026-10-01", { tags: ["Commercial", "sold by ethan h", "outbound", "Monthly"] }),
    job("b", "c7", "2026-11-01", { work_status: "pro canceled", completed_at: null }),
    job("c", "c7", "2026-12-01"),
    job("r", "res", "2026-10-01", { tags: ["sold by ethan h"] }),
  ];
  const acc = buildCommission(jobs);
  assert.equal(acc.length, 1);
  assert.deepEqual(acc[0].visits.map(v => v.hcp_job_id), ["a", "c"]);
  assert.deepEqual(withoutCommercial(jobs).map(j => j.hcp_job_id), ["r"]);
});

test("Ethan's residential tiers are Trevor's at 1/5 (points and pay)", () => {
  const t = scaledTiers(0.2);
  assert.deepEqual(t[0], { tier:1, points:280, pay:80 });
  assert.equal(tierFor(279, t).pay, 0);
  assert.equal(tierFor(280, t).tier, 1);
  assert.equal(tierFor(640, t).tier, 5);
});

test("Ethan's tag is \"sold by ethan h\", any capitalization; plain \"sold by ethan\" doesn't count", () => {
  const pay = { a: { paid_at: day("2026-10-02") } };
  assert.equal(buildCommission([job("a", "c8", "2026-10-01", { tags: ["Commercial", "Sold by Ethan H", "Outbound"] })], { payments: pay })[0].earned, 280);
  assert.equal(buildCommission([job("a", "c8", "2026-10-01", { tags: ["Commercial", "sold by ethan", "Outbound"] })], { payments: pay }).length, 0);
});
