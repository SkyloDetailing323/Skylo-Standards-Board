// netlify/functions/hcp-nightly-recheck-cron.js
// Scheduled (nightly, ~2 AM Mountain): starts hcp-nightly-recheck-background.
// Scheduled functions can't run longer than 30s, so the work lives in the
// background function and this only kicks it off.

const { internalKey } = require("./lib/authToken");
const SITE = "https://main--skylotechleaderboard.netlify.app";

exports.handler = async () => {
  const res = await fetch(`${SITE}/.netlify/functions/hcp-nightly-recheck-background`, { method: "POST", headers: { "x-internal-key": internalKey() || "" } });
  console.log(`hcp-nightly-recheck-cron: HTTP ${res.status}`);
  return { statusCode: 200, body: String(res.status) };
};
