// Shared Google Ads helpers: OAuth client settings, the stored refresh
// token, and fresh access tokens.

const SITE = "https://main--skylotechleaderboard.netlify.app";
const REDIRECT_URI = `${SITE}/.netlify/functions/google-ads-auth-callback`;
// One Google sign-in covers Ads (incl. Local Services) and Analytics (website
// visitors). Read-only for Analytics.
const SCOPE = "https://www.googleapis.com/auth/adwords https://www.googleapis.com/auth/analytics.readonly";

// A dedicated web OAuth client can be set; otherwise reuse the Gmail one
// (same Google Cloud project, "Skylo Tip Sync").
const clientId = () => process.env.GOOGLE_ADS_CLIENT_ID || process.env.GMAIL_CLIENT_ID;
const clientSecret = () => process.env.GOOGLE_ADS_CLIENT_SECRET || process.env.GMAIL_CLIENT_SECRET;

async function sb(path, options = {}) {
  const res = await fetch(`${process.env.SUPABASE_URL}/rest/v1/${path}`, {
    method: options.method || "GET",
    body: options.body,
    headers: { "Content-Type": "application/json", apikey: process.env.SUPABASE_KEY, Authorization: `Bearer ${process.env.SUPABASE_KEY}`, Prefer: options.prefer || "return=representation" },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Supabase ${path.split("?")[0]} failed (HTTP ${res.status}): ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

async function getRefreshToken() {
  const rows = await sb("integration_tokens?key=eq.google_ads_refresh_token&select=value,meta,updated_at");
  return rows?.[0] || null;
}

async function saveRefreshToken(value, meta) {
  await sb("integration_tokens?on_conflict=key", { method: "POST", prefer: "resolution=merge-duplicates,return=minimal",
    body: JSON.stringify({ key: "google_ads_refresh_token", value, meta, updated_at: new Date().toISOString() }) });
}

async function accessToken(refreshToken) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId(), client_secret: clientSecret(), refresh_token: refreshToken, grant_type: "refresh_token" }),
  });
  const data = await res.json();
  if (!res.ok || !data.access_token) throw new Error(`Google token refresh failed: ${data.error_description || data.error || res.status}`);
  return data.access_token;
}

module.exports = { SITE, REDIRECT_URI, SCOPE, clientId, clientSecret, sb, getRefreshToken, saveRefreshToken, accessToken };
