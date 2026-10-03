// netlify/functions/google-ads-auth-callback.js
// Step 2 of "Connect Google Ads": Google sends the owner back here with a
// one-time code; we swap it for a refresh token and keep it server-side
// (integration_tokens), then run a first sync.

const crypto = require("crypto");
const { REDIRECT_URI, SITE, clientId, clientSecret, saveRefreshToken } = require("./lib/googleAds");

const page = (title, msg, ok) => ({
  statusCode: ok ? 200 : 400,
  headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  body: `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><body style="font-family:system-ui;padding:32px;max-width:520px;margin:auto;background:#f0f8ff;color:#0d2240"><h2>${ok ? "✅" : "⚠️"} ${title}</h2><p>${msg}</p><p><a href="${SITE}/?growth=1">Back to the app</a></p></body>`,
});

function validState(state) {
  const [body, sig] = String(state || "").split(".");
  if (!body || !sig || !process.env.AUTH_SECRET) return false;
  const expected = crypto.createHmac("sha256", process.env.AUTH_SECRET).update(body).digest("base64url");
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return false;
  try { return JSON.parse(Buffer.from(body, "base64url").toString()).exp > Date.now(); } catch { return false; }
}

exports.handler = async (event) => {
  const q = event.queryStringParameters || {};
  if (q.error) return page("Google sign-in was cancelled", `Google said: ${q.error}. Tap Connect Google Ads to try again.`, false);
  if (!validState(q.state)) return page("Link expired", "That sign-in link expired or didn't come from the app. Tap Connect Google Ads again.", false);

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code: q.code || "", client_id: clientId(), client_secret: clientSecret(), redirect_uri: REDIRECT_URI, grant_type: "authorization_code" }),
  });
  const data = await res.json();
  if (!res.ok || !data.refresh_token) {
    return page("Couldn't finish connecting", `Google returned: ${data.error_description || data.error || "no refresh token"}. Tap Connect Google Ads again.`, false);
  }
  await saveRefreshToken(data.refresh_token, { scope: data.scope, connected_at: new Date().toISOString() });

  return page("Google Ads connected", "Back in the app, open Marketing → Google Ads and tap <b>Sync now</b> to pull your history. After that it refreshes every 4 hours on its own.", true);
};
