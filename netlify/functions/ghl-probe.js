// netlify/functions/ghl-probe.js
// One-off connection check for the GoHighLevel (LeadConnector) API: confirms
// GHL_TOKEN / GHL_LOCATION_ID work, which scopes the token has, and what each
// endpoint's records look like, so the real sync is built against real
// shapes. Returns only HTTP status, counts and FIELD NAMES -- never record
// values -- so no customer data leaves GHL through this link.
//
// Visit: /.netlify/functions/ghl-probe

const BASE = "https://services.leadconnectorhq.com";

async function ghl(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method: options.method || "GET",
    body: options.body ? JSON.stringify(options.body) : undefined,
    headers: {
      Authorization: `Bearer ${process.env.GHL_TOKEN}`,
      Version: "2021-07-28",
      Accept: "application/json",
      "Content-Type": "application/json",
    },
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  return { status: res.status, data, raw: data ? null : text.slice(0, 200) };
}

// Field names of a record, one level deep for nested objects.
function shape(obj) {
  if (!obj || typeof obj !== "object") return null;
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (Array.isArray(v)) out[k] = v.length && typeof v[0] === "object" ? { array_of: Object.keys(v[0]) } : "array";
    else if (v && typeof v === "object") out[k] = Object.keys(v);
    else out[k] = v === null ? "null" : typeof v;
  }
  return out;
}

function summarize(r, listKey) {
  const list = r.data && listKey ? r.data[listKey] : null;
  return {
    status: r.status,
    ok: r.status >= 200 && r.status < 300,
    error: r.status >= 300 ? (r.data?.message || r.data?.error || r.raw) : undefined,
    count_returned: Array.isArray(list) ? list.length : undefined,
    total: r.data?.total ?? r.data?.meta?.total ?? r.data?.count,
    meta_keys: r.data?.meta ? Object.keys(r.data.meta) : undefined,
    top_level_keys: r.data ? Object.keys(r.data) : undefined,
    record_fields: Array.isArray(list) && list[0] ? shape(list[0]) : undefined,
  };
}

exports.handler = async () => {
  const missing = ["GHL_TOKEN", "GHL_LOCATION_ID"].filter(k => !process.env[k]);
  if (missing.length) return { statusCode: 500, body: JSON.stringify({ ok: false, error: `Missing env vars: ${missing.join(", ")}` }) };
  const loc = process.env.GHL_LOCATION_ID;
  const now = Date.now();

  const [location, contacts, pipelines, opportunities, calendars, users, conversations] = await Promise.all([
    ghl(`/locations/${loc}`),
    ghl(`/contacts/search`, { method: "POST", body: { locationId: loc, pageLimit: 1 } }),
    ghl(`/opportunities/pipelines?locationId=${loc}`),
    ghl(`/opportunities/search?location_id=${loc}&limit=1`),
    ghl(`/calendars/?locationId=${loc}`),
    ghl(`/users/?locationId=${loc}`),
    ghl(`/conversations/search?locationId=${loc}&limit=1`),
  ]);

  const firstCalendar = calendars.data?.calendars?.[0]?.id;
  const events = firstCalendar
    ? await ghl(`/calendars/events?locationId=${loc}&calendarId=${firstCalendar}&startTime=${now - 90 * 864e5}&endTime=${now + 30 * 864e5}`)
    : { status: 0, data: null, raw: "no calendars" };
  const firstConversation = conversations.data?.conversations?.[0]?.id;
  const messages = firstConversation
    ? await ghl(`/conversations/${firstConversation}/messages?limit=1`)
    : { status: 0, data: null, raw: "no conversations" };

  const report = {
    ok: true,
    checked_at: new Date().toISOString(),
    location: { status: location.status, ok: location.status === 200, name_present: !!location.data?.location?.name, timezone: location.data?.location?.timezone, error: location.status !== 200 ? (location.data?.message || location.raw) : undefined },
    contacts: summarize(contacts, "contacts"),
    pipelines: { ...summarize(pipelines, "pipelines"), stage_counts: (pipelines.data?.pipelines || []).map(p => (p.stages || []).length) },
    opportunities: summarize(opportunities, "opportunities"),
    calendars: summarize(calendars, "calendars"),
    appointments: summarize(events, "events"),
    users: summarize(users, "users"),
    conversations: summarize(conversations, "conversations"),
    messages: { ...summarize(messages, null), message_fields: shape(messages.data?.messages?.messages?.[0] || messages.data?.messages?.[0]) },
  };
  return { statusCode: 200, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }, body: JSON.stringify(report, null, 2) };
};
