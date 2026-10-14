// lib/metaAds.js -- shared Meta Marketing API pulls for meta-ads-sync and
// meta-ads-backfill-background.

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
  if (!res.ok) throw new Error(`Supabase ${path.split("?")[0]} failed (HTTP ${res.status}): ${(await res.text()).slice(0, 300)}`);
  return res;
}

function creds() {
  const token = process.env.META_ADS_TOKEN, account = (process.env.META_AD_ACCOUNT_ID || "").replace(/^act_/, "");
  return token && account ? { token, account } : null;
}

async function getAll(url) {
  const out = [];
  while (url) {
    const res = await fetch(url);
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error?.message || `Meta API HTTP ${res.status}`);
    out.push(...(data.data || []));
    url = data.paging?.next || null;
  }
  return out;
}

// Daily per-ad spend, impressions, clicks, leads for since..until -> ad_spend_daily.
async function pullDaily({ token, account }, since, until) {
  const fields = "campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name,spend,impressions,clicks,actions";
  const data = await getAll(`https://graph.facebook.com/${VERSION}/act_${account}/insights?level=ad&time_increment=1&limit=500`
    + `&fields=${fields}&time_range=${encodeURIComponent(JSON.stringify({ since, until }))}&access_token=${encodeURIComponent(token)}`);
  const rows = data.map(r => ({
    platform: "meta", day: r.date_start, campaign_id: r.campaign_id, campaign_name: r.campaign_name,
    adset_id: r.adset_id, adset_name: r.adset_name, ad_id: r.ad_id || "", ad_name: r.ad_name,
    spend: Number(r.spend) || 0, impressions: Number(r.impressions) || 0, clicks: Number(r.clicks) || 0,
    platform_leads: (r.actions || []).filter(a => LEAD_ACTIONS.includes(a.action_type)).reduce((m, a) => Math.max(m, Number(a.value) || 0), 0),
    raw: r, synced_at: new Date().toISOString(),
  }));
  for (let i = 0; i < rows.length; i += 500) {
    await sb("ad_spend_daily?on_conflict=platform,day,ad_id", { method: "POST", prefer: "resolution=merge-duplicates,return=minimal", body: JSON.stringify(rows.slice(i, i + 500)) });
  }
  return rows;
}

// Each ad's start date and status, and how many times the average person
// saw it in the last 28 days (frequency, the main ad-fatigue signal) -> meta_ads.
async function pullAds({ token, account }) {
  const [ads, freq] = await Promise.all([
    getAll(`https://graph.facebook.com/${VERSION}/act_${account}/ads?fields=id,name,campaign_id,created_time,effective_status&limit=500&access_token=${encodeURIComponent(token)}`),
    getAll(`https://graph.facebook.com/${VERSION}/act_${account}/insights?level=ad&date_preset=last_28d&fields=ad_id,reach,frequency&limit=500&access_token=${encodeURIComponent(token)}`),
  ]);
  const f = Object.fromEntries(freq.map(r => [r.ad_id, r]));
  const rows = ads.map(a => ({
    ad_id: a.id, ad_name: a.name, campaign_id: a.campaign_id || null, created_time: a.created_time || null, status: a.effective_status || null,
    reach_28d: f[a.id] ? Number(f[a.id].reach) || 0 : null, frequency_28d: f[a.id] ? Number(f[a.id].frequency) || 0 : null,
    synced_at: new Date().toISOString(),
  }));
  for (let i = 0; i < rows.length; i += 500) {
    await sb("meta_ads?on_conflict=ad_id", { method: "POST", prefer: "resolution=merge-duplicates,return=minimal", body: JSON.stringify(rows.slice(i, i + 500)) });
  }
  return rows.length;
}

async function saveState(key, value) {
  await sb("ghl_sync_state?on_conflict=key", { method: "POST", prefer: "resolution=merge-duplicates,return=minimal", body: JSON.stringify({ key, value, updated_at: new Date().toISOString() }) }).catch(() => {});
}

async function getState(key) {
  const res = await sb(`ghl_sync_state?key=eq.${key}&select=value`);
  const rows = await res.json();
  return rows[0]?.value || null;
}

module.exports = { mountainDay, creds, pullDaily, pullAds, saveState, getState };
