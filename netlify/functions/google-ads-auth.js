// netlify/functions/google-ads-auth.js
// Step 1 of "Connect Google Ads": an owner taps the button in the Marketing
// tab, this checks they're an owner and sends them to Google's sign-in to
// allow read access to Google Ads. Google then returns to
// google-ads-auth-callback with a one-time code.
//
// GET ?t=<login token>

const crypto = require("crypto");
const { verifyToken } = require("./lib/authToken");
const { REDIRECT_URI, SCOPE, clientId } = require("./lib/googleAds");

exports.handler = async (event) => {
  const who = verifyToken(event.queryStringParameters?.t);
  if (!who || who.role !== "owner") return { statusCode: 403, body: "Owners only — log in to the app as an owner and tap Connect Google Ads again." };
  if (!clientId()) return { statusCode: 500, body: "No Google OAuth client configured (GOOGLE_ADS_CLIENT_ID or GMAIL_CLIENT_ID)." };

  // Signed, short-lived state so the callback knows this came from an owner.
  const body = Buffer.from(JSON.stringify({ n: crypto.randomBytes(12).toString("hex"), exp: Date.now() + 15 * 60 * 1000, by: who.name || null })).toString("base64url");
  const state = `${body}.${crypto.createHmac("sha256", process.env.AUTH_SECRET).update(body).digest("base64url")}`;

  const url = "https://accounts.google.com/o/oauth2/v2/auth?" + new URLSearchParams({
    client_id: clientId(), redirect_uri: REDIRECT_URI, response_type: "code", scope: SCOPE,
    access_type: "offline", prompt: "consent", include_granted_scopes: "false", state,
  });
  return { statusCode: 302, headers: { Location: url, "Cache-Control": "no-store" }, body: "" };
};
