// netlify/functions/ga4-sync.js
// Pulls daily website visitors from Google Analytics 4 (sessions, users,
// engaged sessions, key events) by channel, plus landing pages, into
// ga4_daily / ga4_pages_daily. Uses the same Google sign-in as Google Ads
// (Connect Google in the Marketing tab, which now also asks for read-only
// Analytics access). Started daily by ga4-sync-cron for the last 7 days;
// ?days=90 backfills.
//
// The GA4 property is GA4_PROPERTY_ID if set, otherwise found automatically
// from the signed-in account (the one named like "Skylo", else the only one).

const { sb, getRefreshToken, accessToken } = require("./lib/googleAds");
const { canRunSync } = require("./lib/authToken");

const mtDay = (offset = 0) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Denver" }).format(new Date(Date.now() - offset * 864e5));
const ymd = s => `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;

async function saveState(value) {
  await sb("ghl_sync_state?on_conflict=key", { method: "POST", prefer: "resolution=merge-duplicates,return=minimal",
    body: JSON.stringify({ key: "ga4_last_run", value, updated_at: new Date().toISOString() }) }).catch(() => {});
}

async function gget(url, token) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Google Analytics HTTP ${res.status}: ${data?.error?.message || "request failed"}`);
  return data;
}

async function findProperty(token) {
  if (process.env.GA4_PROPERTY_ID) return { id: String(process.env.GA4_PROPERTY_ID).replace(/\D/g, ""), name: null };
  const props = [];
  let pageToken;
  do {
    const data = await gget(`https://analyticsadmin.googleapis.com/v1beta/accountSummaries?pageSize=200${pageToken ? `&pageToken=${pageToken}` : ""}`, token);
    for (const a of data.accountSummaries || []) for (const p of a.propertySummaries || []) props.push({ id: p.property.split("/")[1], name: p.displayName, account: a.displayName });
    pageToken = data.nextPageToken;
  } while (pageToken);
  if (!props.length) throw new Error("This Google login can't see any Google Analytics 4 property — add team@skylod.com as a Viewer in GA4 (Admin → Property access management).");
  return props.find(p => /skylo/i.test(`${p.name} ${p.account}`)) || props[0];
}

async function runReport(token, property, body) {
  const res = await fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${property}:runReport`, {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Google Analytics HTTP ${res.status}: ${data?.error?.message || "report failed"}`);
  return data.rows || [];
}

async function upsert(table, conflict, rows) {
  for (let i = 0; i < rows.length; i += 500) {
    await sb(`${table}?on_conflict=${conflict}`, { method: "POST", prefer: "resolution=merge-duplicates,return=minimal", body: JSON.stringify(rows.slice(i, i + 500)) });
  }
}

exports.handler = async (event) => {
  if (!canRunSync(event)) return { statusCode: 403, body: JSON.stringify({ ok: false, error: "Owners only — use Sync now in the Marketing tab." }) };
  const days = Math.min(Math.max(parseInt(event?.queryStringParameters?.days, 10) || 7, 1), 400);
  const since = mtDay(days - 1), until = mtDay(0);
  try {
    const stored = await getRefreshToken();
    if (!stored) return { statusCode: 200, body: JSON.stringify({ ok: false, skipped: "Google not connected yet" }) };
    if (!/analytics/.test(stored.meta?.scope || "")) {
      const msg = "Google is connected for Ads only — tap Reconnect Google in the Website tab to add Analytics.";
      await saveState({ ok: false, error: msg });
      return { statusCode: 200, body: JSON.stringify({ ok: false, skipped: msg }) };
    }
    const token = await accessToken(stored.value);
    const prop = await findProperty(token);
    const dateRanges = [{ startDate: since, endDate: until }];
    const now = new Date().toISOString();

    const chRows = await runReport(token, prop.id, {
      dateRanges, limit: 100000,
      dimensions: [{ name: "date" }, { name: "sessionDefaultChannelGroup" }],
      metrics: [{ name: "sessions" }, { name: "totalUsers" }, { name: "engagedSessions" }, { name: "keyEvents" }],
    });
    const daily = chRows.map(r => ({
      day: ymd(r.dimensionValues[0].value), channel: r.dimensionValues[1].value || "(not set)",
      sessions: Number(r.metricValues[0].value) || 0, users: Number(r.metricValues[1].value) || 0,
      engaged: Number(r.metricValues[2].value) || 0, key_events: Number(r.metricValues[3].value) || 0, synced_at: now,
    }));

    const pgRows = await runReport(token, prop.id, {
      dateRanges, limit: 100000,
      dimensions: [{ name: "date" }, { name: "landingPage" }],
      metrics: [{ name: "sessions" }, { name: "keyEvents" }],
    });
    const pages = pgRows.map(r => ({
      day: ymd(r.dimensionValues[0].value), page: (r.dimensionValues[1].value || "(not set)").slice(0, 300),
      sessions: Number(r.metricValues[0].value) || 0, key_events: Number(r.metricValues[1].value) || 0, synced_at: now,
    }));

    await upsert("ga4_daily", "day,channel", daily);
    await upsert("ga4_pages_daily", "day,page", pages);
    const result = { ok: true, property: prop.id, property_name: prop.name, since, until, rows: daily.length, pages: pages.length,
      sessions: daily.reduce((s, r) => s + r.sessions, 0) };
    await saveState(result);
    return { statusCode: 200, body: JSON.stringify(result) };
  } catch (e) {
    console.error("ga4-sync:", e.message);
    await saveState({ ok: false, since, until, error: e.message });
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: e.message }) };
  }
};
