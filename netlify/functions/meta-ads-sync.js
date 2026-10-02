// netlify/functions/meta-ads-sync.js
// Pulls daily ad spend, impressions, clicks and leads per ad from the Meta
// Marketing API into ad_spend_daily. Runs every morning for the last 7 days
// (Meta revises recent numbers for a few days); visit with ?days=120 once to
// backfill history.
//
// Needs (Netlify env, secret): META_ADS_TOKEN (system user token, ads_read)
// and META_AD_ACCOUNT_ID (the number after act=). Optional META_API_VERSION.

const VERSION = process.env.META_API_VERSION || "v23.0";
const LEAD_ACTIONS = ["lead", "onsite_conversion.lead_grouped", "leadgen_grouped", "offsite_conversion.fb_pixel_lead"];

function mountainDay(offsetDays = 0) {
  const d = new Date(Date.now() - offsetDays * 864e5);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Denver" }).format(d);
}

async function sb(path, options = {}) {
  const res = await fetch(`${process.env.SUPABASE_URL}/rest/v1/${path}`, {
    method: options.method || "GET",
    body: options.body,
    headers: { "Content-Type": "application/json", apikey: process.env.SUPABASE_KEY, Authorization: `Bearer ${process.env.SUPABASE_KEY}`, Prefer: options.prefer || "return=minimal" },
  });
  if (!res.ok) throw new Error(`Supabase ${path} failed (HTTP ${res.status}): ${(await res.text()).slice(0, 300)}`);
}

async function saveState(value) {
  await sb("ghl_sync_state?on_conflict=key", { method: "POST", prefer: "resolution=merge-duplicates,return=minimal", body: JSON.stringify({ key: "meta_ads_last_run", value, updated_at: new Date().toISOString() }) }).catch(() => {});
}

exports.handler = async (event) => {
  const token = process.env.META_ADS_TOKEN, account = (process.env.META_AD_ACCOUNT_ID || "").replace(/^act_/, "");
  if (!token || !account) return { statusCode: 200, body: JSON.stringify({ ok: false, skipped: "META_ADS_TOKEN / META_AD_ACCOUNT_ID not set yet" }) };

  const days = Math.min(Math.max(parseInt(event?.queryStringParameters?.days, 10) || 7, 1), 400);
  const since = mountainDay(days - 1), until = mountainDay(0);
  const fields = "campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name,spend,impressions,clicks,actions";
  let url = `https://graph.facebook.com/${VERSION}/act_${account}/insights?level=ad&time_increment=1&limit=500`
    + `&fields=${fields}&time_range=${encodeURIComponent(JSON.stringify({ since, until }))}&access_token=${encodeURIComponent(token)}`;

  const rows = [];
  try {
    while (url) {
      const res = await fetch(url);
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error?.message || `Meta API HTTP ${res.status}`);
      for (const r of data.data || []) {
        const leads = (r.actions || []).filter(a => LEAD_ACTIONS.includes(a.action_type)).reduce((m, a) => Math.max(m, Number(a.value) || 0), 0);
        rows.push({
          platform: "meta", day: r.date_start, campaign_id: r.campaign_id, campaign_name: r.campaign_name,
          adset_id: r.adset_id, adset_name: r.adset_name, ad_id: r.ad_id || "", ad_name: r.ad_name,
          spend: Number(r.spend) || 0, impressions: Number(r.impressions) || 0, clicks: Number(r.clicks) || 0,
          platform_leads: leads, raw: r, synced_at: new Date().toISOString(),
        });
      }
      url = data.paging?.next || null;
    }
    for (let i = 0; i < rows.length; i += 500) {
      await sb("ad_spend_daily?on_conflict=platform,day,ad_id", { method: "POST", prefer: "resolution=merge-duplicates,return=minimal", body: JSON.stringify(rows.slice(i, i + 500)) });
    }
    const spend = rows.reduce((s, r) => s + r.spend, 0);
    await saveState({ ok: true, since, until, rows: rows.length, spend: Math.round(spend * 100) / 100 });
    return { statusCode: 200, body: JSON.stringify({ ok: true, since, until, rows: rows.length, spend }) };
  } catch (e) {
    console.error("meta-ads-sync:", e.message);
    await saveState({ ok: false, since, until, error: e.message });
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: e.message }) };
  }
};
