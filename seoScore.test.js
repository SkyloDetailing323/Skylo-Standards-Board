import { test } from "node:test";
import assert from "node:assert/strict";
import { pageKind, pageLabel, scorecard, fixList } from "./seoScore.js";

const site = "https://skylod.com";
const report = {
  non_brand: { clicks: 1, impressions: 125 },
  prev_maps: { clicks: 10, impressions: 100 },
  queries: [
    { query: "car ceramic coating near me", clicks: 0, impressions: 11, position: 1, brand: false },
    { query: "mobile detailing near me", clicks: 0, impressions: 8, position: 3.6, brand: false },
    { query: "mobile detailing", clicks: 1, impressions: 4, position: 9.3, brand: false },
    { query: "skylo detailing", clicks: 37, impressions: 123, position: 1, brand: true },
  ],
  pages: [
    { page: `${site}/?utm_source=google&utm_medium=organic&utm_campaign=gbp`, clicks: 22, impressions: 299, position: 2.9 },
    { page: `${site}/`, clicks: 28, impressions: 285, position: 2.6 },
    { page: `${site}/car-detailing-american-fork`, clicks: 1, impressions: 159, position: 5.2 },
    { page: `${site}/salt-lake-city`, clicks: 2, impressions: 115, position: 6.5 },
    { page: `${site}/car-detailing-provo`, clicks: 2, impressions: 54, position: 11.2 },
    { page: `${site}/quote`, clicks: 0, impressions: 61, position: 7.7 },
    { page: `${site}/tos`, clicks: 1, impressions: 28, position: 6.6 },
  ],
  page_status: [{ page: `${site}/`, verdict: "PASS" }],
  connection: { last_result: { ok: true, sitemaps: [{ path: "/sitemap.xml", errors: 0 }] } },
};

test("page kinds and labels", () => {
  assert.equal(pageKind(report.pages[0].page), "maps");
  assert.equal(pageKind(`${site}/car-detailing-lehi`), "city");
  assert.equal(pageKind(`${site}/salt-lake-city`), "city");
  assert.equal(pageKind(`${site}/boats`), "page");
  assert.equal(pageKind(`${site}/boats?x=1`), "tracking");
  assert.equal(pageLabel(`${site}/`), "Homepage");
  assert.equal(pageLabel(`${site}/car-detailing-american-fork`), "American Fork page");
  assert.equal(pageLabel(`${site}/salt-lake-city`), "Salt Lake City page");
});

test("scorecard", () => {
  const s = Object.fromEntries(scorecard(report, 6).map(x => [x.key, x]));
  assert.equal(s.new.status, "bad");                // 1 in 6 days = 5/month vs 50
  assert.equal(s.cities.value, "0 of 3");
  assert.equal(s.cities.status, "bad");              // Provo is on page two
  assert.equal(s.ctr.value, "4.3%");                 // 1 click / 23 page-one shows
  assert.equal(s.ctr.status, "good");
  assert.equal(s.maps.value, "22");
  assert.equal(s.maps.status, "good");               // up from 10
  assert.equal(s.health.status, "good");
});

test("fix list: biggest city pages first, rank-1-no-clicks flagged, forms/legal skipped", () => {
  const f = fixList(report);
  assert.match(f[0].title, /^American Fork page: shown 159 times/);
  assert.ok(f.some(x => x.title.includes("car ceramic coating near me")));
  assert.ok(!f.some(x => /quote|tos/.test(x.title)));
  assert.ok(!f.some(x => x.title.startsWith("Homepage")));   // already top 3
});

test("indexing problems go to the top", () => {
  const f = fixList({ ...report, page_status: [{ page: `${site}/boats`, verdict: "FAIL", coverage: "Crawled - currently not indexed" }] });
  assert.equal(f[0].title, "Google can't show /boats");
});

test("a #1 rank nobody clicks outranks smaller city pages in the fix list", () => {
  const titles = fixList(report).map(f => f.title);
  assert.ok(titles.findIndex(t => t.includes("car ceramic coating")) < titles.findIndex(t => t.startsWith("Provo page")));
});
