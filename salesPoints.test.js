import { test } from "node:test";
import assert from "node:assert/strict";
import { rowFor, pointsFor, tierFor, POINTS_TABLE } from "./salesPoints.js";

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

test("unknown frequency earns nothing", () => {
  assert.equal(pointsFor(300, "biannual"), 0);
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
