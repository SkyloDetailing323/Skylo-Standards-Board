// netlify/functions/ga4-sync-cron.js
// Scheduled: starts ga4-sync (scheduled functions can't be opened by URL, so
// the timer lives here and the sync itself stays callable from "Sync now").

const { internalKey } = require("./lib/authToken");
const SITE = "https://main--skylotechleaderboard.netlify.app";

exports.handler = async () => {
  const res = await fetch(`${SITE}/.netlify/functions/ga4-sync?days=7`, { headers: { "x-internal-key": internalKey() || "" } });
  const text = await res.text();
  console.log(`ga4-sync-cron: HTTP ${res.status} ${text.slice(0, 300)}`);
  return { statusCode: 200, body: text };
};
