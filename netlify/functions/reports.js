// netlify/functions/reports.js
// Marketing and sales dashboards for the owners. The numbers come from
// database functions (marketing_report / sales_report) that read the GHL
// mirror and ad spend tables, which the browser can't read directly -- so
// this checks the caller is an owner and runs them with the service key.
//
// GET ?type=marketing&from=YYYY-MM-DD&to=YYYY-MM-DD
// GET ?type=search&from=...&to=...   (organic Google search, Search Console)
// GET ?type=sales&rep=trevor|ethan&from=...&to=...
//   A rep with selfTechId can also open their own sales report from their
//   tech login (rep is forced to theirs; nothing else is allowed).
// Header: Authorization: Bearer <login token>

const { verifyToken, tokenFrom } = require("./lib/authToken");

// Which GHL pipelines belong to each rep's report.
const REPS = {
  trevor: { name: "Trevor", pipelines: ["Residential Leads", "Residential Estimates"], selfTechId: "4641f4da-a16f-411b-8688-8b81ac06eda7" },
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

// GET from the REST API, paging past the 1000-row cap.
async function rest(path) {
  const out = [];
  for (let offset = 0; ; offset += 1000) {
    const res = await fetch(`${process.env.SUPABASE_URL}/rest/v1/${path}&limit=1000&offset=${offset}`, {
      headers: { apikey: process.env.SUPABASE_KEY, Authorization: `Bearer ${process.env.SUPABASE_KEY}` },
    });
    if (!res.ok) throw new Error(`${path.split("?")[0]} failed (HTTP ${res.status}): ${(await res.text()).slice(0, 300)}`);
    const rows = await res.json();
    out.push(...rows);
    if (rows.length < 1000) return out;
  }
}

// Searches for the business by name. Everything else is "non-brand": people
// looking for a detailer who didn't already know Skylo.
const BRAND = /skylo|squeegee\s*boy/i;
const shiftDay = (d, n) => { const x = new Date(d + "T12:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };

// Sum Search Console rows by key; position is averaged weighted by impressions.
function rollup(rows, key) {
  const m = {};
  for (const r of rows) {
    const k = key ? r[key] : "all";
    const a = m[k] ||= { [key || "key"]: k, clicks: 0, impressions: 0, pw: 0 };
    a.clicks += r.clicks; a.impressions += r.impressions; a.pw += (Number(r.position) || 0) * r.impressions;
  }
  return Object.values(m).map(({ pw, ...a }) => ({ ...a, position: a.impressions ? Math.round((pw / a.impressions) * 10) / 10 : null }));
}

async function searchReport(from, to) {
  const len = Math.round((new Date(to) - new Date(from)) / 864e5) + 1;
  const pFrom = shiftDay(from, -len), pTo = shiftDay(from, -1);
  const between = (a, b) => `day=gte.${a}&day=lte.${b}`;
  const [daily, prev, queries, pages, status, state, tok] = await Promise.all([
    rest(`gsc_daily?select=day,clicks,impressions,position&${between(from, to)}&order=day`),
    rest(`gsc_daily?select=clicks,impressions,position&${between(pFrom, pTo)}`),
    rest(`gsc_queries_daily?select=query,clicks,impressions,position&${between(from, to)}`),
    rest(`gsc_pages_daily?select=page,clicks,impressions,position&${between(from, to)}`),
    rest("gsc_page_status?select=page,verdict,coverage,last_crawl_at,checked_at&order=page"),
    syncState("gsc_last_run"),
    fetch(`${process.env.SUPABASE_URL}/rest/v1/integration_tokens?key=eq.google_ads_refresh_token&select=meta`, {
      headers: { apikey: process.env.SUPABASE_KEY, Authorization: `Bearer ${process.env.SUPABASE_KEY}` },
    }).then(r => r.ok ? r.json() : []).then(r => r[0] || null).catch(() => null),
  ]);
  const q = rollup(queries, "query").map(x => ({ ...x, brand: BRAND.test(x.query) }));
  const sum = (rows, f) => rows.filter(f).reduce((a, x) => ({ clicks: a.clicks + x.clicks, impressions: a.impressions + x.impressions }), { clicks: 0, impressions: 0 });
  return {
    from, to, prev_from: pFrom, prev_to: pTo,
    totals: rollup(daily)[0] || { clicks: 0, impressions: 0, position: null },
    prev: rollup(prev)[0] || { clicks: 0, impressions: 0, position: null },
    brand: sum(q, x => x.brand), non_brand: sum(q, x => !x.brand),
    daily: daily.map(d => ({ d: d.day, clicks: d.clicks, impressions: d.impressions })),
    queries: q.sort((a, b) => b.impressions - a.impressions).slice(0, 300),
    pages: rollup(pages, "page").sort((a, b) => b.impressions - a.impressions).slice(0, 50),
    page_status: status,
    connection: { google_connected: !!tok, connected: /webmasters/.test(tok?.meta?.scope || ""), last_sync: state?.updated_at || null, last_result: state?.value || null },
  };
}

const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s || "");

exports.handler = async (event) => {
  const who = verifyToken(tokenFrom(event));
  if (!who) return json(401, { error: "Log in again" });
  const q = event.queryStringParameters || {};
  if (who.role !== "owner") {
    const own = who.techId && Object.keys(REPS).find(k => REPS[k].selfTechId === who.techId);
    if (!own || event.httpMethod === "POST" || q.type !== "sales") return json(403, { error: "Owners only" });
    q.rep = own;
  }

  // POST ?type=attribution  body: { plan_minimums:{weekly,biweekly,monthly,bimonthly,quarterly}, gross_margin, target_margin }
  if (event.httpMethod === "POST" && q.type === "attribution") {
    let b; try { b = JSON.parse(event.body || "{}"); } catch { return json(400, { error: "Bad JSON" }); }
    const PLANS = ["weekly", "biweekly", "monthly", "bimonthly", "quarterly"];
    const mins = {};
    for (const k of PLANS) {
      const n = parseInt(b.plan_minimums?.[k], 10);
      if (!(n >= 1 && n <= 52)) return json(400, { error: `${k} minimum must be 1-52 visits` });
      mins[k] = n;
    }
    const pct = v => { const n = Number(v); return n > 0 && n < 1 ? Math.round(n * 1000) / 1000 : null; };
    const value = { plan_minimums: mins, gross_margin: pct(b.gross_margin), target_margin: pct(b.target_margin) };
    if (!value.gross_margin || !value.target_margin) return json(400, { error: "Margins must be between 0% and 100%" });
    const res = await fetch(`${process.env.SUPABASE_URL}/rest/v1/report_settings?on_conflict=key`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: process.env.SUPABASE_KEY, Authorization: `Bearer ${process.env.SUPABASE_KEY}`, Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({ key: "attribution", value, updated_at: new Date().toISOString() }),
    });
    if (!res.ok) return json(500, { error: `Couldn't save (HTTP ${res.status})` });
    return json(200, { ok: true, attribution: value });
  }

  if (!isDate(q.from) || !isDate(q.to)) return json(400, { error: "from and to dates are required" });

  try {
    if (q.type === "marketing") {
      const [report, ghl, meta, gads, gtoken, adCampaigns, ga4] = await Promise.all([
        rpc("marketing_report", { p_from: q.from, p_to: q.to }),
        syncState("last_run"),
        syncState("meta_ads_last_run"),
        syncState("google_ads_last_run"),
        fetch(`${process.env.SUPABASE_URL}/rest/v1/integration_tokens?key=eq.google_ads_refresh_token&select=updated_at,meta`, {
          headers: { apikey: process.env.SUPABASE_KEY, Authorization: `Bearer ${process.env.SUPABASE_KEY}` },
        }).then(r => r.ok ? r.json() : []).then(r => r[0] || null).catch(() => null),
        rpc("ad_campaigns_report", { p_from: q.from, p_to: q.to }).catch(() => ({})),
        syncState("ga4_last_run"),
      ]);
      return json(200, {
        ...report,
        ad_campaigns: adCampaigns || {},
        connections: {
          ghl: { connected: true, last_sync: ghl?.updated_at || null },
          meta: { connected: !!process.env.META_ADS_TOKEN && !!process.env.META_AD_ACCOUNT_ID, last_sync: meta?.updated_at || null, last_result: meta?.value || null },
          google: { connected: !!gtoken, signed_in_at: gtoken?.updated_at || null, last_sync: gads?.updated_at || null, last_result: gads?.value || null },
          lsa: { connected: !!gtoken, last_sync: gads?.updated_at || null, last_result: gads?.value || null },
          ga4: { connected: /analytics/.test(gtoken?.meta?.scope || ""), google_connected: !!gtoken, last_sync: ga4?.updated_at || null, last_result: ga4?.value || null },
        },
      });
    }
    if (q.type === "search") return json(200, await searchReport(q.from, q.to));
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
