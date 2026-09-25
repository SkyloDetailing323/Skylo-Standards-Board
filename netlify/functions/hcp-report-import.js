// netlify/functions/hcp-report-import.js
// MANUALLY-TRIGGERED import of HCP "jobs export" reports that were emailed to
// team@skylod.com. Saves each report's raw contents into the server-only
// hcp_report_imports table (RLS on, no policies) so they can be read and
// reconciled against tip_entries without downloading each file by hand.
//
// HCP export emails carry the file either as an attachment or as a download
// link in the body -- both are handled. The email body is also saved, so if
// a link can't be fetched (e.g. it needs an HCP login) it's still visible.
//
// Read-only on Gmail (same gmail.readonly credentials as hcp-tip-sync.js).
// Safe to run repeatedly: anything already imported is skipped. The response
// is only a summary -- report contents are never returned over HTTP.
//
// Visit: /.netlify/functions/hcp-report-import?since=2026-09-25T19:45:00Z
//   since  -- only emails received at/after this time (default: 24h ago)

const { getAccessToken } = require('./lib/gmailClient');

const FETCH_TIMEOUT_MS = 10000;
const MAX_MESSAGES = 60;
const MAX_CONTENT_BYTES = 5 * 1024 * 1024; // guard against a runaway download

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function sbFetch(path, options = {}) {
  const res = await fetchWithTimeout(`${process.env.SUPABASE_URL}/rest/v1/${path}`, {
    method: options.method || "GET",
    body: options.body,
    headers: {
      "Content-Type": "application/json",
      "apikey": process.env.SUPABASE_KEY,
      "Authorization": `Bearer ${process.env.SUPABASE_KEY}`,
      "Prefer": options.prefer || "return=representation",
    },
  });
  if (res.status === 204) return null;
  const text = await res.text();
  if (!text) return null;
  const data = JSON.parse(text);
  if (!res.ok || (data && !Array.isArray(data) && (data.code || data.message))) {
    throw new Error(`Supabase error on ${path} (HTTP ${res.status}): ${(data && (data.message || data.code)) || text}`);
  }
  return data;
}

async function gmailGet(accessToken, path) {
  const res = await fetchWithTimeout(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Gmail ${path} failed (HTTP ${res.status}): ${JSON.stringify(data)}`);
  return data;
}

function b64urlToBuffer(str) {
  return Buffer.from(str.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

function header(payload, name) {
  const h = (payload.headers || []).find(h => h.name.toLowerCase() === name.toLowerCase());
  return h ? h.value : null;
}

// Walks the MIME tree, collecting body text/html and attachment parts.
function collectParts(payload) {
  const out = { text: null, html: null, attachments: [] };
  (function walk(part) {
    if (!part) return;
    const mime = part.mimeType || "";
    if (part.filename && part.body && (part.body.attachmentId || part.body.data)) {
      out.attachments.push({ filename: part.filename, mimeType: mime, attachmentId: part.body.attachmentId, data: part.body.data });
    } else if (mime === "text/plain" && part.body?.data && !out.text) {
      out.text = b64urlToBuffer(part.body.data).toString("utf8");
    } else if (mime === "text/html" && part.body?.data && !out.html) {
      out.html = b64urlToBuffer(part.body.data).toString("utf8");
    }
    for (const child of part.parts || []) walk(child);
  })(payload);
  return out;
}

// Links in an export email that look like the file download.
function downloadLinks(html, text) {
  const urls = new Set();
  for (const m of (html || "").matchAll(/href\s*=\s*"([^"]+)"/gi)) urls.add(m[1].replace(/&amp;/g, "&"));
  for (const m of (text || "").matchAll(/https?:\/\/[^\s<>"]+/g)) urls.add(m[0]);
  return [...urls].filter(u => /^https?:/i.test(u) && /(export|download|\.csv|\.xlsx)/i.test(u) && !/unsubscribe/i.test(u));
}

function isTextual(contentType, filename) {
  return /text|csv|json/i.test(contentType || "") || /\.csv$/i.test(filename || "");
}

exports.handler = async (event) => {
  const missingEnv = ["GMAIL_CLIENT_ID", "GMAIL_CLIENT_SECRET", "GMAIL_REFRESH_TOKEN", "SUPABASE_URL", "SUPABASE_KEY"]
    .filter(k => !process.env[k]);
  if (missingEnv.length) {
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: `Missing env vars: ${missingEnv.join(", ")}` }) };
  }

  const qp = event.queryStringParameters || {};
  const sinceMs = qp.since ? Date.parse(qp.since) : Date.now() - 24 * 60 * 60 * 1000;
  if (isNaN(sinceMs)) return { statusCode: 400, body: JSON.stringify({ ok: false, error: "Bad 'since' timestamp" }) };

  const accessToken = await getAccessToken();
  // after: is day-granular, so it's only a pre-filter; internalDate is checked below.
  const q = `from:housecallpro.com export after:${Math.floor(sinceMs / 1000) - 86400}`;
  const list = await gmailGet(accessToken, `messages?q=${encodeURIComponent(q)}&maxResults=${MAX_MESSAGES}`);
  const ids = (list.messages || []).map(m => m.id);

  const existing = ids.length
    ? await sbFetch(`hcp_report_imports?gmail_message_id=in.(${ids.map(i => `"${i}"`).join(",")})&select=gmail_message_id`)
    : [];
  const done = new Set((existing || []).map(r => r.gmail_message_id));

  const summary = [];
  for (const id of ids) {
    if (done.has(id)) { summary.push({ id, skipped: "already imported" }); continue; }
    try {
      const msg = await gmailGet(accessToken, `messages/${id}?format=full`);
      const receivedMs = Number(msg.internalDate || 0);
      if (receivedMs < sinceMs) continue;
      const subject = header(msg.payload, "Subject") || "";
      const received_at = new Date(receivedMs).toISOString();
      const parts = collectParts(msg.payload);
      const rows = [];

      for (const a of parts.attachments) {
        const raw = a.data ? b64urlToBuffer(a.data)
          : b64urlToBuffer((await gmailGet(accessToken, `messages/${id}/attachments/${a.attachmentId}`)).data);
        const textual = isTextual(a.mimeType, a.filename);
        rows.push({ part_key: a.filename, source: "attachment", content_type: a.mimeType,
          content: textual ? raw.toString("utf8") : raw.toString("base64") });
      }

      if (parts.attachments.length === 0) {
        for (const url of downloadLinks(parts.html, parts.text)) {
          try {
            const res = await fetchWithTimeout(url, { redirect: "follow" });
            const ct = res.headers.get("content-type") || "";
            const buf = Buffer.from(await res.arrayBuffer());
            if (!res.ok || buf.length > MAX_CONTENT_BYTES || /text\/html/i.test(ct)) continue; // login page, error, etc.
            rows.push({ part_key: url.slice(0, 500), source: "link", content_type: ct,
              content: isTextual(ct, url) ? buf.toString("utf8") : buf.toString("base64") });
          } catch (err) {
            console.error(`hcp-report-import: link fetch failed for ${id}:`, err.message);
          }
        }
      }

      // Always keep the body too, so a missing file is diagnosable.
      rows.push({ part_key: "(email body)", source: "body", content_type: "text/plain",
        content: (parts.text || (parts.html || "").replace(/<[^>]+>/g, " ")).slice(0, 20000) });

      await sbFetch("hcp_report_imports?on_conflict=gmail_message_id,part_key", {
        method: "POST",
        prefer: "resolution=merge-duplicates,return=minimal",
        body: JSON.stringify(rows.map(r => ({ ...r, gmail_message_id: id, subject, received_at }))),
      });
      summary.push({ id, subject, received_at, files: rows.filter(r => r.source !== "body").map(r => r.part_key.slice(0, 80)) });
    } catch (err) {
      console.error(`hcp-report-import: failed on ${id}:`, err.message);
      summary.push({ id, error: err.message.slice(0, 200) });
    }
  }

  const imported = summary.filter(s => s.files);
  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ok: true,
      emails_found: ids.length,
      imported: imported.length,
      with_files: imported.filter(s => s.files.length > 0).length,
      details: summary,
    }, null, 2),
  };
};
