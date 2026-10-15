// netlify/functions/hcp-sales-sync-quick-cron.js
// Every 5 min: starts hcp-sales-sync-background in quick mode (jobs scheduled
// yesterday to 45 days out), so Trevor's "Booked" board on the Sales tab is
// minutes behind HCP instead of an hour. The hourly hcp-sales-sync-cron still
// does the full pull.

const SITE = "https://main--skylotechleaderboard.netlify.app";

exports.handler = async () => {
  const res = await fetch(`${SITE}/.netlify/functions/hcp-sales-sync-background?mode=quick`, { method: "POST" });
  console.log(`hcp-sales-sync-quick-cron: started quick sync (HTTP ${res.status})`);
  return { statusCode: 200, body: JSON.stringify({ ok: true, background_status: res.status }) };
};
