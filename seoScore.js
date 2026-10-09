// seoScore.js
// The SEO page's scorecard and "What to fix next" list, from the Search
// Console report (reports.js type=search). Pure functions, no React or
// network code. Display only -- not tied to pay.

// Owner goals (Oct 2026). Change these to move the green/yellow/red lines.
export const SEO_GOALS = {
  nonBrandPerMonth: 50,  // clicks from people who didn't search "Skylo"
  cityTopRank: 3,        // every city page averaging top 3
  pageOneClickRate: 3,   // % of non-brand page-one appearances that get a click
};

const path = url => String(url || "").replace(/^https?:\/\/[^/]+/, "") || "/";
const MAPS = /utm_campaign=gbp/i;
const CITY = /^\/(car-detailing-[a-z-]+|salt-lake-city|park-city)\/?$/i;
// Pages that aren't worth working on for search (legal, forms).
const SKIP = /^\/(tos|terms|privacy|quote)(\/|$)/i;

export function pageKind(url) {
  if (MAPS.test(url)) return "maps";
  const p = path(url);
  if (p.includes("?")) return "tracking";
  if (CITY.test(p)) return "city";
  return "page";
}

export function pageLabel(url) {
  if (MAPS.test(url)) return "📍 Google Maps listing (its Website button)";
  const p = path(url);
  if (p === "/") return "Homepage";
  if (CITY.test(p)) {
    const city = p.replace(/^\/(car-detailing-)?/, "").replace(/\/$/, "").split("-").map(w => w[0].toUpperCase() + w.slice(1)).join(" ");
    return `${city} page`;
  }
  return p;
}

const rate = (c, i) => i ? (c / i) * 100 : 0;
const pct = n => `${n >= 10 ? Math.round(n) : Math.round(n * 10) / 10}%`;

// d: the search report. days: length of the range. Returns score tiles:
// { key, label, value, sub, goal, status: "good"|"ok"|"bad"|"none", meter: 0-1, help }.
export function scorecard(d, days) {
  const perMonth = n => days ? (n / days) * 30 : 0;
  const nb = d.non_brand?.clicks || 0;
  const nbMonth = perMonth(nb);
  const cities = (d.pages || []).filter(p => pageKind(p.page) === "city" && p.impressions > 0);
  const top = cities.filter(p => p.position != null && p.position <= SEO_GOALS.cityTopRank).length;
  const one = cities.filter(p => p.position != null && p.position <= 10).length;
  const p1 = (d.queries || []).filter(q => !q.brand && q.position != null && q.position <= 10);
  const p1Rate = rate(p1.reduce((s, q) => s + q.clicks, 0), p1.reduce((s, q) => s + q.impressions, 0));
  const maps = (d.pages || []).filter(p => pageKind(p.page) === "maps").reduce((s, p) => s + p.clicks, 0);
  const prevMaps = d.prev_maps?.clicks || 0;
  const notIndexed = (d.page_status || []).filter(p => p.verdict && p.verdict !== "PASS").length;
  const sm = d.connection?.last_result?.sitemaps || [];
  const smErrors = sm.reduce((s, x) => s + (x.errors || 0), 0);
  const healthIssues = notIndexed + smErrors + (sm.length ? 0 : 1);
  const level = (v, good, ok) => v >= good ? "good" : v >= ok ? "ok" : "bad";
  return [
    { key:"new", label:"New people from Google", value:`${nb}`, sub:`≈${Math.round(nbMonth)} a month at this pace`,
      goal:`Goal ${SEO_GOALS.nonBrandPerMonth}+ a month`, status:level(nbMonth, SEO_GOALS.nonBrandPerMonth, SEO_GOALS.nonBrandPerMonth / 2),
      meter:Math.min(1, nbMonth / SEO_GOALS.nonBrandPerMonth),
      help:"Clicks from people who searched something like \"car detailing near me\" — not your name. These are new customers finding you for free. The number SEO work should grow." },
    { key:"cities", label:"City pages in the top 3", value:cities.length ? `${top} of ${cities.length}` : "—", sub:cities.length ? `${one} of ${cities.length} on page one` : "no city pages shown yet",
      goal:"Goal: all of them", status:!cities.length ? "none" : top === cities.length ? "good" : one === cities.length ? "ok" : "bad",
      meter:cities.length ? top / cities.length : 0,
      help:"Your pages for each city (Lehi, Provo, American Fork…). Most clicks go to the top 3 results; at #7–10 you're under the ads and the Maps box, so few people scroll down to you." },
    { key:"ctr", label:"Click rate on page one", value:p1.length ? pct(p1Rate) : "—", sub:"non-brand searches where you're on page one",
      goal:`Goal ${SEO_GOALS.pageOneClickRate}%+`, status:!p1.length ? "none" : level(p1Rate, SEO_GOALS.pageOneClickRate, SEO_GOALS.pageOneClickRate / 2),
      meter:Math.min(1, p1Rate / SEO_GOALS.pageOneClickRate),
      help:"Of the times you showed up on page one for a non-brand search, how often someone clicked. Low = your Google headline (page title) and the line under it aren't convincing, or you're too far down the page." },
    { key:"maps", label:"Maps listing clicks", value:`${maps}`, sub:prevMaps ? `${maps >= prevMaps ? "▲" : "▼"} was ${prevMaps} the period before` : "first period with data",
      goal:"Goal: growing", status:!prevMaps ? (maps ? "good" : "none") : maps >= prevMaps ? "good" : maps >= prevMaps * 0.8 ? "ok" : "bad",
      meter:prevMaps ? Math.min(1, maps / prevMaps) : (maps ? 1 : 0),
      help:"People who tapped Website on your Google Business Profile (the Maps listing). Calls and direction taps from the listing aren't counted here. More reviews and photos on the listing grow this." },
    { key:"health", label:"Site health", value:healthIssues ? `${healthIssues} issue${healthIssues === 1 ? "" : "s"}` : "All good", sub:`${(d.page_status || []).length} top pages checked · sitemap ${sm.length ? (smErrors ? "has errors" : "OK") : "missing"}`,
      goal:"Goal: 0 issues", status:healthIssues ? "bad" : "good", meter:healthIssues ? 0 : 1,
      help:"Whether Google can find and show your most important pages. Any issue here means a page can't show up in search at all — fix these first." },
  ];
}

// Plain-English to-do list, most valuable first (max `limit`).
export function fixList(d, limit = 6) {
  const out = [];
  for (const p of d.page_status || []) {
    if (p.verdict && p.verdict !== "PASS") out.push({ weight:1e6, title:`Google can't show ${pageLabel(p.page)}`,
      body:`Google says: "${p.coverage || p.verdict}". Ask whoever manages skylod.com to check this page is published and listed in the sitemap.` });
  }
  const sm = d.connection?.last_result?.sitemaps || [];
  if (d.connection?.last_result?.ok && !sm.length) out.push({ weight:9e5, title:"Submit a sitemap",
    body:"Search Console → Sitemaps → add /sitemap.xml so Google finds every page." });
  for (const p of d.pages || []) {
    const kind = pageKind(p.page);
    if ((kind !== "city" && kind !== "page") || SKIP.test(path(p.page)) || p.impressions < 20 || p.position == null || p.position <= 3 || p.position > 20) continue;
    const spot = p.position <= 10 ? `#${Math.round(p.position)}, the bottom half of page one` : `#${Math.round(p.position)}, page two`;
    out.push({ weight:p.impressions * (kind === "city" ? 2 : 1), title:`${pageLabel(p.page)}: shown ${p.impressions} times, ${p.clicks} click${p.clicks === 1 ? "" : "s"}`,
      body:`It ranks about ${spot}. Rewrite its Google headline and description (e.g. "Mobile Car Detailing in ${kind === "city" ? pageLabel(p.page).replace(/ page$/, "") : "Utah"} | We Come to You | 1,100+ 5★ Reviews"), add photos and reviews from local customers, and link to it from the homepage. Aim for the top 3.` });
  }
  for (const q of d.queries || []) {
    if (q.brand || q.position == null || q.position > 3 || q.impressions < 10 || rate(q.clicks, q.impressions) >= 2) continue;
    out.push({ weight:q.impressions * 10, title:`"${q.query}": you rank #${Math.round(q.position)} but nobody clicks`,
      body:"People see you near the top and still skip you — usually the page Google shows isn't about this exact service. Give it its own page with a headline that matches the search." });
  }
  return out.sort((a, b) => b.weight - a.weight).slice(0, limit).map(({ weight, ...x }) => x);
}
