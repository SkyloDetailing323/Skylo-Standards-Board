// netlify/functions/reports.js
// Marketing and sales dashboards for the owners. The numbers come from
// database functions (marketing_report / sales_report) that read the GHL
// mirror and ad spend tables, which the browser can't read directly -- so
// this checks the caller is an owner and runs them with the service key.
//
// GET ?type=marketing&from=YYYY-MM-DD&to=YYYY-MM-DD
// GET ?type=search&from=...&to=...   (organic Google search, Search Console)
// GET ?type=sales&rep=trevor|ethan&from=...&to=...
// GET ?type=sales_deals&rep=trevor
//   Trevor's sales for his points bonus: every HCP job of every customer who
//   has a job tagged "sold by trevor", plus each tagged job's revenue without
//   tips; owner overrides (sales_credit_overrides) and, for owners, the
//   review evidence (sales_credit_review_rows). salesPoints.js does the rest.
// POST ?type=sales_credit  owners: who sold a job, overriding the tag.
// GET ?type=ad_trends  owners: Meta ads week by week (adTrends.js).
//   A rep with selfTechId can also open their own sales report from their
//   tech login (rep is forced to theirs; nothing else is allowed).
// Header: Authorization: Bearer <login token>

const { verifyToken, tokenFrom } = require("./lib/authToken");

// Which GHL pipelines belong to each rep's report.
const REPS = {
  trevor: { name: "Trevor", pipelines: ["Residential Leads", "Residential Estimates"], selfTechId: "4641f4da-a16f-411b-8688-8b81ac06eda7", salesTag: "sold by trevor" },
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

// Free jobs from Google: GHL leads whose form visit came from an unpaid
// Google result (GHL's session source "Organic Search") or from the Website
// button on the Maps listing (its link is tagged utm_campaign=gbp), followed
// to HCP jobs the same way as the ad channels (first visit + plan minimums).
// Calls straight from the Maps listing never touch the website, so they
// aren't here.
const mtDay = ts => new Date(ts).toLocaleDateString("en-CA", { timeZone: "America/Denver" });
async function freeJobs(from, to) {
  const opps = await rest(`ghl_opportunities?select=contact_id,created_at,attributions&contact_id=not.is.null&attributions=not.is.null&created_at=gte.${shiftDay(from, -1)}&created_at=lte.${shiftDay(to, 1)}T23:59:59Z`);
  const kindOf = a => {
    const t = JSON.stringify(a || []);
    if (/utm_campaign=gbp/i.test(t)) return "maps";
    if ((a || []).some(x => x?.utmSessionSource === "Organic Search")) return "organic";
    return null;
  };
  const leads = {};
  for (const o of opps) {
    const kind = kindOf(o.attributions), day = mtDay(o.created_at);
    if (!kind || day < from || day > to) continue;
    const l = leads[o.contact_id] ||= { kind, since: o.created_at };
    if (kind === "maps") l.kind = "maps";
    if (o.created_at < l.since) l.since = o.created_at;
  }
  const out = { organic: { leads: 0, booked: 0, upfront: 0, committed: 0 }, maps: { leads: 0, booked: 0, upfront: 0, committed: 0 } };
  const ids = Object.keys(leads);
  for (const id of ids) out[leads[id].kind].leads++;
  if (!ids.length) return out;
  const matches = await restIn("lead_job_matches?select=contact_id,hcp_job_id", "contact_id", ids);
  if (!matches.length) return out;
  const jobs = await rpc("credited_jobs", { p: matches.map(m => ({ k: m.contact_id, since: leads[m.contact_id].since, job: m.hcp_job_id })) });
  const booked = new Set();
  for (const j of jobs || []) {
    const o = out[leads[j.k]?.kind];
    if (!o || (j.part !== "first" && j.part !== "plan")) continue;
    const v = Number(j.value) || 0;
    o.committed += v;
    if (j.part === "first") { o.upfront += v; if (!booked.has(j.k)) { booked.add(j.k); o.booked++; } }
  }
  for (const o of Object.values(out)) { o.upfront = Math.round(o.upfront); o.committed = Math.round(o.committed); }
  return out;
}

async function searchReport(from, to) {
  const len = Math.round((new Date(to) - new Date(from)) / 864e5) + 1;
  const pFrom = shiftDay(from, -len), pTo = shiftDay(from, -1);
  const between = (a, b) => `day=gte.${a}&day=lte.${b}`;
  const [daily, prev, queries, pages, prevQueries, prevPages, status, state, tok, free] = await Promise.all([
    rest(`gsc_daily?select=day,clicks,impressions,position&${between(from, to)}&order=day`),
    rest(`gsc_daily?select=clicks,impressions,position&${between(pFrom, pTo)}`),
    rest(`gsc_queries_daily?select=query,clicks,impressions,position&${between(from, to)}`),
    rest(`gsc_pages_daily?select=page,clicks,impressions,position&${between(from, to)}`),
    rest(`gsc_queries_daily?select=query,clicks,impressions&${between(pFrom, pTo)}`),
    rest(`gsc_pages_daily?select=page,clicks,impressions&${between(pFrom, pTo)}`),
    rest("gsc_page_status?select=page,verdict,coverage,last_crawl_at,checked_at&order=page"),
    syncState("gsc_last_run"),
    fetch(`${process.env.SUPABASE_URL}/rest/v1/integration_tokens?key=eq.google_ads_refresh_token&select=meta`, {
      headers: { apikey: process.env.SUPABASE_KEY, Authorization: `Bearer ${process.env.SUPABASE_KEY}` },
    }).then(r => r.ok ? r.json() : []).then(r => r[0] || null).catch(() => null),
    freeJobs(from, to).catch(e => ({ error: e.message })),
  ]);
  const q = rollup(queries, "query").map(x => ({ ...x, brand: BRAND.test(x.query) }));
  const sum = (rows, f) => rows.filter(f).reduce((a, x) => ({ clicks: a.clicks + x.clicks, impressions: a.impressions + x.impressions }), { clicks: 0, impressions: 0 });
  return {
    from, to, prev_from: pFrom, prev_to: pTo,
    totals: rollup(daily)[0] || { clicks: 0, impressions: 0, position: null },
    prev: rollup(prev)[0] || { clicks: 0, impressions: 0, position: null },
    brand: sum(q, x => x.brand), non_brand: sum(q, x => !x.brand),
    prev_non_brand: sum(prevQueries, x => !BRAND.test(x.query)),
    // The website button on the Google Business Profile (Maps listing) links
    // with utm_campaign=gbp, so its clicks show up as that page.
    prev_maps: sum(prevPages, x => /utm_campaign=gbp/i.test(x.page)),
    daily: daily.map(d => ({ d: d.day, clicks: d.clicks, impressions: d.impressions })),
    queries: q.sort((a, b) => b.impressions - a.impressions).slice(0, 300),
    pages: rollup(pages, "page").sort((a, b) => b.impressions - a.impressions).slice(0, 50),
    // Tracking links (?utm_...) aren't real pages, so Google never indexes them.
    page_status: status.filter(p => !p.page.includes("?")),
    free_jobs: free,
    connection: { google_connected: !!tok, connected: /webmasters/.test(tok?.meta?.scope || ""), last_sync: state?.updated_at || null, last_result: state?.value || null },
  };
}

const inList = ids => `in.(${ids.map(x => `"${String(x).replace(/"/g, "")}"`).join(",")})`;
async function restIn(path, col, ids) {
  const out = [];
  for (let i = 0; i < ids.length; i += 150) out.push(...await rest(`${path}&${col}=${inList(ids.slice(i, i + 150))}`));
  return out;
}

// Jobs for the points bonus. Who sold it comes from the HCP job tag ("sold
// by trevor") -- Trevor and Ethan both book, so the GHL pipelines can't tell
// them apart. Only a booking's first visit carries tags, so the tagged jobs
// are the sales; the customers' other jobs show the plan's later visits
// (frequency and the chargeback window).
async function salesJobs(repKey, rep) {
  const cols = "hcp_job_id,hcp_customer_id,first_name,last_name,work_status,scheduled_start,completed_at,job_created_at,total_cents,tip_cents,raw";
  const [tagged, overrides, evidence] = await Promise.all([
    rest(`hcp_sales_jobs?select=${cols}&raw->>tags=ilike.*${encodeURIComponent(rep.salesTag)}*`),
    rest("sales_credit_overrides?select=hcp_job_id,rep,set_by,set_at"),
    // Last ~100 days is plenty to review (and stays under the 1,000-row cap).
    rpc("sales_credit_review_rows", { p_from: new Date(Date.now() - 100 * 864e5).toISOString() }),
  ]);
  // Jobs an owner credited to this rep without the tag.
  const extraIds = overrides.filter(o => o.rep === repKey).map(o => o.hcp_job_id).filter(id => !tagged.some(j => j.hcp_job_id === id));
  const extra = extraIds.length ? await restIn(`hcp_sales_jobs?select=${cols}`, "hcp_job_id", extraIds) : [];
  const sales = [...tagged, ...extra];
  const customers = [...new Set(sales.map(j => j.hcp_customer_id).filter(Boolean))];
  const others = customers.length ? await restIn(`hcp_sales_jobs?select=${cols}`, "hcp_customer_id", customers) : [];
  const all = {};
  for (const j of [...sales, ...others]) all[j.hcp_job_id] = j;
  const jobs = Object.values(all).map(({ raw, ...j }) => ({ ...j, tags: raw?.tags || [] }));
  const revRows = sales.length ? await restIn("jobs?select=hcp_job_id,revenue", "hcp_job_id", sales.map(j => j.hcp_job_id)) : [];
  const revenue = {};
  for (const r of revRows) revenue[r.hcp_job_id] = (revenue[r.hcp_job_id] || 0) + (Number(r.revenue) || 0);
  return { jobs, revenue, overrides, evidence: evidence || [] };
}

const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s || "");

exports.handler = async (event) => {
  const who = verifyToken(tokenFrom(event));
  if (!who) return json(401, { error: "Log in again" });
  const q = event.queryStringParameters || {};
  if (who.role !== "owner") {
    const own = who.techId && Object.keys(REPS).find(k => REPS[k].selfTechId === who.techId);
    if (!own || event.httpMethod === "POST" || (q.type !== "sales" && q.type !== "sales_deals")) return json(403, { error: "Owners only" });
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

  // POST ?type=sales_credit  body: { hcp_job_id, rep: "trevor"|"ethan"|"none"|null }
  // An owner's call on who sold a job; wins over the HCP "sold by" tag.
  // rep null clears it (back to the tag).
  if (event.httpMethod === "POST" && q.type === "sales_credit") {
    let b; try { b = JSON.parse(event.body || "{}"); } catch { return json(400, { error: "Bad JSON" }); }
    const id = String(b.hcp_job_id || "");
    if (!/^job_[A-Za-z0-9]+$/.test(id)) return json(400, { error: "Bad job id" });
    const H = { "Content-Type": "application/json", apikey: process.env.SUPABASE_KEY, Authorization: `Bearer ${process.env.SUPABASE_KEY}` };
    const url = `${process.env.SUPABASE_URL}/rest/v1/sales_credit_overrides`;
    const res = b.rep == null
      ? await fetch(`${url}?hcp_job_id=eq.${id}`, { method: "DELETE", headers: { ...H, Prefer: "return=minimal" } })
      : ["trevor", "ethan", "none"].includes(b.rep)
        ? await fetch(`${url}?on_conflict=hcp_job_id`, { method: "POST", headers: { ...H, Prefer: "resolution=merge-duplicates,return=minimal" },
            body: JSON.stringify({ hcp_job_id: id, rep: b.rep, set_by: who.name || who.role, set_at: new Date().toISOString() }) })
        : null;
    if (!res) return json(400, { error: "rep must be trevor, ethan, none or null" });
    if (!res.ok) return json(500, { error: `Couldn't save (HTTP ${res.status})` });
    return json(200, { ok: true });
  }

  // GET ?type=ad_trends -- every Meta ad week by week (spend, views, clicks,
  // leads, bookings, revenue) plus each ad's start date, status and 28-day
  // frequency. adTrends.js grades it and spots slides in the browser.
  if (q.type === "ad_trends") {
    try {
      const since = new Date(Date.now() - 400 * 864e5).toISOString().slice(0, 10);
      const [rows, ads] = await Promise.all([
        rest(`rpc/ad_trends?p_since=${since}`),
        rest("meta_ads?select=ad_id,ad_name,campaign_id,created_time,status,reach_28d,frequency_28d"),
      ]);
      return json(200, { rows, ads });
    } catch (e) {
      console.error("reports ad_trends:", e.message);
      return json(500, { error: e.message });
    }
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
    if (q.type === "sales_deals") {
      if (!REPS[q.rep]?.salesTag) return json(400, { error: "No points bonus for this rep" });
      const data = await salesJobs(q.rep, REPS[q.rep]);
      // The review list (evidence + overrides) is for owners only.
      if (who.role !== "owner") { delete data.evidence; }
      return json(200, { rep: q.rep, tag: REPS[q.rep].salesTag, ...data });
    }
    return json(400, { error: "Unknown report type" });
  } catch (e) {
    console.error("reports:", e.message);
    return json(500, { error: e.message });
  }
};
