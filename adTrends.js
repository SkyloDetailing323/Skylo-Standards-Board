// adTrends.js -- Meta ad health on the Marketing tab (owner, Oct 2026).
//
// Every ad is graded on its LAST 4 WEEKS (one day or one week of an ad is
// noise), and watched for a slide: those 4 weeks against the ad's own best
// 4-week stretch, so a tiring ad is flagged before it falls under break-even.
// When it's slipping, reasons() says which part of the funnel moved.
// Pure functions, no React or network.

export const AD_HEALTH = {
  windowWeeks: 4,        // grade window
  greenRoas: 3.5,        // upfront ROAS at or above = green
  plansPayBack: 3,       // committed ROAS that turns a red upfront into yellow
  minSpend: 250,         // under this in the window = not enough data
  minLeads: 10,
  slip: 0.25,            // cost per lead +25% or ROAS -25% vs its best = slipping
  drop: 0.5,             // +50% / -50% = dropping fast
  fatigueFrequency: 3,   // avg times each person saw it in 28 days
  tireWeeks: 8,          // most Meta creatives tire after ~6-10 weeks
};

const DAY = 864e5;
export const weekStart = d => { const t = new Date(d + "T12:00:00Z"); const back = (t.getUTCDay() + 6) % 7; return new Date(t.getTime() - back * DAY).toISOString().slice(0, 10); };
const addWeeks = (wk, n) => new Date(new Date(wk + "T12:00:00Z").getTime() + n * 7 * DAY).toISOString().slice(0, 10);
const FIELDS = ["spend", "impressions", "link_clicks", "platform_leads", "leads", "booked", "upfront", "sold"];

// rows: ad_trends rows (one per ad per Monday week). today: "YYYY-MM-DD".
// -> [{ ad_id, ad_name, campaign_name, weeks:[{wk, ...sums}], firstWeek }]
// with every week from the ad's first week to the last FULL week (the
// current, partial week is left out so a Monday doesn't look like a crash).
export function groupAds(rows, today) {
  const lastFull = addWeeks(weekStart(today), -1);
  const ads = {};
  for (const r of rows || []) {
    const a = ads[r.ad_id] ||= { ad_id: r.ad_id, ad_name: r.ad_name, campaign_id: r.campaign_id, campaign_name: r.campaign_name, byWk: {} };
    if (r.ad_name && !a.ad_name) a.ad_name = r.ad_name;
    if (r.campaign_name && !a.campaign_name) { a.campaign_name = r.campaign_name; a.campaign_id = r.campaign_id; }
    const w = a.byWk[r.wk] ||= { wk: r.wk };
    for (const f of FIELDS) w[f] = (w[f] || 0) + Number(r[f] || 0);
  }
  return Object.values(ads).map(a => {
    const wks = Object.keys(a.byWk).sort();
    const weeks = [];
    if (wks.length) for (let wk = wks[0]; wk <= lastFull; wk = addWeeks(wk, 1)) weeks.push(a.byWk[wk] || { wk, ...Object.fromEntries(FIELDS.map(f => [f, 0])) });
    return { ad_id: a.ad_id, ad_name: a.ad_name, campaign_id: a.campaign_id, campaign_name: a.campaign_name, firstWeek: wks[0] || null, weeks };
  });
}

export function sumWeeks(weeks) {
  const s = Object.fromEntries(FIELDS.map(f => [f, 0]));
  for (const w of weeks) for (const f of FIELDS) s[f] += Number(w[f] || 0);
  return s;
}

const div = (a, b) => (b > 0 ? a / b : null);
export function metrics(s) {
  return {
    spend: s.spend, cpm: div(s.spend * 1000, s.impressions), ctr: div(s.link_clicks, s.impressions), cpc: div(s.spend, s.link_clicks),
    cpl: div(s.spend, s.platform_leads), formRate: div(s.platform_leads, s.link_clicks), ghlRate: div(s.leads, s.platform_leads),
    bookRate: div(s.booked, s.leads), roasUp: div(s.upfront, s.spend), roasSold: div(s.sold, s.spend), ticket: div(s.upfront, s.booked),
    leads: s.leads, platformLeads: s.platform_leads, booked: s.booked,
  };
}

// Grade on the last 4 weeks. breakeven = 1 / gross margin.
// -> { grade: "green"|"yellow"|"red"|"none", note }
export function grade(m, breakeven, cfg = AD_HEALTH) {
  if (m.spend < cfg.minSpend || Math.max(m.leads || 0, m.platformLeads || 0) < cfg.minLeads) return { grade: "none", note: "Not enough data yet" };
  if (!(m.leads > 0) && m.platformLeads > 0) return { grade: "none", note: "Leads aren't reaching GHL, so revenue can't be counted" };
  const r = m.roasUp || 0;
  if (r < breakeven) return (m.roasSold || 0) >= cfg.plansPayBack ? { grade: "yellow", note: "Under break-even up front, but plans pay it back" } : { grade: "red", note: "Losing money" };
  if (r < cfg.greenRoas) return { grade: "yellow", note: "Making money" };
  return { grade: "green", note: "Great" };
}

const pct = (now, before) => (now != null && before != null && before > 0 ? now / before - 1 : null);

// Rolling 4-week metrics for each week (that week and the 3 before it).
export function rolling(ad, n = AD_HEALTH.windowWeeks) {
  return ad.weeks.map((w, i) => ({ wk: w.wk, ...metrics(sumWeeks(ad.weeks.slice(Math.max(0, i - n + 1), i + 1))), full: i >= n - 1 }));
}

// The ad now (last 4 full weeks) vs its own best 4-week stretch, so a slow
// slide shows up long before it crosses break-even.
// -> { status, recent, base, change, peakWeek, slideSince }
// status: "dropping" | "slipping" | "improving" | "steady" | "new" | "quiet"
// base = the best 4 weeks (lowest cost per lead, enough spend), or the 4
// weeks before "now" for a young ad.
// market: how cost per lead / CPM moved across ALL ads from their best weeks
// (median), so a fall-wide price rise doesn't flag every ad. See marketShift().
export function trend(ad, cfg = AD_HEALTH, market = { cpl: 0, cpm: 0 }) {
  const n = cfg.windowWeeks, w = ad.weeks;
  const roll = rolling(ad, n);
  const recentW = w.slice(-n), recent = metrics(sumWeeks(recentW));
  const priorEnd = w.length - n;                       // windows that end before "now"
  let peakIdx = -1;
  for (let i = n - 1; i < priorEnd; i++) {
    const r = roll[i];
    if (r.spend >= 200 && r.cpl != null && (peakIdx < 0 || r.cpl < roll[peakIdx].cpl)) peakIdx = i;
  }
  const base = peakIdx >= 0 ? roll[peakIdx] : metrics(sumWeeks(w.slice(-2 * n, -n)));
  const change = {
    cpl: pct(recent.cpl, base.cpl), cpm: pct(recent.cpm, base.cpm), ctr: pct(recent.ctr, base.ctr), cpc: pct(recent.cpc, base.cpc),
    formRate: pct(recent.formRate, base.formRate), bookRate: pct(recent.bookRate, base.bookRate), ticket: pct(recent.ticket, base.ticket),
    roasUp: pct(recent.roasUp, base.roasUp), spendPerWeek: pct(recent.spend, base.spend),
  };
  let status;
  if (w.length < 2 * n || base.spend < 100) status = "new";
  else if (recent.spend < 100) status = "quiet";
  else {
    const roasWorse = change.roasUp != null && base.leads >= 5 && recent.leads >= 5 ? -change.roasUp : 0;
    const worse = Math.max(change.cpl ?? 0, roasWorse);
    const beyondMarket = Math.max((change.cpl ?? 0) - Math.max(0, market.cpl || 0), roasWorse);
    const earlyFatigue = (change.cpm ?? 0) - Math.max(0, market.cpm || 0) >= cfg.slip && (change.ctr ?? 0) <= -0.1;
    status = beyondMarket >= cfg.drop || worse >= 1 ? "dropping" : beyondMarket >= cfg.slip || earlyFatigue ? "slipping"
      : (change.cpl ?? 0) <= -cfg.slip ? "improving" : "steady";
  }
  // First week after the peak whose 4-week cost per lead ran 25%+ over it.
  let slideSince = null;
  if (peakIdx >= 0 && (status === "slipping" || status === "dropping")) {
    const bar = base.cpl * (1 + Math.max(0, market.cpl || 0) + cfg.slip);
    for (let i = peakIdx + 1; i < roll.length; i++) if (roll[i].cpl != null && roll[i].cpl >= bar) { slideSince = w[Math.max(0, i - n + 1)].wk; break; }
  }
  return { status, recent, base, change, peakWeek: peakIdx >= 0 ? w[peakIdx - n + 1].wk : null, slideSince };
}

// Median change from each ad's best 4 weeks to now, across ads that have one.
export function marketShift(trends) {
  const med = xs => { const v = xs.filter(x => x != null && isFinite(x)).sort((a, b) => a - b); return v.length ? v[Math.floor(v.length / 2)] : 0; };
  const withPeak = trends.filter(t => t.peakWeek);
  return withPeak.length >= 3 ? { cpl: med(withPeak.map(t => t.change.cpl)), cpm: med(withPeak.map(t => t.change.cpm)), ads: withPeak.length } : { cpl: 0, cpm: 0, ads: withPeak.length };
}

const $ = x => `$${x >= 100 ? Math.round(x) : x.toFixed(2)}`;

// The pop-up on each ad: one "why" sentence and one "do this" sentence,
// picking the single biggest cause. m = last 4 weeks' metrics(), g = grade(),
// t = trend(), typical = { cpl, bookRate } across all ads.
// info: { frequency28d, weeksRunning, market: marketShift(...) }
// -> { label, why, todo }
export function adAdvice(m, g, t, breakeven, typical = {}, info = {}, cfg = AD_HEALTH) {
  const x = v => `${(v || 0).toFixed(1)}x`;
  const c = t?.change || {}, mk = info.market || {};
  const label = { green: `Green · ${x(m.roasUp)}`, yellow: `Yellow · ${x(m.roasUp)}`, red: `Red · ${x(m.roasUp)}`, none: "Not graded yet" }[g.grade];
  const sliding = t && (t.status === "slipping" || t.status === "dropping");
  const since = t?.slideSince ? ` since ${t.slideSince.slice(5).replace("-", "/")}` : "";
  const fatigued = ((c.cpm ?? 0) - Math.max(0, mk.cpm || 0) >= 0.15 && (c.ctr ?? 0) <= -0.1) || (info.frequency28d || 0) >= cfg.fatigueFrequency;
  const notBooking = m.leads >= 5 && ((m.bookRate ?? 0) < 0.1 || (typical.bookRate && (m.bookRate ?? 0) < typical.bookRate * 0.6));
  const pricey = m.cpl != null && typical.cpl && m.cpl > typical.cpl * 1.3;
  const small = m.booked >= 2 && m.ticket && m.ticket < 250;
  const out = (why, todo) => ({ label, why, todo });

  if (g.grade === "none") {
    if (m.platformLeads > 0 && !(m.leads > 0)) return out(`Meta counted ${m.platformLeads} leads but none reached GHL, so nobody's working them.`, "Reconnect this ad's form to GHL so the leads get called.");
    return out(`It's too new to judge (${$(m.spend)} spent, ${Math.max(m.leads || 0, m.platformLeads || 0)} leads in 4 weeks).`, `Leave it running until it has $${cfg.minSpend} and ${cfg.minLeads} leads.`);
  }
  if (g.grade === "green") {
    if (sliding) return out(`Still profitable at ${x(m.roasUp)}, but its leads cost more than at its best${since}${fatigued ? " — people are getting tired of it" : ""}.`, "Keep it on, and have a fresh video ready to swap in before it turns yellow.");
    return out(`It's earning ${x(m.roasUp)} — ${m.booked} of ${m.leads} leads booked${m.cpl ? ` at about ${$(m.cpl)} a lead` : ""}.`, "Keep it running and raise the budget about 20% a week while it holds.");
  }
  if (g.grade === "yellow" && (m.roasUp || 0) < breakeven) return out(`Up front it's under break-even, but the plans it sells bring it to ${x(m.roasSold)}.`, "Keep it — it pays off over the plan visits; push the plan offer harder in the ad.");
  // Yellow (making money) or red: the biggest single drag.
  const lead = g.grade === "red" ? `It's losing money (${x(m.roasUp)}, break-even is ${x(breakeven)})` : `It's making money (${x(m.roasUp)}) but not great`;
  if (notBooking) return out(`${lead}: ${m.leads} leads came in but only ${m.booked} booked.`, "The ad is working — call these leads within 5 minutes and follow up with a reason to book now.");
  if (fatigued) return out(`${lead}: people have seen it too many times, so fewer click and each lead costs more${since}.`, "Swap in a new video or hook, or widen the audience.");
  if (pricey) return out(`${lead}: leads cost ${$(m.cpl)} vs ${$(typical.cpl)} on your other ads.`, "Test a new hook or thumbnail, or widen the area it targets.");
  if (small) return out(`${lead}: the jobs it books are small (${$(m.ticket)} on average).`, "Feature bigger packages or a plan offer in the ad.");
  if (sliding && (mk.cpm || 0) >= 0.15) return out(`${lead}: costs rose with the fall ad market more than anything this ad did.`, g.grade === "red" ? "Lower its budget or pause it until costs settle." : "Keep it running and watch it another week.");
  return out(`${lead}.`, g.grade === "red" ? "Cut its budget in half and test a new creative; pause it if it's still red in 2 weeks." : "Test a new creative against it to find a stronger version.");
}
