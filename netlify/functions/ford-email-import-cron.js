// netlify/functions/ford-email-import-cron.js
// Daily 7:30 AM Mountain: starts ford-email-import (Ford Pro report emails ->
// driver scorecard). Scheduled functions can't be opened by URL, so the timer
// lives here and the import stays callable from the Trucks tab's "Import
// now" button. Netlify schedules are UTC, so this fires at both 13:30 and
// 14:30 UTC and only runs on the one that is 7:30 in Denver (MDT or MST).

const { internalKey } = require("./lib/authToken");
const SITE = "https://main--skylotechleaderboard.netlify.app";

exports.handler = async () => {
  const hour = new Intl.DateTimeFormat("en-GB", { timeZone: "America/Denver", hour: "2-digit", hourCycle: "h23" }).format(new Date());
  if (hour !== "07") return { statusCode: 200, body: `not 7 AM in Denver (${hour}) — skipped` };
  const res = await fetch(`${SITE}/.netlify/functions/ford-email-import`, { method: "POST", headers: { "x-internal-key": internalKey() || "" } });
  const text = await res.text();
  console.log(`ford-email-import-cron: HTTP ${res.status} ${text.slice(0, 300)}`);
  return { statusCode: 200, body: text };
};
