// demo/data.js -- made-up data for sales demos (VITE_TENANT builds only).
// Seeded, so every visit shows the same numbers, and dated relative to today
// so the demo always looks current. Nothing here is real.

let seed = 20261015;
const rnd = () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const pick = a => a[Math.floor(rnd() * a.length)];
const between = (a, b) => a + rnd() * (b - a);
const uuid = () => "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => { const r = Math.floor(rnd() * 16); return (c === "x" ? r : (r & 3) | 8).toString(16); });

const DAY = 864e5;
const mtToday = () => new Date(Date.now() - 6 * 3600e3).toISOString().slice(0, 10);
export const addDays = (d, n) => new Date(new Date(d + "T12:00:00Z").getTime() + n * DAY).toISOString().slice(0, 10);
const weekKey = d => { const t = new Date(d + "T12:00:00Z"); return addDays(d, -t.getUTCDay()); };   // Sunday
const at = (d, hh, mm) => new Date(`${d}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00-06:00`).toISOString();

const T = (name, extra = {}) => ({ id: uuid(), name, avatar: "", badges: [], start_date: "2025-03-01", is_lead: false, team_lead_id: null, team_name: null,
  hourly_rate: 0, commission_rate: 27, is_active: true, title: "detail_pro", onboarding_stage: "complete", onboarding_complete: true,
  cert_status: "certified", cert_attempts: 1, classroom_complete: true, perfect_day_rubric_complete: true, misc_rubric_complete: true, on_leave: false, ...extra });

export function buildDemo() {
  const today = mtToday();
  const jake = T("Jake Turner", { is_lead: true, team_name: "Diamond Crew", title: "lead_detail_pro", start_date: "2024-04-15" });
  const mason = T("Mason Reed", { is_lead: true, team_name: "Ozark Elite", title: "lead_detail_pro", start_date: "2024-06-01" });
  const crew = [
    T("Tyler Brooks", { team_lead_id: jake.id, start_date: "2025-01-10" }),
    T("Luke Harmon", { team_lead_id: jake.id, start_date: "2025-02-20" }),
    T("Caleb Fisher", { team_lead_id: jake.id, start_date: "2025-05-05" }),
    T("Noah Pierce", { team_lead_id: mason.id, start_date: "2024-11-11" }),
    T("Wyatt Cole", { team_lead_id: mason.id, start_date: "2025-04-01" }),
    T("Brady Lane", { team_lead_id: mason.id, start_date: "2025-07-14", title: "senior_detail_pro" }),
  ];
  const ryan = T("Ryan Hale", { title: "sales", start_date: "2025-03-01" });
  const field = T("Hunter Shaw", { title: "field_supervisor", start_date: "2024-02-01" });
  const detailers = [jake, mason, ...crew];
  const techs = [...detailers, ryan, field].sort((a, b) => a.name.localeCompare(b.name));
  const skill = Object.fromEntries(detailers.map(t => [t.id, between(0.85, 1.2)]));

  const FIRST = ["Austin", "Bailey", "Carter", "Dana", "Emily", "Grant", "Hailey", "Isaac", "Jordan", "Kendall", "Logan", "Morgan", "Nathan", "Olivia", "Parker", "Quinn", "Reese", "Sierra", "Trent", "Vanessa", "Whitney", "Zane"];
  const LAST = ["Adams", "Baker", "Campbell", "Dawson", "Ellis", "Foster", "Garrett", "Hayes", "Irwin", "Jensen", "Keller", "Lawson", "Mitchell", "Norris", "Owens", "Porter", "Reynolds", "Sutton", "Tucker", "Walsh"];
  const PRICES = [150, 175, 195, 225, 250, 275, 295, 325, 350, 395, 450, 550];
  const customer = () => `${pick(FIRST)} ${pick(LAST)}`;

  const jobs = [], upsells = [], tips = [], time = [], switchovers = [], callbacks = [];
  let n = 1000;
  const start = addDays(today, -150);
  for (let d = start; d <= today; d = addDays(d, 1)) {
    const dow = new Date(d + "T12:00:00Z").getUTCDay();
    if (dow === 0) continue;
    for (const t of detailers) {
      if (rnd() < (dow === 6 ? 0.45 : 0.12)) continue;   // day off
      const count = rnd() < 0.55 ? 2 : rnd() < 0.7 ? 3 : 1;
      let hour = 8;
      for (let k = 0; k < count; k++) {
        const hcp = `job_demo_${n++}`;
        const revenue = Math.round(pick(PRICES) * skill[t.id]);
        const upsell = rnd() < 0.22 * skill[t.id] ? Math.round(pick([25, 35, 45, 60, 75, 95, 120])) : 0;
        const done = d < today || k === 0;
        if (!done) continue;
        jobs.push({ id: uuid(), hcp_job_id: hcp, tech_id: t.id, job_date: d, revenue, upsell_amount: upsell, hours: null, week_key: weekKey(d),
          created_at: at(d, hour + 3, 10), tips: 0, customer_name: customer(), split_confirmed: true });
        if (upsell) upsells.push({ id: uuid(), tech_id: t.id, week_key: weekKey(d), amount: upsell, created_at: at(d, hour + 3, 12), hcp_job_id: hcp, note: null });
        if (rnd() < 0.42) tips.push({ id: uuid(), tech_id: t.id, work_date: d, amount: pick([10, 15, 20, 20, 25, 30, 40, 50]), created_at: at(d, hour + 4, 0), hcp_job_id: hcp });
        hour += 3;
      }
      const inH = 7 + Math.floor(rnd() * 2), inM = Math.floor(rnd() * 50);
      const outMin = (hour + 1) * 60 + Math.floor(rnd() * 60);
      time.push({ id: uuid(), tech_id: t.id, work_date: d, clock_in: at(d, inH, inM),
        clock_out: d === today ? null : at(d, Math.floor(outMin / 60), outMin % 60), auto_closed: false, created_at: at(d, inH, inM) });
      if (rnd() < 0.035 * skill[t.id]) switchovers.push({ id: uuid(), tech_id: t.id, week_key: weekKey(d), plan_id: pick(["monthly", "monthly", "bimonthly", "quarterly", "biweekly"]), created_at: at(d, 15, 0), with_exterior: rnd() < 0.4, sold_date: d });
      if (rnd() < 0.006) callbacks.push({ id: uuid(), tech_id: t.id, reason: pick(["Streaks on windshield", "Missed cupholders", "Pet hair left in trunk"]), created_at: at(d, 18, 0), weight: 1, hcp_job_id: null, job_date: d, customer_name: customer(), job_number: String(8000000 + n), missed_items: [], severity: pick([1, 1, 2]), group_id: null });
    }
  }
  const reviews = [];
  for (let m = 0; m < 5; m++) {
    const mk = addDays(today, -30 * m).slice(0, 7);
    for (const t of detailers) reviews.push({ id: uuid(), tech_id: t.id, month_key: mk, count: Math.max(0, Math.round(between(2, 9) * skill[t.id]) - (m === 0 ? 2 : 0)), created_at: at(today, 9, 0) });
  }
  const vehicles = Array.from({ length: 8 }, (_, i) => ({ id: uuid(), name: `Unit ${i + 1}`, model: i < 6 ? "Ford Transit" : "F-150", plate: `DSD-${100 + i}`, vin: `DEMOVIN${1000 + i}`, active: true, created_at: at(today, 8, 0) }));
  const truck_assignments = [];
  for (const e of time.filter(e => e.work_date >= addDays(today, -60))) {
    const i = detailers.findIndex(t => t.id === e.tech_id);
    truck_assignments.push({ id: uuid(), tech_id: e.tech_id, vehicle_id: vehicles[i % vehicles.length].id, work_date: e.work_date, shared: false, picked_at: e.clock_in });
  }
  return { today, techs, detailers, owner: { name: "Cael Bray" }, rep: ryan, field, lead: jake,
    tables: { techs, jobs, upsells, tip_entries: tips, time_entries: time, switchovers, reviews, callbacks, vehicles, truck_assignments } };
}

// ─── Marketing / ads / sales reports (same shapes as reports.js) ─────────────
const CH = (leads, spend, extra = {}) => {
  const booked = Math.round(leads * between(0.32, 0.45)), up = booked * between(240, 320);
  return { leads, spend: Math.round(spend), booked, clicks: Math.round(spend * between(1.4, 2.2)), customers: booked, plans_sold: Math.round(booked * 0.28),
    impressions: Math.round(spend * between(55, 80)), revenue_upfront: Math.round(up), revenue_sold: Math.round(up * between(1.6, 2.1)),
    revenue_serviced: Math.round(up * between(1.1, 1.4)), revenue_beyond: Math.round(up * 0.3), platform_leads: Math.round(leads * 1.15), last_spend_day: spend ? mtToday() : null, ...extra };
};
export function marketingReport(from, to) {
  seed = 777 + from.length;
  const days = Math.max(1, Math.round((new Date(to) - new Date(from)) / DAY) + 1), f = days / 30;
  const daily = [];
  for (let d = from; d <= to; d = addDays(d, 1)) daily.push({ d, leads: { meta: Math.round(between(1, 5)), google: Math.round(between(0, 3)), lsa: Math.round(between(0, 2)), website: Math.round(between(0, 2)) }, spend: { meta: Math.round(between(45, 85)), google: Math.round(between(30, 60)), lsa: Math.round(between(10, 30)) } });
  const sum = (k, ch) => daily.reduce((s, x) => s + (x[k][ch] || 0), 0);
  const meta = CH(sum("leads", "meta"), sum("spend", "meta")), google = CH(sum("leads", "google"), sum("spend", "google")), lsa = CH(sum("leads", "lsa"), sum("spend", "lsa"));
  lsa.lsa_detail = { jobs: lsa.booked, leads: lsa.leads, booked: lsa.booked, people: lsa.leads, by_type: { PHONE_CALL: Math.round(lsa.leads * 0.7), MESSAGE: Math.round(lsa.leads * 0.3) }, charged: lsa.leads, customers: lsa.customers, plans_sold: lsa.plans_sold, last_lead_at: new Date().toISOString(), revenue_sold: lsa.revenue_sold, with_contact: lsa.leads, revenue_beyond: lsa.revenue_beyond, revenue_upfront: lsa.revenue_upfront, revenue_serviced: lsa.revenue_serviced };
  let adNo = 0;
  const camp = (name, ads) => { const leads = Math.round(meta.leads * ads.share), spend = Math.round(meta.spend * ads.share), c = CH(leads, spend);
    return { id: "c_" + name, name, ...c, ads: ads.list.map((a, i) => { const s = (i ? 0.4 : 0.6), l = Math.round(leads * s), sp = Math.round(spend * s), x = CH(l, sp); return { id: `ad_demo_${adNo++}`, name: a, adset: ads.adset, leads: l, spend: sp, booked: x.booked, plans_sold: x.plans_sold, revenue_sold: x.revenue_sold, revenue_upfront: x.revenue_upfront, revenue_serviced: x.revenue_serviced }; }) }; };
  return {
    from, to, hcp_jobs_synced: Math.round(310 * f),
    channels: { meta, google, lsa, website: CH(Math.round(9 * f), 0), social: CH(Math.round(4 * f), 0), manual: CH(Math.round(6 * f), 0), other: CH(Math.round(3 * f), 0) },
    daily,
    attribution: { gross_margin: 0.52, target_margin: 0.3, plan_minimums: { weekly: 8, biweekly: 7, monthly: 6, bimonthly: 5, quarterly: 4 } },
    meta_campaigns: [
      camp("NWA Interior Detail – Fall", { share: 0.45, adset: "Bentonville / Rogers", list: ["Before & After Reel", "Pet Hair Carousel"] }),
      camp("Membership Plans", { share: 0.35, adset: "Fayetteville 25mi", list: ["Monthly Plan Video", "Keep It Clean Offer"] }),
      camp("Boat & RV Season", { share: 0.2, adset: "Beaver Lake area", list: ["Boat Detail Reel", "RV Wash Photo"] }),
    ],
    website_pages: [{ page: "/", leads: Math.round(5 * f) }, { page: "/memberships", leads: Math.round(3 * f) }, { page: "/boat-rv-detailing", leads: Math.round(2 * f) }],
    website_sources: [{ source: "Google organic", leads: Math.round(6 * f), booked: Math.round(3 * f), revenue_sold: Math.round(2100 * f) }, { source: "Instagram bio", leads: Math.round(3 * f), booked: Math.round(1 * f), revenue_sold: Math.round(700 * f) }],
    ga4: { has_data: true, users: Math.round(1450 * f), sessions: Math.round(1900 * f), engaged: Math.round(1100 * f), key_events: Math.round(64 * f), daily: Object.fromEntries(daily.map(x => [x.d, Math.round(between(40, 80))])),
      pages: [{ page: "/", sessions: Math.round(900 * f), key_events: Math.round(30 * f) }, { page: "/memberships", sessions: Math.round(320 * f), key_events: Math.round(14 * f) }, { page: "/services-pricing", sessions: Math.round(280 * f), key_events: Math.round(9 * f) }],
      by_channel: [{ channel: "Organic Search", users: Math.round(620 * f), sessions: Math.round(800 * f), key_events: Math.round(28 * f) }, { channel: "Paid Social", users: Math.round(410 * f), sessions: Math.round(520 * f), key_events: Math.round(18 * f) }, { channel: "Direct", users: Math.round(250 * f), sessions: Math.round(330 * f), key_events: Math.round(11 * f) }] },
    ad_campaigns: { google: [{ id: "g1", name: "Search – Mobile Detailing NWA", spend: google.spend * 0.7, clicks: Math.round(google.clicks * 0.7), conversions: Math.round(google.leads * 0.7), impressions: Math.round(google.impressions * 0.7) }, { id: "g2", name: "Search – Boat & RV", spend: google.spend * 0.3, clicks: Math.round(google.clicks * 0.3), conversions: Math.round(google.leads * 0.3), impressions: Math.round(google.impressions * 0.3) }],
      lsa: [{ id: "l1", name: "LocalServicesCampaign", spend: lsa.spend, clicks: lsa.clicks, conversions: lsa.leads, impressions: lsa.impressions }] },
    connections: { ghl: { connected: true, last_sync: new Date().toISOString() }, meta: { connected: true, last_sync: new Date().toISOString() }, google: { connected: true, last_sync: new Date().toISOString() }, lsa: { connected: true, last_sync: new Date().toISOString() }, ga4: { connected: true, google_connected: true, last_sync: new Date().toISOString() } },
  };
}

export function adTrends() {
  seed = 4242;
  const ads = [
    ["Before & After Reel", "NWA Interior Detail – Fall", "Bentonville / Rogers", 1.0, -0.075],
    ["Pet Hair Carousel", "NWA Interior Detail – Fall", "Bentonville / Rogers", 0.8, -0.06],
    ["Monthly Plan Video", "Membership Plans", "Fayetteville 25mi", 0.9, 0.0],
    ["Keep It Clean Offer", "Membership Plans", "Fayetteville 25mi", 0.6, 0.06],
    ["Boat Detail Reel", "Boat & RV Season", "Beaver Lake area", 0.7, -0.03],
    ["RV Wash Photo", "Boat & RV Season", "Beaver Lake area", 0.4, 0.04],
  ];
  const rows = [], meta = [], adsets = [];
  const today = mtToday(), monday = addDays(today, -((new Date(today + "T12:00:00Z").getUTCDay() + 6) % 7));
  ads.forEach(([name, camp, adset, size, drift], i) => {
    const id = "ad_demo_" + i;
    meta.push({ ad_id: id, ad_name: name, campaign_id: "c" + i, created_time: addDays(today, -140 + i * 9) + "T15:00:00Z", status: "ACTIVE", reach_28d: Math.round(4000 * size), frequency_28d: +(1.5 + Math.max(0, -drift) * 28).toFixed(1) });
    adsets.push({ ad_id: id, adset_id: "as_" + adset, adset_name: adset, campaign_id: "c_" + camp, campaign_name: camp });
    for (let w = 18; w >= 0; w--) {
      const wk = addDays(monday, -7 * w), age = 18 - w, fade = Math.max(0.45, 1 + drift * Math.max(0, age - 9));
      const spend = Math.round(140 * size * between(0.85, 1.15)), pl = Math.max(0, Math.round(spend / (19 / fade) * between(0.8, 1.2))), leads = Math.round(pl * 0.9), booked = Math.round(leads * between(0.3, 0.45));
      rows.push({ ad_id: id, ad_name: name, campaign_id: "c_" + camp, campaign_name: camp, wk, spend, impressions: Math.round(spend * 70), link_clicks: Math.round(spend * 1.8), platform_leads: pl, leads, booked, upfront: Math.round(booked * 285), sold: Math.round(booked * 540) });
    }
  });
  return { rows, ads: meta, adsets };
}

export function salesReport(from, to) {
  seed = 99;
  const daily = [];
  for (let d = from; d <= to; d = addDays(d, 1)) { const wd = new Date(d + "T12:00:00Z").getUTCDay() % 6 !== 0; daily.push({ d, calls: wd ? Math.round(between(35, 70)) : 0, connected: wd ? Math.round(between(12, 25)) : 0, booked: wd ? Math.round(between(1, 5)) : 0, sold: wd ? Math.round(between(0, 3)) : 0 }); }
  const s = k => daily.reduce((a, x) => a + x[k], 0), calls = s("calls"), booked = s("booked"), sold = s("sold");
  const kind = (leads, b) => ({ demos: 0, leads, contacted: Math.round(leads * 0.93), within_5m: Math.round(leads * 0.74), within_60s: Math.round(leads * 0.41), in_hours_leads: Math.round(leads * 0.8), after_hours_leads: Math.round(leads * 0.2), after_hours_auto_replied: Math.round(leads * 0.2), booked_in_period: b, booked_from_leads: b, median_seconds_to_contact: 94 });
  return { from, to, rep: "Ryan", ghl_user_found: true, texts: Math.round(calls * 1.3),
    calls: { total: calls, per_day: Math.round(calls / Math.max(1, daily.filter(x => x.calls).length)), connected: s("connected"), days_calling: daily.filter(x => x.calls).length, talk_minutes: Math.round(s("connected") * 4.2) },
    daily, plans: { sold: Math.round(sold * 0.6), by_plan: { Monthly: Math.round(sold * 0.35), Bimonthly: Math.round(sold * 0.15), Quarterly: Math.round(sold * 0.1) }, cancelled: 1 },
    by_kind: { all: kind(Math.round(booked * 2.6), booked), warm: kind(Math.round(booked * 2.1), Math.round(booked * 0.85)), cold: kind(Math.round(booked * 0.5), Math.round(booked * 0.15)) },
    revenue: { sold: booked * 610, upfront: booked * 265, serviced: booked * 420, sold_jobs: booked, serviced_jobs: Math.round(booked * 0.8), plan_committed: Math.round(sold * 0.6) * 1500, matched_customers: booked, match_types: { name: Math.round(booked * 0.3), phone: Math.round(booked * 0.7) },
      by_kind: { all: { sold: booked * 610, serviced: booked * 420 }, warm: { sold: booked * 520, serviced: booked * 360 }, cold: { sold: booked * 90, serviced: booked * 60 } } },
    pipelines: ["Residential Leads"] };
}

// Ryan's (residential rep) sold jobs, shaped like hcp_sales_jobs for salesPoints.js.
export function salesDeals(tag) {
  seed = 31337;
  const jobs = [], revenue = {}, today = mtToday();
  const FREQ = [["Monthly", 28], ["Bimonthly", 56], ["Quarterly", 84], ["Biweekly", 14], [null, 0], [null, 0]];
  for (let i = 0; i < 70; i++) {
    const startDay = addDays(today, -Math.floor(rnd() * 120)), price = pick([175, 225, 250, 295, 325, 395]);
    const [plan, every] = pick(FREQ), cust = "cus_demo_" + i, name = ["Grant", "Hailey", "Isaac", "Jordan", "Kendall", "Morgan", "Parker", "Reese"][i % 8];
    const visits = plan ? Math.min(6, 1 + Math.floor(150 / every)) : 1;
    for (let v = 0; v < visits; v++) {
      const d = addDays(startDay, v * every), id = `sale_${i}_${v}`, done = d <= today && !(v > 1 && rnd() < 0.08);
      jobs.push({ hcp_job_id: id, hcp_customer_id: cust, first_name: name, last_name: ["Adams", "Hayes", "Owens", "Walsh", "Tucker"][i % 5], work_status: done ? "complete rated" : "scheduled",
        scheduled_start: d + "T15:00:00Z", completed_at: done ? d + "T19:00:00Z" : null, job_created_at: startDay + "T14:00:00Z", total_cents: price * 100, tip_cents: 0,
        tags: v === 0 ? [tag, ...(plan ? [plan] : []), rnd() < 0.2 ? "RETURNING" : "NEW"] : [] });
      if (done) revenue[id] = price;
    }
  }
  return { rep: "trevor", tag, jobs, revenue, overrides: [], snapshots: {}, plan_minimums: {}, evidence: [], evidence_failed: false };
}

export function laborActuals(today) {
  const m = k => addDays(today.slice(0, 7) + "-01", -28 * k).slice(0, 7);
  return { months: [3, 2, 1].map(k => ({ month: m(k), income: 61000 + k * 2500, wages_cogs: 15400 + k * 600, payroll_taxes_cogs: 1850 + k * 70, training_pay: 300, tips: 2200 })) };
}
