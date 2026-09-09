// netlify/functions/lib/gmailClient.js
// Minimal Gmail API client for the tip-sync function. Auth is a Google OAuth
// "Internal" app (Workspace-only, no verification needed, refresh tokens
// don't expire) using the device-authorization flow -- see the setup
// instructions for how GMAIL_CLIENT_ID/SECRET/REFRESH_TOKEN were obtained.
// Read-only scope (gmail.readonly) -- this never modifies or deletes mail;
// "already processed" tracking lives entirely in Supabase (processed_tip_emails),
// not in Gmail read/unread state, so a human checking the inbox can't cause
// a payment to be skipped or reprocessed.

const FETCH_TIMEOUT_MS = 10000;

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// Exchanges the long-lived refresh token for a short-lived access token.
// Internal Workspace apps don't need re-consent -- this refresh token is
// good indefinitely unless someone revokes it in the Google Cloud project.
async function getAccessToken() {
  const res = await fetchWithTimeout("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id:     process.env.GMAIL_CLIENT_ID,
      client_secret: process.env.GMAIL_CLIENT_SECRET,
      refresh_token: process.env.GMAIL_REFRESH_TOKEN,
      grant_type:    "refresh_token",
    }),
  });
  const data = await res.json();
  if (!res.ok || !data.access_token) {
    throw new Error(`Gmail token refresh failed (HTTP ${res.status}): ${JSON.stringify(data)}`);
  }
  return data.access_token;
}

// Lists message ids matching a search query. `sinceEpochSeconds` becomes an
// `after:` filter -- this is a coarse pre-filter only; the real "already
// processed" guard is the processed_tip_emails table, checked per-message
// by the caller, so a slightly-too-wide window here is harmless.
async function listMessageIds(accessToken, sinceEpochSeconds) {
  const q = `from:notifications@housecallpro.com after:${sinceEpochSeconds}`;
  let ids = [];
  let pageToken = null;
  do {
    const url = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages");
    url.searchParams.set("q", q);
    url.searchParams.set("maxResults", "50");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const res = await fetchWithTimeout(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    const data = await res.json();
    if (!res.ok) throw new Error(`Gmail list failed (HTTP ${res.status}): ${JSON.stringify(data)}`);
    ids = ids.concat((data.messages || []).map(m => m.id));
    pageToken = data.nextPageToken || null;
  } while (pageToken);
  return ids;
}

function b64urlDecode(str) {
  return Buffer.from(str.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
}

// Depth-first search through a message's MIME parts for a body. Prefers
// text/plain (much easier to parse reliably than the HTML template), falls
// back to text/html with tags stripped.
function extractBody(payload) {
  let plain = null, html = null;
  function walk(part) {
    if (!part) return;
    const mime = part.mimeType || "";
    if (mime === "text/plain" && part.body?.data && !plain) plain = b64urlDecode(part.body.data);
    if (mime === "text/html" && part.body?.data && !html) html = b64urlDecode(part.body.data);
    for (const child of (part.parts || [])) walk(child);
  }
  walk(payload);
  if (plain) return plain;
  if (html) {
    return html
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, "\n")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/\n{2,}/g, "\n")
      .trim();
  }
  return "";
}

function getHeader(payload, name) {
  const h = (payload.headers || []).find(h => h.name.toLowerCase() === name.toLowerCase());
  return h ? h.value : null;
}

// Fetches one full message and returns { fromEmail, subject, bodyText, internalDate }.
async function getMessage(accessToken, id) {
  const url = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`;
  const res = await fetchWithTimeout(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  const data = await res.json();
  if (!res.ok) throw new Error(`Gmail get failed (HTTP ${res.status}): ${JSON.stringify(data)}`);

  const fromHeader = getHeader(data.payload, "From") || "";
  // "Housecall Pro <notifications@housecallpro.com>" -> "notifications@housecallpro.com"
  const match = fromHeader.match(/<([^>]+)>/);
  const fromEmail = (match ? match[1] : fromHeader).trim().toLowerCase();

  return {
    id,
    fromEmail,
    subject: getHeader(data.payload, "Subject") || "",
    bodyText: extractBody(data.payload),
    internalDate: Number(data.internalDate || 0), // ms since epoch
  };
}

module.exports = { getAccessToken, listMessageIds, getMessage };
