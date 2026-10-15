// demo/install.js -- answers every database and server call with made-up
// data (demo/data.js), so a demo build runs with no backend and no real
// company data. Loaded first by main.jsx in VITE_TENANT builds only.
// Writes (logging an upsell, a callback...) are kept in memory until reload.
import { buildDemo, marketingReport, adTrends, salesReport, salesDeals, laborActuals } from "./data.js";

const D = buildDemo();
const store = D.tables;
let nextId = 1;

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const b64 = o => btoa(JSON.stringify(o)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const token = (role, techId) => `${b64({ role, techId, exp: Date.now() + 12 * 3600e3 })}.demo`;

// PostgREST-style filters: col=eq.x, neq, gte, lte, gt, lt, in.(a,b), is.null, like/ilike.
function applyFilters(rows, params) {
  let out = rows;
  for (const [k, v] of params) {
    if (["select", "order", "limit", "offset", "on_conflict"].includes(k)) continue;
    const m = /^(not\.)?(eq|neq|gte|lte|gt|lt|in|is|like|ilike)\.(.*)$/.exec(v);
    if (!m) continue;
    const [, not, op, raw] = m;
    const test = r => {
      const x = r[k];
      switch (op) {
        case "eq": return String(x) === raw;
        case "neq": return String(x) !== raw;
        case "gte": return x != null && String(x) >= raw;
        case "lte": return x != null && String(x) <= raw;
        case "gt": return x != null && String(x) > raw;
        case "lt": return x != null && String(x) < raw;
        case "in": return raw.replace(/^\(|\)$/g, "").split(",").map(s => s.replace(/^"|"$/g, "")).includes(String(x));
        case "is": return raw === "null" ? x == null : String(x) === raw;
        default: { const re = new RegExp("^" + raw.replace(/\*/g, ".*") + "$", op === "ilike" ? "i" : ""); return re.test(String(x ?? "")); }
      }
    };
    out = out.filter(r => (not ? !test(r) : test(r)));
  }
  return out;
}

function rest(url, init) {
  const u = new URL(url), table = u.pathname.split("/rest/v1/")[1];
  const method = (init?.method || "GET").toUpperCase();
  if (table.startsWith("rpc/")) return json([]);
  const rows = store[table] || (store[table] = []);
  const params = [...u.searchParams.entries()];
  if (method === "GET") {
    let out = applyFilters(rows, params);
    const off = +(u.searchParams.get("offset") || 0), lim = u.searchParams.get("limit");
    out = out.slice(off, lim ? off + +lim : undefined);
    return json(out);
  }
  const body = init?.body ? JSON.parse(init.body) : null;
  if (method === "POST") {
    const add = (Array.isArray(body) ? body : [body]).map(r => ({ id: r.id || `demo-${nextId++}`, created_at: new Date().toISOString(), ...r }));
    rows.push(...add);
    return json(add, 201);
  }
  if (method === "PATCH") { const hit = applyFilters(rows, params); hit.forEach(r => Object.assign(r, body)); return json(hit); }
  if (method === "DELETE") { const hit = new Set(applyFilters(rows, params)); store[table] = rows.filter(r => !hit.has(r)); return json([]); }
  return json([]);
}

async function fn(url, init) {
  const u = new URL(url, location.origin), name = u.pathname.split("/").pop(), q = Object.fromEntries(u.searchParams);
  if (name === "auth-login") {
    const pin = JSON.parse(init?.body || "{}").pin;
    if (pin === "2222") return json({ type: "admin", role: "manager", name: D.field.name, techId: D.field.id, token: token("manager", D.field.id) });
    if (pin === "3333") return json({ type: "tech", role: "tech", name: D.lead.name, techId: D.lead.id, token: token("tech", D.lead.id) });
    return json({ type: "admin", role: "owner", name: D.owner.name, techId: null, token: token("owner", null) });
  }
  if (name === "reports") {
    const from = q.from || D.today.slice(0, 8) + "01", to = q.to || D.today;
    if (q.type === "marketing") return json(marketingReport(from, to));
    if (q.type === "ad_trends") return json(adTrends());
    if (q.type === "sales") return json(salesReport(from, to));
    if (q.type === "sales_deals") return json(salesDeals("sold by ryan"));
    if (q.type === "search") return json({ connection: { connected: false }, daily: [], queries: [], pages: [], page_status: [], totals: {}, prev: {}, brand: {}, non_brand: {} });
    return json({ ok: true });
  }
  if (name === "labor-actuals") return json(laborActuals(D.today));
  if (name === "audit-scores") return json({ submissions: [], last_run: null, tote_waivers: [], truck_grades: [] });
  if (name === "driver-scores") return json({ assignments: [], daily: [], events: [], unassigned: [], vehicles: [] });
  if (name === "tech-team-scores") return json({ company: { score: null, scored: 0, members: 0 }, teams: [], my_team: null });
  if (name === "damage-reports") return json({ rows: [], full: true });
  return json({ ok: true, demo: true });
}

const realFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input.url;
  if (url.includes("/rest/v1/")) return rest(url, init);
  if (url.includes("/.netlify/functions/")) return fn(url, init);
  return realFetch(input, init);
};
