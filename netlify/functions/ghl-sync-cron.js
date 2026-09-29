// netlify/functions/ghl-sync-cron.js
// Every 15 minutes: starts ghl-sync-background (which does the actual work
// and can run up to 15 minutes). Scheduled functions can't run that long
// themselves, so this just kicks it off and returns.

const SITE = "https://main--skylotechleaderboard.netlify.app";

exports.handler = async () => {
  const res = await fetch(`${SITE}/.netlify/functions/ghl-sync-background`, { method: "POST" });
  console.log(`ghl-sync-cron: started background sync (HTTP ${res.status})`);
  return { statusCode: 200, body: JSON.stringify({ ok: true, background_status: res.status }) };
};
