// netlify/functions/auth-login.js
// Server-side PIN check for the app's login screen. PINs never reach the
// browser: owner PINs live only in the OWNER_PINS env var, and tech PINs are
// looked up here with the service key (the techs.pin column isn't readable
// with the public anon key).
//
// POST { pin }  ->  200 { type, role, name, techId, token }
//                   401 wrong PIN, 429 too many wrong tries from this device
//
// OWNER_PINS format: "Truxton:1234,Casey:5678"
// AUTH_SECRET signs the returned token so server functions can trust it later.

const crypto = require("crypto");

const MAX_FAILS = 8;          // wrong PINs allowed per device...
const WINDOW_MINUTES = 15;    // ...in this many minutes

function json(statusCode, body) {
  return { statusCode, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }, body: JSON.stringify(body) };
}

async function sbFetch(path, options = {}) {
  const res = await fetch(`${process.env.SUPABASE_URL}/rest/v1/${path}`, {
    method: options.method || "GET",
    body: options.body,
    headers: {
      "Content-Type": "application/json",
      apikey: process.env.SUPABASE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_KEY}`,
      Prefer: options.prefer || "return=representation",
    },
  });
  if (res.status === 204) return null;
  const text = await res.text();
  if (!res.ok) throw new Error(`Supabase ${path} failed (HTTP ${res.status}): ${text}`);
  return text ? JSON.parse(text) : null;
}

function sameSecret(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function ownerPins() {
  return (process.env.OWNER_PINS || "").split(",").map(s => s.trim()).filter(Boolean).map(entry => {
    const i = entry.lastIndexOf(":");
    return i > 0 ? { name: entry.slice(0, i).trim(), pin: entry.slice(i + 1).trim() } : null;
  }).filter(o => o && /^\d{4}$/.test(o.pin));
}

function signToken(payload) {
  if (!process.env.AUTH_SECRET) return null;
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Date.now() + 12 * 3600 * 1000 })).toString("base64url");
  const sig = crypto.createHmac("sha256", process.env.AUTH_SECRET).update(body).digest("base64url");
  return `${body}.${sig}`;
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "POST only" });
  const missing = ["SUPABASE_URL", "SUPABASE_KEY"].filter(k => !process.env[k]);
  if (missing.length) return json(500, { error: `Missing env vars: ${missing.join(", ")}` });

  let pin = "";
  try { pin = String(JSON.parse(event.body || "{}").pin || ""); } catch {}
  if (!/^\d{4}$/.test(pin)) return json(401, { error: "Wrong PIN" });

  const h = event.headers || {};
  const ip = h["x-nf-client-connection-ip"] || (h["x-forwarded-for"] || "").split(",")[0].trim() || "unknown";
  const since = new Date(Date.now() - WINDOW_MINUTES * 60 * 1000).toISOString();
  const recent = await sbFetch(`auth_attempts?ip=eq.${encodeURIComponent(ip)}&at=gte.${since}&select=id`);
  if ((recent || []).length >= MAX_FAILS) return json(429, { error: "Too many wrong PINs. Try again in 15 minutes." });

  const owner = ownerPins().find(o => sameSecret(o.pin, pin));
  if (owner) {
    return json(200, { type: "admin", role: "owner", name: owner.name, techId: null, token: signToken({ role: "owner", name: owner.name }) });
  }

  const techs = await sbFetch(`techs?pin=eq.${pin}&select=id,name,title,is_active`);
  const tech = (techs || []).find(t => t.is_active !== false);
  if (tech) {
    // The Field Supervisor gets the admin panel in manager mode.
    const manager = tech.title === "field_supervisor";
    return json(200, { type: manager ? "admin" : "tech", role: manager ? "manager" : "tech", name: tech.name, techId: tech.id,
      token: signToken({ role: manager ? "manager" : "tech", techId: tech.id }) });
  }

  await sbFetch("auth_attempts", { method: "POST", prefer: "return=minimal", body: JSON.stringify({ ip }) }).catch(() => {});
  return json(401, { error: "Wrong PIN" });
};
