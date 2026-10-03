// Verifies the signed login token that auth-login hands out, so server
// functions can tell who is asking. Returns the payload ({ role, name|techId,
// exp }) or null when the token is missing, tampered with, or expired.
const crypto = require("crypto");

function verifyToken(token) {
  if (!token || !process.env.AUTH_SECRET) return null;
  const [body, sig] = String(token).split(".");
  if (!body || !sig) return null;
  const expected = crypto.createHmac("sha256", process.env.AUTH_SECRET).update(body).digest("base64url");
  const a = Buffer.from(sig), b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (!payload.exp || payload.exp < Date.now()) return null;
    return payload;
  } catch { return null; }
}

function tokenFrom(event) {
  const h = event.headers || {};
  const auth = h.authorization || h.Authorization || "";
  return auth.startsWith("Bearer ") ? auth.slice(7) : null;
}

// Key that scheduled wrappers pass to the sync functions they start, so
// those functions can refuse random visitors but accept the timer.
function internalKey() {
  return process.env.AUTH_SECRET ? crypto.createHmac("sha256", process.env.AUTH_SECRET).update("internal-sync").digest("base64url") : null;
}

// Allowed to run a sync: the timer (internal key header) or an owner (?t=token).
function canRunSync(event) {
  const h = event?.headers || {};
  const key = internalKey();
  if (key && (h["x-internal-key"] || h["X-Internal-Key"]) === key) return true;
  const who = verifyToken(event?.queryStringParameters?.t || tokenFrom(event || {}));
  return !!who && who.role === "owner";
}

module.exports = { verifyToken, tokenFrom, internalKey, canRunSync };
