import { useState, useEffect, useCallback } from "react";

// ─── SUPABASE CONFIG ──────────────────────────────────────────────────────────
const SUPABASE_URL = "https://mjmwxxvqcsptrocwucis.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1qbXd4eHZxY3NwdHJvY3d1Y2lzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg4Njk2MjAsImV4cCI6MjA5NDQ0NTYyMH0.YLwGKFvrAn3F8viFgP0oZ6hzqSSq7w8FrNT1y3sy_Sc";

async function sb(path, opts = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      "apikey": SUPABASE_ANON_KEY,
      "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
      "Content-Type": "application/json",
      "Prefer": opts.prefer || "return=representation",
      ...opts.headers,
    },
    ...opts,
  });
  if (!res.ok) { const err = await res.text(); throw new Error(err); }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

// ─── DESIGN TOKENS ────────────────────────────────────────────────────────────
const C = {
  blue:    "#2b9cf0",
  blueDk:  "#0077cc",
  blueLt:  "#e8f4ff",
  blueXlt: "#f0f8ff",
  black:   "#0d2240",
  dark:    "#f5f9ff",
  card:    "#ffffff",
  cardLt:  "#f0f7ff",
  border:  "#c5dff8",
  white:   "#ffffff",
  offWhite:"#0d2240",
  muted:   "#6b93bb",
  green:   "#00c853",
  gold:    "#f59e0b",
  orange:  "#ff6b35",
  purple:  "#7c3aed",
  red:     "#ef4444",
};

const ADMIN_PIN = "0000";
const UPSELL_PTS_PER_DOLLAR = 0.5; // $2 = 1 pt
const REVIEW_PTS = 5;
const REVIEW_BONUS_PTS = 20; // bonus at 10+ reviews in a month
const CALLBACK_PTS = -300; // deducted per callback — nearly a full week of work

// ─── QUOTA CONFIG (Kyle sets these in admin) ──────────────────────────────────
const DEFAULT_QUOTA = {
  upsells: 175,      // $ per month — mid between $150 floor and $200 avg
  reviews: 6,        // count per month — mid between 5 floor and 7 avg
  switchovers: 2,    // count per month — floor for now, team is still developing
};
// Kyle's bonus: triggered when X% of techs hit all 3 quotas in the month
const KYLE_BONUS_THRESHOLD = 0.75; // 75% of techs must hit quota
const KYLE_BONUS_PCT = 0.05;       // 5% of total team upsell revenue that month

const LOGO_SRC = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 160 45'%3E%3Ctext x='80' y='34' font-family='Arial Black,sans-serif' font-size='30' font-weight='900' font-style='italic' fill='%232b9cf0' text-anchor='middle'%3ESkylo%3C/text%3E%3C/svg%3E";

// ─── BADGE DEFS ───────────────────────────────────────────────────────────────
// Rotating trophies: passed to current leader each month, no points
const ROTATING_TROPHIES = [
  { id:"audit_legend",    name:"Audit Legend",     icon:"📋", desc:"100% on audits for the month — passed to the current holder" },
  { id:"upsell_king",     name:"Upsell King",      icon:"👑", desc:"Highest upsells for the month — passed to the current holder" },
  { id:"review_champ",   name:"Review Champion",  icon:"⭐", desc:"Most reviews in the month — passed to the current holder" },
];

// Permanent point badges
// Scale reference: ~800 pts = solid month of work (upsells + reviews + switchovers)
const BADGE_DEFS = [
  // Tenure (show up, stay loyal — meaningful but modest)
  { id:"three_month",    cat:"Tenure",      name:"3-Month Mark",       icon:"📅", pts:40,   desc:"3 months on the team" },
  { id:"six_month",      cat:"Tenure",      name:"Half Year Hustle",   icon:"📆", pts:80,   desc:"6 months of consistency" },
  { id:"one_year",       cat:"Tenure",      name:"One Year Strong",    icon:"🏅", pts:150,  desc:"First full year with Skylo" },
  { id:"two_year",       cat:"Tenure",      name:"Two Year Vet",       icon:"🎖️", pts:225,  desc:"Two years of excellence" },
  { id:"three_year",     cat:"Tenure",      name:"Three Year Elite",   icon:"💎", pts:325,  desc:"Three years — rare commitment" },
  { id:"five_year",      cat:"Tenure",      name:"Five Year Legend",   icon:"👑", pts:500,  desc:"Five years — one of the best" },

  // Revenue (directly tied to company revenue — high value)
  { id:"rev_10k",        cat:"Revenue",     name:"$10K Serviced",      icon:"💵", pts:200,  desc:"First $10,000 in serviced revenue" },
  { id:"rev_25k",        cat:"Revenue",     name:"$25K Serviced",      icon:"💰", pts:400,  desc:"$25,000 in lifetime serviced revenue" },
  { id:"rev_50k",        cat:"Revenue",     name:"$50K Milestone",     icon:"🤑", pts:700,  desc:"$50,000 serviced — elite territory" },
  { id:"rev_100k",       cat:"Revenue",     name:"$100K Club",         icon:"🏦", pts:1200, desc:"$100,000 serviced — hall of fame" },

  // Clean Streaks (quality = retention = revenue)
  { id:"streak_1mo",     cat:"Clean Streak","name":"1-Month Clean",    icon:"✅", pts:150,  desc:"One full month with zero callbacks" },
  { id:"streak_2mo",     cat:"Clean Streak","name":"2-Month Clean",    icon:"🔵", pts:250,  desc:"Two months straight, no callbacks" },
  { id:"streak_3mo",     cat:"Clean Streak","name":"3-Month Clean",    icon:"🔥", pts:375,  desc:"Three months with zero callbacks" },
  { id:"streak_6mo",     cat:"Clean Streak","name":"6-Month Streak",   icon:"⚡", pts:600,  desc:"Six months clean — top tier quality" },
  { id:"streak_1yr",     cat:"Clean Streak","name":"Year of Zero",     icon:"🌟", pts:900,  desc:"A full year with zero callbacks" },

  // Shift Coverage (team first mentality)
  { id:"shift_cover",    cat:"Character",   name:"Shift Hero",         icon:"🫂", pts:175,  desc:"Covered 4+ extra shifts in a month outside normal schedule" },

  // The Prestige Badge
  { id:"perfect_detail", cat:"Prestige",    name:"The Perfect Detail", icon:"💎", pts:1000, desc:"On time every appt, 100% audit, zero callbacks, 1 review/day for a full week, all HCP pics + flyers + satisfaction cards attached" },

  // Performance
  { id:"switchover_5",   cat:"Performance", name:"Converter",          icon:"🔄", pts:150,  desc:"Converted 5 customers to service plans" },
  { id:"switchover_20",  cat:"Performance", name:"Subscription King",  icon:"📈", pts:400,  desc:"Converted 20 customers to service plans" },
  { id:"early_bird",     cat:"Character",   name:"Early Bird",         icon:"⏰", pts:100,  desc:"On time or early to every job for a full month" },
  { id:"customer_whisperer", cat:"Performance", name:"Customer Whisperer", icon:"🤝", pts:250, desc:"3 months straight of 5-star reviews with no gaps" },
];
const ALL_BADGE_DEFS = [...BADGE_DEFS, ...ROTATING_TROPHIES.map(t=>({...t,cat:"Trophy",pts:0}))];
const BADGE_MAP = Object.fromEntries(ALL_BADGE_DEFS.map(b => [b.id, b]));


const SERVICE_PLANS = [
  { id:"biannual",  label:"Bi-Annual",  freq:"2x/yr",   pts:15,  ltv:635  },
  { id:"quarterly", label:"Quarterly",  freq:"4x/yr",   pts:30,  ltv:1030 },
  { id:"bimonthly", label:"Bi-Monthly", freq:"6x/yr",   pts:50,  ltv:1425 },
  { id:"monthly",   label:"Monthly",    freq:"12x/yr",  pts:65,  ltv:2610 },
  { id:"biweekly",  label:"Bi-Weekly",  freq:"26x/yr",  pts:90,  ltv:3900 },
  { id:"weekly",    label:"Weekly",     freq:"52x/yr",  pts:120, ltv:5850 },
];
const PLAN_MAP = Object.fromEntries(SERVICE_PLANS.map(p => [p.id, p]));
const PLAN_COLORS = { biannual:C.green, quarterly:C.blue, bimonthly:C.purple, monthly:C.blue, biweekly:C.gold, weekly:C.orange };

const JOURNEY_TIERS = [
  { id:"bronze",   name:"BRONZE",   icon:"🥉", minPts:0,    maxPts:2499,   color:"#cd7f32", bg:"#1a1000", reward:"Tier 1 — $150",   perks:["$150 Skylo Cash","Badge tracking","Weekly upsells"] },
  { id:"silver",   name:"SILVER",   icon:"🥈", minPts:2500, maxPts:4499,   color:"#a8c0d6", bg:"#0e1520", reward:"Tier 2 — $300",   perks:["$300 Skylo Cash","Switchover bonuses","Monthly spotlight"] },
  { id:"gold",     name:"GOLD",     icon:"🥇", minPts:4500, maxPts:5999,   color:"#ffd600", bg:"#1a1400", reward:"Tier 3 — $600",   perks:["$600 Skylo Cash","Featured on board","Priority scheduling"] },
  { id:"platinum", name:"PLATINUM", icon:"💎", minPts:6000, maxPts:Infinity,color:"#c4b5fd", bg:"#0d0520", reward:"Tier 4 — $1,200", perks:["$1,200 Skylo Cash","Legend nomination","Annual award"] },
];
function getTier(pts) { return [...JOURNEY_TIERS].reverse().find(t => pts >= t.minPts) || JOURNEY_TIERS[0]; }

// ─── HELPERS ──────────────────────────────────────────────────────────────────
const calcBadgePts = (badges) => (badges||[]).reduce((s,id) => s+(BADGE_MAP[id]?.pts||0), 0);
const medal = (i) => i===0?"🥇":i===1?"🥈":i===2?"🥉":`#${i+1}`;

function getWeekKey() {
  // Week runs Mon–Sun, resets at Monday 12:00am MT (UTC-6 MDT)
  const mtOffset = 6 * 60 * 60 * 1000;
  const mt = new Date(Date.now() - mtOffset);
  const day = mt.getDay(); // 0=Sun,1=Mon,2=Tue...6=Sat
  // Days since last Monday (Sunday counts as 6 days after Monday)
  const daysBack = day === 0 ? 6 : day - 1;
  const monday = new Date(mt);
  monday.setDate(mt.getDate() - daysBack);
  const y = monday.getFullYear();
  const m = String(monday.getMonth()+1).padStart(2,"0");
  const d = String(monday.getDate()).padStart(2,"0");
  return `${y}-${m}-${d}`;
}
function getMonthKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}`;
}
function formatWeekLabel(key) {
  const d = new Date(key+"T00:00:00"), end = new Date(d);
  end.setDate(d.getDate()+6);
  const fmt = dt => dt.toLocaleDateString("en-US",{month:"short",day:"numeric"});
  return `${fmt(d)} – ${fmt(end)}`;
}
function formatMonthLabel(key) {
  const [y,m] = key.split("-");
  return new Date(y,m-1).toLocaleDateString("en-US",{month:"long",year:"numeric"});
}
function formatTenure(startDate) {
  if (!startDate) return null;
  const days = Math.floor((new Date()-new Date(startDate))/(1000*60*60*24));
  if (days < 30) return `${days}d`;
  if (days < 365) return `${Math.floor(days/30)}mo`;
  const yrs = Math.floor(days/365), mos = Math.floor((days%365)/30);
  return mos > 0 ? `${yrs}yr ${mos}mo` : `${yrs}yr`;
}
const TEAM_LEAD_OVERRIDE_PCT_PARTIAL = 0.05; // 5% if lead + 2/3 of team hits quota
const TEAM_LEAD_OVERRIDE_PCT_FULL    = 0.10; // 10% if lead + ALL of team hits quota

function calcTeamOverride(tech, allTechs, upsells, switchovers, reviews, callbacks, quota) {
  const teamMembers = allTechs.filter(t=>t.team_lead_id===tech.id);
  if (teamMembers.length===0) return { overridePts:0, overridePct:0, teamMembers:[], allTeamHit:false, partialHit:false, leadHitsQuota:false, teamMemberStats:[], hittingCount:0 };
  const q = quota || DEFAULT_QUOTA;
  const now = new Date(); const y=now.getFullYear(); const mo=String(now.getMonth()+1).padStart(2,"0");
  const mk = getMonthKey();

  const teamMemberStats = teamMembers.map(m=>{
    const monthUpsellAmt   = upsells.filter(u=>u.tech_id===m.id&&u.week_key?.startsWith(`${y}-${mo}`)).reduce((s,u)=>s+u.amount,0);
    const monthReviewCount = reviews.filter(r=>r.tech_id===m.id&&r.month_key===mk).reduce((s,r)=>s+r.count,0);
    const monthSwitchCount = switchovers.filter(s=>s.tech_id===m.id&&s.week_key?.startsWith(`${y}-${mo}`)).length;
    const upHit=monthUpsellAmt>=q.upsells, revHit=monthReviewCount>=q.reviews, swHit=monthSwitchCount>=q.switchovers;
    const tt = calcTotals(m,upsells,switchovers,reviews,callbacks);
    return { ...m, monthUpsellAmt, monthReviewCount, monthSwitchCount, upHit, revHit, swHit, allHit:upHit&&revHit&&swHit, total:tt.total };
  });

  // Lead's own quota
  const leadMonthUpsells  = upsells.filter(u=>u.tech_id===tech.id&&u.week_key?.startsWith(`${y}-${mo}`)).reduce((s,u)=>s+u.amount,0);
  const leadMonthReviews  = reviews.filter(r=>r.tech_id===tech.id&&r.month_key===mk).reduce((s,r)=>s+r.count,0);
  const leadMonthSwitches = switchovers.filter(s=>s.tech_id===tech.id&&s.week_key?.startsWith(`${y}-${mo}`)).length;
  const leadHitsQuota = leadMonthUpsells>=q.upsells && leadMonthReviews>=q.reviews && leadMonthSwitches>=q.switchovers;

  const hittingCount  = teamMemberStats.filter(m=>m.allHit).length;
  const totalMembers  = teamMembers.length;
  const allTeamHit    = leadHitsQuota && hittingCount === totalMembers;
  const twoThirdsHit  = leadHitsQuota && hittingCount >= Math.ceil(totalMembers * (2/3));
  const teamTotalPts  = teamMemberStats.reduce((s,m)=>s+m.total,0); // team members ONLY — lead excluded

  let overridePct = 0;
  if (allTeamHit)       overridePct = TEAM_LEAD_OVERRIDE_PCT_FULL;
  else if (twoThirdsHit) overridePct = TEAM_LEAD_OVERRIDE_PCT_PARTIAL;

  const overridePts = Math.round(teamTotalPts * overridePct);
  return { overridePts, overridePct, teamMembers, teamMemberStats, allTeamHit, partialHit:twoThirdsHit&&!allTeamHit, leadHitsQuota, teamTotalPts, hittingCount, totalMembers };
}

function calcTotals(tech, upsells, switchovers, reviews, callbacks=[]) {
  const badgePts = calcBadgePts(tech.badges);
  const upsellAmt = upsells.filter(u=>u.tech_id===tech.id).reduce((s,u)=>s+u.amount,0);
  const upsellPts = Math.round(upsellAmt*UPSELL_PTS_PER_DOLLAR);
  const switchPts = switchovers.filter(s=>s.tech_id===tech.id).reduce((s,sw)=>s+(PLAN_MAP[sw.plan_id]?.pts||0),0);
  const byMonth = {};
  reviews.filter(r=>r.tech_id===tech.id).forEach(r=>{ byMonth[r.month_key]=(byMonth[r.month_key]||0)+r.count; });
  const reviewPts = Object.values(byMonth).reduce((s,cnt)=>s+(cnt*REVIEW_PTS)+(cnt>=10?REVIEW_BONUS_PTS:0),0);
  const callbackCount = callbacks.filter(c=>c.tech_id===tech.id).length;
  const callbackPts = callbackCount * CALLBACK_PTS;
  const total = Math.max(0, badgePts+upsellPts+switchPts+reviewPts+callbackPts);
  return { badgePts, upsellAmt, upsellPts, switchPts, reviewPts, callbackPts, callbackCount, total };
}

// ─── WEEKLY PAY CALCULATOR ────────────────────────────────────────────────────
// Tiers reset each week. First $150 = 15%, then $300 = 20%, then $450 = 25%, then $700 = 30%
const PAY_TIERS = [
  { upTo: 150,  rate: 0.15, label: "0–$150",    color: C.green  },
  { upTo: 300,  rate: 0.20, label: "$150–$300",  color: C.blue   },
  { upTo: 450,  rate: 0.25, label: "$300–$450",  color: C.gold   },
  { upTo: 700,  rate: 0.30, label: "$450–$700",  color: C.orange },
];

function calcWeeklyPay(weeklyUpsellAmt) {
  // Flat rate unlocks and backfills ALL upsells for the week
  let rate;
  if      (weeklyUpsellAmt >= 700) rate = 0.30;
  else if (weeklyUpsellAmt >= 400) rate = 0.25;
  else if (weeklyUpsellAmt >= 150) rate = 0.20;
  else                              rate = 0.15;
  const totalPay = weeklyUpsellAmt * rate;
  return { totalPay, rate };
}

function getNextPayTier(weeklyAmt) {
  if (weeklyAmt < 150) return { amt: 150 - weeklyAmt, rate: 0.20, label: "20% on your whole week" };
  if (weeklyAmt < 400) return { amt: 400 - weeklyAmt, rate: 0.25, label: "25% on your whole week" };
  if (weeklyAmt < 700) return { amt: 700 - weeklyAmt, rate: 0.30, label: "30% on your whole week" };
  return { amt: null, rate: 0.30, label: "MAX RATE — 30% on your whole week 🔥" };
}


const GS = `
  @import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:ital,wght@0,400;0,600;0,700;0,800;0,900;1,700;1,800;1,900&family=Barlow:wght@400;500;600;700&display=swap');
  * { margin:0; padding:0; box-sizing:border-box; }
  body { background:#f0f8ff; color:#0d2240; font-family:'Barlow',sans-serif; -webkit-font-smoothing:antialiased; }
  ::-webkit-scrollbar { width:4px; } ::-webkit-scrollbar-track { background:#e8f4ff; } ::-webkit-scrollbar-thumb { background:#c5dff8; border-radius:2px; }
  input,select,button { font-family:'Barlow',sans-serif; }
  input[type=number]::-webkit-inner-spin-button { -webkit-appearance:none; }
  input, select { color-scheme: light; }
`;

// ─── BASE COMPONENTS ──────────────────────────────────────────────────────────
function Logo({ h=40 }) {
  return <img src={LOGO_SRC} alt="Skylo" style={{ height:`${h}px`, objectFit:"contain" }}/>;
}

function Header({ right, title, subtitle }) {
  return (
    <div style={{ background:C.white, borderBottom:`3px solid ${C.blue}`, padding:"0 20px", display:"flex", alignItems:"center", justifyContent:"space-between", height:"64px", boxShadow:"0 2px 12px rgba(43,156,240,0.12)" }}>
      <div style={{ display:"flex", alignItems:"center", gap:"14px" }}>
        <Logo h={36}/>
        {title && (
          <div>
            <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"900", fontStyle:"italic", fontSize:"18px", letterSpacing:"1px", textTransform:"uppercase", color:C.black, lineHeight:1 }}>{title}</div>
            {subtitle && <div style={{ fontSize:"10px", color:C.muted, letterSpacing:"2px", textTransform:"uppercase", marginTop:"2px" }}>{subtitle}</div>}
          </div>
        )}
      </div>
      {right}
    </div>
  );
}

function LogoutBtn({ onLogout }) {
  return (
    <button onClick={onLogout} style={{ background:"none", border:`2px solid ${C.border}`, color:C.muted, padding:"6px 16px", borderRadius:"20px", cursor:"pointer", fontSize:"11px", fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"700", letterSpacing:"2px", textTransform:"uppercase" }}>
      EXIT
    </button>
  );
}

function TabBar({ tabs, active, setActive, accent }) {
  const ac = accent || C.blue;
  return (
    <div style={{ display:"flex", background:C.white, borderBottom:`1px solid ${C.border}`, overflowX:"auto", WebkitOverflowScrolling:"touch", scrollbarWidth:"none", boxShadow:"0 1px 4px rgba(43,156,240,0.08)" }}>
      {tabs.map(([id,label]) => (
        <button key={id} onClick={()=>setActive(id)} style={{
          background:"none", border:"none", cursor:"pointer", whiteSpace:"nowrap",
          padding:"14px 18px", fontSize:"11px", letterSpacing:"2px", textTransform:"uppercase",
          fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"800",
          color:active===id?ac:C.muted, flexShrink:0,
          borderBottom:active===id?`3px solid ${ac}`:"3px solid transparent",
        }}>{label}</button>
      ))}
    </div>
  );
}

function Num({ val, size=32, color=C.white, unit="" }) {
  return (
    <div style={{ display:"flex", alignItems:"baseline", gap:"3px" }}>
      <span style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"900", fontSize:`${size}px`, color, lineHeight:1 }}>{val}</span>
      {unit && <span style={{ fontSize:`${size*0.45}px`, color:C.muted, fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"700" }}>{unit}</span>}
    </div>
  );
}

function StatBlock({ label, value, color, sub, accent }) {
  return (
    <div style={{ background:C.white, border:`1px solid ${C.border}`, borderTop:`3px solid ${accent||color||C.blue}`, borderRadius:"12px", padding:"16px", boxShadow:"0 2px 8px rgba(43,156,240,0.08)" }}>
      <div style={{ fontSize:"10px", color:C.muted, letterSpacing:"2px", textTransform:"uppercase", fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"700", marginBottom:"8px" }}>{label}</div>
      <Num val={value} color={color||C.black} size={28}/>
      {sub && <div style={{ fontSize:"11px", color:C.muted, marginTop:"5px" }}>{sub}</div>}
    </div>
  );
}

function Bar({ pct, color=C.blue, h=5 }) {
  return (
    <div style={{ background:C.border, borderRadius:"4px", height:`${h}px`, overflow:"hidden" }}>
      <div style={{ width:`${Math.min(pct,100)}%`, height:"100%", background:color, borderRadius:"4px" }}/>
    </div>
  );
}

function Label({ children, color=C.blue }) {
  return (
    <div style={{ fontSize:"11px", color, letterSpacing:"2px", textTransform:"uppercase", fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"900", fontStyle:"italic", marginBottom:"10px" }}>{children}</div>
  );
}

function Pill({ children, color=C.blue }) {
  return (
    <span style={{ display:"inline-block", background:`${color}22`, border:`1px solid ${color}55`, color, borderRadius:"3px", padding:"2px 8px", fontSize:"10px", fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"700", letterSpacing:"1px", textTransform:"uppercase" }}>
      {children}
    </span>
  );
}

// ─── PIN PAD ──────────────────────────────────────────────────────────────────
function PinPad({ onSubmit }) {
  const [pin, setPin] = useState("");
  const [shake, setShake] = useState(false);
  useEffect(() => {
    if (pin.length===4) {
      const ok = onSubmit(pin);
      if (!ok) { setShake(true); setTimeout(()=>{ setShake(false); setPin(""); },500); }
    }
  }, [pin]);
  const press = d => { if (pin.length<4) setPin(p=>p+d); };
  return (
    <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:"32px" }}>
      <div style={{ display:"flex", gap:"14px", animation:shake?"shake .4s ease":"none" }}>
        {[0,1,2,3].map(i=>(
          <div key={i} style={{ width:"16px", height:"16px", borderRadius:"50%", background:i<pin.length?C.blue:"transparent", border:`2px solid ${i<pin.length?C.blue:C.border}` }}/>
        ))}
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(3,72px)", gap:"10px" }}>
        {[1,2,3,4,5,6,7,8,9,"",0,"⌫"].map((d,i)=>(
          <button key={i} onClick={()=>d==="⌫"?setPin(p=>p.slice(0,-1)):d!==""?press(String(d)):null}
            disabled={d===""}
            style={{ width:"72px", height:"72px", borderRadius:"12px", background:d===""?"transparent":C.white, border:d===""?"none":`2px solid ${C.border}`, color:d==="⌫"?C.muted:C.black, fontSize:d==="⌫"?"20px":"24px", fontWeight:"700", cursor:d===""?"default":"pointer", fontFamily:"'Barlow Condensed',sans-serif", boxShadow:d===""?"none":"0 2px 8px rgba(43,156,240,0.12)" }}>
            {d}
          </button>
        ))}
      </div>
      <style>{`@keyframes shake{0%,100%{transform:translateX(0)}20%,60%{transform:translateX(-6px)}40%,80%{transform:translateX(6px)}}${GS}`}</style>
    </div>
  );
}

// ─── BADGE GRID ───────────────────────────────────────────────────────────────
function BadgeGrid({ earned }) {
  const cats = ["Prestige","Revenue","Clean Streak","Performance","Character","Tenure","Trophy"];
  const catColors = { Prestige:C.gold, Revenue:C.green, "Clean Streak":C.blue, Performance:C.purple, Character:C.orange, Tenure:C.muted, Trophy:"#ff6ef7" };
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:"24px" }}>
      {/* Rotating Trophies info */}
      <div style={{ background:"#ff6ef718", border:"1px solid #ff6ef744", borderRadius:"12px", padding:"12px 16px" }}>
        <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"900", fontSize:"13px", color:"#ff6ef7", letterSpacing:"2px", marginBottom:"6px" }}>🏆 ROTATING MONTHLY TROPHIES</div>
        <div style={{ fontSize:"12px", color:C.muted }}>These badges are passed to whoever is in the lead each month — no points, pure bragging rights.</div>
        <div style={{ display:"flex", gap:"8px", flexWrap:"wrap", marginTop:"10px" }}>
          {ROTATING_TROPHIES.map(t=>(
            <div key={t.id} style={{ background:earned?.includes(t.id)?"#ff6ef722":"rgba(0,0,0,0.2)", border:`1px solid ${earned?.includes(t.id)?"#ff6ef7":"#333"}`, borderRadius:"4px", padding:"6px 12px", opacity:earned?.includes(t.id)?1:0.5 }}>
              <span style={{ fontSize:"16px" }}>{t.icon}</span>
              <span style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"700", fontSize:"12px", color:earned?.includes(t.id)?"#ff6ef7":C.muted, marginLeft:"6px" }}>{t.name}</span>
            </div>
          ))}
        </div>
      </div>
      {cats.filter(c=>c!=="Trophy").map(cat=>{
        const badges = ALL_BADGE_DEFS.filter(b=>b.cat===cat);
        if (!badges.length) return null;
        const col = catColors[cat] || C.blue;
        return (
          <div key={cat}>
            <div style={{ fontSize:"10px", color:col, letterSpacing:"2px", textTransform:"uppercase", fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"800", marginBottom:"10px" }}>{cat}</div>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(160px,1fr))", gap:"8px" }}>
              {badges.map(b=>{
                const have = earned?.includes(b.id);
                return (
                  <div key={b.id} style={{ background:have?`${col}18`:"rgba(0,0,0,0.2)", border:`1px solid ${have?col+"55":C.border}`, borderRadius:"12px", padding:"10px 12px", opacity:have?1:0.45 }}>
                    <div style={{ fontSize:"22px", marginBottom:"5px" }}>{b.icon}</div>
                    <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"800", fontSize:"13px", color:have?C.white:C.muted }}>{b.name}</div>
                    <div style={{ fontSize:"10px", color:col, fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"700", marginTop:"2px" }}>{b.pts>0?`+${b.pts} pts`:"Trophy"}</div>
                    <div style={{ fontSize:"10px", color:C.muted, marginTop:"4px", lineHeight:"1.3" }}>{b.desc}</div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}


// ─── UPSELL LEADERBOARD ───────────────────────────────────────────────────────
function UpsellLeaderboard({ techs, upsells, currentId }) {
  const wk = getWeekKey();
  const byWeek = {};
  upsells.forEach(u=>{ if(!byWeek[u.week_key])byWeek[u.week_key]={}; byWeek[u.week_key][u.tech_id]=(byWeek[u.week_key][u.tech_id]||0)+u.amount; });
  const allWeeks = Object.keys(byWeek).sort((a,b)=>b.localeCompare(a));
  const [selectedWeek, setSelectedWeek] = useState(wk);
  const allTime = {};
  upsells.forEach(u=>{ allTime[u.tech_id]=(allTime[u.tech_id]||0)+u.amount; });

  // Selected week data
  const wkData = byWeek[selectedWeek]||{};
  const ranked = [...techs].map(t=>({...t,amt:wkData[t.id]||0,all:allTime[t.id]||0})).sort((a,b)=>b.amt-a.amt);
  const top = ranked[0]?.amt||1;
  const weekTotal = ranked.reduce((s,t)=>s+t.amt,0);

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:"20px" }}>

      {/* Week selector */}
      <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:"12px", padding:"14px 18px" }}>
        <Label color={C.green}>📅 Select Week</Label>
        <select
          value={selectedWeek}
          onChange={e=>setSelectedWeek(e.target.value)}
          style={{ background:C.cardLt, border:`1px solid ${C.border}`, color:C.black, padding:"10px 14px", borderRadius:"12px", fontSize:"14px", fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"700", width:"100%", cursor:"pointer" }}
        >
          {allWeeks.length === 0 && <option value={wk}>{formatWeekLabel(wk)} — Current Week</option>}
          {allWeeks.map(w=>(
            <option key={w} value={w}>{formatWeekLabel(w)}{w===wk?" — Current":""}</option>
          ))}
        </select>
      </div>

      {/* Selected week breakdown */}
      <div style={{ background:C.card, border:`1px solid ${selectedWeek===wk?C.blue:C.border}`, borderTop:`3px solid ${C.green}`, borderRadius:"12px", overflow:"hidden" }}>
        <div style={{ padding:"14px 18px", borderBottom:`1px solid ${C.border}`, background:C.cardLt, display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <div>
            <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"800", fontSize:"16px", color:C.black }}>{formatWeekLabel(selectedWeek)}</div>
            {selectedWeek===wk&&<div style={{ fontSize:"10px", color:C.blue, letterSpacing:"1px", textTransform:"uppercase", marginTop:"2px" }}>Current Week</div>}
          </div>
          <div style={{ textAlign:"right" }}>
            <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"900", fontSize:"24px", color:C.green }}>${weekTotal.toLocaleString()}</div>
            <div style={{ fontSize:"10px", color:C.muted, letterSpacing:"1px" }}>TEAM TOTAL</div>
          </div>
        </div>
        <div style={{ padding:"14px 18px", display:"flex", flexDirection:"column", gap:"8px" }}>
          {ranked.filter(t=>t.amt>0).map((t,idx)=>{
            const isMe=t.id===currentId; const pct=top>0?Math.round((t.amt/top)*100):0;
            return (
              <div key={t.id} style={{ background:idx===0?`${C.green}12`:isMe?`${C.blue}12`:"transparent", border:`1px solid ${idx===0?C.green:isMe?`${C.blue}44`:C.border}`, borderRadius:"12px", padding:"10px 12px" }}>
                <div style={{ display:"flex", alignItems:"center", gap:"12px", marginBottom:"6px" }}>
                  <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"900", fontStyle:"italic", fontSize:idx===0?"28px":idx<3?"22px":"16px", color:idx===0?C.green:idx===1?"#a8c0d6":idx===2?"#cd7f32":C.muted, width:"30px", textAlign:"center", lineHeight:1 }}>{medal(idx)}</div>
                  <div style={{ width:"36px", height:"36px", borderRadius:"50%", background:`${C.blue}22`, border:`1px solid ${C.blue}44`, display:"flex", alignItems:"center", justifyContent:"center", fontFamily:"'Barlow Condensed',sans-serif", fontSize:"12px", fontWeight:"800", color:C.blue, flexShrink:0 }}>{t.avatar}</div>
                  <div style={{ flex:1 }}>
                    <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"900", fontStyle:"italic", fontSize:"16px", color:C.black }}>{t.name}{isMe&&<span style={{ color:C.blue, fontSize:"11px", marginLeft:"6px", fontStyle:"normal" }}>YOU</span>}</div>
                    <div style={{ fontSize:"11px", color:C.muted }}>+{Math.round(t.amt*UPSELL_PTS_PER_DOLLAR)} pts this week</div>
                  </div>
                  <div style={{ textAlign:"right" }}>
                    <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"900", fontSize:"24px", color:idx===0?C.green:C.black }}>${t.amt.toLocaleString()}</div>
                  </div>
                </div>
                <Bar pct={pct} color={idx===0?C.green:C.blue} h={5}/>
              </div>
            );
          })}
          {ranked.filter(t=>t.amt===0).length>0&&(
            <div style={{ borderTop:`1px dashed ${C.border}`, paddingTop:"8px", marginTop:"4px" }}>
              <div style={{ fontSize:"10px", color:C.muted, letterSpacing:"2px", textTransform:"uppercase", fontFamily:"'Barlow Condensed',sans-serif", marginBottom:"6px" }}>No upsells logged yet this week</div>
              {ranked.filter(t=>t.amt===0).map(t=>{
                const isMe=t.id===currentId;
                return (
                  <div key={t.id} style={{ display:"flex", alignItems:"center", gap:"10px", padding:"6px 8px", opacity:0.5 }}>
                    <div style={{ width:"36px", height:"36px", borderRadius:"50%", background:C.cardLt, border:`1px solid ${C.border}`, display:"flex", alignItems:"center", justifyContent:"center", fontFamily:"'Barlow Condensed',sans-serif", fontSize:"12px", fontWeight:"800", color:C.muted }}>{t.avatar}</div>
                    <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"700", fontSize:"14px", color:C.muted }}>{t.name}{isMe&&" — YOU"}</div>
                    <div style={{ marginLeft:"auto", fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"800", fontSize:"14px", color:C.muted }}>$0</div>
                  </div>
                );
              })}
            </div>
          )}
          {weekTotal===0&&<div style={{ fontSize:"13px", color:C.muted, textAlign:"center", padding:"12px" }}>No upsells logged for this week yet</div>}
        </div>
      </div>

      {/* Running totals pinned at bottom */}
      <div style={{ background:C.card, border:`1px solid ${C.border}`, borderTop:`3px solid ${C.green}`, borderRadius:"12px", overflow:"hidden" }}>
        <div style={{ padding:"14px 18px", borderBottom:`1px solid ${C.border}`, background:C.cardLt }}>
          <Label color={C.green}>💰 Running Totals — All Time</Label>
        </div>
        <div style={{ padding:"14px 18px", display:"flex", flexDirection:"column", gap:"10px" }}>
          {[...techs].sort((a,b)=>(allTime[b.id]||0)-(allTime[a.id]||0)).map((t,i)=>{
            const amt=allTime[t.id]||0; const topAmt=Math.max(...techs.map(x=>allTime[x.id]||0))||1; const pct=Math.round((amt/topAmt)*100);
            return (
              <div key={t.id}>
                <div style={{ display:"flex", justifyContent:"space-between", marginBottom:"5px" }}>
                  <span style={{ fontSize:"13px", fontWeight:"600", color:t.id===currentId?C.blue:C.black }}>{medal(i)} {t.name}{t.id===currentId?" — YOU":""}</span>
                  <div style={{ textAlign:"right" }}>
                    <span style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"800", fontSize:"14px", color:C.black }}>${amt.toLocaleString()}</span>
                    <span style={{ fontSize:"11px", color:C.green, marginLeft:"8px" }}>{Math.round(amt*UPSELL_PTS_PER_DOLLAR).toLocaleString()} pts</span>
                  </div>
                </div>
                <Bar pct={pct} color={C.green}/>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── SWITCHOVER LEADERBOARD ───────────────────────────────────────────────────
function SwitchoverLeaderboard({ techs, switchovers, currentId }) {
  const [rankBy, setRankBy] = useState("count");
  const wk = getWeekKey();
  const byWeek = {};
  switchovers.forEach(s=>{ if(!byWeek[s.week_key])byWeek[s.week_key]={}; if(!byWeek[s.week_key][s.tech_id])byWeek[s.week_key][s.tech_id]=[]; byWeek[s.week_key][s.tech_id].push({plan:s.plan_id}); });
  const allWeeks = Object.keys(byWeek).sort((a,b)=>b.localeCompare(a));
  const wkData = byWeek[wk]||{};
  const allCount={}, allPts={};
  switchovers.forEach(s=>{ allCount[s.tech_id]=(allCount[s.tech_id]||0)+1; allPts[s.tech_id]=(allPts[s.tech_id]||0)+(PLAN_MAP[s.plan_id]?.pts||0); });
  const ranked = [...techs].map(t=>{ const e=wkData[t.id]||[]; return {...t,count:e.length,pts:e.reduce((s,x)=>s+(PLAN_MAP[x.plan]?.pts||0),0),allCount:allCount[t.id]||0,allPts:allPts[t.id]||0,entries:e}; }).sort((a,b)=>rankBy==="count"?b.count-a.count:b.pts-a.pts);
  const top=ranked[0]?.[rankBy==="count"?"count":"pts"]||1;
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:"24px" }}>
      <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:"12px", overflow:"hidden" }}>
        <div style={{ padding:"14px 18px", borderBottom:`1px solid ${C.border}` }}><Label color={C.purple}>🔄 All-Time Switchovers</Label></div>
        <div style={{ padding:"14px 18px", display:"flex", flexDirection:"column", gap:"8px" }}>
          {[...techs].sort((a,b)=>(allPts[b.id]||0)-(allPts[a.id]||0)).map((t,i)=>(
            <div key={t.id} style={{ display:"flex", justifyContent:"space-between" }}>
              <span style={{ fontSize:"13px", color:t.id===currentId?C.blue:C.black }}>{medal(i)} {t.name}{t.id===currentId?" — YOU":""}</span>
              <span style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"800", fontSize:"13px", color:C.black }}>{allCount[t.id]||0} converts · {(allPts[t.id]||0).toLocaleString()} pts</span>
            </div>
          ))}
        </div>
      </div>
      <div>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:"12px" }}>
          <Label>This Week · {formatWeekLabel(wk)}</Label>
          <div style={{ display:"flex", gap:"6px" }}>
            {[["count","COUNT"],["pts","POINTS"]].map(([id,label])=>(
              <button key={id} onClick={()=>setRankBy(id)} style={{ background:rankBy===id?C.blue:"none", border:`1px solid ${rankBy===id?C.blue:C.border}`, color:rankBy===id?C.white:C.muted, padding:"4px 10px", borderRadius:"4px", cursor:"pointer", fontSize:"10px", fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"700", letterSpacing:"1px" }}>{label}</button>
            ))}
          </div>
        </div>
        <div style={{ display:"flex", flexDirection:"column", gap:"8px" }}>
          {ranked.map((t,idx)=>{
            const isMe=t.id===currentId; const val=rankBy==="count"?t.count:t.pts; const pct=top>0?Math.round((val/top)*100):0;
            return (
              <div key={t.id} style={{ background:isMe?`${C.blue}18`:C.card, border:`1px solid ${isMe?C.blue:C.border}`, borderRadius:"12px", padding:"14px 18px" }}>
                <div style={{ display:"flex", alignItems:"center", gap:"12px", marginBottom:"10px" }}>
                  <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"900", fontSize:idx<3?"22px":"14px", color:C.muted, width:"28px", textAlign:"center" }}>{medal(idx)}</div>
                  <div style={{ width:"38px", height:"38px", borderRadius:"50%", background:`${C.blue}22`, border:`1px solid ${C.blue}44`, display:"flex", alignItems:"center", justifyContent:"center", fontFamily:"'Barlow Condensed',sans-serif", fontSize:"12px", fontWeight:"800", color:C.blue, flexShrink:0 }}>{t.avatar}</div>
                  <div style={{ flex:1 }}>
                    <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"800", fontSize:"16px", color:C.black }}>{t.name}{isMe&&<span style={{ color:C.blue, fontSize:"11px", marginLeft:"6px" }}>YOU</span>}</div>
                    <div style={{ fontSize:"11px", color:C.muted }}>All-time: {t.allCount} converts · {t.allPts.toLocaleString()} pts</div>
                  </div>
                  <div style={{ textAlign:"right" }}>
                    <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"900", fontSize:"24px", color:t.count>0?C.white:C.border }}>{t.count}</div>
                    <div style={{ fontSize:"11px", color:C.purple }}>+{t.pts} pts</div>
                  </div>
                </div>
                <Bar pct={pct} color={C.purple}/>
                {t.entries.length>0&&(
                  <div style={{ display:"flex", flexWrap:"wrap", gap:"5px", marginTop:"10px" }}>
                    {t.entries.map((e,i)=>{ const plan=PLAN_MAP[e.plan]; const pc=PLAN_COLORS[e.plan]||C.muted; return plan?(<span key={i} style={{ background:`${pc}22`, border:`1px solid ${pc}55`, borderLeft:`3px solid ${pc}`, borderRadius:"3px", padding:"2px 8px", fontSize:"11px", color:C.black, fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"700" }}>{plan.label} +{plan.pts}pts</span>):null; })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
      <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:"12px", padding:"14px 18px" }}>
        <Label color={C.purple}>Plan Values</Label>
        <div style={{ display:"flex", flexWrap:"wrap", gap:"6px" }}>
          {SERVICE_PLANS.map(p=>{ const pc=PLAN_COLORS[p.id]; return (
            <div key={p.id} style={{ background:`${pc}15`, border:`1px solid ${pc}44`, borderLeft:`3px solid ${pc}`, borderRadius:"4px", padding:"4px 10px", fontSize:"12px" }}>
              <span style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"800", color:C.black }}>{p.label} </span>
              <span style={{ color:C.muted }}>{p.freq} </span>
              <span style={{ color:pc, fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"700" }}>+{p.pts}pts </span>
              <span style={{ color:C.green, fontFamily:"'Barlow Condensed',sans-serif" }}>${p.ltv.toLocaleString()}/yr LTV</span>
            </div>
          ); })}
        </div>
      </div>
    </div>
  );
}

// ─── REVIEW LEADERBOARD ───────────────────────────────────────────────────────
function ReviewLeaderboard({ techs, reviews, currentId }) {
  const mk = getMonthKey();
  const byMonth = {};
  reviews.forEach(r=>{ if(!byMonth[r.month_key])byMonth[r.month_key]={}; byMonth[r.month_key][r.tech_id]=(byMonth[r.month_key][r.tech_id]||0)+r.count; });
  const allMonths = Object.keys(byMonth).sort((a,b)=>b.localeCompare(a));
  const [selectedMonth, setSelectedMonth] = useState(mk);
  const allTime = {};
  reviews.forEach(r=>{ allTime[r.tech_id]=(allTime[r.tech_id]||0)+r.count; });

  const mData = byMonth[selectedMonth]||{};
  const ranked = [...techs].map(t=>({...t,cnt:mData[t.id]||0})).sort((a,b)=>b.cnt-a.cnt);
  const top = ranked[0]?.cnt||1;
  const monthTotal = ranked.reduce((s,t)=>s+t.cnt,0);

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:"20px" }}>
      {/* Points info */}
      <div style={{ background:`${C.gold}18`, border:`1px solid ${C.gold}44`, borderRadius:"12px", padding:"12px 18px", display:"flex", gap:"24px", flexWrap:"wrap" }}>
        <div><span style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"900", fontSize:"20px", color:C.gold }}>+{REVIEW_PTS}</span><span style={{ fontSize:"12px", color:C.muted, marginLeft:"6px" }}>pts per review</span></div>
        <div><span style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"900", fontSize:"20px", color:C.gold }}>+{REVIEW_BONUS_PTS}</span><span style={{ fontSize:"12px", color:C.muted, marginLeft:"6px" }}>bonus at 10+ in a month</span></div>
      </div>

      {/* Month selector */}
      <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:"12px", padding:"14px 18px" }}>
        <Label color={C.gold}>📅 Select Month</Label>
        <select
          value={selectedMonth}
          onChange={e=>setSelectedMonth(e.target.value)}
          style={{ background:C.cardLt, border:`1px solid ${C.border}`, color:C.black, padding:"10px 14px", borderRadius:"12px", fontSize:"14px", fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"700", width:"100%", cursor:"pointer" }}
        >
          {allMonths.length === 0 && <option value={mk}>{formatMonthLabel(mk)} — Current Month</option>}
          {allMonths.map(m=>(
            <option key={m} value={m}>{formatMonthLabel(m)}{m===mk?" — Current":""}</option>
          ))}
        </select>
      </div>

      {/* Selected month breakdown */}
      <div style={{ background:C.card, border:`1px solid ${selectedMonth===mk?C.gold:C.border}`, borderTop:`3px solid ${C.gold}`, borderRadius:"12px", overflow:"hidden" }}>
        <div style={{ padding:"14px 18px", borderBottom:`1px solid ${C.border}`, background:C.cardLt, display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <div>
            <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"800", fontSize:"16px", color:C.black }}>{formatMonthLabel(selectedMonth)}</div>
            {selectedMonth===mk&&<div style={{ fontSize:"10px", color:C.gold, letterSpacing:"1px", textTransform:"uppercase", marginTop:"2px" }}>Current Month</div>}
          </div>
          <div style={{ textAlign:"right" }}>
            <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"900", fontSize:"24px", color:C.gold }}>{monthTotal} ⭐</div>
            <div style={{ fontSize:"10px", color:C.muted, letterSpacing:"1px" }}>TEAM TOTAL</div>
          </div>
        </div>
        <div style={{ padding:"14px 18px", display:"flex", flexDirection:"column", gap:"10px" }}>
          {ranked.map((t,idx)=>{
            const isMe=t.id===currentId; const pct=top>0?Math.round((t.cnt/top)*100):0; const bonus=t.cnt>=10;
            return (
              <div key={t.id} style={{ background:isMe?`${C.blue}18`:"transparent", border:isMe?`1px solid ${C.blue}44`:"1px solid transparent", borderRadius:"12px", padding:"10px 12px" }}>
                <div style={{ display:"flex", alignItems:"center", gap:"12px", marginBottom:"8px" }}>
                  <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"900", fontSize:idx<3?"20px":"13px", color:C.muted, width:"26px", textAlign:"center" }}>{medal(idx)}</div>
                  <div style={{ width:"36px", height:"36px", borderRadius:"50%", background:`${C.blue}22`, border:`1px solid ${C.blue}44`, display:"flex", alignItems:"center", justifyContent:"center", fontFamily:"'Barlow Condensed',sans-serif", fontSize:"12px", fontWeight:"800", color:C.blue, flexShrink:0 }}>{t.avatar}</div>
                  <div style={{ flex:1 }}>
                    <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"800", fontSize:"15px", color:C.black }}>{t.name}{isMe&&<span style={{ color:C.blue, fontSize:"11px", marginLeft:"6px" }}>YOU</span>}</div>
                    <div style={{ fontSize:"11px", color:C.muted }}>+{(t.cnt*REVIEW_PTS)+(bonus?REVIEW_BONUS_PTS:0)} pts{bonus?" 🔥":""}</div>
                  </div>
                  <div style={{ textAlign:"right" }}>
                    <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"900", fontSize:"22px", color:t.cnt>0?C.gold:C.border }}>{t.cnt} ⭐</div>
                  </div>
                </div>
                <Bar pct={pct} color={C.gold} h={4}/>
                {bonus&&<div style={{ marginTop:"6px" }}><Pill color={C.gold}>🔥 Bonus unlocked</Pill></div>}
              </div>
            );
          })}
          {monthTotal===0&&<div style={{ fontSize:"13px", color:C.muted, textAlign:"center", padding:"12px" }}>No reviews logged for this month</div>}
        </div>
      </div>

      {/* Running totals pinned at bottom */}
      <div style={{ background:C.card, border:`1px solid ${C.border}`, borderTop:`3px solid ${C.gold}`, borderRadius:"12px", overflow:"hidden" }}>
        <div style={{ padding:"14px 18px", borderBottom:`1px solid ${C.border}`, background:C.cardLt }}>
          <Label color={C.gold}>⭐ Running Totals — All Time</Label>
        </div>
        <div style={{ padding:"14px 18px", display:"flex", flexDirection:"column", gap:"10px" }}>
          {[...techs].sort((a,b)=>(allTime[b.id]||0)-(allTime[a.id]||0)).map((t,i)=>{
            const cnt=allTime[t.id]||0; const topCnt=Math.max(...techs.map(x=>allTime[x.id]||0))||1; const pct=Math.round((cnt/topCnt)*100);
            return (
              <div key={t.id}>
                <div style={{ display:"flex", justifyContent:"space-between", marginBottom:"5px" }}>
                  <span style={{ fontSize:"13px", color:t.id===currentId?C.blue:C.black }}>{medal(i)} {t.name}{t.id===currentId?" — YOU":""}</span>
                  <span style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"800", fontSize:"14px", color:C.black }}>{cnt} ⭐</span>
                </div>
                <Bar pct={pct} color={C.gold}/>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── TOTAL LEADERBOARD ────────────────────────────────────────────────────────
function TotalLeaderboard({ techs, upsells, switchovers, reviews, callbacks }) {
  const ranked = [...techs].map(t=>{ const tt=calcTotals(t,upsells,switchovers,reviews,callbacks||[]); return {...t,...tt,tier:getTier(tt.total)}; }).sort((a,b)=>b.total-a.total);
  const top = ranked[0]?.total||1;
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:"8px" }}>
      {ranked.map((t,idx)=>{
        const pct=Math.round((t.total/top)*100);
        return (
          <div key={t.id} style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:"12px", padding:"16px 18px" }}>
            <div style={{ display:"flex", alignItems:"center", gap:"12px", marginBottom:"12px" }}>
              <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"900", fontSize:idx<3?"26px":"16px", color:C.muted, width:"32px", textAlign:"center" }}>{medal(idx)}</div>
              <div style={{ width:"42px", height:"42px", borderRadius:"50%", background:`${C.blue}22`, border:`1px solid ${C.blue}44`, display:"flex", alignItems:"center", justifyContent:"center", fontFamily:"'Barlow Condensed',sans-serif", fontSize:"13px", fontWeight:"800", color:C.blue, flexShrink:0 }}>{t.avatar}</div>
              <div style={{ flex:1 }}>
                <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"800", fontSize:"18px", color:C.black }}>{t.name}</div>
                <Pill color={t.tier.color}>{t.tier.icon} {t.tier.name}</Pill>
              </div>
              <div style={{ textAlign:"right" }}>
                <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"900", fontSize:"28px", color:C.black }}>{t.total.toLocaleString()}</div>
                <div style={{ fontSize:"10px", color:C.muted, letterSpacing:"1px" }}>TOTAL PTS</div>
              </div>
            </div>
            <Bar pct={pct} color={C.blue} h={4}/>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:"6px", marginTop:"10px" }}>
              {[
                {l:"Badges",    v:t.badgePts,               c:C.purple},
                {l:"Upsells",   v:`$${Math.round(t.upsellAmt).toLocaleString()}`, c:C.green},
                {l:"Converts",  v:t.switchPts,              c:C.blue},
                {l:"Reviews",   v:t.reviewPts,              c:C.gold},
              ].map(item=>(
                <div key={item.l} style={{ background:C.cardLt, borderRadius:"4px", padding:"8px", textAlign:"center" }}>
                  <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"800", fontSize:"15px", color:item.c }}>{item.v}</div>
                  <div style={{ fontSize:"9px", color:C.muted, letterSpacing:"1px", textTransform:"uppercase" }}>{item.l}</div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── JOURNEY BOARD ────────────────────────────────────────────────────────────
function JourneyBoard({ techs, upsells, switchovers, reviews, quota, callbacks }) {
  const [selected, setSelected] = useState(null);
  const mk = getMonthKey();
  const ranked = [...techs].map(t=>{
    const tt=calcTotals(t,upsells,switchovers,reviews,callbacks||[]);
    const tier=getTier(tt.total);
    const nextTier=JOURNEY_TIERS.find(t2=>t2.minPts>tt.total);
    const ptsToNext=nextTier?nextTier.minPts-tt.total:0;
    const tierPct=nextTier?Math.round(((tt.total-tier.minPts)/(nextTier.minPts-tier.minPts))*100):100;
    const totalReviews=reviews.filter(r=>r.tech_id===t.id).reduce((s,r)=>s+r.count,0);
    const totalSwitches=switchovers.filter(s=>s.tech_id===t.id).length;
    // This month's actuals
    const monthUpsells = upsells.filter(u=>u.tech_id===t.id && u.week_key && u.week_key >= mk.replace("-","")).reduce((s,u)=>s+u.amount, 0);
    // Use week_key to approximate month — find all weeks in current month
    const monthUpsellAmt = (() => {
      const now = new Date(); const y = now.getFullYear(); const m = String(now.getMonth()+1).padStart(2,"0");
      return upsells.filter(u=>u.tech_id===t.id && u.week_key && u.week_key.startsWith(`${y}-${m}`)).reduce((s,u)=>s+u.amount,0);
    })();
    const monthReviewCount = reviews.filter(r=>r.tech_id===t.id && r.month_key===mk).reduce((s,r)=>s+r.count,0);
    const monthSwitchCount = switchovers.filter(s=>s.tech_id===t.id && s.week_key && (() => { const now=new Date(); const y=now.getFullYear(); const m=String(now.getMonth()+1).padStart(2,"0"); return s.week_key.startsWith(`${y}-${m}`); })()).length;
    return {...t,...tt,tier,nextTier,ptsToNext,tierPct,totalReviews,totalSwitches,monthUpsellAmt,monthReviewCount,monthSwitchCount};
  }).sort((a,b)=>b.total-a.total);

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:"20px" }}>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(300px,1fr))", gap:"12px" }}>
        {ranked.map((t,idx)=>(
          <JourneyCard key={t.id} tech={t} rank={idx+1} total={ranked.length} upsells={upsells}
            quota={quota||DEFAULT_QUOTA}
            onClick={()=>setSelected(selected===t.id?null:t.id)} expanded={selected===t.id}/>
        ))}
      </div>
      <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:"12px", padding:"16px 18px" }}>
        <Label>Arena Tiers</Label>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(180px,1fr))", gap:"8px" }}>
          {JOURNEY_TIERS.map(tier=>(
            <div key={tier.id} style={{ background:tier.bg, border:`1px solid ${tier.color}33`, borderLeft:`3px solid ${tier.color}`, borderRadius:"12px", padding:"12px" }}>
              <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"900", fontSize:"20px", color:tier.color, letterSpacing:"2px" }}>{tier.icon} {tier.name}</div>
              <div style={{ fontSize:"10px", color:C.muted, fontFamily:"'Barlow Condensed',sans-serif", marginBottom:"4px" }}>
                {tier.maxPts===Infinity?`${tier.minPts.toLocaleString()}+ pts`:`${tier.minPts.toLocaleString()} – ${tier.maxPts.toLocaleString()} pts`}
              </div>
              <div style={{ fontSize:"11px", color:tier.color, fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"700" }}>🎁 {tier.reward}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function JourneyCard({ tech, rank, total, onClick, expanded, upsells, quota }) {
  const tier = tech.tier;
  const tenure = formatTenure(tech.start_date);
  const earnedBadges = ALL_BADGE_DEFS.filter(b=>tech.badges?.includes(b.id));
  const q = quota || DEFAULT_QUOTA;
  
  // Current week pay breakdown
  const wk = getWeekKey();
  const weekUpsellAmt = (upsells||[]).filter(u=>u.tech_id===tech.id&&u.week_key===wk).reduce((s,u)=>s+u.amount,0);
  const { totalPay, breakdown } = calcWeeklyPay(weekUpsellAmt);
  const nextPayTier = getNextPayTier(weekUpsellAmt);

  // Month quota tracking
  const upPct     = Math.min(Math.round((tech.monthUpsellAmt / q.upsells) * 100), 100);
  const revPct    = Math.min(Math.round((tech.monthReviewCount / q.reviews) * 100), 100);
  const swPct     = Math.min(Math.round((tech.monthSwitchCount / q.switchovers) * 100), 100);
  const upHit     = tech.monthUpsellAmt >= q.upsells;
  const revHit    = tech.monthReviewCount >= q.reviews;
  const swHit     = tech.monthSwitchCount >= q.switchovers;
  const allHit    = upHit && revHit && swHit;
  const hitsCount = [upHit, revHit, swHit].filter(Boolean).length;

  return (
    <div onClick={onClick} style={{ background:C.white, border:`2px solid ${allHit ? "#00c853" : tier.color}44`, borderTop:`3px solid ${allHit ? "#00c853" : tier.color}`, borderRadius:"12px", cursor:"pointer", overflow:"hidden", boxShadow:"0 2px 10px rgba(43,156,240,0.08)" }}>
      <div style={{ padding:"16px 18px" }}>
        <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", marginBottom:"14px" }}>
          <div>
            <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"900", fontStyle:"italic", fontSize:"22px", color:C.black, lineHeight:1 }}>{tech.name}</div>
            <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"800", fontSize:"13px", color:tier.color, letterSpacing:"2px", marginTop:"3px" }}>{tier.icon} {tier.name} ARENA</div>
            {tenure&&<div style={{ fontSize:"10px", color:C.muted, marginTop:"3px" }}>⏱ {tenure} with Skylo</div>}
          </div>
          <div style={{ textAlign:"right" }}>
            <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"900", fontStyle:"italic", fontSize:"30px", color:C.blue, lineHeight:1 }}>{tech.total.toLocaleString()}</div>
            <div style={{ fontSize:"10px", color:C.muted, letterSpacing:"1px" }}>PTS</div>
            <div style={{ fontSize:"10px", color:tier.color, fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"700", marginTop:"2px" }}>#{rank} of {total}</div>
          </div>
        </div>

        {/* ── MONTHLY QUOTA TRACKER ── */}
        <div style={{ background:allHit?`${C.green}12`:`${C.blue}08`, border:`1px solid ${allHit?C.green:C.border}`, borderRadius:"10px", padding:"12px 14px", marginBottom:"14px" }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:"10px" }}>
            <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"900", fontStyle:"italic", fontSize:"12px", color:allHit?C.green:C.black, letterSpacing:"2px", textTransform:"uppercase" }}>
              {allHit ? "✅ QUOTA HIT THIS MONTH" : `📊 MONTHLY QUOTA — ${hitsCount}/3`}
            </div>
            <div style={{ fontSize:"10px", color:C.muted }}>{formatMonthLabel(getMonthKey())}</div>
          </div>
          {[
            { label:"Upsells",     actual:`$${tech.monthUpsellAmt}`,       target:`$${q.upsells}`,  pct:upPct,  hit:upHit,  color:C.green  },
            { label:"Reviews",     actual:tech.monthReviewCount,            target:q.reviews,        pct:revPct, hit:revHit, color:C.gold   },
            { label:"Switchovers", actual:tech.monthSwitchCount,            target:q.switchovers,    pct:swPct,  hit:swHit,  color:C.blue   },
          ].map(row=>(
            <div key={row.label} style={{ marginBottom:"8px" }}>
              <div style={{ display:"flex", justifyContent:"space-between", marginBottom:"3px" }}>
                <span style={{ fontSize:"11px", color:C.muted, fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"700" }}>{row.label}</span>
                <span style={{ fontSize:"11px", fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"900", color:row.hit?C.green:C.black }}>
                  {row.actual} <span style={{ color:C.muted, fontWeight:"600" }}>/ {row.target}</span>
                  {row.hit && <span style={{ color:C.green, marginLeft:"4px" }}>✓</span>}
                </span>
              </div>
              <div style={{ background:C.border, borderRadius:"4px", height:"5px", overflow:"hidden" }}>
                <div style={{ width:`${row.pct}%`, height:"100%", background:row.hit?C.green:row.color, borderRadius:"4px", transition:"width 0.3s" }}/>
              </div>
            </div>
          ))}
        </div>

        {tech.nextTier?(
          <div style={{ background:`${tier.color}12`, border:`1px solid ${tier.color}44`, borderRadius:"10px", padding:"12px 14px", marginBottom:"14px" }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:"8px" }}>
              <div>
                <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"900", fontStyle:"italic", fontSize:"13px", color:tier.color, letterSpacing:"1px" }}>🎯 WORKING TOWARD</div>
                <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"900", fontSize:"22px", color:C.black, lineHeight:1, marginTop:"2px" }}>{tech.nextTier.reward}</div>
              </div>
              <div style={{ textAlign:"right", flexShrink:0 }}>
                <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"900", fontSize:"22px", color:tier.color, lineHeight:1 }}>{tech.ptsToNext.toLocaleString()}</div>
                <div style={{ fontSize:"10px", color:C.muted, letterSpacing:"1px" }}>PTS TO GO</div>
              </div>
            </div>
            <Bar pct={tech.tierPct} color={tier.color} h={7}/>
            <div style={{ fontSize:"10px", color:C.muted, marginTop:"5px" }}>{tech.tierPct}% of the way there · {tech.total.toLocaleString()} / {tech.nextTier.minPts.toLocaleString()} pts</div>
          </div>
        ):(
          <div style={{ marginBottom:"14px", background:`${tier.color}18`, border:`1px solid ${tier.color}44`, borderRadius:"8px", padding:"8px 12px", textAlign:"center" }}>
            <span style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"900", fontSize:"13px", color:tier.color, letterSpacing:"2px" }}>💎 PLATINUM STATUS ACHIEVED</span>
          </div>
        )}
        <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:"6px" }}>
          {[
            {l:"Badges",   v:tech.badges?.length||0,        c:C.purple},
            {l:"Upsells",  v:`$${Math.round(tech.upsellAmt).toLocaleString()}`, c:C.green},
            {l:"Converts", v:tech.totalSwitches,        c:C.blue},
            {l:"Reviews",  v:tech.totalReviews,         c:C.gold},
          ].map(s=>(
            <div key={s.l} style={{ background:C.cardLt, borderRadius:"8px", padding:"8px 4px", textAlign:"center" }}>
              <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"900", fontSize:"16px", color:s.c }}>{s.v}</div>
              <div style={{ fontSize:"9px", color:C.muted, letterSpacing:"1px", textTransform:"uppercase" }}>{s.l}</div>
            </div>
          ))}
        </div>
        {expanded&&(
          <div style={{ borderTop:`1px solid ${C.border}`, paddingTop:"14px", marginTop:"14px", display:"flex", flexDirection:"column", gap:"12px" }}>
            
            {/* 💵 Weekly Pay Scale */}
            <div style={{ background:C.cardLt, borderRadius:"12px", padding:"12px 14px", border:`1px solid ${C.green}44` }}>
              <div style={{ fontSize:"10px", color:C.green, letterSpacing:"2px", textTransform:"uppercase", fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"900", fontStyle:"italic", marginBottom:"10px" }}>💵 This Week's Pay Scale</div>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline", marginBottom:"10px" }}>
                <span style={{ fontSize:"12px", color:C.muted }}>Week upsells</span>
                <span style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"900", fontSize:"20px", color:C.black }}>${weekUpsellAmt.toLocaleString()}</span>
              </div>
              {/* Pay scale — backfill display */}
              <div style={{ display:"flex", flexDirection:"column", gap:"4px", marginBottom:"8px" }}>
                {(()=>{
                  const { rate } = calcWeeklyPay(weekUpsellAmt);
                  const currentPct = Math.round(rate*100);
                  return [
                    { floor:0,   ceil:150,      baseRate:15, label:"$1–$149"    },
                    { floor:150, ceil:400,       baseRate:20, label:"$150–$399" },
                    { floor:400, ceil:700,       baseRate:25, label:"$400–$699" },
                    { floor:700, ceil:Infinity,  baseRate:30, label:"$700+"      },
                  ].map(b=>{
                    const isCurrent    = weekUpsellAmt >= b.floor && (b.ceil===Infinity ? true : weekUpsellAmt < b.ceil);
                    const isPast       = b.ceil !== Infinity && weekUpsellAmt >= b.ceil;
                    const isLocked     = weekUpsellAmt < b.floor;
                    const backfilled   = isPast && currentPct > b.baseRate;
                    const displayRate  = isLocked ? b.baseRate : currentPct;
                    return (
                      <div key={b.label} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", background:isCurrent?`${C.green}22`:isPast?`${C.green}08`:"transparent", border:isCurrent?`1px solid ${C.green}55`:"1px solid transparent", borderRadius:"6px", padding:"6px 10px" }}>
                        <div style={{ display:"flex", alignItems:"center", gap:"6px" }}>
                          <span style={{ fontSize:"11px", color:isCurrent?C.green:isPast?C.black:C.muted, fontFamily:"'Barlow Condensed',sans-serif", fontWeight:isCurrent?"900":"600" }}>{b.label}</span>
                          {isCurrent && <span style={{ fontSize:"9px", background:C.green, color:C.white, borderRadius:"8px", padding:"1px 7px", fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"900" }}>YOUR TIER</span>}
                          {backfilled && <span style={{ fontSize:"9px", background:`${C.green}22`, color:C.green, borderRadius:"8px", padding:"1px 7px", fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"800" }}>↑ BACKFILLED</span>}
                        </div>
                        <div style={{ display:"flex", alignItems:"center", gap:"5px" }}>
                          {backfilled && <span style={{ fontSize:"10px", color:C.muted, textDecoration:"line-through", fontFamily:"'Barlow Condensed',sans-serif" }}>{b.baseRate}%</span>}
                          <span style={{ fontSize:"13px", color:isLocked?C.muted:C.green, fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"900" }}>{displayRate}%</span>
                        </div>
                      </div>
                    );
                  });
                })()}
              </div>
              <div style={{ borderTop:`1px solid ${C.green}33`, paddingTop:"8px", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                <span style={{ fontSize:"12px", color:C.muted }}>Est. upsell bonus <span style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"800", color:C.black }}>({Math.round(calcWeeklyPay(weekUpsellAmt).rate*100)}% × ${weekUpsellAmt})</span></span>
                <span style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"900", fontSize:"22px", color:C.green }}>${totalPay.toFixed(2)}</span>
              </div>
              {nextPayTier&&(
                <div style={{ marginTop:"8px", background:nextPayTier.amt===null?`${C.green}18`:`${C.gold}18`, border:`1px solid ${nextPayTier.amt===null?C.green:C.gold}44`, borderRadius:"8px", padding:"6px 10px", fontSize:"11px", color:nextPayTier.amt===null?C.green:C.gold, fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"700" }}>
                  {nextPayTier.amt===null
                    ? `🔥 ${nextPayTier.label}`
                    : `💡 Upsell $${nextPayTier.amt.toFixed(0)} more to unlock ${nextPayTier.label}`}
                </div>
              )}
            </div>

            <div>
              <Label color={tier.color}>Points Breakdown</Label>
              {[
                {l:"Badge Points",      v:tech.badgePts,   c:C.purple},
                {l:"Upsell Points",     v:tech.upsellPts,  c:C.green},
                {l:"Switchover Points", v:tech.switchPts,  c:C.blue},
                {l:"Review Points",     v:tech.reviewPts,  c:C.gold},
              ].map(item=>(
                <div key={item.l} style={{ display:"flex", justifyContent:"space-between", marginBottom:"6px" }}>
                  <span style={{ fontSize:"12px", color:C.muted }}>{item.l}</span>
                  <span style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"800", fontSize:"14px", color:item.c }}>{item.v.toLocaleString()}</span>
                </div>
              ))}
            </div>
            {tech.start_date&&(
              <div style={{ background:C.cardLt, borderRadius:"8px", padding:"10px 12px", display:"flex", justifyContent:"space-between" }}>
                <span style={{ fontSize:"12px", color:C.muted }}>Started</span>
                <span style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"700", fontSize:"13px", color:C.black }}>{new Date(tech.start_date+"T00:00:00").toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"})} · {tenure}</span>
              </div>
            )}
            {earnedBadges.length>0&&(
              <div>
                <Label color={tier.color}>Badges</Label>
                <div style={{ display:"flex", flexWrap:"wrap", gap:"5px" }}>
                  {earnedBadges.map(b=>(
                    <span key={b.id} style={{ background:`${tier.color}18`, border:`1px solid ${tier.color}44`, borderRadius:"6px", padding:"3px 10px", fontSize:"11px", color:C.black, fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"700" }}>{b.icon} {b.name}</span>
                  ))}
                </div>
              </div>
            )}
            <div>
              <Label color={tier.color}>Current Perks</Label>
              {tier.perks.map((p,i)=>(
                <div key={i} style={{ fontSize:"12px", color:C.black, display:"flex", alignItems:"center", gap:"6px", marginBottom:"4px" }}>
                  <span style={{ color:tier.color, fontWeight:"900" }}>✓</span>{p}
                </div>
              ))}
            </div>
          </div>
        )}
        <div style={{ textAlign:"center", marginTop:"12px", fontSize:"10px", color:C.muted, letterSpacing:"1px" }}>
          {expanded?"▲ COLLAPSE":"▼ EXPAND"}
        </div>
      </div>
    </div>
  );
}


// ─── KYLE BONUS + QUOTA SETTINGS ─────────────────────────────────────────────
function QuotaSettings({ quota, onSave, saving }) {
  const [form, setForm] = useState({ ...quota });
  const inp = { background:C.white, border:`1px solid ${C.border}`, color:C.black, padding:"10px 14px", borderRadius:"8px", fontSize:"16px", fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"700", width:"100%", boxSizing:"border-box" };
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:"16px" }}>
      <div style={{ background:C.white, border:`1px solid ${C.border}`, borderTop:`3px solid ${C.blue}`, borderRadius:"12px", padding:"20px", display:"flex", flexDirection:"column", gap:"14px", boxShadow:"0 2px 8px rgba(43,156,240,0.08)" }}>
        <Label color={C.blue}>📋 Monthly Quota Targets</Label>
        <div style={{ fontSize:"13px", color:C.muted }}>Set the baseline expectation for each tech per month. These show up on every Journey card so techs always know what they're working toward.</div>
        {[
          { key:"upsells",     label:"Upsell Target",      icon:"💰", suffix:"$ / month",  desc:"Minimum upsell revenue expected per tech" },
          { key:"reviews",     label:"Review Target",       icon:"⭐", suffix:"reviews / month", desc:"Minimum Google reviews expected" },
          { key:"switchovers", label:"Switchover Target",   icon:"🔄", suffix:"converts / month", desc:"Minimum service plan conversions expected" },
        ].map(f=>(
          <div key={f.key}>
            <div style={{ display:"flex", justifyContent:"space-between", marginBottom:"6px" }}>
              <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"800", fontSize:"14px", color:C.black }}>{f.icon} {f.label}</div>
              <div style={{ fontSize:"11px", color:C.muted }}>{f.desc}</div>
            </div>
            <div style={{ display:"flex", alignItems:"center", gap:"10px" }}>
              <input type="number" value={form[f.key]} min={0}
                onChange={e=>setForm(v=>({...v,[f.key]:Number(e.target.value)}))}
                style={inp}/>
              <span style={{ fontSize:"12px", color:C.muted, whiteSpace:"nowrap", fontFamily:"'Barlow Condensed',sans-serif" }}>{f.suffix}</span>
            </div>
          </div>
        ))}
        <button disabled={saving} onClick={()=>onSave(form)}
          style={{ background:saving?C.border:C.blue, border:"none", color:C.white, padding:"13px", borderRadius:"24px", cursor:saving?"not-allowed":"pointer", fontSize:"14px", fontWeight:"900", fontStyle:"italic", letterSpacing:"2px", fontFamily:"'Barlow Condensed',sans-serif", textTransform:"uppercase" }}>
          {saving?"Saving...":"Save Quota Targets"}
        </button>
      </div>
      <div style={{ background:`${C.blue}10`, border:`1px solid ${C.border}`, borderRadius:"12px", padding:"16px 18px" }}>
        <Label color={C.blue}>💡 Kyle's Bonus Rule</Label>
        <div style={{ fontSize:"13px", color:C.black, marginBottom:"6px" }}>When <strong>{Math.round(KYLE_BONUS_THRESHOLD*100)}% or more of techs hit all 3 quotas</strong> in a month, Kyle earns <strong style={{ color:C.green }}>5% of the total team upsell revenue</strong> for that month.</div>
        <div style={{ fontSize:"12px", color:C.muted }}>The more the team upsells, the more Kyle earns — no cap. He's incentivized to coach everyone to their max, not just hit a threshold.</div>
      </div>
    </div>
  );
}

function KyleBonusTab({ techs, upsells, switchovers, reviews, quota }) {
  const mk = getMonthKey();
  const q = quota || DEFAULT_QUOTA;

  const techStats = techs.map(t => {
    const now = new Date(); const y = now.getFullYear(); const m = String(now.getMonth()+1).padStart(2,"0");
    const monthUpsellAmt   = upsells.filter(u=>u.tech_id===t.id && u.week_key?.startsWith(`${y}-${m}`)).reduce((s,u)=>s+u.amount,0);
    const monthReviewCount = reviews.filter(r=>r.tech_id===t.id && r.month_key===mk).reduce((s,r)=>s+r.count,0);
    const monthSwitchCount = switchovers.filter(s=>s.tech_id===t.id && s.week_key?.startsWith(`${y}-${m}`)).length;
    const upHit  = monthUpsellAmt   >= q.upsells;
    const revHit = monthReviewCount >= q.reviews;
    const swHit  = monthSwitchCount >= q.switchovers;
    const allHit = upHit && revHit && swHit;
    return { ...t, monthUpsellAmt, monthReviewCount, monthSwitchCount, upHit, revHit, swHit, allHit, hitsCount:[upHit,revHit,swHit].filter(Boolean).length };
  });

  const hittingCount  = techStats.filter(t=>t.allHit).length;
  const totalTechs    = techs.length;
  const hitRate       = totalTechs > 0 ? hittingCount / totalTechs : 0;
  const kyleBonusHit  = hitRate >= KYLE_BONUS_THRESHOLD;
  const pctDisplay    = Math.round(hitRate * 100);
  const neededForBonus = Math.ceil(KYLE_BONUS_THRESHOLD * totalTechs);

  // Total team upsell revenue this month
  const now2 = new Date(); const y2 = now2.getFullYear(); const mo2 = String(now2.getMonth()+1).padStart(2,"0");
  const monthTeamUpsells = upsells.filter(u=>u.week_key?.startsWith(`${y2}-${mo2}`)).reduce((s,u)=>s+u.amount,0);
  const kyleBonusAmt = Math.round(monthTeamUpsells * KYLE_BONUS_PCT * 100) / 100;

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:"16px" }}>
      {/* Kyle's bonus status */}
      <div style={{ background:kyleBonusHit?`${C.green}15`:C.white, border:`2px solid ${kyleBonusHit?C.green:C.border}`, borderTop:`3px solid ${kyleBonusHit?C.green:C.blue}`, borderRadius:"12px", padding:"20px", boxShadow:"0 2px 8px rgba(43,156,240,0.08)" }}>
        <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"900", fontStyle:"italic", fontSize:"13px", color:kyleBonusHit?C.green:C.muted, letterSpacing:"2px", textTransform:"uppercase", marginBottom:"6px" }}>
          {kyleBonusHit ? "🎉 BONUS UNLOCKED" : "⏳ BONUS IN PROGRESS"}
        </div>
        <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"900", fontStyle:"italic", fontSize:"36px", color:kyleBonusHit?C.green:C.black, lineHeight:1, marginBottom:"4px" }}>
          {kyleBonusHit ? `$${kyleBonusAmt.toFixed(2)} EARNED` : `$${kyleBonusAmt.toFixed(2)} PROJECTED`}
        </div>
        <div style={{ fontSize:"12px", color:C.muted, marginBottom:"4px" }}>
          5% of ${monthTeamUpsells.toLocaleString()} team upsells this month
        </div>
        <div style={{ fontSize:"13px", color:C.muted, marginBottom:"16px" }}>
          {kyleBonusHit
            ? `${hittingCount} of ${totalTechs} techs hit all quotas — great coaching, Kyle.`
            : `${hittingCount} of ${totalTechs} techs on quota. Need ${neededForBonus - hittingCount} more to unlock.`}
        </div>
        <div style={{ marginBottom:"8px" }}>
          <div style={{ display:"flex", justifyContent:"space-between", marginBottom:"4px" }}>
            <span style={{ fontSize:"11px", color:C.muted, fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"700" }}>TEAM QUOTA RATE</span>
            <span style={{ fontSize:"11px", fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"900", color:kyleBonusHit?C.green:C.black }}>{pctDisplay}% <span style={{ color:C.muted }}>/</span> {Math.round(KYLE_BONUS_THRESHOLD*100)}% needed</span>
          </div>
          <div style={{ background:C.border, borderRadius:"6px", height:"10px", overflow:"hidden" }}>
            <div style={{ width:`${Math.min(pctDisplay,100)}%`, height:"100%", background:kyleBonusHit?C.green:C.blue, borderRadius:"6px" }}/>
          </div>
          <div style={{ display:"flex", justifyContent:"flex-end", marginTop:"3px" }}>
            <div style={{ width:`${KYLE_BONUS_THRESHOLD*100}%`, borderRight:`2px dashed ${C.muted}`, height:"6px", marginTop:"-3px" }}/>
          </div>
        </div>
        <div style={{ background:C.cardLt, border:`1px solid ${C.border}`, borderRadius:"8px", padding:"10px 12px", marginTop:"12px" }}>
          <div style={{ display:"flex", justifyContent:"space-between", fontSize:"12px", color:C.muted, marginBottom:"4px" }}>
            <span>Team upsells this month</span>
            <span style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"800", color:C.black }}>${monthTeamUpsells.toLocaleString()}</span>
          </div>
          <div style={{ display:"flex", justifyContent:"space-between", fontSize:"12px", color:C.muted, marginBottom:"4px" }}>
            <span>Kyle's rate</span>
            <span style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"800", color:C.black }}>{Math.round(KYLE_BONUS_PCT*100)}%</span>
          </div>
          <div style={{ display:"flex", justifyContent:"space-between", fontSize:"13px", borderTop:`1px solid ${C.border}`, paddingTop:"6px", marginTop:"4px" }}>
            <span style={{ fontWeight:"700", color:C.black }}>Kyle's bonus</span>
            <span style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"900", fontSize:"16px", color:kyleBonusHit?C.green:C.muted }}>${kyleBonusAmt.toFixed(2)} {!kyleBonusHit&&"(locked)"}</span>
          </div>
        </div>
        <div style={{ fontSize:"11px", color:C.muted, marginTop:"10px" }}>Month: {formatMonthLabel(mk)} · Unlocks when {Math.round(KYLE_BONUS_THRESHOLD*100)}% of techs hit all 3 quotas</div>
      </div>

      {/* Per-tech quota breakdown */}
      <div style={{ background:C.white, border:`1px solid ${C.border}`, borderRadius:"12px", overflow:"hidden", boxShadow:"0 2px 8px rgba(43,156,240,0.08)" }}>
        <div style={{ padding:"14px 18px", borderBottom:`1px solid ${C.border}`, background:C.cardLt }}>
          <Label color={C.blue}>📊 This Month's Quota Status — {formatMonthLabel(mk)}</Label>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:"8px", marginTop:"4px" }}>
            {[
              { label:"Upsell Quota",      val:`$${q.upsells}/mo`,    color:C.green },
              { label:"Review Quota",      val:`${q.reviews}/mo`,     color:C.gold  },
              { label:"Switchover Quota",  val:`${q.switchovers}/mo`, color:C.blue  },
            ].map(item=>(
              <div key={item.label} style={{ background:C.white, border:`1px solid ${C.border}`, borderRadius:"8px", padding:"8px 10px", textAlign:"center" }}>
                <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"900", fontSize:"16px", color:item.color }}>{item.val}</div>
                <div style={{ fontSize:"9px", color:C.muted, textTransform:"uppercase", letterSpacing:"1px" }}>{item.label}</div>
              </div>
            ))}
          </div>
        </div>
        <div style={{ padding:"14px 18px", display:"flex", flexDirection:"column", gap:"10px" }}>
          {techStats.map(t=>(
            <div key={t.id} style={{ background:t.allHit?`${C.green}10`:C.cardLt, border:`1px solid ${t.allHit?C.green:C.border}`, borderRadius:"10px", padding:"12px 14px" }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:"8px" }}>
                <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"900", fontStyle:"italic", fontSize:"16px", color:C.black }}>{t.name}</div>
                <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"900", fontSize:"13px", color:t.allHit?C.green:C.muted }}>
                  {t.allHit ? "✅ ALL HIT" : `${t.hitsCount}/3`}
                </div>
              </div>
              <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:"6px" }}>
                {[
                  { label:"Upsells",    val:`$${t.monthUpsellAmt}`,  target:`$${q.upsells}`,  hit:t.upHit,  color:C.green },
                  { label:"Reviews",    val:t.monthReviewCount,       target:q.reviews,         hit:t.revHit, color:C.gold  },
                  { label:"Converts",   val:t.monthSwitchCount,       target:q.switchovers,     hit:t.swHit,  color:C.blue  },
                ].map(col=>(
                  <div key={col.label} style={{ background:col.hit?`${col.color}15`:C.white, border:`1px solid ${col.hit?col.color:C.border}`, borderRadius:"6px", padding:"6px 8px", textAlign:"center" }}>
                    <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"900", fontSize:"15px", color:col.hit?col.color:C.black }}>{col.val}{col.hit?" ✓":""}</div>
                    <div style={{ fontSize:"9px", color:C.muted, textTransform:"uppercase", letterSpacing:"1px" }}>{col.label} / {col.target}</div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── TEAM LEAD PANEL ─────────────────────────────────────────────────────────
function TeamLeadPanel({ tech, techs, upsells, switchovers, reviews, callbacks, quota }) {
  const q = quota || DEFAULT_QUOTA;
  const { overridePts, overridePct, teamMemberStats, allTeamHit, partialHit, leadHitsQuota, teamTotalPts, hittingCount, totalMembers } = calcTeamOverride(tech, techs, upsells, switchovers, reviews, callbacks, q);
  const teamMembers = techs.filter(t=>t.team_lead_id===tech.id);
  if (teamMembers.length===0) return null;
  const mk = getMonthKey();
  const neededForPartial = Math.ceil(totalMembers * (2/3));
  const statusColor = allTeamHit ? C.green : partialHit ? C.gold : C.muted;
  const statusLabel = allTeamHit ? "🏆 10% OVERRIDE UNLOCKED" : partialHit ? "⚡ 5% OVERRIDE UNLOCKED" : "⏳ TEAM LEAD OVERRIDE";

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:"14px" }}>

      {/* Override status card */}
      <div style={{ background:(allTeamHit||partialHit)?`${statusColor}12`:C.white, border:`2px solid ${(allTeamHit||partialHit)?statusColor:C.border}`, borderTop:`4px solid ${statusColor}`, borderRadius:"16px", padding:"18px 20px", boxShadow:"0 4px 16px rgba(43,156,240,0.10)" }}>
        <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"900", fontStyle:"italic", fontSize:"13px", color:statusColor, letterSpacing:"2px", marginBottom:"6px" }}>
          {statusLabel}
        </div>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:"14px" }}>
          <div>
            <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"900", fontStyle:"italic", fontSize:"36px", color:(allTeamHit||partialHit)?statusColor:C.black, lineHeight:1 }}>
              {overridePts>0 ? `+${overridePts.toLocaleString()} PTS` : "LOCKED"}
            </div>
            <div style={{ fontSize:"12px", color:C.muted, marginTop:"4px" }}>
              {overridePct>0?`${Math.round(overridePct*100)}% of your team's ${teamTotalPts.toLocaleString()} pts (your pts not included)`:"Hit quota targets to unlock"}
            </div>
          </div>
          <div style={{ textAlign:"right" }}>
            <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"900", fontSize:"22px", color:C.black }}>{hittingCount}/{totalMembers}</div>
            <div style={{ fontSize:"10px", color:C.muted, letterSpacing:"1px" }}>ON QUOTA</div>
          </div>
        </div>

        {/* Tier breakdown */}
        <div style={{ display:"flex", flexDirection:"column", gap:"8px", marginBottom:"14px" }}>
          {[
            { label:"Your own quota hit", hit:leadHitsQuota, required:true },
            { label:`${neededForPartial}/${totalMembers} team members hit quota → 5% override`, hit:hittingCount>=neededForPartial, active:partialHit||allTeamHit },
            { label:`All ${totalMembers}/${totalMembers} team members hit quota → 10% override`, hit:allTeamHit, active:allTeamHit },
          ].map((row,i)=>(
            <div key={i} style={{ display:"flex", alignItems:"center", gap:"8px", background:row.hit?`${C.green}10`:`${C.border}50`, border:`1px solid ${row.hit?C.green:C.border}`, borderRadius:"8px", padding:"8px 12px" }}>
              <span style={{ color:row.hit?C.green:"#ef4444", fontSize:"18px", flexShrink:0 }}>{row.hit?"✓":"✗"}</span>
              <span style={{ fontSize:"12px", color:row.hit?C.black:C.muted, fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"700" }}>{row.label}</span>
              {row.hit&&i>0&&<span style={{ marginLeft:"auto", fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"900", fontSize:"12px", color:C.green }}>+{Math.round(teamTotalPts*(i===1?0.05:0.10))} pts</span>}
            </div>
          ))}
        </div>

        {!leadHitsQuota&&(
          <div style={{ fontSize:"12px", color:C.muted, fontStyle:"italic" }}>Hit your own quota first to unlock any override.</div>
        )}
        {leadHitsQuota&&!partialHit&&(
          <div style={{ fontSize:"12px", color:C.muted, fontStyle:"italic" }}>Get {neededForPartial-hittingCount} more teammate{neededForPartial-hittingCount>1?"s":""} to quota to unlock 5%.</div>
        )}
        {partialHit&&!allTeamHit&&(
          <div style={{ fontSize:"12px", color:C.gold, fontStyle:"italic", fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"700" }}>5% unlocked! Get {totalMembers-hittingCount} more to quota for the full 10%.</div>
        )}
      </div>

      {/* Team member quota status */}
      <div style={{ background:C.white, border:`1px solid ${C.border}`, borderRadius:"12px", overflow:"hidden", boxShadow:"0 2px 8px rgba(43,156,240,0.08)" }}>
        <div style={{ padding:"14px 18px", borderBottom:`1px solid ${C.border}`, background:C.cardLt }}>
          <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"900", fontStyle:"italic", fontSize:"14px", color:C.black, letterSpacing:"1px" }}>👥 YOUR TEAM — {formatMonthLabel(mk)}</div>
          <div style={{ fontSize:"11px", color:C.muted, marginTop:"2px" }}>Motivate your guys to hit all 3 before month end</div>
        </div>
        <div style={{ padding:"14px 18px", display:"flex", flexDirection:"column", gap:"10px" }}>
          {teamMemberStats.map(m=>(
            <div key={m.id} style={{ background:m.allHit?`${C.green}10`:C.cardLt, border:`1px solid ${m.allHit?C.green:C.border}`, borderRadius:"10px", padding:"12px 14px" }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:"8px" }}>
                <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"900", fontStyle:"italic", fontSize:"16px", color:C.black }}>{m.name}</div>
                <span style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"900", fontSize:"12px", color:m.allHit?C.green:C.muted }}>
                  {m.allHit?"✅ ALL HIT":`${[m.upHit,m.revHit,m.swHit].filter(Boolean).length}/3`}
                </span>
              </div>
              <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:"6px" }}>
                {[
                  { label:"Upsells",   val:`$${m.monthUpsellAmt}`,  target:`$${q.upsells}`,  hit:m.upHit,  color:C.green },
                  { label:"Reviews",   val:m.monthReviewCount,       target:q.reviews,         hit:m.revHit, color:C.gold  },
                  { label:"Converts",  val:m.monthSwitchCount,       target:q.switchovers,     hit:m.swHit,  color:C.blue  },
                ].map(col=>(
                  <div key={col.label} style={{ background:col.hit?`${col.color}15`:C.white, border:`1px solid ${col.hit?col.color:C.border}`, borderRadius:"6px", padding:"6px 8px", textAlign:"center" }}>
                    <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"900", fontSize:"14px", color:col.hit?col.color:C.black }}>{col.val}{col.hit?" ✓":""}</div>
                    <div style={{ fontSize:"9px", color:C.muted, textTransform:"uppercase", letterSpacing:"1px" }}>{col.label} / {col.target}</div>
                  </div>
                ))}
              </div>
              <div style={{ marginTop:"8px", display:"flex", justifyContent:"space-between", fontSize:"11px", color:C.muted }}>
                <span>Total pts: <strong style={{ color:C.black, fontFamily:"'Barlow Condensed',sans-serif" }}>{m.total.toLocaleString()}</strong></span>
                <span>Your cut: <strong style={{ color:C.gold, fontFamily:"'Barlow Condensed',sans-serif" }}>+{Math.round(m.total*TEAM_LEAD_OVERRIDE_PCT)} pts</strong> {!allTeamHit&&"(if unlocked)"}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── INCENTIVE BOARD ─────────────────────────────────────────────────────────
const INCENTIVE_TIERS = [
  {
    pts: 2500,
    prize: "$150",
    color: "#cd7f32",
    icon: "🔥",
    name: "IGNITION",
    tagline: "3–4 months of solid work. You've earned it.",
    items: [
      { name:"Fresh Kicks",              desc:"$150 toward Nike Air Forces, Jordans, or your shoe of choice", img:"https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=400&h=240&fit=crop&auto=format" },
      { name:"Premium Apparel",          desc:"$150 to spend on gear, fits, or streetwear", img:"https://images.unsplash.com/photo-1523381210434-271e8be1f52b?w=400&h=240&fit=crop&auto=format" },
      { name:"Lagoon Pass or Adventure", desc:"Day pass to local attraction or adventure experience", img:"https://images.unsplash.com/photo-1504701954957-2010ec3bcec1?w=400&h=240&fit=crop&auto=format" },
      { name:"Cash",                     desc:"$150 straight cash — no questions asked", img:"https://images.unsplash.com/photo-1554672408-730436b60dde?w=400&h=240&fit=crop&auto=format" },
      { name:"Gift Cards",               desc:"$150 in gift cards to the stores you actually shop at", img:"https://images.unsplash.com/photo-1556742502-ec7c0e9f34b1?w=400&h=240&fit=crop&auto=format" },
    ],
  },
  {
    pts: 4500,
    prize: "$300",
    color: "#a8c0d6",
    icon: "⚡",
    name: "VOLTAGE",
    tagline: "6–7 months in. The team is noticing.",
    items: [
      { name:"Ray-Bans or Designer Shades", desc:"Premium sunglasses — Tom Ford, Oakley, Ray-Ban", img:"https://images.unsplash.com/photo-1473496169904-658ba7574b0d?w=400&h=240&fit=crop&auto=format" },
      { name:"Designer Cologne",           desc:"Tom Ford, Chanel, or your signature scent — up to $300", img:"https://images.unsplash.com/photo-1541643600914-78b084683702?w=400&h=240&fit=crop&auto=format" },
      { name:"Cash",                        desc:"$300 straight cash — spend it how you want", img:"https://images.unsplash.com/photo-1554672408-730436b60dde?w=400&h=240&fit=crop&auto=format" },
      { name:"Xbox or Gaming Bundle",       desc:"New Xbox or $300 gaming store credit", img:"https://images.unsplash.com/photo-1605979257913-1704eb7b6246?w=400&h=240&fit=crop&auto=format" },
      { name:"Hotel Weekend",               desc:"2-night hotel stay anywhere in-state with your person", img:"https://images.unsplash.com/photo-1551882547-ff40c63fe5fa?w=400&h=240&fit=crop&auto=format" },
    ],
  },
  {
    pts: 6000,
    prize: "$600",
    color: "#ffd600",
    icon: "🏆",
    name: "OVERDRIVE",
    tagline: "9 months of excellence. Elite territory.",
    items: [
      { name:"Insta360 X5 Camera",         desc:"The sickest action cam — full kit", img:"https://images.unsplash.com/photo-1516035069371-29a1b244cc32?w=400&h=240&fit=crop&auto=format" },
      { name:"Apple Watch",                 desc:"Latest Apple Watch — your pick of model", img:"https://images.unsplash.com/photo-1434493789847-2f02dc6ca35d?w=400&h=240&fit=crop&auto=format" },
      { name:"Flights + Trip",              desc:"Domestic flights + hotel — pick your destination", img:"https://images.unsplash.com/photo-1436491865332-7a61a109cc05?w=400&h=240&fit=crop&auto=format" },
      { name:"Car Parts Fund",              desc:"$600 toward wheels, tires, suspension, or your build", img:"https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=400&h=240&fit=crop&auto=format" },
      { name:"Cash",                        desc:"$600 in your pocket — no strings attached", img:"https://images.unsplash.com/photo-1554672408-730436b60dde?w=400&h=240&fit=crop&auto=format" },
    ],
  },
  {
    pts: 8000,
    prize: "$1,200",
    color: "#c4b5fd",
    icon: "👑",
    name: "LEGEND",
    tagline: "A full year of being the best. One of one.",
    items: [
      { name:"All-Inclusive Resort",        desc:"Cancun, Dominican Republic, or your pick — you + a guest", img:"https://images.unsplash.com/photo-1571896349842-33c89424de2d?w=400&h=240&fit=crop&auto=format" },
      { name:"S&P 500 / Roth IRA Contribution", desc:"$1,200 invested directly into your future — stocks or retirement", img:"https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3?w=400&h=240&fit=crop&auto=format" },
      { name:"Performance Car Build",       desc:"$1,200 no-questions-asked contribution to your car build", img:"https://images.unsplash.com/photo-1544636331-e26879cd4d9b?w=400&h=240&fit=crop&auto=format" },
      { name:"VIP Concert + Hotel",         desc:"Floor seats to a major show + hotel night for you and a +1", img:"https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=400&h=240&fit=crop&auto=format" },
      { name:"Paid Time Off Bonus",         desc:"Take time off + $1,200 spending money — you earned it", img:"https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=400&h=240&fit=crop&auto=format" },
    ],
  },
];

function IncentiveBoard({ techs, upsells, switchovers, reviews, callbacks, currentId }) {
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:"16px" }}>
      <div style={{ background:C.card, border:`1px solid ${C.border}`, borderTop:`3px solid ${C.blue}`, borderRadius:"12px", padding:"16px 18px" }}>
        <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"900", fontStyle:"italic", fontSize:"28px", color:C.black, letterSpacing:"2px", marginBottom:"4px" }}>SKYLO REWARDS PROGRAM</div>
        <div style={{ fontSize:"13px", color:C.muted, marginBottom:"8px" }}>Stack your points from upsells, switchovers, reviews, and badges. Hit a tier, claim your Skylo Cash — then your points reset and the grind starts again.</div>
        <div style={{ background:`${C.blue}12`, border:`1px solid ${C.border}`, borderRadius:"8px", padding:"10px 14px", fontSize:"12px", color:C.muted, display:"flex", gap:"6px", alignItems:"flex-start" }}>
          <span style={{ color:C.blue, fontSize:"14px" }}>ℹ️</span>
          <span><strong style={{ color:C.black }}>How it works:</strong> Every $2 upselled = 1 pt. Reviews are 5 pts each (+20 bonus at 10/mo). Switchovers are 15–120 pts by plan. Hit 2,500 pts ($150) · 4,500 pts ($300) · 6,000 pts ($600) · 8,000 pts ($1,200) — then points reset and you climb again.</span>
        </div>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(2,1fr)", gap:"8px", marginTop:"14px" }}>
          {[
            {l:"Upsells",    v:"$2 = 1 pt",        c:C.green},
            {l:"Reviews",    v:"5 pts each",        c:C.gold},
            {l:"Switchovers",v:"15–120 pts",        c:C.purple},
            {l:"Badges",     v:"40–1,000 pts",      c:C.blue},
          ].map(item=>(
            <div key={item.l} style={{ background:C.cardLt, borderRadius:"4px", padding:"8px 12px", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
              <span style={{ fontSize:"12px", color:C.muted }}>{item.l}</span>
              <span style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"800", fontSize:"14px", color:item.c }}>{item.v}</span>
            </div>
          ))}
        </div>
      </div>

      {INCENTIVE_TIERS.map((tier, ti) => {
        const myTotal = currentId ? (() => {
          const tech = techs?.find(t=>t.id===currentId);
          if (!tech) return 0;
          return calcTotals(tech, upsells, switchovers, reviews, callbacks).total;
        })() : null;
        const unlocked = myTotal !== null && myTotal >= tier.pts;
        const progress = myTotal !== null ? Math.min(Math.round((myTotal / tier.pts) * 100), 100) : null;
        const prevPts = ti === 0 ? 0 : INCENTIVE_TIERS[ti-1].pts;
        const tierProgress = myTotal !== null ? Math.min(Math.round(((myTotal - prevPts) / (tier.pts - prevPts)) * 100), 100) : null;

        return (
          <div key={tier.name} style={{ background:C.card, border:`1px solid ${unlocked ? tier.color+"66" : C.border}`, borderTop:`4px solid ${tier.color}`, borderRadius:"12px", overflow:"hidden", opacity: unlocked || myTotal === null ? 1 : 0.85 }}>
            <div style={{ padding:"16px 18px", borderBottom:`1px solid ${C.border}`, display:"flex", alignItems:"center", justifyContent:"space-between" }}>
              <div>
                <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"900", fontSize:"28px", color:tier.color, letterSpacing:"3px", lineHeight:1 }}>{tier.icon} {tier.name}</div>
                <div style={{ fontSize:"12px", color:C.muted, marginTop:"3px" }}>{tier.tagline}</div>
              </div>
              <div style={{ textAlign:"right" }}>
                <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"900", fontSize:"38px", color:C.black, lineHeight:1 }}>{tier.prize}</div>
                <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontSize:"12px", color:tier.color, fontWeight:"700", letterSpacing:"1px" }}>{tier.pts.toLocaleString()} PTS REQUIRED</div>
              </div>
            </div>

            {myTotal !== null && (
              <div style={{ padding:"12px 18px", borderBottom:`1px solid ${C.border}`, background:C.cardLt }}>
                {unlocked ? (
                  <div style={{ display:"flex", alignItems:"center", gap:"10px" }}>
                    <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"900", fontSize:"14px", color:tier.color, letterSpacing:"2px" }}>✅ UNLOCKED — SEE ADMIN TO CLAIM</div>
                  </div>
                ) : (
                  <div>
                    <div style={{ display:"flex", justifyContent:"space-between", marginBottom:"6px" }}>
                      <span style={{ fontSize:"11px", color:C.muted, letterSpacing:"1px", textTransform:"uppercase" }}>Progress</span>
                      <span style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"800", fontSize:"12px", color:tier.color }}>{(tier.pts - myTotal).toLocaleString()} pts away</span>
                    </div>
                    <div style={{ background:C.border, borderRadius:"2px", height:"6px", overflow:"hidden" }}>
                      <div style={{ width:`${Math.max(tierProgress||0,0)}%`, height:"100%", background:tier.color, borderRadius:"2px" }}/>
                    </div>
                    <div style={{ fontSize:"10px", color:C.muted, marginTop:"4px" }}>{Math.max(tierProgress||0,0)}% of the way there</div>
                  </div>
                )}
              </div>
            )}

            <div style={{ padding:"14px 18px" }}>
              <div style={{ fontSize:"10px", color:C.muted, letterSpacing:"2px", textTransform:"uppercase", fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"700", marginBottom:"12px" }}>Choose Your Reward</div>
              <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(150px,1fr))", gap:"10px" }}>
                {tier.items.map(item=>(
                  <div key={item.name} style={{ background:C.cardLt, borderRadius:"12px", overflow:"hidden", border:`1px solid ${C.border}` }}>
                    <img src={item.img} alt={item.name} style={{ width:"100%", height:"110px", objectFit:"cover", display:"block" }} loading="lazy"/>
                    <div style={{ padding:"10px" }}>
                      <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"800", fontSize:"13px", color:C.black, lineHeight:"1.2", marginBottom:"3px" }}>{item.name}</div>
                      <div style={{ fontSize:"10px", color:C.muted, lineHeight:"1.3" }}>{item.desc}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── TECH DASHBOARD ───────────────────────────────────────────────────────────
function TechDashboard({ tech, techs, upsells, switchovers, reviews, callbacks, quota, onLogout }) {
  const q = quota || DEFAULT_QUOTA;
  const [tab, setTab] = useState("overview");
  const tt = calcTotals(tech, upsells, switchovers, reviews, callbacks);
  const tier = getTier(tt.total);
  const nextTier = JOURNEY_TIERS.find(t=>t.minPts>tt.total);
  const allRanked = [...techs].map(t=>({...t,...calcTotals(t,upsells,switchovers,reviews,callbacks||[])})).sort((a,b)=>b.total-a.total);
  const myPos = allRanked.findIndex(t=>t.id===tech.id)+1;
  const wk=getWeekKey(), mk=getMonthKey();
  const weekUpsell = upsells.filter(u=>u.tech_id===tech.id&&u.week_key===wk).reduce((s,u)=>s+u.amount,0);
  const monthReviews = reviews.filter(r=>r.tech_id===tech.id&&r.month_key===mk).reduce((s,r)=>s+r.count,0);
  const tenure = formatTenure(tech.start_date);

  // Month quota actuals
  const now = new Date(); const y = now.getFullYear(); const mo = String(now.getMonth()+1).padStart(2,"0");
  const monthUpsellAmt   = upsells.filter(u=>u.tech_id===tech.id && u.week_key?.startsWith(`${y}-${mo}`)).reduce((s,u)=>s+u.amount,0);
  const monthSwitchCount = switchovers.filter(s=>s.tech_id===tech.id && s.week_key?.startsWith(`${y}-${mo}`)).length;
  const upHit  = monthUpsellAmt   >= q.upsells;
  const revHit = monthReviews     >= q.reviews;
  const swHit  = monthSwitchCount >= q.switchovers;
  const allQuotaHit = upHit && revHit && swHit;
  const quotaHitCount = [upHit,revHit,swHit].filter(Boolean).length;
  return (
    <div style={{ minHeight:"100vh", background:"#f0f8ff" }}>
      <style>{GS}</style>
      <Header right={<LogoutBtn onLogout={onLogout}/>}/>
      <div style={{ background:C.white, borderBottom:`1px solid ${C.border}`, padding:"16px 20px 0", boxShadow:"0 2px 12px rgba(43,156,240,0.08)" }}>
        <div style={{ display:"flex", alignItems:"center", gap:"14px", marginBottom:"16px" }}>
          <div style={{ width:"52px", height:"52px", borderRadius:"50%", background:`${C.blue}18`, border:`2px solid ${C.blue}`, display:"flex", alignItems:"center", justifyContent:"center", fontFamily:"'Barlow Condensed',sans-serif", fontSize:"16px", fontWeight:"900", color:C.blue, flexShrink:0 }}>{tech.avatar}</div>
          <div style={{ flex:1 }}>
            <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"900", fontStyle:"italic", fontSize:"26px", color:C.black, lineHeight:1 }}>{tech.name}</div>
            <div style={{ display:"flex", gap:"8px", alignItems:"center", marginTop:"4px", flexWrap:"wrap" }}>
              <Pill color={tier.color}>{tier.icon} {tier.name}</Pill>
              {tenure&&<span style={{ fontSize:"11px", color:C.muted }}>⏱ {tenure}</span>}
            </div>
          </div>
          <div style={{ textAlign:"right" }}>
            <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"900", fontStyle:"italic", fontSize:"36px", color:C.blue, lineHeight:1 }}>{tt.total.toLocaleString()}</div>
            <div style={{ fontSize:"10px", color:C.muted, letterSpacing:"2px" }}>TOTAL PTS</div>
          </div>
        </div>
        {nextTier&&(
          <div style={{ marginBottom:"14px" }}>
            <div style={{ display:"flex", justifyContent:"space-between", marginBottom:"5px" }}>
              <span style={{ fontSize:"10px", color:C.muted, letterSpacing:"1px" }}>🎯 WORKING TOWARD: {nextTier.reward}</span>
              <span style={{ fontSize:"10px", color:tier.color, fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"700" }}>{(nextTier.minPts-tt.total).toLocaleString()} PTS TO GO</span>
            </div>
            <Bar pct={Math.round(((tt.total-tier.minPts)/(nextTier.minPts-tier.minPts))*100)} color={tier.color} h={4}/>
          </div>
        )}
      </div>
      <TabBar tabs={[["overview","Overview"],["journey","🗺️ Journey"],["total","🏆 Total"],["badges","Badges"],["upsells","Upsells"],["switchovers","Converts"],["reviews","⭐ Reviews"],["incentive","🎁 Rewards"],...(tech.is_lead?[["myteam","👥 My Team"]]:[ ])]} active={tab} setActive={setTab}/>
      <div style={{ padding:"20px", maxWidth:"800px", margin:"0 auto" }}>
        {tab==="overview"&&(
          <div style={{ display:"flex", flexDirection:"column", gap:"16px" }}>

            {/* ── MONTHLY QUOTA CARD ── */}
            <div style={{ background:allQuotaHit?`${C.green}12`:C.white, border:`2px solid ${allQuotaHit?C.green:C.border}`, borderTop:`4px solid ${allQuotaHit?C.green:C.blue}`, borderRadius:"16px", padding:"18px 20px", boxShadow:"0 4px 16px rgba(43,156,240,0.10)" }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:"14px" }}>
                <div>
                  <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"900", fontStyle:"italic", fontSize:"18px", color:allQuotaHit?C.green:C.black, letterSpacing:"1px" }}>
                    {allQuotaHit ? "✅ QUOTA CRUSHED" : `📊 MONTHLY QUOTA`}
                  </div>
                  <div style={{ fontSize:"11px", color:C.muted, marginTop:"2px" }}>{formatMonthLabel(mk)} · {quotaHitCount}/3 targets hit</div>
                </div>
                <div style={{ background:allQuotaHit?C.green:quotaHitCount>=2?C.gold:quotaHitCount===1?C.orange:"#ef4444", borderRadius:"20px", padding:"4px 12px", fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"900", fontSize:"13px", color:C.white }}>
                  {allQuotaHit?"ON FIRE 🔥":quotaHitCount>=2?"CLOSE":"NEEDS WORK"}
                </div>
              </div>
              <div style={{ display:"flex", flexDirection:"column", gap:"10px" }}>
                {[
                  { label:"💰 Upsells",     actual:`$${monthUpsellAmt}`,   target:`$${q.upsells}`,    pct:Math.min(Math.round((monthUpsellAmt/q.upsells)*100),100),    hit:upHit,  color:C.green },
                  { label:"⭐ Reviews",      actual:monthReviews,            target:q.reviews,           pct:Math.min(Math.round((monthReviews/q.reviews)*100),100),       hit:revHit, color:C.gold  },
                  { label:"🔄 Switchovers", actual:monthSwitchCount,        target:q.switchovers,       pct:Math.min(Math.round((monthSwitchCount/q.switchovers)*100),100),hit:swHit,  color:C.blue  },
                ].map(row=>(
                  <div key={row.label}>
                    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:"5px" }}>
                      <span style={{ fontSize:"12px", fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"800", color:C.black }}>{row.label}</span>
                      <div style={{ display:"flex", alignItems:"center", gap:"8px" }}>
                        <span style={{ fontSize:"12px", fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"900", color:row.hit?row.color:C.black }}>
                          {row.actual} <span style={{ color:C.muted, fontWeight:"600" }}>/ {row.target}</span>
                        </span>
                        {row.hit
                          ? <span style={{ background:row.color, color:C.white, borderRadius:"10px", padding:"1px 8px", fontSize:"10px", fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"900" }}>✓ HIT</span>
                          : <span style={{ background:C.cardLt, color:C.muted, borderRadius:"10px", padding:"1px 8px", fontSize:"10px", fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"700" }}>{row.pct}%</span>
                        }
                      </div>
                    </div>
                    <div style={{ background:C.border, borderRadius:"6px", height:"7px", overflow:"hidden" }}>
                      <div style={{ width:`${row.pct}%`, height:"100%", background:row.hit?row.color:row.color+"99", borderRadius:"6px", transition:"width 0.4s ease" }}/>
                    </div>
                  </div>
                ))}
              </div>
              {!allQuotaHit&&(
                <div style={{ marginTop:"12px", fontSize:"11px", color:C.muted, fontStyle:"italic" }}>
                  Keep pushing — hit all 3 and Kyle earns his bonus too 💪
                </div>
              )}
            </div>

            <div style={{ display:"grid", gridTemplateColumns:"repeat(2,1fr)", gap:"10px" }}>
              <StatBlock label="Total Points" value={tt.total.toLocaleString()} color={C.blue} accent={C.blue}/>
              <StatBlock label="Team Rank" value={`#${myPos} / ${techs.length}`} color={C.green} accent={C.green}/>
              <StatBlock label="Week Upsells" value={`$${weekUpsell.toLocaleString()}`} color={C.green} sub={`All-time $${Math.round(tt.upsellAmt).toLocaleString()}`} accent={C.green}/>
              <StatBlock label="Month Reviews" value={monthReviews} color={C.gold} sub={`All-time ${reviews.filter(r=>r.tech_id===tech.id).reduce((s,r)=>s+r.count,0)}`} accent={C.gold}/>
            </div>
            <div style={{ background:C.card, border:`1px solid ${C.border}`, borderTop:`3px solid ${tier.color}`, borderRadius:"12px", padding:"16px 18px" }}>
              <Label color={tier.color}>Points Breakdown</Label>
              <div style={{ display:"grid", gridTemplateColumns:"repeat(2,1fr)", gap:"8px" }}>
                {[
                  {l:"🏅 Badges",    v:tt.badgePts,   c:C.purple},
                  {l:"💰 Upsells",   v:tt.upsellPts,  c:C.green},
                  {l:"🔄 Converts",  v:tt.switchPts,  c:C.blue},
                  {l:"⭐ Reviews",   v:tt.reviewPts,  c:C.gold},
                  ...(tt.callbackCount>0?[{l:`📞 Callbacks (${tt.callbackCount})`, v:tt.callbackPts, c:"#ef4444"}]:[]),
                  ...(tech.is_lead?(()=>{ const {overridePts,overridePct,allTeamHit,partialHit}=calcTeamOverride(tech,techs,upsells,switchovers,reviews,callbacks||[],q); const active=allTeamHit||partialHit; return [{l:`👥 Team Override (${active?Math.round(overridePct*100)+"% unlocked":"locked"})`,v:active?`+${overridePts}`:"—",c:active?C.gold:C.muted}]; })():[]),
                ].map(item=>(
                  <div key={item.l} style={{ background:C.cardLt, borderRadius:"4px", padding:"10px 12px", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                    <span style={{ fontSize:"12px", color:C.muted }}>{item.l}</span>
                    <span style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"900", fontSize:"18px", color:item.c }}>{item.v.toLocaleString()}</span>
                  </div>
                ))}
              </div>
            </div>
            {tech.badges.length>0&&(
              <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:"12px", padding:"16px 18px" }}>
                <Label>My Badges</Label>
                <div style={{ display:"flex", flexWrap:"wrap", gap:"6px" }}>
                  {ALL_BADGE_DEFS.filter(b=>tech.badges?.includes(b.id)).map(b=>(
                    <div key={b.id} style={{ background:`${C.blue}18`, border:`1px solid ${C.blue}44`, borderRadius:"4px", padding:"6px 10px", display:"flex", alignItems:"center", gap:"6px" }}>
                      <span style={{ fontSize:"16px" }}>{b.icon}</span>
                      <div>
                        <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"700", fontSize:"12px", color:C.black }}>{b.name}</div>
                        <div style={{ fontSize:"10px", color:C.blue, fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"700" }}>+{b.pts} PTS</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
        {tab==="badges"&&<BadgeGrid earned={tech.badges}/>}
        {tab==="upsells"&&<UpsellLeaderboard techs={techs} upsells={upsells} currentId={tech.id}/>}
        {tab==="switchovers"&&<SwitchoverLeaderboard techs={techs} switchovers={switchovers} currentId={tech.id}/>}
        {tab==="reviews"&&<ReviewLeaderboard techs={techs} reviews={reviews} currentId={tech.id}/>}
        {tab==="total"&&<TotalLeaderboard techs={techs} upsells={upsells} switchovers={switchovers} reviews={reviews} callbacks={callbacks||[]}/>}
        {tab==="journey"&&(
          <div>
            <div style={{ fontSize:"13px", color:C.muted, marginBottom:"16px" }}>Tap any card to expand full breakdown.</div>
            <JourneyBoard techs={techs} upsells={upsells} switchovers={switchovers} reviews={reviews} quota={q} callbacks={callbacks||[]}/>
          </div>
        )}
        {tab==="incentive"&&(
          <div>
            <div style={{ fontSize:"13px", color:C.muted, marginBottom:"16px" }}>Your personal progress toward each reward tier.</div>
            <IncentiveBoard techs={techs} upsells={upsells} switchovers={switchovers} reviews={reviews} callbacks={callbacks||[]} currentId={tech.id}/>
          </div>
        )}
        {tab==="myteam"&&tech.is_lead&&(
          <TeamLeadPanel tech={tech} techs={techs} upsells={upsells} switchovers={switchovers} reviews={reviews} callbacks={callbacks||[]} quota={q}/>
        )}
      </div>
    </div>
  );
}




// ─── DELETE TAB ───────────────────────────────────────────────────────────────
function DeleteTab({ techs, upsells, switchovers, reviews, saving, setSaving, refreshAll, showToast }) {
  const [section, setSection] = useState("upsells");
  const [filterTech, setFilterTech] = useState("");

  const selStyle = { background:C.cardLt, border:`1px solid ${C.border}`, color:C.black, padding:"8px 12px", borderRadius:"12px", fontSize:"13px", fontFamily:"'Barlow',sans-serif", width:"100%", cursor:"pointer" };

  async function deleteUpsell(id) {
    if (!window.confirm("Delete this upsell entry?")) return;
    setSaving(true);
    try { await sb(`upsells?id=eq.${id}`,{method:"DELETE",prefer:"return=minimal"}); await refreshAll(); showToast("Upsell deleted"); }
    catch(e){ showToast("Error: "+e.message,false); }
    setSaving(false);
  }
  async function deleteSwitchover(id) {
    if (!window.confirm("Delete this switchover?")) return;
    setSaving(true);
    try { await sb(`switchovers?id=eq.${id}`,{method:"DELETE",prefer:"return=minimal"}); await refreshAll(); showToast("Switchover deleted"); }
    catch(e){ showToast("Error: "+e.message,false); }
    setSaving(false);
  }
  async function deleteReview(id) {
    if (!window.confirm("Delete this review entry?")) return;
    setSaving(true);
    try { await sb(`reviews?id=eq.${id}`,{method:"DELETE",prefer:"return=minimal"}); await refreshAll(); showToast("Review entry deleted"); }
    catch(e){ showToast("Error: "+e.message,false); }
    setSaving(false);
  }

  const filteredUpsells = upsells.filter(u=>!filterTech||u.tech_id===filterTech).sort((a,b)=>b.week_key?.localeCompare(a.week_key||"")||0);
  const filteredSwitchovers = switchovers.filter(s=>!filterTech||s.tech_id===filterTech).sort((a,b)=>(b.created_at||"").localeCompare(a.created_at||""));
  const filteredReviews = reviews.filter(r=>!filterTech||r.tech_id===filterTech).sort((a,b)=>b.month_key?.localeCompare(a.month_key||"")||0);

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:"14px" }}>
      <div style={{ background:`#ff444418`, border:`1px solid #ff444444`, borderRadius:"12px", padding:"12px 16px", fontSize:"12px", color:C.muted }}>
        <span style={{ color:C.red, fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"800" }}>⚠️ DELETE ZONE</span> — Deletions are permanent. Use this to remove test data or mistakes.
      </div>

      {/* Section picker */}
      <div style={{ display:"flex", gap:"8px" }}>
        {[["upsells","💰 Upsells"],["switchovers","🔄 Converts"],["reviews","⭐ Reviews"]].map(([id,label])=>(
          <button key={id} onClick={()=>setSection(id)} style={{ background:section===id?C.red:C.card, border:`1px solid ${section===id?C.red:C.border}`, color:section===id?C.white:C.muted, padding:"8px 14px", borderRadius:"4px", cursor:"pointer", fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"700", fontSize:"11px", letterSpacing:"1px" }}>{label}</button>
        ))}
      </div>

      {/* Filter by tech */}
      <select value={filterTech} onChange={e=>setFilterTech(e.target.value)} style={selStyle}>
        <option value="">All Techs</option>
        {techs.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}
      </select>

      {/* UPSELLS */}
      {section==="upsells"&&(
        <div style={{ display:"flex", flexDirection:"column", gap:"6px" }}>
          {filteredUpsells.length===0&&<div style={{ fontSize:"13px", color:C.muted, padding:"12px" }}>No upsell entries found.</div>}
          {filteredUpsells.map(u=>{
            const tech=techs.find(t=>t.id===u.tech_id);
            return (
              <div key={u.id} style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:"12px", padding:"12px 16px", display:"flex", alignItems:"center", justifyContent:"space-between", gap:"12px" }}>
                <div>
                  <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"800", fontSize:"15px", color:C.black }}>{tech?.name}</div>
                  <div style={{ fontSize:"12px", color:C.muted }}>{formatWeekLabel(u.week_key)} · <span style={{ color:C.green, fontWeight:"700" }}>${u.amount?.toLocaleString()}</span></div>
                </div>
                <button onClick={()=>deleteUpsell(u.id)} disabled={saving} style={{ background:"none", border:`1px solid ${C.red}`, color:C.red, padding:"6px 12px", borderRadius:"4px", cursor:"pointer", fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"700", fontSize:"12px", letterSpacing:"1px", flexShrink:0 }}>DELETE</button>
              </div>
            );
          })}
        </div>
      )}

      {/* SWITCHOVERS */}
      {section==="switchovers"&&(
        <div style={{ display:"flex", flexDirection:"column", gap:"6px" }}>
          {filteredSwitchovers.length===0&&<div style={{ fontSize:"13px", color:C.muted, padding:"12px" }}>No switchover entries found.</div>}
          {filteredSwitchovers.map(s=>{
            const tech=techs.find(t=>t.id===s.tech_id);
            const plan=PLAN_MAP[s.plan_id];
            const pc=PLAN_COLORS[s.plan_id]||C.muted;
            return (
              <div key={s.id} style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:"12px", padding:"12px 16px", display:"flex", alignItems:"center", justifyContent:"space-between", gap:"12px" }}>
                <div>
                  <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"800", fontSize:"15px", color:C.black }}>{tech?.name}</div>
                  <div style={{ fontSize:"12px", color:C.muted }}>{formatWeekLabel(s.week_key)} · <span style={{ color:pc, fontWeight:"700" }}>{plan?.label||s.plan_id} · +{plan?.pts||0}pts</span></div>
                </div>
                <button onClick={()=>deleteSwitchover(s.id)} disabled={saving} style={{ background:"none", border:`1px solid ${C.red}`, color:C.red, padding:"6px 12px", borderRadius:"4px", cursor:"pointer", fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"700", fontSize:"12px", letterSpacing:"1px", flexShrink:0 }}>DELETE</button>
              </div>
            );
          })}
        </div>
      )}

      {/* REVIEWS */}
      {section==="reviews"&&(
        <div style={{ display:"flex", flexDirection:"column", gap:"6px" }}>
          {filteredReviews.length===0&&<div style={{ fontSize:"13px", color:C.muted, padding:"12px" }}>No review entries found.</div>}
          {filteredReviews.map(r=>{
            const tech=techs.find(t=>t.id===r.tech_id);
            return (
              <div key={r.id} style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:"12px", padding:"12px 16px", display:"flex", alignItems:"center", justifyContent:"space-between", gap:"12px" }}>
                <div>
                  <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"800", fontSize:"15px", color:C.black }}>{tech?.name}</div>
                  <div style={{ fontSize:"12px", color:C.muted }}>{formatMonthLabel(r.month_key)} · <span style={{ color:C.gold, fontWeight:"700" }}>{r.count} ⭐</span></div>
                </div>
                <button onClick={()=>deleteReview(r.id)} disabled={saving} style={{ background:"none", border:`1px solid ${C.red}`, color:C.red, padding:"6px 12px", borderRadius:"4px", cursor:"pointer", fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"700", fontSize:"12px", letterSpacing:"1px", flexShrink:0 }}>DELETE</button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── ADMIN UPSELL ENTRY (with date picker) ────────────────────────────────────
function AdminUpsellEntry({ techs, upsells, saving, setSaving, refreshAll, showToast, allTimeUp }) {
  const wk = getWeekKey();
  const [targetWeek, setTargetWeek] = useState(wk);
  const [form, setForm] = useState({});
  const [useCustomDate, setUseCustomDate] = useState(false);
  const [customDate, setCustomDate] = useState("");

  // Get week key from any date
  function weekKeyFromDate(dateStr) {
    const d = new Date(dateStr + "T00:00:00");
    const start = new Date(d);
    start.setDate(d.getDate() - d.getDay());
    return `${start.getFullYear()}-${String(start.getMonth()+1).padStart(2,"0")}-${String(start.getDate()).padStart(2,"0")}`;
  }

  const activeWeek = useCustomDate && customDate ? weekKeyFromDate(customDate) : targetWeek;
  const weekData = {};
  upsells.filter(u=>u.week_key===activeWeek).forEach(u=>{weekData[u.tech_id]=u.amount;});

  // All weeks that have data
  const byWeek = {};
  upsells.forEach(u=>{ byWeek[u.week_key]=(byWeek[u.week_key]||0)+1; });
  const existingWeeks = Object.keys(byWeek).sort((a,b)=>b.localeCompare(a));

  async function handleSave() {
    setSaving(true);
    try {
      for (const t of techs) {
        const val = parseFloat(form[t.id]);
        if (isNaN(val)||val<=0) continue;
        const existing = await sb(`upsells?tech_id=eq.${t.id}&week_key=eq.${activeWeek}&select=id`);
        if (existing&&existing.length>0) await sb(`upsells?id=eq.${existing[0].id}`,{method:"PATCH",body:JSON.stringify({amount:val}),prefer:"return=minimal"});
        else await sb("upsells",{method:"POST",body:JSON.stringify({tech_id:t.id,week_key:activeWeek,amount:val})});
      }
      await refreshAll();
      showToast("✅ Upsells saved for " + formatWeekLabel(activeWeek) + "!");
      setForm({});
    } catch(e){ showToast("Error: "+e.message,false); }
    setSaving(false);
  }

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:"16px" }}>
      <div style={{ background:C.card, border:`1px solid ${C.border}`, borderTop:`3px solid ${C.green}`, borderRadius:"12px", padding:"20px", display:"flex", flexDirection:"column", gap:"14px" }}>
        <Label color={C.green}>Log Upsells</Label>
        <div style={{ fontSize:"12px", color:C.muted }}>$2 = 1 point · You can log current or any past week</div>

        {/* Week selector */}
        <div style={{ display:"flex", flexDirection:"column", gap:"8px" }}>
          <div style={{ display:"flex", gap:"8px" }}>
            <button onClick={()=>{ setUseCustomDate(false); setTargetWeek(wk); }} style={{ background:!useCustomDate&&targetWeek===wk?C.green:C.cardLt, border:`1px solid ${!useCustomDate&&targetWeek===wk?C.green:C.border}`, color:!useCustomDate&&targetWeek===wk?C.black:C.muted, padding:"8px 14px", borderRadius:"4px", cursor:"pointer", fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"700", fontSize:"12px", letterSpacing:"1px" }}>THIS WEEK</button>
            <button onClick={()=>setUseCustomDate(true)} style={{ background:useCustomDate?C.blue:C.cardLt, border:`1px solid ${useCustomDate?C.blue:C.border}`, color:useCustomDate?C.white:C.muted, padding:"8px 14px", borderRadius:"4px", cursor:"pointer", fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"700", fontSize:"12px", letterSpacing:"1px" }}>PICK A DATE</button>
            {existingWeeks.length>0&&<button onClick={()=>{ setUseCustomDate(false); }} style={{ background:!useCustomDate&&targetWeek!==wk?C.purple:C.cardLt, border:`1px solid ${!useCustomDate&&targetWeek!==wk?C.purple:C.border}`, color:!useCustomDate&&targetWeek!==wk?C.white:C.muted, padding:"8px 14px", borderRadius:"4px", cursor:"pointer", fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"700", fontSize:"12px", letterSpacing:"1px" }}>PAST WEEK</button>}
          </div>
          {useCustomDate&&(
            <div>
              <div style={{ fontSize:"11px", color:C.muted, marginBottom:"5px" }}>Pick any date — we'll find the week it belongs to</div>
              <input type="date" value={customDate} onChange={e=>setCustomDate(e.target.value)} style={{ background:C.cardLt, border:`1px solid ${C.border}`, color:C.black, padding:"8px 12px", borderRadius:"12px", fontSize:"14px", fontFamily:"'Barlow',sans-serif", width:"100%", boxSizing:"border-box" }}/>
              {customDate&&<div style={{ fontSize:"11px", color:C.blue, marginTop:"4px", fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"700" }}>Week: {formatWeekLabel(activeWeek)}</div>}
            </div>
          )}
          {!useCustomDate&&existingWeeks.length>0&&(
            <select value={targetWeek} onChange={e=>setTargetWeek(e.target.value)} style={{ background:C.cardLt, border:`1px solid ${C.border}`, color:C.black, padding:"8px 12px", borderRadius:"12px", fontSize:"14px", fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"700", width:"100%", cursor:"pointer" }}>
              <option value={wk}>{formatWeekLabel(wk)} — Current</option>
              {existingWeeks.filter(w=>w!==wk).map(w=><option key={w} value={w}>{formatWeekLabel(w)}</option>)}
              <option value="new">+ Enter a different past week</option>
            </select>
          )}
        </div>

        <div style={{ background:C.cardLt, borderRadius:"4px", padding:"8px 12px", fontSize:"12px", color:C.blue, fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"700" }}>
          Logging for: {formatWeekLabel(activeWeek)}{activeWeek===wk?" (Current Week)":""}
        </div>

        {techs.map(t=>(
          <div key={t.id} style={{ display:"flex", alignItems:"center", gap:"12px" }}>
            <div style={{ width:"150px" }}>
              <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"700", fontSize:"15px", color:C.black }}>{t.name}</div>
              <div style={{ fontSize:"11px", color:C.muted }}>logged: ${(weekData[t.id]||0).toLocaleString()}</div>
            </div>
            <div style={{ display:"flex", alignItems:"center", gap:"6px", flex:1 }}>
              <span style={{ color:C.green, fontSize:"16px", fontWeight:"800" }}>$</span>
              <input type="number" placeholder={weekData[t.id]||"0"} value={form[t.id]||""} onChange={e=>setForm(f=>({...f,[t.id]:e.target.value}))} style={{ background:C.card, border:`1px solid ${C.border}`, color:C.black, padding:"8px 10px", borderRadius:"12px", fontSize:"14px", fontFamily:"'Barlow Condensed',sans-serif", width:"100%", fontWeight:"700" }}/>
            </div>
          </div>
        ))}
        <button onClick={handleSave} disabled={saving} style={{ background:saving?"#333":C.green, border:"none", color:saving?"#666":C.black, padding:"13px", borderRadius:"12px", cursor:saving?"not-allowed":"pointer", fontSize:"13px", fontWeight:"700", letterSpacing:"2px", fontFamily:"'Barlow Condensed',sans-serif", width:"100%", textTransform:"uppercase" }}>{saving?"Saving...":"Save Upsells"}</button>
      </div>
      <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:"12px", padding:"16px 18px" }}>
        <Label color={C.green}>All-Time Totals</Label>
        {[...techs].sort((a,b)=>(allTimeUp[b.id]||0)-(allTimeUp[a.id]||0)).map((t,i)=>(
          <div key={t.id} style={{ display:"flex", justifyContent:"space-between", marginBottom:"8px" }}>
            <span style={{ fontSize:"13px", color:C.black }}>{medal(i)} {t.name}</span>
            <span style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"800", color:C.green }}>${(allTimeUp[t.id]||0).toLocaleString()} · {Math.round((allTimeUp[t.id]||0)*UPSELL_PTS_PER_DOLLAR)} pts</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── ADMIN REVIEW ENTRY (with month picker) ───────────────────────────────────
function AdminReviewEntry({ techs, reviews, saving, setSaving, refreshAll, showToast }) {
  const mk = getMonthKey();
  const [targetMonth, setTargetMonth] = useState(mk);
  const [form, setForm] = useState({});

  const byMonth = {};
  reviews.forEach(r=>{ byMonth[r.month_key]=(byMonth[r.month_key]||0)+1; });
  const existingMonths = Object.keys(byMonth).sort((a,b)=>b.localeCompare(a));

  const monthData = {};
  reviews.filter(r=>r.month_key===targetMonth).forEach(r=>{ monthData[r.tech_id]=r.count; });

  async function handleSave() {
    setSaving(true);
    try {
      for (const t of techs) {
        const val = parseInt(form[t.id]);
        if (isNaN(val)||val<=0) continue;
        const existing = await sb(`reviews?tech_id=eq.${t.id}&month_key=eq.${targetMonth}&select=id`);
        if (existing&&existing.length>0) await sb(`reviews?id=eq.${existing[0].id}`,{method:"PATCH",body:JSON.stringify({count:val}),prefer:"return=minimal"});
        else await sb("reviews",{method:"POST",body:JSON.stringify({tech_id:t.id,month_key:targetMonth,count:val})});
      }
      await refreshAll();
      showToast("✅ Reviews saved for " + formatMonthLabel(targetMonth) + "!");
      setForm({});
    } catch(e){ showToast("Error: "+e.message,false); }
    setSaving(false);
  }

  return (
    <div style={{ background:C.card, border:`1px solid ${C.border}`, borderTop:`3px solid ${C.gold}`, borderRadius:"12px", padding:"20px", display:"flex", flexDirection:"column", gap:"14px" }}>
      <Label color={C.gold}>Log 5-Star Reviews</Label>
      <div style={{ fontSize:"12px", color:C.muted }}>+{REVIEW_PTS} pts each · +{REVIEW_BONUS_PTS} bonus at 10+ · Log current or any past month</div>

      <div>
        <div style={{ fontSize:"11px", color:C.muted, marginBottom:"6px" }}>Select month</div>
        <select value={targetMonth} onChange={e=>{ setTargetMonth(e.target.value); setForm({}); }} style={{ background:C.cardLt, border:`1px solid ${C.border}`, color:C.black, padding:"8px 12px", borderRadius:"12px", fontSize:"14px", fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"700", width:"100%", cursor:"pointer" }}>
          <option value={mk}>{formatMonthLabel(mk)} — Current</option>
          {existingMonths.filter(m=>m!==mk).map(m=><option key={m} value={m}>{formatMonthLabel(m)}</option>)}
          {/* generate last 12 months as options */}
          {Array.from({length:11},(_,i)=>{
            const d = new Date(); d.setMonth(d.getMonth()-(i+1));
            const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
            return !byMonth[key] ? <option key={key} value={key}>{formatMonthLabel(key)}</option> : null;
          })}
        </select>
      </div>

      <div style={{ background:C.cardLt, borderRadius:"4px", padding:"8px 12px", fontSize:"12px", color:C.gold, fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"700" }}>
        Logging for: {formatMonthLabel(targetMonth)}{targetMonth===mk?" (Current Month)":""}
      </div>

      {techs.map(t=>(
        <div key={t.id} style={{ display:"flex", alignItems:"center", gap:"12px" }}>
          <div style={{ width:"150px" }}>
            <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"700", fontSize:"15px", color:C.black }}>{t.name}</div>
            <div style={{ fontSize:"11px", color:C.muted }}>logged: {monthData[t.id]||0} ⭐</div>
          </div>
          <div style={{ display:"flex", alignItems:"center", gap:"6px", flex:1 }}>
            <span style={{ color:C.gold, fontSize:"16px" }}>⭐</span>
            <input type="number" placeholder={monthData[t.id]||"0"} value={form[t.id]||""} onChange={e=>setForm(f=>({...f,[t.id]:e.target.value}))} style={{ background:C.card, border:`1px solid ${C.border}`, color:C.black, padding:"8px 10px", borderRadius:"12px", fontSize:"14px", fontFamily:"'Barlow Condensed',sans-serif", width:"100%", fontWeight:"700" }}/>
          </div>
        </div>
      ))}
      <button onClick={handleSave} disabled={saving} style={{ background:saving?"#333":C.gold, border:"none", color:saving?"#666":C.black, padding:"13px", borderRadius:"12px", cursor:saving?"not-allowed":"pointer", fontSize:"13px", fontWeight:"700", letterSpacing:"2px", fontFamily:"'Barlow Condensed',sans-serif", width:"100%", textTransform:"uppercase" }}>{saving?"Saving...":"Save Reviews"}</button>
    </div>
  );
}

// ─── RIDE-ALONG SYSTEM ────────────────────────────────────────────────────────
const CHECKLIST_SECTIONS = [
  {
    id: "arrival",
    title: "Arrival",
    icon: "🚗",
    items: [
      { id:"uniform",  label:"Uniform clean and worn correctly?" },
      { id:"ontime",   label:"Arrived on time or let client know they were late?" },
      { id:"parked",   label:"Are they parked correctly and strategically?" },
    ],
  },
  {
    id: "cleaning",
    title: "Cleaning",
    icon: "🧹",
    items: [
      { id:"tote",     label:"Tote organized and no missing items?" },
      { id:"swift",    label:"Are they working swiftly?" },
      { id:"tools",    label:"Are they using the right tools and chemicals for the corresponding cleaning process?" },
      { id:"pics",     label:"Did they take after pics and do all checklists?" },
    ],
    notes: [
      { id:"faults",   label:"How is their cleaning technique? Name any faults:" },
      { id:"wins",     label:"What are they succeeding with?" },
    ],
  },
  {
    id: "customer",
    title: "Customer Interaction",
    icon: "🤝",
    items: [
      { id:"knock",    label:"Did they knock on the door to try for an in-person walk through first?" },
      { id:"video",    label:"If not, did they send a walk-through video of the interior and exterior?" },
      { id:"payment",  label:"Did they have them pay on the phone right there or send the invoice before they left?" },
      { id:"flyers",   label:"Did they hand out 3 flyers and a customer satisfaction card and attach pics to HCP?" },
    ],
  },
];

// Get all upcoming Thursdays
function getThursdays(count = 12) {
  const thursdays = [];
  const now = new Date();
  const day = now.getDay();
  const daysUntilThursday = (4 - day + 7) % 7 || 7;
  let next = new Date(now);
  next.setDate(now.getDate() + daysUntilThursday);
  for (let i = 0; i < count; i++) {
    const d = new Date(next);
    d.setDate(next.getDate() + i * 7);
    thursdays.push(d.toISOString().split("T")[0]);
  }
  return thursdays;
}

function formatDate(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", { weekday:"long", month:"long", day:"numeric" });
}

function RideAlongTab({ techs, rideAlongs, schedules, onSave, onSaveSchedule, saving }) {
  const [view, setView] = useState("schedule"); // "schedule" | "new" | "history" | "detail"
  const [selectedTech, setSelectedTech] = useState("");
  const [selectedDate, setSelectedDate] = useState("");
  const [checklist, setChecklist] = useState({});
  const [notes, setNotes] = useState({});
  const [generalNotes, setGeneralNotes] = useState("");
  const [viewDetail, setViewDetail] = useState(null);
  const [scheduleMap, setScheduleMap] = useState({});
  const thursdays = getThursdays(12);

  // Load existing schedule into map
  useEffect(() => {
    const map = {};
    schedules.forEach(s => { map[s.date] = s.tech_id; });
    setScheduleMap(map);
  }, [schedules]);

  function resetForm() {
    setChecklist({});
    setNotes({});
    setGeneralNotes("");
    setSelectedTech("");
    setSelectedDate("");
  }

  async function handleSaveRideAlong() {
    if (!selectedTech || !selectedDate) return;
    await onSave({
      tech_id: selectedTech,
      date: selectedDate,
      checklist: JSON.stringify(checklist),
      notes: JSON.stringify(notes),
      general_notes: generalNotes,
    });
    resetForm();
    setView("history");
  }

  async function handleScheduleChange(date, techId) {
    const newMap = { ...scheduleMap, [date]: techId };
    setScheduleMap(newMap);
    await onSaveSchedule(date, techId);
  }

  const inp = { background:C.cardLt, border:`1px solid ${C.border}`, color:C.black, padding:"10px 14px", borderRadius:"12px", fontSize:"14px", fontFamily:"'Barlow',sans-serif", width:"100%", boxSizing:"border-box", resize:"vertical", minHeight:"80px" };
  const selStyle = (val) => ({ background:C.cardLt, border:`1px solid ${C.border}`, color:val?C.white:C.muted, padding:"10px 14px", borderRadius:"12px", fontSize:"14px", fontFamily:"'Barlow',sans-serif", width:"100%", boxSizing:"border-box", cursor:"pointer" });

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:"16px" }}>
      {/* View switcher */}
      <div style={{ display:"flex", gap:"8px", flexWrap:"wrap" }}>
        {[["schedule","📅 Schedule"],["new","✏️ New Ride-Along"],["history","📋 History"]].map(([id,label])=>(
          <button key={id} onClick={()=>{ setView(id); setViewDetail(null); }} style={{ background:view===id?C.blue:C.card, border:`1px solid ${view===id?C.blue:C.border}`, color:view===id?C.white:C.muted, padding:"8px 16px", borderRadius:"4px", cursor:"pointer", fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"700", fontSize:"12px", letterSpacing:"1px", textTransform:"uppercase" }}>{label}</button>
        ))}
      </div>

      {/* SCHEDULE VIEW */}
      {view==="schedule"&&(
        <div style={{ display:"flex", flexDirection:"column", gap:"10px" }}>
          <div style={{ background:C.card, border:`1px solid ${C.border}`, borderTop:`3px solid ${C.blue}`, borderRadius:"12px", padding:"16px 18px" }}>
            <Label color={C.blue}>📅 Thursday Ride-Along Schedule</Label>
            <div style={{ fontSize:"12px", color:C.muted, marginBottom:"14px" }}>Assign a tech to each Thursday. This is your weekly coaching schedule.</div>
            <div style={{ display:"flex", flexDirection:"column", gap:"8px" }}>
              {thursdays.map(date=>{
                const assignedId = scheduleMap[date];
                const assignedTech = techs.find(t=>t.id===assignedId);
                const isPast = new Date(date) < new Date(new Date().toISOString().split("T")[0]);
                return (
                  <div key={date} style={{ background:C.cardLt, border:`1px solid ${assignedId?C.blue:C.border}`, borderRadius:"12px", padding:"12px 16px", display:"flex", alignItems:"center", gap:"12px", opacity:isPast?0.6:1 }}>
                    <div style={{ flex:1 }}>
                      <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"800", fontSize:"15px", color:C.black }}>{formatDate(date)}</div>
                      {isPast&&<div style={{ fontSize:"10px", color:C.muted, letterSpacing:"1px", textTransform:"uppercase" }}>Past</div>}
                    </div>
                    <select
                      value={scheduleMap[date]||""}
                      onChange={e=>handleScheduleChange(date,e.target.value)}
                      style={{ background:C.card, border:`1px solid ${assignedId?C.blue:C.border}`, color:assignedId?C.blue:C.muted, padding:"6px 10px", borderRadius:"4px", fontSize:"13px", fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"700", cursor:"pointer", minWidth:"140px" }}
                    >
                      <option value="">— Assign Tech —</option>
                      {techs.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Next up */}
          {(() => {
            const today = new Date().toISOString().split("T")[0];
            const next = thursdays.find(d=>d>=today&&scheduleMap[d]);
            if (!next) return null;
            const tech = techs.find(t=>t.id===scheduleMap[next]);
            return (
              <div style={{ background:`${C.blue}18`, border:`1px solid ${C.blue}44`, borderRadius:"12px", padding:"16px 18px", display:"flex", alignItems:"center", justifyContent:"space-between" }}>
                <div>
                  <div style={{ fontSize:"10px", color:C.blue, letterSpacing:"2px", textTransform:"uppercase", fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"700", marginBottom:"4px" }}>Next Ride-Along</div>
                  <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"900", fontSize:"22px", color:C.black }}>{tech?.name}</div>
                  <div style={{ fontSize:"13px", color:C.muted }}>{formatDate(next)}</div>
                </div>
                <button onClick={()=>{ setSelectedTech(scheduleMap[next]); setSelectedDate(next); setView("new"); }} style={{ background:C.blue, border:"none", color:C.black, padding:"10px 18px", borderRadius:"4px", cursor:"pointer", fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"900", fontSize:"13px", letterSpacing:"1px" }}>START SESSION →</button>
              </div>
            );
          })()}
        </div>
      )}

      {/* NEW RIDE-ALONG FORM */}
      {view==="new"&&(
        <div style={{ display:"flex", flexDirection:"column", gap:"14px" }}>
          <div style={{ background:C.card, border:`1px solid ${C.border}`, borderTop:`3px solid ${C.green}`, borderRadius:"12px", padding:"16px 18px", display:"flex", flexDirection:"column", gap:"12px" }}>
            <Label color={C.green}>✏️ New Ride-Along Session</Label>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"10px" }}>
              <select value={selectedTech} onChange={e=>setSelectedTech(e.target.value)} style={selStyle(selectedTech)}>
                <option value="">— Select Tech —</option>
                {techs.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
              <input type="date" value={selectedDate} onChange={e=>setSelectedDate(e.target.value)} style={{ background:C.cardLt, border:`1px solid ${C.border}`, color:selectedDate?C.white:C.muted, padding:"10px 14px", borderRadius:"12px", fontSize:"14px", fontFamily:"'Barlow',sans-serif", width:"100%", boxSizing:"border-box" }}/>
            </div>
          </div>

          {CHECKLIST_SECTIONS.map(section=>(
            <div key={section.id} style={{ background:C.card, border:`1px solid ${C.border}`, borderLeft:`3px solid ${C.blue}`, borderRadius:"12px", padding:"16px 18px" }}>
              <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"900", fontSize:"18px", color:C.black, letterSpacing:"2px", marginBottom:"14px" }}>{section.icon} {section.title.toUpperCase()}</div>
              <div style={{ display:"flex", flexDirection:"column", gap:"10px" }}>
                {section.items.map(item=>(
                  <div key={item.id} style={{ display:"flex", alignItems:"flex-start", gap:"12px" }}>
                    <div style={{ display:"flex", gap:"6px", flexShrink:0, marginTop:"2px" }}>
                      {["✅","❌","N/A"].map(val=>(
                        <button key={val} onClick={()=>setChecklist(c=>({...c,[section.id+"_"+item.id]:val}))}
                          style={{ background:checklist[section.id+"_"+item.id]===val?( val==="✅"?`${C.green}33`:val==="❌"?"#ff444433":"#ffffff22"):C.cardLt, border:`1px solid ${checklist[section.id+"_"+item.id]===val?(val==="✅"?C.green:val==="❌"?C.red:C.muted):C.border}`, color:checklist[section.id+"_"+item.id]===val?(val==="✅"?C.green:val==="❌"?C.red:C.white):C.muted, padding:"3px 8px", borderRadius:"4px", cursor:"pointer", fontSize:"11px", fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"700", whiteSpace:"nowrap" }}>
                          {val}
                        </button>
                      ))}
                    </div>
                    <div style={{ fontSize:"13px", color:C.black, lineHeight:"1.4", paddingTop:"2px" }}>{item.label}</div>
                  </div>
                ))}
                {section.notes?.map(note=>(
                  <div key={note.id} style={{ marginTop:"4px" }}>
                    <div style={{ fontSize:"12px", color:C.muted, marginBottom:"6px" }}>{note.label}</div>
                    <textarea value={notes[section.id+"_"+note.id]||""} onChange={e=>setNotes(n=>({...n,[section.id+"_"+note.id]:e.target.value}))} placeholder="Type notes here..." style={{...inp, minHeight:"64px"}}/>
                  </div>
                ))}
              </div>
            </div>
          ))}

          {/* General notes */}
          <div style={{ background:C.card, border:`1px solid ${C.border}`, borderLeft:`3px solid ${C.gold}`, borderRadius:"12px", padding:"16px 18px" }}>
            <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"900", fontSize:"18px", color:C.black, letterSpacing:"2px", marginBottom:"10px" }}>📝 GENERAL NOTES & COACHING POINTS</div>
            <textarea value={generalNotes} onChange={e=>setGeneralNotes(e.target.value)} placeholder="Overall session notes, things to work on, wins, action items for next ride-along..." style={{...inp, minHeight:"100px"}}/>
          </div>

          <button onClick={handleSaveRideAlong} disabled={saving||!selectedTech||!selectedDate} style={{ background:saving||!selectedTech||!selectedDate?"#333":C.green, border:"none", color:saving||!selectedTech||!selectedDate?"#666":C.black, padding:"14px", borderRadius:"12px", cursor:saving||!selectedTech||!selectedDate?"not-allowed":"pointer", fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"900", fontSize:"14px", letterSpacing:"2px", textTransform:"uppercase" }}>
            {saving?"SAVING...":"SAVE RIDE-ALONG SESSION"}
          </button>
        </div>
      )}

      {/* HISTORY VIEW */}
      {view==="history"&&!viewDetail&&(
        <div style={{ display:"flex", flexDirection:"column", gap:"10px" }}>
          <div style={{ background:C.card, border:`1px solid ${C.border}`, borderTop:`3px solid ${C.purple}`, borderRadius:"12px", padding:"16px 18px" }}>
            <Label color={C.purple}>📋 Ride-Along History</Label>
            {rideAlongs.length===0&&<div style={{ fontSize:"13px", color:C.muted }}>No ride-alongs logged yet.</div>}
            {[...rideAlongs].sort((a,b)=>b.date.localeCompare(a.date)).map(ra=>{
              const tech = techs.find(t=>t.id===ra.tech_id);
              const cl = ra.checklist ? JSON.parse(ra.checklist) : {};
              const passed = Object.values(cl).filter(v=>v==="✅").length;
              const failed = Object.values(cl).filter(v=>v==="❌").length;
              const total = Object.values(cl).length;
              return (
                <div key={ra.id} onClick={()=>setViewDetail(ra)} style={{ background:C.cardLt, border:`1px solid ${C.border}`, borderRadius:"12px", padding:"14px 16px", marginBottom:"8px", cursor:"pointer", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                  <div>
                    <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"800", fontSize:"16px", color:C.black }}>{tech?.name}</div>
                    <div style={{ fontSize:"12px", color:C.muted }}>{formatDate(ra.date)}</div>
                    {total>0&&<div style={{ fontSize:"11px", color:C.muted, marginTop:"3px" }}><span style={{ color:C.green }}>✅ {passed}</span> passed · <span style={{ color:C.red }}>❌ {failed}</span> failed</div>}
                  </div>
                  <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"700", fontSize:"12px", color:C.blue, letterSpacing:"1px" }}>VIEW →</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* DETAIL VIEW */}
      {view==="history"&&viewDetail&&(
        <div style={{ display:"flex", flexDirection:"column", gap:"14px" }}>
          <button onClick={()=>setViewDetail(null)} style={{ background:"none", border:`1px solid ${C.border}`, color:C.muted, padding:"8px 16px", borderRadius:"4px", cursor:"pointer", fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"700", fontSize:"12px", letterSpacing:"1px", alignSelf:"flex-start" }}>← BACK TO HISTORY</button>
          {(() => {
            const tech = techs.find(t=>t.id===viewDetail.tech_id);
            const cl = viewDetail.checklist ? JSON.parse(viewDetail.checklist) : {};
            const notes = viewDetail.notes ? JSON.parse(viewDetail.notes) : {};
            return (
              <>
                <div style={{ background:C.card, border:`1px solid ${C.border}`, borderTop:`3px solid ${C.purple}`, borderRadius:"12px", padding:"16px 18px" }}>
                  <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"900", fontSize:"22px", color:C.black }}>{tech?.name}</div>
                  <div style={{ fontSize:"13px", color:C.muted }}>{formatDate(viewDetail.date)}</div>
                </div>
                {CHECKLIST_SECTIONS.map(section=>(
                  <div key={section.id} style={{ background:C.card, border:`1px solid ${C.border}`, borderLeft:`3px solid ${C.blue}`, borderRadius:"12px", padding:"16px 18px" }}>
                    <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"900", fontSize:"16px", color:C.black, letterSpacing:"2px", marginBottom:"12px" }}>{section.icon} {section.title.toUpperCase()}</div>
                    {section.items.map(item=>{
                      const val = cl[section.id+"_"+item.id];
                      return (
                        <div key={item.id} style={{ display:"flex", alignItems:"center", gap:"10px", marginBottom:"8px" }}>
                          <span style={{ fontSize:"14px", flexShrink:0 }}>{val||"—"}</span>
                          <span style={{ fontSize:"13px", color:C.black }}>{item.label}</span>
                        </div>
                      );
                    })}
                    {section.notes?.map(note=>{
                      const val = notes[section.id+"_"+note.id];
                      if (!val) return null;
                      return (
                        <div key={note.id} style={{ marginTop:"8px", background:C.cardLt, borderRadius:"4px", padding:"10px 12px" }}>
                          <div style={{ fontSize:"11px", color:C.muted, marginBottom:"4px" }}>{note.label}</div>
                          <div style={{ fontSize:"13px", color:C.black, lineHeight:"1.5", whiteSpace:"pre-wrap" }}>{val}</div>
                        </div>
                      );
                    })}
                  </div>
                ))}
                {viewDetail.general_notes&&(
                  <div style={{ background:C.card, border:`1px solid ${C.border}`, borderLeft:`3px solid ${C.gold}`, borderRadius:"12px", padding:"16px 18px" }}>
                    <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"900", fontSize:"16px", color:C.black, letterSpacing:"2px", marginBottom:"10px" }}>📝 GENERAL NOTES</div>
                    <div style={{ fontSize:"13px", color:C.black, lineHeight:"1.6", whiteSpace:"pre-wrap" }}>{viewDetail.general_notes}</div>
                  </div>
                )}
              </>
            );
          })()}
        </div>
      )}
    </div>
  );
}

// ─── ADMIN PANEL ──────────────────────────────────────────────────────────────
function AdminPanel({ techs, upsells, switchovers, reviews, callbacks, rideAlongs, schedules, quota, setQuota, onLogout, refreshAll }) {
  const [tab, setTab] = useState("upsells");
  const [awardForm, setAwardForm] = useState({techId:"",badgeId:""});
  const [addForm, setAddForm] = useState({name:"",pin:"",avatar:"",start_date:""});
  const [upsellForm, setUpsellForm] = useState({});
  const [swForm, setSwForm] = useState({techId:"",planId:""});
  const [reviewForm, setReviewForm] = useState({});
  const [cbForm, setCbForm] = useState({techId:"",reason:""});
  const [toast, setToast] = useState(null);
  const [saving, setSaving] = useState(false);

  const showToast=(msg,ok=true)=>{ setToast({msg,ok}); setTimeout(()=>setToast(null),3000); };
  async function saveQuota(newQuota) {
    setSaving(true);
    try {
      const existing = await sb("settings?key=eq.quota&select=id").catch(()=>[]);
      if (existing&&existing.length>0) {
        await sb(`settings?id=eq.${existing[0].id}`,{method:"PATCH",body:JSON.stringify({value:JSON.stringify(newQuota)}),prefer:"return=minimal"});
      } else {
        await sb("settings",{method:"POST",body:JSON.stringify({key:"quota",value:JSON.stringify(newQuota)})});
      }
      setQuota(newQuota);
      showToast("✅ Quota saved — all devices updated!");
    } catch(e) { showToast("Error saving quota: "+e.message,false); }
    setSaving(false);
  }

  async function awardBadge() {
    if (!awardForm.techId||!awardForm.badgeId) return showToast("Select a tech and badge",false);
    const tech=techs.find(t=>t.id===awardForm.techId);
    if (tech.badges.includes(awardForm.badgeId)) return showToast(`${tech.name} already has this badge`,false);
    setSaving(true);
    try { await sb(`techs?id=eq.${tech.id}`,{method:"PATCH",body:JSON.stringify({badges:[...tech.badges,awardForm.badgeId]}),prefer:"return=minimal"}); await refreshAll(); showToast(`✅ Badge awarded to ${tech.name}!`); setAwardForm({techId:"",badgeId:""}); }
    catch(e){ showToast("Error: "+e.message,false); }
    setSaving(false);
  }
  async function revokeBadge(techId,badgeId) {
    const tech=techs.find(t=>t.id===techId); setSaving(true);
    try { await sb(`techs?id=eq.${techId}`,{method:"PATCH",body:JSON.stringify({badges:tech.badges.filter(b=>b!==badgeId)}),prefer:"return=minimal"}); await refreshAll(); showToast("Badge removed"); }
    catch(e){ showToast("Error: "+e.message,false); }
    setSaving(false);
  }
  async function addTech() {
    if (!addForm.name||!addForm.pin||addForm.pin.length!==4) return showToast("Name + 4-digit PIN required",false);
    if (techs.find(t=>t.pin===addForm.pin)) return showToast("PIN already in use",false);
    setSaving(true);
    try { const avatar=addForm.avatar||addForm.name.split(" ").map(w=>w[0]).join("").toUpperCase().slice(0,2); await sb("techs",{method:"POST",body:JSON.stringify({name:addForm.name,pin:addForm.pin,avatar,badges:["day_one"],start_date:addForm.start_date||null})}); await refreshAll(); showToast(`✅ ${addForm.name} added!`); setAddForm({name:"",pin:"",avatar:"",start_date:""}); }
    catch(e){ showToast("Error: "+e.message,false); }
    setSaving(false);
  }
  async function updateStartDate(techId,date) {
    try { await sb(`techs?id=eq.${techId}`,{method:"PATCH",body:JSON.stringify({start_date:date||null}),prefer:"return=minimal"}); await refreshAll(); showToast("✅ Start date saved!"); }
    catch(e){ showToast("Error: "+e.message,false); }
  }
  async function deleteTech(tech) {
    const confirmed = window.confirm(`⚠️ Delete ${tech.name}?\n\nThis will permanently remove them AND all their upsells, reviews, switchovers, and callbacks. This cannot be undone.`);
    if (!confirmed) return;
    setSaving(true);
    try {
      // Delete all associated data first
      await Promise.all([
        sb(`upsells?tech_id=eq.${tech.id}`,{method:"DELETE",prefer:"return=minimal"}),
        sb(`reviews?tech_id=eq.${tech.id}`,{method:"DELETE",prefer:"return=minimal"}),
        sb(`switchovers?tech_id=eq.${tech.id}`,{method:"DELETE",prefer:"return=minimal"}),
        sb(`callbacks?tech_id=eq.${tech.id}`,{method:"DELETE",prefer:"return=minimal"}).catch(()=>{}),
      ]);
      // Then delete the tech
      await sb(`techs?id=eq.${tech.id}`,{method:"DELETE",prefer:"return=minimal"});
      await refreshAll();
      showToast(`🗑️ ${tech.name} removed`);
    } catch(e){ showToast("Error: "+e.message,false); }
    setSaving(false);
  }
  async function saveUpsells() {
    const wk=getWeekKey(); setSaving(true);
    try {
      for (const t of techs) { const val=parseFloat(upsellForm[t.id]); if(isNaN(val)||val<=0)continue; const existing=await sb(`upsells?tech_id=eq.${t.id}&week_key=eq.${wk}&select=id`); if(existing&&existing.length>0)await sb(`upsells?id=eq.${existing[0].id}`,{method:"PATCH",body:JSON.stringify({amount:val}),prefer:"return=minimal"}); else await sb("upsells",{method:"POST",body:JSON.stringify({tech_id:t.id,week_key:wk,amount:val})}); }
      await refreshAll(); showToast("✅ Upsells saved!"); setUpsellForm({});
    } catch(e){ showToast("Error: "+e.message,false); }
    setSaving(false);
  }
  async function logSwitchover() {
    if (!swForm.techId||!swForm.planId) return showToast("Select a tech and plan",false);
    setSaving(true);
    try { await sb("switchovers",{method:"POST",body:JSON.stringify({tech_id:swForm.techId,week_key:getWeekKey(),plan_id:swForm.planId})}); await refreshAll(); showToast(`✅ Switchover logged!`); setSwForm({techId:"",planId:""}); }
    catch(e){ showToast("Error: "+e.message,false); }
    setSaving(false);
  }
  async function logCallback() {
    if (!cbForm.techId) return showToast("Select a tech",false);
    const tech = techs.find(t=>t.id===cbForm.techId);
    setSaving(true);
    try {
      await sb("callbacks",{method:"POST",body:JSON.stringify({tech_id:cbForm.techId,reason:cbForm.reason||""})});
      await refreshAll();
      showToast(`📞 Callback logged for ${tech?.name} — ${Math.abs(CALLBACK_PTS)} pts deducted`);
      setCbForm({techId:"",reason:""});
    } catch(e){ showToast("Error: "+e.message,false); }
    setSaving(false);
  }
  async function deleteCallback(id) {
    setSaving(true);
    try { await sb(`callbacks?id=eq.${id}`,{method:"DELETE",prefer:"return=minimal"}); await refreshAll(); showToast("Callback removed"); }
    catch(e){ showToast("Error: "+e.message,false); }
    setSaving(false);
  }
  async function toggleTeamLead(tech) {
    setSaving(true);
    try {
      const newVal = !tech.is_lead;
      await sb(`techs?id=eq.${tech.id}`,{method:"PATCH",body:JSON.stringify({is_lead:newVal}),prefer:"return=minimal"});
      // If removing lead status, unassign all their team members
      if (!newVal) {
        const members = techs.filter(t=>t.team_lead_id===tech.id);
        await Promise.all(members.map(m=>sb(`techs?id=eq.${m.id}`,{method:"PATCH",body:JSON.stringify({team_lead_id:null}),prefer:"return=minimal"})));
      }
      await refreshAll();
      showToast(newVal?`✅ ${tech.name} is now a Team Lead`:`${tech.name} removed as Team Lead`);
    } catch(e){ showToast("Error: "+e.message,false); }
    setSaving(false);
  }
  async function assignTeamMember(member, leadId) {
    setSaving(true);
    try {
      await sb(`techs?id=eq.${member.id}`,{method:"PATCH",body:JSON.stringify({team_lead_id:leadId||null}),prefer:"return=minimal"});
      await refreshAll();
      showToast(leadId?`✅ ${member.name} added to team`:`${member.name} removed from team`);
    } catch(e){ showToast("Error: "+e.message,false); }
    setSaving(false);
  }
  async function saveReviews() {
    const mk=getMonthKey(); setSaving(true);
    try {
      for (const t of techs) { const val=parseInt(reviewForm[t.id]); if(isNaN(val)||val<=0)continue; const existing=await sb(`reviews?tech_id=eq.${t.id}&month_key=eq.${mk}&select=id`); if(existing&&existing.length>0)await sb(`reviews?id=eq.${existing[0].id}`,{method:"PATCH",body:JSON.stringify({count:val}),prefer:"return=minimal"}); else await sb("reviews",{method:"POST",body:JSON.stringify({tech_id:t.id,month_key:mk,count:val})}); }
      await refreshAll(); showToast("✅ Reviews saved!"); setReviewForm({});
    } catch(e){ showToast("Error: "+e.message,false); }
    setSaving(false);
  }

  const wk=getWeekKey(), mk=getMonthKey();
  const wkUp={}; upsells.filter(u=>u.week_key===wk).forEach(u=>{wkUp[u.tech_id]=u.amount;});
  const mkRev={}; reviews.filter(r=>r.month_key===mk).forEach(r=>{mkRev[r.tech_id]=r.count;});
  const allTimeUp={}; upsells.forEach(u=>{allTimeUp[u.tech_id]=(allTimeUp[u.tech_id]||0)+u.amount;});

  const inp={ background:C.white, border:`1px solid ${C.border}`, color:C.black, padding:"10px 14px", borderRadius:"8px", fontSize:"14px", fontFamily:"'Barlow',sans-serif", width:"100%", boxSizing:"border-box" };
  const sel=(val)=>({...inp, color:val?C.black:C.muted});
  const btn=(color)=>({ background:saving?C.border:color||C.blue, border:"none", color:C.black, padding:"13px", borderRadius:"24px", cursor:saving?"not-allowed":"pointer", fontSize:"13px", fontWeight:"900", fontStyle:"italic", letterSpacing:"2px", fontFamily:"'Barlow Condensed',sans-serif", width:"100%", textTransform:"uppercase" });

  return (
    <div style={{ minHeight:"100vh", background:"#f0f8ff" }}>
      <style>{GS}</style>
      <Header title="Admin Panel" subtitle="Skylo Standard Board" right={<LogoutBtn onLogout={onLogout}/>}/>
      <TabBar tabs={[["upsells","Upsells"],["reviews","⭐ Reviews"],["switchovers","Converts"],["callbacks","📞 Callbacks"],["award","Award Badge"],["add","Add Tech"],["manage","Manage"],["teams","👥 Teams"],["delete","🗑️ Delete"],["journey","🗺️ Journey"],["kyle","👑 Kyle Bonus"],["quota","📋 Quota"],["incentive","🎁 Rewards"],["ridealong","🚗 Ride-Alongs"]]} active={tab} setActive={setTab} accent={C.green}/>
      <div style={{ padding:"20px", maxWidth:"700px", margin:"0 auto" }}>

        {tab==="upsells"&&(
          <AdminUpsellEntry techs={techs} upsells={upsells} saving={saving} setSaving={setSaving} refreshAll={refreshAll} showToast={showToast} allTimeUp={allTimeUp}/>
        )}

        {tab==="reviews"&&(
          <AdminReviewEntry techs={techs} reviews={reviews} saving={saving} setSaving={setSaving} refreshAll={refreshAll} showToast={showToast}/>
        )}
        {tab==="switchovers"&&(
          <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:"12px", padding:"20px", display:"flex", flexDirection:"column", gap:"12px" }}>
            <Label color={C.purple}>Log a Switchover · {formatWeekLabel(wk)}</Label>
            <select value={swForm.techId} onChange={e=>setSwForm(f=>({...f,techId:e.target.value}))} style={sel(swForm.techId)}>
              <option value="">— Select Tech —</option>
              {techs.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <select value={swForm.planId} onChange={e=>setSwForm(f=>({...f,planId:e.target.value}))} style={sel(swForm.planId)}>
              <option value="">— Select Plan —</option>
              {SERVICE_PLANS.map(p=><option key={p.id} value={p.id}>{p.label} ({p.freq}) · +{p.pts}pts · ${p.ltv.toLocaleString()}/yr LTV</option>)}
            </select>
            <button onClick={logSwitchover} disabled={saving} style={btn(C.purple)}>{saving?"Saving...":"Log Switchover"}</button>
          </div>
        )}

        {tab==="callbacks"&&(
          <div style={{ display:"flex", flexDirection:"column", gap:"16px" }}>
            {/* Log a callback */}
            <div style={{ background:C.white, border:`2px solid #ef444444`, borderTop:`3px solid #ef4444`, borderRadius:"12px", padding:"20px", display:"flex", flexDirection:"column", gap:"12px", boxShadow:"0 2px 8px rgba(239,68,68,0.08)" }}>
              <div>
                <Label color="#ef4444">📞 Log a Callback</Label>
                <div style={{ fontSize:"12px", color:C.muted, marginBottom:"4px" }}>Each callback deducts <strong style={{ color:"#ef4444" }}>{Math.abs(CALLBACK_PTS)} points</strong> — nearly a full week of work. Quality matters.</div>
              </div>
              <select value={cbForm.techId||""} onChange={e=>setCbForm(f=>({...f,techId:e.target.value}))} style={sel(cbForm?.techId)}>
                <option value="">— Select Tech —</option>
                {techs.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
              <input placeholder="Reason / job description (optional)" value={cbForm.reason||""} onChange={e=>setCbForm(f=>({...f,reason:e.target.value}))} style={inp}/>
              <button onClick={logCallback} disabled={saving} style={{ ...btn("#ef4444"), color:C.white }}>{saving?"Saving...":"Log Callback — Deduct Points"}</button>
            </div>

            {/* Callback history */}
            <div style={{ background:C.white, border:`1px solid ${C.border}`, borderRadius:"12px", overflow:"hidden", boxShadow:"0 2px 8px rgba(43,156,240,0.08)" }}>
              <div style={{ padding:"14px 18px", borderBottom:`1px solid ${C.border}`, background:C.cardLt }}>
                <Label color="#ef4444">📋 Callback History</Label>
              </div>
              <div style={{ padding:"14px 18px", display:"flex", flexDirection:"column", gap:"8px" }}>
                {callbacks.length===0&&<div style={{ fontSize:"13px", color:C.muted }}>No callbacks logged yet. Keep it that way! 💪</div>}
                {callbacks.map(cb=>{
                  const tech = techs.find(t=>t.id===cb.tech_id);
                  return (
                    <div key={cb.id} style={{ background:`#ef444410`, border:`1px solid #ef444433`, borderLeft:`3px solid #ef4444`, borderRadius:"8px", padding:"12px 14px", display:"flex", justifyContent:"space-between", alignItems:"center", gap:"12px" }}>
                      <div>
                        <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"900", fontSize:"15px", color:C.black }}>{tech?.name||"Unknown"}</div>
                        <div style={{ fontSize:"11px", color:C.muted, marginTop:"2px" }}>{cb.reason||"No reason provided"} · {new Date(cb.created_at).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"})}</div>
                      </div>
                      <div style={{ display:"flex", alignItems:"center", gap:"10px", flexShrink:0 }}>
                        <span style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"900", fontSize:"16px", color:"#ef4444" }}>{CALLBACK_PTS} pts</span>
                        <button onClick={()=>deleteCallback(cb.id)} disabled={saving} style={{ background:"none", border:`1px solid #ef4444`, color:"#ef4444", padding:"4px 10px", borderRadius:"6px", cursor:"pointer", fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"700", fontSize:"11px" }}>DELETE</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Per-tech callback summary */}
            {callbacks.length>0&&(
              <div style={{ background:C.white, border:`1px solid ${C.border}`, borderRadius:"12px", padding:"16px 18px", boxShadow:"0 2px 8px rgba(43,156,240,0.08)" }}>
                <Label color="#ef4444">📊 All-Time Callback Count</Label>
                <div style={{ display:"flex", flexDirection:"column", gap:"6px" }}>
                  {techs.map(t=>{
                    const count = callbacks.filter(c=>c.tech_id===t.id).length;
                    if (!count) return null;
                    return (
                      <div key={t.id} style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                        <span style={{ fontSize:"13px", color:C.black, fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"700" }}>{t.name}</span>
                        <span style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"900", fontSize:"14px", color:"#ef4444" }}>{count} callback{count>1?"s":""} · {count*Math.abs(CALLBACK_PTS)} pts lost</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {tab==="award"&&(
          <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:"12px", padding:"20px", display:"flex", flexDirection:"column", gap:"12px" }}>
            <Label color={C.blue}>Award a Badge</Label>
            <select value={awardForm.techId} onChange={e=>setAwardForm(f=>({...f,techId:e.target.value}))} style={sel(awardForm.techId)}>
              <option value="">— Select Tech —</option>
              {techs.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <select value={awardForm.badgeId} onChange={e=>setAwardForm(f=>({...f,badgeId:e.target.value}))} style={sel(awardForm.badgeId)}>
              <option value="">— Select Badge —</option>
              {ALL_BADGE_DEFS.map(b=><option key={b.id} value={b.id}>{b.icon} {b.name} ({b.pts>0?`+${b.pts} pts`:"Trophy"})</option>)}
            </select>
            <button onClick={awardBadge} disabled={saving} style={btn(C.blue)}>{saving?"Saving...":"Award Badge"}</button>
          </div>
        )}

        {tab==="add"&&(
          <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:"12px", padding:"20px", display:"flex", flexDirection:"column", gap:"12px" }}>
            <Label color={C.green}>Add New Tech</Label>
            <input placeholder="Full Name" value={addForm.name} onChange={e=>setAddForm(f=>({...f,name:e.target.value}))} style={inp}/>
            <input placeholder="4-Digit PIN" value={addForm.pin} maxLength={4} onChange={e=>setAddForm(f=>({...f,pin:e.target.value.replace(/\D/g,"")}))} style={inp}/>
            <input placeholder="Initials (optional)" value={addForm.avatar} maxLength={2} onChange={e=>setAddForm(f=>({...f,avatar:e.target.value.toUpperCase()}))} style={inp}/>
            <div>
              <div style={{ fontSize:"12px", color:C.muted, marginBottom:"6px" }}>Start Date</div>
              <input type="date" value={addForm.start_date} onChange={e=>setAddForm(f=>({...f,start_date:e.target.value}))} style={inp}/>
            </div>
            <button onClick={addTech} disabled={saving} style={btn(C.green)}>{saving?"Saving...":"Add Tech"}</button>
          </div>
        )}

        {tab==="manage"&&(
          <div style={{ display:"flex", flexDirection:"column", gap:"10px" }}>
            {techs.map(t=>(
              <div key={t.id} style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:"12px", padding:"16px 18px" }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:"10px" }}>
                  <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"800", fontSize:"17px", color:C.black }}>{t.name}</div>
                  <span style={{ fontSize:"12px", color:C.muted, fontFamily:"'Barlow Condensed',sans-serif" }}>PIN: {t.pin}</span>
                </div>
                <div style={{ display:"flex", alignItems:"center", gap:"10px", marginBottom:"10px" }}>
                  <span style={{ fontSize:"12px", color:C.muted }}>Start date:</span>
                  <input type="date" defaultValue={t.start_date||""} onBlur={e=>updateStartDate(t.id,e.target.value)} style={{ background:C.cardLt, border:`1px solid ${C.border}`, color:C.black, padding:"4px 8px", borderRadius:"4px", fontSize:"12px", fontFamily:"'Barlow Condensed',sans-serif" }}/>
                  {t.start_date&&<span style={{ fontSize:"12px", color:C.blue, fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"700" }}>{formatTenure(t.start_date)}</span>}
                </div>
                <div style={{ display:"flex", flexWrap:"wrap", gap:"5px" }}>
                  {t.badges.map(bid=>{ const b=BADGE_MAP[bid]; return b?(
                    <span key={bid} style={{ background:`${C.blue}18`, border:`1px solid ${C.blue}44`, borderRadius:"3px", padding:"3px 8px", fontSize:"12px", display:"inline-flex", alignItems:"center", gap:"4px" }}>
                      <span>{b.icon}</span><span style={{ color:C.black, fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"700" }}>{b.name}</span>
                      <button onClick={()=>revokeBadge(t.id,bid)} style={{ background:"none", border:"none", color:"#ff4444", cursor:"pointer", fontSize:"13px", lineHeight:1, padding:"0 0 0 2px" }}>×</button>
                    </span>
                  ):null; })}
                </div>
                <div style={{ marginTop:"12px", paddingTop:"12px", borderTop:`1px solid ${C.border}` }}>
                  <button onClick={()=>deleteTech(t)} disabled={saving} style={{ background:"none", border:"1px solid #ef4444", color:"#ef4444", padding:"7px 16px", borderRadius:"8px", cursor:saving?"not-allowed":"pointer", fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"800", fontSize:"12px", letterSpacing:"1px", textTransform:"uppercase" }}>
                    🗑️ Remove {t.name} from Skylo
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}


        {tab==="teams"&&(
          <div style={{ display:"flex", flexDirection:"column", gap:"16px" }}>
            <div style={{ background:C.white, border:`1px solid ${C.border}`, borderTop:`3px solid ${C.gold}`, borderRadius:"12px", padding:"20px", boxShadow:"0 2px 8px rgba(43,156,240,0.08)" }}>
              <Label color={C.gold}>👥 Team Lead Assignments</Label>
              <div style={{ fontSize:"13px", color:C.muted, marginBottom:"16px" }}>Mark techs as team leads and assign members to their team. Teams can be changed anytime.</div>
              <div style={{ display:"flex", flexDirection:"column", gap:"12px" }}>
                {techs.map(t=>(
                  <div key={t.id} style={{ background:C.cardLt, border:`1px solid ${t.is_lead?C.gold:C.border}`, borderLeft:`3px solid ${t.is_lead?C.gold:C.border}`, borderRadius:"10px", padding:"12px 14px" }}>
                    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:"8px" }}>
                      <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"900", fontStyle:"italic", fontSize:"16px", color:C.black }}>
                        {t.name}
                        {t.is_lead&&<span style={{ marginLeft:"8px", background:C.gold, color:C.white, fontSize:"9px", padding:"2px 8px", borderRadius:"8px", fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"900", verticalAlign:"middle" }}>TEAM LEAD</span>}
                      </div>
                      <button onClick={()=>toggleTeamLead(t)} disabled={saving}
                        style={{ background:t.is_lead?"#ef444422":"transparent", border:`1px solid ${t.is_lead?"#ef4444":C.gold}`, color:t.is_lead?"#ef4444":C.gold, padding:"5px 14px", borderRadius:"20px", cursor:"pointer", fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"800", fontSize:"11px", letterSpacing:"1px" }}>
                        {t.is_lead?"Remove Lead":"Make Lead"}
                      </button>
                    </div>
                    {t.is_lead&&(
                      <div>
                        <div style={{ fontSize:"11px", color:C.muted, marginBottom:"6px", fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"700" }}>TEAM MEMBERS</div>
                        <div style={{ display:"flex", flexWrap:"wrap", gap:"6px" }}>
                          {techs.filter(m=>m.id!==t.id).map(m=>{
                            const onTeam = m.team_lead_id===t.id;
                            const onOtherTeam = m.team_lead_id && m.team_lead_id!==t.id;
                            const otherLead = techs.find(x=>x.id===m.team_lead_id);
                            return (
                              <button key={m.id} onClick={()=>assignTeamMember(m,onTeam?null:t.id)} disabled={saving||m.is_lead}
                                style={{ background:onTeam?`${C.gold}20`:"transparent", border:`1px solid ${onTeam?C.gold:C.border}`, color:onTeam?C.gold:C.muted, padding:"4px 12px", borderRadius:"16px", cursor:m.is_lead?"not-allowed":"pointer", fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"700", fontSize:"11px", opacity:m.is_lead?0.4:1 }}>
                                {onTeam?"✓ ":""}{m.name}{onOtherTeam?` (${otherLead?.name}'s team)`:""}
                              </button>
                            );
                          })}
                        </div>
                        <div style={{ fontSize:"10px", color:C.muted, marginTop:"6px" }}>Tap to add/remove. Can't add other leads.</div>
                      </div>
                    )}
                    {!t.is_lead&&t.team_lead_id&&(
                      <div style={{ fontSize:"11px", color:C.muted }}>
                        On {techs.find(x=>x.id===t.team_lead_id)?.name}'s team
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {tab==="delete"&&(
          <DeleteTab techs={techs} upsells={upsells} switchovers={switchovers} reviews={reviews} saving={saving} setSaving={setSaving} refreshAll={refreshAll} showToast={showToast}/>
        )}
        {tab==="journey"&&(
          <div>
            <div style={{ fontSize:"13px", color:C.muted, marginBottom:"16px" }}>Tap any card to expand full breakdown.</div>
            <JourneyBoard techs={techs} upsells={upsells} switchovers={switchovers} reviews={reviews} quota={quota} callbacks={callbacks||[]}/>
          </div>
        )}
        {tab==="kyle"&&(
          <KyleBonusTab techs={techs} upsells={upsells} switchovers={switchovers} reviews={reviews} quota={quota}/>
        )}
        {tab==="quota"&&(
          <QuotaSettings quota={quota} onSave={saveQuota} saving={saving}/>
        )}
        {tab==="incentive"&&(
          <div>
            <div style={{ fontSize:"13px", color:C.muted, marginBottom:"16px" }}>Team rewards overview — all tiers and prizes.</div>
            <IncentiveBoard techs={techs} upsells={upsells} switchovers={switchovers} reviews={reviews} callbacks={callbacks||[]} currentId={null}/>
          </div>
        )}

        {tab==="ridealong"&&(
          <RideAlongTab
            techs={techs}
            rideAlongs={rideAlongs||[]}
            schedules={schedules||[]}
            saving={saving}
            onSave={async(data)=>{
              setSaving(true);
              try { await sb("ride_alongs",{method:"POST",body:JSON.stringify(data)}); await refreshAll(); showToast("✅ Ride-along saved!"); }
              catch(e){ showToast("Error: "+e.message,false); }
              setSaving(false);
            }}
            onSaveSchedule={async(date,techId)=>{
              try {
                const existing = await sb(`ride_along_schedule?date=eq.${date}&select=id`);
                if(existing&&existing.length>0) await sb(`ride_along_schedule?id=eq.${existing[0].id}`,{method:"PATCH",body:JSON.stringify({tech_id:techId||null}),prefer:"return=minimal"});
                else if(techId) await sb("ride_along_schedule",{method:"POST",body:JSON.stringify({date,tech_id:techId})});
                await refreshAll();
              } catch(e){ showToast("Error saving schedule: "+e.message,false); }
            }}
          />
        )}

      </div>
      {toast&&(
        <div style={{ position:"fixed", bottom:"24px", left:"50%", transform:"translateX(-50%)", background:toast.ok?C.green:"#ef4444", color:C.white, padding:"12px 28px", borderRadius:"24px", fontSize:"14px", fontWeight:"900", zIndex:999, whiteSpace:"nowrap", fontFamily:"'Barlow Condensed',sans-serif", letterSpacing:"1px", fontStyle:"italic", boxShadow:"0 4px 20px rgba(0,0,0,0.15)" }}>
          {toast.msg}
        </div>
      )}
    </div>
  );
}

// ─── MAIN APP ─────────────────────────────────────────────────────────────────
export default function App() {
  const [techs, setTechs] = useState([]);
  const [upsells, setUpsells] = useState([]);
  const [switchovers, setSwitchovers] = useState([]);
  const [reviews, setReviews] = useState([]);
  const [callbacks, setCallbacks] = useState([]);
  const [rideAlongs, setRideAlongs] = useState([]);
  const [schedules, setSchedules] = useState([]);
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [dbError, setDbError] = useState(null);

  const [quota, setQuota] = useState(DEFAULT_QUOTA);

  const loadAll = useCallback(async () => {
    try {
      const [t,u,s,r,ra,sch,settings,cb] = await Promise.all([
        sb("techs?select=*&order=name"),
        sb("upsells?select=*"),
        sb("switchovers?select=*"),
        sb("reviews?select=*"),
        sb("ride_alongs?select=*&order=date.desc").catch(()=>[]),
        sb("ride_along_schedule?select=*").catch(()=>[]),
        sb("settings?key=eq.quota&select=*").catch(()=>[]),
        sb("callbacks?select=*&order=created_at.desc").catch(()=>[]),
      ]);
      setTechs(t||[]); setUpsells(u||[]); setSwitchovers(s||[]); setReviews(r||[]);
      setRideAlongs(ra||[]); setSchedules(sch||[]); setCallbacks(cb||[]);
      if (settings&&settings.length>0) {
        try { setQuota(JSON.parse(settings[0].value)); } catch {}
      }
      return true;
    } catch(e) { setDbError(e.message); return false; }
  }, []);

  useEffect(() => { (async()=>{ const ok=await loadAll(); setLoading(false); if(!ok)return; })(); }, []);

  function handlePin(pin) {
    if (pin===ADMIN_PIN) { setUser({type:"admin"}); return true; }
    const tech=techs?.find(t=>t.pin===pin);
    if (tech) { setUser({type:"tech",techId:tech.id}); return true; }
    return false;
  }
  const currentTech = user?.type==="tech" ? techs?.find(t=>t.id===user.techId) : null;

  if (loading) return (
    <div style={{ minHeight:"100vh", background:"#f0f8ff", display:"flex", alignItems:"center", justifyContent:"center", flexDirection:"column", gap:"16px" }}>
      <style>{GS}</style>
      <Logo h={70}/>
      <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontStyle:"italic", color:C.blue, letterSpacing:"4px", fontSize:"14px", fontWeight:"800" }}>LOADING...</div>
    </div>
  );

  if (dbError) return (
    <div style={{ minHeight:"100vh", background:"#f0f8ff", display:"flex", alignItems:"center", justifyContent:"center", flexDirection:"column", gap:"16px", padding:"24px", textAlign:"center" }}>
      <style>{GS}</style>
      <Logo h={70}/>
      <div style={{ color:"#ef4444", fontSize:"13px", maxWidth:"560px" }}>
        <strong>Database setup needed.</strong> Run this SQL in Supabase → SQL Editor:<br/><br/>
        <code style={{ background:C.white, border:`1px solid ${C.border}`, padding:"12px", borderRadius:"10px", fontSize:"11px", display:"block", textAlign:"left", whiteSpace:"pre", color:C.black }}>
{`alter table techs add column if not exists start_date date;
alter table techs add column if not exists is_lead boolean default false;
alter table techs add column if not exists team_lead_id uuid references techs(id);

create table if not exists reviews (
  id uuid primary key default gen_random_uuid(),
  tech_id uuid references techs(id),
  month_key text, count integer default 0,
  created_at timestamptz default now()
);
alter table reviews enable row level security;
drop policy if exists "public access" on reviews;
create policy "public access" on reviews for all using (true) with check (true);

create table if not exists settings (
  id uuid primary key default gen_random_uuid(),
  key text unique not null,
  value text not null,
  created_at timestamptz default now()
);
alter table settings enable row level security;
drop policy if exists "public access" on settings;
create policy "public access" on settings for all using (true) with check (true);

create table if not exists callbacks (
  id uuid primary key default gen_random_uuid(),
  tech_id uuid references techs(id),
  reason text default '',
  created_at timestamptz default now()
);
alter table callbacks enable row level security;
drop policy if exists "public access" on callbacks;
create policy "public access" on callbacks for all using (true) with check (true);`}
        </code><br/>
        <button onClick={()=>{setDbError(null);setLoading(true);loadAll().then(()=>setLoading(false));}} style={{ background:C.blue, border:"none", color:C.black, padding:"12px 28px", borderRadius:"24px", cursor:"pointer", fontFamily:"'Barlow Condensed',sans-serif", fontSize:"14px", fontWeight:"900", fontStyle:"italic", letterSpacing:"2px" }}>RETRY</button>
      </div>
    </div>
  );

  if (!user) return (
    <div style={{ minHeight:"100vh", background:"linear-gradient(160deg, #e8f4ff 0%, #f0f8ff 50%, #e0f0ff 100%)", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:"48px" }}>
      <style>{GS}</style>
      <div style={{ textAlign:"center" }}>
        <Logo h={90}/>
        <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"900", fontStyle:"italic", fontSize:"48px", color:C.black, letterSpacing:"2px", marginTop:"20px", lineHeight:1 }}>THE STANDARD</div>
        <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"900", fontStyle:"italic", fontSize:"48px", color:C.blue, letterSpacing:"2px", lineHeight:1 }}>BOARD</div>
        <div style={{ fontSize:"13px", color:C.muted, letterSpacing:"3px", marginTop:"12px", textTransform:"uppercase", fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"600" }}>Enter your PIN</div>
      </div>
      <PinPad onSubmit={handlePin}/>
    </div>
  );

  if (user.type==="admin") return (
    <AdminPanel techs={techs} setTechs={setTechs} upsells={upsells} setUpsells={setUpsells}
      switchovers={switchovers} setSwitchovers={setSwitchovers} reviews={reviews} setReviews={setReviews}
      callbacks={callbacks} rideAlongs={rideAlongs} schedules={schedules} quota={quota} setQuota={setQuota}
      onLogout={()=>setUser(null)} refreshAll={loadAll}/>
  );
  if (user.type==="tech"&&currentTech) return (
    <TechDashboard tech={currentTech} techs={techs} upsells={upsells} switchovers={switchovers}
      reviews={reviews} callbacks={callbacks} quota={quota} onLogout={()=>setUser(null)}/>
  );
  return null;
}
