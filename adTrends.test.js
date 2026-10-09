// adTrends.test.js -- run with `npm test`.

import test from "node:test";
import assert from "node:assert/strict";
import { groupAds, grade, gradeExplain, trend, reasons, metrics, sumWeeks, weekStart, marketShift } from "./adTrends.js";

const wk = (w, o) => ({ ad_id: "a", ad_name: "PC sign", campaign_id: "c", campaign_name: "Park City", wk: w, spend: 140, impressions: 6000, link_clicks: 45, platform_leads: 8, leads: 0, booked: 0, upfront: 0, sold: 0, ...o });

test("weeks are Mondays; the current partial week is left out; gaps fill with zeros", () => {
  assert.equal(weekStart("2026-10-09"), "2026-10-05");
  const [a] = groupAds([wk("2026-09-07"), wk("2026-09-21"), wk("2026-10-05")], "2026-10-09");
  assert.deepEqual(a.weeks.map(w => w.wk), ["2026-09-07", "2026-09-14", "2026-09-21", "2026-09-28"]);
  assert.equal(a.weeks[1].spend, 0);
});

test("grade: break-even, plans pay it back, green, not enough data, leads not in GHL", () => {
  const m = o => ({ spend: 1000, leads: 20, platformLeads: 20, roasUp: 2.5, roasSold: 2.5, ...o });
  assert.equal(grade(m({ roasUp: 1.5, roasSold: 1.5 }), 1.95).grade, "red");
  assert.equal(grade(m({ roasUp: 1.5, roasSold: 3.2 }), 1.95).grade, "yellow");
  assert.equal(grade(m({}), 1.95).grade, "yellow");
  assert.equal(grade(m({ roasUp: 4 }), 1.95).grade, "green");
  assert.equal(grade(m({ spend: 200 }), 1.95).grade, "none");
  assert.match(grade(m({ leads: 0, roasUp: 0 }), 1.95).note, /GHL/);
});

test("Park City sign ad (real weeks): cost per lead and CPM climbing -> slipping with a reason", () => {
  const real = [["2026-07-06",95,4150,32,5],["2026-07-13",140,6146,49,6],["2026-07-20",141,6345,45,14],["2026-07-27",140,6369,34,6],["2026-08-03",140,6868,39,9],
    ["2026-08-10",138,5626,40,3],["2026-08-17",140,4945,36,10],["2026-08-24",136,4595,30,7],["2026-08-31",144,5449,41,7],["2026-09-07",142,5021,33,7],
    ["2026-09-14",183,6459,53,5],["2026-09-21",216,7438,55,7],["2026-09-28",172,5531,33,6],["2026-10-05",120,3516,23,5]]
    .map(([w, spend, impressions, link_clicks, platform_leads]) => wk(w, { spend, impressions, link_clicks, platform_leads }));
  const [ad] = groupAds(real, "2026-10-12");
  const t = trend(ad);
  assert.ok(["slipping", "dropping"].includes(t.status), t.status);
  assert.ok(t.change.cpm > 0.15);
  assert.equal(t.peakWeek, "2026-07-13");          // best 4 weeks: Jul 13 - Aug 3 ($16 a lead)
  assert.ok(t.slideSince && t.slideSince >= "2026-08-10" && t.slideSince <= "2026-09-14", t.slideSince);
  const why = reasons(t, { frequency28d: 3.4, weeksRunning: 14 });
  assert.ok(why.some(s => /fatigue|seen it/.test(s)), why.join(" | "));
  assert.ok(why.some(s => /14 weeks/.test(s)));
});

test("a steady ad stays steady; a brand-new one is 'new'", () => {
  const ws = ["2026-07-27","2026-08-03","2026-08-10","2026-08-17","2026-08-24","2026-08-31","2026-09-07","2026-09-14"].map(w => wk(w));
  assert.equal(trend(groupAds(ws, "2026-09-22")[0]).status, "steady");
  assert.equal(trend(groupAds(ws.slice(-5), "2026-09-22")[0]).status, "new");
});

test("metrics", () => {
  const m = metrics(sumWeeks([wk("x", { leads: 4, booked: 2, upfront: 600, sold: 900 })]));
  assert.equal(m.cpl, 140 / 8); assert.equal(m.bookRate, 0.5); assert.equal(m.roasUp, 600 / 140); assert.equal(m.ticket, 300);
});

test("market-wide price rise isn't blamed on one ad; booking problems are called out", () => {
  const base = ["2026-07-06","2026-07-13","2026-07-20","2026-07-27","2026-08-03","2026-08-10","2026-08-17","2026-08-24"];
  // costs per lead up ~40% in the last 4 weeks for this ad
  const ad = groupAds(base.map((w, i) => wk(w, { spend: i < 4 ? 100 : 140, platform_leads: 8, impressions: i < 4 ? 6000 : 4500, leads: i < 4 ? 0 : 3 })), "2026-09-01")[0];
  assert.equal(trend(ad).status, "slipping");
  assert.equal(trend(ad, undefined, { cpl: 0.35, cpm: 0.35 }).status, "steady");      // everyone rose ~35%
  const t = trend(ad, undefined, { cpl: 0.35, cpm: 0.35 });
  assert.ok(reasons(t, { market: { cpl: 0.35, cpm: 0.35 } }).some(s => /fall market/.test(s)));
  assert.deepEqual(marketShift([{ peakWeek: "x", change: { cpl: 0.2, cpm: 0.3 } }, { peakWeek: "x", change: { cpl: 0.6, cpm: 0.4 } }, { peakWeek: "x", change: { cpl: 0.4, cpm: 0.2 } }]), { cpl: 0.4, cpm: 0.3, ads: 3 });
  const noBook = { ...t, recent: { ...t.recent, leads: 11, booked: 0, bookRate: 0 } };
  assert.ok(reasons(noBook).some(s => /11 leads reached GHL in 4 weeks but none booked/.test(s)));
});

test("hover text says why it's green, yellow, red or grey", () => {
  const m = o => ({ spend: 1000, leads: 20, platformLeads: 25, booked: 4, bookRate: 0.2, cpl: 40, ticket: 300, roasUp: 2.5, roasSold: 2.5, ...o });
  const ex = mm => gradeExplain(mm, grade(mm, 1.95), 1.95, { cpl: 30, bookRate: 0.25 });
  assert.match(ex(m({ roasUp: 4.2 })).headline, /^Green because it's earning 4\.20x/);
  assert.match(ex(m({ roasUp: 1.2, roasSold: 1.2 })).headline, /^Red because it's losing money: 1\.20x is under break-even 1\.95x/);
  const y = ex(m({ bookRate: 0.1, booked: 2 }));
  assert.match(y.headline, /^Yellow because it's making money/);
  assert.ok(y.lines.some(l => /To push it green: it books 10% of leads vs 25%/.test(l)), y.lines.join(" | "));
  assert.match(ex(m({ roasUp: 1.2, roasSold: 3.4 })).headline, /^Yellow because plans pay it back/);
  assert.match(ex(m({ spend: 100 })).headline, /^Grey: not enough data/);
  assert.match(ex(m({ leads: 0, roasUp: 0, booked: 0 })).headline, /^Grey: its leads aren't reaching GHL/);
});
