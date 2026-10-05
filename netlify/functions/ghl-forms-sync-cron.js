// netlify/functions/ghl-forms-sync-cron.js
// Every 15 minutes: starts ghl-forms-sync (Tote Checks + Tech Audits from
// GHL). Scheduled functions can't be opened by URL, so the timer lives here
// and the sync itself stays callable from the Audit Scores "Sync now" button.

const { internalKey } = require("./lib/authToken");
const SITE = "https://main--skylotechleaderboard.netlify.app";

exports.handler = async () => {
  const res = await fetch(`${SITE}/.netlify/functions/ghl-forms-sync`, { headers: { "x-internal-key": internalKey() || "" } });
  const text = await res.text();
  console.log(`ghl-forms-sync-cron: HTTP ${res.status} ${text.slice(0, 300)}`);
  return { statusCode: 200, body: text };
};
