// netlify/functions/meta-ads-sync-cron.js
// Scheduled: starts meta-ads-sync (scheduled functions can't be opened by URL, so
// the timer lives here and the sync itself stays callable from "Sync now").
// Also starts the one-time history backfill if it hasn't finished yet.

const { internalKey } = require("./lib/authToken");
const { getState } = require("./lib/metaAds");
const SITE = "https://main--skylotechleaderboard.netlify.app";

exports.handler = async () => {
  const headers = { "x-internal-key": internalKey() || "" };
  const res = await fetch(`${SITE}/.netlify/functions/meta-ads-sync?days=7`, { headers });
  const text = await res.text();
  console.log(`meta-ads-sync-cron: HTTP ${res.status} ${text.slice(0, 300)}`);
  try {
    const bf = await getState("meta_ads_backfill");
    if (!bf?.ok) {
      const b = await fetch(`${SITE}/.netlify/functions/meta-ads-backfill-background`, { headers });
      console.log(`meta-ads-sync-cron: backfill started (HTTP ${b.status})`);
    }
  } catch (e) { console.error("meta-ads-sync-cron backfill:", e.message); }
  return { statusCode: 200, body: text };
};
