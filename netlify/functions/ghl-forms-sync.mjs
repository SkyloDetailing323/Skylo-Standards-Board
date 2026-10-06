// netlify/functions/ghl-forms-sync.mjs
// Mirrors the two GoHighLevel inspection forms -- Tote Checks and Tech
// Audits -- into ghl_form_submissions so the Audit Scores tab can score them.
// Kept separate from ghl-sync-background.js so it can't slow down or break
// the main GHL sync. Read-only on GHL; writes only ghl_form_submissions and
// one ghl_sync_state row ("forms_last_run").
//
// Started every 15 minutes by ghl-forms-sync-cron.js, or by an owner:
//   /.netlify/functions/ghl-forms-sync?t=<login token>            last few days
//   /.netlify/functions/ghl-forms-sync?t=<login token>&mode=full  everything
//
// Tote check answers are saved under their question label (looked up from
// the location's custom fields); Tech Audits are scored by GHL field id from
// the raw submission. The tech's name is matched to techs.name exactly;
// names that don't match are listed in forms_last_run and on the Audit
// Scores tab.
//
// Uses auditScoring.js (same file the app uses) for form ids and labels.

import auth from "./lib/authToken.js";
import { AUDIT_CONFIG, formKind, techNameOf, workDateOf, auditJobDate, knownAuditFieldIds } from "../../auditScoring.js";

const BASE = "https://services.leadconnectorhq.com";
const TIME_BUDGET_MS = 20 * 1000;
const LOOKBACK_DAYS = 3;
// Submission bookkeeping in `others` that isn't a question answer.
const NOT_ANSWERS = new Set(["eventData", "fieldsOri", "sessionId", "signatureHash", "formId", "location_id", "locationId", "contactId", "submissionId", "__submissions_other_field__", "__custom_field_id__", "ip", "timezone"]);

const sleep = ms => new Promise(r => setTimeout(r, ms));
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

async function ghl(path) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(BASE + path, { headers: { Authorization: `Bearer ${process.env.GHL_TOKEN}`, Version: "2021-07-28", Accept: "application/json" } });
    if (res.status === 429 || res.status >= 500) { await sleep(800 * 2 ** attempt); continue; }
    const text = await res.text();
    let data = null; try { data = text ? JSON.parse(text) : null; } catch {}
    if (!res.ok) { const e = new Error(`GHL ${path.split("?")[0]} -> ${res.status}: ${(data && (data.message || data.error)) || text.slice(0, 200)}`); e.status = res.status; throw e; }
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
async function getState(key) { const r = await sb(`ghl_sync_state?key=eq.${key}&select=value`); return r && r[0] ? r[0].value : null; }
async function setState(key, value) {
  await sb("ghl_sync_state?on_conflict=key", { method: "POST", prefer: "resolution=merge-duplicates,return=minimal", body: JSON.stringify({ key, value, updated_at: new Date().toISOString() }) });
}

// Custom field id / fieldKey -> question label. Needs the token's
// locations/customFields.readonly scope; without it answers are saved under
// their raw keys and the Audit Scores tab says the labels couldn't be read.
async function fieldLabels(loc) {
  const map = {};
  try {
    const { customFields = [] } = await ghl(`/locations/${loc}/customFields`);
    for (const f of customFields) {
      if (!f.name) continue;
      if (f.id) map[f.id] = f.name;
      if (f.fieldKey) { map[f.fieldKey] = f.name; map[f.fieldKey.replace(/^contact\./, "")] = f.name; }
    }
    return { map, source: "custom_fields", count: customFields.length };
  } catch (e) {
    return { map, source: "raw_keys", error: e.message };
  }
}

function answersOf(sub, labels) {
  const others = sub.others || {};
  const map = { ...labels };
  // Some submissions carry their own field list with labels.
  const ori = Array.isArray(others.fieldsOri) ? others.fieldsOri : [];
  for (const f of ori) {
    const label = f && (f.label || f.name || f.placeholder);
    const key = f && (f.id || f.tag || f.fieldKey || f.key);
    if (label && key && !map[key]) map[key] = label;
  }
  const out = {};
  for (const [k, v] of Object.entries(others)) {
    if (NOT_ANSWERS.has(k) || v == null || v === "") continue;
    if (typeof v === "object" && !Array.isArray(v)) continue;
    const label = map[k] || k;
    out[out[label] === undefined ? label : `${label} (${k})`] = v;
  }
  return out;
}

export default async (req) => {
  const started = Date.now();
  const url = new URL(req.url);
  const event = {
    headers: { "x-internal-key": req.headers.get("x-internal-key") || "", authorization: req.headers.get("authorization") || "" },
    queryStringParameters: { t: url.searchParams.get("t") || undefined },
  };
  if (!auth.canRunSync(event)) return json(403, { error: "Owners only" });
  const missing = ["GHL_TOKEN", "GHL_LOCATION_ID", "SUPABASE_URL", "SUPABASE_KEY"].filter(k => !process.env[k]);
  if (missing.length) return json(500, { error: `Missing env vars: ${missing.join(", ")}` });

  const loc = process.env.GHL_LOCATION_ID;
  const full = url.searchParams.get("mode") === "full";
  const result = { started_at: new Date(started).toISOString(), mode: full ? "full" : "incremental", forms: {}, unmatched_techs: [], errors: [] };
  try {
    const techs = await sb("techs?select=id,name");
    const techByName = {};
    (techs || []).forEach(t => { if (t.name) techByName[t.name] = t.id; });
    const labels = await fieldLabels(loc);
    result.labels = { source: labels.source, count: labels.count, error: labels.error };

    const prev = full ? null : await getState("forms_last_run");
    const since = prev && prev.finished_at && !prev.incomplete
      ? new Date(Date.parse(prev.finished_at) - LOOKBACK_DAYS * 864e5).toISOString().slice(0, 10)
      : null;
    const unmatched = new Set();
    // Current GHL label of every Tech Audit question id AUDIT_CONFIG doesn't
    // know, so a renamed question that got a new id shows up by name.
    const knownIds = knownAuditFieldIds();
    const unmappedAuditFields = {};

    for (const form of [AUDIT_CONFIG.tote, AUDIT_CONFIG.audit]) {
      let saved = 0;
      for (let page = 1; page <= 200; page++) {
        if (Date.now() - started > TIME_BUDGET_MS) { result.incomplete = true; break; }
        const q = `/forms/submissions?locationId=${loc}&formId=${form.formId}&limit=100&page=${page}${since ? `&startAt=${since}` : ""}`;
        const data = await ghl(q);
        const list = data.submissions || [];
        if (!list.length) break;
        const rows = list.map(s => {
          const answers = answersOf(s, labels.map);
          const submittedAt = s.createdAt || s.dateAdded || null;
          const techName = techNameOf(form.formId, answers, s.others);
          const techId = techName ? techByName[techName] || null : null;
          if (techName && !techId) unmatched.add(techName);
          if (formKind(form.formId) === "audit")
            for (const id of (s.others && s.others.fieldsOriSequance) || [])
              if (!knownIds.has(id)) unmappedAuditFields[id] = labels.map[id] || null;
          return {
            id: s.id, form_id: s.formId || form.formId, contact_id: s.contactId || null,
            submitted_at: submittedAt,
            // Audits: the Job Date question (by field id). Tote checks: the Date question.
            work_date: formKind(form.formId) === "audit"
              ? auditJobDate(s.others) || workDateOf({}, submittedAt, [])
              : workDateOf(answers, submittedAt, AUDIT_CONFIG.tote.dateLabels),
            tech_name: techName, tech_id: techId, answers, raw: s, synced_at: new Date().toISOString(),
          };
        });
        await sb("ghl_form_submissions?on_conflict=id", { method: "POST", prefer: "resolution=merge-duplicates,return=minimal", body: JSON.stringify(rows) });
        saved += rows.length;
        const meta = data.meta || {};
        if (!meta.nextPage || list.length < 100) break;
      }
      result.forms[formKind(form.formId)] = saved;
    }
    result.unmatched_techs = [...unmatched].sort();
    result.unmapped_audit_fields = unmappedAuditFields;
    if (Object.keys(unmappedAuditFields).length) console.warn("ghl-forms-sync: Tech Audit question ids not in AUDIT_CONFIG:", JSON.stringify(unmappedAuditFields));
    if (unmatched.size) console.warn("ghl-forms-sync: tech names with no exact match in techs:", result.unmatched_techs.join(", "));
  } catch (e) {
    result.errors.push(e.message);
    result.incomplete = true;
    console.error("ghl-forms-sync:", e.message);
  }
  result.finished_at = new Date().toISOString();
  result.seconds = Math.round((Date.now() - started) / 1000);
  await setState("forms_last_run", result).catch(() => {});
  console.log("ghl-forms-sync done:", JSON.stringify(result));
  return json(result.errors.length ? 500 : 200, { ok: !result.errors.length, ...result });
};
