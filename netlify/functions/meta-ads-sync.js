// netlify/functions/meta-ads-sync.js
// Pulls daily ad spend, impressions, clicks and leads per ad from the Meta
// Marketing API into ad_spend_daily, plus each ad's start date, status and
// 28-day frequency into meta_ads. Started every morning by meta-ads-sync-cron
// for the last 7 days (Meta revises recent numbers for a few days).
// Older history: meta-ads-backfill-background (started once by the cron).
//
// Needs (Netlify env, secret): META_ADS_TOKEN (system user token, ads_read)
// and META_AD_ACCOUNT_ID (the number after act=). Optional META_API_VERSION.

const { canRunSync } = require("./lib/authToken");
const { mountainDay, creds, pullDaily, pullAds, saveState } = require("./lib/metaAds");

exports.handler = async (event) => {
  if (!canRunSync(event)) return { statusCode: 403, body: JSON.stringify({ ok: false, error: "Owners only — use Sync now in the Marketing tab." }) };
  const c = creds();
  if (!c) return { statusCode: 200, body: JSON.stringify({ ok: false, skipped: "META_ADS_TOKEN / META_AD_ACCOUNT_ID not set yet" }) };

  const days = Math.min(Math.max(parseInt(event?.queryStringParameters?.days, 10) || 7, 1), 120);
  const since = mountainDay(days - 1), until = mountainDay(0);
  try {
    const rows = await pullDaily(c, since, until);
    let ads = null;
    try { ads = await pullAds(c); } catch (e) { console.error("meta-ads-sync ads:", e.message); ads = `failed: ${e.message}`; }
    const spend = rows.reduce((s, r) => s + r.spend, 0);
    await saveState("meta_ads_last_run", { ok: true, since, until, rows: rows.length, spend: Math.round(spend * 100) / 100, ads });
    return { statusCode: 200, body: JSON.stringify({ ok: true, since, until, rows: rows.length, spend, ads }) };
  } catch (e) {
    console.error("meta-ads-sync:", e.message);
    await saveState("meta_ads_last_run", { ok: false, since, until, error: e.message });
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: e.message }) };
  }
};
