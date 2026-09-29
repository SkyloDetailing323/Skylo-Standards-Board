// netlify/functions/ghl-sync-background.js
// Mirrors GoHighLevel into Supabase (the ghl_* tables) so reports can join
// leads, pipeline, appointments and conversations with HCP jobs.
//
// Background function (up to 15 min). Kicked off every 15 minutes by
// ghl-sync-cron.js, or by hand:
//   /.netlify/functions/ghl-sync-background            incremental run
//   /.netlify/functions/ghl-sync-background?mode=full  also re-walks all
//                                                      conversations and 2+
//                                                      years of appointments
// Each run: pipelines, users, calendars, opportunities and contacts are pulled
// in full (they're small enough); conversations since the last run; then
// message history for any conversation with new messages, until the time
// budget runs out -- the next run picks up where this one stopped.
// Read-only on GHL. Writes only ghl_* tables. A lock stops overlapping runs.

const BASE = "https://services.leadconnectorhq.com";
const TIME_BUDGET_MS = 13.5 * 60 * 1000;
const MIN_GAP_MS = 120;            // ~8 GHL requests/second, under their 100 per 10s limit
const LOCK_STALE_MS = 16 * 60 * 1000;

const sleep = ms => new Promise(r => setTimeout(r, ms));
let lastCall = 0, apiCalls = 0, startedAt = 0;
const timeLeft = () => TIME_BUDGET_MS - (Date.now() - startedAt);
class OutOfTime extends Error {}
const checkTime = () => { if (timeLeft() < 20000) throw new OutOfTime("time budget used"); };

async function ghl(path, { method = "GET", body } = {}) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const wait = lastCall + MIN_GAP_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastCall = Date.now(); apiCalls++;
    const res = await fetch(BASE + path, {
      method, body: body ? JSON.stringify(body) : undefined,
      headers: { Authorization: `Bearer ${process.env.GHL_TOKEN}`, Version: "2021-07-28", Accept: "application/json", "Content-Type": "application/json" },
    });
    if (res.status === 429 || res.status >= 500) { await sleep(1000 * 2 ** attempt); continue; }
    const text = await res.text();
    let data = null; try { data = text ? JSON.parse(text) : null; } catch {}
    if (!res.ok) {
      const err = new Error(`GHL ${method} ${path.split("?")[0]} -> ${res.status}: ${(data && (data.message || data.error)) || text.slice(0, 200)}`);
      err.status = res.status; throw err;
    }
    return data || {};
  }
  throw new Error(`GHL ${path.split("?")[0]} kept failing (rate limit / server errors)`);
}

async function sb(path, options = {}) {
  const res = await fetch(`${process.env.SUPABASE_URL}/rest/v1/${path}`, {
    method: options.method || "GET", body: options.body,
    headers: { "Content-Type": "application/json", apikey: process.env.SUPABASE_KEY, Authorization: `Bearer ${process.env.SUPABASE_KEY}`, Prefer: options.prefer || "return=representation" },
  });
  if (res.status === 204) return null;
  const text = await res.text();
  if (!res.ok) throw new Error(`Supabase ${path.split("?")[0]} (HTTP ${res.status}): ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}
async function upsert(table, rows) {
  for (let i = 0; i < rows.length; i += 500) {
    await sb(`${table}?on_conflict=id`, { method: "POST", prefer: "resolution=merge-duplicates,return=minimal", body: JSON.stringify(rows.slice(i, i + 500)) });
  }
}
async function getState(key) { const r = await sb(`ghl_sync_state?key=eq.${key}&select=value`); return r && r[0] ? r[0].value : null; }
async function setState(key, value) {
  await sb("ghl_sync_state?on_conflict=key", { method: "POST", prefer: "resolution=merge-duplicates,return=minimal", body: JSON.stringify({ key, value, updated_at: new Date().toISOString() }) });
}

// ─── normalizers ────────────────────────────────────────────────────────────
const ts = v => { if (v === null || v === undefined || v === "") return null; const d = new Date(typeof v === "string" && /^\d+$/.test(v) ? Number(v) : v); return isNaN(d) ? null : d.toISOString(); };
const phoneNorm = p => { const d = String(p || "").replace(/\D/g, ""); return d.length >= 10 ? d.slice(-10) : null; };
const emailNorm = e => (e ? String(e).trim().toLowerCase() || null : null);

function mapContact(c, seen) {
  return {
    id: c.id, first_name: c.firstName || null, last_name: c.lastName || null,
    name: c.contactName || [c.firstName, c.lastName].filter(Boolean).join(" ") || null,
    email: c.email || null, phone: c.phone || null, email_norm: emailNorm(c.email), phone_norm: phoneNorm(c.phone),
    additional_emails: c.additionalEmails || null, additional_phones: c.additionalPhones || null,
    source: c.source || null, type: c.type || null, tags: Array.isArray(c.tags) ? c.tags : [],
    attribution_source: c.attributionSource || null, last_attribution_source: c.lastAttributionSource || null,
    custom_fields: c.customFields || null, assigned_to: c.assignedTo || null, dnd: c.dnd ?? null,
    address: c.address || null, city: c.city || null, state: c.state || null, postal_code: c.postalCode || null, country: c.country || null,
    business_name: c.businessName || null, company_name: c.companyName || null,
    date_added: ts(c.dateAdded), date_updated: ts(c.dateUpdated),
    raw: c, last_seen_at: seen, synced_at: new Date().toISOString(),
  };
}
function mapOpportunity(o, seen) {
  return {
    id: o.id, name: o.name || null, monetary_value: o.monetaryValue ?? null,
    pipeline_id: o.pipelineId || null, stage_id: o.pipelineStageId || null, status: o.status || null, source: o.source || null,
    assigned_to: o.assignedTo || null, contact_id: o.contactId || o.contact?.id || null, lost_reason_id: o.lostReasonId || null,
    created_at: ts(o.createdAt), updated_at: ts(o.updatedAt),
    last_status_change_at: ts(o.lastStatusChangeAt), last_stage_change_at: ts(o.lastStageChangeAt),
    attributions: o.attributions || null, custom_fields: o.customFields || null,
    raw: o, last_seen_at: seen, synced_at: new Date().toISOString(),
  };
}

// ─── steps ──────────────────────────────────────────────────────────────────
async function syncPipelines(loc, seen) {
  const { pipelines = [] } = await ghl(`/opportunities/pipelines?locationId=${loc}`);
  await upsert("ghl_pipelines", pipelines.map(p => ({ id: p.id, name: p.name || null, position: p.position != null ? String(p.position) : null, raw: p, last_seen_at: seen, synced_at: new Date().toISOString() })));
  await upsert("ghl_pipeline_stages", pipelines.flatMap(p => (p.stages || []).map(s => ({ id: s.id, pipeline_id: p.id, name: s.name || null, position: s.position ?? null, win_probability: s.stageWinProbability ?? null, last_seen_at: seen }))));
  return pipelines.length;
}
async function syncUsers(loc, seen) {
  const { users = [] } = await ghl(`/users/?locationId=${loc}`);
  await upsert("ghl_users", users.map(u => ({ id: u.id, name: u.name || [u.firstName, u.lastName].filter(Boolean).join(" ") || null, email: u.email || null, phone: u.phone || null, deleted: !!u.deleted, roles: u.roles || null, raw: u, last_seen_at: seen, synced_at: new Date().toISOString() })));
  return users.length;
}
async function syncCalendars(loc, seen) {
  const { calendars = [] } = await ghl(`/calendars/?locationId=${loc}`);
  await upsert("ghl_calendars", calendars.map(c => ({ id: c.id, name: c.name || null, calendar_type: c.calendarType || null, is_active: c.isActive ?? null, raw: c, last_seen_at: seen, synced_at: new Date().toISOString() })));
  return calendars;
}
async function syncOpportunities(loc, seen) {
  const existing = {};
  for (let from = 0; ; from += 1000) {
    const page = await sb(`ghl_opportunities?select=id,stage_id,status,monetary_value&order=id&offset=${from}&limit=1000`);
    (page || []).forEach(r => { existing[r.id] = r; });
    if (!page || page.length < 1000) break;
  }
  let n = 0, startAfter = null, startAfterId = null;
  const history = [];
  for (;;) {
    checkTime();
    const q = `/opportunities/search?location_id=${loc}&limit=100${startAfter ? `&startAfter=${startAfter}&startAfterId=${startAfterId}` : ""}`;
    const data = await ghl(q);
    const list = data.opportunities || [];
    if (!list.length) break;
    const rows = list.map(o => mapOpportunity(o, seen));
    for (const r of rows) {
      const old = existing[r.id];
      if (!old || old.stage_id !== r.stage_id || old.status !== r.status || Number(old.monetary_value) !== Number(r.monetary_value)) {
        history.push({ opportunity_id: r.id, pipeline_id: r.pipeline_id, stage_id: r.stage_id, status: r.status, monetary_value: r.monetary_value,
          changed_at: old ? (r.last_stage_change_at || r.last_status_change_at || r.updated_at) : r.created_at });
      }
    }
    await upsert("ghl_opportunities", rows);
    n += list.length;
    const meta = data.meta || {};
    if (!meta.startAfterId || meta.startAfterId === startAfterId || list.length < 100) break;
    startAfter = meta.startAfter; startAfterId = meta.startAfterId;
  }
  for (let i = 0; i < history.length; i += 500) {
    await sb("ghl_opportunity_history", { method: "POST", prefer: "return=minimal", body: JSON.stringify(history.slice(i, i + 500)) });
  }
  return { count: n, changes: history.length };
}
async function syncContacts(loc, seen) {
  let n = 0, searchAfter = null, pageLimit = 500;
  for (;;) {
    checkTime();
    let data;
    try {
      data = await ghl("/contacts/search", { method: "POST", body: { locationId: loc, pageLimit, ...(searchAfter ? { searchAfter } : {}) } });
    } catch (e) {
      if (pageLimit > 100 && (e.status === 400 || e.status === 422)) { pageLimit = 100; continue; }
      throw e;
    }
    const list = data.contacts || [];
    if (!list.length) break;
    await upsert("ghl_contacts", list.map(c => mapContact(c, seen)));
    n += list.length;
    const next = list[list.length - 1].searchAfter;
    if (!next || list.length < pageLimit || JSON.stringify(next) === JSON.stringify(searchAfter)) break;
    searchAfter = next;
  }
  return n;
}
async function syncConversations(loc, seen, full) {
  const cursor = full ? null : await getState("conversations_cursor");   // newest lastMessageDate already seen (ms)
  let n = 0, startAfterDate = null, newest = cursor || 0;
  for (;;) {
    checkTime();
    const data = await ghl(`/conversations/search?locationId=${loc}&limit=100&sortBy=last_message_date&sort=desc${startAfterDate ? `&startAfterDate=${startAfterDate}` : ""}`);
    const list = data.conversations || [];
    if (!list.length) break;
    const fresh = cursor ? list.filter(c => (c.lastMessageDate || 0) > cursor) : list;
    await upsert("ghl_conversations", fresh.map(c => ({
      id: c.id, contact_id: c.contactId || null, type: c.type || null,
      last_message_date: ts(c.lastMessageDate), last_message_direction: c.lastMessageDirection || null, last_message_type: c.lastMessageType || null,
      unread_count: c.unreadCount ?? null, date_added: ts(c.dateAdded), date_updated: ts(c.dateUpdated),
      raw: c, last_seen_at: seen, synced_at: new Date().toISOString(),
    })));
    n += fresh.length;
    for (const c of list) newest = Math.max(newest, c.lastMessageDate || 0);
    if (fresh.length < list.length) break;                               // reached conversations we already have
    const last = list[list.length - 1];
    const next = (Array.isArray(last.sort) && last.sort[0]) || last.lastMessageDate;
    if (!next || next === startAfterDate || list.length < 100) break;
    startAfterDate = next;
  }
  if (newest) await setState("conversations_cursor", newest);
  return n;
}
async function syncAppointments(loc, calendars, seen, full) {
  const now = Date.now(), DAY = 864e5;
  const from = full ? Date.UTC(2024, 0, 1) : now - 60 * DAY, to = now + 180 * DAY;
  let n = 0;
  for (const cal of calendars) {
    for (let start = from; start < to; start += 31 * DAY) {
      checkTime();
      const end = Math.min(start + 31 * DAY, to);
      const { events = [] } = await ghl(`/calendars/events?locationId=${loc}&calendarId=${cal.id}&startTime=${start}&endTime=${end}`);
      if (!events.length) continue;
      await upsert("ghl_appointments", events.map(e => ({
        id: e.id, calendar_id: e.calendarId || cal.id, contact_id: e.contactId || null, title: e.title || null,
        status: e.appointmentStatus || e.status || null, assigned_user_id: e.assignedUserId || null,
        start_time: ts(e.startTime), end_time: ts(e.endTime), date_added: ts(e.dateAdded), date_updated: ts(e.dateUpdated),
        raw: e, last_seen_at: seen, synced_at: new Date().toISOString(),
      })));
      n += events.length;
    }
  }
  return n;
}
// Message history for conversations with messages we haven't pulled yet,
// newest first, until the time budget runs out.
async function syncMessages() {
  let conversations = 0, messages = 0;
  for (;;) {
    checkTime();
    const todo = await sb("ghl_conversations?select=id,contact_id,last_message_date,messages_synced_through&needs_messages=is.true&order=last_message_date.desc&limit=50");
    if (!todo || !todo.length) break;
    for (const c of todo) {
      checkTime();
      let lastMessageId = null, error = null;
      const since = c.messages_synced_through ? Date.parse(c.messages_synced_through) : 0;
      try {
      for (let page = 0; page < 50; page++) {
        const data = await ghl(`/conversations/${c.id}/messages?limit=100${lastMessageId ? `&lastMessageId=${lastMessageId}` : ""}`);
        const box = data.messages || {};
        const list = Array.isArray(box) ? box : (box.messages || []);
        if (!list.length) break;
        await upsert("ghl_messages", list.map(m => ({
          id: m.id, conversation_id: m.conversationId || c.id, contact_id: m.contactId || c.contact_id || null,
          direction: m.direction || null, message_type: m.messageType || null, type: typeof m.type === "number" ? m.type : null,
          status: m.status || null, source: m.source || null, user_id: m.userId || null,
          body: m.body || null, content_type: m.contentType || null,
          date_added: ts(m.dateAdded), date_updated: ts(m.dateUpdated), raw: m, synced_at: new Date().toISOString(),
        })));
        messages += list.length;
        const oldest = Math.min(...list.map(m => Date.parse(m.dateAdded) || Infinity));
        if (!box.nextPage || !box.lastMessageId || (since && oldest <= since)) break;
        lastMessageId = box.lastMessageId;
      }
      } catch (e) {
        if (e instanceof OutOfTime) throw e;
        error = e.message.slice(0, 300);   // e.g. a channel GHL won't return messages for -- skip it, don't loop on it
      }
      await sb(`ghl_conversations?id=eq.${encodeURIComponent(c.id)}`, { method: "PATCH", prefer: "return=minimal", body: JSON.stringify({ messages_synced_through: c.last_message_date, messages_error: error }) });
      conversations++;
    }
  }
  return { conversations, messages };
}

exports.handler = async (event) => {
  startedAt = Date.now(); apiCalls = 0;
  const missing = ["GHL_TOKEN", "GHL_LOCATION_ID", "SUPABASE_URL", "SUPABASE_KEY"].filter(k => !process.env[k]);
  if (missing.length) { console.error("ghl-sync: missing env", missing); return; }
  const loc = process.env.GHL_LOCATION_ID;
  const full = (event.queryStringParameters || {}).mode === "full";

  const lock = await getState("lock");
  if (lock && lock.running && Date.now() - Date.parse(lock.started_at) < LOCK_STALE_MS) { console.log("ghl-sync: already running, skipping"); return; }
  const seen = new Date().toISOString();
  await setState("lock", { running: true, started_at: seen, mode: full ? "full" : "incremental" });

  const result = { started_at: seen, mode: full ? "full" : "incremental", steps: {}, errors: [] };
  const step = async (name, fn) => {
    try { result.steps[name] = await fn(); }
    catch (e) {
      if (e instanceof OutOfTime) { result.steps[name] = "stopped: out of time (continues next run)"; throw e; }
      result.errors.push(`${name}: ${e.message}`); console.error(`ghl-sync ${name}:`, e.message);
    }
  };
  try {
    await step("pipelines", () => syncPipelines(loc, seen));
    await step("users", () => syncUsers(loc, seen));
    let calendars = [];
    await step("calendars", async () => { calendars = await syncCalendars(loc, seen); return calendars.length; });
    await step("opportunities", () => syncOpportunities(loc, seen));
    await step("contacts", () => syncContacts(loc, seen));
    await step("conversations", () => syncConversations(loc, seen, full));
    await step("appointments", () => syncAppointments(loc, calendars, seen, full));
    await step("messages", () => syncMessages());
  } catch (e) {
    if (!(e instanceof OutOfTime)) result.errors.push(e.message);
  } finally {
    result.finished_at = new Date().toISOString();
    result.api_calls = apiCalls;
    result.seconds = Math.round((Date.now() - startedAt) / 1000);
    await setState("last_run", result).catch(() => {});
    await setState("lock", { running: false, finished_at: result.finished_at }).catch(() => {});
    console.log("ghl-sync done:", JSON.stringify(result));
  }
};
