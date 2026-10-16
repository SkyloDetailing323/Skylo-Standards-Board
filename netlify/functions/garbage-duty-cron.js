// netlify/functions/garbage-duty-cron.js
// Hourly timer for the garbage rotation: starts garbage-duty (action "run"),
// which marks past nights with no bins photo 'missed' (the run just after
// midnight Mountain) and locks today's assignment at 10:00 AM Mountain.
// Status-only on garbage_duty -- never touches time entries or hours.
// Scheduled functions can't be opened by URL, so the timer lives here.

const { internalKey } = require("./lib/authToken");
const SITE = "https://main--skylotechleaderboard.netlify.app";

exports.handler = async () => {
  const res = await fetch(`${SITE}/.netlify/functions/garbage-duty`, { method: "POST", headers: { "Content-Type": "application/json", "x-internal-key": internalKey() || "" }, body: JSON.stringify({ action: "run" }) });
  const text = await res.text();
  console.log(`garbage-duty-cron: HTTP ${res.status} ${text.slice(0, 300)}`);
  return { statusCode: 200, body: text };
};
