// netlify/functions/reports.js
// Marketing and sales dashboards for the owners. The numbers come from
// database functions (marketing_report / sales_report) that read the GHL
// mirror and ad spend tables, which the browser can't read directly -- so
// this checks the caller is an owner and runs them with the service key.
//
// GET ?type=marketing&from=YYYY-MM-DD&to=YYYY-MM-DD
// GET ?type=sales&rep=trevor|ethan&from=...&to=...
// Header: Authorization: Bearer <login token>

const { verifyToken, tokenFrom } = require("./lib/authToken");

// Which GHL pipelines belong to each rep's report.
const REPS = {
  trevor: { name: "Trevor", pipelines: ["Residential Leads", "Residential Estimates"] },
  ethan:  { name: "Ethan",  pipelines: ["Commercial Sales"] },
};

function json(statusCode, body) {
  return { statusCode, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }, body: JSON.stringify(body) };
}

async function rpc(fn, args) {
  const res = await fetch(`${process.env.SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: process.env.SUPABASE_KEY, Authorization: `Bearer ${process.env.SUPABASE_KEY}` },
    body: JSON.stringify(args),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${fn} failed (HTTP ${res.status}): ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

async function syncState(key) {
  const res = await fetch(`${process.env.SUPABASE_URL}/rest/v1/ghl_sync_state?key=eq.${key}&select=value,updated_at`, {
    headers: { apikey: process.env.SUPABASE_KEY, Authorization: `Bearer ${process.env.SUPABASE_KEY}` },
  });
  const rows = res.ok ? await res.json() : [];
  return rows[0] || null;
}

const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s || "");

exports.handler = async (event) => {
  const who = verifyToken(tokenFrom(event));
  if (!who) return json(401, { error: "Log in again" });
  if (who.role !== "owner") return json(403, { error: "Owners only" });

  const q = event.queryStringParameters || {};
  if (!isDate(q.from) || !isDate(q.to)) return json(400, { error: "from and to dates are required" });

  try {
    if (q.type === "marketing") {
      const [report, ghl, meta, gads, gtoken, adCampaigns] = await Promise.all([
        rpc("marketing_report", { p_from: q.from, p_to: q.to }),
        syncState("last_run"),
        syncState("meta_ads_last_run"),
        syncState("google_ads_last_run"),
        fetch(`${process.env.SUPABASE_URL}/rest/v1/integration_tokens?key=eq.google_ads_refresh_token&select=updated_at`, {
          headers: { apikey: process.env.SUPABASE_KEY, Authorization: `Bearer ${process.env.SUPABASE_KEY}` },
        }).then(r => r.ok ? r.json() : []).then(r => r[0] || null).catch(() => null),
        rpc("ad_campaigns_report", { p_from: q.from, p_to: q.to }).catch(() => ({})),
      ]);
      return json(200, {
        ...report,
        ad_campaigns: adCampaigns || {},
        connections: {
          ghl: { connected: true, last_sync: ghl?.updated_at || null },
          meta: { connected: !!process.env.META_ADS_TOKEN && !!process.env.META_AD_ACCOUNT_ID, last_sync: meta?.updated_at || null, last_result: meta?.value || null },
          google: { connected: !!gtoken, signed_in_at: gtoken?.updated_at || null, last_sync: gads?.updated_at || null, last_result: gads?.value || null },
          lsa: { connected: !!gtoken, last_sync: gads?.updated_at || null, last_result: gads?.value || null },
          ga4: { connected: false },
        },
      });
    }
    if (q.type === "sales") {
      const rep = REPS[q.rep];
      if (!rep) return json(400, { error: "Unknown rep" });
      const report = await rpc("sales_report", { p_rep: rep.name, p_pipelines: rep.pipelines, p_from: q.from, p_to: q.to });
      return json(200, { ...report, pipelines: rep.pipelines });
    }
    return json(400, { error: "Unknown report type" });
  } catch (e) {
    console.error("reports:", e.message);
    return json(500, { error: e.message });
  }
};
