// netlify/functions/reports.js
// Marketing and sales dashboards for the owners. The numbers come from
// database functions (marketing_report / sales_report) that read the GHL
// mirror and ad spend tables, which the browser can't read directly -- so
// this checks the caller is an owner and runs them with the service key.
//
// GET ?type=marketing&from=YYYY-MM-DD&to=YYYY-MM-DD
// GET ?type=sales&rep=trevor|ethan&from=...&to=...
// GET ?type=sales_deals&rep=trevor
//   Trevor's sales for his points bonus: every HCP job of every customer who
//   has a job tagged "sold by trevor", plus each tagged job's revenue without
//   tips; owner overrides (sales_credit_overrides) and, for owners, the
//   review evidence (sales_credit_review_rows). salesPoints.js does the rest.
// POST ?type=sales_credit  owners: who sold a job, overriding the tag.
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
