// netlify/functions/hcp-sales-sync-cron.js
// Hourly: starts hcp-sales-sync-background (HCP jobs + customer contact info
// for the Sales/Marketing revenue numbers).

const SITE = "https://main--skylotechleaderboard.netlify.app";

exports.handler = async () => {
  const res = await fetch(`${SITE}/.netlify/functions/hcp-sales-sync-background`, { method: "POST" });
  console.log(`hcp-sales-sync-cron: started background sync (HTTP ${res.status})`);
  return { statusCode: 200, body: JSON.stringify({ ok: true, background_status: res.status }) };
};
