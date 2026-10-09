// netlify/functions/reports.js
// Marketing and sales dashboards for the owners. The numbers come from
// database functions (marketing_report / sales_report) that read the GHL
// mirror and ad spend tables, which the browser can't read directly -- so
// this checks the caller is an owner and runs them with the service key.
//
// GET ?type=marketing&from=YYYY-MM-DD&to=YYYY-MM-DD
// GET ?type=sales&rep=trevor|ethan&from=...&to=...
// GET ?type=sales_deals&rep=trevor&from=...&to=...
//   Trevor's closed clients for his points bonus (salesPoints.js does the math).
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
const inList = ids => `in.(${ids.map(x => `"${String(x).replace(/"/g, "")}"`).join(",")})`;
async function restIn(path, col, ids) {
  const out = [];
  for (let i = 0; i < ids.length; i += 150) out.push(...await rest(`${path}&${col}=${inList(ids.slice(i, i + 150))}`));
  return out;
}
const mtDate = ts => new Date(ts).toLocaleDateString("en-CA", { timeZone: "America/Denver" });
const PLAN_FREQ = { weekly: "weekly", biweekly: "biweekly", monthly: "monthly", bimonthly: "bimonthly", quarterly: "quarterly", biannual: "biannual" };

// A rep's new clients whose first visit was booked in the range, with the
// ticket price and frequency the points table needs. Same customers and
// first-visit price as the Sales report's revenue: a GHL contact from the
// rep's pipelines, matched to HCP jobs, first visit's price without tips;
// canceled HCP jobs drop out. Frequency = the contact's GHL maintenance-plan
// pipeline (an open plan wins over a lost one), else the spacing of the plan
// visits booked with the first visit in HCP, else one-time.
async function salesDeals(rep, from, to) {
  const pipes = await rest("ghl_pipelines?select=id,name");
  const repPipes = pipes.filter(p => rep.pipelines.includes(p.name)).map(p => p.id);
  const planPipes = Object.fromEntries(pipes.filter(p => /maintenance plan/i.test(p.name))
    .map(p => [p.id, PLAN_FREQ[p.name.replace(/maintenance plan/i, "").trim().toLowerCase()] || null]));
  if (!repPipes.length) return [];
  const opps = await rest(`ghl_opportunities?select=contact_id,created_at&contact_id=not.is.null&pipeline_id=${inList(repPipes)}`);
  const since = {};
  for (const o of opps) if (!since[o.contact_id] || o.created_at < since[o.contact_id]) since[o.contact_id] = o.created_at;
  const contacts = Object.keys(since);
  if (!contacts.length) return [];
  const matches = await restIn("lead_job_matches?select=contact_id,hcp_job_id", "contact_id", contacts);
  if (!matches.length) return [];
  const credited = await rpc("credited_jobs", { p: matches.map(m => ({ k: m.contact_id, since: since[m.contact_id], job: m.hcp_job_id })) });

  const deals = {};
  for (const j of credited || []) {
    if (j.part !== "first") continue;
    const d = deals[j.k] ||= { contact_id: j.k, price: 0, booked_at: j.job_created_at, hcp_freq: j.plan_freq || null, job_ids: [] };
    d.price += Number(j.value) || 0;
    d.job_ids.push(j.hcp_job_id);
    if (j.job_created_at < d.booked_at) d.booked_at = j.job_created_at;
  }
  const list = Object.values(deals).filter(d => { const md = mtDate(d.booked_at); return md >= from && md <= to; });
  if (!list.length) return [];

  const ids = list.map(d => d.contact_id);
  const [plans, names] = await Promise.all([
    restIn(`ghl_opportunities?select=contact_id,pipeline_id,status,created_at&pipeline_id=${inList(Object.keys(planPipes))}`, "contact_id", ids),
    restIn("hcp_sales_jobs?select=hcp_job_id,first_name,last_name", "hcp_job_id", list.flatMap(d => d.job_ids)),
  ]);
  const nameOf = Object.fromEntries(names.map(n => [n.hcp_job_id, `${n.first_name || ""} ${n.last_name || ""}`.trim()]));
  return list.map(d => {
    const mine = plans.filter(p => p.contact_id === d.contact_id && planPipes[p.pipeline_id])
      .sort((a, b) => ((a.status === "lost") - (b.status === "lost")) || (b.created_at > a.created_at ? 1 : -1));
    const plan = mine[0];
    return {
      contact_id: d.contact_id,
      name: d.job_ids.map(id => nameOf[id]).find(Boolean) || "Unknown client",
      booked_on: mtDate(d.booked_at),
      price: Math.round(d.price * 100) / 100,
      freq: plan ? planPipes[plan.pipeline_id] : (d.hcp_freq || "one_time"),
      freq_source: plan ? "ghl_plan" : d.hcp_freq ? "hcp_visits" : "none",
      plan_cancelled: plan?.status === "lost",
    };
  }).sort((a, b) => a.booked_on < b.booked_on ? 1 : -1);
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
      if (q.rep !== "trevor") return json(400, { error: "Points bonus is for Trevor only" });
      return json(200, { rep: q.rep, from: q.from, to: q.to, deals: await salesDeals(REPS.trevor, q.from, q.to) });
    }
    return json(400, { error: "Unknown report type" });
  } catch (e) {
    console.error("reports:", e.message);
    return json(500, { error: e.message });
  }
};
