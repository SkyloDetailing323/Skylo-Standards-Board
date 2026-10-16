// netlify/functions/hcp-commission-payments-cron.js
// Hourly: starts hcp-commission-payments-background (which of Ethan's
// commercial visits the client has paid, for his commission).

const SITE = "https://main--skylotechleaderboard.netlify.app";

exports.handler = async () => {
  const res = await fetch(`${SITE}/.netlify/functions/hcp-commission-payments-background`, { method: "POST" });
  console.log(`hcp-commission-payments-cron: started background sync (HTTP ${res.status})`);
  return { statusCode: 200, body: JSON.stringify({ ok: true, background_status: res.status }) };
};
