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

// Plain-English "why is it this color" for the hover box. m = last 4 weeks'
// metrics(), g = grade(). typical = { cpl, bookRate } across all ads, to say
// what's holding a yellow back. -> { headline, lines[] }
export function gradeExplain(m, g, breakeven, typical = {}, cfg = AD_HEALTH) {
  const $ = x => `$${Math.round(x).toLocaleString()}`, x = v => `${(v || 0).toFixed(2)}x`;
  const back = `${$(m.roasUp * m.spend || 0)} in first visits on ${$(m.spend)} spent (${x(m.roasUp)})`;
  const funnel = `${m.leads} leads reached GHL${m.cpl != null ? ` at ${$(m.cpl)} each (Meta's count)` : ""}, ${m.booked} booked${m.bookRate != null ? ` (${Math.round(m.bookRate * 100)}%)` : ""}${m.ticket ? `, avg first job ${$(m.ticket)}` : ""}.`;
  // What's holding it back, compared with the account.
  const weak = [];
  if (m.bookRate != null && typical.bookRate && m.bookRate < typical.bookRate * 0.75) weak.push(`it books ${Math.round(m.bookRate * 100)}% of leads vs ${Math.round(typical.bookRate * 100)}% for your ads overall — faster follow-up would move it most`);
  if (m.cpl != null && typical.cpl && m.cpl > typical.cpl * 1.3) weak.push(`its leads cost ${$(m.cpl)} vs ${$(typical.cpl)} typical — a stronger hook or wider audience would lower that`);
  if (m.ticket && m.ticket < 250) weak.push(`its jobs are small (${$(m.ticket)} avg) — push bigger packages or plans`);
  if (g.grade === "none") {
    if (m.spend < cfg.minSpend || Math.max(m.leads || 0, m.platformLeads || 0) < cfg.minLeads)
      return { headline: "Grey: not enough data yet", lines: [`It needs at least ${$(cfg.minSpend)} spent and ${cfg.minLeads} leads in 4 weeks to grade fairly. So far: ${$(m.spend)} and ${Math.max(m.leads || 0, m.platformLeads || 0)} leads.`] };
    return { headline: "Grey: its leads aren't reaching GHL", lines: [`Meta counted ${m.platformLeads} leads, but none reached GHL, so the app can't see bookings or revenue. Check the form is connected to GHL.`] };
  }
  if (g.grade === "green") return { headline: `Green because it's earning ${x(m.roasUp)} — at or above ${cfg.greenRoas}x`, lines: [`${back}.`, funnel, "Keep it running; if its cost per lead starts climbing, it'll show as slipping here first."] };
  if (g.grade === "red") return { headline: `Red because it's losing money: ${x(m.roasUp)} is under break-even ${x(breakeven)}`, lines: [`${back}. Every dollar needs to bring back ${x(breakeven)} in first visits to cover the job's costs.`, funnel, ...(weak.length ? [`Biggest drag: ${weak[0]}.`] : [])] };
  if ((m.roasUp || 0) < breakeven) return { headline: `Yellow because plans pay it back: ${x(m.roasSold)} counting plan visits`, lines: [`Up front it's only ${x(m.roasUp)} (under break-even ${x(breakeven)}), but the plans it sold bring ${x(m.roasSold)} once their first visits are counted.`, funnel] };
  return { headline: `Yellow because it's making money (${x(m.roasUp)}) but under ${cfg.greenRoas}x`, lines: [`${back}.`, funnel, weak.length ? `To push it green: ${weak.join("; ")}.` : `To push it green: more bookings per lead or bigger first jobs.`] };
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

const P = x => `${Math.round(Math.abs(x) * 100)}%`;
const $ = x => `$${x >= 100 ? Math.round(x) : x.toFixed(2)}`;

// Why it's moving, most likely cause first. info: { frequency28d, weeksRunning }
// info: { frequency28d, weeksRunning, market: marketShift(...) }
export function reasons(t, info = {}, cfg = AD_HEALTH) {
  const { change: c, recent: r, base: b } = t, out = [];
  const mk = info.market || { cpl: 0, cpm: 0 };
  const marketCpm = Math.max(0, mk.cpm || 0);
  const cpmUp = (c.cpm ?? 0) - marketCpm >= 0.15, ctrDown = (c.ctr ?? 0) <= -0.1, freq = info.frequency28d;
  if (marketCpm >= 0.15 && (c.cpm ?? 0) >= 0.15) out.push(`Meta costs rose about ${P(marketCpm)} per 1,000 views across all your ads since their best weeks (the fall market), so ${(c.cpm ?? 0) - marketCpm < 0.1 ? "most" : "part"} of this ad's rise isn't the ad itself.`);
  if (cpmUp && ctrDown) out.push(`Ad fatigue: Meta is charging ${P(c.cpm)} more per 1,000 views and ${P(c.ctr)} fewer people click${freq ? `, and each person has seen it ${freq.toFixed(1)} times in 28 days` : ""}. The same audience is tired of it. Swap in a new video or hook.`);
  else if (freq && freq >= cfg.fatigueFrequency) out.push(`Each person has seen it ${freq.toFixed(1)} times in 28 days. The audience is small for this budget; widen the area or interests, or refresh the creative.`);
  else if (cpmUp) out.push(`Reaching this audience costs ${P(c.cpm)} more per 1,000 views (${$(b.cpm)} → ${$(r.cpm)}) while clicks held up. More competition or a shrinking audience; widen the targeting.`);
  else if (ctrDown) out.push(`${P(c.ctr)} fewer people click (${(b.ctr * 100).toFixed(2)}% → ${(r.ctr * 100).toFixed(2)}%). The hook is wearing out; test a new first 3 seconds or thumbnail.`);
  if ((c.formRate ?? 0) <= -0.2) out.push(`Clicks are fine, but ${P(c.formRate)} fewer finish the form (${Math.round(b.formRate * 100)}% → ${Math.round(r.formRate * 100)}% of clicks). Check the form or landing page.`);
  if ((c.spendPerWeek ?? 0) >= 0.4 && (c.cpl ?? 0) > 0) out.push(`Budget went up ${P(c.spendPerWeek)} a week. Bigger budgets reach colder people and cost more per lead; raise it 20% at a time.`);
  if (r.platformLeads >= 5 && r.ghlRate != null && r.ghlRate < 0.5) out.push(`Only ${Math.round(r.ghlRate * 100)}% of Meta's leads reached GHL. The form may be disconnected from GHL.`);
  if (r.leads >= 5 && (r.bookRate ?? 0) < 0.1) out.push(`${r.leads} leads reached GHL in 4 weeks but ${r.booked ? `only ${r.booked}` : "none"} booked. The leads aren't converting: check how fast they're contacted, the follow-up, and whether the ad attracts the right customers.`);
  else if (b.leads >= 5 && r.leads >= 5 && (c.bookRate ?? 0) <= -0.3) out.push(`Leads book less (${Math.round(b.bookRate * 100)}% → ${Math.round(r.bookRate * 100)}%). Check how fast they're contacted and the follow-up.`);
  if (b.booked >= 3 && r.booked >= 3 && (c.ticket ?? 0) <= -0.2) out.push(`Jobs from it are smaller (avg ${$(b.ticket)} → ${$(r.ticket)}). Push higher-value packages or plans.`);
  if (!out.length && (c.cpl ?? 0) > 0) out.push("No single cause stands out; costs drifted up across the board. Watch it another week.");
  if (info.weeksRunning >= cfg.tireWeeks) out.push(`It's been running ${info.weeksRunning} weeks. Most Meta ads tire after 6–10, so have the next creative ready.`);
  return out;
}
