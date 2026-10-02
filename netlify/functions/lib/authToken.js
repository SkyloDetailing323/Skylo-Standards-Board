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

module.exports = { verifyToken, tokenFrom };
