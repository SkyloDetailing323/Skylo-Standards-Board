// netlify/functions/google-ads-sync.js
// Pulls daily cost, impressions, clicks and conversions per campaign from
// the Google Ads API into ad_spend_daily. Local Services campaigns are saved
// as platform "lsa", everything else as "google". Started every 4 hours by google-ads-sync-cron for the
// last 7 days (Google revises recent numbers); ?days=90 backfills.
//
// Needs: the stored refresh token (Connect Google Ads button),
// GOOGLE_ADS_CUSTOMER_ID (ad account, digits only), GOOGLE_ADS_LOGIN_CUSTOMER_ID
// (manager account, digits only), and GOOGLE_ADS_DEVELOPER_TOKEN if Google
// issued one. Optional GOOGLE_ADS_API_VERSION.

const { sb, getRefreshToken, accessToken } = require("./lib/googleAds");
const { canRunSync } = require("./lib/authToken");

const VERSIONS = process.env.GOOGLE_ADS_API_VERSION ? [process.env.GOOGLE_ADS_API_VERSION] : ["v24", "v23", "v22", "v21"];
const digits = s => String(s || "").replace(/\D/g, "");
const mtDay = (offset = 0) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Denver" }).format(new Date(Date.now() - offset * 864e5));

async function saveState(value) {
  await sb("ghl_sync_state?on_conflict=key", { method: "POST", prefer: "resolution=merge-duplicates,return=minimal",
    body: JSON.stringify({ key: "google_ads_last_run", value, updated_at: new Date().toISOString() }) }).catch(() => {});
}

async function search(version, token, customerId, loginId, query) {
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  if (process.env.GOOGLE_ADS_DEVELOPER_TOKEN) headers["developer-token"] = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
  if (loginId) headers["login-customer-id"] = loginId;
  const rows = [];
  let pageToken;
  do {
    const res = await fetch(`https://googleads.googleapis.com/${version}/customers/${customerId}/googleAds:search`, {
      method: "POST", headers, body: JSON.stringify({ query, ...(pageToken ? { pageToken } : {}) }),
    });
    const text = await res.text();
    if (res.status === 404 && /not found|unsupported|version/i.test(text)) { const e = new Error("version"); e.version = true; throw e; }
    let data; try { data = JSON.parse(text); } catch { data = null; }
    if (!res.ok) {
      const detail = data?.error?.details?.[0]?.errors?.[0]?.message || data?.error?.message || text.slice(0, 300);
      throw new Error(`Google Ads API (${version}) HTTP ${res.status}: ${detail}`);
    }
    rows.push(...(data.results || []));
    pageToken = data.nextPageToken;
  } while (pageToken);
  return rows;
}

const last10 = s => { const d = digits(s); return d.length >= 10 ? d.slice(-10) : null; };

async function syncLsaLeads(version, token, customerId, loginId, since) {
  const query = `SELECT local_services_lead.id, local_services_lead.lead_type, local_services_lead.lead_status,
      local_services_lead.category_id, local_services_lead.service_id, local_services_lead.contact_details,
      local_services_lead.creation_date_time, local_services_lead.lead_charged, local_services_lead.credit_details.credit_state
    FROM local_services_lead WHERE local_services_lead.creation_date_time >= '${since} 00:00:00'`;
  const results = await search(version, token, customerId, loginId, query);
  const rows = results.map(r => {
    const l = r.localServicesLead || {};
    const c = l.contactDetails || {};
    // creation_date_time comes back in the account's time zone (Mountain),
    // "YYYY-MM-DD HH:MM:SS" with no offset.
    const created = l.creationDateTime ? new Date(l.creationDateTime.replace(" ", "T") + "-06:00").toISOString() : null;
    return {
      id: String(l.id), created_at: created, lead_type: l.leadType || null, lead_status: l.leadStatus || null,
      category_id: l.categoryId || null, service_id: l.serviceId || null, charged: !!l.leadCharged,
      credit_state: l.creditDetails?.creditState || null, consumer_name: c.consumerName || null,
      phone_norm: last10(c.phoneNumber), email_norm: c.email ? String(c.email).trim().toLowerCase() : null,
      raw: l, synced_at: new Date().toISOString(),
    };
  }).filter(r => r.id && r.id !== "undefined");
  for (let i = 0; i < rows.length; i += 500) {
    await sb("lsa_leads?on_conflict=id", { method: "POST", prefer: "resolution=merge-duplicates,return=minimal", body: JSON.stringify(rows.slice(i, i + 500)) });
  }
  return { ok: true, leads: rows.length, with_contact: rows.filter(r => r.phone_norm || r.email_norm).length };
}

exports.handler = async (event) => {
  if (!canRunSync(event)) return { statusCode: 403, body: JSON.stringify({ ok: false, error: "Owners only — use Sync now in the Marketing tab." }) };
  const days = Math.min(Math.max(parseInt(event?.queryStringParameters?.days, 10) || 7, 1), 400);
  const since = mtDay(days - 1), until = mtDay(0);
  const customerId = digits(process.env.GOOGLE_ADS_CUSTOMER_ID), loginId = digits(process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID);
  try {
    const stored = await getRefreshToken();
    if (!stored) return { statusCode: 200, body: JSON.stringify({ ok: false, skipped: "Google Ads not connected yet (tap Connect Google Ads)" }) };
    if (!customerId) throw new Error("GOOGLE_ADS_CUSTOMER_ID is not set");
    const token = await accessToken(stored.value);
    const query = `SELECT segments.date, campaign.id, campaign.name, campaign.advertising_channel_type,
      metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions, metrics.conversions_value
      FROM campaign WHERE segments.date BETWEEN '${since}' AND '${until}'`;

    // Try through the manager account first (if set), then direct access --
    // team@skylod.com is also a user on the ad account itself, and a manager
    // that isn't linked yet makes Google refuse the request.
    let results, used, via;
    const routes = loginId && loginId !== customerId ? [loginId, null] : [null];
    let lastErr;
    outer: for (const route of routes) {
      for (const v of VERSIONS) {
        try { results = await search(v, token, customerId, route, query); used = v; via = route ? "manager" : "direct"; break outer; }
        catch (e) { if (e.version) continue; lastErr = e; if (/HTTP 403/.test(e.message)) continue outer; throw e; }
      }
    }
    if (!results && lastErr) throw lastErr;
    if (!results) throw new Error(`No supported Google Ads API version among ${VERSIONS.join(", ")} — set GOOGLE_ADS_API_VERSION`);

    const rows = results.map(r => {
      const lsa = r.campaign?.advertisingChannelType === "LOCAL_SERVICES";
      return {
        platform: lsa ? "lsa" : "google", day: r.segments.date,
        campaign_id: String(r.campaign.id), campaign_name: r.campaign.name,
        adset_id: null, adset_name: null, ad_id: `campaign:${r.campaign.id}`, ad_name: r.campaign.name,
        spend: Number(r.metrics?.costMicros || 0) / 1e6,
        impressions: Number(r.metrics?.impressions || 0), clicks: Number(r.metrics?.clicks || 0),
        platform_leads: Number(r.metrics?.conversions || 0),
        raw: { conversions_value: Number(r.metrics?.conversionsValue || 0), channel: r.campaign?.advertisingChannelType },
        synced_at: new Date().toISOString(),
      };
    });
    for (let i = 0; i < rows.length; i += 500) {
      await sb("ad_spend_daily?on_conflict=platform,day,ad_id", { method: "POST", prefer: "resolution=merge-duplicates,return=minimal", body: JSON.stringify(rows.slice(i, i + 500)) });
    }
    const spend = Math.round(rows.reduce((s, r) => s + r.spend, 0) * 100) / 100;

    // LSA leads (calls/messages/bookings) never pass through GHL, so pull each
    // one's contact details here to match against HCP jobs by phone/email.
    // Best-effort: a failure here is reported but doesn't fail the spend sync.
    let lsa;
    try {
      lsa = await syncLsaLeads(used, token, customerId, via === "manager" ? loginId : null, since);
    } catch (e) {
      console.error("google-ads-sync: LSA leads:", e.message);
      lsa = { ok: false, error: e.message };
    }

    await saveState({ ok: true, version: used, via, since, until, rows: rows.length, spend, lsa });
    return { statusCode: 200, body: JSON.stringify({ ok: true, version: used, via, since, until, rows: rows.length, spend, lsa }) };
  } catch (e) {
    console.error("google-ads-sync:", e.message);
    await saveState({ ok: false, since, until, error: e.message });
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: e.message }) };
  }
};
