// netlify/functions/meta-ads-backfill-background.js
// One-time pull of older Meta ad history (up to ~13 months) in 30-day pieces,
// so the Marketing tab can show an ad's whole life -- when it started, its
// best weeks and when it began to slide. Started once by meta-ads-sync-cron
// (internal key) or by an owner (?t=token); records "meta_ads_backfill" when done.

const { canRunSync } = require("./lib/authToken");
const { mountainDay, creds, pullDaily, saveState } = require("./lib/metaAds");

exports.handler = async (event) => {
  if (!canRunSync(event)) return { statusCode: 403, body: "Owners only" };
  const c = creds();
  if (!c) return { statusCode: 200, body: "Meta not connected" };
  const total = Math.min(Math.max(parseInt(event?.queryStringParameters?.days, 10) || 395, 30), 395);
  const done = [];
  try {
    for (let end = 0; end < total; end += 30) {
      const since = mountainDay(Math.min(end + 29, total - 1)), until = mountainDay(end);
      const rows = await pullDaily(c, since, until);
      done.push({ since, until, rows: rows.length });
    }
    await saveState("meta_ads_backfill", { ok: true, days: total, finished_at: new Date().toISOString(), pieces: done });
  } catch (e) {
    console.error("meta-ads-backfill:", e.message);
    await saveState("meta_ads_backfill", { ok: false, error: e.message, pieces: done, at: new Date().toISOString() });
  }
  return { statusCode: 202 };
};
