// netlify/functions/gsc-sync.js
// Pulls organic Google search for skylod.com from Search Console: daily site
// totals, the searches people typed, and the pages that showed up, into
// gsc_daily / gsc_queries_daily / gsc_pages_daily. Also asks Google whether the
// site's top pages are indexed (gsc_page_status) and reads sitemap status.
// Uses the same Google sign-in as Google Ads and Analytics (Reconnect Google
// in the Marketing tab adds read-only Search Console access). Started daily by
// gsc-sync-cron for the last 10 days (Search Console runs ~2-3 days behind);
// ?days=480 backfills (Google keeps 16 months).
//
// The site is GSC_SITE_URL if set (e.g. "sc-domain:skylod.com"), otherwise
// found automatically from the signed-in account (the one named like skylod).

const { sb, getRefreshToken, accessToken } = require("./lib/googleAds");
const { canRunSync } = require("./lib/authToken");

const API = "https://www.googleapis.com/webmasters/v3";
const mtDay = (offset = 0) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Denver" }).format(new Date(Date.now() - offset * 864e5));
const INSPECT_PAGES = 15;

async function saveState(value) {
  await sb("ghl_sync_state?on_conflict=key", { method: "POST", prefer: "resolution=merge-duplicates,return=minimal",
    body: JSON.stringify({ key: "gsc_last_run", value, updated_at: new Date().toISOString() }) }).catch(() => {});
}

async function gfetch(url, token, body) {
  const res = await fetch(url, {
    method: body ? "POST" : "GET",
    headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Search Console HTTP ${res.status}: ${data?.error?.message || "request failed"}`);
  return data;
}

async function findSite(token) {
  if (process.env.GSC_SITE_URL) return process.env.GSC_SITE_URL;
  const sites = ((await gfetch(`${API}/sites`, token)).siteEntry || []).filter(s => s.permissionLevel !== "siteUnverifiedUser");
  if (!sites.length) throw new Error("This Google login can't see any Search Console site — add team@skylod.com as a user on skylod.com (Search Console → Settings → Users and permissions).");
  return (sites.find(s => s.siteUrl === "sc-domain:skylod.com") || sites.find(s => /skylod/i.test(s.siteUrl)) || sites[0]).siteUrl;
}

// Every row for the dimensions, paging past Google's 25,000-row cap.
async function query(token, site, since, until, dimensions) {
  const rows = [];
  for (let startRow = 0; ; startRow += 25000) {
    const data = await gfetch(`${API}/sites/${encodeURIComponent(site)}/searchAnalytics/query`, token,
      { startDate: since, endDate: until, dimensions, rowLimit: 25000, startRow });
    rows.push(...(data.rows || []));
    if ((data.rows || []).length < 25000) return rows;
  }
}

async function upsert(table, conflict, rows) {
  for (let i = 0; i < rows.length; i += 500) {
    await sb(`${table}?on_conflict=${conflict}`, { method: "POST", prefer: "resolution=merge-duplicates,return=minimal", body: JSON.stringify(rows.slice(i, i + 500)) });
  }
}

const num = (r, k) => Math.round(Number(r[k]) || 0);
const pos = r => r.position != null ? Math.round(Number(r.position) * 100) / 100 : null;

exports.handler = async (event) => {
  if (!canRunSync(event)) return { statusCode: 403, body: JSON.stringify({ ok: false, error: "Owners only — use Sync now in the Marketing tab." }) };
  const days = Math.min(Math.max(parseInt(event?.queryStringParameters?.days, 10) || 10, 1), 480);
  const since = mtDay(days - 1), until = mtDay(0);
  try {
    const stored = await getRefreshToken();
    if (!stored) return { statusCode: 200, body: JSON.stringify({ ok: false, skipped: "Google not connected yet" }) };
    if (!/webmasters/.test(stored.meta?.scope || "")) {
      const msg = "Google is connected without Search Console — tap Reconnect Google on the Google Search page to add it.";
      await saveState({ ok: false, error: msg });
      return { statusCode: 200, body: JSON.stringify({ ok: false, skipped: msg }) };
    }
    const token = await accessToken(stored.value);
    const site = await findSite(token);
    const now = new Date().toISOString();

    const [totals, queries, pages] = await Promise.all([
      query(token, site, since, until, ["date"]),
      query(token, site, since, until, ["date", "query"]),
      query(token, site, since, until, ["date", "page"]),
    ]);
    const daily = totals.map(r => ({ day: r.keys[0], clicks: num(r, "clicks"), impressions: num(r, "impressions"), position: pos(r), synced_at: now }));
    const qRows = queries.map(r => ({ day: r.keys[0], query: String(r.keys[1]).slice(0, 300), clicks: num(r, "clicks"), impressions: num(r, "impressions"), position: pos(r), synced_at: now }));
    const pRows = pages.map(r => ({ day: r.keys[0], page: String(r.keys[1]).slice(0, 500), clicks: num(r, "clicks"), impressions: num(r, "impressions"), position: pos(r), synced_at: now }));
    await upsert("gsc_daily", "day", daily);
    await upsert("gsc_queries_daily", "day,query", qRows);
    await upsert("gsc_pages_daily", "day,page", pRows);

    // Site health: sitemaps, and whether the most-seen pages are indexed.
    const sitemaps = ((await gfetch(`${API}/sites/${encodeURIComponent(site)}/sitemaps`, token).catch(() => ({}))).sitemap || [])
      .map(s => ({ path: s.path, last_downloaded: s.lastDownloaded || null, errors: Number(s.errors) || 0, warnings: Number(s.warnings) || 0, pending: !!s.isPending }));
    const byPage = {};
    // Tracking links (?utm_...) aren't real pages -- Google never indexes them.
    for (const r of pRows) if (!r.page.includes("?")) byPage[r.page] = (byPage[r.page] || 0) + r.impressions;
    const top = Object.entries(byPage).sort((a, b) => b[1] - a[1]).slice(0, INSPECT_PAGES).map(([p]) => p);
    const status = [];
    for (let i = 0; i < top.length; i += 5) {
      const batch = await Promise.all(top.slice(i, i + 5).map(page =>
        gfetch("https://searchconsole.googleapis.com/v1/urlInspection/index:inspect", token, { inspectionUrl: page, siteUrl: site })
          .then(d => { const x = d.inspectionResult?.indexStatusResult || {}; return { page, verdict: x.verdict || null, coverage: x.coverageState || null, last_crawl_at: x.lastCrawlTime || null, checked_at: now }; })
          .catch(() => null)));
      status.push(...batch.filter(Boolean));
    }
    if (status.length) await upsert("gsc_page_status", "page", status);

    const result = { ok: true, site, since, until, rows: daily.length, queries: qRows.length, pages: pRows.length,
      clicks: daily.reduce((s, r) => s + r.clicks, 0), inspected: status.length, sitemaps };
    await saveState(result);
    return { statusCode: 200, body: JSON.stringify(result) };
  } catch (e) {
    console.error("gsc-sync:", e.message);
    await saveState({ ok: false, since, until, error: e.message });
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: e.message }) };
  }
};
